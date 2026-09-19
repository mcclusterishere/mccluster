/* GET /v1/media/usage.

   Every other control on media spend is per job, so a funded provider balance
   could drain through many individually-approved jobs with nothing able to say
   so. This aggregates the media_cost_events ledger.

   What matters here: it reads the ledger rather than recomputing a figure, it
   refuses a caller who is not in the org, and a group_by it does not support is
   rejected rather than silently falling back to something else. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { getUsage } from '../src/media/router.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const USER = { id: '423e4567-e89b-42d3-a456-426614174333' };

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function withFetchMock(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

const ROLLUP = {
  ok: true,
  org_id: ORG_ID,
  group_by: 'day',
  totals: { jobs: 3, reserved_cents: 110, released_cents: 0, actual_cents: 73, committed_cents: 110, in_flight_jobs: 1, unsettled_cents: 37 },
  rows: [{ key: '2026-09-17', jobs: 3, reserved_cents: 110, actual_cents: 73, committed_cents: 110, in_flight_jobs: 1 }]
};

function backend({ member = true, rollup = ROLLUP, wrapped = false } = {}) {
  const calls = [];
  return {
    calls,
    handler: async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
      if (href.includes('/rest/v1/org_members')) {
        return jsonResponse(member ? [{ org_id: ORG_ID, role: 'owner' }] : []);
      }
      if (href.includes('/rest/v1/rpc/media_usage_rollup')) {
        return jsonResponse(wrapped ? [rollup] : rollup);
      }
      return jsonResponse([]);
    }
  };
}

function get(query = '') {
  return new Request(`https://api.mccluster.org/v1/media/usage?org_id=${ORG_ID}${query}`, { method: 'GET' });
}

test('returns the ledger rollup for a member', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => {
    const usage = await getUsage(get(), env, USER);
    assert.equal(usage.totals.actual_cents, 73);
    /* Committed is what answers "how much of the balance is gone": settled
       actuals plus reservations still in flight. */
    assert.equal(usage.totals.committed_cents, 110);
    assert.equal(usage.totals.unsettled_cents, 37);
    assert.equal(usage.rows.length, 1);
  });
});

test('a scalar rpc result wrapped in an array is unwrapped', async () => {
  const be = backend({ wrapped: true });
  await withFetchMock(be.handler, async () => {
    const usage = await getUsage(get(), env, USER);
    assert.equal(usage.totals.jobs, 3, 'must not return the array itself');
  });
});

test('a non-member cannot read org spend', async () => {
  const be = backend({ member: false });
  await withFetchMock(be.handler, async () => {
    await assert.rejects(() => getUsage(get(), env, USER), (e) => e.status === 403);
  });
  assert.ok(
    !be.calls.some((c) => c.href.includes('media_usage_rollup')),
    'the rollup must not run once membership is refused'
  );
});

test('the org is taken from the membership check, not passed through blindly', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => { await getUsage(get(), env, USER); });
  const call = be.calls.find((c) => c.href.includes('media_usage_rollup'));
  assert.equal(call.body.p_org_id, ORG_ID);
});

test('supported groupings are passed through', async () => {
  for (const group of ['day', 'provider', 'capability', 'model']) {
    const be = backend({});
    await withFetchMock(be.handler, async () => { await getUsage(get(`&group_by=${group}`), env, USER); });
    const call = be.calls.find((c) => c.href.includes('media_usage_rollup'));
    assert.equal(call.body.p_group_by, group);
  }
});

test('an unsupported grouping is refused rather than silently defaulted', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => {
    await assert.rejects(() => getUsage(get('&group_by=everything'), env, USER), (e) => e.status === 400);
  });
});

test('a malformed date is refused rather than becoming "all time"', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => {
    /* Silently widening the window would understate burn rate by spreading
       spend over a period the caller did not ask for. */
    await assert.rejects(() => getUsage(get('&from=not-a-date'), env, USER), (e) => e.status === 400);
  });
});

test('an omitted window is left for the function to default', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => { await getUsage(get(), env, USER); });
  const call = be.calls.find((c) => c.href.includes('media_usage_rollup'));
  assert.equal(call.body.p_from, null);
  assert.equal(call.body.p_to, null);
});

test('an explicit window is forwarded as an instant', async () => {
  const be = backend({});
  await withFetchMock(be.handler, async () => {
    await getUsage(get('&from=2026-09-01T00:00:00Z&to=2026-09-17T00:00:00Z'), env, USER);
  });
  const call = be.calls.find((c) => c.href.includes('media_usage_rollup'));
  assert.equal(call.body.p_from, '2026-09-01T00:00:00.000Z');
  assert.equal(call.body.p_to, '2026-09-17T00:00:00.000Z');
});
