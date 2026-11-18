-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 18 of the Ambria food review: turns on Realtime for the
--   notifications table.
-- WHY IT EXISTS
--   The bell used to check for new notifications every 20 seconds, so an
--   in-app banner could arrive up to 20 s late. With Realtime the app is told
--   the moment a row is added (components/NotificationBell.tsx subscribes to
--   INSERTs for the signed-in user only).
--   Safe: nothing is changed or deleted. Realtime obeys the existing RLS
--   policy (notifications_select): a user only ever hears about their OWN rows.
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste → Run. Running it twice is fine.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
