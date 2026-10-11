/* Deterministic, side-effect-free Decision Intelligence scenario economics.
   Money is represented in integer minor units. No AI-generated arithmetic is trusted. */
function money(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(field + ' must be a nonnegative integer in minor units');
  return value;
}
function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(field + ' must be a nonnegative integer');
  return value;
}
export function evaluateCampaignScenario(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Scenario object required');
  const visitors = count(input.visitors, 'visitors');
  const signups = count(input.signups, 'signups');
  const customers = count(input.customers, 'customers');
  if (signups > visitors || customers > signups) throw new RangeError('Funnel counts must be monotonically nonincreasing');
  const revenue = money(input.verifiedRevenueMinor, 'verifiedRevenueMinor');
  const refunds = money(input.refundsMinor, 'refundsMinor');
  const paymentFees = money(input.paymentFeesMinor, 'paymentFeesMinor');
  const acquisition = money(input.acquisitionCostMinor, 'acquisitionCostMinor');
  const creator = money(input.creatorCostMinor, 'creatorCostMinor');
  const infrastructure = money(input.infrastructureCostMinor, 'infrastructureCostMinor');
  if (refunds > revenue) throw new RangeError('Refunds cannot exceed verified revenue');
  const netRevenueMinor = revenue - refunds;
  const totalCostMinor = paymentFees + acquisition + creator + infrastructure;
  if (!Number.isSafeInteger(totalCostMinor)) throw new RangeError('Cost total exceeds safe integer range');
  const contributionMinor = netRevenueMinor - totalCostMinor;
  return Object.freeze({
    visitors, signups, customers,
    signupRate: visitors ? signups / visitors : null,
    customerConversionRate: visitors ? customers / visitors : null,
    netRevenueMinor, totalCostMinor, contributionMinor,
    acquisitionCostPerCustomerMinor: customers ? acquisition / customers : null,
    contributionMargin: netRevenueMinor ? contributionMinor / netRevenueMinor : null,
    profitable: contributionMinor > 0,
    assumptions: 'Observed inputs only; no attribution or causal lift inferred'
  });
}
