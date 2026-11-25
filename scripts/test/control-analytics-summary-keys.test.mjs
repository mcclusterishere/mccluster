import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../js/control-room/analytics-deck.js', import.meta.url), 'utf8');
function setup({ width = 362, content = 804, starts = [2, 272, 542] } = {}) {
  const moves = [];
  const rail = {
    clientWidth: width, scrollWidth: content, scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 12 }),
    scrollTo({ left, behavior }) { this.scrollLeft = Math.max(0, Math.min(content - width, left)); moves.push({ left: this.scrollLeft, behavior }); }
  };
  rail.children = starts.map(left => ({ getBoundingClientRect: () => ({ left: 12 + left - rail.scrollLeft }) }));
  const root = { querySelector: () => null, querySelectorAll: selector => selector === '.cu-summary-groups' ? [rail] : [] };
  const context = { window: { CR: {} }, document: {}, clearTimeout, setTimeout };
  vm.runInNewContext(source, context);
  const selected = [];
  context.window.CR.analyticsDeck.bind(root, { section: 'overview' }, section => selected.push(section), () => {});
  function key(key, overrides = {}) {
    const event = { key, target: rail, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
    rail.onkeydown?.(event);
    return event;
  }
  return { rail, moves, selected, key };
}

test('summary rail arrow keys advance whole cards and clamp repeated input without changing chapters', () => {
  const { rail, selected, key } = setup();
  assert.equal(key('ArrowRight').prevented, true);
  assert.equal(rail.scrollLeft, 272);
  key('ArrowRight'); assert.equal(rail.scrollLeft, 442);
  key('ArrowRight'); assert.equal(rail.scrollLeft, 442);
  key('ArrowLeft'); assert.equal(rail.scrollLeft, 272);
  key('ArrowLeft'); assert.equal(rail.scrollLeft, 2);
  key('ArrowLeft'); assert.equal(rail.scrollLeft, 0);
  assert.deepEqual(selected, []);
});

test('Home and End reach both edges with immediate movement and leave focus on the rail', () => {
  const { rail, moves, key } = setup();
  assert.equal(key('End').stopped, true); assert.equal(rail.scrollLeft, 442);
  key('Home'); assert.equal(rail.scrollLeft, 0);
  assert.ok(moves.every(move => move.behavior === 'instant'));
});

test('rail ignores nested controls, modifiers, and unrelated keys', () => {
  const { moves, key } = setup();
  for (const overrides of [{ target: {} }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    assert.equal(key('ArrowRight', overrides).prevented, false);
  }
  assert.equal(key('ArrowDown').prevented, false);
  assert.equal(moves.length, 0);
});

test('nonoverflowing desktop summary leaves native keyboard behavior alone', () => {
  const { moves, key } = setup({ width: 1000, content: 1000 });
  assert.equal(key('ArrowRight').prevented, false);
  assert.equal(key('End').prevented, false);
  assert.equal(moves.length, 0);
});

test('card targets use current geometry after a resize or manual pan', () => {
  const { rail, key } = setup({ width: 390, content: 950, starts: [2, 320, 638] });
  rail.scrollLeft = 180;
  key('ArrowRight'); assert.equal(rail.scrollLeft, 320);
  rail.clientWidth = 500;
  key('End'); assert.equal(rail.scrollLeft, 450);
  key('ArrowLeft'); assert.equal(rail.scrollLeft, 320);
});
