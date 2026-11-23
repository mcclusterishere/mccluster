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
