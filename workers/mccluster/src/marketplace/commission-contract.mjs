/**
 * Shared marketplace commission contract v1.
 * Pure calculation only: NO Stripe calls, payout authorization, or database writes.
 * Caps are mandatory and are enforced against committed+pending lifetime accruals
 * by the server in a transaction/lock before an award is ever persisted.
 */
export const MARKETPLACE_POLICY_V1 = Object.freeze({
  version: 'marketplace-commission-v1',
  providerBps: 7000,
  customerReferrerBps: 500,
  supplyReferrerBps: 500,
  operatorBps: 1000,
  reserveBps: 1000,
  payoutsEnabled: false,
  // Intentionally unset until the owner approves a specific dollar cap.
  customerReferralCapCents: null,
  supplyReferralCapCents: null
});

const ROLES = ['providerBps','customerReferrerBps','supplyReferrerBps','operatorBps','reserveBps'];
const validMoney = n => Number.isSafeInteger(n) && n >= 0;
export function validateMarketplacePolicy(policy) {
  if (!policy || !ROLES.every(k => Number.isInteger(policy[k]) && policy[k] >= 0 && policy[k] <= 10000) ||
    ROLES.reduce((s,k)=>s+policy[k],0)!==10000) throw new RangeError('Shares must be nonnegative integer basis points summing to 10000');
  if (policy.payoutsEnabled !== false) throw new Error('Payouts disabled pending compliance and unit economics');
  for (const key of ['customerReferralCapCents','supplyReferralCapCents']) {
    if (policy[key] !== null && !validMoney(policy[key])) throw new RangeError(key+' must be nonnegative cents or null');
  }
  return policy;
}
function capAward(nominal, cap, previouslyAccrued) {
  if (cap === null) return 0; // fail closed until cap is approved
  if (!validMoney(previouslyAccrued)) throw new RangeError('Invalid prior accrual');
  return Math.min(nominal, Math.max(0, cap - previouslyAccrued));
}
/**
 * Inputs must come from server-verified, settled transaction data.
 * The two referral roles may be held by the same verified account;
 * caps are independent by role/attribution agreement.
 * This does not enforce concurrency or authorize money movement.
 */
export function quoteMarketplaceAllocation({
  commissionableCents, policy = MARKETPLACE_POLICY_V1,
  customerReferrerEligible = false, supplyReferrerEligible = false,
  customerPreviouslyAccruedCents = 0, supplyPreviouslyAccruedCents = 0
}) {
  validateMarketplacePolicy(policy);
  if (!validMoney(commissionableCents)) throw new RangeError('Invalid commissionable amount');
  if (typeof customerReferrerEligible !== 'boolean' || typeof supplyReferrerEligible !== 'boolean') throw new TypeError('Eligibility must be boolean');
  const portion = bps => Math.floor(commissionableCents * bps / 10000);
  const providerCents = portion(policy.providerBps);
  const customerReferrerCents = customerReferrerEligible
    ? capAward(portion(policy.customerReferrerBps),policy.customerReferralCapCents,customerPreviouslyAccruedCents) : 0;
  const supplyReferrerCents = supplyReferrerEligible
    ? capAward(portion(policy.supplyReferrerBps),policy.supplyReferralCapCents,supplyPreviouslyAccruedCents) : 0;
  const reserveCents = portion(policy.reserveBps);
  const operatorCents = commissionableCents - providerCents - customerReferrerCents - supplyReferrerCents - reserveCents;
  return Object.freeze({
    policyVersion: policy.version, commissionableCents, providerCents,
    customerReferrerCents, supplyReferrerCents, reserveCents, operatorCents,
    payoutsEnabled: false, payable: false
  });
}
