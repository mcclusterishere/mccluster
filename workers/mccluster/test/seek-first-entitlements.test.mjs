import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assertConsumable,
  defaultEntitlement,
  effectiveEntitlement,
  LANES,
  normalizeLane
} from '../src/seek-first/entitlements.js';
import { sourceByKey } from '../src/seek-first/source-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

function decide(sourceKey, lane, row) {
  const entitlement = effectiveEntitlement(sourceByKey(sourceKey), row);
  try {
    assertConsumable(entitlement, lane);
    return { allowed: true, entitlement };
  } catch (error) {
    return { allowed: false, code: error.code, entitlement };
  }
}

test('open data is consumable on every lane', () => {
  for (const lane of Object.values(LANES)) {
    assert.equal(decide('usgs', lane).allowed, true, `usgs on ${lane}`);
    assert.equal(decide('usaspending', lane).allowed, true, `usaspending on ${lane}`);
  }
});

/*
  The failure this firewall exists to prevent: Planet's education-and-research
  imagery quietly becoming a dependency of a commercial Whip build because the
  same owner holds both projects.
*/
test('academic imagery is refused to a commercial consumer', () => {
  const commercial = decide('planet_research', LANES.COMMERCIAL);
  assert.equal(commercial.allowed, false);
  assert.equal(commercial.code, 'entitlement_lane_denied');
  assert.equal(commercial.entitlement.source_class, 'ACADEMIC');
  assert.equal(commercial.entitlement.commercial_use, false);

  assert.equal(decide('planet_research', LANES.ACADEMIC).allowed, true);
  assert.equal(decide('planet_research', LANES.INTERNAL).allowed, true);
  assert.equal(decide('opensky_research', LANES.COMMERCIAL).allowed, false);
});

test('commercial providers are refused to the public-open and academic lanes', () => {
  assert.equal(decide('tomtom', LANES.PUBLIC_OPEN).allowed, false);
  assert.equal(decide('tomtom', LANES.ACADEMIC).allowed, false);
  assert.equal(decide('tomtom', LANES.COMMERCIAL).allowed, true);
  assert.equal(decide('tomtom', LANES.INTERNAL).allowed, true);
});

test('an org entitlement can withdraw a permission but cannot invent retention', () => {
  const disabled = decide('usgs', LANES.INTERNAL, { enabled: false, lane: 'OPEN' });
  assert.equal(disabled.allowed, false);
  assert.equal(disabled.code, 'entitlement_disabled');

  const expired = decide('usgs', LANES.INTERNAL, {
    enabled: true, lane: 'OPEN', expires_at: '2020-01-01T00:00:00Z'
  });
  assert.equal(expired.allowed, false);
  assert.equal(expired.code, 'entitlement_expired');

  // google_maps is persistence 'none' in the registry. A row claiming
  // persistence_allowed must not be able to turn that on.
  const forced = effectiveEntitlement(sourceByKey('google_maps'), {
    enabled: true, lane: 'COMMERCIAL_OR_NONPROFIT', persistence_allowed: true, commercial_use: true
  });
  assert.equal(forced.persistence_allowed, false);
});

test('registry defaults never grant redistribution and mark attribution debts', () => {
  for (const key of ['usgs', 'overpass', 'celestrak', 'open_meteo', 'tomtom', 'planet_research']) {
    const entitlement = defaultEntitlement(sourceByKey(key));
    assert.equal(entitlement.redistribution, false, `${key} must not default to redistributable`);
    const source = sourceByKey(key);
    assert.equal(entitlement.attribution_required, Boolean(source.attribution), key);
  }
  assert.equal(defaultEntitlement(sourceByKey('google_maps')).persistence_allowed, false);
  assert.equal(defaultEntitlement(sourceByKey('cesium_ion')).persistence_allowed, false);
  assert.equal(defaultEntitlement(sourceByKey('aisstream')).persistence_allowed, false);
});

test('an unknown lane is rejected rather than silently downgraded', () => {
  assert.throws(() => normalizeLane('MARKETING'), (error) => error.code === 'invalid_lane');
  assert.equal(normalizeLane(undefined), LANES.INTERNAL);
  assert.equal(normalizeLane('commercial'), LANES.COMMERCIAL);
});

test('the entitlement decision is threaded into persistence, and force cannot override it', async () => {
  const store = await readFile(resolve(here, '..', 'src', 'seek-first', 'store.js'), 'utf8');
  assert.match(store, /entitlement\.persistence_allowed === false/);
  const forceIndex = store.indexOf("source.persistence === PERSISTENCE.TRANSIENT && !force");
  const entitlementIndex = store.indexOf('entitlement.persistence_allowed === false');
  assert.ok(forceIndex >= 0 && entitlementIndex > forceIndex,
    'the entitlement veto must be evaluated after, and independently of, the transient force flag');
});

test('the entity history migration keeps evidence instead of overwriting it', async () => {
  const sql = await readFile(
    resolve(repoRoot, 'supabase', 'migrations', '20260909040000_spatial_entity_history.sql'), 'utf8');
  assert.match(sql, /create table if not exists public\.seek_first_entity_revisions/i);
  assert.match(sql, /after insert or update on public\.seek_first_entities/i);
  assert.match(sql, /create or replace function public\.seek_first_timeline/i);
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /revoke all on table public\.seek_first_entity_revisions from anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.seek_first_timeline\([^)]*\) to service_role/i);
  // A re-ingest that changes nothing must not manufacture a revision.
  assert.match(sql, /is not distinct from old\.properties/i);
  // Geometry comparison must not use the ambiguous bare operator.
  assert.match(sql, /st_asewkb\(new\.footprint\)/i);
});
