import crypto from 'node:crypto';
import { enqueueComputeTask, liveCapabilityImplementations } from '../compute/store.mjs';
import { HARDWARE_MODE_RANK } from '../compute/protocol.mjs';

const ROUTING_KEYS = new Set(['provider', 'transport', 'hosting', 'billing']);

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function mergeFeatures(entries) {
  const merged = {};
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.features || {})) {
      if (value === true) merged[key] = true;
      else if (merged[key] === undefined) merged[key] = value;
      else if (Array.isArray(value) && Array.isArray(merged[key])) {
        merged[key] = [...new Set([...merged[key], ...value])];
      }
    }
  }
  return merged;
}

function computeRequirements(requirements = {}) {
  const features = {};
  for (const [key, value] of Object.entries(requirements || {})) {
    if (ROUTING_KEYS.has(key) || value === undefined || value === null || value === false) continue;
    features[key] = value;
  }
  return Object.keys(features).length ? { features } : {};
}

function hardwareModeOf(entry) {
  const mode = entry?.inventory?.runtime?.hardware_mode;
  return typeof mode === 'string' && Object.hasOwn(HARDWARE_MODE_RANK, mode) ? mode : 'unknown';
}

// The node's measured generation rate for exactly this entry's model: the
// doctor's sidecar map first, else the node's best measurement when it is
// this model. Never a guess from another model.
function generationRateOf(entry) {
  const runtime = entry?.inventory?.runtime;
  const byModel = runtime?.measured_inference_by_model?.[entry?.model]?.generation_tokens_per_second;
  const value = byModel ?? (runtime?.measured_inference?.model === entry?.model ? runtime.measured_inference.generation_tokens_per_second : null);
  const n = Number(value);
  return value != null && Number.isFinite(n) && n >= 0 ? n : null;
}

// Evidence the registry ranks on: the best hardware_mode among the live nodes
// of one (capability, implementation) group, the fastest measured generation
// for the entry model, and the per-node detail.
function bindingEvidence(entries) {
  const nodes = entries.map((entry) => ({
    node_id: entry.node_id,
    node_name: entry.node_name,
    hardware_mode: hardwareModeOf(entry),
    generation_tokens_per_second: generationRateOf(entry)
  }));
  const best = nodes.reduce((mode, node) => (HARDWARE_MODE_RANK[node.hardware_mode] > HARDWARE_MODE_RANK[mode] ? node.hardware_mode : mode), 'unknown');
  const rates = nodes.map((node) => node.generation_tokens_per_second).filter((rate) => rate != null);
  return {
    hardware_mode: best,
    hardware_mode_rank: HARDWARE_MODE_RANK[best],
    generation_tokens_per_second: rates.length ? Math.max(...rates) : null,
    live_nodes: nodes.length,
    nodes
  };
}

export function normalizeComputeEnqueueResult(result) {
  const task = result?.task || null;
  if (!task) {
    throw Object.assign(new Error('Failed to enqueue compute task'), {
      status: 503,
      code: 'COMPUTE_ENQUEUE_FAILED'
    });
  }
  return { task, replayed: Boolean(result?.replayed) };
}

export async function discoverComputeTools({ live = liveCapabilityImplementations, env = process.env } = {}) {
  const orgId = env.MCCLUSTER_ORG_ID;
  if (!orgId || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      tools: [],
      diagnostic: { id: 'mccluster-compute', transport: 'compute', ok: false, reason: 'control_plane_not_configured' }
    };
  }

  const implementations = await live({ orgId });
  const grouped = new Map();
  for (const item of implementations) {
    const key = `${item.capability}\u0000${item.implementation}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  const tools = [];
  for (const entries of grouped.values()) {
    const first = entries[0];
    const idHash = hash(`${first.capability}:${first.implementation}`);
    const toolName = `compute.${first.capability}.${idHash}`;
    const bindingId = `compute.${first.capability}.${idHash}`;
    const features = mergeFeatures(entries);
    const evidence = bindingEvidence(entries);
    tools.push({
      name: toolName,
      title: `Self-hosted ${first.capability}: ${first.implementation}`,
      description: `Queue ${first.capability} on McCluster-owned/self-hosted compute using ${first.implementation}.`,
      inputSchema: first.input_schema || { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          task: { type: 'object' },
          replayed: { type: 'boolean' }
        },
        required: ['task', 'replayed']
      },
      transport: 'compute',
      capabilityBinding: {
        id: bindingId,
        capability: first.capability,
        provider: 'mccluster-compute',
        transport: 'compute',
        status: 'active',
        priority: 100,
        economics: { hosting: 'self-hosted', billing: 'compute' },
        features,
        evidence
      },
      target: {
        orgId,
        capability: first.capability,
        implementation: first.implementation,
        nodes: entries.map((entry) => entry.node_id),
        maxConcurrency: entries.reduce((sum, entry) => sum + Number(entry.max_concurrency || 1), 0),
        evidence
      }
    });
  }

  return {
    tools,
    diagnostic: {
      id: 'mccluster-compute',
      transport: 'compute',
      ok: true,
      tools: tools.length,
      live_nodes: new Set(implementations.map((item) => item.node_id)).size,
      implementations: implementations.length
    }
  };
}

// The discovery snapshot can be up to CORE_TOOL_CACHE_TTL_MS old, so the live
// nodes are re-read before a task is pinned to an implementation. No live node
// is a fallback code (the registry tries the next binding); a failed read is not.
export async function callComputeTool(target, args = {}, options = {}, { enqueue = enqueueComputeTask, live = liveCapabilityImplementations } = {}) {
  const fresh = (await live({ orgId: target.orgId }))
    .filter((item) => item.capability === target.capability && item.implementation === target.implementation);
  if (!fresh.length) {
    throw Object.assign(new Error(`No live compute node serves ${target.capability}/${target.implementation}`), {
      status: 503,
      code: 'COMPUTE_NO_LIVE_NODE',
      retryable: true
    });
  }
  const result = await enqueue({
    orgId: target.orgId,
    capability: target.capability,
    implementation: target.implementation,
    input: args,
    requirements: computeRequirements(options.requirements || {}),
    priority: Number(options.priority || 0),
    maxAttempts: Number(options.maxAttempts || 3),
    idempotencyKey: options.idempotencyKey || null,
    metadata: {
      source: options.source || 'mccluster-tool-bus',
      requested_at: new Date().toISOString(),
      advertised_nodes_at_submit: fresh.map((item) => item.node_id),
      advertised_concurrency_at_submit: fresh.reduce((sum, item) => sum + Number(item.max_concurrency || 1), 0)
    }
  });
  return normalizeComputeEnqueueResult(result);
}
