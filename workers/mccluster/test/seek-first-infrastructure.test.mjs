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
  assert.deepEqual(peering.optionalCredentialEnv, ['PEERINGDB_API_KEY']);
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
