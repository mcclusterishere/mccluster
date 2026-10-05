import test from 'node:test';
import assert from 'node:assert/strict';

import { getMediaBudget, putMediaBudget } from '../src/media/router.js';

const ORG = '123e4567-e89b-42d3-a456-426614174000';
const USER = { id: '423e4567-e89b-42d3-a456-426614174333' };
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

function backend({ role = 'owner', budget = null } = {}) {
  const calls = [];
  return {
    calls,
    handler: async (url, options = {}) => {
      const href = String(url);
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ href, method, body, headers: options.headers || {} });

      if (href.includes('/rest/v1/org_members')) {
        return json(role ? [{ org_id: ORG, role }] : []);
      }
      if (href.includes('/rest/v1/org_media_budgets')) {
        if (method === 'POST') return json([{ ...body, created_at: '2026-10-05T00:00:00Z' }]);
        return json(budget ? [budget] : []);
      }
      if (href.includes('/rest/v1/rpc/media_usage_rollup')) {
        return json({ totals: { jobs: 4, actual_cents: 700, committed_cents: 900, in_flight_jobs: 1, unsettled_cents: 200 }, rows: [] });
      }
      if (href.includes('/rest/v1/control_audit')) {
        return json([{ id: 9, at: '2026-10-05T00:00:00Z' }]);
      }
      return json([]);
    }
  };
}

function getRequest() {
  return new Request(`https://api.mccluster.org/v1/media/budget?org_id=${ORG}`, { method: 'GET' });
}

function putRequest(body) {
  return new Request('https://api.mccluster.org/v1/media/budget', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_id: ORG, ...body })
  });
}

test('budget GET returns a disabled default without inventing a cap', async () => {
  const be = backend();
  await withFetch(be.handler, async () => {
    const result = await getMediaBudget(getRequest(), env, USER);
    assert.equal(result.configured, false);
    assert.equal(result.budget.enabled, false);
    assert.equal(result.budget.monthly_limit_cents, null);
    assert.equal(result.budget.warn_at_percent, 80);
    assert.equal(result.usage.committed_cents, 900);
    assert.match(result.period.from, /^2026-10-01T00:00:00\.000Z$/);
  });
});

test('budget GET returns the stored owner policy and current-month spend', async () => {
  const stored = { org_id: ORG, enabled: true, monthly_limit_cents: 5000, warn_at_percent: 75 };
  const be = backend({ budget: stored });
  await withFetch(be.handler, async () => {
    const result = await getMediaBudget(getRequest(), env, USER);
    assert.equal(result.configured, true);
    assert.equal(result.budget.monthly_limit_cents, 5000);
    assert.equal(result.usage.actual_cents, 700);
  });
});

test('only an owner can change the monthly allowance', async () => {
  const be = backend({ role: 'staff' });
  await withFetch(be.handler, async () => {
    await assert.rejects(
      () => putMediaBudget(putRequest({ enabled: true, monthly_limit_cents: 5000 }), env, USER),
      (error) => error.status === 403
    );
  });
  assert.ok(!be.calls.some((call) => call.href.includes('/org_media_budgets') && call.method === 'POST'));
});

test('an enabled allowance requires an explicit non-negative integer cap', async () => {
  for (const value of [null, -1, 2.5, 'nope']) {
    const be = backend();
    await withFetch(be.handler, async () => {
      await assert.rejects(
        () => putMediaBudget(putRequest({ enabled: true, monthly_limit_cents: value }), env, USER),
        (error) => error.status === 400
      );
    });
  }
});

test('owner writes are upserted and recorded in the Control audit ledger', async () => {
  const be = backend();
  await withFetch(be.handler, async () => {
    const result = await putMediaBudget(
      putRequest({ enabled: true, monthly_limit_cents: 12500, warn_at_percent: 85 }),
      env,
      USER
    );
    assert.equal(result.budget.enabled, true);
    assert.equal(result.budget.monthly_limit_cents, 12500);
    assert.equal(result.audit.recorded, true);
  });

  const write = be.calls.find((call) => call.href.includes('/org_media_budgets') && call.method === 'POST');
  assert.ok(write);
  assert.equal(write.body.org_id, ORG);
  assert.equal(write.body.updated_by, USER.id);
  assert.match(String(write.headers.prefer || ''), /resolution=merge-duplicates/);

  const audit = be.calls.find((call) => call.href.includes('/control_audit'));
  assert.equal(audit.body.event, 'media.budget.updated');
  assert.equal(audit.body.detail.monthly_limit_cents, 12500);
});

test('the warning threshold is bounded to a real percentage', async () => {
  const be = backend();
  await withFetch(be.handler, async () => {
    await assert.rejects(
      () => putMediaBudget(putRequest({ enabled: false, monthly_limit_cents: null, warn_at_percent: 101 }), env, USER),
      (error) => error.status === 400
    );
  });
});
