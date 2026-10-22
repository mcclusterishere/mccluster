import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertConsumable,
  defaultEntitlement,
  LANES,
} from '../src/seek-first/entitlements.js';
import { sourceByKey } from '../src/seek-first/source-registry.js';
import {
  INFRASTRUCTURE_SOURCE_KEYS,
  isInfrastructureSource,
  executeInfrastructureAdapter,
  InfrastructureAdapterError,
} from '../src/seek-first/infrastructure-adapters.js';

function allowed(sourceKey, lane) {
  try {
    assertConsumable(defaultEntitlement(sourceByKey(sourceKey)), lane);
    return true;
  } catch {
    return false;
  }
}

test('infrastructure sources are registered without replacing the existing provider gateway', () => {
  assert.deepEqual(INFRASTRUCTURE_SOURCE_KEYS, ['peeringdb', 'ripe_atlas']);
  assert.equal(isInfrastructureSource('peeringdb'), true);
  assert.equal(isInfrastructureSource('ripe_atlas'), true);
  assert.equal(isInfrastructureSource('overpass'), false);

  const peering = sourceByKey('peeringdb');
  assert.equal(peering.sourceClass, 'NONPROFIT');
  assert.equal(peering.persistence, 'transient');
  assert.ok(peering.capabilities.includes('internet-facilities'));

  const atlas = sourceByKey('ripe_atlas');
  assert.equal(atlas.sourceClass, 'ACADEMIC');
  assert.equal(atlas.persistence, 'transient');
  assert.ok(atlas.capabilities.includes('network-probes'));
});

test('PeeringDB cannot silently become a commercial dependency', () => {
  assert.equal(allowed('peeringdb', LANES.NONPROFIT), true);
  assert.equal(allowed('peeringdb', LANES.INTERNAL), true);
  assert.equal(allowed('peeringdb', LANES.COMMERCIAL), false);
  assert.equal(allowed('peeringdb', LANES.PUBLIC_OPEN), false);
});

test('RIPE Atlas stays inside the academic/research lane by default', () => {
  assert.equal(allowed('ripe_atlas', LANES.ACADEMIC), true);
  assert.equal(allowed('ripe_atlas', LANES.INTERNAL), true);
  assert.equal(allowed('ripe_atlas', LANES.COMMERCIAL), false);
  assert.equal(allowed('ripe_atlas', LANES.PUBLIC_OPEN), false);
});

test('infrastructure adapters reject missing or oversized viewports without network calls', async () => {
  for (const source of INFRASTRUCTURE_SOURCE_KEYS) {
    await assert.rejects(
      executeInfrastructureAdapter(source, {}),
      (error) => error instanceof InfrastructureAdapterError && error.code === 'bbox_required',
    );
    await assert.rejects(
      executeInfrastructureAdapter(source, { bbox: [-180, -90, 180, 90] }),
      (error) => error instanceof InfrastructureAdapterError && error.code === 'bbox_too_large',
    );
  }
});

test('PeeringDB normalizes bounded facilities with attribution and coordinate confidence', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const request = new URL(url);
    assert.equal(request.hostname, 'www.peeringdb.com');
    assert.equal(request.searchParams.get('latitude__gte'), '40');
    assert.equal(request.searchParams.get('longitude__lte'), '-70');
    return { ok: true, json: async () => ({ data: [
      { id: 123, name: 'Sample Facility', latitude: 41, longitude: -72, country: 'US', net_count: 8 },
      { id: 124, name: 'Unknown Location', latitude: null, longitude: null },
    ] }) };
  };
  const result = await executeInfrastructureAdapter('peeringdb', { bbox: [-75, 40, -70, 43] });
  assert.equal(result.source, 'peeringdb');
  assert.equal(result.persistence, 'transient');
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].point, { lat: 41, lon: -72 });
  assert.equal(result.records[0].properties.geo_method, 'provider_coordinate');
  assert.equal(result.records[0].properties.geo_confidence, 0.92);
  assert.match(result.records[0].source_url, /peeringdb/);
});

test('RIPE Atlas preserves privacy-obfuscated coordinate metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).searchParams.get('status'), '2');
    return { ok: true, json: async () => ({ results: [
      { id: 44, geometry: { coordinates: [-72, 41] }, status: { id: 1, name: 'Connected' }, is_anchor: false },
    ] }) };
  };
  const result = await executeInfrastructureAdapter('ripe_atlas', { bbox: [-75, 40, -70, 43] });
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].point, { lat: 41, lon: -72 });
  assert.equal(result.records[0].properties.geo_method, 'privacy_obfuscated');
  assert.equal(result.records[0].properties.geo_precision_m, 400);
  assert.match(result.coordinate_notice, /privacy-obfuscated/);
});

test('provider HTTP failures retain a structured upstream error', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    executeInfrastructureAdapter('peeringdb', { bbox: [-75, 40, -70, 43] }),
    (error) => error instanceof InfrastructureAdapterError && error.status === 429 && error.code === 'provider_error',
  );
});
