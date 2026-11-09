import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSecSubmissions, parseSecCompanyFacts } from '../src/eup/adapters/sec.js';
import { parseGleifRecord } from '../src/eup/adapters/gleif.js';
import { parseCongressBill, parseCongressActions, parseCongressTextVersions } from '../src/eup/adapters/congress.js';
import { parseCensusTigerListing } from '../src/eup/adapters/census.js';
import { parseCtAssemblyBill } from '../src/eup/adapters/ct-assembly.js';
import { parseBridgeportCouncilRoster } from '../src/eup/adapters/bridgeport-council.js';
import { boundedUpstreamRead } from '../src/eup/adapters/index.js';
import { provenance, rawHash } from '../src/eup/provenance.js';
import { assertFetchAllowed, withholdRestricted } from '../src/eup/intake.js';

const fx = async (name) => JSON.parse(await readFile(new URL(`./fixtures/eup/${name}`, import.meta.url), 'utf8'));
const AT = '2026-11-09T12:00:00.000Z';
const PROV_KEYS = ['source_id', 'source_record_id', 'url', 'observed_at', 'effective_from', 'effective_to', 'upstream_updated_at', 'fetched_at', 'parser_version', 'raw_hash', 'rights_revision', 'review_state', 'coverage'];
const hasProvenance = (r) => { for (const k of PROV_KEYS) assert.ok(k in r.provenance, `provenance.${k} on ${r.external_id}`); assert.equal(r.provenance.review_state, 'intake'); };

test('provenance is complete, https-only and immutable', async () => {
  const p = provenance({ source_id: 's', source_record_id: 'r', url: 'https://example.gov/x', fetched_at: AT, parser_version: 'p/1', rights_revision: 'rr' });
  assert.deepEqual(Object.keys(p).sort(), [...PROV_KEYS].sort());
  assert.ok(Object.isFrozen(p));
  assert.throws(() => provenance({ source_id: 's', source_record_id: 'r', url: 'http://example.gov/x', fetched_at: AT, parser_version: 'p/1', rights_revision: 'rr' }), /https/);
  assert.throws(() => provenance({ source_id: 's', source_record_id: 'r', url: 'https://e.gov', fetched_at: AT, parser_version: 'p/1', rights_revision: 'rr', coverage: 'total' }), /coverage/);
  assert.equal(await rawHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('SEC submissions: identity plus typed address assertions, no headquarters, no geocode', async () => {
  const { company, locations } = parseSecSubmissions(await fx('sec-submissions.json'), { fetched_at: AT, raw_hash: 'h1' });
  assert.equal(company.external_id, 'cik:0001234567');
  assert.deepEqual(company.identifiers, [{ scheme: 'cik', value: '0001234567' }, { scheme: 'ticker', value: 'SYNG' }]);
  assert.deepEqual(locations.map((l) => l.kind).sort(), ['mailing_address', 'registered_office']);
  assert.ok(locations.every((l) => l.geocode === null && l.identifier_scheme === 'cik'));
  assert.ok(!locations.some((l) => l.kind === 'headquarters'), 'a filing address is not promoted to HQ');
  [company, ...locations].forEach(hasProvenance);
  assert.equal(company.provenance.url, 'https://data.sec.gov/submissions/CIK0001234567.json');
  assert.throws(() => parseSecSubmissions({}, { fetched_at: AT }), /cik/);
});

test('SEC companyfacts: one record per period/accession; a 10-K/A restatement stays a separate record', async () => {
  const facts = parseSecCompanyFacts(await fx('sec-companyfacts.json'), { fetched_at: AT, concepts: ['us-gaap:Revenues'] });
  assert.equal(facts.length, 2);
  assert.deepEqual(facts.map((f) => f.value), [120000000, 118500000]);
  assert.ok(facts.every((f) => f.unit === 'USD' && f.currency === 'USD' && f.period_start === '2025-01-01' && f.period_end === '2025-12-31'));
  assert.notEqual(facts[0].external_id, facts[1].external_id);
  assert.equal(facts[1].provenance.upstream_updated_at, '2026-05-14T00:00:00.000Z');
  const all = parseSecCompanyFacts(await fx('sec-companyfacts.json'), { fetched_at: AT });
  assert.equal(all.find((f) => f.concept === 'dei:EntityCommonStockSharesOutstanding').currency, null);
  all.forEach(hasProvenance);
});

test('GLEIF: legal address and headquarters are different kinds; registration status kept', async () => {
  const { company, locations } = parseGleifRecord(await fx('gleif-record.json'), { fetched_at: AT });
  assert.deepEqual(company.identifiers, [{ scheme: 'lei', value: 'SYNTH00000000000GRID' }]);
  assert.equal(company.status, 'issued');
  assert.deepEqual(locations.map((l) => [l.kind, l.address.city]), [['registered_office', 'Stamford'], ['headquarters', 'Bridgeport']]);
  assert.ok(locations.every((l) => l.geocode === null));
  assert.equal(company.provenance.upstream_updated_at, '2026-09-30T12:00:00.000Z');
  assert.throws(() => parseGleifRecord({ data: { attributes: { lei: 'short' } } }, { fetched_at: AT }), /LEI/);
});

test('Congress.gov: bill identity, actions with committee, text versions as versions; reported is not enacted', async () => {
  const bill = parseCongressBill(await fx('congress-bill.json'), { fetched_at: AT });
  assert.equal(bill.external_id, 'bill:119-hr90001');
  assert.deepEqual([bill.session, bill.identifier, bill.enacted, bill.enacted_at], ['119', 'HR 90001', false, null]);
  const actions = parseCongressActions(await fx('congress-actions.json'), { congress: 119, type: 'HR', number: 90001 }, { fetched_at: AT });
  assert.equal(actions.length, 3);
  assert.equal(actions[1].committee_external_id, 'committee:hsif00');
  const versions = parseCongressTextVersions(await fx('congress-text-versions.json'), bill, { fetched_at: AT, raw_hash: 'h' });
  assert.equal(versions.length, 2);
  assert.notEqual(versions[0].text_hash, versions[1].text_hash);
  assert.deepEqual(versions.map((v) => v.version_label), ['Introduced in House', 'Reported in House']);
  const law = parseCongressBill({ bill: { congress: 118, type: 'S', number: 1, latestAction: { actionDate: '2024-01-01', text: 'Became Public Law No: 118-1.' } } }, { fetched_at: AT });
  assert.equal(law.enacted, true); assert.equal(law.enacted_at, '2024-01-01');
  [bill, ...actions, ...versions].forEach(hasProvenance);
});

test('Census TIGER listing: vintage and FIPS, discoverable file only, not validated geometry', async () => {
  const rows = parseCensusTigerListing(await fx('census-listing.json'), { fetched_at: AT, jurisdictionByFips: { '09': 'ct-state' } });
  assert.equal(rows.length, 3, 'README is not a layer');
  const ct = rows.find((r) => r.external_id === 'tiger:2025:09:place');
  assert.deepEqual([ct.vintage, ct.jurisdiction_external_id, ct.geometry_ref, ct.validated, ct.effective_from], ['2025', 'ct-state', null, false, '2025-01-01']);
  assert.equal(rows.find((r) => r.state_fips === '36').jurisdiction_external_id, null);
  assert.equal(ct.provenance.upstream_updated_at, '2025-09-22T00:00:00.000Z');
  const html = parseCensusTigerListing('<a href="tl_2025_09_place.zip">tl_2025_09_place.zip</a> 2025-09-22 10:00 866K', { fetched_at: AT });
  assert.equal(html.length, 1);
});

test('CT General Assembly: proposed bill with a text version, actions and an amendment; not enacted without a public act', async () => {
  const { bill, actions, amendments } = parseCtAssemblyBill(await fx('cga-bill.json'), { fetched_at: AT });
  assert.deepEqual([bill.external_id, bill.session, bill.identifier, bill.enacted, bill.version_label], ['bill:2026-HB90042', '2026', 'HB 90042', false, 'File Copy 1']);
  assert.equal(actions.length, 2); assert.equal(actions[0].committee_external_id, 'committee:ET');
  assert.deepEqual(amendments.map((m) => [m.label, m.applies_to_version]), [['LCO 4123', 1]]);
  assert.equal(bill.provenance.rights_revision, 'ct-cga-public-2026-11-unreviewed');
  [bill, ...actions, ...amendments].forEach(hasProvenance);
});

test('Bridgeport roster: offices per district, current terms with unknown dates, no contact details copied', async () => {
  const { offices, persons, terms } = parseBridgeportCouncilRoster(await fx('bridgeport-roster.json'), { fetched_at: AT, observed_at: AT });
  assert.equal(offices.length, 2); assert.equal(persons.length, 4); assert.equal(terms.length, 4);
  assert.ok(terms.every((t) => t.status === 'current' && t.start_date === null && t.end_date === null && t.provenance.coverage === 'partial'));
  assert.doesNotMatch(JSON.stringify({ offices, persons, terms }), /555-0100|phone/);
  assert.ok(persons.some((p) => p.external_ids.roles.includes('Council President')));
});

const states = { approved: { source_id: 'sec_edgar', configured: true, access: 'approved', paused: false, rights_expires_at: null } };

test('the gate refuses before any fetch: unknown, held, unreviewed, expired, unconfigured, missing binding, paused', async () => {
  let calls = 0; const fetchImpl = async () => { calls += 1; return new Response('{}'); };
  const env = { SEC_USER_AGENT: 'McCluster test agent' };
  const attempt = (id, state, e = env) => boundedUpstreamRead(id, state, e, 'https://data.sec.gov/submissions/CIK0001234567.json', { fetchImpl });
  await assert.rejects(attempt('nope', null), { reason: 'unknown_source' });
  await assert.rejects(attempt('openfec', { access: 'approved', configured: true }), { reason: 'rights_held' });
  await assert.rejects(attempt('sec_edgar', null), { reason: 'not_configured' });
  await assert.rejects(attempt('sec_edgar', { ...states.approved, rights_expires_at: '2026-01-01T00:00:00Z' }), { reason: 'rights_expired' });
  await assert.rejects(attempt('sec_edgar', { ...states.approved, configured: false }), { reason: 'not_configured' });
  await assert.rejects(attempt('sec_edgar', states.approved, {}), { reason: 'not_configured' });
  await assert.rejects(attempt('sec_edgar', { ...states.approved, paused: true }), { reason: 'source_paused' });
  assert.equal(calls, 0, 'no network activity before the gate passes');
  assert.throws(() => assertFetchAllowed('market_prices', { access: 'approved', configured: true }, env), { reason: 'rights_held' });
});

test('an allowed read is bounded to the source host and returns text with its fetch time', async () => {
  const seen = [];
  const fetchImpl = async (url) => { seen.push(String(url)); return new Response('{"cik":"1234567"}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const env = { SEC_USER_AGENT: 'McCluster test agent' };
  const out = await boundedUpstreamRead('sec_edgar', states.approved, env, 'https://data.sec.gov/submissions/CIK0001234567.json', { fetchImpl, now: () => Date.parse(AT) });
  assert.equal(out.text, '{"cik":"1234567"}'); assert.equal(out.fetched_at, AT); assert.equal(seen.length, 1);
  await assert.rejects(boundedUpstreamRead('sec_edgar', states.approved, env, 'https://evil.example/x', { fetchImpl }), { reason: 'invalid_upstream' });
  await assert.rejects(boundedUpstreamRead('sec_edgar', states.approved, env, 'http://data.sec.gov/x', { fetchImpl }), { reason: 'invalid_upstream' });
  assert.equal(seen.length, 1);
});

test('stored rows from a held or expired source are withheld from reads', () => {
  const rows = [
    { id: 1, provenance: { source_id: 'sec_edgar' } },
    { id: 2, provenance: { source_id: 'openfec' } },
    { id: 3, provenance: { source_id: 'gleif' } },
    { id: 4, provenance: { source_id: 'official_ct_offices' } }
  ];
  const st = [states.approved, { source_id: 'gleif', access: 'approved', configured: true, rights_expires_at: '2026-01-01T00:00:00Z' }, { source_id: 'official_ct_offices', access: 'approved' }];
  const out = withholdRestricted(rows, st, { now: Date.parse(AT) });
  assert.deepEqual(out.rows.map((r) => r.id), [1, 4]);
  assert.deepEqual(out.withheld, { openfec: 1, gleif: 1 });
});
