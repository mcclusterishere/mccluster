import { rest } from '../supabase.mjs';

async function rpc(name, payload, restImpl = rest) {
  const { body } = await restImpl(`rpc/${name}`, { method: 'POST', body: JSON.stringify(payload) });
  return body;
}

function eq(value) { return `eq.${value}`; }

export async function nodeById(nodeId) {
  const params = new URLSearchParams({ id: eq(nodeId), select: '*', limit: '1' });
  const { body = [] } = await rest(`ops_compute_nodes?${params}`);
  return body[0] || null;
}

export async function enrollNode(node) {
  const existing = await nodeById(node.id);
  if (existing && existing.key_fingerprint !== node.key_fingerprint) {
    throw Object.assign(new Error('Node id is already bound to a different key'), { status: 409, code: 'NODE_KEY_CONFLICT' });
  }
  if (existing && existing.org_id !== node.org_id) {
    throw Object.assign(new Error('Compute node is already enrolled to a different organization'), { status: 409, code: 'NODE_ORG_CONFLICT' });
  }
  if (existing?.state === 'revoked' || existing?.revoked_at) {
    throw Object.assign(new Error('Compute node has been revoked'), { status: 403, code: 'NODE_REVOKED' });
  }
  const now = new Date().toISOString();
  const record = {
    id: node.id,
    org_id: node.org_id,
    display_name: node.display_name,
    public_key_pem: node.public_key_pem,
    key_fingerprint: node.key_fingerprint,
    protocol_version: node.protocol_version,
    agent_version: node.agent_version,
    state: existing?.state === 'draining' ? 'draining' : 'online',
    inventory: node.inventory,
    capabilities: node.capabilities,
    labels: node.labels,
    max_leases: node.max_leases,
    last_seen_at: now,
    updated_at: now
  };
  const { body = [] } = await rest('ops_compute_nodes?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(record)
  });
  return body[0] || record;
}

export async function heartbeatNode(nodeId, { inventory, capabilities, labels, load, agentVersion, maxLeases } = {}) {
  const now = new Date().toISOString();
  const patch = { last_seen_at: now, updated_at: now };
  if (inventory) patch.inventory = inventory;
  if (capabilities) patch.capabilities = capabilities;
  if (labels) patch.labels = labels;
  if (load) patch.load = load;
  if (agentVersion) patch.agent_version = agentVersion;
  if (maxLeases) patch.max_leases = maxLeases;
  const params = new URLSearchParams({ id: eq(nodeId), state: 'not.in.(revoked,quarantined)' });
  const { body = [] } = await rest(`ops_compute_nodes?${params}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!body.length) throw Object.assign(new Error('Compute node cannot heartbeat'), { status: 403, code: 'NODE_UNAVAILABLE' });
  return body[0];
}

export async function acceptNonce(nodeId, nonce, expiresAt) {
  return Boolean(await rpc('compute_accept_nonce', {
    p_node_id: nodeId,
    p_nonce: nonce,
    p_expires_at: expiresAt
  }));
}

// p_yield_seconds exists only once the pending compute_claim_task_yield_v3
// SQL is promoted. Until then PostgREST answers 404 PGRST202 for the 5-argument
// call; the parameter is then dropped for the life of the process (logged
// once) and the claim is retried as the plain 4-argument call.
let yieldUnsupported = false;

function yieldParameterUnknown(error) {
  if (Number(error?.status) !== 404) return false;
  return error?.detail?.code === 'PGRST202' || /p_yield_seconds|Could not find the function/i.test(String(error?.message || ''));
}

export async function claimLease(nodeId, { capabilities, implementations, leaseSeconds = 120, yieldSeconds = 0 } = {}, { restImpl = rest } = {}) {
  const payload = {
    p_node_id: nodeId,
    p_capabilities: capabilities || [],
    p_implementations: implementations || [],
    p_lease_seconds: leaseSeconds
  };
  const yieldValue = Math.floor(Number(yieldSeconds) || 0);
  if (yieldValue <= 0 || yieldUnsupported) return rpc('compute_claim_task', payload, restImpl);
  try {
    return await rpc('compute_claim_task', { ...payload, p_yield_seconds: yieldValue }, restImpl);
  } catch (error) {
    if (!yieldParameterUnknown(error)) throw error;
    yieldUnsupported = true;
    console.log(JSON.stringify({ event: 'compute_claim_yield_unsupported', detail: 'compute_claim_task has no p_yield_seconds (compute_claim_task_yield_v3 is pending); claiming without it' }));
    return rpc('compute_claim_task', payload, restImpl);
  }
}

// Cancel a task that is still queued, atomically against the claim: the
// scheduler selects status='queued' FOR UPDATE SKIP LOCKED, so this
// conditional update and a claim cannot both win. Null means a node already
// holds the task and the caller must not run it anywhere else.
export async function cancelQueuedComputeTask({ orgId, taskId, reason = 'canceled' } = {}, { restImpl = rest } = {}) {
  if (!orgId || !taskId) return null;
  const params = new URLSearchParams({ id: eq(taskId), org_id: eq(orgId), status: 'eq.queued' });
  const { body = [] } = await restImpl(`ops_compute_tasks?${params}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'canceled', last_error: String(reason).slice(0, 4000), updated_at: new Date().toISOString() })
  });
  return Array.isArray(body) && body.length ? body[0] : null;
}

// True when the owner asked to cancel a task a node holds: the cancel RPC
// stamps metadata.cancel_requested_at (production_request_compute_cancel).
export async function taskCancelRequested(taskId, { restImpl = rest } = {}) {
  if (!taskId) return false;
  const params = new URLSearchParams({ id: eq(taskId), select: 'status,metadata', limit: '1' });
  const { body = [] } = await restImpl(`ops_compute_tasks?${params}`);
  const row = Array.isArray(body) ? body[0] : null;
  return Boolean(row && ['leased', 'running'].includes(row.status) && row.metadata?.cancel_requested_at);
}

export async function startLease(nodeId, leaseId, leaseToken, extendSeconds = 120) {
  return rpc('compute_start_lease', {
    p_node_id: nodeId,
    p_lease_id: leaseId,
    p_lease_token: leaseToken,
    p_extend_seconds: extendSeconds
  });
}

export async function heartbeatLease(nodeId, leaseId, leaseToken, progress = {}, extendSeconds = 120) {
  return rpc('compute_heartbeat_lease', {
    p_node_id: nodeId,
    p_lease_id: leaseId,
    p_lease_token: leaseToken,
    p_progress: progress,
    p_extend_seconds: extendSeconds
  });
}

export async function completeLease(nodeId, leaseId, leaseToken, result = {}) {
  return Boolean(await rpc('compute_complete_lease', {
    p_node_id: nodeId,
    p_lease_id: leaseId,
    p_lease_token: leaseToken,
    p_result: result
  }));
}

export async function failLease(nodeId, leaseId, leaseToken, error, retry = true) {
  return Boolean(await rpc('compute_fail_lease', {
    p_node_id: nodeId,
    p_lease_id: leaseId,
    p_lease_token: leaseToken,
    p_error: String(error || 'compute node failure').slice(0, 4000),
    p_retry: Boolean(retry)
  }));
}

export async function enqueueComputeTask({ orgId, capability, implementation = null, input = {}, requirements = {}, priority = 0, runAfter = null, maxAttempts = 3, metadata = {}, idempotencyKey = null }) {
  const result = await rpc('compute_enqueue_task', {
    p_org_id: orgId,
    p_capability: capability,
    p_implementation: implementation,
    p_input: input,
    p_requirements: requirements,
    p_priority: Number(priority || 0),
    p_run_after: runAfter || null,
    p_max_attempts: Math.max(1, Math.min(100, Number(maxAttempts || 3))),
    p_metadata: metadata,
    p_idempotency_key: idempotencyKey
  });
  if (result?.conflict) {
    throw Object.assign(new Error('Idempotency-Key was already used for a different compute task request'), {
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT'
    });
  }
  return { task: result?.task || null, replayed: Boolean(result?.replayed) };
}

export async function computeTaskById({ orgId, taskId } = {}) {
  if (!orgId || !taskId) return null;
  const params = new URLSearchParams({
    id: eq(taskId),
    org_id: eq(orgId),
    select: 'id,org_id,capability,implementation,input,requirements,priority,status,run_after,attempts,max_attempts,locked_by_node_id,locked_at,output,last_error,metadata,created_at,updated_at',
    limit: '1'
  });
  const { body = [] } = await rest(`ops_compute_tasks?${params}`);
  return body[0] || null;
}

export async function listNodes(options = {}) {
  const normalized = typeof options === 'string' ? { orgId: options } : (options || {});
  const { orgId, liveOnly = false, limit = 100 } = normalized;
  const params = new URLSearchParams({
    select: 'id,org_id,display_name,key_fingerprint,protocol_version,agent_version,state,inventory,capabilities,labels,load,max_leases,enrolled_at,last_seen_at,revoked_at,updated_at',
    order: 'last_seen_at.desc',
    limit: String(Math.min(500, Math.max(1, Number(limit) || 100)))
  });
  if (orgId) params.set('org_id', eq(orgId));
  if (liveOnly) {
    params.set('state', 'eq.online');
    params.set('last_seen_at', `gte.${new Date(Date.now() - 180_000).toISOString()}`);
  }
  const { body = [] } = await rest(`ops_compute_nodes?${params}`);
  return body;
}

export async function liveCapabilityImplementations({ orgId } = {}) {
  const nodes = await listNodes({ orgId, liveOnly: true, limit: 500 });
  const implementations = [];
  for (const node of nodes) {
    for (const entry of Array.isArray(node.capabilities) ? node.capabilities : []) {
      implementations.push({
        node_id: node.id,
        node_name: node.display_name,
        capability: entry.capability,
        implementation: entry.implementation,
        backend: entry.backend,
        model: entry.model,
        version: entry.version,
        features: entry.features || {},
        input_schema: entry.input_schema || { type: 'object' },
        output_schema: entry.output_schema || { type: 'object' },
        max_concurrency: entry.max_concurrency || 1,
        min_vram_bytes: entry.min_vram_bytes ?? null,
        hosting: 'self-hosted',
        billing: 'compute',
        labels: node.labels || {},
        inventory: node.inventory || {},
        load: node.load || {},
        last_seen_at: node.last_seen_at
      });
    }
  }
  return implementations;
}
