-- Equity Uprise Policy OS — canonical policy/research/relationship graph.
-- Additive to 0017/0018. Reuses M identity, org tenancy, inbox/outreach and
-- the existing control plane rather than creating parallel systems.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ---------------------------------------------------------------------
-- shared helpers (private: never exposed through PostgREST)
-- ---------------------------------------------------------------------
create or replace function private.eu_touch_updated_at()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.eu_touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Initiatives: the living policy docket
-- ---------------------------------------------------------------------
create table if not exists public.eu_initiatives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  slug text not null,
  title text not null,
  short_title text not null default '',
  summary text not null default '',
  objective text not null default '',
  jurisdiction text not null default '',
  geography jsonb not null default '{}'::jsonb,
  topic_slugs text[] not null default '{}',
  stage text not null default 'research'
    check (stage in ('idea','research','drafting','stakeholder-review','submitted','under-consideration','adopted','closed','paused')),
  status text not null default 'active'
    check (status in ('active','paused','completed','archived')),
  visibility text not null default 'public'
    check (visibility in ('public','unlisted','private')),
  current_ask text not null default '',
  next_milestone text not null default '',
  next_milestone_at timestamptz,
  target_outcome text not null default '',
  owner_m_uid uuid references public.m_people(id) on delete set null,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);
create index if not exists eu_initiatives_stage_idx on public.eu_initiatives(org_id, stage, status);
create index if not exists eu_initiatives_topics_idx on public.eu_initiatives using gin(topic_slugs);
drop trigger if exists eu_initiatives_touch on public.eu_initiatives;
create trigger eu_initiatives_touch before update on public.eu_initiatives
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_initiative_members (
  initiative_id uuid not null references public.eu_initiatives(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  role text not null default 'contributor'
    check (role in ('owner','lead','editor','researcher','fellow','advisor','observer')),
  permissions jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('invited','active','inactive','removed')),
  joined_at timestamptz not null default now(),
  primary key (initiative_id, m_uid)
);
create index if not exists eu_initiative_members_person_idx on public.eu_initiative_members(m_uid, status);

create table if not exists public.eu_initiative_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid not null references public.eu_initiatives(id) on delete cascade,
  update_type text not null default 'progress'
    check (update_type in ('progress','milestone','hearing','filing','meeting','research','publication','correction','decision','note')),
  title text not null default '',
  body text not null default '',
  visibility text not null default 'public' check (visibility in ('public','internal','private')),
  source_event_id bigint,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists eu_initiative_updates_idx on public.eu_initiative_updates(initiative_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Canonical stakeholders + initiative relationship graph
-- ---------------------------------------------------------------------
create table if not exists public.eu_stakeholder_orgs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  domain text,
  kind text not null default 'other',
  jurisdiction text not null default '',
  website text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eu_stakeholder_orgs_domain_idx
  on public.eu_stakeholder_orgs(org_id, lower(domain)) where domain is not null and domain <> '';
drop trigger if exists eu_stakeholder_orgs_touch on public.eu_stakeholder_orgs;
create trigger eu_stakeholder_orgs_touch before update on public.eu_stakeholder_orgs
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_stakeholders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  m_uid uuid references public.m_people(id) on delete set null,
  eu_profile_id uuid references public.eu_profiles(id) on delete set null,
  inbox_contact_id uuid references public.inbox_contacts(id) on delete set null,
  out_contact_id uuid references public.out_contacts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  stakeholder_org_id uuid references public.eu_stakeholder_orgs(id) on delete set null,
  name text not null default '',
  title text not null default '',
  email text not null default '',
  phone text not null default '',
  city text not null default '',
  region text not null default '',
  stakeholder_types text[] not null default '{}',
  expertise_tags text[] not null default '{}',
  source text not null default 'manual',
  consent jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eu_stakeholders_email_idx on public.eu_stakeholders(org_id, lower(email));
create index if not exists eu_stakeholders_types_idx on public.eu_stakeholders using gin(stakeholder_types);
create index if not exists eu_stakeholders_expertise_idx on public.eu_stakeholders using gin(expertise_tags);
drop trigger if exists eu_stakeholders_touch on public.eu_stakeholders;
create trigger eu_stakeholders_touch before update on public.eu_stakeholders
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_stakeholder_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid not null references public.eu_initiatives(id) on delete cascade,
  stakeholder_id uuid not null references public.eu_stakeholders(id) on delete cascade,
  role text not null default 'stakeholder',
  stance text not null default 'unknown'
    check (stance in ('support','conditional-support','neutral','unknown','concerned','oppose','mixed')),
  contribution_types text[] not null default '{}',
  stage text not null default 'identified'
    check (stage in ('identified','researching','queued','contacted','replied','engaged','meeting-requested','meeting-scheduled','contributing','committed','inactive','declined','closed')),
  stage_source text not null default 'system' check (stage_source in ('system','human')),
  stage_reason text not null default '',
  relationship_score numeric(6,2) not null default 0,
  last_contact_at timestamptz,
  last_reply_at timestamptz,
  next_action text not null default '',
  next_action_at timestamptz,
  assigned_m_uid uuid references public.m_people(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (initiative_id, stakeholder_id)
);
create index if not exists eu_stakeholder_links_pipeline_idx
  on public.eu_stakeholder_links(initiative_id, stage, next_action_at);
drop trigger if exists eu_stakeholder_links_touch on public.eu_stakeholder_links;
create trigger eu_stakeholder_links_touch before update on public.eu_stakeholder_links
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_communications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  stakeholder_id uuid references public.eu_stakeholders(id) on delete set null,
  stakeholder_link_id uuid references public.eu_stakeholder_links(id) on delete set null,
  channel text not null,
  provider text not null default '',
  direction text not null check (direction in ('in','out')),
  external_thread_id text,
  external_message_id text,
  inbox_conversation_id uuid references public.inbox_conversations(id) on delete set null,
  out_recipient_id uuid references public.out_recipients(id) on delete set null,
  from_address text not null default '',
  to_addresses jsonb not null default '[]'::jsonb,
  subject text not null default '',
  body_excerpt text not null default '',
  classification jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  raw_ref jsonb not null default '{}'::jsonb,
  unique (org_id, provider, external_message_id)
);
create index if not exists eu_communications_relation_idx
  on public.eu_communications(initiative_id, stakeholder_id, occurred_at desc);
create index if not exists eu_communications_thread_idx
  on public.eu_communications(org_id, provider, external_thread_id);

-- ---------------------------------------------------------------------
-- 3. Meetings + commitments: convert conversation into institutional memory
-- ---------------------------------------------------------------------
create table if not exists public.eu_meetings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  title text not null,
  meeting_type text not null default 'stakeholder'
    check (meeting_type in ('stakeholder','fellowship-interview','research','government','partner','internal','public')),
  status text not null default 'requested'
    check (status in ('requested','tentative','confirmed','completed','cancelled','declined','no-show')),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/New_York',
  provider text not null default '',
  external_event_id text,
  external_join_url text,
  agenda text not null default '',
  prep_brief jsonb not null default '{}'::jsonb,
  notes text not null default '',
  transcript_ref jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eu_meetings_calendar_idx on public.eu_meetings(org_id, starts_at, status);
drop trigger if exists eu_meetings_touch on public.eu_meetings;
create trigger eu_meetings_touch before update on public.eu_meetings
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_meeting_participants (
  meeting_id uuid not null references public.eu_meetings(id) on delete cascade,
  stakeholder_id uuid references public.eu_stakeholders(id) on delete set null,
  m_uid uuid references public.m_people(id) on delete set null,
  email text not null default '',
  name text not null default '',
  participant_role text not null default 'attendee',
  response_status text not null default 'needsAction',
  primary key (meeting_id, email)
);

create table if not exists public.eu_commitments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete cascade,
  meeting_id uuid references public.eu_meetings(id) on delete set null,
  stakeholder_id uuid references public.eu_stakeholders(id) on delete set null,
  owner_m_uid uuid references public.m_people(id) on delete set null,
  description text not null,
  direction text not null default 'incoming' check (direction in ('incoming','outgoing','mutual','internal')),
  status text not null default 'open' check (status in ('open','done','cancelled','overdue')),
  due_at timestamptz,
  source_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists eu_commitments_due_idx on public.eu_commitments(org_id, status, due_at);

-- ---------------------------------------------------------------------
-- 4. Fellowship applications + interview queue
-- ---------------------------------------------------------------------
create table if not exists public.eu_fellowship_applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  m_uid uuid references public.m_people(id) on delete set null,
  stakeholder_id uuid references public.eu_stakeholders(id) on delete set null,
  cohort text not null default '',
  application_year integer not null default extract(year from now())::integer,
  applicant_name text not null,
  preferred_name text not null default '',
  email text not null,
  phone text not null default '',
  location text not null default '',
  occupation text not null default '',
  policy_interests text[] not null default '{}',
  initiative_ids uuid[] not null default '{}',
  skills text[] not null default '{}',
  availability jsonb not null default '{}'::jsonb,
  responses jsonb not null default '{}'::jsonb,
  work_samples jsonb not null default '[]'::jsonb,
  consent jsonb not null default '{}'::jsonb,
  stage text not null default 'submitted'
    check (stage in ('draft','submitted','screening','interview-requested','interview-scheduled','interviewed','accepted','waitlisted','declined','withdrawn','onboarded')),
  score jsonb not null default '{}'::jsonb,
  reviewer_notes text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eu_fellowship_applications_stage_idx
  on public.eu_fellowship_applications(org_id, stage, created_at desc);
create index if not exists eu_fellowship_applications_email_idx
  on public.eu_fellowship_applications(org_id, lower(email));
drop trigger if exists eu_fellowship_applications_touch on public.eu_fellowship_applications;
create trigger eu_fellowship_applications_touch before update on public.eu_fellowship_applications
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_calendar_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  provider text not null default 'google-calendar',
  calendar_external_id text not null default 'primary',
  timezone text not null default 'America/New_York',
  interview_minutes integer not null default 30 check (interview_minutes between 10 and 180),
  buffer_before_minutes integer not null default 15 check (buffer_before_minutes between 0 and 180),
  buffer_after_minutes integer not null default 15 check (buffer_after_minutes between 0 and 180),
  minimum_notice_minutes integer not null default 1440 check (minimum_notice_minutes >= 0),
  booking_horizon_days integer not null default 30 check (booking_horizon_days between 1 and 365),
  allowed_windows jsonb not null default '{}'::jsonb,
  blackout_rules jsonb not null default '{}'::jsonb,
  auto_confirm boolean not null default false,
  reminder_minutes integer[] not null default array[60,30],
  updated_at timestamptz not null default now()
);

create table if not exists public.eu_interview_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  application_id uuid references public.eu_fellowship_applications(id) on delete cascade,
  stakeholder_id uuid references public.eu_stakeholders(id) on delete set null,
  meeting_id uuid references public.eu_meetings(id) on delete set null,
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  timezone text not null default 'America/New_York',
  hold_expires_at timestamptz,
  state text not null default 'requested'
    check (state in ('requested','held','approved','declined','expired','conflict','confirmed','cancelled')),
  conflict_reason text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null
);
create index if not exists eu_interview_requests_queue_idx on public.eu_interview_requests(org_id, state, requested_start);

-- ---------------------------------------------------------------------
-- 5. Research workspace + evidence graph
-- ---------------------------------------------------------------------
create table if not exists public.eu_research_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  slug text not null,
  title text not null,
  abstract text not null default '',
  objective text not null default '',
  methodology text not null default '',
  status text not null default 'active'
    check (status in ('active','paused','review','complete','archived')),
  visibility text not null default 'internal' check (visibility in ('public','internal','private')),
  owner_m_uid uuid references public.m_people(id) on delete set null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);
drop trigger if exists eu_research_projects_touch on public.eu_research_projects;
create trigger eu_research_projects_touch before update on public.eu_research_projects
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_research_members (
  research_project_id uuid not null references public.eu_research_projects(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  role text not null default 'researcher'
    check (role in ('principal-investigator','editor','researcher','reviewer','contributor','observer')),
  permissions jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('invited','active','inactive','removed')),
  added_at timestamptz not null default now(),
  primary key (research_project_id, m_uid)
);

create table if not exists public.eu_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  research_project_id uuid not null references public.eu_research_projects(id) on delete cascade,
  source_type text not null default 'web',
  title text not null,
  authors jsonb not null default '[]'::jsonb,
  publisher text not null default '',
  published_at timestamptz,
  url text not null default '',
  canonical_url text not null default '',
  doi text not null default '',
  external_ids jsonb not null default '{}'::jsonb,
  snapshot_ref jsonb not null default '{}'::jsonb,
  sha256 text not null default '',
  citation jsonb not null default '{}'::jsonb,
  verification text not null default 'unverified'
    check (verification in ('unverified','retrieved','verified','superseded','broken')),
  superseded_by uuid references public.eu_sources(id) on delete set null,
  last_checked_at timestamptz,
  added_by_m_uid uuid references public.m_people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eu_sources_project_idx on public.eu_sources(research_project_id, verification, created_at desc);
create index if not exists eu_sources_doi_idx on public.eu_sources(lower(doi)) where doi <> '';
drop trigger if exists eu_sources_touch on public.eu_sources;
create trigger eu_sources_touch before update on public.eu_sources
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  research_project_id uuid not null references public.eu_research_projects(id) on delete cascade,
  section_key text not null default '',
  claim text not null,
  claim_type text not null default 'factual' check (claim_type in ('factual','analytic','recommendation','definition','estimate')),
  status text not null default 'draft' check (status in ('draft','supported','contested','approved','retired')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  sensitivity text not null default 'normal' check (sensitivity in ('normal','high','legal-review')),
  created_by_m_uid uuid references public.m_people(id) on delete set null,
  approved_by_m_uid uuid references public.m_people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eu_claims_project_idx on public.eu_claims(research_project_id, status);
drop trigger if exists eu_claims_touch on public.eu_claims;
create trigger eu_claims_touch before update on public.eu_claims
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_claim_evidence (
  claim_id uuid not null references public.eu_claims(id) on delete cascade,
  source_id uuid not null references public.eu_sources(id) on delete cascade,
  relation text not null default 'supports' check (relation in ('supports','contradicts','context','method')),
  locator text not null default '',
  excerpt text not null default '',
  note text not null default '',
  verified_by_m_uid uuid references public.m_people(id) on delete set null,
  verified_at timestamptz,
  primary key (claim_id, source_id, relation, locator)
);

create table if not exists public.eu_manuscripts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  research_project_id uuid not null references public.eu_research_projects(id) on delete cascade,
  title text not null,
  status text not null default 'draft'
    check (status in ('outline','draft','internal-review','stakeholder-review','final-review','approved','published','superseded')),
  current_revision integer not null default 0,
  style_profile jsonb not null default '{}'::jsonb,
  created_by_m_uid uuid references public.m_people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists eu_manuscripts_touch on public.eu_manuscripts;
create trigger eu_manuscripts_touch before update on public.eu_manuscripts
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_manuscript_sections (
  id uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references public.eu_manuscripts(id) on delete cascade,
  section_key text not null,
  parent_section_id uuid references public.eu_manuscript_sections(id) on delete cascade,
  ordinal numeric(10,3) not null default 0,
  heading text not null default '',
  body_markdown text not null default '',
  status text not null default 'draft' check (status in ('draft','assigned','in-review','changes-requested','approved')),
  assigned_m_uid uuid references public.m_people(id) on delete set null,
  last_editor_m_uid uuid references public.m_people(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (manuscript_id, section_key)
);

create table if not exists public.eu_section_revisions (
  id bigserial primary key,
  section_id uuid not null references public.eu_manuscript_sections(id) on delete cascade,
  revision_no integer not null,
  body_markdown text not null,
  heading text not null default '',
  change_summary text not null default '',
  created_by_m_uid uuid references public.m_people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (section_id, revision_no)
);

create table if not exists public.eu_review_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  manuscript_id uuid not null references public.eu_manuscripts(id) on delete cascade,
  section_id uuid references public.eu_manuscript_sections(id) on delete cascade,
  parent_id uuid references public.eu_review_comments(id) on delete cascade,
  author_m_uid uuid references public.m_people(id) on delete set null,
  body text not null,
  anchor jsonb not null default '{}'::jsonb,
  state text not null default 'open' check (state in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_m_uid uuid references public.m_people(id) on delete set null
);
create index if not exists eu_review_comments_manuscript_idx on public.eu_review_comments(manuscript_id, state, created_at);

-- ---------------------------------------------------------------------
-- 6. Immutable normalized event ledger: the source for automation state
-- ---------------------------------------------------------------------
create table if not exists public.eu_events (
  id bigserial primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  event_type text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  source_system text not null default 'equity-uprise',
  source_id text not null default '',
  actor_m_uid uuid references public.m_people(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  causation_event_id bigint references public.eu_events(id) on delete set null,
  correlation_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists eu_events_idempotency_idx
  on public.eu_events(org_id, idempotency_key) where idempotency_key is not null;
create index if not exists eu_events_timeline_idx on public.eu_events(initiative_id, occurred_at desc, id desc);
create index if not exists eu_events_type_idx on public.eu_events(org_id, event_type, occurred_at desc);

-- append-only: no update/delete policies are created below.

-- ---------------------------------------------------------------------
-- 7. Seed Equity Uprise as a first-class McCluster app + control capabilities
-- ---------------------------------------------------------------------
insert into public.platform_apps(app_key, name, product_family, kind, public_url)
values ('equity-uprise-web','Equity Uprise','equity-uprise','web','https://matthew.mccluster.org/equity-uprise.html')
on conflict (app_key) do update set
  name=excluded.name, product_family=excluded.product_family, kind=excluded.kind,
  public_url=excluded.public_url, updated_at=now();

insert into public.control_capabilities(capability, description, risk) values
  ('policy.read','Read Equity Uprise initiative and policy state','low'),
  ('policy.write','Create or modify policy initiatives and stakeholder state','medium'),
  ('research.read','Read internal research workspaces and evidence graphs','low'),
  ('research.write','Contribute sources, claims and manuscript revisions','medium'),
  ('research.review','Approve evidence, sections and research reviews','medium'),
  ('publication.publish','Publish a canonical Equity Uprise research record','high'),
  ('publication.distribute','Syndicate an approved publication to external repositories and channels','high'),
  ('government.submit','Submit an official filing, comment, testimony or policy packet to a government system','high'),
  ('calendar.schedule','Create or modify an external calendar event','high'),
  ('integration.manage','Connect, rotate or disconnect an external integration credential','high'),
  ('music.deliver','Deliver a music release or DDEX message to an external partner','high')
on conflict (capability) do update set description=excluded.description, risk=excluded.risk;

-- Owners/admins get all. Staff get read/write/review but not irreversible external actions.
insert into public.control_role_capabilities(role, capability, allowed)
select r.role, c.capability, true
from (values ('owner'),('admin')) r(role)
cross join (values
 ('policy.read'),('policy.write'),('research.read'),('research.write'),('research.review'),
 ('publication.publish'),('publication.distribute'),('government.submit'),('calendar.schedule'),
 ('integration.manage'),('music.deliver')) c(capability)
on conflict (role, capability) do update set allowed=true;

insert into public.control_role_capabilities(role, capability, allowed)
select 'staff', c, true from unnest(array[
 'policy.read','policy.write','research.read','research.write','research.review'
]) c
on conflict (role, capability) do update set allowed=true;

insert into public.control_role_capabilities(role, capability, allowed)
select 'viewer', c, true from unnest(array['policy.read','research.read']) c
on conflict (role, capability) do update set allowed=true;

-- ---------------------------------------------------------------------
-- 8. RLS. Public surfaces are explicit; PII/research mutation stays behind Edge Functions.
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array[
    'eu_initiatives','eu_initiative_members','eu_initiative_updates',
    'eu_stakeholder_orgs','eu_stakeholders','eu_stakeholder_links','eu_communications',
    'eu_meetings','eu_meeting_participants','eu_commitments',
    'eu_fellowship_applications','eu_calendar_settings','eu_interview_requests',
    'eu_research_projects','eu_research_members','eu_sources','eu_claims','eu_claim_evidence',
    'eu_manuscripts','eu_manuscript_sections','eu_section_revisions','eu_review_comments','eu_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Public initiative pages.
drop policy if exists eu_initiatives_public_read on public.eu_initiatives;
create policy eu_initiatives_public_read on public.eu_initiatives for select to anon, authenticated
using (visibility='public' or public.is_org_member(org_id));

drop policy if exists eu_updates_public_read on public.eu_initiative_updates;
create policy eu_updates_public_read on public.eu_initiative_updates for select to anon, authenticated
using (visibility='public' or public.is_org_member(org_id));

-- Initiative members see their own membership; org staff see all.
drop policy if exists eu_initiative_members_read on public.eu_initiative_members;
create policy eu_initiative_members_read on public.eu_initiative_members for select to authenticated
using (
  exists(select 1 from public.eu_initiatives i where i.id=initiative_id and public.is_org_member(i.org_id))
  or exists(select 1 from public.m_auth_user_links l where l.auth_user_id=auth.uid() and l.m_uid=eu_initiative_members.m_uid)
);

-- Sensitive operational tables: org staff only from browser; service role is the writer.
do $$ declare t text; begin
  foreach t in array array[
    'eu_stakeholder_orgs','eu_stakeholders','eu_stakeholder_links','eu_communications',
    'eu_meetings','eu_commitments','eu_calendar_settings','eu_interview_requests','eu_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_org_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))', t || '_org_read', t);
  end loop;
end $$;

-- eu_meeting_participants is the one operational table with no org_id of its
-- own: a participant row is identified by (meeting_id, email) and inherits
-- tenancy from its meeting. It was in the org_id loop above, which made this
-- migration fail outright with 42703 on a clean database.
drop policy if exists eu_meeting_participants_org_read on public.eu_meeting_participants;
create policy eu_meeting_participants_org_read on public.eu_meeting_participants for select to authenticated
using (exists(select 1 from public.eu_meetings m where m.id = meeting_id and public.is_org_member(m.org_id)));

-- Applicant can read their own application after signing in; staff sees all.
drop policy if exists eu_fellowship_app_read on public.eu_fellowship_applications;
create policy eu_fellowship_app_read on public.eu_fellowship_applications for select to authenticated
using (
  public.is_org_member(org_id)
  or (m_uid is not null and exists(select 1 from public.m_auth_user_links l where l.auth_user_id=auth.uid() and l.m_uid=eu_fellowship_applications.m_uid))
);

-- Research visibility: public projects are public; members and org staff can read internal work.
drop policy if exists eu_research_projects_read on public.eu_research_projects;
create policy eu_research_projects_read on public.eu_research_projects for select to anon, authenticated
using (
  visibility='public'
  or public.is_org_member(org_id)
  or (auth.uid() is not null and exists(
    select 1 from public.eu_research_members rm join public.m_auth_user_links l on l.m_uid=rm.m_uid
    where rm.research_project_id=eu_research_projects.id and rm.status='active' and l.auth_user_id=auth.uid()
  ))
);

drop policy if exists eu_research_members_read on public.eu_research_members;
create policy eu_research_members_read on public.eu_research_members for select to authenticated
using (
  exists(select 1 from public.eu_research_projects p where p.id=research_project_id and public.is_org_member(p.org_id))
  or exists(select 1 from public.m_auth_user_links l where l.auth_user_id=auth.uid() and l.m_uid=eu_research_members.m_uid)
);

-- Research children inherit access through their project/manuscript.
-- `foreach a, b in array values (...)` is not PL/pgSQL: a multi-variable
-- FOREACH needs SLICE over a real 2-D array, and VALUES is not an array
-- expression at all. This block was a syntax error, so the migration could
-- never have run. Both tables key on the same column, so one variable does.
do $$ declare t text; begin
  foreach t in array array['eu_sources','eu_claims'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists(select 1 from public.eu_research_projects p where p.id=%I.research_project_id and (public.is_org_member(p.org_id) or exists(select 1 from public.eu_research_members rm join public.m_auth_user_links l on l.m_uid=rm.m_uid where rm.research_project_id=p.id and rm.status=''active'' and l.auth_user_id=auth.uid()))))',
      t || '_read', t, t
    );
  end loop;
end $$;

-- Claim evidence through claim -> project.
drop policy if exists eu_claim_evidence_read on public.eu_claim_evidence;
create policy eu_claim_evidence_read on public.eu_claim_evidence for select to authenticated
using (exists(
  select 1 from public.eu_claims c join public.eu_research_projects p on p.id=c.research_project_id
  where c.id=claim_id and (
    public.is_org_member(p.org_id)
    or exists(select 1 from public.eu_research_members rm join public.m_auth_user_links l on l.m_uid=rm.m_uid
      where rm.research_project_id=p.id and rm.status='active' and l.auth_user_id=auth.uid())
  )
));

-- Manuscript-related reads through research project membership.
drop policy if exists eu_manuscripts_read on public.eu_manuscripts;
create policy eu_manuscripts_read on public.eu_manuscripts for select to authenticated
using (
  public.is_org_member(org_id)
  or exists(select 1 from public.eu_research_members rm join public.m_auth_user_links l on l.m_uid=rm.m_uid
    where rm.research_project_id=eu_manuscripts.research_project_id and rm.status='active' and l.auth_user_id=auth.uid())
);

do $$ declare t text; begin
  foreach t in array array['eu_manuscript_sections','eu_section_revisions','eu_review_comments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
  end loop;
end $$;

create policy eu_manuscript_sections_read on public.eu_manuscript_sections for select to authenticated
using (exists(
  select 1 from public.eu_manuscripts m join public.eu_research_projects p on p.id=m.research_project_id
  where m.id=manuscript_id and (
    public.is_org_member(p.org_id) or exists(select 1 from public.eu_research_members rm join public.m_auth_user_links l on l.m_uid=rm.m_uid
      where rm.research_project_id=p.id and rm.status='active' and l.auth_user_id=auth.uid())
  )
));
create policy eu_section_revisions_read on public.eu_section_revisions for select to authenticated
using (exists(
  select 1 from public.eu_manuscript_sections s join public.eu_manuscripts m on m.id=s.manuscript_id
  join public.eu_research_projects p on p.id=m.research_project_id
  where s.id=section_id and (
    public.is_org_member(p.org_id) or exists(select 1 from public.eu_research_members rm join public.m_auth_user_links l on l.m_uid=rm.m_uid
      where rm.research_project_id=p.id and rm.status='active' and l.auth_user_id=auth.uid())
  )
));
create policy eu_review_comments_read on public.eu_review_comments for select to authenticated
using (
  public.is_org_member(org_id)
  or exists(select 1 from public.eu_manuscripts m join public.eu_research_members rm on rm.research_project_id=m.research_project_id
    join public.m_auth_user_links l on l.m_uid=rm.m_uid
    where m.id=manuscript_id and rm.status='active' and l.auth_user_id=auth.uid())
);

-- Browser grants are read-focused. Mutations go through narrowly validated Edge Functions.
grant select on public.eu_initiatives, public.eu_initiative_updates, public.eu_research_projects to anon, authenticated;
grant select on public.eu_initiative_members, public.eu_stakeholder_orgs, public.eu_stakeholders,
  public.eu_stakeholder_links, public.eu_communications, public.eu_meetings, public.eu_meeting_participants,
  public.eu_commitments, public.eu_fellowship_applications, public.eu_calendar_settings,
  public.eu_interview_requests, public.eu_research_members, public.eu_sources, public.eu_claims,
  public.eu_claim_evidence, public.eu_manuscripts, public.eu_manuscript_sections, public.eu_section_revisions,
  public.eu_review_comments, public.eu_events to authenticated;

revoke insert, update, delete on public.eu_initiatives, public.eu_initiative_members, public.eu_initiative_updates,
  public.eu_stakeholder_orgs, public.eu_stakeholders, public.eu_stakeholder_links, public.eu_communications,
  public.eu_meetings, public.eu_meeting_participants, public.eu_commitments,
  public.eu_fellowship_applications, public.eu_calendar_settings, public.eu_interview_requests,
  public.eu_research_projects, public.eu_research_members, public.eu_sources, public.eu_claims,
  public.eu_claim_evidence, public.eu_manuscripts, public.eu_manuscript_sections, public.eu_section_revisions,
  public.eu_review_comments, public.eu_events from anon, authenticated;

-- event ledger is intentionally append-only from client roles; only service-side adapters write it.
revoke update, delete on public.eu_events from public, anon, authenticated;
