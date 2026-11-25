import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAVEL, createTravelControls } from '../../js/fictional-city/travel-controls.mjs';
import { createSpatialWorld, isWalkable, moveWithCollisions } from '../../js/fictional-city/spatial.mjs';

test('bike is an outdoor session mode with bounded acceleration and body clearance', () => {
  const travel = createTravelControls();
  assert.equal(travel.mode, 'walk');
  assert.equal(travel.setMode('bike', { interior: true }), false);
  assert.equal(travel.setMode('bike', { clear: () => false }), false);
  assert.equal(travel.setMode('jet'), false);
  assert.equal(travel.setMode('bike'), true);
  assert.equal(travel.radius, 1.08);
  assert.equal(travel.speedFor(1, .05), .275);
  let speed; for (let n = 0; n < 100; n++) speed = travel.speedFor(1, .05);
  assert.equal(speed, TRAVEL.bike.speed);
  assert.equal(travel.speedFor(0, .05), 0, 'release brakes immediately');
  assert.equal(travel.speedFor(1, Infinity), 0);
  assert.equal(travel.setMode('walk'), true); assert.equal(travel.radius, .43);
});
test('bike swept collision cannot cross thin walls or ride off the bridge into water', () => {
  const world = createSpatialWorld([{ id: 'thin-wall', position: [5, 0], size: [.12, 8] }]);
  const start = { x: 0, z: 0 }, next = moveWithCollisions(start, 20, 0, world, undefined, TRAVEL.bike.radius);
  assert.ok(next.x < 4); assert.equal(isWalkable(next.x, next.z, world, TRAVEL.bike.radius), true);
  const bridge = moveWithCollisions({ x: 0, z: 57 }, 20, 0, world, undefined, TRAVEL.bike.radius);
  assert.ok(bridge.x < 4); assert.equal(isWalkable(bridge.x, bridge.z, world, TRAVEL.bike.radius), true);
});
