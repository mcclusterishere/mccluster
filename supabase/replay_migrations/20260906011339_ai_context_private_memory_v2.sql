-- Local/CI reconstruction of the existing private context schema.
-- DDL recovered from production migration 20260906011339; contains no conversation data.
create extension if not exists pgmq;
create extension if not exists pg_net with schema extensions;

create schema if not exists ai_context;
revoke all on schema ai_context from public, anon, authenticated;

create table if not exists ai_context.sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  provider text not null,
  account_label text,
  adapter_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, account_label)
);

create table if not exists ai_context.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source_id uuid not null references ai_context.sources(id) on delete cascade,
  external_conversation_id text not null,
  title text,
  source_url text,
  model_family text,
  started_at timestamptz,
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_conversation_id)
);

create table if not exists ai_context.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  conversation_id uuid not null references ai_context.conversations(id) on delete cascade,
  external_message_id text,
  ordinal bigint,
  role text not null,
  model text,
  content text not null,
  content_hash text not null,
  occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  fts tsvector generated always as (to_tsvector('english', coalesce(content,''))) stored,
  embedding public.vector(384),
  created_at timestamptz not null default now(),
  unique (conversation_id, content_hash, role)
);

create index if not exists ai_context_messages_conversation_idx on ai_context.messages(conversation_id, ordinal, occurred_at);
create index if not exists ai_context_messages_fts_idx on ai_context.messages using gin(fts);
create index if not exists ai_context_messages_embedding_idx on ai_context.messages using hnsw (embedding public.vector_cosine_ops);

create table if not exists ai_context.memory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  memory_type text not null,
  subject text,
  content text not null,
  canonical_key text,
  confidence numeric(5,4) not null default 0.7000 check (confidence >= 0 and confidence <= 1),
  status text not null default 'active',
  sensitivity text not null default 'internal',
  source_message_ids uuid[] not null default '{}'::uuid[],
  valid_from timestamptz,
  valid_until timestamptz,
  last_confirmed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  fts tsvector generated always as (to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(content,''))) stored,
  embedding public.vector(384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ai_context_memory_key_unique on ai_context.memory_items(org_id, canonical_key) where canonical_key is not null;
create index if not exists ai_context_memory_fts_idx on ai_context.memory_items using gin(fts);
create index if not exists ai_context_memory_embedding_idx on ai_context.memory_items using hnsw (embedding public.vector_cosine_ops);

create table if not exists ai_context.decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  title text not null,
  decision text not null,
  rationale_summary text,
  risk_class text not null default 'low',
  status text not null default 'proposed',
  proposed_by text,
  approved_by uuid,
  approved_at timestamptz,
  source_conversation_id uuid references ai_context.conversations(id) on delete set null,
  source_message_ids uuid[] not null default '{}'::uuid[],
  supersedes_id uuid references ai_context.decisions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_context.model_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  provider text not null,
  model text not null,
  purpose text,
  conversation_id uuid references ai_context.conversations(id) on delete set null,
  context_message_ids uuid[] not null default '{}'::uuid[],
  context_memory_ids uuid[] not null default '{}'::uuid[],
  input_hash text,
  output_summary text,
  tool_calls jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  latency_ms integer,
  estimated_cost numeric(14,6),
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create table if not exists ai_context.artifact_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  conversation_id uuid references ai_context.conversations(id) on delete cascade,
  message_id uuid references ai_context.messages(id) on delete cascade,
  memory_id uuid references ai_context.memory_items(id) on delete cascade,
  decision_id uuid references ai_context.decisions(id) on delete cascade,
  artifact_type text not null,
  external_id text,
  url text,
  repo text,
  ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_context.sync_cursors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source_id uuid not null references ai_context.sources(id) on delete cascade,
  cursor text,
  last_external_id text,
  last_synced_at timestamptz,
  status text not null default 'idle',
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  unique(source_id)
);

create table if not exists ai_context.context_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  scope text not null,
  scope_key text,
  title text not null,
  markdown text not null,
  source_message_ids uuid[] not null default '{}'::uuid[],
  source_memory_ids uuid[] not null default '{}'::uuid[],
  generated_by text,
  content_hash text,
  created_at timestamptz not null default now()
);

create table if not exists ai_context.ingestion_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  provider text not null,
  idempotency_key text not null,
  payload_hash text,
  conversation_id uuid references ai_context.conversations(id) on delete set null,
  message_count integer not null default 0,
  status text not null default 'accepted',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(org_id, provider, idempotency_key)
);

alter table ai_context.sources enable row level security;
alter table ai_context.conversations enable row level security;
alter table ai_context.messages enable row level security;
alter table ai_context.memory_items enable row level security;
alter table ai_context.decisions enable row level security;
alter table ai_context.model_runs enable row level security;
alter table ai_context.artifact_links enable row level security;
alter table ai_context.sync_cursors enable row level security;
alter table ai_context.context_snapshots enable row level security;
alter table ai_context.ingestion_receipts enable row level security;

revoke all on all tables in schema ai_context from public, anon, authenticated;
revoke all on all sequences in schema ai_context from public, anon, authenticated;
revoke all on all functions in schema ai_context from public, anon, authenticated;
alter default privileges for role postgres in schema ai_context revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema ai_context revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema ai_context revoke execute on functions from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'ai-context-ingest') then
    perform pgmq.create('ai-context-ingest');
  end if;
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'ai-context-enrich') then
    perform pgmq.create('ai-context-enrich');
  end if;
end $$;
