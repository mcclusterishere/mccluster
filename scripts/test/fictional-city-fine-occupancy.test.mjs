import test from 'node:test';
import assert from 'node:assert/strict';
import { fineOccupancy } from '../../js/fictional-city/fine-occupancy.mjs';
import { interiorWorld, findWalkingPath, isWalkable } from '../../js/fictional-city/spatial.mjs';

test('2×2 samples preserve metric geometry, negative cells, and explicit per-level scales', () => {
  const world = interiorWorld(false, 'home'), before = JSON.stringify(world);
  const city = fineOccupancy(world, { coarseCellMeters: 3.54 });
  const hq = fineOccupancy(world, { coarseCellMeters: 3.6576 });
  assert.equal(city.cellMeters, 1.77); assert.equal(hq.cellMeters, 1.8288);
  assert.deepEqual(city.toCell(-.1, -.1), { x: -1, y: -1 });
  for (const x of [-2, -1, 0, 1]) for (const y of [-2, -1, 0, 1]) {
    const p = city.centre(x, y); assert.deepEqual(city.toCell(p.x, p.z), { x, y });
    assert.equal(city.open(x, y), isWalkable(p.x, p.z, world, .3));
  }
  assert.equal(JSON.stringify(world), before);
  assert.throws(() => fineOccupancy(world, { coarseCellMeters: 0 }));
  assert.throws(() => city.toCell(NaN, 0));
});

test('furniture collides in free walk and fine occupancy; doorway approach remains reachable', () => {
  const room = interiorWorld(false, 'home');
  const grid = fineOccupancy(room, { coarseCellMeters: 3.54 });
  const sofa = room.fixtures.find(f => f.id === 'sofa');
  assert.equal(isWalkable(sofa.x, sofa.z, room, .3), false);
  const cell = grid.toCell(sofa.x, sofa.z); assert.equal(grid.open(cell.x, cell.y), false);
  const entry = { x: 0, z: room.depth / 2 - 2.2 };
  assert.ok(findWalkingPath(entry, room.storyPoint, room).length > 0);
  assert.ok(findWalkingPath(room.storyPoint, { x: 0, z: room.depth / 2 - .65 }, room).length > 0);
});

test('fine-cell transitions cannot tunnel through thin furniture between open centres', () => {
  const room = { surfaces: [{ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }],
    blockers: [{ minX: 1.7, maxX: 1.8, minZ: -4, maxZ: 4 }] };
  const grid = fineOccupancy(room, { coarseCellMeters: 3.54 });
  assert.equal(grid.open(0, 0), true); assert.equal(grid.open(1, 0), true);
  assert.equal(grid.canStep({ x: 0, y: 0 }, { x: 1, y: 0 }), false);
  assert.equal(grid.canStep({ x: 0, y: 0 }, { x: 0, y: 1 }), true);
  assert.equal(grid.canStep({ x: 0, y: 0 }, { x: 1, y: 1 }), false);
});
