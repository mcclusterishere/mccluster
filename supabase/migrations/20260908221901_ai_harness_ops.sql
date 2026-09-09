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

create table if not exists public.ops_objectives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  body text,
  status text not null default 'open'
    check (status in ('open','blocked','done','dropped')),
  priority int not null default 50,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null,
  body text not null,
  severity text not null default 'info'
    check (severity in ('info','watch','warn','critical')),
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ops_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null,
  status text not null default 'queued'
    check (status in ('queued','running','done','failed','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  error text,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ops_jobs_due
  on public.ops_jobs (status, run_after)
  where status in ('queued','running');

create table if not exists public.ops_recommendations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  objective_id uuid references public.ops_objectives(id) on delete set null,
  title text not null,
  body text,
  status text not null default 'proposed'
    check (status in ('proposed','accepted','rejected','executed')),
  score real,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ops_repo_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  repo text not null,
  kind text not null,
  ref text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ops_objectives enable row level security;
alter table public.ops_signals enable row level security;
alter table public.ops_jobs enable row level security;
alter table public.ops_recommendations enable row level security;
alter table public.ops_repo_events enable row level security;

revoke all on table public.ops_objectives from anon, authenticated;
revoke all on table public.ops_signals from anon, authenticated;
revoke all on table public.ops_jobs from anon, authenticated;
revoke all on table public.ops_recommendations from anon, authenticated;
revoke all on table public.ops_repo_events from anon, authenticated;
grant all on table public.ops_objectives to service_role;
grant all on table public.ops_signals to service_role;
grant all on table public.ops_jobs to service_role;
grant all on table public.ops_recommendations to service_role;
grant all on table public.ops_repo_events to service_role;
