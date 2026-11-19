-- E=UP ENVIRONMENTAL EVENT STORE, version 1, part 01 of 05 (migration name eup_environment_events_v1_01): the schema.
-- One canonical, revisioned record per public government observation, the store behind the signed-out E=UP timeline,
-- its globe objects, selections and deep links (docs/control-plane/EUP-EVENT-TIMELINE.md, slice S1; reconciliation
-- decisions D5, D6, D7 and D12). This part: the pure helpers, the seven tables, their guards and their wall. Part 02 adds
-- the reads, 03 the ingest, 04 the owner's read and commands, 05 the coverage intake. Each part is one transaction of at
-- most 32,000 bytes (what one `apply_migration` call carries safely, supabase/pending/README.md), safe to run twice, and
-- refuses (55000), changing nothing, until the part before it is in.
--
-- PENDING. Not applied to production. Owner approval required. Applied only on the owner's separate approval of the exact
-- text of each part, independent of and after the mission publish (step 9 of docs/control-plane/WORLD-RELEASE-20261118.md),
-- with the Supabase MCP `apply_migration` (it runs as postgres) under the part's migration name, parts 01 to 05 in order,
-- one call per part and a read between parts; then promoted with the steps in supabase/pending/README.md.
-- Order and procedure: supabase/pending/PROMOTION-ORDER.md, section 12. Rollback (every part, however many ran):
-- 20261119100000_eup_environment_events_v1.rollback.sql. Proof before apply: scripts/test/eup-environment-events.integration.mjs
-- (PGlite) and scripts/test/eup-environment-events.native.integration.mjs (disposable PostgreSQL 16 and 17).
-- Part 01 needs the applied module policy (supabase/migrations/20261117144103_eup_module_policy_v1.sql): without it
-- it refuses (55000) and changes nothing.
--
-- APPLYING THE PARTS CHANGES NOTHING PUBLIC. They create no row. No shipped code calls these functions yet: the owner routes,
-- the ingest and the public routes are later slices. The ingest writes nothing until the house owner sets a provider
-- rule and the Worker's ingest flag is on, and every public read refuses until the owner installs and then enables the
-- environment module (EUM01 / EUM03, the module policy's own codes).
--
-- Defaults adopted pending the owner's confirmation (each can still change in these parts before they are applied):
--   D5  The canonical id is '<provider>:<the provider's preferred id when the store first saw the event>', never
--       reassigned. Every id the provider lists for the event is an alias, and a read by any alias answers the canonical
--       event. When the provider associates two stored events, the one published later becomes a redirect ('merged')
--       to the other.
--   D6  A new revision comes only from a substantive change: origin time (by 1 s or more; the default named no
--       threshold), location (1 km or more), depth (1 km or more), magnitude or its type, review status, tsunami flag,
--       PAGER alert, or deletion. USGS `updated` is kept and shown ("USGS updated") but never makes a revision by
--       itself, and neither do place wording or significance.
--   D7  USGS qualifies at M4.5+ worldwide, automatic events included (and shown as automatic), plus any event with USGS
--       significance above 600, a PAGER alert or a tsunami flag. It is an owner-adjustable rule with a revision. A rule
--       change applies from each event's next ingest; a published event is never unpublished by a rule change or by a
--       downward correction: it stays, with the correction shown.
--   D12 A provider deletion stays as a tombstone with no coordinates (so no globe object) and its deep link answers the
--       tombstone. An owner hold hides the event ("not available") and is logged. Corrections keep old -> new.
-- Not built here: the ingest of any provider but 'usgs', and the coverage matcher (the parts store, gate and retract
-- what a matcher proposes; a GDELT mention point can never be the basis of a match).
--
-- Objects (row level security on, no policy, no privilege for any API role; the functions below are the only door):
--   eup_environment_providers        per provider: ingest active|paused, publication shown|hidden, the rule, a revision
--   eup_environment_events           per canonical event: state, revision, the snapshot at that revision, its times
--   eup_environment_event_revisions  append-only: each revision's snapshot, change (old -> new), cause, source and fetch times
--   eup_environment_event_aliases    append-only: provider id -> canonical id
--   eup_environment_source_health    append-only, one row per ingest run; rows older than 30 days leave through the
--                                    ingest's own purge and no other way
--   eup_environment_decisions        append-only owner decision log: actor, command, target, expected revision, reason,
--                                    idempotency key, payload digest and receipt, as the module policy's command log
--   eup_environment_coverage         news coverage bound to a canonical event AND its revision; 'official_identifier'
--                                    attaches by itself and stays retractable, 'type_place_time' waits for the owner
-- Entry points (EXECUTE for service_role only; the Worker is the only caller), with the part that creates each:
--   eup_environment_ingest(provider, run_id, fetched_at, health, events)    one call per ingest run, idempotent per run id  [03]
--   eup_environment_ingest_state(provider, since, limit)                    the ingest's read: rule, switches, published events  [03]
--   eup_environment_public_events(since, until, cursor, limit)              a public timeline page, whitelisted fields  [02]
--   eup_environment_public_event(id)                                        one event by canonical id or any alias  [02]
--   eup_environment_owner_read(actor, event_id, limit)                      providers, health, review queue, decisions  [04]
--   eup_environment_owner_preview(actor, since, until, cursor, limit)       the public page while the module is off  [02]
--   eup_environment_owner_command(actor, command, target, expected_revision, key, reason, payload)  [04]
--   eup_environment_coverage_propose(proposals)                             what a coverage matcher found  [05]
-- Codes: 42501 house owner required; 22023 invalid input; 40001 the revision moved; 55P03 a lock wait over 5 s (nothing
--   changed); EUE01 provider not configured; EUE03 event or coverage not found; EUE04 not allowed from the current state;
--   EUE05 a run id reused with another payload; EUE06 an idempotency key reused with another command; EUE07 provider
--   refused (not a government provider, or not supported yet). Public reads: EUM00, EUM01, EUM03 as the module guard.
begin;
set local lock_timeout = '5s';

do $prerequisite$
begin
  if to_regclass('public.eup_module_policies') is null or to_regprocedure('public.eup_module_policy_read(text)') is null
     or to_regclass('public.orgs') is null or to_regclass('public.org_members') is null or to_regclass('auth.users') is null then
    raise exception 'eup_environment_events_v1 needs the applied module policy (20261117144103_eup_module_policy_v1) first'
      using errcode = '55000';
  end if;
end $prerequisite$;

-- ---------------------------------------------------------------- pure helpers (no table access)

-- The effective state of an event, from the facts that decide it. The events table's CHECK holds every row to it.
create or replace function public.eup_environment_state_of(p_merged_into text, p_held_at timestamptz,
  p_retracted_at timestamptz, p_withdrawn_at timestamptz, p_first_published_at timestamptz) returns text
language sql immutable security invoker set search_path = '' as $$
  select case when p_merged_into is not null then 'merged'
              when p_retracted_at is not null then 'retracted'
              when p_held_at is not null then 'held'
              when p_withdrawn_at is not null then 'withdrawn_by_source'
              when p_first_published_at is not null then 'published'
              else 'candidate' end
$$;

-- The one time format every answer uses: UTC, ISO 8601, milliseconds.
create or replace function public.eup_environment_iso_text(p timestamptz) returns text
language sql stable security invoker set search_path = '' as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- An ISO 8601 UTC string ('...Z') read from JSON, or null for anything else. Never raises.
create or replace function public.eup_environment_iso(p jsonb) returns timestamptz
language plpgsql stable security invoker set search_path = '' as $$
declare m text[]; y integer; mo integer; d integer;
begin
  if p is null or jsonb_typeof(p) is distinct from 'string' then return null; end if;
  m := regexp_match(p #>> '{}', '^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})([.][0-9]{1,6})?Z$');
  if m is null then return null; end if;
  y := m[1]::integer; mo := m[2]::integer; d := m[3]::integer;
  if y < 1900 or y > 2200 or mo < 1 or mo > 12 or d < 1 or m[4]::integer > 23 or m[5]::integer > 59 or m[6]::integer > 59 then
    return null;
  end if;
  if d > extract(day from (make_date(y, mo, 1) + interval '1 month' - interval '1 day'))::integer then return null; end if;
  return (p #>> '{}')::timestamptz;
end $$;

-- Great-circle distance in km (haversine on the mean Earth radius).
create or replace function public.eup_environment_km(p_lon1 numeric, p_lat1 numeric, p_lon2 numeric, p_lat2 numeric)
returns double precision
language sql immutable strict security invoker set search_path = '' as $$
  select 2 * 6371.0088 * asin(least(1::double precision, sqrt(
      power(sin(radians((p_lat2 - p_lat1)::double precision) / 2), 2)
    + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
      * power(sin(radians((p_lon2 - p_lon1)::double precision) / 2), 2))))
$$;

create or replace function public.eup_environment_inc(p jsonb, p_key text) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select jsonb_set(p, array[p_key], to_jsonb(coalesce((p ->> p_key)::bigint, 0) + 1))
$$;

-- D7, the default publication rule (adopted pending the owner's confirmation). set_rule without a rule stores it.
create or replace function public.eup_environment_default_rule(p_provider text) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select case when p_provider = 'usgs' then
    '{"min_magnitude": 4.5, "include_automatic": true, "significance_above": 600, "pager_alert": true, "tsunami": true}'::jsonb end
$$;

-- A rule has exactly the five keys, each in range.
create or replace function public.eup_environment_rule_valid(p_provider text, p_rule jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare k text; n numeric;
begin
  if p_provider is distinct from 'usgs' or jsonb_typeof(p_rule) is distinct from 'object' then return false; end if;
  for k in select jsonb_object_keys(p_rule) loop
    if k not in ('min_magnitude', 'include_automatic', 'significance_above', 'pager_alert', 'tsunami') then return false; end if;
  end loop;
  if jsonb_typeof(p_rule -> 'min_magnitude') is distinct from 'number' then return false; end if;
  n := (p_rule ->> 'min_magnitude')::numeric;
  if n < 0 or n > 10 then return false; end if;
  if jsonb_typeof(p_rule -> 'include_automatic') is distinct from 'boolean' or jsonb_typeof(p_rule -> 'pager_alert') is distinct from 'boolean'
     or jsonb_typeof(p_rule -> 'tsunami') is distinct from 'boolean' then return false; end if;
  if jsonb_typeof(p_rule -> 'significance_above') = 'null' then return true; end if;
  if jsonb_typeof(p_rule -> 'significance_above') is distinct from 'number' then return false; end if;
  n := (p_rule ->> 'significance_above')::numeric;
  return n >= 0 and n <= 10000 and n = trunc(n);
end $$;

-- Does an event qualify for publication under a rule? (D7.) Deleted events never do.
create or replace function public.eup_environment_qualifies(p_provider text, p_rule jsonb, p_snapshot jsonb, p_significance integer)
returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_provider is distinct from 'usgs' or not coalesce(public.eup_environment_rule_valid(p_provider, p_rule), false)
     or jsonb_typeof(p_snapshot) is distinct from 'object' or coalesce(p_snapshot ->> 'status', '') not in ('automatic', 'reviewed') then
    return false;
  end if;
  if jsonb_typeof(p_snapshot -> 'magnitude') = 'number' then
    if (p_snapshot ->> 'magnitude')::numeric >= (p_rule ->> 'min_magnitude')::numeric
       and ((p_rule ->> 'include_automatic')::boolean or p_snapshot ->> 'status' = 'reviewed') then
      return true;
    end if;
  end if;
  if jsonb_typeof(p_rule -> 'significance_above') = 'number' and p_significance is not null then
    if p_significance > (p_rule ->> 'significance_above')::numeric then return true; end if;
  end if;
  if (p_rule ->> 'pager_alert')::boolean and jsonb_typeof(p_snapshot -> 'alert') = 'string' then return true; end if;
  if (p_rule ->> 'tsunami')::boolean and (p_snapshot -> 'tsunami') = 'true'::jsonb then return true; end if;
  return false;
end $$;

-- ---------------------------------------------------------------- tables

create table if not exists public.eup_environment_providers (
  provider text primary key check (provider in ('usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops')),
  ingest text not null check (ingest in ('active', 'paused')),
  publication text not null check (publication in ('shown', 'hidden')),
  rule jsonb not null check (jsonb_typeof(rule) = 'object' and octet_length(rule::text) <= 2000),
  revision bigint not null check (revision between 1 and 9007199254740991),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.eup_environment_events (
  id text primary key check (id ~ '^(usgs|nws|nhc|eonet|firms|wfigs|coops):[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'),
  provider text not null check (provider in ('usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops')),
  kind text not null,
  state text not null check (state in ('candidate', 'published', 'held', 'withdrawn_by_source', 'merged', 'retracted')),
  revision bigint not null check (revision between 1 and 9007199254740991),
  provider_event_id text not null check (provider_event_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 8000),
  significance integer check (significance between 0 and 10000),
  observed_at timestamptz not null,
  source_updated_at timestamptz,
  fetched_at timestamptz not null,
  revised_at timestamptz not null,
  first_published_at timestamptz,
  held_at timestamptz,
  retracted_at timestamptz,
  withdrawn_at timestamptz,
  merged_into text references public.eup_environment_events(id),
  state_changed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint eup_environment_events_provider_prefix check (split_part(id, ':', 1) = provider),
  constraint eup_environment_events_kind check ((provider, kind) in (('usgs', 'earthquake'), ('nws', 'weather_alert'),
    ('nhc', 'tropical_cyclone'), ('eonet', 'natural_event'), ('firms', 'fire_detection'), ('wfigs', 'fire_perimeter'),
    ('coops', 'water_level'))),
  constraint eup_environment_events_state check (state = public.eup_environment_state_of(merged_into, held_at, retracted_at,
    withdrawn_at, first_published_at)),
  constraint eup_environment_events_not_self check (merged_into is null or merged_into <> id)
);
create index if not exists eup_environment_events_timeline on public.eup_environment_events (observed_at desc, id desc)
  where first_published_at is not null and state in ('published', 'withdrawn_by_source', 'retracted');
create index if not exists eup_environment_events_review on public.eup_environment_events (state, observed_at desc);
create index if not exists eup_environment_events_merged on public.eup_environment_events (merged_into) where merged_into is not null;

create table if not exists public.eup_environment_event_revisions (
  event_id text not null references public.eup_environment_events(id),
  revision bigint not null check (revision between 1 and 9007199254740991),
  cause text not null check (cause in ('source_first_seen', 'source_revised', 'source_deleted', 'source_restored', 'source_merged',
    'owner_rollback')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 8000),
  changes jsonb not null check (jsonb_typeof(changes) = 'object' and octet_length(changes::text) <= 4000),
  source_updated_at timestamptz,
  fetched_at timestamptz,
  run_id text check (run_id is null or run_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
  decision_seq bigint,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (event_id, revision),
  constraint eup_environment_event_revisions_first check ((revision = 1) = (cause = 'source_first_seen')),
  constraint eup_environment_event_revisions_owner check ((cause = 'owner_rollback') = (decision_seq is not null))
);

create table if not exists public.eup_environment_event_aliases (
  provider text not null check (provider in ('usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops')),
  provider_event_id text not null check (provider_event_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'),
  event_id text not null references public.eup_environment_events(id),
  first_seen_at timestamptz not null default clock_timestamp(),
  primary key (provider, provider_event_id),
  constraint eup_environment_event_aliases_provider check (split_part(event_id, ':', 1) = provider)
);
create index if not exists eup_environment_event_aliases_event on public.eup_environment_event_aliases (event_id);

create table if not exists public.eup_environment_source_health (
  seq bigint generated always as identity primary key,
  provider text not null check (provider in ('usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops')),
  run_id text not null check (run_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
  status text not null check (status in ('ok', 'empty', 'unavailable', 'paused')),
  reason text check (reason is null or reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  http_status integer check (http_status is null or http_status between 100 and 599),
  upstream_generated_at timestamptz,
  fetched_at timestamptz not null,
  counts jsonb not null check (jsonb_typeof(counts) = 'object' and octet_length(counts::text) <= 2000),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object' and octet_length(receipt::text) <= 8000),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint eup_environment_source_health_run unique (provider, run_id)
);
create index if not exists eup_environment_source_health_latest on public.eup_environment_source_health (provider, seq desc);

create table if not exists public.eup_environment_decisions (
  seq bigint generated always as identity,
  org_id uuid not null references public.orgs(id),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  actor uuid not null references auth.users(id),
  command text not null check (command in ('hold', 'release', 'retract', 'restore', 'rollback', 'pause_provider',
    'resume_provider', 'hide_provider', 'show_provider', 'set_rule', 'attach_coverage', 'reject_coverage', 'retract_coverage')),
  target_kind text not null check (target_kind in ('event', 'provider', 'coverage')),
  target_id text not null check (length(target_id) between 1 and 200),
  expected_revision bigint not null check (expected_revision >= 0),
  reason text not null check (length(reason) between 1 and 500),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  prior jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (org_id, idempotency_key),
  constraint eup_environment_decisions_seq unique (seq)
);
create index if not exists eup_environment_decisions_target on public.eup_environment_decisions (target_kind, target_id, seq desc);

create table if not exists public.eup_environment_coverage (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.eup_environment_events(id),
  event_revision bigint not null check (event_revision between 1 and 9007199254740991),
  article_key text not null check (length(article_key) between 3 and 240 and article_key !~ '[[:cntrl:][:space:]]'),
  url text not null check (length(url) <= 2000 and url ~ '^https://[^[:space:][:cntrl:]]+$'),
  title text not null check (length(title) between 1 and 300 and title !~ '[[:cntrl:]]'),
  domain text not null check (domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  seen_at timestamptz not null,
  basis text not null check (basis in ('official_identifier', 'type_place_time')),
  basis_detail jsonb not null check (jsonb_typeof(basis_detail) = 'object' and octet_length(basis_detail::text) <= 1000),
  state text not null check (state in ('proposed', 'attached', 'rejected', 'retracted', 'stale')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_seq bigint,
  proposed_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint eup_environment_coverage_article unique (event_id, article_key),
  constraint eup_environment_coverage_decided check (state not in ('attached', 'rejected', 'retracted') or decided_at is not null)
);
create index if not exists eup_environment_coverage_event on public.eup_environment_coverage (event_id, state);

-- ---------------------------------------------------------------- guards

-- Append-only logs refuse UPDATE, DELETE and TRUNCATE; events and provider rows are never deleted, keep their identity
-- and move one revision at a time; coverage rows are never deleted and never bind to an older revision. Health rows
-- older than 30 days may leave only inside the ingest's purge, which sets a transaction-local marker for that one
-- statement (a correctness backstop, not a wall against the table owner, who can switch triggers off).
create or replace function public.eup_environment_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception '% is never truncated', tg_table_name using errcode = '42501';
  end if;
  if tg_table_name in ('eup_environment_event_revisions', 'eup_environment_event_aliases', 'eup_environment_decisions') then
    raise exception '% is append-only', tg_table_name using errcode = '42501';
  end if;
  if tg_table_name = 'eup_environment_source_health' then
    if tg_op = 'DELETE' and current_setting('eup.environment_health_purge', true) = 'on'
       and old.recorded_at < now() - interval '30 days' then
      return old;
    end if;
    raise exception 'eup_environment_source_health is append-only; rows older than 30 days leave through the ingest purge only'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception '% rows are never deleted', tg_table_name using errcode = '42501';
  end if;
  if tg_table_name = 'eup_environment_events' then
    if new.id <> old.id or new.provider <> old.provider or new.kind <> old.kind or new.created_at <> old.created_at
       or new.revision not in (old.revision, old.revision + 1)
       or (old.merged_into is not null and new.merged_into is distinct from old.merged_into)
       or (old.first_published_at is not null and new.first_published_at is distinct from old.first_published_at) then
      raise exception 'eup_environment_events rows keep their identity and move one revision at a time' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_table_name = 'eup_environment_providers' then
    if new.provider <> old.provider or new.created_at <> old.created_at or new.revision <> old.revision + 1 then
      raise exception 'eup_environment_providers rows change only by one revision' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_table_name = 'eup_environment_coverage' then
    if new.id <> old.id or new.event_id <> old.event_id or new.article_key <> old.article_key
       or new.proposed_at <> old.proposed_at or new.event_revision < old.event_revision then
      raise exception 'eup_environment_coverage rows keep their identity and never bind to an older revision' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'eup_environment_guard is attached to an unexpected table %', tg_table_name using errcode = '42501';
end $$;

create or replace trigger eup_environment_providers_guard before update or delete on public.eup_environment_providers
  for each row execute function public.eup_environment_guard();
create or replace trigger eup_environment_providers_no_truncate before truncate on public.eup_environment_providers
  for each statement execute function public.eup_environment_guard();
create or replace trigger eup_environment_events_guard before update or delete on public.eup_environment_events
  for each row execute function public.eup_environment_guard();
create or replace trigger eup_environment_events_no_truncate before truncate on public.eup_environment_events
  for each statement execute function public.eup_environment_guard();
create or replace trigger eup_environment_event_revisions_guard before update or delete on public.eup_environment_event_revisions
  for each row execute function public.eup_environment_guard();
create or replace trigger eup_environment_event_revisions_no_truncate before truncate on public.eup_environment_event_revisions
  for each statement execute function public.eup_environment_guard();
create or replace trigger eup_environment_event_aliases_guard before update or delete on public.eup_environment_event_aliases
  for each row execute function public.eup_environment_guard();
create or replace trigger eup_environment_event_aliases_no_truncate before truncate on public.eup_environment_event_aliases
  for each statement execute function public.eup_environment_guard();
create or replace trigger eup_environment_source_health_guard before update or delete on public.eup_environment_source_health
  for each row execute function public.eup_environment_guard();
create or replace trigger eup_environment_source_health_no_truncate before truncate on public.eup_environment_source_health
  for each statement execute function public.eup_environment_guard();
create or replace trigger eup_environment_decisions_guard before update or delete on public.eup_environment_decisions
  for each row execute function public.eup_environment_guard();
create or replace trigger eup_environment_decisions_no_truncate before truncate on public.eup_environment_decisions
  for each statement execute function public.eup_environment_guard();
create or replace trigger eup_environment_coverage_guard before update or delete on public.eup_environment_coverage
  for each row execute function public.eup_environment_guard();
create or replace trigger eup_environment_coverage_no_truncate before truncate on public.eup_environment_coverage
  for each statement execute function public.eup_environment_guard();

-- At commit, every event's current revision is in its history with the same snapshot. SECURITY DEFINER because a
-- deferred trigger runs at COMMIT as whoever commits (service_role, which holds no table privilege); it only reads.
create or replace function public.eup_environment_event_consistent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare snap jsonb;
begin
  select r.snapshot into snap from public.eup_environment_event_revisions r where r.event_id = new.id and r.revision = new.revision;
  if snap is null or snap is distinct from new.snapshot then
    raise exception 'eup_environment_events: revision % of % has no matching history row', new.revision, new.id using errcode = '23514';
  end if;
  return null;
end $$;
do $consistency$
begin
  if not exists (select 1 from pg_trigger where tgname = 'eup_environment_events_consistent'
                  and tgrelid = 'public.eup_environment_events'::regclass) then
    create constraint trigger eup_environment_events_consistent after insert or update on public.eup_environment_events
      deferrable initially deferred for each row execute function public.eup_environment_event_consistent();
  end if;
end $consistency$;

-- ---------------------------------------------------------------- the wall
alter table public.eup_environment_providers enable row level security;
alter table public.eup_environment_events enable row level security;
alter table public.eup_environment_event_revisions enable row level security;
alter table public.eup_environment_event_aliases enable row level security;
alter table public.eup_environment_source_health enable row level security;
alter table public.eup_environment_decisions enable row level security;
alter table public.eup_environment_coverage enable row level security;
-- Supabase's default privileges hand every new public table, sequence and function to anon, authenticated and
-- service_role (and PostgreSQL gives functions to PUBLIC). Everything this part creates is taken back; it grants nothing.
revoke all on table public.eup_environment_providers, public.eup_environment_events, public.eup_environment_event_revisions,
  public.eup_environment_event_aliases, public.eup_environment_source_health, public.eup_environment_decisions,
  public.eup_environment_coverage from public, anon, authenticated, service_role;
revoke all on sequence public.eup_environment_source_health_seq_seq, public.eup_environment_decisions_seq_seq
  from public, anon, authenticated, service_role;
revoke all on function public.eup_environment_state_of(text, timestamptz, timestamptz, timestamptz, timestamptz),
  public.eup_environment_iso_text(timestamptz), public.eup_environment_iso(jsonb),
  public.eup_environment_km(numeric, numeric, numeric, numeric), public.eup_environment_inc(jsonb, text),
  public.eup_environment_default_rule(text), public.eup_environment_rule_valid(text, jsonb),
  public.eup_environment_qualifies(text, jsonb, jsonb, integer), public.eup_environment_guard(),
  public.eup_environment_event_consistent()
  from public, anon, authenticated, service_role;
commit;
