-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 1 of the Ambria food review: every table, constraint and index.
--
-- WHY IT EXISTS
--   One voice recording ("submission") can contain several complaints
--   ("issues"). Each issue is assigned, tracked and resolved on its own, while
--   the original transcript and event details stay on the submission, so they
--   are stored once and never copied.
--
--     app_users ─┬─< submissions ─< issues ─< issue_assignments >─ pocs
--                │                    │  └──< issue_events (audit trail)
--                │                    └── issue_categories ─< poc_category_mapping >─ pocs
--                └── app_user_secrets (PIN hash, lockout — no client access)
--     venues ─< venue_aliases            notification_queue → notifications
--     api_usage_log / job_errors / app_settings (operations + Admin visibility)
--
-- USED BY
--   Every Edge Function and the React app (through the RLS rules in migration 2).
--
-- DEPENDS ON
--   Supabase Auth (auth.users). Each app_users row IS a Supabase Auth user, so
--   that auth.uid() works inside RLS policies.
--
-- SAFE TO RE-RUN
--   Yes. Everything uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Keeps updated_at honest on every UPDATE without trusting the client.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- USERS
-- -----------------------------------------------------------------------------
create table if not exists public.app_users (
  id               uuid primary key references auth.users(id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 120),
  -- Lowercase letters, digits and dots only (rahul.sharma, rahul.sharma2).
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

-- Secrets live in their own table. RLS is on and NO policy exists, so even a
-- user reading their own app_users row can never see a PIN hash.
create table if not exists public.app_user_secrets (
  user_id          uuid primary key references public.app_users(id) on delete cascade,
  pin_hash         text not null,            -- bcrypt, via pgcrypto crypt()
  failed_attempts  int  not null default 0,
  locked_until     timestamptz,
  pin_changed_at   timestamptz,
  updated_at       timestamptz not null default now()
);

-- Every login attempt, success or failure. Feeds the per-IP rate limit and
-- gives Admin an audit trail.
create table if not exists public.auth_login_attempts (
  id          bigint generated always as identity primary key,
  username    text,
  user_id     uuid references public.app_users(id) on delete set null,
  ip          text,
  outcome     text not null,   -- ok | invalid | locked | inactive | rate_limited
  created_at  timestamptz not null default now()
);
create index if not exists auth_login_attempts_ip_time_idx on public.auth_login_attempts (ip, created_at desc);

-- -----------------------------------------------------------------------------
-- VENUES + ALIASES
-- Aliases are a separate table (not an array) so they can be indexed, and so
-- the same alias may belong to two venues; the app then asks the user which one.
-- -----------------------------------------------------------------------------
create table if not exists public.venues (
  id                 uuid primary key default gen_random_uuid(),
  venue_name         text not null unique,
  calendar_venue_id  text,          -- Event Calendar category id, e.g. 'ap'
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.venue_aliases (
  id                uuid primary key default gen_random_uuid(),
  venue_id          uuid not null references public.venues(id) on delete cascade,
  alias             text not null,
  -- lower-cased, single-spaced copy used for case-insensitive exact matching
  alias_normalized  text generated always as (lower(regexp_replace(trim(alias), '\s+', ' ', 'g'))) stored,
  created_at        timestamptz not null default now(),
  unique (venue_id, alias_normalized)
);
create index if not exists venue_aliases_norm_idx on public.venue_aliases (alias_normalized);

-- -----------------------------------------------------------------------------
-- CATEGORIES, POCs, MAPPINGS
-- -----------------------------------------------------------------------------
create table if not exists public.issue_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,          -- also given to the AI so it categorises correctly
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.pocs (
  id          uuid primary key default gen_random_uuid(),
  -- The login account the POC uses to open their dashboard.
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
  venue_id     uuid references public.venues(id) on delete cascade,  -- null = all venues
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- At most ONE active POC per (category, venue), plus one per category with no
-- venue as the fallback. Venue-specific mappings win over the fallback.
create unique index if not exists poc_map_cat_venue_uniq
  on public.poc_category_mapping (category_id, venue_id) where is_active and venue_id is not null;
create unique index if not exists poc_map_cat_default_uniq
  on public.poc_category_mapping (category_id) where is_active and venue_id is null;

-- -----------------------------------------------------------------------------
-- SUBMISSIONS (one per recording)
-- -----------------------------------------------------------------------------
create table if not exists public.submissions (
  id                    uuid primary key default gen_random_uuid(),
  -- Generated on the phone before the first submit attempt. Re-sending after a
  -- network drop hits this unique key instead of creating a duplicate.
  client_submission_id  uuid not null unique,
  submitted_by          uuid not null references public.app_users(id),

  -- Audio (kept temporarily; see app_settings.audio_retention_days)
  audio_path            text,          -- private Storage object path
  audio_mime            text,
  audio_duration_sec    numeric(6,2) check (audio_duration_sec is null or audio_duration_sec <= 125),
  audio_expires_at      timestamptz,
  audio_deleted_at      timestamptz,

  -- Transcripts. reviewed_transcript is what the user approved; nothing ever
  -- rewrites it. raw_transcript is Sarvam's untouched output, kept for audits.
  raw_transcript        text,
  reviewed_transcript   text not null check (length(trim(reviewed_transcript)) > 0),
  transcription_meta    jsonb not null default '{}'::jsonb,   -- model, language, chunks

  -- Event-level details (null when not stated — never guessed)
  event_date            date,
  venue_id              uuid references public.venues(id),
  calendar_event_id     text,
  guest_name            text,
  function_name         text,
  event_match           jsonb,          -- candidates + how the match was made
  extraction            jsonb,          -- full structured JSON from the AI, validated

  processing_status     text not null default 'submitted' check (processing_status in (
                          'submitted', 'processing', 'awaiting_confirmation',
                          'pending_assignment', 'assigned', 'failed')),
  processing_error      text,
  attempt_count         int not null default 0,
  next_attempt_at       timestamptz,
  locked_at             timestamptz,    -- cron claim, so two runs never process one row

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists submissions_by_user_idx on public.submissions (submitted_by, created_at desc);
create index if not exists submissions_status_idx  on public.submissions (processing_status, next_attempt_at);
create index if not exists submissions_event_idx   on public.submissions (event_date, venue_id);

-- -----------------------------------------------------------------------------
-- ISSUES (one per complaint inside a submission)
-- -----------------------------------------------------------------------------
create table if not exists public.issues (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.submissions(id) on delete cascade,
  issue_index       int  not null,     -- position within the recording (0, 1, 2…)
  category_id       uuid references public.issue_categories(id),
  category_raw      text,              -- what the AI said, even if it matched nothing
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
  -- Re-processing the same submission can never create the same issue twice.
  unique (submission_id, issue_index)
);
create index if not exists issues_status_idx   on public.issues (status, created_at desc);
create index if not exists issues_category_idx on public.issues (category_id);

-- Assignment HISTORY. Exactly one row per issue has is_current = true.
create table if not exists public.issue_assignments (
  id           uuid primary key default gen_random_uuid(),
  issue_id     uuid not null references public.issues(id) on delete cascade,
  poc_id       uuid not null references public.pocs(id),
  is_current   boolean not null default true,
  assigned_by  uuid references public.app_users(id),   -- null = automatic
  reason       text,                                   -- 'auto: category mapping', 'manual: …'
  assigned_at  timestamptz not null default now(),
  ended_at     timestamptz
);
create unique index if not exists issue_assignments_one_current
  on public.issue_assignments (issue_id) where is_current;
create index if not exists issue_assignments_poc_idx
  on public.issue_assignments (poc_id) where is_current;

-- Audit trail: status changes, notes, reassignments.
create table if not exists public.issue_events (
  id          bigint generated always as identity primary key,
  issue_id    uuid not null references public.issues(id) on delete cascade,
  actor_id    uuid references public.app_users(id),
  event_type  text not null,   -- status_changed | note_added | assigned | reassigned
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists issue_events_issue_idx on public.issue_events (issue_id, created_at);

-- -----------------------------------------------------------------------------
-- NOTIFICATIONS
-- notification_queue = work to deliver (in-app now; email/WhatsApp/push later)
-- notifications      = what a user sees in their in-app bell
-- -----------------------------------------------------------------------------
create table if not exists public.notification_queue (
  id                 uuid primary key default gen_random_uuid(),
  issue_id           uuid references public.issues(id) on delete cascade,
  recipient_user_id  uuid not null references public.app_users(id) on delete cascade,
  channel            text not null default 'in_app' check (channel in ('in_app', 'email', 'whatsapp', 'push')),
  notification_type  text not null,     -- issue_assigned | issue_reassigned | …
  payload            jsonb not null default '{}'::jsonb,
  -- e.g. 'issue_assigned:<assignment id>:in_app'. Unique, so no duplicates ever.
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

-- -----------------------------------------------------------------------------
-- OPERATIONS: API usage, errors, settings
-- -----------------------------------------------------------------------------
-- One row per external API call. Counts requests and usage, so moving from free
-- to paid tiers (or comparing cost) is based on real numbers.
create table if not exists public.api_usage_log (
  id             bigint generated always as identity primary key,
  provider       text not null,     -- sarvam | gemini | event_calendar
  operation      text not null,     -- transcribe | extract | summarize | list_events
  model          text,
  ok             boolean not null,
  http_status    int,
  latency_ms     int,
  usage          jsonb not null default '{}'::jsonb,   -- audio seconds, tokens…
  error          text,
  submission_id  uuid references public.submissions(id) on delete set null,
  user_id        uuid references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists api_usage_log_provider_time_idx on public.api_usage_log (provider, created_at desc);

create table if not exists public.job_errors (
  id           bigint generated always as identity primary key,
  job          text not null,       -- process-issue | assign-issues | cron | …
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

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
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
