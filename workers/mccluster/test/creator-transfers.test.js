import test from 'node:test';
import assert from 'node:assert/strict';
import { transferApprovedCreatorEarning } from '../src/creator-transfers.js';

test('never permits live Stripe transfers', async () => {
  await assert.rejects(() => transferApprovedCreatorEarning({STRIPE_SECRET_KEY:'sk_live_fake',CREATOR_PAYOUTS_TEST_ENABLED:'true'},{}),/test_mode_only/);
});
test('requires explicit pilot enablement', async () => {
  await assert.rejects(() => transferApprovedCreatorEarning({STRIPE_SECRET_KEY:'sk_test_fake'},{}),/disabled/);
});
test('requires verified approved and reserved earning', async () => {
  await assert.rejects(() => transferApprovedCreatorEarning({STRIPE_SECRET_KEY:'sk_test_fake',CREATOR_PAYOUTS_TEST_ENABLED:'true'},{}),/earning_not_verified/);
});
test('rejects caller-provided malformed destinations before any network access', async () => {
  await assert.rejects(() => transferApprovedCreatorEarning({STRIPE_SECRET_KEY:'sk_test_fake',CREATOR_PAYOUTS_TEST_ENABLED:'true'},{approved:true,verified:true,reserved:true,destination:'external',amountCents:200,currency:'usd',earningId:'00000000-0000-0000-0000-000000000001'}),/invalid_connected_account/);
});
test('rejects zero and fractional transfers', async () => {
  for (const amountCents of [0,-1,1.5]) {
    await assert.rejects(() => transferApprovedCreatorEarning({STRIPE_SECRET_KEY:'sk_test_fake',CREATOR_PAYOUTS_TEST_ENABLED:'true'},{approved:true,verified:true,reserved:true,destination:'acct_123',amountCents,currency:'usd',earningId:'00000000-0000-0000-0000-000000000001'}),/invalid_transfer_amount/);
  }
});
