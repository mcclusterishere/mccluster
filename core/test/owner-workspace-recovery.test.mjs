import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerRoutedChat } from '../src/compute/owner-routing.mjs';
import { runResidentAgent } from '../src/resident-agent.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const TURN = '00000000-0000-4000-8000-000000000002';
const TASK = '00000000-0000-4000-8000-000000000003';
const NODE = `node_${'a'.repeat(32)}`;
const OTHER_NODE = `node_${'b'.repeat(32)}`;
const NOW = Date.parse('2026-11-22T15:00:00Z');
const ROUTE = { mode: 'node', node_id: NODE, implementation: 'qwen3.8b.local' };

function recoveredTask({ receiptNode = NODE, mode = 'node' } = {}) {
  const route = mode === 'node' ? ROUTE : { mode: 'auto', implementation: ROUTE.implementation };
  const task = { id: TASK, org_id: ORG, status: 'done', implementation: ROUTE.implementation, attempts: 1, locked_by_node_id: null,
    requirements: mode === 'node' ? { node_id: NODE } : {}, metadata: { turn_id: TURN, requested_route: route },
    output: { model: 'qwen3:8b', content: 'The completed answer survived the disconnect.', usage: { generation_tokens_per_second: 24 } } };
  const calls = { enqueue: 0, read: 0, requests: [], nodes: [] };
  const dependencies = {
    now: () => NOW,
    rest: async (resource, options) => {
      calls.requests.push(resource);
      if (resource === 'rpc/compute_owner_workspace_status') return { body: { version: 1, node_pinning: true, pair_reservations: true, turn_stop: true } };
      const url = new URL(resource, 'https://fixture.invalid/');
      if (url.pathname === '/ops_compute_tasks') {
        assert.equal(url.searchParams.get('org_id'), `eq.${ORG}`);
        assert.equal(url.searchParams.get('idempotency_key'), `eq.owner:${TURN}:0`);
        return { body: [task] };
      }
      if (url.pathname === '/ops_compute_leases') {
        assert.equal(url.searchParams.get('task_id'), `eq.${TASK}`);
        return { body: [{ node_id: receiptNode, status: 'done', attempt: 1, progress: {}, completed_at: new Date(NOW - 300_000).toISOString() }] };
      }
      throw new Error(`Unexpected recovery request ${resource}`);
    },
    listNodes: async args => {
      calls.nodes.push(args);
      return [{ id: NODE, display_name: 'Studio iMac', state: 'offline', last_seen_at: new Date(NOW - 600_000).toISOString(), capabilities: [], revoked_at: null }];
    },
    readTask: async args => { calls.read++; assert.equal(args.taskId, TASK); assert.equal(args.orgId, ORG); return task; },
    enqueue: async () => { calls.enqueue++; throw new Error('Completed work must not be enqueued again.'); },
    sleep: async () => { throw new Error('Completed work must not wait for an offline device.'); },
  };
  return { route, task, calls, dependencies };
}

test('saved completed Auto and pinned jobs reattach after their worker disconnects without fresh inference', async () => {
  for (const mode of ['auto', 'node']) {
    const fixture = recoveredTask({ mode }); const progress = [], linked = [];
    const result = await ownerRoutedChat({ orgId: ORG, route: fixture.route, metadata: { turn_id: TURN, round: 0 }, input: { prompt: 'Recover the saved answer' }, onProgress: update => progress.push(update), onTask: id => linked.push(id) }, fixture.dependencies);
    assert.equal(result.message.content, fixture.task.output.content);
    assert.equal(result.compute_task_id, TASK);
    assert.equal(result.node.node_id, NODE);
    assert.equal(result.node.node_name, 'Studio iMac');
    assert.equal(result.fallback_reason, null);
    assert.equal(fixture.calls.enqueue, 0);
    assert.equal(fixture.calls.read, 1);
    assert.equal(fixture.calls.nodes[0].liveOnly, false, 'historical execution receipts retain disconnected device names');
    assert.deepEqual(linked, [TASK]);
    assert.equal(progress.at(-1).status, 'done');
  }
});

test('recovery still rejects a completed receipt from the wrong worker for a pinned route', async () => {
  const fixture = recoveredTask({ receiptNode: OTHER_NODE });
  await assert.rejects(ownerRoutedChat({ orgId: ORG, route: ROUTE, metadata: { turn_id: TURN }, input: {} }, fixture.dependencies), { code: 'AI_ROUTE_RECEIPT_MISMATCH' });
  assert.equal(fixture.calls.enqueue, 0, 'receipt mismatch does not silently reroute or duplicate work');
});

const toolResponse = () => ({ model: 'qwen3:8b', message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'analysis_queue', arguments: { task: 'Prepare a review', evidence: 'Fixture evidence' } } }] } });
const agentArgs = extra => ({ messages: [{ role: 'user', content: 'Queue a review' }], context: { orgId: ORG, turnId: TURN, actorKind: 'owner' }, ownerRoute: { mode: 'auto', implementation: 'qwen3.8b.local' }, ...extra });

test('an abort received as the model returns tool calls prevents every tool side effect', async () => {
  const controller = new AbortController();
  const stopped = Object.assign(new Error('Stopped by owner'), { code: 'AI_TURN_STOPPED' });
  let executed = 0, checkpoints = 0;
  await assert.rejects(runResidentAgent(agentArgs({ signal: controller.signal, checkpoint: async () => { checkpoints++; } }), {
    chat: async () => { controller.abort(stopped); return toolResponse(); },
    execute: async () => { executed++; return { job_id: 'must-not-exist' }; },
  }), error => error === stopped);
  assert.equal(executed, 0);
  assert.equal(checkpoints, 0);
});

test('a durable owner Stop observed by the pre-tool checkpoint prevents execution without a local abort signal', async () => {
  const stopped = Object.assign(new Error('The saved run was stopped'), { code: 'LEASE_LOST' });
  let executed = 0, checkpoints = 0;
  await assert.rejects(runResidentAgent(agentArgs({ checkpoint: async receipts => { checkpoints++; assert.deepEqual(receipts, []); throw stopped; } }), {
    chat: async () => toolResponse(),
    execute: async () => { executed++; return { job_id: 'must-not-exist' }; },
  }), error => error === stopped);
  assert.equal(checkpoints, 1);
  assert.equal(executed, 0);
});

test('an abort during the awaited pre-tool checkpoint is checked again before execution', async () => {
  const controller = new AbortController();
  const stopped = Object.assign(new Error('Lease replaced during checkpoint'), { code: 'LEASE_LOST' });
  let executed = 0;
  await assert.rejects(runResidentAgent(agentArgs({ signal: controller.signal, checkpoint: async () => { controller.abort(stopped); } }), {
    chat: async () => toolResponse(),
    execute: async () => { executed++; return { job_id: 'must-not-exist' }; },
  }), error => error === stopped);
  assert.equal(executed, 0);
});
