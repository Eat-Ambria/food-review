-- Migration 30: small fixes: PIN change never locks and needs a different PIN, a slower Sarvam answer is not paid twice,
-- old login attempts are cleared, and a username can never be taken that someone else already signs in with.
create or replace function public.change_my_pin(p_current_pin text, p_new_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_secret  public.app_user_secrets%rowtype;
  v_problem text;
begin
  if not public.is_active_user() then
    return jsonb_build_object('ok', false, 'error', 'Your session has ended. Please sign in again.');
  end if;

  select * into v_secret from public.app_user_secrets where user_id = auth.uid() for update;
  if v_secret.failed_attempts >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong PINs. Sign out and sign in again, or ask an admin to reset your PIN.');
  end if;
  if extensions.crypt(coalesce(p_current_pin, ''), v_secret.pin_hash) <> v_secret.pin_hash then
    update public.app_user_secrets set failed_attempts = failed_attempts + 1 where user_id = auth.uid();
    return jsonb_build_object('ok', false, 'error', 'Current PIN is incorrect.');
  end if;
  if p_new_pin = p_current_pin then
    return jsonb_build_object('ok', false, 'error', 'Choose a PIN that is different from your current one.');
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

create or replace function public.stt_reserve_chunk(
  p_user_id uuid, p_client_id uuid, p_chunk_index int, p_audio_seconds numeric)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_row        public.transcription_chunks%rowtype;
  v_gap        int := public.setting_int('stt_min_gap_seconds', 20);
  v_window     int := public.setting_int('stt_window_minutes', 15);
  v_max_recs   int := public.setting_int('stt_max_recordings_per_window', 20);
  v_max_min    int := public.setting_int('stt_max_minutes_per_day', 0);
  v_recent     int;
  v_oldest     timestamptz;
  v_last       timestamptz;
  v_today_sec  numeric;
  v_day_start  timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
  v_id         uuid;
begin

  perform pg_advisory_xact_lock(hashtext('stt:' || p_user_id::text));

  select * into v_row from public.transcription_chunks
   where client_submission_id = p_client_id and chunk_index = p_chunk_index;
  if found then
    if v_row.user_id <> p_user_id then
      return jsonb_build_object('status', 'limited', 'reason', 'forbidden');
    end if;
    if v_row.transcript is not null then
      return jsonb_build_object('status', 'cached', 'transcript', v_row.transcript,
        'language_code', v_row.language_code, 'request_id', v_row.request_id);
    end if;
    if v_row.created_at > now() - interval '90 seconds' then
      return jsonb_build_object('status', 'busy');
    end if;
    update public.transcription_chunks set created_at = now() where id = v_row.id;
    return jsonb_build_object('status', 'go', 'id', v_row.id);
  end if;

  if not exists (select 1 from public.transcription_chunks where client_submission_id = p_client_id) then

    if v_gap > 0 then

      select max(first_at) into v_last from (
        select min(created_at) as first_at from public.transcription_chunks
         where user_id = p_user_id and created_at > now() - interval '1 day'
         group by client_submission_id
        having min(created_at) > now() - make_interval(secs => v_gap)
      ) r;
      if v_last is not null then
        return jsonb_build_object('status', 'limited', 'reason', 'gap',
          'retry_after', v_last + make_interval(secs => v_gap), 'gap_seconds', v_gap);
      end if;
    end if;

    if v_max_recs > 0 then
      select count(*), min(first_at) into v_recent, v_oldest from (
        select min(created_at) as first_at from public.transcription_chunks
         where user_id = p_user_id and created_at > now() - interval '1 day'
         group by client_submission_id
        having min(created_at) > now() - make_interval(mins => v_window)
      ) r;
      if v_recent >= v_max_recs then
        return jsonb_build_object('status', 'limited', 'reason', 'window',
          'retry_after', v_oldest + make_interval(mins => v_window), 'max', v_max_recs, 'window_minutes', v_window);
      end if;
    end if;

    if v_max_min > 0 then
      select coalesce(sum(audio_seconds), 0) into v_today_sec
        from public.transcription_chunks
       where user_id = p_user_id and created_at >= v_day_start;
      if v_today_sec + p_audio_seconds > v_max_min * 60 then
        return jsonb_build_object('status', 'limited', 'reason', 'daily',
          'retry_after', v_day_start + interval '1 day', 'max_minutes', v_max_min);
      end if;
    end if;
  end if;

  insert into public.transcription_chunks (user_id, client_submission_id, chunk_index, audio_seconds)
  values (p_user_id, p_client_id, p_chunk_index, p_audio_seconds)
  returning id into v_id;
  return jsonb_build_object('status', 'go', 'id', v_id);
end $$;

revoke all on function public.stt_reserve_chunk(uuid, uuid, int, numeric) from public, anon, authenticated;
grant execute on function public.stt_reserve_chunk(uuid, uuid, int, numeric) to service_role;

create or replace function public.maintenance_cleanup()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a int; b int; c int; d int;
begin
  delete from public.transcription_chunks where created_at < now() - interval '7 days';   get diagnostics a = row_count;
  delete from public.api_usage_log       where created_at < now() - interval '90 days';  get diagnostics b = row_count;
  delete from public.job_runs            where started_at < now() - interval '30 days';  get diagnostics c = row_count;
  delete from public.auth_login_attempts where created_at < now() - interval '30 days';  get diagnostics d = row_count;
  return jsonb_build_object('transcription_chunks', a, 'api_usage_log', b, 'job_runs', c, 'auth_login_attempts', d);
end $$;
revoke all on function public.maintenance_cleanup() from public, anon, authenticated;
grant execute on function public.maintenance_cleanup() to service_role;

create or replace function public.username_not_taken()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_key text := regexp_replace(lower(new.username), '[^a-z0-9]', '', 'g');
  v_who text;
begin
  if tg_op = 'UPDATE' and new.username = old.username then
    return new;
  end if;
  select name into v_who from public.app_users
   where id <> new.id
     and (regexp_replace(lower(username), '[^a-z0-9]', '', 'g') = v_key
          or (is_active and regexp_replace(split_part(trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')), ' ', 1), '[^a-z0-9]', '', 'g') = v_key))
   limit 1;
  if v_who is not null then
    raise exception 'The username "%" is too close to how % signs in. Choose a longer username.', new.username, v_who
      using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists app_users_username_not_taken on public.app_users;
create trigger app_users_username_not_taken
  before insert or update of username on public.app_users
  for each row execute function public.username_not_taken();
