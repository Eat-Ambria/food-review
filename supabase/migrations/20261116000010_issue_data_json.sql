-- Migration 10: saves each submission's issues as one JSON entry.
alter table public.submissions add column if not exists issue_data jsonb;

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
