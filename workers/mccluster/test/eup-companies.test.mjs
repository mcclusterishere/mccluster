import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEup, EUP_PREFIX } from '../src/eup/router.js';
import { projectCompany } from '../src/eup/companies.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const E = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' };
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
const prov = (source_id) => ({ source_id, source_record_id: 'r', url: 'https://example.gov', fetched_at: '2026-11-09T12:00:00Z', parser_version: 'p/1', rights_revision: 'rr', review_state: 'intake', coverage: 'partial' });
const STATES = [{ source_id: 'sec_edgar', access: 'approved', configured: true }, { source_id: 'gleif', access: 'approved', configured: true }, { source_id: 'usaspending', access: 'approved' }];
const record = {
  entity: { id: E, legal_name: 'Synthetic Grid Components Inc', status: 'operating', review_state: 'intake', revision: 3, provenance: prov('sec_edgar') },
  identifiers: [{ scheme: 'cik', value: '0001234567' }, { scheme: 'lei', value: 'SYNTH00000000000GRID' }, { scheme: 'ticker', value: 'SYNG' }],
  locations: [
    { kind: 'registered_office', address: { city: 'Stamford' }, lat: null, lon: null, provenance: prov('sec_edgar') },
    { kind: 'exchange', address: { name: 'Nasdaq' }, lat: 40.7569, lon: -73.986, geocode_precision: 'street', geocode_method: 'fixture', provenance: prov('sec_edgar') },
    { kind: 'headquarters', address: { city: 'Bridgeport' }, lat: 41.1792, lon: -73.1894, geocode_precision: 'locality', geocode_method: 'fixture-centroid', provenance: prov('gleif') }
  ],
  facts: [
    { concept: 'us-gaap:Revenues', period_start: '2025-01-01', period_end: '2025-12-31', unit: 'USD', currency: 'USD', value: 118500000, amended: true, supersedes: 'f1', provenance: prov('sec_edgar') },
    { concept: 'us-gaap:Revenues', period_start: '2025-01-01', period_end: '2025-12-31', unit: 'USD', currency: 'USD', value: 120000000, amended: false, supersedes: null, provenance: prov('sec_edgar') }
  ],
  awards: [{ external_id: 'award:SYN-26-0001', agency: 'DOE (synthetic)', recipient: 'Synthetic Grid Components Inc', obligation: 2500000, outlay: 400000, period_start: '2026-01-01', period_end: '2026-12-31', place_of_performance: { city: 'Bridgeport' }, provenance: prov('usaspending') }]
};
function fake(get = record, search = [{ id: E, legal_name: record.entity.legal_name, status: 'operating', review_state: 'intake', identifiers: record.identifiers, provenance: prov('sec_edgar') }], states = STATES) {
  const fetchImpl = async (url, opts = {}) => {
    const body = JSON.parse(opts.body);
    if (String(url).includes('eup_sources_read')) return json(states);
    if (String(url).includes('eup_company_read')) return json(body.p_action === 'search' ? search : get);
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl };
}
const call = (path, f, init) => handleEup(new Request(`https://api.mccluster.org${EUP_PREFIX}/companies${path}`, init), env, { requireHouseOwner: async () => ({ id: OWNER }), fetchImpl: f.fetchImpl, now: () => Date.parse('2026-11-09T12:00:00Z') });

test('search returns identity-separated results; short queries are refused', async () => {
  const b = await (await call('/search?q=Synthetic', fake())).json();
  assert.equal(b.count, 1); assert.deepEqual(b.results[0].identifiers.map((i) => i.scheme), ['cik', 'lei', 'ticker']);
  assert.equal((await call('/search?q=a', fake())).status, 400);
});

test('company detail keeps HQ, registered office and exchange apart; only HQ/facility/performance geocodes pin; quote is null', async () => {
  const b = await (await call(`/${E}`, fake())).json(); const c = b.company;
  assert.deepEqual(c.locations.map((l) => [l.kind, l.pin !== null]), [['registered_office', false], ['exchange', false], ['headquarters', true]]);
  assert.equal(c.headquarters_pin.precision, 'locality');
  assert.equal(c.locations.find((l) => l.kind === 'registered_office').geocode, null);
  assert.equal(c.quote, null); assert.match(c.quote_note, /held/);
  assert.deepEqual(c.facts.map((f) => [f.value, f.amended]), [[118500000, true], [120000000, false]]);
  assert.equal(c.facts[0].period.end, '2025-12-31'); assert.equal(c.facts[0].unit, 'USD');
  assert.match(c.awards[0].note, /not evidence/);
  assert.equal(c.awards[0].place_of_performance.city, 'Bridgeport');
});

test('a held or expired source withholds its rows from the projection, including a whole entity', () => {
  const expired = [{ source_id: 'sec_edgar', access: 'approved' }, { source_id: 'gleif', access: 'approved', rights_expires_at: '2026-01-01T00:00:00Z' }];
  const c = projectCompany(record, expired, Date.parse('2026-11-09T12:00:00Z'));
  assert.ok(!c.locations.some((l) => l.kind === 'headquarters')); assert.equal(c.headquarters_pin, null);
  assert.equal(c.awards.length, 0, 'unreviewed usaspending rows are withheld');
});

test('an entity from a held source is 403, a missing one 404, writes 405', async () => {
  const held = { ...record, entity: { ...record.entity, provenance: prov('openfec') } };
  assert.equal((await call(`/${E}`, fake(held))).status, 403);
  assert.equal((await call(`/${E}`, fake(null))).status, 404);
  assert.equal((await call(`/${E}`, fake(), { method: 'POST' })).status, 405);
  assert.equal((await call('/nope', fake())).status, 404);
});
