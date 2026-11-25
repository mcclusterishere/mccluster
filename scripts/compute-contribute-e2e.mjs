/* Local end-to-end proof of the contribute panel, 3-to-1 ledger, node
   routing and credit deduction. Disposable PGlite (or NATIVE_TEST_DATABASE_URL).
   Never connects to production Supabase or OVH Core.

     PGLITE_MODULE_PATH=... node scripts/compute-contribute-e2e.mjs
*/
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { migrationPath } from './native-admin-test-db.mjs';
import { hashJson } from '../core/src/compute/jobs.mjs';
import { setOptIn, writeBalances, readPanel } from '../desktop/contribute-panel/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let db;
if (process.env.NATIVE_TEST_DATABASE_URL) {
  const { nativeTestDb } = await import('./native-admin-test-db.mjs');
  db = await nativeTestDb('contribute-e2e');
} else {
  const modulePath = process.env.PGLITE_MODULE_PATH;
  if (!modulePath || !path.isAbsolute(modulePath)) throw Error('Set PGLITE_MODULE_PATH to pinned PGlite');
  const { PGlite } = await import(pathToFileURL(modulePath));
  const { pgcrypto } = await import(pathToFileURL(path.join(path.dirname(modulePath), 'contrib/pgcrypto.js')));
  db = new PGlite({ extensions: { pgcrypto } });
}
const read = (file) => fs.readFileSync(`${root}/${file}`, 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const q = async (sql, params = []) => Array.from((await db.query(sql, params)).rows);
const one = async (sql, params = []) => (await q(sql, params))[0];
let passed = 0;
const ok = (label) => { passed += 1; console.log(`${label}: PASS`); };
const report = {};

const ORG = '00000000-0000-4000-8000-000000000001';
const NODE_A = 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NODE_B = 'node_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NODE_C = 'node_cccccccccccccccccccccccccccccccc';
const HOLDER = 'core-primary';
const IMPLS = "array['micro.local']";
const CAPS = JSON.stringify([{ capability: 'ai.chat', implementation: 'micro.local', max_concurrency: 1 }]);
let keySeq = 0;
const key = (prefix) => `${prefix}:${++keySeq}`;
const stateRoot = mkdtempSync(path.join(tmpdir(), 'contribute-e2e-'));

function usage(units) {
  return { prompt_eval_count: 0, prompt_eval_cached_count: 0, eval_count: units, total_duration_ns: 200_000_000, load_duration_ns: 0, prompt_eval_duration_ns: 0, eval_duration_ns: 100_000_000, model_digest: 'sha256:micro', ollama_version: '0.6.0' };
}
async function enqueue() {
  const r = (await one("select public.compute_enqueue_task($1::uuid,'ai.chat','micro.local','{\"prompt\":\"hi\"}'::jsonb,'{}'::jsonb,0,null::timestamptz,3,'{}'::jsonb,null) as r", [ORG])).r;
  assert.equal(r.conflict, false);
  return r.task.id;
}
async function reserve(opKey, accountId, taskId, max) {
  return (await one('select public.compute_ledger_reserve($1,$2,$3::uuid,$4::bigint) as r', [opKey, accountId, taskId, String(max)])).r;
}
async function settle(opKey, taskId, tokenHash, attempt, met, outputSha) {
  return (await one('select public.compute_ledger_settle($1,$2::uuid,$3,$4::integer,$5::text::jsonb,$6,$7::text,$8::bigint) as r',
    [opKey, taskId, tokenHash, attempt, JSON.stringify(met), outputSha, HOLDER, 1])).r;
}
async function balances(accountId) { return (await one('select public.compute_ledger_balances($1) as r', [accountId])).r; }
async function correct(opKey, accountId, spend, units, reason) {
  return (await one('select public.compute_ledger_correct($1,null::bigint,$2,$3::bigint,$4::bigint,$5) as r', [opKey, accountId, String(spend), String(units), reason])).r;
}
async function claim(nodeId) {
  return (await one(`select public.compute_claim_task($1,array['ai.chat'],${IMPLS}) as r`, [nodeId])).r;
}
async function runClaimed(nodeId, taskId, result, claimed) {
  const lease = { leaseId: claimed.lease_id, token: claimed.lease_token, tokenHash: sha256(claimed.lease_token), attempt: Number(claimed.attempt) };
  assert.ok((await one('select public.compute_start_lease($1,$2::uuid,$3) as r', [nodeId, lease.leaseId, lease.token])).r, 'start');
  assert.equal((await one('select public.compute_complete_lease($1,$2::uuid,$3,$4::text::jsonb) as r', [nodeId, lease.leaseId, lease.token, JSON.stringify(result)])).r, true, 'complete');
  return lease;
}
async function syncWorkerPanel() {
  const b = await balances('worker-ratio');
  // Mint rows belong to the worker: units_micro is what was earned; accepted
  // contribution is stored on the mint row as metering.accepted_units_micro.
  const contributedRow = await one(`
    select coalesce(sum((metering->>'accepted_units_micro')::bigint),0)::text as contributed,
           coalesce(sum(units_micro),0)::text as earned
      from public.ops_compute_contribution_ledger
     where account_id='worker-ratio' and kind='mint'`);
  writeBalances(stateRoot, {
    account_id: 'worker-ratio',
    contributed_micro: contributedRow.contributed,
    earned_micro: b.earned,
    carry_micro: b.carry_micro,
    available_micro: b.available,
    pending_micro: b.pending || 0,
    source: 'ledger'
  });
  return readPanel(stateRoot);
}

try {
  await db.exec(`do $$ begin create role anon;create role authenticated;create role service_role;exception when duplicate_object then null;end $$;create schema if not exists extensions;create table if not exists public.orgs(id uuid primary key);`);
  await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;`);
  const files = [
    'supabase/replay_migrations/20260912071000_compute_node_protocol.sql',
    'supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql',
    'supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql',
    await migrationPath('compute_lease_authority_v2'),
    await migrationPath('job_attestations_v1'),
    await migrationPath('scheduler_lease_v1'),
    'supabase/pending/compute_contribution_ledger_v1.sql'
  ];
  for (const f of files) { await db.exec(read(f)); console.log(`loaded ${f}`); }

  await q('insert into public.orgs(id) values ($1)', [ORG]);
  await q(`insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,state,capabilities,last_seen_at)
    values ($1,$4,$1,'fixture',$1,'mccluster-compute/1','test','online',$5::text::jsonb, now()),
           ($2,$4,$2,'fixture',$2,'mccluster-compute/1','test','offline',$5::text::jsonb, now()),
           ($3,$4,$3,'fixture',$3,'mccluster-compute/1','test','online',$5::text::jsonb, now() - interval '10 minutes')`,
    [NODE_A, NODE_B, NODE_C, ORG, CAPS]);
  await q(`insert into public.ops_compute_accounts(account_id,org_id,kind,status) values
    ('worker-ratio',$1,'community','active'),('spender',$1,'owner','active')`, [ORG]);
  await q("insert into public.ops_compute_node_accounts(node_id,account_id) values ($1,'worker-ratio')", [NODE_A]);
  await q(`insert into public.ops_compute_model_classes(model_class,unit_version,approved_models,implementations,out_unit_micro,in_unit_micro,redemption_ratio,min_tokens_per_s,max_tokens_per_s,max_eval_count,max_prompt_eval_count)
    values ('pilot.micro',1,'[{"model":"micro:1b","digest":"sha256:micro"}]'::jsonb,'["micro.local"]'::jsonb,1,0,3,1,100000,4096,32768)`);
  assert.equal((await correct(key('grant'), 'spender', -1000, 0, 'e2e opening grant')).ok, true);
  const acquire = (await one("select public.compute_scheduler_acquire($1::uuid,$2,'primary',300) as r", [ORG, HOLDER])).r;
  assert.ok(['fresh', 'renewed', 'expired_takeover'].includes(acquire.reason), JSON.stringify(acquire));

  // Panel opt-in on the local state root (no Core call).
  const before = readPanel(stateRoot);
  assert.equal(before.opted_in, false);
  setOptIn(stateRoot, true, { now: '2026-11-25T17:30:00.000Z' });
  const opted = readPanel(stateRoot);
  assert.equal(opted.opted_in, true);
  assert.equal(opted.balances, null);
  ok('contribute panel opt-in is recorded on the local state root');
  report.opted_in = true;

  // Contribute exactly 3 units from the online node; earn 1.
  {
    const task = await enqueue();
    assert.equal((await reserve(key('reserve'), 'spender', task, 16)).ok, true);
    const skippedOffline = await claim(NODE_B);
    const skippedStale = await claim(NODE_C);
    assert.equal(skippedOffline, null);
    assert.equal(skippedStale, null);
    const taken = await claim(NODE_A);
    assert.ok(taken, 'online node should claim the job');
    assert.equal(taken.task_id, task);
    const result = { model: 'micro:1b', content: '3', usage: usage(3) };
    const lease = await runClaimed(NODE_A, task, result, taken);
    const met = { ...usage(3), model: result.model, runtime_version: '0.6.0', node_id: NODE_A, attempt: lease.attempt };
    const s = await settle(key('settle'), task, lease.tokenHash, lease.attempt, met, hashJson(result));
    assert.equal(s.accepted, true, JSON.stringify(s));
    assert.equal(Number(s.units_micro), 3);
    assert.equal(Number(s.minted_micro), 1);
    assert.equal(Number(s.spend_micro), 3);
    const worker = await balances('worker-ratio');
    assert.equal(Number(worker.earned), 1);
    assert.equal(Number(worker.available), 1);
    const panel = await syncWorkerPanel();
    assert.equal(panel.opted_in, true);
    assert.equal(panel.balances.contributed.micro, '3');
    assert.equal(panel.balances.earned.micro, '1');
    ok('offline and stale nodes are skipped; the online node runs the job; 3 contributed units earn 1 spendable unit');
    report.routing = { offline_skipped: true, stale_skipped: true, claimed_by: 'NODE_A', task };
    report.contribution = { units: 3, minted: 1, panel_contributed: panel.balances.contributed.micro, panel_earned: panel.balances.earned.micro };
  }

  // A second job of 3 units: credits deduct from the spender and the worker earns another unit.
  {
    const spenderBefore = await balances('spender');
    const availableBefore = Number(spenderBefore.available);
    const task = await enqueue();
    const reserved = await reserve(key('reserve'), 'spender', task, 3);
    assert.equal(reserved.ok, true, JSON.stringify(reserved));
    const held = await balances('spender');
    assert.equal(Number(held.pending), 3);
    assert.equal(Number(held.available), availableBefore - 3);
    assert.equal(await claim(NODE_B), null);
    const taken = await claim(NODE_A);
    assert.equal(taken.task_id, task);
    const result = { model: 'micro:1b', content: 'pay', usage: usage(3) };
    const lease = await runClaimed(NODE_A, task, result, taken);
    const met = { ...usage(3), model: result.model, runtime_version: '0.6.0', node_id: NODE_A, attempt: lease.attempt };
    const s = await settle(key('settle'), task, lease.tokenHash, lease.attempt, met, hashJson(result));
    assert.equal(s.accepted, true);
    assert.equal(Number(s.spend_micro), 3);
    const spenderAfter = await balances('spender');
    assert.equal(Number(spenderAfter.pending), 0);
    assert.equal(Number(spenderAfter.available), availableBefore - 3);
    assert.ok(Number(spenderAfter.available) >= 0);
    const worker = await balances('worker-ratio');
    assert.equal(Number(worker.earned), 2);
    const panel = await syncWorkerPanel();
    assert.equal(panel.balances.contributed.micro, '6');
    assert.equal(panel.balances.earned.micro, '2');
    ok('credits deduct by exactly the settled spend and the available balance never goes negative');
    report.deduction = { spend: 3, available_before: availableBefore, available_after: Number(spenderAfter.available), worker_earned: 2 };
  }

  report.passed = passed;
  report.state_root = stateRoot;
  console.log(`compute contribute e2e: ${passed} cases PASS`);
  console.log(`E2E_REPORT ${JSON.stringify(report)}`);
} finally {
  await db.close();
}
