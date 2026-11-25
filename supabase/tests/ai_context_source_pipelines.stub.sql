-- Minimal pre-state for supabase/pending/20261125012000_ai_context_source_pipelines_v1.sql on a disposable database.
-- Only the columns the source pipeline SQL touches (shapes from universal_ingestion_entity_resolution_v1 and
-- ai_context_workstreams_v1). Synthetic ids only. Never run against production.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists ai_context;
create table public.orgs (id uuid primary key, slug text not null, enabled boolean not null default true);
create table public.org_members (org_id uuid not null, profile_id uuid not null, role text not null);
create table public.ops_ingest_connectors (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id) on delete cascade,
  connector_key text not null, kind text not null, display_name text not null, description text not null default '',
  config jsonb not null default '{}'::jsonb, cursor jsonb not null default '{}'::jsonb,
  retention_policy jsonb not null default '{}'::jsonb, license_policy jsonb not null default '{}'::jsonb,
  enabled boolean not null default true, last_sync_at timestamptz, last_ok_at timestamptz, last_error text, last_error_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, connector_key), unique (id, org_id));
create table public.ops_ingest_runs (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, connector_id uuid not null,
  trace_id uuid not null default gen_random_uuid(),
  mode text not null default 'incremental' check (mode in ('initial','incremental','replay','manual')),
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  cursor_before jsonb not null default '{}'::jsonb, cursor_after jsonb not null default '{}'::jsonb,
  records_seen integer not null default 0, records_written integer not null default 0, records_rejected integer not null default 0,
  error text, metadata jsonb not null default '{}'::jsonb, started_at timestamptz not null default now(), finished_at timestamptz,
  foreign key (connector_id, org_id) references public.ops_ingest_connectors(id, org_id) on delete cascade);
create table public.ops_ingest_records (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, connector_id uuid not null,
  run_id uuid references public.ops_ingest_runs(id) on delete set null, trace_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 1000),
  record_kind text not null check (char_length(record_kind) between 1 and 160),
  source_ref jsonb not null default '{}'::jsonb, observed_at timestamptz not null, ingested_at timestamptz not null default now(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 1200),
  payload jsonb not null default '{}'::jsonb, retention_policy jsonb not null default '{}'::jsonb,
  license_policy jsonb not null default '{}'::jsonb,
  status text not null default 'accepted' check (status in ('accepted','rejected','superseded')), error text,
  created_at timestamptz not null default now(),
  foreign key (connector_id, org_id) references public.ops_ingest_connectors(id, org_id) on delete cascade,
  unique (org_id, connector_id, idempotency_key), unique (id, org_id));
create or replace function ai_context.workstream_require_house(p_org uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_org is null or not exists (select 1 from public.orgs o where o.id = p_org and o.slug = 'mccluster' and o.enabled = true) then
    raise exception 'organization outside Core authority' using errcode = '42501';
  end if;
end;
$$;
insert into public.orgs values ('00000000-0000-4000-8000-000000000001', 'mccluster', true), ('00000000-0000-4000-8000-000000000002', 'tenant', true);
insert into public.org_members values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', 'owner'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000bb', 'member'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', 'owner');
