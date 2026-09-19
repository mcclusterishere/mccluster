/* Sovereign mode is enforcement, not advice.

   The property under test is negative and therefore easy to get wrong
   by accident: in `required` mode a generation capability must be
   UNABLE to reach a metered external binding, even when that binding is
   healthy, higher priority, and the only thing available. A test that
   only checks the happy path would pass against a registry that quietly
   falls back to FAL the moment the GPU is asleep — which is precisely
   the failure this mode exists to prevent. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CapabilityRegistry, isSovereignBinding, sovereignMode, governedCapabilities
} from '../src/capabilities/registry.mjs';

const CAPABILITY = {
  id: 'model3d.generate',
  lifecycle: 'active',
  execution: 'async',
  risk: 'spend',
  description: 'Generate a 3D model'
};

/* A hosted API that would happily take the job and the money. Given the
   higher priority deliberately, so a test that passes cannot be passing
   because the local one simply sorted first. */
const EXTERNAL = {
  id: 'fal.hunyuan3d',
  capability: 'model3d.generate',
  provider: 'fal',
  tool: 'fal.tool',
  transport: 'http',
  status: 'active',
  priority: 100,
  economics: { hosting: 'external', billing: 'metered' }
};

const LOCAL = {
  id: 'local.hunyuan3d',
  capability: 'model3d.generate',
  provider: 'mccluster-compute',
  tool: 'compute.tool',
  transport: 'http',
  status: 'active',
  priority: 1,
  economics: { hosting: 'self-hosted', billing: 'compute' }
};

function registryWith(bindings, tools) {
  return new CapabilityRegistry({
    catalog: { capabilities: [CAPABILITY], bindings },
    toolRegistry: {
      async list() {
        return { tools: tools.map((name) => ({ name })), refreshedAt: new Date().toISOString() };
      }
    }
  });
}

async function refusal(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

test('mode parsing accepts exactly the three modes', () => {
  assert.equal(sovereignMode({}), 'off');
  assert.equal(sovereignMode({ MCCLUSTER_SOVEREIGN_MEDIA: 'required' }), 'required');
  assert.equal(sovereignMode({ MCCLUSTER_SOVEREIGN_MEDIA: 'PREFER' }), 'prefer');
  assert.equal(sovereignMode({ MCCLUSTER_SOVEREIGN_MEDIA: 'off' }), 'off');
  assert.throws(() => sovereignMode({ MCCLUSTER_SOVEREIGN_MEDIA: 'sometimes' }), /must be one of/);
});

test('the four generation capabilities are governed by default', () => {
  const governed = governedCapabilities({});
  for (const id of ['image.generate', 'video.generate', 'audio.generate', 'model3d.generate']) {
    assert.ok(governed.has(id), `${id} must be governed`);
  }
});

test('sovereignty is hosting plus billing, and a metered provider cannot claim it', () => {
  assert.equal(isSovereignBinding(LOCAL), true);
  assert.equal(isSovereignBinding(EXTERNAL), false);
  assert.equal(isSovereignBinding({ provider: 'x', economics: { hosting: 'owned', billing: 'free' } }), true);
  /* A binding that mislabels its economics while pointing at a hosted
     inference API must still be refused. */
  assert.equal(
    isSovereignBinding({ provider: 'fal', economics: { hosting: 'self-hosted', billing: 'compute' } }),
    false,
    'a known metered provider cannot label its way past the gate'
  );
  assert.equal(isSovereignBinding({ provider: 'x', economics: { hosting: 'external', billing: 'compute' } }), false);
});

test('required mode refuses to spend when only an external provider is healthy', async () => {
  const registry = registryWith([EXTERNAL, LOCAL], ['fal.tool']);
  const error = await refusal(registry.resolve('model3d.generate', {
    env: { MCCLUSTER_SOVEREIGN_MEDIA: 'required' }
  }));
  assert.ok(error, 'resolve must not succeed');
  assert.equal(error.code, 'NO_SOVEREIGN_CAPACITY');
  assert.equal(error.status, 503);
  assert.equal(error.detail.waiting, true);
  assert.deepEqual(error.detail.refused_external.map((b) => b.provider), ['fal']);
});

test('required mode routes to the local implementation even when it is lower priority', async () => {
  const registry = registryWith([EXTERNAL, LOCAL], ['fal.tool', 'compute.tool']);
  const resolved = await registry.resolve('model3d.generate', {
    env: { MCCLUSTER_SOVEREIGN_MEDIA: 'required' }
  });
  assert.equal(resolved.binding.id, 'local.hunyuan3d');
  assert.equal(resolved.routingPolicy.sovereignMode, 'required');
  assert.equal(resolved.routingPolicy.sovereign, true);
  /* The external binding must not survive as an alternative either —
     anything downstream that reaches for alternatives[0] on failure
     would otherwise route straight to a metered provider. */
  assert.deepEqual(resolved.alternatives, [], 'external bindings must not remain reachable');
});

test('required mode cannot be talked into a fallback by a caller or by configuration', async () => {
  const registry = registryWith([EXTERNAL], ['fal.tool']);
  for (const options of [
    { env: { MCCLUSTER_SOVEREIGN_MEDIA: 'required' }, allowExternalFallback: true },
    { env: { MCCLUSTER_SOVEREIGN_MEDIA: 'required', MCCLUSTER_SOVEREIGN_ALLOW_FALLBACK: 'true' } }
  ]) {
    const error = await refusal(registry.resolve('model3d.generate', options));
    assert.ok(error, 'required mode must ignore fallback authorization');
    assert.equal(error.code, 'NO_SOVEREIGN_CAPACITY');
  }
});

test('prefer mode waits by default rather than silently spending', async () => {
  const registry = registryWith([EXTERNAL], ['fal.tool']);
  const error = await refusal(registry.resolve('model3d.generate', {
    env: { MCCLUSTER_SOVEREIGN_MEDIA: 'prefer' }
  }));
  assert.ok(error, 'silence is not authorization to spend');
  assert.equal(error.code, 'NO_SOVEREIGN_CAPACITY');
});

test('prefer mode falls back only when explicitly authorized', async () => {
  const registry = registryWith([EXTERNAL], ['fal.tool']);

  const perCall = await registry.resolve('model3d.generate', {
    env: { MCCLUSTER_SOVEREIGN_MEDIA: 'prefer' },
    allowExternalFallback: true
  });
  assert.equal(perCall.binding.id, 'fal.hunyuan3d');
  assert.equal(perCall.routingPolicy.sovereign, false);

  const byConfig = await registry.resolve('model3d.generate', {
    env: { MCCLUSTER_SOVEREIGN_MEDIA: 'prefer', MCCLUSTER_SOVEREIGN_ALLOW_FALLBACK: 'true' }
  });
  assert.equal(byConfig.binding.id, 'fal.hunyuan3d');
});

test('prefer mode still puts the local implementation first when it is healthy', async () => {
  const registry = registryWith([EXTERNAL, LOCAL], ['fal.tool', 'compute.tool']);
  const resolved = await registry.resolve('model3d.generate', {
    env: { MCCLUSTER_SOVEREIGN_MEDIA: 'prefer', MCCLUSTER_SOVEREIGN_ALLOW_FALLBACK: 'true' }
  });
  assert.equal(resolved.binding.id, 'local.hunyuan3d');
  assert.equal(resolved.routingPolicy.sovereign, true);
  assert.equal(resolved.alternatives[0].id, 'fal.hunyuan3d', 'fallback stays visible in prefer mode');
});

test('off mode preserves historical routing exactly', async () => {
  const registry = registryWith([EXTERNAL], ['fal.tool']);
  const resolved = await registry.resolve('model3d.generate', { env: {} });
  assert.equal(resolved.binding.id, 'fal.hunyuan3d');
  assert.equal(resolved.routingPolicy.sovereignMode, 'off');
});

test('an ungoverned capability is unaffected by required mode', async () => {
  const registry = new CapabilityRegistry({
    catalog: {
      capabilities: [{ ...CAPABILITY, id: 'research.web' }],
      bindings: [{ ...EXTERNAL, id: 'ext.research', capability: 'research.web' }]
    },
    toolRegistry: {
      async list() { return { tools: [{ name: 'fal.tool' }], refreshedAt: new Date().toISOString() }; }
    }
  });
  const resolved = await registry.resolve('research.web', {
    env: { MCCLUSTER_SOVEREIGN_MEDIA: 'required' }
  });
  assert.equal(resolved.binding.id, 'ext.research');
  assert.equal(resolved.routingPolicy.governed, false);
});
