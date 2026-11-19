-- Migration 17: remembers which function the recorder picked.
alter table public.submissions add column if not exists chosen_calendar_event_id text;
