import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAiRequest } from '../src/ai/router.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const APPROVAL_ID = '223e4567-e89b-42d3-a456-426614174111';
const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333' };
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role'
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function request(decision) {
  return new Request(`https://api.mccluster.org/v1/ai/approvals/${APPROVAL_ID}/decision`, {
    method: 'POST',
    headers: { authorization: 'Bearer human-token', 'content-type': 'application/json' },
    body: JSON.stringify({ decision })
  });
}

function backend({ owner = true, approval = true } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init = {}) => {
      const href = String(url);
      calls.push({ href, init });
      if (href.includes('/rest/v1/orgs?')) return json([{ id: ORG_ID }]);
      if (href.includes('/rest/v1/org_members?')) return json(owner ? [{ org_id: ORG_ID, role: 'owner' }] : []);
      if (href.includes('/rest/v1/control_approvals?')) {
        if (!approval) return json([]);
        return json([{
          id: APPROVAL_ID,
          org_id: ORG_ID,
          capability: 'code.build',
          resource_type: 'repository',
          resource_id: 'mcclusterishere/mccluster',
          state: JSON.parse(init.body).state,
          decided_by: JSON.parse(init.body).decided_by,
          decided_at: JSON.parse(init.body).decided_at
        }]);
      }
      throw new Error(`unexpected fetch ${href}`);
    }
  };
}

async function withBackend(be, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = be.fetch;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('house owner can approve a pending approval and identity is server-injected', async () => {
  const be = backend();
  const response = await withBackend(be, () => handleAiRequest(request('approve'), env, OWNER));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.approval.state, 'approved');
  assert.equal(body.approval.decided_by, OWNER.id);
  const patch = be.calls.find((call) => call.href.includes('/control_approvals?'));
  assert.ok(patch);
  assert.equal(patch.init.method, 'PATCH');
  assert.match(patch.href, /state=eq.pending/);
  assert.match(patch.href, /expires_at=gt./);
  assert.equal(JSON.parse(patch.init.body).decided_by, OWNER.id);
});

test('house owner can deny a pending approval', async () => {
  const be = backend();
  const response = await withBackend(be, () => handleAiRequest(request('deny'), env, OWNER));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).approval.state, 'denied');
});

test('invalid approval decisions fail closed before mutation', async () => {
  const be = backend();
  const response = await withBackend(be, () => handleAiRequest(request('maybe'), env, OWNER));
  assert.equal(response.status, 400);
  assert.ok(!be.calls.some((call) => call.href.includes('/control_approvals?')));
});

test('non-owner cannot decide approvals', async () => {
  const be = backend({ owner: false });
  const response = await withBackend(be, () => handleAiRequest(request('approve'), env, OWNER));
  assert.equal(response.status, 403);
  assert.ok(!be.calls.some((call) => call.href.includes('/control_approvals?')));
});

test('expired or already-decided approval returns conflict instead of fabricated success', async () => {
  const be = backend({ approval: false });
  const response = await withBackend(be, () => handleAiRequest(request('approve'), env, OWNER));
  assert.equal(response.status, 409);
});
