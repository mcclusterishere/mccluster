-- Local replay reconstruction for production-only ai_context prerequisites.
-- Production already has ai_context.sources and ai_context.conversations from
-- historical live schema state that was never captured in canonical migrations.
-- This file intentionally shares the production decision migration version so
-- scripts/supabase-local-reset-with-replay.sh substitutes it only for clean
-- local/CI rebuilds; the canonical production migration remains unchanged.

create schema if not exists ai_context;

create table if not exists ai_context.sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  provider text not null,
  account_label text,
  adapter_version text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, account_label)
);

alter table ai_context.sources enable row level security;
revoke all on table ai_context.sources from public;
revoke all on table ai_context.sources from anon;
revoke all on table ai_context.sources from authenticated;
revoke all on table ai_context.sources from service_role;

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
  metadata jsonb not null default '{}',
  content_hash text,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_conversation_id)
);

alter table ai_context.conversations enable row level security;
revoke all on table ai_context.conversations from public;
revoke all on table ai_context.conversations from anon;
revoke all on table ai_context.conversations from authenticated;
revoke all on table ai_context.conversations from service_role;

-- Exact production decision migration follows.
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
  source_message_ids uuid[] not null default '{}',
  supersedes_id uuid references ai_context.decisions(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ai_context.decisions
  add column if not exists rationale_summary text,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists source_message_ids uuid[] not null default '{}',
  add column if not exists metadata jsonb not null default '{}',
  add column if not exists updated_at timestamptz not null default now();

alter table ai_context.decisions enable row level security;

revoke all on table ai_context.decisions from public;
revoke all on table ai_context.decisions from anon;
revoke all on table ai_context.decisions from authenticated;
revoke all on table ai_context.decisions from service_role;

comment on table ai_context.decisions is
  'Canonical private AI decision record. Human access is mediated by the authenticated context-decision Edge Function; direct Data API roles have no table privileges.';
