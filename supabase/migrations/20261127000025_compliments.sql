-- Migration 25: good feedback (praise like "chhole bahut achhe the") saved apart from issues and shown on the Issues page.
create table if not exists public.compliments (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  item           text,
  venue_id       uuid references public.venues(id) on delete set null,
  event_day      date not null,
  summary        text not null,
  original_text  text,
  created_at     timestamptz not null default now()
);
create index if not exists compliments_day_idx on public.compliments (event_day desc);
create index if not exists compliments_submission_idx on public.compliments (submission_id);
alter table public.compliments enable row level security;
grant all on public.compliments to service_role;

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
    select c.id, c.submission_id, c.created_at, c.event_day, c.item, c.summary, c.original_text,
           c.venue_id, v.venue_name, u.name
      from public.compliments c
      join public.submissions s on s.id = c.submission_id
      left join public.venues v on v.id = c.venue_id
      left join public.app_users u on u.id = s.submitted_by
     where c.event_day between p_from and p_to
     order by c.event_day desc, c.created_at desc
     limit 500;
end $$;
revoke all on function public.compliments_feed(date, date) from public, anon;
grant execute on function public.compliments_feed(date, date) to authenticated;
