-- Migration 21: the menu's dishes, so recordings can tell a dish name ("Golden Coin") from a venue name.
create table if not exists public.dishes (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) between 1 and 120),
  name_hi         text,
  section         text,
  is_active       boolean not null default true,
  name_normalized text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  created_at      timestamptz not null default now(),
  unique (name_normalized)
);
alter table public.dishes enable row level security;
grant select on public.dishes to authenticated;
grant all on public.dishes to service_role;

drop policy if exists dishes_read on public.dishes;
create policy dishes_read on public.dishes for select to authenticated using (public.is_active_user());
drop policy if exists dishes_admin_write on public.dishes;
create policy dishes_admin_write on public.dishes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
