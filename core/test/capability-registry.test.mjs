import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CapabilityRegistry } from '../src/capabilities/registry.mjs';

function fakeTools(names) {
  const calls = [];
  return {
    calls,
    async list() {
      return {
        tools: names.map((name) => ({ name })),
        diagnostics: [],
        refreshedAt: '2026-09-12T00:00:00.000Z'
      };
    },
    async call(name, args) {
      calls.push({ name, args });
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

test('capability calls delegate through the normalized tool registry', async () => {
  const tools = fakeTools(['owned.health']);
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  const result = await registry.call('system.health', { probe: true });
  assert.equal(result.capability, 'system.health');
  assert.equal(result.provider, 'owned');
  assert.deepEqual(result.economics, { hosting: 'owned', billing: 'free' });
  assert.deepEqual(tools.calls, [{ name: 'owned.health', args: { probe: true } }]);
});

test('planned capabilities fail closed', async () => {
  const registry = new CapabilityRegistry({ toolRegistry: fakeTools(['owned.health']), catalog });
  await assert.rejects(
    () => registry.resolve('video.generate'),
    (error) => error.code === 'CAPABILITY_NOT_ACTIVE' && error.status === 409
  );
});
