/* A repo job the model mis-targets must still run somewhere real.
   ============================================================
   The reflection model names its own targets and repeatedly named the
   objective instead of a repository — 'McCluster',
   'McCluster/autonomous-data-center-pipeline', once the literal
   'owner/repo'. Each one failed on the node every night from the 14th.
   The allowlist check that stopped the failures also stopped the job
   running at all, so the fallback below is what keeps repo_health alive
   without letting the model pick an arbitrary repository. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReflectionPlan } from '../src/reflection-policy.mjs';

const plan = (jobs) => normalizeReflectionPlan({ next_jobs: jobs }).next_jobs;

test('a repo_health job with an objective-shaped target falls back to the canonical repo', () => {
  for (const bad of ['McCluster', 'McCluster/autonomous-data-center-pipeline', 'owner/repo', '']) {
    const [job] = plan([{ job_type: 'repo_health', target_id: bad, task: 'check the repo' }]);
    assert.ok(job, `repo_health was dropped for target ${JSON.stringify(bad)}`);
    assert.equal(job.target_id, 'mcclusterishere/mccluster');
    assert.equal(job.target_type, 'repository');
  }
});

test('an allowlisted target is honoured exactly as given', () => {
  const [job] = plan([
    { job_type: 'repo_health', target_id: 'mcclusterishere/mccluster', task: 'check' },
  ]);
  assert.equal(job.target_id, 'mcclusterishere/mccluster');
});

test('code_patch still refuses to guess a repository', () => {
  /* Reading a repo it was not pointed at is cheap to get wrong; WRITING to
     one is not, so the fallback deliberately does not cover code_patch. */
  const jobs = plan([{ job_type: 'code_patch', target_id: 'owner/repo', task: 'patch something' }]);
  assert.equal(jobs.length, 0);
});
