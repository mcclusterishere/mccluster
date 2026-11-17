// Windows GPU discovery over recorded-style fixtures (no PowerShell, no reg.exe,
// no nvidia-smi on the test host). The probe is driven through an injectable
// exec so the win32 path runs on Linux CI exactly as it would on the laptop.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import {
  deriveHardwareMode,
  discoverHardware,
  mergeWindowsGpuInventory,
  parseNvidiaInventoryCsv,
  parseWindowsDisplayClassReg,
  parseWindowsVideoControllers,
  windowsInventory
} from '../src/compute/hardware.mjs';
import { isPositiveGpuEvidence } from '../src/compute/node-agent-config.mjs';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/windows-hardware/${name}`, import.meta.url), 'utf8');
const ENV = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' };
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const REG = 'C:\\Windows\\System32\\reg.exe';
const NVIDIA_PATHS = ['nvidia-smi', 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe', 'C:\\Windows\\System32\\nvidia-smi.exe'];

function fakeExec({ cim, reg, nvidia } = {}) {
  const calls = [];
  const missing = (command) => Object.assign(new Error(`spawnSync ${command} ENOENT`), { code: 'ENOENT' });
  const exec = (command, args) => {
    calls.push({ command, args });
    if (/nvidia-smi/i.test(command)) {
      if (typeof nvidia === 'string') return nvidia;
      throw missing(command);
    }
    if (/powershell\.exe$/i.test(command)) {
      if (cim instanceof Error) throw cim;
      if (cim === undefined) throw missing(command);
      return cim;
    }
    if (/reg\.exe$/i.test(command)) {
      if (reg === undefined) throw missing(command);
      return reg;
    }
    throw new Error(`unexpected command ${command}`);
  };
  return { exec, calls };
}

const distinct = (values) => values.filter((value, index) => values.indexOf(value) === index);

test('CIM JSON parses as one object or an array, never throws, and derives the vendor from the PNP id', () => {
  const one = parseWindowsVideoControllers(fixture('cim-780m-only.json'));
  assert.equal(one.length, 1);
  assert.equal(one[0].name, 'AMD Radeon 780M Graphics');
  assert.equal(one[0].vendor, 'amd');
  assert.equal(one[0].vendor_id, '1002');
  assert.equal(one[0].pnp_device_id, 'PCI\\VEN_1002&DEV_15BF&SUBSYS_8B4A103C&REV_C1\\3&11583659&0&08');
  assert.equal(one[0].adapter_ram_bytes, 536870912);
  assert.equal(one[0].driver_version, '32.0.13031.3015');

  const two = parseWindowsVideoControllers(fixture('cim-780m-rx7600s.json'));
  assert.deepEqual(two.map((item) => item.name), ['AMD Radeon 780M Graphics', 'AMD Radeon RX 7600S']);
  assert.equal(two[1].adapter_ram_bytes, 4293918720);

  const nvidia = parseWindowsVideoControllers(fixture('cim-nvidia-desktop.json'));
  assert.equal(nvidia[0].vendor, 'nvidia');
  assert.equal(nvidia[0].vendor_id, '10DE');

  const basic = parseWindowsVideoControllers(fixture('cim-no-gpu.json'));
  assert.equal(basic[0].vendor, 'unknown');
  assert.equal(basic[0].adapter_ram_bytes, 0);

  assert.deepEqual(parseWindowsVideoControllers(''), []);
  assert.deepEqual(parseWindowsVideoControllers('null'), []);
  assert.deepEqual(parseWindowsVideoControllers(fixture('powershell-error.txt')), []);
  // Vendor falls back to AdapterCompatibility when the PNP id carries no VEN_.
  assert.equal(parseWindowsVideoControllers(JSON.stringify({ Name: 'x', AdapterCompatibility: 'Intel Corporation', PNPDeviceID: 'ROOT\\X' }))[0].vendor, 'intel');
});

test('the display-class registry dump yields subkeys with REG_QWORD memory sizes and ignores denied keys', () => {
  const entries = parseWindowsDisplayClassReg(fixture('reg-780m-rx7600s.txt'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].subkey, '0000');
  assert.equal(entries[0].driver_desc, 'AMD Radeon 780M Graphics');
  assert.equal(entries[0].matching_device_id, 'PCI\\VEN_1002&DEV_15BF&SUBSYS_8B4A103C');
  assert.equal(entries[0].qw_memory_size_bytes, 536870912);
  assert.equal(entries[0].driver_version, '32.0.13031.3015');
  assert.equal(entries[1].subkey, '0001');
  assert.equal(entries[1].qw_memory_size_bytes, 8589934592, 'the QWORD above 4 GiB is read exactly');
  assert.deepEqual(parseWindowsDisplayClassReg(fixture('reg-no-gpu.txt')), []);
  assert.deepEqual(parseWindowsDisplayClassReg('ERROR: Access is denied.\r\n'), []);
  assert.deepEqual(parseWindowsDisplayClassReg(''), []);
  const decimal = parseWindowsDisplayClassReg('HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0002\r\n    HardwareInformation.qwMemorySize    REG_QWORD    1073741824\r\n');
  assert.equal(decimal[0].qw_memory_size_bytes, 1073741824);
  assert.equal(decimal[0].driver_desc, null);
});

test('780M only: integrated shared-memory APU with its VRAM from the registry and a Vulkan compute path', () => {
  const { exec } = fakeExec({ cim: fixture('cim-780m-only.json'), reg: fixture('reg-780m-only.txt') });
  const { gpus, probe } = windowsInventory({ exec, env: ENV });
  assert.equal(gpus.length, 1);
  assert.deepEqual(gpus[0], {
    vendor: 'amd',
    model: 'AMD Radeon 780M Graphics',
    uuid: 'pnp:PCI\\VEN_1002&DEV_15BF&SUBSYS_8B4A103C&REV_C1\\3&11583659&0&08',
    vram_bytes: 536870912,
    driver: '32.0.13031.3015',
    compute: 'vulkan',
    form: 'integrated',
    memory: 'shared',
    vram_source: 'registry'
  });
  assert.equal(probe.ok, true);
  assert.equal(probe.platform, 'win32');
  assert.deepEqual(probe.methods, ['nvidia-smi', 'win32-cim', 'win32-reg']);
  assert.deepEqual(probe.errors, []);
  assert.deepEqual(probe.ignored_controllers, []);
  assert.equal(deriveHardwareMode({ gpus, probe, gpuVerifiedAt: null }), 'gpu-present-unverified');
});

test('780M plus RX 7600S: the discrete card reads 8 GiB from the registry, never the wrapped AdapterRAM', () => {
  const { exec } = fakeExec({ cim: fixture('cim-780m-rx7600s.json'), reg: fixture('reg-780m-rx7600s.txt') });
  const { gpus, probe } = windowsInventory({ exec, env: ENV });
  assert.deepEqual(gpus.map((gpu) => gpu.model), ['AMD Radeon 780M Graphics', 'AMD Radeon RX 7600S'], 'CIM order');
  const discrete = gpus[1];
  assert.equal(discrete.vram_bytes, 8589934592);
  assert.notEqual(discrete.vram_bytes, 4293918720, 'AdapterRAM is a wrapped uint32 and must not be used');
  assert.equal(discrete.vram_source, 'registry');
  assert.equal(discrete.form, 'discrete');
  assert.equal(discrete.memory, 'dedicated');
  assert.equal(discrete.compute, 'vulkan');
  assert.equal(discrete.uuid, 'pnp:PCI\\VEN_1002&DEV_7480&SUBSYS_8B4B103C&REV_C1\\4&2C9A3B1F&0&0008');
  assert.equal(gpus[0].form, 'integrated');
  assert.equal(probe.ok, true);
});

test('NVIDIA desktop with nvidia-smi: exactly one GPU from nvidia-smi, the CIM duplicate dropped', () => {
  const { exec, calls } = fakeExec({ cim: fixture('cim-nvidia-desktop.json'), reg: fixture('reg-nvidia-desktop.txt'), nvidia: fixture('nvidia-smi-desktop.csv') });
  const { gpus, probe } = windowsInventory({ exec, env: ENV });
  assert.equal(gpus.length, 1);
  assert.deepEqual(gpus[0], {
    vendor: 'nvidia',
    model: 'NVIDIA GeForce RTX 4070',
    uuid: 'GPU-0f3c9a6e-7b1d-4c2e-9a8f-1234567890ab',
    vram_bytes: 12282 * 1048576,
    driver: '566.03',
    compute: '8.9',
    form: 'discrete',
    memory: 'dedicated',
    vram_source: 'nvidia-smi'
  });
  assert.deepEqual(probe.errors, []);
  assert.equal(calls.filter((call) => /nvidia-smi/i.test(call.command)).length, 1, 'first success wins');
});

test('NVIDIA desktop without nvidia-smi: CIM plus registry describe the card and the probe says nvidia-smi was unavailable', () => {
  const { exec, calls } = fakeExec({ cim: fixture('cim-nvidia-desktop.json'), reg: fixture('reg-nvidia-desktop.txt') });
  const { gpus, probe } = windowsInventory({ exec, env: ENV });
  assert.equal(gpus.length, 1);
  assert.equal(gpus[0].vendor, 'nvidia');
  assert.equal(gpus[0].vram_bytes, 12884901888);
  assert.equal(gpus[0].vram_source, 'registry');
  assert.equal(gpus[0].compute, 'cuda');
  assert.equal(gpus[0].form, 'discrete');
  assert.equal(gpus[0].memory, 'dedicated');
  assert.equal(gpus[0].uuid, 'pnp:PCI\\VEN_10DE&DEV_2786&SUBSYS_88E51043&REV_A1\\4&1A2B3C4D&0&0019');
  assert.ok(probe.errors.includes('nvidia-smi: unavailable for an NVIDIA adapter'), JSON.stringify(probe.errors));
  assert.equal(probe.ok, true);
  const nvidiaCalls = calls.filter((call) => /nvidia-smi/i.test(call.command)).map((call) => call.command);
  assert.deepEqual(distinct(nvidiaCalls), NVIDIA_PATHS, 'PATH first, then the two absolute Windows locations, in that order');
  assert.equal(nvidiaCalls.length, 6, 'both query forms per location');
});

test('the probe invokes PowerShell and reg.exe from SystemRoot with the exact arguments', () => {
  const { exec, calls } = fakeExec({ cim: fixture('cim-780m-only.json'), reg: fixture('reg-780m-only.txt') });
  windowsInventory({ exec, env: ENV });
  const ps = calls.find((call) => /powershell\.exe$/i.test(call.command));
  assert.equal(ps.command, POWERSHELL);
  assert.deepEqual(ps.args.slice(0, 6), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,DriverVersion,PNPDeviceID,AdapterRAM,VideoProcessor,Status | ConvertTo-Json -Compress']);
  const reg = calls.find((call) => /reg\.exe$/i.test(call.command));
  assert.equal(reg.command, REG);
  assert.deepEqual(reg.args, ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}', '/s']);
});

test('a missing SystemRoot PowerShell falls back to powershell.exe on PATH', () => {
  const calls = [];
  const exec = (command, args) => {
    calls.push(command);
    if (command === 'powershell.exe') return fixture('cim-780m-only.json');
    if (command === 'reg.exe') return fixture('reg-780m-only.txt');
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  const { gpus, probe } = windowsInventory({ exec, env: ENV });
  assert.equal(gpus.length, 1);
  assert.equal(probe.ok, true);
  assert.ok(calls.indexOf(POWERSHELL) < calls.indexOf('powershell.exe'));
  assert.ok(calls.indexOf(REG) < calls.indexOf('reg.exe'));
});

test('Microsoft Basic Display Adapter is not an accelerator: no GPUs, probe ok, cpu-only', () => {
  const { exec } = fakeExec({ cim: fixture('cim-no-gpu.json'), reg: fixture('reg-no-gpu.txt') });
  const { gpus, probe } = windowsInventory({ exec, env: ENV });
  assert.deepEqual(gpus, []);
  assert.equal(probe.ok, true);
  assert.deepEqual(probe.ignored_controllers, ['Microsoft Basic Display Adapter']);
  assert.equal(deriveHardwareMode({ gpus, probe, gpuVerifiedAt: null }), 'cpu-only');
});

test('a PowerShell failure leaves the probe not ok with a prefixed error and the mode unknown', () => {
  const failure = Object.assign(new Error('Command failed: powershell.exe'), { status: 1, stderr: fixture('powershell-error.txt') });
  const { exec } = fakeExec({ cim: failure, reg: fixture('reg-no-gpu.txt') });
  const { gpus, probe } = windowsInventory({ exec, env: ENV });
  assert.deepEqual(gpus, []);
  assert.equal(probe.ok, false);
  assert.ok(probe.errors[0].startsWith('win32-cim: '), probe.errors[0]);
  assert.match(probe.errors[0], /Access denied/);
  assert.ok(probe.errors[0].length <= 220);
  assert.equal(deriveHardwareMode({ gpus, probe, gpuVerifiedAt: null }), 'unknown');
});

test('non-JSON PowerShell output is a failed probe, and a reg.exe failure only degrades the VRAM source', () => {
  const garbage = fakeExec({ cim: 'WARNING: something\r\n', reg: fixture('reg-780m-only.txt') });
  const broken = windowsInventory({ exec: garbage.exec, env: ENV });
  assert.equal(broken.probe.ok, false);
  assert.deepEqual(broken.gpus, []);
  assert.ok(broken.probe.errors.some((error) => error.startsWith('win32-cim: ')));

  const noReg = fakeExec({ cim: fixture('cim-780m-only.json') });
  const degraded = windowsInventory({ exec: noReg.exec, env: ENV });
  assert.equal(degraded.probe.ok, true);
  assert.equal(degraded.gpus.length, 1);
  assert.equal(degraded.gpus[0].vram_bytes, 536870912, 'AdapterRAM is the only source left');
  assert.equal(degraded.gpus[0].vram_source, 'cim');
  assert.ok(degraded.probe.errors.some((error) => error.startsWith('win32-reg: ')), JSON.stringify(degraded.probe.errors));
});

test('errors never carry a Windows user path', () => {
  const failure = Object.assign(new Error('Command failed'), { stderr: 'At C:\\Users\\someone\\probe.ps1:1 char:1\r\nAccess denied' });
  const { exec } = fakeExec({ cim: failure });
  const { probe } = windowsInventory({ exec, env: ENV });
  assert.doesNotMatch(probe.errors.join('\n'), /\\Users\\someone/);
});

test('merge rules: exclusions, prefix matching, zero VRAM, and vendor form classes', () => {
  const controllers = [
    { name: 'Intel(R) UHD Graphics 770', adapter_compatibility: 'Intel Corporation', driver_version: '31.0.101.2125', pnp_device_id: 'PCI\\VEN_8086&DEV_4680&SUBSYS_00000000&REV_0C\\3&11583659&0&10', adapter_ram_bytes: 1073741824, video_processor: null, status: 'OK', vendor: 'intel', vendor_id: '8086' },
    { name: 'Intel(R) Arc(TM) A770 Graphics', adapter_compatibility: 'Intel Corporation', driver_version: '31.0.101.2125', pnp_device_id: 'PCI\\VEN_8086&DEV_56A0&SUBSYS_00000000&REV_08\\4&0&0&0008', adapter_ram_bytes: 0, video_processor: null, status: 'OK', vendor: 'intel', vendor_id: '8086' },
    { name: 'Parsec Virtual Display Adapter', adapter_compatibility: 'Parsec', driver_version: '0.45', pnp_device_id: 'ROOT\\DISPLAY\\0000', adapter_ram_bytes: 0, video_processor: null, status: 'OK', vendor: 'unknown', vendor_id: null },
    { name: 'Some PCI adapter', adapter_compatibility: 'Unknown Co', driver_version: null, pnp_device_id: 'PCI\\VEN_1234&DEV_0001\\0', adapter_ram_bytes: 0, video_processor: null, status: 'OK', vendor: 'unknown', vendor_id: '1234' }
  ];
  const reg = [
    { subkey: '0000', driver_desc: 'Intel(R) UHD Graphics 770', matching_device_id: 'PCI\\VEN_8086&DEV_4680', qw_memory_size_bytes: 134217728, driver_version: '31.0.101.2125' },
    { subkey: '0001', driver_desc: 'Intel(R) UHD Graphics 770', matching_device_id: 'PCI\\VEN_8086&DEV_4680&SUBSYS_00000000', qw_memory_size_bytes: 268435456, driver_version: '31.0.101.2125' }
  ];
  const merged = mergeWindowsGpuInventory(controllers, reg, []);
  assert.deepEqual(merged.ignored_controllers, ['Parsec Virtual Display Adapter']);
  assert.equal(merged.gpus.length, 3);
  const [uhd, arc, other] = merged.gpus;
  assert.equal(uhd.vram_bytes, 268435456, 'the longest matching_device_id prefix wins');
  assert.equal(uhd.form, 'integrated');
  assert.equal(uhd.memory, 'shared');
  assert.equal(uhd.compute, 'vulkan');
  assert.equal(arc.form, 'discrete');
  assert.equal(arc.memory, 'dedicated');
  assert.equal(arc.vram_bytes, 0);
  assert.equal(arc.vram_source, 'none');
  assert.equal(other.form, 'unknown');
  assert.equal(other.memory, 'unknown');
  assert.equal(other.compute, null);
  assert.deepEqual(merged.errors, []);

  const byDesc = mergeWindowsGpuInventory(
    [{ name: 'AMD Radeon(TM) Graphics', adapter_compatibility: 'Advanced Micro Devices, Inc.', driver_version: null, pnp_device_id: 'PCI\\VEN_1002&DEV_164C\\X', adapter_ram_bytes: 0, video_processor: null, status: 'OK', vendor: 'amd', vendor_id: '1002' }],
    [{ subkey: '0003', driver_desc: 'amd radeon(tm) graphics', matching_device_id: 'PCI\\VEN_1002&DEV_FFFF', qw_memory_size_bytes: 536870912, driver_version: null }],
    []
  );
  assert.equal(byDesc.gpus[0].vram_bytes, 536870912, 'DriverDesc equality (case-insensitive) is the fallback match');
  assert.equal(byDesc.gpus[0].form, 'integrated');
});

test('a stale driver subkey with the same MatchingDeviceId never shadows the live one', () => {
  const controllers = parseWindowsVideoControllers(fixture('cim-780m-only.json'));
  const entries = parseWindowsDisplayClassReg(fixture('reg-780m-stale-subkey.txt'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].subkey, '0000');
  assert.equal(entries[0].qw_memory_size_bytes, null, 'the leftover of the earlier install carries no memory size');
  assert.equal(entries[1].qw_memory_size_bytes, 536870912);
  const merged = mergeWindowsGpuInventory(controllers, entries, []);
  assert.equal(merged.gpus.length, 1);
  assert.equal(merged.gpus[0].vram_bytes, 536870912, 'the subkey with a memory size wins among equal-length matches');
  assert.equal(merged.gpus[0].vram_source, 'registry');
  assert.equal(merged.gpus[0].driver, '32.0.13031.3015');

  const same = 'PCI\\VEN_1002&DEV_15BF&SUBSYS_8B4A103C';
  const bothSized = mergeWindowsGpuInventory(controllers, [
    { subkey: '0001', driver_desc: 'AMD Radeon 780M Graphics', matching_device_id: same, qw_memory_size_bytes: 268435456, driver_version: 'new' },
    { subkey: '0000', driver_desc: 'AMD Radeon 780M Graphics', matching_device_id: same, qw_memory_size_bytes: 134217728, driver_version: 'old' }
  ], []);
  assert.equal(bothSized.gpus[0].vram_bytes, 268435456, 'both sized: the highest subkey (the latest install) wins, whatever the order');

  const longer = mergeWindowsGpuInventory(controllers, [
    { subkey: '0000', driver_desc: 'AMD Radeon 780M Graphics', matching_device_id: same, qw_memory_size_bytes: null, driver_version: null },
    { subkey: '0001', driver_desc: 'AMD Radeon 780M Graphics', matching_device_id: 'PCI\\VEN_1002&DEV_15BF', qw_memory_size_bytes: 536870912, driver_version: null }
  ], []);
  assert.equal(longer.gpus[0].vram_source, 'cim', 'a longer MatchingDeviceId still outranks a shorter one; AdapterRAM is then the fallback');

  const byDesc = mergeWindowsGpuInventory(
    [{ name: 'AMD Radeon 780M Graphics', adapter_compatibility: 'Advanced Micro Devices, Inc.', driver_version: null, pnp_device_id: 'PCI\\VEN_1002&DEV_FFFF\\X', adapter_ram_bytes: 0, video_processor: null, status: 'OK', vendor: 'amd', vendor_id: '1002' }],
    [
      { subkey: '0000', driver_desc: 'AMD Radeon 780M Graphics', matching_device_id: 'PCI\\VEN_1002&DEV_0000', qw_memory_size_bytes: null, driver_version: null },
      { subkey: '0001', driver_desc: 'AMD Radeon 780M Graphics', matching_device_id: 'PCI\\VEN_1002&DEV_0000', qw_memory_size_bytes: 536870912, driver_version: null }
    ],
    []
  );
  assert.equal(byDesc.gpus[0].vram_source, 'registry', 'the DriverDesc fallback applies the same preference');

  const { exec } = fakeExec({ cim: fixture('cim-780m-only.json'), reg: fixture('reg-780m-stale-subkey.txt') });
  const probed = windowsInventory({ exec, env: ENV });
  assert.equal(probed.gpus[0].vram_source, 'registry', 'through the whole Windows probe too');
  assert.equal(probed.gpus[0].vram_bytes, 536870912);
});

test('when nvidia-smi answered, every NVIDIA CIM controller is dropped, whatever CIM calls the card', () => {
  const controllers = parseWindowsVideoControllers(fixture('cim-nvidia-desktop.json'));
  const smi = parseNvidiaInventoryCsv('NVIDIA GeForce RTX 4070 SUPER, GPU-1, 12282, 566.03, 8.9\n');
  const merged = mergeWindowsGpuInventory(controllers, [], smi);
  assert.deepEqual(merged.gpus.map((gpu) => gpu.model), ['NVIDIA GeForce RTX 4070 SUPER'], 'one card, one entry');
  assert.deepEqual(merged.errors, []);
  const mixed = mergeWindowsGpuInventory([...parseWindowsVideoControllers(fixture('cim-780m-only.json')), ...controllers], [], smi);
  assert.deepEqual(mixed.gpus.map((gpu) => [gpu.vendor, gpu.vram_source]), [['nvidia', 'nvidia-smi'], ['amd', 'cim']], 'other vendors still come from CIM');
});

test('nvidia-smi entries carry the per-GPU form, memory and source fields', () => {
  const [gpu] = parseNvidiaInventoryCsv('NVIDIA RTX 4090, GPU-abc, 24564, 590.1, 8.9\n');
  assert.equal(gpu.form, 'discrete');
  assert.equal(gpu.memory, 'dedicated');
  assert.equal(gpu.vram_source, 'nvidia-smi');
});

test('deriveHardwareMode: evidence within the TTL wins, stale evidence does not, CPU-only loads never verify', () => {
  const now = Date.parse('2026-11-17T20:00:00.000Z');
  const gpus = [{ vendor: 'amd', model: 'AMD Radeon 780M Graphics', vram_bytes: 536870912 }];
  const okProbe = { ok: true, platform: 'win32', methods: [], errors: [], ignored_controllers: [] };
  const badProbe = { ...okProbe, ok: false };
  const fresh = new Date(now - 3_600_000).toISOString();
  const stale = new Date(now - 86_400_001).toISOString();
  assert.equal(deriveHardwareMode({ gpus, probe: okProbe, gpuVerifiedAt: fresh, now }), 'gpu-verified');
  assert.equal(deriveHardwareMode({ gpus: [], probe: badProbe, gpuVerifiedAt: fresh, now }), 'gpu-verified', 'engine evidence outranks the probe');
  assert.equal(deriveHardwareMode({ gpus, probe: okProbe, gpuVerifiedAt: stale, now }), 'gpu-present-unverified');
  assert.equal(deriveHardwareMode({ gpus, probe: okProbe, gpuVerifiedAt: stale, now, ttlMs: 7 * 86_400_000 }), 'gpu-verified', 'the TTL is configurable');
  assert.equal(deriveHardwareMode({ gpus, probe: badProbe, gpuVerifiedAt: null, now }), 'gpu-present-unverified');
  assert.equal(deriveHardwareMode({ gpus: [], probe: okProbe, gpuVerifiedAt: null, now }), 'cpu-only');
  assert.equal(deriveHardwareMode({ gpus: [], probe: badProbe, gpuVerifiedAt: null, now }), 'unknown');
  assert.equal(deriveHardwareMode({ gpus: [], probe: null, gpuVerifiedAt: 'not a date', now }), 'unknown');
  assert.equal(deriveHardwareMode({}), 'unknown');
  // The ollama-runtime fixture: a model loaded on CPU (size_vram 0) is not GPU evidence.
  assert.equal(isPositiveGpuEvidence({ source: 'ollama:/api/ps', model: 'qwen3:8b', size_vram_bytes: 0, size_bytes: 123, checked_at: fresh }), false);
  assert.equal(isPositiveGpuEvidence({ source: 'ollama:/api/ps', model: 'qwen3:8b', size_vram_bytes: 1, size_bytes: 123, checked_at: fresh }), true);
  assert.equal(isPositiveGpuEvidence(null), false);
});

test('discoverHardware runs the win32 path on any host when told to, and keeps the POSIX path otherwise', () => {
  const { exec } = fakeExec({ cim: fixture('cim-780m-only.json'), reg: fixture('reg-780m-only.txt') });
  const hardware = discoverHardware({ platform: 'win32', exec, env: ENV, diskPath: os.tmpdir() });
  assert.equal(hardware.platform, 'win32');
  assert.equal(hardware.gpus.length, 1);
  assert.equal(hardware.gpus[0].vendor, 'amd');
  assert.equal(hardware.runtime.gpu_probe.ok, true);
  assert.deepEqual(hardware.runtime.gpu_probe.methods, ['nvidia-smi', 'win32-cim', 'win32-reg']);
  assert.equal(hardware.runtime.memory_architecture, 'unspecified');
  assert.ok(hardware.disk_free_bytes > 0, 'free space is read from the state directory volume');
  assert.equal(hardware.runtime.hardware_mode, undefined, 'the node agent derives the mode; discovery only reports evidence');

  const local = discoverHardware({ diskPath: os.tmpdir() });
  assert.equal(local.platform, process.platform);
  assert.equal(local.runtime.gpu_probe.platform, process.platform);
  assert.ok(local.runtime.gpu_probe.methods.includes('nvidia-smi'));
  assert.equal(typeof local.runtime.gpu_probe.ok, 'boolean');
  assert.ok(Array.isArray(local.gpus));
});
