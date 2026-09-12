import test from 'node:test';
import assert from 'node:assert/strict';

import { extractJsonObject, normalizeReflectionPlan } from '../src/reflection-policy.mjs';

test('extractJsonObject accepts fenced model JSON', () => {
  const parsed = extractJsonObject('```json\n{"summary":"ok","next_jobs":[]}\n```');
  assert.equal(parsed.summary, 'ok');
});

test('reflection policy keeps only safe unattended jobs', () => {
  const plan = normalizeReflectionPlan({
    summary: 'advance safely',
    next_jobs: [
      {
        job_type: 'local_analysis',
        task: 'Analyze the supplied blockers.',
        target_type: 'portfolio',
        target_id: 'McCluster',
        priority: 40,
      },
      {
        job_type: 'code_patch',
        task: 'Change production code.',
        target_type: 'repo',
        target_id: 'mcclusterishere/mccluster',
        priority: 99,
      },
      {
        job_type: 'deploy',
        task: 'Deploy it.',
      },
      {
        job_type: 'repo_health',
        task: 'Inspect repository health using already-installed checks.',
        target_type: 'repo',
        target_id: 'mcclusterishere/mccluster',
      },
    ],
  }, { maxJobs: 3 });

  assert.deepEqual(plan.next_jobs.map((job) => job.job_type), ['local_analysis', 'repo_health']);
  assert.equal(plan.dropped_job_count, 2);
  assert.equal(plan.next_jobs[0].input.reflection_origin, true);
});

test('reflection policy bounds count, priority, and empty tasks', () => {
  const plan = normalizeReflectionPlan({
    next_jobs: [
      { job_type: 'local_analysis', task: 'one', priority: 500 },
      { job_type: 'repo_health', task: 'two', priority: -5 },
      { job_type: 'local_analysis', task: 'three' },
      { job_type: 'local_analysis', task: 'four' },
      { job_type: 'local_analysis', task: '' },
    ],
  }, { maxJobs: 2 });

  assert.equal(plan.next_jobs.length, 2);
  assert.equal(plan.next_jobs[0].priority, 100);
  assert.equal(plan.next_jobs[1].priority, 0);
});
