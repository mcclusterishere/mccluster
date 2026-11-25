import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSpatialWorld, interiorWorld, isWalkable, moveWithCollisions, findWalkingPath, yardFixtures } from '../../js/fictional-city/spatial.mjs';

const shops = [-25, 23].flatMap(z => [-48, -16, 16, 48].map(x => ({ id: `${x}:${z}`, position: [x, z], size: [23, 19, 8], entrance: [x, z < 0 ? -14 : 12] })));
shops.push({ id: 'garage', position: [0, -52], size: [30, 12, 8], entrance: [0, -44] });
const world = createSpatialWorld(shops, { footprintMeters: [21.9456, 21.9456] });

test('authored doors have standing room; buildings, open water and land edges stop a walking body', () => {
  for (const b of shops) {
    assert.ok(isWalkable(...b.entrance, world), b.id + ' door is reachable');
    assert.equal(isWalkable(...b.position, world), false, b.id + ' is a solid exterior');
  }
  assert.ok(isWalkable(0, 60, world), 'bridge');
  assert.equal(isWalkable(10, 60, world), false, 'water beside the bridge');
  assert.equal(isWalkable(0, 88, world), false, 'HQ remains solid');
  assert.equal(isWalkable(71.9, 0, world), false, 'body cannot hang over the edge');
  assert.equal(isWalkable(NaN, 0, world), false);
});

test('bridge joins support the whole body across both shorelines', () => {
  for (let z = 43; z <= 73; z += .1) assert.ok(isWalkable(0, z, world), `supported at z=${z}`);
  const moved = moveWithCollisions({ x: 0, z: 43 }, 0, 31, world);
  assert.ok(Math.abs(moved.z - 74) < .001, 'large delta remains connected over the bridge');
});

test('movement cannot tunnel through a storefront and slides along its face', () => {
  const start = { x: -48, z: -14 };
  const direct = moveWithCollisions(start, 0, -30, world);
  assert.ok(direct.z > -15.5, 'front wall blocks a large step');
  const slide = moveWithCollisions(start, 5, -5, world);
  assert.ok(slide.x > start.x + 4.9, 'horizontal component survives the collision');
  assert.ok(isWalkable(slide.x, slide.z, world));
});

function assertPathSafe(path, field) {
  assert.ok(path.length > 1, 'a path exists');
  for (let i = 0; i < path.length; i++) {
    const p = path[i]; assert.ok(isWalkable(p.x, p.z, field), `walkable ${JSON.stringify(p)}`);
    if (!i) continue;
    const a = path[i - 1];
    for (let t = 0; t <= 1; t += .1) assert.ok(isWalkable(a.x + (p.x - a.x) * t, a.z + (p.z - a.z) * t, field), 'no diagonal corner clipping');
  }
}

test('a tap route to the island crosses the bridge rather than the water', () => {
  const path = findWalkingPath({ x: -30, z: 40 }, { x: -15, z: 90 }, world);
  assertPathSafe(path, world);
  assert.ok(path.some(p => p.z === 60 && Math.abs(p.x) < 4.6), 'uses the bridge');
});

test('a tap behind a shop takes a real street/sidewalk detour', () => {
  const path = findWalkingPath({ x: -48, z: 0 }, { x: -48, z: -42 }, world);
  assertPathSafe(path, world);
  assert.ok(path.some(p => Math.abs(p.x + 48) >= 12), 'goes around the storefront');
});

test('interior counters are solid and staff can be approached around the counter', () => {
  const room = interiorWorld();
  assert.equal(isWalkable(0, -2.4, room), false);
  assert.ok(isWalkable(0, 3.3, room));
  assertPathSafe(findWalkingPath({ x: 0, z: 3.3 }, { x: 0, z: -4.2 }, room), room);
  const garage = interiorWorld(true);
  assert.equal(isWalkable(-6.5, -2.8, garage), false, 'work van');
  assert.ok(isWalkable(0, 3, garage), 'garage floor');
});

const manifest = JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json', import.meta.url), 'utf8'));
const neighborhoodPlaces = (manifest.neighborhoods || []).flatMap(n => n.places || []);
const storyBeats = (manifest.storyArcs || []).flatMap(a => a.beats || []);
const expanded = createSpatialWorld([...manifest.businesses, manifest.garage, ...neighborhoodPlaces],
  manifest.district.island.hq, (manifest.neighborhoods || []).flatMap(n => n.surfaces || []), storyBeats);
const start = { x: manifest.district.spawn[0], z: manifest.district.spawn[1] };

test('every Bridgeport door has a continuous walking route from the original city spawn', () => {
  assert.equal(neighborhoodPlaces.filter(b => b.footprint).length, 16, 'actual source building count');
  for (const place of neighborhoodPlaces) {
    const goal = { x: place.entrance[0], z: place.entrance[1] };
    assert.ok(isWalkable(goal.x, goal.z, expanded), place.id + ' has a clear entrance');
    const path = findWalkingPath(start, goal, expanded);
    assert.ok(path.length, place.id + ' is reachable within the bounded search');
    assertPathSafe(path, expanded);
  }
  assert.equal(isWalkable(10, 60, expanded), false, 'expansion does not fill the original harbor');
  assert.equal(isWalkable(0, 88, expanded), false, 'HQ remains a solid exterior');
});

test('the thirteen story stops can be walked in order, with a route back to the original island', () => {
  assert.equal(storyBeats.length, 13);
  let from = start;
  for (const beat of storyBeats) {
    const goal = { x: beat.position[0], z: beat.position[1] };
    assert.ok(isWalkable(goal.x, goal.z, expanded), beat.id + ' marker has standing room');
    const path = findWalkingPath(from, goal, expanded);
    assert.ok(path.length, beat.id + ' can be walked from the preceding scene');
    assertPathSafe(path, expanded); from = goal;
  }
  assertPathSafe(findWalkingPath(from, { x: 0, z: 74 }, expanded), expanded);
  assert.deepEqual(findWalkingPath(start, { x: 0, z: 74 }, expanded, 1), [], 'explicit search limit remains enforced');
});

test('polygon collision preserves concave gaps and courtyards while keeping a body off wall edges', () => {
  const polygon = { id: 'corner', position: [4, 4], size: [8, 8, 10], footprint: [[0, 0], [8, 0], [8, 3], [3, 3], [3, 8], [0, 8]] };
  const concave = createSpatialWorld([polygon]);
  assert.equal(isWalkable(1, 1, concave), false, 'inside the actual building');
  assert.ok(isWalkable(6, 6, concave), 'the empty notch is not replaced by a rectangular blocker');
  assert.equal(isWalkable(3.2, 4, concave), false, 'body intersects an inner corner wall');
  const courtyard = createSpatialWorld([{ ...polygon, footprint: [[-8, -8], [8, -8], [8, 8], [-8, 8]],
    footprintHoles: [[[-2, -2], [-2, 2], [2, 2], [2, -2]]] }]);
  assert.ok(isWalkable(0, 0, courtyard), 'courtyard remains open');
  assert.equal(isWalkable(1.8, 0, courtyard), false, 'courtyard wall still stops a walking body');
  assert.equal(isWalkable(5, 0, courtyard), false, 'occupied building around the courtyard stays solid');
});

test('story interiors have reachable narrative positions and solid scene-specific furniture', () => {
  for (const style of ['industrial', 'walkup', 'laundromat', 'chapel']) {
    const room = interiorWorld(false, style), entry = { x: 0, z: room.depth / 2 - 2.2 };
    assert.ok(room.fixtures.length, style + ' uses its own interior program');
    assertPathSafe(findWalkingPath(entry, room.storyPoint, room), room);
    for (const fixture of room.fixtures) assert.equal(isWalkable(fixture.x, fixture.z, room), false, style + ': ' + fixture.id);
  }
});

test('the donation bin, dice table and parked vehicles have solid footprints without obstructing their story markers', () => {
  const bin = storyBeats.find(b => b.prop === 'donation-bin');
  assert.ok(bin?.propPosition);
  assert.equal(isWalkable(...bin.propPosition, expanded), false, 'donation bin is a physical prop');
  assert.ok(isWalkable(...bin.position, expanded), 'reader stands clear of the bin');
  for (const place of neighborhoodPlaces.filter(b => b.style === 'yard')) {
    assert.ok(isWalkable(...place.entrance, expanded), place.id + ' entrance');
    for (const fixture of yardFixtures(place)) assert.equal(isWalkable(fixture.x, fixture.z, expanded), false, fixture.id);
  }
});
