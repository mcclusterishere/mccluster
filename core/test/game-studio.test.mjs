import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGameStudioPlan, GAME_STUDIO_STAGES } from '../src/game-studio.mjs';

test('buildGameStudioPlan creates the complete autonomous production loop', () => {
  const plan = buildGameStudioPlan({
    brief: 'Build PRIM3 Operation 01 as a tactical 3D mission.',
    repository: 'mcclusterishere/hitmans-halo',
    campaign: 'PRIM3 66 Operations',
    operation_ids: ['P1-A'],
    world_refs: ['Hitmans Halo Cesium Earth'],
    canon_refs: ['Episode 0', 'Prim3 Operations'],
  });

  assert.equal(plan.system, 'mccluster-autonomous-game-studio');
  assert.deepEqual(plan.loop.sequence, GAME_STUDIO_STAGES);
  assert.equal(plan.stages.length, 11);
  assert.equal(plan.spec.repository, 'mcclusterishere/hitmans-halo');
  assert.ok(plan.required_capabilities.includes('code.build'));
  assert.ok(plan.required_capabilities.includes('research.web'));
  assert.equal(plan.execution_policy.automatic_merge, false);
  assert.equal(plan.execution_policy.production_deploy, false);
  assert.equal(plan.execution_policy.builder_reviewer_separation, true);
});

test('buildGameStudioPlan rejects empty briefs', () => {
  assert.throws(() => buildGameStudioPlan({ brief: '   ' }), /requires brief/);
});

test('planner normalizes budgets and defaults', () => {
  const plan = buildGameStudioPlan({ brief: 'Prototype a mission', budget_cents: -100 });
  assert.equal(plan.spec.engine, 'godot');
  assert.equal(plan.spec.budget_cents, 0);
  assert.deepEqual(plan.spec.target_platforms, ['desktop']);
});
