// E=Up intake under real concurrency: native PostgreSQL, real sessions. What serial PGlite
// (scripts/test/eup-intake.integration.mjs) cannot show: SKIP LOCKED between concurrent claims, same-key races
// on refresh and correction, a drain that waits for a claim in flight while settlement is not queued behind it,
// and a pause and a late claim queued behind the drain, then admitted or refused.
//
//   ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> \
//     node scripts/test/eup-intake.native.integration.mjs
//
// EUP_INTAKE_SQL replaces supabase/pending/eup_intake_v1.sql (for negative controls: a mutated copy must fail).
// Disposable server only (scripts/test/support/native-postgres.mjs); never the canonical project.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { refuseUnlessAllowed, startNativePostgres, supabaseShapedDatabase, until, blockedBy, waitsOn } from './support/native-postgres.mjs';
import { OWNER } from './support/eup-module-policy-database.mjs';

refuseUnlessAllowed('eup-intake.native');
const repo = (p) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');
const server = await startNativePostgres();
const clients = [];
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; console.log(`ok ${n} ${m}`); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; console.log(`ok ${n} ${m}`); };
const code = (p) => p.then(() => 'ok', (e) => e.code);
const val = (p) => p.then((r) => r.rows[0].r);
const timed = async (p) => { const t = Date.now(); const r = await p; return [r, Date.now() - t]; };
let admin;
const svc = async () => {
  const c = await server.client('eup_intake_native');
  clients.push(c);
  await c.query('set role service_role');
  await c.query("set statement_timeout = '8s'; set lock_timeout = '8s'");
  c.pid = (await c.query('select pg_backend_pid() as p')).rows[0].p;
  return c;
};
const policy = (c, state, rev, key) => val(c.query('select public.eup_module_policy_command($1,$2,$3,$4,$5,$6) as r', [OWNER, 'intake', state, rev, key, 'synthetic proof']));
const command = (c, action, params) => val(c.query('select public.eup_sources_command($1,$2,$3) as r', [action, params, OWNER]));
const claim = (c, worker) => val(c.query('select public.eup_import_run_claim(p_worker => $1) as r', [worker]));
const finish = (c, run, status, lease) => val(c.query('select public.eup_import_run_finish(p_run_id => $1, p_status => $2, p_records => null, p_error => null, p_cursor => null, p_lease => $3) as r', [run, status, lease]));
const release = (c, run, lease) => val(c.query('select public.eup_import_run_release($1,$2,$3) as r', [run, lease, 'synthetic release']));
const apply = (c, rev) => val(c.query("select public.eup_intake_apply(p_source_id => 'sec_edgar', p_kind => 'company_fact', p_records => '[]'::jsonb, p_policy_revision => $1) as r", [rev]));
const counts = (c) => val(c.query("select public.eup_sources_read('run_counts', '{}'::jsonb) as r")).then((r) => [r.queued, r.running, r.running_expired]);
const on = (waiter, holder, label) => waitsOn(admin, waiter, holder, label);
try {
  admin = await supabaseShapedDatabase(server, 'eup_intake_native', { owners: [OWNER] });
  clients.push(admin);
  const intakeSql = process.env.EUP_INTAKE_SQL ? await readFile(process.env.EUP_INTAKE_SQL, 'utf8') : await repo('supabase/pending/eup_intake_v1.sql');
  eq(await code(admin.query(intakeSql)), '55000', 'the intake file refuses to run before the policy file');
  await admin.query(await repo('supabase/pending/eup_module_policy_v1.sql'));
  await admin.query(intakeSql); await admin.query(intakeSql);
  await admin.query(await repo('supabase/pending/eup_intake_v1.rollback.sql'));
  await admin.query(intakeSql); await admin.query(intakeSql);
  ok(true, `PostgreSQL ${server.version}: intake SQL applies twice, rolls back, applies twice again`);
  const seq = (await admin.query(`select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S' and relname like 'eup\\_%' and relname not like 'eup\\_module\\_%'`)).rows[0].n;
  eq(seq, 0, 'the intake file creates no sequence');
  const priv = (await admin.query(`select r.rolname as role, count(*) filter (where has_table_privilege(r.rolname, c.oid, 'SELECT') or has_table_privilege(r.rolname, c.oid, 'INSERT') or has_table_privilege(r.rolname, c.oid, 'UPDATE'))::int as some,
      count(*) filter (where has_table_privilege(r.rolname, c.oid, 'DELETE') or has_table_privilege(r.rolname, c.oid, 'TRUNCATE') or has_table_privilege(r.rolname, c.oid, 'REFERENCES') or has_table_privilege(r.rolname, c.oid, 'TRIGGER'))::int as more
    from pg_class c cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'eup\\_%' and c.relname not like 'eup\\_module\\_%' group by 1 order by 1`)).rows;
  eq(priv, [{ role: 'anon', some: 0, more: 0 }, { role: 'authenticated', some: 0, more: 0 }, { role: 'service_role', some: 25, more: 0 }], 'anon and authenticated hold nothing on the 25 intake tables; service_role select, insert and update only');

  const a = await svc(), b = await svc(), c = await svc(), d = await svc(), o = await svc();
  eq(await code(claim(a, 'w-a')), 'EUM01', 'not installed: claim refused');
  await val(o.query('select public.eup_module_policy_install($1,$2,$3,$4) as r', [OWNER, 'intake', 'proof-install-0001', 'synthetic install']));
  eq((await policy(o, 'enabled', 0, 'proof-enable-0001')).policy.revision, 1, 'intake installed and enabled at revision 1');
  await admin.query("insert into public.eup_source_registry_state(source_id, configured, access) values ('sec_edgar', true, 'approved')");
  const runs = [];
  for (const key of ['native-run-000A', 'native-run-000B', 'native-run-000C']) runs.push((await command(a, 'refresh', { source_id: 'sec_edgar', idempotency_key: key })).run_id);

  /* 1. concurrent claims: SKIP LOCKED, no wait, never the same run */
  await a.query('begin');
  const ca = await claim(a, 'w-a');
  const [cb, tb] = await timed(claim(b, 'w-b'));
  await c.query('begin');
  const [cc, tc] = await timed(claim(c, 'w-c'));
  const [cd, td] = await timed(claim(d, 'w-d'));
  eq([ca.run_id, cb.run_id, cc.run_id], runs, 'three sessions, two of them with the claim still uncommitted, take three different runs, oldest first');
  eq([cd.claimed, cd.policy_revision], [false, 1], 'a fourth claim finds nothing: the locked rows are skipped, not waited for');
  ok(tb < 1000 && tc < 1000 && td < 1000, `no claim waited for another (${tb} ms, ${tc} ms, ${td} ms)`);
  await a.query('commit'); await c.query('commit');
  eq(await counts(d), [0, 3, 0], 'run counts: three running');

  /* 2. the same refresh key on two sessions: one run */
  await a.query('begin');
  const ra = await command(a, 'refresh', { source_id: 'sec_edgar', idempotency_key: 'native-run-000D' });
  const rbP = command(b, 'refresh', { source_id: 'sec_edgar', idempotency_key: 'native-run-000D' });
  await on(b, a, 'second refresh waits for the first');
  await a.query('commit');
  const rb = await rbP;
  eq([ra.created, rb.created, rb.run_id === ra.run_id], [true, false, true], 'the same refresh key sent on two sessions at once queues one run; the second answers with it');
  eq((await admin.query("select count(*)::int as n from public.eup_import_runs where idempotency_key = 'native-run-000D'")).rows[0].n, 1, 'one row for that key');

  /* 3. the same correction key on two sessions: one correction, the second replays */
  const item = (await admin.query("insert into public.eup_review_items(kind, subject_table, subject_key) values ('coverage', 'fixture', 'native') returning id, revision")).rows[0];
  const corr = { review_item_id: item.id, expected_revision: item.revision, idempotency_key: 'native-correct-0001', correction: { note: 'synthetic' } };
  await a.query('begin');
  const k1 = await command(a, 'correct', corr);
  const k2P = command(b, 'correct', corr);
  await until(async () => { const w = await blockedBy(admin, b.pid); return w.type === 'Lock' && w.event === 'advisory' && (w.blockers || []).includes(a.pid); }, 'second correction waits on the key lock');
  ok(true, 'the second identical correction waits on the idempotency key lock of the first');
  await a.query('commit');
  const k2 = await k2P;
  eq([k1.replayed, k2.replayed, k2.correction_id === k1.correction_id], [false, true, true], 'after the first commits the second replays it');
  eq((await admin.query('select count(*)::int as n from public.eup_corrections')).rows[0].n, 1, 'one correction row');

  /* 4. a drain waits for a claim in flight; settlement is not queued behind the drain; a pause and a late claim are */
  await a.query('begin');
  const c4 = await claim(a, 'w-a2');
  eq([c4.claimed, c4.run_id, c4.policy_revision], [true, ra.run_id, 1], 'a claim in flight (uncommitted) under revision 1');
  const drainP = policy(o, 'draining', 1, 'proof-drain-0001');
  await on(o, a, 'drain waits for the claim');
  ok(true, 'the drain command waits for the transaction that holds the claim');
  const [fb, tfb] = await timed(finish(b, cb.run_id, 'completed', cb.lease));
  const [rc, trc] = await timed(release(b, cc.run_id, cc.lease));
  eq([fb.status, rc.status], ['completed', 'queued'], 'while the drain waits, another holder finishes one run and releases another');
  ok(tfb < 1000 && trc < 1000, `settlement did not queue behind the drain (${tfb} ms, ${trc} ms)`);
  const pauseP = command(c, 'pause', { source_id: 'gleif' });
  const lateP = code(claim(d, 'w-late'));
  await on(c, o, 'pause queues behind the drain'); await on(d, o, 'late claim queues behind the drain');
  ok(true, 'a pause and a late claim both queue behind the waiting drain (fair queue)');
  eq(await apply(a, 1), { applied: 0, duplicates: 0, reviewed: 0 }, 'the in-flight job keeps writing under its revision while the drain waits (no deadlock)');
  await a.query('commit');
  const drained = await drainP;
  eq([drained.policy.state, drained.policy.revision], ['draining', 2], 'the drain lands once the claim commits');
  eq([(await pauseP).paused, await lateP], [true, 'EUM02'], 'then the pause is admitted (reduce-only) and the late claim is refused module_draining');
  eq(await code(apply(a, 1)), 'EUM02', 'the job\'s next write is refused module_draining');
  eq((await release(a, c4.run_id, c4.lease)).status, 'queued', 'so it releases its run');
  eq((await finish(a, ca.run_id, 'failed', ca.lease)).status, 'failed', 'and the last holder settles');
  eq(await counts(d), [2, 0, 0], 'run counts while draining: nothing running, two queued and kept');
  eq((await policy(o, 'disabled', 2, 'proof-disable-0001')).policy.state, 'disabled', 'with nothing in flight the disable is immediate');
  eq(await code(claim(d, 'w-late')), 'EUM03', 'disabled: claim refused');
  eq((await policy(o, 'enabled', 3, 'proof-enable-0002')).policy.revision, 4, 're-enabled at revision 4');
  eq(await code(apply(a, 1)), 'EUM04', 'a write bound to revision 1 is refused module_policy_changed');
  const again = await claim(a, 'w-a3');
  eq([again.claimed, again.policy_revision], [true, 4], 'a kept run is claimed under revision 4');
  eq((await admin.query("select count(*)::int as n from pg_locks where locktype = 'advisory'")).rows[0].n, 0, 'no advisory lock outlives its transaction');
  console.log(`${n} native intake assertions passed on PostgreSQL ${server.version}.`);
} catch (error) {
  console.error(`FAILED after ${n} assertions: ${error.code || ''} ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const c of clients) { try { await c.end(); } catch {} }
  server.stop();
}
