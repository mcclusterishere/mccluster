import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { amdInventoryFromSysfs, amdLoadFromSysfs, parseNvidiaInventoryCsv, parseNvidiaLoadCsv, parseAppleDisplayInventory } from '../src/compute/hardware.mjs';
import { assertLoopbackUrl, capabilityReadiness, engineHealthSummary, healthyCapabilities, probeExecutors, probeHttpExecutor } from '../src/compute/engine-probes.mjs';

test('parses NVIDIA inventory and runtime telemetry', () => {
  const inventory = parseNvidiaInventoryCsv('NVIDIA RTX 4090, GPU-abc, 24564, 590.1, 8.9\n');
  assert.equal(inventory[0].vendor, 'nvidia');
  assert.equal(inventory[0].uuid, 'GPU-abc');
  assert.equal(inventory[0].vram_bytes, 24564 * 1024 * 1024);

  const load = parseNvidiaLoadCsv('GPU-abc, 1024, 24564, 87, 71, 399.4\n');
  assert.equal(load[0].memory_used_bytes, 1024 * 1024 * 1024);
  assert.equal(load[0].utilization_percent, 87);
  assert.equal(load[0].temperature_c, 71);
});

test('discovers AMD VRAM from Linux sysfs without requiring ROCm CLI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mccluster-amd-'));
  const device = path.join(root, 'card0', 'device');
  fs.mkdirSync(device, { recursive: true });
  fs.writeFileSync(path.join(device, 'vendor'), '0x1002\n');
  fs.writeFileSync(path.join(device, 'device'), '0x744c\n');
  fs.writeFileSync(path.join(device, 'mem_info_vram_total'), '25769803776\n');
  fs.writeFileSync(path.join(device, 'mem_info_vram_used'), '1073741824\n');
  fs.writeFileSync(path.join(device, 'gpu_busy_percent'), '33\n');
  fs.writeFileSync(path.join(device, 'uevent'), 'PCI_SLOT_NAME=0000:03:00.0\n');

  const inventory = amdInventoryFromSysfs(root);
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].vendor, 'amd');
  assert.equal(inventory[0].vram_bytes, 25769803776);

  const load = amdLoadFromSysfs(root);
  assert.equal(load[0].memory_used_bytes, 1073741824);
  assert.equal(load[0].utilization_percent, 33);
  fs.rmSync(root, { recursive: true, force: true });
});

test('engine probes reject non-loopback targets', () => {
  assert.throws(() => assertLoopbackUrl('https://example.com/health'), /loopback/i);
  assert.equal(assertLoopbackUrl('http://127.0.0.1:8188/system_stats').hostname, '127.0.0.1');
});

test('Apple Metal inventory never misrepresents unified memory as dedicated VRAM', () => {
  const inventory = parseAppleDisplayInventory(JSON.stringify({ SPDisplaysDataType: [{ sppci_model: 'Apple M1', spdisplays_metal: 'spdisplays_metal3' }] }));
  assert.equal(inventory[0].vendor, 'apple');
  assert.equal(inventory[0].compute, 'metal');
  assert.equal(inventory[0].vram_bytes, 0);
  assert.equal(inventory[0].uuid, null);
  assert.deepEqual(parseAppleDisplayInventory('{}'), []);
});

test('HTTP engine probe honors health status', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const result = await probeHttpExecutor({ type: 'http', url: 'http://127.0.0.1:8188/execute', health_url: 'http://127.0.0.1:8188/health' }, fakeFetch);
  assert.equal(result.healthy, true);
  assert.equal(result.status, 200);
});

test('only healthy implementations are advertised to Core', async () => {
  const manifest = {
    publicCapabilities: [
      { capability: 'image.generate', implementation: 'image.local', min_vram_bytes: 0 },
      { capability: 'video.generate', implementation: 'video.local', min_vram_bytes: 0 }
    ],
    executors: new Map([
      ['image.local', { type: 'http', url: 'http://127.0.0.1:8188/image', health_url: 'http://127.0.0.1:8188/health' }],
      ['video.local', { type: 'http', url: 'http://127.0.0.1:8288/video', health_url: 'http://127.0.0.1:8288/health' }]
    ])
  };
  const fakeFetch = async (url) => new Response('', { status: String(url).includes('8188') ? 200 : 503 });
  const health = await probeExecutors(manifest, fakeFetch);
  const advertised = healthyCapabilities(manifest, health, { gpus: [] });
  assert.deepEqual(advertised.map((item) => item.implementation), ['image.local']);
});

test('healthy engines still fail closed when VRAM is below the capability requirement', () => {
  const manifest = {
    publicCapabilities: [
      { capability: 'model3d.generate', implementation: 'hunyuan.local', min_vram_bytes: 20_000_000_000 }
    ]
  };
  const health = new Map([['hunyuan.local', { healthy: true }]]);
  const inventory = { gpus: [{ vendor: 'nvidia', vram_bytes: 12_000_000_000 }] };
  const readiness = capabilityReadiness(manifest, health, inventory);
  assert.equal(readiness[0].ready, false);
  assert.match(readiness[0].reason, /insufficient VRAM/i);
  assert.deepEqual(healthyCapabilities(manifest, health, inventory), []);
});

const evidence = { source: 'ollama:/api/ps', model: 'qwen3:8b', size_vram_bytes: 5_600_000_000, size_bytes: 5_600_000_000, processor_gpu_percent: 100, running_models: 1, checked_at: '2026-11-17T20:00:00.000Z' };
const executor = { type: 'http', url: 'http://127.0.0.1:4790/execute', health_url: 'http://127.0.0.1:4790/health' };

test('HTTP engine probe carries the health body gpu_evidence as evidence, and null when the body has none', async () => {
  const withEvidence = await probeHttpExecutor(executor, async () => new Response(JSON.stringify({ ok: true, gpu_evidence: evidence }), { status: 200 }));
  assert.equal(withEvidence.healthy, true);
  assert.deepEqual(withEvidence.evidence, evidence);

  const without = await probeHttpExecutor(executor, async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assert.equal(without.healthy, true);
  assert.equal(without.evidence, null);

  const notJson = await probeHttpExecutor(executor, async () => new Response('plain text', { status: 200 }));
  assert.equal(notJson.healthy, true, 'liveness is the status code, not the body shape');
  assert.equal(notJson.evidence, null);

  const notObject = await probeHttpExecutor(executor, async () => new Response(JSON.stringify({ ok: true, gpu_evidence: 'yes' }), { status: 200 }));
  assert.equal(notObject.evidence, null);

  const unhealthy = await probeHttpExecutor(executor, async () => new Response(JSON.stringify({ ok: false, gpu_evidence: evidence }), { status: 503 }));
  assert.equal(unhealthy.healthy, false);
  assert.deepEqual(unhealthy.evidence, evidence, 'an unhealthy executor may still report what the engine has loaded');

  const huge = await probeHttpExecutor(executor, async () => new Response('x'.repeat(70_000), { status: 200 }));
  assert.equal(huge.healthy, true);
  assert.equal(huge.evidence, null, 'bodies above 64 KiB are not parsed');
});

test('engine health summary carries evidence per implementation', () => {
  const health = new Map([
    ['qwen3.8b.local', { healthy: true, status: 200, reason: null, checked_at: '2026-11-17T20:00:00.000Z', evidence }],
    ['other.local', { healthy: false, status: 503, reason: 'HTTP 503', checked_at: '2026-11-17T20:00:00.000Z' }]
  ]);
  const summary = engineHealthSummary(health, [{ capability: { capability: 'ai.chat', implementation: 'qwen3.8b.local' }, ready: true, reason: null }]);
  assert.deepEqual(summary[0].evidence, evidence);
  assert.deepEqual(summary[0].capabilities, [{ capability: 'ai.chat', ready: true, reason: null }]);
  assert.equal(summary[1].evidence, null);
});
