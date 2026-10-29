-- What supabase/migrations/20261029011534_eu_runtime_and_media_rollup_v1.sql needs that
-- production already has: orgs, m_people, eu_jobs, eu_monitors, media_jobs,
-- media_cost_events, and the Vault / pg_net / pg_cron surfaces its functions name
-- (stand-ins; nothing here sends or schedules). Test-only, scratch database. Applied
-- after supabase_api_roles.stub.sql and schema_test_helpers.sql.
create schema if not exists private;
grant usage on schema private to anon, authenticated;  -- as production
create schema if not exists vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(), name text, description text, secret text);
create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
  returns uuid language sql as $$ insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id $$;
create schema if not exists net;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
  returns bigint language sql as $$ select 1::bigint $$;
create schema if not exists cron;
create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean not null default true);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql
  as $$ insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
        on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ delete from cron.job where jobname = job_name returning true $$;

create table public.orgs(id uuid primary key default gen_random_uuid());
create table public.eu_jobs(id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), job_type text not null default 'x',
  provider text not null default '', action text not null default 'run', state text not null default 'queued', priority smallint not null default 5,
  scheduled_at timestamptz not null default now(), lease_owner text, lease_until timestamptz, attempts integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.eu_monitors(id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), initiative_id uuid,
  name text not null, monitor_type text not null, provider text not null default '', cadence text not null default 'daily', enabled boolean not null default true,
  last_run_at timestamptz, next_run_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
-- the row types the two trigger functions declare (%rowtype is resolved when they are validated);
-- production has every one of these tables (checked 2026-10-29)
create table public.eu_workflows(id uuid primary key default gen_random_uuid());
create table public.out_recipients(id uuid primary key default gen_random_uuid());
create table public.out_contacts(id uuid primary key default gen_random_uuid());
create table public.out_campaigns(id uuid primary key default gen_random_uuid());
create table public.eu_stakeholders(id uuid primary key default gen_random_uuid());
create table public.eu_stakeholder_links(id uuid primary key default gen_random_uuid());
create table public.media_jobs(id uuid primary key default gen_random_uuid(), org_id uuid, provider text, capability text, provider_model_id text,
  status text, created_at timestamptz not null default now());
create table public.media_cost_events(id bigserial primary key, org_id uuid, job_id uuid references public.media_jobs(id), event_type text,
  amount_cents integer, created_at timestamptz not null default now());

insert into public.orgs(id) values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.m_people(id) values ('a0000000-0000-4000-8000-00000000000a');
insert into public.eu_jobs(org_id, provider) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ddex'), ('aaaaaaaa-0000-4000-8000-000000000001', 'zenodo'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'internal');
insert into public.eu_monitors(org_id, name, monitor_type, provider, next_run_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Citations', 'citation', 'openalex', now() - interval '1 minute');
insert into public.media_jobs(id, org_id, provider, capability, provider_model_id, status) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'fal', 'image', 'm1', 'succeeded'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'fal', 'video', 'm2', 'running');
insert into public.media_cost_events(org_id, job_id, event_type, amount_cents) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'reserved', 50),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'actual', 37),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000002', 'reserved', 120);
