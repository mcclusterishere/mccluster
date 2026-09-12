import test from 'node:test';
import assert from 'node:assert/strict';

import { boundedConversationMessages, normalizeObjectiveSynthesis } from '../src/objective-synthesis-policy.mjs';

test('low-confidence synthesis is ignored', () => {
  const result = normalizeObjectiveSynthesis({
    action: 'create',
    confidence: 0.4,
    name: 'Build everything',
    description: 'Too uncertain.'
  });
  assert.equal(result.action, 'ignore');
});

test('update is limited to supplied canonical objective ids', () => {
  const rejected = normalizeObjectiveSynthesis({
    action: 'update',
    confidence: 0.99,
    objective_id: 'not-visible',
    name: 'Hijack objective'
  }, { existingObjectiveIds: ['visible-id'] });
  assert.equal(rejected.action, 'ignore');

  const accepted = normalizeObjectiveSynthesis({
    action: 'update',
    confidence: 0.95,
    objective_id: 'visible-id',
    name: 'Advance Core autonomy',
    description: 'Continue the canonical automation program.',
    priority: 500,
    success_metric: { milestone: 'working feedback loop' }
  }, { existingObjectiveIds: ['visible-id'] });
  assert.equal(accepted.action, 'update');
  assert.equal(accepted.objective_id, 'visible-id');
  assert.equal(accepted.priority, 100);
});

test('create keeps only bounded objective fields', () => {
  const accepted = normalizeObjectiveSynthesis({
    action: 'create',
    confidence: 0.91,
    name: 'Launch morning autonomous brief',
    description: 'Persist useful overnight output for the owner.',
    priority: -10,
    success_metric: { cadence: 'daily' },
    status: 'completed',
    deploy: true,
    send_email: true
  });
  assert.deepEqual(Object.keys(accepted).sort(), [
    'action', 'confidence', 'description', 'name', 'priority', 'reason', 'success_metric'
  ]);
  assert.equal(accepted.action, 'create');
  assert.equal(accepted.priority, 0);
});

test('conversation messages are bounded from the newest end', () => {
  const messages = Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `message-${i}` }));
  const bounded = boundedConversationMessages(messages, { maxMessages: 3, maxChars: 1000 });
  assert.deepEqual(bounded.map((message) => message.content), ['message-57', 'message-58', 'message-59']);
});
