/* Records the Stripe reconciler writes, as Control sees them.

   supabase/functions/stripe-webhook records a paid checkout as a
   stripe_checkout order and a provider-verified payment. Control may annotate
   those rows and move an order through fulfillment, but it may not retype
   what Stripe recorded, and test-mode money is shown without ever being
   counted as revenue. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleWorkRequest } from '../src/work.js';

const USER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'matthew@mccluster.org' };
const HOUSE = '123e4567-e89b-42d3-a456-426614174000';
const LEAD = '623e4567-e89b-42d3-a456-426614174666';
const STRIPE_ORDER = '723e4567-e89b-42d3-a456-426614174777';
const MANUAL_ORDER = '733e4567-e89b-42d3-a456-426614174777';
const VERIFIED = 'b23e4567-e89b-42d3-a456-426614174bbb';
const TEST_MODE = 'b33e4567-e89b-42d3-a456-426614174bbb';
const OWNER_RECORDED = 'b43e4567-e89b-42d3-a456-426614174bbb';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const ROWS = {
  leads: [{ id: LEAD, org_id: HOUSE, name: 'Buyer One', email: 'buyer.one@example.com', status: 'confirmed', created_at: '2026-10-06T12:00:00+00:00' }],
  work_orders: [
    { id: STRIPE_ORDER, org_id: HOUSE, lead_id: LEAD, title: 'Print 11x14 · Buyer One', state: 'paid', amount_cents: 4000, currency: 'usd',
      items: [{ title: 'Print 11x14', offering: 'print-11x14', quantity: 1 }], source_table: 'stripe_checkout', source_id: 'cs_live_a1B2c3D4e5F6',
      placed_at: '2026-10-06T12:00:00+00:00', livemode: true },
    { id: MANUAL_ORDER, org_id: HOUSE, lead_id: LEAD, title: 'Hand-entered order', state: 'open', amount_cents: 1000, currency: 'usd',
      items: [], source_table: null, source_id: null, placed_at: '2026-10-01T00:00:00+00:00', livemode: true }
  ],
  work_payments: [
    { id: VERIFIED, org_id: HOUSE, lead_id: LEAD, order_id: STRIPE_ORDER, title: 'Print 11x14 · Buyer One', state: 'paid', amount_cents: 4000,
      currency: 'usd', provider: 'stripe', provider_reference: 'pi_3Abc123', verification: 'provider_verified',
      paid_at: '2026-10-06T12:00:00+00:00', livemode: true, created_at: '2026-10-06T12:00:01+00:00' },
    { id: TEST_MODE, org_id: HOUSE, lead_id: LEAD, title: 'TEST · Print 11x14 · Tester', state: 'paid', amount_cents: 4000, currency: 'usd',
      provider: 'stripe', provider_reference: 'pi_testAbc123', verification: 'provider_verified', paid_at: '2026-10-06T13:00:00+00:00',
      livemode: false, created_at: '2026-10-06T13:00:01+00:00' },
    { id: OWNER_RECORDED, org_id: HOUSE, lead_id: LEAD, title: 'Cash at the show', state: 'paid', amount_cents: 2500, currency: 'usd',
      provider: 'manual', verification: 'owner_recorded', paid_at: '2026-10-02T00:00:00+00:00', livemode: true, created_at: '2026-10-02T00:00:00+00:00' }
  ]
};

function backend() {
  const calls = [];
  const handler = async (href, options = {}) => {
    href = String(href);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ href, method, body });
    if (href.includes('/rest/v1/org_members')) {
      return json([{ role: 'owner', added_at: '2026-01-01T00:00:00Z', orgs: { id: HOUSE, slug: 'mccluster', name: 'McCluster', kind: 'studio', enabled: true } }]);
    }
    if (href.includes('/rest/v1/control_audit') && method === 'POST') return json([{ id: 1, at: '2026-10-06T00:00:00Z' }]);
    if (href.includes('/rest/v1/control_audit')) return json([]);
    const table = href.split('/rest/v1/')[1].split('?')[0];
    const id = (href.match(/[?&]id=eq\.([0-9a-f-]{36})/) || [])[1];
    const list = (ROWS[table] || []).filter((r) => !id || r.id === id);
    if (method === 'PATCH') return json([{ ...list[0], ...body }]);
    return json(list);
  };
  return {
    calls,
    handler,
    writes(table) { return calls.filter((c) => c.method !== 'GET' && c.href.includes(`/rest/v1/${table}`)); }
  };
}

const run = (b, method, path, body) => {
  const original = globalThis.fetch;
  globalThis.fetch = b.handler;
  const url = new URL(`https://api.mccluster.org${path}`);
  const init = { method, headers: { 'content-type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return Promise.resolve()
    .then(() => handleWorkRequest(new Request(url, init), env, USER, url))
    .finally(() => { globalThis.fetch = original; });
};

test('a provider-verified payment cannot be retyped in Control', async () => {
  const b = backend();
  for (const [field, value] of [
    ['amount_cents', 1], ['currency', 'eur'], ['provider', 'manual'], ['provider_reference', 'pi_other'],
    ['state', 'refunded'], ['paid_at', '2026-01-01T00:00:00Z']
  ]) {
    await assert.rejects(run(b, 'PATCH', `/v1/work/payments/${VERIFIED}`, { org_id: HOUSE, [field]: value }),
      (err) => err.status === 400 && /changes only through its provider/.test(err.message) && err.message.includes(field), field);
  }
  assert.equal(b.writes('work_payments').length, 0, 'nothing was written');

  const note = await run(b, 'PATCH', `/v1/work/payments/${VERIFIED}`, { org_id: HOUSE, note: 'Framed, ships Friday', title: 'Print for Buyer One' });
  assert.equal(note.changed, true, 'its title and note stay the owner’s to write');
  assert.deepEqual(Object.keys(b.writes('work_payments')[0].body).sort(), ['note', 'title']);
});

test('resending a verified row unchanged is not an edit', async () => {
  const b = backend();
  const out = await run(b, 'PATCH', `/v1/work/payments/${VERIFIED}`, {
    org_id: HOUSE, amount_cents: 4000, currency: 'USD', provider: 'stripe', provider_reference: 'pi_3Abc123', state: 'paid',
    paid_at: '2026-10-06T12:00:00.000Z'
  });
  assert.equal(out.payment.id, VERIFIED, 'the +00:00 and Z spellings of one instant are the same time');
});

test('an owner-recorded payment stays fully editable', async () => {
  const b = backend();
  const out = await run(b, 'PATCH', `/v1/work/payments/${OWNER_RECORDED}`, { org_id: HOUSE, amount_cents: 3000, state: 'refunded' });
  assert.equal(out.changed, true);
  assert.equal(b.writes('work_payments')[0].body.amount_cents, 3000);
});

test('a Stripe checkout order keeps Stripe’s amount and lines but moves through fulfillment', async () => {
  const b = backend();
  for (const [field, value] of [['amount_cents', 1], ['currency', 'eur'], ['items', []], ['placed_at', '2026-01-01T00:00:00Z']]) {
    await assert.rejects(run(b, 'PATCH', `/v1/work/orders/${STRIPE_ORDER}`, { org_id: HOUSE, [field]: value }),
      (err) => err.status === 400 && /came from a Stripe checkout/.test(err.message), field);
  }
  const same = await run(b, 'PATCH', `/v1/work/orders/${STRIPE_ORDER}`, {
    org_id: HOUSE, items: [{ quantity: 1, offering: 'print-11x14', title: 'Print 11x14' }], placed_at: '2026-10-06T12:00:00Z'
  });
  assert.equal(same.order.id, STRIPE_ORDER, 'the same lines in another key order are not a change');
  const shipped = await run(b, 'PATCH', `/v1/work/orders/${STRIPE_ORDER}`, { org_id: HOUSE, state: 'fulfilled' });
  assert.equal(shipped.order.state, 'fulfilled');

  const manual = await run(b, 'PATCH', `/v1/work/orders/${MANUAL_ORDER}`, { org_id: HOUSE, amount_cents: 1200 });
  assert.equal(manual.changed, true, 'an order entered by hand is still the owner’s to correct');
});

test('test-mode money is shown in history but never counted as revenue', async () => {
  const b = backend();
  const out = await run(b, 'GET', `/v1/work/history?org_id=${HOUSE}&lead_id=${LEAD}`);
  assert.equal(out.records.payments.length, 3, 'every payment is listed');
  assert.equal(out.totals.paid_cents, 6500, 'live Stripe 4000 + cash 2500; the test payment is excluded');
  assert.equal(out.totals.billed_cents, 6500);
  assert.equal(out.totals.provider_verified_cents, 4000, 'only the live Stripe payment is verified revenue');
  assert.equal(out.totals.test_mode_cents, 4000, 'test money is reported separately');
  assert.equal(out.records.orders.length, 2);
});
