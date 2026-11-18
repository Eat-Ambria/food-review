-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 12: each issue can have its OWN venue, event and item (dish).
--
-- WHY IT EXISTS
--   One recording can cover several venues and several problems with the same
--   dish, e.g. "AP mein dal makhani thandi thi, AM mein dal makhani mein namak
--   zyada tha". These are two separate issues, at two venues, for two events,
--   and they may go to two different POCs (venue-specific mapping, Phase 7).
--   • issues.item              the dish / thing the problem is about ("Dal Makhani", "AC")
--   • issues.venue_id          venue for THIS issue (defaults to the recording's venue)
--   • issues.calendar_event_id Calendar booking for THIS issue
--   • issues.event_info        guest / function / shift of that booking (copied from the Calendar)
--
-- USED BY
--   supabase/functions/process-issue (writes), dashboards (Phase 8)
--
-- DEPENDS ON
--   Migrations 1–11.
--
-- SAFE TO RE-RUN
--   Yes.
-- =============================================================================

alter table public.issues add column if not exists item text;
alter table public.issues add column if not exists venue_id uuid references public.venues(id);
alter table public.issues add column if not exists calendar_event_id text;
alter table public.issues add column if not exists event_info jsonb;

create index if not exists issues_venue_idx on public.issues (venue_id);

-- Existing issues inherit the venue/event of their recording.
update public.issues i
   set venue_id = s.venue_id,
       calendar_event_id = s.calendar_event_id,
       event_info = case when s.calendar_event_id is not null
                         then jsonb_build_object('guest_name', s.guest_name, 'function_name', s.function_name, 'date', s.event_date)
                    end
  from public.submissions s
 where s.id = i.submission_id and i.venue_id is null;
