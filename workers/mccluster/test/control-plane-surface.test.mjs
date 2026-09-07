import test from 'node:test';
import assert from 'node:assert/strict';

import core from '../src/index.js';

function env(overrides = {}) {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    ALLOWED_ORIGINS: 'https://matthew.mccluster.org',
    HereTenantAgent: {
      idFromName: () => 'health-id',
      get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: true, internal: true }), { headers: { 'content-type': 'application/json' } }) })
    },
    ...overrides
  };
}

async function json(response) {
  return response.json();
}

test('public health is minimal and does not expose infrastructure identifiers', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('health should not make network calls'); };
  try {
    const response = await core.fetch(new Request('https://api.mccluster.org/health'), env());
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { ok: true, service: 'mccluster' });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('internal durable-object health rejects unauthenticated callers before touching Supabase', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unauthenticated request should not fetch'); };
  try {
    const response = await core.fetch(new Request('https://api.mccluster.org/internal/here-tenant-agent'), env());
    assert.equal(response.status, 401);
    assert.equal((await json(response)).error, 'Authentication required');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('internal durable-object health rejects authenticated non-house owners', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('/auth/v1/user')) return Response.json({ id: 'user-1', email: 'client@example.com' });
    if (value.includes('/rest/v1/orgs?slug=eq.mccluster')) return Response.json([{ id: 'house-org' }]);
    if (value.includes('/rest/v1/org_members?')) return Response.json([]);
    throw new Error(`unexpected fetch: ${value}`);
  };
  try {
    const request = new Request('https://api.mccluster.org/internal/here-tenant-agent', { headers: { authorization: 'Bearer client-token' } });
    const response = await core.fetch(request, env());
    assert.equal(response.status, 403);
    assert.equal((await json(response)).error, 'McCluster house owner access required');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('internal durable-object health permits a verified house owner', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('/auth/v1/user')) return Response.json({ id: 'owner-1', email: 'owner@example.com' });
    if (value.includes('/rest/v1/orgs?slug=eq.mccluster')) return Response.json([{ id: 'house-org' }]);
    if (value.includes('/rest/v1/org_members?')) return Response.json([{ org_id: 'house-org', role: 'owner' }]);
    throw new Error(`unexpected fetch: ${value}`);
  };
  try {
    const request = new Request('https://api.mccluster.org/internal/here-tenant-agent', { headers: { authorization: 'Bearer owner-token' } });
    const response = await core.fetch(request, env());
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { ok: true, internal: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public app registry uses an explicit safe field projection', async () => {
  const originalFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async (url) => {
    requested = String(url);
    return Response.json([{ app_key: 'whip-rider-web', name: 'Whip Equipped', public_url: 'https://example.com' }]);
  };
  try {
    const response = await core.fetch(new Request('https://api.mccluster.org/v1/apps'), env());
    assert.equal(response.status, 200);
    assert.match(requested, /select=app_key,name,product_family,kind,bundle_id,public_url/);
    assert.doesNotMatch(requested, /oauth_client_id|settings/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
