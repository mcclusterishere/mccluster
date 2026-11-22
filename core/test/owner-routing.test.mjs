import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerRoutedChat, taskExecution, normalizeOwnerRoute, requireWorkspaceOwner } from '../src/compute/owner-routing.mjs';
import { verifiedPairBenchmark, pairSummary } from '../src/compute/pairs.mjs';
import { ownerWorkspaceLanes, runJobLanes } from '../src/runner-lanes.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000003';
const A = `node_${'a'.repeat(40)}`, B = `node_${'b'.repeat(40)}`;
const nodes = [A, B].map(id => ({ id, display_name: id === A ? 'Office Mac' : 'Studio Mac', state: 'online', last_seen_at: new Date().toISOString(), capabilities: [{ capability: 'ai.chat', implementation: 'qwen3.8b.local' }, { capability: 'compute.pair.control', implementation: 'exo.mlx.local' }] }));
const status = { version: 1, node_pinning: true, pair_reservations: true, turn_stop: true };

test('owner access and route validation reject another organization and malformed pins', () => {
  assert.throws(() => requireWorkspaceOwner(ORG, { kind: 'member', user_id: OWNER }, { MCCLUSTER_ORG_ID: ORG }), { code: 'AI_OWNER_REQUIRED' });
  assert.throws(() => requireWorkspaceOwner(OWNER, { kind: 'owner', user_id: OWNER }, { MCCLUSTER_ORG_ID: ORG }), { code: 'CROSS_ORG_DENIED' });
  assert.throws(() => normalizeOwnerRoute({ mode: 'node', node_id: 'other' }), { code: 'AI_ROUTE_INVALID' });
  assert.throws(() => normalizeOwnerRoute({ implementation: 'invented' }), { code: 'AI_MODEL_UNAVAILABLE' });
});

test('a pin cannot silently enqueue on another worker or downgrade to an old schema', async () => {
  let enqueues = 0;
  const dependencies = { rest: async () => ({ body: status }), listNodes: async () => [{ ...nodes[0], state: 'draining' }], enqueue: async () => { enqueues += 1; } };
  await assert.rejects(ownerRoutedChat({ route: { mode: 'node', node_id: A }, orgId: ORG, input: {} }, dependencies), { code: 'AI_DEVICE_UNAVAILABLE' });
  await assert.rejects(ownerRoutedChat({ route: { mode: 'auto' }, orgId: ORG, input: {} }, { ...dependencies, rest: async () => ({ body: {} }) }), { code: 'AI_WORKSPACE_MIGRATION_PENDING' });
  assert.equal(enqueues, 0);
});

test('a durable pin uses queue requirements and the completed lease receipt after task ownership clears', async () => {
  let queued;
  const task = { id: OWNER, status: 'done', attempts: 1, locked_by_node_id: null, output: { content: 'A real receipt', model: 'qwen3:8b' }, implementation: 'qwen3.8b.local' };
  const dependencies = { rest: async path => ({ body: path.startsWith('rpc/') ? status : path.startsWith('ops_compute_tasks?') ? [] : [{ node_id: A, status: 'done', attempt: 1 }] }), listNodes: async () => nodes,
    enqueue: async args => { queued = args; return { task }; }, readTask: async () => task };
  const answer = await ownerRoutedChat({ route: { mode: 'node', node_id: A }, orgId: ORG, input: { prompt: 'Test' }, metadata: { turn_id: OWNER, round: 0 } }, dependencies);
  assert.deepEqual(queued.requirements, { node_id: A }); assert.equal(queued.input.strict_model, true);
  assert.equal(queued.idempotencyKey, `owner:${OWNER}:0`); assert.equal(answer.node.node_id, A); assert.equal(answer.fallback_reason, null);
  await assert.rejects(ownerRoutedChat({ route: { mode: 'node', node_id: B }, orgId: ORG, input: {} }, dependencies), { code: 'AI_ROUTE_RECEIPT_MISMATCH' });
});

test('Auto records recovery and ignores stale progress from an earlier attempt', async () => {
  const task = { id: OWNER, status: 'done', attempts: 2, output: { content: 'Recovered' } };
  const dependencies = { rest: async path => ({ body: path.startsWith('rpc/') ? status : [{ node_id: B, status: 'done', attempt: 2, progress: {} }] }), listNodes: async () => nodes, enqueue: async () => ({ task }), readTask: async () => task };
  const answer = await ownerRoutedChat({ route: { mode: 'auto' }, orgId: ORG, input: {} }, dependencies);
  assert.equal(answer.node.node_id, B); assert.match(answer.fallback_reason, /lease.*reassigned/i);
  const receipt = await taskExecution({ orgId: ORG, task: { ...task, status: 'queued' }, restImpl: async () => ({ body: [{ node_id: A, attempt: 1, progress: { content: 'stale text' } }] }) });
  assert.equal(receipt.content, '');
});

function pairFixture() {
  const pair = { node_ids: [A, B], state: 'ready' };
  pair.benchmark = { ok: true, shared_model_test: true, model_id: 'mlx-community/Qwen3.5-27B-4bit', model_revision: 'a'.repeat(40), node_ids: [A, B], runtime_node_ids: ['runtime-a', 'runtime-b'], runtime: { name: 'exo', version: 'fixture', commit: 'b'.repeat(40) }, network_backend: 'mlx-ring-tcp', model_traffic_local: true, context_tokens: 4096, prompt_tokens: 64, output_tokens: 32, time_to_first_token_ms: 25, output_tokens_per_second: 5, measured_at: new Date().toISOString(), devices: [A, B].map(node_id => ({ node_id, platform: 'darwin', arch: 'arm64', memory_bytes: 16 * 1024 ** 3, peak_memory_bytes: 10 * 1024 ** 3, free_memory_min_bytes: 5 * 1024 ** 3, peak_memory_verified: true, cleanup_confirmed: true })) };
  return pair;
}
test('pair readiness requires two distinct measured devices, exact revision, current proof and live controllers', () => {
  const pair = pairFixture();
  assert.equal(verifiedPairBenchmark(pair.benchmark, pair), true);
  assert.equal(pairSummary(pair, nodes).ready, true);
  for (const mutate of [p => p.benchmark.devices[1] = p.benchmark.devices[0], p => p.benchmark.model_revision = 'main', p => delete p.benchmark.measured_at, p => p.benchmark.devices[1].cleanup_confirmed = false, p => p.benchmark.devices[1].peak_memory_verified = false, p => p.benchmark.model_traffic_local = false]) {
    const changed = structuredClone(pair); mutate(changed); assert.equal(pairSummary(changed, nodes).ready, false);
  }
  assert.equal(pairSummary(pair, [{ ...nodes[0], state: 'revoked' }, nodes[1]]).ready, false);
  assert.equal(pairSummary({ ...pair, benchmark: null }, nodes).ready, false, 'two independent Ollama workers never constitute a shared model');
});

test('independent conversations run in bounded lanes while ordinary jobs retain their serial lane', async () => {
  const lanes = ownerWorkspaceLanes(['resident_ai_turn', 'repo_health', 'compute_pair_benchmark'], 2);
  let stop = false, total = 0; const active = new Map(), peaks = new Map();
  await runJobLanes({ lanes, shouldStop: () => stop, pause: async () => {}, pollMs: 1,
    cycle: async types => {
      const type = types[0], value = (active.get(type) || 0) + 1;
      active.set(type, value); peaks.set(type, Math.max(peaks.get(type) || 0, value));
      await new Promise(resolve => setTimeout(resolve, 10));
      active.set(type, value - 1); total += 1; if (total >= 4) stop = true; return true;
    } });
  assert.equal(peaks.get('resident_ai_turn'), 2); assert.equal(peaks.get('repo_health'), 1); assert.equal(peaks.get('compute_pair_benchmark'), 1);
});
