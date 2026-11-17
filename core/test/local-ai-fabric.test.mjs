// Fabric-first local AI (MCCLUSTER_LOCAL_AI_FABRIC=prefer) with injected store
// functions and a fake clock: Core's own executors hand ai.chat to a live
// GPU-verified node through the compute fabric, wait a bounded time, cancel a
// task that is still queued and run locally, and never run locally while a
// node owns the task.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fabricConfigFromEnv, localAiChat } from '../src/compute/local-ai-client.mjs';

const ORG = '00000000-0000-0000-0000-000000000001';
const chat = (capabilities = [{ capability: 'ai.chat', implementation: 'qwen3.8b.local' }]) => capabilities;
const gpuNode = { id: 'node_gpu', display_name: 'owner-windows-gpu', inventory: { runtime: { hardware_mode: 'gpu-verified' } }, capabilities: chat() };
const ovhNode = { id: 'node_ovh', display_name: 'ovh-primary', inventory: { runtime: { hardware_mode: 'gpu-verified' } }, capabilities: chat() };
const unverifiedNode = { id: 'node_pilot', display_name: 'owner-windows-pilot', inventory: { runtime: { hardware_mode: 'gpu-present-unverified' } }, capabilities: chat() };
const otherModelNode = { id: 'node_14b', display_name: 'owner-desktop', inventory: { runtime: { hardware_mode: 'gpu-verified' } }, capabilities: chat([{ capability: 'ai.chat', implementation: 'qwen3.14b.local' }]) };
const adapterOutput = {
  model: 'qwen3:8b', model_source: 'implementation', implementation: 'qwen3.8b.local', content: 'fabric answer', tool_calls: [], done_reason: 'stop',
  settings: { think: false }, thinking_chars: 0, queue_wait_ms: 7, usage: { prompt_eval_count: 12, eval_count: 30, total_duration_ns: 900 }
};

function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

function localFetch() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ model: 'qwen3:8b', implementation: 'core-local', content: 'local answer', queue_wait_ms: 1, usage: { eval_count: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

function harness({ nodes = [gpuNode], statuses = [{ status: 'done', output: adapterOutput }], enqueue, cancel, listNodes } = {}) {
  const calls = { enqueue: [], poll: 0, cancel: [], events: [] };
  let index = 0;
  const fabric = {
    mode: 'prefer', waitMs: 10_000, pollMs: 1_000, runningWaitMs: 30_000, implementation: 'qwen3.8b.local', excludeNodes: new Set(['ovh-primary']), orgId: ORG,
    listNodes: listNodes || (async () => nodes),
    enqueueComputeTask: enqueue || (async (args) => { calls.enqueue.push(args); return { task: { id: 'task-1', status: 'queued' }, replayed: false }; }),
    computeTaskById: async () => {
      calls.poll += 1;
      const next = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      return typeof next === 'function' ? next() : next;
    },
    cancelQueuedComputeTask: cancel || (async (args) => { calls.cancel.push(args); return { id: 'task-1', status: 'canceled' }; })
  };
  const local = localFetch();
  const time = clock();
  const options = { fetchImpl: local.fetchImpl, fabric, now: time.now, sleep: time.sleep, log: (record) => calls.events.push(record) };
  return { fabric, calls, local, options, events: () => calls.events.map((event) => event.event) };
}

test('mode off: the local adapter answers and the result says the fabric was not attempted', async () => {
  const h = harness();
  h.fabric.mode = 'off';
  const result = await localAiChat({ messages: [{ role: 'user', content: 'hello' }], priority: -20 }, h.options);
  assert.equal(result.message.content, 'local answer');
  assert.equal(result.route, 'local');
  assert.equal(result.compute_task_id, null);
  assert.deepEqual(result.fabric, { attempted: false, reason: 'disabled', wait_ms: null });
  assert.equal(h.local.calls.length, 1);
  assert.equal(h.local.calls[0].url, 'http://127.0.0.1:4790/execute');
  assert.equal(h.local.calls[0].body.implementation, 'core-local');
  assert.equal(h.local.calls[0].body.metadata.source, 'core-local-ai-client');
  assert.equal(h.calls.enqueue.length, 0);
});

test('an invalid mode or a missing organization behaves as off and says why once', async () => {
  const invalid = harness();
  invalid.fabric.mode = 'invalid';
  await localAiChat({ prompt: 'x' }, invalid.options);
  await localAiChat({ prompt: 'x' }, invalid.options);
  assert.equal(invalid.calls.enqueue.length, 0);
  assert.deepEqual(invalid.calls.events.filter((event) => event.event === 'local_ai_fabric_disabled').map((event) => event.reason), ['invalid_mode'], 'logged once per process, not per call');

  const noOrg = harness();
  noOrg.fabric.orgId = null;
  const result = await localAiChat({ prompt: 'x' }, noOrg.options);
  assert.equal(result.route, 'local');
  assert.equal(result.fabric.reason, 'disabled');
  assert.equal(noOrg.calls.enqueue.length, 0);
});

test('no eligible node: excluded, unverified or other-implementation nodes never receive Core work', async () => {
  const h = harness({ nodes: [ovhNode, unverifiedNode, otherModelNode] });
  const result = await localAiChat({ prompt: 'x' }, h.options);
  assert.equal(result.route, 'local');
  assert.deepEqual(result.fabric, { attempted: true, reason: 'no_eligible_node', wait_ms: null });
  assert.equal(h.calls.enqueue.length, 0);
  assert.equal(h.local.calls.length, 1);
  assert.deepEqual(h.events(), ['local_ai_fabric_fallback']);
});

test('an eligible GPU node runs the task and the node output is shaped like the adapter answer', async () => {
  const h = harness({ statuses: [{ status: 'leased' }, { status: 'running' }, { status: 'done', output: adapterOutput }] });
  const result = await localAiChat({ messages: [{ role: 'user', content: 'hello' }], temperature: 0.1, numCtx: 8192, numPredict: 256, json: true, priority: -20, metadata: { job_type: 'objective_plan' } }, h.options);
  assert.equal(result.route, 'fabric');
  assert.equal(result.compute_task_id, 'task-1');
  assert.deepEqual(result.fabric, { attempted: true, reason: 'done', wait_ms: 3_000 });
  assert.equal(result.message.content, 'fabric answer');
  assert.equal(result.model, 'qwen3:8b');
  assert.equal(result.implementation, 'qwen3.8b.local');
  assert.equal(result.queue_wait_ms, 7);
  assert.equal(result.prompt_eval_count, 12);
  assert.equal(result.eval_count, 30);
  assert.equal(result.total_duration, 900);
  assert.equal(h.local.calls.length, 0, 'the local adapter is never called when the fabric answered');
  assert.equal(h.calls.poll, 3);

  const [enqueued] = h.calls.enqueue;
  assert.equal(enqueued.orgId, ORG);
  assert.equal(enqueued.capability, 'ai.chat');
  assert.equal(enqueued.implementation, 'qwen3.8b.local');
  assert.deepEqual(enqueued.requirements, { features: { gpu: true } });
  assert.equal(enqueued.maxAttempts, 1);
  assert.equal(enqueued.priority, -20);
  assert.equal(enqueued.metadata.source, 'local-ai-fabric');
  assert.equal(enqueued.metadata.job_type, 'objective_plan');
  assert.ok(Number.isFinite(Date.parse(enqueued.metadata.requested_at)));
  assert.deepEqual(enqueued.input, {
    messages: [{ role: 'user', content: 'hello' }], temperature: 0.1, num_ctx: 8192, num_predict: 256, think: false, json: true
  }, 'the task input is exactly what the local path would POST as /execute input');
  assert.deepEqual(h.events(), ['local_ai_fabric_enqueued', 'local_ai_fabric_done']);
});

test('the fabric input and the local input are the same object shape', async () => {
  const fabricRun = harness();
  await localAiChat({ prompt: 'summarize', tools: [{ type: 'function', function: { name: 'f' } }], schema: { type: 'object' }, model: 'qwen3:14b', think: true }, fabricRun.options);
  const localRun = harness();
  localRun.fabric.mode = 'off';
  await localAiChat({ prompt: 'summarize', tools: [{ type: 'function', function: { name: 'f' } }], schema: { type: 'object' }, model: 'qwen3:14b', think: true }, localRun.options);
  assert.deepEqual(fabricRun.calls.enqueue[0].input, localRun.local.calls[0].body.input);
});

test('a failed or canceled task falls back to the local adapter', async () => {
  for (const status of ['failed', 'canceled']) {
    const h = harness({ statuses: [{ status: 'leased' }, { status, last_error: 'node broke' }] });
    const result = await localAiChat({ prompt: 'x' }, h.options);
    assert.equal(result.route, 'local');
    assert.equal(result.message.content, 'local answer');
    assert.deepEqual(result.fabric, { attempted: true, reason: 'failed', wait_ms: 2_000 });
    assert.equal(h.calls.cancel.length, 0);
  }
});

test('the wait exceeded while still queued: the task is canceled atomically and the local adapter runs', async () => {
  const h = harness({ statuses: [{ status: 'queued' }] });
  const result = await localAiChat({ prompt: 'x' }, h.options);
  assert.equal(result.route, 'local');
  assert.deepEqual(result.fabric, { attempted: true, reason: 'wait_timeout_canceled', wait_ms: 10_000 });
  assert.equal(h.calls.cancel.length, 1);
  assert.deepEqual(h.calls.cancel[0], { orgId: ORG, taskId: 'task-1', reason: 'canceled: local-ai-fabric wait exceeded' });
  assert.equal(h.calls.poll, 10);
  assert.deepEqual(h.events(), ['local_ai_fabric_enqueued', 'local_ai_fabric_canceled', 'local_ai_fabric_fallback']);
});

test('a cancel that finds the task already claimed keeps polling, and a later done is returned without any local run', async () => {
  const statuses = [...Array(10).fill({ status: 'queued' }), { status: 'running' }, { status: 'done', output: adapterOutput }];
  const h = harness({ statuses, cancel: async (args) => { h.calls.cancel.push(args); return null; } });
  const result = await localAiChat({ prompt: 'x' }, h.options);
  assert.equal(result.route, 'fabric');
  assert.equal(result.message.content, 'fabric answer');
  assert.equal(result.fabric.wait_ms, 12_000);
  assert.equal(h.calls.cancel.length, 1);
  assert.equal(h.local.calls.length, 0);
});

test('a task a node still holds past the running wait throws a retryable timeout; the local adapter is never a silent duplicate', async () => {
  const h = harness({ statuses: [{ status: 'running' }] });
  await assert.rejects(localAiChat({ prompt: 'x' }, h.options), (error) => {
    assert.equal(error.code, 'LOCAL_AI_FABRIC_TIMEOUT');
    assert.equal(error.status, 504);
    assert.equal(error.retryable, true);
    assert.equal(error.compute_task_id, 'task-1');
    return true;
  });
  assert.equal(h.local.calls.length, 0);
  assert.equal(h.calls.cancel.length, 0);
  assert.equal(h.calls.poll, 40, 'waitMs + runningWaitMs at one poll per second');
  assert.ok(h.events().includes('local_ai_fabric_timeout'));
});

test('route local forces the local adapter even with an eligible node', async () => {
  const h = harness();
  const result = await localAiChat({ prompt: 'x', route: 'local' }, h.options);
  assert.equal(result.route, 'local');
  assert.deepEqual(result.fabric, { attempted: false, reason: 'disabled', wait_ms: null });
  assert.equal(h.calls.enqueue.length, 0);
});

test('an enqueue that throws or returns no task falls back to the local adapter', async () => {
  const thrown = harness({ enqueue: async () => { throw new Error('rpc down'); } });
  const first = await localAiChat({ prompt: 'x' }, thrown.options);
  assert.equal(first.route, 'local');
  assert.deepEqual(first.fabric, { attempted: true, reason: 'enqueue_failed', wait_ms: null });

  const empty = harness({ enqueue: async () => ({ task: null, replayed: false }) });
  const second = await localAiChat({ prompt: 'x' }, empty.options);
  assert.equal(second.fabric.reason, 'enqueue_failed');
  assert.equal(empty.calls.poll, 0);
});

test('three consecutive failed reads take the queued task back first; the local adapter runs only once the cancel won', async () => {
  const h = harness({ statuses: [null] });
  const result = await localAiChat({ prompt: 'x' }, h.options);
  assert.equal(result.route, 'local');
  assert.deepEqual(result.fabric, { attempted: true, reason: 'poll_failed', wait_ms: 3_000 });
  assert.equal(h.calls.poll, 3);
  assert.equal(h.calls.cancel.length, 1, 'the task is canceled before any local run');
  assert.deepEqual(h.calls.cancel[0], { orgId: ORG, taskId: 'task-1', reason: 'canceled: local-ai-fabric task reads failed' });
  assert.equal(h.local.calls.length, 1);
  assert.deepEqual(h.events(), ['local_ai_fabric_enqueued', 'local_ai_fabric_canceled', 'local_ai_fabric_fallback']);
});

test('failed reads whose cancel finds the task claimed keep polling; a later done is returned and the local adapter never runs', async () => {
  const statuses = [null, null, null, { status: 'running' }, { status: 'done', output: adapterOutput }];
  const h = harness({ statuses, cancel: async (args) => { h.calls.cancel.push(args); return null; } });
  const result = await localAiChat({ prompt: 'x' }, h.options);
  assert.equal(result.route, 'fabric');
  assert.equal(result.message.content, 'fabric answer');
  assert.equal(h.calls.cancel.length, 1);
  assert.equal(h.calls.poll, 5);
  assert.equal(h.local.calls.length, 0, 'ownership was unknown, then a node held it: never a local duplicate');
});

test('failed reads with a failing cancel never run locally: the retryable timeout is thrown at the running bound', async () => {
  const h = harness({ statuses: [null], cancel: async (args) => { h.calls.cancel.push(args); throw new Error('PostgREST 503'); } });
  await assert.rejects(localAiChat({ prompt: 'x' }, h.options), (error) => {
    assert.equal(error.code, 'LOCAL_AI_FABRIC_TIMEOUT');
    assert.equal(error.retryable, true);
    assert.equal(error.compute_task_id, 'task-1');
    return true;
  });
  assert.equal(h.local.calls.length, 0);
  assert.equal(h.calls.poll, 42, 'three reads per cancel attempt up to waitMs + runningWaitMs');
  assert.equal(h.calls.cancel.length, 14);
  const timeout = h.calls.events.find((event) => event.event === 'local_ai_fabric_timeout');
  assert.equal(timeout.status, 'unknown');
});

test('a queued task whose cancel keeps failing past the running bound is a timeout, not a local run', async () => {
  const h = harness({ statuses: [{ status: 'queued' }], cancel: async (args) => { h.calls.cancel.push(args); throw new Error('PostgREST 503'); } });
  await assert.rejects(localAiChat({ prompt: 'x' }, h.options), (error) => error.code === 'LOCAL_AI_FABRIC_TIMEOUT');
  assert.equal(h.local.calls.length, 0);
  assert.equal(h.calls.poll, 40);
});

test("the caller's timeoutMs bounds the fabric: half of it for the claim, all of it before a held task times out", async () => {
  const held = harness({ statuses: [{ status: 'running' }] });
  await assert.rejects(localAiChat({ prompt: 'x', timeoutMs: 30_000 }, held.options), (error) => error.code === 'LOCAL_AI_FABRIC_TIMEOUT');
  assert.equal(held.calls.poll, 30, 'the 30 s budget, not waitMs + runningWaitMs (40 s)');
  assert.equal(held.local.calls.length, 0);

  const queued = harness({ statuses: [{ status: 'queued' }] });
  const result = await localAiChat({ prompt: 'x', timeoutMs: 40_000 }, queued.options);
  assert.equal(result.route, 'local');
  assert.deepEqual(result.fabric, { attempted: true, reason: 'wait_timeout_canceled', wait_ms: 10_000 }, 'waitMs (10 s) is already under half the budget (20 s)');
  const shortBudget = harness({ statuses: [{ status: 'queued' }] });
  shortBudget.fabric.waitMs = 100_000;
  const shortResult = await localAiChat({ prompt: 'x', timeoutMs: 12_000 }, shortBudget.options);
  assert.equal(shortResult.fabric.reason, 'wait_timeout_canceled');
  assert.equal(shortResult.fabric.wait_ms, 15_000, 'the budget floor is 30 s, so the claim wait is capped at 15 s');
  assert.equal(shortBudget.calls.poll, 15);

  const tiny = harness({ statuses: [{ status: 'queued' }] });
  const tinyResult = await localAiChat({ prompt: 'x', timeoutMs: 16_000 }, tiny.options);
  assert.equal(tinyResult.fabric.wait_ms, 10_000, 'a configured waitMs shorter than half the budget still wins');
});

test('a node read failure is not an eligible node', async () => {
  const h = harness({ listNodes: async () => { throw new Error('control plane unreachable'); } });
  const result = await localAiChat({ prompt: 'x' }, h.options);
  assert.equal(result.route, 'local');
  assert.equal(result.fabric.reason, 'no_eligible_node');
  assert.equal(h.calls.enqueue.length, 0);
});

test('a caller abort during the wait cancels a queued task and never runs locally', async () => {
  const controller = new AbortController();
  const h = harness({ statuses: [{ status: 'queued' }, () => { controller.abort(new Error('private reason')); return { status: 'queued' }; }] });
  await assert.rejects(localAiChat({ prompt: 'x', signal: controller.signal }, h.options), (error) => {
    assert.equal(error.code, 'CALLER_ABORTED');
    assert.equal(error.retryable, false);
    assert.equal(error.compute_task_id, 'task-1');
    assert.doesNotMatch(error.message, /private reason/);
    return true;
  });
  assert.equal(h.calls.cancel.length, 1);
  assert.equal(h.local.calls.length, 0);
});

test('the fabric configuration comes from the environment with bounded values', () => {
  const defaults = fabricConfigFromEnv({});
  assert.equal(defaults.mode, 'off');
  assert.equal(defaults.waitMs, 120_000);
  assert.equal(defaults.pollMs, 1_500);
  assert.equal(defaults.runningWaitMs, 600_000);
  assert.equal(defaults.implementation, 'qwen3.8b.local');
  assert.deepEqual([...defaults.excludeNodes], ['ovh-primary']);
  assert.equal(defaults.orgId, null);

  const tuned = fabricConfigFromEnv({
    MCCLUSTER_LOCAL_AI_FABRIC: 'PREFER', MCCLUSTER_LOCAL_AI_FABRIC_WAIT_MS: '5000', MCCLUSTER_LOCAL_AI_FABRIC_POLL_MS: '100',
    MCCLUSTER_LOCAL_AI_FABRIC_RUNNING_WAIT_MS: '99999999', MCCLUSTER_LOCAL_AI_FABRIC_IMPLEMENTATION: 'qwen3.14b.local',
    MCCLUSTER_LOCAL_AI_FABRIC_EXCLUDE_NODES: 'ovh-primary, ovh-secondary', MCCLUSTER_NODE_NAME: 'this-box', MCCLUSTER_ORG_ID: ORG
  });
  assert.equal(tuned.mode, 'prefer');
  assert.equal(tuned.waitMs, 10_000, 'floor');
  assert.equal(tuned.pollMs, 250, 'floor');
  assert.equal(tuned.runningWaitMs, 3_600_000, 'ceiling');
  assert.equal(tuned.implementation, 'qwen3.14b.local');
  assert.deepEqual([...tuned.excludeNodes], ['ovh-primary', 'ovh-secondary', 'this-box']);
  assert.equal(tuned.orgId, ORG);
  assert.equal(fabricConfigFromEnv({ MCCLUSTER_LOCAL_AI_FABRIC: 'sometimes' }).mode, 'invalid');
});
