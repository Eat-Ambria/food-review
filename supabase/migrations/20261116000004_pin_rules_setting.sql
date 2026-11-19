-- Migration 4: makes the "easy PIN" rule an on/off setting.
insert into public.app_settings (key, value, description) values
  ('pin_block_easy_pins', 'false', 'true = refuse PINs like 1111 or 1234 when users choose a new PIN')
on conflict (key) do nothing;

create or replace function public.pin_problem(p_pin text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if p_pin is null or p_pin !~ '^\d{4}$' then
    return 'PIN must be exactly 4 digits';
  end if;
  if p_pin = '0000' then
    return 'Please choose a PIN other than 0000 (that is the default PIN)';
  end if;
  if coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'pin_block_easy_pins'), false) then
    if p_pin ~ '^(\d)\1{3}$' then
      return 'PIN cannot be the same digit repeated (like 1111)';
    end if;
    if p_pin in ('1234','2345','3456','4567','5678','6789','0123',
                 '9876','8765','7654','6543','5432','4321','3210') then
      return 'PIN cannot be a simple sequence like 1234';
    end if;
  end if;
  return null;
end $$;

revoke all on function public.pin_problem(text) from public, anon, authenticated;

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

  update public.app_user_secrets
     set pin_hash = public.hash_pin(p_new_pin), failed_attempts = 0, locked_until = null, pin_changed_at = now()
   where user_id = auth.uid();
  update public.app_users set must_change_pin = false where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.change_my_pin(text, text) from public, anon;
grant execute on function public.change_my_pin(text, text) to authenticated;
