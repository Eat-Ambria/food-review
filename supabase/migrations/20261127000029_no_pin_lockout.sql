-- Migration 29: wrong PINs never lock an account. Each wrong PIN slows the next answer; after 10 wrong PINs in a minute
-- or 30 in an hour on one username, that username waits a little before trying again (safe to run again).
create index if not exists auth_login_attempts_user_time_idx on public.auth_login_attempts (username, created_at desc);

create or replace function public.auth_check_pin(p_username text, p_pin text, p_ip text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_user    public.app_users%rowtype;
  v_secret  public.app_user_secrets%rowtype;
  v_uname   text := lower(trim(coalesce(p_username, '')));
  v_recent  int;
  v_minute  int;
  v_hour    int;
begin
  perform pg_advisory_xact_lock(hashtext('login:' || v_uname));

  select count(*) filter (where created_at > now() - interval '15 minutes'),
         count(*) filter (where created_at > now() - interval '1 minute'),
         count(*)
    into v_recent, v_minute, v_hour
    from public.auth_login_attempts
   where username = v_uname and outcome = 'invalid' and created_at > now() - interval '1 hour';

  if v_minute >= 10 or v_hour >= 30 then
    insert into public.auth_login_attempts (username, ip, outcome) values (v_uname, p_ip, 'rate_limited');
    return jsonb_build_object('ok', false, 'reason', 'slow_down', 'failed', v_recent);
  end if;

  select * into v_user from public.app_users where username = v_uname;
  if not found then
    perform extensions.crypt(coalesce(p_pin, ''), extensions.gen_salt('bf', 10));
    insert into public.auth_login_attempts (username, ip, outcome) values (v_uname, p_ip, 'invalid');
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'failed', v_recent + 1);
  end if;

  select * into v_secret from public.app_user_secrets where user_id = v_user.id for update;
  if not found or p_pin is null or extensions.crypt(p_pin, v_secret.pin_hash) <> v_secret.pin_hash then
    if found then
      update public.app_user_secrets set failed_attempts = failed_attempts + 1, locked_until = null where user_id = v_user.id;
    end if;
    insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'invalid');
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'failed', v_recent + 1);
  end if;

  if not v_user.is_active then
    insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'inactive');
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  update public.app_user_secrets set failed_attempts = 0, locked_until = null where user_id = v_user.id;
  update public.app_users set last_login_at = now() where id = v_user.id;
  insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'ok');
  return jsonb_build_object('ok', true, 'reason', 'ok', 'user_id', v_user.id);
end $$;

revoke all on function public.auth_check_pin(text, text, text) from public, anon, authenticated;
grant execute on function public.auth_check_pin(text, text, text) to service_role;

update public.app_user_secrets set locked_until = null, failed_attempts = 0 where locked_until is not null;
