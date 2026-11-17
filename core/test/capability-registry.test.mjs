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
      id: 'ai.chat',
      title: 'AI chat',
      description: 'Self-hosted conversational inference',
      domain: 'ai',
      lifecycle: 'active',
      execution: 'async',
      risk: 'read',
      approval: 'none',
      interfaces: ['mcp', 'http', 'agent'],
      inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } },
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
  const result = await registry.call('system.health', { probe: true }, { requirements: { region: 'us' }, operationId: 'core:job-1:0' });
  assert.equal(result.capability, 'system.health');
  assert.equal(result.provider, 'owned');
  assert.deepEqual(result.economics, { hosting: 'owned', billing: 'free' });
  assert.equal(tools.calls[0].name, 'owned.health');
  assert.deepEqual(tools.calls[0].args, { probe: true });
  assert.deepEqual(tools.calls[0].options.requirements, { region: 'us' });
  assert.equal(tools.calls[0].options.source, 'capability:system.health');
  assert.equal(tools.calls[0].options.operationId, 'core:job-1:0', 'a caller-scoped operation id survives the capability hop');
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


test('live compute ai.chat becomes a first-class self-hosted capability', async () => {
  const tools = fakeTools([{
    name: 'compute.ai.chat.local123',
    transport: 'compute',
    capabilityBinding: {
      id: 'compute.ai.chat.local123',
      capability: 'ai.chat',
      provider: 'mccluster-compute',
      transport: 'compute',
      status: 'active',
      priority: 100,
      economics: { hosting: 'self-hosted', billing: 'compute' },
      features: { chat: true, json: true, self_hosted: true }
    }
  }]);
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  const resolved = await registry.resolve('ai.chat', { requirements: { self_hosted: true } });
  assert.equal(resolved.binding.provider, 'mccluster-compute');
  assert.equal(resolved.binding.tool, 'compute.ai.chat.local123');
  assert.deepEqual(resolved.binding.economics, { hosting: 'self-hosted', billing: 'compute' });
});

function computeChatTool(id, evidence) {
  return {
    name: `compute.ai.chat.${id}`,
    transport: 'compute',
    capabilityBinding: {
      id: `compute.ai.chat.${id}`,
      capability: 'ai.chat',
      provider: 'mccluster-compute',
      transport: 'compute',
      status: 'active',
      priority: 100,
      economics: { hosting: 'self-hosted', billing: 'compute' },
      features: { chat: true, self_hosted: true },
      ...(evidence ? { evidence } : {})
    }
  };
}

function failingTools(entries, failures = {}) {
  const calls = [];
  return {
    calls,
    async list() {
      return { tools: entries.map((entry) => typeof entry === 'string' ? { name: entry } : entry), diagnostics: [], refreshedAt: '2026-11-17T00:00:00.000Z' };
    },
    async call(name, args, options) {
      calls.push({ name, args, options });
      if (failures[name]) throw failures[name];
      return { tool: name, transport: 'compute', durationMs: 1, result: { task: { id: `task-${name}` }, replayed: false } };
    }
  };
}

test('among compute bindings, GPU-verified evidence outranks CPU-only even when its id sorts later', async () => {
  const tools = fakeTools([
    computeChatTool('aaa111', { hardware_mode: 'cpu-only', hardware_mode_rank: 1, generation_tokens_per_second: 10 }),
    computeChatTool('zzz999', { hardware_mode: 'gpu-verified', hardware_mode_rank: 3, generation_tokens_per_second: 20 })
  ]);
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  const resolved = await registry.resolve('ai.chat');
  assert.equal(resolved.binding.id, 'compute.ai.chat.zzz999');
  assert.deepEqual(resolved.binding.evidence, { hardware_mode: 'gpu-verified', hardware_mode_rank: 3, generation_tokens_per_second: 20 });
  assert.equal(resolved.alternatives[0].id, 'compute.ai.chat.aaa111');
  assert.equal(resolved.binding.routingScore, resolved.alternatives[0].routingScore, 'economics tie; evidence decided');
  const snapshot = await registry.snapshot();
  const chat = snapshot.capabilities.find((capability) => capability.id === 'ai.chat');
  assert.equal(chat.bindings.find((binding) => binding.id === 'compute.ai.chat.aaa111').evidence.hardware_mode, 'cpu-only');
});

test('equal hardware mode: the faster measured generation wins; no evidence at all keeps the id order', async () => {
  const fast = new CapabilityRegistry({ toolRegistry: fakeTools([
    computeChatTool('aaa111', { hardware_mode: 'gpu-verified', hardware_mode_rank: 3, generation_tokens_per_second: 12 }),
    computeChatTool('zzz999', { hardware_mode: 'gpu-verified', hardware_mode_rank: 3, generation_tokens_per_second: 30 })
  ]), catalog });
  assert.equal((await fast.resolve('ai.chat')).binding.id, 'compute.ai.chat.zzz999');

  const rankOnly = new CapabilityRegistry({ toolRegistry: fakeTools([
    computeChatTool('aaa111', { hardware_mode: 'gpu-present-unverified' }),
    computeChatTool('zzz999', { hardware_mode: 'cpu-only' })
  ]), catalog });
  assert.equal((await rankOnly.resolve('ai.chat')).binding.id, 'compute.ai.chat.aaa111', 'the mode name ranks when no numeric rank is given');

  const plain = new CapabilityRegistry({ toolRegistry: fakeTools([computeChatTool('bbb222'), computeChatTool('aaa111')]), catalog });
  const resolved = await plain.resolve('ai.chat');
  assert.equal(resolved.binding.id, 'compute.ai.chat.aaa111');
  assert.equal(resolved.binding.evidence, null);
});

test('a static owned/free binding still outranks compute bindings whatever their evidence', async () => {
  const withStatic = {
    ...catalog,
    bindings: [...catalog.bindings, {
      id: 'ai.chat.owned', capability: 'ai.chat', provider: 'owned', tool: 'owned.chat', transport: 'http', status: 'active', priority: 0,
      economics: { hosting: 'owned', billing: 'free' }, features: { chat: true }
    }]
  };
  const tools = fakeTools(['owned.chat', computeChatTool('zzz999', { hardware_mode: 'gpu-verified', hardware_mode_rank: 3, generation_tokens_per_second: 50 })]);
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog: withStatic });
  const resolved = await registry.resolve('ai.chat');
  assert.equal(resolved.binding.id, 'ai.chat.owned');
  assert.equal(resolved.binding.evidence, null, 'static catalog bindings carry no evidence');
  assert.equal(resolved.alternatives[0].id, 'compute.ai.chat.zzz999');
});

test('call() moves to the next candidate when no live node serves the first and says so', async () => {
  const first = computeChatTool('zzz999', { hardware_mode: 'gpu-verified', hardware_mode_rank: 3, generation_tokens_per_second: 20 });
  const second = computeChatTool('aaa111', { hardware_mode: 'cpu-only', hardware_mode_rank: 1, generation_tokens_per_second: 10 });
  const tools = failingTools([first, second], {
    'compute.ai.chat.zzz999': Object.assign(new Error('No live compute node serves ai.chat/qwen3.14b.local'), { status: 503, code: 'COMPUTE_NO_LIVE_NODE', retryable: true })
  });
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  const result = await registry.call('ai.chat', { prompt: 'x' }, { requirements: { chat: true }, operationId: 'core:job-9:0' });
  assert.deepEqual(tools.calls.map((call) => call.name), ['compute.ai.chat.zzz999', 'compute.ai.chat.aaa111']);
  assert.equal(result.binding, 'compute.ai.chat.aaa111');
  assert.equal(result.tool, 'compute.ai.chat.aaa111');
  assert.equal(result.provider, 'mccluster-compute');
  assert.deepEqual(result.fallback_from, [{ binding: 'compute.ai.chat.zzz999', code: 'COMPUTE_NO_LIVE_NODE' }]);
  assert.equal(tools.calls[1].options.source, 'capability:ai.chat');
  assert.equal(tools.calls[1].options.operationId, 'core:job-9:0');
  assert.deepEqual(tools.calls[1].options.requirements, { chat: true });
});

test('call() reports no fallback when the first candidate answers', async () => {
  const tools = failingTools([computeChatTool('aaa111', { hardware_mode: 'gpu-verified', hardware_mode_rank: 3 }), computeChatTool('bbb222')]);
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  const result = await registry.call('ai.chat', { prompt: 'x' });
  assert.equal(result.binding, 'compute.ai.chat.aaa111');
  assert.deepEqual(result.fallback_from, []);
  assert.equal(tools.calls.length, 1);
});

test('call() rethrows a non-fallback error without trying the next candidate', async () => {
  const tools = failingTools([computeChatTool('aaa111', { hardware_mode: 'gpu-verified', hardware_mode_rank: 3 }), computeChatTool('bbb222')], {
    'compute.ai.chat.aaa111': Object.assign(new Error('messages or prompt is required'), { status: 400, code: 'INPUT_REQUIRED' })
  });
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  await assert.rejects(registry.call('ai.chat', {}), (error) => {
    assert.equal(error.code, 'INPUT_REQUIRED');
    assert.deepEqual(error.tried, []);
    return true;
  });
  assert.equal(tools.calls.length, 1, 'a 400 is the caller\'s problem, not a reason to try another implementation');
});

test('call() throws the last candidate\'s error, carrying the candidates it skipped, when every one fails', async () => {
  const enqueueFailed = () => Object.assign(new Error('Failed to enqueue compute task'), { status: 503, code: 'COMPUTE_ENQUEUE_FAILED' });
  const tools = failingTools([computeChatTool('aaa111', { hardware_mode: 'gpu-verified', hardware_mode_rank: 3 }), computeChatTool('bbb222')], {
    'compute.ai.chat.aaa111': enqueueFailed(),
    'compute.ai.chat.bbb222': enqueueFailed()
  });
  const registry = new CapabilityRegistry({ toolRegistry: tools, catalog });
  await assert.rejects(registry.call('ai.chat', { prompt: 'x' }), (error) => {
    assert.equal(error.code, 'COMPUTE_ENQUEUE_FAILED');
    assert.equal(error.status, 503);
    assert.deepEqual(error.tried, [{ binding: 'compute.ai.chat.aaa111', code: 'COMPUTE_ENQUEUE_FAILED' }]);
    return true;
  });
  assert.equal(tools.calls.length, 2);
});
