// The pending E=UP environmental event store against its actual SQL in isolated PGlite (serial; one session): the five
// parts supabase/pending/20261119100000_eup_environment_events_v1_01.sql to _05.sql on top of the applied module policy,
// through scripts/test/support/eup-environment-database.mjs, with Supabase's default privileges switched on.
// Proves: the parts apply in order, refuse out of order and without the module policy, apply twice without change, roll
// back cleanly (the module policy untouched) and apply again identically; no row is created; no API role holds a table
// or sequence privilege and service_role executes exactly the eight entry points; ingest is idempotent per run and per
// content (a rerun writes no event row); a new revision only for a substantive change (D6, field by field, with the
// thresholds); aliases resolve and a preferred-id change keeps one canonical id; an association of two stored events
// becomes a redirect; a deletion is kept as a withdrawn revision and a tombstone, and a restore comes back; the D7 rule
// publishes by magnitude, significance, alert or tsunami and never unpublishes; holds, releases, retractions,
// restores and rollbacks with the expected revision and the idempotency key (409 on conflict); provider pause, hide and
// rule; the public reads are gated by the module policy, whitelisted, paginated and equal to the owner's preview;
// coverage is bound to the event's revision, attaches only on an official identifier or type + place + time, goes stale
// on a correction and is retracted on a withdrawal or merge; append-only and identity guards refuse UPDATE, DELETE and
// TRUNCATE even for the table owner; and 'gdelt' is refused at every door.
// Real concurrency (two ingests, an owner command against an ingest, one key on two sessions) needs real sessions and
// is the native proof's job: scripts/test/eup-environment-events.native.integration.mjs.
//   PGLITE_MODULE=<PGlite dist/index.js> node scripts/test/eup-environment-events.integration.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createEnvironmentStoreDatabase, OWNER, PEER, SECOND_OWNER, STORE_ENTRY_POINTS, STORE_PART_FILES, STORE_PART_MAX_BYTES, STORE_TABLES,
  DEFAULT_USGS_RULE, usgsEvent, usgsUrl, storePartSql
} from './support/eup-environment-database.mjs';
import { installModule, setModuleState, enableModule, drainModule, disableModule, readModulePolicy } from './support/eup-module-policy-database.mjs';

const store = await createEnvironmentStoreDatabase();
const { db, as } = store;
let count = 0;
const ok = (c, m) => { assert.ok(c, m); count += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); count += 1; };
async function rejects(fn, code, m) { await assert.rejects(fn, (e) => { assert.equal(e.code, code, `${m}: ${e.message}`); return true; }, m); count += 1; }
const admin = async (sql, params) => (await db.query(sql, params)).rows;
const adminCode = (sql, params) => admin(sql, params).then(() => 'ok', (e) => e.code);
const run = (role, sql, params) => as(role, async () => (await db.query(sql, params)).rows);
const n = async (table) => (await admin(`select count(*)::int as n from public.${table}`))[0].n;
const counts = async () => Object.fromEntries(await Promise.all(STORE_TABLES.map(async (t) => [t, await n(t)])));
const ev = async (id) => (await admin('select * from public.eup_environment_events where id = $1', [id]))[0];
const revs = async (id) => admin('select revision, cause, changes, snapshot, decision_seq from public.eup_environment_event_revisions where event_id = $1 order by revision', [id]);
const digest = async () => (await admin(`select md5(coalesce((select string_agg(t::text, '|' order by t.id) from public.eup_environment_events t), '')
  || coalesce((select string_agg(t::text, '|' order by t.event_id, t.revision) from public.eup_environment_event_revisions t), '')
  || coalesce((select string_agg(t::text, '|' order by t.provider_event_id) from public.eup_environment_event_aliases t), '')
  || coalesce((select string_agg(t::text, '|' order by t.id) from public.eup_environment_coverage t), '')) as d`))[0].d;
const xmins = async () => admin('select id, xmin::text as x from public.eup_environment_events order by id');
const has = (actual, expected, m) => eq(Object.fromEntries(Object.keys(expected).map((k) => [k, actual[k]])), expected, m);
const fingerprint = async () => (await admin(`select jsonb_build_object(
    'functions', (select jsonb_agg(jsonb_build_object('f', p.oid::regprocedure::text, 'acl', p.proacl::text, 'definer', p.prosecdef,
        'config', p.proconfig::text, 'body', md5(p.prosrc)) order by p.oid::regprocedure::text)
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_environment%'),
    'relations', (select jsonb_agg(jsonb_build_object('r', c.relname, 'kind', c.relkind, 'acl', c.relacl::text, 'rls', c.relrowsecurity) order by c.relname)
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'eup_environment%'),
    'constraints', (select jsonb_agg(jsonb_build_object('n', k.conname, 'def', pg_get_constraintdef(k.oid)) order by k.conname)
      from pg_constraint k join pg_class c on c.oid = k.conrelid where c.relnamespace = 'public'::regnamespace and c.relname like 'eup_environment%'),
    'triggers', (select jsonb_agg(jsonb_build_object('t', t.tgname, 'def', pg_get_triggerdef(t.oid)) order by t.tgname)
      from pg_trigger t where not t.tgisinternal and t.tgname like 'eup_environment%')) as f`))[0].f;
const objects = async () => (await admin(`select
    (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'eup_environment%') as relations,
    (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_environment%') as functions,
    (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_module%') as policy_functions`))[0];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PUBLISHED_KEYS = ['alert', 'correction', 'depth_km', 'first_published_at', 'id', 'kind', 'lat', 'lon', 'magnitude', 'magnitude_type',
  'news_coverage', 'observed_at', 'place', 'provider', 'review_status', 'revised_at', 'revision', 'source', 'state', 'title', 'tsunami'];
const TOMBSTONE_KEYS = ['first_published_at', 'id', 'kind', 'magnitude', 'magnitude_type', 'observed_at', 'place', 'provider', 'retracted_at',
  'revision', 'source', 'state', 'title', 'withdrawn_at'];
const ids = (page) => page.events.map((e) => e.id);
const rule = (overrides = {}) => ({ ...DEFAULT_USGS_RULE, ...overrides });
// A refused part stops inside its own transaction; the server ends it at the error. PGlite keeps one session, so end it.
const applyCode = (target, range) => target.apply(range).then(() => 'ok', async (e) => { await target.db.exec('rollback'); return e.code; });

// ---------------------------------------------------------------- fixtures (synthetic, modelled on lane 06's USGS facts)
const VAN = usgsEvent({ provider_id: 'attn6uqd', status: 'automatic', observed_at: '2026-10-20T04:05:12.340Z', source_updated_at: '2026-10-20T04:10:37.000Z',
  lon: 167.95, lat: -15.12, depth_km: 25, magnitude: 6.6, magnitude_type: 'mi', place: 'Vanuatu Islands', title: 'M 6.6 - Vanuatu Islands', significance: 670, net: 'at', code: 'tn6uqd' });
const CI = usgsEvent({ provider_id: 'ci41363495', status: 'automatic', observed_at: '2026-11-18T23:41:00.120Z', source_updated_at: '2026-11-18T23:41:35.000Z',
  lon: -116.8, lat: 33.95, depth_km: 9.2, magnitude: 3.42, magnitude_type: 'ml', place: '10 km NE of Example, CA', title: 'M 3.4 - 10 km NE of Example, CA', significance: 182 });
const SIG = usgsEvent({ provider_id: 'nc75000001', observed_at: '2026-11-17T08:00:00.000Z', magnitude: 4.4, magnitude_type: 'mw', significance: 650, lon: -122, lat: 37.5, place: '5 km S of Example, CA' });
const TSU = usgsEvent({ provider_id: 'ak0260000001', observed_at: '2026-11-16T12:00:00.000Z', magnitude: 3, magnitude_type: 'ml', tsunami: true, significance: 138, lon: -160, lat: 55, place: 'Example Island, Alaska' });
const AUTO = usgsEvent({ provider_id: 'us7000r001', status: 'automatic', observed_at: '2026-11-15T06:00:00.000Z', magnitude: 4.6, magnitude_type: 'mb', significance: 326, lon: 120.5, lat: -8.4, place: '50 km N of Example, Indonesia' });
const DEL = usgsEvent({ provider_id: 'us7000del1', observed_at: '2026-11-14T03:00:00.000Z', magnitude: 4.7, magnitude_type: 'mb', significance: 340, lon: -70.5, lat: -30.2, place: '20 km W of Example, Chile' });
const AKA = usgsEvent({ provider_id: 'aka2026wpvhsf', status: 'automatic', observed_at: '2026-11-15T06:10:11.000Z', magnitude: 3.8, magnitude_type: 'ml', significance: 222, lon: -151.5, lat: 61.2, place: '30 km W of Example, Alaska' });
const CHINA = usgsEvent({ provider_id: 'us6000u43g', observed_at: '2026-10-22T14:33:40.000Z', source_updated_at: '2026-11-10T08:27:37.066Z', magnitude: 7, magnitude_type: 'mww',
  significance: 1007, alert: 'orange', lon: 93.2, lat: 31.9, depth_km: 10, place: '189 km ENE of Nagqu, China', title: 'M 7.0 - 189 km ENE of Nagqu, China' });
const FIRST = [VAN, CI, SIG, TSU, AUTO, DEL, AKA, CHINA];
const coverage = (eventId, revision, article, extra = {}) => ({ event_id: eventId, event_revision: revision, article_key: `gdelt:${article}`,
  url: `https://news.example.org/2026/${article}`, title: 'Strong earthquake reported', domain: 'news.example.org', seen_at: '2026-10-20T06:00:00.000Z',
  basis: 'official_identifier', basis_detail: { identifier: article, found_in: 'url' }, ...extra });

try {
  ok(store.rolesStub, 'the Supabase API-role stub (default privileges on tables and functions) was found and applied');

  // ---------------------------------------------------------------- parts: size, order, idempotency, rollback
  for (const [i, file] of STORE_PART_FILES.entries()) {
    const bytes = Buffer.byteLength(await storePartSql(i + 1), 'utf8');
    ok(bytes <= STORE_PART_MAX_BYTES, `${file} is ${bytes} bytes, at most ${STORE_PART_MAX_BYTES}: one apply_migration call carries it`);
  }
  eq(await counts(), Object.fromEntries(STORE_TABLES.map((t) => [t, 0])), 'the five parts create no row in any of the seven tables');
  const first = await fingerprint();
  eq(await objects(), { relations: 26, functions: 29, policy_functions: 9 },
    'seven tables, seventeen indexes (seven primary keys, three unique keys, seven others), two identity sequences; 29 functions; the module policy\'s nine untouched');
  await store.apply();
  eq(await fingerprint(), first, 'the five parts applied a second time change nothing (idempotent)');
  await store.rollback();
  eq(await objects(), { relations: 0, functions: 0, policy_functions: 9 }, 'the rollback removes every store object and leaves the module policy');
  await store.rollback(); ok(true, 'the rollback is safe to run twice');
  for (const part of [2, 3, 4, 5]) {
    eq(await applyCode(store, { from: part, to: part }), '55000', `part 0${part} refuses (55000) before part 0${part - 1}`);
    eq((await objects()).functions, 0, `and part 0${part} changed nothing`);
  }
  await store.apply({ from: 1, to: 1 });
  const afterOne = await objects();
  eq(await applyCode(store, { from: 3, to: 3 }), '55000', 'part 03 refuses while part 02 is missing');
  eq(await objects(), afterOne, 'and changed nothing');
  await store.apply({ from: 2, to: 5 });
  eq(await fingerprint(), first, 'parts 01 to 05 after a rollback rebuild the identical schema, grants, constraints and triggers');
  {
    const bare = await createEnvironmentStoreDatabase({ apply: false });
    await bare.db.exec('drop function public.eup_module_policy_read(text)');
    eq(await applyCode(bare, { from: 1, to: 1 }), '55000', 'part 01 refuses (55000) without the applied module policy');
    eq((await bare.db.query(`select count(*)::int as n from pg_class where relname like 'eup_environment%'`)).rows[0].n, 0, 'and creates nothing');
    await bare.close();
  }

  // ---------------------------------------------------------------- the wall, with Supabase default privileges on
  const ALL_TABLE = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
  for (const role of ['anon', 'authenticated', 'service_role', 'public']) {
    const t = await admin(`select bool_or(has_table_privilege($1, c.oid, $2)) as any_table from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relname = any($3::text[])`, [role, ALL_TABLE, STORE_TABLES]);
    const s = await admin(`select has_sequence_privilege($1, 'public.eup_environment_source_health_seq_seq', 'USAGE,SELECT,UPDATE') as a,
      has_sequence_privilege($1, 'public.eup_environment_decisions_seq_seq', 'USAGE,SELECT,UPDATE') as b`, [role]);
    eq([t[0].any_table, s[0].a, s[0].b], [false, false, false], `${role} holds no privilege on any store table or identity sequence`);
  }
  eq((await admin(`select bool_and(c.relrowsecurity) as rls, (select count(*)::int from pg_policy p join pg_class x on x.oid = p.polrelid
      where x.relname like 'eup_environment%') as policies from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1::text[])`,
    [STORE_TABLES]))[0], { rls: true, policies: 0 }, 'row level security is on for all seven tables and there is no policy');
  const fns = await admin(`select replace(p.oid::regprocedure::text, 'public.', '') as f, has_function_privilege('service_role', p.oid, 'EXECUTE') as s,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as a, has_function_privilege('anon', p.oid, 'EXECUTE') as n,
      has_function_privilege('public', p.oid, 'EXECUTE') as p, p.prosecdef as definer, coalesce(p.proconfig, '{}'::text[]) as config
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_environment%' order by 1`);
  eq(fns.filter((f) => f.s).map((f) => f.f), [...STORE_ENTRY_POINTS], 'service_role executes exactly the eight entry points');
  ok(fns.every((f) => !f.a && !f.n && !f.p), 'anon, authenticated and PUBLIC execute none of the 29 functions');
  ok(fns.every((f) => f.config.includes('search_path=""')), 'every function pins an empty search_path');
  eq(fns.filter((f) => f.definer).map((f) => f.f), [...STORE_ENTRY_POINTS.slice(0, 1), 'eup_environment_event_consistent()', ...STORE_ENTRY_POINTS.slice(1)],
    'SECURITY DEFINER: the eight entry points, and the commit-time consistency trigger (it runs as whoever commits and only reads)');
  eq(fns.filter((f) => f.config.includes('lock_timeout=5s')).map((f) => f.f.split('(')[0]),
    ['eup_environment_coverage_propose', 'eup_environment_ingest', 'eup_environment_owner_command'], 'every writer bounds its lock wait at 5 s');
  for (const role of ['anon', 'authenticated']) {
    for (const table of STORE_TABLES) await rejects(() => run(role, `select * from public.${table}`), '42501', `${role} cannot read ${table}`);
    await rejects(() => run(role, 'select public.eup_environment_public_events()'), '42501', `${role} cannot execute the public page`);
    await rejects(() => run(role, "select public.eup_environment_public_event('usgs:attn6uqd')"), '42501', `${role} cannot execute the event read`);
    await rejects(() => run(role, "select public.eup_environment_ingest('usgs', 'run-denied-0001', now(), '{\"status\":\"ok\"}', '[]')"), '42501', `${role} cannot ingest`);
    await rejects(() => run(role, 'select public.eup_environment_owner_read($1)', [OWNER]), '42501', `${role} cannot execute the owner read`);
    await rejects(() => run(role, "select public.eup_environment_owner_command($1, 'set_rule', 'usgs', 0, 'k-denied-00000001', 'x')", [OWNER]), '42501', `${role} cannot command`);
    await rejects(() => run(role, "select public.eup_environment_coverage_propose('[]')"), '42501', `${role} cannot propose coverage`);
  }
  await rejects(() => run('service_role', 'select * from public.eup_environment_events'), '42501', 'service_role cannot read the events table directly');
  await rejects(() => run('service_role', "insert into public.eup_environment_providers(provider, ingest, publication, rule, revision, updated_by) values ('usgs', 'active', 'shown', '{}', 1, $1)", [OWNER]),
    '42501', 'service_role cannot write a provider rule directly');
  await rejects(() => run('service_role', "select public.eup_environment_state_of(null, null, null, null, null)"), '42501', 'service_role cannot execute an internal helper');

  // ---------------------------------------------------------------- nothing configured, module not installed
  await rejects(() => store.ingest([VAN]), 'EUE01', 'the ingest refuses while no provider rule exists');
  eq(await n('eup_environment_source_health'), 0, 'and records nothing, not even a health row');
  await rejects(() => store.publicEvents(), 'EUM01', 'the public page answers EUM01 while the environment module is not installed');
  await rejects(() => store.publicEvent('usgs:attn6uqd'), 'EUM01', 'so does the event read');
  {
    const view = await store.ownerRead();
    eq(view.module, { installed: false }, 'the owner read says the module is not installed');
    eq(view.providers.map((p) => [p.provider, p.configured, p.supported]), [['usgs', false, true], ['nws', false, false], ['nhc', false, false],
      ['eonet', false, false], ['firms', false, false], ['wfigs', false, false], ['coops', false, false]], 'every government provider is listed, none configured, only USGS supported');
    eq(view.providers[0].default_rule, DEFAULT_USGS_RULE, 'the owner read shows the D7 default rule');
    eq((await store.preview()).events, [], 'the owner preview answers while the module is off, with nothing yet');
  }
  await rejects(() => store.preview({}, PEER), '42501', 'a house member who is not an owner gets no preview');
  await rejects(() => store.ownerRead(null, PEER), '42501', 'nor the owner read');
  await rejects(() => store.preview({}, null), '42501', 'nor does a missing actor');

  // ---------------------------------------------------------------- the owner configures USGS
  await rejects(() => store.command('set_rule', 'usgs', 0, { actor: PEER }), '42501', 'a member who is not an owner cannot set a rule');
  await rejects(() => store.command('set_rule', 'gdelt', 0), 'EUE07', 'gdelt is not a government provider: refused');
  await rejects(() => store.command('set_rule', 'nws', 0), 'EUE07', 'a government provider without an ingest yet is refused');
  await rejects(() => store.command('set_rule', 'usgs', 0, { payload: { rule: rule({ extra: true }) } }), '22023', 'a rule with an unknown key is refused');
  await rejects(() => store.command('set_rule', 'usgs', 0, { payload: { rule: rule({ min_magnitude: '4.5' }) } }), '22023', 'a rule with a string magnitude is refused');
  await rejects(() => store.command('set_rule', 'usgs', 0, { payload: { rule: rule({ min_magnitude: 11 }) } }), '22023', 'a rule out of range is refused');
  await rejects(() => store.command('set_rule', 'usgs', 0, { payload: { other: 1 } }), '22023', 'a payload key the command does not take is refused');
  await rejects(() => store.command('set_rule', 'usgs', 0, { reason: '' }), '22023', 'an empty reason is refused');
  await rejects(() => store.command('set_rule', 'usgs', 0, { reason: 'x'.repeat(501) }), '22023', 'a reason over 500 characters is refused');
  await rejects(() => store.command('set_rule', 'usgs', 0, { k: 'short' }), '22023', 'a short idempotency key is refused');
  eq(await n('eup_environment_decisions'), 0, 'no refused command left a decision row');
  const setKey = 'k-set-rule-usgs-0001';
  const configured = await store.command('set_rule', 'usgs', 0, { k: setKey, reason: 'Adopt the D7 default pending confirmation.' });
  has(configured, { schema: 'mccluster.environment-decision/v1', command: 'set_rule', target_kind: 'provider', target: 'usgs', changed: true,
    prior: { configured: false, revision: 0 }, result: { ingest: 'active', publication: 'shown', rule: DEFAULT_USGS_RULE, revision: 1 } },
    'set_rule without a rule stores the D7 default at revision 1, ingest active and shown');
  eq(await store.command('set_rule', 'usgs', 0, { k: setKey, reason: 'Adopt the D7 default pending confirmation.' }), configured,
    'the same key and the same command replay the stored receipt');
  eq(await n('eup_environment_decisions'), 1, 'one decision row, not two');
  await rejects(() => store.command('set_rule', 'usgs', 0, { k: setKey, reason: 'Another reason.' }), 'EUE06', 'the same key with another command is refused');
  await rejects(() => store.command('set_rule', 'usgs', 0), '40001', 'a command at a revision that moved is refused (409)');
  eq(await n('eup_environment_decisions'), 1, 'and logs nothing');
  await rejects(() => adminCode("insert into public.eup_environment_providers(provider, ingest, publication, rule, revision, updated_by) values ('gdelt', 'active', 'shown', '{}', 1, $1)", [OWNER])
    .then((c) => { if (c !== 'ok') throw Object.assign(new Error(c), { code: c }); }), '23514', 'even the table owner cannot store a gdelt provider row');
  await rejects(() => store.ingest([VAN], { provider: 'gdelt' }), 'EUE07', 'the ingest refuses gdelt');
  await rejects(() => store.ingest([VAN], { provider: 'eonet' }), 'EUE07', 'and a government provider it does not support yet');

  // ---------------------------------------------------------------- first ingest
  const fetched1 = new Date().toISOString();
  const run1 = await store.ingest(FIRST, { run: 'usgs-run-0001', fetchedAt: fetched1 });
  has(run1, { schema: 'mccluster.environment-ingest/v1', provider: 'usgs', run_id: 'usgs-run-0001', status: 'ok' }, 'the first run is recorded ok');
  has(run1.counts, { received: 8, inserted: 8, published: 6, revised: 0, unchanged: 0, refused: 0 }, 'eight inserted, six published at once');
  eq(run1.refusals, [], 'nothing refused');
  const states = Object.fromEntries((await admin('select id, state, revision from public.eup_environment_events order by id')).map((r) => [r.id, [r.state, Number(r.revision)]]));
  eq(states, { 'usgs:ak0260000001': ['published', 1], 'usgs:aka2026wpvhsf': ['candidate', 1], 'usgs:attn6uqd': ['published', 1], 'usgs:ci41363495': ['candidate', 1],
    'usgs:nc75000001': ['published', 1], 'usgs:us6000u43g': ['published', 1], 'usgs:us7000del1': ['published', 1], 'usgs:us7000r001': ['published', 1] },
    'D7: M4.5+ (automatic included), significance over 600 (M4.4), a tsunami flag (M3.0) publish; M3.42 and M3.8 stay candidates');
  eq((await revs('usgs:attn6uqd')).map((r) => [Number(r.revision), r.cause]), [[1, 'source_first_seen']], 'revision 1 is the first sight');
  eq(await n('eup_environment_event_aliases'), 8, 'one alias per event so far');
  eq(await n('eup_environment_source_health'), 1, 'exactly one health row for the run');
  await rejects(() => store.publicEvents(), 'EUM01', 'publishing in the store shows nothing while the module is not installed');
  eq(ids(await store.preview()), ['usgs:nc75000001', 'usgs:ak0260000001', 'usgs:us7000r001', 'usgs:us7000del1', 'usgs:us6000u43g', 'usgs:attn6uqd'],
    'the owner preview lists the six published events, newest observation first');

  // ---------------------------------------------------------------- idempotency
  const before = await digest();
  eq(await store.ingest(FIRST, { run: 'usgs-run-0001', fetchedAt: fetched1 }), run1, 'the same run id and payload return the stored receipt');
  eq([await digest(), await n('eup_environment_source_health')], [before, 1], 'and write nothing, not even a second health row');
  await rejects(() => store.ingest([VAN], { run: 'usgs-run-0001', fetchedAt: fetched1 }), 'EUE05', 'the same run id with another payload is refused');
  const x1 = await xmins();
  const run2 = await store.ingest(FIRST);
  has(run2.counts, { received: 8, unchanged: 8, inserted: 0, revised: 0, refreshed: 0, published: 0 }, 'a new run with the same content: all unchanged');
  eq([await digest(), await xmins()], [before, x1], 'and not one event row was written (no new row version)');
  eq(await n('eup_environment_source_health'), 2, 'one new health row for the new run');

  // ---------------------------------------------------------------- D6: what makes a revision
  {
    const china0 = await ev('usgs:us6000u43g');
    const sub = { ...CHINA, lat: 31.9045, depth_km: 10.4, observed_at: '2026-10-22T14:33:40.400Z', place: '190 km ENE of Nagqu, China' };
    has((await store.ingest([sub])).counts, { unchanged: 1, revised: 0, refreshed: 0 }, '0.5 km, 0.4 km deeper, 0.4 s and new place wording: no revision, no write');
    eq((await ev('usgs:us6000u43g')).snapshot, china0.snapshot, 'the snapshot (place wording included) follows revisions only');
    const dyfi = { ...CHINA, source_updated_at: '2026-11-19T01:53:57.963Z', significance: 1010 };
    has((await store.ingest([dyfi])).counts, { refreshed: 1, revised: 0 }, 'a felt-report update (USGS updated and significance move): refreshed, no revision');
    const china1 = await ev('usgs:us6000u43g');
    eq([Number(china1.revision), china1.significance, china1.source_updated_at.toISOString()], [1, 1010, '2026-11-19T01:53:57.963Z'],
      'revision 1 kept; USGS updated and significance refreshed');
  }
  {
    const VAN2 = { ...VAN, provider_id: 'us6000u3jl', aliases: ['attn6uqd', 'pt26293000', 'us6000u3jl'], status: 'reviewed', source_updated_at: '2026-10-20T04:31:30.000Z',
      magnitude: 6.3, magnitude_type: 'mww', lat: -15.147, title: 'M 6.3 - Vanuatu Islands', source_url: usgsUrl('us6000u3jl'), net: 'us', code: '6000u3jl' };
    const r = await store.ingest([VAN2]);
    has(r.counts, { revised: 1, inserted: 0 }, 'the preferred id moved from attn6uqd to us6000u3jl: the same event, revised');
    const v = await ev('usgs:attn6uqd');
    eq([v.id, Number(v.revision), v.provider_event_id, v.state], ['usgs:attn6uqd', 2, 'us6000u3jl', 'published'], 'one canonical id (D5), revision 2, the new preferred id kept');
    eq((await revs('usgs:attn6uqd'))[1].changes, { location: { from: [167.95, -15.12], to: [167.95, -15.147], km: 3 }, magnitude: { from: 6.6, to: 6.3 },
      magnitude_type: { from: 'mi', to: 'mww' }, status: { from: 'automatic', to: 'reviewed' } }, 'the change records old -> new for each substantive field');
    eq((await admin("select provider_event_id from public.eup_environment_event_aliases where event_id = 'usgs:attn6uqd' order by 1")).map((a) => a.provider_event_id),
      ['attn6uqd', 'pt26293000', 'us6000u3jl'], 'all three ids are aliases of the one event');
    eq(await n('eup_environment_events'), 8, 'no second event was created');
    has((await store.ingest([VAN2])).counts, { unchanged: 1 }, 'the same answer again changes nothing');
  }
  {
    // one substantive field at a time, each exactly one revision naming exactly that field
    let auto = { ...AUTO };
    const steps = [['depth_km', { depth_km: 11.2 }], ['observed_at', { observed_at: '2026-11-15T06:00:02.000Z' }], ['magnitude_type', { magnitude_type: 'mwr' }],
      ['tsunami', { tsunami: true }], ['alert', { alert: 'green' }], ['status', { status: 'reviewed' }], ['magnitude', { magnitude: 4.2 }]];
    for (const [i, [field, change]] of steps.entries()) {
      auto = { ...auto, ...change };
      has((await store.ingest([auto])).counts, { revised: 1 }, `${field} alone makes a revision`);
      const r = (await revs('usgs:us7000r001')).at(-1);
      eq([Number(r.revision), r.cause, Object.keys(r.changes)], [i + 2, 'source_revised', [field]], `revision ${i + 2} names ${field} and nothing else`);
    }
    const a = await ev('usgs:us7000r001');
    eq([a.state, a.snapshot.magnitude], ['published', 4.2], 'a downward correction below M4.5 never unpublishes (D7): it stays, corrected');
    has((await store.ingest([{ ...auto, depth_km: 11.9 }])).counts, { unchanged: 1 }, '0.7 km of depth is under the threshold');
  }
  {
    // the California origin versions: automatic M3.42, reviewed M3.1, reviewed M3.36, then felt reports
    has((await store.ingest([{ ...CI, status: 'reviewed', magnitude: 3.1, source_updated_at: '2026-11-19T00:04:19.000Z' }])).counts, { revised: 1, published: 0 }, 'M3.42 automatic to M3.1 reviewed: revised');
    has((await store.ingest([{ ...CI, status: 'reviewed', magnitude: 3.36, source_updated_at: '2026-11-19T00:34:25.000Z' }])).counts, { revised: 1 }, 'M3.1 to M3.36: revised again');
    eq([(await ev('usgs:ci41363495')).state, Number((await ev('usgs:ci41363495')).revision)], ['candidate', 3], 'still a candidate, at revision 3');
    has((await store.ingest([{ ...CI, status: 'reviewed', magnitude: 3.36, source_updated_at: '2026-11-19T01:53:57.963Z', significance: 650 }])).counts,
      { refreshed: 1, published: 1, revised: 0 }, 'felt reports lift its significance over 600: published without a new revision');
    const c = await ev('usgs:ci41363495');
    eq([c.state, Number(c.revision), c.first_published_at !== null], ['published', 3, true], 'published at revision 3');
  }

  // ---------------------------------------------------------------- merge: the provider associates two stored events
  const MA = usgsEvent({ provider_id: 'us7000mrga', observed_at: '2026-11-13T01:00:00.000Z', magnitude: 5, lon: 10, lat: 45, place: 'Example, Italy' });
  const MB = usgsEvent({ provider_id: 'pt26300001', observed_at: '2026-11-13T01:00:01.000Z', magnitude: 5.1, lon: 10.01, lat: 45, place: 'Example, Italy', net: 'pt', code: '26300001' });
  has((await store.ingest([MA])).counts, { inserted: 1, published: 1 }, 'event A first seen and published');
  has((await store.ingest([MB])).counts, { inserted: 1, published: 1 }, 'event B first seen later, as a separate event');
  has((await store.propose([coverage('usgs:pt26300001', 1, 'pt26300001')])).counts, { attached: 1 }, 'B carries an official-identifier coverage');
  {
    const r = await store.ingest([{ ...MA, aliases: ['us7000mrga', 'pt26300001'] }]);
    has(r.counts, { merged: 1, unchanged: 1, inserted: 0 }, 'USGS now lists both ids as one event: B merges into A');
    const b = await ev('usgs:pt26300001');
    eq([b.state, b.merged_into, Number(b.revision)], ['merged', 'usgs:us7000mrga', 2], 'the later-published one is a redirect to the earlier (D5)');
    eq((await revs('usgs:pt26300001'))[1].cause, 'source_merged', 'its revision 2 records the merge');
    eq((await admin("select state from public.eup_environment_coverage where event_id = 'usgs:pt26300001'"))[0].state, 'retracted', 'its coverage is retracted');
    eq((await ev('usgs:us7000mrga')).state, 'published', 'A stands');
    has((await store.ingest([{ ...MA, aliases: ['us7000mrga', 'pt26300001'] }])).counts, { merged: 0, unchanged: 1 }, 'the same answer again merges nothing more');
  }

  // ---------------------------------------------------------------- withdrawal by the source, and its return
  has((await store.propose([coverage('usgs:us7000del1', 1, 'us7000del1')])).counts, { attached: 1 }, 'the M4.7 carries an official-identifier coverage');
  {
    const r = await store.ingest([{ provider_id: 'us7000del1', status: 'deleted' }, { provider_id: 'aka2026wpvhsf', status: 'deleted', aliases: ['aka2026wpvhsf'] },
      { provider_id: 'us0000zzzz99', status: 'deleted' }]);
    has(r.counts, { withdrawn: 2, unknown_deletions: 1, inserted: 0 }, 'two deletions withdraw, an unknown deleted id creates nothing');
    const d = await ev('usgs:us7000del1');
    eq([d.state, Number(d.revision), d.snapshot.status, d.withdrawn_at !== null], ['withdrawn_by_source', 2, 'deleted', true], 'the deletion is kept as revision 2, a tombstone');
    eq((await revs('usgs:us7000del1'))[1].changes, { status: { from: 'reviewed', to: 'deleted' } }, 'the withdrawal records reviewed -> deleted');
    eq((await admin("select state, decided_by from public.eup_environment_coverage where event_id = 'usgs:us7000del1'"))[0], { state: 'retracted', decided_by: null },
      'its coverage is retracted by the withdrawal (not by a person)');
    eq((await ev('usgs:aka2026wpvhsf')).state, 'withdrawn_by_source', 'a withdrawn candidate is withdrawn too, never having been public');
    eq(await n('eup_environment_events'), 10, 'and the unknown id created no event');
    has((await store.ingest([{ provider_id: 'us7000del1', status: 'deleted' }])).counts, { unchanged: 1, withdrawn: 0 }, 'a second deletion notice changes nothing');
    await rejects(() => store.command('rollback', 'usgs:aka2026wpvhsf', 2, { payload: { to_revision: 1 } }), 'EUE04', 'a withdrawn event cannot be rolled back over the source');
    has((await store.ingest([DEL])).counts, { restored: 1 }, 'USGS lists it again, undeleted: restored');
    const back = await ev('usgs:us7000del1');
    eq([back.state, Number(back.revision), back.withdrawn_at], ['published', 3, null], 'published again at revision 3');
    eq((await revs('usgs:us7000del1'))[2].cause, 'source_restored', 'revision 3 is the restore');
  }

  // ---------------------------------------------------------------- run health: paused, outage, no data, refusals, conflicts, retention
  {
    const pol = (await store.ownerRead()).providers[0];
    eq([pol.revision, pol.last_run.status], [1, 'ok'], 'the owner read shows the rule revision and the last run');
    const paused = await store.command('pause_provider', 'usgs', 1);
    eq(paused.result.ingest, 'paused', 'the owner pauses the USGS ingest');
    const d0 = await digest();
    const r = await store.ingest([{ ...CHINA, magnitude: 7.1 }]);
    eq([r.status, r.counts.received, r.counts.revised], ['paused', 1, 0], 'a paused provider records only its health row');
    eq(await digest(), d0, 'and changes no event');
    has(await store.command('pause_provider', 'usgs', 2), { changed: false }, 'pausing again is a logged no-op');
    has(await store.command('resume_provider', 'usgs', 2), { changed: true, result: { ingest: 'active', publication: 'shown', rule: DEFAULT_USGS_RULE, revision: 3 } }, 'resumed at revision 3');
    const out = await store.ingest([], { health: { status: 'unavailable', reason: 'upstream_http', http_status: 503 } });
    eq([out.status, out.counts.received], ['unavailable', 0], 'an outage is recorded as unavailable, with its reason');
    const empty = await store.ingest([]);
    eq(empty.status, 'empty', 'a successful read with no events is recorded as empty: no data, not an outage');
    await rejects(() => store.ingest([VAN], { health: { status: 'unavailable', reason: 'timeout' } }), '22023', 'an outage cannot carry events');
    await rejects(() => store.ingest([], { health: { status: 'unavailable' } }), '22023', 'an outage names its reason');
    await rejects(() => store.ingest([], { health: { status: 'ok', reason: 'upstream_http' } }), '22023', 'a successful read carries no reason');
    await rejects(() => store.ingest([], { health: { status: 'ok', secret: 'x' } }), '22023', 'a health field the store does not know is refused');
    await rejects(() => store.ingest([], { fetchedAt: '2026-01-01T00:00:00.000Z' }), '22023', 'a fetch time days in the past is refused');
    const last = (await store.ownerRead()).providers[0];
    eq([last.last_run.status, last.last_success_at !== null], ['empty', true], 'the owner tells the last run (no data) and the last success apart');
    const bad = await store.ingest([
      usgsEvent({ provider_id: 'US-BAD' }), usgsEvent({ provider_id: 'us7000hhh1', source_url: 'http://earthquake.usgs.gov/earthquakes/eventpage/us7000hhh1' }),
      usgsEvent({ provider_id: 'us7000hhh2', source_url: 'https://example.org/us7000hhh2' }), { ...usgsEvent({ provider_id: 'us7000hhh3' }), secret: 1 },
      usgsEvent({ provider_id: 'us7000hhh4', observed_at: '2026-02-30T00:00:00.000Z' }), usgsEvent({ provider_id: 'us7000hhh5', lat: 95 }),
      usgsEvent({ provider_id: 'us7000hhh6', title: 'line\nbreak' }), usgsEvent({ provider_id: 'us7000good', observed_at: '2026-11-12T00:00:00.000Z', magnitude: 4.5 })]);
    has(bad.counts, { refused: 7, inserted: 1, published: 1 }, 'seven invalid events refused one by one; the valid one is stored');
    eq(bad.refusals.map((x) => x.reason), ['provider_id', 'source_url', 'source_url', 'unknown_field', 'observed_at', 'coordinates', 'title'], 'each refusal names its field');
    const conflict = await store.ingest([usgsEvent({ provider_id: 'us7000cf01', aliases: ['us7000cf01', 'xx7000cf00'], observed_at: '2026-11-11T00:00:00.000Z' }),
      usgsEvent({ provider_id: 'us7000cf02', aliases: ['us7000cf02', 'xx7000cf00'], observed_at: '2026-11-11T00:00:00.000Z' })]);
    has(conflict.counts, { inserted: 1, conflicts: 1 }, 'two provider events sharing an id in one run: the first is applied, the second is a conflict');
    eq(conflict.refusals, [{ index: 1, reason: 'alias_conflict' }], 'and named');
    await admin(`insert into public.eup_environment_source_health(provider, run_id, status, fetched_at, counts, payload_digest, receipt, recorded_at)
      values ('usgs', 'old-run-forty-days', 'ok', now() - interval '40 days', '{}', repeat('a', 64), '{}', now() - interval '40 days'),
             ('usgs', 'old-run-ten-days', 'ok', now() - interval '10 days', '{}', repeat('b', 64), '{}', now() - interval '10 days')`);
    await store.ingest([]);
    eq((await admin("select run_id from public.eup_environment_source_health where run_id like 'old-run-%'")).map((x) => x.run_id), ['old-run-ten-days'],
      'the next run purges health rows older than 30 days and keeps the rest');
    await rejects(() => adminCode("delete from public.eup_environment_source_health where run_id = 'old-run-ten-days'").then((c) => { if (c !== 'ok') throw Object.assign(new Error(c), { code: c }); }),
      '42501', 'a direct delete of a health row is refused, even for the table owner');
    await rejects(() => db.transaction(async (tx) => { await tx.query("select set_config('eup.environment_health_purge', 'on', true)");
      await tx.query("delete from public.eup_environment_source_health where run_id = 'old-run-ten-days'"); }), '42501', 'the purge marker never removes a row younger than 30 days');
  }

  // ---------------------------------------------------------------- the module gate and the public shape
  await installModule(db, 'environment');
  await rejects(() => store.publicEvents(), 'EUM03', 'installed but disabled: the public page answers EUM03 (off)');
  await rejects(() => store.publicEvent('usgs:attn6uqd'), 'EUM03', 'and the event read too');
  await enableModule(db, 'environment');
  const page = await store.publicEvents({ limit: 200 });
  eq(page.schema, 'mccluster.environment-events/v1', 'the page names its schema');
  eq(page.sources.map((x) => [x.provider, x.status, Object.keys(x).sort().join(',')]), [['usgs', 'empty', 'checked_at,last_success_at,provider,status']],
    'the page names each shown provider\'s last run (here a read with no events), so no data is told from an outage');
  ok(page.sources[0].last_success_at !== null && page.sources[0].checked_at !== null, 'with when it was checked and its last successful read');
  eq(page, await store.preview({ limit: 200 }), 'the owner preview is exactly the public page once the module is enabled');
  const published = page.events.filter((e) => e.state === 'published');
  const tombs = page.events.filter((e) => e.state !== 'published');
  ok(published.every((e) => JSON.stringify(Object.keys(e).sort()) === JSON.stringify(PUBLISHED_KEYS)), 'every published event carries exactly the whitelisted keys');
  ok(published.every((e) => JSON.stringify(Object.keys(e.source).sort()) === JSON.stringify(['fetched_at', 'id', 'updated_at', 'url'])), 'and its source exactly id, url, USGS updated and retrieved');
  eq(tombs.map((e) => [e.id, e.state]), [], 'no tombstone yet: the one withdrawal that was published came back');
  ok(!UUID_RE.test(JSON.stringify(page)), 'no person or row identifier anywhere in the public page');
  ok(!/significance|"net"|"code"|held_at|decided_by|snapshot|run_id/.test(JSON.stringify(page)), 'no internal field in the public page');
  eq(ids(page).includes('usgs:aka2026wpvhsf') || ids(page).includes('usgs:pt26300001'), false, 'no candidate, never-published withdrawal or redirect in the page');
  {
    const v = page.events.find((e) => e.id === 'usgs:attn6uqd');
    eq([v.revision, v.magnitude, v.review_status, v.source.id, v.source.url, v.correction.cause, v.correction.changes.magnitude],
      [2, 6.3, 'reviewed', 'us6000u3jl', usgsUrl('us6000u3jl'), 'source_revised', { from: 6.6, to: 6.3 }], 'a corrected event shows its revision and old -> new');
    const c = page.events.find((e) => e.id === 'usgs:us6000u43g');
    eq([c.source.updated_at, c.correction, c.news_coverage], ['2026-11-19T01:53:57.963Z', null, []], 'USGS updated is shown; no correction; no coverage yet');
  }
  {
    const all = []; let cursor = null; let pages = 0;
    do { const p = await store.publicEvents({ limit: 3, cursor }); all.push(...ids(p)); cursor = p.next_cursor; pages += 1; } while (cursor && pages < 20);
    eq(all, ids(page), 'three at a time, the cursor walks the whole timeline once, in order');
    await rejects(() => store.publicEvents({ cursor: 'not-a-cursor' }), '22023', 'a malformed cursor is refused');
    await rejects(() => store.publicEvents({ since: '2026-11-19T00:00:00Z', until: '2026-11-18T00:00:00Z' }), '22023', 'an empty window is refused');
    eq(ids(await store.publicEvents({ since: '2026-11-15T00:00:00Z', until: '2026-11-17T00:00:00Z' })), ['usgs:ak0260000001', 'usgs:us7000r001'], 'since and until bound the window');
  }
  {
    const viaAlias = await store.publicEvent('usgs:us6000u3jl');
    eq([viaAlias.status, viaAlias.id, viaAlias.redirected_from], ['published', 'usgs:attn6uqd', 'usgs:us6000u3jl'], 'a deep link by the new preferred id resolves to the canonical event');
    eq(viaAlias.event.history.map((h) => [h.revision, h.cause]), [[2, 'source_revised']], 'with its correction history');
    const merged = await store.publicEvent('usgs:pt26300001');
    eq([merged.status, merged.id, merged.redirected_from], ['published', 'usgs:us7000mrga', 'usgs:pt26300001'], 'a merged event redirects to the one that stands');
    eq((await store.publicEvent('usgs:ci41363495')).status, 'published', 'the felt-report publication is readable');
    eq((await store.publicEvent('usgs:aka2026wpvhsf')).status, 'not_found', 'a withdrawal that was never published is not found');
    eq((await store.publicEvent('usgs:us0000none')).status, 'not_found', 'an unknown id is not found');
    eq(await store.publicEvent('<script>'), { schema: 'mccluster.environment-event/v1', status: 'not_found', id: null, redirected_from: null, event: null }, 'garbage is not found and not echoed');
    await drainModule(db, 'environment');
    eq((await store.publicEvents()).schema, 'mccluster.environment-events/v1', 'a draining module still answers reads');
    await disableModule(db, 'environment');
    await rejects(() => store.publicEvents(), 'EUM03', 'a disabled module refuses again');
    await enableModule(db, 'environment');
  }

  // ---------------------------------------------------------------- owner decisions on events
  {
    const before = await n('eup_environment_decisions');
    const holdKey = 'k-hold-attn6uqd-0001';
    const held = await store.command('hold', 'usgs:attn6uqd', 2, { k: holdKey, reason: 'Checking the magnitude with USGS.' });
    has(held, { changed: true, prior: { state: 'published', revision: 2 }, result: { state: 'held', revision: 2 } }, 'hold hides the event; the revision does not move');
    ok(!ids(await store.publicEvents({ limit: 200 })).includes('usgs:attn6uqd'), 'a held event leaves the page');
    eq((await store.publicEvent('usgs:us6000u3jl')).status, 'not_available', 'and its deep link answers not available (D12)');
    eq(await store.command('hold', 'usgs:attn6uqd', 2, { k: holdKey, reason: 'Checking the magnitude with USGS.' }), held, 'the same key replays');
    await rejects(() => store.command('hold', 'usgs:attn6uqd', 2, { k: holdKey, reason: 'Other.' }), 'EUE06', 'the same key with another reason is refused');
    await rejects(() => store.command('release', 'usgs:attn6uqd', 1), '40001', 'a stale expected revision is refused (409)');
    eq(await n('eup_environment_decisions'), before + 1, 'one decision logged for the hold, none for the refusals');
    has(await store.command('hold', 'usgs:attn6uqd', 2), { changed: false }, 'holding a held event is a logged no-op');
    has(await store.command('release', 'usgs:attn6uqd', 2), { changed: true, result: { state: 'published', revision: 2 } }, 'release publishes it again');
    ok(ids(await store.publicEvents({ limit: 200 })).includes('usgs:attn6uqd'), 'back in the page');
    has(await store.command('retract', 'usgs:nc75000001', 1), { changed: true, result: { state: 'retracted', revision: 1 } }, 'the owner retracts an event');
    const tomb = (await store.publicEvents({ limit: 200 })).events.find((e) => e.id === 'usgs:nc75000001');
    eq([tomb.state, JSON.stringify(Object.keys(tomb).sort()), Object.keys(tomb.source).sort()], ['retracted', JSON.stringify(TOMBSTONE_KEYS), ['id', 'url']],
      'a retraction stays in the timeline as a tombstone without coordinates');
    await rejects(() => store.command('hold', 'usgs:nc75000001', 1), 'EUE04', 'a retracted event cannot be held');
    has(await store.command('restore', 'usgs:nc75000001', 1), { changed: true, result: { state: 'published', revision: 1 } }, 'restore brings it back');
    await rejects(() => store.command('hold', 'usgs:pt26300001', 2), 'EUE04', 'a merged event takes no command');
    await rejects(() => store.command('hold', 'usgs:us0000none', 1), 'EUE03', 'an unknown event is refused');
    has(await store.command('hold', 'usgs:aka2026wpvhsf', 2), { changed: true, result: { state: 'held', revision: 2 } }, 'a withdrawn candidate can be held');
    await store.command('release', 'usgs:aka2026wpvhsf', 2);
    eq((await ev('usgs:aka2026wpvhsf')).state, 'withdrawn_by_source', 'and its release returns it to the source\'s state, not to published');
    // rollback
    const auto = await ev('usgs:us7000r001');
    await rejects(() => store.command('rollback', 'usgs:us7000r001', Number(auto.revision), { payload: { to_revision: Number(auto.revision) } }), '22023', 'rollback to the current revision is refused');
    await rejects(() => store.command('rollback', 'usgs:us7000r001', Number(auto.revision), { payload: {} }), '22023', 'rollback names its revision');
    await rejects(() => store.command('rollback', 'usgs:us7000del1', 3, { payload: { to_revision: 2 } }), 'EUE04', 'rollback to a withdrawal revision is refused');
    const rb = await store.command('rollback', 'usgs:us7000r001', Number(auto.revision), { payload: { to_revision: 1 }, reason: 'The normaliser misread revisions 2 to 8.' });
    has(rb, { changed: true, result: { state: 'published', revision: Number(auto.revision) + 1 } }, 'rollback makes revision 1\'s content the new current revision');
    const last = (await revs('usgs:us7000r001')).at(-1);
    eq([last.cause, last.decision_seq !== null, last.snapshot], ['owner_rollback', true, (await revs('usgs:us7000r001'))[0].snapshot], 'recorded as owner_rollback, bound to its decision');
    eq((await store.publicEvent('usgs:us7000r001')).event.correction.cause, 'owner_rollback', 'the public correction says it was the publisher\'s rollback');
    has(await store.command('rollback', 'usgs:us7000r001', Number(auto.revision) + 1, { payload: { to_revision: 1 } }), { changed: false }, 'rolling back to identical content is a logged no-op');
  }

  // ---------------------------------------------------------------- the rule, hiding a provider, the owner's view
  {
    const r = await store.command('set_rule', 'usgs', 3, { payload: { rule: rule({ min_magnitude: 5 }) } });
    eq(r.result.revision, 4, 'the owner raises the threshold to M5.0 (revision 4)');
    has((await store.ingest([usgsEvent({ provider_id: 'us7000m48a', observed_at: '2026-11-10T00:00:00.000Z', magnitude: 4.8, significance: 300 })])).counts,
      { inserted: 1, published: 0 }, 'a new M4.8 is now a candidate');
    eq((await ev('usgs:us7000good')).state, 'published', 'an M4.5 published under the old rule stays published');
    await store.command('set_rule', 'usgs', 4, { payload: { rule: DEFAULT_USGS_RULE } });
    const hidden = await store.command('hide_provider', 'usgs', 5);
    eq([hidden.changed, hidden.result.publication, hidden.result.ingest, hidden.result.revision], [true, 'hidden', 'active', 6], 'the owner hides USGS from the public view (revision 6); the ingest goes on');
    const hiddenPage = await store.publicEvents();
    eq([hiddenPage.events, hiddenPage.sources], [[], []], 'the page shows none of its events and does not list the provider');
    eq((await store.publicEvent('usgs:us6000u43g')).status, 'not_available', 'and its deep links answer not available');
    await store.command('show_provider', 'usgs', 6);
    ok(ids(await store.publicEvents({ limit: 200 })).includes('usgs:us6000u43g'), 'shown again');
    const view = await store.ownerRead('usgs:us6000u3jl');
    eq([view.module.installed, view.module.state, view.providers[0].revision, view.providers[0].configured], [true, 'enabled', 7, true], 'the owner read: the module and the rule\'s revision');
    ok(view.review.candidates.some((c) => c.id === 'usgs:us7000m48a' && c.qualifies === true),
      'the review queue lists the M4.8 candidate as qualifying under the restored M4.5 rule');
    has((await store.ingest([usgsEvent({ provider_id: 'us7000m48a', observed_at: '2026-11-10T00:00:00.000Z', magnitude: 4.8, significance: 300 })])).counts,
      { published: 1, revised: 0 }, 'a rule change applies from the event\'s next ingest: it publishes then, without a new revision');
    ok(view.review.withdrawn.some((c) => c.id === 'usgs:aka2026wpvhsf'), 'the withdrawn list has the source\'s withdrawal');
    ok(view.review.merged.some((c) => c.id === 'usgs:pt26300001'), 'the merged list has the redirect');
    ok(view.review.corrected.some((c) => c.id === 'usgs:attn6uqd'), 'the corrected list has the revised event');
    eq([view.event.summary.id, view.event.revisions.length, view.event.aliases.length], ['usgs:attn6uqd', 2, 3], 'the event in full, read by an alias');
    ok(view.event.decisions.some((d) => d.command === 'hold') && view.health.length > 0 && view.decisions.length > 0, 'with its decisions; the health log and the decision log are there');
  }

  // ---------------------------------------------------------------- coverage
  {
    has((await store.ingest([usgsEvent({ provider_id: 'us7000smal1', observed_at: '2026-11-09T00:00:00.000Z', magnitude: 2, significance: 60 })])).counts,
      { inserted: 1, published: 0 }, 'an M2.0 is stored as a candidate');
    const off = await n('eup_environment_events');
    const r = await store.propose([
      coverage('usgs:us0000none', 1, 'us0000none'),
      coverage('usgs:us7000smal1', 1, 'us7000smal1'),
      coverage('usgs:attn6uqd', 1, 'us6000u3jl'),
      coverage('usgs:attn6uqd', 2, 'pt26293000', { basis_detail: { identifier: 'pt26293000', found_in: 'url', lat: -15.1 } }),
      coverage('usgs:attn6uqd', 2, 'us7000zzzz'),
      coverage('usgs:us6000u43g', 1, 'nagqu-1', { basis: 'type_place_time', title: 'Strong earthquake shakes Lhasa', basis_detail: { place_term: 'Lhasa', type_term: 'earthquake' } }),
      coverage('usgs:us6000u43g', 1, 'nagqu-2', { domain: 'other.example.org' }),
      coverage('usgs:us6000u43g', 1, 'nagqu-3', { basis: 'type_place_time', title: 'Earthquake near Nagqu', seen_at: '2026-10-30T00:00:00.000Z', basis_detail: { place_term: 'Nagqu', type_term: 'earthquake' } }),
      coverage('usgs:us6000u43g', 1, 'nagqu-4', { basis: 'geo_point', basis_detail: { lat: 31.9, lon: 93.2 } }),
      coverage('gdelt:12345', 1, 'gdelt-only')
    ]);
    eq(r.results.map((x) => x.reason), ['event_not_found', 'event_not_public', 'stale_revision', 'basis', 'basis', 'basis', 'domain', 'basis', 'basis', 'invalid'],
      'no event for news alone; candidates take none; a stale revision, coordinates, a non-alias id, a place USGS did not name, another host, 72 h passed, a geo point and gdelt are all refused');
    eq(await n('eup_environment_events'), off, 'news never creates an event');
    const okRun = await store.propose([
      coverage('usgs:attn6uqd', 2, 'us6000u3jl', { title: 'Vanuatu quake us6000u3jl' }),
      coverage('usgs:us6000u43g', 1, 'nagqu-5', { basis: 'type_place_time', title: 'Earthquake near Nagqu shakes Tibet', seen_at: '2026-10-22T20:00:00.000Z', basis_detail: { place_term: 'Nagqu', type_term: 'earthquake' } })]);
    eq(okRun.results.map((x) => x.state), ['attached', 'proposed'], 'an official identifier attaches at once; type + place + time waits for the owner (D10)');
    const vanCov = (await store.publicEvent('usgs:attn6uqd')).event.news_coverage;
    eq(vanCov.map((c) => [c.basis, c.event_revision, c.domain]), [['official_identifier', 2, 'news.example.org']], 'the attached story is on the post, bound to revision 2');
    eq((await store.publicEvent('usgs:us6000u43g')).event.news_coverage, [], 'a proposal is not public');
    const tptId = okRun.results[1].id;
    await rejects(() => store.command('attach_coverage', tptId, 0), '40001', 'attaching needs the event\'s current revision');
    has(await store.command('attach_coverage', tptId, 1), { changed: true, result: { state: 'attached', event_revision: 1 } }, 'the owner attaches it');
    eq((await store.publicEvent('usgs:us6000u43g')).event.news_coverage.map((c) => c.basis), ['type_place_time'], 'now on the post');
    has((await store.propose([coverage('usgs:us6000u43g', 1, 'nagqu-5', { basis: 'type_place_time', title: 'Earthquake near Nagqu shakes Tibet', seen_at: '2026-10-22T20:00:00.000Z', basis_detail: { place_term: 'Nagqu', type_term: 'earthquake' } })])).counts,
      { unchanged: 1 }, 'the same proposal again changes nothing');
    // a correction: type+place+time goes stale, the official identifier follows the revision
    has((await store.ingest([{ ...CHINA, source_updated_at: '2026-11-19T01:53:57.963Z', significance: 1010, magnitude: 7.1 }])).counts, { revised: 1 }, 'USGS corrects the M7.0 to M7.1');
    eq((await store.publicEvent('usgs:us6000u43g')).event.news_coverage, [], 'its type + place + time story goes stale: off the post until matched again');
    has((await store.ingest([{ ...VAN, provider_id: 'us6000u3jl', aliases: ['attn6uqd', 'pt26293000', 'us6000u3jl'], status: 'reviewed', source_updated_at: '2026-10-20T04:31:30.000Z',
      magnitude: 6.3, magnitude_type: 'mww', lat: -15.147, depth_km: 27, title: 'M 6.3 - Vanuatu Islands', source_url: usgsUrl('us6000u3jl'), net: 'us', code: '6000u3jl' }])).counts, { revised: 1 }, 'USGS deepens the Vanuatu event by 2 km');
    eq((await store.publicEvent('usgs:attn6uqd')).event.news_coverage.map((c) => c.event_revision), [3], 'the official-identifier story follows to revision 3');
    const again = await store.propose([coverage('usgs:us6000u43g', 2, 'nagqu-5', { basis: 'type_place_time', title: 'Earthquake near Nagqu shakes Tibet', seen_at: '2026-10-22T20:00:00.000Z', basis_detail: { place_term: 'Nagqu', type_term: 'earthquake' } })]);
    eq([again.counts.revived, again.results[0].state], [1, 'proposed'], 'matched again against revision 2, it waits for the owner again');
    has(await store.command('reject_coverage', tptId, 2), { changed: true, result: { state: 'rejected', event_revision: 2 } }, 'the owner rejects it');
    has((await store.propose([coverage('usgs:us6000u43g', 2, 'nagqu-5', { basis: 'type_place_time', title: 'Earthquake near Nagqu shakes Tibet', seen_at: '2026-10-22T20:00:00.000Z', basis_detail: { place_term: 'Nagqu', type_term: 'earthquake' } })])).counts,
      { unchanged: 1, revived: 0 }, 'a rejection sticks: a matcher cannot bring it back');
    const vanId = (await admin("select id from public.eup_environment_coverage where event_id = 'usgs:attn6uqd'"))[0].id;
    has(await store.command('retract_coverage', vanId, 3), { changed: true, result: { state: 'retracted', event_revision: 3 } }, 'the owner retracts the official-identifier story');
    has((await store.propose([coverage('usgs:attn6uqd', 3, 'us6000u3jl', { title: 'Vanuatu quake us6000u3jl' })])).counts, { unchanged: 1 }, 'and an owner\'s retraction sticks too');
    // a withdrawal retracts, and a restored event's story can be matched again
    has((await store.propose([coverage('usgs:us7000del1', 3, 'us7000del1')])).counts, { revived: 1 }, 'the story retracted by the withdrawal comes back once the event did');
    // retraction by the owner of the event retracts its stories
    await store.command('retract', 'usgs:us7000del1', 3);
    eq((await admin("select state from public.eup_environment_coverage where event_id = 'usgs:us7000del1'"))[0].state, 'retracted', 'an owner retraction of the event retracts its stories');
  }

  // ---------------------------------------------------------------- append-only and identity guards, even for the table owner
  {
    const refuse = async (sql, code, m) => rejects(() => adminCode(sql).then((c) => { if (c !== 'ok') throw Object.assign(new Error(c), { code: c }); }), code, m);
    for (const table of ['eup_environment_event_revisions', 'eup_environment_event_aliases', 'eup_environment_decisions']) {
      await refuse(`update public.${table} set ${table === 'eup_environment_event_aliases' ? 'first_seen_at = first_seen_at' : table === 'eup_environment_decisions' ? 'reason = reason' : 'changes = changes'}`, '42501', `${table}: UPDATE refused`);
      await refuse(`delete from public.${table}`, '42501', `${table}: DELETE refused`);
      await refuse(`truncate public.${table} cascade`, '42501', `${table}: TRUNCATE refused`);
    }
    await refuse('update public.eup_environment_source_health set status = status', '42501', 'the health log: UPDATE refused');
    await refuse('truncate public.eup_environment_source_health', '42501', 'the health log: TRUNCATE refused');
    await refuse("delete from public.eup_environment_events where id = 'usgs:us7000good'", '42501', 'an event is never deleted');
    await refuse("update public.eup_environment_events set provider_event_id = provider_event_id, revision = revision + 2 where id = 'usgs:us7000good'", '42501', 'an event never skips a revision');
    await refuse("update public.eup_environment_events set kind = 'water_level' where id = 'usgs:us7000good'", '42501', 'an event keeps its kind');
    await refuse("update public.eup_environment_events set merged_into = null, state = 'published', first_published_at = state_changed_at where id = 'usgs:pt26300001'", '42501', 'a merge is never undone');
    await refuse("update public.eup_environment_events set first_published_at = now() where id = 'usgs:us7000good'", '42501', 'a first publication time never moves');
    await refuse("update public.eup_environment_events set state = 'published' where id = 'usgs:us7000smal1'", '23514', 'the state is always the one the facts decide (a candidate cannot be marked published)');
    await refuse("delete from public.eup_environment_providers", '42501', 'a provider rule is never deleted');
    await refuse("update public.eup_environment_providers set ingest = 'paused'", '42501', 'a provider rule changes only with its revision');
    await refuse("delete from public.eup_environment_coverage", '42501', 'coverage is never deleted');
    await refuse("update public.eup_environment_coverage set event_revision = 1 where event_id = 'usgs:attn6uqd'", '42501', 'coverage never binds to an older revision');
    await rejects(() => db.transaction(async (tx) => {
      await tx.query("update public.eup_environment_events set revision = revision + 1, snapshot = snapshot || '{\"place\":\"edited\"}' where id = 'usgs:us7000good'");
    }), '23514', 'at commit, an event revision without its history row is refused');
    eq(Number((await ev('usgs:us7000good')).revision), 1, 'and nothing changed');
    await refuse("insert into public.eup_environment_events(id, provider, kind, state, revision, provider_event_id, snapshot, observed_at, fetched_at, revised_at, state_changed_at) values ('gdelt:1', 'gdelt', 'earthquake', 'candidate', 1, '1', '{}', now(), now(), now(), now())",
      '23514', 'no event of a non-government provider, even for the table owner (E4)');
  }
  console.log(`eup-environment-events.integration: ${count} assertions passed`);
} finally {
  await store.close();
}
