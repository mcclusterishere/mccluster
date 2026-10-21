/* THE HEAT SCALE (js/heat-scale.js), shared by the World's news heat map and the Control Room's Analytics globe. Owner,
   2026-10-21: the Analytics map was "lackluster, really lackluster, because the shading isn't dynamic enough", and the
   World's news should be "a heat map of how many articles or mentions it has" instead of pins.
   node --test scripts/test/heat-scale.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const H = createRequire(import.meta.url)(ROOT + 'js/heat-scale.js');

test('a lopsided spread still uses the whole ramp: half rank, half log size', () => {
  const values = [1, 2, 3, 5, 7, 8, 40, 1200];
  const level = H.levels(values), t = values.map(level);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], 'more is always hotter: ' + values[i]);
  assert.equal(t[0], H.LOW, 'the least is faint, never invisible');
  assert.ok(t[t.length - 1] > 0.95);
  assert.ok(t[4] > 0.35 && t[4] < 0.55, 'a middling place sits in the middle, not crushed to the bottom: ' + t[4]);
  /* the old shading, value ÷ max square-rooted on a 0.22..0.9 blend, put these seven within a tenth of each other */
  const old = values.slice(0, 7).map((v) => 0.22 + 0.68 * Math.sqrt(v / 1200));
  assert.ok(Math.max(...old) - Math.min(...old) < 0.11);
  assert.ok(t[6] - t[0] > 0.5);
});

test('ties share a level, nothing has none, one place alone is the hottest', () => {
  const level = H.levels([5, 5, 9, 0, -3, NaN]);
  assert.equal(level(5), level(5));
  assert.equal(level(0), null);
  assert.equal(level(undefined), null);
  assert.equal(level(4), null, 'a value not in the set has no level');
  assert.equal(H.levels([42])(42), 1);
  assert.equal(H.levels([])(1), null);
});

test('each ramp only gets lighter, dark (little) to bright (most), and the heat ramp grows more opaque', () => {
  const steps = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
  const L = steps.map((t) => H.lightness(H.at(H.HEAT, t)));
  for (let i = 1; i < L.length; i++) assert.ok(L[i] > L[i - 1], 'heat lightness rises at ' + steps[i]);
  assert.ok(L[L.length - 1] - L[0] > 0.45, 'a wide lightness range: ' + (L[L.length - 1] - L[0]).toFixed(2));
  const A = steps.map((t) => H.at(H.HEAT, t)[3]);
  for (let i = 1; i < A.length; i++) assert.ok(A[i] >= A[i - 1]);
  /* Analytics: one hue, from its land colour through its accent to a tint of it */
  const ramp = H.accentRamp(H.hexRgb('#3b3e44'), H.hexRgb('#e11d2e'), true);
  const LA = steps.map((t) => H.lightness(H.at(ramp, t)));
  for (let i = 1; i < LA.length; i++) assert.ok(LA[i] > LA[i - 1], 'accent ramp lightness rises at ' + steps[i]);
  assert.ok(steps.every((t) => H.at(ramp, t)[3] === 1), 'opaque on the analytics globe');
  assert.deepEqual(H.at(ramp, 0.5).slice(0, 3).map((v) => Math.round(v * 255)), [225, 29, 46], 'the middle is the accent itself');
});

test('the legend bar is the ramp itself, and the count reads as English', () => {
  assert.equal(H.gradient(), 'linear-gradient(90deg,rgba(140,26,62,1) 0%,rgba(191,42,60,1) 25%,rgba(232,86,46,1) 50%,rgba(248,161,47,1) 75%,rgba(255,226,122,1) 100%)');
  assert.equal(H.stories(1), '1 story');
  assert.equal(H.stories(0), '0 stories');
  assert.equal(H.stories(1234), '1,234 stories');
});

test('Analytics shades by the shared scale on its own accent; its legend bar is the same three stops', () => {
  const g = read('js/control-room/analytics-globe.js');
  assert.doesNotMatch(g, /0\.22\s*\+\s*0\.68\s*\*\s*Math\.sqrt/, 'the flat value ÷ max blend is gone');
  assert.match(g, /H\.accentRamp\(\[C\.land\.red, C\.land\.green, C\.land\.blue\], \[C\.accent\.red, C\.accent\.green, C\.accent\.blue\], true\)/);
  assert.match(g, /window\.HuHeat\.levels\(values\(\)\)/);
  const html = read('control.html');
  assert.ok(html.indexOf('js/heat-scale.js') > 0 && html.indexOf('js/heat-scale.js') < html.indexOf('js/control-room/analytics-globe.js'), 'loaded before the globe');
  const css = read('css/control-analytics-deck.css');
  assert.match(css, /\.cu-heat-legend i\{[^}]*linear-gradient\(90deg,color-mix\(in srgb,var\(--an-accent,#e11d2e\) 28%,var\(--an-land,#3b3e44\)\) 0%,var\(--an-accent,#e11d2e\) 50%,color-mix\(in srgb,var\(--an-accent,#e11d2e\) 38%,#fff\) 100%\)/);
  /* the accent rule holds: no hard-coded red on the analytics screen */
  assert.doesNotMatch(css, /#393b40/);
});

test('the World: no pin per story; the countries are shaded by the counts, and the globe page loads the scale', () => {
  const html = read('action-globe.html');
  assert.ok(html.indexOf('js/heat-scale.js') > 0 && html.indexOf('js/heat-scale.js') < html.indexOf('js/world-countries.js'));
  const globe = read('js/action-globe.js'), wc = read('js/world-countries.js');
  assert.match(globe, /fetch\(API\+'\/v1\/world\/news-heat',\{credentials:'omit'\}\)/);
  assert.match(globe, /heatCells:newsHeatCells/);
  assert.match(globe, /news-heat',\{credentials:'omit'\}\)[^\n]*\.catch\(\(\)=>\{if\(countries\)countries\.heat\(null\)\}\);/, 'a failed refresh clears the old counts');
  assert.match(wc, /if \(st\.heatFill\) st\.heatFill\.show = st\.lineAlpha > 0\.15;/, 'the heat shows while the borders do');
  assert.match(wc, /const hide = code === st\.selected && !!st\.stateHeat;/, 'a selected country steps aside for its states');
});
