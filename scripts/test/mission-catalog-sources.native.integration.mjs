// The pending mission catalog sources pair on a real PostgreSQL server: the same proof the PGlite test runs
// (scripts/test/support/mission-catalog-sources-database.mjs, runProof, on the production-shaped stub), here on
// PostgreSQL 16 (no MAINTAIN privilege) or 17, plus what one PGlite session cannot show:
//   (a) one command key sent from two sessions at once is recorded once: the second waits on the key's lock, then
//       replays the first receipt (same audit id, no second control_audit row);
//   (b) two different commands read at the same revision: the second waits on the row, then is refused MCS02 (moved),
//       changing nothing;
//   (c) the forward file's lock wait is bounded: behind a session holding a SHARE lock on network_organizations it gives
//       up after its 5 s lock_timeout (55P03) and changes nothing.
//
//   ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> \
//     node scripts/test/mission-catalog-sources.native.integration.mjs
//
// Disposable server only (scripts/test/support/native-postgres.mjs: 127.0.0.1, removed afterwards); never the canonical
// project. Run it once per PostgreSQL major (16 and 17); production runs 17.6.
import assert from 'node:assert/strict';
import { refuseUnlessAllowed, startNativePostgres, until, blockedBy } from './support/native-postgres.mjs';
import { nativeAdapter, runProof, snapshot, auditCount, forwardSql, stubSql, OWNER, DRAWDOWN_MISSIONS, CONFIRM } from './support/mission-catalog-sources-database.mjs';

refuseUnlessAllowed('mission-catalog-sources.native');
const server = await startNativePostgres();
const clients = [];
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; console.log(`ok   ${m}`); };
const newDatabase = async (name) => { const a = await server.client('postgres'); await a.query(`create database ${name}`); await a.end(); };
const session = async (db) => { const c = await server.client(db); clients.push(c); c.pid = (await c.query('select pg_backend_pid() as p')).rows[0].p; return c; };
const settle = (p) => p.then((r) => ({ ok: true, r: r?.rows?.[0]?.r }), (e) => ({ ok: false, code: e.code }));
const COMMAND = 'select public.mission_catalog_source_command($1, $2, $3, $4, $5, $6, $7::jsonb) as r';

try {
  // 1. The whole proof
  await newDatabase('mission_sources_proof');
  const db = await nativeAdapter(server, 'mission_sources_proof');
  let run;
  try {
    run = await runProof(db);
  } finally {
    await db.close();
  }
  for (const r of run.results) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.pass ? '' : `  ${r.detail}`}`);
  assert.equal(run.failed.length, 0, `${run.failed.length} checks of the proof failed on PostgreSQL ${server.version}`);
  n += run.results.length;

  // 2. Two sessions at once, and the lock bound
  await newDatabase('mission_sources_sessions');
  const admin = await session('mission_sources_sessions');
  await admin.query(await stubSql());
  await admin.query(`update public.action_missions set status = 'open' where id = '${DRAWDOWN_MISSIONS[0]}'`);
  const forward = await forwardSql();
  const fp = { query: async (sql, params) => (await admin.query(sql, params)).rows };

  // (c) behind a SHARE lock on network_organizations the forward file gives up after 5 s and changes nothing
  const holder = await session('mission_sources_sessions');
  await holder.query('begin');
  await holder.query('lock table public.network_organizations in share mode');
  const before = await snapshot(fp);
  await admin.query("set statement_timeout = '30s'"); // a file without its lock_timeout would fail here instead of hanging
  const started = Date.now();
  const applied = await settle(admin.query(forward));
  const waited = Date.now() - started;
  await admin.query('rollback').catch(() => {});
  await admin.query('reset statement_timeout');
  ok(!applied.ok && applied.code === '55P03', `(c) behind a SHARE lock on network_organizations the forward file gives up: ${applied.code}`);
  ok(waited >= 4500 && waited < 20000, `(c) after its 5 s lock timeout (waited ${waited} ms)`);
  ok((await snapshot(fp)) === before, '(c) and changed nothing');
  await holder.query('rollback');
  await admin.query(forward);
  ok((await admin.query("select state from public.mission_catalog_sources where catalog = 'drawdown'")).rows[0]?.state === 'draft', '(c) once the lock is gone it applies');

  // (a) one key from two sessions at once: recorded once
  const s1 = await session('mission_sources_sessions');
  const s2 = await session('mission_sources_sessions');
  for (const c of [s1, s2]) await c.query('set role service_role');
  const key = crypto.randomUUID();
  const args = [OWNER, 'drawdown', 'show', 1, key, 'Native proof: one key, two sessions.', JSON.stringify(CONFIRM)];
  await s1.query('begin');
  const first = (await s1.query(COMMAND, args)).rows[0].r;
  const second = settle(s2.query(COMMAND, args));
  await until(async () => { const b = await blockedBy(admin, s2.pid); return b.type === 'Lock' && (b.blockers || []).includes(s1.pid); }, 'the second session waits on the key');
  ok(true, '(a) the second session waits on the first session\'s key lock');
  await s1.query('commit');
  const two = await second;
  ok(first.replayed === false && two.ok && two.r.replayed === true && two.r.audit_id === first.audit_id && two.r.revision === first.revision,
    `(a) the second replays the first receipt (audit ${first.audit_id}, revision ${first.revision})`);
  ok((await auditCount(fp)) === 1, '(a) one control_audit row');

  // (b) two commands read at revision 2: the second waits on the row, then is refused MCS02
  await s1.query('begin');
  const hide = (await s1.query(COMMAND, [OWNER, 'drawdown', 'hide', 2, crypto.randomUUID(), 'Native proof: the first of two.', '{}'])).rows[0].r;
  const edit = settle(s2.query(COMMAND, [OWNER, 'drawdown', 'edit', 2, crypto.randomUUID(), 'Native proof: the second of two.', JSON.stringify({ role_line: 'A second role line, read at the same revision.' })]));
  await until(async () => { const b = await blockedBy(admin, s2.pid); return b.type === 'Lock' && (b.blockers || []).includes(s1.pid); }, 'the second command waits on the row');
  ok(true, '(b) the second command waits on the row the first holds');
  await s1.query('commit');
  const moved = await edit;
  ok(hide.state === 'hidden' && hide.revision === 3 && !moved.ok && moved.code === 'MCS02', `(b) the first wins (revision ${hide.revision}); the second is refused ${moved.code}`);
  const row = (await admin.query("select state, revision, role_line from public.mission_catalog_sources")).rows[0];
  ok(row.state === 'hidden' && row.revision === 3 && !row.role_line.startsWith('A second'), '(b) and changed nothing');
  ok((await auditCount(fp)) === 2, '(b) one more control_audit row, for the first only');

  console.log(`mission-catalog-sources.native: ${n} checks passed on PostgreSQL ${server.version}`);
} finally {
  for (const c of clients) await c.end().catch(() => {});
  server.stop();
}
