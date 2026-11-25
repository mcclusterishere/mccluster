const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('./rules.js');

test('preview paths avoid obstacles and occupied cells, including a required detour', () => {
  const state = rules.createState();
  const e = state.units.find(u => u.id === 'E');
  assert.equal(rules.reachable(state, 'E').get('3,3').length - 1, 3);
  e.x = 3; e.y = 2;
  const path = rules.reachable(state, 'E').get('5,2');
  assert.equal(path.length - 1, 4, 'the blocked direct line requires four steps, not Manhattan distance two');
  for (let i = 0; i < path.length; i++) {
    assert.ok(!state.blocked.has(rules.key(path[i].x, path[i].y)));
    assert.ok(!state.units.some(u => u.id !== 'E' && u.x === path[i].x && u.y === path[i].y));
    if (i) assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y), 1);
  }
  assert.equal(e.ap, 2, 'preview does not spend AP');
});

test('blocked, occupied and out-of-range destinations never spend AP', () => {
  const state = rules.createState();
  for (const [x, y] of [[4, 2], [0, 4], [9, 0], [-1, 2], [1, 2]]) assert.equal(rules.beginMove(state, 'E', x, y), null);
  assert.equal(state.units[0].ap, 2);
  assert.equal(state.moving, null);
});

test('one move costs one AP, cannot double-commit, and lands on the final tile', () => {
  const state = rules.createState();
  const path = rules.beginMove(state, 'E', 3, 3);
  assert.ok(path);
  assert.equal(state.units[0].ap, 1);
  assert.equal(rules.beginMove(state, 'E', 3, 3), null);
  assert.equal(rules.endTurn(state), false, 'turn cannot change mid-animation');
  assert.equal(state.units[0].ap, 1);
  assert.equal(rules.finishMove(state), true);
  assert.deepEqual([state.units[0].x, state.units[0].y], [3, 3]);
  assert.ok(rules.beginMove(state, 'E', 3, 4)); rules.finishMove(state);
  assert.equal(state.units[0].ap, 0);
  assert.equal(rules.beginMove(state, 'E', 3, 5), null);
  assert.equal(rules.reachable(state, 'E').size, 1);
  assert.equal(rules.endTurn(state), true);
  assert.equal(state.turn, 2);
  assert.ok(state.units.every(u => u.ap === 2));
});

test('relay requires adjacent Aya and spends one AP exactly once', () => {
  const state = rules.createState();
  assert.equal(rules.connect(state, 'T'), false);
  const aya = state.units.find(u => u.id === 'T'); aya.x = 6; aya.y = 6;
  assert.equal(rules.connect(state, 'E'), false);
  assert.equal(rules.canConnect(state, 'T'), true);
  assert.equal(rules.connect(state, 'T'), true);
  assert.equal(aya.ap, 1);
  assert.equal(state.complete, true);
  assert.equal(rules.connect(state, 'T'), false);
  assert.equal(aya.ap, 1);
});
