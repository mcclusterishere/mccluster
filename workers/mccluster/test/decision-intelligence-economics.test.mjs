import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCampaignScenario } from '../src/decision-intelligence/economics.js';

const scenario = (changes = {}) => ({
  visitors: 1000, signups: 100, customers: 20,
  verifiedRevenueMinor: 200000, refundsMinor: 20000,
  paymentFeesMinor: 6000, acquisitionCostMinor: 50000,
  creatorCostMinor: 25000, infrastructureCostMinor: 9000,
  ...changes
});

test('calculates observed campaign unit economics in minor units', () => {
  const result = evaluateCampaignScenario(scenario());
  assert.equal(result.netRevenueMinor, 180000);
  assert.equal(result.totalCostMinor, 90000);
  assert.equal(result.contributionMinor, 90000);
  assert.equal(result.signupRate, 0.1);
  assert.equal(result.customerConversionRate, 0.02);
  assert.equal(result.acquisitionCostPerCustomerMinor, 2500);
  assert.equal(result.contributionMargin, 0.5);
  assert.equal(result.profitable, true);
});

test('zero denominators return null rather than misleading zero rates', () => {
  const result = evaluateCampaignScenario(scenario({ visitors: 0, signups: 0, customers: 0, verifiedRevenueMinor: 0, refundsMinor: 0 }));
  assert.equal(result.signupRate, null);
  assert.equal(result.customerConversionRate, null);
  assert.equal(result.acquisitionCostPerCustomerMinor, null);
  assert.equal(result.contributionMargin, null);
});

test('rejects inconsistent funnels, refunds and invalid money', () => {
  assert.throws(() => evaluateCampaignScenario(scenario({ signups: 1001 })), /Funnel/);
  assert.throws(() => evaluateCampaignScenario(scenario({ refundsMinor: 200001 })), /Refunds/);
  assert.throws(() => evaluateCampaignScenario(scenario({ creatorCostMinor: -1 })), /nonnegative/);
  assert.throws(() => evaluateCampaignScenario(scenario({ paymentFeesMinor: 1.5 })), /integer/);
});

test('rejects unsafe aggregated costs', () => {
  assert.throws(() => evaluateCampaignScenario(scenario({ infrastructureCostMinor: Number.MAX_SAFE_INTEGER })), /safe integer/);
});
