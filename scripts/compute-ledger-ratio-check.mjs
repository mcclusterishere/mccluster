/* Focused proof of the 3-to-1 contribution rule in the pending ledger SQL.
   Disposable PGlite (or NATIVE_TEST_DATABASE_URL). Never connects to production Supabase.

     PGLITE_MODULE_PATH=... node scripts/compute-ledger-ratio-check.mjs
*/
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { migrationPath } from './native-admin-test-db.mjs';
import { hashJson } from '../core/src/compute/jobs.mjs';
import { redemptionMint } from '../core/src/compute/contribution-ledger.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let db;
if (process.env.NATIVE_TEST_DATABASE_URL) {
  const { nativeTestDb } = await import('./native-admin-test-db.mjs');
  db = await nativeTestDb('ledger-ratio');
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

const ORG = '00000000-0000-4000-8000-000000000001';
const NODE_A = 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NODE_B = 'node_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HOLDER = 'core-primary';
const IMPLS = "array['micro.local']";
let keySeq = 0;
const key = (prefix) => `${prefix}:${++keySeq}`;

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
async function runTask(nodeId, taskId, result) {
  const c = (await one(`select public.compute_claim_task($1,array['ai.chat'],${IMPLS}) as r`, [nodeId])).r;
  assert.ok(c, `claim for ${taskId} returned null`);
  assert.equal(c.task_id, taskId, 'claim took the expected task');
  const lease = { leaseId: c.lease_id, token: c.lease_token, tokenHash: sha256(c.lease_token), attempt: Number(c.attempt) };
  assert.ok((await one('select public.compute_start_lease($1,$2::uuid,$3) as r', [nodeId, lease.leaseId, lease.token])).r, 'start');
  assert.equal((await one('select public.compute_complete_lease($1,$2::uuid,$3,$4::text::jsonb) as r', [nodeId, lease.leaseId, lease.token, JSON.stringify(result)])).r, true, 'complete');
  return lease;
}
async function contribute(nodeId, units, payer = 'spender') {
  const task = await enqueue();
  const reserved = await reserve(key('reserve'), payer, task, 16);
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
  const result = { model: 'micro:1b', content: String(units), usage: usage(units) };
  const lease = await runTask(nodeId, task, result);
  const met = { ...usage(units), model: result.model, runtime_version: '0.6.0', node_id: nodeId, attempt: lease.attempt };
  const s = await settle(key('settle'), task, lease.tokenHash, lease.attempt, met, hashJson(result));
  return { task, settle: s, lease };
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

  const CAPS = JSON.stringify([{ capability: 'ai.chat', implementation: 'micro.local', max_concurrency: 1 }]);
  await q('insert into public.orgs(id) values ($1)', [ORG]);
  for (const id of [NODE_A, NODE_B]) {
    await q(`insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,state,capabilities)
      values ($1,$2,$1,'fixture',$1,'mccluster-compute/1','test','online',$3::text::jsonb)`, [id, ORG, CAPS]);
  }
  await q(`insert into public.ops_compute_accounts(account_id,org_id,kind,status) values
    ('worker-ratio',$1,'community','active'),('spender',$1,'owner','active')`, [ORG]);
  await q("insert into public.ops_compute_node_accounts(node_id,account_id) values ($1,'worker-ratio')", [NODE_A]);
  await q(`insert into public.ops_compute_model_classes(model_class,unit_version,approved_models,implementations,out_unit_micro,in_unit_micro,redemption_ratio,min_tokens_per_s,max_tokens_per_s,max_eval_count,max_prompt_eval_count)
    values ('pilot.micro',1,'[{"model":"micro:1b","digest":"sha256:micro"}]'::jsonb,'["micro.local"]'::jsonb,1,0,3,1,100000,4096,32768)`);
  // Opening grant so the spender can reserve.
  assert.equal((await correct(key('grant'), 'spender', -1000, 0, 'ratio-check opening grant')).ok, true);
  const acquire = (await one("select public.compute_scheduler_acquire($1::uuid,$2,'primary',300) as r", [ORG, HOLDER])).r;
  assert.ok(['fresh', 'renewed', 'expired_takeover'].includes(acquire.reason), JSON.stringify(acquire));

  // 1. One job of exactly three units mints one spendable unit and leaves no carry.
  {
    const { settle: s } = await contribute(NODE_A, 3);
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.equal(s.accepted, true);
    assert.equal(Number(s.units_micro), 3);
    assert.equal(Number(s.minted_micro), 1);
    assert.equal(Number(s.carry_micro), 0);
    const expected = redemptionMint(3);
    assert.equal(BigInt(s.minted_micro), expected.mintedMicro);
    assert.equal(BigInt(s.carry_micro), expected.carryMicro);
    const b = await balances('worker-ratio');
    assert.equal(Number(b.earned), 1);
    assert.equal(Number(b.available), 1);
    assert.equal(Number(b.carry_micro), 0);
    ok('exactly three contributed units mint one spendable unit and leave no carry');
  }

  // 2. Partial units stay in carry; the next job completes the ratio (2 + 1 = 3).
  {
    const first = await contribute(NODE_A, 2);
    assert.equal(Number(first.settle.minted_micro), 0);
    assert.equal(Number(first.settle.carry_micro), 2);
    const mid = await balances('worker-ratio');
    assert.equal(Number(mid.earned), 1);
    assert.equal(Number(mid.carry_micro), 2);
    const second = await contribute(NODE_A, 1);
    assert.equal(Number(second.settle.minted_micro), 1);
    assert.equal(Number(second.settle.carry_micro), 0);
    const b = await balances('worker-ratio');
    assert.equal(Number(b.earned), 2);
    assert.equal(Number(b.available), 2);
    assert.equal(Number(b.carry_micro), 0);
    ok('a remainder of 2 plus 1 more unit mints the next spendable unit; no rounding is lost');
  }

  // 3. Replaying the same settle key does not mint twice.
  {
    const task = await enqueue();
    assert.equal((await reserve(key('reserve'), 'spender', task, 16)).ok, true);
    const result = { model: 'micro:1b', content: 'dup', usage: usage(3) };
    const lease = await runTask(NODE_A, task, result);
    const met = { ...usage(3), model: result.model, runtime_version: '0.6.0', node_id: NODE_A, attempt: lease.attempt };
    const op = key('settle');
    const first = await settle(op, task, lease.tokenHash, lease.attempt, met, hashJson(result));
    const replay = await settle(op, task, lease.tokenHash, lease.attempt, met, hashJson(result));
    assert.equal(first.ok, true); assert.equal(first.accepted, true); assert.equal(first.replayed, false);
    assert.equal(Number(first.minted_micro), 1);
    assert.equal(replay.replayed, true);
    assert.equal(Number(replay.minted_micro), 1);
    const mints = await q("select count(*)::int as n from public.ops_compute_contribution_ledger where task_id=$1::uuid and kind='mint'", [task]);
    assert.equal(mints[0].n, 1);
    const b = await balances('worker-ratio');
    assert.equal(Number(b.earned), 3);
    ok('replaying the same settle key does not mint a second credit');
  }

  // 4. Spend is checked at reserve: over-budget is refused, available never goes negative.
  {
    const before = await balances('spender');
    const available = Number(before.available);
    assert.ok(available > 0, 'spender has a grant');
    const task = await enqueue();
    const over = await reserve(key('reserve'), 'spender', task, available + 1);
    assert.equal(over.ok, false);
    assert.equal(over.code, 'OVER_BUDGET');
    const after = await balances('spender');
    assert.equal(Number(after.available), available);
    assert.ok(Number(after.available) >= 0);
    // The refused reserve left the task queued with no hold; cancel it so
    // the next claim cannot take it instead of the paying job.
    await q("update public.ops_compute_tasks set status='canceled' where id=$1::uuid and status='queued'", [task]);
    // A legal reserve then settle deducts, still never below zero.
    const pay = await enqueue();
    const held = await reserve(key('reserve'), 'spender', pay, 3);
    assert.equal(held.ok, true, JSON.stringify(held));
    const pending = await balances('spender');
    assert.equal(Number(pending.pending), 3);
    assert.equal(Number(pending.available), available - 3);
    const result = { model: 'micro:1b', content: 'pay', usage: usage(3) };
    const lease = await runTask(NODE_A, pay, result);
    const met = { ...usage(3), model: result.model, runtime_version: '0.6.0', node_id: NODE_A, attempt: lease.attempt };
    const s = await settle(key('settle'), pay, lease.tokenHash, lease.attempt, met, hashJson(result));
    assert.equal(s.accepted, true);
    assert.equal(Number(s.spend_micro), 3);
    const settled = await balances('spender');
    assert.equal(Number(settled.pending), 0);
    assert.equal(Number(settled.available), available - 3);
    assert.ok(Number(settled.available) >= 0);
    ok('over-budget reserve is refused; a legal spend deducts exactly and never goes negative');
  }

  console.log(`compute contribution ledger ratio check: ${passed} cases PASS`);
} finally {
  await db.close();
}
