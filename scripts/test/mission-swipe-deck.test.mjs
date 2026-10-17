import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { createState, gesture, category, brief } = require('../../js/mission-swipe-deck.js');
const mission = (id, discovery_category = 'help', extra = {}) => ({ id, title: id, status: 'open', kind: 'civic', discovery_category, ...extra });

test('only distinct currently open civic missions enter the deck', () => {
  const deck = createState();
  deck.update([mission('a'), mission('a'), mission('paused', 'help', { status: 'paused' }), mission('draft', 'create', { status: 'draft' }), mission('completed', 'create', { status: 'completed' }), mission('clip', 'earn', { kind: 'clip' }), { id: 'unverified-status' }]);
  assert.deepEqual(deck.available().map(x => x.id), ['a']);
});

test('passing, undoing, and resetting cannot reverse a confirmed acceptance', () => {
  const deck = createState(); deck.update([mission('a'), mission('b'), mission('c')]);
  assert.equal(deck.pass().id, 'a');
  assert.equal(deck.current().id, 'b');
  deck.accept('b');
  assert.equal(deck.current().id, 'c');
  assert.equal(deck.undo().id, 'a');
  assert.equal(deck.current().id, 'a');
  deck.pass(); deck.resetPasses();
  assert.deepEqual(deck.available().map(x => x.id), ['a', 'c']);
});

test('refresh preserves passes and acceptance while withdrawing unavailable missions', () => {
  const deck = createState(); deck.update([mission('a'), mission('b'), mission('c')]);
  deck.pass(); deck.accept('b');
  deck.update([mission('a', 'help', { status: 'paused' }), mission('b'), mission('d')]);
  assert.equal(deck.canUndo(), false);
  assert.equal(deck.undo(), null);
  assert.deepEqual(deck.available().map(x => x.id), ['d']);
});

test('categories use explicit data and never infer money from points', () => {
  const deck = createState(); deck.update([mission('song', 'create'), mission('ride'), mission('research', '', { domain: 'research', base_points: 1000 })]);
  deck.selectCategory('create'); assert.equal(deck.current().id, 'song');
  deck.selectCategory('earn'); assert.equal(deck.current(), null);
  deck.selectCategory('all'); assert.equal(deck.available().length, 3);
  assert.equal(category({ domain: 'research', base_points: 1000 }), '');
  assert.equal(category({ discovery_category: 'create', domain: 'research' }), 'create');
});

test('vertical and short gestures do not decide a mission', () => {
  assert.equal(gesture(-95, 4, 320), 'pass');
  assert.equal(gesture(95, 4, 320), 'accept');
  assert.equal(gesture(50, 2, 320), null);
  assert.equal(gesture(95, 120, 320), null);
  assert.equal(gesture(-95, 90, 320), null);
});

test('card brief stays bounded and ends on a word while leaving the full instructions intact', () => {
  const instructions = 'Choose one issue in your neighborhood. '.repeat(12);
  const excerpt = brief(instructions);
  assert.ok(excerpt.length <= 220);
  assert.ok(excerpt.endsWith('…'));
  assert.ok(instructions.startsWith(excerpt.slice(0, -1)));
  assert.equal(instructions[excerpt.length - 1], ' ', 'the excerpt stops before a word boundary');
  assert.equal(brief('A short mission.\nTwo steps.'), 'A short mission. Two steps.');
});

test('World mode gestures exclude the mission deck and static shell loads its assets', () => {
  const page = readFileSync(new URL('../../mnet.html', import.meta.url), 'utf8');
  const travel = readFileSync(new URL('../../js/travel/world-travel.mjs', import.meta.url), 'utf8');
  assert.ok(page.indexOf('js/mission-swipe-deck.js') < page.indexOf('js/mnet.js'));
  assert.match(page, /css\/mission-swipe-deck\.css/);
  assert.match(travel, /closest\('[^']*\[data-mission-deck\]/);
  assert.match(travel, /mcc:world-mode/);
});
