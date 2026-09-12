export const COMPUTE_PROTOCOL = 'mccluster-compute/1';
export const SIGNATURE_ALGORITHM = 'ed25519';
export const DEFAULT_LEASE_SECONDS = 120;
export const DEFAULT_HEARTBEAT_SECONDS = 30;
export const DEFAULT_CLOCK_SKEW_MS = 5 * 60_000;

const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const IMPLEMENTATION_ID = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/;
const NODE_ID = /^node_[a-f0-9]{24,64}$/;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function finite(value, label, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return n;
}

export function validateCapabilityManifest(input) {
  if (!Array.isArray(input)) throw new Error('capabilities must be an array');
  const seen = new Set();
  return input.map((raw, index) => {
    const item = object(raw, `capabilities[${index}]`);
    if (!CAPABILITY_ID.test(item.capability || '')) throw new Error(`Invalid capability id: ${item.capability || ''}`);
    if (!IMPLEMENTATION_ID.test(item.implementation || '')) throw new Error(`Invalid implementation id: ${item.implementation || ''}`);
    const key = `${item.capability}:${item.implementation}`;
    if (seen.has(key)) throw new Error(`Duplicate capability implementation: ${key}`);
    seen.add(key);
    const concurrency = Math.floor(finite(item.max_concurrency ?? 1, `${key}.max_concurrency`, { min: 1, max: 64 }));
    const vram = item.min_vram_bytes == null ? null : Math.floor(finite(item.min_vram_bytes, `${key}.min_vram_bytes`, { min: 0 }));
    return {
      capability: item.capability,
      implementation: item.implementation,
      backend: String(item.backend || 'native').slice(0, 120),
      model: item.model == null ? null : String(item.model).slice(0, 200),
      version: item.version == null ? null : String(item.version).slice(0, 120),
      features: object(item.features || {}, `${key}.features`),
      input_schema: object(item.input_schema || { type: 'object' }, `${key}.input_schema`),
      output_schema: object(item.output_schema || { type: 'object' }, `${key}.output_schema`),
      max_concurrency: concurrency,
      min_vram_bytes: vram,
      hosting: 'self-hosted',
      billing: 'compute'
    };
  });
}

export function validateInventory(input) {
  const inventory = object(input || {}, 'inventory');
  const gpus = Array.isArray(inventory.gpus) ? inventory.gpus.map((gpu, i) => {
    const value = object(gpu, `inventory.gpus[${i}]`);
    return {
      vendor: String(value.vendor || 'unknown').slice(0, 80),
      model: String(value.model || 'unknown').slice(0, 160),
      uuid: value.uuid == null ? null : String(value.uuid).slice(0, 160),
      vram_bytes: Math.floor(finite(value.vram_bytes ?? 0, `inventory.gpus[${i}].vram_bytes`, { min: 0 })),
      driver: value.driver == null ? null : String(value.driver).slice(0, 120),
      compute: value.compute == null ? null : String(value.compute).slice(0, 120)
    };
  }) : [];
  return {
    hostname: inventory.hostname == null ? null : String(inventory.hostname).slice(0, 255),
    platform: inventory.platform == null ? null : String(inventory.platform).slice(0, 80),
    arch: inventory.arch == null ? null : String(inventory.arch).slice(0, 80),
    cpu_count: Math.floor(finite(inventory.cpu_count ?? 0, 'inventory.cpu_count', { min: 0, max: 4096 })),
    memory_bytes: Math.floor(finite(inventory.memory_bytes ?? 0, 'inventory.memory_bytes', { min: 0 })),
    disk_free_bytes: Math.floor(finite(inventory.disk_free_bytes ?? 0, 'inventory.disk_free_bytes', { min: 0 })),
    gpus,
    runtime: object(inventory.runtime || {}, 'inventory.runtime')
  };
}

export function validateEnrollment(body) {
  const value = object(body, 'enrollment');
  if (value.protocol !== COMPUTE_PROTOCOL) throw new Error(`Unsupported compute protocol: ${value.protocol || ''}`);
  if (typeof value.public_key !== 'string' || !value.public_key.includes('BEGIN PUBLIC KEY')) throw new Error('public_key must be a PEM public key');
  if (!value.org_id || typeof value.org_id !== 'string') throw new Error('org_id is required');
  return {
    protocol: COMPUTE_PROTOCOL,
    org_id: value.org_id,
    display_name: String(value.display_name || 'unnamed compute node').slice(0, 160),
    public_key: value.public_key,
    agent_version: String(value.agent_version || 'unknown').slice(0, 80),
    inventory: validateInventory(value.inventory || {}),
    capabilities: validateCapabilityManifest(value.capabilities || []),
    labels: object(value.labels || {}, 'labels'),
    max_leases: Math.floor(finite(value.max_leases ?? 1, 'max_leases', { min: 1, max: 64 }))
  };
}

export function validateNodeId(value) {
  if (!NODE_ID.test(value || '')) throw new Error('Invalid compute node id');
  return value;
}

export function validateLoad(input = {}) {
  const load = object(input, 'load');
  return {
    running_leases: Math.floor(finite(load.running_leases ?? 0, 'load.running_leases', { min: 0, max: 1024 })),
    gpu: Array.isArray(load.gpu) ? load.gpu.slice(0, 64) : [],
    memory_free_bytes: load.memory_free_bytes == null ? null : Math.floor(finite(load.memory_free_bytes, 'load.memory_free_bytes', { min: 0 })),
    disk_free_bytes: load.disk_free_bytes == null ? null : Math.floor(finite(load.disk_free_bytes, 'load.disk_free_bytes', { min: 0 }))
  };
}

export function capabilityIds(manifest) {
  return [...new Set(validateCapabilityManifest(manifest).map((item) => item.capability))];
}
