-- Migration 1: creates all the tables.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table if not exists public.app_users (
  id               uuid primary key references auth.users(id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 120),

  username         text not null check (username ~ '^[a-z0-9]+(\.[a-z0-9]+)*$' and length(username) <= 64),
  role             text not null default 'recorder' check (role in ('admin', 'recorder', 'poc')),
  mobile_number    text,
  email            text,
  is_active        boolean not null default true,
  must_change_pin  boolean not null default true,
  last_login_at    timestamptz,
  created_by       uuid references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists app_users_username_key on public.app_users (username);
create index if not exists app_users_role_active_idx on public.app_users (role, is_active);

create table if not exists public.app_user_secrets (
  user_id          uuid primary key references public.app_users(id) on delete cascade,
  pin_hash         text not null,
  failed_attempts  int  not null default 0,
  locked_until     timestamptz,
  pin_changed_at   timestamptz,
  updated_at       timestamptz not null default now()
);

create table if not exists public.auth_login_attempts (
  id          bigint generated always as identity primary key,
  username    text,
  user_id     uuid references public.app_users(id) on delete set null,
  ip          text,
  outcome     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists auth_login_attempts_ip_time_idx on public.auth_login_attempts (ip, created_at desc);

create table if not exists public.venues (
  id                 uuid primary key default gen_random_uuid(),
  venue_name         text not null unique,
  calendar_venue_id  text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.venue_aliases (
  id                uuid primary key default gen_random_uuid(),
  venue_id          uuid not null references public.venues(id) on delete cascade,
  alias             text not null,

  alias_normalized  text generated always as (lower(regexp_replace(trim(alias), '\s+', ' ', 'g'))) stored,
  created_at        timestamptz not null default now(),
  unique (venue_id, alias_normalized)
);
create index if not exists venue_aliases_norm_idx on public.venue_aliases (alias_normalized);

create table if not exists public.issue_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.pocs (
  id          uuid primary key default gen_random_uuid(),

  user_id     uuid unique references public.app_users(id) on delete set null,
  name        text not null,
  email       text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.poc_category_mapping (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.issue_categories(id) on delete cascade,
  poc_id       uuid not null references public.pocs(id) on delete cascade,
  venue_id     uuid references public.venues(id) on delete cascade,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists poc_map_cat_venue_uniq
  on public.poc_category_mapping (category_id, venue_id) where is_active and venue_id is not null;
create unique index if not exists poc_map_cat_default_uniq
  on public.poc_category_mapping (category_id) where is_active and venue_id is null;

create table if not exists public.submissions (
  id                    uuid primary key default gen_random_uuid(),

  client_submission_id  uuid not null unique,
  submitted_by          uuid not null references public.app_users(id),

  audio_path            text,
  audio_mime            text,
  audio_duration_sec    numeric(6,2) check (audio_duration_sec is null or audio_duration_sec <= 125),
  audio_expires_at      timestamptz,
  audio_deleted_at      timestamptz,

  raw_transcript        text,
  reviewed_transcript   text not null check (length(trim(reviewed_transcript)) > 0),
  transcription_meta    jsonb not null default '{}'::jsonb,

  event_date            date,
  venue_id              uuid references public.venues(id),
  calendar_event_id     text,
  guest_name            text,
  function_name         text,
  event_match           jsonb,
  extraction            jsonb,

  processing_status     text not null default 'submitted' check (processing_status in (
                          'submitted', 'processing', 'awaiting_confirmation',
                          'pending_assignment', 'assigned', 'failed')),
  processing_error      text,
  attempt_count         int not null default 0,
  next_attempt_at       timestamptz,
  locked_at             timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists submissions_by_user_idx on public.submissions (submitted_by, created_at desc);
create index if not exists submissions_status_idx  on public.submissions (processing_status, next_attempt_at);
create index if not exists submissions_event_idx   on public.submissions (event_date, venue_id);

create table if not exists public.issues (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.submissions(id) on delete cascade,
  issue_index       int  not null,
  category_id       uuid references public.issue_categories(id),
  category_raw      text,
  description       text not null,
  location          text,
  ai_summary        text,
  summary_status    text not null default 'pending' check (summary_status in ('pending', 'done', 'failed')),
  status            text not null default 'pending' check (status in ('pending', 'in_progress', 'resolved')),
  resolution_notes  text,
  resolved_at       timestamptz,
  resolved_by       uuid references public.app_users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (submission_id, issue_index)
);
create index if not exists issues_status_idx   on public.issues (status, created_at desc);
create index if not exists issues_category_idx on public.issues (category_id);

create table if not exists public.issue_assignments (
  id           uuid primary key default gen_random_uuid(),
  issue_id     uuid not null references public.issues(id) on delete cascade,
  poc_id       uuid not null references public.pocs(id),
  is_current   boolean not null default true,
  assigned_by  uuid references public.app_users(id),
  reason       text,
  assigned_at  timestamptz not null default now(),
  ended_at     timestamptz
);
create unique index if not exists issue_assignments_one_current
  on public.issue_assignments (issue_id) where is_current;
create index if not exists issue_assignments_poc_idx
  on public.issue_assignments (poc_id) where is_current;

create table if not exists public.issue_events (
  id          bigint generated always as identity primary key,
  issue_id    uuid not null references public.issues(id) on delete cascade,
  actor_id    uuid references public.app_users(id),
  event_type  text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists issue_events_issue_idx on public.issue_events (issue_id, created_at);

create table if not exists public.notification_queue (
  id                 uuid primary key default gen_random_uuid(),
  issue_id           uuid references public.issues(id) on delete cascade,
  recipient_user_id  uuid not null references public.app_users(id) on delete cascade,
  channel            text not null default 'in_app' check (channel in ('in_app', 'email', 'whatsapp', 'push')),
  notification_type  text not null,
  payload            jsonb not null default '{}'::jsonb,

  dedupe_key         text not null unique,
  status             text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  retry_count        int not null default 0,
  max_retries        int not null default 5,
  last_error         text,
  next_attempt_at    timestamptz not null default now(),
  locked_at          timestamptz,
  created_at         timestamptz not null default now(),
  processed_at       timestamptz
);
create index if not exists notification_queue_due_idx
  on public.notification_queue (status, next_attempt_at);

create table if not exists public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  recipient_user_id  uuid not null references public.app_users(id) on delete cascade,
  issue_id           uuid references public.issues(id) on delete cascade,
  queue_id           uuid unique references public.notification_queue(id) on delete set null,
  title              text not null,
  body               text,
  read_at            timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_user_id, created_at desc);

create table if not exists public.api_usage_log (
  id             bigint generated always as identity primary key,
  provider       text not null,
  operation      text not null,
  model          text,
  ok             boolean not null,
  http_status    int,
  latency_ms     int,
  usage          jsonb not null default '{}'::jsonb,
  error          text,
  submission_id  uuid references public.submissions(id) on delete set null,
  user_id        uuid references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists api_usage_log_provider_time_idx on public.api_usage_log (provider, created_at desc);

create table if not exists public.job_errors (
  id           bigint generated always as identity primary key,
  job          text not null,
  entity_type  text,
  entity_id    text,
  message      text not null,
  details      jsonb not null default '{}'::jsonb,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists job_errors_open_idx on public.job_errors (created_at desc) where resolved_at is null;

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.app_users(id),
  updated_at  timestamptz not null default now()
);

insert into public.app_settings (key, value, description) values
  ('pin_max_attempts',     '5',  'Wrong PINs in a row before the account locks'),
  ('pin_lock_minutes',     '15', 'How long a locked account stays locked'),
  ('ip_max_attempts',      '30', 'Login attempts allowed from one network address per window'),
  ('ip_window_minutes',    '15', 'Window for the per-network-address login limit'),
  ('audio_retention_days', '30', 'Days to keep the original recordings before auto-delete')
on conflict (key) do nothing;

do $$
declare t text;
begin
  foreach t in array array['app_users','app_user_secrets','venues','issue_categories','pocs',
                           'poc_category_mapping','submissions','issues','app_settings']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
