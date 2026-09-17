create table if not exists ai_context.model_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  conversation_id uuid references ai_context.conversations(id) on delete set null,
  decision_id uuid references ai_context.decisions(id) on delete set null,
  provider text not null,
  model text,
  purpose text not null default 'other',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  latency_ms int,
  status text not null default 'ok'
    check (status in ('ok','error','budget_denied','policy_denied')),
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists ai_context.artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  conversation_id uuid references ai_context.conversations(id) on delete set null,
  kind text not null default 'file',
  uri text,
  label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_context.context_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text,
  body_markdown text not null,
  token_estimate int,
  generated_at timestamptz not null default now()
);

create table if not exists ai_context.sync_cursors (
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null,
  account_label text not null default 'default',
  cursor text,
  last_synced_at timestamptz,
  primary key (org_id, provider, account_label)
);

create table if not exists ai_context.ingestion_receipts (
  idempotency_key text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  conversation_id uuid not null references ai_context.conversations(id) on delete cascade,
  payload_hash text not null,
  accepted_at timestamptz not null default now()
);

alter table ai_context.model_runs enable row level security;
alter table ai_context.artifacts enable row level security;
alter table ai_context.context_snapshots enable row level security;
alter table ai_context.sync_cursors enable row level security;
alter table ai_context.ingestion_receipts enable row level security;

-- NOTE: this migration originally also created public.ops_objectives,
-- ops_signals, ops_jobs, ops_recommendations and ops_repo_events. That
-- block has been dropped when porting this file onto main: those tables
-- exist in the live database under different, incompatible column names
-- (ops_signals.signal_type not kind, integer severity, ops_objectives.name
-- not title — confirmed by independent review during the MCP continuity
-- work) and no migration in this repo's history defines the real,
-- currently-deployed shape of those tables. Reintroducing this draft
-- schema here would only leave a misleading definition in git for tables
-- that already exist differently in production. The live ops_* schema
-- still needs to be captured from the database and committed separately.
