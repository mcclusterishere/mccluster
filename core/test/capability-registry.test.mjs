import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CapabilityRegistry } from '../src/capabilities/registry.mjs';

function fakeTools(entries) {
  const calls = [];
  return {
    calls,
    async list() {
      return {
        tools: entries.map((entry) => typeof entry === 'string' ? { name: entry } : entry),
        diagnostics: [],
        refreshedAt: '2026-09-12T00:00:00.000Z'
      };
    },
    async call(name, args, options) {
      calls.push({ name, args, options });
      return { ok: true, name, args };
    }
  };
}

const catalog = {
  schemaVersion: '1.0',
  catalogVersion: 'test.1',
  capabilities: [
    {
      id: 'system.health',
      title: 'Health',
      description: 'Health check',
      domain: 'system',
      lifecycle: 'active',
      execution: 'sync',
      risk: 'read',
      approval: 'none',
      interfaces: ['mcp', 'http', 'agent'],
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object' }
    },
    {
      id: 'model3d.generate',
      title: '3D',
      description: '3D generation',
      domain: 'spatial.asset',
      lifecycle: 'active',
      execution: 'async',
      risk: 'spend',
      approval: 'budget-gated',
      interfaces: ['mcp', 'http', 'agent'],
      inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } },
      outputSchema: { type: 'object' }
    },
    {
      id: 'video.generate',
      title: 'Video',
      description: 'Video generation',
      domain: 'media.video',
      lifecycle: 'planned',
      execution: 'async',
      risk: 'spend',
      approval: 'budget-gated',
      interfaces: ['mcp', 'http', 'agent'],
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object' }
    }
  ],
  bindings: [
    {
      id: 'provider.owned',
      capability: 'system.health',
      provider: 'owned',
      tool: 'owned.health',
      transport: 'http',
      status: 'active',
      priority: 10,
      economics: { hosting: 'owned', billing: 'free' },
      features: { authenticated: false, region: 'us' }
    },
    {
      id: 'provider.external',
      capability: 'system.health',
      provider: 'external',
      tool: 'external.health',
      transport: 'mcp-http',
      status: 'active',
      priority: 100,
      economics: { hosting: 'external', billing: 'metered' },
      features: { authenticated: true, region: 'us' }
    }
  ]
};

test('lists active and planned capabilities without pretending planned work is callable', async () => {
  const registry = new CapabilityRegistry({ toolRegistry: fakeTools(['owned.health']), catalog });
  const snapshot = await registry.list();
  const health = snapshot.capabilities.find((capability) => capability.id === 'system.health');
  const video = snapshot.capabilities.find((capability) => capability.id === 'video.generate');
  assert.equal(health.available, true);
  assert.deepEqual(health.providers, ['owned']);
  assert.equal(video.available, false);
  assert.equal(snapshot.routingPolicy.preferOwned, true);
});

test('prefers an owned/free implementation over a higher-priority metered external implementation', async () => {
  const registry = new CapabilityRegistry({ toolRegistry: fakeTools(['owned.health', 'external.health']), catalog });
  const resolved = await registry.resolve('system.health');
  assert.equal(resolved.binding.id, 'provider.owned');
  assert.deepEqual(resolved.binding.economics, { hosting: 'owned', billing: 'free' });
});

test('can disable self-host-first policy when an explicit raw-priority comparison is needed', async () => {
  const registry = new CapabilityRegistry({ toolRegistry: fakeTools(['owned.health', 'external.health']), catalog });
  const resolved = await registry.resolve('system.health', { preferOwned: false });
  assert.equal(resolved.binding.id, 'provider.external');
});

test('requirements can route to a different implementation', async () => {
  const registry = new CapabilityRegistry({ toolRegistry: fakeTools(['owned.health', 'external.health']), catalog });
  const resolved = await registry.resolve('system.health', { requirements: { authenticated: true } });
  assert.equal(resolved.binding.id, 'provider.external');
});

test('economics can be an explicit routing requirement', async () => {
  const registry = new CapabilityRegistry({ toolRegistry: fakeTools(['owned.health', 'external.health']), catalog });
  const resolved = await registry.resolve('system.health', { requirements: { billing: 'metered' } });
  assert.equal(resolved.binding.id, 'provider.external');
});

test('live compute tools become self-hosted bindings without changing the static catalog', async () => {
  const tools = fakeTools([{
    name: 'compute.model3d.generate.abc123',
    transport: 'compute',
    capabilityBinding: {
      id: 'compute.model3d.generate.abc123',
      capability: 'model3d.generate',
      provider: 'mccluster-compute',
      transport: 'compute',
      status: 'active',
      priority: 100,
      economics: { hosting: 'self-hosted', billing: 'compute' },
      features: { pbr: true, image_to_3d: true }
    }
  }]);
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  const resolved = await registry.resolve('model3d.generate', { requirements: { pbr: true } });
  assert.equal(resolved.binding.provider, 'mccluster-compute');
  assert.equal(resolved.binding.tool, 'compute.model3d.generate.abc123');
  assert.deepEqual(resolved.binding.economics, { hosting: 'self-hosted', billing: 'compute' });
});

test('unknown node-advertised capabilities cannot extend the policy catalog implicitly', async () => {
  const tools = fakeTools([{
    name: 'compute.unknown.power.abc123',
    transport: 'compute',
    capabilityBinding: {
      id: 'compute.unknown.power.abc123',
      capability: 'unknown.power',
      provider: 'mccluster-compute',
      transport: 'compute',
      status: 'active',
      priority: 100,
      economics: { hosting: 'self-hosted', billing: 'compute' }
    }
  }]);
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  await assert.rejects(
    () => registry.resolve('unknown.power'),
    (error) => error.code === 'UNKNOWN_CAPABILITY' && error.status === 404
  );
});

test('capability calls delegate through the normalized tool registry with routing requirements', async () => {
  const tools = fakeTools(['owned.health']);
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  const result = await registry.call('system.health', { probe: true }, { requirements: { region: 'us' } });
  assert.equal(result.capability, 'system.health');
  assert.equal(result.provider, 'owned');
  assert.deepEqual(result.economics, { hosting: 'owned', billing: 'free' });
  assert.equal(tools.calls[0].name, 'owned.health');
  assert.deepEqual(tools.calls[0].args, { probe: true });
  assert.deepEqual(tools.calls[0].options.requirements, { region: 'us' });
  assert.equal(tools.calls[0].options.source, 'capability:system.health');
});

test('planned capabilities fail closed even if a compute node advertises an implementation', async () => {
  const tools = fakeTools([{
    name: 'compute.video.generate.abc123',
    transport: 'compute',
    capabilityBinding: {
      id: 'compute.video.generate.abc123',
      capability: 'video.generate',
      provider: 'mccluster-compute',
      transport: 'compute',
      status: 'active',
      priority: 100,
      economics: { hosting: 'self-hosted', billing: 'compute' }
    }
  }]);
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  await assert.rejects(
    () => registry.resolve('video.generate'),
    (error) => error.code === 'CAPABILITY_NOT_ACTIVE' && error.status === 409
  );
});
