import assert from 'node:assert/strict';
import test from 'node:test';
import { hashEnvelope } from '../src/fabric/router.js';

const base = {
  schema_version: 1,
  event_id: '33333333-3333-4333-8333-333333333333',
  org_id: '1c0733be-69b5-4e65-abe7-377b492c296b',
  trace_id: '22222222-2222-4222-8222-222222222222',
  kind: 'conversation.ingested',
  origin_node: 'cloudflare',
  occurred_at: '2026-09-12T22:00:00Z',
};

function payload(extra = {}) {
  return {
    provider: 'chatgpt',
    conversation_id: base.trace_id,
    receipt_id: base.event_id,
    message_count: 2,
    payload_hash: 'a'.repeat(64),
    ...extra,
  };
}

test('Worker Fabric hashes a reference-only conversation envelope', async () => {
  const hash = await hashEnvelope({ ...base, payload: payload() });
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('Worker Fabric rejects transcript aliases and sensitive source metadata', async () => {
  for (const [key, value] of [
    ['messages', [{ role: 'user', content: 'private' }]],
    ['transcript', 'private transcript'],
    ['raw_text', 'private text'],
    ['conversation', { content: 'private' }],
    ['source_url', 'https://example.invalid/?token=secret'],
    ['idempotency_key', 'private-request-key'],
  ]) {
    await assert.rejects(
      hashEnvelope({ ...base, payload: payload({ [key]: value }) }),
      /raw conversation messages are forbidden/,
    );
  }
});

test('Worker Fabric requires durable references and sane message counts', async () => {
  await assert.rejects(
    hashEnvelope({ ...base, payload: payload({ receipt_id: '' }) }),
    /requires conversation_id and receipt_id/,
  );
  await assert.rejects(
    hashEnvelope({ ...base, payload: payload({ message_count: 1.5 }) }),
    /message_count must be a non-negative integer/,
  );
});
