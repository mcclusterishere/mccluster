-- E=Up admin workspace: PRIVATE intake, snapshot and review store for the
-- Civic League, Companies & Finance and Sources & Review sections.
--
-- Owner direction, 2026-11-09: the first deeper E=Up release is admin-only.
-- The existing civic schema (20261014021057_civic_global_discovery) grants
-- anon/authenticated SELECT on verified civic rows, and action_policy_bills has
-- a public using(true) read policy, so an admin import written there would be
-- public the moment it was marked verified. Nothing in this file touches those
-- tables; it creates a separate eup_* intake store in the same canonical
-- database. Publication to any public projection is a later, separately
-- authorised step and deliberately has no function here.
--
-- Boundaries: every table is service_role only (RLS on, no client policy,
-- anon/authenticated revoked). The Worker reaches the store only through the
-- eup_* functions below, after the house-owner check in workers/mccluster/src/eup.
-- Records are append-only evidence: a changed upstream record becomes a new
-- snapshot revision (and, for a bill, a new version row); corrections are new
-- rows that reference what they correct. A duplicate import (same raw hash) is
-- a no-op. Stale prior data is kept visibly stale; nothing is replaced by zero.
--
-- Source definitions live in code (workers/mccluster/src/eup/registry.js) and
-- mirror the planning inventory; this schema holds only their mutable state.
-- Idempotent: safe to run twice. Rollback: eup_intake_v1.rollback.sql.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- sources
create table if not exists public.eup_source_registry_state (
  source_id text primary key,
  configured boolean not null default false,
  access text not null default 'not_reviewed' check (access in ('not_reviewed','approved','held')),
  paused boolean not null default false,
  rights_revision text,
  rights_expires_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  next_run_at timestamptz,
  quota_reset_at timestamptz,
  quota_used integer not null default 0,
  records integer,            -- null = unknown, never a fabricated zero
  unresolved integer,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.eup_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  idempotency_key text not null,
  requested_by uuid,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','dead_letter','review')),
  attempt integer not null default 0,
  cursor jsonb not null default '{}'::jsonb,
  quota_used integer not null default 0,
  backoff_until timestamptz,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_id, idempotency_key)
);

-- --------------------------------------------------------------- snapshots
create table if not exists public.eup_record_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  source_record_id text not null,
  revision integer not null,
  raw_hash text,
  payload jsonb not null,
  provenance jsonb not null,
  superseded_by uuid references public.eup_record_snapshots(id),
  created_at timestamptz not null default now(),
  unique (source_id, source_record_id, revision)
);
create index if not exists eup_record_snapshots_record_idx on public.eup_record_snapshots (source_id, source_record_id, raw_hash);

create or replace function public.eup_snapshot_immutable() returns trigger
language plpgsql as $$
begin
  if new.payload is distinct from old.payload or new.provenance is distinct from old.provenance
     or new.raw_hash is distinct from old.raw_hash or new.revision is distinct from old.revision
     or new.source_id is distinct from old.source_id or new.source_record_id is distinct from old.source_record_id then
    raise exception 'eup_record_snapshots is append-only' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists eup_record_snapshots_immutable on public.eup_record_snapshots;
create trigger eup_record_snapshots_immutable before update on public.eup_record_snapshots
  for each row execute function public.eup_snapshot_immutable();

-- ------------------------------------------------------------------- civic
create table if not exists public.eup_civic_jurisdictions (
  id uuid primary key default gen_random_uuid(),
  source_id text not null, external_id text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  level text not null check (level in ('country','state','county','municipality','ward','district','other')),
  name text not null,
  parent_id uuid references public.eup_civic_jurisdictions(id),
  external_ids jsonb not null default '{}'::jsonb,
  review_state text not null default 'intake' check (review_state in ('intake','reviewed','corrected','superseded')),
  revision integer not null default 1,
  provenance jsonb not null,
  unique (source_id, external_id)
);
-- Overlapping relations (a district can span towns); ZIP codes are not districts.
create table if not exists public.eup_civic_jurisdiction_relations (
  parent_id uuid not null references public.eup_civic_jurisdictions(id),
  child_id uuid not null references public.eup_civic_jurisdictions(id),
  relation text not null check (relation in ('contains','overlaps')),
  provenance jsonb not null,
  primary key (parent_id, child_id, relation)
);
create table if not exists public.eup_civic_boundary_versions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.eup_civic_jurisdictions(id),
  source_id text not null, external_id text not null,
  vintage text not null,
  effective_from date, effective_to date,
  geometry_ref text,          -- a file/object reference, never geometry in this row
  provenance jsonb not null,
  unique (source_id, external_id),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create table if not exists public.eup_civic_offices (
  id uuid primary key default gen_random_uuid(),
  source_id text not null, external_id text not null,
  jurisdiction_id uuid not null references public.eup_civic_jurisdictions(id),
  title text not null, office_type text not null default 'other',
  seats integer not null default 1 check (seats >= 1),
  review_state text not null default 'intake' check (review_state in ('intake','reviewed','corrected','superseded')),
  revision integer not null default 1,
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_civic_persons (
  id uuid primary key default gen_random_uuid(),
  source_id text not null, external_id text not null,
  display_name text not null,
  external_ids jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_civic_terms (
  id uuid primary key default gen_random_uuid(),
  source_id text not null, external_id text not null,
  office_id uuid not null references public.eup_civic_offices(id),
  seat_label text not null default '1',
  person_id uuid references public.eup_civic_persons(id),  -- null = vacancy
  status text not null check (status in ('current','former','vacant','announced')),
  start_date date, end_date date,
  revision integer not null default 1,
  provenance jsonb not null,
  unique (source_id, external_id),
  check (end_date is null or start_date is null or end_date >= start_date),
  check ((status = 'vacant') = (person_id is null))
);
create table if not exists public.eup_civic_committees (
  id uuid primary key default gen_random_uuid(),
  source_id text not null, external_id text not null,
  jurisdiction_id uuid not null references public.eup_civic_jurisdictions(id),
  name text not null, chamber text,
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_civic_bills (
  id uuid primary key default gen_random_uuid(),
  source_id text not null, external_id text not null,
  jurisdiction_id uuid not null references public.eup_civic_jurisdictions(id),
  body text not null, session text not null, identifier text not null,
  title text not null,
  status text not null default 'unknown',
  enacted boolean not null default false,
  enacted_at date, effective_at date,
  review_state text not null default 'intake' check (review_state in ('intake','reviewed','corrected','superseded')),
  revision integer not null default 1,
  provenance jsonb not null,
  unique (source_id, external_id),
  unique (jurisdiction_id, body, session, identifier),
  check (enacted or enacted_at is null)
);
create table if not exists public.eup_civic_bill_versions (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.eup_civic_bills(id),
  version_number integer not null check (version_number >= 1),
  version_label text not null,
  text_hash text,
  published_at date,
  provenance jsonb not null,
  unique (bill_id, version_number)
);
create table if not exists public.eup_civic_bill_actions (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.eup_civic_bills(id),
  source_id text not null, external_id text not null,
  action_at date not null, chamber text, description text not null,
  committee_id uuid references public.eup_civic_committees(id),
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_civic_bill_amendments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.eup_civic_bills(id),
  source_id text not null, external_id text not null,
  label text not null, status text not null default 'proposed',
  applies_to_version integer,
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_civic_roll_calls (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.eup_civic_bills(id),
  source_id text not null, external_id text not null,
  chamber text, held_at date, question text,
  yeas integer, nays integer, not_voting integer,
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_civic_election_contests (
  id uuid primary key default gen_random_uuid(),
  source_id text not null, external_id text not null,
  jurisdiction_id uuid not null references public.eup_civic_jurisdictions(id),
  office_id uuid references public.eup_civic_offices(id),
  name text not null, election_date date not null,
  term_starts_on date,
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_civic_candidacies (
  id uuid primary key default gen_random_uuid(),
  source_id text not null, external_id text not null,
  contest_id uuid not null references public.eup_civic_election_contests(id),
  person_id uuid not null references public.eup_civic_persons(id),
  party text,
  registration_status text not null default 'registered' check (registration_status in ('registered','qualified','withdrawn','disqualified')),
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_civic_election_results (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.eup_civic_election_contests(id),
  candidacy_id uuid not null references public.eup_civic_candidacies(id),
  stage text not null check (stage in ('preliminary','canvassed','certified')),
  votes integer check (votes >= 0),
  certified_at date,
  provenance jsonb not null,
  unique (contest_id, candidacy_id, stage),
  check ((stage = 'certified') = (certified_at is not null))
);

-- --------------------------------------------------------------- companies
create table if not exists public.eup_company_entities (
  id uuid primary key default gen_random_uuid(),
  source_id text not null, external_id text not null,
  legal_name text not null,
  status text not null default 'unknown',
  review_state text not null default 'intake' check (review_state in ('intake','reviewed','corrected','superseded')),
  revision integer not null default 1,
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_company_identifiers (
  entity_id uuid not null references public.eup_company_entities(id),
  scheme text not null check (scheme in ('cik','lei','ticker')),
  value text not null,
  provenance jsonb not null,
  primary key (scheme, value)
);
create table if not exists public.eup_company_locations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.eup_company_entities(id),
  source_id text not null, external_id text not null,
  kind text not null check (kind in ('headquarters','registered_office','mailing_address','exchange','facility','place_of_performance')),
  address jsonb not null default '{}'::jsonb,
  lat double precision, lon double precision,
  geocode_precision text check (geocode_precision in ('rooftop','street','locality','region','country')),
  geocode_method text,
  effective_from date, effective_to date,
  provenance jsonb not null,
  unique (source_id, external_id),
  check ((lat is null) = (lon is null)),
  check (lat is null or (lat between -90 and 90 and lon between -180 and 180))
);
create table if not exists public.eup_company_facts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.eup_company_entities(id),
  source_id text not null, external_id text not null,
  concept text not null,
  period_start date, period_end date not null,
  unit text not null, currency text,
  value numeric not null,
  amended boolean not null default false,
  supersedes uuid references public.eup_company_facts(id),
  provenance jsonb not null,
  unique (source_id, external_id)
);
create table if not exists public.eup_company_awards (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.eup_company_entities(id),
  source_id text not null, external_id text not null,
  agency text not null, recipient text not null,
  obligation numeric, outlay numeric,
  period_start date, period_end date,
  place_of_performance jsonb not null default '{}'::jsonb,
  provenance jsonb not null,
  unique (source_id, external_id)
);

-- ------------------------------------------------------------------ review
create table if not exists public.eup_review_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('identity','geography','coverage','correction')),
  subject_table text not null, subject_key text not null,
  revision integer not null default 1,
  status text not null default 'open' check (status in ('open','resolved','rejected')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (kind, subject_table, subject_key)
);
create table if not exists public.eup_corrections (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references public.eup_review_items(id),
  idempotency_key text not null unique,
  expected_revision integer not null,
  correction jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ privileges
do $$
declare t text;
begin
  foreach t in array array['eup_source_registry_state','eup_import_runs','eup_record_snapshots',
    'eup_civic_jurisdictions','eup_civic_jurisdiction_relations','eup_civic_boundary_versions','eup_civic_offices',
    'eup_civic_persons','eup_civic_terms','eup_civic_committees','eup_civic_bills','eup_civic_bill_versions',
    'eup_civic_bill_actions','eup_civic_bill_amendments','eup_civic_roll_calls','eup_civic_election_contests',
    'eup_civic_candidacies','eup_civic_election_results','eup_company_entities','eup_company_identifiers',
    'eup_company_locations','eup_company_facts','eup_company_awards','eup_review_items','eup_corrections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);
  end loop;
end $$;

-- -------------------------------------------------------------- functions
-- Provenance must say where, when and under what rights a row came from.
create or replace function public.eup_check_provenance(p jsonb) returns jsonb
language plpgsql immutable as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'provenance_required' using errcode = '22023'; end if;
  foreach k in array array['source_id','source_record_id','url','fetched_at','parser_version','rights_revision','review_state','coverage'] loop
    if coalesce(p->>k, '') = '' then raise exception 'provenance_missing_%', k using errcode = '22023'; end if;
  end loop;
  if p->>'review_state' not in ('intake','reviewed','corrected','superseded') then raise exception 'provenance_review_state' using errcode = '22023'; end if;
  if p->>'coverage' not in ('full','partial','unknown') then raise exception 'provenance_coverage' using errcode = '22023'; end if;
  return p;
end $$;

-- A snapshot per upstream record revision. Same raw hash = duplicate = no-op.
create or replace function public.eup_record_snapshot(p_source_id text, p_record_id text, p_raw_hash text, p_payload jsonb, p_provenance jsonb)
returns jsonb language plpgsql security invoker as $$
declare existing public.eup_record_snapshots; latest public.eup_record_snapshots; next_rev integer; created_id uuid;
begin
  perform public.eup_check_provenance(p_provenance);
  perform pg_advisory_xact_lock(hashtext('eup_snapshot:' || p_source_id || ':' || p_record_id));
  if p_raw_hash is not null then
    select * into existing from public.eup_record_snapshots where source_id = p_source_id and source_record_id = p_record_id and raw_hash = p_raw_hash order by revision desc limit 1;
    if found then return jsonb_build_object('id', existing.id, 'revision', existing.revision, 'created', false); end if;
  end if;
  select * into latest from public.eup_record_snapshots where source_id = p_source_id and source_record_id = p_record_id order by revision desc limit 1;
  next_rev := coalesce(latest.revision, 0) + 1;
  insert into public.eup_record_snapshots (source_id, source_record_id, revision, raw_hash, payload, provenance)
    values (p_source_id, p_record_id, next_rev, p_raw_hash, p_payload, p_provenance) returning id into created_id;
  if latest.id is not null then update public.eup_record_snapshots set superseded_by = created_id where id = latest.id; end if;
  return jsonb_build_object('id', created_id, 'revision', next_rev, 'created', true);
end $$;

-- Refresh requests are idempotent per (source, key); a repeat returns the same run.
create or replace function public.eup_sources_command(p_action text, p_params jsonb, p_actor uuid)
returns jsonb language plpgsql security invoker as $$
declare run public.eup_import_runs; st public.eup_source_registry_state; item public.eup_review_items; corr public.eup_corrections; sid text; key text;
begin
  if p_actor is null then raise exception 'actor_required' using errcode = '22023'; end if;
  sid := p_params->>'source_id'; key := p_params->>'idempotency_key';
  if p_action = 'refresh' then
    if coalesce(sid,'') = '' or coalesce(key,'') = '' then raise exception 'source_and_key_required' using errcode = '22023'; end if;
    select * into st from public.eup_source_registry_state where source_id = sid for update;
    if not found or not st.configured or st.access <> 'approved' then raise exception 'not_configured' using errcode = 'P0001'; end if;
    if st.paused then raise exception 'source_paused' using errcode = 'P0001'; end if;
    insert into public.eup_import_runs (source_id, idempotency_key, requested_by) values (sid, key, p_actor)
      on conflict (source_id, idempotency_key) do nothing;
    select * into run from public.eup_import_runs where source_id = sid and idempotency_key = key;
    update public.eup_source_registry_state set last_attempt_at = now(), updated_at = now(), revision = revision + 1 where source_id = sid and run.created_at >= now() - interval '1 second';
    return jsonb_build_object('run_id', run.id, 'status', run.status, 'created', run.created_at >= now() - interval '1 second');
  elsif p_action = 'pause' or p_action = 'resume' then
    if coalesce(sid,'') = '' then raise exception 'source_required' using errcode = '22023'; end if;
    insert into public.eup_source_registry_state (source_id, paused) values (sid, p_action = 'pause')
      on conflict (source_id) do update set paused = excluded.paused, updated_at = now(), revision = public.eup_source_registry_state.revision + 1;
    select * into st from public.eup_source_registry_state where source_id = sid;
    return jsonb_build_object('source_id', st.source_id, 'paused', st.paused, 'revision', st.revision);
  elsif p_action = 'correct' then
    if coalesce(key,'') = '' then raise exception 'key_required' using errcode = '22023'; end if;
    select * into corr from public.eup_corrections where idempotency_key = key;
    if found then
      if corr.correction is distinct from (p_params->'correction') then raise exception 'idempotency_payload_mismatch' using errcode = '40001'; end if;
      select * into item from public.eup_review_items where id = corr.review_item_id;
      return jsonb_build_object('correction_id', corr.id, 'review_item_id', item.id, 'revision', item.revision, 'status', item.status, 'replayed', true);
    end if;
    select * into item from public.eup_review_items where id = (p_params->>'review_item_id')::uuid for update;
    if not found then raise exception 'review_item_not_found' using errcode = 'P0002'; end if;
    if item.revision <> (p_params->>'expected_revision')::integer then raise exception 'revision_conflict' using errcode = '40001'; end if;
    if item.status <> 'open' then raise exception 'review_item_closed' using errcode = '40001'; end if;
    insert into public.eup_corrections (review_item_id, idempotency_key, expected_revision, correction, created_by)
      values (item.id, key, item.revision, coalesce(p_params->'correction', '{}'::jsonb), p_actor) returning * into corr;
    update public.eup_review_items set status = 'resolved', revision = revision + 1, resolved_at = now() where id = item.id returning * into item;
    return jsonb_build_object('correction_id', corr.id, 'review_item_id', item.id, 'revision', item.revision, 'status', item.status, 'replayed', false);
  end if;
  raise exception 'unknown_action' using errcode = '22023';
end $$;

-- Read model for Sources & Review: state rows plus open review items.
create or replace function public.eup_sources_read(p_action text, p_params jsonb)
returns jsonb language sql stable security invoker as $$
  select case p_action
    when 'list' then coalesce((select jsonb_agg(to_jsonb(s) order by s.source_id) from public.eup_source_registry_state s), '[]'::jsonb)
    when 'runs' then coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (select * from public.eup_import_runs where source_id = p_params->>'source_id' order by created_at desc limit 50) r), '[]'::jsonb)
    when 'review' then jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from public.eup_review_items i where i.status = coalesce(p_params->>'status','open')), '[]'::jsonb),
      'corrections', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from (select * from public.eup_corrections order by created_at desc limit 100) c), '[]'::jsonb))
    else null end;
$$;

-- Read model for the Civic League. Rows carry their provenance; nothing here is a public projection.
create or replace function public.eup_civic_read(p_action text, p_params jsonb)
returns jsonb language plpgsql stable security invoker as $$
declare jid uuid; oid uuid; bid uuid; result jsonb;
begin
  if p_action = 'jurisdictions' then
    if coalesce(p_params->>'parent','none') = 'none' then
      select coalesce(jsonb_agg(to_jsonb(j) order by j.name), '[]'::jsonb) into result from public.eup_civic_jurisdictions j where j.parent_id is null;
    else
      jid := (p_params->>'parent')::uuid;
      select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb) into result from (
        select to_jsonb(j) || jsonb_build_object('relation', 'contains') as row from public.eup_civic_jurisdictions j where j.parent_id = jid
        union all
        select to_jsonb(j) || jsonb_build_object('relation', r.relation) from public.eup_civic_jurisdiction_relations r join public.eup_civic_jurisdictions j on j.id = r.child_id where r.parent_id = jid and j.parent_id is distinct from jid) q;
    end if;
    return result;
  elsif p_action = 'boundaries' then
    jid := (p_params->>'jurisdiction')::uuid;
    select coalesce(jsonb_agg(to_jsonb(b) order by b.vintage desc), '[]'::jsonb) into result from public.eup_civic_boundary_versions b where b.jurisdiction_id = jid; return result;
  elsif p_action = 'offices' then
    jid := (p_params->>'jurisdiction')::uuid;
    select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('vacant_seats', (select count(*) from public.eup_civic_terms t where t.office_id = o.id and t.status = 'vacant')) order by o.title), '[]'::jsonb)
      into result from public.eup_civic_offices o where o.jurisdiction_id = jid; return result;
  elsif p_action = 'terms' then
    oid := (p_params->>'office')::uuid;
    select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('person', case when p.id is null then null else jsonb_build_object('id', p.id, 'display_name', p.display_name, 'external_ids', p.external_ids) end) order by t.start_date desc nulls last), '[]'::jsonb)
      into result from public.eup_civic_terms t left join public.eup_civic_persons p on p.id = t.person_id where t.office_id = oid; return result;
  elsif p_action = 'bills' then
    jid := (p_params->>'jurisdiction')::uuid;
    select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object('versions', (select count(*) from public.eup_civic_bill_versions v where v.bill_id = b.id)) order by b.identifier), '[]'::jsonb)
      into result from public.eup_civic_bills b where b.jurisdiction_id = jid and (p_params->>'session' is null or b.session = p_params->>'session'); return result;
  elsif p_action = 'bill' then
    bid := (p_params->>'id')::uuid;
    select to_jsonb(b) || jsonb_build_object(
      'versions', coalesce((select jsonb_agg(to_jsonb(v) order by v.version_number) from public.eup_civic_bill_versions v where v.bill_id = b.id), '[]'::jsonb),
      'actions', coalesce((select jsonb_agg(to_jsonb(a) order by a.action_at) from public.eup_civic_bill_actions a where a.bill_id = b.id), '[]'::jsonb),
      'amendments', coalesce((select jsonb_agg(to_jsonb(m)) from public.eup_civic_bill_amendments m where m.bill_id = b.id), '[]'::jsonb),
      'roll_calls', coalesce((select jsonb_agg(to_jsonb(r) order by r.held_at) from public.eup_civic_roll_calls r where r.bill_id = b.id), '[]'::jsonb),
      'committees', coalesce((select jsonb_agg(distinct to_jsonb(c)) from public.eup_civic_bill_actions a join public.eup_civic_committees c on c.id = a.committee_id where a.bill_id = b.id), '[]'::jsonb),
      'law_status', case when b.enacted then 'enacted' else 'proposed' end)
      into result from public.eup_civic_bills b where b.id = bid; return result;
  elsif p_action = 'elections' then
    jid := (p_params->>'jurisdiction')::uuid;
    select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
      'candidacies', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('person', jsonb_build_object('id', p.id, 'display_name', p.display_name),
        'results', coalesce((select jsonb_agg(to_jsonb(r) order by r.stage) from public.eup_civic_election_results r where r.candidacy_id = c.id), '[]'::jsonb)))
        from public.eup_civic_candidacies c join public.eup_civic_persons p on p.id = c.person_id where c.contest_id = e.id), '[]'::jsonb),
      'certification', case when exists(select 1 from public.eup_civic_election_results r where r.contest_id = e.id and r.stage = 'certified') then 'certified'
        when exists(select 1 from public.eup_civic_election_results r where r.contest_id = e.id and r.stage = 'canvassed') then 'canvassed'
        when exists(select 1 from public.eup_civic_election_results r where r.contest_id = e.id) then 'preliminary' else 'no_results' end,
      'term_started', (e.term_starts_on is not null and e.term_starts_on <= current_date)) order by e.election_date desc), '[]'::jsonb)
      into result from public.eup_civic_election_contests e where e.jurisdiction_id = jid; return result;
  end if;
  raise exception 'unknown_action' using errcode = '22023';
end $$;

create or replace function public.eup_company_read(p_action text, p_params jsonb)
returns jsonb language plpgsql stable security invoker as $$
declare eid uuid; result jsonb;
begin
  if p_action = 'search' then
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'legal_name', e.legal_name, 'status', e.status, 'review_state', e.review_state,
      'identifiers', coalesce((select jsonb_agg(jsonb_build_object('scheme', i.scheme, 'value', i.value)) from public.eup_company_identifiers i where i.entity_id = e.id), '[]'::jsonb)) order by e.legal_name), '[]'::jsonb)
      into result from public.eup_company_entities e
      where e.legal_name ilike '%' || coalesce(p_params->>'q','') || '%'
         or exists (select 1 from public.eup_company_identifiers i where i.entity_id = e.id and i.value = coalesce(p_params->>'q',''))
      limit 50;
    return result;
  elsif p_action = 'get' then
    eid := (p_params->>'id')::uuid;
    select jsonb_build_object(
      'entity', to_jsonb(e),
      'identifiers', coalesce((select jsonb_agg(to_jsonb(i) - 'entity_id') from public.eup_company_identifiers i where i.entity_id = e.id), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(to_jsonb(l) order by l.kind) from public.eup_company_locations l where l.entity_id = e.id), '[]'::jsonb),
      'facts', coalesce((select jsonb_agg(to_jsonb(f) order by f.period_end desc, f.amended) from public.eup_company_facts f where f.entity_id = e.id), '[]'::jsonb),
      'awards', coalesce((select jsonb_agg(to_jsonb(a)) from public.eup_company_awards a where a.entity_id = e.id), '[]'::jsonb))
      into result from public.eup_company_entities e where e.id = eid;
    return result;
  end if;
  raise exception 'unknown_action' using errcode = '22023';
end $$;

-- Intake: apply parsed records of one kind from one source. Every record is
-- snapshotted; a duplicate (same raw hash) changes nothing; a changed record
-- bumps the entity revision and, for bill text, adds a version row. Geography
-- that cannot be resolved goes to review instead of being promoted.
create or replace function public.eup_intake_apply(p_source_id text, p_kind text, p_records jsonb)
returns jsonb language plpgsql security invoker as $$
declare rec jsonb; snap jsonb; applied integer := 0; duplicates integer := 0; reviewed integer := 0; prov jsonb;
        jid uuid; pid uuid; oid uuid; bid uuid; cid uuid; eid uuid; candid uuid; existing_rev integer; ext text; other uuid;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then raise exception 'records_array_required' using errcode = '22023'; end if;
  for rec in select * from jsonb_array_elements(p_records) loop
    ext := rec->>'external_id';
    prov := public.eup_check_provenance(rec->'provenance');
    if prov->>'source_id' <> p_source_id then raise exception 'provenance_source_mismatch' using errcode = '22023'; end if;
    snap := public.eup_record_snapshot(p_source_id, p_kind || ':' || ext, rec->>'raw_hash', rec - 'provenance' - 'raw_hash', prov);
    if not (snap->>'created')::boolean then duplicates := duplicates + 1; continue; end if;

    if p_kind = 'jurisdiction' then
      jid := null;
      if rec->>'parent_external_id' is not null then
        select id into jid from public.eup_civic_jurisdictions where source_id = p_source_id and external_id = rec->>'parent_external_id';
        if jid is null then
          insert into public.eup_review_items (kind, subject_table, subject_key, detail) values ('geography', 'eup_civic_jurisdictions', p_source_id || ':' || ext, jsonb_build_object('reason', 'unknown_parent', 'parent_external_id', rec->>'parent_external_id'))
            on conflict (kind, subject_table, subject_key) do update set revision = public.eup_review_items.revision + 1, status = 'open', detail = excluded.detail;
          reviewed := reviewed + 1; continue;
        end if;
      end if;
      insert into public.eup_civic_jurisdictions (source_id, external_id, country_code, level, name, parent_id, external_ids, provenance)
        values (p_source_id, ext, rec->>'country_code', rec->>'level', rec->>'name', jid, coalesce(rec->'external_ids','{}'::jsonb), prov)
        on conflict (source_id, external_id) do update set name = excluded.name, level = excluded.level, parent_id = excluded.parent_id, external_ids = excluded.external_ids,
          provenance = excluded.provenance, revision = public.eup_civic_jurisdictions.revision + 1, review_state = 'intake';
    elsif p_kind = 'jurisdiction_relation' then
      select id into jid from public.eup_civic_jurisdictions where source_id = p_source_id and external_id = rec->>'parent_external_id';
      select id into other from public.eup_civic_jurisdictions where source_id = p_source_id and external_id = rec->>'child_external_id';
      if jid is null or other is null then
        insert into public.eup_review_items (kind, subject_table, subject_key, detail) values ('geography', 'eup_civic_jurisdiction_relations', p_source_id || ':' || ext, jsonb_build_object('reason', 'unknown_endpoint'))
          on conflict (kind, subject_table, subject_key) do update set revision = public.eup_review_items.revision + 1, status = 'open';
        reviewed := reviewed + 1; continue;
      end if;
      insert into public.eup_civic_jurisdiction_relations (parent_id, child_id, relation, provenance) values (jid, other, rec->>'relation', prov) on conflict do nothing;
    elsif p_kind = 'boundary' then
      select id into jid from public.eup_civic_jurisdictions where source_id = p_source_id and external_id = rec->>'jurisdiction_external_id';
      if jid is null then
        insert into public.eup_review_items (kind, subject_table, subject_key, detail) values ('geography', 'eup_civic_boundary_versions', p_source_id || ':' || ext, jsonb_build_object('reason', 'unknown_jurisdiction'))
          on conflict (kind, subject_table, subject_key) do update set revision = public.eup_review_items.revision + 1, status = 'open';
        reviewed := reviewed + 1; continue;
      end if;
      insert into public.eup_civic_boundary_versions (jurisdiction_id, source_id, external_id, vintage, effective_from, effective_to, geometry_ref, provenance)
        values (jid, p_source_id, ext, rec->>'vintage', (rec->>'effective_from')::date, (rec->>'effective_to')::date, rec->>'geometry_ref', prov)
        on conflict (source_id, external_id) do update set effective_to = excluded.effective_to, geometry_ref = excluded.geometry_ref, provenance = excluded.provenance;
    elsif p_kind = 'office' then
      select id into jid from public.eup_civic_jurisdictions where source_id = p_source_id and external_id = rec->>'jurisdiction_external_id';
      if jid is null then
        insert into public.eup_review_items (kind, subject_table, subject_key, detail) values ('geography', 'eup_civic_offices', p_source_id || ':' || ext, jsonb_build_object('reason', 'unknown_jurisdiction'))
          on conflict (kind, subject_table, subject_key) do update set revision = public.eup_review_items.revision + 1, status = 'open';
        reviewed := reviewed + 1; continue;
      end if;
      insert into public.eup_civic_offices (source_id, external_id, jurisdiction_id, title, office_type, seats, provenance)
        values (p_source_id, ext, jid, rec->>'title', coalesce(rec->>'office_type','other'), coalesce((rec->>'seats')::integer, 1), prov)
        on conflict (source_id, external_id) do update set title = excluded.title, office_type = excluded.office_type, seats = excluded.seats, provenance = excluded.provenance, revision = public.eup_civic_offices.revision + 1;
    elsif p_kind = 'person' then
      insert into public.eup_civic_persons (source_id, external_id, display_name, external_ids, provenance)
        values (p_source_id, ext, rec->>'display_name', coalesce(rec->'external_ids','{}'::jsonb), prov)
        on conflict (source_id, external_id) do update set display_name = excluded.display_name, external_ids = excluded.external_ids, provenance = excluded.provenance, revision = public.eup_civic_persons.revision + 1;
    elsif p_kind = 'term' then
      select id into oid from public.eup_civic_offices where source_id = p_source_id and external_id = rec->>'office_external_id';
      if oid is null then raise exception 'unknown_office' using errcode = 'P0002'; end if;
      pid := null;
      if rec->>'person_external_id' is not null then
        select id into pid from public.eup_civic_persons where source_id = p_source_id and external_id = rec->>'person_external_id';
        if pid is null then raise exception 'unknown_person' using errcode = 'P0002'; end if;
      end if;
      insert into public.eup_civic_terms (source_id, external_id, office_id, seat_label, person_id, status, start_date, end_date, provenance)
        values (p_source_id, ext, oid, coalesce(rec->>'seat_label','1'), pid, rec->>'status', (rec->>'start_date')::date, (rec->>'end_date')::date, prov)
        on conflict (source_id, external_id) do update set person_id = excluded.person_id, status = excluded.status, start_date = excluded.start_date, end_date = excluded.end_date, provenance = excluded.provenance, revision = public.eup_civic_terms.revision + 1;
    elsif p_kind = 'committee' then
      select id into jid from public.eup_civic_jurisdictions where source_id = p_source_id and external_id = rec->>'jurisdiction_external_id';
      if jid is null then raise exception 'unknown_jurisdiction' using errcode = 'P0002'; end if;
      insert into public.eup_civic_committees (source_id, external_id, jurisdiction_id, name, chamber, provenance) values (p_source_id, ext, jid, rec->>'name', rec->>'chamber', prov)
        on conflict (source_id, external_id) do update set name = excluded.name, chamber = excluded.chamber, provenance = excluded.provenance;
    elsif p_kind = 'bill' then
      select id into jid from public.eup_civic_jurisdictions where source_id = p_source_id and external_id = rec->>'jurisdiction_external_id';
      if jid is null then raise exception 'unknown_jurisdiction' using errcode = 'P0002'; end if;
      insert into public.eup_civic_bills (source_id, external_id, jurisdiction_id, body, session, identifier, title, status, enacted, enacted_at, effective_at, provenance)
        values (p_source_id, ext, jid, rec->>'body', rec->>'session', rec->>'identifier', rec->>'title', coalesce(rec->>'status','unknown'), coalesce((rec->>'enacted')::boolean, false), (rec->>'enacted_at')::date, (rec->>'effective_at')::date, prov)
        on conflict (source_id, external_id) do update set title = excluded.title, status = excluded.status, enacted = excluded.enacted, enacted_at = excluded.enacted_at, effective_at = excluded.effective_at,
          provenance = excluded.provenance, revision = public.eup_civic_bills.revision + 1, review_state = 'intake'
        returning id into bid;
      -- a text version is append-only: a new text hash is a new version number
      if rec->>'text_hash' is not null and not exists (select 1 from public.eup_civic_bill_versions v where v.bill_id = bid and v.text_hash = rec->>'text_hash') then
        insert into public.eup_civic_bill_versions (bill_id, version_number, version_label, text_hash, published_at, provenance)
          values (bid, (select coalesce(max(version_number),0)+1 from public.eup_civic_bill_versions where bill_id = bid), coalesce(rec->>'version_label','text'), rec->>'text_hash', (rec->>'text_published_at')::date, prov);
      end if;
    elsif p_kind = 'bill_action' then
      select id into bid from public.eup_civic_bills where source_id = p_source_id and external_id = rec->>'bill_external_id';
      if bid is null then raise exception 'unknown_bill' using errcode = 'P0002'; end if;
      cid := null;
      if rec->>'committee_external_id' is not null then select id into cid from public.eup_civic_committees where source_id = p_source_id and external_id = rec->>'committee_external_id'; end if;
      insert into public.eup_civic_bill_actions (bill_id, source_id, external_id, action_at, chamber, description, committee_id, provenance)
        values (bid, p_source_id, ext, (rec->>'action_at')::date, rec->>'chamber', rec->>'description', cid, prov)
        on conflict (source_id, external_id) do update set description = excluded.description, provenance = excluded.provenance;
    elsif p_kind = 'bill_amendment' then
      select id into bid from public.eup_civic_bills where source_id = p_source_id and external_id = rec->>'bill_external_id';
      if bid is null then raise exception 'unknown_bill' using errcode = 'P0002'; end if;
      insert into public.eup_civic_bill_amendments (bill_id, source_id, external_id, label, status, applies_to_version, provenance)
        values (bid, p_source_id, ext, rec->>'label', coalesce(rec->>'status','proposed'), (rec->>'applies_to_version')::integer, prov)
        on conflict (source_id, external_id) do update set status = excluded.status, provenance = excluded.provenance;
    elsif p_kind = 'roll_call' then
      select id into bid from public.eup_civic_bills where source_id = p_source_id and external_id = rec->>'bill_external_id';
      if bid is null then raise exception 'unknown_bill' using errcode = 'P0002'; end if;
      insert into public.eup_civic_roll_calls (bill_id, source_id, external_id, chamber, held_at, question, yeas, nays, not_voting, provenance)
        values (bid, p_source_id, ext, rec->>'chamber', (rec->>'held_at')::date, rec->>'question', (rec->>'yeas')::integer, (rec->>'nays')::integer, (rec->>'not_voting')::integer, prov)
        on conflict (source_id, external_id) do update set yeas = excluded.yeas, nays = excluded.nays, not_voting = excluded.not_voting, provenance = excluded.provenance;
    elsif p_kind = 'election_contest' then
      select id into jid from public.eup_civic_jurisdictions where source_id = p_source_id and external_id = rec->>'jurisdiction_external_id';
      if jid is null then raise exception 'unknown_jurisdiction' using errcode = 'P0002'; end if;
      oid := null;
      if rec->>'office_external_id' is not null then select id into oid from public.eup_civic_offices where source_id = p_source_id and external_id = rec->>'office_external_id'; end if;
      insert into public.eup_civic_election_contests (source_id, external_id, jurisdiction_id, office_id, name, election_date, term_starts_on, provenance)
        values (p_source_id, ext, jid, oid, rec->>'name', (rec->>'election_date')::date, (rec->>'term_starts_on')::date, prov)
        on conflict (source_id, external_id) do update set name = excluded.name, term_starts_on = excluded.term_starts_on, provenance = excluded.provenance;
    elsif p_kind = 'candidacy' then
      select id into cid from public.eup_civic_election_contests where source_id = p_source_id and external_id = rec->>'contest_external_id';
      select id into pid from public.eup_civic_persons where source_id = p_source_id and external_id = rec->>'person_external_id';
      if cid is null or pid is null then raise exception 'unknown_contest_or_person' using errcode = 'P0002'; end if;
      insert into public.eup_civic_candidacies (source_id, external_id, contest_id, person_id, party, registration_status, provenance)
        values (p_source_id, ext, cid, pid, rec->>'party', coalesce(rec->>'registration_status','registered'), prov)
        on conflict (source_id, external_id) do update set party = excluded.party, registration_status = excluded.registration_status, provenance = excluded.provenance;
    elsif p_kind = 'election_result' then
      select id into candid from public.eup_civic_candidacies where source_id = p_source_id and external_id = rec->>'candidacy_external_id';
      if candid is null then raise exception 'unknown_candidacy' using errcode = 'P0002'; end if;
      select contest_id into cid from public.eup_civic_candidacies where id = candid;
      insert into public.eup_civic_election_results (contest_id, candidacy_id, stage, votes, certified_at, provenance)
        values (cid, candid, rec->>'stage', (rec->>'votes')::integer, (rec->>'certified_at')::date, prov)
        on conflict (contest_id, candidacy_id, stage) do update set votes = excluded.votes, certified_at = excluded.certified_at, provenance = excluded.provenance;
    elsif p_kind = 'company' then
      insert into public.eup_company_entities (source_id, external_id, legal_name, status, provenance)
        values (p_source_id, ext, rec->>'legal_name', coalesce(rec->>'status','unknown'), prov)
        on conflict (source_id, external_id) do update set legal_name = excluded.legal_name, status = excluded.status, provenance = excluded.provenance, revision = public.eup_company_entities.revision + 1
        returning id into eid;
      -- identifiers: a scheme/value already owned by a different entity is an identity conflict for review, not an overwrite
      for snap in select * from jsonb_array_elements(coalesce(rec->'identifiers','[]'::jsonb)) loop
        select entity_id into other from public.eup_company_identifiers where scheme = snap->>'scheme' and value = snap->>'value';
        if other is not null and other <> eid then
          insert into public.eup_review_items (kind, subject_table, subject_key, detail) values ('identity', 'eup_company_identifiers', (snap->>'scheme') || ':' || (snap->>'value'), jsonb_build_object('reason', 'identifier_claimed_by_other_entity', 'claimant', eid, 'owner', other))
            on conflict (kind, subject_table, subject_key) do update set revision = public.eup_review_items.revision + 1, status = 'open', detail = excluded.detail;
          reviewed := reviewed + 1;
        elsif other is null then
          insert into public.eup_company_identifiers (entity_id, scheme, value, provenance) values (eid, snap->>'scheme', snap->>'value', prov);
        end if;
      end loop;
    elsif p_kind = 'company_location' then
      select e.id into eid from public.eup_company_entities e join public.eup_company_identifiers i on i.entity_id = e.id where i.scheme = rec->>'identifier_scheme' and i.value = rec->>'identifier_value';
      if eid is null then raise exception 'unknown_company' using errcode = 'P0002'; end if;
      if rec->'geocode' is not null and jsonb_typeof(rec->'geocode') = 'object' and (
           (rec->'geocode'->>'lat')::double precision not between -90 and 90 or (rec->'geocode'->>'lon')::double precision not between -180 and 180) then
        insert into public.eup_review_items (kind, subject_table, subject_key, detail) values ('geography', 'eup_company_locations', p_source_id || ':' || ext, jsonb_build_object('reason', 'implausible_coordinates', 'geocode', rec->'geocode'))
          on conflict (kind, subject_table, subject_key) do update set revision = public.eup_review_items.revision + 1, status = 'open', detail = excluded.detail;
        reviewed := reviewed + 1; continue;
      end if;
      insert into public.eup_company_locations (entity_id, source_id, external_id, kind, address, lat, lon, geocode_precision, geocode_method, effective_from, effective_to, provenance)
        values (eid, p_source_id, ext, rec->>'kind', coalesce(rec->'address','{}'::jsonb), (rec->'geocode'->>'lat')::double precision, (rec->'geocode'->>'lon')::double precision, rec->'geocode'->>'precision', rec->'geocode'->>'method', (rec->>'effective_from')::date, (rec->>'effective_to')::date, prov)
        on conflict (source_id, external_id) do update set address = excluded.address, lat = excluded.lat, lon = excluded.lon, geocode_precision = excluded.geocode_precision, geocode_method = excluded.geocode_method, effective_to = excluded.effective_to, provenance = excluded.provenance;
    elsif p_kind = 'company_fact' then
      select e.id into eid from public.eup_company_entities e join public.eup_company_identifiers i on i.entity_id = e.id where i.scheme = rec->>'identifier_scheme' and i.value = rec->>'identifier_value';
      if eid is null then raise exception 'unknown_company' using errcode = 'P0002'; end if;
      -- a restatement of the same concept/period is a NEW fact that supersedes the old one; the old row stays
      select id into other from public.eup_company_facts f where f.entity_id = eid and f.concept = rec->>'concept' and f.period_end = (rec->>'period_end')::date
        and f.period_start is not distinct from (rec->>'period_start')::date and f.external_id <> ext order by f.provenance->>'fetched_at' desc limit 1;
      insert into public.eup_company_facts (entity_id, source_id, external_id, concept, period_start, period_end, unit, currency, value, amended, supersedes, provenance)
        values (eid, p_source_id, ext, rec->>'concept', (rec->>'period_start')::date, (rec->>'period_end')::date, rec->>'unit', rec->>'currency', (rec->>'value')::numeric, coalesce((rec->>'amended')::boolean, other is not null), other, prov)
        on conflict (source_id, external_id) do update set value = excluded.value, amended = excluded.amended, provenance = excluded.provenance;
    elsif p_kind = 'company_award' then
      eid := null;
      if rec->>'identifier_value' is not null then
        select e.id into eid from public.eup_company_entities e join public.eup_company_identifiers i on i.entity_id = e.id where i.scheme = rec->>'identifier_scheme' and i.value = rec->>'identifier_value';
      end if;
      insert into public.eup_company_awards (entity_id, source_id, external_id, agency, recipient, obligation, outlay, period_start, period_end, place_of_performance, provenance)
        values (eid, p_source_id, ext, rec->>'agency', rec->>'recipient', (rec->>'obligation')::numeric, (rec->>'outlay')::numeric, (rec->>'period_start')::date, (rec->>'period_end')::date, coalesce(rec->'place_of_performance','{}'::jsonb), prov)
        on conflict (source_id, external_id) do update set obligation = excluded.obligation, outlay = excluded.outlay, provenance = excluded.provenance;
    else
      raise exception 'unknown_kind' using errcode = '22023';
    end if;
    applied := applied + 1;
  end loop;
  return jsonb_build_object('applied', applied, 'duplicates', duplicates, 'reviewed', reviewed);
end $$;

-- Import-run outcome bookkeeping: a failure keeps the previous success and
-- record counts (stale, not zero); success updates them.
create or replace function public.eup_import_run_finish(p_run_id uuid, p_status text, p_records integer, p_error text, p_cursor jsonb)
returns jsonb language plpgsql security invoker as $$
declare run public.eup_import_runs;
begin
  if p_status not in ('completed','failed','dead_letter','review') then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.eup_import_runs set status = p_status, error = p_error, cursor = coalesce(p_cursor, cursor), finished_at = now(), attempt = attempt + 1 where id = p_run_id returning * into run;
  if not found then raise exception 'run_not_found' using errcode = 'P0002'; end if;
  insert into public.eup_source_registry_state (source_id) values (run.source_id) on conflict do nothing;
  if p_status = 'completed' then
    update public.eup_source_registry_state set last_attempt_at = now(), last_success_at = now(), last_error = null, records = p_records, updated_at = now(), revision = revision + 1 where source_id = run.source_id;
  else
    update public.eup_source_registry_state set last_attempt_at = now(), last_error = p_error, updated_at = now(), revision = revision + 1 where source_id = run.source_id;
  end if;
  return jsonb_build_object('run_id', run.id, 'status', run.status, 'attempt', run.attempt);
end $$;

do $$
declare f text;
begin
  foreach f in array array['eup_check_provenance(jsonb)','eup_record_snapshot(text,text,text,jsonb,jsonb)','eup_sources_command(text,jsonb,uuid)',
    'eup_sources_read(text,jsonb)','eup_civic_read(text,jsonb)','eup_company_read(text,jsonb)','eup_intake_apply(text,text,jsonb)',
    'eup_import_run_finish(uuid,text,integer,text,jsonb)','eup_snapshot_immutable()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

comment on table public.eup_record_snapshots is 'E=Up admin intake: immutable upstream record revisions with provenance; service_role only; never a public projection.';
