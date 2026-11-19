-- Migration 2: security rules (who can read or change which data).
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

create or replace function public.current_poc_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.pocs p
  join public.app_users u on u.id = p.user_id
  where p.user_id = auth.uid() and p.is_active and u.is_active
$$;

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

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on public.app_users, public.auth_login_attempts, public.submissions, public.issues,
                public.issue_assignments, public.issue_events, public.notification_queue,
                public.api_usage_log, public.job_errors
  to authenticated;

grant select, insert, update, delete on public.venues, public.venue_aliases, public.issue_categories,
                                        public.pocs, public.poc_category_mapping, public.app_settings
  to authenticated;

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists login_attempts_admin on public.auth_login_attempts;
create policy login_attempts_admin on public.auth_login_attempts for select to authenticated
  using (public.is_admin());

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

drop policy if exists pocs_read on public.pocs;
create policy pocs_read on public.pocs for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
drop policy if exists pocs_admin_write on public.pocs;
create policy pocs_admin_write on public.pocs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists poc_map_admin on public.poc_category_mapping;
create policy poc_map_admin on public.poc_category_mapping for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select to authenticated
  using (
    public.is_admin()
    or (submitted_by = auth.uid() and public.is_active_user())
    or exists (select 1 from public.issues i where i.submission_id = submissions.id and public.is_my_issue(i.id))
  );

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

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_user_id = auth.uid() and public.is_active_user());
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_user_id = auth.uid() and public.is_active_user())
  with check (recipient_user_id = auth.uid());

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
