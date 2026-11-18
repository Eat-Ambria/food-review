-- =============================================================================
-- WHAT THIS FILE IS
--   Migration 2: Row Level Security, which decides who can read or write which rows.
--
-- WHY IT EXISTS
--   The browser holds the public key, so anyone can call the database API
--   directly. Hiding a page in React protects nothing. Every rule must live here.
--
--   Principles:
--   • Being logged in is NOT enough. A user must also have an ACTIVE app_users
--     row. Deactivating a user cuts them off on their very next request, even
--     while their session token is still valid.
--   • Sensitive writes (status changes, PIN changes, assignment) go through
--     SECURITY DEFINER functions that check permissions themselves, never
--     through broad UPDATE policies.
--   • Tables with RLS on and no policy for a role are invisible to that role
--     (app_user_secrets, auth_login_attempts, notification_queue…).
--
-- USED BY
--   Every query the React app makes with the user's session.
--
-- DEPENDS ON
--   Migration 1 (tables).
--
-- SAFE TO RE-RUN
--   Yes. Policies are dropped and recreated.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can read app_users without
-- triggering app_users' own policies (which would recurse forever).
-- -----------------------------------------------------------------------------
create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.app_users where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_app_role() is not null
$$;

-- The pocs.id of the logged-in user, if they are an active POC.
create or replace function public.current_poc_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.pocs p
  join public.app_users u on u.id = p.user_id
  where p.user_id = auth.uid() and p.is_active and u.is_active
$$;

-- True when the issue is currently assigned to the logged-in POC.
create or replace function public.is_my_issue(p_issue_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.issue_assignments a
    where a.issue_id = p_issue_id and a.is_current and a.poc_id = public.current_poc_id()
  )
$$;

revoke all on function public.current_app_role(), public.is_admin(), public.is_active_user(),
                     public.current_poc_id(), public.is_my_issue(uuid) from public, anon;
grant execute on function public.current_app_role(), public.is_admin(), public.is_active_user(),
                     public.current_poc_id(), public.is_my_issue(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Turn RLS on everywhere.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['app_users','app_user_secrets','auth_login_attempts','venues','venue_aliases',
                           'issue_categories','pocs','poc_category_mapping','submissions','issues',
                           'issue_assignments','issue_events','notification_queue','notifications',
                           'api_usage_log','job_errors','app_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Table privileges. The project was created with "Automatically expose new
-- tables" OFF, so no API role can touch any table until it is granted here.
-- Two layers: GRANT decides which tables a role can reach at all, and the RLS
-- policies below decide which ROWS inside them.
--   anon          → nothing (a logged-out visitor sees no table)
--   authenticated → only the tables the app reads/writes directly
--   service_role  → everything (Edge Functions; it bypasses RLS by design)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on public.app_users, public.auth_login_attempts, public.submissions, public.issues,
                public.issue_assignments, public.issue_events, public.notification_queue,
                public.api_usage_log, public.job_errors
  to authenticated;
-- Master data that Admin edits from the app (RLS limits writes to Admin).
grant select, insert, update, delete on public.venues, public.venue_aliases, public.issue_categories,
                                        public.pocs, public.poc_category_mapping, public.app_settings
  to authenticated;
-- Notifications: read own, and only the read_at column may change.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
-- app_user_secrets: deliberately NO grant to authenticated.

-- -----------------------------------------------------------------------------
-- app_users: everyone sees their own row; Admin sees all.
-- No INSERT/UPDATE/DELETE policies. User changes go through Edge Functions /
-- admin RPCs, so nobody can promote themselves to admin.
-- -----------------------------------------------------------------------------
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- app_user_secrets / auth_login_attempts: no policies → no client access.
-- (Admin sees login attempts through a later admin view.)
drop policy if exists login_attempts_admin on public.auth_login_attempts;
create policy login_attempts_admin on public.auth_login_attempts for select to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- Master data: readable by any active user, writable by Admin.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['venues','venue_aliases','issue_categories']
  loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated
                    using (public.is_active_user())', t);
    execute format('drop policy if exists %1$s_admin_write on public.%1$s', t);
    execute format('create policy %1$s_admin_write on public.%1$s for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- pocs: Admin manages; a POC can read their own record.
drop policy if exists pocs_read on public.pocs;
create policy pocs_read on public.pocs for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
drop policy if exists pocs_admin_write on public.pocs;
create policy pocs_admin_write on public.pocs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists poc_map_admin on public.poc_category_mapping;
create policy poc_map_admin on public.poc_category_mapping for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- submissions
--   Recorder: sees own. POC: sees a submission only if one of its issues is
--   currently theirs (to read the transcript). Admin: all.
--   INSERT/UPDATE happen through Edge Functions (service role), so the client
--   can never set its own processing_status or event match.
-- -----------------------------------------------------------------------------
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select to authenticated
  using (
    public.is_admin()
    or (submitted_by = auth.uid() and public.is_active_user())
    or exists (select 1 from public.issues i where i.submission_id = submissions.id and public.is_my_issue(i.id))
  );

-- -----------------------------------------------------------------------------
-- issues: Admin all; POC only their currently-assigned issues; recorder the
-- issues from their own submissions. Status updates go through an RPC.
-- -----------------------------------------------------------------------------
drop policy if exists issues_select on public.issues;
create policy issues_select on public.issues for select to authenticated
  using (
    public.is_admin()
    or public.is_my_issue(id)
    or exists (select 1 from public.submissions s
               where s.id = issues.submission_id and s.submitted_by = auth.uid() and public.is_active_user())
  );

drop policy if exists issue_assignments_select on public.issue_assignments;
create policy issue_assignments_select on public.issue_assignments for select to authenticated
  using (public.is_admin() or (is_current and poc_id = public.current_poc_id()));

drop policy if exists issue_events_select on public.issue_events;
create policy issue_events_select on public.issue_events for select to authenticated
  using (public.is_admin() or public.is_my_issue(issue_id));

-- -----------------------------------------------------------------------------
-- notifications: own only. Marking read is the only allowed change. The
-- column-level grant above means only read_at can be updated.
-- -----------------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_user_id = auth.uid() and public.is_active_user());
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_user_id = auth.uid() and public.is_active_user())
  with check (recipient_user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Admin-only visibility tables.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['notification_queue','api_usage_log','job_errors']
  loop
    execute format('drop policy if exists %1$s_admin_read on public.%1$s', t);
    execute format('create policy %1$s_admin_read on public.%1$s for select to authenticated
                    using (public.is_admin())', t);
  end loop;
end $$;

drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
