-- Migration 8: venue details for matching the Event Calendar.
alter table public.venues add column if not exists sub_venues text[] not null default '{}';
alter table public.venues add column if not exists sort_order int not null default 0;

create unique index if not exists venues_calendar_venue_id_key
  on public.venues (calendar_venue_id) where calendar_venue_id is not null;
