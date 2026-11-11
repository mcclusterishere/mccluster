// E=Up module policy under real concurrency: native PostgreSQL, real sessions. What serial PGlite
// (scripts/test/eup-module-policy.integration.mjs) cannot show:
//   (a) a drain waits for a write already in flight, and a writer that arrives after the drain request queues
//       BEHIND it (one fair lock queue) and is then refused EUM02;
//   (b) the in-flight transaction keeps writing while the drain waits (re-entrant guard, no deadlock);
//   (r) reduce-only work: a disable waits for an in-flight reduce writer, and a reduce writer queued behind the
//       disable is admitted under the new revision;
//   (m) the reduce marker is a mode, never a bypass: set by hand it takes no lock by itself, but the trigger then
//       holds the shared lock and the policy row FOR SHARE, and a state command waits for that writer;
//   (d) the same key on two sessions executes once; two commands at one revision have one winner;
//   a state command's lock wait is bounded (55P03, nothing changed or logged); a REPEATABLE READ writer whose
//   snapshot predates a drain is refused 40001; and (f) an intake job under the policy: claim, in-flight apply,
//   drain, refused side effect, release, re-enable, stale revision refused EUM04, reclaim.
// Writers are statements on a fixture table that carries the trigger backstop every guarded E=Up table carries,
// so this proof stands on the policy file alone and does not change when a module's commands do.
//
//   ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> \
//     node scripts/test/eup-module-policy.native.integration.mjs
//
// EUP_POLICY_SQL replaces supabase/pending/eup_module_policy_v1.sql (for negative controls). Disposable server
// only (scripts/test/support/native-postgres.mjs); never the canonical project.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { refuseUnlessAllowed, startNativePostgres, supabaseShapedDatabase, until, blockedBy } from './support/native-postgres.mjs';
import { OWNER, PEER, SECOND_OWNER, MODULE_POLICY_ENTRY_POINTS, MODULE_POLICY_LOCK_KEY } from './support/eup-module-policy-database.mjs';

refuseUnlessAllowed('eup-module-policy.native');
const repo = (p) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');
const server = await startNativePostgres();
const DB = 'eup_policy_native';
const clients = [];
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; console.log(`ok ${n} ${m}`); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; console.log(`ok ${n} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (p) => p.then(() => 'ok', (e) => e.code);
const val = (p) => p.then((r) => r.rows[0].r);
const k = (s) => `proof-${s}-0000`;
let admin;
const svc = async () => {
  const c = await server.client(DB);
  clients.push(c);
  await c.query('set role service_role');
  c.pid = (await c.query('select pg_backend_pid() as p')).rows[0].p;
  return c;
};
const policy = (c, module, state, rev, key, reason = 'synthetic proof', actor = OWNER) =>
  val(c.query('select public.eup_module_policy_command($1,$2,$3,$4,$5,$6) as r', [actor, module, state, rev, key, reason]));
const install = (c, module, key, actor = OWNER) => val(c.query('select public.eup_module_policy_install($1,$2,$3,$4) as r', [actor, module, key, 'synthetic install']));
const read = (c, module) => val(c.query('select public.eup_module_policy_read($1) as r', [module]));
const write = (c, note) => c.query('insert into public.eup_fixture_league_writes(note) values ($1)', [note]);
const touch = (c) => c.query("update public.eup_fixture_league_writes set note = note where note = 'first'");
const notes = async () => (await admin.query('select note from public.eup_fixture_league_writes order by id')).rows.map((r) => r.note);
const lockedBy = (waiter, holder, label) => until(async () => {
  const b = await blockedBy(admin, waiter.pid);
  return b.type === 'Lock' && b.waiting && (b.blockers || []).includes(holder.pid);
}, label);
/** settles a promise into a flag the proof can read while it is still pending */
const watch = (p) => { const w = { done: false, p }; p.then(() => { w.done = true; }, () => { w.done = true; }); return w; };
try {
  admin = await supabaseShapedDatabase(server, DB, { owners: [OWNER, SECOND_OWNER], members: [PEER] });
  clients.push(admin);
  const rowLocksAvailable = (await code(admin.query('create extension if not exists pgrowlocks'))) === 'ok';
  if (!rowLocksAvailable) console.log('note: pgrowlocks is not installed on this server; the two row-lock readings below are skipped');
  const policySql = process.env.EUP_POLICY_SQL ? await readFile(process.env.EUP_POLICY_SQL, 'utf8') : await repo('supabase/pending/eup_module_policy_v1.sql');
  await admin.query(policySql);
  await admin.query(await repo('supabase/pending/eup_module_policy_v1.rollback.sql'));
  await admin.query(policySql); await admin.query(policySql);
  ok(true, `PostgreSQL ${server.version}: the policy file applies, rolls back, applies again and applies twice`);
  await admin.query(`create table public.eup_fixture_league_writes(id bigint generated always as identity primary key, note text not null);
    create trigger eup_fixture_league_writes_module_policy before insert or update or delete on public.eup_fixture_league_writes
      for each statement execute function public.eup_module_guard_trigger('league');`);

  const s = await svc(), w = await svc(), o = await svc(), nw = await svc();
  /* grants, with the real API roles and Supabase-style default privileges switched on */
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const t = (await admin.query(`select has_table_privilege($1,'public.eup_module_policies','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as a,
      has_table_privilege($1,'public.eup_module_policy_commands','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as b,
      has_sequence_privilege($1,'public.eup_module_policy_commands_seq_seq','USAGE,SELECT,UPDATE') as q`, [role])).rows[0];
    eq([t.a, t.b, t.q], [false, false, false], `${role} holds no privilege on the policy tables or the command sequence`);
  }
  const fns = (await admin.query(`select p.oid::regprocedure::text as f, has_function_privilege('service_role', p.oid, 'EXECUTE') as s,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as a, has_function_privilege('anon', p.oid, 'EXECUTE') as n
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_module%' order by 1`)).rows;
  eq(fns.filter((f) => f.s).map((f) => f.f.replace(/^public\./, '')).sort(), [...MODULE_POLICY_ENTRY_POINTS].sort(), 'service_role executes exactly the entry points');
  ok(fns.every((f) => !f.a && !f.n), 'anon and authenticated execute none of them');
  eq(await code(s.query('select * from public.eup_module_policies')), '42501', 'service_role cannot read the policy table directly');
  eq(await code(s.query("update public.eup_module_policies set state = 'enabled'")), '42501', 'service_role cannot write the policy table directly');

  /* a missing policy row fails closed */
  eq(await code(read(s, 'league')), 'EUM01', 'reading a module with no policy row is an error, never "enabled"');
  eq(await code(write(s, 'first')), 'EUM01', 'a guarded write is refused while no policy row exists (trigger backstop)');
  eq(await code(policy(s, 'league', 'enabled', 0, k('en-missing'))), 'EUM01', 'a state command on a module that is not installed');
  await w.query('begin'); await w.query("select set_config('eup.module_reduce', 'league', true)");
  eq(await code(write(w, 'first')), 'EUM01', '(m) a hand-set reduce marker on a module with no row is refused EUM01 through the trigger');
  await w.query('rollback');

  /* install: disabled at revision 0, owner only, replayable */
  eq(await code(install(s, 'league', k('inst-peer'), PEER)), '42501', 'a member who is not a house owner cannot install');
  const i1 = await install(s, 'league', k('inst')); const i1b = await install(s, 'league', k('inst'));
  eq([i1.policy.state, i1.policy.revision, JSON.stringify(i1) === JSON.stringify(i1b)], ['disabled', 0, true], 'install starts disabled at revision 0; its replay returns the same receipt');
  eq(await code(install(s, 'league', k('inst-again'))), 'EUM07', 'a second install with a new key is refused');
  eq(await code(write(s, 'first')), 'EUM03', 'a disabled module refuses the write with EUM03');

  /* revision compare-and-set, replay, and the command log */
  const e1 = await policy(s, 'league', 'enabled', 0, k('enable-1'));
  eq([e1.policy.state, e1.policy.revision, e1.changed], ['enabled', 1, true], 'enable moves revision 0 to 1');
  eq(JSON.stringify(await policy(s, 'league', 'enabled', 0, k('enable-1'))), JSON.stringify(e1), '(d) an exact replay returns the stored receipt');
  eq(await code(policy(s, 'league', 'enabled', 0, k('enable-1'), 'altered reason')), 'EUM06', '(d) a replay with a changed payload is refused');
  eq(await code(policy(s, 'league', 'draining', 0, k('stale-1'))), '40001', '(d) a stale revision is refused');
  eq(await code(policy(s, 'league', 'disabled', 1, k('direct-disable'))), 'EUM05', 'enabled to disabled is refused until drained');
  eq(await code(policy(s, 'league', 'draining', 1, k('peer-drain'), 'x', PEER)), '42501', 'a non-owner cannot drain');
  const noop = await policy(s, 'league', 'enabled', 1, k('noop'));
  eq([noop.changed, noop.policy.revision], [false, 1], 'a no-op keeps the revision and is still logged');
  eq((await admin.query("select count(*)::int as n from public.eup_module_policy_commands where module_id = 'league'")).rows[0].n, 3, 'the log holds install, enable and the no-op; refusals log nothing');
  eq(await code(admin.query("update public.eup_module_policy_commands set reason = 'x'")), '42501', 'the command log refuses UPDATE even for the table owner');
  eq(await code(admin.query('delete from public.eup_module_policy_commands')), '42501', 'the command log refuses DELETE');
  eq(await code(admin.query('truncate public.eup_module_policy_commands')), '42501', 'the command log refuses TRUNCATE');
  eq(await code(admin.query("update public.eup_module_policies set state = 'disabled'")), '42501', 'the policy row cannot change without a revision step');
  eq(await code(admin.query('delete from public.eup_module_policies')), '42501', 'the policy row cannot be deleted');
  await write(s, 'first');
  eq(await notes(), ['first'], 'enabled: the guarded write is admitted');

  /* (a) + (b): the drain waits for the write in flight and queues a late writer behind itself */
  await w.query('begin');
  await write(w, 'in-flight');
  const t0 = Date.now();
  const drain = watch(policy(o, 'league', 'draining', 1, k('drain-1'), 'drain under real work'));
  await lockedBy(o, w, 'drain blocked by the in-flight writer');
  ok(!drain.done, '(a) the drain is blocked: a Lock wait whose blocker is the in-flight writer, with an ungranted lock');
  const late = watch(code(write(nw, 'late')));
  await until(async () => { const b = await blockedBy(admin, nw.pid); return b.type === 'Lock' && (b.blockers || []).includes(o.pid); }, 'late writer queued behind the drain');
  ok(!late.done && !drain.done, '(a) a writer that arrives after the drain request queues BEHIND the drain (fair queue)');
  await write(w, 'in-flight-2');
  ok(!drain.done, '(b) the in-flight transaction keeps writing while the drain waits (re-entrant guard, no deadlock)');
  eq((await read(s, 'league')).state, 'enabled', 'the policy still reads enabled while the drain waits');
  await sleep(150); await w.query('commit');
  const dr = await drain.p;
  eq([dr.policy.state, dr.policy.revision, dr.prior.state, dr.prior.revision], ['draining', 2, 'enabled', 1], '(a) the drain completes only after the in-flight transaction commits');
  ok(Date.now() - t0 >= 150, '(a) and not before');
  eq(await late.p, 'EUM02', '(a) the queued late writer is then refused with EUM02 module_draining');
  eq(await notes(), ['first', 'in-flight', 'in-flight-2'], '(b) the writes that began before the drain committed; the late one left nothing');
  eq(await code(write(s, 'after')), 'EUM02', 'every new write is refused while draining');
  eq(await code(touch(s)), 'EUM02', 'a direct UPDATE is refused while draining (trigger backstop)');
  eq((await s.query('select count(*)::int as n from public.eup_fixture_league_writes')).rows[0].n, 3, 'reads keep working while draining');

  /* (r): the disable waits for an in-flight reduce writer; a reduce writer queued behind it is admitted after */
  const before = await notes();
  await w.query('begin');
  eq(await val(w.query("select public.eup_module_guard_reduce('league') as r")), '2', '(r) the reduce guard answers while draining with the locked revision');
  eq(await code(touch(w)), 'ok', '(r) the reduce writer writes a guarded table while draining');
  eq(await code(touch(s)), 'EUM02', '(r) another session without the marker is still refused: the marker is per transaction');
  const dis = watch(policy(o, 'league', 'disabled', 2, k('disable-1')));
  await lockedBy(o, w, 'disable blocked by the reduce writer');
  ok(!dis.done, '(r) the disable is blocked by the in-flight reduce writer');
  const lateR = watch((async () => {
    await nw.query('begin');
    try {
      const r = await val(nw.query("select public.eup_module_guard_reduce('league') as r"));
      const u = await code(touch(nw));
      await nw.query('commit');
      return [r, u];
    } catch (e) { await nw.query('rollback'); return e.code; }
  })());
  await until(async () => { const b = await blockedBy(admin, nw.pid); return b.type === 'Lock' && (b.blockers || []).includes(o.pid); }, 'late reduce writer queued behind the disable');
  ok(!lateR.done && !dis.done, '(r) a reduce writer that arrives after the disable request queues BEHIND it');
  eq(await code(touch(w)), 'ok', '(r) the in-flight reduce writer keeps writing while the disable waits');
  eq((await read(s, 'league')).state, 'draining', '(r) the policy still reads draining while the disable waits');
  await sleep(150); await w.query('commit');
  const d1 = await dis.p;
  eq([d1.policy.state, d1.policy.revision], ['disabled', 3], 'draining to disabled, only after the reduce writer committed');
  eq(await lateR.p, ['3', 'ok'], '(r) the queued reduce writer is then admitted under the disabled policy (revision 3)');
  eq(await code(touch(s)), 'EUM03', '(r) a write without the marker is refused while disabled');
  eq((await val(s.query("select current_setting('eup.module_reduce', true) as r"))) || '', '', '(r) no marker on a session that never called the reduce guard');
  eq((await val(nw.query("select current_setting('eup.module_reduce', true) as r"))) || '', '', '(r) and none left on the reduce writer\'s session after its commit');
  eq(await notes(), before, 'disabling deletes nothing');

  /* (m): a writer that only hand-set the marker still holds the locks, and a state command waits for it */
  const advisory = async (c) => (await admin.query("select mode, granted from pg_locks where pid = $1 and locktype = 'advisory' and classid = $2", [c.pid, MODULE_POLICY_LOCK_KEY])).rows.map((r) => [r.mode, r.granted]);
  const rowLocks = async () => (await admin.query("select modes::text as modes, pids::text as pids from pgrowlocks('public.eup_module_policies')")).rows.map((r) => [r.modes, r.pids]);
  await w.query('begin'); await w.query("select set_config('eup.module_reduce', 'league', true)");
  eq(await advisory(w), [], '(m) setting the marker by hand takes no lock by itself');
  if (rowLocksAvailable) eq(await rowLocks(), [], '(m) nor a row lock');
  eq(await code(touch(w)), 'ok', '(m) the hand-marked write is admitted while disabled: the marker selects reduce mode');
  eq(await advisory(w), [['ShareLock', true]], '(m) and the trigger made that writer hold the shared advisory lock');
  if (rowLocksAvailable) eq(await rowLocks(), [['{"For Share"}', `{${w.pid}}`]], '(m) and the policy row FOR SHARE');
  const en = watch(policy(o, 'league', 'enabled', 3, k('enable-2')));
  await lockedBy(o, w, 'enable blocked by the hand-marked writer');
  ok(!en.done, '(m) a state command waits for a writer that only hand-set the marker');
  const lateM = watch((async () => {
    await nw.query('begin');
    try {
      await nw.query("select set_config('eup.module_reduce', 'league', true)");
      const u = await code(touch(nw));
      await nw.query('commit');
      return u;
    } catch (e) { await nw.query('rollback'); return e.code; }
  })());
  await until(async () => { const b = await blockedBy(admin, nw.pid); return b.type === 'Lock' && (b.blockers || []).includes(o.pid); }, 'late hand-marked writer queued behind the enable');
  ok(!lateM.done && !en.done, '(m) a hand-marked writer that arrives after the command queues BEHIND it');
  eq(await code(touch(w)), 'ok', '(m) the in-flight hand-marked writer keeps writing while the command waits');
  eq((await read(s, 'league')).state, 'disabled', '(m) the policy still reads disabled while the command waits');
  await sleep(150); await w.query('commit');
  const e2 = await en.p;
  eq(await lateM.p, 'ok', '(m) the queued hand-marked writer runs after the command and commits');
  eq([await advisory(w), await advisory(nw)], [[], []], '(m) no advisory lock outlives either transaction');
  eq([e2.policy.state, e2.policy.revision], ['enabled', 4], 'disabled to enabled, only after the hand-marked writer committed');
  eq(await code(write(s, 'after-enable')), 'ok', 'after re-enable an ordinary write is admitted again');

  /* (d) concurrent: the same key on two sessions executes once; two keys at one revision have one winner */
  const same = await Promise.all([o, nw].map((c) => policy(c, 'league', 'draining', 4, k('race-same'), 'race').then((r) => JSON.stringify(r), (e) => e.code)));
  ok(same[0] === same[1] && JSON.parse(same[0]).policy.revision === 5, '(d) the same key sent on two sessions executes once and both get the same receipt');
  eq((await admin.query('select count(*)::int as n from public.eup_module_policy_commands where idempotency_key = $1', [k('race-same')])).rows[0].n, 1, '(d) exactly one log row for that key');
  const cas = await Promise.all([[o, 'enabled', 'cas-a'], [nw, 'disabled', 'cas-b']].map(([c, st, key]) => policy(c, 'league', st, 5, k(key), 'cas').then((r) => r.policy.revision, (e) => e.code)));
  eq([...cas].sort(), [6, '40001'].sort(), '(d) two different commands at the same revision: exactly one wins, the other gets 40001');
  if ((await read(s, 'league')).state === 'disabled') await policy(s, 'league', 'enabled', 6, k('re-enable-3'));
  const cur = await read(s, 'league');
  eq(cur.state, 'enabled', 'league enabled again for the remaining cases');

  /* a state command's lock wait is bounded: nothing changes on 55P03, and the same key then succeeds */
  await w.query('begin'); await write(w, 'slow');
  const tb = Date.now();
  eq(await code(policy(o, 'league', 'draining', cur.revision, k('drain-busy'), 'bounded wait')), '55P03', 'a drain that cannot get the lock within lock_timeout fails with 55P03');
  ok(Date.now() - tb >= 4500 && Date.now() - tb < 7500, `it waited the configured 5 s (${Date.now() - tb} ms)`);
  eq((await read(s, 'league')).revision, cur.revision, 'a timed-out drain changed nothing');
  eq((await admin.query('select count(*)::int as n from public.eup_module_policy_commands where idempotency_key = $1', [k('drain-busy')])).rows[0].n, 0, 'and logged nothing');
  await w.query('commit');
  const retry = await policy(o, 'league', 'draining', cur.revision, k('drain-busy'), 'bounded wait');
  eq(retry.policy.state, 'draining', 'the same key succeeds once the writer is gone');
  await policy(s, 'league', 'enabled', retry.policy.revision, k('re-enable-4'));

  /* a REPEATABLE READ writer whose snapshot predates the drain cannot write on it */
  const rr = await svc();
  await rr.query('begin isolation level repeatable read'); await rr.query('select 1');
  const pre = await read(s, 'league');
  await policy(s, 'league', 'draining', pre.revision, k('drain-rr'));
  eq(await code(write(rr, 'rr')), '40001', 'a repeatable-read writer with a pre-drain snapshot is refused (serialization failure), never admitted as enabled');
  await rr.query('rollback');
  await policy(s, 'league', 'enabled', pre.revision + 1, k('re-enable-5'));

  /* (f) an intake job under the policy: claim, a write in flight, drain, refused side effect, settlement */
  await admin.query(await repo('supabase/pending/eup_intake_v1.sql'));
  await install(s, 'intake', k('inst-intake'));
  eq(await code(val(s.query("select public.eup_import_run_claim('core-a') as r"))), 'EUM03', '(f) a disabled module starts no job');
  const ie = await policy(s, 'intake', 'enabled', 0, k('intake-enable'));
  await admin.query("insert into public.eup_source_registry_state(source_id, configured, access) values ('official_ct_offices', true, 'approved')");
  const refresh = (key) => val(s.query('select public.eup_sources_command($1,$2,$3) as r', ['refresh', { source_id: 'official_ct_offices', idempotency_key: key }, OWNER]));
  const run1 = await refresh('refresh-0001');
  const claim1 = await val(s.query("select public.eup_import_run_claim('core-a') as r"));
  eq([claim1.claimed, claim1.run_id, claim1.policy_revision], [true, run1.run_id, ie.policy.revision], '(f) the job is claimed under policy revision 1');
  const rec = (id, hash) => [{ external_id: id, country_code: 'US', level: 'state', name: 'Connecticut', raw_hash: hash, provenance: { source_id: 'official_ct_offices', source_record_id: id, url: 'https://example.invalid/ct', fetched_at: '2026-11-09T00:00:00Z', parser_version: 'proof/1', rights_revision: 'r1', review_state: 'intake', coverage: 'partial' } }];
  const apply = (c, records, rev) => val(c.query('select public.eup_intake_apply($1,$2,$3,$4) as r', ['official_ct_offices', 'jurisdiction', JSON.stringify(records), rev]));
  await w.query('begin');
  const applied = await apply(w, rec('ct', 'h1'), claim1.policy_revision);
  const d2 = watch(policy(o, 'intake', 'draining', ie.policy.revision, k('intake-drain'), 'drain intake'));
  await until(async () => { const b = await blockedBy(admin, o.pid); return b.type === 'Lock' && (b.blockers || []).includes(w.pid); }, 'intake drain blocked by the apply');
  ok(!d2.done && applied.applied === 1, '(f) the drain waits for the job write already in its transaction');
  await w.query('commit');
  const d2r = await d2.p;
  eq([d2r.policy.state, d2r.policy.revision], ['draining', 2], 'intake draining at revision 2');
  eq(await code(apply(s, rec('ct-2', 'h2'), claim1.policy_revision)), 'EUM02', '(f) the claimed job\'s NEXT side effect is refused once draining');
  eq((await admin.query('select count(*)::int as n from public.eup_record_snapshots')).rows[0].n, 1, '(f) only the in-flight batch was written');
  eq(await code(refresh('refresh-0002')), 'EUM02', '(f) no new run can be queued while draining');
  eq(await code(val(s.query("select public.eup_import_run_claim('core-b') as r"))), 'EUM02', '(f) no new claim while draining');
  eq((await val(s.query('select public.eup_sources_command($1,$2,$3) as r', ['pause', { source_id: 'official_ct_offices' }, OWNER]))).paused, true, 'pausing a source stays possible while draining');
  const rel = await val(s.query('select public.eup_import_run_release($1,$2,$3) as r', [claim1.run_id, claim1.lease, 'module_draining']));
  eq(rel.status, 'queued', '(f) the job settles by releasing its run while draining; the run is kept');
  eq(await code(val(s.query('select public.eup_import_run_release($1,$2,$3) as r', [claim1.run_id, claim1.lease, 'again']))), 'EUI02', 'a released lease cannot settle twice (EUI02 run_not_running)');
  const id3 = await policy(s, 'intake', 'disabled', 2, k('intake-disable'));
  const ie2 = await policy(s, 'intake', 'enabled', id3.policy.revision, k('intake-enable-2'));
  await val(s.query('select public.eup_sources_command($1,$2,$3) as r', ['resume', { source_id: 'official_ct_offices' }, OWNER]));
  eq(await code(apply(s, rec('ct-2', 'h2'), claim1.policy_revision)), 'EUM04', '(f) a job still holding the pre-drain revision is refused after re-enable (EUM04)');
  const claim2 = await val(s.query("select public.eup_import_run_claim('core-b') as r"));
  eq([claim2.claimed, claim2.run_id, claim2.policy_revision], [true, run1.run_id, ie2.policy.revision], 'the kept run is claimed again under the new revision');
  eq((await apply(s, rec('ct-2', 'h2'), claim2.policy_revision)).applied, 1, 'and its write is accepted');
  eq((await val(s.query('select public.eup_import_run_finish($1,$2,$3,$4,$5,$6) as r', [claim2.run_id, 'completed', 2, null, null, claim2.lease]))).status, 'completed', 'the job finishes');

  /* the owner's view */
  const view = await val(s.query('select public.eup_module_control_read($1, 5) as r', [OWNER]));
  eq(view.modules.map((m) => [m.moduleId, m.installed, m.state]), [['environment', false, null], ['league', true, 'enabled'], ['intake', true, 'enabled']], 'the owner view lists every registry module, installed or not');
  ok(view.commands.length === 5 && view.modules[2].last_command.requested_state === 'enabled' && view.modules[2].last_command.idempotency_key === k('intake-enable-2'), 'the owner view carries each module\'s last command and a bounded log');
  eq(await code(val(s.query('select public.eup_module_control_read($1, 5) as r', [PEER]))), '42501', 'the owner view refuses a non-owner');
  eq((await admin.query("select count(*)::int as n from pg_locks where locktype = 'advisory'")).rows[0].n, 0, 'no advisory lock outlives its transaction');
  console.log(`${n} native module-policy assertions passed on PostgreSQL ${server.version}.`);
} catch (error) {
  console.error(`FAILED after ${n} assertions: ${error.code || ''} ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const c of clients) { try { await c.end(); } catch {} }
  server.stop();
}
