-- Creator payout reservation ledger: no public access, no live Stripe execution.
create table if not exists public.action_creator_funding (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  mission_id uuid not null,
  currency text not null default 'usd' check (currency = 'usd'),
  funded_cents bigint not null default 0 check (funded_cents >= 0),
  reserved_cents bigint not null default 0 check (reserved_cents >= 0),
  spent_cents bigint not null default 0 check (spent_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, mission_id),
  check (funded_cents >= reserved_cents + spent_cents)
);
create table if not exists public.action_creator_payout_intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  mission_id uuid not null,
  earning_id uuid not null unique references public.action_clip_earnings(id),
  creator_m_uid uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[a-zA-Z0-9]+$'),
  idempotency_key text not null unique,
  state text not null default 'reserved' check (state in ('reserved','transferring','transferred','failed','reversed')),
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  stripe_transfer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.action_creator_payout_events (
  id uuid primary key default gen_random_uuid(),
  payout_intent_id uuid not null references public.action_creator_payout_intents(id),
  org_id uuid not null references public.orgs(id),
  event_key text not null unique,
  event_type text not null,
  amount_cents bigint,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists action_creator_payout_intents_org_state_idx on public.action_creator_payout_intents(org_id,state);
create index if not exists action_creator_payout_events_intent_idx on public.action_creator_payout_events(payout_intent_id);
alter table public.action_creator_funding enable row level security;
alter table public.action_creator_payout_intents enable row level security;
alter table public.action_creator_payout_events enable row level security;
alter table public.action_creator_funding force row level security;
alter table public.action_creator_payout_intents force row level security;
alter table public.action_creator_payout_events force row level security;
revoke all on public.action_creator_funding, public.action_creator_payout_intents, public.action_creator_payout_events from anon, authenticated;
