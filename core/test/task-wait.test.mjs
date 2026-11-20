// awaitComputeTask: the shared bounded wait for a durable compute task (used
// by browser_act): done returns the task, failed/canceled throw, the deadline
// cancels a task that is still queued and throws a timeout otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitComputeTask } from '../src/compute/task-wait.mjs';

const ORG = '00000000-0000-0000-0000-000000000001';
function harness(statuses, { cancel } = {}) {
  let t = 1_000_000; let index = 0;
  const calls = { reads: 0, cancels: [] };
  const deps = {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    computeTaskById: async ({ orgId, taskId }) => {
      assert.equal(orgId, ORG); assert.equal(taskId, 'task-1');
      calls.reads += 1;
      const next = statuses[Math.min(index, statuses.length - 1)]; index += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    cancelQueuedComputeTask: cancel || (async (args) => { calls.cancels.push(args); return { id: 'task-1', status: 'canceled' }; })
  };
  return { deps, calls };
}

test('a task that finishes is returned with its wait and poll count', async () => {
  const h = harness([{ status: 'queued' }, { status: 'leased' }, { status: 'running' }, { status: 'done', output: { ok: true }, locked_by_node_id: 'node_a' }]);
  const result = await awaitComputeTask({ orgId: ORG, taskId: 'task-1', deadlineMs: 30_000, pollMs: 1_000 }, h.deps);
  assert.equal(result.task.status, 'done');
  assert.equal(result.task.locked_by_node_id, 'node_a');
  assert.equal(result.waitMs, 4_000);
  assert.equal(result.polls, 4);
  assert.equal(h.calls.cancels.length, 0);
});

test('a failed or canceled task throws COMPUTE_TASK_FAILED with the task id and its last error, never a retryable flag', async () => {
  for (const status of ['failed', 'canceled']) {
    const h = harness([{ status: 'running' }, { status, last_error: 'BROWSER_UNAVAILABLE: playwright not found' }]);
    await assert.rejects(awaitComputeTask({ orgId: ORG, taskId: 'task-1', deadlineMs: 30_000, pollMs: 1_000 }, h.deps), (error) => {
      assert.equal(error.code, 'COMPUTE_TASK_FAILED');
      assert.equal(error.status, 502);
      assert.equal(error.retryable, false);
      assert.equal(error.task_id, 'task-1');
      assert.equal(error.task_status, status);
      assert.match(error.last_error, /BROWSER_UNAVAILABLE/);
      return true;
    });
  }
});

test('past the deadline a task still queued is canceled atomically and the timeout names it', async () => {
  const h = harness([{ status: 'queued' }]);
  await assert.rejects(awaitComputeTask({ orgId: ORG, taskId: 'task-1', deadlineMs: 5_000, pollMs: 1_000 }, h.deps), (error) => {
    assert.equal(error.code, 'COMPUTE_TASK_TIMEOUT');
    assert.equal(error.status, 504);
    assert.equal(error.retryable, false);
    assert.equal(error.task_id, 'task-1');
    assert.equal(error.task_status, 'queued');
    assert.equal(error.canceled, true);
    return true;
  });
  assert.equal(h.calls.reads, 5);
  assert.deepEqual(h.calls.cancels, [{ orgId: ORG, taskId: 'task-1', reason: 'canceled: wait deadline passed' }]);
});

test('a task a node holds past the deadline is never canceled; the timeout says it is still running', async () => {
  const h = harness([{ status: 'running' }]);
  await assert.rejects(awaitComputeTask({ orgId: ORG, taskId: 'task-1', deadlineMs: 3_000, pollMs: 1_000 }, h.deps), (error) => error.code === 'COMPUTE_TASK_TIMEOUT' && error.task_status === 'running' && error.canceled === false);
  assert.equal(h.calls.cancels.length, 0);
});

test('failed reads are tolerated; three in a row make the status unknown and a deadline then tries the cancel', async () => {
  const recovered = harness([new Error('503'), null, { status: 'done', output: {} }]);
  const result = await awaitComputeTask({ orgId: ORG, taskId: 'task-1', deadlineMs: 10_000, pollMs: 1_000 }, recovered.deps);
  assert.equal(result.task.status, 'done');
  const unknown = harness([null], { cancel: async (args) => { unknown.calls.cancels.push(args); return null; } });
  await assert.rejects(awaitComputeTask({ orgId: ORG, taskId: 'task-1', deadlineMs: 4_000, pollMs: 1_000 }, unknown.deps), (error) => error.code === 'COMPUTE_TASK_TIMEOUT' && error.task_status === 'unknown' && error.canceled === false);
  assert.equal(unknown.calls.cancels.length, 1, 'ownership unknown: the cancel is attempted; a null answer means a node may hold it');
});

test('a missing org or task id is refused before any read, and the poll interval is bounded', async () => {
  const h = harness([{ status: 'done' }]);
  await assert.rejects(awaitComputeTask({ orgId: ORG, taskId: '' }, h.deps), (error) => error.code === 'COMPUTE_TASK_INVALID' && error.status === 400);
  assert.equal(h.calls.reads, 0);
  const fast = harness([{ status: 'queued' }, { status: 'done' }]);
  const result = await awaitComputeTask({ orgId: ORG, taskId: 'task-1', deadlineMs: 2_000, pollMs: 1 }, fast.deps);
  assert.equal(result.waitMs, 200, 'the poll floor is 100 ms');
});
