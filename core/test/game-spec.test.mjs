import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGameSpec, validateGameSpec } from '../src/game-studio/game-spec.mjs';

const valid = {
  id: 'TEST_MISSION_000',
  title: 'PRIM3 Tactical Sandbox',
  campaign: 'PRIM3',
  engine: 'godot',
  mission: {
    objectives: ['Move squad to objective', 'Neutralize hostile', 'Extract'],
    required_mechanics: ['unit_selection', 'movement', 'action_points', 'cover', 'enemy_turn', 'extraction'],
    completion_conditions: ['objective_reached', 'hostile_resolved', 'squad_extracted'],
  },
  world: { mode: 'synthetic', halo_context: false },
  playtest: {
    seed: 1337,
    max_steps: 500,
    max_seconds: 300,
    scenarios: ['happy_path', 'blocked_path', 'combat_then_extract'],
    required_evidence: ['telemetry', 'visual', 'action_trace', 'build_log'],
  },
  acceptance: {
    min_completion_rate: 1,
    max_crashes: 0,
    deterministic_replay_required: true,
    max_regressions: 0,
  },
};

test('normalizes deterministic game spec', () => {
  const spec = normalizeGameSpec(valid);
  assert.equal(spec.schema_version, '0.1');
  assert.equal(spec.id, 'TEST_MISSION_000');
  assert.equal(spec.playtest.seed, 1337);
  assert.equal(spec.acceptance.deterministic_replay_required, true);
});

test('validates minimum evidence and mission requirements', () => {
  const result = validateGameSpec(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('rejects underspecified autonomous mission', () => {
  const result = validateGameSpec({ id: 'bad', title: 'bad', mission: {}, playtest: {} });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((x) => x.includes('mission.objectives')));
  assert.ok(result.errors.some((x) => x.includes('telemetry')));
  assert.ok(result.errors.some((x) => x.includes('visual')));
});

test('requires coordinates when Halo context is enabled', () => {
  const result = validateGameSpec({ ...valid, world: { mode: 'halo', halo_context: true } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((x) => x.includes('latitude and longitude')));
});
