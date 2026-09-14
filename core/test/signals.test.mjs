import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSeverity, normalizeSignal, normalizeSignalRecord, signalNeedsSynthesis } from '../src/signals.mjs';

test('normalizes legacy addSignal inputs into the canonical DB envelope', () => {
  const row = normalizeSignal({
    orgId: '11111111-1111-1111-1111-111111111111',
    kind: 'communications_owner_escalation',
    body: 'Owner review requested',
    severity: 'warning',
    source: 'sms',
    sourceRef: 'message-1',
    metadata: { thread_id: 'thread-1' },
    observedAt: '2026-09-14T20:00:00Z',
  });
  assert.equal(row.signal_type, 'communications_owner_escalation');
  assert.equal(row.severity, 60);
  assert.equal(row.payload.schema_version, 'mccluster-signal/v1');
  assert.equal(row.payload.content, 'Owner review requested');
  assert.equal(row.payload.metadata.thread_id, 'thread-1');
  assert.equal(row.fingerprint.length, 64);
  assert.equal(row.status, 'new');
});

test('signal fingerprint is deterministic across ingestion retries', () => {
  const input = { orgId: 'o', kind: 'message', body: 'same', source: 'email', sourceRef: 'm-1', metadata: { a: 1 } };
  assert.equal(normalizeSignal(input).fingerprint, normalizeSignal(input).fingerprint);
});

test('severity accepts labels and bounded numeric values', () => {
  assert.equal(normalizeSeverity('critical'), 100);
  assert.equal(normalizeSeverity(130), 100);
  assert.equal(normalizeSeverity(-2), 0);
});

test('only unprocessed content-bearing signals require synthesis', () => {
  assert.equal(signalNeedsSynthesis({ id: 1, status: 'new', payload: { content: 'Build it' } }), true);
  assert.equal(signalNeedsSynthesis({ id: 2, status: 'consumed', payload: { content: 'Build it' }, processed_at: '2026-09-14T20:00:00Z' }), false);
  assert.equal(signalNeedsSynthesis({ id: 3, status: 'new', payload: {} }), false);
});

test('normalizes stored signal records for Initiative OS', () => {
  const signal = normalizeSignalRecord({ id: 42, signal_type: 'calendar.event', source: 'fabric', severity: 70, confidence: 0.9, payload: { content: 'Deadline tomorrow', metadata: { project: 'McCluster' } }, observed_at: '2026-09-14T21:00:00Z' });
  assert.equal(signal.id, '42');
  assert.equal(signal.content, 'Deadline tomorrow');
  assert.equal(signal.metadata.project, 'McCluster');
});
