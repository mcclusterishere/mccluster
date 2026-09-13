import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicPlanJobId } from '../src/executors/objective-plan.mjs';

test('same planner job and step key produce the same valid UUID', () => {
  const first = deterministicPlanJobId('11111111-1111-4111-8111-111111111111', 'inspect');
  const second = deterministicPlanJobId('11111111-1111-4111-8111-111111111111', 'inspect');
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('different step keys produce different child ids', () => {
  const inspect = deterministicPlanJobId('parent-job', 'inspect');
  const analyze = deterministicPlanJobId('parent-job', 'analyze');
  assert.notEqual(inspect, analyze);
});
