// Isolated local PostgreSQL-compatible support for the pending E=UP environmental event store; never connects to
// canonical Supabase. Applies the applied module policy (supabase/migrations/20261117144103_eup_module_policy_v1.sql)
// and then the five pending parts, supabase/pending/20261119100000_eup_environment_events_v1_01.sql to _05.sql, in
// order, and drives the store the way the Worker will: as service_role, through the eight entry points, never through
// the tables. scripts/test/eup-environment-events.integration.mjs uses createEnvironmentStoreDatabase(); the owner
// routes, the ingest and the public routes of the later slices can use ENVIRONMENT_STORE_RPC as their PostgREST
// stand-in.
//
//   const store = await createEnvironmentStoreDatabase();   // PGLITE_MODULE: PGlite's dist/index.js
//   await store.command('set_rule', 'usgs', 0);              // the house owner configures USGS (the D7 default rule)
//   await store.ingest([usgsEvent({ provider_id: 'us7000abcd' })]);
//   await enableModule(store.db, 'environment');             // only then do the public reads answer
//
// EUP_ENVIRONMENT_PARTS_DIR replaces supabase/pending/ as the folder the five parts are read from (same file names),
// for negative controls: a mutated copy must fail the integration test.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OWNER, PEER, SECOND_OWNER, ensureHouse, applyModulePolicy, asServiceRole } from './eup-module-policy-database.mjs';

export { OWNER, PEER, SECOND_OWNER };
export const STORE_PART_FILES = Object.freeze([1, 2, 3, 4, 5].map((i) => `20261119100000_eup_environment_events_v1_0${i}.sql`));
export const STORE_PART_NAMES = Object.freeze([1, 2, 3, 4, 5].map((i) => `eup_environment_events_v1_0${i}`));
export const STORE_ROLLBACK_FILE = '20261119100000_eup_environment_events_v1.rollback.sql';
/** What one `apply_migration` call carries safely (supabase/pending/README.md); every part stays at or under it. */
export const STORE_PART_MAX_BYTES = 32000;
export const GOVERNMENT_PROVIDERS = Object.freeze(['usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops']);
export const STORE_TABLES = Object.freeze(['eup_environment_providers', 'eup_environment_events', 'eup_environment_event_revisions',
  'eup_environment_event_aliases', 'eup_environment_source_health', 'eup_environment_decisions', 'eup_environment_coverage']);
// The functions service_role may execute, by identity signature (pg_proc regprocedure text without the schema).
export const STORE_ENTRY_POINTS = Object.freeze([
  'eup_environment_coverage_propose(jsonb)',
  'eup_environment_ingest(text,text,timestamp with time zone,jsonb,jsonb)',
  'eup_environment_ingest_state(text,timestamp with time zone,integer)',
  'eup_environment_owner_command(uuid,text,text,bigint,text,text,jsonb)',
  'eup_environment_owner_preview(uuid,timestamp with time zone,timestamp with time zone,text,integer)',
  'eup_environment_owner_read(uuid,text,integer)',
  'eup_environment_public_event(text)',
  'eup_environment_public_events(timestamp with time zone,timestamp with time zone,text,integer)'
]);
// D7, the default USGS rule (adopted pending the owner's confirmation), as the SQL stores it.
export const DEFAULT_USGS_RULE = Object.freeze({ min_magnitude: 4.5, include_automatic: true, significance_above: 600, pager_alert: true, tsunami: true });

const PENDING = new URL('../../../supabase/pending/', import.meta.url);
const MIGRATIONS_ROLES_STUB = new URL('../../../supabase/tests/supabase_api_roles.stub.sql', import.meta.url);
const partPath = (file) => process.env.EUP_ENVIRONMENT_PARTS_DIR ? join(process.env.EUP_ENVIRONMENT_PARTS_DIR, file) : new URL(file, PENDING);
/** Part i (1-based) as text. */
export const storePartSql = (i) => readFile(partPath(STORE_PART_FILES[i - 1]), 'utf8');
export const storeRollbackSql = () => readFile(new URL(STORE_ROLLBACK_FILE, PENDING), 'utf8');
/** Apply parts `from` to `to` (1-based, inclusive), each one statement batch, as the table owner. */
export async function applyStore(db, { from = 1, to = 5 } = {}) {
  for (let i = from; i <= to; i += 1) await db.exec(await storePartSql(i));
}
export async function rollbackStore(db) { await db.exec(await storeRollbackSql()); }

// PostgREST stand-in: RPC name -> (named arguments) -> [sql, params]. The result column is `r`. JSON arguments travel
// as text and are cast, as PostgREST hands them over.
const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
export const ENVIRONMENT_STORE_RPC = Object.freeze({
  eup_environment_ingest: (a) => ['select public.eup_environment_ingest($1, $2, $3::timestamptz, $4::jsonb, $5::jsonb) as r',
    [a.p_provider, a.p_run_id, a.p_fetched_at, json(a.p_health), json(a.p_events)]],
  eup_environment_ingest_state: (a) => ['select public.eup_environment_ingest_state($1, $2::timestamptz, $3) as r',
    [a.p_provider, a.p_since, a.p_limit ?? 200]],
  eup_environment_public_events: (a) => ['select public.eup_environment_public_events($1::timestamptz, $2::timestamptz, $3, $4) as r',
    [a.p_since ?? null, a.p_until ?? null, a.p_cursor ?? null, a.p_limit ?? 50]],
  eup_environment_public_event: (a) => ['select public.eup_environment_public_event($1) as r', [a.p_id]],
  eup_environment_owner_read: (a) => ['select public.eup_environment_owner_read($1, $2, $3) as r', [a.p_actor, a.p_event_id ?? null, a.p_limit ?? 50]],
  eup_environment_owner_preview: (a) => ['select public.eup_environment_owner_preview($1, $2::timestamptz, $3::timestamptz, $4, $5) as r',
    [a.p_actor, a.p_since ?? null, a.p_until ?? null, a.p_cursor ?? null, a.p_limit ?? 50]],
  eup_environment_owner_command: (a) => ['select public.eup_environment_owner_command($1, $2, $3, $4, $5, $6, $7::jsonb) as r',
    [a.p_actor, a.p_command, a.p_target, a.p_expected_revision, a.p_key, a.p_reason, json(a.p_payload ?? {})]],
  eup_environment_coverage_propose: (a) => ['select public.eup_environment_coverage_propose($1::jsonb) as r', [json(a.p_proposals)]]
});
/** One RPC as service_role in its own transaction: what one PostgREST call is. */
export function environmentStoreRpc(db, name, args = {}) {
  if (!Object.hasOwn(ENVIRONMENT_STORE_RPC, name)) throw new Error(`Unknown environment store RPC: ${name}`);
  const [sql, params] = ENVIRONMENT_STORE_RPC[name](args);
  return asServiceRole(db, async (tx) => (await tx.query(sql, params)).rows[0].r);
}

export const usgsUrl = (id) => `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`;
/**
 * One USGS event as the Worker's normaliser (a later slice) is to hand it over. Synthetic values; the ids and the
 * sequences the integration test plays are modelled on the USGS behaviour recorded in the reconciliation's lane 06
 * (preferred-id changes, origin versions, deletions), not copied from a live answer.
 */
export function usgsEvent(overrides = {}) {
  const id = overrides.provider_id ?? 'us7000test';
  return {
    provider_id: id, aliases: [id], status: 'reviewed', observed_at: '2026-11-18T10:00:00.000Z',
    source_updated_at: '2026-11-18T10:30:00.000Z', lon: 142.1, lat: 38.3, depth_km: 10, magnitude: 5.2, magnitude_type: 'mww',
    place: '40 km E of Example, Japan', title: 'M 5.2 - 40 km E of Example, Japan', source_url: usgsUrl(id), significance: 416,
    alert: null, tsunami: false, net: id.slice(0, 2), code: id.slice(2),
    ...overrides
  };
}
const key = (label) => `fixture-${label}-${randomUUID()}`;

/**
 * A fresh database: Supabase API roles with Supabase's DEFAULT PRIVILEGES on (every new public table, sequence and
 * function handed to anon, authenticated and service_role unless the SQL takes it back), a house with two owners and
 * one plain member, the module policy applied, and then the five parts (unless `apply` is false).
 */
export async function createEnvironmentStoreDatabase({ apply = true } = {}) {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  const stub = existsSync(MIGRATIONS_ROLES_STUB);
  if (stub) {
    // gen_random_uuid() and sha256() are built in; PGlite does not load Supabase's pgcrypto extension.
    await db.exec((await readFile(MIGRATIONS_ROLES_STUB, 'utf8')).replace(/create extension if not exists pgcrypto;/gi, ''));
  } else {
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      grant usage on schema auth, public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  }
  await db.exec('alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;');
  await ensureHouse(db, OWNER);
  await db.exec(`insert into auth.users(id) values ('${PEER}'), ('${SECOND_OWNER}');
    insert into public.org_members(org_id, profile_id, role) values ('${OWNER}', '${PEER}', 'member'), ('${OWNER}', '${SECOND_OWNER}', 'owner');`);
  await applyModulePolicy(db);
  if (apply) await applyStore(db);
  let chain = Promise.resolve();
  // Session-role queue for multi-statement work as one role (an explicit begin ... end), as the policy harness does.
  const as = (role, work) => {
    const run = chain.then(async () => { await db.exec(`set role ${role}`); try { return await work(); } finally { await db.exec('rollback; reset role'); } });
    chain = run.catch(() => {});
    return run;
  };
  const rpc = (name, args) => environmentStoreRpc(db, name, args);
  let runs = 0;
  return {
    db, as, rolesStub: stub, rpc,
    apply: (range) => applyStore(db, range),
    rollback: () => rollbackStore(db),
    close: () => db.close(),
    /** One ingest run; fetched now unless told otherwise. */
    ingest: (events, { run = `run-${String(++runs).padStart(4, '0')}-${randomUUID().slice(0, 8)}`, fetchedAt = new Date().toISOString(),
      health = { status: 'ok' }, provider = 'usgs' } = {}) =>
      rpc('eup_environment_ingest', { p_provider: provider, p_run_id: run, p_fetched_at: fetchedAt, p_health: health, p_events: events }),
    command: (command, target, expectedRevision, { actor = OWNER, k = key(command), reason = `Test fixture: ${command}.`, payload = {} } = {}) =>
      rpc('eup_environment_owner_command', { p_actor: actor, p_command: command, p_target: target, p_expected_revision: expectedRevision,
        p_key: k, p_reason: reason, p_payload: payload }),
    publicEvents: (args = {}) => rpc('eup_environment_public_events', { p_since: args.since, p_until: args.until, p_cursor: args.cursor, p_limit: args.limit }),
    publicEvent: (id) => rpc('eup_environment_public_event', { p_id: id }),
    preview: (args = {}, actor = OWNER) => rpc('eup_environment_owner_preview', { p_actor: actor, p_since: args.since, p_until: args.until,
      p_cursor: args.cursor, p_limit: args.limit }),
    ownerRead: (eventId = null, actor = OWNER, limit = 50) => rpc('eup_environment_owner_read', { p_actor: actor, p_event_id: eventId, p_limit: limit }),
    propose: (proposals) => rpc('eup_environment_coverage_propose', { p_proposals: proposals })
  };
}
