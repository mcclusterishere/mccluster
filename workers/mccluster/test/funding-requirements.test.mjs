import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateFundingRegister, CRITERION_STATUSES } from '../src/funding-requirements.js';
import { handleFundingIntelligence } from '../src/funding-intelligence.js';
const seed = JSON.parse(await readFile(new URL('../../../docs/control-plane/admin-evidence-20261020/funding-register.json', import.meta.url), 'utf8'));
const row = id => structuredClone(seed.opportunities.find(r => r.criteria_register.route_id === id));
const now = Date.parse('2026-10-20T20:00:00Z');
const req = query => new Request('https://api.mccluster.org/v1/control/funding/register' + query);

test('register covers 72 distinct routes, keeps civic primary keys and never represents technical targets as requirements', () => {
  assert.equal(seed.opportunities.length, 72);
  assert.equal(new Set(seed.opportunities.map(r => r.criteria_register.route_id)).size, 72);
  assert.equal(row('N01').opportunity_id, 'cities-deliver-2026');
  assert.equal(row('N03').opportunity_id, 'cthealth-trusted-messengers-2026');
  for (const r of seed.opportunities) {
    const actual = evaluateFundingRegister(r, { now, details: true });
    assert.notEqual(actual.eligible_to_apply, true);
    assert.equal(actual.funding_authorized, false);
    assert.equal(actual.award_received, false);
    assert.equal(actual.requirements_complete, false);
    assert.ok(actual.criteria.every(c => CRITERION_STATUSES.includes(c.status)));
    assert.ok(actual.criteria.filter(c => c.classification === 'proposed_target').every(c => !c.blocking));
    assert.ok(!('score' in actual) && !('probability' in actual));
  }
});
test('closed awards, PI gaps, partner letters, licensing and incompatible workflow are independent blockers', () => {
  const historical = evaluateFundingRegister(row('N03'), { now });
  assert.equal(historical.call_status, 'closed');
  assert.equal(historical.eligible_to_apply, false);
  assert.equal(historical.award_received, false);
  const nsf = evaluateFundingRegister(row('C02'), { now });
  assert.ok(nsf.application_readiness.blocking_criterion_ids.includes('C02-pi'));
  assert.ok(nsf.application_readiness.blocking_criterion_ids.includes('C02-license'));
  const city = evaluateFundingRegister(row('N01'), { now });
  assert.ok(city.application_readiness.blocking_criterion_ids.includes('N01-city'));
  assert.ok(city.application_readiness.blocking_criterion_ids.includes('N01-license'));
  for (const code of ['O03', 'O04']) {
    const incompatible = evaluateFundingRegister(row(code), { now });
    assert.equal(incompatible.application_readiness.status, 'incompatible');
    assert.equal(incompatible.eligible_to_apply, false);
  }
});
test('a UI/imported evidence label or nonapplicable label cannot bypass mandatory source review and evidence resolution', () => {
  const r = row('C02');
  for (const c of r.criteria_register.criteria) c.status = 'evidenced';
  let p = evaluateFundingRegister(r, { now, details: true });
  assert.ok(p.criteria.every(c => c.status === 'unverified'));
  const c = r.criteria_register.criteria.find(c => c.criterion_id === 'C02-pi');
  Object.assign(c, { status: 'not_applicable', reviewer: 'reviewer-1', reviewed_at: '2026-10-20T19:00:00Z',
    evidence_refs: ['artifact-1'], source_basis: 'reviewed_primary_source', source_version: 'official:fixture' });
  p = evaluateFundingRegister(r, { now, details: true });
  assert.equal(p.criteria.find(c => c.criterion_id === 'C02-pi').status, 'unverified');
  p = evaluateFundingRegister(r, { now, details: true, resolvedEvidence: new Set(['artifact-1']) });
  assert.equal(p.criteria.find(c => c.criterion_id === 'C02-pi').status, 'unverified', 'unregistered source version cannot support a review');
  r.criteria_register.source_versions.push({source_id:'official:fixture',sha256:'a'.repeat(64),review_state:'complete_requirements_review',
    reviewer:'reviewer-1',reviewed_at:'2026-10-20T18:00:00Z'});
  p = evaluateFundingRegister(r, { now, details: true, resolvedEvidence: new Set(['artifact-1']) });
  assert.equal(p.criteria.find(c => c.criterion_id === 'C02-pi').status, 'not_applicable');
  assert.notEqual(p.eligible_to_apply, true, 'a general catalog still has no private applicant review');
});
test('deadline boundary is closed at exact declared instant; no timezone invented for organization-local deadlines', () => {
  const n = row('N01');
  assert.equal(evaluateFundingRegister(n, { now: Date.parse('2026-11-30T04:58:59Z') }).call_status, 'open');
  assert.equal(evaluateFundingRegister(n, { now: Date.parse('2026-11-30T04:59:00Z') }).call_status, 'closed');
  const c = row('C03');
  assert.equal(evaluateFundingRegister(c, { now: Date.parse('2026-11-04T20:00:00Z') }).deadline.instant, null);
  assert.equal(evaluateFundingRegister(c, { now }).deadline.timezone, 'submitting_organization_local');
});
test('legacy closure survives conflicting metadata and noncash instruments are explicit', () => {
  const c = row('N03'); c.criteria_register.call_status = 'open';
  assert.equal(evaluateFundingRegister(c, { now }).call_status, 'closed');
  for (const [code, instrument] of [['O13','noncash_allocation'], ['R01','investment'], ['R07','tax_incentive'], ['R14','loan']]) {
    assert.equal(evaluateFundingRegister(row(code), { now }).instrument, instrument);
  }
});
test('missing, malformed and duplicate criteria cannot claim installed review readiness', () => {
  for (const criteria_register of [null, {}, [], {schema_version:1}, {schema_version:1, criteria:[{criterion_id:'X'}, {criterion_id:'X'}]}]) {
    const p = evaluateFundingRegister({criteria_register}, { now });
    assert.equal(p.register_state, 'unverified');
    assert.notEqual(p.eligible_to_apply, true);
  }
});
test('list projection is private and bounded; detail reads preserve source/criteria provenance', async () => {
  let query;
  const response = await handleFundingIntelligence(req(''), {}, {read: async q => {query = q; return seed.opportunities;}});
  const all = await response.json();
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(all.items.length, 72);
  assert.equal(all.completeness.state, 'complete');
  assert.ok(all.items.every(x => !x.criteria));
  assert.match(query, /limit=101/);
  const detail = await handleFundingIntelligence(req('?route_id=N01'), {}, {read: async q => {query = q; return [row('N01')];}});
  const d = await detail.json();
  assert.match(query, /criteria_register->>route_id=eq.N01/);
  assert.ok(d.items[0].criteria.length > 1);
  assert.equal(d.items[0].source_versions[0].source_kind, 'user_supplied_research_brief');
});
test('bad filters, absent schema and unavailable database cannot become empty successful registers', async () => {
  let calls = 0;
  const invalid = await handleFundingIntelligence(req('?route_id=N01%26or=(true)'), {}, {read: async () => {calls++;}});
  assert.equal(invalid.status, 400); assert.equal(calls, 0);
  for (const [status, expected] of [[400,'not_installed'], [404,'not_installed'], [503,'unavailable']]) {
    const response = await handleFundingIntelligence(req(''), {}, {read: async () => {throw Object.assign(Error('db'), {status});}});
    const p = await response.json(); assert.equal(p.ok, false); assert.equal(p.schema_state, expected);
    assert.equal(p.completeness.state, 'unavailable');
  }
  const bad = await handleFundingIntelligence(req(''), {}, {read: async () => ({rows:[]})});
  assert.equal((await bad.json()).ok, false);
});
test('lookahead reports a capped registry, not falsely complete results', async () => {
  const rows = Array.from({length:101}, (_, i) => ({...row('N01'), opportunity_id:'route-'+i}));
  const response = await handleFundingIntelligence(req(''), {}, {read: async () => rows});
  const p = await response.json(); assert.equal(p.items.length,100);assert.equal(p.completeness.state,'truncated');
});
