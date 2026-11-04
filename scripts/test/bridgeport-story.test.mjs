import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialState, sanitizeState, completeStoryBeat, storyProgress, atStoryBeat, purchase, recordVisit } from '../../js/fictional-city/state.mjs';
import { cityPlaces, citySurfaces, validateCityExtensions, neighborhoodAt } from '../../js/fictional-city/content.mjs';
import { createSpatialWorld, isWalkable } from '../../js/fictional-city/spatial.mjs';

const city = JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json', import.meta.url), 'utf8'));
const area = city.neighborhoods.find(n => n.id === 'bridgeport-robbery-1s');
const arc = city.storyArcs.find(a => a.id === 'robbery-1s');

test('Bridgeport extends the original city with actual sourced footprints and a separate cast', () => {
  assert.equal(validateCityExtensions(city), true);
  assert.equal(city.businesses.length, 8); assert.equal(city.npcs.length, 24); assert.equal(city.garageCrew.length, 3);
  assert.equal(city.businesses.find(b => b.id === 'pressure-tv').color, '#5e8c5a');
  assert.equal(city.businesses.find(b => b.id === 'robbery-1s').name, 'Robbery 1s Exchange');
  assert.deepEqual(city.district.island.center, [0, 88]);
  assert.equal(area.places.filter(p => p.footprint).length, 16);
  assert.equal(area.places.filter(p => p.storyArcId).length, 9);
  assert.ok(area.bounds.maxZ <= city.district.bounds.minZ);
  assert.equal(new Set(cityPlaces(city).map(p => p.id)).size, cityPlaces(city).length);
  const roads = new Set(area.roads.map(r => r.name));
  for (const name of ['Main Street', 'Middle Street', 'Fairfield Avenue', 'Golden Hill Street', 'Broad Street', 'Elm Street']) assert.ok(roads.has(name), name);
  assert.equal(arc.series, 'Designer Kicks'); assert.equal(arc.title, 'The Robbery 1s');
  assert.deepEqual([...new Set(arc.beats.map(b => b.act))], [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(arc.beats.length, 13);
});

test('story progression requires the current scene and preserves the existing economy and Whip reader', () => {
  let state = purchase(initialState(city), city.items[0].id, city, 123).state;
  state.story.chapter = 'test-drive';
  const economy = { credits: state.credits, inventory: state.inventory, receipts: state.receipts };
  assert.equal(completeStoryBeat(state, arc.beats.at(-1).id, city).reason, 'out-of-order');
  assert.equal(completeStoryBeat(state, arc.beats[0].id, city).reason, 'visit-location');
  for (const beat of arc.beats) {
    state.position = { x: beat.position[0], z: beat.position[1], interior: null };
    state = recordVisit(state, beat.placeId, city);
    const result = completeStoryBeat(state, beat.id, city);
    assert.ok(result.ok, beat.id); state = result.state;
    assert.deepEqual(sanitizeState(state, city), state, 'reload after ' + beat.id);
  }
  assert.equal(storyProgress(state, arc).finished, true);
  assert.equal(completeStoryBeat(state, arc.beats.at(-1).id, city).unchanged, true);
  assert.deepEqual({ credits: state.credits, inventory: state.inventory, receipts: state.receipts }, economy);
  assert.equal(state.story.chapter, 'test-drive');
});

test('all 16 geographic footprint rings match public source coordinates without rescaling or substitutions', async () => {
  const evidence = JSON.parse(await readFile(new URL('../../docs/fictional-city/geography/bridgeport-footprints-2023.geojson', import.meta.url), 'utf8'));
  const mapped = area.places.filter(p => p.footprint);
  assert.equal(evidence.features.length, mapped.length);
  const sx = 111320 * Math.cos(41.1798 * Math.PI / 180);
  for (const feature of evidence.features) {
    const place = mapped.find(p => Number(p.sourceFootprintId) === Number(feature.properties.OBJECTID));
    assert.ok(place, 'retained footprint ' + feature.properties.OBJECTID);
    const expected = feature.geometry.coordinates[0].map(([lon, lat]) => [
      Number(((lon + 73.1903) * sx).toFixed(4)), Number((-(lat - 41.1798) * 111320 - 220).toFixed(4))
    ]);
    assert.deepEqual(place.footprint, expected, place.id);
  }
});

test('donation-bin custody requires the exterior bin, while designated interior scenes work indoors', () => {
  const bin = arc.beats.find(b => b.prop === 'donation-bin');
  let state = initialState(city); state.position = { x: 0, z: 2, interior: bin.placeId };
  assert.equal(atStoryBeat(state, bin), false);
  state.position = { x: bin.position[0], z: bin.position[1], interior: null };
  assert.equal(atStoryBeat(state, bin), true);
  const finale = arc.beats.at(-1);
  assert.equal(finale.allowInterior, true);
  state.position = { x: 0, z: -2.6, interior: finale.placeId };
  assert.equal(atStoryBeat(state, finale), true);
});

test('existing saves survive extension and corrupt story progress cannot jump ahead', () => {
  const old = initialState(city); delete old.arcs;
  old.credits = 127; old.inventory = { [city.items[0].id]: 2 }; old.story.chapter = 'test-drive';
  const migrated = sanitizeState(old, city);
  assert.equal(migrated.credits, 127); assert.deepEqual(migrated.inventory, old.inventory); assert.deepEqual(migrated.arcs, {});
  const corrupt = { ...migrated, arcs: { [arc.id]: { completed: [arc.beats[0].id, arc.beats[2].id, 'forged'] }, unknown: { completed: ['forged'] } } };
  assert.deepEqual(sanitizeState(corrupt, city).arcs, { [arc.id]: { completed: [arc.beats[0].id] } });
  assert.equal(completeStoryBeat(migrated, 'unknown', city).reason, 'unknown-beat');
});

test('new saved exterior and interior locations persist beyond the old northern clamp', () => {
  const p = area.places.find(p => p.storyArcId && p.style !== 'yard');
  const state = initialState(city);
  state.position = { x: p.entrance[0], z: p.entrance[1], interior: null };
  assert.ok(state.position.z < -70);
  assert.deepEqual(sanitizeState(state, city).position, state.position);
  assert.equal(neighborhoodAt(city, state.position).id, area.id);
  state.position = { x: 0, z: 2, interior: p.id };
  assert.deepEqual(sanitizeState(state, city).position, state.position);
  assert.equal(neighborhoodAt(city, state.position).id, area.id);
});

test('story props and sourced footprint interiors remain solid while the current scene is reachable', () => {
  const world = createSpatialWorld(cityPlaces(city), city.district.island.hq, citySurfaces(city), arc.beats);
  for (const beat of arc.beats) assert.ok(isWalkable(...beat.position, world), beat.id);
  const bin = arc.beats.find(b => b.prop === 'donation-bin');
  assert.ok(Array.isArray(bin.propPosition));
  assert.equal(isWalkable(...bin.propPosition, world), false);
  assert.ok(Math.hypot(bin.position[0] - bin.propPosition[0], bin.position[1] - bin.propPosition[1]) > 1);
});

test('malformed extension IDs, geometry and story references fail validation', () => {
  for (const change of [
    c => { c.neighborhoods[0].places[0].id = c.businesses[0].id; },
    c => { c.neighborhoods[0].places[0].footprint[0][0] = Infinity; },
    c => { c.storyArcs[0].beats[0].placeId = 'missing'; },
    c => { c.storyArcs[0].beats[1].id = c.storyArcs[0].beats[0].id; }
  ]) { const broken = structuredClone(city); change(broken); assert.throws(() => validateCityExtensions(broken)); }
});

test('government identities stay intact and the story crew uses its owner-selected nearby street name', async () => {
  const evidence = JSON.parse(await readFile(new URL('../../docs/fictional-city/geography/bridgeport-government-classification.json', import.meta.url), 'utf8'));
  const protectedPlaces = area.places.filter(p => p.publicIdentity?.kind === 'government');
  assert.equal(protectedPlaces.length, 2);
  assert.deepEqual(protectedPlaces.map(p => p.sourceFootprintId).sort((a, b) => a - b), [279819, 283267]);
  for (const place of protectedPlaces) {
    assert.equal(place.name, place.publicIdentity.officialName);
    assert.equal(place.publicIdentity.publicFunction, 'Superior Court');
    assert.equal(place.enterable, false);
    assert.equal(place.storyArcId, undefined);
    assert.equal(arc.beats.some(b => b.placeId === place.id), false);
    assert.equal(evidence.records.find(r => r.sourceFootprintId === place.sourceFootprintId).ownershipClassification, 'government');
    const renamed = structuredClone(city);
    renamed.neighborhoods[0].places.find(p => p.id === place.id).name = 'Invented Shop';
    assert.throws(() => validateCityExtensions(renamed), /government identity/);
    const unprotected = structuredClone(city);
    delete unprotected.neighborhoods[0].places.find(p => p.id === place.id).publicIdentity;
    assert.throws(() => validateCityExtensions(unprotected), /government identity/);
  }
  const works = area.places.find(p => p.id === 'bridgeport-ashline-works');
  assert.equal(works.sourceFootprintId, 250867);
  assert.deepEqual(arc.beats[0].position, works.entrance);
  for (const place of area.places) {
    const record = place.footprint && evidence.records.find(r => r.sourceFootprintId === place.sourceFootprintId);
    if (record) assert.equal(place.sourceParcel.parcelId, record.parcelId);
    if (place.storyArcId) assert.ok(place.sourceParcel.ownershipClassification.startsWith('private'), place.id);
  }
  // Owner, 2026-11-03 (final): one Willy Whackers gang, the School of Hard Knocks kids in the wider-city lore.
  // Mr. GREAT and Harold's crew stays unnamed; the withdrawn Elm Street label must not return to this story.
  assert.equal(arc.factions, undefined);
  assert.doesNotMatch(JSON.stringify([city.neighborhoods, city.storyArcs]), /Willy Whackers/);
});
