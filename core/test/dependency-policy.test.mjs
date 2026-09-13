import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDependencyRows, dependencyEvidence, dependencyIdsFromJob } from '../src/dependency-policy.mjs';

test('dependency IDs are deduplicated and bounded', () => {
  const ids = dependencyIdsFromJob({ input: { plan: { depends_on_job_ids: ['a', 'a', 'b'] } } });
  assert.deepEqual(ids, ['a', 'b']);
});

test('known failure wins over a missing dependency', () => {
  const result = classifyDependencyRows(['failed', 'missing'], [
    { id: 'failed', status: 'failed', output: null },
  ]);
  assert.equal(result.state, 'failed');
  assert.deepEqual(result.failed_ids, ['failed']);
});

test('unfinished dependency waits and complete dependencies become ready', () => {
  assert.equal(classifyDependencyRows(['a'], [{ id: 'a', status: 'running' }]).state, 'waiting');
  assert.equal(classifyDependencyRows(['a'], [{ id: 'a', status: 'done' }]).state, 'ready');
});

test('dependency evidence includes prerequisite output', () => {
  const evidence = dependencyEvidence([
    {
      id: 'a',
      job_type: 'repo_health',
      target_type: 'repo',
      target_id: 'mcclusterishere/mccluster',
      status: 'done',
      output: { tests: 'green' },
      updated_at: '2026-09-12T00:00:00Z',
    },
  ]);
  assert.equal(evidence[0].job_id, 'a');
  assert.deepEqual(evidence[0].output, { tests: 'green' });
});
