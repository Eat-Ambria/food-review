-- Migration 19: lets people sign in with or without spaces or dots in the username (rahul sharma = rahulsharma = rahul.sharma).
create or replace function public.resolve_username(p_username text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_typed text := lower(trim(coalesce(p_username, '')));
  v_key   text := regexp_replace(lower(coalesce(p_username, '')), '[^a-z0-9]', '', 'g');
  v_found text[];
begin
  if exists (select 1 from public.app_users where username = v_typed) then
    return v_typed;
  end if;
  if v_key = '' then
    return v_typed;
  end if;
  select array_agg(username) into v_found
    from public.app_users
   where regexp_replace(username, '[^a-z0-9]', '', 'g') = v_key;
  if coalesce(array_length(v_found, 1), 0) = 1 then
    return v_found[1];
  end if;
  return v_typed;
end $$;

revoke all on function public.resolve_username(text) from public, anon, authenticated;
grant execute on function public.resolve_username(text) to service_role;
