-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 3: the database side of username + 4-digit PIN login.
--
-- WHY IT EXISTS
--   A 4-digit PIN has only 10,000 combinations, so the ONLY real protection is
--   checking it on the server with an attempt limit:
--     • PINs are stored as bcrypt hashes (pgcrypto crypt + gen_salt('bf')).
--     • 5 wrong PINs → account locked for 15 minutes (both values are in app_settings).
--     • 30 attempts per network address per 15 min, which slows down someone
--       trying "0000" against every imported username.
--     • The row is locked (FOR UPDATE) during the check, so parallel requests
--       cannot sneak in extra guesses.
--   Users never get a password they could type into Supabase directly. Their
--   Supabase Auth password is random and thrown away. The only way to log in is
--   the auth-login Edge Function, which calls auth_check_pin() below.
--
-- USED BY
--   supabase/functions/auth-login      → auth_check_pin
--   supabase/functions/admin-users     → auth_create_app_user (Phase 2 import too)
--   React Change PIN screen            → change_my_pin
--   React User Management              → admin_reset_pin, admin_unlock_user
--   SQL Editor, once, for the 1st admin → bootstrap_admin
--
-- DEPENDS ON
--   Migrations 1 and 2.
-- =============================================================================

-- Reads an integer setting with a fallback, so a missing row never breaks login.
create or replace function public.setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default)
$$;

create or replace function public.hash_pin(p_pin text)
returns text language sql volatile security definer set search_path = public, extensions as $$
  select extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
$$;

-- Rejects PINs that are trivially guessable. Returns null when the PIN is OK,
-- otherwise a message the user can understand.
create or replace function public.pin_problem(p_pin text)
returns text language sql immutable as $$
  select case
    when p_pin is null or p_pin !~ '^\d{4}$'            then 'PIN must be exactly 4 digits'
    when p_pin ~ '^(\d)\1{3}$'                          then 'PIN cannot be the same digit repeated (like 0000 or 1111)'
    when p_pin in ('1234','2345','3456','4567','5678','6789','0123',
                   '9876','8765','7654','6543','5432','4321','3210') then 'PIN cannot be a simple sequence like 1234'
    else null
  end
$$;

-- -----------------------------------------------------------------------------
-- auth_check_pin — the heart of login. Service role only.
-- Returns {ok, reason, user_id, locked_until}.
-- reason: ok | invalid | locked | inactive | rate_limited
-- "invalid" is used for BOTH unknown username and wrong PIN, so an attacker
-- cannot discover which usernames exist.
-- -----------------------------------------------------------------------------
create or replace function public.auth_check_pin(p_username text, p_pin text, p_ip text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_user     public.app_users%rowtype;
  v_secret   public.app_user_secrets%rowtype;
  v_ip_count int;
  v_max      int := public.setting_int('pin_max_attempts', 5);
  v_lock_min int := public.setting_int('pin_lock_minutes', 15);
  v_uname    text := lower(trim(coalesce(p_username, '')));
begin
  -- 1. Per-network-address throttle (counts every attempt, success or not).
  select count(*) into v_ip_count from public.auth_login_attempts
   where ip = p_ip
     and created_at > now() - make_interval(mins => public.setting_int('ip_window_minutes', 15));
  if p_ip is not null and v_ip_count >= public.setting_int('ip_max_attempts', 30) then
    insert into public.auth_login_attempts (username, ip, outcome) values (v_uname, p_ip, 'rate_limited');
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select * into v_user from public.app_users where username = v_uname;
  if not found then
    -- Spend roughly the same time as a real check so timing doesn't leak existence.
    perform extensions.crypt(coalesce(p_pin, ''), extensions.gen_salt('bf', 10));
    insert into public.auth_login_attempts (username, ip, outcome) values (v_uname, p_ip, 'invalid');
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Lock this user's secret row for the rest of the transaction.
  select * into v_secret from public.app_user_secrets where user_id = v_user.id for update;
  if not found then
    insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'invalid');
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- 2. Locked? Refuse WITHOUT checking the PIN, so guessing stops during the lock.
  if v_secret.locked_until is not null and v_secret.locked_until > now() then
    insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'locked');
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_secret.locked_until);
  end if;

  -- 3. Wrong PIN → count it, lock at the limit.
  if p_pin is null or extensions.crypt(p_pin, v_secret.pin_hash) <> v_secret.pin_hash then
    if v_secret.failed_attempts + 1 >= v_max then
      update public.app_user_secrets
         set failed_attempts = 0, locked_until = now() + make_interval(mins => v_lock_min)
       where user_id = v_user.id;
      insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'locked');
      return jsonb_build_object('ok', false, 'reason', 'locked',
                                'locked_until', now() + make_interval(mins => v_lock_min));
    end if;
    update public.app_user_secrets set failed_attempts = failed_attempts + 1 where user_id = v_user.id;
    insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'invalid');
    return jsonb_build_object('ok', false, 'reason', 'invalid',
                              'attempts_left', v_max - (v_secret.failed_attempts + 1));
  end if;

  -- 4. Correct PIN but deactivated. Revealed only after a correct PIN.
  if not v_user.is_active then
    insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'inactive');
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  update public.app_user_secrets set failed_attempts = 0, locked_until = null where user_id = v_user.id;
  update public.app_users set last_login_at = now() where id = v_user.id;
  insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'ok');
  return jsonb_build_object('ok', true, 'reason', 'ok', 'user_id', v_user.id);
end $$;

-- -----------------------------------------------------------------------------
-- auth_create_app_user — called by the admin-users Edge Function AFTER it has
-- created the Supabase Auth user. Default PIN 0000, must change on first login.
-- -----------------------------------------------------------------------------
create or replace function public.auth_create_app_user(
  p_id uuid, p_name text, p_username text, p_role text,
  p_mobile text default null, p_email text default null, p_created_by uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.app_users (id, name, username, role, mobile_number, email, must_change_pin, created_by)
  values (p_id, trim(p_name), lower(trim(p_username)), p_role, p_mobile, p_email, true, p_created_by);
  insert into public.app_user_secrets (user_id, pin_hash) values (p_id, public.hash_pin('0000'));
end $$;

-- -----------------------------------------------------------------------------
-- change_my_pin — the logged-in user changes their own PIN. Requires the
-- current PIN, and wrong guesses count toward the same lockout as login.
-- Returns {ok, error}. It returns instead of RAISE-ing because an exception
-- would roll back the failed-attempt counter and give unlimited guesses.
-- -----------------------------------------------------------------------------
create or replace function public.change_my_pin(p_current_pin text, p_new_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_secret  public.app_user_secrets%rowtype;
  v_problem text;
  v_max     int := public.setting_int('pin_max_attempts', 5);
begin
  if not public.is_active_user() then
    return jsonb_build_object('ok', false, 'error', 'Your session has ended. Please sign in again.');
  end if;

  select * into v_secret from public.app_user_secrets where user_id = auth.uid() for update;
  if v_secret.locked_until is not null and v_secret.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong PINs. Try again after '
      || to_char(v_secret.locked_until at time zone 'Asia/Kolkata', 'HH12:MI AM') || '.');
  end if;

  if extensions.crypt(coalesce(p_current_pin, ''), v_secret.pin_hash) <> v_secret.pin_hash then
    if v_secret.failed_attempts + 1 >= v_max then
      update public.app_user_secrets
         set failed_attempts = 0,
             locked_until = now() + make_interval(mins => public.setting_int('pin_lock_minutes', 15))
       where user_id = auth.uid();
      return jsonb_build_object('ok', false, 'error', 'Too many wrong PINs. Your account is locked for '
        || public.setting_int('pin_lock_minutes', 15) || ' minutes.');
    end if;
    update public.app_user_secrets set failed_attempts = failed_attempts + 1 where user_id = auth.uid();
    return jsonb_build_object('ok', false, 'error', 'Current PIN is incorrect.');
  end if;

  v_problem := public.pin_problem(p_new_pin);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'error', v_problem || '.');
  end if;
  if p_new_pin = p_current_pin then
    return jsonb_build_object('ok', false, 'error', 'New PIN must be different from the current PIN.');
  end if;

  update public.app_user_secrets
     set pin_hash = public.hash_pin(p_new_pin), failed_attempts = 0, locked_until = null, pin_changed_at = now()
   where user_id = auth.uid();
  update public.app_users set must_change_pin = false where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- Admin: reset a user's PIN back to 0000 (forces a change at next login) and
-- clear any lock. Admin cannot see or choose the PIN.
-- -----------------------------------------------------------------------------
create or replace function public.admin_reset_pin(p_user_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reset PINs' using errcode = '42501';
  end if;
  update public.app_user_secrets
     set pin_hash = public.hash_pin('0000'), failed_attempts = 0, locked_until = null, pin_changed_at = null
   where user_id = p_user_id;
  update public.app_users set must_change_pin = true where id = p_user_id;
end $$;

create or replace function public.admin_unlock_user(p_user_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can unlock users' using errcode = '42501';
  end if;
  update public.app_user_secrets set failed_attempts = 0, locked_until = null where user_id = p_user_id;
end $$;

-- -----------------------------------------------------------------------------
-- bootstrap_admin — creates the FIRST admin. It works only while no admin
-- exists, and only from the SQL Editor (no API role may call it).
-- Usage: create the Auth user in Dashboard → Authentication → Add user, then
--   select public.bootstrap_admin('<that user id>', 'Your Name', 'your.username');
-- -----------------------------------------------------------------------------
create or replace function public.bootstrap_admin(p_auth_user_id uuid, p_name text, p_username text)
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  if exists (select 1 from public.app_users where role = 'admin') then
    raise exception 'An admin already exists. Create more users from the app.';
  end if;
  perform public.auth_create_app_user(p_auth_user_id, p_name, p_username, 'admin');
  return 'Admin created. Sign in as ' || lower(trim(p_username)) || ' with PIN 0000; you will be asked to change it.';
end $$;

-- -----------------------------------------------------------------------------
-- Who may call what. Postgres grants EXECUTE to PUBLIC by default, so strip
-- that first, then grant narrowly.
-- -----------------------------------------------------------------------------
revoke all on function public.setting_int(text, int), public.hash_pin(text),
                       public.auth_check_pin(text, text, text),
                       public.auth_create_app_user(uuid, text, text, text, text, text, uuid),
                       public.change_my_pin(text, text), public.admin_reset_pin(uuid),
                       public.admin_unlock_user(uuid), public.bootstrap_admin(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.auth_check_pin(text, text, text),
                          public.auth_create_app_user(uuid, text, text, text, text, text, uuid)
  to service_role;
grant execute on function public.change_my_pin(text, text), public.admin_reset_pin(uuid),
                          public.admin_unlock_user(uuid)
  to authenticated;
