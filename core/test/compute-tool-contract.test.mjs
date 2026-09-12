import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeComputeEnqueueResult } from '../src/tools/compute.mjs';

test('compute broker preserves the public task response shape', () => {
  const task = { id: '11111111-1111-1111-1111-111111111111', status: 'queued' };
  const result = normalizeComputeEnqueueResult({ task, replayed: false });

  assert.equal(result.task, task);
  assert.equal(result.task.id, task.id);
  assert.equal(result.replayed, false);
  assert.equal(result.task.task, undefined);
});

test('compute broker exposes idempotent replay without nesting the task', () => {
  const task = { id: '22222222-2222-2222-2222-222222222222', status: 'queued' };
  const result = normalizeComputeEnqueueResult({ task, replayed: true });

  assert.equal(result.task.id, task.id);
  assert.equal(result.replayed, true);
});

test('compute broker fails closed when enqueue returns no task', () => {
  assert.throws(
    () => normalizeComputeEnqueueResult({ task: null, replayed: false }),
    (error) => error?.status === 503 && error?.code === 'COMPUTE_ENQUEUE_FAILED'
  );
});
