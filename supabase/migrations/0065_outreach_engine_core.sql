-- ============================================================
-- OUTREACH ENGINE CORE — recovered repository history
--
-- Production migration 20260824222918 (outreach_engine) is present in the
-- live Supabase migration ledger but the SQL file was absent from this repo.
-- Equity Uprise's canonical stakeholder graph intentionally references this
-- system (`out_contacts`, `out_recipients`, `out_events`), so a clean reset
-- cannot reach the EU migrations without restoring the source-of-truth DDL.
--
-- This migration is reconstructed from the live production schema. It is
-- idempotent: on production the tables/indexes already exist; on a fresh
-- database it recreates the outreach substrate before the EU timestamped
-- migrations run.
-- ============================================================

create table if not exists public.out_companies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  domain text,
  kind text not null default 'nonprofit',
  city text,
  region text,
  source text not null default 'manual',
  status text not null default 'new',
  notes text,
  created_at timestamptz not null default now(),
  constraint out_companies_kind_ck check (kind in ('nonprofit','brand','agency','government','media','other')),
  constraint out_companies_source_ck check (source in ('inquiry','import','research','manual')),
  constraint out_companies_status_ck check (status in ('new','contacted','replied','partner','declined'))
);

create unique index if not exists out_companies_org_domain
  on public.out_companies(org_id, lower(domain)) where domain is not null;

create table if not exists public.out_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  company_id uuid references public.out_companies(id) on delete set null,
  email text not null,
  name text,
  title text,
  consent text not null default 'none',
  consent_source text,
  consent_at timestamptz,
  unsub_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  constraint out_contacts_consent_ck check (consent in ('none','inquired','opted_in'))
);

create unique index if not exists out_contacts_org_email
  on public.out_contacts(org_id, lower(email));
create unique index if not exists out_contacts_unsub
  on public.out_contacts(unsub_token);

create table if not exists public.out_sender_identities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  label text not null,
  from_name text not null,
  from_email text not null,
  reply_to text,
  postal_address text not null,
  provider text not null default 'resend',
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists out_sender_org_email
  on public.out_sender_identities(org_id, lower(from_email));

create table if not exists public.out_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  sender_id uuid not null references public.out_sender_identities(id) on delete restrict,
  subject text not null,
  body_text text not null,
  body_html text,
  audience jsonb not null default '{}'::jsonb,
  audience_kind text not null default 'warm',
  status text not null default 'draft',
  throttle_per_hour integer not null default 60,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint out_campaigns_kind_ck check (audience_kind in ('warm','cold')),
  constraint out_campaigns_status_ck check (status in ('draft','approved','sending','paused','done','failed')),
  constraint out_campaigns_throttle_ck check (throttle_per_hour between 1 and 2000)
);

-- Production migration 20260904210053 enforced one campaign per Gmail source
-- message. Include it here because that production-only migration is also
-- absent from the repository and the index is safe/idempotent.
create unique index if not exists out_campaigns_gmail_message_id_unique
  on public.out_campaigns ((audience ->> 'gmail_message_id'))
  where nullif(audience ->> 'gmail_message_id', '') is not null;

create table if not exists public.out_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.out_campaigns(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  contact_id uuid references public.out_contacts(id) on delete set null,
  address text not null,
  state text not null default 'queued',
  skip_reason text,
  provider_id text,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint out_recipients_state_ck check (state in ('queued','sent','failed','skipped'))
);

create unique index if not exists out_recipients_once
  on public.out_recipients(campaign_id, lower(address));
create index if not exists out_recipients_work
  on public.out_recipients(campaign_id, state);

create table if not exists public.out_events (
  id bigserial primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  recipient_id uuid references public.out_recipients(id) on delete cascade,
  address text not null,
  type text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(),
  constraint out_events_type_ck check (type in ('sent','delivered','opened','clicked','bounced','complained','unsubscribed','failed'))
);

create index if not exists out_events_org_at
  on public.out_events(org_id, at desc);

create table if not exists public.out_suppressions (
  org_id uuid not null references public.orgs(id) on delete cascade,
  address text not null,
  reason text not null,
  detail text,
  at timestamptz not null default now(),
  primary key (org_id, address),
  constraint out_suppressions_reason_ck check (reason in ('unsubscribed','bounced','complained','manual'))
);

create or replace function public.out_lower_address()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  new.address := lower(trim(new.address));
  return new;
end $function$;

revoke all on function public.out_lower_address() from public, anon, authenticated;
grant execute on function public.out_lower_address() to service_role;

drop trigger if exists out_recipients_lower on public.out_recipients;
create trigger out_recipients_lower
before insert or update on public.out_recipients
for each row execute function public.out_lower_address();

drop trigger if exists out_suppressions_lower on public.out_suppressions;
create trigger out_suppressions_lower
before insert or update on public.out_suppressions
for each row execute function public.out_lower_address();

alter table public.out_companies enable row level security;
alter table public.out_contacts enable row level security;
alter table public.out_sender_identities enable row level security;
alter table public.out_campaigns enable row level security;
alter table public.out_recipients enable row level security;
alter table public.out_events enable row level security;
alter table public.out_suppressions enable row level security;

drop policy if exists out_companies_org on public.out_companies;
create policy out_companies_org on public.out_companies for all
using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

drop policy if exists out_contacts_org on public.out_contacts;
create policy out_contacts_org on public.out_contacts for all
using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

drop policy if exists out_sender_read on public.out_sender_identities;
create policy out_sender_read on public.out_sender_identities for select
using (private.is_org_member(org_id));
drop policy if exists out_sender_owner on public.out_sender_identities;
create policy out_sender_owner on public.out_sender_identities for all
using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));

drop policy if exists out_campaigns_org on public.out_campaigns;
create policy out_campaigns_org on public.out_campaigns for all
using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

drop policy if exists out_recipients_read on public.out_recipients;
create policy out_recipients_read on public.out_recipients for select
using (private.is_org_member(org_id));

drop policy if exists out_events_read on public.out_events;
create policy out_events_read on public.out_events for select
using (private.is_org_member(org_id));

drop policy if exists out_suppressions_read on public.out_suppressions;
create policy out_suppressions_read on public.out_suppressions for select
using (private.is_org_member(org_id));
drop policy if exists out_suppressions_add on public.out_suppressions;
create policy out_suppressions_add on public.out_suppressions for insert
with check (private.is_org_member(org_id));

-- Verify the foreign-key targets Equity Uprise depends on.
do $$
begin
  if to_regclass('public.out_contacts') is null
     or to_regclass('public.out_recipients') is null
     or to_regclass('public.out_events') is null then
    raise exception 'outreach engine recovery incomplete; Equity Uprise FK targets are missing';
  end if;
end $$;
