import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveReflection } from '../src/executors/objective-reflection.mjs';

// Audit finding C2: partial child scheduling followed by a parent retry
// re-planned and re-enqueued the first child. Synthetic deps, no database.
const ORG = '123e4567-e89b-42d3-a456-426614174000';
const JOB = '323e4567-e89b-42d3-a456-426614174000';

function harness() {
  const rows = new Map();
  let calls = 0; let chats = 0; let checkpointed = null;
  const deps = {
    getObjectives: async () => [], getJobs: async () => [], getHealth: async () => null,
    chat: async () => { chats += 1; return { model: 'synthetic', message: { content: JSON.stringify({ summary: 'Two checks', next_jobs: [
      { job_type: 'repo_health', task: 'Check repository', target_id: 'mcclusterishere/mccluster' },
      { job_type: 'local_analysis', task: 'Review supplied evidence' },
    ] }) } }; },
    checkpoint: async (job, input) => { checkpointed = input; return { ...job, input }; },
    enqueue: async value => {
      calls += 1;
      if (calls === 2) throw new Error('synthetic second-insert failure');
      if (!value.jobId) throw new Error('child enqueue must carry a stable jobId');
      if (!rows.has(value.jobId)) rows.set(value.jobId, { ...value, id: value.jobId, job_type: value.jobType });
      return rows.get(value.jobId);
    },
  };
  return { deps, rows, chats: () => chats, checkpoint: () => checkpointed };
}

test('a reflection retry after a partial enqueue reuses the stored plan and creates each child exactly once', async () => {
  const h = harness();
  const job = { id: JOB, org_id: ORG, job_type: 'objective_reflection', input: { max_next_jobs: 2 } };
  await assert.rejects(objectiveReflection(job, h.deps), /second-insert/);
  assert.ok(h.checkpoint()?.objective_reflection_checkpoint, 'the normalized plan is checkpointed before any child is enqueued');
  const result = await objectiveReflection({ ...job, attempts: 2, input: h.checkpoint() }, h.deps);
  assert.equal(h.chats(), 1, 'the retry does not ask the model for another plan');
  assert.equal(h.rows.size, 2);
  assert.deepEqual([...h.rows.values()].map(r => r.jobType), ['repo_health', 'local_analysis']);
  assert.equal(result.queued_jobs.length, 2);
  assert.ok(result.queued_jobs.every(q => /^[0-9a-f-]{36}$/.test(q.id)));
  assert.equal(result.plan_source, 'checkpoint');
});

test('child job identities are derived deterministically from the parent and plan step', async () => {
  const a = harness(); const b = harness();
  const job = { id: JOB, org_id: ORG, job_type: 'objective_reflection', input: { max_next_jobs: 2 } };
  a.deps.enqueue = async value => ({ ...value, id: value.jobId, job_type: value.jobType });
  b.deps.enqueue = a.deps.enqueue;
  const [ra, rb] = [await objectiveReflection(job, a.deps), await objectiveReflection(job, b.deps)];
  assert.deepEqual(ra.queued_jobs.map(q => q.id), rb.queued_jobs.map(q => q.id));
  assert.notEqual(ra.queued_jobs[0].id, ra.queued_jobs[1].id);
});
