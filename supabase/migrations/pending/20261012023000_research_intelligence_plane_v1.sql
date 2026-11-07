-- Research Intelligence Plane v1.
-- Adds an evidence/claim graph on top of the existing Research Lab registry.
-- Browser roles receive no direct table access; the McCluster Worker remains
-- the owner-only gateway. Publication-facing material is aggregate by default.

create table if not exists public.research_evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid not null references public.research_projects(id) on delete cascade,
  key text not null unique,
  title text not null,
  evidence_type text not null
    check (evidence_type in ('analytics_aggregate','spatial_query','dataset','source_snapshot','experiment_result','other')),
  source_system text not null,
  source_ref text,
  query_spec jsonb not null default '{}'::jsonb check (jsonb_typeof(query_spec) = 'object'),
  observed_from timestamptz,
  observed_until timestamptz,
  row_count bigint check (row_count is null or row_count >= 0),
  aggregate_only boolean not null default true,
  contains_direct_identifiers boolean not null default false,
  privacy_class text not null default 'aggregate'
    check (privacy_class in ('public','aggregate','internal_restricted')),
  content_sha256 text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (observed_until is null or observed_from is null or observed_until >= observed_from),
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  check (not contains_direct_identifiers or privacy_class = 'internal_restricted'),
  check (aggregate_only or privacy_class = 'internal_restricted')
);

create index if not exists research_evidence_project_time
  on public.research_evidence_snapshots (research_project_id, captured_at desc);

create table if not exists public.research_claims (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid not null references public.research_projects(id) on delete cascade,
  claim_key text not null,
  claim_text text not null,
  status text not null default 'draft'
    check (status in ('draft','supported','contested','rejected','published')),
  analysis_method text,
  effect jsonb not null default '{}'::jsonb check (jsonb_typeof(effect) = 'object'),
  limitations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (research_project_id, claim_key)
);

create table if not exists public.research_claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.research_claims(id) on delete cascade,
  research_source_id uuid references public.research_sources(id) on delete restrict,
  evidence_snapshot_id uuid references public.research_evidence_snapshots(id) on delete restrict,
  relation text not null check (relation in ('supports','contradicts','context')),
  locator jsonb not null default '{}'::jsonb check (jsonb_typeof(locator) = 'object'),
  note text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(research_source_id, evidence_snapshot_id) = 1)
);

create index if not exists research_claim_evidence_claim
  on public.research_claim_evidence (claim_id, relation);

alter table public.research_evidence_snapshots enable row level security;
alter table public.research_claims enable row level security;
alter table public.research_claim_evidence enable row level security;

revoke all on table public.research_evidence_snapshots from anon, authenticated;
revoke all on table public.research_claims from anon, authenticated;
revoke all on table public.research_claim_evidence from anon, authenticated;

comment on table public.research_evidence_snapshots is
  'Versionable research evidence manifests for aggregate analytics, governed spatial queries, datasets and experiment results. Raw visitor identifiers are not publication evidence.';
comment on table public.research_claims is
  'Claim ledger. A paper claim can remain contested and can link to both supporting and contradicting evidence.';
comment on table public.research_claim_evidence is
  'Claim-to-source/evidence graph with structured locators for reproducible citations.';
