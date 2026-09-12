import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG = path.resolve(HERE, '../../capabilities/catalog.json');

function parseJsonEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) { throw new Error(`${name} is not valid JSON: ${error.message}`); }
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`);
  return parsed;
}

function readCatalog(file = DEFAULT_CATALOG) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.capabilities) || !Array.isArray(parsed.bindings)) {
    throw new Error('Capability catalog must contain capabilities[] and bindings[]');
  }
  return parsed;
}

function normalizeCapability(value) {
  if (!value?.id || !ID.test(value.id)) throw new Error(`Invalid capability id: ${value?.id || ''}`);
  if (!['active', 'planned', 'deprecated'].includes(value.lifecycle)) {
    throw new Error(`Invalid lifecycle for capability ${value.id}`);
  }
  if (!['sync', 'async', 'either'].includes(value.execution)) {
    throw new Error(`Invalid execution mode for capability ${value.id}`);
  }
  if (!['read', 'write', 'spend', 'deploy', 'destructive'].includes(value.risk)) {
    throw new Error(`Invalid risk class for capability ${value.id}`);
  }
  return {
    description: '',
    interfaces: ['http', 'mcp', 'agent'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    tags: [],
    ...value
  };
}

function normalizeBinding(value, capabilities) {
  if (!value?.id || !ID.test(value.id)) throw new Error(`Invalid binding id: ${value?.id || ''}`);
  if (!value?.capability || !capabilities.has(value.capability)) {
    throw new Error(`Binding ${value.id} references unknown capability ${value?.capability || ''}`);
  }
  if (!value?.tool) throw new Error(`Binding ${value.id} has no tool`);
  if (!['active', 'disabled', 'candidate'].includes(value.status || 'active')) {
    throw new Error(`Invalid status for binding ${value.id}`);
  }
  return {
    provider: 'unknown',
    transport: 'tool',
    status: 'active',
    priority: 0,
    features: {},
    ...value,
    priority: Number(value.priority || 0)
  };
}

function featureMatch(binding, requirements = {}) {
  for (const [key, wanted] of Object.entries(requirements || {})) {
    if (wanted === undefined || wanted === null || wanted === false) continue;
    if (key === 'provider') {
      if (binding.provider !== wanted) return false;
      continue;
    }
    if (key === 'transport') {
      if (binding.transport !== wanted) return false;
      continue;
    }
    const actual = binding.features?.[key];
    if (Array.isArray(wanted)) {
      if (!Array.isArray(actual) || !wanted.every((item) => actual.includes(item))) return false;
    } else if (wanted === true) {
      if (actual !== true) return false;
    } else if (actual !== wanted) {
      return false;
    }
  }
  return true;
}

function publicBinding(binding, available) {
  return {
    id: binding.id,
    provider: binding.provider,
    tool: binding.tool,
    transport: binding.transport,
    status: binding.status,
    priority: binding.priority,
    features: binding.features || {},
    available
  };
}

export class CapabilityRegistry {
  constructor({ toolRegistry, catalog, catalogPath } = {}) {
    if (!toolRegistry) throw new Error('CapabilityRegistry requires toolRegistry');
    this.toolRegistry = toolRegistry;
    const base = catalog || readCatalog(catalogPath);
    const extraCapabilities = parseJsonEnv('CORE_CAPABILITIES_JSON');
    const extraBindings = parseJsonEnv('CORE_CAPABILITY_BINDINGS_JSON');

    this.schemaVersion = base.schemaVersion || '1.0';
    this.catalogVersion = base.catalogVersion || 'unknown';
    this.capabilities = new Map();

    for (const raw of [...base.capabilities, ...extraCapabilities]) {
      const capability = normalizeCapability(raw);
      if (this.capabilities.has(capability.id)) throw new Error(`Duplicate capability id: ${capability.id}`);
      this.capabilities.set(capability.id, capability);
    }

    this.bindings = [...base.bindings, ...extraBindings].map((raw) => normalizeBinding(raw, this.capabilities));
    const ids = new Set();
    for (const binding of this.bindings) {
      if (ids.has(binding.id)) throw new Error(`Duplicate binding id: ${binding.id}`);
      ids.add(binding.id);
    }
  }

  has(id) {
    return this.capabilities.has(id);
  }

  get(id) {
    return this.capabilities.get(id) || null;
  }

  async snapshot({ force = false } = {}) {
    const toolSnapshot = await this.toolRegistry.list({ force });
    const availableTools = new Set(toolSnapshot.tools.map((tool) => tool.name));
    const capabilities = [];

    for (const capability of this.capabilities.values()) {
      const bindings = this.bindings
        .filter((binding) => binding.capability === capability.id)
        .map((binding) => publicBinding(binding, availableTools.has(binding.tool)));
      const activeBindings = bindings.filter((binding) => binding.status === 'active' && binding.available);
      capabilities.push({
        ...capability,
        available: capability.lifecycle === 'active' && activeBindings.length > 0,
        bindings,
        providers: [...new Set(activeBindings.map((binding) => binding.provider))]
      });
    }

    return {
      schemaVersion: this.schemaVersion,
      catalogVersion: this.catalogVersion,
      capabilities,
      diagnostics: toolSnapshot.diagnostics,
      refreshedAt: toolSnapshot.refreshedAt
    };
  }

  async list(options = {}) {
    return this.snapshot(options);
  }

  async resolve(id, { requirements = {}, force = false } = {}) {
    const capability = this.capabilities.get(id);
    if (!capability) throw Object.assign(new Error(`Unknown capability: ${id}`), { status: 404, code: 'UNKNOWN_CAPABILITY' });
    if (capability.lifecycle !== 'active') {
      throw Object.assign(new Error(`Capability is not active: ${id}`), { status: 409, code: 'CAPABILITY_NOT_ACTIVE' });
    }

    const toolSnapshot = await this.toolRegistry.list({ force });
    const availableTools = new Set(toolSnapshot.tools.map((tool) => tool.name));
    const candidates = this.bindings
      .filter((binding) => binding.capability === id)
      .filter((binding) => binding.status === 'active')
      .filter((binding) => availableTools.has(binding.tool))
      .filter((binding) => featureMatch(binding, requirements))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    if (!candidates.length) {
      throw Object.assign(new Error(`No available implementation satisfies ${id}`), {
        status: 503,
        code: 'NO_CAPABILITY_BINDING',
        detail: { capability: id, requirements }
      });
    }

    return {
      capability,
      binding: publicBinding(candidates[0], true),
      alternatives: candidates.slice(1).map((binding) => publicBinding(binding, true)),
      refreshedAt: toolSnapshot.refreshedAt
    };
  }

  async call(id, args = {}, options = {}) {
    const resolved = await this.resolve(id, options);
    const startedAt = Date.now();
    const result = await this.toolRegistry.call(resolved.binding.tool, args);
    return {
      capability: id,
      catalogVersion: this.catalogVersion,
      provider: resolved.binding.provider,
      binding: resolved.binding.id,
      tool: resolved.binding.tool,
      durationMs: Date.now() - startedAt,
      result
    };
  }

  async asMcpTools(options = {}) {
    const snapshot = await this.snapshot(options);
    return snapshot.capabilities
      .filter((capability) => capability.available)
      .filter((capability) => capability.interfaces.includes('mcp'))
      .map((capability) => ({
        name: capability.id,
        title: capability.title,
        description: capability.description,
        inputSchema: capability.inputSchema,
        outputSchema: capability.outputSchema,
        _meta: {
          'mccluster/capability': true,
          'mccluster/risk': capability.risk,
          'mccluster/execution': capability.execution,
          'mccluster/approval': capability.approval,
          'mccluster/providers': capability.providers
        }
      }));
  }
}

export function createCapabilityRegistry(options) {
  return new CapabilityRegistry(options);
}
