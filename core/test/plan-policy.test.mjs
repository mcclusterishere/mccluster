import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObjectivePlan } from '../src/plan-policy.mjs';

test('accepts a topologically ordered safe DAG', () => {
  const plan = normalizeObjectivePlan({
    steps: [
      { key: 'inspect', job_type: 'repo_health', task: 'Inspect repo health', depends_on: [] },
      { key: 'analyze', job_type: 'local_analysis', task: 'Analyze findings', depends_on: ['inspect'] },
      { key: 'parallel', job_type: 'local_analysis', task: 'Analyze objective context', depends_on: [] },
      { key: 'synthesize', job_type: 'local_analysis', task: 'Synthesize', depends_on: ['analyze', 'parallel'] },
    ],
  });

  assert.equal(plan.steps.length, 4);
  assert.deepEqual(plan.steps[3].depends_on, ['analyze', 'parallel']);
});

test('rejects unsafe and forward dependencies', () => {
  const plan = normalizeObjectivePlan({
    steps: [
      { key: 'future', job_type: 'local_analysis', task: 'bad forward dep', depends_on: ['later'] },
      { key: 'later', job_type: 'local_analysis', task: 'later work', depends_on: [] },
      { key: 'deploy', job_type: 'deploy', task: 'deploy prod', depends_on: [] },
      { key: 'patch', job_type: 'code_patch', task: 'edit code', depends_on: [] },
    ],
  });

  assert.deepEqual(plan.steps.map((step) => step.key), ['later']);
  assert.equal(plan.dropped_step_count, 3);
});

test('bounds plan size and priority', () => {
  const plan = normalizeObjectivePlan({
    steps: Array.from({ length: 20 }, (_, index) => ({
      key: `step_${index}`,
      job_type: 'local_analysis',
      task: `task ${index}`,
      depends_on: [],
      priority: 999,
    })),
  }, { maxSteps: 5 });

  assert.equal(plan.steps.length, 5);
  assert.ok(plan.steps.every((step) => step.priority === 100));
});
