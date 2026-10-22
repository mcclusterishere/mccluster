import test from 'node:test';
import assert from 'node:assert/strict';

import { createGeneration, getMediaBudget, updateMediaBudget, NON_HOUSE_MEDIA_MONTHLY_LIMIT_CENTS } from '../src/media/router.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333' };
const HOUSE_ORG_ID = '923e4567-e89b-42d3-a456-426614174999';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function withFetchMock(role, fn, { houseId = HOUSE_ORG_ID, stored } = {}) {
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
    if (href.includes('/rest/v1/orgs?slug=eq.mccluster')) {
      return jsonResponse(houseId ? [{ id: houseId }] : []);
    }
    if (href.includes('/rest/v1/org_media_budgets?') && (options.method || 'GET') === 'GET') {
      if (stored !== undefined) return jsonResponse(stored ? [stored] : []);
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
  // The house org pays fal.ai, so it alone may set an allowance this large.
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
  }, { houseId: ORG_ID });
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

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };

test('a non-house owner cannot raise the allowance above the ceiling', async () => {
  for (const limit of [NON_HOUSE_MEDIA_MONTHLY_LIMIT_CENTS + 1, Number.MAX_SAFE_INTEGER]) {
    await withFetchMock('owner', async (seen) => {
      await assert.rejects(
        () => updateMediaBudget(req('PATCH', { enabled: true, monthly_limit_cents: limit }), ENV, OWNER),
        (error) => error.status === 403 && error.detail.max_monthly_limit_cents === NON_HOUSE_MEDIA_MONTHLY_LIMIT_CENTS
      );
      assert.equal(seen.some((x) => x.href.includes('org_media_budgets') && x.method === 'POST'), false);
    });
  }
});

test('an unresolvable house org is not treated as the house org', async () => {
  await withFetchMock('owner', async (seen) => {
    await assert.rejects(
      () => updateMediaBudget(req('PATCH', { enabled: true, monthly_limit_cents: 50000 }), ENV, OWNER),
      (error) => error.status === 403
    );
    assert.equal(seen.some((x) => x.href.includes('org_media_budgets') && x.method === 'POST'), false);
  }, { houseId: null });
});

test('a non-house owner can set an allowance at the ceiling', async () => {
  await withFetchMock('owner', async (seen) => {
    const result = await updateMediaBudget(
      req('PATCH', { enabled: true, monthly_limit_cents: NON_HOUSE_MEDIA_MONTHLY_LIMIT_CENTS }), ENV, OWNER
    );
    assert.equal(result.budget.monthly_limit_cents, NON_HOUSE_MEDIA_MONTHLY_LIMIT_CENTS);
  });
});

function generate() {
  return new Request('https://api.mccluster.org/v1/media/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_id: ORG_ID, model_id: 't2i', prompt: 'a lighthouse' })
  });
}

// Generation fixture: owner of a non-house org, a priced model, and a stored
// allowance. Reaching the reservation RPC is the "allowed" signal.
async function tryGenerate(stored, houseId = HOUSE_ORG_ID) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    seen.push(href);
    if (href.includes('/rest/v1/org_members?')) return jsonResponse([{ org_id: ORG_ID, role: 'owner' }]);
    if (href.includes('/rest/v1/control_role_capabilities?')) return jsonResponse([{ role: 'owner', capability: 'media.generate', allowed: true }]);
    if (href.includes('/rest/v1/media_models?')) {
      return jsonResponse([{ id: 't2i', provider: 'fal', provider_model_id: 'fal-ai/flux-2', capability: 'text-to-image', parameter_schema: {}, cost_hint: {}, enabled: true }]);
    }
    if (href.includes('/rest/v1/orgs?slug=eq.mccluster')) return jsonResponse(houseId ? [{ id: houseId }] : []);
    if (href.includes('/rest/v1/org_media_budgets?')) return jsonResponse(stored ? [stored] : []);
    if (href.includes('/rest/v1/rpc/media_create_budgeted_job_v2')) throw new Error('reached reservation');
    throw new Error(`Unexpected fetch: ${href}`);
  };
  __resetCapabilityCache();
  try {
    return await createGeneration(generate(), ENV, OWNER).then(() => ({ seen }), (error) => ({ error, seen }));
  } finally {
    globalThis.fetch = original;
    __resetCapabilityCache();
  }
}

const reserved = (seen) => seen.some((h) => h.includes('media_create_budgeted_job'));

test('a non-house org with no enabled allowance cannot spend on the house fal.ai account', async () => {
  for (const stored of [null, { enabled: false, monthly_limit_cents: 1000 }, { enabled: true, monthly_limit_cents: null }]) {
    const { error, seen } = await tryGenerate(stored);
    assert.equal(error?.status, 403, JSON.stringify(stored));
    assert.equal(reserved(seen), false);
  }
});

test('a stored non-house allowance above the ceiling is refused, not trusted', async () => {
  const { error, seen } = await tryGenerate({ enabled: true, monthly_limit_cents: Number.MAX_SAFE_INTEGER });
  assert.equal(error?.status, 403);
  assert.equal(reserved(seen), false);
});

test('a non-house org within its stored allowance reaches the budgeted reservation', async () => {
  const { error, seen } = await tryGenerate({ enabled: true, monthly_limit_cents: NON_HOUSE_MEDIA_MONTHLY_LIMIT_CENTS });
  assert.match(String(error?.message), /reached reservation/);
  assert.equal(reserved(seen), true);
});

test('the house org is not held to the non-house ceiling', async () => {
  const { error, seen } = await tryGenerate(null, ORG_ID);
  assert.match(String(error?.message), /reached reservation/);
  assert.equal(seen.some((h) => h.includes('org_media_budgets')), false);
});
