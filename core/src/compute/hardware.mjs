import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MIB = 1024 * 1024;

function number(value, fallback = 0) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); }
  catch { return ''; }
}

function realBasename(file) {
  try { return path.basename(fs.realpathSync(file)); }
  catch { return null; }
}

function execText(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 5_000,
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

export function parseNvidiaInventoryCsv(text = '') {
  return String(text).trim().split('\n').filter(Boolean).map((line) => {
    const fields = line.split(',').map((v) => v.trim());
    const [model, uuid, mib, driver] = fields;
    const compute = fields[4] || null;
    return {
      vendor: 'nvidia',
      model: model || 'unknown',
      uuid: uuid || null,
      vram_bytes: Math.max(0, Math.floor(number(mib) * MIB)),
      driver: driver || null,
      compute
    };
  });
}

export function parseNvidiaLoadCsv(text = '') {
  return String(text).trim().split('\n').filter(Boolean).map((line) => {
    const [uuid, used, total, util, temp, power] = line.split(',').map((v) => v.trim());
    const totalBytes = Math.max(0, Math.floor(number(total) * MIB));
    const usedBytes = Math.max(0, Math.floor(number(used) * MIB));
    return {
      vendor: 'nvidia',
      uuid: uuid || null,
      memory_used_bytes: usedBytes,
      memory_total_bytes: totalBytes,
      memory_free_bytes: Math.max(0, totalBytes - usedBytes),
      utilization_percent: Math.max(0, Math.min(100, number(util))),
      temperature_c: number(temp, null),
      power_watts: number(power, null)
    };
  });
}

function nvidiaInventory() {
  const format = '--format=csv,noheader,nounits';
  try {
    return parseNvidiaInventoryCsv(execText('nvidia-smi', [
      '--query-gpu=name,uuid,memory.total,driver_version,compute_cap', format
    ]));
  } catch {
    try {
      return parseNvidiaInventoryCsv(execText('nvidia-smi', [
        '--query-gpu=name,uuid,memory.total,driver_version', format
      ]));
    } catch { return []; }
  }
}

function nvidiaLoad() {
  try {
    return parseNvidiaLoadCsv(execText('nvidia-smi', [
      '--query-gpu=uuid,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw',
      '--format=csv,noheader,nounits'
    ]));
  } catch { return []; }
}

export function amdInventoryFromSysfs(root = '/sys/class/drm') {
  if (process.platform !== 'linux' && root === '/sys/class/drm') return [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
  const gpus = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^card\d+$/.test(entry.name)) continue;
    const device = path.join(root, entry.name, 'device');
    if (readText(path.join(device, 'vendor')).toLowerCase() !== '0x1002') continue;
    const total = number(readText(path.join(device, 'mem_info_vram_total')));
    const pci = readText(path.join(device, 'uevent'));
    const slot = pci.split('\n').find((line) => line.startsWith('PCI_SLOT_NAME='))?.split('=')[1] || entry.name;
    const deviceId = readText(path.join(device, 'device')) || 'unknown';
    gpus.push({
      vendor: 'amd',
      model: `AMD GPU ${deviceId}`,
      uuid: `pci:${slot}`,
      vram_bytes: Math.max(0, Math.floor(total)),
      driver: realBasename(path.join(device, 'driver')),
      compute: 'rocm'
    });
  }
  return gpus;
}

export function amdLoadFromSysfs(root = '/sys/class/drm') {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
  const gpus = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^card\d+$/.test(entry.name)) continue;
    const device = path.join(root, entry.name, 'device');
    if (readText(path.join(device, 'vendor')).toLowerCase() !== '0x1002') continue;
    const total = number(readText(path.join(device, 'mem_info_vram_total')));
    const used = number(readText(path.join(device, 'mem_info_vram_used')));
    const busy = number(readText(path.join(device, 'gpu_busy_percent')), null);
    const uevent = readText(path.join(device, 'uevent'));
    const slot = uevent.split('\n').find((line) => line.startsWith('PCI_SLOT_NAME='))?.split('=')[1] || entry.name;
    gpus.push({
      vendor: 'amd',
      uuid: `pci:${slot}`,
      memory_used_bytes: Math.max(0, Math.floor(used)),
      memory_total_bytes: Math.max(0, Math.floor(total)),
      memory_free_bytes: Math.max(0, Math.floor(total - used)),
      utilization_percent: busy == null ? null : Math.max(0, Math.min(100, busy)),
      temperature_c: null,
      power_watts: null
    });
  }
  return gpus;
}

function diskFreeBytes(directory = '/') {
  try {
    const stat = fs.statfsSync(directory);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch { return 0; }
}

export function discoverHardware() {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpu_count: os.cpus().length,
    memory_bytes: os.totalmem(),
    disk_free_bytes: diskFreeBytes('/'),
    gpus: [...nvidiaInventory(), ...amdInventoryFromSysfs()],
    runtime: {
      node: process.version,
      kernel: os.release(),
      agent_platform: 'mccluster-compute'
    }
  };
}

export function loadSnapshot(runningLeases = 0) {
  return {
    running_leases: Math.max(0, Number(runningLeases) || 0),
    memory_free_bytes: os.freemem(),
    disk_free_bytes: diskFreeBytes('/'),
    gpu: [...nvidiaLoad(), ...amdLoadFromSysfs()]
  };
}
