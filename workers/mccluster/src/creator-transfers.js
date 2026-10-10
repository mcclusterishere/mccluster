import { stripeRequest } from './whip/stripe.js';

/**
 * McCluster-funded creator transfers. This module intentionally has no public route:
 * caller must authenticate the McCluster owner, atomically reserve a verified earning
 * and bind the creator's destination account server-side before invoking it.
 *
 * Live transfers are prohibited during pilot, regardless of caller arguments.
 */
export async function transferApprovedCreatorEarning(env, intent) {
  if (!/^sk_test_/.test(String(env.STRIPE_SECRET_KEY || ''))) {
    throw new Error('creator_transfers_test_mode_only');
  }
  if (env.CREATOR_PAYOUTS_TEST_ENABLED !== 'true') {
    throw new Error('creator_transfers_disabled');
  }
  if (!intent?.approved || !intent?.reserved || !intent?.verified) {
    throw new Error('earning_not_verified_approved_and_reserved');
  }
  if (!/^acct_[a-zA-Z0-9]+$/.test(String(intent.destination || ''))) {
    throw new Error('invalid_connected_account');
  }
  if (!Number.isSafeInteger(intent.amountCents) || intent.amountCents <= 0) {
    throw new Error('invalid_transfer_amount');
  }
  if (intent.currency !== 'usd') throw new Error('unsupported_currency');
  if (!/^[0-9a-f-]{36}$/.test(String(intent.earningId || ''))) {
    throw new Error('invalid_earning_id');
  }

  const account = await stripeRequest(env, 'accounts/' + encodeURIComponent(intent.destination), {}, { method: 'GET' });
  if (account.id !== intent.destination || account.capabilities?.transfers !== 'active' || !account.payouts_enabled) {
    throw new Error('connected_account_not_transfer_ready');
  }

  const balance = await stripeRequest(env, 'balance', {}, { method: 'GET' });
  const availableUsd = (balance.available || []).filter(b => b.currency === 'usd').reduce((n, b) => n + b.amount, 0);
  if (availableUsd < intent.amountCents) throw new Error('insufficient_stripe_test_balance');

  // Stable across retries. A caller must persist the same immutable payout intent
  // and recover the transfer by idempotency key after any uncertain network failure.
  const idempotencyKey = 'mccluster_creator_' + intent.earningId;
  return stripeRequestWithIdempotency(env, {
    amount: intent.amountCents,
    currency: intent.currency,
    destination: intent.destination,
    transfer_group: 'creator_earning_' + intent.earningId,
    metadata: { earning_id: intent.earningId, org_id: String(intent.orgId || '') }
  }, idempotencyKey);
}

async function stripeRequestWithIdempotency(env, params, key) {
  const form = new URLSearchParams();
  for (const [field, value] of Object.entries(params)) {
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) form.set(field + '[' + k + ']', String(v));
    } else form.set(field, String(value));
  }
  const response = await fetch('https://api.stripe.com/v1/transfers', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'content-type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': key
    },
    body: form.toString()
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.code || 'stripe_transfer_failed');
  return { transferId: body.id, amountCents: body.amount, currency: body.currency, destination: body.destination };
}
