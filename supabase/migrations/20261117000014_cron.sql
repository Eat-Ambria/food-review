-- Migration 14: the 5-minute background job (retries and clean-up).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists public.job_runs (
  id           bigint generated always as identity primary key,
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  stats        jsonb not null default '{}'::jsonb
);
create index if not exists job_runs_job_time_idx on public.job_runs (job, started_at desc);
alter table public.job_runs enable row level security;
grant select on public.job_runs to authenticated;
grant all on public.job_runs to service_role;
drop policy if exists job_runs_admin_read on public.job_runs;
create policy job_runs_admin_read on public.job_runs for select to authenticated using (public.is_admin());

create or replace function public.job_start(p_job text)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('job:' || p_job));
  if exists (select 1 from public.job_runs where job = p_job and finished_at is null and started_at > now() - interval '4 minutes') then
    return null;
  end if;
  insert into public.job_runs (job) values (p_job) returning id into v_id;
  return v_id;
end $$;

create or replace function public.job_finish(p_id bigint, p_ok boolean, p_stats jsonb)
returns void language sql volatile security definer set search_path = public as $$
  update public.job_runs set finished_at = now(), ok = p_ok, stats = coalesce(p_stats, '{}'::jsonb) where id = p_id
$$;

create or replace function public.maintenance_cleanup()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a int; b int; c int;
begin
  delete from public.transcription_chunks where created_at < now() - interval '7 days';   get diagnostics a = row_count;
  delete from public.api_usage_log       where created_at < now() - interval '90 days';  get diagnostics b = row_count;
  delete from public.job_runs            where started_at < now() - interval '30 days';  get diagnostics c = row_count;
  return jsonb_build_object('transcription_chunks', a, 'api_usage_log', b, 'job_runs', c);
end $$;

revoke all on function public.job_start(text), public.job_finish(bigint, boolean, jsonb), public.maintenance_cleanup()
  from public, anon, authenticated;
grant execute on function public.job_start(text), public.job_finish(bigint, boolean, jsonb), public.maintenance_cleanup()
  to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'issue_desk_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'issue_desk_cron_secret',
                                'Shared with Edge Function secret CRON_SECRET (process-issue cron run)');
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'issue-desk-every-5-min') then
    perform cron.unschedule('issue-desk-every-5-min');
  end if;
end $$;

select cron.schedule(
  'issue-desk-every-5-min',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://upcewlcrwpwntiibobth.supabase.co/functions/v1/process-issue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'issue_desk_cron_secret')
    ),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

select decrypted_secret as copy_this_into_CRON_SECRET
  from vault.decrypted_secrets where name = 'issue_desk_cron_secret';
