import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function checker() {
  const src = await readFile(join(ROOT, 'js/name-integrity.js'), 'utf8');
  const window = {};
  vm.runInNewContext(src, { window, Set, String, RegExp });
  return window.MCC_NAME_INTEGRITY;
}

test('name integrity accepts ordinary international name shapes', async () => {
  const c = await checker();
  for (const pair of [
    ['Matthew', 'McCluster'],
    ['Anne-Marie', "O'Neill"],
    ['José', 'García'],
    ['Jean', 'de la Cruz']
  ]) assert.equal(c.validate(pair[0], pair[1]).ok, true, pair.join(' '));
});

test('name integrity rejects obvious garbage without pretending to verify identity', async () => {
  const c = await checker();
  for (const pair of [
    ['dog', 'chicken feet'],
    ['test', 'user'],
    ['asdf', 'qwerty'],
    ['John123', 'Smith'],
    ['aaaaaa', 'bbbbbb']
  ]) assert.equal(c.validate(pair[0], pair[1]).ok, false, pair.join(' '));
});

test('account intake source names the screen as plausibility screening, not ID verification', async () => {
  const src = await readFile(join(ROOT, 'js/name-integrity.js'), 'utf8');
  assert.match(src, /NOT government-ID\s*verification/i);
});
