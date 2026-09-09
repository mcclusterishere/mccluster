-- Equity Uprise Policy OS — automation/control/integration layer.
-- External systems are adapters. Their receipts become eu_events; they never
-- become the canonical source of policy state.

create extension if not exists pgcrypto;
create schema if not exists private;

-- public.is_org_owner did not exist. Two policies below call it, so this
-- migration could not run. It is defined here in the same shape as the
-- existing public.is_org_member: SECURITY DEFINER over org_members with a
-- pinned search_path, answering for the current auth.uid() only.
create or replace function public.is_org_owner(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org
      and m.profile_id = auth.uid()
      and m.role = 'owner'
  );
$$;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Integration registry: metadata + secret references, never raw secrets
-- ---------------------------------------------------------------------
create table if not exists public.eu_integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null,
  integration_class text not null
    check (integration_class in ('mail','calendar','identity','identifier','repository','government','social','media','music','analytics','storage','other')),
  label text not null default '',
  account_id text not null default '',
  account_label text not null default '',
  credential_mode text not null default 'function-secret'
    check (credential_mode in ('function-secret','vault','oauth-vault','none')),
  token_env text,
  secret_id uuid,
  refresh_secret_id uuid,
  scopes text[] not null default '{}',
  capabilities jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'disconnected'
    check (status in ('disconnected','pending','connected','degraded','error','revoked')),
  last_ok_at timestamptz,
  last_sync_at timestamptz,
  last_error text not null default '',
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, label),
  constraint eu_integrations_one_primary_secret check (token_env is null or secret_id is null)
);
create index if not exists eu_integrations_status_idx on public.eu_integrations(org_id, status, provider);
drop trigger if exists eu_integrations_touch on public.eu_integrations;
create trigger eu_integrations_touch before update on public.eu_integrations
for each row execute function private.eu_touch_updated_at();

-- Person-scoped OAuth grants (ORCID is the important first use case).
-- refresh/access material is always a Vault reference, never stored here.
create table if not exists public.eu_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  integration_id uuid not null references public.eu_integrations(id) on delete cascade,
  m_uid uuid references public.m_people(id) on delete cascade,
  external_subject text not null default '',
  external_email text not null default '',
  access_secret_id uuid,
  refresh_secret_id uuid,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','expired','revoked','error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eu_oauth_connections_subject_idx
  on public.eu_oauth_connections(integration_id, external_subject, m_uid);
drop trigger if exists eu_oauth_connections_touch on public.eu_oauth_connections;
create trigger eu_oauth_connections_touch before update on public.eu_oauth_connections
for each row execute function private.eu_touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. Workflow definitions and runs
-- ---------------------------------------------------------------------
create table if not exists public.eu_workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  trigger_event text not null,
  initiative_id uuid references public.eu_initiatives(id) on delete cascade,
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  approval_mode text not null default 'none'
    check (approval_mode in ('none','standing','per-run')),
  enabled boolean not null default true,
  max_runs_per_hour integer not null default 100 check (max_runs_per_hour between 1 and 10000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eu_workflows_trigger_idx on public.eu_workflows(org_id, trigger_event, enabled);
drop trigger if exists eu_workflows_touch on public.eu_workflows;
create trigger eu_workflows_touch before update on public.eu_workflows
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  workflow_id uuid not null references public.eu_workflows(id) on delete cascade,
  trigger_event_id bigint references public.eu_events(id) on delete set null,
  state text not null default 'queued'
    check (state in ('queued','running','waiting-approval','succeeded','partial','failed','cancelled')),
  correlation_id uuid not null default gen_random_uuid(),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text not null default '',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists eu_workflow_runs_state_idx on public.eu_workflow_runs(org_id, state, created_at);

-- Generic durable jobs. Domain-specific subsystems (social/media/outbound) keep
-- their own queues; this table coordinates adapters that do not already have one.
create table if not exists public.eu_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  workflow_run_id uuid references public.eu_workflow_runs(id) on delete set null,
  event_id bigint references public.eu_events(id) on delete set null,
  integration_id uuid references public.eu_integrations(id) on delete set null,
  job_type text not null,
  provider text not null default '',
  action text not null,
  capability text not null default '',
  resource_type text not null default '',
  resource_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'queued'
    check (state in ('queued','leased','waiting-approval','running','retry','succeeded','failed','cancelled','not-configured')),
  priority smallint not null default 5 check (priority between 1 and 9),
  scheduled_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 8 check (max_attempts between 1 and 100),
  idempotency_key text,
  approval_id uuid references public.control_approvals(id) on delete set null,
  result jsonb not null default '{}'::jsonb,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eu_jobs_idempotency_idx
  on public.eu_jobs(org_id, idempotency_key) where idempotency_key is not null;
create index if not exists eu_jobs_due_idx on public.eu_jobs(state, scheduled_at, priority) where state in ('queued','retry');
create index if not exists eu_jobs_resource_idx on public.eu_jobs(org_id, resource_type, resource_id, created_at desc);
drop trigger if exists eu_jobs_touch on public.eu_jobs;
create trigger eu_jobs_touch before update on public.eu_jobs
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_job_attempts (
  id bigserial primary key,
  job_id uuid not null references public.eu_jobs(id) on delete cascade,
  attempt integer not null,
  worker text not null default '',
  request jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  http_status integer,
  provider_request_id text not null default '',
  error text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (job_id, attempt)
);

-- Lease due work. Service role only.
create or replace function private.eu_claim_jobs(p_worker text, p_limit integer default 20, p_lease_seconds integer default 120)
returns setof public.eu_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return query
  with due as (
    select j.id from public.eu_jobs j
    where j.state in ('queued','retry')
      and j.scheduled_at <= now()
      and (j.lease_until is null or j.lease_until < now())
    order by j.priority desc, j.scheduled_at, j.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,20),100))
  )
  update public.eu_jobs j
     set state='leased', lease_owner=left(coalesce(p_worker,'worker'),120),
         lease_until=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),1800))),
         attempts=j.attempts+1, updated_at=now()
   from due where j.id=due.id
  returning j.*;
end;
$$;
revoke all on function private.eu_claim_jobs(text,integer,integer) from public, anon, authenticated;
grant execute on function private.eu_claim_jobs(text,integer,integer) to service_role;

-- ---------------------------------------------------------------------
-- 3. Intelligence monitors
-- ---------------------------------------------------------------------
create table if not exists public.eu_monitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete cascade,
  name text not null,
  monitor_type text not null
    check (monitor_type in ('web-search','rss','government-docket','legislation','agenda','utility-filing','research-literature','stakeholder-site','citation','source-health','custom-api')),
  provider text not null default '',
  query jsonb not null default '{}'::jsonb,
  cadence text not null default 'daily',
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  cursor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eu_monitors_due_idx on public.eu_monitors(enabled, next_run_at);
drop trigger if exists eu_monitors_touch on public.eu_monitors;
create trigger eu_monitors_touch before update on public.eu_monitors
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_monitor_hits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  monitor_id uuid not null references public.eu_monitors(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete cascade,
  external_id text not null default '',
  url text not null default '',
  title text not null default '',
  summary text not null default '',
  occurred_at timestamptz,
  relevance numeric(5,4) check (relevance is null or relevance between 0 and 1),
  classification jsonb not null default '{}'::jsonb,
  state text not null default 'new' check (state in ('new','relevant','ignored','actioned','duplicate')),
  raw jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (monitor_id, external_id)
);
create index if not exists eu_monitor_hits_queue_idx on public.eu_monitor_hits(initiative_id, state, first_seen_at desc);

-- ---------------------------------------------------------------------
-- 4. Government targets, dockets, submissions and receipts
-- ---------------------------------------------------------------------
create table if not exists public.eu_government_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete cascade,
  level text not null default 'local' check (level in ('local','county','state','federal','tribal','international')),
  jurisdiction text not null default '',
  agency text not null default '',
  body text not null default '',
  office text not null default '',
  official_name text not null default '',
  official_title text not null default '',
  email text not null default '',
  portal_url text not null default '',
  api_provider text not null default '',
  external_target_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists eu_government_targets_touch on public.eu_government_targets;
create trigger eu_government_targets_touch before update on public.eu_government_targets
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_government_dockets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete cascade,
  target_id uuid references public.eu_government_targets(id) on delete set null,
  provider text not null default '',
  external_docket_id text not null,
  title text not null default '',
  docket_type text not null default '',
  status text not null default 'open',
  url text not null default '',
  comment_deadline timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  unique (org_id, provider, external_docket_id)
);

create table if not exists public.eu_government_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid not null references public.eu_initiatives(id) on delete cascade,
  target_id uuid references public.eu_government_targets(id) on delete set null,
  docket_id uuid references public.eu_government_dockets(id) on delete set null,
  publication_id uuid,
  submission_type text not null default 'letter'
    check (submission_type in ('letter','comment','testimony','petition','filing','policy-brief','records-request','other')),
  title text not null,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  provider text not null default '',
  state text not null default 'draft'
    check (state in ('draft','ready','waiting-approval','submitted','accepted','rejected','withdrawn','failed')),
  control_approval_id uuid references public.control_approvals(id) on delete set null,
  external_submission_id text not null default '',
  receipt jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  deadline_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eu_government_submissions_queue_idx on public.eu_government_submissions(org_id, state, deadline_at);
drop trigger if exists eu_government_submissions_touch on public.eu_government_submissions;
create trigger eu_government_submissions_touch before update on public.eu_government_submissions
for each row execute function private.eu_touch_updated_at();

-- publication_id FK is added by the publication migration once that table exists.

-- ---------------------------------------------------------------------
-- 5. Automation-safe stage projection rules (data, not hardcoded UI logic)
-- ---------------------------------------------------------------------
create table if not exists public.eu_stage_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  object_type text not null check (object_type in ('stakeholder-link','fellowship-application','initiative','submission')),
  from_stage text,
  event_type text not null,
  to_stage text not null,
  priority integer not null default 100,
  conditions jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(org_id, object_type, event_type, to_stage)
);

-- Seed relationship rules. Human overrides remain possible by stage_source='human'.
insert into public.eu_stage_rules(org_id, object_type, event_type, to_stage, priority)
select o.id, 'stakeholder-link', x.event_type, x.to_stage, x.priority
from public.orgs o cross join (values
  ('outreach.queued','queued',10),
  ('outreach.sent','contacted',20),
  ('outreach.replied','replied',30),
  ('meeting.requested','meeting-requested',40),
  ('meeting.confirmed','meeting-scheduled',50),
  ('meeting.completed','engaged',60),
  ('commitment.created','committed',70)
) as x(event_type,to_stage,priority)
where o.slug='mccluster'
on conflict do nothing;

insert into public.eu_stage_rules(org_id, object_type, event_type, to_stage, priority)
select o.id, 'fellowship-application', x.event_type, x.to_stage, x.priority
from public.orgs o cross join (values
  ('fellowship.submitted','submitted',10),
  ('fellowship.screened','screening',20),
  ('interview.requested','interview-requested',30),
  ('interview.confirmed','interview-scheduled',40),
  ('interview.completed','interviewed',50),
  ('fellowship.accepted','accepted',60),
  ('fellowship.onboarded','onboarded',70)
) as x(event_type,to_stage,priority)
where o.slug='mccluster'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 6. Suggested workflows: OFF until adapters are configured.
-- ---------------------------------------------------------------------
insert into public.eu_workflows(org_id,name,trigger_event,conditions,actions,approval_mode,enabled)
select o.id, x.name, x.trigger_event, x.conditions, x.actions, x.approval_mode, false
from public.orgs o cross join (values
  ('Inbound reply -> relationship state','mail.inbound',
   '{"requires":["initiative_id","stakeholder_id"]}'::jsonb,
   '[{"do":"classify-reply"},{"do":"project-stage"},{"do":"extract-commitments"},{"do":"propose-next-action"}]'::jsonb,'none'),
  ('Meeting completed -> institutional memory','meeting.completed',
   '{}'::jsonb,
   '[{"do":"summarize-meeting"},{"do":"extract-commitments"},{"do":"propose-followup"},{"do":"project-stage"}]'::jsonb,'none'),
  ('Publication approved -> package outputs','publication.approved',
   '{}'::jsonb,
   '[{"do":"render-html"},{"do":"render-pdf"},{"do":"render-jats"},{"do":"generate-citation-metadata"},{"do":"queue-distribution"}]'::jsonb,'standing'),
  ('Source superseded -> impact review','source.superseded',
   '{}'::jsonb,
   '[{"do":"find-dependent-claims"},{"do":"find-dependent-artifacts"},{"do":"open-correction-review"}]'::jsonb,'none')
) as x(name,trigger_event,conditions,actions,approval_mode)
where o.slug='mccluster'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 7. RLS + grants
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array[
    'eu_integrations','eu_oauth_connections','eu_workflows','eu_workflow_runs','eu_jobs','eu_job_attempts',
    'eu_monitors','eu_monitor_hits','eu_government_targets','eu_government_dockets','eu_government_submissions','eu_stage_rules'
  ] loop execute format('alter table public.%I enable row level security',t); end loop;
end $$;

-- Integration credentials/config are owner-only.
drop policy if exists eu_integrations_owner on public.eu_integrations;
create policy eu_integrations_owner on public.eu_integrations for select to authenticated
using (public.is_org_owner(org_id));
drop policy if exists eu_oauth_connections_read on public.eu_oauth_connections;
create policy eu_oauth_connections_read on public.eu_oauth_connections for select to authenticated
using (
  public.is_org_owner(org_id)
  or (m_uid is not null and exists(select 1 from public.m_auth_user_links l where l.auth_user_id=auth.uid() and l.m_uid=eu_oauth_connections.m_uid))
);

-- Operational state is visible to org members; mutation is service-side/control-plane only.
do $$ declare t text; begin
  foreach t in array array[
    'eu_workflows','eu_workflow_runs','eu_jobs','eu_monitors','eu_monitor_hits',
    'eu_government_targets','eu_government_dockets','eu_government_submissions','eu_stage_rules'
  ] loop
    execute format('drop policy if exists %I on public.%I',t||'_org_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))',t||'_org_read',t);
  end loop;
end $$;

-- attempts inherit from the job.
drop policy if exists eu_job_attempts_read on public.eu_job_attempts;
create policy eu_job_attempts_read on public.eu_job_attempts for select to authenticated
using (exists(select 1 from public.eu_jobs j where j.id=job_id and public.is_org_member(j.org_id)));

grant select on public.eu_integrations, public.eu_oauth_connections, public.eu_workflows,
  public.eu_workflow_runs, public.eu_jobs, public.eu_job_attempts, public.eu_monitors,
  public.eu_monitor_hits, public.eu_government_targets, public.eu_government_dockets,
  public.eu_government_submissions, public.eu_stage_rules to authenticated;

revoke insert, update, delete on public.eu_integrations, public.eu_oauth_connections, public.eu_workflows,
  public.eu_workflow_runs, public.eu_jobs, public.eu_job_attempts, public.eu_monitors,
  public.eu_monitor_hits, public.eu_government_targets, public.eu_government_dockets,
  public.eu_government_submissions, public.eu_stage_rules from anon, authenticated;
