-- Migration 12: lets each issue have its own venue, function and item.
alter table public.issues add column if not exists item text;
alter table public.issues add column if not exists venue_id uuid references public.venues(id);
alter table public.issues add column if not exists calendar_event_id text;
alter table public.issues add column if not exists event_info jsonb;

create index if not exists issues_venue_idx on public.issues (venue_id);

update public.issues i
   set venue_id = s.venue_id,
       calendar_event_id = s.calendar_event_id,
       event_info = case when s.calendar_event_id is not null
                         then jsonb_build_object('guest_name', s.guest_name, 'function_name', s.function_name, 'date', s.event_date)
                    end
  from public.submissions s
 where s.id = i.submission_id and i.venue_id is null;
