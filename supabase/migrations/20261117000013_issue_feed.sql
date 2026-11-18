-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 13: the database side of the Issues page, My submissions and the
--   Admin dashboard.
--
-- WHY IT EXISTS
--   Decision: EVERY POC sees EVERY issue (read-only). There is no assignment or
--   resolve workflow; the page simply shows what came up, where, at which event.
--   • issues_feed(): one row per issue, already joined with its venue, its
--     event (from the Calendar), the transcript, the audio and the recorder's
--     name, so the page can group Date → Venue → Event in one call.
--       Admin / POC → all issues.  Recording User → only their own.
--     (app_users is not readable by POCs directly, so this function supplies
--     the recorder's name.)
--   • Storage: POCs and Admin may open recordings (to listen). Recorders still
--     only see their own files.
--   • admin_attention(): recordings Admin should look at (processing failed, no
--     issue found, or the event is not certain).
--   • admin_set_submission_event(): Admin picks the right booking from the
--     candidates the matcher found. It is copied onto the recording and its
--     issues, and nothing is typed by hand.
--
-- USED BY
--   src/services/issueService.ts → pages/Issues, pages/MySubmissions, pages/AdminDashboard
--
-- DEPENDS ON
--   Migrations 1–12.
--
-- SAFE TO RE-RUN
--   Yes.
-- =============================================================================

-- ---- POCs read everything (rows), recorders their own, Admin all -----------
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select to authenticated
  using (public.is_admin() or public.has_role('poc') or (submitted_by = auth.uid() and public.is_active_user()));

drop policy if exists issues_select on public.issues;
create policy issues_select on public.issues for select to authenticated
  using (
    public.is_admin() or public.has_role('poc')
    or exists (select 1 from public.submissions s
               where s.id = issues.submission_id and s.submitted_by = auth.uid() and public.is_active_user())
  );

-- ---- Storage: POCs and Admin can listen to any recording ---------------------
drop policy if exists recordings_select_staff on storage.objects;
create policy recordings_select_staff on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and (public.is_admin() or public.has_role('poc')));

-- ---- The feed ----------------------------------------------------------------------
drop function if exists public.issues_feed(date, date, uuid, text);
create or replace function public.issues_feed(
  p_from date, p_to date, p_venue_id uuid default null, p_category text default null)
returns table (
  issue_id uuid, submission_id uuid, issue_index int, created_at timestamptz, event_day date,
  category text, item text, description text, summary text, location text, original_text text,
  venue_id uuid, venue_name text, calendar_event_id text, guest_name text, function_name text,
  shift text, sub_venue text, event_title text, match_status text,
  transcript text, audio_path text, audio_duration_sec numeric, recorded_by text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_all boolean := public.is_admin() or public.has_role('poc');
begin
  if not public.is_active_user() then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return query
    with base as (
      select i.id as issue_id, s.id as submission_id, i.issue_index, i.created_at,
             coalesce((i.event_info->>'date')::date, s.event_date, (s.created_at at time zone 'Asia/Kolkata')::date) as event_day,
             coalesce(i.category_raw, 'Other') as category, i.item, i.description, i.ai_summary as summary,
             i.location, i.original_text,
             coalesce(i.venue_id, s.venue_id) as venue_id,
             coalesce(i.calendar_event_id, s.calendar_event_id) as calendar_event_id,
             coalesce(i.event_info->>'guest_name', s.guest_name) as guest_name,
             coalesce(i.event_info->>'function_name', s.function_name) as function_name,
             i.event_info->>'shift' as shift, i.event_info->>'sub_venue' as sub_venue,
             i.event_info->>'title' as event_title,
             coalesce(i.event_info->>'match_status', s.event_match->>'status') as match_status,
             s.reviewed_transcript as transcript, s.audio_path, s.audio_duration_sec,
             s.submitted_by, s.audio_deleted_at
        from public.issues i
        join public.submissions s on s.id = i.submission_id
       where v_all or s.submitted_by = auth.uid()
    )
    select r.issue_id, r.submission_id, r.issue_index, r.created_at, r.event_day,
           r.category, r.item, r.description, r.summary, r.location, r.original_text,
           r.venue_id, v.venue_name, r.calendar_event_id, r.guest_name, r.function_name,
           r.shift, r.sub_venue, r.event_title, r.match_status,
           r.transcript, case when r.audio_deleted_at is null then r.audio_path end, r.audio_duration_sec,
           u.name as recorded_by
      from base r
      left join public.venues v on v.id = r.venue_id
      left join public.app_users u on u.id = r.submitted_by
     where r.event_day between p_from and p_to
       and (p_venue_id is null or r.venue_id = p_venue_id)
       and (p_category is null or r.category = p_category)
     order by r.event_day desc, v.venue_name nulls last, r.calendar_event_id nulls last, r.created_at desc, r.issue_index
     limit 2000;
end $$;

-- ---- Admin: recordings that need a look -------------------------------------------
drop function if exists public.admin_attention();
create or replace function public.admin_attention()
returns table (
  submission_id uuid, created_at timestamptz, processing_status text, processing_error text,
  attempt_count int, next_attempt_at timestamptz, transcript text, recorded_by text,
  event_status text, event_match jsonb, issue_count int
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Only an admin can see this' using errcode = '42501';
  end if;
  return query
    select s.id, s.created_at, s.processing_status, s.processing_error, s.attempt_count, s.next_attempt_at,
           s.reviewed_transcript, u.name, s.event_match->>'status', s.event_match,
           (select count(*)::int from public.issues i where i.submission_id = s.id)
      from public.submissions s
      left join public.app_users u on u.id = s.submitted_by
     where s.created_at > now() - interval '30 days'
       and (s.processing_status in ('failed', 'needs_review', 'submitted', 'processing')
            or coalesce(s.event_match->>'status', '') in ('ambiguous', 'no_events', 'calendar_error', 'calendar_paused', 'not_enough_info'))
     order by s.created_at desc
     limit 200;
end $$;

-- ---- Admin: choose the right booking for an uncertain recording ---------------
create or replace function public.admin_set_submission_event(p_submission_id uuid, p_calendar_event_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_sub  public.submissions%rowtype;
  v_cand jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Only an admin can do this.');
  end if;
  select * into v_sub from public.submissions where id = p_submission_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Recording not found.'); end if;

  -- Only a booking the matcher actually found may be chosen (no free typing).
  select c into v_cand from jsonb_array_elements(coalesce(v_sub.event_match->'candidates', '[]'::jsonb)) c
   where c->>'calendar_event_id' = p_calendar_event_id limit 1;
  if v_cand is null then return jsonb_build_object('ok', false, 'error', 'That booking is not one of the candidates.'); end if;

  update public.submissions
     set calendar_event_id = v_cand->>'calendar_event_id',
         event_date = (v_cand->>'date')::date,
         venue_id = nullif(v_cand->>'venue_id', '')::uuid,
         guest_name = v_cand->>'guest_name',
         function_name = v_cand->>'function_name',
         event_match = v_sub.event_match || jsonb_build_object(
           'status', 'matched', 'event', v_cand, 'chosen_by_admin', auth.uid(), 'chosen_at', now())
   where id = p_submission_id;

  -- Issues of this recording that had no event of their own get this one.
  update public.issues
     set calendar_event_id = v_cand->>'calendar_event_id',
         venue_id = coalesce(venue_id, nullif(v_cand->>'venue_id', '')::uuid),
         event_info = jsonb_build_object(
           'calendar_event_id', v_cand->>'calendar_event_id', 'date', v_cand->>'date',
           'guest_name', v_cand->>'guest_name', 'function_name', v_cand->>'function_name',
           'shift', v_cand->>'shift', 'sub_venue', v_cand->>'sub_venue', 'title', v_cand->>'title',
           'match_status', 'matched_by_admin')
   where submission_id = p_submission_id
     and calendar_event_id is null
     and (venue_id is null or venue_id = nullif(v_cand->>'venue_id', '')::uuid);

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.issues_feed(date, date, uuid, text), public.admin_attention(),
                       public.admin_set_submission_event(uuid, text) from public, anon;
grant execute on function public.issues_feed(date, date, uuid, text), public.admin_attention(),
                          public.admin_set_submission_event(uuid, text) to authenticated;
