-- Control - Work post-sale graph: relationships, service projects,
-- deliverables, renewals and the owner payment ledger.
-- Same rules as 20261005044012_control_work_records_v1: org_id on every row,
-- no browser access, writes only through the audited /v1/work/{kind} routes.
-- Companies stay public.out_companies; people stay leads / out_contacts.
-- work_payments is the service-payment ledger: owner_recorded unless a
-- provider reconciler verifies it. public.payments remains Whip's ledger.

create table if not exists public.work_relationships (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  title             text not null check (length(btrim(title)) between 1 and 300),
  relationship_type text not null default 'client'
                    check (relationship_type in ('client', 'prospect', 'partner', 'sponsor', 'vendor', 'collaborator', 'other')),
  state             text not null default 'active' check (state in ('active', 'paused', 'ended')),
  company_id        uuid references public.out_companies(id) on delete set null,
  contact_id        uuid references public.out_contacts(id) on delete set null,
  lead_id           uuid references public.leads(id) on delete set null,
  owner_id          uuid,
  started_at        timestamptz,
  ended_at          timestamptz,
  notes             text check (notes is null or length(notes) <= 4000),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (company_id is not null or contact_id is not null or lead_id is not null),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

create table if not exists public.work_projects (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  title            text not null check (length(btrim(title)) between 1 and 300),
  state            text not null default 'planned'
                   check (state in ('planned', 'active', 'on_hold', 'delivered', 'closed', 'cancelled')),
  summary          text check (summary is null or length(summary) <= 4000),
  company_id       uuid references public.out_companies(id) on delete set null,
  relationship_id  uuid references public.work_relationships(id) on delete set null,
  lead_id          uuid references public.leads(id) on delete set null,
  order_id         uuid references public.work_orders(id) on delete set null,
  owner_id         uuid,
  starts_at        timestamptz,
  due_at           timestamptz,
  budget_cents     integer check (budget_cents is null or budget_cents >= 0),
  currency         text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (due_at is null or starts_at is null or due_at >= starts_at)
);

create table if not exists public.work_deliverables (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  project_id      uuid not null references public.work_projects(id) on delete cascade,
  title           text not null check (length(btrim(title)) between 1 and 300),
  kind            text not null default 'other'
                  check (kind in ('file', 'site', 'media', 'report', 'campaign', 'other')),
  state           text not null default 'planned'
                  check (state in ('planned', 'in_progress', 'delivered', 'accepted', 'rejected')),
  approval_state  text not null default 'not_requested'
                  check (approval_state in ('not_requested', 'pending', 'approved', 'changes_requested')),
  artifact_url    text check (artifact_url is null or (artifact_url ~ '^https://' and length(artifact_url) <= 2000)),
  media_asset_id  uuid,
  due_at          timestamptz,
  delivered_at    timestamptz,
  approved_at     timestamptz,
  approved_by     uuid,
  note            text check (note is null or length(note) <= 4000),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((approval_state = 'approved') = (approved_at is not null))
);

create table if not exists public.work_renewals (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  title             text not null check (length(btrim(title)) between 1 and 300),
  state             text not null default 'upcoming'
                    check (state in ('upcoming', 'renewed', 'lapsed', 'cancelled')),
  cadence           text not null default 'annual'
                    check (cadence in ('monthly', 'quarterly', 'annual', 'one_time', 'custom')),
  company_id        uuid references public.out_companies(id) on delete set null,
  relationship_id   uuid references public.work_relationships(id) on delete set null,
  project_id        uuid references public.work_projects(id) on delete set null,
  order_id          uuid references public.work_orders(id) on delete set null,
  amount_cents      integer check (amount_cents is null or amount_cents >= 0),
  currency          text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  renews_at         timestamptz,
  last_renewed_at   timestamptz,
  source_table      text check (source_table in ('site_accounts', 'api_subscriptions', 'offerings')),
  source_id         text check (source_id is null or length(source_id) <= 200),
  note              text check (note is null or length(note) <= 4000),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((source_table is null) = (source_id is null))
);

create table if not exists public.work_payments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  title               text not null check (length(btrim(title)) between 1 and 300),
  state               text not null default 'due'
                      check (state in ('due', 'pending', 'paid', 'failed', 'refunded', 'cancelled')),
  amount_cents        integer not null check (amount_cents >= 0),
  currency            text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  provider            text not null default 'manual' check (provider in ('stripe', 'square', 'manual', 'other')),
  provider_reference  text check (provider_reference is null or length(provider_reference) <= 200),
  verification        text not null default 'owner_recorded'
                      check (verification in ('owner_recorded', 'provider_verified')),
  company_id          uuid references public.out_companies(id) on delete set null,
  lead_id             uuid references public.leads(id) on delete set null,
  order_id            uuid references public.work_orders(id) on delete set null,
  project_id          uuid references public.work_projects(id) on delete set null,
  renewal_id          uuid references public.work_renewals(id) on delete set null,
  due_at              timestamptz,
  paid_at             timestamptz,
  note                text check (note is null or length(note) <= 4000),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (state <> 'paid' or paid_at is not null),
  check (verification = 'owner_recorded' or (provider in ('stripe', 'square') and provider_reference is not null))
);
