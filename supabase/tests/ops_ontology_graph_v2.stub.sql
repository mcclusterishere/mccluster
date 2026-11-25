-- Stub of production's state that supabase/pending/20261125010000_ops_ontology_graph_v2.sql needs, for a disposable
-- database only. Column lists copy the replay definitions (replay_migrations/0001_crm, 0007_offerings,
-- 0011_activation_sprints, 0047_control_authority_core, 0055_client_connect, 0065_outreach_engine_core,
-- 20260908213000/20260908213200 equity_uprise, migrations/20261005044012 and 20261005075808 work records).
-- Foreign keys to tables the graph does not read (eu_initiatives, eu_artifacts, eu_music_works, m_people,
-- out_sender_identities) are dropped. Apply order: this file, then migrations/20260919053445_operational_ontology_v1.sql,
-- then the pending file.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $roles$;

create schema if not exists auth;
create schema if not exists private;
create table if not exists auth.users (id uuid primary key);

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null default 'tenant',
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.platform_apps (
  id uuid primary key default gen_random_uuid(),
  app_key text not null unique, name text not null, product_family text, kind text, bundle_id text, public_url text,
  oauth_client_id text, oauth_redirect_uris text[], settings jsonb not null default '{}'::jsonb,
  enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.control_capabilities (capability text primary key, description text, risk text);
create table public.control_role_capabilities (role text, capability text, allowed boolean, primary key (role, capability));
create table public.control_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  capability text not null references public.control_capabilities(capability),
  resource_type text not null, resource_id text not null, request_hash text not null, reason text,
  state text not null default 'pending' check (state in ('pending','approved','denied','expired')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), decided_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 minutes'
);

create table public.out_companies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null, domain text, kind text not null default 'nonprofit', city text, region text,
  source text not null default 'manual', status text not null default 'new', notes text,
  created_at timestamptz not null default now()
);
create table public.out_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  company_id uuid references public.out_companies(id) on delete set null,
  email text not null, name text, title text, consent text not null default 'none', consent_source text, consent_at timestamptz,
  unsub_token uuid not null default gen_random_uuid(), created_at timestamptz not null default now()
);
create table public.out_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null, sender_id uuid not null, subject text not null, body_text text not null, body_html text,
  audience jsonb not null default '{}'::jsonb, audience_kind text not null default 'warm', status text not null default 'draft',
  throttle_per_hour integer not null default 60, created_by uuid, approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(), name text not null, email text not null, want text not null default '',
  note text not null default '', page text not null default '', source text not null default 'direct', medium text,
  campaign text, gclid text, status text not null default 'new',
  org_id uuid references public.orgs(id) on delete set null,
  company_id uuid references public.out_companies(id) on delete set null
);
create table public.offerings (
  id uuid primary key default gen_random_uuid(), slug text not null unique, site_id text not null, brand_id text not null,
  legal_entity_id text not null, offering_type text not null, revenue_type text not null, title text not null,
  short_description text, full_description text, price numeric, currency text not null default 'usd',
  price_type text not null default 'fixed', custom_min numeric, custom_max numeric,
  payment_provider text not null default 'stripe', payment_account_reference text not null default 'mccluster-primary',
  fulfillment_type text not null, inventory_policy text not null default 'unlimited', primary_action text not null default 'buy',
  status text not null default 'draft', campaign_namespace text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.engagements (
  id uuid primary key default gen_random_uuid(), client_name text not null, client_email text, site_slug text,
  offer_id text not null default 'anti-social', mode text not null default 'm', started_on date not null default current_date,
  free_until date generated always as (started_on + interval '1 month') stored,
  decision text not null default 'undecided', decided_at timestamptz, note text, created_at timestamptz not null default now()
);
create table public.work_relationships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null, relationship_type text not null default 'client', state text not null default 'active',
  company_id uuid references public.out_companies(id) on delete set null,
  contact_id uuid references public.out_contacts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  owner_id uuid, started_at timestamptz, ended_at timestamptz, notes text, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  company_id uuid references public.out_companies(id) on delete set null,
  title text not null, state text not null default 'open', amount_cents integer, currency text not null default 'usd',
  items jsonb not null default '[]'::jsonb, source_table text, source_id text, placed_at timestamptz not null default now(),
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.work_bookings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  company_id uuid references public.out_companies(id) on delete set null,
  title text not null, state text not null default 'proposed', starts_at timestamptz, ends_at timestamptz,
  location text, note text, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.work_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null, detail text, state text not null default 'open', assignee uuid, due_at timestamptz,
  related_type text, related_id uuid, created_by uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), completed_at timestamptz
);
create table public.work_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null, state text not null default 'planned', summary text,
  company_id uuid references public.out_companies(id) on delete set null,
  relationship_id uuid references public.work_relationships(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  order_id uuid references public.work_orders(id) on delete set null,
  owner_id uuid, starts_at timestamptz, due_at timestamptz, budget_cents integer, currency text not null default 'usd',
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.work_deliverables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.work_projects(id) on delete cascade,
  title text not null, kind text not null default 'other', state text not null default 'planned',
  approval_state text not null default 'not_requested', artifact_url text, media_asset_id uuid, due_at timestamptz,
  delivered_at timestamptz, approved_at timestamptz, approved_by uuid, note text, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.work_renewals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null, state text not null default 'upcoming', cadence text not null default 'annual',
  company_id uuid references public.out_companies(id) on delete set null,
  relationship_id uuid references public.work_relationships(id) on delete set null,
  project_id uuid references public.work_projects(id) on delete set null,
  order_id uuid references public.work_orders(id) on delete set null,
  amount_cents integer, currency text not null default 'usd', renews_at timestamptz, last_renewed_at timestamptz,
  source_table text, source_id text, note text, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.work_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null, state text not null default 'due', amount_cents integer not null, currency text not null default 'usd',
  provider text not null default 'manual', provider_reference text, verification text not null default 'owner_recorded',
  company_id uuid references public.out_companies(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  order_id uuid references public.work_orders(id) on delete set null,
  project_id uuid references public.work_projects(id) on delete set null,
  renewal_id uuid references public.work_renewals(id) on delete set null,
  due_at timestamptz, paid_at timestamptz, note text, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.eu_meetings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid, title text not null, meeting_type text not null default 'stakeholder',
  status text not null default 'requested', starts_at timestamptz, ends_at timestamptz,
  timezone text not null default 'America/New_York', provider text not null default '', external_event_id text,
  external_join_url text, agenda text not null default '', prep_brief jsonb not null default '{}'::jsonb,
  notes text not null default '', transcript_ref jsonb not null default '{}'::jsonb, summary jsonb not null default '{}'::jsonb,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.eu_releases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid, artifact_id uuid, title text not null, artist text not null default '', upc text not null default '',
  release_type text not null default 'single', release_date date, label text not null default 'McCluster Corp',
  territories text[] not null default array['Worldwide'], artwork_ref jsonb not null default '{}'::jsonb,
  status text not null default 'draft', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.eu_recordings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid, work_id uuid, artifact_id uuid, title text not null, version_title text not null default '',
  artist text not null default '', featured_artists jsonb not null default '[]'::jsonb, isrc text not null default '',
  duration_ms integer, recording_year integer, master_owner text not null default '', p_line text not null default '',
  c_line text not null default '', language text not null default 'en', explicit boolean not null default false,
  audio_ref jsonb not null default '{}'::jsonb, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.eu_release_tracks (
  release_id uuid not null references public.eu_releases(id) on delete cascade,
  recording_id uuid not null references public.eu_recordings(id) on delete restrict,
  disc_no integer not null default 1, track_no integer not null,
  primary key (release_id, disc_no, track_no), unique (release_id, recording_id)
);
