-- Migration 27: admins and POCs get the recorder's mobile number with each issue, so they can call about serious issues.
drop function if exists public.issues_feed(date, date, uuid, text);
create or replace function public.issues_feed(
  p_from date, p_to date, p_venue_id uuid default null, p_category text default null)
returns table (
  issue_id uuid, submission_id uuid, issue_index int, created_at timestamptz, event_day date,
  category text, item text, description text, summary text, location text, original_text text,
  venue_id uuid, venue_name text, calendar_event_id text, guest_name text, function_name text,
  shift text, sub_venue text, event_title text, match_status text,
  transcript text, audio_path text, audio_duration_sec numeric, recorded_by text,
  is_serious boolean, serious_keywords text[], recorded_by_mobile text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
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
             s.submitted_by, s.audio_deleted_at,
             coalesce(i.is_serious, s.is_serious) as is_serious,
             coalesce(i.serious_keywords, s.serious_keywords) as serious_keywords
        from public.issues i
        join public.submissions s on s.id = i.submission_id
    )
    select r.issue_id, r.submission_id, r.issue_index, r.created_at, r.event_day,
           r.category, r.item, r.description, r.summary, r.location, r.original_text,
           r.venue_id, v.venue_name, r.calendar_event_id, r.guest_name, r.function_name,
           r.shift, r.sub_venue, r.event_title, r.match_status,
           r.transcript, case when r.audio_deleted_at is null then r.audio_path end, r.audio_duration_sec,
           u.name as recorded_by, r.is_serious, r.serious_keywords,
           case when public.is_admin() or public.has_role('poc') then u.mobile_number end as recorded_by_mobile
      from base r
      left join public.venues v on v.id = r.venue_id
      left join public.app_users u on u.id = r.submitted_by
     where r.event_day between p_from and p_to
       and (p_venue_id is null or r.venue_id = p_venue_id)
       and (p_category is null or r.category = p_category)
     order by r.event_day desc, v.venue_name nulls last, r.calendar_event_id nulls last, r.created_at desc, r.issue_index
     limit 2000;
end $$;
revoke all on function public.issues_feed(date, date, uuid, text) from public, anon;
grant execute on function public.issues_feed(date, date, uuid, text) to authenticated;
