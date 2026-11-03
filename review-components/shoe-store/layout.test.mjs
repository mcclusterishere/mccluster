import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoreLayout, storeFloor, transitionStoreFloor, COLLECTION_LABELS } from './layout.mjs';
import { buildStoreFloorModel } from './model.mjs';
import { isWalkable, findWalkingPath, moveWithCollisions } from '../../js/fictional-city/spatial.mjs';

test('thirteen owner labels are configurable without claiming designs, crime rankings, or purchases', () => {
  const layout = createStoreLayout(); assert.equal(layout.collection.length, 13);
  for (const slot of layout.collection) {
    assert.equal(slot.status, 'pending-design-and-integration'); assert.equal(slot.price, null);
    assert.equal(slot.city, COLLECTION_LABELS[slot.number - 1].city); assert.equal(slot.name, COLLECTION_LABELS[slot.number - 1].name); assert.equal(slot.offense, null); assert.equal(slot.shoeModel, null);
    assert.equal(slot.power, null); assert.equal(slot.purchasable, false);
  }
  assert.equal(createStoreLayout({ collectionSlots: 12 }).collection.length, 12);
  assert.equal(COLLECTION_LABELS[0].name, 'Robbery 1s');
  assert.equal(COLLECTION_LABELS[10].name, 'Repo Elevens');
  assert.equal(createStoreLayout({ collectionSlots: 14 }).collection[13].name, null);
  layout.collection[0].name = 'Do not mutate shared labels';
  assert.equal(createStoreLayout().collection[0].name, 'Robbery 1s');
  for (const n of [0, 25, 1.5, NaN]) assert.throws(() => createStoreLayout({ collectionSlots: n }));
});
test('every floor target is walkable and reachable from its arrival', () => {
  for (const f of createStoreLayout().floors) {
    const arrival = f.targets[0];
    for (const target of f.targets) {
      assert.ok(isWalkable(target.x, target.z, f), `${f.id}:${target.id} standing room`);
      assert.ok(findWalkingPath(arrival, target, f).length, `${f.id}:${target.id} route`);
    }
    for (const fixture of f.fixtures) assert.equal(isWalkable(fixture.x, fixture.z, f), false, fixture.id);
    const stopped = moveWithCollisions(arrival, 40, 40, f);
    assert.ok(isWalkable(stopped.x, stopped.z, f));
  }
});
test('stairs are reciprocal, proximity checked, immutable, and preserve city state', () => {
  const layout = createStoreLayout();
  const p = { interior: 'designer-kicks', floor: 'retail', x: 6.3, z: -5.2 };
  const down = transitionStoreFloor(layout, p, 'factory-stair'); assert.ok(down.ok);
  assert.equal(p.floor, 'retail'); assert.equal(down.position.floor, 'factory');
  assert.equal(down.position.interior, p.interior);
  const up = transitionStoreFloor(layout, down.position, 'showroom-stair'); assert.ok(up.ok); assert.deepEqual(up.position, p);
  assert.equal(transitionStoreFloor(layout, { ...p, x: 0, z: 5 }, 'factory-stair').reason, 'approach-stairs');
  assert.equal(transitionStoreFloor(layout, p, 'showroom-stair').ok, false);
  assert.equal(transitionStoreFloor(layout, { ...p, floor: 'roof' }, 'factory-stair').ok, false);
  assert.equal(storeFloor(layout, null).id, 'retail');
});
test('near and mobile models share collision and floor bounds with fewer decorations', () => {
  const layout = createStoreLayout();
  for (const f of layout.floors) {
    const counts = [];
    for (const detail of ['near', 'mobile']) {
      const records = [], batch = { add(...args) { records.push(args); } };
      const result = buildStoreFloorModel(layout, f.id, { batch, detail });
      assert.equal(result.layout, f); assert.equal(result.floorId, f.id); counts.push(records.length);
      for (const [shape, color, x, y, z, w, h, d] of records) {
        assert.ok(['box', 'cylinder'].includes(shape)); assert.match(color, /^#[a-f0-9]{6}$/i);
        for (const value of [x, y, z, w, h, d]) assert.ok(Number.isFinite(value));
        assert.ok(w > 0 && h > 0 && d > 0);
      }
    }
    assert.ok(counts[1] < counts[0]); assert.ok(counts[0] < 400);
  }
});
