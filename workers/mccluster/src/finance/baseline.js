/* Pure contracts, not a brokerage, evidence verifier, or ownership ingestion API.
 * Only the future authenticated canonical owner store may supply a baseline and
 * reconciled contributions. NEVER pass request/query JSON, a paper ledger, or a
 * directory/watchlist as an ownership baseline. Source labels are not authentication.
 * No network, persistence, trade execution, plan eligibility, or FX conversion. */
export const OWNERSHIP_SCHEMA = 'finance-ownership-baseline/v1';
export const OWNERSHIP_SOURCE = 'mccluster:finance:ownership';
export const BASELINE_POLICY = Object.freeze({ baseline_max_age_ms: 86400000, mark_max_age_ms: 30000,
  max_rows: 20000, microshares_per_share: 1000000 });
export class BaselineError extends Error {
  constructor(code) { super(code); this.name = 'BaselineError'; this.code = code; }
}
const fail = code => { throw new BaselineError(code); };
const MAX = BigInt(Number.MAX_SAFE_INTEGER), SCALE = BigInt(BASELINE_POLICY.microshares_per_share);
const CURRENCIES = new Set('USD CAD EUR GBP CHF AUD NZD HKD SGD JPY CNY SEK NOK DKK INR BRL ZAR MXN KRW TWD ILS'.split(' '));
const EVIDENCE = new Set(['owner_attestation', 'custodian_statement', 'transfer_agent_statement']);
function shape(value, required, optional = []) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_object');
  const keys = Reflect.ownKeys(value), allowed = new Set([...required, ...optional]);
  if (required.some(k => !Object.hasOwn(value, k)) || keys.some(k => !allowed.has(k))) fail('invalid_fields');
  if (keys.some(k => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) fail('invalid_fields');
  return value;
}
function rows(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > BASELINE_POLICY.max_rows ||
      Reflect.ownKeys(value).length !== value.length + 1) fail('invalid_rows');
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid_rows');
  }
  return value;
}
function integer(value, positive = false) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < (positive ? 1 : 0)) fail('invalid_amount');
  return value;
}
const safeNumber = n => n >= 0n && n <= MAX ? Number(n) : fail('amount_overflow');
const sum = values => safeNumber(values.reduce((n, v) => n + BigInt(v), 0n));
function token(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value)) fail('invalid_identity');
  return value;
}
function issuer(value) {
  token(value);
  if (!/^[a-z][a-z0-9_-]*:.+$/.test(value) || (value.startsWith('sec:') && !/^sec:\d{10}$/.test(value))) fail('invalid_issuer');
  return value;
}
function identity(row) {
  const issuer_id = issuer(row.issuer_id), listing_id = row.listing_id;
  if (typeof listing_id !== 'string' || listing_id.length > 180) fail('invalid_listing');
  if (listing_id.startsWith('sec:')) {
    const parts = listing_id.split('|');
    if (parts.length !== 3 || parts[0] !== issuer_id || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,49}$/.test(parts[1]) ||
        parts[1].trim() !== parts[1] || !/^[A-Za-z0-9][A-Za-z0-9.^_-]{0,29}$/.test(parts[2])) fail('invalid_listing');
  } else if (!/^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,139}$/.test(listing_id)) fail('invalid_listing');
  return { issuer_id, listing_id };
}
function currency(value) { if (!CURRENCIES.has(value)) fail('unsupported_currency'); return value; }
function clock(value) {
  integer(value);
  if (!Number.isFinite(new Date(value).getTime())) fail('invalid_now');
  return value;
}
function timestamp(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) fail('invalid_timestamp');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) fail('invalid_timestamp');
  if (time > now) fail('future_timestamp');
  return new Date(time).toISOString();
}
function unique(values, key, code) {
  const seen = new Set();
  for (const row of values) { if (seen.has(row[key])) fail(code); seen.add(row[key]); }
}
function evidence(value, owner, at, now) {
  shape(value, ['type', 'reference_id', 'source_id', 'as_of']);
  if (!EVIDENCE.has(value.type)) fail('invalid_evidence_type');
  const source_id = token(value.source_id);
  if ((value.type === 'owner_attestation' && source_id !== owner) ||
      (value.type === 'custodian_statement' && !/^custodian:.+/.test(source_id)) ||
      (value.type === 'transfer_agent_statement' && !/^transfer-agent:.+/.test(source_id))) fail('evidence_source_mismatch');
  const as_of = timestamp(value.as_of, now);
  if (as_of > at) fail('evidence_after_baseline');
  return { type: value.type, reference_id: token(value.reference_id), source_id, as_of };
}

/** Structural validation only. The caller must authenticate and scope the store read.
 * There is no automatic conversion from a simulation or evidence authenticity claim. */
export function validateOwnershipBaseline(input, { now = Date.now() } = {}) {
  clock(now);
  shape(input, ['schema', 'source', 'source_id', 'owner_id', 'org_id', 'as_of', 'coverage', 'currency', 'corporate_actions_reconciled_through', 'positions', 'pending_orders', 'watchlist']);
  if (input.schema !== OWNERSHIP_SCHEMA) fail('unsupported_schema');
  if (input.source !== 'canonical_owner_store' || input.source_id !== OWNERSHIP_SOURCE) fail('invalid_baseline_source');
  if (!['complete', 'partial'].includes(input.coverage)) fail('invalid_coverage');
  const owner_id = token(input.owner_id), org_id = token(input.org_id), as_of = timestamp(input.as_of, now);
  const corporate_actions_reconciled_through = input.corporate_actions_reconciled_through === null ? null : timestamp(input.corporate_actions_reconciled_through, now);
  const positions = rows(input.positions).map(p => {
    shape(p, ['issuer_id', 'listing_id', 'currency', 'quantity_microshares', 'evidence']);
    return { ...identity(p), currency: currency(p.currency), quantity_microshares: integer(p.quantity_microshares, true),
      evidence: evidence(p.evidence, owner_id, as_of, now) };
  });
  unique(positions, 'listing_id', 'duplicate_position'); // Store must reconcile lots/accounts, never silently add duplicates.
  const pending_orders = rows(input.pending_orders).map(p => {
    shape(p, ['order_id', 'issuer_id', 'listing_id', 'currency', 'quantity_microshares', 'side', 'source_id', 'as_of']);
    if (!['buy', 'sell'].includes(p.side)) fail('invalid_order_side');
    const source_id = token(p.source_id), at = timestamp(p.as_of, now);
    if (!/^(custodian|transfer-agent):.+/.test(source_id)) fail('invalid_order_source');
    if (at > as_of) fail('order_after_baseline');
    return { ...identity(p), order_id: token(p.order_id), currency: currency(p.currency),
      quantity_microshares: integer(p.quantity_microshares, true), side: p.side, source_id, as_of: at };
  });
  unique(pending_orders, 'order_id', 'duplicate_order');
  const watchlist = rows(input.watchlist).map(p => {
    shape(p, ['issuer_id', 'listing_id', 'currency']);
    return { ...identity(p), currency: currency(p.currency) };
  });
  unique(watchlist, 'listing_id', 'duplicate_watch_candidate');
  // A stable listing cannot identify different issuers/currencies across sections.
  const identities = new Map();
  for (const p of [...positions, ...pending_orders, ...watchlist]) {
    const signature = `${p.issuer_id}|${p.currency}`;
    if (identities.has(p.listing_id) && identities.get(p.listing_id) !== signature) fail('listing_identity_conflict');
    identities.set(p.listing_id, signature);
  }
  return { schema: OWNERSHIP_SCHEMA, source: input.source, source_id: OWNERSHIP_SOURCE, owner_id, org_id,
    as_of, coverage: input.coverage, currency: currency(input.currency), corporate_actions_reconciled_through, positions, pending_orders, watchlist };
}

function markIndex(marks, now) {
  const result = new Map();
  for (const q of rows(marks)) {
    shape(q, ['schema', 'issuer_id', 'listing_id', 'currency', 'price_cents', 'as_of', 'source_id', 'feed', 'status']);
    if (q.schema !== 'finance-listing-mark/v1') fail('unsupported_mark_schema');
    const id = identity(q), source_id = token(q.source_id);
    if (!/^market-data:.+/.test(source_id)) fail('invalid_mark_source');
    if (!['real_time', 'delayed', 'end_of_day'].includes(q.status)) fail('invalid_mark_status');
    if (result.has(id.listing_id)) fail('duplicate_mark');
    result.set(id.listing_id, { ...id, currency: currency(q.currency), price_cents: integer(q.price_cents, true),
      as_of: timestamp(q.as_of, now), source_id, feed: token(q.feed), status: q.status });
  }
  return result;
}
const LIMITS = Object.freeze([
  'Structural validation does not prove ownership or authenticate evidence. Owner attestations are distinct from custodian or transfer-agent evidence.',
  'Securities value only, not net worth. No cash, debt, fees, FX or executable prices. Corporate-action reconciliation must be supplied by the trusted store; this module does not perform it.',
  'Pending orders and watch candidates are never owned positions. A small share count across listings is not market-cap-weighted exposure.'
]);
function unavailable(now, status, reason) {
  return { schema: 'finance-ownership-display/v1', status, reason, generated_at: new Date(now).toISOString(),
    as_of: null, currency: null, coverage: 'unknown', corporate_actions_reconciled_through: null, holdings_count: null, issuer_count: null,
    pending_count: null, watch_count: null, positions: [], pending_orders: [], watchlist: [],
    total_value_cents: null, evidence_verified: false, trade_enabled: false, limitations: [...LIMITS] };
}

/** Clean display projection. Missing is UNKNOWN, not an assertion of zero assets.
 * Any invalid baseline hides its data. Any incomplete/stale/mismatched valuation
 * prevents a total; it never sums only the rows that happen to have quotes. */
export function ownershipBaseline({ baseline = null, marks = [], now = Date.now() } = {}) {
  clock(now);
  if (baseline === null) return unavailable(now, 'unknown', 'baseline_missing');
  let b;
  try { b = validateOwnershipBaseline(baseline, { now }); }
  catch (error) { if (!(error instanceof BaselineError)) throw error; return unavailable(now, 'invalid', error.code); }
  let quotes = new Map(), markError = null;
  try { quotes = markIndex(marks, now); }
  catch (error) { if (!(error instanceof BaselineError)) throw error; markError = error.code; }
  const old = at => now - Date.parse(at) > BASELINE_POLICY.baseline_max_age_ms;
  const stale = old(b.as_of) || b.positions.some(p => old(p.evidence.as_of));
  const positions = b.positions.map(p => {
    const row = { issuer_id: p.issuer_id, listing_id: p.listing_id, currency: p.currency,
      quantity_microshares: p.quantity_microshares, quantity: p.quantity_microshares / Number(SCALE),
      evidence_type: p.evidence.type, evidence_as_of: p.evidence.as_of, evidence_verified: false,
      value_cents: null, mark: null, status: 'unavailable', reason: null };
    const q = quotes.get(p.listing_id);
    if (old(b.as_of) || old(p.evidence.as_of)) row.reason = 'baseline_stale';
    else if (markError) row.reason = markError;
    else if (!q) row.reason = 'mark_missing';
    else if (q.issuer_id !== p.issuer_id) row.reason = 'mark_identity_mismatch';
    else if (q.currency !== p.currency) row.reason = 'mark_currency_mismatch';
    else if (b.corporate_actions_reconciled_through === null || b.corporate_actions_reconciled_through < b.as_of ||
        b.corporate_actions_reconciled_through < q.as_of) row.reason = 'corporate_actions_unreconciled';
    else if (p.currency !== b.currency) row.reason = 'currency_conversion_unavailable';
    else if (q.status !== 'real_time') row.reason = 'mark_not_real_time';
    else if (now - Date.parse(q.as_of) > BASELINE_POLICY.mark_max_age_ms) row.reason = 'mark_stale';
    else {
      try {
        // Round HALF UP once per position, with exact fixed-point intermediate arithmetic.
        row.value_cents = safeNumber((BigInt(p.quantity_microshares) * BigInt(q.price_cents) + SCALE / 2n) / SCALE);
        row.status = 'marked';
        row.mark = { price_cents: q.price_cents, as_of: q.as_of, source_id: q.source_id, feed: q.feed, status: q.status };
      } catch (error) { if (!(error instanceof BaselineError)) throw error; row.reason = error.code; }
    }
    return row;
  });
  let total_value_cents = null, reason = stale ? 'baseline_stale' : b.coverage !== 'complete' ? 'baseline_incomplete' :
    b.corporate_actions_reconciled_through === null || b.corporate_actions_reconciled_through < b.as_of ? 'corporate_actions_unreconciled' : markError;
  if (!reason && positions.every(p => p.status === 'marked')) {
    try { total_value_cents = sum(positions.map(p => p.value_cents)); }
    catch (error) { if (!(error instanceof BaselineError)) throw error; reason = error.code; }
  }
  if (total_value_cents === null && !reason) reason = 'valuation_incomplete';
  return { ...unavailable(now, stale ? 'stale' : total_value_cents !== null ? 'complete' : 'partial', reason),
    as_of: b.as_of, currency: b.currency, coverage: b.coverage, corporate_actions_reconciled_through: b.corporate_actions_reconciled_through, holdings_count: positions.length,
    issuer_count: new Set(positions.map(p => p.issuer_id)).size, pending_count: b.pending_orders.length,
    watch_count: b.watchlist.length, positions,
    // Never echo owner/org IDs, evidence refs, order IDs or custody source IDs.
    pending_orders: b.pending_orders.map(({ issuer_id, listing_id, currency, quantity_microshares, side, as_of }) =>
      ({ issuer_id, listing_id, currency, quantity_microshares, side, as_of, status: 'pending' })),
    watchlist: b.watchlist.map(p => ({ ...p, status: 'watch_candidate' })), total_value_cents };
}

/** Planner only. Verified amounts must be supplied from reconciled canonical store
 * records; this arithmetic does not verify them. Manual figures remain separate. */
export function contributionPlan(input) {
  shape(input, ['currency', 'target_cents', 'remaining_months'], ['verified_contributed_cents', 'manual_contributed_cents', 'issuer_spend']);
  const cur = currency(input.currency), target = integer(input.target_cents), months = integer(input.remaining_months);
  const spends = rows(input.issuer_spend === undefined ? [] : input.issuer_spend).map(p => {
    shape(p, ['issuer_id', 'spend_cents']);
    return { issuer_id: issuer(p.issuer_id), spend_cents: integer(p.spend_cents) };
  });
  unique(spends, 'issuer_id', 'duplicate_issuer_spend');
  const planned = sum(spends.map(p => p.spend_cents));
  const progress = (value, basis) => {
    if (value == null) return { basis, status: 'unknown', contributed_cents: null, remaining_cents: null, monthly_required_cents: null, over_target_cents: null };
    const contributed = integer(value), remaining = Math.max(0, target - contributed);
    return { basis, status: remaining === 0 ? 'target_met' : months === 0 ? 'deadline_reached' : 'in_progress',
      contributed_cents: contributed, remaining_cents: remaining,
      monthly_required_cents: remaining === 0 ? 0 : months === 0 ? null : safeNumber((BigInt(remaining) + BigInt(months) - 1n) / BigInt(months)),
      over_target_cents: Math.max(0, contributed - target) };
  };
  return { schema: 'finance-contribution-plan/v1', currency: cur, target_cents: target, remaining_months: months,
    verified: progress(input.verified_contributed_cents, 'reconciled_store_required'),
    manual: progress(input.manual_contributed_cents, 'manual_unverified'),
    issuer_spend: spends, planned_spend_cents: planned, unallocated_target_cents: Math.max(0, target - planned),
    above_target_cents: Math.max(0, planned - target), ownership_effect: 'none',
    note: 'Planning arithmetic only. Contributions are not asset value, returns or owned shares. No assumption of future returns, fees or taxes.' };
}

const WEIGHT_NOTES = Object.freeze({
  share_count: 'Share-count proportion is not economic exposure; share denominations and splits differ.',
  equal_share_price: 'Equal shares produce price-weighted dollar exposure, not equal-dollar or market-cap weights.',
  holding_value: 'Position-value weights use quantity times price, not issuer size.',
  equal_dollar: 'Hypothetical equal-dollar targets per issuer in the reporting currency; not evidence of purchased or owned assets.',
  market_cap: 'Issuer market-cap weights require one constituent per issuer and comparable market-cap inputs.'
});
/** Pure comparisons, not recommended allocations. Required missing constituents
 * fail the whole calculation. FX, live quote freshness and universe coverage must
 * be established by the caller; this helper is explicitly not a live valuation. */
export function portfolioWeights(input) {
  shape(input, ['method', 'currency', 'constituents']);
  if (typeof input.method !== 'string' || !Object.hasOwn(WEIGHT_NOTES, input.method)) fail('invalid_weighting_method');
  const cur = currency(input.currency), method = input.method;
  const items = rows(input.constituents).map(p => {
    shape(p, ['issuer_id', 'listing_id', 'currency'], ['quantity_microshares', 'price_cents', 'market_cap_cents']);
    const row = { ...identity(p), currency: currency(p.currency) };
    for (const k of ['quantity_microshares', 'price_cents', 'market_cap_cents']) if (p[k] !== undefined && p[k] !== null) row[k] = integer(p[k], k !== 'quantity_microshares');
    return row;
  });
  unique(items, 'listing_id', 'duplicate_constituent');
  if (method === 'market_cap') unique(items, 'issuer_id', 'duplicate_market_cap_issuer');
  if (method === 'equal_dollar') unique(items, 'issuer_id', 'duplicate_equal_dollar_issuer');
  const base = { schema: 'finance-weights/v1', method, currency: cur, status: 'unavailable', weights: null,
    live_valuation: false, note: WEIGHT_NOTES[method] };
  if (!items.length) return { ...base, reason: 'constituents_missing' };
  const required = { share_count: ['quantity_microshares'], equal_share_price: ['price_cents'],
    holding_value: ['quantity_microshares', 'price_cents'], equal_dollar: [], market_cap: ['market_cap_cents'] }[method];
  for (const p of items) {
    if (required.some(k => p[k] === undefined)) return { ...base, reason: 'constituent_data_missing' };
    if (['equal_share_price', 'holding_value', 'market_cap'].includes(method) && p.currency !== cur) return { ...base, reason: 'currency_conversion_unavailable' };
  }
  const values = items.map(p => method === 'share_count' ? BigInt(p.quantity_microshares) :
    method === 'equal_share_price' ? BigInt(p.price_cents) : method === 'market_cap' ? BigInt(p.market_cap_cents) :
      method === 'holding_value' ? BigInt(p.quantity_microshares) * BigInt(p.price_cents) : 1n);
  const total = values.reduce((n, v) => n + v, 0n);
  if (total === 0n) return { ...base, reason: 'zero_weight_total' };
  // Largest-remainder basis points sum to exactly 10000, with stable listing-ID ties.
  const weights = items.map((p, i) => ({ issuer_id: p.issuer_id, listing_id: p.listing_id,
    weight_bps: Number(values[i] * 10000n / total), numerator: values[i].toString(), denominator: total.toString() }));
  const order = values.map((v, i) => ({ i, rem: v * 10000n % total, id: items[i].listing_id }))
    .sort((a, b) => a.rem === b.rem ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.rem > b.rem ? -1 : 1);
  const residual = 10000 - weights.reduce((n, w) => n + w.weight_bps, 0);
  for (let i = 0; i < residual; i++) weights[order[i].i].weight_bps++;
  return { ...base, status: 'complete', reason: null, weights };
}
