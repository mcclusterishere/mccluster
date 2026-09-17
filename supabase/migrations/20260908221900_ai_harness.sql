create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create schema if not exists ai_context;

revoke all on schema ai_context from public, anon, authenticated;
grant usage on schema ai_context to postgres, service_role;
grant all on all tables in schema ai_context to postgres, service_role;
grant all on all sequences in schema ai_context to postgres, service_role;
grant all on all functions in schema ai_context to postgres, service_role;
alter default privileges in schema ai_context grant all on tables to postgres, service_role;
alter default privileges in schema ai_context grant all on sequences to postgres, service_role;
alter default privileges in schema ai_context grant all on functions to postgres, service_role;

create table if not exists ai_context.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null
    check (provider in ('chatgpt','claude','grok','gemini','copilot','local','other')),
  account_label text not null default 'default',
  adapter_version text not null default '1',
  external_conversation_id text not null,
  title text,
  source_url text,
  model_family text,
  started_at timestamptz,
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, account_label, external_conversation_id)
);

create index if not exists ai_conversations_org_last
  on ai_context.conversations (org_id, last_message_at desc nulls last);

comment on table ai_context.conversations is
  'Normalized provider conversations. Raw private corpus. Not a public website datastore.';

create table if not exists ai_context.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_context.conversations(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider_message_id text,
  role text not null check (role in ('user','assistant','system','tool','other')),
  model text,
  content text not null,
  occurred_at timestamptz,
  ordinal int not null,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null,
  fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(content, '')), 'A')
  ) stored,
  created_at timestamptz not null default now(),
  unique (conversation_id, ordinal)
);

create index if not exists ai_messages_fts on ai_context.messages using gin (fts);
create index if not exists ai_messages_org_occurred
  on ai_context.messages (org_id, occurred_at desc nulls last);
create unique index if not exists ai_messages_provider_id
  on ai_context.messages (conversation_id, provider_message_id)
  where provider_message_id is not null;

create table if not exists ai_context.memory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  conversation_id uuid references ai_context.conversations(id) on delete set null,
  source_message_ids uuid[] not null default '{}',
  kind text not null default 'fact'
    check (kind in ('fact','preference','project','constraint','relationship','other')),
  subject text,
  body text not null,
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  status text not null default 'active'
    check (status in ('active','superseded','disputed','archived')),
  sensitivity text not null default 'internal'
    check (sensitivity in ('public','internal','restricted','secret')),
  superseded_by uuid references ai_context.memory_items(id) on delete set null,
  freshness_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', body), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_memory_fts on ai_context.memory_items using gin (fts);
create index if not exists ai_memory_org_status
  on ai_context.memory_items (org_id, status, freshness_at desc);

comment on table ai_context.memory_items is
  'Canonical durable memory. Transcripts stay in messages. Later statements supersede; they do not erase evidence.';

create table if not exists ai_context.decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  rationale text,
  risk_class text not null default 'low'
    check (risk_class in ('low','medium','high','critical')),
  status text not null default 'proposed'
    check (status in ('proposed','approved','rejected','executed','rolled_back')),
  requires_approval boolean not null default true,
  approved_by uuid,
  approved_at timestamptz,
  executed_at timestamptz,
  provenance jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_decisions_org_status
  on ai_context.decisions (org_id, status, created_at desc);

alter table ai_context.conversations enable row level security;
alter table ai_context.messages enable row level security;
alter table ai_context.memory_items enable row level security;
alter table ai_context.decisions enable row level security;
