-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 16: "serious" complaints. Admin-managed keywords; a matching
--   complaint is flagged and every POC gets a WhatsApp message.
--
-- WHY IT EXISTS
--   Some problems can't wait for someone to open the app (fire, injury, a gas
--   leak, a fight…). Admin keeps a keyword list (Hindi and English). When a
--   submitted complaint contains one, process-issue:
--     • marks the submission serious (is_serious, serious_keywords)
--     • queues one WhatsApp message per POC (notification_queue, channel
--       'whatsapp', unique dedupe_key, so never twice) and sends it via
--       Whapi.Cloud, the same service the attendance "Aria" bot uses
--     • the bell / phone push title also starts with "Serious"
--   Matching is on whole words, so "aag" does not match inside "aage".
--
-- USED BY
--   supabase/functions/process-issue, src/pages/Alerts/AlertsPage.tsx,
--   issues_feed (Issues page badge), Admin dashboard
--
-- DEPENDS ON
--   Migrations 1–15.
--
-- SAFE TO RE-RUN
--   Yes.
-- =============================================================================

create table if not exists public.alert_keywords (
  id          uuid primary key default gen_random_uuid(),
  keyword     text not null check (length(trim(keyword)) between 2 and 60),
  -- lower-case, single-spaced; used for matching and uniqueness
  keyword_normalized text generated always as (lower(regexp_replace(trim(keyword), '\s+', ' ', 'g'))) stored,
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (keyword_normalized)
);
alter table public.alert_keywords enable row level security;
grant select, insert, delete on public.alert_keywords to authenticated;
grant all on public.alert_keywords to service_role;
drop policy if exists alert_keywords_admin on public.alert_keywords;
create policy alert_keywords_admin on public.alert_keywords for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.submissions add column if not exists is_serious boolean not null default false;
alter table public.submissions add column if not exists serious_keywords text[];
create index if not exists submissions_serious_idx on public.submissions (created_at desc) where is_serious;

-- ---- Bell/push title says "Serious" for serious complaints ---------------------
-- Same as migration 15, with the title prefix.
create or replace function public.enqueue_new_issue_notifications(p_submission_id uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_sub     public.submissions%rowtype;
  v_count   int;
  v_venue   text;
  v_venues  int;
  v_first   record;
  v_title   text;
  v_body    text;
  v_event   text;
  v_queued  int := 0;
  r         record;
begin
  select * into v_sub from public.submissions where id = p_submission_id;
  if not found then return 0; end if;

  select count(*) into v_count from public.issues where submission_id = p_submission_id;
  if v_count = 0 then return 0; end if;

  select count(distinct coalesce(i.venue_id, v_sub.venue_id)), min(v.venue_name)
    into v_venues, v_venue
    from public.issues i
    left join public.venues v on v.id = coalesce(i.venue_id, v_sub.venue_id)
   where i.submission_id = p_submission_id;

  select i.category_raw, i.item, i.ai_summary into v_first
    from public.issues i where i.submission_id = p_submission_id order by i.issue_index limit 1;

  v_title := case when v_sub.is_serious then 'Serious: ' else '' end
             || case when v_count = 1 then 'New issue' else v_count || ' new issues' end
             || case when v_venues = 1 and v_venue is not null then ' at ' || v_venue
                     when v_venues > 1 then ' at ' || v_venues || ' venues' else '' end;
  v_event := nullif(concat_ws(' · ', v_sub.guest_name, v_sub.function_name), '');
  v_body  := concat_ws(' · ', v_event, coalesce(v_first.category_raw, 'Other') || coalesce(': ' || v_first.item, ''))
             || ': ' || left(coalesce(v_first.ai_summary, ''), 140)
             || case when v_count > 1 then ' (+' || (v_count - 1) || ' more)' else '' end;

  for r in
    select u.id from public.app_users u
     where u.is_active and 'poc' = any(u.roles) and u.id <> v_sub.submitted_by
  loop
    insert into public.notifications (recipient_user_id, submission_id, title, body, url)
    values (r.id, p_submission_id, v_title, v_body, 'issues')
    on conflict do nothing;

    insert into public.notification_queue (recipient_user_id, channel, notification_type, payload, dedupe_key)
    values (r.id, 'push', 'new_issues',
            jsonb_build_object('title', v_title, 'body', v_body, 'url', 'issues', 'tag', 'issues-' || p_submission_id),
            'new_issues:' || p_submission_id || ':' || r.id || ':push')
    on conflict (dedupe_key) do nothing;
    v_queued := v_queued + 1;
  end loop;
  return v_queued;
end $$;
revoke all on function public.enqueue_new_issue_notifications(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_new_issue_notifications(uuid) to service_role;

-- ---- Issues feed: same as migration 13, plus is_serious / serious_keywords -----
drop function if exists public.issues_feed(date, date, uuid, text);
create or replace function public.issues_feed(
  p_from date, p_to date, p_venue_id uuid default null, p_category text default null)
returns table (
  issue_id uuid, submission_id uuid, issue_index int, created_at timestamptz, event_day date,
  category text, item text, description text, summary text, location text, original_text text,
  venue_id uuid, venue_name text, calendar_event_id text, guest_name text, function_name text,
  shift text, sub_venue text, event_title text, match_status text,
  transcript text, audio_path text, audio_duration_sec numeric, recorded_by text,
  is_serious boolean, serious_keywords text[]
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
             s.submitted_by, s.audio_deleted_at, s.is_serious, s.serious_keywords
        from public.issues i
        join public.submissions s on s.id = i.submission_id
       where v_all or s.submitted_by = auth.uid()
    )
    select r.issue_id, r.submission_id, r.issue_index, r.created_at, r.event_day,
           r.category, r.item, r.description, r.summary, r.location, r.original_text,
           r.venue_id, v.venue_name, r.calendar_event_id, r.guest_name, r.function_name,
           r.shift, r.sub_venue, r.event_title, r.match_status,
           r.transcript, case when r.audio_deleted_at is null then r.audio_path end, r.audio_duration_sec,
           u.name as recorded_by, r.is_serious, r.serious_keywords
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
