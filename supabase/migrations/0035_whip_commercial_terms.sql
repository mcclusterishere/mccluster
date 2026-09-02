-- Whip Equipped commercial terms on the McCluster platform.
--
-- McCluster Corp owns the customer-side platform rail.
-- Whip Equipped owns product-specific operator/network and white-label economics.
-- These are separate ledger components even if Stripe settles them together.

alter table public.platform_fee_policies
  add column if not exists white_label_build_fee_cents integer not null default 0
    check (white_label_build_fee_cents >= 0);

comment on column public.platform_fee_policies.white_label_build_fee_cents is
  'One-time implementation/build fee for a branded white-label application. Whip Equipped default: $333.';

-- Economic beneficiaries are durable accounting identities, not Stripe account ids.
-- Stripe destinations may change; the commercial right represented here does not.
create table if not exists public.platform_revenue_beneficiaries (
  beneficiary_key text primary key,
  display_name text not null,
  legal_name text,
  kind text not null default 'business'
    check (kind in ('business','product','partner','creator','affiliate')),
  settings jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A revenue component may be assigned across multiple beneficiaries. Shares for
-- the same app/policy/component should total 10,000 bps (100%).
create table if not exists public.platform_revenue_rules (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.platform_apps(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete cascade,
  policy_key text not null,
  component text not null
    check (component in ('payer_fee','payee_fee','white_label_build_fee','white_label_subscription')),
  beneficiary_key text not null references public.platform_revenue_beneficiaries(beneficiary_key) on delete restrict,
  share_bps integer not null check (share_bps between 0 and 10000),
  effective_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(app_id, org_id, policy_key, component, beneficiary_key, effective_at)
);

create index if not exists platform_revenue_rules_lookup_idx
  on public.platform_revenue_rules(app_id, org_id, policy_key, component, effective_at desc);

-- Per-transaction allocation rows make the economics auditable even if a
-- future contract changes percentages. Historical allocations never need to be
-- recomputed from today's pricing policy.
create table if not exists public.platform_ledger_allocations (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.platform_ledger(id) on delete cascade,
  component text not null
    check (component in ('payer_fee','payee_fee','white_label_build_fee','white_label_subscription')),
  beneficiary_key text not null references public.platform_revenue_beneficiaries(beneficiary_key) on delete restrict,
  gross_component_cents integer not null check (gross_component_cents >= 0),
  share_bps integer not null check (share_bps between 0 and 10000),
  allocation_cents integer not null check (allocation_cents >= 0),
  status text not null default 'accrued'
    check (status in ('accrued','payable','paid','reversed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(ledger_id, component, beneficiary_key)
);

create index if not exists platform_ledger_allocations_beneficiary_idx
  on public.platform_ledger_allocations(beneficiary_key, created_at desc);

alter table public.platform_revenue_beneficiaries enable row level security;
alter table public.platform_revenue_rules enable row level security;
alter table public.platform_ledger_allocations enable row level security;

-- The catalogue itself can be read by signed-in users for receipts/about screens.
drop policy if exists platform_revenue_beneficiaries_read on public.platform_revenue_beneficiaries;
create policy platform_revenue_beneficiaries_read on public.platform_revenue_beneficiaries
  for select to authenticated using (enabled = true);

-- Revenue agreements and allocations are financial records. Keep mutation and
-- broad reads on the service/admin boundary. Payers may see allocations tied to
-- their own transaction for receipt transparency; org members may see their org.
drop policy if exists platform_ledger_allocations_read on public.platform_ledger_allocations;
create policy platform_ledger_allocations_read on public.platform_ledger_allocations
  for select to authenticated using (
    exists (
      select 1 from public.platform_ledger l
       where l.id = ledger_id
         and (
           l.payer_user_id = auth.uid()
           or (l.org_id is not null and public.is_org_member(l.org_id))
         )
    )
  );

revoke insert, update, delete on public.platform_revenue_beneficiaries from anon, authenticated;
revoke all on public.platform_revenue_rules from anon, authenticated;
revoke insert, update, delete on public.platform_ledger_allocations from anon, authenticated;

insert into public.platform_revenue_beneficiaries
  (beneficiary_key,display_name,legal_name,kind)
values
  ('mccluster-corp','McCluster Corp','McCluster Corp','business'),
  ('whip-equipped','Whip Equipped','Whip Equipped','product')
on conflict (beneficiary_key) do update set
  display_name=excluded.display_name,
  legal_name=excluded.legal_name,
  kind=excluded.kind,
  updated_at=now();

-- Commercial terms:
--   customer/payer side: 3% McCluster Corp platform fee
--   operator/payee side (network): 3% Whip Equipped fee
--   white label: $333 implementation + $33/mo, operator transaction fee = 0%
update public.platform_fee_policies p
set payer_fee_bps = 300,
    payee_fee_bps = 300,
    white_label_payee_fee_bps = 0,
    white_label_build_fee_cents = 33300,
    white_label_subscription_cents = 3300,
    updated_at = now()
from public.platform_apps a
where p.app_id = a.id
  and a.app_key in ('whip-rider-web','whip-rider-ios','whip-rentals-web','whip-rentals-ios')
  and p.policy_key = 'whip-network';

-- McCluster Corp owns the customer-side service fee for the life of the
-- McCluster-powered transaction rail. No end date is intentionally supplied.
insert into public.platform_revenue_rules
  (app_id,org_id,policy_key,component,beneficiary_key,share_bps,effective_at,ends_at)
select a.id,null,'whip-network','payer_fee','mccluster-corp',10000,now(),null
from public.platform_apps a
where a.app_key in ('whip-rider-web','whip-rider-ios','whip-rentals-web','whip-rentals-ios')
and not exists (
  select 1 from public.platform_revenue_rules r
   where r.app_id=a.id and r.org_id is null and r.policy_key='whip-network'
     and r.component='payer_fee' and r.beneficiary_key='mccluster-corp' and r.ends_at is null
);

-- Whip Equipped owns the product-side network fee.
insert into public.platform_revenue_rules
  (app_id,org_id,policy_key,component,beneficiary_key,share_bps,effective_at,ends_at)
select a.id,null,'whip-network','payee_fee','whip-equipped',10000,now(),null
from public.platform_apps a
where a.app_key in ('whip-rider-web','whip-rider-ios','whip-rentals-web','whip-rentals-ios')
and not exists (
  select 1 from public.platform_revenue_rules r
   where r.app_id=a.id and r.org_id is null and r.policy_key='whip-network'
     and r.component='payee_fee' and r.beneficiary_key='whip-equipped' and r.ends_at is null
);

-- White-label implementation and recurring platform charges belong to the
-- Whip Equipped product business by default. They can later be internally
-- reallocated without changing customer pricing.
insert into public.platform_revenue_rules
  (app_id,org_id,policy_key,component,beneficiary_key,share_bps,effective_at,ends_at)
select a.id,null,'whip-network',c.component,'whip-equipped',10000,now(),null
from public.platform_apps a
cross join (values ('white_label_build_fee'),('white_label_subscription')) as c(component)
where a.app_key in ('whip-rider-web','whip-rider-ios','whip-rentals-web','whip-rentals-ios')
and not exists (
  select 1 from public.platform_revenue_rules r
   where r.app_id=a.id and r.org_id is null and r.policy_key='whip-network'
     and r.component=c.component and r.beneficiary_key='whip-equipped' and r.ends_at is null
);
