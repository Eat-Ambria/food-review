-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 5: the database functions behind the Admin "User Management" screen.
--
-- WHY IT EXISTS
--   The app has no direct UPDATE rights on app_users (see migration 2), so
--   nobody, not even a hacked browser, can promote themselves to admin. Admin
--   edits go through these functions, which check:
--     • the caller is an active admin
--     • the username format is valid and the username is not already taken
--     • an admin cannot remove their own admin access or deactivate themselves
--     • at least one active admin always remains
--   Creating users needs Supabase Auth, so that happens in the admin-users Edge
--   Function, not here.
--
-- USED BY
--   src/services/userAdminService.ts
--
-- DEPENDS ON
--   Migrations 1–4.
--
-- SAFE TO RE-RUN
--   Yes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- admin_list_users: every user plus whether they are currently locked out.
-- (locked_until lives in app_user_secrets, which the browser cannot read.)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id uuid, name text, username text, role text, mobile_number text, email text,
  is_active boolean, must_change_pin boolean, last_login_at timestamptz,
  created_at timestamptz, locked_until timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can list users' using errcode = '42501';
  end if;
  return query
    select u.id, u.name, u.username, u.role, u.mobile_number, u.email,
           u.is_active, u.must_change_pin, u.last_login_at, u.created_at,
           case when s.locked_until > now() then s.locked_until end
      from public.app_users u
      left join public.app_user_secrets s on s.user_id = u.id
     order by u.name;
end $$;

-- -----------------------------------------------------------------------------
-- admin_update_user: edit name, username, role, contact details, active flag.
-- Returns {ok, error} so the screen can show a friendly message.
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_user(
  p_user_id uuid, p_name text, p_username text, p_role text,
  p_mobile text, p_email text, p_is_active boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_target   public.app_users%rowtype;
  v_username text := lower(trim(coalesce(p_username, '')));
  v_name     text := trim(coalesce(p_name, ''));
  v_other_admins int;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Only an admin can edit users.');
  end if;

  select * into v_target from public.app_users where id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'User not found.');
  end if;

  if v_name = '' or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'Name is required (max 120 characters).');
  end if;
  if v_username !~ '^[a-z0-9]+(\.[a-z0-9]+)*$' or length(v_username) > 64 then
    return jsonb_build_object('ok', false, 'error',
      'Username can only use lowercase letters, numbers and dots (e.g. rahul.sharma).');
  end if;
  if p_role not in ('admin', 'recorder', 'poc') then
    return jsonb_build_object('ok', false, 'error', 'Invalid role.');
  end if;
  if exists (select 1 from public.app_users where username = v_username and id <> p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'Username "' || v_username || '" is already taken.');
  end if;

  -- Self-protection: an admin cannot lock themselves out.
  if p_user_id = auth.uid() and (p_role <> 'admin' or not p_is_active) then
    return jsonb_build_object('ok', false, 'error', 'You cannot remove your own admin access or deactivate yourself.');
  end if;

  -- Never leave the system without an active admin.
  if v_target.role = 'admin' and v_target.is_active and (p_role <> 'admin' or not p_is_active) then
    select count(*) into v_other_admins from public.app_users
     where role = 'admin' and is_active and id <> p_user_id;
    if v_other_admins = 0 then
      return jsonb_build_object('ok', false, 'error', 'At least one active admin must remain.');
    end if;
  end if;

  update public.app_users
     set name = v_name,
         username = v_username,
         role = p_role,
         mobile_number = nullif(trim(coalesce(p_mobile, '')), ''),
         email = nullif(trim(coalesce(p_email, '')), ''),
         is_active = p_is_active
   where id = p_user_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_list_users(),
                       public.admin_update_user(uuid, text, text, text, text, text, boolean)
  from public, anon;
grant execute on function public.admin_list_users(),
                          public.admin_update_user(uuid, text, text, text, text, text, boolean)
  to authenticated;
