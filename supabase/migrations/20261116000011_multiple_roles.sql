-- Migration 11: lets a user have more than one role.
alter table public.app_users add column if not exists roles text[];
update public.app_users set roles = array[role] where roles is null or cardinality(roles) = 0;

alter table public.app_users drop constraint if exists app_users_roles_check;
alter table public.app_users add constraint app_users_roles_check
  check (roles is not null and cardinality(roles) >= 1 and roles <@ array['admin', 'recorder', 'poc']::text[]);

create index if not exists app_users_roles_idx on public.app_users using gin (roles);

create or replace function public.primary_role(p_roles text[])
returns text language sql immutable as $$
  select case when 'admin' = any(p_roles) then 'admin'
              when 'poc' = any(p_roles) then 'poc'
              else 'recorder' end
$$;

create or replace function public.sync_user_roles()
returns trigger language plpgsql as $$
begin

  if new.roles is null or cardinality(new.roles) = 0 then
    new.roles := array[new.role];
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role and new.roles = old.roles then
    new.roles := array[new.role];
  end if;

  new.roles := array(select r from unnest(array['admin', 'recorder', 'poc']) r where r = any(new.roles));
  new.role := public.primary_role(new.roles);
  return new;
end $$;

drop trigger if exists trg_sync_user_roles on public.app_users;
create trigger trg_sync_user_roles before insert or update on public.app_users
  for each row execute function public.sync_user_roles();

create or replace function public.has_role(p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where id = auth.uid() and is_active and p_role = any(roles))
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('admin')
$$;

revoke all on function public.has_role(text) from public, anon;
grant execute on function public.has_role(text) to authenticated;

drop function if exists public.auth_create_app_user(uuid, text, text, text, text, text, uuid);
create or replace function public.auth_create_app_user(
  p_id uuid, p_name text, p_username text, p_role text,
  p_mobile text default null, p_email text default null, p_created_by uuid default null,
  p_roles text[] default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.app_users (id, name, username, role, roles, mobile_number, email, must_change_pin, created_by)
  values (p_id, trim(p_name), lower(trim(p_username)), coalesce(p_role, 'recorder'),
          coalesce(p_roles, array[coalesce(p_role, 'recorder')]), p_mobile, p_email, true, p_created_by);
  insert into public.app_user_secrets (user_id, pin_hash) values (p_id, public.hash_pin('0000'));
end $$;
revoke all on function public.auth_create_app_user(uuid, text, text, text, text, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.auth_create_app_user(uuid, text, text, text, text, text, uuid, text[]) to service_role;

create or replace function public.bootstrap_admin(p_auth_user_id uuid, p_name text, p_username text)
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  if exists (select 1 from public.app_users where 'admin' = any(roles)) then
    raise exception 'An admin already exists. Create more users from the app.';
  end if;
  perform public.auth_create_app_user(p_auth_user_id, p_name, p_username, 'admin', null, null, null, array['admin']);
  return 'Admin created. Sign in as ' || lower(trim(p_username)) || ' with PIN 0000; you will be asked to change it.';
end $$;
revoke all on function public.bootstrap_admin(uuid, text, text) from public, anon, authenticated;

drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
  id uuid, name text, username text, role text, roles text[], mobile_number text, email text,
  is_active boolean, must_change_pin boolean, last_login_at timestamptz,
  created_at timestamptz, locked_until timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can list users' using errcode = '42501';
  end if;
  return query
    select u.id, u.name, u.username, u.role, u.roles, u.mobile_number, u.email,
           u.is_active, u.must_change_pin, u.last_login_at, u.created_at,
           case when s.locked_until > now() then s.locked_until end
      from public.app_users u
      left join public.app_user_secrets s on s.user_id = u.id
     order by u.name;
end $$;

drop function if exists public.admin_update_user(uuid, text, text, text, text, text, boolean);
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
  if v_username !~ '^[a-z0-9]+(\.[a-z0-9]+)*$' or length(v_username) > 64 then
    return jsonb_build_object('ok', false, 'error', 'Username can only use lowercase letters, numbers and dots (e.g. rahul.sharma).');
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

revoke all on function public.admin_list_users(),
                       public.admin_update_user(uuid, text, text, text[], text, text, boolean)
  from public, anon;
grant execute on function public.admin_list_users(),
                          public.admin_update_user(uuid, text, text, text[], text, text, boolean)
  to authenticated;
