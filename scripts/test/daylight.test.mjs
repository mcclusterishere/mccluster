import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const core = createRequire(import.meta.url)('../../js/daylight.js');

// New Haven, Connecticut (41.31°N, 72.93°W). Published 2026-06-21 sunrise 05:18 EDT, sunset 20:29 EDT.
const NH = [41.31, -72.93];
test('solar elevation is high at summer noon, deep below the horizon at night', () => {
  const noon = core.solarElevation(new Date('2026-06-21T16:00:00Z'), ...NH); // 12:00 EDT
  assert.ok(noon > 66 && noon < 76, `noon elevation ${noon}`);
  const night = core.solarElevation(new Date('2026-06-21T07:00:00Z'), ...NH); // 03:00 EDT
  assert.ok(night < -15, `night elevation ${night}`);
});
test('the day/night switch brackets the published sunrise and sunset within a few minutes', () => {
  assert.equal(core.phase(core.solarElevation(new Date('2026-06-21T09:10:00Z'), ...NH), 'night'), 'night'); // 05:10 EDT
  assert.equal(core.phase(core.solarElevation(new Date('2026-06-21T09:30:00Z'), ...NH), 'night'), 'day');   // 05:30 EDT
  assert.equal(core.phase(core.solarElevation(new Date('2026-06-22T00:20:00Z'), ...NH), 'day'), 'day');     // 20:20 EDT
  assert.equal(core.phase(core.solarElevation(new Date('2026-06-22T01:00:00Z'), ...NH), 'day'), 'day');     // 21:00 EDT, civil twilight still counts as day
  assert.equal(core.phase(core.solarElevation(new Date('2026-06-22T01:20:00Z'), ...NH), 'day'), 'night');   // 21:20 EDT, past civil twilight
});
test('twilight keeps the previous answer so the theme does not flicker', () => {
  assert.equal(core.phase(-3, 'day'), 'day');
  assert.equal(core.phase(-3, 'night'), 'night');
  assert.equal(core.phase(-3, ''), 'night');
});
test('the time-zone fallback puts US Eastern near its meridian and clamps', () => {
  assert.equal(core.estimateLongitude(240), -60);
  assert.equal(core.estimateLongitude(-540), 135);
  assert.equal(core.estimateLongitude(-1000), 180);
});
test('the equator at the March equinox is lit at Greenwich noon and dark at midnight', () => {
  assert.equal(core.resolve(new Date('2026-03-20T12:00:00Z'), 0, 0, ''), 'day');
  assert.equal(core.resolve(new Date('2026-03-20T00:00:00Z'), 0, 0, ''), 'night');
});
