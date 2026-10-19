/* Control → Build → Code route contract. Synthetic Supabase fixtures only:
   no production credentials, no live Core, no GitHub. A "queued" job here is
   a row written to a fake ledger, never an executed code change. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAiRequest } from '../src/ai/router.js';
import { validateBuildRequest, mapReceipt, describe, SENSITIVE_RULES, deterministicJobId, requestFingerprint } from '../src/ai/build-code.js';
import { readFile } from 'node:fs/promises';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_ORG = '223e4567-e89b-42d3-a456-426614174999';
const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333' };
const MEMBER = { id: '523e4567-e89b-42d3-a456-426614174444' };
const KEY = 'b2f1c5e4-9f0a-4c3b-8d2e-1a2b3c4d5e6f';
const JOB_ID = await deterministicJobId('123e4567-e89b-42d3-a456-426614174000', 'b2f1c5e4-9f0a-4c3b-8d2e-1a2b3c4d5e6f');
const baseEnv = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const onEnv = { ...baseEnv, CONTROL_BUILD_CODE_ENABLED: 'true' };

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function req(method, path, body, headers = {}) {
  return new Request(`https://api.mccluster.org${path}`, { method, headers: { authorization: 'Bearer human-token', 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
function backend({ owner = true, existing = null, jobs = [], approvals = () => json([]), keyLookup = null } = {}) {
  const calls = [], ledger = [...jobs];
  return {
    calls, ledger,
    fetch: async (url, init = {}) => {
      const href = String(url); calls.push({ href, init });
      if (href.includes('/rest/v1/orgs?')) return json([{ id: ORG_ID }]);
      if (href.includes('/rest/v1/org_members?')) return json(owner ? [{ org_id: ORG_ID, role: 'owner' }] : []);
      if (href.includes('/rest/v1/control_approvals?')) return approvals();
      if (href.includes('/rest/v1/ops_agent_jobs?') && (init.method || 'GET') === 'GET') {
        if (href.includes('input-%3E%3Eidempotency_key=eq.') || href.includes('input->>idempotency_key=eq.')) return keyLookup ? keyLookup() : json(existing ? [existing] : []);
        const id = decodeURIComponent(href).match(/id=eq\.([0-9a-f-]{36})/i)?.[1];
        return json(ledger.filter((j) => j.id === id && decodeURIComponent(href).includes(`org_id=eq.${j.org_id}`)));
      }
      if (href.endsWith('/rest/v1/ops_agent_jobs') && init.method === 'POST') {
        const row = JSON.parse(init.body);
        /* The fixture ledger honours the primary key exactly like Postgres. */
        if (ledger.some((j) => j.id === row.id)) return json({ code: '23505', message: 'duplicate key value violates unique constraint "ops_agent_jobs_pkey"' }, 409);
        const stored = { attempts: 0, locked_by: null, output: null, last_error: null, created_at: '2026-10-19T02:00:00Z', updated_at: '2026-10-19T02:00:00Z', ...row };
        ledger.push(stored);
        return json([stored], 201);
      }
      throw new Error(`unexpected fetch ${init.method || 'GET'} ${href}`);
    }
  };
}
async function withBackend(be, fn) { const original = globalThis.fetch; globalThis.fetch = be.fetch; try { return await fn(); } finally { globalThis.fetch = original; } }
const good = { repository: 'mcclusterishere/mccluster', task: 'Add a unit test for route-core distance rounding.', title: 'Test distance rounding', allowed_paths: ['scripts/test', 'js/travel/'], idempotency_key: KEY };
const writes = (be) => be.calls.filter((c) => c.init.method === 'POST' && c.href.endsWith('/rest/v1/ops_agent_jobs'));

test('signed-out callers get 401 before any ledger read', async () => {
  const be = backend();
  const res = await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', good), onEnv, null));
  assert.equal(res.status, 401); assert.equal(be.calls.length, 0);
});
test('an ordinary signed-in member is refused; no job is written', async () => {
  const be = backend({ owner: false });
  const res = await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', good), onEnv, MEMBER));
  assert.equal(res.status, 403); assert.equal(writes(be).length, 0);
});
test('a browser cannot choose another organization through query or body', async () => {
  const be = backend();
  const viaQuery = await withBackend(be, () => handleAiRequest(req('POST', `/v1/ai/build/code?org_id=${OTHER_ORG}`, good), onEnv, OWNER));
  assert.equal(viaQuery.status, 403);
  const viaBody = await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', { ...good, org_id: OTHER_ORG }), onEnv, OWNER));
  assert.equal(viaBody.status, 403);
  assert.equal(writes(be).length, 0);
});
test('forged role, admin and scope fields are ignored and never widen the request', async () => {
  const be = backend();
  const res = await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', { ...good, role: 'owner', is_admin: true, org_id: ORG_ID, priority: 100, max_attempts: 9, job_type: 'host_health' }), onEnv, OWNER));
  assert.equal(res.status, 202);
  const row = JSON.parse(writes(be)[0].init.body);
  assert.equal(row.job_type, 'code_patch'); assert.equal(row.priority, 80); assert.equal(row.max_attempts, 2); assert.equal(row.org_id, ORG_ID);
  assert.deepEqual(Object.keys(row.input).sort(), ['allowed_paths', 'capability', 'idempotency_key', 'request_fingerprint', 'requested_at', 'requested_by', 'requested_by_user', 'task', 'title']);
  assert.equal(row.input.requested_by_user, OWNER.id);
});
test('with the flag off the route answers unavailable, not success, and writes nothing', async () => {
  const be = backend();
  const res = await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', good), baseEnv, OWNER));
  assert.equal(res.status, 503);
  const body = await res.json(); assert.equal(body.state, 'unavailable'); assert.equal(body.reason, 'control_build_code_disabled');
  assert.equal(writes(be).length, 0);
  const status = await withBackend(be, () => handleAiRequest(req('GET', '/v1/ai/build/code'), baseEnv, OWNER));
  const described = await status.json(); assert.equal(described.enabled, false); assert.equal(described.state, 'unavailable');
});
test('repository allowlist and protected paths are enforced server-side', async () => {
  const be = backend();
  for (const [patch, needle] of [
    [{ repository: 'evil/repo' }, 'not allowlisted'],
    [{ repository: '../../etc' }, 'owner/repo'],
    [{ allowed_paths: ['.github/workflows'] }, 'protected'],
    [{ allowed_paths: ['supabase/migrations/x'] }, 'protected'],
    [{ allowed_paths: ['js/../.env'] }, 'protected location|not a plain repository prefix'],
    [{ allowed_paths: ['js/../lib'] }, 'not a plain repository prefix'],
    [{ allowed_paths: ['/etc'] }, 'not a plain repository prefix'],
    [{ allowed_paths: 'js' }, 'list'],
    [{ task: 'tiny' }, 'at least'],
    [{ idempotency_key: 'not-a-uuid' }, 'idempotency_key']
  ]) {
    const res = await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', { ...good, ...patch }), onEnv, OWNER));
    assert.equal(res.status, 400, JSON.stringify(patch));
    assert.match((await res.json()).error, new RegExp(needle), JSON.stringify(patch));
  }
  assert.equal(writes(be).length, 0);
});
test('a valid build queues exactly one canonical code_patch job with the capability recorded', async () => {
  const be = backend();
  const res = await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', good), onEnv, OWNER));
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.queued, true); assert.equal(body.replayed, false); assert.equal(body.job_id, JOB_ID);
  assert.equal(body.receipt.state, 'queued'); assert.equal(body.receipt.repository, 'mcclusterishere/mccluster');
  assert.deepEqual(body.receipt.allowed_paths, ['scripts/test', 'js/travel']);
  assert.equal(body.receipt.verification.draft_pr_verified, false);
  assert.equal(writes(be).length, 1);
  const row = JSON.parse(writes(be)[0].init.body);
  assert.equal(row.input.capability, 'code.build'); assert.equal(row.target_type, 'repository'); assert.equal(row.status, 'queued');
  assert.equal(row.id, JOB_ID, 'the job id is derived from (org, idempotency key)');
  assert.equal(row.input.request_fingerprint, await requestFingerprint({ repository: good.repository, task: good.task, title: good.title, allowed_paths: ['scripts/test', 'js/travel'] }));
});
test('two simultaneous submissions with one key produce exactly one stored job and the same job id', async () => {
  /* The key lookup races: both requests see "nothing yet"; only the insert can decide. */
  const be = backend({ keyLookup: () => json([]) });
  const [a, b] = await withBackend(be, () => Promise.all([
    handleAiRequest(req('POST', '/v1/ai/build/code', good), onEnv, OWNER),
    handleAiRequest(req('POST', '/v1/ai/build/code', good), onEnv, OWNER)
  ]));
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 202]);
  const bodies = await Promise.all([a.json(), b.json()]);
  assert.equal(bodies[0].job_id, JOB_ID); assert.equal(bodies[1].job_id, JOB_ID);
  assert.equal(be.ledger.length, 1, 'exactly one row exists after the race');
  assert.equal(writes(be).length, 2, 'both attempted the insert; the primary key refused the second');
});
test('reusing a key with a different payload is a conflict, never a replay of another objective', async () => {
  const fingerprint = await requestFingerprint({ repository: good.repository, task: good.task, title: good.title, allowed_paths: ['scripts/test', 'js/travel'] });
  const existing = { id: JOB_ID, org_id: ORG_ID, job_type: 'code_patch', target_type: 'repository', target_id: good.repository, status: 'queued', attempts: 0, max_attempts: 2, input: { ...good, allowed_paths: ['scripts/test', 'js/travel'], request_fingerprint: fingerprint }, output: null, last_error: null, created_at: 'x', updated_at: 'y' };
  const be = backend({ existing, jobs: [existing] });
  const res = await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', { ...good, task: 'A completely different objective that must not be replayed.' }), onEnv, OWNER));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'idempotency_conflict'); assert.equal(body.job_id, JOB_ID);
  assert.equal(writes(be).length, 0);
  /* Same key through the race path with a different payload is also a conflict. */
  const raced = backend({ keyLookup: () => json([]), jobs: [existing] });
  const res2 = await withBackend(raced, () => handleAiRequest(req('POST', '/v1/ai/build/code', { ...good, task: 'Another different objective after the insert loses.' }), onEnv, OWNER));
  assert.equal(res2.status, 409); assert.equal(raced.ledger.length, 1);
});
test('an unavailable or malformed approvals read is reported as unknown, never as no approval', async () => {
  const job = { id: JOB_ID, org_id: ORG_ID, job_type: 'code_patch', target_type: 'repository', target_id: good.repository, status: 'queued', attempts: 0, max_attempts: 2, input: good, output: null, last_error: null, created_at: 'x', updated_at: 'y' };
  for (const [name, approvals, source, state] of [
    ['503', () => json({ message: 'down' }, 503), 'unavailable', 'unknown'],
    ['thrown', () => { throw new Error('socket hang up'); }, 'unavailable', 'unknown'],
    ['non-list', () => json({ not: 'a list' }), 'unavailable', 'unknown'],
    ['malformed row', () => json([{ id: 5 }]), 'unavailable', 'unknown'],
    ['verified none', () => json([]), 'ok', 'none'],
    ['pending', () => json([{ id: 'a1', state: 'pending', expires_at: null }]), 'ok', 'pending']
  ]) {
    const be = backend({ jobs: [job], approvals });
    const res = await withBackend(be, () => handleAiRequest(req('GET', `/v1/ai/build/code/${JOB_ID}`), onEnv, OWNER));
    const { receipt } = await res.json();
    assert.equal(receipt.approval_source, source, name); assert.equal(receipt.approval_state, state, name);
    assert.equal(receipt.state, state === 'pending' ? 'awaiting_approval' : 'queued', name);
  }
});
test('the deterministic job id is stable, scoped to the organization and a valid UUID', async () => {
  const a = await deterministicJobId(ORG_ID, KEY), b = await deterministicJobId(ORG_ID, KEY.toUpperCase()), c = await deterministicJobId(OTHER_ORG, KEY);
  assert.equal(a, b); assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('contract drift: the edge row matches what core.code.build writes', async () => {
  const core = await readFile(new URL('../../../core/src/tools/control.mjs', import.meta.url), 'utf8');
  const handler = core.slice(core.indexOf("name === 'core.code.build'"));
  assert.match(handler, /jobType: 'code_patch'/); assert.match(handler, /targetType: 'repository'/); assert.match(handler, /maxAttempts: 2/);
  assert.match(handler, /input: \{ task, title: text\(args\.title, 500\), allowed_paths:/);
  const be = backend();
  await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', good), onEnv, OWNER));
  const row = JSON.parse(writes(be)[0].init.body);
  assert.equal(row.job_type, 'code_patch'); assert.equal(row.target_type, 'repository'); assert.equal(row.max_attempts, 2);
  for (const key of ['task', 'title', 'allowed_paths']) assert.ok(key in row.input, key);
});
test('resubmitting the same idempotency key replays the existing job and writes nothing', async () => {
  const existing = { id: JOB_ID, org_id: ORG_ID, job_type: 'code_patch', target_type: 'repository', target_id: good.repository, status: 'running', attempts: 1, max_attempts: 2, input: { ...good }, output: null, last_error: null, created_at: '2026-10-19T02:00:00Z', updated_at: '2026-10-19T02:01:00Z' };
  const be = backend({ existing });
  const res = await withBackend(be, () => handleAiRequest(req('POST', '/v1/ai/build/code', good), onEnv, OWNER));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.replayed, true); assert.equal(body.job_id, JOB_ID); assert.equal(body.receipt.state, 'running');
  assert.equal(writes(be).length, 0);
});
test('receipt readback is org-scoped and maps every stored status to one product state', async () => {
  const mk = (status, extra = {}) => ({ id: JOB_ID, org_id: ORG_ID, job_type: 'code_patch', target_type: 'repository', target_id: good.repository, status, attempts: 1, max_attempts: 2, input: good, output: null, last_error: null, created_at: 'x', updated_at: 'y', ...extra });
  for (const [status, state] of [['queued', 'queued'], ['running', 'running'], ['done', 'completed'], ['failed', 'failed'], ['cancelled', 'cancelled'], ['weird', 'unknown']]) {
    const be = backend({ jobs: [mk(status)] });
    const res = await withBackend(be, () => handleAiRequest(req('GET', `/v1/ai/build/code/${JOB_ID}`), onEnv, OWNER));
    assert.equal(res.status, 200); assert.equal((await res.json()).receipt.state, state, status);
  }
  const foreign = backend({ jobs: [mk('done', { org_id: OTHER_ORG })] });
  const res = await withBackend(foreign, () => handleAiRequest(req('GET', `/v1/ai/build/code/${JOB_ID}`), onEnv, OWNER));
  assert.equal(res.status, 404);
});
test('a reported draft PR is surfaced as reported, never as verified, and forged output is bounded', () => {
  const receipt = mapReceipt({ id: JOB_ID, status: 'done', job_type: 'code_patch', target_id: good.repository, input: good, attempts: 1, max_attempts: 2, output: { branch: 'core/job-abc', pushed: true, draft_pr: 'https://github.com/mcclusterishere/mccluster/pull/999', agent_output_tail: 'x'.repeat(9000), tests: { ok: true } } });
  assert.equal(receipt.state, 'completed'); assert.equal(receipt.reported.draft_pr, 'https://github.com/mcclusterishere/mccluster/pull/999');
  assert.equal(receipt.verification.draft_pr_verified, false); assert.equal(receipt.reported.agent_output_tail.length, 4000);
  const forged = mapReceipt({ id: JOB_ID, status: 'done', input: {}, output: { draft_pr: 'javascript:alert(1)', branch: { not: 'a string' } } });
  assert.equal(forged.reported.draft_pr, null); assert.equal(forged.reported.branch, null);
  assert.equal(mapReceipt(null).state, 'unknown');
  assert.equal(mapReceipt({ id: JOB_ID, status: 'queued', input: {} }, { status: 'ok', approval: { id: 'a', state: 'pending' } }).state, 'awaiting_approval');
  assert.equal(mapReceipt({ id: JOB_ID, status: 'queued', input: {} }, { status: 'unavailable', approval: null }).approval_state, 'unknown');
});
test('validation and description are pure and name the same protected paths the executor refuses', () => {
  assert.equal(validateBuildRequest(good, onEnv).ok, true);
  assert.equal(validateBuildRequest('nope', onEnv).ok, false);
  const described = describe(onEnv);
  assert.equal(described.capability, 'code.build'); assert.equal(described.output, 'draft_pr_only'); assert.equal(described.safety.auto_merge, false);
  assert.equal(described.protected_paths.length, SENSITIVE_RULES.length);
  for (const p of ['.git/config', '.github/workflows/x.yml', 'supabase/migrations/1.sql', 'core/systemd/u.service', 'a/.env.local', 'keys/id_ed25519', 'lib/credentials.js', 'config/secrets.json']) assert.ok(SENSITIVE_RULES.some((r) => r.test(p)), p);
  assert.ok(!SENSITIVE_RULES.some((r) => r.test('js/travel/world-travel.mjs')));
});
