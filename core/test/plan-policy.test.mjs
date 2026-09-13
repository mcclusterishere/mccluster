import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedPlanJobTypes, normalizeObjectivePlan } from '../src/plan-policy.mjs';

test('planner allowlist is limited to safe evidence work', () => {
  assert.deepEqual(new Set(allowedPlanJobTypes()), new Set(['local_analysis', 'repo_health']));
});

test('planner accepts topologically ordered safe steps and clamps priority', () => {
  const plan = normalizeObjectivePlan({
    summary: 'inspect then analyze',
    steps: [
      { key: 'inspect', job_type: 'repo_health', task: 'Inspect repository', priority: 999 },
      { key: 'analyze', job_type: 'local_analysis', task: 'Analyze inspection', depends_on: ['inspect'], priority: -20 },
    ],
  });

  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].priority, 100);
  assert.equal(plan.steps[1].priority, 0);
  assert.deepEqual(plan.steps[1].depends_on, ['inspect']);
});

test('planner drops unsafe or forward-dependent steps', () => {
  const plan = normalizeObjectivePlan({
    steps: [
      { key: 'deploy', job_type: 'code_patch', task: 'Ship it' },
      { key: 'too-early', job_type: 'local_analysis', task: 'Analyze', depends_on: ['later'] },
      { key: 'later', job_type: 'repo_health', task: 'Inspect' },
    ],
  });

  assert.deepEqual(plan.steps.map((step) => step.key), ['later']);
  assert.equal(plan.dropped_step_count, 2);
});
