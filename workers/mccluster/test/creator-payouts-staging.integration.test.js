/**
 * Fail-closed concurrency and Stripe sandbox smoke harness.
 * Run only against an isolated staging Supabase project with seeded test earnings.
 * Required env: CREATOR_PAYOUTS_API, CREATOR_PAYOUTS_OWNER_JWT,
 * CREATOR_PAYOUTS_TEST_EARNING_ID. Never supplies live Stripe keys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const api = process.env.CREATOR_PAYOUTS_API;
const jwt = process.env.CREATOR_PAYOUTS_OWNER_JWT;
const earningId = process.env.CREATOR_PAYOUTS_TEST_EARNING_ID;
const enabled = Boolean(api && jwt && earningId);

async function post(path, payload) {
  const response = await fetch(new URL(path, api), {
    method: 'POST',
    headers: { authorization: 'Bearer ' + jwt, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test('concurrent reservations cannot both reserve one earning', { skip: !enabled }, async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    post('/v1/creator-payouts/reserve', { earning_id: earningId })
  ));
  const successes = results.filter(x => x.status >= 200 && x.status < 300);
  assert.equal(successes.length, 1, JSON.stringify(results));
});

test('concurrent transfers cannot both claim the same payout intent', { skip: !enabled }, async () => {
  const listing = await fetch(new URL('/v1/creator-payouts', api), {
    headers: { authorization: 'Bearer ' + jwt }
  });
  assert.equal(listing.status, 200);
  const data = await listing.json();
  const intent = (data.intents || []).find(x => x.earning_id === earningId);
  assert.ok(intent, 'seeded earning must have a reserved intent');
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    post('/v1/creator-payouts/transfer', { intent_id: intent.id })
  ));
  const accepted = results.filter(x => x.status >= 200 && x.status < 300);
  assert.ok(accepted.length <= 1, JSON.stringify(results));
  assert.ok(results.some(x => x.status === 409), JSON.stringify(results));
});
