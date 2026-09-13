import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObjectiveSynthesis } from '../src/objective-synthesis-policy.mjs';

test('ignores low-confidence objective mutations', () => {
  const result = normalizeObjectiveSynthesis({
    action: 'create',
    confidence: 0.71,
    name: 'Should not land',
  });
  assert.equal(result.action, 'ignore');
});

test('allows high-confidence create with bounded fields', () => {
  const result = normalizeObjectiveSynthesis({
    action: 'create',
    confidence: 0.91,
    name: 'Ship the autonomous game studio',
    description: 'Build a durable PRIM3 game production capability.',
    priority: 500,
    success_metric: { vertical_slice: true },
  });
  assert.equal(result.action, 'create');
  assert.equal(result.priority, 100);
  assert.equal(result.success_metric.vertical_slice, true);
});

test('updates only an objective id supplied by the active canonical set', () => {
  const denied = normalizeObjectiveSynthesis({
    action: 'update',
    confidence: 0.95,
    objective_id: 'retired-objective',
    name: 'Do not mutate this',
  }, { existingObjectiveIds: ['active-objective'] });
  assert.equal(denied.action, 'ignore');

  const allowed = normalizeObjectiveSynthesis({
    action: 'update',
    confidence: 0.95,
    objective_id: 'active-objective',
    name: 'Advance current objective',
  }, { existingObjectiveIds: ['active-objective'] });
  assert.equal(allowed.action, 'update');
  assert.equal(allowed.objective_id, 'active-objective');
});

test('fails closed when a create/update lacks a durable objective name', () => {
  assert.equal(normalizeObjectiveSynthesis({ action: 'create', confidence: 0.99 }).action, 'ignore');
  assert.equal(normalizeObjectiveSynthesis({
    action: 'update',
    confidence: 0.99,
    objective_id: 'active-objective',
  }, { existingObjectiveIds: ['active-objective'] }).action, 'ignore');
});
