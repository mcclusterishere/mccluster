import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnvelope, hashEnvelope, stableStringify } from '../src/fabric.mjs';

test('stableStringify sorts object keys recursively', () => {
  const a = { z: 1, a: { y: 2, b: 3 }, list: [{ q: 1, a: 2 }] };
  const b = { list: [{ a: 2, q: 1 }], a: { b: 3, y: 2 }, z: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
});

test('createEnvelope produces immutable identity fields and a valid SHA-256 hash', () => {
  const envelope = createEnvelope({
    org_id: '1c0733be-69b5-4e65-abe7-377b492c296b',
    trace_id: '22222222-2222-4222-8222-222222222222',
    event_id: '33333333-3333-4333-8333-333333333333',
    kind: 'conversation.ingested',
    occurred_at: '2026-09-12T22:00:00.000Z',
    payload: { message: 'hello', nested: { b: 2, a: 1 } }
  });
  assert.equal(envelope.origin_node, 'ovh');
  assert.match(envelope.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(envelope.content_hash, hashEnvelope(envelope));
});

test('hash changes when payload changes but not when key order changes', () => {
  const base = {
    schema_version: 1,
    event_id: '33333333-3333-4333-8333-333333333333',
    org_id: '1c0733be-69b5-4e65-abe7-377b492c296b',
    trace_id: '22222222-2222-4222-8222-222222222222',
    kind: 'fabric.test',
    origin_node: 'ovh',
    occurred_at: '2026-09-12T22:00:00.000Z'
  };
  assert.equal(hashEnvelope({ ...base, payload: { a: 1, b: 2 } }), hashEnvelope({ ...base, payload: { b: 2, a: 1 } }));
  assert.notEqual(hashEnvelope({ ...base, payload: { a: 1 } }), hashEnvelope({ ...base, payload: { a: 2 } }));
});
