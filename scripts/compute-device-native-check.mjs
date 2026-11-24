// Equity Uprise shared-platform support-only proof of Core compute evidence and
// fencing. This fixture does not define or activate any building capability.
// D/E approval proof. Local PostgreSQL only; never accepts a hosted database.
// Default: disposable database with the canonical compute migrations and a
// minimal orgs fixture. --from-reset: the actual Supabase CLI reset database,
// with no replacement of base tables, roles, grants or functions.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativeTestDb, waitForBlocked, resetMigrationPlan } from './native-admin-test-db.mjs';
import { generateNodeIdentity, signRequest } from '../core/src/compute/signature.mjs';
import { completionAttestation, verifyAttestation } from '../core/src/compute/jobs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromReset = process.argv.includes('--from-reset');
const reportArg = process.argv.indexOf('--report');
const read = (name) => fs.readFile(path.join(root, name), 'utf8');
const names = {
  D: 'supabase/pending/compute_job_attestations_v1.sql',
  Drollback: 'supabase/pending/compute_job_attestations_v1.rollback.sql',
  E: 'supabase/pending/compute_scheduler_lease_v1.sql',
  Erollback: 'supabase/pending/compute_scheduler_lease_v1.rollback.sql'
};
const source = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => [key, await read(name)])));
const checks = [];
const fixtureRollback = new Error('rollback disposable proof fixture');
const connectionUrl = new URL(process.env.NATIVE_TEST_DATABASE_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(connectionUrl.hostname), 'only a local disposable database is allowed');
assert.equal(connectionUrl.port, '54322', 'only the isolated Supabase port is allowed');
assert.ok(path.isAbsolute(process.env.POSTGRES_MODULE_PATH || ''), 'POSTGRES_MODULE_PATH must be absolute');

async function resetDatabase() {
  assert.equal(connectionUrl.pathname, '/postgres', '--from-reset requires the local CLI reset database');
  const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
  const options = { max: 1, onnotice: () => {}, connection: { application_name: 'compute-device-native-proof', statement_timeout: 20000 } };
  const wrap = (sql) => ({
    native: true,
    query: async (text, values = []) => ({ rows: await sql.unsafe(text, values) }),
    exec: (text) => sql.unsafe(text),
    transaction: (fn) => sql.begin((tx) => fn(wrap(tx)))
  });
  const sql = postgres(connectionUrl.href, options);
  const db = wrap(sql);
  db.fork = () => { const child = postgres(connectionUrl.href, options); return { ...wrap(child), close: () => child.end() }; };
  db.close = () => sql.end();
  try {
    const { rows } = await db.query("select to_regclass('supabase_migrations.schema_migrations') is not null as reset, to_regclass('public.ops_compute_leases') is not null as compute");
    assert.ok(rows[0].reset && rows[0].compute, '--from-reset requires the canonical migration reset first');
    const actual = Array.from((await db.query('select version,name from supabase_migrations.schema_migrations order by version')).rows);
    const plan = await resetMigrationPlan(root);
    assert.deepEqual(actual, plan.rows, 'full reset must match exact canonical and replay (version,name) rows before applying pending SQL');
    console.log(`Canonical reset plan: ${plan.rows.length} migrations = ${plan.productionCount} production + ${plan.replayOnlyCount} replay-only foundations`);
    return db;
  } catch (error) { await db.close(); throw error; }
}

async function expectState(db, code, fn) {
  await db.exec('savepoint expected_failure');
  let error;
  try { await fn(); } catch (caught) { error = caught; }
  await db.exec('rollback to savepoint expected_failure');
  await db.exec('release savepoint expected_failure');
  assert.equal(error?.code, code, `expected SQLSTATE ${code}, got ${error ? `${error.code}: ${error.message}` : 'success'}`);
}

async function fixture(db) {
  const org = crypto.randomUUID();
  const task = crypto.randomUUID();
  const lease = crypto.randomUUID();
  const node = generateNodeIdentity();
  await db.query('insert into public.orgs(id,slug,name) values ($1,$2,$3)', [org, `compute-proof-${org}`, 'Disposable D/E native proof']);
  await db.query(`insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version)
    values ($1,$2,'Disposable native proof',$3,$4,'mccluster-compute/1','native-proof')`, [node.nodeId, org, node.publicKeyPem, node.fingerprint]);
  await db.query("insert into public.ops_compute_tasks(id,org_id,capability,status,attempts,output) values ($1,$2,'ai.chat','done',1,'{\"ok\":true}')", [task, org]);
  await db.query(`insert into public.ops_compute_leases(id,task_id,node_id,status,lease_token_hash,expires_at,attempt,result)
    values ($1,$2,$3,'done','synthetic-digest-only',clock_timestamp()+interval '1 minute',1,'{"ok":true}')`, [lease, task, node.nodeId]);
  const route = `/v1/compute/leases/${lease}/complete`;
  // A deliberately non-normalized timestamp proves signed_at is preserved as
  // signed text. The body/private key remain in memory and never enter SQL.
  const signedAt = '2026-11-24T18:10:01.123456+00:00';
  const headers = signRequest({ privateKeyPem: node.privateKeyPem, method: 'POST', path: route, nodeId: node.nodeId,
    timestamp: signedAt, bodyBytes: Buffer.from('{"lease_token":"synthetic-local-only","result":{"ok":true}}') });
  const attestation = completionAttestation({ node: { id: node.nodeId }, leaseId: lease, attempt: 1, method: 'POST', path: route, headers, result: { ok: true } });
  return { org, task, lease, node, attestation };
}

async function insertAttestation(db, f, patch = {}, suffix = '') {
  const a = { ...f.attestation, task_id: f.task, ...patch };
  const columns = ['lease_id','task_id','node_id','attempt','protocol','method','path','signed_at','nonce','body_digest','signature','result_sha256'];
  return db.query(`insert into public.ops_compute_attestations(${columns.join(',')}) values (${columns.map((_, i) => `$${i + 1}`).join(',')}) ${suffix} returning *`, columns.map((column) => a[column]));
}

async function isolated(db, fn) {
  try {
    await db.transaction(async (tx) => { const f = await fixture(tx); await fn(tx, f); throw fixtureRollback; });
  } catch (error) { if (error !== fixtureRollback) throw error; }
}

async function test(name, fn) {
  try { await fn(); checks.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, ok: false, code: error.code || null, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

const db = fromReset ? await resetDatabase() : await nativeTestDb('compute_device');
let installed = false;
let postgresVersion;
try {
  if (!fromReset) {
    await db.exec(`do $$ begin create role anon; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
      alter role service_role bypassrls;
      create schema extensions;
      grant usage on schema public to anon, authenticated, service_role;
      create table public.orgs(id uuid primary key, slug text not null unique, name text not null, enabled boolean not null default true);
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;`);
    for (const file of [
      'supabase/replay_migrations/20260912071000_compute_node_protocol.sql',
      'supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql',
      'supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql',
      'supabase/migrations/20261020210718_compute_lease_authority_v2.sql'
    ]) await db.exec(await read(file));
  }
  postgresVersion = (await db.query('select version() as version')).rows[0].version;
  console.log(`${fromReset ? 'FULL RESET SCHEMA' : 'CANONICAL COMPUTE + MINIMAL ORGS FIXTURE'}: ${postgresVersion}`);
  const preflight = (await db.query(`select
    to_regclass('public.ops_compute_attestations') is null as d_absent,
    to_regclass('public.ops_compute_scheduler_leases') is null as e_absent,
    (select rolbypassrls from pg_roles where rolname='service_role') as bypassrls`)).rows[0];
  assert.ok(preflight.d_absent && preflight.e_absent, 'D/E objects already exist; refusing to replace or later drop them');
  assert.equal(preflight.bypassrls, true, 'proof must use the real BYPASSRLS service role');
  const baseCounts = (await db.query('select (select count(*)::int from public.ops_compute_nodes) as nodes,(select count(*)::int from public.ops_compute_tasks) as tasks,(select count(*)::int from public.ops_compute_leases) as leases')).rows[0];
  await db.exec(source.D); await db.exec(source.E); installed = true;

  await test('D: real service_role inserts and reads a verifiable signed receipt; first accepted receipt wins', () => isolated(db, async (tx, f) => {
    await tx.exec('set local role service_role');
    const first = (await insertAttestation(tx, f)).rows[0];
    assert.equal(first.signed_at, f.attestation.signed_at);
    assert.equal(verifyAttestation(first, f.node.publicKeyPem).ok, true);
    const retry = await insertAttestation(tx, f, { nonce: crypto.randomUUID(), signature: 'A'.repeat(86) }, 'on conflict (lease_id) do nothing');
    assert.equal(retry.rows.length, 0);
    const saved = (await tx.query('select * from public.ops_compute_attestations where lease_id=$1', [f.lease])).rows[0];
    assert.equal(saved.signature, first.signature);
    assert.equal(saved.nonce, first.nonce);
    assert.equal(verifyAttestation(saved, f.node.publicKeyPem).ok, true);
    await tx.exec('reset role');
  }));

  for (const [operation, statement] of [
    ['UPDATE', "update public.ops_compute_attestations set signature=repeat('A',86)"],
    ['DELETE', 'delete from public.ops_compute_attestations'],
    ['TRUNCATE', 'truncate public.ops_compute_attestations']
  ]) await test(`D: real service_role cannot ${operation} signed evidence under Supabase default grants`, () => isolated(db, async (tx, f) => {
    await insertAttestation(tx, f);
    await expectState(tx, '42501', async () => { await tx.exec('set local role service_role'); await tx.exec(statement); });
    assert.equal((await tx.query('select signature from public.ops_compute_attestations where lease_id=$1', [f.lease])).rows[0].signature, f.attestation.signature);
  }));

  for (const role of ['anon','authenticated']) await test(`D/E: actual ${role} role cannot read private rows or execute scheduler RPCs`, () => isolated(db, async (tx, f) => {
    await insertAttestation(tx, f);
    for (const table of ['ops_compute_attestations','ops_compute_scheduler_leases']) await expectState(tx, '42501', async () => {
      await tx.exec(`set local role ${role}`); await tx.exec(`select * from public.${table}`);
    });
    await expectState(tx, '42501', async () => { await tx.exec(`set local role ${role}`); await tx.query("select public.compute_scheduler_acquire($1,'core-private','primary',30)", [f.org]); });
  }));

  await test('D: malformed evidence is rejected with real service_role INSERT', () => isolated(db, async (tx, f) => {
    for (const patch of [{ attempt: 0 }, { protocol: 'wrong' }, { method: 'GET' }, { path: '/wrong' }, { signed_at: 'yesterday' }, { nonce: 'bad' }, { body_digest: 'short' }, { signature: 'short' }, { result_sha256: 'bad' }]) {
      await expectState(tx, '23514', async () => { await tx.exec('set local role service_role'); await insertAttestation(tx, f, patch); });
    }
  }));

  await test('E: real service_role RPCs fence prior holders and preserve term/history across release', () => isolated(db, async (tx, f) => {
    await tx.exec('set local role service_role');
    const call = async (sql, values = []) => (await tx.query(sql, values)).rows[0].r;
    let r = await call("select public.compute_scheduler_acquire($1,'core-a','primary',30) as r", [f.org]);
    assert.equal(r.reason, 'fresh'); assert.equal(Number(r.term), 1);
    r = await call("select public.compute_scheduler_acquire($1,'core-b','standby',30) as r", [f.org]);
    assert.equal(r.active, false); assert.equal(r.reason, 'held');
    r = await call("select public.compute_scheduler_handover($1,'core-a',1,'core-b',60) as r", [f.org]);
    assert.equal(r.ok, true);
    r = await call("select public.compute_scheduler_acquire($1,'core-b','standby',30) as r", [f.org]);
    assert.equal(r.active, true); assert.equal(Number(r.term), 2);
    for (const sql of ["select public.compute_scheduler_renew($1,'core-a',1,30) as r", "select public.compute_scheduler_release($1,'core-a',1) as r", "select public.compute_scheduler_handover($1,'core-a',1,'core-c',30) as r"]) {
      r = await call(sql, [f.org]); assert.equal(r.ok, false); assert.equal(r.reason, 'fenced');
    }
    r = await call("select public.compute_scheduler_release($1,'core-b',2) as r", [f.org]); assert.equal(r.ok, true);
    r = await call("select public.compute_scheduler_acquire($1,'core-c','primary',30) as r", [f.org]); assert.equal(Number(r.term), 3);
    const row = (await tx.query('select term,history from public.ops_compute_scheduler_leases where org_id=$1', [f.org])).rows[0];
    assert.equal(Number(row.term), 3); assert.equal(row.history.length, 5);
    await tx.exec('reset role');
  }));

  for (const [operation, statement] of [
    ['INSERT', "insert into public.ops_compute_scheduler_leases select * from public.ops_compute_scheduler_leases where false"],
    ['UPDATE', 'update public.ops_compute_scheduler_leases set term=term+1'],
    ['DELETE', 'delete from public.ops_compute_scheduler_leases'],
    ['TRUNCATE', 'truncate public.ops_compute_scheduler_leases']
  ]) await test(`E: real service_role cannot directly ${operation} fencing state`, () => isolated(db, async (tx, f) => {
    await tx.query("select public.compute_scheduler_acquire($1,'core-a','primary',30)", [f.org]);
    await expectState(tx, '42501', async () => { await tx.exec('set local role service_role'); await tx.exec(statement); });
  }));

  await test('D: rollback refuses populated evidence and preserves the signed receipt and parent lease', () => isolated(db, async (tx, f) => {
    await insertAttestation(tx, f);
    await expectState(tx, '55000', () => tx.exec(source.Drollback));
    const row = (await tx.query('select * from public.ops_compute_attestations where lease_id=$1', [f.lease])).rows[0];
    assert.equal(verifyAttestation(row, f.node.publicKeyPem).ok, true);
    assert.equal((await tx.query('select count(*)::int as n from public.ops_compute_leases where id=$1', [f.lease])).rows[0].n, 1);
  }));

  await test('E: rollback refuses even released scheduler history and preserves RPCs and fencing term', () => isolated(db, async (tx, f) => {
    await tx.query("select public.compute_scheduler_acquire($1,'core-history','primary',30)", [f.org]);
    await tx.query("select public.compute_scheduler_release($1,'core-history',1)", [f.org]);
    const before = (await tx.query('select to_jsonb(s) as row from public.ops_compute_scheduler_leases s where org_id=$1', [f.org])).rows[0].row;
    await expectState(tx, '55000', () => tx.exec(source.Erollback));
    const after = (await tx.query('select to_jsonb(s) as row from public.ops_compute_scheduler_leases s where org_id=$1', [f.org])).rows[0].row;
    assert.deepEqual(after, before);
    const next = (await tx.query("select public.compute_scheduler_acquire($1,'core-next','standby',30) as r", [f.org])).rows[0].r;
    assert.equal(Number(next.term), 2);
  }));

  for (const lane of ['D','E']) await test(`${lane}: rollback rejects an old-snapshot transaction`, async () => {
    try {
      await db.transaction(async (tx) => {
        await tx.exec('set transaction isolation level repeatable read');
        await expectState(tx, '55000', () => tx.exec(source[`${lane}rollback`]));
        throw fixtureRollback;
      });
    } catch (error) { if (error !== fixtureRollback) throw error; }
  });

  for (const lane of ['D','E']) await test(`${lane}: rollback waits for an in-flight writer then refuses its committed evidence`, async () => {
    const f = await db.transaction((tx) => fixture(tx));
    const writer = db.fork(); const rollback = db.fork();
    let release; let ready;
    const blocked = new Promise((resolve) => { release = resolve; });
    const began = new Promise((resolve) => { ready = resolve; });
    let attempt;
    try {
      const writing = writer.transaction(async (tx) => {
        if (lane === 'D') await insertAttestation(tx, f);
        else await tx.query("select public.compute_scheduler_acquire($1,'core-inflight','primary',30)", [f.org]);
        ready(); await blocked;
      });
      await began;
      attempt = rollback.exec(source[`${lane}rollback`]).then(() => ({ code: null }), (error) => ({ code: error.code, message: error.message }));
      try { await waitForBlocked(db); } finally { release(); }
      await writing;
      assert.equal((await attempt).code, '55000', 'committed evidence must prevent the destructive rollback');
      const table = lane === 'D' ? 'ops_compute_attestations' : 'ops_compute_scheduler_leases';
      const key = lane === 'D' ? 'lease_id' : 'org_id';
      const value = lane === 'D' ? f.lease : f.org;
      assert.equal((await db.query(`select count(*)::int as n from public.${table} where ${key}=$1`, [value])).rows[0].n, 1);
    } finally {
      release(); if (attempt) await attempt;
      await writer.close(); await rollback.close();
      // Delete only the fixture org in this disposable local database; these
      // cleanup statements are deliberately absent from the rollback files.
      await db.query('delete from public.orgs where id=$1', [f.org]);
      // A failing before-fix rollback may have dropped one of the test tables.
      await db.exec(source.D); await db.exec(source.E);
    }
  });

  await test('D/E: empty rollback is repeatable, preserves canonical compute rows, and reapply restores narrow grants', async () => {
    await db.exec(source.Drollback); await db.exec(source.Erollback);
    await db.exec(source.Drollback); await db.exec(source.Erollback);
    const gone = (await db.query("select to_regclass('public.ops_compute_attestations') is null as d, to_regclass('public.ops_compute_scheduler_leases') is null as e, to_regprocedure('public.compute_scheduler_acquire(uuid,text,text,integer)') is null as rpc")).rows[0];
    assert.deepEqual(gone, { d: true, e: true, rpc: true });
    const after = (await db.query('select (select count(*)::int from public.ops_compute_nodes) as nodes,(select count(*)::int from public.ops_compute_tasks) as tasks,(select count(*)::int from public.ops_compute_leases) as leases')).rows[0];
    assert.deepEqual(after, baseCounts);
    await db.exec(source.D); await db.exec(source.E);
    await db.exec(source.D); await db.exec(source.E);
    const grants = (await db.query(`select has_table_privilege('service_role','public.ops_compute_attestations','SELECT,INSERT') as evidence,
      has_table_privilege('service_role','public.ops_compute_attestations','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as mutate,
      has_table_privilege('service_role','public.ops_compute_scheduler_leases','SELECT') as diagnostics,
      has_table_privilege('service_role','public.ops_compute_scheduler_leases','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as raw_write`)).rows[0];
    assert.deepEqual(grants, { evidence: true, mutate: false, diagnostics: true, raw_write: false });
  });
} finally {
  if (fromReset && installed) {
    // The guarded files themselves decide whether cleanup is safe. A failed
    // proof never overrides populated-table protection.
    try { await db.exec(source.Drollback); await db.exec(source.Erollback); }
    catch (error) { checks.push({ name: 'full-reset cleanup', ok: false, code: error.code, message: error.message }); }
  }
  await db.close();
}
const proof = {
  schema: 'mccluster-compute-device-native-proof/1', mode: fromReset ? 'full-reset' : 'canonical-compute-minimal-orgs',
  postgres: postgresVersion, finished_at: new Date().toISOString(),
  files: Object.fromEntries(Object.entries(names).map(([key, name]) => [name, crypto.createHash('sha256').update(source[key]).digest('hex')])),
  checks, passed: checks.filter((x) => x.ok).length, failed: checks.filter((x) => !x.ok).length
};
if (reportArg !== -1) { assert.ok(process.argv[reportArg + 1], '--report requires a path'); await fs.writeFile(process.argv[reportArg + 1], `${JSON.stringify(proof, null, 2)}\n`); }
console.log(`D/E native proof: ${proof.passed} passed, ${proof.failed} failed`);
if (proof.failed) process.exitCode = 1;
