import assert from 'node:assert/strict';
import test from 'node:test';

import { executeAdapter } from '../src/seek-first/adapters.js';
import { sourceByKey } from '../src/seek-first/source-registry.js';

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); }
  finally { globalThis.fetch = original; }
}

test('network source registry exposes keyless PeeringDB and RIPE Atlas lanes', () => {
  const peering = sourceByKey('peeringdb');
  assert.equal(peering.lane, 'NONPROFIT');
  assert.equal(peering.credentialEnv.length, 0);
  assert.equal(peering.persistence, 'transient');

  const ripe = sourceByKey('ripe_atlas');
  assert.equal(ripe.lane, 'ACADEMIC');
  assert.equal(ripe.credentialEnv.length, 0);
  assert.equal(ripe.persistence, 'transient');
});

test('PeeringDB adapter turns viewport facilities into network entities', async () => {
  let requested = '';
  const result = await withFetch(async (input) => {
    requested = String(input);
    return new Response(JSON.stringify({
      data: [{
        id: 42,
        name: 'Example IX Facility',
        latitude: 41.30,
        longitude: -72.92,
        city: 'New Haven',
        state: 'CT',
        country: 'US',
        net_count: 17,
        ix_count: 2,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, () => executeAdapter('peeringdb', {
    bbox: '-73.2,41.1,-72.7,41.5',
    limit: 250,
  }, {}));

  assert.match(requested, /^https:\/\/www\.peeringdb\.com\/api\/fac\?/);
  assert.match(requested, /latitude__gte=41\.1/);
  assert.equal(result.source, 'peeringdb');
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].point, { lat: 41.3, lon: -72.92 });
  assert.equal(result.records[0].entity_type, 'internet_facility');
  assert.equal(result.records[0].properties.geo_method, 'facility_address_geocode');
});

test('RIPE Atlas adapter exposes public connected probes without claiming exact location', async () => {
  let requested = '';
  const result = await withFetch(async (input) => {
    requested = String(input);
    return new Response(JSON.stringify({
      results: [{
        id: 9001,
        latitude: 41.31,
        longitude: -72.93,
        is_anchor: false,
        asn_v4: 64500,
        country_code: 'US',
        status: { id: 1, name: 'Connected' },
        tags: [],
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, () => executeAdapter('ripe_atlas', {
    bbox: '-73.2,41.1,-72.7,41.5',
    limit: 250,
    connected_only: true,
  }, {}));

  assert.match(requested, /^https:\/\/atlas\.ripe\.net\/api\/v2\/probes\//);
  assert.match(requested, /is_public=true/);
  assert.match(requested, /status=1/);
  assert.equal(result.records[0].entity_type, 'ripe_atlas_probe');
  assert.equal(result.records[0].properties.geo_method, 'privacy_obfuscated');
  assert.equal(result.records[0].properties.geo_precision_m, null);
});

test('network viewport adapters reject world-scale unbounded queries', async () => {
  await assert.rejects(
    executeAdapter('peeringdb', { bbox: '-180,-90,180,90' }, {}),
    /span exceeds 30 degrees/,
  );
});
