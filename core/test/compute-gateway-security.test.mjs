import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertJsonContentType, normalizeRequestId, parseIdempotencyKey, resolveScopedOrg, secureSecretEqual } from '../src/compute/http-security.mjs';

test('admin secrets use fixed-length digest comparison semantics', () => {
  assert.equal(secureSecretEqual('same-secret', 'same-secret'), true);
  assert.equal(secureSecretEqual('same-secret', 'different-secret'), false);
  assert.equal(secureSecretEqual('', 'different-secret'), false);
  assert.equal(secureSecretEqual('x', ''), false);
});

test('request ids accept bounded safe caller correlation ids and replace unsafe values', () => {
  assert.equal(normalizeRequestId('req_123:abc'), 'req_123:abc');
  assert.match(normalizeRequestId('bad id with spaces'), /^[0-9a-f-]{36}$/i);
  assert.match(normalizeRequestId('x'.repeat(129)), /^[0-9a-f-]{36}$/i);
});

test('idempotency keys are strict, bounded and optional', () => {
  assert.equal(parseIdempotencyKey(undefined), null);
  assert.equal(parseIdempotencyKey('task-abc_123'), 'task-abc_123');
  assert.throws(() => parseIdempotencyKey('contains space'), (error) => error.code === 'BAD_IDEMPOTENCY_KEY');
  assert.throws(() => parseIdempotencyKey('x'.repeat(129)), (error) => error.code === 'BAD_IDEMPOTENCY_KEY');
});

test('POST content type must be JSON', () => {
  assert.doesNotThrow(() => assertJsonContentType('application/json'));
  assert.doesNotThrow(() => assertJsonContentType('application/json; charset=utf-8'));
  assert.throws(() => assertJsonContentType('text/plain'), (error) => error.code === 'UNSUPPORTED_MEDIA_TYPE');
  assert.throws(() => assertJsonContentType(undefined), (error) => error.status === 415);
});

test('canonical Core organization fails closed on cross-org administration', () => {
  const canonical = '00000000-0000-0000-0000-000000000001';
  assert.equal(resolveScopedOrg(null, canonical), canonical);
  assert.equal(resolveScopedOrg(canonical, canonical), canonical);
  assert.throws(
    () => resolveScopedOrg('00000000-0000-0000-0000-000000000002', canonical),
    (error) => error.code === 'CROSS_ORG_DENIED' && error.status === 403
  );
});
