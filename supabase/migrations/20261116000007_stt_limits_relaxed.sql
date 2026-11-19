-- Migration 7: relaxes the transcription limits to anti-spam only.
insert into public.app_settings (key, value, description) values
  ('stt_min_gap_seconds', '20', 'Minimum seconds between two NEW recordings from one user (anti-spam)')
on conflict (key) do nothing;

update public.app_settings set value = '20',
       description = 'New recordings one user may transcribe per window (anti-spam backstop)'
 where key = 'stt_max_recordings_per_window' and value #>> '{}' = '5';
update public.app_settings set value = '0',
       description = 'Minutes of audio one user may transcribe per day (India time). 0 = no limit'
 where key = 'stt_max_minutes_per_day' and value #>> '{}' = '30';

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
    if v_row.created_at > now() - interval '60 seconds' then
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
