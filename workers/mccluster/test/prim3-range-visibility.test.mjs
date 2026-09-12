import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');

async function text(path) {
  return readFile(path, 'utf8');
}

test('Training Range author CSS cannot override HTML hidden state', async () => {
  const css = await text(resolve(root, 'css', 'prim3-range.css'));
  assert.match(css, /\.prim3-range-page \[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test('Training Range gate action starts hidden and learner shell starts hidden', async () => {
  const html = await text(resolve(root, 'prim3-range.html'));
  assert.match(html, /id="rangeGateAction"[^>]*hidden/);
  assert.match(html, /id="rangeShell"[^>]*hidden/);
});

test('successful readiness compilation removes the gate before rendering the range', async () => {
  const source = await text(resolve(root, 'js', 'prim3-range.js'));
  const gateHide = source.indexOf('els.gate.hidden = true');
  const rangeShow = source.indexOf('els.range.hidden = false', gateHide);
  const briefing = source.indexOf('renderBriefing()', rangeShow);
  assert.ok(gateHide >= 0, 'success path must hide the mission gate');
  assert.ok(rangeShow > gateHide, 'success path must reveal the learner range after hiding the gate');
  assert.ok(briefing > rangeShow, 'briefing must render only after the visible state changes');
});
