-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 10: one JSON entry per submission, in the agreed key-value format.
--
-- WHY IT EXISTS
--   The user wants every complaint stored as a single JSON blob:
--     {
--       "event_date": "2026-11-15",
--       "venue": "Ambria Pushpanjali",
--       "guest_name": null,
--       "function_name": "Wedding",
--       "issues": [
--         { "category": "Maintenance", "description": "...", "location": "Banquet Hall", "summary": "..." }
--       ]
--     }
--   It is written by process-issue every time a submission is processed.
--   The individual issues ALSO stay as rows in `issues`, because each one is
--   assigned to its own POC and gets its own status. issue_data is the
--   complete record as extracted, handy for export and other systems. Status
--   changes are tracked in `issues`, not in this blob.
--
-- USED BY
--   supabase/functions/process-issue (writes it)
--
-- DEPENDS ON
--   Migrations 1–9.
--
-- SAFE TO RE-RUN
--   Yes. The backfill only touches rows where issue_data is still empty.
-- =============================================================================

alter table public.submissions add column if not exists issue_data jsonb;

-- Fill it for submissions that were processed before this column existed.
update public.submissions s
   set issue_data = jsonb_build_object(
         'event_date',    s.event_date,
         'venue',         (select v.venue_name from public.venues v where v.id = s.venue_id),
         'guest_name',    s.guest_name,
         'function_name', s.function_name,
         'issues', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'category',    i.category_raw,
                      'description', i.description,
                      'location',    i.location,
                      'summary',     i.ai_summary
                    ) order by i.issue_index)
               from public.issues i where i.submission_id = s.id), '[]'::jsonb)
       )
 where s.issue_data is null
   and s.processing_status in ('pending_assignment', 'assigned', 'needs_review');
