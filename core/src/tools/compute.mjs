import crypto from 'node:crypto';
import { enqueueComputeTask, liveCapabilityImplementations } from '../compute/store.mjs';

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

export async function discoverComputeTools() {
  const orgId = process.env.MCCLUSTER_ORG_ID;
  if (!orgId || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      tools: [],
      diagnostic: { id: 'mccluster-compute', transport: 'compute', ok: false, reason: 'control_plane_not_configured' }
    };
  }

  const implementations = await liveCapabilityImplementations({ orgId });
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
    tools.push({
      name: toolName,
      title: `Self-hosted ${first.capability}: ${first.implementation}`,
      description: `Queue ${first.capability} on McCluster-owned/self-hosted compute using ${first.implementation}.`,
      inputSchema: first.input_schema || { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          task: { type: 'object' }
        }
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
        features
      },
      target: {
        orgId,
        capability: first.capability,
        implementation: first.implementation,
        nodes: entries.map((entry) => entry.node_id),
        maxConcurrency: entries.reduce((sum, entry) => sum + Number(entry.max_concurrency || 1), 0)
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

export async function callComputeTool(target, args = {}, options = {}) {
  const task = await enqueueComputeTask({
    orgId: target.orgId,
    capability: target.capability,
    implementation: target.implementation,
    input: args,
    requirements: computeRequirements(options.requirements || {}),
    priority: Number(options.priority || 0),
    maxAttempts: Number(options.maxAttempts || 3),
    metadata: {
      source: options.source || 'mccluster-tool-bus',
      requested_at: new Date().toISOString(),
      advertised_nodes_at_submit: target.nodes,
      advertised_concurrency_at_submit: target.maxConcurrency
    }
  });
  if (!task) throw Object.assign(new Error('Failed to enqueue compute task'), { status: 503, code: 'COMPUTE_ENQUEUE_FAILED' });
  return { task };
}
