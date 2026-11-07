/** Published USD rates checked 2026-10-17, not the customer's actual bill.
 * Shared account allowances are optional because other workloads consume them.
 * Excludes DB, email, paid network APIs, payment fees, people, taxes, DO/log costs
 * and network overages. Native processing and managed transforms are alternatives.
 * Sources: docs/website-studio/FOUNDATION.md.
 */
function nonnegative(n, name) {
  if (!Number.isFinite(n) || n < 0) throw new TypeError(`${name} must be nonnegative`);
  return n;
}
const excess = (n, allowance) => Math.max(0, n - allowance);
export function r2Cost({ gbMonths, classA = 0, classB = 0, allowances = true }) {
  [gbMonths, classA, classB].forEach(n => nonnegative(n, 'R2 usage'));
  // R2 rounds storage and operation billing units up, not to arbitrary cents.
  return excess(Math.ceil(gbMonths), allowances ? 10 : 0) * 0.015
    + Math.ceil(excess(classA, allowances ? 1e6 : 0) / 1e6) * 4.5
    + Math.ceil(excess(classB, allowances ? 1e7 : 0) / 1e6) * 0.36;
}
export function streamCost({ storedMinutes, deliveredMinutes }) {
  nonnegative(storedMinutes, 'stored minutes'); nonnegative(deliveredMinutes, 'delivered minutes');
  return Math.ceil(storedMinutes / 1000) * 5 + deliveredMinutes / 1000;
}
export function standard2ProcessingCost({ busyHours, allowances = true }) {
  nonnegative(busyHours, 'busy hours');
  // standard-2: assume full 1 vCPU use, 6 GiB provisioned RAM, 12 GB disk.
  // This is a supplied capacity budget, NOT a measured number of video jobs.
  return excess(busyHours, allowances ? 6.25 : 0) * 0.072
    + excess(busyHours * 6, allowances ? 25 : 0) * 0.009
    + excess(busyHours * 12, allowances ? 200 : 0) * 0.000252;
}
export function transformationCost({ operations, allowances = true, bindingBetaUnbilled = false }) {
  nonnegative(operations, 'transformations');
  return bindingBetaUnbilled ? 0 : excess(operations, allowances ? 5000 : 0) * 0.0005;
}
export function pilotEstimate({ allowances = true, includeWorkersBase = true } = {}) {
  const lines = {
    workers_base: includeWorkersBase ? 5 : 0,
    r2_100gb: r2Cost({ gbMonths: 100, allowances }),
    stream_1000_stored_10000_delivered: streamCost({ storedMinutes: 1000, deliveredMinutes: 10000 }),
    native_processing_100_busy_hours: standard2ProcessingCost({ busyHours: 100, allowances })
  };
  return { checked_at: '2026-10-17', currency: 'USD', assumptions: {
    profiles: 100, r2_gb_months: 100, stream_stored_minutes: 1000,
    stream_delivered_minutes: 10000, standard2_busy_hours: 100,
    account_allowances_available: allowances, workers_base_included: includeWorkersBase,
    workers_and_R2_operations_within_remaining_allowances: true
  }, lines, total: Object.values(lines).reduce((a, b) => a + b, 0) };
}
