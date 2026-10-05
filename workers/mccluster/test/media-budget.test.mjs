import test from 'node:test';
import assert from 'node:assert/strict';

import { getMediaBudget, updateMediaBudget } from '../src/media/router.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333' };

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function withFetchMock(role, fn) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    let body = null;
    if (options.body) {
      try { body = JSON.parse(String(options.body)); } catch { body = String(options.body); }
    }
    seen.push({ href, method: options.method || 'GET', body });

    if (href.includes('/rest/v1/org_members?')) {
      return jsonResponse(role ? [{ org_id: ORG_ID, role }] : []);
    }
    if (href.includes('/rest/v1/org_media_budgets?') && (options.method || 'GET') === 'GET') {
      return jsonResponse([{
        org_id: ORG_ID,
        enabled: true,
        monthly_limit_cents: 25000,
        warn_at_percent: 80,
        updated_by: OWNER.id,
        created_at: '2026-10-05T00:00:00Z',
        updated_at: '2026-10-05T01:00:00Z'
      }]);
    }
    if (href.includes('/rest/v1/org_media_budgets?') && options.method === 'POST') {
      return jsonResponse([{
        ...body,
        created_at: '2026-10-05T00:00:00Z',
        updated_at: body.updated_at
      }]);
    }
    if (href.includes('/rest/v1/control_audit') && options.method === 'POST') {
      return jsonResponse([{ id: 1, at: '2026-10-05T01:00:01Z' }]);
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };
  return Promise.resolve().then(() => fn(seen)).finally(() => { globalThis.fetch = original; });
}

function req(method = 'GET', body) {
  return new Request(`https://api.mccluster.org/v1/media/budget?org_id=${ORG_ID}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
}

test('owner can read the canonical monthly media allowance', async () => {
  await withFetchMock('owner', async (seen) => {
    const result = await getMediaBudget(req(), { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' }, OWNER);
    assert.equal(result.budget.monthly_limit_cents, 25000);
    assert.equal(result.budget.enabled, true);
    assert.ok(seen.some((x) => x.href.includes('org_media_budgets')));
  });
});

test('non-owner cannot read or change the media allowance', async () => {
  await withFetchMock('staff', async (seen) => {
    await assert.rejects(
      () => getMediaBudget(req(), { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' }, OWNER),
      (error) => error.status === 403
    );
    assert.equal(seen.some((x) => x.href.includes('org_media_budgets')), false);
  });
});

test('owner can update the allowance and the mutation is audited', async () => {
  await withFetchMock('owner', async (seen) => {
    const result = await updateMediaBudget(
      req('PATCH', { enabled: true, monthly_limit_cents: 50000, warn_at_percent: 75 }),
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' },
      OWNER
    );
    assert.equal(result.budget.monthly_limit_cents, 50000);
    assert.equal(result.budget.warn_at_percent, 75);
    assert.equal(result.audit.recorded, true);
    const write = seen.find((x) => x.href.includes('org_media_budgets') && x.method === 'POST');
    assert.ok(write);
    assert.equal(write.body.org_id, ORG_ID);
    assert.equal(write.body.updated_by, OWNER.id);
    assert.ok(seen.some((x) => x.href.includes('/rest/v1/control_audit') && x.method === 'POST'));
  });
});

test('enabled allowance requires a concrete monthly cap', async () => {
  await withFetchMock('owner', async (seen) => {
    await assert.rejects(
      () => updateMediaBudget(
        req('PATCH', { enabled: true, monthly_limit_cents: null, warn_at_percent: 80 }),
        { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' },
        OWNER
      ),
      (error) => error.status === 400 && /monthly limit/i.test(error.message)
    );
    assert.equal(seen.some((x) => x.href.includes('org_media_budgets') && x.method === 'POST'), false);
  });
});
