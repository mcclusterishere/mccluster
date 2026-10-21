import test from 'node:test';
import assert from 'node:assert/strict';

const HOUSE = '123e4567-e89b-42d3-a456-426614174000';
const FOREIGN = '223e4567-e89b-42d3-a456-426614174000';
const HOUSE_JOB = '323e4567-e89b-42d3-a456-426614174000';
const FOREIGN_JOB = '423e4567-e89b-42d3-a456-426614174000';
const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

async function mockCore(run, handler) {
  const previousUrl = process.env.SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  const previousLegacy = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://house-boundary.test';
  process.env.SUPABASE_SECRET_KEY = 'test-service-only';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = handler;
  try { await run(); } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of [['SUPABASE_URL', previousUrl], ['SUPABASE_SECRET_KEY', previousSecret], ['SUPABASE_SERVICE_ROLE_KEY', previousLegacy]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('house queue excludes foreign organization jobs at read and compare-and-swap boundaries', async () => {
  const seen = [];
  await mockCore(async () => {
    const core = await import('../src/supabase.mjs?house-queue-authority');
    const claimed = await core.claimNext(['repo_health']);
    assert.equal(claimed?.id, HOUSE_JOB);
    const jobCalls = seen.filter((x) => x.href.includes('/rest/v1/ops_agent_jobs'));
    assert.ok(jobCalls.length >= 3);
    assert.ok(jobCalls.every((x) => new URL(x.href).searchParams.get('org_id') === 'eq.' + HOUSE), 'every job query and mutation must scope the canonical house');
    assert.equal(jobCalls.filter((x) => x.method === 'PATCH').length, 1);
    assert.equal(new URL(jobCalls.find((x) => x.method === 'PATCH').href).searchParams.get('id'), 'eq.' + HOUSE_JOB);
  }, async (url, init = {}) => {
    const href = String(url), method = init.method || 'GET';
    seen.push({ href, method });
    if (href.includes('/rest/v1/orgs?')) return json([{ id: HOUSE, enabled: true }]);
    if (!href.includes('/rest/v1/ops_agent_jobs?')) throw new Error('Unexpected Core request: ' + href);
    if (method === 'PATCH') return json([{ id: HOUSE_JOB, org_id: HOUSE, ...JSON.parse(init.body) }]);
    const q = new URL(href).searchParams;
    if (q.get('status') === 'eq.running' || q.has('created_at')) return json([]);
    return json([
      { id: FOREIGN_JOB, org_id: FOREIGN, job_type: 'repo_health', attempts: 0 },
      { id: HOUSE_JOB, org_id: HOUSE, job_type: 'repo_health', attempts: 0 }
    ]);
  });
});

test('a missing or disabled canonical house fails closed before reading queued jobs', async () => {
  const seen = [];
  await mockCore(async () => {
    const core = await import('../src/supabase.mjs?disabled-house-authority');
    await assert.rejects(() => core.claimNext(['repo_health']), /house organization unavailable/i);
    assert.equal(seen.filter(x => x.includes('/rest/v1/ops_agent_jobs')).length, 0);
  }, async (url) => {
    const href = String(url); seen.push(href);
    if (href.includes('/rest/v1/orgs?')) return json([{ id: HOUSE, enabled: false }]);
    throw new Error('Unexpected database access after disabled house');
  });
});

test('foreign prerequisite output cannot enter house job evidence', async () => {
  const seen = [];
  await mockCore(async () => {
    const { prepareClaimedDagJob } = await import('../src/objective-dag-store.mjs?house-dependency-authority');
    const job = { id: HOUSE_JOB, org_id: HOUSE, status: 'running', attempts: 1, input: { depends_on_job_ids: [FOREIGN_JOB] } };
    const prepared = await prepareClaimedDagJob(job, { recheckMs: 5000 });
    assert.equal(prepared.action, 'waiting');
    assert.deepEqual(prepared.dependency.missing_ids, [FOREIGN_JOB]);
    assert.equal(prepared.job.input?.evidence, undefined);
    assert.ok(seen.some(x => x.method === 'PATCH'));
    assert.ok(seen.every(x => new URL(x.href).searchParams.get('org_id') === 'eq.' + HOUSE));
  }, async (url, init = {}) => {
    const href = String(url), method = init.method || 'GET'; seen.push({ href, method });
    if (!href.includes('/rest/v1/ops_agent_jobs?')) throw new Error('Unexpected dependency request: ' + href);
    if (method === 'PATCH') return json([{ id: HOUSE_JOB, org_id: HOUSE, input: { depends_on_job_ids: [FOREIGN_JOB] }, ...JSON.parse(init.body) }]);
    // Deliberately simulate a broken API adapter ignoring the org predicate.
    return json([{ id: FOREIGN_JOB, org_id: FOREIGN, status: 'done', output: { token: 'must-not-appear' } }]);
  });
});
