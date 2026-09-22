/* GET /v1/workspaces/me — the one server answer to "who am I and what may
   I open".

   What matters here: the caller never names itself (the token does), the
   list is exactly the caller's memberships and not every org in the
   table, the default selection is deterministic rather than row-order,
   a switched-off tenant is listed but never opened into, and
   requireMembership still refuses an org the caller only claims. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireMembership, resolveWorkspaces } from '../src/workspaces.js';

const USER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'matthew@mccluster.org' };
const HOUSE = '123e4567-e89b-42d3-a456-426614174000';
const SHOP = '223e4567-e89b-42d3-a456-426614174111';
const CLOSED = '323e4567-e89b-42d3-a456-426614174222';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function withFetchMock(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

/* Deliberately returned in an unhelpful order, so a passing sort test
   cannot be an accident of how the rows arrived. */
const ROWS = [
  { role: 'viewer', added_at: '2026-01-03T00:00:00Z', orgs: { id: SHOP, slug: 'esmer', name: 'Esmer', kind: 'business', enabled: true } },
  { role: 'owner', added_at: '2026-01-02T00:00:00Z', orgs: { id: CLOSED, slug: 'aaa-closed', name: 'Closed', kind: 'studio', enabled: false } },
  { role: 'owner', added_at: '2026-01-01T00:00:00Z', orgs: { id: HOUSE, slug: 'mccluster', name: 'McCluster', kind: 'studio', enabled: true } }
];

function backend({ rows = ROWS, status = 200 } = {}) {
  const calls = [];
  return {
    calls,
    handler: async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, method: options.method || 'GET' });
      if (href.includes('/rest/v1/org_members')) return jsonResponse(rows, status);
      return jsonResponse([]);
    }
  };
}

test('the list is scoped to the caller token, never to every org', async () => {
  const be = backend();
  await withFetchMock(be.handler, async () => {
    await resolveWorkspaces(env, USER);
  });
  const [call] = be.calls;
  assert.match(call.href, /org_members\?profile_id=eq\./);
  assert.ok(
    call.href.includes(encodeURIComponent(USER.id)),
    'the membership query must be filtered by the authenticated profile id'
  );
});

test('memberships come back flattened with role and org identity', async () => {
  const be = backend();
  const result = await withFetchMock(be.handler, () => resolveWorkspaces(env, USER));

  assert.equal(result.ok, true);
  assert.equal(result.contract, 'mccluster-workspace/v1');
  assert.equal(result.profile.id, USER.id);
  assert.equal(result.profile.email, USER.email);
  assert.equal(result.workspaces.length, 3);

  const house = result.workspaces.find((row) => row.org_id === HOUSE);
  assert.deepEqual(
    { slug: house.slug, name: house.name, kind: house.kind, role: house.role, enabled: house.enabled },
    { slug: 'mccluster', name: 'McCluster', kind: 'studio', role: 'owner', enabled: true }
  );
});

test('the default is the strongest role on an enabled org, not row order', async () => {
  const be = backend();
  const result = await withFetchMock(be.handler, () => resolveWorkspaces(env, USER));

  assert.equal(result.default_org_id, HOUSE);
  assert.equal(result.workspaces[0].org_id, CLOSED, 'owner sorts ahead of viewer regardless of enabled');
  assert.equal(result.workspaces.at(-1).org_id, SHOP, 'viewer sorts last');
});

test('a switched-off org stays listed but is never opened into', async () => {
  const onlyClosed = [ROWS[1]];
  const be = backend({ rows: onlyClosed });
  const result = await withFetchMock(be.handler, () => resolveWorkspaces(env, USER));

  assert.equal(result.workspaces.length, 1, 'the person can still see where their workspace went');
  assert.equal(result.workspaces[0].enabled, false);
  assert.equal(result.default_org_id, null, 'a disabled tenant is a worse first screen than the switcher');
});

test('no membership is an empty list, not an error', async () => {
  const be = backend({ rows: [] });
  const result = await withFetchMock(be.handler, () => resolveWorkspaces(env, USER));
  assert.deepEqual(result.workspaces, []);
  assert.equal(result.default_org_id, null);
});

test('a token with no subject is refused before any database access', async () => {
  let touched = false;
  await withFetchMock(async () => { touched = true; return jsonResponse([]); }, async () => {
    await assert.rejects(
      () => resolveWorkspaces(env, {}),
      (error) => error.status === 401
    );
  });
  assert.equal(touched, false, 'an unauthenticated caller must not reach the database');
});

test('requireMembership returns the role for an org the caller is really in', async () => {
  const be = backend();
  const match = await withFetchMock(be.handler, () => requireMembership(env, USER, HOUSE));
  assert.equal(match.role, 'owner');
  assert.equal(match.org_id, HOUSE);
});

test('requireMembership refuses an org the caller only claims', async () => {
  const be = backend();
  await withFetchMock(be.handler, async () => {
    await assert.rejects(
      () => requireMembership(env, USER, '999e4567-e89b-42d3-a456-426614174999'),
      (error) => error.status === 403
    );
  });
});

test('requireMembership refuses a switched-off org even to its owner', async () => {
  const be = backend();
  await withFetchMock(be.handler, async () => {
    await assert.rejects(
      () => requireMembership(env, USER, CLOSED),
      (error) => error.status === 403
    );
  });
});

test('requireMembership refuses a missing org_id rather than guessing one', async () => {
  const be = backend();
  await withFetchMock(be.handler, async () => {
    await assert.rejects(
      () => requireMembership(env, USER, ''),
      (error) => error.status === 400
    );
  });
});
