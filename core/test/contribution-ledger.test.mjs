import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hashJson } from '../src/compute/jobs.mjs';
import { LEDGER_ENV_FLAG, createLedgerRpc, estimateMaxUnitsMicro, leaseTokenHash, ledgerEnabled, operationKey, resolveModelClass, schedulerIdentity, taskCounterCaps, balances, receipt, release, reserve, settle } from '../src/compute/contribution-ledger.mjs';
import { ledgerBalances, ledgerReceipt, releaseAfterFailure, releaseTaskReservation, settleCompletion, settleDoneTask, startContributionSweep, submitJob, sweepContributionLedger, validateCompletion } from '../src/compute/jobs-service.mjs';
import { LEDGER_HOLD_RUN_AFTER, activateHeldTask, completingLeaseForSettle, isLedgerHold, openReservations, reservationForTask, staleHeldTasks } from '../src/compute/jobs-store.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const TASK = '10000000-0000-4000-8000-000000000001';
const TASK2 = '10000000-0000-4000-8000-000000000002';
const TASK3 = '10000000-0000-4000-8000-000000000003';
const LEASE = '20000000-0000-4000-8000-000000000001';
const NODE = 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CLASS = { model_class: 'pilot.qwen3-8b', unit_version: 1, implementations: ['qwen3.8b.local'], out_unit_micro: 1000, in_unit_micro: 100, max_eval_count: 4096, max_prompt_eval_count: 32768 };
const NOW = '2026-11-23T12:00:00.000Z';
const ACTIVE = { holderId: 'core-primary', term: 2, isActive: () => true };
const STANDBY = { holderId: 'core-standby', term: null, isActive: () => false };

function usage(over = {}) {
  return { prompt_eval_count: 100, prompt_eval_cached_count: 20, eval_count: 50, total_duration_ns: 3_000_000_000, load_duration_ns: 1_000_000_000, prompt_eval_duration_ns: 500_000_000, eval_duration_ns: 1_000_000_000, model_digest: 'sha256:0123456789abcdef', ollama_version: '0.6.0', ...over };
}

// A fake ledger and a fake task store: records every RPC call and answers from
// a script, defaulting to ok. Idempotency and fences are the SQL's job
// (scripts/compute-ledger-sql-check.mjs); the enqueue here is idempotent the way
// compute_enqueue_task is (same task back, replayed: true).
function fakeLedger({ answers = {}, ledgerOn = true, classes = [CLASS], live = [{ node_id: NODE, capability: 'ai.chat', implementation: 'qwen3.8b.local' }] } = {}) {
  const calls = [];
  const logs = [];
  const reads = [];
  const tasks = new Map();
  const leases = new Map();
  const reservations = new Map();
  const canceled = [];
  const activated = [];
  const enqueued = [];
  const faults = {};
  const deps = {
    env: {},
    ledgerEnabled: () => ledgerOn,
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      const answer = answers[name];
      if (typeof answer === 'function') return answer(payload);
      return answer ?? { ok: true, replayed: false };
    },
    modelClasses: async () => { reads.push('modelClasses'); return classes; },
    live: async () => live,
    enqueue: async (args) => {
      enqueued.push(args);
      const existing = tasks.get(TASK);
      if (existing) return { task: existing, replayed: true };
      const task = { id: TASK, org_id: args.orgId, capability: args.capability, implementation: args.implementation, input: args.input, status: 'queued', run_after: args.runAfter || NOW, attempts: 0, max_attempts: args.maxAttempts, metadata: args.metadata, output: null };
      tasks.set(task.id, task);
      return { task, replayed: false };
    },
    cancelQueued: async ({ taskId, reason }) => {
      if (faults.cancel) throw faults.cancel;
      const t = tasks.get(taskId);
      if (!t || t.status !== 'queued') return null;
      canceled.push({ taskId, reason }); t.status = 'canceled';
      return t;
    },
    activateHeld: async ({ taskId, runAfter }) => {
      if (faults.activate) throw faults.activate;
      const t = tasks.get(taskId);
      if (!t || t.status !== 'queued' || !isLedgerHold(t.run_after)) return null;
      t.run_after = runAfter || NOW; activated.push({ taskId, runAfter });
      return t;
    },
    leaseById: async ({ leaseId }) => { reads.push('leaseById'); return leases.get(leaseId) || null; },
    taskRowById: async ({ taskId }) => { reads.push('taskRowById'); return tasks.get(taskId) || null; },
    nodeById: async (id) => ({ id, key_fingerprint: 'fp', inventory: { runtime: { hardware_mode: 'gpu-verified' } } }),
    reservationForTask: async ({ taskId }) => { reads.push('reservationForTask'); return reservations.get(taskId) || null; },
    completingLeaseForSettle: async ({ taskId }) => [...leases.values()].find((l) => l.task_id === taskId && l.status === 'done') || null,
    openReservations: async () => [...reservations.values()].filter((r) => r.status === 'open').map((r) => { const t = tasks.get(r.task_id); return { ...r, task_status: t?.status ?? null, org_id: t?.org_id ?? ORG, run_after: t?.run_after ?? null, metadata: t?.metadata ?? null }; }),
    staleHeldTasks: async ({ olderThan }) => [...tasks.values()].filter((t) => t.status === 'queued' && isLedgerHold(t.run_after) && (t.created_at || '') < olderThan),
    now: () => NOW,
    log: (record) => logs.push(record)
  };
  return { deps, calls, logs, reads, tasks, leases, reservations, canceled, activated, enqueued, faults };
}

test('pure helpers: the flag, operation keys, token hash, class resolution, the task caps and the max-units estimate', () => {
  assert.equal(LEDGER_ENV_FLAG, 'CORE_CONTRIBUTION_LEDGER_ENABLED');
  assert.equal(ledgerEnabled({}), false);
  assert.equal(ledgerEnabled({ CORE_CONTRIBUTION_LEDGER_ENABLED: '1' }), true);
  assert.equal(ledgerEnabled({ CORE_CONTRIBUTION_LEDGER_ENABLED: 'true' }), false, 'only the literal 1 turns it on');
  assert.equal(operationKey('reserve', [TASK]), `reserve:${TASK}`);
  assert.equal(operationKey('settle', [TASK, 1, 'core-primary', null]), `settle:${TASK}:1:core-primary:none`);
  assert.match(operationKey('x', ['a bé']), /^x:a_b_+$/);
  assert.ok(operationKey('x', ['y'.repeat(400)]).length <= 200);
  assert.equal(leaseTokenHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(resolveModelClass([CLASS, { model_class: 'other', implementations: ['z'] }], { implementation: 'qwen3.8b.local' }), CLASS);
  assert.equal(resolveModelClass([CLASS, { model_class: 'other', implementations: ['z'] }], { implementation: 'nope' }), null, 'two classes and no match: unknown');
  assert.equal(resolveModelClass([CLASS], { implementation: null }), CLASS, 'the pilot has one class');
  assert.equal(resolveModelClass([], {}), null);
  assert.equal(estimateMaxUnitsMicro({ input: {}, modelClass: CLASS }), 4096 * 1000 + 32768 * 100);
  assert.equal(estimateMaxUnitsMicro({ input: { num_predict: 64 }, modelClass: CLASS }), 64 * 1000 + 32768 * 100);
  assert.equal(estimateMaxUnitsMicro({ input: { num_predict: 64, num_ctx: 2048 }, modelClass: CLASS }), 64 * 1000 + 2048 * 100);
  assert.equal(estimateMaxUnitsMicro({ input: { num_predict: 1_000_000 }, modelClass: CLASS }), 4096 * 1000 + 32768 * 100, 'the class bound caps a greedy request');
  assert.equal(estimateMaxUnitsMicro({ input: {}, modelClass: null }), null);
  assert.equal(estimateMaxUnitsMicro({ input: {}, modelClass: { ...CLASS, out_unit_micro: 1.5 } }), null, 'integer weights only');
  // The caps the settle enforces are the caps the reservation is priced from.
  const single = { ...CLASS, max_eval_count: 1, max_prompt_eval_count: 1, out_unit_micro: Number.MAX_SAFE_INTEGER, in_unit_micro: 0 };
  assert.equal(estimateMaxUnitsMicro({ modelClass: single }), Number.MAX_SAFE_INTEGER);
  assert.equal(estimateMaxUnitsMicro({ modelClass: { ...single, in_unit_micro: 1 } }), null);
  assert.equal(estimateMaxUnitsMicro({ modelClass: { ...single, max_eval_count: 2 } }), null);

  assert.deepEqual(taskCounterCaps({ input: {}, modelClass: CLASS }), { max_eval_count: 4096, max_prompt_eval_count: 32768 });
  assert.deepEqual(taskCounterCaps({ input: { num_predict: 64, num_ctx: 4096 }, modelClass: CLASS }), { max_eval_count: 64, max_prompt_eval_count: 4096 });
  assert.deepEqual(taskCounterCaps({ input: { num_predict: 8, num_ctx: 512 }, modelClass: CLASS }), { max_eval_count: 16, max_prompt_eval_count: 2048 }, 'the adapter never runs below 16 tokens or a 2048 context');
  assert.deepEqual(taskCounterCaps({ input: { num_predict: '64', num_ctx: 12.5 }, modelClass: CLASS }), { max_eval_count: 4096, max_prompt_eval_count: 32768 }, 'only JSON integers lower a cap, as in the SQL');
  assert.equal(taskCounterCaps({ input: {}, modelClass: null }), null);
  for (const input of [{}, { num_predict: 64 }, { num_predict: 8, num_ctx: 512 }, { num_predict: 4096, num_ctx: 32768 }]) {
    const caps = taskCounterCaps({ input, modelClass: CLASS });
    assert.equal(caps.max_eval_count * CLASS.out_unit_micro + caps.max_prompt_eval_count * CLASS.in_unit_micro, estimateMaxUnitsMicro({ input, modelClass: CLASS }), 'an attempt inside its caps cannot cost more than the reservation');
  }
});

test('schedulerIdentity: the election holder and its term when active, null term when not, the Core id without an election', () => {
  const active = { holderId: 'core-primary', term: 3, isActive: () => true };
  assert.deepEqual(schedulerIdentity(active, {}), { holder_id: 'core-primary', term: 3, active: true, configured: true });
  assert.deepEqual(schedulerIdentity(STANDBY, {}), { holder_id: 'core-standby', term: null, active: false, configured: true });
  assert.deepEqual(schedulerIdentity(null, { MCCLUSTER_CORE_ID: 'core-ovh' }), { holder_id: 'core-ovh', term: null, active: true, configured: false });
  assert.deepEqual(schedulerIdentity(null, { MCCLUSTER_SCHEDULER_HOLDER_ID: 'prime', MCCLUSTER_CORE_ID: 'core-ovh' }).holder_id, 'prime');
  assert.equal(schedulerIdentity(null, { MCCLUSTER_CORE_ID: 'Not Valid!' }).holder_id, 'core-single');
});

test('the RPC wrappers post the named functions with the contract arguments over the PostgREST client', async () => {
  const seen = [];
  const restImpl = async (path, init) => { seen.push({ path, init }); return { body: { ok: true, path } }; };
  const deps = { rpc: createLedgerRpc(restImpl, { timeoutMs: 500 }) };
  await reserve({ opKey: 'k1', accountId: 'owner-1', taskId: TASK, maxUnitsMicro: 7_372_800, modelClass: 'pilot.qwen3-8b', unitVersion: 1 }, deps);
  await settle({ opKey: 'k2', taskId: TASK, leaseToken: 'tok', attempt: 1, metering: { eval_count: 1 }, outputSha256: 'a'.repeat(64), scheduler: { holder_id: 'core-primary', term: 2 } }, deps);
  await release({ opKey: 'k3', taskId: TASK, reason: 'canceled', scheduler: { holder_id: 'core-primary', term: null } }, deps);
  await balances({ accountId: 'owner-1' }, deps);
  await receipt({ taskId: TASK }, deps);
  await reserve({ opKey: 'k4', accountId: 'owner-1', taskId: TASK, maxUnitsMicro: 1 }, deps);
  await settle({ opKey: 'k5', taskId: TASK, leaseTokenHash: 'b'.repeat(64), attempt: 1, metering: {}, outputSha256: 'a'.repeat(64), scheduler: { holder_id: 'core-primary', term: 2 } }, deps);
  assert.deepEqual(seen.map((s) => s.path), ['rpc/compute_ledger_reserve', 'rpc/compute_ledger_settle', 'rpc/compute_ledger_release', 'rpc/compute_ledger_balances', 'rpc/compute_ledger_receipt', 'rpc/compute_ledger_reserve', 'rpc/compute_ledger_settle']);
  const bodies = seen.map((s) => JSON.parse(s.init.body));
  assert.deepEqual(bodies[0], { p_op_key: 'k1', p_account_id: 'owner-1', p_task_id: TASK, p_max_units_micro: 7_372_800, p_deadline_seconds: 3600, p_model_class: 'pilot.qwen3-8b', p_unit_version: 1 });
  assert.deepEqual(bodies[1], { p_op_key: 'k2', p_task_id: TASK, p_lease_token_hash: leaseTokenHash('tok'), p_attempt: 1, p_metering: { eval_count: 1 }, p_output_sha256: 'a'.repeat(64), p_scheduler_holder_id: 'core-primary', p_scheduler_term: 2 });
  assert.deepEqual(bodies[2], { p_op_key: 'k3', p_task_id: TASK, p_reason: 'canceled', p_scheduler_holder_id: 'core-primary', p_scheduler_term: null });
  assert.deepEqual(bodies[3], { p_account_id: 'owner-1' });
  assert.deepEqual(bodies[4], { p_task_id: TASK });
  assert.equal(bodies[5].p_model_class, null); assert.equal(bodies[5].p_unit_version, null);
  assert.equal(bodies[6].p_lease_token_hash, 'b'.repeat(64), 'the sweep settles with the stored token hash');
  assert.ok(seen.every((s) => s.init.method === 'POST' && s.init.signal instanceof AbortSignal), 'every call is a POST with a timeout');
  await assert.rejects(() => reserve({ opKey: 'k', accountId: 'a', taskId: TASK, maxUnitsMicro: -1 }, deps), (e) => e.code === 'LEDGER_ARGUMENT');
  await assert.rejects(() => settle({}, {}), TypeError);
});

test('with the flag unset nothing changes: the enqueue is PR #823\'s, no hold, no reservation, no settle, no release, no sweep, no read, no RPC', async () => {
  const f = fakeLedger({ ledgerOn: false });
  const submitted = await submitJob({ capability: 'ai.chat', implementation: 'qwen3.8b.local', input: { prompt: 'hi' }, account_id: 'owner-1', run_after: '2026-12-01T00:00:00.000Z' }, { canonicalOrg: ORG }, f.deps);
  assert.equal(submitted.ledger, undefined);
  assert.equal('ledger' in submitted, false);
  assert.equal(submitted.job.metadata.contribution, undefined);
  assert.equal(f.enqueued[0].runAfter, '2026-12-01T00:00:00.000Z', 'the submitter\'s own run_after, never the ledger hold');
  assert.equal(f.activated.length, 0);
  f.leases.set(LEASE, { id: LEASE, task_id: TASK, node_id: NODE, attempt: 1, status: 'done' });
  f.reads.length = 0;
  // /complete: whatever the node reports is committed as on PR #823; nothing is read, nothing is validated.
  for (const result of [{ usage: usage({ prompt_eval_cached_count: null }) }, { usage: 'garbage' }, { usage: usage({ eval_count: -5 }) }, { usage: usage({ eval_count: 9_000_000 }) }, { content: 'ECHO' }, {}]) {
    assert.deepEqual(await validateCompletion({ leaseId: LEASE, result }, f.deps), { checked: false, metered: false });
  }
  assert.deepEqual(f.reads, [], 'validateCompletion touches no row while the flag is unset');
  assert.deepEqual(await settleCompletion({ node: { id: NODE }, leaseId: LEASE, leaseToken: 't', result: { usage: usage() } }, f.deps), { enabled: false });
  assert.deepEqual(await settleDoneTask({ taskId: TASK }, f.deps), { enabled: false });
  assert.deepEqual(await releaseAfterFailure({ leaseId: LEASE }, f.deps), { enabled: false });
  assert.deepEqual(await releaseTaskReservation({ taskId: TASK }, f.deps), { enabled: false });
  assert.equal((await sweepContributionLedger({}, f.deps)).enabled, false);
  let timers = 0;
  const sweep = startContributionSweep({ setIntervalImpl: () => { timers += 1; return {}; } }, f.deps);
  assert.equal(sweep.enabled, false);
  assert.equal(timers, 0, 'no timer is armed while the flag is unset');
  assert.deepEqual(await sweep.tick(), { enabled: false });
  sweep.stop();
  assert.deepEqual(f.reads, []);
  assert.equal(f.calls.length, 0);
  assert.equal(f.canceled.length, 0);
});

test('submission with the ledger on enqueues the task held, reserves its max units for the paying account pinned to the class version, then lifts the hold', async () => {
  const f = fakeLedger({ answers: { compute_ledger_reserve: (p) => ({ ok: true, replayed: false, reservation_id: 7, max_units_micro: p.p_max_units_micro }) } });
  const submitted = await submitJob({ capability: 'ai.chat', implementation: 'qwen3.8b.local', input: { prompt: 'hi', num_predict: 64 }, account_id: 'owner-1' }, { canonicalOrg: ORG }, f.deps);
  assert.equal(f.enqueued[0].runAfter, LEDGER_HOLD_RUN_AFTER, 'enqueued where no claim reaches it');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'compute_ledger_reserve');
  assert.deepEqual(f.calls[0].payload, { p_op_key: `reserve:${TASK}`, p_account_id: 'owner-1', p_task_id: TASK, p_max_units_micro: 64 * 1000 + 32768 * 100, p_deadline_seconds: 3600, p_model_class: 'pilot.qwen3-8b', p_unit_version: 1 });
  assert.deepEqual(f.activated, [{ taskId: TASK, runAfter: null }], 'the hold is lifted only after the reservation exists');
  assert.equal(submitted.job.run_after, NOW);
  assert.equal(isLedgerHold(f.tasks.get(TASK).run_after), false);
  assert.equal(submitted.ledger.ok, true);
  assert.equal(submitted.ledger.model_class, 'pilot.qwen3-8b');
  assert.equal(submitted.ledger.account_id, 'owner-1');
  assert.deepEqual(submitted.job.metadata.contribution, { account_id: 'owner-1', run_after: null });
  assert.equal(f.logs.find((l) => l.event === 'compute_ledger_reserve').ok, true);
  // The submitter's own run_after survives the hold: in the metadata (so it stays in the request hash) and on the lifted task.
  const later = fakeLedger();
  const delayed = await submitJob({ capability: 'ai.chat', input: {}, account_id: 'owner-1', run_after: '2026-12-01T00:00:00.000Z' }, { canonicalOrg: ORG }, later.deps);
  assert.equal(later.enqueued[0].runAfter, LEDGER_HOLD_RUN_AFTER);
  assert.equal(later.enqueued[0].metadata.contribution.run_after, '2026-12-01T00:00:00.000Z');
  assert.equal(delayed.job.run_after, '2026-12-01T00:00:00.000Z');
  // The owner actor pays when no account is named; the configured default after that.
  const g = fakeLedger();
  await submitJob({ capability: 'ai.chat', input: {} }, { canonicalOrg: ORG, actor: { kind: 'owner', user_id: '11111111-1111-4111-8111-111111111111' } }, g.deps);
  assert.equal(g.calls[0].payload.p_account_id, '11111111-1111-4111-8111-111111111111');
  const h = fakeLedger(); h.deps.env = { CORE_CONTRIBUTION_DEFAULT_ACCOUNT: 'house', CORE_CONTRIBUTION_DEADLINE_SECONDS: '120' };
  await submitJob({ capability: 'ai.chat', input: {} }, { canonicalOrg: ORG }, h.deps);
  assert.equal(h.calls[0].payload.p_account_id, 'house');
  assert.equal(h.calls[0].payload.p_deadline_seconds, 120);
  const none = fakeLedger();
  await assert.rejects(() => submitJob({ capability: 'ai.chat', input: {} }, { canonicalOrg: ORG }, none.deps), (e) => e.code === 'LEDGER_ACCOUNT_REQUIRED' && e.status === 400);
  assert.equal(none.calls.length, 0, 'refused before anything is enqueued');
  assert.equal(none.enqueued.length, 0);
  await assert.rejects(() => submitJob({ capability: 'ai.chat', input: {}, account_id: 'bad id!' }, { canonicalOrg: ORG }, fakeLedger().deps), (e) => e.code === 'JOB_INVALID');
});

test('a refused reservation cancels the held task and surfaces the ledger code; an unknown class refuses too; a replay of the refusal is an error, not an ok canceled job', async () => {
  const f = fakeLedger({ answers: { compute_ledger_reserve: { ok: false, code: 'OVER_BUDGET', available: 5, requested: 7_372_800 } } });
  const body = { capability: 'ai.chat', implementation: 'qwen3.8b.local', input: {}, account_id: 'owner-1' };
  await assert.rejects(() => submitJob(body, { canonicalOrg: ORG, idempotencyKey: 'k' }, f.deps), (e) => e.code === 'OVER_BUDGET' && e.status === 409 && e.ledger.available === 5 && e.job_id === TASK);
  assert.deepEqual(f.canceled, [{ taskId: TASK, reason: 'contribution ledger refused: OVER_BUDGET' }]);
  assert.equal(f.tasks.get(TASK).status, 'canceled');
  assert.equal(f.activated.length, 0, 'a refused task is never made claimable');
  // The client retries under the same Idempotency-Key: the enqueue replays the canceled task and the SQL says TASK_NOT_QUEUED.
  f.calls.length = 0;
  const replay = fakeLedger({ answers: { compute_ledger_reserve: { ok: false, code: 'TASK_NOT_QUEUED', task_status: 'canceled' } } });
  replay.tasks.set(TASK, f.tasks.get(TASK));
  await assert.rejects(() => submitJob(body, { canonicalOrg: ORG, idempotencyKey: 'k' }, replay.deps), (e) => e.code === 'LEDGER_RESERVATION_REFUSED' && e.status === 409 && e.job_status === 'canceled' && e.job_id === TASK);
  assert.equal(replay.calls.length, 1, 'the replay re-attempted the reservation');
  assert.equal(replay.activated.length, 0);
  for (const code of ['QUOTA_RESERVATIONS', 'QUOTA_QUEUE', 'ACCOUNT_FROZEN', 'UNIT_VERSION_STALE']) {
    const g = fakeLedger({ answers: { compute_ledger_reserve: { ok: false, code } } });
    await assert.rejects(() => submitJob({ capability: 'ai.chat', input: {}, account_id: 'owner-1' }, { canonicalOrg: ORG }, g.deps), (e) => e.code === code);
    assert.equal(g.canceled.length, 1);
  }
  const noClass = fakeLedger({ classes: [{ ...CLASS, model_class: 'a', implementations: ['x'] }, { ...CLASS, model_class: 'b', implementations: ['y'] }] });
  await assert.rejects(() => submitJob({ capability: 'ai.chat', implementation: 'qwen3.8b.local', input: {}, account_id: 'owner-1' }, { canonicalOrg: ORG }, noClass.deps), (e) => e.code === 'LEDGER_CLASS_UNKNOWN');
  assert.equal(noClass.calls.length, 0);
  assert.equal(noClass.canceled.length, 1);
  // The cancel itself failing leaves a HELD task: nothing can claim it, and the sweep cancels the stale hold.
  const stuck = fakeLedger({ answers: { compute_ledger_reserve: { ok: false, code: 'OVER_BUDGET' } } });
  stuck.faults.cancel = new Error('database away');
  await assert.rejects(() => submitJob(body, { canonicalOrg: ORG }, stuck.deps), (e) => e.code === 'OVER_BUDGET');
  assert.equal(stuck.tasks.get(TASK).status, 'queued');
  assert.equal(isLedgerHold(stuck.tasks.get(TASK).run_after), true, 'still held: unclaimable');
  assert.equal(stuck.logs.some((l) => l.event === 'compute_ledger_cancel_failed'), true);
});

test('a reserve that THROWS never leaves a claimable unreserved task, and an idempotent replay re-attempts the missing reservation', async () => {
  const body = { capability: 'ai.chat', implementation: 'qwen3.8b.local', input: { prompt: 'hi' }, account_id: 'owner-1' };
  for (const [label, arrange] of [
    ['the reserve RPC times out', (f) => { f.answersBroken = true; }],
    ['the model class read fails (ledger SQL not promoted: 404 PGRST205)', (f) => { f.deps.modelClasses = async () => { throw Object.assign(new Error('relation not found'), { status: 404, detail: { code: 'PGRST205' } }); }; }]
  ]) {
    let broken = true;
    const f = fakeLedger({ answers: { compute_ledger_reserve: (p) => { if (broken) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); return { ok: true, replayed: false, max_units_micro: p.p_max_units_micro }; } } });
    const healthyClasses = f.deps.modelClasses;
    arrange(f);
    await assert.rejects(() => submitJob(body, { canonicalOrg: ORG, idempotencyKey: 'K' }, f.deps), (e) => e.code === 'LEDGER_RESERVE_FAILED' && e.status === 503 && e.retryable === true && e.job_id === TASK, label);
    const held = f.tasks.get(TASK);
    assert.equal(held.status, 'queued', label);
    assert.equal(isLedgerHold(held.run_after), true, `${label}: the task is held, so compute_claim_task (run_after <= now()) never hands it out`);
    assert.equal(Date.parse(held.run_after) > Date.parse('9000-01-01T00:00:00Z'), true);
    assert.equal(f.activated.length, 0, label);
    assert.equal(f.logs.some((l) => l.event === 'compute_ledger_reserve_failed'), true, label);
    // The client retries with the same Idempotency-Key: enqueue replays, and the reservation is attempted again.
    broken = false; f.deps.modelClasses = healthyClasses;
    const before = f.calls.filter((c) => c.name === 'compute_ledger_reserve').length;
    const retried = await submitJob(body, { canonicalOrg: ORG, idempotencyKey: 'K' }, f.deps);
    assert.equal(retried.replayed, true, label);
    assert.equal(f.calls.filter((c) => c.name === 'compute_ledger_reserve').length, before + 1, `${label}: a replay does not skip the reserve`);
    assert.equal(f.calls.at(-1).payload.p_op_key, `reserve:${TASK}`, 'the same operation key, so a reserve that did land replays in the SQL');
    assert.equal(retried.ledger.ok, true, label);
    assert.deepEqual(f.activated, [{ taskId: TASK, runAfter: null }], label);
    assert.equal(isLedgerHold(f.tasks.get(TASK).run_after), false, `${label}: claimable only now`);
    assert.equal(f.canceled.length, 0);
  }
  // Lifting the hold fails after the reserve landed: 503 retryable, still held; the replay lifts it.
  const f = fakeLedger();
  f.faults.activate = new Error('database away');
  await assert.rejects(() => submitJob(body, { canonicalOrg: ORG, idempotencyKey: 'K' }, f.deps), (e) => e.code === 'LEDGER_ACTIVATE_FAILED' && e.status === 503 && e.retryable === true);
  assert.equal(isLedgerHold(f.tasks.get(TASK).run_after), true);
  f.faults.activate = null;
  const again = await submitJob(body, { canonicalOrg: ORG, idempotencyKey: 'K' }, f.deps);
  assert.equal(again.replayed, true);
  assert.equal(f.activated.length, 1);
  // A replay of a submission that already ran: the reserve replays in the SQL (ok), nothing is held, nothing changes.
  f.tasks.get(TASK).status = 'done';
  const done = await submitJob(body, { canonicalOrg: ORG, idempotencyKey: 'K' }, f.deps);
  assert.equal(done.job.status, 'done');
  assert.equal(f.activated.length, 1);
});

test('settleCompletion settles the completing lease under the scheduler (holder, term) with the metering block and the hash of the STORED output', async () => {
  const f = fakeLedger({ answers: { compute_ledger_settle: { ok: true, replayed: false, accepted: true, charged: true, reason: 'accepted', minted_micro: 19333 } } });
  const node = { id: NODE, key_fingerprint: 'fp', inventory: { runtime: { hardware_mode: 'gpu-verified' } } };
  // PostgREST hands the stored jsonb back with its own key order and number spelling; the hash is over the value.
  const stored = { usage: usage(), content: 'hello', model: 'qwen3:8b', data: { small: 1e-7, big: 1e21 } };
  const wire = { model: 'qwen3:8b', content: 'hello', data: { big: 1e21, small: 1e-7 }, usage: usage() };
  f.tasks.set(TASK, { id: TASK, org_id: ORG, capability: 'ai.chat', implementation: 'qwen3.8b.local', status: 'done', attempts: 1, output: stored });
  f.leases.set(LEASE, { id: LEASE, task_id: TASK, node_id: NODE, attempt: 1, status: 'done', started_at: '2026-11-23T00:00:01.000Z', completed_at: '2026-11-23T00:00:04.000Z' });
  const out = await settleCompletion({ node, leaseId: LEASE, leaseToken: 'secret-token', result: wire, election: ACTIVE }, f.deps);
  assert.equal(out.enabled, true);
  assert.equal(out.accepted, true);
  assert.equal(f.calls.length, 1);
  const p = f.calls[0].payload;
  assert.equal(f.calls[0].name, 'compute_ledger_settle');
  assert.equal(p.p_op_key, `settle:${TASK}:1:core-primary:2`);
  assert.equal(p.p_task_id, TASK);
  assert.equal(p.p_lease_token_hash, leaseTokenHash('secret-token'));
  assert.equal(p.p_attempt, 1);
  assert.equal(p.p_output_sha256, hashJson(stored), 'the one hash implementation, over the stored output');
  assert.equal(p.p_output_sha256, hashJson(wire), 'key order and number spelling do not change it');
  assert.equal(hashJson(JSON.parse('{"big":1000000000000000000000,"small":0.0000001}')), hashJson({ small: 1e-7, big: 1e21 }), 'jsonb\'s plain-decimal spelling of 1e21 and 1e-7 parses to the same hash');
  assert.equal(p.p_scheduler_holder_id, 'core-primary');
  assert.equal(p.p_scheduler_term, 2);
  assert.equal(p.p_metering.eval_count, 50);
  assert.equal(p.p_metering.model, 'qwen3:8b');
  assert.equal(p.p_metering.model_digest, 'sha256:0123456789abcdef');
  assert.equal(p.p_metering.runtime_version, '0.6.0');
  assert.equal(p.p_metering.node_id, NODE);
  assert.equal(p.p_metering.hardware_mode, 'gpu-verified');
  assert.equal(p.p_metering.duration_ms, 3000);
  assert.equal(f.logs.find((l) => l.event === 'compute_ledger_settle').minted_micro, 19333);
  // A real Ollama result: the counter it never reports goes to the SQL as null (the SQL counts it as 0).
  const ollama = fakeLedger();
  ollama.tasks.set(TASK, { ...f.tasks.get(TASK), output: { model: 'qwen3:8b', content: 'x', usage: usage({ prompt_eval_cached_count: null }) } });
  ollama.leases.set(LEASE, f.leases.get(LEASE));
  await settleCompletion({ node, leaseId: LEASE, leaseToken: 't', result: {}, election: ACTIVE }, ollama.deps);
  assert.equal(ollama.calls[0].payload.p_metering.prompt_eval_cached_count, null);
  assert.equal(ollama.calls[0].payload.p_metering.eval_count, 50);
  // A standby that took the node's /complete does not call the ledger: the active scheduler's sweep settles.
  const g = fakeLedger();
  g.tasks.set(TASK, f.tasks.get(TASK)); g.leases.set(LEASE, f.leases.get(LEASE));
  const deferred = await settleCompletion({ node, leaseId: LEASE, leaseToken: 't', result: wire, election: STANDBY }, g.deps);
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.code, 'SCHEDULER_STANDBY');
  assert.equal(g.calls.length, 0, 'no settle with a null term from a standby');
  assert.equal(g.logs.at(-1).event, 'compute_ledger_settle_deferred');
  // No election: the Core id and a null term (accepted by the SQL only while the org has no scheduler row).
  const h = fakeLedger(); h.deps.env = { MCCLUSTER_CORE_ID: 'core-ovh' };
  h.tasks.set(TASK, f.tasks.get(TASK)); h.leases.set(LEASE, f.leases.get(LEASE));
  await settleCompletion({ node, leaseId: LEASE, leaseToken: 't', result: wire }, h.deps);
  assert.equal(h.calls[0].payload.p_scheduler_holder_id, 'core-ovh');
  assert.equal(h.calls[0].payload.p_scheduler_term, null);
  // A ledger fault never fails the completion: logged, returned, no throw.
  const broken = fakeLedger({ answers: { compute_ledger_settle: () => { throw new Error('database away'); } } });
  broken.tasks.set(TASK, f.tasks.get(TASK)); broken.leases.set(LEASE, f.leases.get(LEASE));
  const failed = await settleCompletion({ node, leaseId: LEASE, leaseToken: 't', result: wire }, broken.deps);
  assert.equal(failed.ok, false);
  assert.equal(broken.logs.at(-1).event, 'compute_ledger_settle_failed');
  const unknown = await settleCompletion({ node, leaseId: '20000000-0000-4000-8000-000000000009', leaseToken: 't', result: wire }, fakeLedger().deps);
  assert.equal(unknown.code, 'LEDGER_LEASE_UNKNOWN');
});

test('a settle that did not land is retried by the sweep: STALE_TERM, a deadlock and a timeout all end settled by the active scheduler', async () => {
  const stored = { model: 'qwen3:8b', content: 'hello', usage: usage() };
  const node = { id: NODE };
  for (const [label, firstAnswer] of [
    ['STALE_TERM (the scheduler lease moved during the job)', () => ({ ok: false, code: 'STALE_TERM' })],
    ['a deadlock abort (40P01)', () => { throw Object.assign(new Error('deadlock detected'), { status: 500, detail: { code: '40P01' } }); }],
    ['a client timeout before the SQL ran', () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }]
  ]) {
    let first = true;
    const f = fakeLedger({ answers: { compute_ledger_settle: (p) => { if (first) { first = false; return firstAnswer(); } f.reservations.get(p.p_task_id).status = 'settled'; return { ok: true, replayed: false, accepted: true, charged: true, reason: 'accepted', minted_micro: 19333, entries: { settle: 1, mint: 2, release: 3 } }; } } });
    f.tasks.set(TASK, { id: TASK, org_id: ORG, capability: 'ai.chat', implementation: 'qwen3.8b.local', status: 'done', attempts: 1, output: stored });
    f.leases.set(LEASE, { id: LEASE, task_id: TASK, node_id: NODE, attempt: 1, status: 'done', lease_token_hash: leaseTokenHash('secret-token'), started_at: '2026-11-23T00:00:01.000Z', completed_at: '2026-11-23T00:00:04.000Z' });
    f.reservations.set(TASK, { reservation_id: 1, task_id: TASK, account_id: 'owner-1', max_units_micro: 7_372_800, status: 'open', created_at: '2026-11-23T11:59:00.000Z', expires_at: '2026-11-23T12:59:00.000Z' });
    // Core A receives the completion under term 1; its settle does not land.
    const inline = await settleCompletion({ node, leaseId: LEASE, leaseToken: 'secret-token', result: stored, election: { holderId: 'core-a', term: 1, isActive: () => true } }, f.deps);
    assert.equal(inline.ok, false, label);
    assert.equal(f.reservations.get(TASK).status, 'open', `${label}: the task is done and its reservation still open`);
    // A standby sweeps nothing.
    const idle = await sweepContributionLedger({ orgId: ORG, election: STANDBY }, f.deps);
    assert.equal(idle.skipped, 'standby', label);
    assert.equal(f.calls.length, 1, label);
    // Core B holds the scheduler lease now (term 2). It never saw the completion; its sweep settles it from the durable rows.
    const swept = await sweepContributionLedger({ orgId: ORG, election: { holderId: 'core-b', term: 2, isActive: () => true } }, f.deps);
    assert.equal(swept.scanned, 1, label);
    assert.equal(swept.settled, 1, label);
    const p = f.calls.at(-1).payload;
    assert.equal(f.calls.at(-1).name, 'compute_ledger_settle');
    assert.equal(p.p_op_key, `settle:${TASK}:1:core-b:2`, 'a fresh key under the new holder\'s own term');
    assert.equal(p.p_scheduler_holder_id, 'core-b'); assert.equal(p.p_scheduler_term, 2);
    assert.equal(p.p_lease_token_hash, leaseTokenHash('secret-token'), 'fenced on the completing lease, from its stored hash');
    assert.equal(p.p_attempt, 1);
    assert.equal(p.p_output_sha256, hashJson(stored));
    assert.equal(p.p_metering.eval_count, 50); assert.equal(p.p_metering.node_id, NODE); assert.equal(p.p_metering.node_key_fingerprint, 'fp');
    assert.equal(f.reservations.get(TASK).status, 'settled', label);
    // Nothing is left for the next pass.
    const next = await sweepContributionLedger({ orgId: ORG, election: { holderId: 'core-b', term: 2, isActive: () => true } }, f.deps);
    assert.equal(next.scanned, 0, label);
  }
  // A done task whose settle is refused for good (no completing lease the SQL accepts) is released once its reservation expired, not held forever.
  const lost = fakeLedger({ answers: { compute_ledger_settle: { ok: false, code: 'LEASE_REJECTED' }, compute_ledger_release: (p) => { lost.reservations.get(p.p_task_id).status = 'released'; return { ok: true, released: true }; } } });
  lost.tasks.set(TASK, { id: TASK, org_id: ORG, capability: 'ai.chat', status: 'done', attempts: 2, output: stored });
  lost.leases.set(LEASE, { id: LEASE, task_id: TASK, node_id: NODE, attempt: 1, status: 'done', lease_token_hash: 'c'.repeat(64) });
  lost.reservations.set(TASK, { reservation_id: 1, task_id: TASK, status: 'open', created_at: '2026-11-23T11:00:00.000Z', expires_at: '2026-11-23T12:30:00.000Z' });
  assert.equal((await sweepContributionLedger({ orgId: ORG }, lost.deps)).released, 0, 'not before the reservation expires');
  lost.reservations.get(TASK).expires_at = '2026-11-23T11:30:00.000Z';
  const gone = await sweepContributionLedger({ orgId: ORG }, lost.deps);
  assert.equal(gone.released, 1);
  assert.equal(lost.calls.at(-1).payload.p_reason, 'unsettleable:LEASE_REJECTED:done');
  // settleDoneTask on a task that is not done does nothing.
  const early = fakeLedger(); early.tasks.set(TASK, { id: TASK, status: 'running' });
  assert.deepEqual(await settleDoneTask({ taskId: TASK }, early.deps), { enabled: true, ok: true, settled: false, reason: 'task_not_done', task_status: 'running' });
  assert.equal(early.calls.length, 0);
});

test('a failure releases the reservation only once the task is terminal; a retry keeps it; the sweep releases failed, canceled and expired-in-queue reservations', async () => {
  const f = fakeLedger({ answers: { compute_ledger_release: { ok: true, replayed: false, released: true } } });
  f.tasks.set(TASK, { id: TASK, org_id: ORG, capability: 'ai.chat', status: 'queued', attempts: 1, max_attempts: 3 });
  f.leases.set(LEASE, { id: LEASE, task_id: TASK, node_id: NODE, attempt: 1, status: 'failed' });
  const election = { holderId: 'core-primary', term: 1, isActive: () => true };
  const retry = await releaseAfterFailure({ leaseId: LEASE, election }, f.deps);
  assert.deepEqual(retry, { enabled: true, ok: true, released: false, reason: 'task_not_terminal', task_status: 'queued' });
  assert.equal(f.calls.length, 0, 'a retryable failure keeps the reservation for the next attempt');
  f.tasks.get(TASK).status = 'failed';
  const standby = await releaseAfterFailure({ leaseId: LEASE, election: STANDBY }, f.deps);
  assert.equal(standby.deferred, true);
  assert.equal(f.calls.length, 0, 'a standby leaves the release to the active scheduler\'s sweep');
  const released = await releaseAfterFailure({ leaseId: LEASE, election }, f.deps);
  assert.equal(released.released, true);
  assert.deepEqual(f.calls[0].payload, { p_op_key: `release:${TASK}:failed:core-primary:1`, p_task_id: TASK, p_reason: 'failed:failed', p_scheduler_holder_id: 'core-primary', p_scheduler_term: 1 });
  const canceled = fakeLedger({ answers: { compute_ledger_release: { ok: true, released: true } } });
  canceled.tasks.set(TASK, { id: TASK, status: 'canceled' });
  assert.equal((await releaseTaskReservation({ taskId: TASK, reason: 'canceled' }, canceled.deps)).released, true);
  assert.equal(canceled.calls[0].payload.p_reason, 'canceled:canceled');
  assert.equal((await releaseAfterFailure({ leaseId: '20000000-0000-4000-8000-000000000009' }, fakeLedger().deps)).code, 'LEDGER_LEASE_UNKNOWN');

  // The sweep: one failed task, one running (left alone), one queued inside its deadline (left alone).
  const sweep = fakeLedger({ answers: { compute_ledger_release: (p) => { sweep.reservations.get(p.p_task_id).status = 'released'; return { ok: true, released: true }; } } });
  const open = (taskId, over = {}) => sweep.reservations.set(taskId, { reservation_id: sweep.reservations.size + 1, task_id: taskId, account_id: 'owner-1', max_units_micro: 7_372_800, status: 'open', created_at: '2026-11-23T11:59:00.000Z', expires_at: '2026-11-23T12:59:00.000Z', ...over });
  sweep.tasks.set(TASK, { id: TASK, org_id: ORG, status: 'failed' }); open(TASK);
  sweep.tasks.set(TASK2, { id: TASK2, org_id: ORG, status: 'running' }); open(TASK2);
  sweep.tasks.set(TASK3, { id: TASK3, org_id: ORG, status: 'queued', run_after: NOW }); open(TASK3);
  const swept = await sweepContributionLedger({ orgId: ORG }, sweep.deps);
  assert.equal(swept.scanned, 3);
  assert.equal(swept.released, 1);
  assert.equal(swept.canceled, 0);
  assert.equal(sweep.calls.length, 1);
  assert.equal(sweep.calls[0].payload.p_reason, 'sweep:failed');
  assert.equal(sweep.tasks.get(TASK3).status, 'queued');

  // The reservation of a queued task nobody ever claimed expires: the task is canceled (atomically against a claim) and the reservation released.
  sweep.reservations.get(TASK3).expires_at = '2026-11-23T11:59:59.000Z';
  const expired = await sweepContributionLedger({ orgId: ORG }, sweep.deps);
  assert.equal(expired.canceled, 1);
  assert.equal(expired.released, 1);
  assert.deepEqual(sweep.canceled, [{ taskId: TASK3, reason: 'contribution ledger: reservation_expired' }]);
  assert.equal(sweep.tasks.get(TASK3).status, 'canceled');
  assert.equal(sweep.calls.at(-1).payload.p_task_id, TASK3);
  assert.equal(sweep.calls.at(-1).payload.p_reason, 'reservation_expired:canceled');
  assert.equal(sweep.reservations.get(TASK3).status, 'released', 'pending returns to the account');
  // The running task's reservation expires too: it is left to its own completion (LATE) or failure.
  sweep.reservations.get(TASK2).expires_at = '2026-11-23T11:59:59.000Z';
  const running = await sweepContributionLedger({ orgId: ORG }, sweep.deps);
  assert.equal(running.scanned, 1); assert.equal(running.released, 0); assert.equal(running.canceled, 0);

  // A node claims the expired queued task between the read and the cancel: the cancel loses and nothing is released.
  const race = fakeLedger();
  race.tasks.set(TASK, { id: TASK, org_id: ORG, status: 'queued', run_after: NOW });
  race.reservations.set(TASK, { reservation_id: 1, task_id: TASK, status: 'open', created_at: '2026-11-23T10:00:00.000Z', expires_at: '2026-11-23T11:00:00.000Z' });
  race.deps.cancelQueued = async () => null;
  const lostRace = await sweepContributionLedger({ orgId: ORG }, race.deps);
  assert.equal(lostRace.canceled, 0); assert.equal(lostRace.released, 0); assert.equal(race.calls.length, 0);
  assert.equal(lostRace.outcomes[0].reason, 'claimed_meanwhile');

  // Held tasks: reserved but never made claimable, and never reserved at all. Both are cleaned up after the grace, neither before.
  const holds = fakeLedger({ answers: { compute_ledger_release: (p) => { holds.reservations.get(p.p_task_id).status = 'released'; return { ok: true, released: true }; } } });
  holds.tasks.set(TASK, { id: TASK, org_id: ORG, status: 'queued', run_after: LEDGER_HOLD_RUN_AFTER, created_at: '2026-11-23T11:59:00.000Z' });
  holds.reservations.set(TASK, { reservation_id: 1, task_id: TASK, status: 'open', created_at: '2026-11-23T11:59:00.000Z', expires_at: '2026-11-23T12:59:00.000Z' });
  holds.tasks.set(TASK2, { id: TASK2, org_id: ORG, status: 'queued', run_after: LEDGER_HOLD_RUN_AFTER, created_at: '2026-11-23T11:59:00.000Z' });
  const fresh = await sweepContributionLedger({ orgId: ORG }, holds.deps);
  assert.equal(fresh.canceled, 0, 'a submission in flight is not touched');
  for (const id of [TASK, TASK2]) holds.tasks.get(id).created_at = '2026-11-23T11:40:00.000Z';
  holds.reservations.get(TASK).created_at = '2026-11-23T11:40:00.000Z';
  const stale = await sweepContributionLedger({ orgId: ORG }, holds.deps);
  assert.equal(stale.canceled, 2);
  assert.equal(stale.released, 1);
  assert.deepEqual(holds.canceled.map((c) => c.reason).sort(), ['contribution ledger: hold_never_lifted', 'contribution ledger: never reserved']);
  assert.equal(holds.reservations.get(TASK).status, 'released');

  // One bad row does not stop the pass.
  const bumpy = fakeLedger({ answers: { compute_ledger_release: { ok: true, released: true } } });
  bumpy.tasks.set(TASK, { id: TASK, org_id: ORG, status: 'queued', run_after: NOW }); bumpy.tasks.set(TASK2, { id: TASK2, org_id: ORG, status: 'failed' });
  bumpy.reservations.set(TASK, { reservation_id: 1, task_id: TASK, status: 'open', expires_at: '2026-11-23T11:00:00.000Z' });
  bumpy.reservations.set(TASK2, { reservation_id: 2, task_id: TASK2, status: 'open', expires_at: '2026-11-23T12:59:00.000Z' });
  bumpy.faults.cancel = new Error('database away');
  const partial = await sweepContributionLedger({ orgId: ORG }, bumpy.deps);
  assert.equal(partial.errors >= 1, true); assert.equal(partial.released, 1);
});

test('startContributionSweep arms an interval, asks the election on every pass, never overlaps, and the gateway starts it beside the election loop', async () => {
  const timers = [];
  const cleared = [];
  const setIntervalImpl = (fn, ms) => { const timer = { fn, ms, unref() { this.unrefd = true; } }; timers.push(timer); return timer; };
  const clearIntervalImpl = (timer) => cleared.push(timer);
  let active = false;
  const election = { holderId: 'core-primary', get term() { return active ? 4 : null; }, isActive: () => active };
  let release;
  const f = fakeLedger({ answers: { compute_ledger_release: () => new Promise((resolve) => { release = () => resolve({ ok: true, released: true }); }) } });
  f.tasks.set(TASK, { id: TASK, org_id: ORG, status: 'failed' });
  f.reservations.set(TASK, { reservation_id: 1, task_id: TASK, status: 'open', expires_at: '2026-11-23T12:59:00.000Z' });
  f.deps.env = { CORE_CONTRIBUTION_SWEEP_MS: '45000' };
  const sweep = startContributionSweep({ election, orgId: ORG, setIntervalImpl, clearIntervalImpl }, f.deps);
  assert.equal(sweep.enabled, true);
  assert.equal(sweep.intervalMs, 45000);
  assert.equal(timers.length, 1); assert.equal(timers[0].ms, 45000); assert.equal(timers[0].unrefd, true, 'the timer never keeps the process alive');
  assert.equal(f.logs.at(-1).event, 'compute_ledger_sweep_started');
  // Standby: the pass does nothing.
  timers[0].fn();
  assert.equal((await sweep.tick()).skipped, 'standby');
  assert.equal(f.calls.length, 0);
  // The election makes this instance active: the next interval pass releases under the live term.
  active = true;
  timers[0].fn();
  const inFlight = sweep.tick();
  timers[0].fn();
  assert.equal(sweep.tick(), inFlight, 'a pass in flight is not doubled');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].payload, { p_op_key: `release:${TASK}:failed:core-primary:4`, p_task_id: TASK, p_reason: 'sweep:failed', p_scheduler_holder_id: 'core-primary', p_scheduler_term: 4 });
  release();
  assert.equal((await inFlight).released, 1);
  // A pass that throws is logged and the loop survives.
  f.deps.openReservations = async () => { throw new Error('database away'); };
  const failed = await sweep.tick();
  assert.equal(failed.ok, false);
  assert.equal(f.logs.at(-1).event, 'compute_ledger_sweep_failed');
  sweep.stop(); sweep.stop();
  assert.deepEqual(cleared, [timers[0]]);
  // Bounds on the interval; the default is 30 s.
  assert.equal(startContributionSweep({ intervalMs: 1, setIntervalImpl, clearIntervalImpl }, fakeLedger().deps).intervalMs, 5000);
  assert.equal(startContributionSweep({ setIntervalImpl, clearIntervalImpl }, fakeLedger().deps).intervalMs, 30000);
  // The gateway wires it where the election loop starts, with the same election, and stops it on shutdown.
  const gateway = readFileSync(new URL('../src/compute/gateway.mjs', import.meta.url), 'utf8');
  const started = gateway.indexOf('await election.start();');
  const wired = gateway.indexOf('startContributionSweep({ election,');
  assert.ok(started > 0 && wired > started && wired - started < 900, 'startContributionSweep follows election.start()');
  assert.ok(wired < gateway.indexOf('server.listen(PORT'), 'armed before the gateway takes traffic');
  assert.match(gateway, /ledgerSweep\.stop\(\);/);
});

test('the ledger store reads: open reservations of every task state, the task reservation, the settle lease with its token hash, the hold and its lift', async () => {
  const seen = [];
  const restImpl = (rows) => async (path, init) => { seen.push({ path: decodeURIComponent(path), init }); return { body: rows }; };
  const rows = await openReservations({ orgId: ORG, limit: 10 }, { restImpl: restImpl([{ reservation_id: 3, task_id: TASK, account_id: 'owner-1', max_units_micro: 5, created_at: 'c', expires_at: 'e', ops_compute_tasks: { id: TASK, org_id: ORG, status: 'done', run_after: 'r', metadata: { a: 1 } } }]) });
  assert.deepEqual(rows, [{ reservation_id: 3, task_id: TASK, account_id: 'owner-1', max_units_micro: 5, created_at: 'c', expires_at: 'e', task_status: 'done', org_id: ORG, run_after: 'r', metadata: { a: 1 } }]);
  assert.match(seen[0].path, /^ops_compute_spend_reservations\?status=eq\.open&/);
  assert.equal(/ops_compute_tasks\.status=/.test(seen[0].path), false, 'no task-status filter: a done task with an open reservation is in the list');
  assert.match(seen[0].path, new RegExp(`ops_compute_tasks\\.org_id=eq\\.${ORG}`));
  const missing = async () => { throw Object.assign(new Error('not found'), { status: 404, detail: { code: 'PGRST205' } }); };
  assert.deepEqual(await openReservations({}, { restImpl: missing }), [], 'the ledger SQL is not promoted: nothing to sweep');
  assert.equal(await reservationForTask({ taskId: TASK }, { restImpl: missing }), null);
  assert.equal(await reservationForTask({ taskId: 'nope' }, { restImpl: missing }), null);
  assert.deepEqual(await reservationForTask({ taskId: TASK }, { restImpl: restImpl([{ task_id: TASK, status: 'open', model_class: 'pilot.qwen3-8b', unit_version: 1 }]) }), { task_id: TASK, status: 'open', model_class: 'pilot.qwen3-8b', unit_version: 1 });
  const lease = await completingLeaseForSettle({ taskId: TASK }, { restImpl: restImpl([{ id: LEASE, task_id: TASK, attempt: 2, status: 'done', lease_token_hash: 'd'.repeat(64) }]) });
  assert.equal(lease.lease_token_hash, 'd'.repeat(64));
  assert.match(seen.at(-1).path, /status=eq\.done/); assert.match(seen.at(-1).path, /lease_token_hash/); assert.match(seen.at(-1).path, /order=attempt\.desc/);
  assert.equal(isLedgerHold(LEDGER_HOLD_RUN_AFTER), true);
  assert.equal(isLedgerHold('9999-12-31T00:00:00+00:00'), true, 'PostgREST spells the same instant differently');
  assert.equal(isLedgerHold(NOW), false); assert.equal(isLedgerHold(null), false);
  const lifted = await activateHeldTask({ orgId: ORG, taskId: TASK, runAfter: null }, { restImpl: restImpl([{ id: TASK, status: 'queued', run_after: NOW }]), now: () => NOW });
  assert.equal(lifted.run_after, NOW);
  const patch = seen.at(-1);
  assert.equal(patch.init.method, 'PATCH');
  assert.match(patch.path, /status=eq\.queued/); assert.match(patch.path, new RegExp(`run_after=eq\\.${LEDGER_HOLD_RUN_AFTER.replace(/[.]/g, '\\.')}`), 'only a task that is still queued and still held');
  assert.deepEqual(JSON.parse(patch.init.body), { run_after: NOW, updated_at: NOW });
  await activateHeldTask({ orgId: ORG, taskId: TASK, runAfter: '2026-12-01T00:00:00.000Z' }, { restImpl: restImpl([]), now: () => NOW });
  assert.equal(JSON.parse(seen.at(-1).init.body).run_after, '2026-12-01T00:00:00.000Z');
  assert.equal(await activateHeldTask({ orgId: ORG, taskId: TASK }, { restImpl: restImpl([]), now: () => NOW }), null, 'nothing held: nothing lifted');
  await staleHeldTasks({ orgId: ORG, olderThan: NOW }, { restImpl: restImpl([]) });
  assert.match(seen.at(-1).path, /status=eq\.queued/); assert.match(seen.at(-1).path, /created_at=lt\./); assert.match(seen.at(-1).path, /metadata->contribution=not\.is\.null/);
  assert.deepEqual(await staleHeldTasks({ orgId: ORG }, { restImpl: missing }), [], 'no cutoff: no query');
});

test('balances and receipt pass through to the RPCs; the receipt id is validated', async () => {
  const f = fakeLedger({ answers: { compute_ledger_balances: { account_id: 'owner-1', pending: 0, earned: 3, spent: 1, available: 2, display_points: 0 }, compute_ledger_receipt: { schema: 'mccluster-ledger-receipt/1', task_id: TASK } } });
  assert.equal((await ledgerBalances({ accountId: 'owner-1' }, f.deps)).available, 2);
  assert.equal((await ledgerReceipt({ taskId: TASK }, f.deps)).schema, 'mccluster-ledger-receipt/1');
  await assert.rejects(() => ledgerReceipt({ taskId: 'nope' }, f.deps), (e) => e.code === 'JOB_ID_INVALID');
  assert.deepEqual(f.calls.map((c) => c.name), ['compute_ledger_balances', 'compute_ledger_receipt']);
});
