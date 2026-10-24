import test from 'node:test';
import assert from 'node:assert/strict';
import { movementHeading } from '../../js/travel/navigation-heading.mjs';

const fix = (coordinates, extra = {}) => ({ coordinates, timestamp:2000, accuracy:8, heading:null, speed:null, ...extra });
const previous = fix([0,0], { timestamp:1000, heading:270 });
test('moving GPS course takes priority and north is a valid heading', () => {
  assert.equal(movementHeading(fix([0,.001], { heading:0, speed:12 }), previous), 0);
  assert.equal(movementHeading(fix([0,.001], { heading:80, speed:12 }), previous), 80);
});
test('movement determines the course when the device has no heading', () => {
  assert.equal(movementHeading(fix([.001,0]), previous), 90);
  assert.equal(movementHeading(fix([0,.001]), previous), 0);
  assert.equal(movementHeading(fix([-.001,0]), previous), 270);
});
test('stationary noise, poor accuracy and stale fixes retain the last course', () => {
  assert.equal(movementHeading(fix([.00001,0]), previous), 270);
  assert.equal(movementHeading(fix([.001,0], { speed:0, heading:90 }), previous), 270);
  assert.equal(movementHeading(fix([.001,0], { accuracy:500, heading:90, speed:12 }), previous), 270);
  assert.equal(movementHeading(fix([.001,0], { timestamp:500 }), previous), 270);
  assert.equal(movementHeading(fix([.001,0], { timestamp:30000 }), previous), 270);
});
test('unknown first course stays unknown and movement across the date line stays east', () => {
  assert.equal(movementHeading(fix([0,0]), null), null);
  assert.equal(movementHeading(fix([-179.999,0]), fix([179.999,0], { timestamp:1000 })), 90);
});
