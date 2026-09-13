import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalTimestamp, createEnvelope, hashEnvelope, stableStringify } from '../src/fabric.mjs';

const orgId = '1c0733be-69b5-4e65-abe7-377b492c296b';
const traceId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';

function conversationPayload(extra = {}) {
  return {
    provider: 'chatgpt',
    conversation_id: traceId,
    receipt_id: eventId,
    message_count: 3,
    payload_hash: 'a'.repeat(64),
    ...extra,
  };
}

test('stableStringify sorts object keys recursively', () => {
  const a = { z: 1, a: { y: 2, b: 3 }, list: [{ q: 1, a: 2 }] };
  const b = { list: [{ a: 2, q: 1 }], a: { b: 3, y: 2 }, z: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
});

test('canonicalTimestamp normalizes equivalent RFC3339 instants', () => {
  assert.equal(canonicalTimestamp('2026-09-12T22:00:00+00:00'), '2026-09-12T22:00:00.000Z');
  assert.equal(canonicalTimestamp('2026-09-12T18:00:00-04:00'), '2026-09-12T22:00:00.000Z');
});

test('createEnvelope produces immutable identity fields and a valid SHA-256 hash', () => {
  const envelope = createEnvelope({
    org_id: orgId,
    trace_id: traceId,
    event_id: eventId,
    kind: 'fabric.test',
    occurred_at: '2026-09-12T18:00:00-04:00',
    payload: { nested: { b: 2, a: 1 } }
  });
  assert.equal(envelope.origin_node, 'ovh');
  assert.equal(envelope.occurred_at, '2026-09-12T22:00:00.000Z');
  assert.match(envelope.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(envelope.content_hash, hashEnvelope(envelope));
});

test('hash survives key-order and timestamp-format normalization', () => {
  const base = {
    schema_version: 1,
    event_id: eventId,
    org_id: orgId,
    trace_id: traceId,
    kind: 'fabric.test',
    origin_node: 'ovh'
  };
  assert.equal(
    hashEnvelope({ ...base, occurred_at: '2026-09-12T22:00:00+00:00', payload: { a: 1, b: 2 } }),
    hashEnvelope({ ...base, occurred_at: '2026-09-12T18:00:00-04:00', payload: { b: 2, a: 1 } })
  );
  assert.notEqual(
    hashEnvelope({ ...base, occurred_at: '2026-09-12T22:00:00Z', payload: { a: 1 } }),
    hashEnvelope({ ...base, occurred_at: '2026-09-12T22:00:00Z', payload: { a: 2 } })
  );
});

test('conversation.ingested accepts only bounded reference metadata', () => {
  const envelope = createEnvelope({
    org_id: orgId,
    trace_id: traceId,
    event_id: eventId,
    kind: 'conversation.ingested',
    occurred_at: '2026-09-12T22:00:00Z',
    payload: conversationPayload(),
  });
  assert.equal(envelope.payload.conversation_id, traceId);
  assert.equal(envelope.payload.receipt_id, eventId);
});

test('conversation.ingested rejects raw-content aliases, not only messages', () => {
  for (const [key, value] of [
    ['messages', [{ role: 'user', content: 'private' }]],
    ['transcript', 'private transcript'],
    ['raw_text', 'private text'],
    ['conversation', { content: 'private' }],
    ['source_url', 'https://example.invalid/?token=secret'],
  ]) {
    assert.throws(() => createEnvelope({
      org_id: orgId,
      trace_id: traceId,
      event_id: eventId,
      kind: 'conversation.ingested',
      occurred_at: '2026-09-12T22:00:00Z',
      payload: conversationPayload({ [key]: value }),
    }), /raw conversation messages are forbidden/);
  }
});

test('conversation.ingested requires durable references and a valid message count', () => {
  assert.throws(() => createEnvelope({
    org_id: orgId,
    trace_id: traceId,
    event_id: eventId,
    kind: 'conversation.ingested',
    occurred_at: '2026-09-12T22:00:00Z',
    payload: conversationPayload({ receipt_id: '' }),
  }), /requires conversation_id and receipt_id/);

  assert.throws(() => createEnvelope({
    org_id: orgId,
    trace_id: traceId,
    event_id: eventId,
    kind: 'conversation.ingested',
    occurred_at: '2026-09-12T22:00:00Z',
    payload: conversationPayload({ message_count: -1 }),
  }), /message_count must be a non-negative integer/);
});
