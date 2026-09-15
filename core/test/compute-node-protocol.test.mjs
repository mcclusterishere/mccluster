import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPUTE_PROTOCOL, validateCapabilityManifest, validateEnrollment } from '../src/compute/protocol.mjs';
import { generateNodeIdentity, nodeIdFromPublicKey, signRequest, verifySignedRequest } from '../src/compute/signature.mjs';

test('node identity is deterministically derived from its public key', () => {
  const identity = generateNodeIdentity();
  assert.match(identity.nodeId, /^node_[a-f0-9]{32}$/);
  assert.equal(nodeIdFromPublicKey(identity.publicKeyPem), identity.nodeId);
  assert.match(identity.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.match(identity.publicKeyPem, /BEGIN PUBLIC KEY/);
});

test('signed compute request verifies exact method path and body', () => {
  const identity = generateNodeIdentity();
  const bodyBytes = Buffer.from(JSON.stringify({ hello: 'gpu' }));
  const timestamp = new Date().toISOString();
  const nonce = 'd2d5ba9a-9f8a-42a8-bcf3-9a3eae61d21a';
  const headers = signRequest({
    privateKeyPem: identity.privateKeyPem,
    method: 'POST',
    path: '/v1/compute/heartbeat',
    nodeId: identity.nodeId,
    bodyBytes,
    timestamp,
    nonce
  });
  const verified = verifySignedRequest({
    publicKeyPem: identity.publicKeyPem,
    method: 'POST',
    path: '/v1/compute/heartbeat',
    headers,
    bodyBytes,
    now: Date.parse(timestamp)
  });
  assert.equal(verified.nodeId, identity.nodeId);
  assert.equal(verified.nonce, nonce);
});

test('tampered request body is rejected before signature acceptance', () => {
  const identity = generateNodeIdentity();
  const bodyBytes = Buffer.from('{"value":1}');
  const timestamp = new Date().toISOString();
  const headers = signRequest({
    privateKeyPem: identity.privateKeyPem,
    method: 'POST',
    path: '/v1/compute/lease',
    nodeId: identity.nodeId,
    bodyBytes,
    timestamp,
    nonce: '51dbb18d-85fc-4f7c-9244-f5fd568abbc8'
  });
  assert.throws(
    () => verifySignedRequest({
      publicKeyPem: identity.publicKeyPem,
      method: 'POST',
      path: '/v1/compute/lease',
      headers,
      bodyBytes: Buffer.from('{"value":2}'),
      now: Date.parse(timestamp)
    }),
    (error) => error.code === 'BAD_DIGEST'
  );
});

test('stale signatures are rejected', () => {
  const identity = generateNodeIdentity();
  const timestamp = new Date(Date.now() - 10 * 60_000).toISOString();
  const bodyBytes = Buffer.from('{}');
  const headers = signRequest({
    privateKeyPem: identity.privateKeyPem,
    method: 'POST',
    path: '/v1/compute/heartbeat',
    nodeId: identity.nodeId,
    bodyBytes,
    timestamp,
    nonce: '694494c9-9549-4777-9c82-91b28512720a'
  });
  assert.throws(
    () => verifySignedRequest({
      publicKeyPem: identity.publicKeyPem,
      method: 'POST',
      path: '/v1/compute/heartbeat',
      headers,
      bodyBytes,
      now: Date.now(),
      maxClockSkewMs: 5 * 60_000
    }),
    (error) => error.code === 'STALE_SIGNATURE'
  );
});

test('public capability manifest is provider-neutral and self-host classified', () => {
  const manifest = validateCapabilityManifest([{
    capability: 'model3d.generate',
    implementation: 'hunyuan3d.2-1',
    backend: 'comfyui',
    model: 'Hunyuan3D 2.1',
    max_concurrency: 2,
    min_vram_bytes: 20_000_000_000,
    features: { pbr: true, image_to_3d: true },
    executor: { type: 'http', url: 'http://127.0.0.1:8188' }
  }]);
  assert.equal(manifest[0].capability, 'model3d.generate');
  assert.equal(manifest[0].hosting, 'self-hosted');
  assert.equal(manifest[0].billing, 'compute');
  assert.equal(manifest[0].executor, undefined);
});

test('enrollment validates protocol and strips node-local executor details', () => {
  const identity = generateNodeIdentity();
  const enrollment = validateEnrollment({
    protocol: COMPUTE_PROTOCOL,
    org_id: '00000000-0000-0000-0000-000000000001',
    display_name: 'GPU Node 1',
    public_key: identity.publicKeyPem,
    inventory: { cpu_count: 16, memory_bytes: 64_000_000_000, gpus: [] },
    capabilities: [{
      capability: 'video.generate',
      implementation: 'ltx.local',
      executor: { type: 'http', url: 'http://127.0.0.1:8188' }
    }]
  });
  assert.equal(enrollment.protocol, COMPUTE_PROTOCOL);
  assert.equal(enrollment.capabilities[0].executor, undefined);
});

test('duplicate capability implementations fail closed', () => {
  assert.throws(() => validateCapabilityManifest([
    { capability: 'video.generate', implementation: 'ltx.local' },
    { capability: 'video.generate', implementation: 'ltx.local' }
  ]), /Duplicate capability implementation/);
});
