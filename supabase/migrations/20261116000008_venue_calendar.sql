-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 8: venue details needed for Event Calendar matching.
--
-- WHY IT EXISTS
--   • venues.sub_venues: lawns/halls inside a venue, copied from the Event
--     Calendar (e.g. AP → "Amber Lawn", "Glass House"). When someone says
--     "Amber Lawn mein AC band tha" without naming the venue, the sub-venue
--     still points to the right venue. A name that exists in two venues (e.g.
--     "Glass House") is treated as ambiguous by the app, never guessed.
--   • venues.calendar_venue_id must be unique: one app venue ↔ one calendar
--     category, so "import from calendar" can be re-run without duplicates.
--   • Venues and aliases are edited by Admin directly from the app. The RLS
--     rules from migration 2 already allow this for admins only.
--
-- USED BY
--   src/pages/Venues/*, src/utils/eventDetect.ts, functions/event-calendar
--
-- DEPENDS ON
--   Migrations 1–2.
--
-- SAFE TO RE-RUN
--   Yes.
-- =============================================================================

alter table public.venues add column if not exists sub_venues text[] not null default '{}';
alter table public.venues add column if not exists sort_order int not null default 0;

create unique index if not exists venues_calendar_venue_id_key
  on public.venues (calendar_venue_id) where calendar_venue_id is not null;
