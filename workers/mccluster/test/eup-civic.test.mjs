import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEup, EUP_PREFIX } from '../src/eup/router.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const J = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', O = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' };
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
const prov = (source_id, coverage = 'partial') => ({ source_id, source_record_id: 'r', url: 'https://example.gov', fetched_at: '2026-11-09T12:00:00Z', parser_version: 'p/1', rights_revision: 'rr', review_state: 'intake', coverage });

function fake(data, states = [{ source_id: 'official_ct_offices', access: 'approved', configured: true }]) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const body = JSON.parse(opts.body); calls.push({ url: String(url), body });
    if (String(url).includes('eup_sources_read')) return json(states);
    if (String(url).includes('eup_civic_read')) return json(typeof data === 'function' ? data(body.p_action, body.p_params) : data);
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls };
}
const call = (path, f, init) => handleEup(new Request(`https://api.mccluster.org${EUP_PREFIX}/civic${path}`, init), env, { requireHouseOwner: async () => ({ id: OWNER }), fetchImpl: f.fetchImpl, now: () => Date.parse('2026-11-09T12:00:00Z') });

test('jurisdictions, offices, terms, bills and elections read the private store with provenance and coverage', async () => {
  const f = fake((action, params) => {
    if (action === 'jurisdictions') return params.parent === 'none' ? [{ id: J, name: 'United States', level: 'country', provenance: prov('official_ct_offices', 'full') }] : [{ id: O, name: 'Connecticut', level: 'state', relation: 'contains', provenance: prov('official_ct_offices') }];
    if (action === 'offices') return [{ id: O, title: 'Mayor', vacant_seats: 0, provenance: prov('official_ct_offices') }];
    if (action === 'terms') return [{ id: 't', status: 'vacant', person: null, provenance: prov('official_ct_offices') }];
    if (action === 'bills') return [{ id: B, identifier: 'HB 90042', enacted: false, versions: 2, provenance: prov('official_ct_offices') }];
    if (action === 'elections') return [{ id: 'e', certification: 'preliminary', term_started: false, candidacies: [], provenance: prov('official_ct_offices') }];
    return [];
  });
  const roots = await (await call('/jurisdictions', f)).json();
  assert.equal(roots.count, 1); assert.equal(roots.coverage, 'full'); assert.ok(!f.calls.some((c) => c.url.includes('civic_jurisdictions') || c.url.includes('action_policy')));
  const children = await (await call(`/jurisdictions?parent=${J}`, f)).json(); assert.equal(children.jurisdictions[0].relation, 'contains');
  assert.equal((await (await call(`/offices?jurisdiction=${J}`, f)).json()).offices[0].title, 'Mayor');
  assert.equal((await (await call(`/terms?office=${O}`, f)).json()).terms[0].status, 'vacant');
  assert.equal((await (await call(`/bills?jurisdiction=${J}&session=2026`, f)).json()).bills[0].versions, 2);
  assert.equal(f.calls.find((c) => c.body.p_action === 'bills').body.p_params.session, '2026');
  assert.equal((await (await call(`/elections?jurisdiction=${J}`, f)).json()).elections[0].certification, 'preliminary');
});

test('bill detail separates proposed from enacted and 404s when absent', async () => {
  const f = fake((action) => action === 'bill' ? { id: B, enacted: false, law_status: 'proposed', versions: [{ version_number: 1 }, { version_number: 2 }], provenance: prov('official_ct_legislation') } : null, [{ source_id: 'official_ct_legislation', access: 'approved' }]);
  const r = await call(`/bills/${B}`, f); const b = await r.json();
  assert.equal(b.law_status, 'proposed'); assert.equal(b.bill.versions.length, 2);
  const g = fake(() => null);
  assert.equal((await call(`/bills/${B}`, g)).status, 404);
});

test('records from a held or unreviewed source are withheld even when stored; an empty selection says so', async () => {
  const f = fake([{ id: 1, provenance: prov('official_ct_offices') }, { id: 2, provenance: prov('legiscan_secondary') }, { id: 3, provenance: prov('official_ct_elections') }]);
  const b = await (await call(`/offices?jurisdiction=${J}`, f)).json();
  assert.equal(b.count, 1); assert.deepEqual(b.withheld, { legiscan_secondary: 1, official_ct_elections: 1 });
  const empty = await (await call('/jurisdictions', fake([]))).json();
  assert.equal(empty.count, 0); assert.match(empty.note, /absence of coverage/);
  const held = fake(() => ({ id: B, provenance: prov('legiscan_secondary') }));
  assert.equal((await call(`/bills/${B}`, held)).status, 403);
});

test('invalid parameters, writes and unknown routes are refused', async () => {
  const f = fake([]);
  assert.equal((await call('/offices?jurisdiction=nope', f)).status, 400);
  assert.equal((await call('/jurisdictions?parent=nope', f)).status, 400);
  assert.equal((await call('/offices', f, { method: 'POST' })).status, 405);
  assert.equal((await call('/wards', f)).status, 404);
  assert.equal(f.calls.length, 0);
});

test('storage outage is 503 unavailable, never fabricated rows', async () => {
  const r = await handleEup(new Request(`https://api.mccluster.org${EUP_PREFIX}/civic/jurisdictions`), { ALLOWED_ORIGINS: '' }, { requireHouseOwner: async () => ({ id: OWNER }), fetchImpl: async () => { throw new Error('x'); } });
  assert.equal(r.status, 503); assert.equal((await r.json()).reason, 'storage_unavailable');
});
