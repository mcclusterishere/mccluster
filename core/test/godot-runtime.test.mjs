import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGodotArgs, parseStudioLine, resolveGodotBinary } from '../src/game-studio/godot-runtime.mjs';

const scenario = {
  id: 'TEST_MISSION_000',
  seed: 33,
  max_steps: 250,
};

test('resolves explicit Godot binary', () => {
  assert.equal(resolveGodotBinary({ MCCLUSTER_GODOT_BIN: '/usr/bin/godot4' }), '/usr/bin/godot4');
  assert.equal(resolveGodotBinary({}), 'godot');
});

test('builds bounded headless Godot invocation', () => {
  assert.deepEqual(buildGodotArgs({ projectPath: '/tmp/prim3', scenario }), [
    '--headless',
    '--path',
    '/tmp/prim3',
    '--',
    '--mccluster-scenario=TEST_MISSION_000',
    '--mccluster-seed=33',
    '--mccluster-max-steps=250',
  ]);
});

test('parses only studio event lines', () => {
  assert.equal(parseStudioLine('Godot Engine v4'), null);
  assert.equal(parseStudioLine('MCCLUSTER_EVENT not-json'), null);
  assert.deepEqual(parseStudioLine('MCCLUSTER_EVENT {"kind":"action","type":"move"}'), {
    kind: 'action',
    type: 'move',
  });
});
