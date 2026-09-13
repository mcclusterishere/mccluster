import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDependencyRows,
  dependencyEvidenceFromRows,
  dependencyIdsFromJob,
} from '../src/dependency-policy.mjs';

test('extracts and de-duplicates dependency ids', () => {
  const ids = dependencyIdsFromJob({ input: { plan: { depends_on_job_ids: ['a', 'b', 'a', ''] } } });
  assert.deepEqual(ids, ['a', 'b']);
});

test('marks dependency set ready only when all are done', () => {
  assert.equal(classifyDependencyRows(['a', 'b'], [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }]).state, 'ready');
  assert.equal(classifyDependencyRows(['a', 'b'], [{ id: 'a', status: 'done' }, { id: 'b', status: 'running' }]).state, 'waiting');
});

test('known failure wins over a simultaneously missing dependency', () => {
  const state = classifyDependencyRows(
    ['failed', 'missing'],
    [{ id: 'failed', status: 'failed' }],
  );
  assert.equal(state.state, 'failed');
  assert.deepEqual(state.failed_ids, ['failed']);
});

test('missing dependencies wait when no known failure exists', () => {
  const state = classifyDependencyRows(['a', 'b'], [{ id: 'a', status: 'done' }]);
  assert.equal(state.state, 'waiting');
  assert.deepEqual(state.missing_ids, ['b']);
});

test('dependency evidence carries bounded prerequisite outputs into downstream work', () => {
  const evidence = dependencyEvidenceFromRows(
    ['inspect'],
    [{
      id: 'inspect',
      job_type: 'repo_health',
      target_type: 'repo',
      target_id: 'mcclusterishere/mccluster',
      status: 'done',
      output: { summary: 'healthy', checks: ['tests', 'syntax'] },
      updated_at: '2026-09-13T00:00:00.000Z',
    }],
  );

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].status, 'done');
  assert.match(evidence[0].output_excerpt, /healthy/);
  assert.match(evidence[0].output_excerpt, /tests/);
});
