// Orchestration for the device job contract, shared by the gateway's HTTP
// routes (admin token, staging and ops) and the Core control tools (the owner's
// path through the Worker). Durable truth stays in ops_compute_tasks and
// ops_compute_leases; this layer only reads them into the contract shapes.
import { cancelQueuedComputeTask, computeTaskById, enqueueComputeTask, liveCapabilityImplementations, nodeById } from './store.mjs';
import { LEDGER_HOLD_RUN_AFTER, activateHeldTask, attestationForLease, completingLeaseForSettle, isLedgerHold, leaseById, leasesForTask, listComputeTasks, nodesById, openReservations, recordAttestation, reservationForTask, staleHeldTasks, taskRowById } from './jobs-store.mjs';
import { buildReceipt, completingLease, completionAttestation, hashJson, jobResult, jobView, latestLease, meteringBlock, receiptKeyFromEnv, receiptKeyInfo, signReceipt, validateJobSubmission, validateResultUsage } from './jobs.mjs';
import { ownedOnlyAdmitted } from './protocol.mjs';
import { createLedgerRpc, estimateMaxUnitsMicro, leaseTokenHash, ledgerEnabled, listModelClasses, operationKey, resolveModelClass, schedulerIdentity, taskCounterCaps, balances as ledgerBalancesRpc, receipt as ledgerReceiptRpc, release as ledgerRelease, reserve as ledgerReserve, settle as ledgerSettle } from './contribution-ledger.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const JOB_SOURCE = 'device-jobs/1';
const AI_CAPABILITY = /^ai\./;
const TERMINAL_TASK = new Set(['failed', 'canceled']);

function httpError(message, status, code, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

// The process receipt key is resolved once (a malformed key fails loudly at
// gateway start, see gateway.mjs); a custom env gets its own cache.
let processReceiptKey;
export function resolveReceiptKey(env = process.env) {
  if (env !== process.env) return receiptKeyFromEnv(env);
  if (processReceiptKey === undefined) processReceiptKey = receiptKeyFromEnv(env);
  return processReceiptKey;
}

export function defaultDeps(env = process.env) {
  let key;
  let rpc;
  return {
    env,
    enqueue: enqueueComputeTask,
    taskById: computeTaskById,
    live: liveCapabilityImplementations,
    nodeById,
    leasesForTask,
    leaseById,
    listTasks: listComputeTasks,
    nodesById,
    recordAttestation,
    attestationForLease,
    // Resolved lazily so a gateway without the key still starts; a malformed key fails here, loudly, on first use.
    receiptKey: () => { if (key === undefined) key = resolveReceiptKey(env); return key; },
    // Contribution ledger (COMPUTE-CONTRIBUTION-LEDGER.md), off unless CORE_CONTRIBUTION_LEDGER_ENABLED=1.
    ledgerEnabled: () => ledgerEnabled(env),
    rpc: (name, payload) => { if (!rpc) rpc = createLedgerRpc(); return rpc(name, payload); },
    modelClasses: listModelClasses,
    taskRowById,
    cancelQueued: cancelQueuedComputeTask,
    openReservations,
    reservationForTask,
    completingLeaseForSettle,
    activateHeld: activateHeldTask,
    staleHeldTasks,
    now: () => new Date().toISOString(),
    log: (record) => console.log(JSON.stringify(record))
  };
}

function requireJobId(value) {
  if (!UUID.test(String(value || ''))) throw httpError('job_id must be a UUID', 400, 'JOB_ID_INVALID');
  return String(value).toLowerCase();
}

export async function submitJob(body, { canonicalOrg = null, idempotencyKey = null, actor = null, via = 'gateway', election = null } = {}, deps = defaultDeps()) {
  const submission = validateJobSubmission(body, { canonicalOrg });
  // The preflight applies the same tests the claim applies (compute_claim_task
  // and claimableManifest): capability, pinned implementation, the requested
  // features as a subset of the advertised ones, and owned-only admission. A
  // job nothing can claim is refused here instead of sitting queued forever.
  const wanted = submission.requirements.features || {};
  const satisfies = (item) => Object.entries(wanted).every(([key, value]) => JSON.stringify(item.features?.[key]) === JSON.stringify(value));
  const advertised = (await deps.live({ orgId: submission.org_id }))
    .filter((item) => item.capability === submission.capability
      && (!submission.implementation || item.implementation === submission.implementation)
      && satisfies(item)
      && ownedOnlyAdmitted(item.capability, item.labels));
  if (!advertised.length && !submission.allow_offline) {
    throw httpError(`No live compute node serves ${submission.capability}${submission.implementation ? `/${submission.implementation}` : ''}; pass allow_offline:true to queue anyway`, 503, 'COMPUTE_NO_LIVE_NODE', { retryable: true });
  }
  // Metadata is part of the idempotency request hash (compute_enqueue_task), so
  // it holds only what a legitimate retry of the same submission repeats:
  // nothing time- or fleet-dependent. The task row's created_at is the time of
  // acceptance; the live-node snapshot travels in the response, not the row.
  const ledgerOn = ledgerIsOn(deps);
  // The account that pays: named on the submission, else the owner actor, else
  // the configured default. Recorded in metadata only when the ledger is on
  // (metadata is part of the idempotency hash; an unset flag changes nothing).
  const accountId = ledgerOn ? (submission.account_id || actor?.user_id || String(deps.env?.CORE_CONTRIBUTION_DEFAULT_ACCOUNT || '').trim() || null) : null;
  if (ledgerOn && !accountId) throw httpError('The contribution ledger is on and no account pays for this job: pass account_id', 400, 'LEDGER_ACCOUNT_REQUIRED');
  const metadata = {
    ...submission.metadata,
    source: JOB_SOURCE,
    via,
    client: submission.client,
    submitted_by: actor ? { kind: actor.kind || 'owner', user_id: actor.user_id || null, source: actor.source || null } : null,
    // With the ledger on the task is enqueued held (see below), so the
    // submitter's own run_after travels here: it stays part of the request hash.
    ...(ledgerOn ? { contribution: { account_id: accountId, run_after: submission.run_after } } : {})
  };
  const liveNodes = [...new Set(advertised.map((item) => item.node_id))];
  const { task, replayed } = await deps.enqueue({
    orgId: submission.org_id,
    capability: submission.capability,
    implementation: submission.implementation,
    input: submission.input,
    requirements: submission.requirements,
    priority: submission.priority,
    // Ledger on: the task is enqueued HELD (a constant far-future run_after no
    // claim reaches) and becomes claimable only after its reservation exists.
    // A reserve that throws therefore never leaves a claimable unreserved task.
    runAfter: ledgerOn ? LEDGER_HOLD_RUN_AFTER : submission.run_after,
    maxAttempts: submission.max_attempts,
    metadata,
    idempotencyKey
  });
  if (!task) throw httpError('Failed to enqueue compute job', 503, 'COMPUTE_ENQUEUE_FAILED');
  if (!ledgerOn) return { job: jobView({ task, leases: [], node: null }), replayed: Boolean(replayed), live_nodes: liveNodes.length, live_node_ids: liveNodes };
  const { ledger, task: live } = await reserveThenRelease({ task, submission, accountId, replayed: Boolean(replayed) }, deps);
  return { job: jobView({ task: live, leases: [], node: null }), replayed: Boolean(replayed), live_nodes: liveNodes.length, live_node_ids: liveNodes, ledger };
}

function ledgerIsOn(deps) {
  return typeof deps?.ledgerEnabled === 'function' && deps.ledgerEnabled() === true;
}

// Reserve at submission with the task's max units (COMPUTE-CONTRIBUTION-LEDGER.md),
// then lift the hold. Every step is idempotent (the reserve on its operation
// key, the lift on the held state), so a replayed submission runs them again:
// a reservation the first acceptance never got is attempted now.
//   reserve throws      -> 503 retryable; the task stays held (unclaimable).
//                          A retry with the same Idempotency-Key reserves it;
//                          without one the sweep cancels the stale hold.
//   reserve refuses     -> the held task is canceled and the ledger's code answers 409.
//   lifting the hold throws -> 503 retryable; held and reserved, a retry lifts
//                          it, else the sweep cancels and releases it.
async function reserveThenRelease({ task, submission, accountId, replayed }, deps) {
  let ledger;
  try {
    ledger = await reserveForTask({ task, submission, accountId }, deps);
  } catch (error) {
    deps.log({ event: 'compute_ledger_reserve_failed', task_id: task.id, account_id: accountId, replayed, message: error.message, code: error.code || null });
    throw httpError('The contribution ledger could not reserve this job; it is held and will not run. Retry with the same Idempotency-Key', 503, 'LEDGER_RESERVE_FAILED', { retryable: true, job_id: task.id });
  }
  if (!ledger.ok) {
    if (ledger.code === 'TASK_NOT_QUEUED') {
      // Only a replay gets here: the first acceptance was refused and its task
      // canceled (or the task left the queue with no reservation under this key).
      throw httpError(`This job was not reserved and is ${ledger.task_status || task.status}; submit it again under a new Idempotency-Key`, 409, 'LEDGER_RESERVATION_REFUSED', { ledger, job_id: task.id, job_status: ledger.task_status || task.status });
    }
    await deps.cancelQueued({ orgId: submission.org_id, taskId: task.id, reason: `contribution ledger refused: ${ledger.code}` }).catch((error) => {
      // The task is held, so nothing claims it; the sweep cancels the stale hold.
      deps.log({ event: 'compute_ledger_cancel_failed', task_id: task.id, message: error.message, code: error.code || null });
    });
    throw httpError(`The contribution ledger refused the reservation (${ledger.code})`, 409, ledger.code, { ledger, job_id: task.id });
  }
  let live = task;
  try {
    live = (await deps.activateHeld({ orgId: submission.org_id, taskId: task.id, runAfter: submission.run_after })) || task;
  } catch (error) {
    deps.log({ event: 'compute_ledger_activate_failed', task_id: task.id, message: error.message, code: error.code || null });
    throw httpError('The job is reserved but could not be made claimable; retry with the same Idempotency-Key', 503, 'LEDGER_ACTIVATE_FAILED', { retryable: true, job_id: task.id });
  }
  return { ledger, task: live };
}

async function reserveForTask({ task, submission, accountId }, deps) {
  const modelClass = resolveModelClass(await deps.modelClasses(), { implementation: submission.implementation ?? task.implementation ?? null });
  const maxUnitsMicro = estimateMaxUnitsMicro({ input: submission.input, modelClass });
  if (maxUnitsMicro === null) return { ok: false, code: 'LEDGER_CLASS_UNKNOWN', reason: 'no model class prices this implementation' };
  const deadlineSeconds = Number(deps.env?.CORE_CONTRIBUTION_DEADLINE_SECONDS) || undefined;
  const outcome = await ledgerReserve({ opKey: operationKey('reserve', [task.id]), accountId, taskId: task.id, maxUnitsMicro, deadlineSeconds, modelClass: modelClass.model_class, unitVersion: modelClass.unit_version }, deps);
  deps.log({ event: 'compute_ledger_reserve', task_id: task.id, account_id: accountId, max_units_micro: maxUnitsMicro, model_class: modelClass?.model_class ?? null, unit_version: modelClass?.unit_version ?? null, ok: outcome?.ok === true, code: outcome?.code ?? null, replayed: outcome?.replayed === true });
  return { ...(outcome || { ok: false, code: 'LEDGER_NO_REPLY' }), model_class: modelClass?.model_class ?? null, max_units_micro: maxUnitsMicro, account_id: accountId };
}

// ---- Completion and failure paths -------------------------------------------
// Called by the gateway BEFORE compute_complete_lease commits a result.
//
// With CORE_CONTRIBUTION_LEDGER_ENABLED unset this does nothing at all: no
// read, no check, exactly the /complete of PR #823. A real Ollama result (its
// prompt_eval_cached_count is always null, zero counters are omitted) is
// committed as it always was.
//
// With the ledger on it inspects only an ai.* task that holds an OPEN
// reservation: the counters must be present and well formed (an unreported one
// is 0) and inside the task's own caps (num_predict, num_ctx) and the model
// class maxima, the same rule the reservation was priced with. A refusal
// leaves the lease running; the node fails or retries. This is an early
// refusal only: compute_ledger_settle enforces the same bounds, so a read that
// fails here never blocks a completion.
export async function validateCompletion({ leaseId, result }, deps = defaultDeps()) {
  const skipped = { checked: false, metered: false };
  if (!ledgerIsOn(deps)) return skipped;
  let task; let lease; let reservation; let classes;
  try {
    lease = await deps.leaseById({ leaseId });
    task = lease ? await deps.taskRowById({ taskId: lease.task_id }) : null;
    if (!task || !AI_CAPABILITY.test(String(task.capability || ''))) return skipped;
    reservation = await deps.reservationForTask({ taskId: task.id });
    if (!reservation || reservation.status !== 'open') return skipped;
    classes = await deps.modelClasses();
  } catch (error) {
    deps.log({ event: 'compute_ledger_validate_unavailable', lease_id: leaseId, message: error.message, code: error.code || null });
    return skipped;
  }
  const pinned = (Array.isArray(classes) ? classes : []).find((row) => row?.model_class === reservation.model_class) || null;
  const modelClass = pinned || resolveModelClass(classes, { implementation: lease.implementation ?? task.implementation ?? null });
  const bounds = taskCounterCaps({ input: task.input || {}, modelClass }) || {};
  const usage = result && typeof result === 'object' && !Array.isArray(result) ? result.usage : undefined;
  const verdict = validateResultUsage(usage, bounds);
  if (!verdict.ok) throw httpError(`Result usage refused: ${verdict.reason}`, 422, verdict.code, { lease_id: leaseId });
  if (!verdict.metered) throw httpError('This job holds a contribution reservation: its ai.* result must carry the runtime usage counters', 422, 'RESULT_USAGE_MISSING', { lease_id: leaseId });
  return { checked: true, metered: true };
}

// One settle of a done task's completing lease, under this instance's
// scheduler identity. The output hash has ONE implementation, hashJson(), and
// is taken over the STORED output (what the SQL compares the lease's result
// with), never re-derived in SQL. An instance that is not the active scheduler
// does not call the ledger at all: the active scheduler's sweep settles.
async function settleAttempt({ task, lease, node, tokenHash, election, via }, deps) {
  const scheduler = schedulerIdentity(election, deps.env);
  if (scheduler.configured && !scheduler.active) {
    deps.log({ event: 'compute_ledger_settle_deferred', task_id: task.id, lease_id: lease.id, holder_id: scheduler.holder_id, via, detail: 'not the active scheduler; the active scheduler sweep settles' });
    return { enabled: true, ok: false, deferred: true, code: 'SCHEDULER_STANDBY' };
  }
  const metering = meteringBlock({ task, lease, node }) || {};
  const outcome = await ledgerSettle({
    opKey: operationKey('settle', [task.id, lease.attempt, scheduler.holder_id, scheduler.term]),
    taskId: task.id, leaseTokenHash: tokenHash, attempt: lease.attempt, metering, outputSha256: hashJson(task.output ?? {}), scheduler
  }, deps);
  deps.log({ event: 'compute_ledger_settle', via, task_id: task.id, lease_id: lease.id, attempt: lease.attempt, node_id: lease.node_id ?? node?.id ?? null, holder_id: scheduler.holder_id, term: scheduler.term, ok: outcome?.ok === true, code: outcome?.code ?? null, accepted: outcome?.accepted ?? null, charged: outcome?.charged ?? null, reason: outcome?.reason ?? null, replayed: outcome?.replayed === true, minted_micro: outcome?.minted_micro ?? null });
  return { enabled: true, ...(outcome || { ok: false, code: 'LEDGER_NO_REPLY' }) };
}

// Called by the gateway after compute_complete_lease accepted the result.
// Best-effort and after the commit: a ledger fault never undoes the result. It
// is not the only chance either: a settle that is refused, deferred or lost
// here (STALE_TERM, a deadlock, a timeout, a standby that took the node's
// call) leaves a done task with an open reservation, and the active
// scheduler's sweep (sweepContributionLedger) settles it under its own term.
export async function settleCompletion({ node, leaseId, leaseToken, result, election = null }, deps = defaultDeps()) {
  if (!ledgerIsOn(deps)) return { enabled: false };
  try {
    const lease = await deps.leaseById({ leaseId });
    const row = lease ? await deps.taskRowById({ taskId: lease.task_id }) : null;
    if (!lease || !row) throw Object.assign(new Error('lease or task not found for settle'), { code: 'LEDGER_LEASE_UNKNOWN' });
    // The stored output is what was committed; the wire result only stands in
    // if the row was read before it carried one (the SQL then refuses).
    const task = { ...row, output: row.output ?? (result && typeof result === 'object' ? result : {}) };
    return await settleAttempt({ task, lease, node, tokenHash: leaseTokenHash(leaseToken), election, via: 'complete' }, deps);
  } catch (error) {
    deps.log({ event: 'compute_ledger_settle_failed', lease_id: leaseId, node_id: node?.id ?? null, message: error.message, code: error.code || null });
    return { enabled: true, ok: false, code: error.code || 'LEDGER_SETTLE_FAILED', error: error.message };
  }
}

// The sweep's settle: everything is read back from the durable rows (the task
// and its output, the done lease and its token hash, the node), so any
// instance that holds the scheduler lease can settle a completion another
// instance received.
export async function settleDoneTask({ taskId, election = null }, deps = defaultDeps()) {
  if (!ledgerIsOn(deps)) return { enabled: false };
  try {
    const task = await deps.taskRowById({ taskId });
    if (!task) throw Object.assign(new Error('task not found for settle'), { code: 'LEDGER_TASK_UNKNOWN' });
    if (task.status !== 'done') return { enabled: true, ok: true, settled: false, reason: 'task_not_done', task_status: task.status };
    const lease = await deps.completingLeaseForSettle({ taskId });
    if (!lease?.lease_token_hash) throw Object.assign(new Error('no done lease for the task'), { code: 'LEDGER_LEASE_UNKNOWN' });
    const node = await Promise.resolve(deps.nodeById(lease.node_id)).catch(() => null);
    return await settleAttempt({ task, lease, node, tokenHash: lease.lease_token_hash, election, via: 'sweep' }, deps);
  } catch (error) {
    deps.log({ event: 'compute_ledger_settle_failed', task_id: taskId, via: 'sweep', message: error.message, code: error.code || null });
    return { enabled: true, ok: false, code: error.code || 'LEDGER_SETTLE_FAILED', error: error.message };
  }
}

// Releases a task's open reservation when the task is terminal. A retryable
// failure requeues the task and keeps the reservation for the next attempt.
export async function releaseTaskReservation({ taskId, reason = 'released', election = null, requireTerminal = true }, deps = defaultDeps()) {
  if (!ledgerIsOn(deps)) return { enabled: false };
  try {
    const task = await deps.taskRowById({ taskId });
    if (!task) throw Object.assign(new Error('task not found for release'), { code: 'LEDGER_TASK_UNKNOWN' });
    if (requireTerminal && !TERMINAL_TASK.has(task.status)) return { enabled: true, ok: true, released: false, reason: 'task_not_terminal', task_status: task.status };
    const scheduler = schedulerIdentity(election, deps.env);
    if (scheduler.configured && !scheduler.active) return { enabled: true, ok: false, released: false, deferred: true, code: 'SCHEDULER_STANDBY' };
    const outcome = await ledgerRelease({ opKey: operationKey('release', [task.id, task.status, scheduler.holder_id, scheduler.term]), taskId: task.id, reason: `${reason}:${task.status}`, scheduler }, deps);
    deps.log({ event: 'compute_ledger_release', task_id: task.id, task_status: task.status, holder_id: scheduler.holder_id, term: scheduler.term, ok: outcome?.ok === true, code: outcome?.code ?? null, released: outcome?.released === true, replayed: outcome?.replayed === true });
    return { enabled: true, ...(outcome || { ok: false, code: 'LEDGER_NO_REPLY' }) };
  } catch (error) {
    deps.log({ event: 'compute_ledger_release_failed', task_id: taskId, message: error.message, code: error.code || null });
    return { enabled: true, ok: false, code: error.code || 'LEDGER_RELEASE_FAILED', error: error.message };
  }
}

// Called by the gateway after compute_fail_lease accepted a failure.
export async function releaseAfterFailure({ leaseId, election = null }, deps = defaultDeps()) {
  if (!ledgerIsOn(deps)) return { enabled: false };
  const lease = await deps.leaseById({ leaseId }).catch(() => null);
  if (!lease) return { enabled: true, ok: false, code: 'LEDGER_LEASE_UNKNOWN' };
  return releaseTaskReservation({ taskId: lease.task_id, reason: 'failed', election }, deps);
}

// ---- The ledger sweep ---------------------------------------------------------
// What makes the settle and the release durable. The active scheduler runs it
// on an interval (startContributionSweep, started by gateway.mjs next to the
// scheduler election loop); a standby does nothing. One pass looks at every
// OPEN reservation and closes the ones whose task has moved on:
//   done               -> settle (a completion whose inline settle was refused,
//                         deferred, deadlocked or timed out, on any instance).
//                         If the settle is refused for good (LEASE_REJECTED) and
//                         the reservation has expired, it is released instead.
//   failed, canceled   -> release (a lease that expired, exhausted retries, a cancel).
//   queued and expired -> the reservation's deadline passed and no node ever
//                         completed it: the task is canceled (atomically against
//                         a claim) and the reservation released. If a node took
//                         it first, nothing happens: its settle will answer LATE.
//   queued, still held past the hold grace -> a submission whose hold was never
//                         lifted and whose client never retried: canceled and released.
//   leased, running    -> left alone; its completion or failure closes it.
// It then cancels held tasks older than the grace that never got a reservation.
export const DEFAULT_SWEEP_INTERVAL_MS = 30_000;
export const DEFAULT_HOLD_GRACE_MS = 600_000;
const UNSETTLEABLE = new Set(['LEASE_REJECTED']);

export async function sweepContributionLedger({ orgId = null, election = null, limit = 100 } = {}, deps = defaultDeps()) {
  const tally = { scanned: 0, settled: 0, released: 0, canceled: 0, errors: 0 };
  if (!ledgerIsOn(deps)) return { enabled: false, ...tally };
  const scheduler = schedulerIdentity(election, deps.env);
  if (scheduler.configured && !scheduler.active) return { enabled: true, skipped: 'standby', ...tally };
  const nowMs = Date.parse(deps.now());
  const graceMs = Math.max(60_000, Number(deps.env?.CORE_CONTRIBUTION_HOLD_GRACE_MS) || DEFAULT_HOLD_GRACE_MS);
  const rows = await deps.openReservations({ orgId, limit });
  const outcomes = [];
  const cancelAndRelease = async (row, why) => {
    const canceled = await deps.cancelQueued({ orgId: row.org_id, taskId: row.task_id, reason: `contribution ledger: ${why}` });
    if (!canceled) return { task_id: row.task_id, action: 'skip', reason: 'claimed_meanwhile' };
    tally.canceled += 1;
    const out = await releaseTaskReservation({ taskId: row.task_id, reason: why, election }, deps);
    if (out.released === true) tally.released += 1;
    return { task_id: row.task_id, action: 'cancel_release', ...out };
  };
  for (const row of rows) {
    tally.scanned += 1;
    try {
      const expired = Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) <= nowMs;
      if (row.task_status === 'done') {
        let out = await settleDoneTask({ taskId: row.task_id, election }, deps);
        if (out.ok === true && out.entries) tally.settled += 1;
        else if (expired && UNSETTLEABLE.has(out.code)) {
          out = await releaseTaskReservation({ taskId: row.task_id, reason: `unsettleable:${out.code}`, election, requireTerminal: false }, deps);
          if (out.released === true) tally.released += 1;
        }
        outcomes.push({ task_id: row.task_id, action: 'settle', ...out });
      } else if (TERMINAL_TASK.has(row.task_status)) {
        const out = await releaseTaskReservation({ taskId: row.task_id, reason: 'sweep', election }, deps);
        if (out.released === true) tally.released += 1;
        outcomes.push({ task_id: row.task_id, action: 'release', ...out });
      } else if (row.task_status === 'queued') {
        const staleHold = isLedgerHold(row.run_after) && Number.isFinite(Date.parse(row.created_at)) && Date.parse(row.created_at) <= nowMs - graceMs;
        if (expired) outcomes.push(await cancelAndRelease(row, 'reservation_expired'));
        else if (staleHold) outcomes.push(await cancelAndRelease(row, 'hold_never_lifted'));
      }
    } catch (error) {
      tally.errors += 1;
      deps.log({ event: 'compute_ledger_sweep_row_failed', task_id: row.task_id, message: error.message, code: error.code || null });
    }
  }
  // Held tasks that never got a reservation (the reserve threw and nobody retried).
  try {
    const reserved = new Set(rows.map((row) => row.task_id));
    const stale = await deps.staleHeldTasks({ orgId, olderThan: new Date(nowMs - graceMs).toISOString(), limit });
    for (const task of stale) {
      if (reserved.has(task.id)) continue;
      const canceled = await deps.cancelQueued({ orgId: task.org_id, taskId: task.id, reason: 'contribution ledger: never reserved' });
      if (canceled) { tally.canceled += 1; outcomes.push({ task_id: task.id, action: 'cancel_unreserved' }); }
    }
  } catch (error) {
    tally.errors += 1;
    deps.log({ event: 'compute_ledger_sweep_holds_failed', message: error.message, code: error.code || null });
  }
  if (tally.scanned || tally.canceled || tally.errors) deps.log({ event: 'compute_ledger_sweep', org_id: orgId, holder_id: scheduler.holder_id, term: scheduler.term, ...tally });
  return { enabled: true, ...tally, outcomes };
}

// Starts the sweep on an interval. gateway.mjs calls this right after the
// scheduler election loop starts; each pass asks the election whether this
// instance is the active scheduler (no election: the single scheduler always
// is). Passes never overlap. Returns { enabled, intervalMs, tick, stop }.
export function startContributionSweep({ election = null, orgId = null, intervalMs = null, limit = 100, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}, deps = defaultDeps()) {
  if (!ledgerIsOn(deps)) return { enabled: false, intervalMs: null, tick: async () => ({ enabled: false }), stop: () => {} };
  const configured = Number(intervalMs ?? deps.env?.CORE_CONTRIBUTION_SWEEP_MS);
  const every = Math.max(5_000, Math.min(3_600_000, Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : DEFAULT_SWEEP_INTERVAL_MS));
  let running = null;
  const tick = () => {
    if (running) return running;
    running = sweepContributionLedger({ orgId, election, limit }, deps)
      .catch((error) => { deps.log({ event: 'compute_ledger_sweep_failed', message: error.message, code: error.code || null }); return { enabled: true, ok: false, error: error.message }; })
      .finally(() => { running = null; });
    return running;
  };
  let timer = setIntervalImpl(() => { tick(); }, every);
  timer?.unref?.();
  deps.log({ event: 'compute_ledger_sweep_started', interval_ms: every, org_id: orgId, election: Boolean(election) });
  return { enabled: true, intervalMs: every, tick, stop: () => { if (timer) { clearIntervalImpl(timer); timer = null; } } };
}

export async function ledgerBalances({ accountId }, deps = defaultDeps()) {
  return ledgerBalancesRpc({ accountId }, deps);
}

export async function ledgerReceipt({ taskId }, deps = defaultDeps()) {
  return ledgerReceiptRpc({ taskId: requireJobId(taskId) }, deps);
}

async function loadJob(orgId, jobId, deps) {
  const taskId = requireJobId(jobId);
  const task = await deps.taskById({ orgId, taskId });
  if (!task || task.org_id !== orgId) throw httpError('compute job not found', 404, 'JOB_NOT_FOUND');
  const leases = await deps.leasesForTask({ taskId });
  const lease = completingLease(task, leases) || latestLease(leases);
  const nodeId = lease?.node_id || task.locked_by_node_id || null;
  const node = nodeId ? await deps.nodeById(nodeId) : null;
  return { task, leases, lease, node };
}

export async function getJob({ orgId, jobId }, deps = defaultDeps()) {
  const { task, leases, node } = await loadJob(orgId, jobId, deps);
  return jobView({ task, leases, node });
}

export async function getJobResult({ orgId, jobId }, deps = defaultDeps()) {
  const { task, leases, node } = await loadJob(orgId, jobId, deps);
  return jobResult({ task, leases, node });
}

export async function getJobReceipt({ orgId, jobId, issuer = {} }, deps = defaultDeps()) {
  const { task, leases, lease, node } = await loadJob(orgId, jobId, deps);
  const attestation = lease ? await deps.attestationForLease({ leaseId: lease.id }) : null;
  const receipt = buildReceipt({ task, leases, node, attestation, nodePublicKeyPem: node?.public_key_pem || null, issuedAt: deps.now(), issuer });
  return signReceipt(receipt, deps.receiptKey());
}

export async function listJobs({ orgId, status = null, capability = null, limit = 50 }, deps = defaultDeps()) {
  const tasks = await deps.listTasks({ orgId, status, capability, limit });
  const nodes = await deps.nodesById({ ids: tasks.map((task) => task.locked_by_node_id).filter(Boolean) });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return { schema: 'mccluster-job-list/1', org_id: orgId, count: tasks.length, jobs: tasks.map((task) => jobView({ task, leases: [], node: byId.get(task.locked_by_node_id) || null })) };
}

export function receiptKey(deps = defaultDeps()) {
  return receiptKeyInfo(deps.receiptKey());
}

// Called by the gateway after compute_complete_lease accepted the completion.
// Best-effort: a failure to record never undoes the committed result; it is
// logged and the receipt reports the attestation as absent.
export async function recordCompletionAttestation({ node, leaseId, path, headers, result }, deps = defaultDeps()) {
  try {
    const lease = await deps.leaseById({ leaseId });
    const attestation = completionAttestation({ node, leaseId, attempt: lease?.attempt ?? null, method: 'POST', path, headers, result });
    const outcome = await deps.recordAttestation({ ...attestation, task_id: lease?.task_id ?? null }, { log: (line) => deps.log(typeof line === 'string' ? JSON.parse(line) : line) });
    return { ...outcome, lease_id: leaseId };
  } catch (error) {
    deps.log({ event: 'compute_attestation_record_failed', lease_id: leaseId, node_id: node?.id ?? null, message: error.message, code: error.code || null });
    return { recorded: false, replayed: false, available: null, error: error.code || error.message };
  }
}
