import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ownershipBaseline, validateOwnershipBaseline, contributionPlan, portfolioWeights,
  OWNERSHIP_SCHEMA, OWNERSHIP_SOURCE, BASELINE_POLICY, BaselineError } from '../src/finance/baseline.js';

// Entirely invented, test-local values. No actual holdings, accounts, targets or documents.
const NOW = Date.parse('2026-11-11T15:00:00Z');
const iso = (offset = 0) => new Date(NOW + offset).toISOString();
const listing = { issuer_id: 'issuer:fixture-alpha', listing_id: 'listing:fixture-alpha-us', currency: 'USD' };
const other = { issuer_id: 'issuer:fixture-beta', listing_id: 'listing:fixture-beta-us', currency: 'USD' };
const evidence = { type: 'owner_attestation', reference_id: 'evidence:fixture', source_id: 'owner-fixture', as_of: iso() };
const position = { ...listing, quantity_microshares: 2000000, evidence };
function baseline(patch = {}) {
  return structuredClone({ schema: OWNERSHIP_SCHEMA, source: 'canonical_owner_store', source_id: OWNERSHIP_SOURCE,
    owner_id: 'owner-fixture', org_id: 'org-fixture', as_of: iso(), coverage: 'complete', currency: 'USD', corporate_actions_reconciled_through: iso(),
    positions: [position], pending_orders: [], watchlist: [], ...patch });
}
function mark(patch = {}) {
  return { schema: 'finance-listing-mark/v1', ...listing, price_cents: 1250, as_of: iso(-1000),
    source_id: 'market-data:fixture', feed: 'fixture-feed', status: 'real_time', ...patch };
}
const view = (b, marks = [mark()], now = NOW) => ownershipBaseline({ baseline: b, marks, now });
const rejects = (fn, code) => assert.throws(fn, e => e instanceof BaselineError && e.code === code);

test('no baseline means unknown, not zero, even with quotes or a synthetic paper ledger', () => {
  const absent = ownershipBaseline({ now: NOW, marks: [mark()] });
  assert.equal(absent.status, 'unknown');
  for (const key of ['holdings_count', 'issuer_count', 'pending_count', 'watch_count', 'total_value_cents']) assert.equal(absent[key], null);
  assert.equal(absent.trade_enabled, false);
  for (const b of [{ schema: 'finance-paper-demo/v1', shares: 2 }, { positions: [position] }, { source: 'paper', commands: [] }]) {
    const result = view(b);
    assert.equal(result.status, 'invalid'); assert.equal(result.total_value_cents, null); assert.deepEqual(result.positions, []);
  }
});
test('explicitly empty store inventory differs from missing or partial inventory', () => {
  const result = view(baseline({ positions: [] }), []);
  assert.equal(result.status, 'complete'); assert.equal(result.total_value_cents, 0); assert.equal(result.holdings_count, 0);
  const partial = view(baseline({ coverage: 'partial', positions: [] }), []);
  assert.equal(partial.status, 'partial'); assert.equal(partial.total_value_cents, null); assert.equal(partial.reason, 'baseline_incomplete');
});
test('owned positions alone contribute; pending buys/sells and watch candidates stay separate', () => {
  const pending = side => ({ ...other, order_id: `order:${side}`, quantity_microshares: 9000000, side,
    source_id: 'custodian:fixture', as_of: iso() });
  const result = view(baseline({ pending_orders: [pending('buy'), pending('sell')], watchlist: [other] }), [mark(), mark(other)]);
  assert.equal(result.total_value_cents, 2500); assert.equal(result.holdings_count, 1); assert.equal(result.issuer_count, 1);
  assert.equal(result.pending_count, 2); assert.equal(result.watch_count, 1);
  assert.equal(result.pending_orders[0].status, 'pending'); assert.equal(result.watchlist[0].status, 'watch_candidate');
});
test('clean projection does not echo owner/org, evidence, custody or order identifiers', () => {
  const b = baseline({ pending_orders: [{ ...other, order_id: 'order:private-fixture', quantity_microshares: 1000000,
    side: 'buy', source_id: 'custodian:private-fixture', as_of: iso() }] });
  const result = JSON.stringify(view(b));
  for (const value of ['owner-fixture', 'org-fixture', 'evidence:fixture', 'order:private-fixture', 'custodian:private-fixture']) assert.equal(result.includes(value), false);
  assert.match(result, /Structural validation does not prove ownership/);
});
test('evidence types stay distinct without falsely claiming document authenticity', () => {
  for (const [type, source_id] of [['owner_attestation', 'owner-fixture'], ['custodian_statement', 'custodian:fixture'], ['transfer_agent_statement', 'transfer-agent:fixture']]) {
    const result = view(baseline({ positions: [{ ...position, evidence: { ...evidence, type, source_id } }] }));
    assert.equal(result.status, 'complete'); assert.equal(result.positions[0].evidence_type, type);
    assert.equal(result.evidence_verified, false); assert.equal(result.positions[0].evidence_verified, false);
  }
  for (const ev of [{ ...evidence, type: 'paper_fill' }, { ...evidence, source_id: 'different-owner' },
    { ...evidence, type: 'custodian_statement' }, { ...evidence, type: 'transfer_agent_statement', source_id: 'custodian:fixture' },
    { ...evidence, reference_id: 'https://fixture.invalid/private' }, { ...evidence, account_number: 'not-a-real-account' }]) {
    assert.equal(view(baseline({ positions: [{ ...position, evidence: ev }] })).status, 'invalid');
  }
});
test('strict version/source/coverage schemas reject extras, coercions, getters and inherited objects', () => {
  const cases = [baseline({ schema: 'finance-ownership-baseline/v2' }), baseline({ source: 'request_json' }),
    baseline({ source_id: 'other:store' }), baseline({ coverage: 'unknown' }), baseline({ arbitrary: true }),
    baseline({ currency: 'usd' }), baseline({ owner_id: '' }), baseline({ org_id: null }),
    baseline({ positions: [{ ...position, quantity_microshares: '2000000' }] }),
    baseline({ positions: [{ ...position, quantity_microshares: 0 }] }), baseline({ positions: [{ ...position, status: 'owned' }] })];
  const getter = baseline(); Object.defineProperty(getter, 'source', { get() { assert.fail('getter executed'); }, enumerable: true });
  cases.push(getter, Object.assign(Object.create({ hidden: true }), baseline()));
  for (const b of cases) { assert.equal(view(b).status, 'invalid'); assert.equal(view(b).total_value_cents, null); }
  rejects(() => validateOwnershipBaseline(baseline({ schema: 'wrong' }), { now: NOW }), 'unsupported_schema');
});
test('stable SEC and opaque listing IDs work; ticker-only and conflicting identities fail', () => {
  const sec = { issuer_id: 'sec:0000000123', listing_id: 'sec:0000000123|NYSE American|EXM.A', currency: 'USD' };
  assert.equal(view(baseline({ positions: [{ ...position, ...sec }] }), [mark(sec)]).status, 'complete');
  for (const patch of [{ listing_id: 'EXM' }, { issuer_id: 'EXM' }, { issuer_id: 'sec:123' },
    { ...sec, listing_id: 'sec:0000000999|NYSE American|EXM.A' }, { ...sec, listing_id: 'sec:0000000123||EXM' }, { listing_id: 'listing:<script>' }]) {
    assert.equal(view(baseline({ positions: [{ ...position, ...patch }] })).status, 'invalid');
  }
  assert.equal(view(baseline({ watchlist: [{ ...listing, currency: 'CAD' }] })).reason, 'listing_identity_conflict');
  assert.equal(view(baseline({ watchlist: [{ ...listing, issuer_id: other.issuer_id }] })).reason, 'listing_identity_conflict');
});
test('duplicate positions/orders/watch candidates fail while separate share classes remain separate', () => {
  assert.equal(view(baseline({ positions: [position, position] })).reason, 'duplicate_position');
  assert.equal(view(baseline({ watchlist: [other, other] })).reason, 'duplicate_watch_candidate');
  const pending = { ...other, order_id: 'order:fixture', quantity_microshares: 1000000, side: 'buy', source_id: 'custodian:fixture', as_of: iso() };
  assert.equal(view(baseline({ pending_orders: [pending, pending] })).reason, 'duplicate_order');
  for (const patch of [{ side: 'filled' }, { source_id: 'paper:fixture' }, { as_of: iso(1) }]) assert.equal(view(baseline({ pending_orders: [{ ...pending, ...patch }] })).status, 'invalid');
  const secondClass = { ...position, listing_id: 'listing:fixture-alpha-class-b' };
  const result = view(baseline({ positions: [position, secondClass] }), [mark(), mark({ listing_id: secondClass.listing_id })]);
  assert.equal(result.holdings_count, 2); assert.equal(result.issuer_count, 1); assert.equal(result.total_value_cents, 5000);
});
test('malformed/future timestamps fail, and stale snapshot or evidence never gets totals', () => {
  for (const at of ['2026-02-30T15:00:00Z', 'yesterday', '2026-11-11', '2026-11-11T10:00:00-05:00', iso(1)]) assert.equal(view(baseline({ as_of: at })).status, 'invalid');
  assert.equal(view(baseline({ as_of: iso(-1) })).reason, 'evidence_after_baseline');
  const old = iso(-BASELINE_POLICY.baseline_max_age_ms - 1);
  for (const b of [baseline({ as_of: old, positions: [{ ...position, evidence: { ...evidence, as_of: old } }] }),
    baseline({ positions: [{ ...position, evidence: { ...evidence, as_of: old } }] })]) {
    const result = view(b); assert.equal(result.status, 'stale'); assert.equal(result.total_value_cents, null);
    assert.equal(result.positions[0].value_cents, null); assert.equal(result.positions[0].reason, 'baseline_stale');
  }
  assert.equal(view(baseline({ as_of: old, positions: [] }), []).status, 'stale');
  const boundary = iso(-BASELINE_POLICY.baseline_max_age_ms);
  assert.equal(view(baseline({ as_of: boundary, positions: [{ ...position, evidence: { ...evidence, as_of: boundary } }] })).status, 'complete');
});
test('one missing quote blocks the entire total instead of skipping a constituent', () => {
  const result = view(baseline({ positions: [position, { ...position, ...other }] }));
  assert.equal(result.status, 'partial'); assert.equal(result.total_value_cents, null);
  assert.equal(result.positions[0].value_cents, 2500); assert.equal(result.positions[1].reason, 'mark_missing');
});
test('quote identity, currency, freshness, status and source must all match', () => {
  const cases = [[{ issuer_id: other.issuer_id }, 'mark_identity_mismatch'], [{ currency: 'CAD' }, 'mark_currency_mismatch'],
    [{ as_of: iso(-BASELINE_POLICY.mark_max_age_ms - 1) }, 'mark_stale'], [{ as_of: iso(1) }, 'future_timestamp'],
    [{ status: 'delayed' }, 'mark_not_real_time'], [{ status: 'end_of_day' }, 'mark_not_real_time'],
    [{ source_id: 'paper:fixture' }, 'invalid_mark_source'], [{ feed: '' }, 'invalid_identity'],
    [{ schema: 'other/v1' }, 'unsupported_mark_schema'], [{ price_cents: 0 }, 'invalid_amount'], [{ account: 'unexpected' }, 'invalid_fields']];
  for (const [patch, reason] of cases) {
    const result = view(baseline(), [mark(patch)]); assert.equal(result.total_value_cents, null, reason); assert.equal(result.positions[0].reason, reason);
  }
  assert.equal(view(baseline(), [mark({ as_of: iso(-BASELINE_POLICY.mark_max_age_ms) })]).status, 'complete');
  assert.equal(view(baseline(), [mark({ listing_id: other.listing_id })]).positions[0].reason, 'mark_missing');
  assert.equal(view(baseline(), [mark(), mark()]).positions[0].reason, 'duplicate_mark');
});
test('no implicit FX conversion even when fresh foreign marks exist', () => {
  const foreign = { ...other, currency: 'JPY' };
  const result = view(baseline({ positions: [position, { ...position, ...foreign }] }), [mark(), mark(foreign)]);
  assert.equal(result.status, 'partial'); assert.equal(result.total_value_cents, null); assert.equal(result.positions[1].reason, 'currency_conversion_unavailable');
});
test('all amounts reject nonfinite, unsafe, negative and fractional values without coercion', () => {
  for (const invalid of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -1, -0, 1.5, '10', null, true]) {
    assert.equal(view(baseline({ positions: [{ ...position, quantity_microshares: invalid }] })).status, 'invalid');
    assert.equal(view(baseline(), [mark({ price_cents: invalid })]).total_value_cents, null);
  }
  for (const invalid of [NaN, Infinity, -1, 'now', Number.MAX_SAFE_INTEGER]) assert.throws(() => ownershipBaseline({ now: invalid }), BaselineError);
});
test('sparse, oversized and decorated arrays cannot silently drop data', () => {
  const sparse = new Array(1), decorated = new Array(1); decorated.extra = position;
  const getter = [position]; Object.defineProperty(getter, '0', { get() { assert.fail('array getter executed'); } });
  const symbol = [position]; symbol[Symbol('private')] = true;
  const inherited = Object.setPrototypeOf([position], { map() { assert.fail('inherited map executed'); } });
  for (const positions of [sparse, decorated, getter, symbol, inherited, new Array(BASELINE_POLICY.max_rows + 1)]) {
    const b = baseline(); b.positions = positions; assert.equal(view(b).reason, 'invalid_rows');
  }
});
test('fractional shares round half-up per position; overflow never returns a partial total', () => {
  for (const [quantity_microshares, cents] of [[500000, 1], [499999, 0], [1500000, 2], [2500000, 3]]) {
    assert.equal(view(baseline({ positions: [{ ...position, quantity_microshares }] }), [mark({ price_cents: 1 })]).total_value_cents, cents);
  }
  const tooLarge = view(baseline({ positions: [{ ...position, quantity_microshares: Number.MAX_SAFE_INTEGER }] }), [mark({ price_cents: Number.MAX_SAFE_INTEGER })]);
  assert.equal(tooLarge.total_value_cents, null); assert.equal(tooLarge.positions[0].reason, 'amount_overflow');
  const two = baseline({ positions: [{ ...position, quantity_microshares: 1000000 }, { ...position, ...other, quantity_microshares: 1000000 }] });
  const combined = view(two, [mark({ price_cents: Number.MAX_SAFE_INTEGER }), mark({ ...other, price_cents: 1 })]);
  assert.equal(combined.total_value_cents, null); assert.equal(combined.reason, 'amount_overflow');
});

const budget = patch => ({ currency: 'USD', target_cents: 10001, remaining_months: 3, ...patch });
test('manual contributions never substitute for unknown reconciled contributions or ownership', () => {
  const plan = contributionPlan(budget({ manual_contributed_cents: 1000, issuer_spend: [{ issuer_id: listing.issuer_id, spend_cents: 5000 }] }));
  assert.equal(plan.verified.status, 'unknown'); assert.equal(plan.verified.contributed_cents, null);
  assert.equal(plan.manual.remaining_cents, 9001); assert.equal(plan.manual.monthly_required_cents, 3001); assert.equal(plan.manual.basis, 'manual_unverified');
  assert.equal(plan.planned_spend_cents, 5000); assert.equal(plan.unallocated_target_cents, 5001); assert.equal(plan.ownership_effect, 'none');
  const separate = contributionPlan(budget({ verified_contributed_cents: 1001, manual_contributed_cents: 5000 }));
  assert.equal(separate.verified.monthly_required_cents, 3000); assert.equal(separate.manual.monthly_required_cents, 1667);
});
test('contribution deadlines, exceeded targets and safe-integer ceiling division are explicit', () => {
  const overdue = contributionPlan(budget({ remaining_months: 0, verified_contributed_cents: 0 }));
  assert.equal(overdue.verified.monthly_required_cents, null); assert.equal(overdue.verified.status, 'deadline_reached');
  const exceeded = contributionPlan(budget({ verified_contributed_cents: 20000, remaining_months: 0, issuer_spend: [{ issuer_id: listing.issuer_id, spend_cents: 12000 }] }));
  assert.equal(exceeded.verified.remaining_cents, 0); assert.equal(exceeded.verified.over_target_cents, 9999);
  assert.equal(exceeded.verified.monthly_required_cents, 0); assert.equal(exceeded.above_target_cents, 1999);
  assert.equal(contributionPlan(budget({ target_cents: Number.MAX_SAFE_INTEGER, verified_contributed_cents: 0, remaining_months: Number.MAX_SAFE_INTEGER })).verified.monthly_required_cents, 1);
});
test('contribution inputs reject invalid amounts, duplicate issuer spend and sum overflow', () => {
  for (const patch of [{ target_cents: -1 }, { remaining_months: 1.5 }, { verified_contributed_cents: '1' }, { manual_contributed_cents: Infinity }, { issuer_spend: null }, { currency: 'XYZ' }, { holdings: [position] }]) assert.throws(() => contributionPlan(budget(patch)), BaselineError);
  rejects(() => contributionPlan(budget({ issuer_spend: [{ issuer_id: listing.issuer_id, spend_cents: 1 }, { issuer_id: listing.issuer_id, spend_cents: 2 }] })), 'duplicate_issuer_spend');
  rejects(() => contributionPlan(budget({ issuer_spend: [{ issuer_id: listing.issuer_id, spend_cents: Number.MAX_SAFE_INTEGER }, { issuer_id: other.issuer_id, spend_cents: 1 }] })), 'amount_overflow');
});

const constituents = [{ ...listing, quantity_microshares: 1000000, price_cents: 1000, market_cap_cents: 90000 },
  { ...other, quantity_microshares: 3000000, price_cents: 3000, market_cap_cents: 10000 }];
const weighted = (method, items = constituents) => portfolioWeights({ method, currency: 'USD', constituents: items });
test('share count, equal-share price, holding value, equal-dollar and market-cap weights are distinct', () => {
  for (const [method, expected] of [['share_count', [2500, 7500]], ['equal_share_price', [2500, 7500]], ['holding_value', [1000, 9000]], ['equal_dollar', [5000, 5000]], ['market_cap', [9000, 1000]]]) {
    const result = weighted(method); assert.equal(result.status, 'complete'); assert.equal(result.live_valuation, false); assert.deepEqual(result.weights.map(p => p.weight_bps), expected);
  }
  assert.match(weighted('equal_share_price').note, /not equal-dollar or market-cap/); assert.match(weighted('share_count').note, /not economic exposure/);
});
test('missing weighting data, currency conversion and zero total do not silently skip constituents', () => {
  assert.equal(weighted('share_count', []).weights, null);
  for (const [method, missing] of [['holding_value', 'price_cents'], ['equal_share_price', 'price_cents'], ['share_count', 'quantity_microshares'], ['market_cap', 'market_cap_cents']]) {
    const items = structuredClone(constituents); delete items[1][missing];
    const result = weighted(method, items); assert.equal(result.weights, null); assert.equal(result.reason, 'constituent_data_missing');
  }
  const foreign = constituents.map(p => ({ ...p, currency: 'EUR' }));
  for (const method of ['holding_value', 'equal_share_price', 'market_cap']) assert.equal(weighted(method, foreign).reason, 'currency_conversion_unavailable');
  assert.equal(weighted('equal_dollar', foreign).status, 'complete'); // Hypothetical targets, never valuation.
  assert.equal(weighted('share_count', constituents.map(p => ({ ...p, quantity_microshares: 0 }))).reason, 'zero_weight_total');
});
test('exact big-integer weighting and largest-remainder basis points are stable and sum to 10000', () => {
  const three = ['c', 'b', 'a'].map(id => ({ issuer_id: `issuer:${id}`, listing_id: `listing:${id}`, currency: 'USD' }));
  const result = weighted('equal_dollar', three);
  assert.equal(result.weights.reduce((n, p) => n + p.weight_bps, 0), 10000); assert.equal(result.weights.find(p => p.listing_id === 'listing:a').weight_bps, 3334);
  assert.deepEqual(weighted('equal_dollar', [...three].reverse()).weights.sort((a, b) => a.listing_id.localeCompare(b.listing_id)), result.weights.sort((a, b) => a.listing_id.localeCompare(b.listing_id)));
  const huge = weighted('holding_value', constituents.map(p => ({ ...p, quantity_microshares: Number.MAX_SAFE_INTEGER, price_cents: Number.MAX_SAFE_INTEGER })));
  assert.deepEqual(huge.weights.map(p => p.weight_bps), [5000, 5000]); assert.ok(BigInt(huge.weights[0].denominator) > BigInt(Number.MAX_SAFE_INTEGER)); assert.doesNotThrow(() => JSON.stringify(huge));
});
test('weight validation rejects duplicate listings/issuer caps, unsafe values and unknown fields', () => {
  rejects(() => weighted('equal_dollar', [constituents[0], constituents[0]]), 'duplicate_constituent');
  const shareClasses = [constituents[0], { ...constituents[1], issuer_id: listing.issuer_id }];
  rejects(() => weighted('market_cap', shareClasses), 'duplicate_market_cap_issuer');
  rejects(() => weighted('equal_dollar', shareClasses), 'duplicate_equal_dollar_issuer');
  assert.equal(weighted('holding_value', shareClasses).status, 'complete');
  for (const patch of [{ price_cents: Infinity }, { quantity_microshares: -1 }, { market_cap_cents: 0 }, { source: 'paper' }]) assert.throws(() => weighted('holding_value', [{ ...constituents[0], ...patch }]), BaselineError);
  for (const method of ['secret_trade', ['holding_value'], ['equal_dollar'], {}, null, true, 1]) rejects(() => weighted(method), 'invalid_weighting_method');
});
test('helpers do not mutate input or depend on request, paper, broker or network APIs', async () => {
  const b = baseline(), marks = [mark()], before = JSON.stringify({ b, marks, constituents }); view(b, marks); weighted('holding_value'); contributionPlan(budget());
  assert.equal(JSON.stringify({ b, marks, constituents }), before);
  const source = await readFile(new URL('../src/finance/baseline.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s/m); assert.doesNotMatch(source, /\bfetch\s*\(|request\.(?:json|url)|\.searchParams|executeCashOrder\s*\(|replayDemo\s*\(/);
});


test('corporate-action reconciliation must explicitly cover the snapshot and quote, even within 24 hours', () => {
  for (const reconciled of [null, iso(-1), iso(-3600000)]) {
    const result = view(baseline({ corporate_actions_reconciled_through: reconciled }));
    assert.equal(result.total_value_cents, null); assert.equal(result.positions[0].reason, 'corporate_actions_unreconciled');
  }
  assert.equal(view(baseline({ positions: [], corporate_actions_reconciled_through: null }), []).total_value_cents, null);
  const beforeOpen = iso(-3600000);
  const b = baseline({ as_of: beforeOpen, corporate_actions_reconciled_through: beforeOpen,
    positions: [{ ...position, evidence: { ...evidence, as_of: beforeOpen } }] });
  assert.equal(view(b).positions[0].reason, 'corporate_actions_unreconciled');
  b.corporate_actions_reconciled_through = iso(-1000);
  assert.equal(view(b).status, 'complete');
  assert.equal(view(b).corporate_actions_reconciled_through, iso(-1000));
  for (const reconciled of [iso(1), 'yesterday', true]) assert.equal(view(baseline({ corporate_actions_reconciled_through: reconciled })).status, 'invalid');
  const missing = baseline(); delete missing.corporate_actions_reconciled_through;
  assert.equal(view(missing).total_value_cents, null);
});
