import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { amdInventoryFromSysfs, amdLoadFromSysfs, parseNvidiaInventoryCsv, parseNvidiaLoadCsv } from '../src/compute/hardware.mjs';
import { assertLoopbackUrl, healthyCapabilities, probeExecutors, probeHttpExecutor } from '../src/compute/engine-probes.mjs';

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

test('HTTP engine probe honors health status', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const result = await probeHttpExecutor({ type: 'http', url: 'http://127.0.0.1:8188/execute', health_url: 'http://127.0.0.1:8188/health' }, fakeFetch);
  assert.equal(result.healthy, true);
  assert.equal(result.status, 200);
});

test('only healthy implementations are advertised to Core', async () => {
  const manifest = {
    publicCapabilities: [
      { capability: 'image.generate', implementation: 'image.local' },
      { capability: 'video.generate', implementation: 'video.local' }
    ],
    executors: new Map([
      ['image.local', { type: 'http', url: 'http://127.0.0.1:8188/image', health_url: 'http://127.0.0.1:8188/health' }],
      ['video.local', { type: 'http', url: 'http://127.0.0.1:8288/video', health_url: 'http://127.0.0.1:8288/health' }]
    ])
  };
  const fakeFetch = async (url) => new Response('', { status: String(url).includes('8188') ? 200 : 503 });
  const health = await probeExecutors(manifest, fakeFetch);
  const advertised = healthyCapabilities(manifest, health);
  assert.deepEqual(advertised.map((item) => item.implementation), ['image.local']);
});
