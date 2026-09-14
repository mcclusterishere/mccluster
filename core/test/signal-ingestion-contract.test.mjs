import test from 'node:test';
import assert from 'node:assert/strict';
import { signalToPortfolioRecord } from '../src/signal-portfolio.mjs';
import { assertCompletionEvidence, buildCompletionEvidence } from '../src/completion-evidence.mjs';
import { buildPortfolioPlan } from '../src/initiative-os.mjs';

test('canonical signal normalizes into Initiative OS without pretending to be a raw transcript', () => {
  const record = signalToPortfolioRecord({
    id: 42,
    signal_type: 'funding',
    source: 'email',
    source_ref: 'gmail:abc',
    severity: 82,
    confidence: 0.9,
    status: 'new',
    observed_at: '2026-09-14T20:00:00.000Z',
    payload: {
      summary: 'Submit the security grant packet before Friday.',
      project: 'McCluster Corp',
      initiative: 'Security Grant',
      department: 'funding',
      deadline: '2026-09-18T21:00:00.000Z',
    },
  });

  assert.equal(record.id, 'signal:42');
  assert.equal(record.project, 'McCluster Corp');
  assert.equal(record.initiative, 'Security Grant');
  assert.equal(record.department, 'funding');
  assert.equal(record.priority, 82);
  assert.equal(record.metadata.source_ref, 'gmail:abc');

  const plan = buildPortfolioPlan({ objectives: [record], now: Date.parse('2026-09-14T21:00:00.000Z') });
  assert.equal(plan.initiative_count, 1);
  assert.equal(plan.top_initiatives[0].project, 'McCluster Corp');
  assert.deepEqual(plan.top_initiatives[0].objective_ids, ['signal:42']);
});

test('completion evidence accepts and proves signal-backed objective synthesis', () => {
  const job = { id: 'job-signal-1', job_type: 'objective_synthesis' };
  const output = {
    executor: 'objective_synthesis:v3',
    action: 'create',
    confidence: 0.91,
    reason: 'durable commitment',
    source: {
      signal_id: '42',
      source_type: 'email',
      source_ref: 'gmail:abc',
      fingerprint: 'abc123',
    },
    objective: { id: '11111111-1111-5111-8111-111111111111', name: 'Submit grant packet', priority: 82, status: 'active' },
    reflection_job_id: null,
  };

  const wrapped = buildCompletionEvidence(job, output, {
    startedAt: '2026-09-14T20:00:00.000Z',
    completedAt: '2026-09-14T20:00:01.000Z',
  });
  assert.equal(assertCompletionEvidence(job, wrapped), true);
  assert.equal(wrapped.completion_evidence.records.some((item) => item.kind === 'canonical_signal_reference' && item.signal_id === '42'), true);
  assert.equal(wrapped.completion_evidence.records.some((item) => item.kind === 'database_mutation' && item.table === 'ops_signals'), true);
});
