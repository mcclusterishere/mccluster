-- Intel -> mission canon v1 (PENDING: not applied to production).
--
-- One evidence -> claim -> briefing -> decision -> mission -> outcome loop for
-- Hitman's Halo and the shared McCluster plane. Design and reasons:
-- docs/control-plane/INTEL-TO-MISSION-CANON.md.
--
-- REUSED, NOT DUPLICATED (all applied in production):
--   source registry + checkpoint ... public.ops_ingest_connectors (cursor, license_policy, retention_policy)
--   collection runs ................ public.ops_ingest_runs (running|succeeded|partial|failed)
--   source snapshots ............... public.ops_ingest_records (content_hash, idempotency_key, source_ref)
--   decisions ...................... ai_context.decisions (approver, time, rationale; written only
--                                    through the context-decision Edge Function as the human)
--   missions / proofs .............. public.action_missions, public.action_proofs
--   tenancy ........................ public.orgs, public.org_members
--   audit .......................... public.control_audit (Worker lib/audit.js) + intel_reviews below
--
-- NEW (this file): reviewable evidence, analytical claims with stance-bearing
-- evidence links, review history, briefings with citations, the decision
-- basis, the mission<-decision link, outcomes with proof links, and the
-- server functions that keep each transition atomic. Supersedes the unapplied
-- supabase/pending/20261011190000_decision_intelligence_evidence_v1.sql
-- (do not apply both).
--
-- Access model: anon has nothing. authenticated may SELECT intel tables only
-- where RLS says the caller is an owner/admin of the row's org. Every write
-- goes through the Worker (service_role) and the security-definer functions
-- below, which are executable by service_role only. Members and the public
-- receive only the aggregate projection (intel_geo_projection) through the
-- Worker, with a k-anonymity floor.
--
-- Purpose limits (enforced by CHECKs, see the canon doc): no person-level
-- subjects, no electoral purpose lane. Voter-level profiling, sensitive-trait
-- inference and covert persuasion targeting are out of scope for this schema.
--
-- Rollback: supabase/pending/20261015210000_intel_mission_canon_v1.rollback.sql

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Role helper
-- ---------------------------------------------------------------------------
create or replace function public.intel_is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.profile_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  )
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.intel_outcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  mission_id uuid not null references public.action_missions(id) on delete restrict,
  decision_id uuid not null references ai_context.decisions(id) on delete restrict,
  summary text not null check (char_length(summary) between 1 and 4000),
  occurred_at timestamptz not null,
  measures jsonb not null default '{}'::jsonb check (jsonb_typeof(measures) = 'object'),
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'rejected')),
  submitted_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  unique (id, org_id),
  check ((status = 'submitted') = (reviewed_at is null))
);
create index intel_outcomes_mission_idx on public.intel_outcomes (org_id, mission_id, created_at desc);

create table public.intel_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('source_record', 'mission_outcome', 'document')),
  source_record_id uuid,
  outcome_id uuid,
  title text not null check (char_length(title) between 1 and 500),
  summary text not null default '' check (char_length(summary) <= 4000),
  publisher text not null check (char_length(publisher) between 1 and 200),
  source_url text check (source_url is null or source_url ~ '^https://'),
  license text not null check (char_length(license) between 1 and 200),
  attribution text,
  retrieved_at timestamptz not null,
  observed_at timestamptz,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  measures jsonb not null default '{}'::jsonb check (jsonb_typeof(measures) = 'object'),
  -- Coordinates are stored only when the source itself published them. They
  -- are never derived, geocoded or defaulted; (0,0) is refused outright.
  lat numeric(9, 6) check (lat is null or lat between -90 and 90),
  lon numeric(9, 6) check (lon is null or lon between -180 and 180),
  geo_source text not null default 'none' check (geo_source in ('source_published', 'none')),
  region_label text check (region_label is null or char_length(region_label) <= 200),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'accepted', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  visibility text not null default 'private' check (visibility in ('private', 'members', 'public')),
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  check ((lat is null) = (lon is null)),
  check ((geo_source = 'source_published') = (lat is not null)),
  check (not (lat = 0 and lon = 0)),
  check (kind <> 'source_record' or source_record_id is not null),
  check (kind <> 'mission_outcome' or outcome_id is not null),
  check (visibility = 'private' or review_status = 'accepted'),
  foreign key (source_record_id, org_id) references public.ops_ingest_records(id, org_id) on delete restrict,
  foreign key (outcome_id, org_id) references public.intel_outcomes(id, org_id) on delete restrict
);
create unique index intel_evidence_one_per_record on public.intel_evidence (org_id, source_record_id) where source_record_id is not null;
create unique index intel_evidence_one_per_outcome on public.intel_evidence (outcome_id) where outcome_id is not null;
create index intel_evidence_review_idx on public.intel_evidence (org_id, review_status, retrieved_at desc);
create index intel_evidence_geo_idx on public.intel_evidence (org_id, visibility, observed_at) where lat is not null;

create table public.intel_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  statement text not null check (char_length(statement) between 1 and 2000),
  subject_kind text not null check (subject_kind in ('event', 'place', 'infrastructure', 'organization', 'program', 'policy', 'aggregate')),
  purpose text not null check (purpose in ('public_interest_research', 'nonprofit_program', 'operations')),
  status text not null default 'draft' check (status in ('draft', 'under_review', 'supported', 'disputed', 'rejected', 'retracted')),
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  region_label text check (region_label is null or char_length(region_label) <= 200),
  created_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  visibility text not null default 'private' check (visibility in ('private', 'members', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  check (visibility = 'private' or status = 'supported')
);
create index intel_claims_status_idx on public.intel_claims (org_id, status, updated_at desc);

create table public.intel_claim_evidence (
  org_id uuid not null,
  claim_id uuid not null,
  evidence_id uuid not null,
  stance text not null check (stance in ('supports', 'contradicts', 'context')),
  note text check (note is null or char_length(note) <= 2000),
  added_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (claim_id, evidence_id, stance),
  foreign key (claim_id, org_id) references public.intel_claims(id, org_id) on delete cascade,
  foreign key (evidence_id, org_id) references public.intel_evidence(id, org_id) on delete restrict
);
create index intel_claim_evidence_evidence_idx on public.intel_claim_evidence (org_id, evidence_id);

-- Append-only review history for evidence, claims, outcomes and briefings.
create table public.intel_reviews (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  subject_type text not null check (subject_type in ('evidence', 'claim', 'outcome', 'briefing')),
  subject_id uuid not null,
  from_status text,
  to_status text not null,
  confidence numeric(4, 3),
  reviewer_id uuid not null,
  note text check (note is null or char_length(note) <= 2000),
  reviewed_at timestamptz not null default now()
);
create index intel_reviews_subject_idx on public.intel_reviews (org_id, subject_type, subject_id, reviewed_at);

create table public.intel_briefings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  body text not null check (char_length(body) between 1 and 40000),
  status text not null default 'final' check (status in ('draft', 'final', 'withdrawn')),
  drafting text not null default 'human' check (drafting in ('human', 'model_assisted')),
  author_id uuid not null,
  -- Freshness: the window the cited evidence was retrieved in, computed by
  -- intel_create_briefing from the citations, never typed by hand.
  evidence_oldest_at timestamptz,
  evidence_newest_at timestamptz,
  as_of timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create table public.intel_briefing_citations (
  org_id uuid not null,
  briefing_id uuid not null,
  ordinal smallint not null check (ordinal between 1 and 500),
  claim_id uuid,
  evidence_id uuid,
  locator text check (locator is null or char_length(locator) <= 500),
  primary key (briefing_id, ordinal),
  check (num_nonnulls(claim_id, evidence_id) >= 1),
  foreign key (briefing_id, org_id) references public.intel_briefings(id, org_id) on delete cascade,
  foreign key (claim_id, org_id) references public.intel_claims(id, org_id) on delete restrict,
  foreign key (evidence_id, org_id) references public.intel_evidence(id, org_id) on delete restrict
);
create index intel_briefing_citations_claim_idx on public.intel_briefing_citations (org_id, claim_id) where claim_id is not null;
create index intel_briefing_citations_evidence_idx on public.intel_briefing_citations (org_id, evidence_id) where evidence_id is not null;

-- What a decision relied on. The decision itself (approver, time, rationale,
-- status) stays in ai_context.decisions; this table never copies it.
create table public.intel_decision_basis (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  decision_id uuid not null references ai_context.decisions(id) on delete restrict,
  briefing_id uuid,
  claim_id uuid,
  evidence_id uuid,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  check (num_nonnulls(briefing_id, claim_id, evidence_id) = 1),
  foreign key (briefing_id, org_id) references public.intel_briefings(id, org_id) on delete restrict,
  foreign key (claim_id, org_id) references public.intel_claims(id, org_id) on delete restrict,
  foreign key (evidence_id, org_id) references public.intel_evidence(id, org_id) on delete restrict
);
create unique index intel_decision_basis_unique on public.intel_decision_basis
  (decision_id, coalesce(briefing_id, claim_id, evidence_id));

-- A mission created from a decision. A link table rather than a column on
-- action_missions: that table is granted to anon at table level (public
-- mission cards), has no org_id, and a private decision id must not ride
-- along on every public read.
create table public.intel_mission_decisions (
  mission_id uuid primary key references public.action_missions(id) on delete restrict,
  org_id uuid not null references public.orgs(id) on delete cascade,
  decision_id uuid not null references ai_context.decisions(id) on delete restrict,
  objectives text[] not null default '{}',
  scope text check (scope is null or char_length(scope) <= 2000),
  region_label text check (region_label is null or char_length(region_label) <= 200),
  target_measures jsonb not null default '{}'::jsonb check (jsonb_typeof(target_measures) = 'object'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  linked_by uuid not null,
  linked_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
create index intel_mission_decisions_decision_idx on public.intel_mission_decisions (org_id, decision_id);

create table public.intel_outcome_proofs (
  org_id uuid not null,
  outcome_id uuid not null,
  proof_id uuid not null references public.action_proofs(id) on delete restrict,
  primary key (outcome_id, proof_id),
  foreign key (outcome_id, org_id) references public.intel_outcomes(id, org_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
do $grants$
declare t text;
begin
  foreach t in array array[
    'intel_evidence', 'intel_claims', 'intel_claim_evidence', 'intel_reviews', 'intel_briefings',
    'intel_briefing_citations', 'intel_decision_basis', 'intel_mission_decisions', 'intel_outcomes',
    'intel_outcome_proofs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.intel_is_org_admin(org_id)))',
      t || '_org_admin_read', t
    );
  end loop;
end
$grants$;

-- Review history is append-only, even for the service role.
revoke update, delete on table public.intel_reviews from service_role;

revoke all on function public.intel_is_org_admin(uuid) from public, anon;
grant execute on function public.intel_is_org_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Server functions (service_role only)
-- ---------------------------------------------------------------------------

-- Read the canonical decision state. ai_context is not exposed to the Data
-- API; this is the single, read-only window the Worker uses to gate missions.
create or replace function public.intel_decision_state(p_org uuid, p_decision uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id, 'org_id', d.org_id, 'title', d.title, 'status', d.status,
    'risk_class', d.risk_class, 'approved_by', d.approved_by, 'approved_at', d.approved_at,
    'rationale_summary', d.rationale_summary, 'created_at', d.created_at
  )
  from ai_context.decisions d
  where d.id = p_decision and d.org_id = p_org
$$;

-- Collector: begin a run. Upserts the connector, refuses to start while
-- another run is live (lease) or before the minimum interval, and returns the
-- checkpoint cursor. A refused start writes nothing.
create or replace function public.intel_collector_begin(
  p_org uuid, p_connector_key text, p_connector jsonb, p_min_interval_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connector public.ops_ingest_connectors%rowtype;
  v_last timestamptz;
  v_run uuid;
begin
  insert into public.ops_ingest_connectors (org_id, connector_key, kind, display_name, description, config, retention_policy, license_policy)
  values (
    p_org, p_connector_key, coalesce(p_connector->>'kind', 'api'), coalesce(p_connector->>'display_name', p_connector_key),
    coalesce(p_connector->>'description', ''), coalesce(p_connector->'config', '{}'::jsonb),
    coalesce(p_connector->'retention_policy', '{}'::jsonb), coalesce(p_connector->'license_policy', '{}'::jsonb)
  )
  on conflict (org_id, connector_key) do update
    set display_name = excluded.display_name, description = excluded.description, config = excluded.config,
        retention_policy = excluded.retention_policy, license_policy = excluded.license_policy, updated_at = now()
  returning * into v_connector;

  -- serialize concurrent ticks on this connector
  perform 1 from public.ops_ingest_connectors where id = v_connector.id for update;

  if not v_connector.enabled then
    return jsonb_build_object('started', false, 'reason', 'connector_disabled', 'connector_id', v_connector.id);
  end if;
  if exists (
    select 1 from public.ops_ingest_runs r
    where r.connector_id = v_connector.id and r.status = 'running' and r.started_at > now() - interval '15 minutes'
  ) then
    return jsonb_build_object('started', false, 'reason', 'run_in_progress', 'connector_id', v_connector.id);
  end if;
  -- runs left 'running' past the lease were interrupted: record them as failed
  update public.ops_ingest_runs
     set status = 'failed', error = 'lease_expired', finished_at = now()
   where connector_id = v_connector.id and status = 'running';

  select max(r.started_at) into v_last from public.ops_ingest_runs r where r.connector_id = v_connector.id;
  if v_last is not null and v_last > now() - make_interval(secs => greatest(coalesce(p_min_interval_seconds, 900), 60)) then
    return jsonb_build_object('started', false, 'reason', 'not_due', 'connector_id', v_connector.id, 'last_started_at', v_last);
  end if;

  insert into public.ops_ingest_runs (org_id, connector_id, mode, status, cursor_before)
  values (p_org, v_connector.id, case when v_connector.cursor = '{}'::jsonb then 'initial' else 'incremental' end, 'running', v_connector.cursor)
  returning id into v_run;

  update public.ops_ingest_connectors set last_sync_at = now() where id = v_connector.id;
  return jsonb_build_object('started', true, 'run_id', v_run, 'connector_id', v_connector.id, 'cursor', v_connector.cursor);
end
$$;

-- Collector: record a failed run. Failure is never reported as zero rows of
-- success: status 'failed' with the error, and the cursor does not move.
create or replace function public.intel_collector_fail(p_org uuid, p_run uuid, p_error text, p_metadata jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_connector uuid;
begin
  update public.ops_ingest_runs
     set status = 'failed', error = left(coalesce(p_error, 'unknown_error'), 2000),
         metadata = metadata || coalesce(p_metadata, '{}'::jsonb), finished_at = now()
   where id = p_run and org_id = p_org and status = 'running'
  returning connector_id into v_connector;
  if v_connector is null then raise exception 'run % is not running for this org', p_run using errcode = 'P0002'; end if;
  update public.ops_ingest_connectors
     set last_error = left(coalesce(p_error, 'unknown_error'), 2000), last_error_at = now(), updated_at = now()
   where id = v_connector;
  return jsonb_build_object('run_id', p_run, 'status', 'failed');
end
$$;

-- Collector: commit a fetched batch. Records, evidence and the advanced
-- checkpoint are written in ONE transaction, so a crash can never advance the
-- cursor past rows that were not stored. Duplicate records (same
-- idempotency_key) are counted as deduplicated, not written.
create or replace function public.intel_collector_commit(
  p_org uuid, p_run uuid, p_records jsonb, p_cursor jsonb, p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ops_ingest_runs%rowtype;
  v_connector public.ops_ingest_connectors%rowtype;
  v_item jsonb;
  v_record_id uuid;
  v_seen integer := 0;
  v_written integer := 0;
  v_rejected integer := 0;
  v_retention interval;
  v_lat numeric;
  v_lon numeric;
begin
  select * into v_run from public.ops_ingest_runs where id = p_run and org_id = p_org for update;
  if not found or v_run.status <> 'running' then
    raise exception 'run % is not running for this org', p_run using errcode = 'P0002';
  end if;
  if coalesce(jsonb_typeof(p_records), '') <> 'array' then raise exception 'records must be an array'; end if;
  select * into v_connector from public.ops_ingest_connectors where id = v_run.connector_id;
  v_retention := make_interval(days => coalesce((v_connector.retention_policy->>'days')::integer, 365));

  for v_item in select value from jsonb_array_elements(p_records) loop
    v_seen := v_seen + 1;
    if coalesce(v_item->>'external_id', '') = '' or coalesce(v_item->>'content_hash', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'idempotency_key', '') = '' or coalesce(v_item->>'title', '') = '' then
      v_rejected := v_rejected + 1;
      continue;
    end if;
    v_record_id := null;
    insert into public.ops_ingest_records (
      org_id, connector_id, run_id, trace_id, external_id, record_kind, source_ref, observed_at,
      content_hash, idempotency_key, payload, retention_policy, license_policy
    ) values (
      p_org, v_connector.id, p_run, v_run.trace_id, v_item->>'external_id', coalesce(v_item->>'record_kind', 'record'),
      coalesce(v_item->'source_ref', '{}'::jsonb), coalesce((v_item->>'observed_at')::timestamptz, now()),
      v_item->>'content_hash', v_item->>'idempotency_key', coalesce(v_item->'payload', '{}'::jsonb),
      v_connector.retention_policy, v_connector.license_policy
    )
    on conflict (org_id, connector_id, idempotency_key) do nothing
    returning id into v_record_id;

    if v_record_id is null then
      continue; -- deduplicated
    end if;
    v_written := v_written + 1;

    -- coordinates only as a pair the source published; (0,0) is not a place
    v_lat := (v_item->>'lat')::numeric;
    v_lon := (v_item->>'lon')::numeric;
    if v_lat is null or v_lon is null or (v_lat = 0 and v_lon = 0)
       or v_lat not between -90 and 90 or v_lon not between -180 and 180 then
      v_lat := null; v_lon := null;
    end if;

    insert into public.intel_evidence (
      org_id, kind, source_record_id, title, summary, publisher, source_url, license, attribution,
      retrieved_at, observed_at, content_sha256, measures, lat, lon, geo_source, region_label, retention_until
    ) values (
      p_org, 'source_record', v_record_id, left(v_item->>'title', 500), left(coalesce(v_item->>'summary', ''), 4000),
      coalesce(v_connector.license_policy->>'publisher', v_connector.display_name),
      nullif(v_item->>'source_url', ''),
      coalesce(v_connector.license_policy->>'license', 'unspecified'),
      v_connector.license_policy->>'attribution',
      coalesce((v_item->>'retrieved_at')::timestamptz, now()),
      (v_item->>'observed_at')::timestamptz,
      v_item->>'content_hash',
      coalesce(v_item->'measures', '{}'::jsonb),
      v_lat, v_lon,
      case when v_lat is not null then 'source_published' else 'none' end,
      left(v_item->>'region_label', 200),
      now() + v_retention
    );
  end loop;

  update public.ops_ingest_runs
     set status = case when v_rejected > 0 then 'partial' else 'succeeded' end,
         records_seen = v_seen, records_written = v_written, records_rejected = v_rejected,
         cursor_after = coalesce(p_cursor, v_run.cursor_before),
         metadata = metadata || coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('deduplicated', v_seen - v_written - v_rejected),
         finished_at = now()
   where id = p_run;
  update public.ops_ingest_connectors
     set cursor = coalesce(p_cursor, cursor), last_ok_at = now(), updated_at = now()
   where id = v_connector.id;

  return jsonb_build_object(
    'run_id', p_run, 'status', case when v_rejected > 0 then 'partial' else 'succeeded' end,
    'records_seen', v_seen, 'records_written', v_written, 'records_rejected', v_rejected,
    'deduplicated', v_seen - v_written - v_rejected, 'cursor', coalesce(p_cursor, v_run.cursor_before)
  );
end
$$;

-- Review evidence or a claim, with history. Visibility above 'private' needs
-- an accepted/supported item (also enforced by table CHECKs).
create or replace function public.intel_review(
  p_org uuid, p_actor uuid, p_subject_type text, p_subject_id uuid, p_to_status text,
  p_note text default null, p_confidence numeric default null, p_visibility text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_from text;
begin
  if p_subject_type = 'evidence' then
    if p_to_status not in ('accepted', 'rejected') then raise exception 'evidence status must be accepted or rejected'; end if;
    select review_status into v_from from public.intel_evidence where id = p_subject_id and org_id = p_org for update;
    if not found then raise exception 'evidence not found' using errcode = 'P0002'; end if;
    update public.intel_evidence
       set review_status = p_to_status, reviewed_by = p_actor, reviewed_at = now(), updated_at = now(),
           visibility = case when p_to_status = 'accepted' then coalesce(p_visibility, visibility) else 'private' end
     where id = p_subject_id;
  elsif p_subject_type = 'claim' then
    if p_to_status not in ('under_review', 'supported', 'disputed', 'rejected', 'retracted') then
      raise exception 'invalid claim status';
    end if;
    select status into v_from from public.intel_claims where id = p_subject_id and org_id = p_org for update;
    if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
    if p_to_status = 'supported' and not exists (
      select 1 from public.intel_claim_evidence ce join public.intel_evidence e on e.id = ce.evidence_id
      where ce.claim_id = p_subject_id and ce.stance = 'supports' and e.review_status = 'accepted'
    ) then
      raise exception 'a supported claim needs at least one accepted supporting evidence item';
    end if;
    update public.intel_claims
       set status = p_to_status, confidence = coalesce(p_confidence, confidence), reviewed_by = p_actor,
           reviewed_at = now(), updated_at = now(),
           visibility = case when p_to_status = 'supported' then coalesce(p_visibility, visibility) else 'private' end
     where id = p_subject_id;
  else
    raise exception 'subject_type must be evidence or claim';
  end if;

  insert into public.intel_reviews (org_id, subject_type, subject_id, from_status, to_status, confidence, reviewer_id, note)
  values (p_org, p_subject_type, p_subject_id, v_from, p_to_status, p_confidence, p_actor, left(p_note, 2000));
  return jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id, 'from', v_from, 'to', p_to_status);
end
$$;

-- Create a claim and its stance-bearing evidence links in one step.
create or replace function public.intel_create_claim(
  p_org uuid, p_actor uuid, p_statement text, p_subject_kind text, p_purpose text, p_links jsonb,
  p_region_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_claim uuid; v_link jsonb; v_count integer := 0;
begin
  if coalesce(jsonb_typeof(p_links), '') <> 'array' or jsonb_array_length(p_links) = 0 then
    raise exception 'a claim needs at least one evidence link';
  end if;
  insert into public.intel_claims (org_id, statement, subject_kind, purpose, status, region_label, created_by)
  values (p_org, p_statement, p_subject_kind, p_purpose, 'under_review', p_region_label, p_actor)
  returning id into v_claim;
  for v_link in select value from jsonb_array_elements(p_links) loop
    if not exists (
      select 1 from public.intel_evidence e
      where e.id = (v_link->>'evidence_id')::uuid and e.org_id = p_org and e.review_status <> 'rejected'
    ) then
      raise exception 'evidence % is not usable in this org', v_link->>'evidence_id';
    end if;
    insert into public.intel_claim_evidence (org_id, claim_id, evidence_id, stance, note, added_by)
    values (p_org, v_claim, (v_link->>'evidence_id')::uuid, v_link->>'stance', left(v_link->>'note', 2000), p_actor);
    v_count := v_count + 1;
  end loop;
  insert into public.intel_reviews (org_id, subject_type, subject_id, from_status, to_status, reviewer_id, note)
  values (p_org, 'claim', v_claim, null, 'under_review', p_actor, 'created');
  return jsonb_build_object('claim_id', v_claim, 'status', 'under_review', 'evidence_links', v_count);
end
$$;

-- Create a final briefing whose citations must all resolve to stored,
-- non-rejected records in the same org. Freshness comes from the evidence.
create or replace function public.intel_create_briefing(
  p_org uuid, p_actor uuid, p_title text, p_body text, p_citations jsonb, p_drafting text default 'human'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_briefing uuid; v_c jsonb; v_ordinal integer := 0;
  v_claim uuid; v_evidence uuid; v_oldest timestamptz; v_newest timestamptz;
begin
  if coalesce(jsonb_typeof(p_citations), '') <> 'array' or jsonb_array_length(p_citations) = 0 then
    raise exception 'a briefing needs at least one citation';
  end if;
  insert into public.intel_briefings (org_id, title, body, status, drafting, author_id)
  values (p_org, p_title, p_body, 'final', coalesce(p_drafting, 'human'), p_actor)
  returning id into v_briefing;
  for v_c in select value from jsonb_array_elements(p_citations) loop
    v_ordinal := v_ordinal + 1;
    v_claim := nullif(v_c->>'claim_id', '')::uuid;
    v_evidence := nullif(v_c->>'evidence_id', '')::uuid;
    if v_claim is not null and not exists (
      select 1 from public.intel_claims where id = v_claim and org_id = p_org and status not in ('rejected', 'retracted')
    ) then raise exception 'cited claim % is not usable', v_claim; end if;
    if v_evidence is not null and not exists (
      select 1 from public.intel_evidence where id = v_evidence and org_id = p_org and review_status <> 'rejected'
    ) then raise exception 'cited evidence % is not usable', v_evidence; end if;
    insert into public.intel_briefing_citations (org_id, briefing_id, ordinal, claim_id, evidence_id, locator)
    values (p_org, v_briefing, v_ordinal, v_claim, v_evidence, left(v_c->>'locator', 500));
  end loop;

  select min(e.retrieved_at), max(e.retrieved_at) into v_oldest, v_newest
  from public.intel_evidence e
  where e.org_id = p_org and e.id in (
    select bc.evidence_id from public.intel_briefing_citations bc where bc.briefing_id = v_briefing and bc.evidence_id is not null
    union
    select ce.evidence_id from public.intel_briefing_citations bc
      join public.intel_claim_evidence ce on ce.claim_id = bc.claim_id
     where bc.briefing_id = v_briefing
  );
  update public.intel_briefings set evidence_oldest_at = v_oldest, evidence_newest_at = v_newest where id = v_briefing;
  return jsonb_build_object('briefing_id', v_briefing, 'citations', v_ordinal,
    'evidence_oldest_at', v_oldest, 'evidence_newest_at', v_newest);
end
$$;

-- Record what a (proposed) decision relied on. The decision must exist in
-- ai_context.decisions for the same org.
create or replace function public.intel_record_decision_basis(
  p_org uuid, p_actor uuid, p_decision uuid, p_briefing uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  if not exists (select 1 from ai_context.decisions d where d.id = p_decision and d.org_id = p_org) then
    raise exception 'decision not found in this org' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.intel_briefings b where b.id = p_briefing and b.org_id = p_org and b.status = 'final') then
    raise exception 'briefing is not final in this org';
  end if;
  insert into public.intel_decision_basis (org_id, decision_id, briefing_id, recorded_by)
  values (p_org, p_decision, p_briefing, p_actor)
  on conflict do nothing;
  insert into public.intel_decision_basis (org_id, decision_id, claim_id, recorded_by)
  select distinct p_org, p_decision, bc.claim_id, p_actor
  from public.intel_briefing_citations bc where bc.briefing_id = p_briefing and bc.claim_id is not null
  on conflict do nothing;
  insert into public.intel_decision_basis (org_id, decision_id, evidence_id, recorded_by)
  select distinct p_org, p_decision, bc.evidence_id, p_actor
  from public.intel_briefing_citations bc where bc.briefing_id = p_briefing and bc.evidence_id is not null
  on conflict do nothing;
  select count(*) into v_rows from public.intel_decision_basis where decision_id = p_decision;
  return jsonb_build_object('decision_id', p_decision, 'basis_items', v_rows);
end
$$;

-- Create a mission from an APPROVED decision. The approval check and the
-- insert happen in one transaction; the mission is created as 'draft' so
-- publishing it to members stays a separate, deliberate admin act.
create or replace function public.intel_create_mission_from_decision(
  p_org uuid, p_actor uuid, p_decision uuid, p_idempotency_key text, p_mission jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text; v_existing public.intel_mission_decisions%rowtype; v_mission uuid;
begin
  select * into v_existing from public.intel_mission_decisions where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.decision_id <> p_decision then raise exception 'idempotency key reused for a different decision'; end if;
    return jsonb_build_object('mission_id', v_existing.mission_id, 'decision_id', p_decision, 'created', false);
  end if;

  select d.status into v_status from ai_context.decisions d where d.id = p_decision and d.org_id = p_org for share;
  if v_status is null then raise exception 'decision not found in this org' using errcode = 'P0002'; end if;
  if v_status <> 'approved' then raise exception 'decision is %, not approved', v_status using errcode = '42501'; end if;

  insert into public.action_missions (title, description, domain, status, proof_required, verification_mode)
  values (
    left(p_mission->>'title', 160), coalesce(p_mission->>'description', ''),
    coalesce(p_mission->>'domain', 'community'), 'draft', true, 'review'
  )
  returning id into v_mission;

  insert into public.intel_mission_decisions (mission_id, org_id, decision_id, objectives, scope, region_label, target_measures, idempotency_key, linked_by)
  values (
    v_mission, p_org, p_decision,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_mission->'objectives', '[]'::jsonb))), '{}'),
    p_mission->>'scope', p_mission->>'region_label', coalesce(p_mission->'target_measures', '{}'::jsonb),
    p_idempotency_key, p_actor
  );
  return jsonb_build_object('mission_id', v_mission, 'decision_id', p_decision, 'created', true, 'mission_status', 'draft');
end
$$;

-- Submit an outcome for a decision-linked mission. Every cited proof must
-- belong to an assignment on that mission.
create or replace function public.intel_submit_outcome(
  p_org uuid, p_actor uuid, p_mission uuid, p_idempotency_key text, p_summary text,
  p_occurred_at timestamptz, p_measures jsonb, p_proof_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_link public.intel_mission_decisions%rowtype; v_outcome uuid; v_existing uuid;
begin
  select id into v_existing from public.intel_outcomes where org_id = p_org and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('outcome_id', v_existing, 'created', false);
  end if;
  select * into v_link from public.intel_mission_decisions where mission_id = p_mission and org_id = p_org;
  if not found then raise exception 'mission is not linked to a decision in this org' using errcode = 'P0002'; end if;
  if coalesce(array_length(p_proof_ids, 1), 0) = 0 then raise exception 'an outcome needs at least one proof'; end if;
  if exists (
    select 1 from unnest(p_proof_ids) as pid(id)
    where not exists (
      select 1 from public.action_proofs pr join public.action_mission_assignments a on a.id = pr.assignment_id
      where pr.id = pid.id and a.mission_id = p_mission
    )
  ) then
    raise exception 'every proof must belong to this mission';
  end if;
  insert into public.intel_outcomes (org_id, mission_id, decision_id, summary, occurred_at, measures, submitted_by, idempotency_key)
  values (p_org, p_mission, v_link.decision_id, p_summary, p_occurred_at, coalesce(p_measures, '{}'::jsonb), p_actor, p_idempotency_key)
  returning id into v_outcome;
  insert into public.intel_outcome_proofs (org_id, outcome_id, proof_id)
  select p_org, v_outcome, pid from unnest(p_proof_ids) as pid;
  insert into public.intel_reviews (org_id, subject_type, subject_id, from_status, to_status, reviewer_id, note)
  values (p_org, 'outcome', v_outcome, null, 'submitted', p_actor, 'submitted');
  return jsonb_build_object('outcome_id', v_outcome, 'created', true, 'status', 'submitted');
end
$$;

-- Review an outcome. Accepting needs at least one VERIFIED proof; an accepted
-- outcome becomes evidence (kind mission_outcome) and may be attached to a
-- claim with a stance, closing the loop.
create or replace function public.intel_review_outcome(
  p_org uuid, p_actor uuid, p_outcome uuid, p_status text, p_note text default null,
  p_claim uuid default null, p_stance text default 'supports'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_outcome public.intel_outcomes%rowtype; v_evidence uuid; v_hash text;
begin
  if p_status not in ('accepted', 'rejected') then raise exception 'status must be accepted or rejected'; end if;
  select * into v_outcome from public.intel_outcomes where id = p_outcome and org_id = p_org for update;
  if not found then raise exception 'outcome not found' using errcode = 'P0002'; end if;
  if v_outcome.status <> 'submitted' then raise exception 'outcome already reviewed'; end if;
  if p_status = 'accepted' and not exists (
    select 1 from public.intel_outcome_proofs op join public.action_proofs pr on pr.id = op.proof_id
    where op.outcome_id = p_outcome and pr.status = 'verified'
  ) then
    raise exception 'an accepted outcome needs at least one verified proof';
  end if;

  update public.intel_outcomes
     set status = p_status, reviewed_by = p_actor, reviewed_at = now(), review_note = left(p_note, 2000)
   where id = p_outcome;
  insert into public.intel_reviews (org_id, subject_type, subject_id, from_status, to_status, reviewer_id, note)
  values (p_org, 'outcome', p_outcome, 'submitted', p_status, p_actor, left(p_note, 2000));

  if p_status = 'accepted' then
    v_hash := encode(sha256(convert_to(jsonb_build_object(
      'outcome', v_outcome.id, 'summary', v_outcome.summary, 'measures', v_outcome.measures,
      'occurred_at', v_outcome.occurred_at)::text, 'UTF8')), 'hex');
    insert into public.intel_evidence (
      org_id, kind, outcome_id, title, summary, publisher, license, retrieved_at, observed_at,
      content_sha256, measures, review_status, reviewed_by, reviewed_at
    ) values (
      p_org, 'mission_outcome', v_outcome.id, left('Mission outcome: ' || v_outcome.summary, 500), v_outcome.summary,
      'McCluster mission review', 'internal', now(), v_outcome.occurred_at, v_hash, v_outcome.measures,
      'accepted', p_actor, now()
    )
    returning id into v_evidence;
    if p_claim is not null then
      if not exists (select 1 from public.intel_claims where id = p_claim and org_id = p_org) then
        raise exception 'claim not found in this org';
      end if;
      insert into public.intel_claim_evidence (org_id, claim_id, evidence_id, stance, note, added_by)
      values (p_org, p_claim, v_evidence, coalesce(p_stance, 'supports'), 'mission outcome', p_actor);
    end if;
  end if;
  return jsonb_build_object('outcome_id', p_outcome, 'status', p_status, 'evidence_id', v_evidence, 'claim_id', p_claim);
end
$$;

-- Lineage from a claim forward: evidence -> briefings -> decisions ->
-- missions -> outcomes (and the evidence those outcomes fed back).
create or replace function public.intel_lineage(p_org uuid, p_claim uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with claim as (
    select * from public.intel_claims where id = p_claim and org_id = p_org
  ), ev as (
    select ce.stance, e.* from public.intel_claim_evidence ce
    join public.intel_evidence e on e.id = ce.evidence_id
    where ce.claim_id = p_claim and ce.org_id = p_org
  ), br as (
    select distinct b.* from public.intel_briefings b
    join public.intel_briefing_citations bc on bc.briefing_id = b.id
    where b.org_id = p_org and (bc.claim_id = p_claim or bc.evidence_id in (select id from ev))
  ), decs as (
    select distinct d.id, d.title, d.status, d.approved_by, d.approved_at, d.rationale_summary, d.risk_class, d.created_at
    from public.intel_decision_basis db join ai_context.decisions d on d.id = db.decision_id
    where db.org_id = p_org and d.org_id = p_org
      and (db.claim_id = p_claim or db.briefing_id in (select id from br) or db.evidence_id in (select id from ev))
  ), mis as (
    select md.*, m.title, m.status from public.intel_mission_decisions md
    join public.action_missions m on m.id = md.mission_id
    where md.org_id = p_org and md.decision_id in (select id from decs)
  ), oc as (
    select o.*, (select coalesce(jsonb_agg(op.proof_id), '[]'::jsonb) from public.intel_outcome_proofs op where op.outcome_id = o.id) as proof_ids,
           (select e.id from public.intel_evidence e where e.outcome_id = o.id) as feedback_evidence_id
    from public.intel_outcomes o where o.org_id = p_org and o.mission_id in (select mission_id from mis)
  )
  select case when not exists (select 1 from claim) then null else jsonb_build_object(
    'claim', (select jsonb_build_object('id', id, 'statement', statement, 'status', status, 'confidence', confidence,
                                        'subject_kind', subject_kind, 'purpose', purpose) from claim),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'stance', stance, 'title', title,
              'publisher', publisher, 'source_url', source_url, 'license', license, 'retrieved_at', retrieved_at,
              'content_sha256', content_sha256, 'review_status', review_status, 'source_record_id', source_record_id,
              'outcome_id', outcome_id) order by retrieved_at) from ev), '[]'::jsonb),
    'briefings', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status, 'as_of', as_of,
              'evidence_oldest_at', evidence_oldest_at, 'evidence_newest_at', evidence_newest_at,
              'citations', (select jsonb_agg(jsonb_build_object('ordinal', ordinal, 'claim_id', claim_id, 'evidence_id', evidence_id, 'locator', locator) order by ordinal)
                            from public.intel_briefing_citations c where c.briefing_id = br.id)) order by created_at) from br), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(to_jsonb(decs) order by created_at) from decs), '[]'::jsonb),
    'missions', coalesce((select jsonb_agg(jsonb_build_object('mission_id', mission_id, 'decision_id', decision_id, 'title', title,
              'status', status, 'objectives', objectives, 'scope', scope, 'region_label', region_label,
              'target_measures', target_measures) order by linked_at) from mis), '[]'::jsonb),
    'outcomes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'mission_id', mission_id, 'decision_id', decision_id,
              'summary', summary, 'occurred_at', occurred_at, 'measures', measures, 'status', status,
              'proof_ids', proof_ids, 'feedback_evidence_id', feedback_evidence_id) order by created_at) from oc), '[]'::jsonb)
  ) end
$$;

-- Privacy-safe geographic aggregate for the globe. Buckets are grid cells of
-- p_cell_deg degrees x a time bucket. Only rows the audience may see are
-- counted; cells below the k floor are suppressed (counted, not drawn);
-- rows without source-published coordinates are counted as 'unknown' and
-- never placed. Cell centres are bucket labels, not record locations.
create or replace function public.intel_geo_projection(
  p_org uuid, p_audience text, p_since timestamptz, p_until timestamptz,
  p_cell_deg integer default 10, p_time_bucket text default 'day', p_k integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_k integer;
  v_vis text[];
  v_result jsonb;
begin
  if p_audience not in ('owner', 'members', 'public') then raise exception 'invalid audience'; end if;
  if p_cell_deg not in (1, 5, 10, 30) then raise exception 'cell_deg must be 1, 5, 10 or 30'; end if;
  if p_time_bucket not in ('hour', 'day', 'week') then raise exception 'time_bucket must be hour, day or week'; end if;
  if p_until <= p_since or p_until - p_since > interval '92 days' then raise exception 'window must be positive and at most 92 days'; end if;
  -- the k floor is never below 5 for members or the public
  v_k := case when p_audience = 'owner' then 1 else greatest(coalesce(p_k, 5), 5) end;
  v_vis := case p_audience when 'owner' then array['private', 'members', 'public']
                           when 'members' then array['members', 'public']
                           else array['public'] end;

  with vis as (
    select e.lat, e.lon, coalesce(e.observed_at, e.retrieved_at) as t
    from public.intel_evidence e
    where e.org_id = p_org and e.visibility = any(v_vis)
      and (p_audience = 'owner' or e.review_status = 'accepted')
      and e.review_status <> 'rejected'
      and coalesce(e.observed_at, e.retrieved_at) >= p_since and coalesce(e.observed_at, e.retrieved_at) < p_until
  ), cells as (
    select floor(lat / p_cell_deg)::integer as cy, floor(lon / p_cell_deg)::integer as cx,
           date_trunc(p_time_bucket, t) as bucket, count(*)::integer as n
    from vis where lat is not null
    group by 1, 2, 3
  )
  select jsonb_build_object(
    'audience', p_audience, 'k_threshold', v_k, 'cell_deg', p_cell_deg, 'time_bucket', p_time_bucket,
    'since', p_since, 'until', p_until,
    'totals', jsonb_build_object(
      'records', (select count(*) from vis),
      'located', (select count(*) from vis where lat is not null),
      'unknown_location', (select count(*) from vis where lat is null),
      'suppressed_records', coalesce((select sum(n) from cells where n < v_k), 0),
      'suppressed_buckets', (select count(*) from cells where n < v_k)
    ),
    'buckets', coalesce((select jsonb_agg(jsonb_build_object(
        'cell', format('g%s:%s:%s', p_cell_deg, cy, cx),
        'cell_center', jsonb_build_object('lat', (cy + 0.5) * p_cell_deg, 'lon', (cx + 0.5) * p_cell_deg),
        'cell_bounds', jsonb_build_array(cx * p_cell_deg, cy * p_cell_deg, (cx + 1) * p_cell_deg, (cy + 1) * p_cell_deg),
        'bucket_start', bucket, 'count', n) order by bucket, cy, cx)
      from cells where n >= v_k), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;

-- Counts and collector health: stored totals vs latest run vs failures.
create or replace function public.intel_health(p_org uuid, p_connector_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select * from public.ops_ingest_connectors where org_id = p_org and connector_key = p_connector_key
  ), latest as (
    select r.* from public.ops_ingest_runs r join c on c.id = r.connector_id order by r.started_at desc limit 1
  ), last_ok as (
    select r.* from public.ops_ingest_runs r join c on c.id = r.connector_id
    where r.status in ('succeeded', 'partial') order by r.started_at desc limit 1
  )
  select jsonb_build_object(
    'connector', (select jsonb_build_object('id', id, 'key', connector_key, 'enabled', enabled, 'cursor', cursor,
                   'last_sync_at', last_sync_at, 'last_ok_at', last_ok_at, 'last_error', last_error, 'last_error_at', last_error_at) from c),
    'stored', jsonb_build_object(
      'source_records', (select count(*) from public.ops_ingest_records r join c on c.id = r.connector_id),
      'evidence_total', (select count(*) from public.intel_evidence where org_id = p_org),
      'evidence_by_review', coalesce((select jsonb_object_agg(review_status, n) from (
          select review_status, count(*) n from public.intel_evidence where org_id = p_org group by 1) s), '{}'::jsonb),
      'claims', (select count(*) from public.intel_claims where org_id = p_org),
      'briefings', (select count(*) from public.intel_briefings where org_id = p_org),
      'decisions_with_basis', (select count(distinct decision_id) from public.intel_decision_basis where org_id = p_org),
      'missions_from_decisions', (select count(*) from public.intel_mission_decisions where org_id = p_org),
      'outcomes', (select count(*) from public.intel_outcomes where org_id = p_org)
    ),
    'latest_run', (select jsonb_build_object('id', id, 'status', status, 'started_at', started_at, 'finished_at', finished_at,
                   'records_seen', records_seen, 'records_written', records_written, 'records_rejected', records_rejected,
                   'error', error) from latest),
    'last_successful_run', (select jsonb_build_object('id', id, 'status', status, 'started_at', started_at,
                   'records_written', records_written) from last_ok),
    'failures', jsonb_build_object(
      'last_7d', (select count(*) from public.ops_ingest_runs r join c on c.id = r.connector_id
                  where r.status = 'failed' and r.started_at > now() - interval '7 days'),
      'runs_last_7d', (select count(*) from public.ops_ingest_runs r join c on c.id = r.connector_id
                  where r.started_at > now() - interval '7 days')
    )
  )
$$;

-- Retention: delete expired evidence that nothing cites. Cited evidence is
-- kept (the FKs would refuse anyway) so a decision never loses its basis.
-- Not scheduled by this migration.
create or replace function public.intel_prune_expired_evidence(p_org uuid, p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  with doomed as (
    select e.id from public.intel_evidence e
    where e.org_id = p_org and e.retention_until is not null and e.retention_until < now()
      and not exists (select 1 from public.intel_claim_evidence ce where ce.evidence_id = e.id)
      and not exists (select 1 from public.intel_briefing_citations bc where bc.evidence_id = e.id)
      and not exists (select 1 from public.intel_decision_basis db where db.evidence_id = e.id)
    limit greatest(1, least(coalesce(p_limit, 1000), 10000))
  )
  delete from public.intel_evidence e using doomed where e.id = doomed.id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

do $fn$
declare f text;
begin
  foreach f in array array[
    'public.intel_decision_state(uuid, uuid)',
    'public.intel_collector_begin(uuid, text, jsonb, integer)',
    'public.intel_collector_fail(uuid, uuid, text, jsonb)',
    'public.intel_collector_commit(uuid, uuid, jsonb, jsonb, jsonb)',
    'public.intel_review(uuid, uuid, text, uuid, text, text, numeric, text)',
    'public.intel_create_claim(uuid, uuid, text, text, text, jsonb, text)',
    'public.intel_create_briefing(uuid, uuid, text, text, jsonb, text)',
    'public.intel_record_decision_basis(uuid, uuid, uuid, uuid)',
    'public.intel_create_mission_from_decision(uuid, uuid, uuid, text, jsonb)',
    'public.intel_submit_outcome(uuid, uuid, uuid, text, text, timestamptz, jsonb, uuid[])',
    'public.intel_review_outcome(uuid, uuid, uuid, text, text, uuid, text)',
    'public.intel_lineage(uuid, uuid)',
    'public.intel_geo_projection(uuid, text, timestamptz, timestamptz, integer, text, integer)',
    'public.intel_health(uuid, text)',
    'public.intel_prune_expired_evidence(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$fn$;

comment on table public.intel_evidence is
  'Reviewable evidence: a stored source snapshot (ops_ingest_records), an accepted mission outcome, or a document. Coordinates only when the source published them. Private by default; members/public see only intel_geo_projection aggregates.';
comment on table public.intel_claims is
  'Analytical claims with stance-bearing evidence. No person-level subjects and no electoral purpose lane by design.';
comment on table public.intel_decision_basis is
  'What an ai_context.decisions row relied on (briefing, claims, evidence). Approver, time and rationale stay in ai_context.decisions.';
comment on table public.intel_mission_decisions is
  'Mission <- decision link, private. A link table so the anon-readable action_missions never carries a private decision id.';
comment on table public.intel_outcomes is
  'Mission outcomes with proof links and measures; an accepted outcome becomes intel_evidence (kind mission_outcome).';
