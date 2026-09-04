-- ============================================================
-- CLIENT CONNECT — one Stripe connected account per client org.
--
-- The whip rail (/api/operators/{tenant}/stripe/*) already proved the
-- mechanics: Express accounts, direct charges, application fees, and
-- signature-verified webhooks. It is bound to whip `tenants`, so no other
-- client can reach it. This lifts the same rail onto `orgs`, which is where
-- client tenancy actually lives.
--
-- `offerings.payment_account_reference` already names which account takes the
-- money — every row says 'mccluster-primary' today. This table is what that
-- name resolves to. Pointing a client's offerings at the client's own Stripe
-- account therefore becomes a data change, not a code change.
--
-- Keyed on (org_id, livemode) on purpose: a test account and a live account
-- for the same client must coexist, because the flow is proved in test mode
-- before a real card is ever charged.
-- ============================================================

create table if not exists public.org_stripe_accounts (
  org_id            uuid not null references public.orgs(id) on delete cascade,
  livemode          boolean not null default false,
  account_reference text not null,
  stripe_account_id text,
  charges_enabled   boolean not null default false,
  payouts_enabled   boolean not null default false,
  details_submitted boolean not null default false,
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started','onboarding','restricted','ready','disabled')),

  -- Stripe's own requirements blob, stored verbatim. The desk shows a client
  -- exactly what Stripe is waiting on rather than paraphrasing it. Today the
  -- McCluster platform account itself is held up on business_profile.url;
  -- without this column that fact is invisible outside the Stripe dashboard.
  requirements      jsonb not null default '{}'::jsonb,

  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  primary key (org_id, livemode),
  unique (account_reference, livemode),
  unique (stripe_account_id)
);

comment on table public.org_stripe_accounts is
  'Stripe connected account per client org, per mode. Resolves offerings.payment_account_reference to a real acct_ id.';
comment on column public.org_stripe_accounts.onboarding_status is
  'not_started -> onboarding -> ready. restricted/disabled mirror a Stripe account that can no longer charge.';

create index if not exists org_stripe_accounts_ref_idx
  on public.org_stripe_accounts(account_reference, livemode);

alter table public.org_stripe_accounts enable row level security;

-- A client sees their own rail and nothing else. There is no cross-tenant
-- read here: an org member is scoped to their org by is_org_member.
drop policy if exists org_stripe_accounts_member_read on public.org_stripe_accounts;
create policy org_stripe_accounts_member_read on public.org_stripe_accounts
  for select using (public.is_org_member(org_id));

-- The rail is written by the Worker under the service role, never from a
-- browser. A client cannot mark their own account charges_enabled.
revoke insert, update, delete on public.org_stripe_accounts from anon, authenticated;

-- ============================================================
-- LEADS BECOME TENANT-SCOPED
--
-- `leads` is already the CRM rail: anyone may drop one in, only the owner
-- reads the pile back. Esmer's Book tab is inquiry-first, so its inquiries
-- belong in that same pile — not in a second bookings table in a satellite
-- repo. The one thing missing is which client the lead is for.
--
-- Null org_id keeps every existing McCluster lead exactly where it was.
-- ============================================================

alter table public.leads
  add column if not exists org_id uuid references public.orgs(id) on delete set null;

create index if not exists leads_org_idx on public.leads(org_id, at desc);

comment on column public.leads.org_id is
  'Client org this inquiry belongs to. Null means it is McCluster''s own lead, which is every row written before this migration.';

-- The owner keeps the whole pipeline (policy leads_desk, unchanged). This
-- adds the client: a member of an org reads that org''s inquiries only.
drop policy if exists leads_org_read on public.leads;
create policy leads_org_read on public.leads
  for select to authenticated
  using (org_id is not null and public.is_org_member(org_id));
