-- McCluster Platform Core
-- One identity / app registry / fee-policy / ledger layer for every McCluster app.
-- Whip Equipped becomes a product family on this root rather than a parallel backend.

create extension if not exists pgcrypto;

-- ============================================================
-- APPLICATION REGISTRY
-- ============================================================
create table if not exists public.platform_apps (
  id uuid primary key default gen_random_uuid(),
  app_key text not null unique,
  name text not null,
  product_family text not null,
  kind text not null default 'web'
    check (kind in ('web','ios','android','desktop','service','game')),
  bundle_id text,
  public_url text,
  oauth_client_id text,
  oauth_redirect_uris jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_apps is
  'Canonical registry of every McCluster application. OAuth registration lives in Supabase Auth; oauth_client_id mirrors the assigned client for platform policy and audit.';

create table if not exists public.platform_user_apps (
  user_id uuid not null references auth.users(id) on delete cascade,
  app_id uuid not null references public.platform_apps(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete cascade,
  role text not null default 'user',
  settings jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, app_id, org_id)
);

create index if not exists platform_user_apps_app_idx on public.platform_user_apps(app_id);
create index if not exists platform_user_apps_org_idx on public.platform_user_apps(org_id);

-- ============================================================
-- MONETIZATION POLICY
-- bps = basis points. 300 = 3.00%.
-- The payer fee is added to the payer's base amount.
-- The payee fee is withheld from the receiver/operator economic basis.
-- ============================================================
create table if not exists public.platform_fee_policies (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.platform_apps(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete cascade,
  policy_key text not null,
  payer_fee_bps integer not null default 0 check (payer_fee_bps between 0 and 10000),
  payee_fee_bps integer not null default 0 check (payee_fee_bps between 0 and 10000),
  white_label_payee_fee_bps integer not null default 0 check (white_label_payee_fee_bps between 0 and 10000),
  white_label_subscription_cents integer not null default 0 check (white_label_subscription_cents >= 0),
  currency text not null default 'usd',
  fee_basis jsonb not null default '{"base":true,"extras":true,"protection":false,"tax":false,"deposit":false,"tolls":false,"government_fees":false}'::jsonb,
  enabled boolean not null default true,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(app_id, org_id, policy_key)
);

comment on column public.platform_fee_policies.payer_fee_bps is
  'Fee charged on top of the payer/customer fee basis.';
comment on column public.platform_fee_policies.payee_fee_bps is
  'Fee withheld from the receiver/operator fee basis in network mode.';
comment on column public.platform_fee_policies.white_label_payee_fee_bps is
  'Receiver/operator fee after white-label subscription is active; normally zero for Whip Equipped.';

-- ============================================================
-- CENTRAL TRANSACTION LEDGER
-- Stripe may settle several components as one application fee. McCluster
-- records the economic components separately so reporting is never derived
-- from a Stripe total or frontend display.
-- ============================================================
create table if not exists public.platform_ledger (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.platform_apps(id) on delete restrict,
  org_id uuid references public.orgs(id) on delete restrict,
  payer_user_id uuid references auth.users(id) on delete set null,
  transaction_kind text not null,
  resource_type text not null,
  resource_id text not null,
  currency text not null default 'usd',

  base_amount_cents integer not null check (base_amount_cents >= 0),
  payer_fee_cents integer not null default 0 check (payer_fee_cents >= 0),
  payer_total_cents integer not null check (payer_total_cents >= 0),
  payee_fee_cents integer not null default 0 check (payee_fee_cents >= 0),
  processing_fee_cents integer check (processing_fee_cents is null or processing_fee_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  pass_through_cents integer not null default 0 check (pass_through_cents >= 0),
  platform_revenue_cents integer not null default 0 check (platform_revenue_cents >= 0),
  payee_economic_amount_cents integer not null check (payee_economic_amount_cents >= 0),

  stripe_connected_account_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_application_fee_id text,
  stripe_checkout_session_id text,
  status text not null default 'created'
    check (status in ('created','authorized','paid','captured','refunded','partially_refunded','canceled','failed','disputed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(app_id, resource_type, resource_id, transaction_kind)
);

create index if not exists platform_ledger_payer_idx on public.platform_ledger(payer_user_id, created_at desc);
create index if not exists platform_ledger_org_idx on public.platform_ledger(org_id, created_at desc);
create index if not exists platform_ledger_stripe_pi_idx on public.platform_ledger(stripe_payment_intent_id);

-- A mirror of OAuth clients is useful for app inventory and policy. It is
-- NOT the protocol source of truth: actual clients are registered in
-- Supabase Auth > OAuth Apps.
create table if not exists public.platform_oauth_clients (
  app_id uuid primary key references public.platform_apps(id) on delete cascade,
  client_id text unique,
  client_type text not null default 'public' check (client_type in ('public','confidential')),
  redirect_uris jsonb not null default '[]'::jsonb,
  scopes text[] not null default array['openid','profile','email'],
  environment text not null default 'production',
  registered_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- RLS
-- ============================================================
alter table public.platform_apps enable row level security;
alter table public.platform_user_apps enable row level security;
alter table public.platform_fee_policies enable row level security;
alter table public.platform_ledger enable row level security;
alter table public.platform_oauth_clients enable row level security;

-- Public app metadata is intentionally discoverable; disabled apps are not.
drop policy if exists platform_apps_public_read on public.platform_apps;
create policy platform_apps_public_read on public.platform_apps
  for select using (enabled = true);

-- A person can see their own app relationship. Org members can see rows for
-- their org. Server-side provisioning uses service role.
drop policy if exists platform_user_apps_mine on public.platform_user_apps;
create policy platform_user_apps_mine on public.platform_user_apps
  for select using (
    user_id = auth.uid()
    or (org_id is not null and public.is_org_member(org_id))
  );

-- Fee policy is quote-visible. Financial writes stay server-side.
drop policy if exists platform_fee_policy_read on public.platform_fee_policies;
create policy platform_fee_policy_read on public.platform_fee_policies
  for select using (
    enabled = true
    and (org_id is null or public.is_org_member(org_id))
  );

-- Payers see their own ledger; org members see org transactions.
drop policy if exists platform_ledger_read on public.platform_ledger;
create policy platform_ledger_read on public.platform_ledger
  for select using (
    payer_user_id = auth.uid()
    or (org_id is not null and public.is_org_member(org_id))
  );

-- OAuth client IDs are public identifiers, but registry mutation is server/admin only.
drop policy if exists platform_oauth_clients_read on public.platform_oauth_clients;
create policy platform_oauth_clients_read on public.platform_oauth_clients
  for select using (true);

-- Do not grant browser-side financial mutation capability. The service role
-- bypasses RLS and is the expected writer for fees and ledger records.
revoke insert, update, delete on public.platform_fee_policies from anon, authenticated;
revoke insert, update, delete on public.platform_ledger from anon, authenticated;
revoke insert, update, delete on public.platform_oauth_clients from anon, authenticated;

-- ============================================================
-- SEED FIRST-PARTY APPS
-- ============================================================
insert into public.platform_apps (app_key,name,product_family,kind,public_url)
values
  ('mccluster-web','McCluster','mccluster','web','https://matthew.mccluster.org'),
  ('whip-rider-web','Whip Equipped','whip-equipped','web',null),
  ('whip-driver-web','Whip Equipped Driver','whip-equipped','web',null),
  ('whip-rentals-web','Whip Equipped Rentals','whip-equipped','web',null),
  ('whip-rider-ios','Whip Equipped','whip-equipped','ios',null),
  ('whip-driver-ios','Whip Equipped Driver','whip-equipped','ios',null),
  ('whip-rentals-ios','Whip Equipped Rentals','whip-equipped','ios',null)
on conflict (app_key) do update set
  name=excluded.name,
  product_family=excluded.product_family,
  kind=excluded.kind,
  updated_at=now();

-- Network mode: payer + receiver are both monetized at 3%.
-- White Label: $33/month; receiver-side fee becomes 0%, payer service fee remains 3%.
insert into public.platform_fee_policies
  (app_id,org_id,policy_key,payer_fee_bps,payee_fee_bps,white_label_payee_fee_bps,white_label_subscription_cents,currency)
select id,null,'whip-network',300,300,0,3300,'usd'
from public.platform_apps
where app_key in ('whip-rider-web','whip-rider-ios','whip-rentals-web','whip-rentals-ios')
on conflict (app_id,org_id,policy_key) do update set
  payer_fee_bps=excluded.payer_fee_bps,
  payee_fee_bps=excluded.payee_fee_bps,
  white_label_payee_fee_bps=excluded.white_label_payee_fee_bps,
  white_label_subscription_cents=excluded.white_label_subscription_cents,
  updated_at=now();

-- Pre-create the OAuth mirror rows. Supabase OAuth Apps registration will
-- fill client_id and exact redirect URIs later.
insert into public.platform_oauth_clients (app_id,client_type,environment)
select id,'public','production'
from public.platform_apps
where app_key in (
  'whip-rider-web','whip-driver-web','whip-rentals-web',
  'whip-rider-ios','whip-driver-ios','whip-rentals-ios'
)
on conflict (app_id) do nothing;
