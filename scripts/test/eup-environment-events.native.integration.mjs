// The pending E=UP environmental event store under real concurrency: native PostgreSQL, real sessions. What one serial
// PGlite session (scripts/test/eup-environment-events.integration.mjs) cannot show:
//   (a) the five parts on PostgreSQL 16 or 17 with the real API roles and Supabase-style default privileges: they apply
//       in order, roll back and apply twice; no API role holds a table or sequence privilege; service_role executes
//       exactly the seven entry points; every RPC commits as service_role (the commit-time consistency check included);
//   (b) two ingest runs of one provider at once queue on the provider lock: the second waits, then finds what the first
//       wrote and changes nothing;
//   (c) one idempotency key on two sessions executes once: the second waits on the key lock and replays the receipt;
//   (d) an owner hold waits for an ingest that holds the event; once the ingest's new revision commits, the hold at the
//       old revision is refused 40001 and logs nothing;
//   (e) a coverage proposal and a withdrawal of the same event queue on the event row, in either order, without a
//       deadlock: proposal first, then the withdrawal retracts it; withdrawal first, then the proposal is refused;
//   (f) a lock wait is bounded: an owner command behind a held event row gives up after 5 s (55P03), changing nothing.
//
//   ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> \
//     node scripts/test/eup-environment-events.native.integration.mjs
//
// Disposable server only (scripts/test/support/native-postgres.mjs), 127.0.0.1, removed afterwards; never the
// canonical project. EUP_ENVIRONMENT_PARTS_DIR replaces supabase/pending/ for the five parts (negative controls).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { refuseUnlessAllowed, startNativePostgres, supabaseShapedDatabase, until, blockedBy } from './support/native-postgres.mjs';
import { OWNER, PEER, SECOND_OWNER, STORE_ENTRY_POINTS, STORE_TABLES, storePartSql, storeRollbackSql, usgsEvent } from './support/eup-environment-database.mjs';

refuseUnlessAllowed('eup-environment-events.native');
const repo = (p) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');
const server = await startNativePostgres();
const DB = 'eup_environment_native';
const clients = [];
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; console.log(`ok ${n} ${m}`); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; console.log(`ok ${n} ${m}`); };
const code = (p) => p.then(() => 'ok', (e) => e.code);
const val = (p) => p.then((r) => r.rows[0].r);
let admin;
const svc = async () => {
  const c = await server.client(DB);
  clients.push(c);
  await c.query('set role service_role');
  c.pid = (await c.query('select pg_backend_pid() as p')).rows[0].p;
  return c;
};
const now = () => new Date().toISOString();
const ingest = (c, run, events, health = { status: 'ok' }) =>
  val(c.query('select public.eup_environment_ingest($1, $2, $3::timestamptz, $4::jsonb, $5::jsonb) as r', ['usgs', run, now(), JSON.stringify(health), JSON.stringify(events)]));
const command = (c, cmd, target, expected, key, payload = {}, reason = 'synthetic native proof', actor = OWNER) =>
  val(c.query('select public.eup_environment_owner_command($1, $2, $3, $4, $5, $6, $7::jsonb) as r', [actor, cmd, target, expected, key, reason, JSON.stringify(payload)]));
const propose = (c, proposals) => val(c.query('select public.eup_environment_coverage_propose($1::jsonb) as r', [JSON.stringify(proposals)]));
const lockedBy = (waiter, holder, label) => until(async () => {
  const b = await blockedBy(admin, waiter.pid);
  return b.type === 'Lock' && b.waiting && (b.blockers || []).includes(holder.pid);
}, label);
/** settles a promise into a flag the proof can read while it is still pending */
const watch = (p) => { const w = { done: false, p }; p.then(() => { w.done = true; }, () => { w.done = true; }); return w; };
const decisions = async () => Number((await admin.query('select count(*) as n from public.eup_environment_decisions')).rows[0].n);
const evRow = async (id) => (await admin.query('select state, revision::int as revision from public.eup_environment_events where id = $1', [id])).rows[0];
const coverage = (eventId, revision, article) => ({ event_id: eventId, event_revision: revision, article_key: `gdelt:${article}`,
  url: `https://news.example.org/2026/${article}`, title: 'Strong earthquake reported', domain: 'news.example.org',
  seen_at: '2026-11-18T12:00:00.000Z', basis: 'official_identifier', basis_detail: { identifier: article, found_in: 'url' } });

try {
  admin = await supabaseShapedDatabase(server, DB, { owners: [OWNER, SECOND_OWNER], members: [PEER] });
  clients.push(admin);
  await admin.query(await repo('supabase/migrations/20261117144103_eup_module_policy_v1.sql'));
  const parts = await Promise.all([1, 2, 3, 4, 5].map((i) => storePartSql(i)));
  eq(await code(admin.query(parts[1])), '55000', `PostgreSQL ${server.version}: part 02 refuses before part 01`);
  await admin.query('rollback'); // the refused part stopped inside its own transaction block
  eq(Number((await admin.query("select count(*) as n from pg_proc where proname like 'eup_environment%'")).rows[0].n), 0, 'and created nothing');
  for (const sql of parts) await admin.query(sql);
  await admin.query(await storeRollbackSql());
  eq(Number((await admin.query("select count(*) as n from pg_class where relname like 'eup_environment%'")).rows[0].n), 0, 'the rollback removes every store relation');
  for (const sql of parts) await admin.query(sql);
  for (const sql of parts) await admin.query(sql);
  ok(true, 'the five parts apply in order, roll back, apply again and apply twice');

  /* (a) the wall, with the real API roles and Supabase-style default privileges */
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const t = (await admin.query(`select bool_or(has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as a
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($2::text[])`, [role, STORE_TABLES])).rows[0].a;
    const s = (await admin.query(`select has_sequence_privilege($1, 'public.eup_environment_source_health_seq_seq', 'USAGE,SELECT,UPDATE')
      or has_sequence_privilege($1, 'public.eup_environment_decisions_seq_seq', 'USAGE,SELECT,UPDATE') as s`, [role])).rows[0].s;
    eq([t, s], [false, false], `${role} holds no privilege on any store table or identity sequence`);
  }
  const exec = (await admin.query(`select replace(p.oid::regprocedure::text, 'public.', '') as f from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_environment%' and has_function_privilege('service_role', p.oid, 'EXECUTE') order by 1`)).rows.map((r) => r.f);
  eq(exec, [...STORE_ENTRY_POINTS], 'service_role executes exactly the seven entry points');
  const anyApi = (await admin.query(`select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')) as a
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_environment%'`)).rows[0].a;
  eq(anyApi, false, 'anon and authenticated execute none of the store functions');

  const a = await svc(), b = await svc(), c = await svc();
  eq((await command(a, 'set_rule', 'usgs', 0, 'native-set-rule-0001')).result.revision, 1, 'the owner configures USGS (the D7 default rule)');
  const events = [usgsEvent({ provider_id: 'us7000nat1', observed_at: '2026-11-18T01:00:00.000Z', magnitude: 5.4 }),
    usgsEvent({ provider_id: 'us7000nat2', observed_at: '2026-11-18T02:00:00.000Z', magnitude: 4.9 }),
    usgsEvent({ provider_id: 'us7000nat3', observed_at: '2026-11-18T03:00:00.000Z', magnitude: 6.1 })];
  eq((await ingest(a, 'native-run-0001', events)).counts.inserted, 3, 'an ingest run as service_role inserts and commits (the commit-time check passes as service_role)');

  /* (b) two runs of one provider at once */
  {
    // the new event first: without the provider lock, run 3 would insert it too and fail on the duplicate key
    const more = [usgsEvent({ provider_id: 'us7000nat4', observed_at: '2026-11-18T04:00:00.000Z', magnitude: 5 }), ...events];
    await a.query('begin');
    const first = await ingest(a, 'native-run-0002', more);
    eq([first.counts.inserted, first.counts.unchanged], [1, 3], 'run 2 (not yet committed) inserts the new event');
    const second = watch(ingest(b, 'native-run-0003', more));
    await lockedBy(b, a, 'run 3 waits on the provider lock');
    ok(!second.done, 'run 3 is still waiting while run 2 is open');
    await a.query('commit');
    const r3 = await second.p;
    eq([r3.counts.inserted, r3.counts.unchanged], [0, 4], 'run 3 then finds what run 2 wrote and changes nothing');
  }

  /* (c) one key on two sessions */
  {
    const before = await decisions();
    await a.query('begin');
    const r1 = await command(a, 'hold', 'usgs:us7000nat1', 1, 'native-hold-key-0001', {}, 'one key, two sessions');
    const second = watch(command(b, 'hold', 'usgs:us7000nat1', 1, 'native-hold-key-0001', {}, 'one key, two sessions'));
    await lockedBy(b, a, 'the same key on session b waits for session a');
    await a.query('commit');
    eq(await second.p, r1, 'the second session replays the first one\'s receipt');
    eq(await decisions(), before + 1, 'and the command ran once: one decision row');
    eq((await evRow('usgs:us7000nat1')).state, 'held', 'the event is held');
    await command(a, 'release', 'usgs:us7000nat1', 1, 'native-release-0001');
  }

  /* (d) an owner hold behind an ingest that revises the event */
  {
    await a.query('begin');
    const rev = await ingest(a, 'native-run-0004', [{ ...events[0], magnitude: 5.6 }]);
    eq(rev.counts.revised, 1, 'an open ingest revises us7000nat1 to revision 2');
    const before = await decisions();
    const hold = watch(command(b, 'hold', 'usgs:us7000nat1', 1, 'native-hold-stale-0001'));
    await lockedBy(b, a, 'the hold waits on the event row the ingest holds');
    await a.query('commit');
    eq(await code(hold.p), '40001', 'once the revision commits, the hold at the old revision is refused (409)');
    eq([await decisions(), (await evRow('usgs:us7000nat1')).revision], [before, 2], 'and nothing was logged or changed by it');
  }

  /* (e) a proposal and a withdrawal of one event, both orders */
  {
    await a.query('begin');
    eq((await propose(a, [coverage('usgs:us7000nat2', 1, 'us7000nat2')])).counts.attached, 1, 'a proposal attaches (not yet committed)');
    const del = watch(ingest(b, 'native-run-0005', [{ provider_id: 'us7000nat2', status: 'deleted' }]));
    await lockedBy(b, a, 'the withdrawal waits on the event row the proposal holds');
    await a.query('commit');
    eq((await del.p).counts.withdrawn, 1, 'then the withdrawal runs');
    eq((await admin.query("select state from public.eup_environment_coverage where event_id = 'usgs:us7000nat2'")).rows[0].state, 'retracted',
      'and retracts the story attached just before it: no deadlock');
    await a.query('begin');
    eq((await ingest(a, 'native-run-0006', [{ provider_id: 'us7000nat3', status: 'deleted' }])).counts.withdrawn, 1, 'a withdrawal of us7000nat3 (not yet committed)');
    const prop = watch(propose(b, [coverage('usgs:us7000nat3', 1, 'us7000nat3')]));
    await lockedBy(b, a, 'the proposal waits on the event row the withdrawal holds');
    await a.query('commit');
    eq((await prop.p).results[0].reason, 'event_not_public', 'then the proposal is refused: the event is withdrawn');
  }

  /* (f) a bounded wait */
  {
    await c.query('reset role');
    await c.query('begin');
    await c.query("select 1 from public.eup_environment_events where id = 'usgs:us7000nat4' for update");
    const before = await decisions();
    const started = Date.now();
    eq(await code(command(b, 'hold', 'usgs:us7000nat4', 1, 'native-hold-bounded-0001')), '55P03', 'an owner command behind a held row gives up (55P03)');
    const waited = Date.now() - started;
    ok(waited >= 4500 && waited < 15000, `after the 5 s lock timeout (waited ${waited} ms)`);
    await c.query('rollback');
    eq([await decisions(), (await evRow('usgs:us7000nat4')).state], [before, 'published'], 'and changed nothing');
    eq((await command(b, 'hold', 'usgs:us7000nat4', 1, 'native-hold-bounded-0001')).changed, true, 'the same key is free to run once the row is free');
  }
  console.log(`eup-environment-events.native: ${n} checks passed on PostgreSQL ${server.version}`);
} finally {
  for (const cl of clients) { try { await cl.end(); } catch { /* already closed */ } }
  server.stop();
}
