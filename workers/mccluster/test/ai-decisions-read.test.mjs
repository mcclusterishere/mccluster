/* GET /v1/ai/decisions.

   ai_context is a private schema PostgREST does not expose, so a decision can
   be recorded and never read back — including the ones waiting on the owner.
   This is the read side, added as a method on the route that already records
   them rather than as a new namespace.

   What matters here: the house-owner gate that already guards /v1/ai/* still
   applies, the caller's own token is forwarded (the service key is never
   presented as a human), the org is pinned by the Worker, and the filters are
   passed through rather than being reinterpreted. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAiRequest } from '../src/ai/router.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'owner@example.com' };
const USER_TOKEN = 'user-jwt-not-the-service-key';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  MCCLUSTER_HOUSE_ORG_ID: ORG_ID
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function withFetchMock(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

const DECISION = {
  id: 'd1', org_id: ORG_ID, title: 'Promote the Worker version',
  decision: 'Promote after the contract check passes', rationale_summary: null,
  risk_class: 'high', status: 'proposed', proposed_by: OWNER.id,
  created_at: '2026-09-17T00:00:00Z'
};

/* `owner` decides what the membership lookup reports; `fn` is what the edge
   function returns, so an owner can be tested against the same data. */
function backend({ owner = true, fn = null, fnStatus = 200 } = {}) {
  const calls = [];
  return {
    calls,
    handler: async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, method: options.method || 'GET', headers: options.headers || {} });
      /* The house org is resolved by slug, not from configuration. */
      if (href.includes('/rest/v1/orgs')) return jsonResponse([{ id: ORG_ID }]);
      if (href.includes('/rest/v1/org_members')) {
        return jsonResponse(owner ? [{ org_id: ORG_ID, role: 'owner' }] : []);
      }
      if (href.includes('/functions/v1/context-decision')) {
        return jsonResponse(fn || { decisions: [DECISION], has_more: false, next_before: null, next_before_id: null }, fnStatus);
      }
      return jsonResponse([]);
    }
  };
}

function get(path) {
  return new Request(`https://api.mccluster.org${path}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${USER_TOKEN}` }
  });
}

test('an owner can read decisions back', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => {
    const response = await handleAiRequest(get('/v1/ai/decisions'), env, OWNER);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.decisions.length, 1);
    assert.equal(body.decisions[0].status, 'proposed');
    assert.equal(body.decisions[0].risk_class, 'high');
    assert.equal(body.has_more, false);
  });
});

test('the read forwards the caller token, never the service key as identity', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => {
    await handleAiRequest(get('/v1/ai/decisions'), env, OWNER);
  });
  const call = be.calls.find((c) => c.href.includes('/functions/v1/context-decision'));
  assert.ok(call, 'expected the context function to be called');
  assert.equal(call.method, 'GET');
  /* The function refuses a bearer equal to the service key, so forwarding the
     human's token is what keeps the owner/admin check meaningful. */
  assert.equal(call.headers.authorization, `Bearer ${USER_TOKEN}`);
  assert.notEqual(call.headers.authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
});

test('a non-owner is refused before any decision is read', async () => {
  const be = backend({ owner: false });
  await withFetchMock(be.handler, async () => {
    const response = await handleAiRequest(get('/v1/ai/decisions'), env, OWNER);
    assert.equal(response.status, 403);
    const text = await response.text();
    assert.ok(!text.includes('Promote the Worker'), 'must not leak a decision to a non-owner');
  });
  assert.ok(
    !be.calls.some((c) => c.href.includes('/functions/v1/context-decision')),
    'the function must not be reached at all once the gate refuses'
  );
});

test('an unauthenticated request is refused', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => {
    const response = await handleAiRequest(get('/v1/ai/decisions'), env, null);
    assert.equal(response.status, 401);
  });
});

test('filters and paging are passed through, and the org is pinned by the Worker', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => {
    await handleAiRequest(
      get('/v1/ai/decisions?status=proposed,approved&risk_class=high&limit=10&before=2026-09-17T00:00:00Z&before_id=d9'),
      env,
      OWNER
    );
  });
  const call = be.calls.find((c) => c.href.includes('/functions/v1/context-decision'));
  const q = new URL(call.href).searchParams;
  assert.equal(q.get('status'), 'proposed,approved');
  assert.equal(q.get('risk_class'), 'high');
  assert.equal(q.get('limit'), '10');
  assert.equal(q.get('before'), '2026-09-17T00:00:00Z');
  assert.equal(q.get('before_id'), 'd9');
  /* The org comes from the house org / gate, not from whatever the caller
     appended, so a cross-org read cannot be requested through the filters. */
  assert.equal(q.get('org_id'), ORG_ID);
});

test('empty parameters are omitted rather than sent as empty strings', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => {
    await handleAiRequest(get('/v1/ai/decisions'), env, OWNER);
  });
  const call = be.calls.find((c) => c.href.includes('/functions/v1/context-decision'));
  const q = new URL(call.href).searchParams;
  assert.equal(q.has('status'), false);
  assert.equal(q.has('before'), false);
  assert.equal(q.has('risk_class'), false);
});

test('no decisions is an empty list, not an error', async () => {
  const be = backend({ fn: { decisions: [], has_more: false, next_before: null, next_before_id: null } });
  await withFetchMock(be.handler, async () => {
    const response = await handleAiRequest(get('/v1/ai/decisions'), env, OWNER);
    assert.equal(response.status, 200);
    const body = await response.json();
    /* The console distinguishes "nothing pending" from "could not read", so
       this has to succeed rather than 404. */
    assert.deepEqual(body.decisions, []);
  });
});

test('a rejection from the function is surfaced, not flattened into success', async () => {
  const be = backend({ fn: { error: 'invalid status: maybe' }, fnStatus: 400 });
  await withFetchMock(be.handler, async () => {
    const response = await handleAiRequest(get('/v1/ai/decisions?status=maybe'), env, OWNER);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(JSON.stringify(body), /invalid status/);
  });
});

test('a function outage becomes 502, not a fabricated empty list', async () => {
  const be = backend({ fn: { error: 'boom' }, fnStatus: 500 });
  await withFetchMock(be.handler, async () => {
    const response = await handleAiRequest(get('/v1/ai/decisions'), env, OWNER);
    assert.equal(response.status, 502);
  });
});

test('POST still records a decision on the same route', async () => {
  const be = backend({ fn: { decision: DECISION }, fnStatus: 201 });
  await withFetchMock(be.handler, async () => {
    const response = await handleAiRequest(
      new Request('https://api.mccluster.org/v1/ai/decisions', {
        method: 'POST',
        headers: { authorization: `Bearer ${USER_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Promote', decision: 'after checks' })
      }),
      env,
      OWNER
    );
    assert.equal(response.status, 201);
  });
  const call = be.calls.find((c) => c.href.includes('/functions/v1/context-decision'));
  assert.equal(call.method, 'POST', 'the write path must be unchanged');
});
