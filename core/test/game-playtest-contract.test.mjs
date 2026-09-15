import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlaytestRun, finishPlaytest, normalizePlaytestScenario, recordAction, recordObservation } from '../src/game-studio/playtest-contract.mjs';
import { evaluatePlaytest, repairTasksFromEvaluation } from '../src/game-studio/evaluator.mjs';
import { getEngineAdapter, getWorldAdapter, listStudioAdapters } from '../src/game-studio/adapter-registry.mjs';

test('normalizes deterministic embodied playtest scenario', () => {
  const scenario = normalizePlaytestScenario({ id: 'sandbox', goals: ['reach extraction'], seed: 42 });
  assert.equal(scenario.seed, 42);
  assert.equal(scenario.engine, 'godot');
  assert.ok(scenario.required_evidence.includes('telemetry'));
});

test('records evidence and passes a complete stable run', () => {
  const run = createPlaytestRun({ id: 'sandbox', goals: ['reach extraction'], seed: 7, max_steps: 100 });
  recordObservation(run, { t_ms: 0, frame_ref: 'frame://1', state_ref: 'state://1' });
  recordAction(run, { t_ms: 10, type: 'move', target: 'cover-a', result: 'ok' });
  finishPlaytest(run, { status: 'completed', completed_goals: ['reach extraction'], elapsed_ms: 5000 });
  const evaluation = evaluatePlaytest(run, { pass_score: 70 });
  assert.equal(evaluation.passed, true);
  assert.deepEqual(evaluation.blockers, []);
});

test('generates repair work from failed evidence', () => {
  const run = createPlaytestRun({ id: 'sandbox', goals: ['reach extraction'], seed: 7 });
  run.metrics.crashes = 1;
  finishPlaytest(run, { status: 'failed', failed_goals: ['reach extraction'] });
  const evaluation = evaluatePlaytest(run);
  const repairs = repairTasksFromEvaluation(evaluation);
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.blockers.includes('crash'));
  assert.ok(repairs.some((task) => task.kind === 'stability'));
});

test('adapter registry separates engine and world roles', () => {
  assert.equal(getEngineAdapter('godot').status, 'build-now');
  assert.equal(getEngineAdapter('unreal').roles.includes('production-target'), true);
  assert.equal(getWorldAdapter('halo').authority, 'context-source');
  assert.ok(listStudioAdapters().worlds.length >= 3);
});
