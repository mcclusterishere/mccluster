import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import DATA from '../../../data/markets/direct-ownership-routes.json' with { type: 'json' };
import DIRECTORY from '../../../data/markets/sec-listing-directory.json' with { type: 'json' };
import { ownershipOptionsView, validateOwnershipReference, OWNERSHIP_REFERENCE_REVIEW_DAYS } from '../src/finance/ownership-options.js';
import { handleIntelRequest } from '../src/intel/router.js';
import { IntelError } from '../src/intel/store.js';

const now = Date.parse('2026-11-12T12:00:00Z');
const copy = () => structuredClone(DATA);
const catalog = () => ownershipOptionsView({ now });
const byTicker = symbol => catalog().routes.find(route => route.ticker === symbol);
const referenceError = error => /^invalid_ownership_/.test(error.code) && error.status === 400;
test('canonical ownership route enforces owner, feature flag, private cache and exact read parameters', async () => {
  const env = {FINANCE_DEV_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
  const options = {requireHouseOwner:async()=>({id:'11111111-1111-4111-8111-111111111111'})};
  const request = (query='',method='GET') => new Request('https://fixture.invalid/v1/intel/finance/ownership-options'+query,{method});
  const response = await handleIntelRequest(request('?symbol=PG&mic=XNYS'),env,options);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal((await response.json()).routes[0].ticker,'PG');
  assert.equal((await handleIntelRequest(request(),env,{requireHouseOwner:async()=>{throw new IntelError('denied',403,'forbidden');}})).status,403);
  assert.equal((await handleIntelRequest(request(),{...env,FINANCE_DEV_ENABLED:'false'},options)).status,404);
  for(const query of ['?symbol=PG','?mic=XNYS','?symbol=PG&mic=XNYS&symbol=AI','?issuer_id=','?url=https://example.com','?issuer_id=sec:0000080424&symbol=PG&mic=XNYS']) {
    assert.equal((await handleIntelRequest(request(query),env,options)).status,400,query);
  }
  const mutation = await handleIntelRequest(request('','POST'),env,options);
  assert.ok(mutation.status>=400,'Read-only endpoint must not accept an account or trade mutation');
});
function modifiedDirectory(extra) {
  const result = structuredClone(DIRECTORY);
  result.listings.push(extra);
  const byExchange = {};
  for (const row of result.listings) byExchange[row.exchange || 'UNKNOWN'] = (byExchange[row.exchange || 'UNKNOWN'] || 0) + 1;
  result.counts = { listing_associations: result.listings.length, distinct_ciks: new Set(result.listings.map(row => row.cik)).size,
    distinct_listing_ids: new Set(result.listings.map(row => row.listing_id)).size, by_exchange: byExchange };
  return result;
}

test('public sample preserves 13 distinct routes, six providers and three market-system notes without ownership or eligibility assertions', () => {
  assert.equal(validateOwnershipReference(DATA), DATA);
  const view = catalog();
  assert.equal(view.schema, 'finance-direct-ownership-options/v1');
  assert.equal(view.reference_date, '2026-11-12');
  assert.equal(view.status, 'available');
  assert.equal(view.ownership, 'not_asserted');
  assert.equal(view.userEligibility, 'not_assessed');
  assert.equal(view.automatic_collection, false);
  assert.equal(view.is_live, false);
  assert.deepEqual(view.counts, { sample_routes: 13, provider_entries: 6, market_notes: 3, returned_routes: 13 });
  assert.equal(new Set(view.routes.map(route => route.id)).size, 13);
  assert.equal(view.matching_basis, 'catalog_no_identity_join');
  for (const route of view.routes) {
    assert.equal(route.userEligibility, 'not_assessed');
    assert.equal(route.evidenceFreshness.is_live, false);
    assert.equal(route.evidenceFreshness.current_terms_verified, false);
    assert.ok(route.sources.length);
  }
  assert.ok(view.limitations.some(note => /not a complete provider, sector or exchange inventory/.test(note)));
  assert.ok(view.providerDirectory.some(provider => /Former AST is now EQ/.test(provider.note)));
  assert.ok(view.marketNotes.some(note => note.market === 'Japan' && /No general/.test(note.finding)));
});

test('unknown costs remain null, sourced zero stays zero, and monetary versus whole-share units cannot collapse', () => {
  const sony = byTicker('SONY'), manulife = byTicker('MFC'), air = byTicker('AI'), pg = byTicker('PG');
  assert.equal(sony.initialMinimum, null);
  assert.equal(sony.optionalMinimum, null);
  assert.equal(sony.fees.enrollment, null);
  assert.equal(air.fees.enrollment, 0);
  assert.deepEqual(manulife.initialMinimum, { amount: 1, unit: 'existing_whole_share', currency: null, note: 'Not a first-share purchase facility' });
  assert.equal(air.initialMinimum.unit, 'whole_share');
  assert.equal(air.initialMinimum.currency, null);
  assert.equal(pg.initialMinimum.amount, 250);
  assert.equal(pg.initialMinimum.currency, 'USD');
  assert.equal(pg.initialMinimum.unit, 'currency');
  assert.equal(manulife.optionalMinimum.unit, 'currency');
  assert.equal(byTicker('ONB').fees.enrollment, null);
  assert.match(byTicker('SBCF').caveats[0], /2014/);
  assert.equal(byTicker('NBBK').fees.enrollment, 25);
  assert.match(byTicker('NBBK').fees.note, /U.S.-bank check/);
});

test('first-purchase, already-holder, registration treatment and U.S.-source scope remain distinct', () => {
  const pg = byTicker('PG'), manulife = byTicker('MFC'), air = byTicker('AI'), sony = byTicker('SONY');
  assert.equal(pg.newInvestorAccess, 'yes');
  assert.equal(pg.usResidentEligibility, 'yes_general_public');
  assert.equal(pg.registrationModel, 'plan_nominee_with_drs_exit');
  assert.equal(pg.userEligibility, 'not_assessed');
  assert.equal(manulife.newInvestorAccess, 'no');
  assert.equal(manulife.entryPath, 'existing_holder_drip_optional_cash');
  assert.equal(manulife.registrationModel, 'registered_plan_shares');
  assert.equal(manulife.usResidentEligibility, 'yes_explicit');
  assert.equal(air.usResidentEligibility, 'unverified');
  assert.equal(air.securityType, 'ordinary_common');
  assert.equal(air.registrationModel, 'pure_registered');
  assert.equal(sony.registrationModel, 'registered_adr');
  assert.equal(sony.securityType, 'adr');
  assert.equal(sony.planSponsorType, 'depositary');
  assert.match(sony.caveats[0], /does not register underlying Japanese ordinary shares/);
  assert.equal(byTicker('CAC').planSponsorType, 'transfer_agent_affiliate');
  assert.equal(byTicker('NBBK').planSponsorType, 'transfer_agent');
  assert.equal(byTicker('MRK').registrationEvidence.status, 'details_unverified');
});

test('explicit reviewed CIK filters without pretending to identify a live listing', () => {
  const view = ownershipOptionsView({ issuer_id: 'sec:0000080424', now });
  assert.equal(view.status, 'available');
  assert.equal(view.matching_basis, 'explicit_reviewed_cik');
  assert.equal(view.routes.length, 1);
  assert.equal(view.routes[0].ticker, 'PG');
  assert.equal(view.routes[0].issuer_id, 'sec:0000080424');
  assert.equal(view.symbol, null);
  assert.equal(view.mic, null);
  assert.equal(view.identity_snapshot, null);
  assert.equal(view.providerDirectory.length, 6);
  assert.equal(view.marketNotes.length, 3);
});

test('exact symbol plus reviewed MIC derives a unique SEC CIK from the dated directory', () => {
  for (const [symbol, mic, issuer] of [['PG', 'XNYS', 'sec:0000080424'], ['NBBK', 'XNAS', 'sec:0001979330'], ['RNST', 'XNYS', 'sec:0000715072'], ['MFC', 'XNYS', 'sec:0001086888']]) {
    const view = ownershipOptionsView({ symbol, mic, now });
    assert.equal(view.status, 'available');
    assert.equal(view.routes.length, 1);
    assert.equal(view.routes[0].ticker, symbol);
    assert.equal(view.routes[0].issuer_id, issuer);
    assert.equal(view.issuer_id, issuer);
    assert.equal(view.matching_basis, 'sec_snapshot_symbol_and_mic');
    assert.equal(view.identity_snapshot.retrieved_at, DIRECTORY.retrieved_at);
    assert.equal(view.identity_snapshot.source_url, DIRECTORY.source.url);
    assert.equal(view.identity_snapshot.sha256, DIRECTORY.source.sha256);
  }
});

test('Air Liquide AI never attaches to NYSE C3.ai or any ticker-only search', () => {
  const view = ownershipOptionsView({ symbol: 'AI', mic: 'XNYS', now });
  assert.equal(view.status, 'not_covered');
  assert.equal(view.issuer_id, 'sec:0001577526');
  assert.deepEqual(view.routes, []);
  assert.equal(view.needs_review, true);
  assert.equal(ownershipOptionsView({ issuer_id: 'sec:0001577526', now }).routes.length, 0);
  assert.throws(() => ownershipOptionsView({ symbol: 'AI', now }), /invalid_ownership_query/);
  const air = byTicker('AI');
  assert.equal(air.issuer_id, null);
  assert.equal(air.identity_status, 'unresolved_for_sec_join');
  assert.equal(air.issuerIdentity.isin, 'FR0000120073');
  assert.equal(air.issuerIdentity.homeListing, 'Euronext Paris:AI');
});

test('null-CIK foreign and U.S. routes remain catalog-only, without ticker-based inferred identity', () => {
  for (const [symbol, mic] of [['SONY', 'XNYS'], ['TTE', 'XNYS'], ['CAC', 'XNAS'], ['ONB', 'XNAS'], ['SBCF', 'XNAS']]) {
    const route = byTicker(symbol);
    assert.equal(route.issuerIdentity.cik, null);
    assert.equal(route.issuer_id, null);
    const view = ownershipOptionsView({ symbol, mic, now });
    assert.equal(view.status, 'not_covered');
    assert.deepEqual(view.routes, []);
  }
  assert.equal(byTicker('TTE').issuerIdentity.isin, 'FR0000120271');
  assert.ok(catalog().staleClaimsToAvoid.some(claim => /NYSE ordinary shares/.test(claim.correction)));
});

test('unmapped MICs, wrong exchange, absent identities and ambiguous SEC identities fail closed', () => {
  for (const [symbol, mic] of [['PG', 'XNAS'], ['AI', 'XPAR'], ['PG', 'XBTS'], ['PG', 'XCBO'], ['ZZZZZZZZ', 'XNYS']]) {
    const view = ownershipOptionsView({ symbol, mic, now });
    assert.equal(view.status, 'identity_unresolved');
    assert.equal(view.needs_review, true);
    assert.deepEqual(view.routes, []);
  }
  const directory = modifiedDirectory({ issuer_id: 'sec:9999999999', cik: '9999999999', ticker: 'PG', name: 'Collision fixture', exchange: 'NYSE', listing_id: 'sec:9999999999|NYSE|PG' });
  const ambiguous = ownershipOptionsView({ symbol: 'PG', mic: 'XNYS', now, directory });
  assert.equal(ambiguous.status, 'identity_unresolved');
  assert.equal(ambiguous.issuer_id, null);
  assert.deepEqual(ambiguous.routes, []);
  const unknown = ownershipOptionsView({ issuer_id: 'sec:9999999999', now });
  assert.equal(unknown.status, 'not_covered');
  assert.equal(unknown.needs_review, true);
});

test('a different same-issuer ticker cannot inherit the common-share plan', () => {
  const directory = modifiedDirectory({ issuer_id: 'sec:0000080424', cik: '0000080424', ticker: 'PG-A', name: 'Share-class fixture', exchange: 'NYSE', listing_id: 'sec:0000080424|NYSE|PG-A' });
  const view = ownershipOptionsView({ symbol: 'PG-A', mic: 'XNYS', now, directory });
  assert.equal(view.issuer_id, 'sec:0000080424');
  assert.equal(view.status, 'not_covered');
  assert.deepEqual(view.routes, []);
});

test('query rejects mixed identity, coercion, missing components, markup and malformed time', () => {
  for (const params of [
    { issuer_id: 'sec:0000080424', symbol: 'PG', mic: 'XNYS' },
    { issuer_id: ['sec:0000080424'] }, { issuer_id: '80424' }, { issuer_id: 'sec:80424' },
    { symbol: 'PG' }, { mic: 'XNYS' }, { symbol: ['PG'], mic: 'XNYS' },
    { symbol: 'pg', mic: 'XNYS' }, { symbol: '<script>', mic: 'XNYS' },
    { symbol: 'PG', mic: ['XNYS'] }, { symbol: 'PG', mic: 'NYSE!' },
    { now: '2026-11-12' }, { now: NaN }, { now: Infinity }, { now: 1e100 },
  ]) assert.throws(() => ownershipOptionsView({ now, ...params }), error => error.code === 'invalid_ownership_query');
});

test('retrieval recency never renews old terms, undated terms or current registration validity', () => {
  const pg = byTicker('PG'), camden = byTicker('CAC'), seacoast = byTicker('SBCF'), nb = byTicker('NBBK');
  assert.equal(pg.evidenceFreshness.state, 'recently_observed');
  assert.equal(pg.evidenceFreshness.document_state, 'includes_undated_documents');
  assert.equal(pg.evidenceFreshness.current_terms_verified, false);
  assert.equal(pg.registrationEvidence.current_registration_verified, false);
  assert.equal(camden.evidenceFreshness.state, 'recently_observed');
  assert.equal(camden.evidenceFreshness.document_state, 'older_terms_require_review');
  assert.ok(camden.evidenceFreshness.document_dates.includes('2021-06-25'));
  assert.equal(seacoast.evidenceFreshness.document_state, 'older_terms_require_review');
  assert.ok(seacoast.evidenceFreshness.document_dates.includes('2014-11-21'));
  assert.equal(nb.evidenceFreshness.document_state, 'undated_documents');
});

test('source evidence, registration, providers and market notes expire without hiding historical facts', () => {
  assert.equal(OWNERSHIP_REFERENCE_REVIEW_DAYS, 30);
  const expiry = Date.parse('2026-12-12T00:00:00Z');
  const fresh = ownershipOptionsView({ now: expiry - 1 });
  assert.ok(fresh.routes.every(route => route.evidenceFreshness.state === 'recently_observed'));
  const stale = ownershipOptionsView({ now: expiry });
  for (const route of stale.routes) {
    assert.equal(route.evidenceFreshness.state, 'review_due');
    assert.equal(route.registrationEvidence.status, 'review_due');
    assert.equal(route.evidenceFreshness.review_due_at, '2026-12-12');
    assert.equal(route.evidenceFreshness.age_days, 30);
    assert.equal(route.userEligibility, 'not_assessed');
  }
  assert.ok(stale.providerDirectory.every(entry => entry.evidenceFreshness.state === 'review_due'));
  assert.ok(stale.marketNotes.every(entry => entry.evidenceFreshness.state === 'review_due'));
  const future = ownershipOptionsView({ now: Date.parse('2026-11-11T23:59:59Z') });
  assert.ok(future.routes.every(route => route.evidenceFreshness.state === 'future_observation' && route.evidenceFreshness.age_days === null));
  assert.ok(future.routes.every(route => route.registrationEvidence.status === 'future_observation'));
});

test('oldest required source controls expiry even when another source was just retrieved', () => {
  const reference = copy();
  reference.routes[0].sources[1].verifiedAt = '2026-10-01';
  const pg = ownershipOptionsView({ now, reference }).routes[0];
  assert.equal(pg.evidenceFreshness.state, 'review_due');
  assert.equal(pg.evidenceFreshness.observed_at, '2026-10-01');
});

test('strict reference rejects unknown/private keys at every nested object boundary', () => {
  for (const mutate of [
    d => { d.owner_id = 'private'; }, d => { d.routes[0].held_quantity = 1; },
    d => { d.routes[0].issuerIdentity.account_number = 'private'; },
    d => { d.routes[0].initialMinimum.budget = 1; },
    d => { d.routes[0].fees.personal_balance = 1; }, d => { d.routes[0].sources[0].private_notes = 'private'; },
    d => { d.enums.approved = ['yes']; }, d => { d.providerDirectory[0].credentials = {}; },
    d => { d.marketNotes[0].holdings = []; }, d => { d.staleClaimsToAvoid[0].account = {}; },
  ]) { const doc = copy(); mutate(doc); assert.throws(() => validateOwnershipReference(doc), referenceError); }
});

test('strict reference rejects missing keys, type coercion, unsafe numbers and contradictory units', () => {
  for (const mutate of [
    d => { d.schemaVersion = '1'; }, d => { d.verifiedAt = ['2026-11-12']; },
    d => { delete d.routes[0].fees.enrollment; }, d => { d.routes[0].issuerIdentity.cik = ['0000080424']; },
    d => { d.routes[0].ticker = ['PG']; }, d => { d.routes[0].domicile = ['US']; },
    d => { d.routes[0].newInvestorAccess = true; }, d => { d.routes[0].fees.enrollment = '15'; },
    d => { d.routes[0].fees.enrollment = NaN; }, d => { d.routes[0].fees.enrollment = -1; },
    d => { d.routes[0].fees.purchase = { amount: 1 }; }, d => { d.routes[0].initialMinimum.amount = '250'; },
    d => { d.routes[0].initialMinimum.amount = Infinity; }, d => { d.routes[0].initialMinimum.amount = -1; },
    d => { d.routes[0].initialMinimum.amount = Number.MAX_SAFE_INTEGER + 1; },
    d => { delete d.routes[0].initialMinimum.unit; }, d => { d.routes[0].initialMinimum.unit = 'whole_share'; },
    d => { d.routes[0].initialMinimum.currency = null; }, d => { d.routes[0].initialMinimum.currency = ['USD']; },
    d => { d.routes[9].initialMinimum.amount = 1.5; }, d => { d.routes[9].initialMinimum.currency = 'USD'; },
    d => { d.routes[9].initialMinimum.amount = 0; }, d => { d.routes[9].initialMinimum.unit = 'shares'; },
    d => { d.routes[10].issuerIdentity.isin = ['FR0000120073']; },
    d => { d.routes.push(structuredClone(d.routes[0])); },
    d => { d.providerDirectory.push(structuredClone(d.providerDirectory[0])); },
    d => { d.marketNotes.push(structuredClone(d.marketNotes[0])); },
    d => { d.enums.newInvestorAccess[0] = 'eligible'; },
  ]) { const doc = copy(); mutate(doc); assert.throws(() => validateOwnershipReference(doc), referenceError); }
});

test('reference enforces ADR, pure registration and existing-holder semantics', () => {
  for (const mutate of [
    d => { d.routes[12].securityType = 'ordinary_common'; },
    d => { d.routes[12].registrationModel = 'pure_registered'; },
    d => { d.routes[12].providerRole = 'issuer_shareholder_services'; },
    d => { d.routes[9].newInvestorAccess = 'yes'; },
    d => { d.routes[9].initialMinimum = null; },
    d => { d.routes[10].entryPath = 'direct_purchase_plan'; },
  ]) { const doc = copy(); mutate(doc); assert.throws(() => validateOwnershipReference(doc), referenceError); }
});

test('plain-data boundary rejects accessors without invoking them, inherited fields, symbols and sparse arrays', () => {
  let invoked = false;
  const accessor = copy();
  Object.defineProperty(accessor.routes[0], 'issuerName', { enumerable: true, get() { invoked = true; return 'unsafe'; } });
  assert.throws(() => validateOwnershipReference(accessor), referenceError);
  assert.equal(invoked, false);
  const sourceAccessor = copy();
  Object.defineProperty(sourceAccessor.routes[0].sources, '0', { enumerable: true, get() { invoked = true; return {}; } });
  assert.throws(() => validateOwnershipReference(sourceAccessor), referenceError);
  assert.equal(invoked, false);
  for (const mutate of [
    d => { Object.setPrototypeOf(d.routes[0], { extra: true }); },
    d => { d.routes[0][Symbol('private')] = 'private'; },
    d => { delete d.routes[0].sources[0]; },
    d => { delete d.routes[0].caveats[0]; },
    d => { d.routes[0].sources.extra = 'private'; },
  ]) { const doc = copy(); mutate(doc); assert.throws(() => validateOwnershipReference(doc), referenceError); }
});

test('XSS text and unsafe, untrusted or credential-bearing source URLs are rejected', () => {
  for (const mutate of [
    d => { d.routes[0].issuerName = '<img src=x onerror=alert(1)>'; },
    d => { d.routes[0].caveats = ['<script>alert(1)</script>']; },
    d => { d.routes[0].fees.note = 'bad\u0000text'; },
    d => { d.providerDirectory[0].role = '<svg>'; },
    d => { d.marketNotes[0].finding = '<iframe>'; },
  ]) { const doc = copy(); mutate(doc); assert.throws(() => validateOwnershipReference(doc), referenceError); }
  for (const url of [
    'javascript:alert(1)', 'data:text/html,hello', 'http://www.sec.gov/test',
    'https://www.sec.gov.evil.invalid/test', 'https://attacker.sec.gov/test',
    'https://www.sec.gov@evil.invalid/test', 'https://user:pass@www.sec.gov/test',
    'https://www.sec.gov:8443/test', 'https://www.sec.gov/test#javascript:alert(1)',
    'https://www.sec.gov\\@evil.invalid/test', 'https://www.sec.gov/test?x=%3Cscript%3E',
    'https://www.sec.gov/test\n', ['https://www.sec.gov/test'],
  ]) {
    const doc = copy(); doc.routes[0].sources[0].url = url;
    assert.throws(() => validateOwnershipReference(doc), referenceError);
  }
  const provider = copy(); provider.providerDirectory[0].url = 'https://evil.invalid/';
  assert.throws(() => validateOwnershipReference(provider), referenceError);
});

test('malformed, coerced and impossible source/document dates cannot refresh evidence', () => {
  for (const mutate of [
    d => { d.verifiedAt = '2026-02-30'; },
    d => { d.routes[0].sources[0].verifiedAt = '2026-11-13'; },
    d => { d.routes[0].sources[0].verifiedAt = '2026-11-12T00:00:00Z'; },
    d => { d.routes[0].sources[0].verifiedAt = ['2026-11-12']; },
    d => { d.routes[0].sources[0].documentDate = '2026-02-29'; },
    d => { d.routes[0].sources[0].documentDate = '2026-13-01'; },
    d => { d.routes[0].sources[0].documentDate = '2026-11'; },
    d => { d.routes[0].sources[0].documentDate = '2026-11-13'; },
    d => { d.routes[0].sources[0].documentDate = ['2026-10-15']; },
    d => { delete d.routes[0].sources[0].documentDate; },
    d => { d.routes[0].sources.push(structuredClone(d.routes[0].sources[0])); },
  ]) { const doc = copy(); mutate(doc); assert.throws(() => validateOwnershipReference(doc), referenceError); }
});

test('returned references cannot mutate the bundled catalog or input', () => {
  const reference = copy(), view = ownershipOptionsView({ now, reference });
  view.routes[0].sources[0].title = 'changed';
  view.routes[0].issuerIdentity.cik = '9999999999';
  view.providerDirectory[0].sources[0].title = 'changed';
  view.marketNotes[0].details.push('changed');
  view.staleClaimsToAvoid[0].source.title = 'changed';
  view.interpretation.push('changed');
  assert.deepEqual(reference, DATA);
  assert.deepEqual(ownershipOptionsView({ now }).routes, ownershipOptionsView({ now, reference }).routes);
});

test('module import and view need no network, database, provider key or account operations', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('No network permitted'); };
  try {
    const module = await import('../src/finance/ownership-options.js?offline-proof');
    module.ownershipOptionsView({ now });
    module.ownershipOptionsView({ symbol: 'PG', mic: 'XNYS', now });
    assert.equal(calls, 0);
    assert.deepEqual(Object.keys(module).sort(), ['OWNERSHIP_REFERENCE_REVIEW_DAYS', 'ownershipOptionsView', 'validateOwnershipReference']);
  } finally { globalThis.fetch = oldFetch; }
  const source = await readFile(new URL('../src/finance/ownership-options.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|rpc)\s*\(|SUPABASE_|ALPACA_|computershare-plan\.js|plan-review-service\.js/);
});
