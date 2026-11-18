-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 15: notifications for POCs. An in-app bell, plus a phone push
--   (Web Push) whenever a new recording produces issues.
--
-- WHY IT EXISTS
--   Decision: every POC is told about every new complaint.
--   • ONE notification per recording (not per issue), so phones don't buzz
--     three times for one complaint: "3 new issues at Ambria Pushpanjali".
--   • The person who recorded it is not notified about their own recording.
--   • ONE write path: enqueue_new_issue_notifications() writes the bell row
--     (notifications) AND the push job (notification_queue) together, so the
--     bell and the phone always agree.
--   • Duplicate-proof: a recording can notify each person only once
--     (unique recipient + submission, unique dedupe_key), even if processing
--     is retried.
--   • push_subscriptions: one row per device that turned notifications on.
--     Dead devices (push service says 404/410) are removed by the sender.
--   • WhatsApp can later be added as another channel in notification_queue.
--
-- USED BY
--   supabase/functions/process-issue (enqueue + send), src/components/NotificationBell.tsx,
--   src/lib/push.ts
--
-- DEPENDS ON
--   Migrations 1–14.
--
-- SAFE TO RE-RUN
--   Yes.
-- =============================================================================

-- ---- devices --------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.app_users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  failures      int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- A user manages only their own devices.
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid() and public.is_active_user());

-- ---- bell rows: link + which recording ---------------------------------------------------
alter table public.notifications add column if not exists submission_id uuid references public.submissions(id) on delete cascade;
alter table public.notifications add column if not exists url text;
create unique index if not exists notifications_once_per_submission
  on public.notifications (recipient_user_id, submission_id) where submission_id is not null;

-- ---- enqueue for one processed recording -----------------------------------------------------
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

  select count(distinct coalesce(i.venue_id, v_sub.venue_id)),
         min(v.venue_name)
    into v_venues, v_venue
    from public.issues i
    left join public.venues v on v.id = coalesce(i.venue_id, v_sub.venue_id)
   where i.submission_id = p_submission_id;

  select i.category_raw, i.item, i.ai_summary into v_first
    from public.issues i where i.submission_id = p_submission_id order by i.issue_index limit 1;

  v_title := case when v_count = 1 then 'New issue' else v_count || ' new issues' end
             || case when v_venues = 1 and v_venue is not null then ' at ' || v_venue
                     when v_venues > 1 then ' at ' || v_venues || ' venues' else '' end;
  v_event := nullif(concat_ws(' · ', v_sub.guest_name, v_sub.function_name), '');
  v_body  := concat_ws(' · ', v_event, coalesce(v_first.category_raw, 'Other') || coalesce(': ' || v_first.item, ''))
             || ': ' || left(coalesce(v_first.ai_summary, ''), 140)
             || case when v_count > 1 then ' (+' || (v_count - 1) || ' more)' else '' end;

  -- Every active POC except the person who recorded it.
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

-- Mark everything read for the signed-in user (the bell's "Mark all read").
create or replace function public.mark_all_notifications_read()
returns void language sql volatile security definer set search_path = public as $$
  update public.notifications set read_at = now()
   where recipient_user_id = auth.uid() and read_at is null
$$;

revoke all on function public.enqueue_new_issue_notifications(uuid), public.mark_all_notifications_read() from public, anon, authenticated;
grant execute on function public.enqueue_new_issue_notifications(uuid) to service_role;
grant execute on function public.mark_all_notifications_read() to authenticated;
