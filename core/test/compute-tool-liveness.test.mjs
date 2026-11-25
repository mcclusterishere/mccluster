// The compute tool bus with injected store functions: a task is enqueued only
// for an implementation some live node serves right now, and every live
// (capability, implementation) group carries the evidence the registry ranks on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { callComputeTool, discoverComputeTools } from '../src/tools/compute.mjs';

const ORG = '00000000-0000-0000-0000-000000000001';
const ENV = { MCCLUSTER_ORG_ID: ORG, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'configured-elsewhere' };

function liveEntry(overrides = {}) {
  return {
    node_id: 'node_a',
    node_name: 'owner-windows-gpu',
    capability: 'ai.chat',
    implementation: 'qwen3.8b.local',
    backend: 'ollama',
    model: 'qwen3:8b',
    version: '2',
    features: { chat: true, self_hosted: true, gpu: true },
    input_schema: { type: 'object', properties: { prompt: { type: 'string' } } },
    output_schema: { type: 'object' },
    max_concurrency: 1,
    min_vram_bytes: 0,
    hosting: 'self-hosted',
    billing: 'compute',
    labels: { trust: 'owned' },
    inventory: { runtime: { hardware_mode: 'gpu-verified', measured_inference_by_model: { 'qwen3:8b': { generation_tokens_per_second: 22.4 } } } },
    load: {},
    last_seen_at: '2026-11-17T20:00:00.000Z',
    ...overrides
  };
}

test('callComputeTool refuses to enqueue when no live node serves the implementation', async () => {
  let enqueued = 0;
  const target = { orgId: ORG, capability: 'ai.chat', implementation: 'qwen3.14b.local', nodes: ['node_stale'], maxConcurrency: 1 };
  await assert.rejects(
    callComputeTool(target, { prompt: 'x' }, {}, { enqueue: async () => { enqueued += 1; return { task: { id: 't' } }; }, live: async () => [liveEntry()] }),
    (error) => error.code === 'COMPUTE_NO_LIVE_NODE' && error.status === 503 && error.retryable === true && /qwen3\.14b\.local/.test(error.message)
  );
  assert.equal(enqueued, 0);
});

test('callComputeTool enqueues with the nodes that advertise the implementation right now', async () => {
  const seen = [];
  const live = [
    liveEntry(),
    liveEntry({ node_id: 'node_b', node_name: 'ovh-primary', max_concurrency: 2, inventory: { runtime: { hardware_mode: 'cpu-only' } } }),
    liveEntry({ node_id: 'node_c', implementation: 'qwen3.14b.local', model: 'qwen3:14b' })
  ];
  const result = await callComputeTool(
    { orgId: ORG, capability: 'ai.chat', implementation: 'qwen3.8b.local', nodes: ['node_stale'], maxConcurrency: 9 },
    { prompt: 'x' },
    { source: 'capability:ai.chat', requirements: { gpu: true, provider: 'mccluster-compute' }, priority: -20, maxAttempts: 1, idempotencyKey: 'k-1' },
    {
      enqueue: async (args) => { seen.push(args); return { task: { id: 't1', status: 'queued' }, replayed: false }; },
      live: async ({ orgId }) => { assert.equal(orgId, ORG); return live; }
    }
  );
  assert.equal(result.task.id, 't1');
  assert.equal(result.replayed, false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].orgId, ORG);
  assert.equal(seen[0].capability, 'ai.chat');
  assert.equal(seen[0].implementation, 'qwen3.8b.local');
  assert.deepEqual(seen[0].input, { prompt: 'x' });
  assert.deepEqual(seen[0].requirements, { features: { gpu: true } }, 'routing keys never become task requirements');
  assert.equal(seen[0].priority, -20);
  assert.equal(seen[0].maxAttempts, 1);
  assert.equal(seen[0].idempotencyKey, 'k-1');
  assert.equal(seen[0].metadata.source, 'capability:ai.chat');
  assert.deepEqual(seen[0].metadata.advertised_nodes_at_submit, ['node_a', 'node_b'], 'fresh, not the discovery-time snapshot');
  assert.equal(seen[0].metadata.advertised_concurrency_at_submit, 3);
  assert.ok(Number.isFinite(Date.parse(seen[0].metadata.requested_at)));
});

test('a liveness read failure is rethrown unchanged and nothing is enqueued', async () => {
  const failure = new Error('control plane unreachable');
  let enqueued = 0;
  await assert.rejects(
    callComputeTool({ orgId: ORG, capability: 'ai.chat', implementation: 'qwen3.8b.local', nodes: [], maxConcurrency: 1 }, {}, {}, { enqueue: async () => { enqueued += 1; }, live: async () => { throw failure; } }),
    (error) => error === failure
  );
  assert.equal(enqueued, 0);
});

test('an enqueue that returns no task is COMPUTE_ENQUEUE_FAILED', async () => {
  await assert.rejects(
    callComputeTool({ orgId: ORG, capability: 'ai.chat', implementation: 'qwen3.8b.local', nodes: [], maxConcurrency: 1 }, { prompt: 'x' }, {}, { enqueue: async () => ({ task: null }), live: async () => [liveEntry()] }),
    (error) => error.code === 'COMPUTE_ENQUEUE_FAILED' && error.status === 503
  );
});

test('discoverComputeTools aggregates evidence per implementation from the live nodes', async () => {
  const live = [
    liveEntry(),
    liveEntry({ node_id: 'node_b', node_name: 'ovh-primary', inventory: { runtime: { hardware_mode: 'cpu-only', measured_inference: { model: 'qwen3:8b', generation_tokens_per_second: 9.5 } } } }),
    liveEntry({ node_id: 'node_c', node_name: 'owner-windows-gpu', implementation: 'qwen3.14b.local', model: 'qwen3:14b', inventory: { runtime: { hardware_mode: 'gpu-present-unverified' } } }),
    liveEntry({ node_id: 'node_d', node_name: 'no-runtime', inventory: {} })
  ];
  const { tools, diagnostic } = await discoverComputeTools({ live: async ({ orgId }) => { assert.equal(orgId, ORG); return live; }, env: ENV });
  assert.equal(diagnostic.ok, true);
  assert.equal(diagnostic.live_nodes, 4);
  assert.equal(tools.length, 2);

  const eight = tools.find((tool) => tool.target.implementation === 'qwen3.8b.local');
  assert.deepEqual(eight.capabilityBinding.evidence, {
    hardware_mode: 'gpu-verified',
    hardware_mode_rank: 3,
    generation_tokens_per_second: 22.4,
    live_nodes: 3,
    nodes: [
      { node_id: 'node_a', node_name: 'owner-windows-gpu', hardware_mode: 'gpu-verified', generation_tokens_per_second: 22.4 },
      { node_id: 'node_b', node_name: 'ovh-primary', hardware_mode: 'cpu-only', generation_tokens_per_second: 9.5 },
      { node_id: 'node_d', node_name: 'no-runtime', hardware_mode: 'unknown', generation_tokens_per_second: null }
    ]
  });
  assert.deepEqual(eight.target.evidence, eight.capabilityBinding.evidence);
  assert.deepEqual(eight.target.nodes, ['node_a', 'node_b', 'node_d']);
  assert.deepEqual(eight.capabilityBinding.economics, { hosting: 'self-hosted', billing: 'compute' });
  assert.equal(eight.capabilityBinding.features.gpu, true);

  const fourteen = tools.find((tool) => tool.target.implementation === 'qwen3.14b.local');
  assert.equal(fourteen.capabilityBinding.evidence.hardware_mode, 'gpu-present-unverified');
  assert.equal(fourteen.capabilityBinding.evidence.hardware_mode_rank, 2);
  assert.equal(fourteen.capabilityBinding.evidence.generation_tokens_per_second, null);
  assert.equal(fourteen.capabilityBinding.evidence.live_nodes, 1);
});

test('discoverComputeTools without the control plane configured reports the reason and lists no tools', async () => {
  const result = await discoverComputeTools({ live: async () => { throw new Error('must not be called'); }, env: {} });
  assert.deepEqual(result.tools, []);
  assert.equal(result.diagnostic.ok, false);
  assert.equal(result.diagnostic.reason, 'control_plane_not_configured');
});

// browser.act is admitted only from nodes whose trust was recorded as owned at
// enrolment (labels.enrolled_trust, written by the owner-token-gated enrol
// call and never by a heartbeat): discovery drops the entries of any other node
// and the enqueue-time re-read ignores them too, so a node the owner did not
// enrol as owned cannot offer the owner's browser.
function browserEntry(overrides = {}) {
  return liveEntry({
    node_id: 'node_owned', node_name: 'owner-windows-gpu', capability: 'browser.act', implementation: 'chromium.local', backend: 'playwright', model: null, version: '1',
    features: { browser: true, headed: false, screenshot: true, self_hosted: true }, labels: { trust: 'owned', enrolled_trust: 'owned', site: 'owner-windows-gpu' }, ...overrides
  });
}

test('browser.act entries from nodes that are not trust-owned are not discovered and the diagnostic counts them', async () => {
  const live = [
    liveEntry(),
    browserEntry(),
    browserEntry({ node_id: 'node_partner', node_name: 'partner-box', labels: { trust: 'partner', enrolled_trust: 'partner' } }),
    browserEntry({ node_id: 'node_unlabelled', node_name: 'no-labels', labels: {} }),
    liveEntry({ node_id: 'node_partner', node_name: 'partner-box', labels: { trust: 'partner' } })
  ];
  const { tools, diagnostic } = await discoverComputeTools({ live: async () => live, env: ENV });
  const browser = tools.find((tool) => tool.target.capability === 'browser.act');
  assert.ok(browser, 'the owned node still advertises it');
  assert.deepEqual(browser.target.nodes, ['node_owned']);
  assert.equal(browser.capabilityBinding.features.browser, true);
  assert.equal(browser.capabilityBinding.evidence.live_nodes, 1);
  const chat = tools.find((tool) => tool.target.capability === 'ai.chat');
  assert.deepEqual(chat.target.nodes, ['node_a', 'node_partner'], 'ai.chat is not owned-only');
  assert.equal(diagnostic.dropped_owned_only, 2);
  assert.equal(diagnostic.implementations, 3, 'the dropped entries are not counted as live implementations');
});

test('callComputeTool never pins browser.act to a node that is not trust-owned, and passes browser:true as a feature requirement', async () => {
  const seen = [];
  const target = { orgId: ORG, capability: 'browser.act', implementation: 'chromium.local', nodes: ['node_owned'], maxConcurrency: 1 };
  await assert.rejects(
    callComputeTool(target, { actions: [{ type: 'done' }] }, { requirements: { browser: true } }, { enqueue: async () => { seen.push('enqueued'); return { task: { id: 't' } }; }, live: async () => [browserEntry({ node_id: 'node_partner', labels: { trust: 'partner', enrolled_trust: 'partner' } })] }),
    (error) => error.code === 'COMPUTE_NO_LIVE_NODE'
  );
  assert.deepEqual(seen, []);
  const result = await callComputeTool(target, { actions: [{ type: 'done' }] }, { requirements: { browser: true }, maxAttempts: 1, source: 'capability:browser.act' }, {
    enqueue: async (args) => { seen.push(args); return { task: { id: 't2', status: 'queued' }, replayed: false }; },
    live: async () => [browserEntry({ node_id: 'node_partner', labels: { trust: 'partner', enrolled_trust: 'partner' } }), browserEntry()]
  });
  assert.equal(result.task.id, 't2');
  assert.deepEqual(seen[0].requirements, { features: { browser: true } });
  assert.deepEqual(seen[0].metadata.advertised_nodes_at_submit, ['node_owned'], 'only the owned node is counted at submit');
  assert.equal(seen[0].maxAttempts, 1);
});

// Review N2R-3: labels.trust is what a node asserts, and before the fix any
// heartbeat could rewrite it. A node that says trust 'owned' without the trust
// recorded at enrolment is not admitted, at discovery or at enqueue.
test('browser.act from a node that only asserts labels.trust owned (no trust recorded at enrolment) is never admitted', async () => {
  const asserted = browserEntry({ node_id: 'node_asserted', node_name: 'asserted-box', labels: { trust: 'owned', role: 'gpu-laptop', site: 'asserted-box' } });
  // The recorded word must be exactly 'owned'.
  const inexact = browserEntry({ node_id: 'node_inexact', node_name: 'inexact-box', labels: { trust: 'partner', enrolled_trust: 'Owned' } });
  const { tools, diagnostic } = await discoverComputeTools({ live: async () => [liveEntry(), asserted, inexact], env: ENV });
  assert.equal(tools.find((tool) => tool.target.capability === 'browser.act'), undefined, 'no browser tool from an asserted trust');
  assert.equal(diagnostic.dropped_owned_only, 2);
  const seen = [];
  const target = { orgId: ORG, capability: 'browser.act', implementation: 'chromium.local', nodes: ['node_asserted'], maxConcurrency: 1 };
  await assert.rejects(
    callComputeTool(target, { actions: [{ type: 'done' }] }, { requirements: { browser: true } }, { enqueue: async () => { seen.push('enqueued'); return { task: { id: 't' } }; }, live: async () => [asserted, inexact] }),
    (error) => error.code === 'COMPUTE_NO_LIVE_NODE'
  );
  assert.deepEqual(seen, [], 'nothing was enqueued for an asserted trust');
});
