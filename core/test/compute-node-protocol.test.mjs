import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COMPUTE_PROTOCOL, HARDWARE_MODES, HARDWARE_MODE_RANK, clampYieldSeconds, countLiveGpuNodes, validateCapabilityManifest, validateEnrollment, validateInventory } from '../src/compute/protocol.mjs';
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

test('inventory keeps the per-GPU form, memory and vram_source fields and the runtime hardware_mode, still stripping unknown gpu keys', () => {
  const inventory = validateInventory({
    gpus: [{ vendor: 'amd', model: 'AMD Radeon 780M Graphics', vram_bytes: 536870912, form: 'integrated', memory: 'shared', vram_source: 'registry', local_path: 'not for the plane' }],
    runtime: { hardware_mode: 'gpu-present-unverified', gpu_probe: { ok: true } }
  });
  assert.equal(inventory.gpus[0].form, 'integrated');
  assert.equal(inventory.gpus[0].memory, 'shared');
  assert.equal(inventory.gpus[0].vram_source, 'registry');
  assert.equal(inventory.gpus[0].local_path, undefined, 'unknown gpu keys are still dropped');
  assert.equal(inventory.runtime.hardware_mode, 'gpu-present-unverified');
  const bare = validateInventory({ gpus: [{ vendor: 'nvidia', vram_bytes: 1 }] }).gpus[0];
  assert.equal(bare.form, null);
  assert.equal(bare.memory, null);
  assert.equal(bare.vram_source, null);
  const long = validateInventory({ gpus: [{ vendor: 'x', form: 'y'.repeat(100) }] }).gpus[0];
  assert.equal(long.form.length, 40);
});

test('the hardware_mode vocabulary, its rank, the yield clamp and the live GPU count are shared protocol helpers', () => {
  assert.deepEqual(HARDWARE_MODES, ['gpu-verified', 'gpu-present-unverified', 'cpu-only', 'unknown']);
  assert.deepEqual(HARDWARE_MODE_RANK, { 'gpu-verified': 3, 'gpu-present-unverified': 2, 'cpu-only': 1, unknown: 0 });
  assert.equal(clampYieldSeconds(30), 30);
  assert.equal(clampYieldSeconds('45.9'), 45);
  assert.equal(clampYieldSeconds(100000), 300);
  assert.equal(clampYieldSeconds(-5), 0);
  assert.equal(clampYieldSeconds(undefined), 0);
  assert.equal(clampYieldSeconds('soon'), 0);
  const nodes = [
    { id: 'node_a', inventory: { runtime: { hardware_mode: 'gpu-verified' } } },
    { id: 'node_b', inventory: { runtime: { hardware_mode: 'gpu-present-unverified' } } },
    { id: 'node_c', inventory: { runtime: { hardware_mode: 'gpu-verified' } } },
    { id: 'node_d', inventory: null },
    { id: 'node_e' }
  ];
  assert.equal(countLiveGpuNodes(nodes, { excludeNodeId: 'node_a' }), 1, 'a node never counts itself');
  assert.equal(countLiveGpuNodes(nodes, { excludeNodeId: 'node_z' }), 2);
  assert.equal(countLiveGpuNodes(nodes), 2);
  assert.equal(countLiveGpuNodes(null), 0);
});

test('a browser.act manifest entry with no model and a browser feature normalizes like any other, and its executor stays node-local', () => {
  const [entry] = validateCapabilityManifest([{
    capability: 'browser.act', implementation: 'chromium.local', backend: 'playwright', model: null, version: '1',
    features: { browser: true, headed: false, screenshot: true, self_hosted: true }, max_concurrency: 1, min_vram_bytes: 0,
    executor: { type: 'http', url: 'http://127.0.0.1:4791/execute', health_url: 'http://127.0.0.1:4791/ready', health_method: 'GET', health_timeout_ms: 3000, timeout_ms: 180000 }
  }]);
  assert.equal(entry.capability, 'browser.act');
  assert.equal(entry.implementation, 'chromium.local');
  assert.equal(entry.model, null);
  assert.equal(entry.backend, 'playwright');
  assert.deepEqual(entry.features, { browser: true, headed: false, screenshot: true, self_hosted: true });
  assert.equal(entry.max_concurrency, 1);
  assert.equal(entry.min_vram_bytes, 0);
  assert.equal(entry.executor, undefined, 'the loopback executor never leaves the node');
  const [vision] = validateCapabilityManifest([{ capability: 'ai.chat', implementation: 'qwen3-vl.8b.local', model: 'qwen3-vl:8b', features: { gpu: true, vision: true } }]);
  assert.equal(vision.features.vision, true, 'features.vision survives normalization: the claim SQL matches it');
});

test('the Core package never grows a Playwright dependency: the browser executor resolves it from the node at start', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(Object.hasOwn(pkg[section] || {}, 'playwright'), false, `${section} must not list playwright`);
  }
  assert.equal(pkg.scripts['compute:browser'], 'node src/compute/browser-executor.mjs');
  assert.match(pkg.scripts['test:browser'], /browser-executor\.test\.mjs/);
});
