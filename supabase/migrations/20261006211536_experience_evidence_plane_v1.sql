-- Experience Evidence Plane + Research Lab registry v1.
--
-- This migration is deliberately behavior-neutral. It records what a policy
-- could show, what it chose, experiment assignment, propensity and outcomes.
-- No experimental policy is enabled by this migration.
--
-- Public-schema tables are service-role only. Browser clients go through the
-- Worker so anonymous experiment traffic cannot read or mutate the research
-- ledger directly.

create table if not exists public.experience_surfaces (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text,
  risk_tier smallint not null default 0 check (risk_tier between 0 and 3),
  allowed_mutations jsonb not null default '[]'::jsonb check (jsonb_typeof(allowed_mutations) = 'array'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.experience_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version text not null,
  plane text not null check (plane in ('production','research')),
  mode text not null check (mode in ('offline','shadow','ghost','live','opt_in','promoted')),
  algorithm text not null,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  source_commit_sha text,
  enabled boolean not null default false,
  promoted_from_policy_id uuid references public.experience_policies(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (key, version)
);

create table if not exists public.research_projects (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  abstract text,
  research_question text,
  status text not null default 'planning'
    check (status in ('planning','review','active','paused','analysis','published','closed')),
  lead_name text not null default 'Matthew McCluster',
  lead_orcid text,
  canonical_url text,
  protocol_ref text,
  human_subjects_status text not null default 'undetermined'
    check (human_subjects_status in ('undetermined','not_human_subjects_research','pending_irb','exempt','approved','not_approved')),
  publication_plan jsonb not null default '{}'::jsonb check (jsonb_typeof(publication_plan) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.experience_experiments (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  surface_id uuid not null references public.experience_surfaces(id) on delete restrict,
  research_project_id uuid references public.research_projects(id) on delete set null,
  hypothesis text not null,
  primary_metric text not null,
  guardrail_metrics jsonb not null default '[]'::jsonb check (jsonb_typeof(guardrail_metrics) = 'array'),
  randomization_unit text not null default 'subject'
    check (randomization_unit in ('subject','session','device','network_cluster')),
  allocation numeric(5,4) not null default 0 check (allocation >= 0 and allocation <= 1),
  intent text not null default 'product' check (intent in ('product','research')),
  research_review text not null default 'not_required'
    check (research_review in ('not_required','pending','exempt','approved','denied')),
  protocol_ref text,
  consent_mode text not null default 'product_notice'
    check (consent_mode in ('product_notice','research_consent','opt_in')),
  preregistration_uri text,
  preregistered_at timestamptz,
  publication_eligible boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','offline','shadow','ghost','canary','running','paused','analysis','completed','promoted','stopped')),
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (intent <> 'research' or research_review in ('pending','exempt','approved','denied')),
  check (status not in ('canary','running') or intent <> 'research' or research_review in ('exempt','approved'))
);

create index if not exists experience_experiments_surface_status
  on public.experience_experiments (surface_id, status, started_at, ended_at);

create table if not exists public.experience_experiment_arms (
  experiment_id uuid not null references public.experience_experiments(id) on delete cascade,
  arm_key text not null,
  policy_id uuid not null references public.experience_policies(id) on delete restrict,
  weight integer not null check (weight > 0),
  is_control boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (experiment_id, arm_key)
);

create unique index if not exists experience_one_control_arm
  on public.experience_experiment_arms (experiment_id)
  where is_control;

create table if not exists public.experience_assignments (
  experiment_id uuid not null references public.experience_experiments(id) on delete cascade,
  subject_key_hash text not null,
  arm_key text not null,
  assignment_version integer not null default 1 check (assignment_version > 0),
  assigned_at timestamptz not null default now(),
  primary key (experiment_id, subject_key_hash, assignment_version),
  foreign key (experiment_id, arm_key)
    references public.experience_experiment_arms(experiment_id, arm_key)
    on delete restrict
);

create table if not exists public.experience_feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  subject_key_hash text not null,
  schema_version text not null,
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists experience_feature_subject_recent
  on public.experience_feature_snapshots (subject_key_hash, created_at desc);

create table if not exists public.experience_decisions (
  id uuid primary key default gen_random_uuid(),
  surface_id uuid not null references public.experience_surfaces(id) on delete restrict,
  subject_key_hash text not null,
  session_id text,
  policy_id uuid not null references public.experience_policies(id) on delete restrict,
  experiment_id uuid references public.experience_experiments(id) on delete set null,
  arm_key text,
  feature_snapshot_id uuid references public.experience_feature_snapshots(id) on delete set null,
  eligible_candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(eligible_candidates) = 'array'),
  selected_candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(selected_candidates) = 'array'),
  propensities jsonb not null default '[]'::jsonb check (jsonb_typeof(propensities) = 'array'),
  reason_codes text[] not null default '{}'::text[],
  objective_weights jsonb not null default '{}'::jsonb check (jsonb_typeof(objective_weights) = 'object'),
  client_context jsonb not null default '{}'::jsonb check (jsonb_typeof(client_context) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  check ((experiment_id is null and arm_key is null) or experiment_id is not null)
);

create index if not exists experience_decisions_surface_time
  on public.experience_decisions (surface_id, created_at desc);
create index if not exists experience_decisions_subject_time
  on public.experience_decisions (subject_key_hash, created_at desc);
create index if not exists experience_decisions_experiment_time
  on public.experience_decisions (experiment_id, created_at desc)
  where experiment_id is not null;

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  citation_key text not null unique,
  title text not null,
  authors jsonb not null default '[]'::jsonb check (jsonb_typeof(authors) = 'array'),
  published_year integer,
  doi text,
  canonical_url text not null,
  source_type text not null default 'paper',
  category text,
  relevance text,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create unique index if not exists research_sources_doi_unique
  on public.research_sources (lower(doi))
  where doi is not null;

create table if not exists public.research_artifacts (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid references public.research_projects(id) on delete set null,
  experiment_id uuid references public.experience_experiments(id) on delete set null,
  key text not null unique,
  title text not null,
  kind text not null check (kind in ('software','dataset','protocol','preregistration','report','paper','poster','presentation','release','other')),
  status text not null default 'draft' check (status in ('draft','review','released','superseded','withdrawn')),
  canonical_url text,
  doi text,
  concept_doi text,
  orcid_work_put_code text,
  git_commit_sha text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.experience_surfaces enable row level security;
revoke all on table public.experience_surfaces from anon, authenticated;
alter table public.experience_policies enable row level security;
revoke all on table public.experience_policies from anon, authenticated;
alter table public.research_projects enable row level security;
revoke all on table public.research_projects from anon, authenticated;
alter table public.experience_experiments enable row level security;
revoke all on table public.experience_experiments from anon, authenticated;
alter table public.experience_experiment_arms enable row level security;
revoke all on table public.experience_experiment_arms from anon, authenticated;
alter table public.experience_assignments enable row level security;
revoke all on table public.experience_assignments from anon, authenticated;
alter table public.experience_feature_snapshots enable row level security;
revoke all on table public.experience_feature_snapshots from anon, authenticated;
alter table public.experience_decisions enable row level security;
revoke all on table public.experience_decisions from anon, authenticated;
alter table public.research_sources enable row level security;
revoke all on table public.research_sources from anon, authenticated;
alter table public.research_artifacts enable row level security;
revoke all on table public.research_artifacts from anon, authenticated;

insert into public.experience_surfaces (key, description, risk_tier, allowed_mutations)
values
  ('global.for_you', 'Global next-step / For You recommendation surface.', 0, '["order","content"]'::jsonb),
  ('music.next_step', 'Music listening next-step surface.', 0, '["order","content"]'::jsonb),
  ('action.next_step', 'Action Network next-step discovery surface.', 0, '["order","content"]'::jsonb)
on conflict (key) do update set
  description = excluded.description,
  risk_tier = excluded.risk_tier,
  allowed_mutations = excluded.allowed_mutations,
  updated_at = now();

insert into public.experience_policies (key, version, plane, mode, algorithm, config, enabled)
values (
  'control-order',
  'v1',
  'production',
  'promoted',
  'identity_order',
  '{"behavior_change":false,"description":"Preserve caller candidate order; evidence collection only."}'::jsonb,
  true
)
on conflict (key, version) do update set
  plane = excluded.plane,
  mode = excluded.mode,
  algorithm = excluded.algorithm,
  config = excluded.config,
  enabled = true;

insert into public.research_projects (
  key, title, abstract, research_question, status, lead_name, lead_orcid,
  canonical_url, human_subjects_status, publication_plan
)
values (
  'mccluster-adaptive-experience-lab',
  'McCluster Adaptive Experience Research Lab',
  'A living research program studying adaptive digital experiences, recommender systems, audience behavior, creator/music discovery, Action Network participation, and commercial outcomes on the McCluster platform.',
  'How can a unified first-party digital ecosystem adapt interfaces and recommendations over time while preserving user agency, experimental validity, privacy, and commercial usefulness?',
  'planning',
  'Matthew McCluster',
  '0009-0000-8988-8955',
  'https://matthew.mccluster.org/research.html',
  'undetermined',
  '{"repositories":["GitHub","Zenodo"],"identity":["ORCID"],"outputs":["software","protocols","datasets","reports","papers"]}'::jsonb
)
on conflict (key) do update set
  title = excluded.title,
  abstract = excluded.abstract,
  research_question = excluded.research_question,
  lead_orcid = excluded.lead_orcid,
  canonical_url = excluded.canonical_url,
  publication_plan = excluded.publication_plan,
  updated_at = now();

insert into public.event_taxonomy (event_name, stage, note) values
  ('experience_impression','view','An adaptive surface rendered a policy-selected item or module.'),
  ('experience_visible','engage','A policy-selected item or module entered the visible viewport.'),
  ('experience_interaction','engage','The visitor interacted with a policy-selected item or module.'),
  ('experience_dismissed','engage','The visitor explicitly dismissed a policy-selected item or module.'),
  ('experience_outcome','engage','A downstream outcome was attributed to an experience decision.')
on conflict (event_name) do update set stage = excluded.stage, note = excluded.note;

alter table public.events_lean add column if not exists decision_id text;
alter table public.events_lean add column if not exists experience_surface text;
alter table public.events_lean add column if not exists experience_policy text;
alter table public.events_lean add column if not exists experience_experiment text;
alter table public.events_lean add column if not exists experience_arm text;

create or replace function private.events_lean_row(e public.events)
returns public.events_lean
language sql
immutable
set search_path = ''
as $lean_row$
  select row(
    e.id, e.at, e.site_id, e.name, e.path, e.device_id, e.session_id,
    coalesce(e.is_bot, false), e.country, e.referrer,
    coalesce(e.device->'network'->>'effective', e.asn_org),
    nullif(e.props->>'src', ''),
    nullif(e.props->>'source', ''),
    case
      when lower(coalesce(e.props->>'song', '')) = 'whodidtheshoot' then 'who did the shoot'
      else nullif(trim(regexp_replace(lower(coalesce(e.props->>'track', e.props->>'song')), '[-_]+', ' ', 'g')), '')
    end,
    nullif(trim(coalesce(e.props->>'album', e.props->>'album_slug')), ''),
    case when jsonb_typeof(e.props->'listened_seconds') = 'number' then (e.props->>'listened_seconds')::numeric end,
    case when e.name = 'dwell' and jsonb_typeof(e.props->'s') = 'number' then (e.props->>'s')::numeric end,
    case when e.name = 'page_leave' and jsonb_typeof(e.props->'visible_s') = 'number' then (e.props->>'visible_s')::numeric end,
    case when e.name = 'page_leave' and jsonb_typeof(e.props->'hidden_s') = 'number' then (e.props->>'hidden_s')::numeric end,
    case when e.name = 'page_leave' and jsonb_typeof(e.props->'depth') = 'number' then least(100, greatest(0, (e.props->>'depth')::numeric)) end,
    case when e.name = 'page_leave' and jsonb_typeof(e.props->'exit_intent') = 'boolean' then (e.props->>'exit_intent')::boolean end,
    nullif(e.props->>'decision_id', ''),
    nullif(e.props->>'experience_surface', ''),
    nullif(e.props->>'experience_policy', ''),
    nullif(e.props->>'experience_experiment', ''),
    nullif(e.props->>'experience_arm', '')
  )::public.events_lean
$lean_row$;

create or replace function private.events_lean_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $lean_sync$
begin
  insert into public.events_lean
  select (private.events_lean_row(new)).*
  on conflict (id) do update set
    at = excluded.at, site_id = excluded.site_id, name = excluded.name, path = excluded.path,
    device_id = excluded.device_id, session_id = excluded.session_id, is_bot = excluded.is_bot,
    country = excluded.country, referrer = excluded.referrer, network = excluded.network,
    src = excluded.src, source = excluded.source, track = excluded.track, album = excluded.album,
    listened_seconds = excluded.listened_seconds, dwell_s = excluded.dwell_s,
    visible_s = excluded.visible_s, hidden_s = excluded.hidden_s, depth = excluded.depth,
    exit_intent = excluded.exit_intent,
    decision_id = excluded.decision_id,
    experience_surface = excluded.experience_surface,
    experience_policy = excluded.experience_policy,
    experience_experiment = excluded.experience_experiment,
    experience_arm = excluded.experience_arm;
  return null;
exception when others then
  raise warning 'events_lean_sync skipped %: %', new.id, sqlerrm;
  return null;
end;
$lean_sync$;

revoke all on function private.events_lean_row(public.events) from public, anon, authenticated;
revoke all on function private.events_lean_sync() from public, anon, authenticated;

comment on table public.experience_decisions is
  'Canonical opportunity/exposure ledger. Records what was eligible and selected before downstream events occur.';
comment on table public.experience_experiments is
  'Product and research experiments. Research-intent experiments cannot enter canary/running state without exempt/approved review status.';
comment on table public.research_projects is
  'Research program registry. Human-subjects status is governance metadata, not a self-issued IRB determination.';
comment on table public.research_sources is
  'Canonical bibliography for research methods and claims used by the McCluster Research Lab.';
comment on table public.research_artifacts is
  'Publication ledger for protocols, datasets, software releases, reports and DOI/ORCID-linked outputs.';
