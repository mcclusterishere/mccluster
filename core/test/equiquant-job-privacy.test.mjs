import test from 'node:test';
import assert from 'node:assert/strict';

// These Supabase clients capture the environment on import. No network transport is used.
process.env.SUPABASE_URL = 'https://isolated-queue.invalid';
process.env.SUPABASE_SECRET_KEY = 'isolated-queue-fixture';
const { recentJobs } = await import('../src/supabase.mjs');
const { queuedJobs, runningJobs } = await import('../src/tools/resume.mjs');
const { executeResidentTool } = await import('../src/resident-tools.mjs');
const { loadReflectionJobs } = await import('../src/reflection-context.mjs');
const { prepareClaimedDagJob } = await import('../src/objective-dag-store.mjs');
const { failureDetails } = await import('../src/health-details.mjs');
const { emitCoreEvent } = await import('../src/observability.mjs');

const privateJob = {
  id: '00000000-0000-4000-8000-000000000001', org_id: '00000000-0000-4000-8000-000000000002',
  job_type: 'equiquant_mosaic_replay', target_id: 'private-project', status: 'done',
  output: { scenario: 'pooled' },
};
const otherJob = { ...privateJob, id: '00000000-0000-4000-8000-000000000003', job_type: 'local_analysis', target_id: 'shared' };

test('shared operator reads omit project job details across queue history, digest, resume, reflection and resident lookup', async t => {
  const query = url => {
    const q = new URL(url, 'https://isolated-queue.invalid').searchParams;
    return [privateJob, otherJob].filter(row =>
      !q.getAll('job_type').includes('neq.' + row.job_type) &&
      (!q.has('id') || q.get('id') === 'eq.' + row.id) &&
      (!q.has('org_id') || q.get('org_id') === 'eq.' + row.org_id));
  };
  t.mock.method(globalThis, 'fetch', async url => Response.json(query(url)));
  const rest = async url => ({ body: query(url) });
  for (const rows of [
    await recentJobs({orgId: privateJob.org_id}),
    await queuedJobs(privateJob.org_id),
    await runningJobs(privateJob.org_id),
    await loadReflectionJobs(rest, privateJob.org_id, 24),
  ]) assert.deepEqual(rows.map(r => r.id), [otherJob.id]);
  const context = { orgId: privateJob.org_id, turnId: 'test-turn' };
  await assert.rejects(executeResidentTool('job_read', {job_id: privateJob.id}, context, {rest}), /not found/);
  assert.equal((await executeResidentTool('job_read', {job_id: otherJob.id}, context, {rest})).id, otherJob.id);
});

test('another queued task cannot copy private replay output as dependency evidence', async t => {
  const claimed = { ...otherJob, input: { depends_on_job_ids: [privateJob.id] }, attempts: 1 };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'PATCH') return Response.json([claimed]);
    const params = new URL(url).searchParams;
    return Response.json(params.get('job_type') === 'neq.' + privateJob.job_type ? [] : [privateJob]);
  });
  const outcome = await prepareClaimedDagJob(claimed);
  assert.equal(outcome.action, 'waiting');
  assert.deepEqual(outcome.dependency.missing_ids, [privateJob.id]);
});

test('health retains counts while shared failure details and telemetry omit project activity', async t => {
  const rows = [privateJob, otherJob].map(job => ({ ...job, status: 'failed', attempts: 1, max_attempts: 1 }));
  const health = await failureDetails(async () => ({body: rows, headers: new Headers({'content-range':'0-1/2'})}), privateJob.org_id);
  assert.equal(health.retry_exhausted_count, 2);
  assert.deepEqual(health.recent_failures.map(row => row.id), [otherJob.id]);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected telemetry publication'); });
  const emission = await emitCoreEvent({
    orgId: privateJob.org_id, resourceId: privateJob.id, resourceType: 'ops_agent_job',
    name: 'core.job.equiquant_mosaic_replay.completed',
  });
  assert.equal(emission.reason, 'private_research_job');
  assert.equal(fetch.mock.callCount(), 0);
});
