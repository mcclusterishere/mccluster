import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDependencyRows, dependencyIdsFromJob } from '../src/dependency-policy.mjs';


test('extracts and de-duplicates dependency ids', () => {
  const ids = dependencyIdsFromJob({ input: { plan: { depends_on_job_ids: ['a', 'b', 'a', ''] } } });
  assert.deepEqual(ids, ['a', 'b']);
});


test('marks dependency set ready only when all are done', () => {
  assert.equal(classifyDependencyRows(['a', 'b'], [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }]).state, 'ready');
  assert.equal(classifyDependencyRows(['a', 'b'], [{ id: 'a', status: 'done' }, { id: 'b', status: 'running' }]).state, 'waiting');
});


test('fails closed on failed or missing dependencies', () => {
  const failed = classifyDependencyRows(['a', 'b'], [{ id: 'a', status: 'done' }, { id: 'b', status: 'failed' }]);
  assert.equal(failed.state, 'failed');
  assert.deepEqual(failed.failed_ids, ['b']);

  const missing = classifyDependencyRows(['a', 'b'], [{ id: 'a', status: 'done' }]);
  assert.equal(missing.state, 'waiting');
  assert.deepEqual(missing.missing_ids, ['b']);
});
