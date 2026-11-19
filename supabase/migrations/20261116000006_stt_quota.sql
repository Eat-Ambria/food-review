-- Migration 6: transcription limits, and paying only once for each audio part.
create table if not exists public.transcription_chunks (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.app_users(id) on delete cascade,
  client_submission_id  uuid not null,
  chunk_index           int  not null,
  audio_seconds         numeric(6,2) not null default 0,
  transcript            text,
  language_code         text,
  request_id            text,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,
  unique (client_submission_id, chunk_index)
);
create index if not exists transcription_chunks_user_time_idx
  on public.transcription_chunks (user_id, created_at desc);

alter table public.transcription_chunks enable row level security;

grant all on public.transcription_chunks to service_role;

insert into public.app_settings (key, value, description) values
  ('stt_max_recordings_per_window', '5',  'New recordings one user may transcribe per window'),
  ('stt_window_minutes',            '15', 'Length of that window in minutes'),
  ('stt_max_minutes_per_day',       '30', 'Minutes of audio one user may transcribe per day (India time)')
on conflict (key) do nothing;

create or replace function public.stt_reserve_chunk(
  p_user_id uuid, p_client_id uuid, p_chunk_index int, p_audio_seconds numeric)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_row        public.transcription_chunks%rowtype;
  v_window     int := public.setting_int('stt_window_minutes', 15);
  v_max_recs   int := public.setting_int('stt_max_recordings_per_window', 5);
  v_max_min    int := public.setting_int('stt_max_minutes_per_day', 30);
  v_recent     int;
  v_oldest     timestamptz;
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
    select count(distinct client_submission_id), min(created_at) into v_recent, v_oldest
      from (
        select client_submission_id, min(created_at) as created_at
          from public.transcription_chunks
         where user_id = p_user_id and created_at > now() - make_interval(mins => v_window)
         group by client_submission_id
      ) recs;
    if v_recent >= v_max_recs then
      return jsonb_build_object('status', 'limited', 'reason', 'window',
        'retry_after', v_oldest + make_interval(mins => v_window), 'max', v_max_recs, 'window_minutes', v_window);
    end if;

    select coalesce(sum(audio_seconds), 0) into v_today_sec
      from public.transcription_chunks
     where user_id = p_user_id and created_at >= v_day_start;
    if v_today_sec + p_audio_seconds > v_max_min * 60 then
      return jsonb_build_object('status', 'limited', 'reason', 'daily',
        'retry_after', v_day_start + interval '1 day', 'max_minutes', v_max_min);
    end if;
  end if;

  insert into public.transcription_chunks (user_id, client_submission_id, chunk_index, audio_seconds)
  values (p_user_id, p_client_id, p_chunk_index, p_audio_seconds)
  returning id into v_id;
  return jsonb_build_object('status', 'go', 'id', v_id);
end $$;

create or replace function public.stt_complete_chunk(p_id uuid, p_transcript text, p_language text, p_request_id text)
returns void language sql volatile security definer set search_path = public as $$
  update public.transcription_chunks
     set transcript = coalesce(p_transcript, ''), language_code = p_language,
         request_id = p_request_id, completed_at = now()
   where id = p_id
$$;

create or replace function public.stt_release_chunk(p_id uuid)
returns void language sql volatile security definer set search_path = public as $$
  delete from public.transcription_chunks where id = p_id and transcript is null
$$;

revoke all on function public.stt_reserve_chunk(uuid, uuid, int, numeric),
                       public.stt_complete_chunk(uuid, text, text, text),
                       public.stt_release_chunk(uuid)
  from public, anon, authenticated;
grant execute on function public.stt_reserve_chunk(uuid, uuid, int, numeric),
                          public.stt_complete_chunk(uuid, text, text, text),
                          public.stt_release_chunk(uuid)
  to service_role;
