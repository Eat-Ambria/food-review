-- Migration 34: owner/admin delete with a required reason, logged in deletion_log; issues_feed returns can_delete.
create table if not exists public.deletion_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  action text not null check (action in ('delete_issue','delete_submission')),
  deleted_what text not null check (deleted_what in ('issue','recording')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  actor_id uuid, actor_name text, actor_roles text[] not null default '{}',
  actor_is_owner boolean not null default false,
  submission_id uuid, issue_id uuid, category text, item text, summary text, description text, venue_name text,
  recorded_by_id uuid, recorded_by_name text, recorded_at timestamptz, transcript_snippet text,
  had_audio boolean not null default false, compliments_removed int not null default 0,
  issues jsonb not null default '[]'::jsonb
);
create index if not exists deletion_log_created_idx on public.deletion_log (created_at desc);
alter table public.deletion_log enable row level security;
revoke all on public.deletion_log from public, anon, authenticated;
grant select on public.deletion_log to authenticated;
grant all on public.deletion_log to service_role;
drop policy if exists deletion_log_admin_read on public.deletion_log;
create policy deletion_log_admin_read on public.deletion_log for select to authenticated using (public.is_admin());

create or replace function public._clean_reason(p text) returns text
language sql immutable as $$ select btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')) $$;

create or replace function public.delete_issue_logged(p_issue_id uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_reason text := public._clean_reason(p_reason);
  v_actor record; v_sid uuid; v_sub record; v_issue record;
  v_admin boolean; v_left int; v_praise int; v_whole boolean;
begin
  if char_length(v_reason) not between 3 and 500 then raise exception 'reason_required' using errcode = '22023'; end if;
  select id, name, roles into v_actor from app_users where id = p_actor and is_active;
  if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
  v_admin := 'admin' = any(v_actor.roles);
  select submission_id into v_sid from issues where id = p_issue_id;
  if v_sid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select s.*, u.name as rec_name into v_sub
    from submissions s left join app_users u on u.id = s.submitted_by
   where s.id = v_sid for update of s;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not v_admin and v_sub.submitted_by is distinct from p_actor then raise exception 'not_allowed' using errcode = '42501'; end if;
  select i.*, v.venue_name into v_issue
    from issues i left join venues v on v.id = coalesce(i.venue_id, v_sub.venue_id)
   where i.id = p_issue_id for update of i;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select count(*) into v_left from issues where submission_id = v_sid and id <> p_issue_id;
  select count(*) into v_praise from compliments where submission_id = v_sid;
  v_whole := v_left = 0 and v_praise = 0;
  insert into deletion_log (action, deleted_what, reason, actor_id, actor_name, actor_roles, actor_is_owner,
    submission_id, issue_id, category, item, summary, description, venue_name,
    recorded_by_id, recorded_by_name, recorded_at, transcript_snippet, had_audio, compliments_removed, issues)
  values ('delete_issue', case when v_whole then 'recording' else 'issue' end, v_reason,
    v_actor.id, v_actor.name, v_actor.roles, coalesce(v_sub.submitted_by = p_actor, false),
    v_sid, v_issue.id, coalesce(v_issue.category_raw, 'Other'), v_issue.item, v_issue.ai_summary, v_issue.description,
    v_issue.venue_name, v_sub.submitted_by, v_sub.rec_name, v_sub.created_at, left(v_sub.reviewed_transcript, 500),
    v_sub.audio_path is not null and v_sub.audio_deleted_at is null, 0,
    jsonb_build_array(jsonb_build_object('issue_id', v_issue.id, 'category', coalesce(v_issue.category_raw,'Other'),
      'item', v_issue.item, 'summary', v_issue.ai_summary, 'description', v_issue.description)));
  delete from issues where id = p_issue_id;
  if v_whole then
    delete from notification_queue where dedupe_key like 'serious:' || v_sid || ':%' or dedupe_key like 'new_issues:' || v_sid || ':%';
    delete from submissions where id = v_sid;
  end if;
  return jsonb_build_object('deleted', case when v_whole then 'recording' else 'issue' end, 'submission_id', v_sid,
    'audio_path', case when v_whole and v_sub.audio_deleted_at is null then v_sub.audio_path end);
end $$;

create or replace function public.delete_submission_logged(p_submission_id uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_reason text := public._clean_reason(p_reason);
  v_actor record; v_sub record; v_issues jsonb; v_praise int;
begin
  if char_length(v_reason) not between 3 and 500 then raise exception 'reason_required' using errcode = '22023'; end if;
  select id, name, roles into v_actor from app_users where id = p_actor and is_active;
  if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
  select s.*, u.name as rec_name, v.venue_name into v_sub
    from submissions s left join app_users u on u.id = s.submitted_by left join venues v on v.id = s.venue_id
   where s.id = p_submission_id for update of s;
  if not found then return jsonb_build_object('deleted', 'none'); end if;
  if not ('admin' = any(v_actor.roles)) then
    raise exception 'not_allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('issue_id', i.id, 'category', coalesce(i.category_raw,'Other'),
           'item', i.item, 'summary', i.ai_summary, 'description', i.description) order by i.issue_index), '[]'::jsonb)
    into v_issues from issues i where i.submission_id = p_submission_id;
  select count(*) into v_praise from compliments where submission_id = p_submission_id;
  insert into deletion_log (action, deleted_what, reason, actor_id, actor_name, actor_roles, actor_is_owner,
    submission_id, venue_name, recorded_by_id, recorded_by_name, recorded_at, transcript_snippet, had_audio,
    compliments_removed, issues, summary)
  values ('delete_submission', 'recording', v_reason, v_actor.id, v_actor.name, v_actor.roles, coalesce(v_sub.submitted_by = p_actor, false),
    v_sub.id, v_sub.venue_name, v_sub.submitted_by, v_sub.rec_name, v_sub.created_at, left(v_sub.reviewed_transcript, 500),
    v_sub.audio_path is not null and v_sub.audio_deleted_at is null, v_praise, v_issues,
    jsonb_array_length(v_issues) || ' issue(s)');
  delete from notification_queue where dedupe_key like 'serious:' || p_submission_id || ':%' or dedupe_key like 'new_issues:' || p_submission_id || ':%';
  delete from submissions where id = p_submission_id;
  return jsonb_build_object('deleted', 'recording', 'submission_id', p_submission_id,
    'audio_path', case when v_sub.audio_deleted_at is null then v_sub.audio_path end);
end $$;

revoke all on function public.delete_issue_logged(uuid, uuid, text), public.delete_submission_logged(uuid, uuid, text),
  public._clean_reason(text) from public, anon, authenticated;
grant execute on function public.delete_issue_logged(uuid, uuid, text), public.delete_submission_logged(uuid, uuid, text) to service_role;

drop function if exists public.issues_feed(date, date, uuid, text);
create or replace function public.issues_feed(
  p_from date, p_to date, p_venue_id uuid default null, p_category text default null)
returns table (
  issue_id uuid, submission_id uuid, issue_index int, created_at timestamptz, event_day date,
  category text, item text, description text, summary text, location text, original_text text,
  venue_id uuid, venue_name text, calendar_event_id text, guest_name text, function_name text,
  shift text, sub_venue text, event_title text, match_status text,
  transcript text, audio_path text, audio_duration_sec numeric, recorded_by text,
  is_serious boolean, serious_keywords text[], recorded_by_mobile text, recorded_at timestamptz,
  can_delete boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_admin boolean := public.is_admin();
begin
  if not public.is_active_user() then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return query
    with base as (
      select i.id as issue_id, s.id as submission_id, i.issue_index, i.created_at,
             coalesce(
               case when i.event_info->>'match_status' in ('matched','matched_by_admin') then (i.event_info->>'date')::date end,
               case when s.event_match->>'status'='matched' then s.event_date end,
               (s.created_at at time zone 'Asia/Kolkata')::date) as event_day,
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
             coalesce(i.serious_keywords, s.serious_keywords) as serious_keywords,
             s.created_at as recorded_at
        from public.issues i
        join public.submissions s on s.id = i.submission_id
    )
    select r.issue_id, r.submission_id, r.issue_index, r.created_at, r.event_day,
           r.category, r.item, r.description, r.summary, r.location, r.original_text,
           r.venue_id, v.venue_name, r.calendar_event_id, r.guest_name, r.function_name,
           r.shift, r.sub_venue, r.event_title, r.match_status,
           r.transcript, case when r.audio_deleted_at is null then r.audio_path end, r.audio_duration_sec,
           u.name as recorded_by, r.is_serious, r.serious_keywords,
           case when public.is_admin() or public.has_role('poc') then u.mobile_number end as recorded_by_mobile,
           r.recorded_at,
           (v_admin or r.submitted_by = auth.uid()) as can_delete
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

