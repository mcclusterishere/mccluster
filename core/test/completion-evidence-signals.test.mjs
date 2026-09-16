import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompletionEvidence, assertCompletionEvidence } from '../src/completion-evidence.mjs';

const now = '2026-09-14T22:00:00.000Z';
const job = { id: 'job-signal-synthesis', job_type: 'objective_synthesis', target_type: 'signal', target_id: '42', input: {} };

test('signal-driven objective synthesis carries a durable signal proof instead of pretending it is private context', () => {
  const output = {
    executor: 'objective_synthesis:v3',
    action: 'create',
    source: { kind: 'signal', signal_id: '42', conversation_id: null, provider: 'sms', fingerprint: 'f'.repeat(64) },
    objective: { id: 'objective-42' },
    reflection_job_id: 'reflection-42',
  };
  const evidenced = buildCompletionEvidence(job, output, { startedAt: now, completedAt: now });
  assert.equal(evidenced.completion_evidence.records.some((item) => item.kind === 'signal_reference' && item.signal_id === '42'), true);
  assert.equal(assertCompletionEvidence(job, evidenced), true);
});

test('synthesis cannot ambiguously claim both signal and conversation provenance', () => {
  assert.throws(() => buildCompletionEvidence(job, {
    executor: 'objective_synthesis:v3', action: 'ignore',
    source: { signal_id: '42', conversation_id: 'conv-42', fingerprint: 'f'.repeat(64) },
  }), /exactly one signal or private-conversation reference/);
});
