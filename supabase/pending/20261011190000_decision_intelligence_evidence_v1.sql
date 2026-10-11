-- Decision Intelligence evidence spine. Deliberately private: no direct Data API grants.
-- Access must be mediated by an authenticated, org-authorized server adapter.
create schema if not exists decision_intelligence;

create table if not exists decision_intelligence.sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  canonical_uri text,
  title text not null,
  source_kind text not null check (source_kind in ('web','document','internal','financial','spatial')),
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  usage_lane text not null default 'internal',
  retention_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create index if not exists di_sources_org_retrieved_idx on decision_intelligence.sources (org_id, retrieved_at desc);
create unique index if not exists di_sources_org_hash_idx on decision_intelligence.sources (org_id, content_sha256) where content_sha256 is not null;

create table if not exists decision_intelligence.claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  statement text not null check (length(trim(statement)) > 0),
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified','supported','disputed','rejected','stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create index if not exists di_claims_org_state_idx on decision_intelligence.claims (org_id, verification_state);

create table if not exists decision_intelligence.evidence_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  claim_id uuid not null,
  source_id uuid not null,
  relationship text not null check (relationship in ('supports','contradicts','context')),
  source_locator text,
  excerpt text,
  recorded_at timestamptz not null default now(),
  foreign key (org_id, claim_id) references decision_intelligence.claims(org_id, id) on delete cascade,
  foreign key (org_id, source_id) references decision_intelligence.sources(org_id, id) on delete restrict,
  unique (org_id, claim_id, source_id, relationship, source_locator)
);
create index if not exists di_evidence_org_source_idx on decision_intelligence.evidence_links (org_id, source_id);

create table if not exists decision_intelligence.decision_evidence (
  org_id uuid not null,
  decision_id uuid not null,
  claim_id uuid not null,
  attached_at timestamptz not null default now(),
  primary key (org_id, decision_id, claim_id),
  foreign key (org_id, claim_id) references decision_intelligence.claims(org_id, id) on delete restrict
);
-- Decision IDs are validated by the authenticated decision service. No FK to
-- ai_context.decisions until that schema's production migration is verified.

alter table decision_intelligence.sources enable row level security;
alter table decision_intelligence.claims enable row level security;
alter table decision_intelligence.evidence_links enable row level security;
alter table decision_intelligence.decision_evidence enable row level security;
alter table decision_intelligence.sources force row level security;
alter table decision_intelligence.claims force row level security;
alter table decision_intelligence.evidence_links force row level security;
alter table decision_intelligence.decision_evidence force row level security;

revoke all on schema decision_intelligence from public, anon, authenticated, service_role;
revoke all on all tables in schema decision_intelligence from public, anon, authenticated, service_role;
comment on schema decision_intelligence is 'Private evidence registry; no public Data API surface. Authorized backend access only.';
