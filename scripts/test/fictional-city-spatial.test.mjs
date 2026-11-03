import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpatialWorld, interiorWorld, isWalkable, moveWithCollisions, findWalkingPath } from '../../js/fictional-city/spatial.mjs';

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
