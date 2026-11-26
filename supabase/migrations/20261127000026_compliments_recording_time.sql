-- Migration 26: good feedback shows the day and time of the recording, not the time it was processed again.
create or replace function public.compliments_feed(p_from date, p_to date)
returns table (
  id uuid, submission_id uuid, created_at timestamptz, event_day date, item text, summary text,
  original_text text, venue_id uuid, venue_name text, recorded_by text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_active_user() then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return query
    select c.id, c.submission_id, s.created_at, c.event_day, c.item, c.summary, c.original_text,
           c.venue_id, v.venue_name, u.name
      from public.compliments c
      join public.submissions s on s.id = c.submission_id
      left join public.venues v on v.id = c.venue_id
      left join public.app_users u on u.id = s.submitted_by
     where c.event_day between p_from and p_to
     order by c.event_day desc, s.created_at desc
     limit 500;
end $$;
revoke all on function public.compliments_feed(date, date) from public, anon;
grant execute on function public.compliments_feed(date, date) to authenticated;

update public.compliments c
   set event_day = coalesce(s.event_date, (s.created_at at time zone 'Asia/Kolkata')::date)
  from public.submissions s
 where s.id = c.submission_id
   and c.event_day = (c.created_at at time zone 'Asia/Kolkata')::date
   and c.event_day <> coalesce(s.event_date, (s.created_at at time zone 'Asia/Kolkata')::date);
