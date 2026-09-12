import { rest } from '../supabase.mjs';

async function rpc(name, payload) {
  const { body } = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(payload) });
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

export async function claimLease(nodeId, { capabilities, implementations, leaseSeconds = 120 } = {}) {
  return rpc('compute_claim_task', {
    p_node_id: nodeId,
    p_capabilities: capabilities || [],
    p_implementations: implementations || [],
    p_lease_seconds: leaseSeconds
  });
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

export async function enqueueComputeTask({ orgId, capability, implementation = null, input = {}, requirements = {}, priority = 0, runAfter, maxAttempts = 3, metadata = {} }) {
  const body = {
    org_id: orgId,
    capability,
    implementation,
    input,
    requirements,
    priority: Number(priority || 0),
    run_after: runAfter || new Date().toISOString(),
    max_attempts: Math.max(1, Math.min(100, Number(maxAttempts || 3))),
    metadata
  };
  const { body: rows = [] } = await rest('ops_compute_tasks', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  return rows[0] || null;
}

export async function listNodes({ orgId, liveOnly = false, limit = 100 } = {}) {
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
