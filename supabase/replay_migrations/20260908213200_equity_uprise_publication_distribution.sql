-- Equity Uprise Policy OS — canonical artifacts, publication syndication,
-- citation/impact tracking and music/DDEX readiness.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Generic artifact graph. One source, many derivatives.
-- ---------------------------------------------------------------------
create table if not exists public.eu_artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  research_project_id uuid references public.eu_research_projects(id) on delete set null,
  parent_artifact_id uuid references public.eu_artifacts(id) on delete set null,
  artifact_type text not null
    check (artifact_type in ('publication','dataset','policy-brief','testimony','letter','press-release','social-copy','image','video','audio','song','release','presentation','web-page','other')),
  title text not null,
  status text not null default 'draft'
    check (status in ('draft','review','approved','published','superseded','withdrawn','archived')),
  canonical_url text not null default '',
  storage_ref jsonb not null default '{}'::jsonb,
  mime_type text not null default '',
  sha256 text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  lineage jsonb not null default '{}'::jsonb,
  created_by_m_uid uuid references public.m_people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eu_artifacts_initiative_idx on public.eu_artifacts(initiative_id, artifact_type, status);
create index if not exists eu_artifacts_parent_idx on public.eu_artifacts(parent_artifact_id);
drop trigger if exists eu_artifacts_touch on public.eu_artifacts;
create trigger eu_artifacts_touch before update on public.eu_artifacts
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_artifact_dependencies (
  source_artifact_id uuid not null references public.eu_artifacts(id) on delete cascade,
  dependent_artifact_id uuid not null references public.eu_artifacts(id) on delete cascade,
  dependency_type text not null default 'derived-from'
    check (dependency_type in ('derived-from','quotes','summarizes','renders','translates','embeds','promotes','corrects')),
  metadata jsonb not null default '{}'::jsonb,
  primary key (source_artifact_id, dependent_artifact_id, dependency_type)
);

-- ---------------------------------------------------------------------
-- 2. Publications: canonical Equity Uprise version of record
-- ---------------------------------------------------------------------
create table if not exists public.eu_publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  research_project_id uuid references public.eu_research_projects(id) on delete set null,
  manuscript_id uuid references public.eu_manuscripts(id) on delete set null,
  artifact_id uuid unique references public.eu_artifacts(id) on delete set null,
  stable_id text not null,
  publication_type text not null default 'report'
    check (publication_type in ('report','working-paper','policy-brief','memorandum','white-paper','dataset','testimony','other')),
  title text not null,
  subtitle text not null default '',
  abstract text not null default '',
  keywords text[] not null default '{}',
  jurisdiction text not null default '',
  canonical_url text not null default '',
  doi text not null default '',
  license text not null default '',
  funding_statement text not null default '',
  conflict_statement text not null default '',
  status text not null default 'draft'
    check (status in ('draft','final-review','approved','publishing','published','corrected','retracted','superseded')),
  current_version text not null default '0.1',
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by_m_uid uuid references public.m_people(id) on delete set null,
  approved_by_m_uid uuid references public.m_people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, stable_id)
);
create unique index if not exists eu_publications_doi_idx on public.eu_publications(lower(doi)) where doi <> '';
create index if not exists eu_publications_status_idx on public.eu_publications(org_id, status, published_at desc);
drop trigger if exists eu_publications_touch on public.eu_publications;
create trigger eu_publications_touch before update on public.eu_publications
for each row execute function private.eu_touch_updated_at();

-- Guarded: a bare ADD CONSTRAINT makes the migration fail on a second run,
-- which turns an ordinary replay into a manual cleanup.
alter table public.eu_government_submissions
  drop constraint if exists eu_government_submissions_publication_fk;
alter table public.eu_government_submissions
  add constraint eu_government_submissions_publication_fk
  foreign key (publication_id) references public.eu_publications(id) on delete set null;

create table if not exists public.eu_publication_versions (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.eu_publications(id) on delete cascade,
  version_label text not null,
  version_type text not null default 'version' check (version_type in ('version','correction','retraction','replacement')),
  title text not null default '',
  abstract text not null default '',
  content_hash text not null,
  html_ref jsonb not null default '{}'::jsonb,
  pdf_ref jsonb not null default '{}'::jsonb,
  docx_ref jsonb not null default '{}'::jsonb,
  jats_ref jsonb not null default '{}'::jsonb,
  bibtex text not null default '',
  ris text not null default '',
  csl_json jsonb not null default '{}'::jsonb,
  correction_note text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by_m_uid uuid references public.m_people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(publication_id, version_label)
);

-- CRediT contributor taxonomy. ORCID lives per contributor, not only per account.
create table if not exists public.eu_publication_contributors (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.eu_publications(id) on delete cascade,
  m_uid uuid references public.m_people(id) on delete set null,
  display_name text not null,
  affiliation text not null default '',
  orcid text not null default '',
  is_author boolean not null default true,
  author_order integer,
  corresponding boolean not null default false,
  credit_roles text[] not null default '{}',
  contribution_statement text not null default '',
  approval_state text not null default 'pending' check (approval_state in ('pending','approved','declined')),
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists eu_publication_contributors_idx on public.eu_publication_contributors(publication_id, author_order);

create table if not exists public.eu_publication_claims (
  publication_id uuid not null references public.eu_publications(id) on delete cascade,
  claim_id uuid not null references public.eu_claims(id) on delete restrict,
  section_key text not null default '',
  primary key(publication_id, claim_id)
);

-- ---------------------------------------------------------------------
-- 3. External scholarly records + distributions
-- ---------------------------------------------------------------------
create table if not exists public.eu_external_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  publication_id uuid references public.eu_publications(id) on delete cascade,
  artifact_id uuid references public.eu_artifacts(id) on delete cascade,
  provider text not null,
  record_type text not null default 'publication',
  external_id text not null default '',
  external_url text not null default '',
  state text not null default 'pending'
    check (state in ('pending','submitted','published','indexed','error','removed','manual-required')),
  metadata jsonb not null default '{}'::jsonb,
  receipt jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, provider, record_type, external_id)
);
create index if not exists eu_external_records_pub_idx on public.eu_external_records(publication_id, provider, state);
drop trigger if exists eu_external_records_touch on public.eu_external_records;
create trigger eu_external_records_touch before update on public.eu_external_records
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_distribution_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null,
  target_type text not null
    check (target_type in ('canonical-site','doi-registry','orcid','repository','preprint','government','email','social','video','music-partner','archive','other')),
  label text not null,
  integration_id uuid references public.eu_integrations(id) on delete set null,
  config jsonb not null default '{}'::jsonb,
  capability text not null default '',
  approval_required boolean not null default true,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, provider, label)
);
drop trigger if exists eu_distribution_targets_touch on public.eu_distribution_targets;
create trigger eu_distribution_targets_touch before update on public.eu_distribution_targets
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  publication_id uuid references public.eu_publications(id) on delete cascade,
  artifact_id uuid references public.eu_artifacts(id) on delete cascade,
  target_id uuid not null references public.eu_distribution_targets(id) on delete restrict,
  job_id uuid references public.eu_jobs(id) on delete set null,
  version_label text not null default '',
  state text not null default 'queued'
    check (state in ('queued','waiting-approval','sending','submitted','published','indexed','manual-required','failed','cancelled')),
  external_id text not null default '',
  external_url text not null default '',
  receipt jsonb not null default '{}'::jsonb,
  error text not null default '',
  idempotency_key text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists eu_deliveries_idempotency_idx
  on public.eu_deliveries(org_id, idempotency_key) where idempotency_key is not null;
create index if not exists eu_deliveries_pub_idx on public.eu_deliveries(publication_id, state, created_at desc);

-- ---------------------------------------------------------------------
-- 4. Citation + impact intelligence
-- ---------------------------------------------------------------------
create table if not exists public.eu_citation_snapshots (
  id bigserial primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  publication_id uuid not null references public.eu_publications(id) on delete cascade,
  provider text not null,
  cited_by_count integer,
  works jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  unique(publication_id, provider, recorded_at)
);
create index if not exists eu_citation_snapshots_idx on public.eu_citation_snapshots(publication_id, provider, recorded_at desc);

create table if not exists public.eu_impact_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete cascade,
  publication_id uuid references public.eu_publications(id) on delete set null,
  impact_type text not null
    check (impact_type in ('scholarly-citation','government-citation','legislative-reference','media-reference','backlink','download','meeting-attributed','policy-change','adoption','funding','other')),
  title text not null default '',
  description text not null default '',
  source_url text not null default '',
  source_id text not null default '',
  occurred_at timestamptz,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  verified boolean not null default false,
  verified_by_m_uid uuid references public.m_people(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists eu_impact_events_idx on public.eu_impact_events(initiative_id, impact_type, occurred_at desc);

-- ---------------------------------------------------------------------
-- 5. Music rights/catalog graph + DDEX delivery readiness
-- ---------------------------------------------------------------------
create table if not exists public.eu_music_works (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  title text not null,
  iswc text not null default '',
  writers jsonb not null default '[]'::jsonb,
  publishers jsonb not null default '[]'::jsonb,
  rights jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists eu_music_works_touch on public.eu_music_works;
create trigger eu_music_works_touch before update on public.eu_music_works
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_recordings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  work_id uuid references public.eu_music_works(id) on delete set null,
  artifact_id uuid references public.eu_artifacts(id) on delete set null,
  title text not null,
  version_title text not null default '',
  artist text not null default '',
  featured_artists jsonb not null default '[]'::jsonb,
  isrc text not null default '',
  duration_ms integer,
  recording_year integer,
  master_owner text not null default '',
  p_line text not null default '',
  c_line text not null default '',
  language text not null default 'en',
  explicit boolean not null default false,
  audio_ref jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eu_recordings_isrc_idx on public.eu_recordings(lower(isrc)) where isrc <> '';
drop trigger if exists eu_recordings_touch on public.eu_recordings;
create trigger eu_recordings_touch before update on public.eu_recordings
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_releases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid references public.eu_initiatives(id) on delete set null,
  artifact_id uuid references public.eu_artifacts(id) on delete set null,
  title text not null,
  artist text not null default '',
  upc text not null default '',
  release_type text not null default 'single' check (release_type in ('single','ep','album','compilation','video')),
  release_date date,
  label text not null default 'McCluster Corp',
  territories text[] not null default array['Worldwide'],
  artwork_ref jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','metadata-review','approved','delivering','delivered','live','takedown','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eu_releases_upc_idx on public.eu_releases(lower(upc)) where upc <> '';
drop trigger if exists eu_releases_touch on public.eu_releases;
create trigger eu_releases_touch before update on public.eu_releases
for each row execute function private.eu_touch_updated_at();

create table if not exists public.eu_release_tracks (
  release_id uuid not null references public.eu_releases(id) on delete cascade,
  recording_id uuid not null references public.eu_recordings(id) on delete restrict,
  disc_no integer not null default 1,
  track_no integer not null,
  primary key(release_id, disc_no, track_no),
  unique(release_id, recording_id)
);

create table if not exists public.eu_rights_splits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  resource_type text not null check (resource_type in ('work','recording','release')),
  resource_id uuid not null,
  party_name text not null,
  party_m_uid uuid references public.m_people(id) on delete set null,
  role text not null,
  share_bps integer not null check (share_bps between 0 and 10000),
  territory text not null default 'Worldwide',
  rights_type text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists eu_rights_splits_resource_idx on public.eu_rights_splits(resource_type, resource_id);

create table if not exists public.eu_ddex_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  release_id uuid references public.eu_releases(id) on delete cascade,
  message_standard text not null default 'ERN',
  standard_version text not null default '4.3',
  message_id text not null,
  sender_dpid text not null default '',
  recipient_dpid text not null default '',
  recipient_name text not null default '',
  payload_ref jsonb not null default '{}'::jsonb,
  state text not null default 'draft'
    check (state in ('draft','validated','waiting-approval','queued','sent','acknowledged','rejected','failed')),
  validation jsonb not null default '{}'::jsonb,
  receipt jsonb not null default '{}'::jsonb,
  control_approval_id uuid references public.control_approvals(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(org_id, message_id)
);

-- ---------------------------------------------------------------------
-- 6. Seed distribution targets (disabled until credentials/agreements exist)
-- ---------------------------------------------------------------------
insert into public.eu_distribution_targets(org_id,provider,target_type,label,capability,approval_required,enabled,config)
select o.id, x.provider, x.target_type, x.label, x.capability, x.approval_required, false, x.config
from public.orgs o cross join (values
 ('equity-uprise','canonical-site','Canonical Equity Uprise record','publication.publish',true,'{}'::jsonb),
 ('crossref','doi-registry','Crossref DOI + metadata','publication.distribute',true,'{}'::jsonb),
 ('orcid','orcid','ORCID contributor work sync','publication.distribute',false,'{}'::jsonb),
 ('zenodo','repository','Zenodo mirror','publication.distribute',false,'{}'::jsonb),
 ('osf','repository','OSF project/archive','publication.distribute',false,'{}'::jsonb),
 ('ssrn','preprint','SSRN submission package','publication.distribute',true,'{"mode":"manual-package"}'::jsonb),
 ('regulations-gov','government','Regulations.gov submission','government.submit',true,'{}'::jsonb),
 ('linkedin','social','LinkedIn policy derivative','social.publish',true,'{}'::jsonb),
 ('tiktok','social','TikTok policy derivative','social.publish',true,'{}'::jsonb),
 ('youtube','video','YouTube policy briefing','social.publish',true,'{}'::jsonb),
 ('ddex','music-partner','DDEX ERN delivery partner','music.deliver',true,'{}'::jsonb)
) as x(provider,target_type,label,capability,approval_required,config)
where o.slug='mccluster'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 7. RLS / grants
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array[
    'eu_artifacts','eu_artifact_dependencies','eu_publications','eu_publication_versions',
    'eu_publication_contributors','eu_publication_claims','eu_external_records','eu_distribution_targets',
    'eu_deliveries','eu_citation_snapshots','eu_impact_events','eu_music_works','eu_recordings','eu_releases',
    'eu_release_tracks','eu_rights_splits','eu_ddex_messages'
  ] loop execute format('alter table public.%I enable row level security',t); end loop;
end $$;

-- Published publications/artifacts are public. Internal state remains org-only.
drop policy if exists eu_publications_read on public.eu_publications;
create policy eu_publications_read on public.eu_publications for select to anon, authenticated
using (status in ('published','corrected','superseded') or public.is_org_member(org_id));

drop policy if exists eu_artifacts_read on public.eu_artifacts;
create policy eu_artifacts_read on public.eu_artifacts for select to anon, authenticated
using (status in ('published','superseded') or public.is_org_member(org_id));

-- Public versions/contributors/claim links only when parent publication is public.
drop policy if exists eu_publication_versions_read on public.eu_publication_versions;
create policy eu_publication_versions_read on public.eu_publication_versions for select to anon, authenticated
using (exists(select 1 from public.eu_publications p where p.id=publication_id and (p.status in ('published','corrected','superseded') or public.is_org_member(p.org_id))));
drop policy if exists eu_publication_contributors_read on public.eu_publication_contributors;
create policy eu_publication_contributors_read on public.eu_publication_contributors for select to anon, authenticated
using (exists(select 1 from public.eu_publications p where p.id=publication_id and (p.status in ('published','corrected','superseded') or public.is_org_member(p.org_id))));
drop policy if exists eu_publication_claims_read on public.eu_publication_claims;
create policy eu_publication_claims_read on public.eu_publication_claims for select to authenticated
using (exists(select 1 from public.eu_publications p where p.id=publication_id and public.is_org_member(p.org_id)));

-- Artifact dependencies only expose edges whose source and dependent are visible.
drop policy if exists eu_artifact_dependencies_read on public.eu_artifact_dependencies;
create policy eu_artifact_dependencies_read on public.eu_artifact_dependencies for select to authenticated
using (exists(select 1 from public.eu_artifacts a where a.id=source_artifact_id and public.is_org_member(a.org_id)));

-- Operational distribution/impact/music internals are org-only.
do $$ declare t text; begin
  foreach t in array array[
    'eu_external_records','eu_distribution_targets','eu_deliveries','eu_citation_snapshots','eu_impact_events',
    'eu_music_works','eu_recordings','eu_releases','eu_rights_splits','eu_ddex_messages'
  ] loop
    execute format('drop policy if exists %I on public.%I',t||'_org_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))',t||'_org_read',t);
  end loop;
end $$;

-- release_tracks inherit via release.
drop policy if exists eu_release_tracks_read on public.eu_release_tracks;
create policy eu_release_tracks_read on public.eu_release_tracks for select to authenticated
using (exists(select 1 from public.eu_releases r where r.id=release_id and public.is_org_member(r.org_id)));

grant select on public.eu_artifacts, public.eu_publications, public.eu_publication_versions,
  public.eu_publication_contributors to anon, authenticated;
grant select on public.eu_artifact_dependencies, public.eu_publication_claims, public.eu_external_records,
  public.eu_distribution_targets, public.eu_deliveries, public.eu_citation_snapshots, public.eu_impact_events,
  public.eu_music_works, public.eu_recordings, public.eu_releases, public.eu_release_tracks,
  public.eu_rights_splits, public.eu_ddex_messages to authenticated;

revoke insert, update, delete on public.eu_artifacts, public.eu_artifact_dependencies, public.eu_publications,
  public.eu_publication_versions, public.eu_publication_contributors, public.eu_publication_claims,
  public.eu_external_records, public.eu_distribution_targets, public.eu_deliveries, public.eu_citation_snapshots,
  public.eu_impact_events, public.eu_music_works, public.eu_recordings, public.eu_releases,
  public.eu_release_tracks, public.eu_rights_splits, public.eu_ddex_messages from anon, authenticated;
