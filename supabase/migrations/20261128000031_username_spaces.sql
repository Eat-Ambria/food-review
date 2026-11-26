-- Migration 31: usernames may contain single spaces (e.g. "chaitanya arora"); sign-in still works with or without them.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.app_users'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%username%'
  loop
    execute format('alter table public.app_users drop constraint %I', c);
  end loop;
end $$;
alter table public.app_users add constraint app_users_username_check
  check (username ~ '^[a-z0-9]+([ .][a-z0-9]+)*$' and length(username) <= 64);

create or replace function public.admin_update_user(
  p_user_id uuid, p_name text, p_username text, p_roles text[],
  p_mobile text, p_email text, p_is_active boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_target   public.app_users%rowtype;
  v_username text := lower(trim(coalesce(p_username, '')));
  v_name     text := trim(coalesce(p_name, ''));
  v_roles    text[] := array(select distinct r from unnest(coalesce(p_roles, '{}')) r);
  v_other_admins int;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Only an admin can edit users.');
  end if;
  select * into v_target from public.app_users where id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'User not found.'); end if;

  if v_name = '' or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'Name is required (max 120 characters).');
  end if;
  if v_username !~ '^[a-z0-9]+([ .][a-z0-9]+)*$' or length(v_username) > 64 then
    return jsonb_build_object('ok', false, 'error', 'Username can only use small letters, numbers and single spaces (e.g. rahul sharma).');
  end if;
  if cardinality(v_roles) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Choose at least one role.');
  end if;
  if not (v_roles <@ array['admin', 'recorder', 'poc']::text[]) then
    return jsonb_build_object('ok', false, 'error', 'Invalid role.');
  end if;
  if exists (select 1 from public.app_users where username = v_username and id <> p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'Username "' || v_username || '" is already taken.');
  end if;

  if p_user_id = auth.uid() and (not ('admin' = any(v_roles)) or not p_is_active) then
    return jsonb_build_object('ok', false, 'error', 'You cannot remove your own admin access or deactivate yourself.');
  end if;
  if 'admin' = any(v_target.roles) and v_target.is_active and (not ('admin' = any(v_roles)) or not p_is_active) then
    select count(*) into v_other_admins from public.app_users
     where 'admin' = any(roles) and is_active and id <> p_user_id;
    if v_other_admins = 0 then
      return jsonb_build_object('ok', false, 'error', 'At least one active admin must remain.');
    end if;
  end if;

  update public.app_users
     set name = v_name, username = v_username, roles = v_roles,
         mobile_number = nullif(trim(coalesce(p_mobile, '')), ''),
         email = nullif(trim(coalesce(p_email, '')), ''),
         is_active = p_is_active
   where id = p_user_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_update_user(uuid, text, text, text[], text, text, boolean) from public, anon;
grant execute on function public.admin_update_user(uuid, text, text, text[], text, text, boolean) to authenticated;
