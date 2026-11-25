import test from 'node:test';
import assert from 'node:assert/strict';
import spatial from '../src/seek-first/index.js';
import { listSourceRecords } from '../src/seek-first/store.js';

const env = { SUPABASE_URL: 'https://archive.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function fixture(t, failTable) {
  const original = globalThis.fetch, calls = [];
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async raw => {
    const url = new URL(raw), table = url.pathname.split('/').pop(); calls.push(url);
    if (table === 'orgs') return json([{ id: 'house', slug: 'mccluster' }]);
    if (table === 'seek_first_sources') return json([{ source_key: 'usgs' }]);
    if (table === failTable) return json({ error: 'unavailable' }, 503);
    const common = { source_key: 'usgs', provenance: { attribution: 'Fixture' } };
    return json(table === 'seek_first_entities' ? [{ ...common, id: 'a', observed_at: '2026-10-21T00:00:00Z', entity_type: 'station', name: 'Station', properties: {} }] :
      table === 'seek_first_events' ? [{ ...common, id: 'b', observed_at: '2026-10-23T00:00:00Z', event_type: 'earthquake', name: 'Stored earthquake', properties: { magnitude: 3 } }] :
      [{ ...common, id: 'c', observed_at: '2026-10-22T00:00:00Z', observation_type: 'temperature', metric: 'air', value_number: 0, unit: 'C', payload: { quality: 'measured' } }]);
  };
  return calls;
}
test('stored source records include events and measurements with bounded house-scoped reads', async t => {
  const calls = fixture(t), rows = await listSourceRecords(env, 'house', { source: 'usgs', limit: 3 });
  assert.deepEqual(rows.map(r => r.kind), ['event', 'observation', 'entity']);
  assert.equal(rows[1].properties.value_number, 0); assert.equal(rows[1].properties.quality, 'measured');
  assert.equal(rows[0].record_type, 'earthquake');
  for (const url of calls) {
    assert.equal(url.searchParams.get('org_id'), 'eq.house');
    assert.equal(url.searchParams.get('source_key'), 'eq.usgs');
    assert.equal(url.searchParams.get('limit'), '3');
  }
});
test('the archive returns the newest merged sample rather than the first record family', async t => {
  fixture(t); const rows = await listSourceRecords(env, 'house', { source: 'usgs', limit: 1 });
  assert.deepEqual(rows.map(r => r.id), ['b']);
});
test('a failed record family cannot turn into an empty or silently partial archive', async t => {
  fixture(t, 'seek_first_events');
  await assert.rejects(listSourceRecords(env, 'house', { source: 'usgs' }), /database request failed/);
});
test('archive authorization precedes every database read', async t => {
  const calls = fixture(t);
  const result = await spatial.fetch(new Request('https://api.mccluster.org/v1/seek-first/records?source=usgs'), env,
    { requireHouseOwner: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); } });
  assert.equal(result.status, 403); assert.equal(calls.length, 0);
});
test('archive route validates source and limit and returns all record kinds', async t => {
  fixture(t); const options = { requireHouseOwner: async () => ({ id: 'owner' }) };
  const request = query => new Request('https://api.mccluster.org/v1/seek-first/records?' + query);
  const response = await spatial.fetch(request('source=usgs&limit=3'), env, options);
  assert.equal(response.status, 200); assert.equal((await response.json()).records.length, 3);
  assert.equal((await spatial.fetch(request('source=unknown'), env, options)).status, 404);
  assert.equal((await spatial.fetch(request('source=usgs&limit=101'), env, options)).status, 400);
});
