-- Test-only stand-ins for the production tables the intel canon builds on.
-- Column shapes match production (verified 2026-10-15 with information_schema,
-- SELECT-only). Never applied to a real project.
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null default '',
  kind text not null default 'house', settings jsonb not null default '{}'::jsonb, enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade, profile_id uuid not null,
  role text not null default 'member', added_at timestamptz not null default now(), primary key (org_id, profile_id)
);
-- ops_ingest_connectors / runs / records: verbatim from
-- supabase/migrations/20260919055029_universal_ingestion_entity_resolution_v1.sql (lines 9-91)
create table if not exists public.ops_ingest_connectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  connector_key text not null check (connector_key ~ '^[a-z][a-z0-9_.:-]{0,119}$'),
  kind text not null check (kind in (
    'api','database','file','email','calendar','web','telemetry','event_stream','mcp','internal'
  )),
  display_name text not null,
  description text not null default '',
  config jsonb not null default '{}'::jsonb,
  cursor jsonb not null default '{}'::jsonb,
  retention_policy jsonb not null default '{}'::jsonb,
  license_policy jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  last_sync_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, connector_key),
  unique (id, org_id)
);
create index if not exists ops_ingest_connectors_kind_idx
  on public.ops_ingest_connectors(org_id, kind, enabled);

create table if not exists public.ops_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  connector_id uuid not null,
  trace_id uuid not null default gen_random_uuid(),
  mode text not null default 'incremental'
    check (mode in ('initial','incremental','replay','manual')),
  status text not null default 'running'
    check (status in ('running','succeeded','partial','failed')),
  cursor_before jsonb not null default '{}'::jsonb,
  cursor_after jsonb not null default '{}'::jsonb,
  records_seen integer not null default 0 check (records_seen >= 0),
  records_written integer not null default 0 check (records_written >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (connector_id, org_id)
    references public.ops_ingest_connectors(id, org_id) on delete cascade
);
create index if not exists ops_ingest_runs_connector_idx
  on public.ops_ingest_runs(org_id, connector_id, started_at desc);
create index if not exists ops_ingest_runs_status_idx
  on public.ops_ingest_runs(org_id, status, started_at desc);

create table if not exists public.ops_ingest_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  connector_id uuid not null,
  run_id uuid references public.ops_ingest_runs(id) on delete set null,
  trace_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 1000),
  record_kind text not null check (char_length(record_kind) between 1 and 160),
  source_ref jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 1200),
  payload jsonb not null default '{}'::jsonb,
  retention_policy jsonb not null default '{}'::jsonb,
  license_policy jsonb not null default '{}'::jsonb,
  status text not null default 'accepted'
    check (status in ('accepted','rejected','superseded')),
  error text,
  created_at timestamptz not null default now(),
  foreign key (connector_id, org_id)
    references public.ops_ingest_connectors(id, org_id) on delete cascade,
  unique (org_id, connector_id, idempotency_key),
  unique (id, org_id)
);
create index if not exists ops_ingest_records_external_idx
  on public.ops_ingest_records(org_id, connector_id, external_id, observed_at desc);
create index if not exists ops_ingest_records_hash_idx
  on public.ops_ingest_records(org_id, content_hash);
create index if not exists ops_ingest_records_trace_idx
  on public.ops_ingest_records(org_id, trace_id, ingested_at);
alter table public.ops_ingest_connectors enable row level security;
alter table public.ops_ingest_runs enable row level security;
alter table public.ops_ingest_records enable row level security;
revoke all on public.ops_ingest_connectors, public.ops_ingest_runs, public.ops_ingest_records from public, anon, authenticated;
grant select, insert, update, delete on public.ops_ingest_connectors, public.ops_ingest_runs, public.ops_ingest_records to service_role;
