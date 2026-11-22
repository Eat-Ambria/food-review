-- Migration 20: the per-network login limit counts only wrong PINs, so many staff on one venue WiFi can sign in together.
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
  select count(*) into v_ip_count from public.auth_login_attempts
   where ip = p_ip and outcome in ('invalid', 'locked')
     and created_at > now() - make_interval(mins => public.setting_int('ip_window_minutes', 15));
  if p_ip is not null and v_ip_count >= public.setting_int('ip_max_attempts', 30) then
    insert into public.auth_login_attempts (username, ip, outcome) values (v_uname, p_ip, 'rate_limited');
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  select * into v_user from public.app_users where username = v_uname;
  if not found then
    perform extensions.crypt(coalesce(p_pin, ''), extensions.gen_salt('bf', 10));
    insert into public.auth_login_attempts (username, ip, outcome) values (v_uname, p_ip, 'invalid');
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v_secret from public.app_user_secrets where user_id = v_user.id for update;
  if not found then
    insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'invalid');
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_secret.locked_until is not null and v_secret.locked_until > now() then
    insert into public.auth_login_attempts (username, user_id, ip, outcome) values (v_uname, v_user.id, p_ip, 'locked');
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_secret.locked_until);
  end if;
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
