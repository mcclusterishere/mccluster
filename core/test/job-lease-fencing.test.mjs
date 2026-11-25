import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompletionEvidence } from '../src/completion-evidence.mjs';

// Audit finding C3: ops job claims lacked an attempt-specific lease, so an old
// attempt sharing the configured worker ID could finish a reclaimed job, and a
// zero-row heartbeat was treated as success. Synthetic fetch only; no database.
const ORG = '123e4567-e89b-42d3-a456-426614174000';
const JOB = '323e4567-e89b-42d3-a456-426614174000';
const SHA = 'a'.repeat(40);

function withEnv(fn) {
  return async () => {
    const saved = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'MCCLUSTER_CORE_ID'].map(k => [k, process.env[k]]));
    const savedFetch = globalThis.fetch;
    process.env.SUPABASE_URL = 'https://lease-fence.test';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
    process.env.MCCLUSTER_CORE_ID = 'static-core';
    try { await fn(); } finally {
      globalThis.fetch = savedFetch;
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
}

function fakeTable(initial) {
  const state = { row: initial, urls: [] };
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    state.urls.push(parsed);
    if (parsed.pathname.endsWith('/orgs')) return Response.json([{ id: ORG, enabled: true }]);
    if ((init.method || 'GET') === 'GET') return Response.json(state.row.status === 'queued' ? [state.row] : []);
    const matches = [...parsed.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(state.row[k]) === v.slice(3));
    if (matches) state.row = { ...state.row, ...JSON.parse(init.body) };
    if (init.headers?.Prefer === 'return=minimal') return new Response(null, { status: 204 });
    return Response.json(matches ? [state.row] : []);
  };
  return state;
}

test('a claim binds a unique lease into locked_by and the attempt into every ownership predicate', withEnv(async () => {
  const table = fakeTable({ id: JOB, org_id: ORG, job_type: 'repo_health', status: 'queued', attempts: 0, run_after: '2020-01-01T00:00:00Z' });
  const module = await import(`../src/supabase.mjs?lease-claim=${Date.now()}`);
  const claimed = await module.claimNext(['repo_health']);
  assert.ok(claimed);
  assert.match(claimed.locked_by, /^static-core#[A-Za-z0-9_-]{16,}$/);
  const second = await (async () => {
    table.row = { ...table.row, status: 'queued' };
    return module.claimNext(['repo_health']);
  })();
  assert.notEqual(second.locked_by, claimed.locked_by, 'each claim issues its own lease token');
  const params = new URLSearchParams(module.ownedRunningParams(claimed));
  assert.equal(params.get('locked_by'), `eq.${claimed.locked_by}`);
  assert.equal(params.get('attempts'), `eq.${claimed.attempts}`);
}));

test('an old attempt cannot complete, fail or checkpoint a job reclaimed under a newer lease', withEnv(async () => {
  const module = await import(`../src/supabase.mjs?lease-complete=${Date.now()}`);
  const old = { id: JOB, org_id: ORG, job_type: 'repo_health', status: 'running', attempts: 1, locked_by: 'static-core#attempt-one-token-xxxxxxxx' };
  const table = fakeTable({ ...old, attempts: 2, locked_by: 'static-core#attempt-two-token-yyyyyyyy' });
  const output = buildCompletionEvidence(old, { executor: 'repo_health:v1', repo: 'test/repo', head: SHA, clean: true, tests: { ran: false } });
  await assert.rejects(module.completeJob(old, output), /Lost ownership/);
  assert.equal(table.row.status, 'running', 'the newer attempt is untouched');
  assert.equal(table.row.attempts, 2);
  await assert.rejects(module.checkpointJobInput(old, { x: 1 }), /Lost ownership/);
  assert.equal(await module.failJob(old, new Error('late failure')), null);
  assert.equal(table.row.status, 'running');
}));

test('a heartbeat that updates zero rows reports lost ownership instead of succeeding', withEnv(async () => {
  const module = await import(`../src/supabase.mjs?lease-heartbeat=${Date.now()}`);
  const mine = { id: JOB, org_id: ORG, status: 'running', attempts: 1, locked_by: 'static-core#mine-token-zzzzzzzzzzzz' };
  const table = fakeTable({ ...mine });
  await module.heartbeat(mine);
  assert.ok(table.urls.length);
  table.row = { ...table.row, locked_by: 'other-worker#other-token-wwwwwwww' };
  await assert.rejects(module.heartbeat(mine), error => error.code === 'LEASE_LOST' && /Lost ownership/.test(error.message));
}));

test('the runner aborts the executor and refuses completion once the lease is lost', async () => {
  const { readFile } = await import('node:fs/promises');
  const runner = await readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /AbortController/);
  assert.match(runner, /LEASE_LOST/);
  assert.match(runner, /signal\.aborted/);
  assert.match(runner, /executor\(job, \{ signal/);
});
