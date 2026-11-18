-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 7: changes the transcription limits from "usage caps" to
--   "anti-spam only".
--
-- WHY IT EXISTS
--   Real usage: 4–5 functions a day and many complaints per function, so a
--   daily cap or "5 per 15 min" would block genuine work. The goal is only to
--   stop rapid-fire sending:
--     • at least 20 seconds between two NEW recordings from the same user
--       (a real complaint takes longer than that to speak)
--     • at most 20 new recordings per 15 minutes (spam backstop)
--     • NO daily cap (0 = off; it can be switched on later if ever needed)
--   Unchanged: a chunk is never paid for twice, and a limited recording stays
--   on the phone and is transcribed automatically when allowed.
--   Settings (change any time, no deploy):
--     update app_settings set value = '30' where key = 'stt_min_gap_seconds';
--
-- USED BY
--   supabase/functions/transcribe-audio (via stt_reserve_chunk)
--
-- DEPENDS ON
--   Migration 6 (transcription_chunks, stt_* functions).
--
-- SAFE TO RE-RUN
--   Yes.
-- =============================================================================

insert into public.app_settings (key, value, description) values
  ('stt_min_gap_seconds', '20', 'Minimum seconds between two NEW recordings from one user (anti-spam)')
on conflict (key) do nothing;

-- Raise the window limit and switch off the daily cap, but only if they still
-- have migration 6's defaults (never overwrite a value an admin chose).
update public.app_settings set value = '20',
       description = 'New recordings one user may transcribe per window (anti-spam backstop)'
 where key = 'stt_max_recordings_per_window' and value #>> '{}' = '5';
update public.app_settings set value = '0',
       description = 'Minutes of audio one user may transcribe per day (India time). 0 = no limit'
 where key = 'stt_max_minutes_per_day' and value #>> '{}' = '30';

-- -----------------------------------------------------------------------------
-- stt_reserve_chunk: same as migration 6, plus the minimum-gap rule, and a
-- daily cap of 0 now means "off".
-- Returns {status:'cached'|'busy'|'go'|'limited', …}; for limited:
--   reason 'gap' | 'window' | 'daily', retry_after (timestamptz)
-- -----------------------------------------------------------------------------
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
  -- One user at a time: two tabs can't both slip past the limits.
  perform pg_advisory_xact_lock(hashtext('stt:' || p_user_id::text));

  -- 1. Seen this exact chunk before?
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

  -- 2. Limits apply only to a NEW recording. Later chunks and retries of a
  --    started recording always go through.
  if not exists (select 1 from public.transcription_chunks where client_submission_id = p_client_id) then

    -- 2a. Minimum gap since this user's previous new recording.
    if v_gap > 0 then
      -- A recording's start = its FIRST chunk (retries of later chunks don't count).
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

    -- 2b. Spam backstop: N new recordings per window.
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

    -- 2c. Optional daily cap (0 = off).
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
