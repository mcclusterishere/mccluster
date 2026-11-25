// Reads and writes the device job contract needs beyond store.mjs. Every call
// goes through the same service-role REST client; nothing here is a second
// data plane. The attestation table is pending SQL
// (supabase/pending/compute_job_attestations_v1.sql): until it is promoted the
// writes degrade to "not recorded" (logged once) and receipts say so.
import { rest } from '../supabase.mjs';

const LEASE_SELECT = 'id,task_id,node_id,implementation,attempt,status,expires_at,started_at,completed_at,progress,result,last_error,created_at,updated_at';
const TASK_SELECT = 'id,org_id,capability,implementation,input,requirements,priority,status,run_after,attempts,max_attempts,locked_by_node_id,locked_at,output,last_error,metadata,created_at,updated_at';
const NODE_SELECT = 'id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,state,inventory,capabilities,labels,load,max_leases,enrolled_at,last_seen_at,revoked_at,updated_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let attestationsUnavailableLogged = false;

function tableMissing(error) {
  return Number(error?.status) === 404 && (error?.detail?.code === 'PGRST205' || /ops_compute_attestations/i.test(String(error?.message || '')));
}

export async function leasesForTask({ taskId } = {}, { restImpl = rest } = {}) {
  if (!UUID.test(taskId || '')) return [];
  const params = new URLSearchParams({ task_id: `eq.${taskId}`, select: LEASE_SELECT, order: 'created_at.desc', limit: '100' });
  const { body = [] } = await restImpl(`ops_compute_leases?${params}`);
  return Array.isArray(body) ? body : [];
}

export async function leaseById({ leaseId } = {}, { restImpl = rest } = {}) {
  if (!UUID.test(leaseId || '')) return null;
  const params = new URLSearchParams({ id: `eq.${leaseId}`, select: LEASE_SELECT, limit: '1' });
  const { body = [] } = await restImpl(`ops_compute_leases?${params}`);
  return body[0] || null;
}

// One task by id without an org filter: the completion and failure paths know
// the lease, not the org, and only read capability, implementation and status.
export async function taskRowById({ taskId } = {}, { restImpl = rest } = {}) {
  if (!UUID.test(taskId || '')) return null;
  const params = new URLSearchParams({ id: `eq.${taskId}`, select: TASK_SELECT, limit: '1' });
  const { body = [] } = await restImpl(`ops_compute_tasks?${params}`);
  return body[0] || null;
}

// ---- Contribution ledger reads (pending SQL compute_contribution_ledger_v1) --
// A ledger-on submission is enqueued HELD: run_after is this sentinel, which no
// claim reaches (compute_claim_task takes run_after <= now()), until the
// reservation exists and the hold is lifted. The sentinel is a constant so the
// enqueue's idempotency hash is the same on a retry.
export const LEDGER_HOLD_RUN_AFTER = '9999-12-31T00:00:00.000Z';

export function isLedgerHold(runAfter) {
  return Number.isFinite(Date.parse(runAfter)) && Date.parse(runAfter) === Date.parse(LEDGER_HOLD_RUN_AFTER);
}

function reservationsMissing(error) {
  return Number(error?.status) === 404 && (error?.detail?.code === 'PGRST205' || /ops_compute_spend_reservations/i.test(String(error?.message || '')));
}

// Every open spend reservation with its task's state: the ledger sweep's
// input (a done task to settle, a failed or canceled one to release, a queued
// one that is still held or has outlived its reservation). Oldest first.
// Degrades to an empty list while the ledger SQL is not promoted.
export async function openReservations({ orgId = null, limit = 100, after = null, asOf = null } = {}, { restImpl = rest } = {}) {
  const params = new URLSearchParams({
    status: 'eq.open',
    select: 'reservation_id::text,task_id,account_id,max_units_micro,created_at,expires_at,ops_compute_tasks!inner(id,org_id,status,run_after,metadata)',
    order: 'reservation_id.asc',
    limit: String(Math.min(500, Math.max(1, Number(limit) || 100)))
  });
  if (after !== null) params.set('reservation_id', `gt.${after}`);
  if (asOf) params.set('created_at', `lte.${asOf}`);
  if (orgId) params.set('ops_compute_tasks.org_id', `eq.${orgId}`);
  try {
    const { body = [] } = await restImpl(`ops_compute_spend_reservations?${params}`);
    return (Array.isArray(body) ? body : []).map((row) => ({
      reservation_id: row.reservation_id, task_id: row.task_id, account_id: row.account_id, max_units_micro: row.max_units_micro,
      created_at: row.created_at ?? null, expires_at: row.expires_at ?? null, task_status: row.ops_compute_tasks?.status ?? null, org_id: row.ops_compute_tasks?.org_id ?? null,
      run_after: row.ops_compute_tasks?.run_after ?? null, metadata: row.ops_compute_tasks?.metadata ?? null
    }));
  } catch (error) {
    if (reservationsMissing(error)) return [];
    throw error;
  }
}

// The task's reservation row, or null (none, or the ledger SQL is not promoted).
export async function reservationForTask({ taskId } = {}, { restImpl = rest } = {}) {
  if (!UUID.test(taskId || '')) return null;
  const params = new URLSearchParams({ task_id: `eq.${taskId}`, select: 'reservation_id,task_id,account_id,max_units_micro,model_class,unit_version,status,expires_at', limit: '1' });
  try {
    const { body = [] } = await restImpl(`ops_compute_spend_reservations?${params}`);
    return body[0] || null;
  } catch (error) {
    if (reservationsMissing(error)) return null;
    throw error;
  }
}

// The done lease of a done task with the token hash the settle is fenced on.
// The hash never leaves the Core: it goes straight into compute_ledger_settle.
export async function completingLeaseForSettle({ taskId } = {}, { restImpl = rest } = {}) {
  if (!UUID.test(taskId || '')) return null;
  const params = new URLSearchParams({ task_id: `eq.${taskId}`, status: 'eq.done', select: `${LEASE_SELECT},lease_token_hash`, order: 'attempt.desc', limit: '1' });
  const { body = [] } = await restImpl(`ops_compute_leases?${params}`);
  return body[0] || null;
}

// Lifts the ledger hold: the task becomes claimable at the submitter's own
// run_after (or now). Conditional on the task still being queued and held, so
// a replay or the sweep can repeat it; null when there was nothing to lift.
export async function activateHeldTask({ orgId, taskId, runAfter = null } = {}, { restImpl = rest, now = () => new Date().toISOString() } = {}) {
  if (!orgId || !UUID.test(taskId || '')) return null;
  const params = new URLSearchParams({ id: `eq.${taskId}`, org_id: `eq.${orgId}`, status: 'eq.queued', run_after: `eq.${LEDGER_HOLD_RUN_AFTER}`, select: TASK_SELECT });
  const stamp = now();
  const { body = [] } = await restImpl(`ops_compute_tasks?${params}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ run_after: runAfter || stamp, updated_at: stamp })
  });
  return Array.isArray(body) && body.length ? body[0] : null;
}

// Held device jobs older than the cutoff: a submission whose reserve never
// landed and whose client never retried. The sweep cancels the ones that have
// no open reservation.
export async function staleHeldTasks({ orgId = null, olderThan, limit = 100, after = null } = {}, { restImpl = rest } = {}) {
  if (!olderThan) return [];
  const params = new URLSearchParams({ status: 'eq.queued', run_after: `eq.${LEDGER_HOLD_RUN_AFTER}`, created_at: `lt.${olderThan}`, select: 'id,org_id,status,run_after,created_at', order: 'id.asc', limit: String(Math.min(500, Math.max(1, Number(limit) || 100))) });
  if (after !== null) params.set('id', `gt.${after}`);
  // Only tasks the ledger path enqueued (they carry metadata.contribution).
  params.set('metadata->contribution', 'not.is.null');
  if (orgId) params.set('org_id', `eq.${orgId}`);
  const { body = [] } = await restImpl(`ops_compute_tasks?${params}`);
  return Array.isArray(body) ? body : [];
}

export async function listComputeTasks({ orgId, status = null, capability = null, limit = 50 } = {}, { restImpl = rest } = {}) {
  if (!orgId) return [];
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, select: TASK_SELECT, order: 'created_at.desc', limit: String(Math.min(200, Math.max(1, Number(limit) || 50))) });
  if (status) params.set('status', `in.(${String(status).split(',').map((s) => s.trim()).filter(Boolean).join(',')})`);
  if (capability) params.set('capability', `eq.${capability}`);
  const { body = [] } = await restImpl(`ops_compute_tasks?${params}`);
  return Array.isArray(body) ? body : [];
}

export async function nodesById({ ids = [] } = {}, { restImpl = rest } = {}) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return [];
  const params = new URLSearchParams({ id: `in.(${list.join(',')})`, select: NODE_SELECT, limit: String(list.length) });
  const { body = [] } = await restImpl(`ops_compute_nodes?${params}`);
  return Array.isArray(body) ? body : [];
}

// First write wins: a replayed completion (same lease, same payload) is
// accepted by the SQL fence and must not overwrite the recorded attestation.
export async function recordAttestation(attestation, { restImpl = rest, log = console.log } = {}) {
  const row = {
    lease_id: attestation.lease_id,
    task_id: attestation.task_id,
    node_id: attestation.node_id,
    attempt: attestation.attempt,
    protocol: attestation.protocol,
    method: attestation.method,
    path: attestation.path,
    signed_at: attestation.signed_at,
    nonce: attestation.nonce,
    body_digest: attestation.body_digest,
    signature: attestation.signature,
    result_sha256: attestation.result_sha256
  };
  try {
    const { body = [] } = await restImpl('ops_compute_attestations?on_conflict=lease_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(row)
    });
    return { recorded: Array.isArray(body) && body.length > 0, replayed: Array.isArray(body) && body.length === 0, available: true };
  } catch (error) {
    if (!tableMissing(error)) throw error;
    if (!attestationsUnavailableLogged) {
      attestationsUnavailableLogged = true;
      log(JSON.stringify({ event: 'compute_attestation_store_unavailable', detail: 'ops_compute_attestations is not promoted (supabase/pending/compute_job_attestations_v1.sql); completion attestations are not recorded' }));
    }
    return { recorded: false, replayed: false, available: false };
  }
}

export async function attestationForLease({ leaseId } = {}, { restImpl = rest } = {}) {
  if (!UUID.test(leaseId || '')) return null;
  try {
    const params = new URLSearchParams({ lease_id: `eq.${leaseId}`, select: '*', limit: '1' });
    const { body = [] } = await restImpl(`ops_compute_attestations?${params}`);
    const row = body[0] || null;
    return row ? { schema: 'mccluster-completion-attestation/1', ...row } : null;
  } catch (error) {
    if (tableMissing(error)) return null;
    throw error;
  }
}
