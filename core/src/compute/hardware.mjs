import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MIB = 1024 * 1024;
// Engine evidence (a model loaded with VRAM) keeps a node gpu-verified this long.
export const GPU_EVIDENCE_TTL_MS = 86_400_000;

const NVIDIA_FORMAT = '--format=csv,noheader,nounits';
const NVIDIA_QUERIES = [
  '--query-gpu=name,uuid,memory.total,driver_version,compute_cap',
  '--query-gpu=name,uuid,memory.total,driver_version'
];
const NVIDIA_LOAD_QUERY = '--query-gpu=uuid,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw';

// Windows: the display adapter class in the registry and the CIM controller class.
const DISPLAY_CLASS_GUID = '{4d36e968-e325-11ce-bfc1-08002be10318}';
const DISPLAY_CLASS_KEY = `HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\${DISPLAY_CLASS_GUID}`;
const DISPLAY_CLASS_PREFIX = `HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\${DISPLAY_CLASS_GUID}\\`;
const CIM_COMMAND = 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,DriverVersion,PNPDeviceID,AdapterRAM,VideoProcessor,Status | ConvertTo-Json -Compress';
const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', CIM_COMMAND];
const NON_ACCELERATOR = /Basic Display|Basic Render|Remote Display|Virtual|VMware|Hyper-V|Parsec|DisplayLink|RDP/i;
const VENDOR_BY_PCI_ID = { '1002': 'amd', '10DE': 'nvidia', '8086': 'intel' };
const AMD_INTEGRATED = /\bVega \d+ Graphics\b|\b\d{3}M\b|Radeon\(TM\) Graphics|Radeon Graphics$/i;
const AMD_DISCRETE = /\bRX\b|\bPRO\b|\bW\d{4}\b/i;
// Windows names the Arc cards "Intel(R) Arc(TM) A770 Graphics"; the (TM) is optional here.
const INTEL_DISCRETE = /\bArc(?:\(TM\))?\s+[AB]\d{3}\b/i;

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

// stderr is captured so a failed probe can say why (bounded, user paths masked).
function execText(command, args, { timeout = 5_000 } = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function safeErrorText(error) {
  const raw = String(error?.stderr || error?.message || error || 'unknown error');
  const line = raw.split(/\r?\n/).map((part) => part.trim()).find(Boolean) || 'unknown error';
  return line
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/gi, '<user-dir>')
    .replace(/\\Users\\[^\\\s"']+/gi, '\\<user-dir>')
    .slice(0, 200);
}

// Try each candidate executable in order; the first success wins and the
// last failure is reported.
function firstSuccess(exec, candidates, argsFor) {
  let lastError = null;
  for (const command of candidates) {
    try { return { text: exec(command, argsFor(command)), command, error: null }; }
    catch (error) { lastError = error; }
  }
  return { text: null, command: null, error: lastError || new Error('no candidate executable') };
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
      compute,
      form: 'discrete',
      memory: 'dedicated',
      vram_source: 'nvidia-smi'
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

// nvidia-smi on PATH everywhere; on Windows also its two usual absolute homes.
function nvidiaCandidates(platform, env) {
  if (platform !== 'win32') return ['nvidia-smi'];
  return [
    'nvidia-smi',
    `${env.ProgramFiles || 'C:\\Program Files'}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`,
    `${env.SystemRoot || 'C:\\Windows'}\\System32\\nvidia-smi.exe`
  ];
}

function nvidiaInventory({ exec = execText, platform = process.platform, env = process.env } = {}) {
  for (const command of nvidiaCandidates(platform, env)) {
    for (const query of NVIDIA_QUERIES) {
      try { return parseNvidiaInventoryCsv(exec(command, [query, NVIDIA_FORMAT])); }
      catch { /* next query form, then the next location */ }
    }
  }
  return [];
}

function nvidiaLoad({ exec = execText, platform = process.platform, env = process.env } = {}) {
  for (const command of nvidiaCandidates(platform, env)) {
    try { return parseNvidiaLoadCsv(exec(command, [NVIDIA_LOAD_QUERY, NVIDIA_FORMAT])); }
    catch { /* next location */ }
  }
  return [];
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
      compute: 'rocm',
      form: 'unknown',
      memory: 'unknown',
      vram_source: 'sysfs'
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

// Free space of the volume that holds `directory` (the node's state dir); the
// volume root is the fallback when the directory does not exist yet.
function diskFreeBytes(directory = null, platform = process.platform) {
  const candidates = directory
    ? [directory, path.parse(path.resolve(directory)).root]
    : [platform === 'win32' ? path.parse(process.cwd()).root : '/'];
  for (const candidate of candidates) {
    try {
      const stat = fs.statfsSync(candidate);
      return Number(stat.bavail) * Number(stat.bsize);
    } catch { /* next */ }
  }
  return 0;
}

export function parseAppleDisplayInventory(text = '{}') {
  const data = JSON.parse(text);
  return (Array.isArray(data.SPDisplaysDataType) ? data.SPDisplaysDataType : [])
    .filter((item) => /apple/i.test(String(item.sppci_model || item._name || '')))
    .map((item) => ({ vendor: 'apple', model: item.sppci_model || item._name,
      uuid: null, vram_bytes: 0, driver: null,
      compute: /metal/i.test(String(item.spdisplays_metal || item.spdisplays_mtlgpufamilysupport || '')) ? 'metal' : null,
      form: 'integrated', memory: 'shared', vram_source: 'none' }));
}

function appleInventory({ exec = execText, platform = process.platform } = {}) {
  if (platform !== 'darwin' || process.arch !== 'arm64') return [];
  try { return parseAppleDisplayInventory(exec('system_profiler', ['SPDisplaysDataType', '-json'])); }
  catch { return []; }
}

// ---------------------------------------------------------------------------
// Windows discovery: pure parsers over recorded-style command output.

function vendorFromCompatibility(value) {
  const text = String(value || '');
  if (/advanced micro|\bAMD\b|\bATI\b/i.test(text)) return 'amd';
  if (/nvidia/i.test(text)) return 'nvidia';
  if (/intel/i.test(text)) return 'intel';
  return 'unknown';
}

function optionalString(value) {
  return value == null ? null : String(value);
}

// `Get-CimInstance Win32_VideoController | ... | ConvertTo-Json -Compress`:
// one object for one controller, an array for several. Never throws.
export function parseWindowsVideoControllers(text = '') {
  let data;
  try { data = JSON.parse(String(text ?? '').trim() || 'null'); }
  catch { return []; }
  const items = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
  return items.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => {
    const pnp = item.PNPDeviceID == null ? '' : String(item.PNPDeviceID);
    const compatibility = optionalString(item.AdapterCompatibility);
    const vendorId = (pnp.match(/VEN_([0-9A-F]{4})/i) || [])[1]?.toUpperCase() || null;
    return {
      name: String(item.Name || 'unknown'),
      adapter_compatibility: compatibility,
      driver_version: optionalString(item.DriverVersion),
      pnp_device_id: pnp,
      adapter_ram_bytes: Math.max(0, Math.floor(Number(item.AdapterRAM) || 0)),
      video_processor: optionalString(item.VideoProcessor),
      status: optionalString(item.Status),
      vendor: VENDOR_BY_PCI_ID[vendorId] || vendorFromCompatibility(compatibility),
      vendor_id: vendorId
    };
  });
}

function parseRegistryNumber(value) {
  const text = String(value ?? '').trim();
  try {
    if (/^0x[0-9a-f]+$/i.test(text)) return Number(BigInt(text));
    if (/^\d+$/.test(text)) return Number(text);
  } catch { /* fall through */ }
  return null;
}

// `reg query HKLM\...\Class\{display} /s`: one subkey per adapter (0000, 0001,
// ...) with DriverDesc, MatchingDeviceId and the REG_QWORD memory size that
// does not wrap above 4 GiB as CIM's AdapterRAM does. Denied keys and unknown
// lines are ignored. Never throws.
export function parseWindowsDisplayClassReg(text = '') {
  const entries = [];
  const prefix = DISPLAY_CLASS_PREFIX.toUpperCase();
  let current = null;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line) continue;
    if (/^HKEY_/i.test(line)) {
      const rest = line.toUpperCase().startsWith(prefix) ? line.slice(DISPLAY_CLASS_PREFIX.length) : null;
      if (rest !== null && /^\d{4}$/.test(rest)) {
        current = { subkey: rest, driver_desc: null, matching_device_id: null, qw_memory_size_bytes: null, driver_version: null };
        entries.push(current);
      } else {
        current = null;
      }
      continue;
    }
    const match = line.match(/^\s{4}(\S+)\s{4}(REG_\w+)\s{4}(.*)$/);
    if (!match || !current) continue;
    const [, name, type, value] = match;
    const key = name.toLowerCase();
    if (key === 'driverdesc' && type === 'REG_SZ') current.driver_desc = value.trim();
    else if (key === 'matchingdeviceid' && type === 'REG_SZ') current.matching_device_id = value.trim().toUpperCase();
    else if (key === 'driverversion' && type === 'REG_SZ') current.driver_version = value.trim();
    else if (key === 'hardwareinformation.qwmemorysize') current.qw_memory_size_bytes = parseRegistryNumber(value);
  }
  return entries;
}

// Windows keeps the 00NN subkeys of earlier driver installs beside the live
// one, with the same MatchingDeviceId. Among equal-length prefix matches the
// subkey that carries a memory size wins (a stale one usually has none), then
// the highest subkey number (the latest install); the doctor applies the same
// rule (Select-McRegistryEntry in core/windows/mccluster-node.ps1).
function subkeyNumber(entry) {
  const n = Number.parseInt(String(entry?.subkey ?? ''), 10);
  return Number.isFinite(n) ? n : -1;
}

function preferRegistryEntry(candidate, best) {
  if (!best) return true;
  const candidateId = String(candidate.matching_device_id || '');
  const bestId = String(best.matching_device_id || '');
  if (candidateId.length !== bestId.length) return candidateId.length > bestId.length;
  const candidateHasMemory = Number(candidate.qw_memory_size_bytes) > 0;
  const bestHasMemory = Number(best.qw_memory_size_bytes) > 0;
  if (candidateHasMemory !== bestHasMemory) return candidateHasMemory;
  return subkeyNumber(candidate) > subkeyNumber(best);
}

function matchRegistryEntry(controller, regEntries) {
  const pnp = String(controller.pnp_device_id || '').toUpperCase();
  let best = null;
  for (const entry of regEntries) {
    const id = String(entry?.matching_device_id || '').toUpperCase();
    if (id && pnp.startsWith(id) && preferRegistryEntry(entry, best)) best = entry;
  }
  if (best) return best;
  const name = String(controller.name || '').toLowerCase();
  let byName = null;
  for (const entry of regEntries) {
    if (String(entry?.driver_desc || '').toLowerCase() !== name) continue;
    if (!byName || preferRegistryEntry(entry, byName)) byName = entry;
  }
  return byName;
}

function formFor(vendor, name) {
  const model = String(name || '');
  if (vendor === 'nvidia') return 'discrete';
  if (vendor === 'amd') {
    if (AMD_INTEGRATED.test(model)) return 'integrated';
    if (AMD_DISCRETE.test(model)) return 'discrete';
    return 'unknown';
  }
  if (vendor === 'intel') return INTEL_DISCRETE.test(model) ? 'discrete' : 'integrated';
  return 'unknown';
}

function memoryFor(form) {
  if (form === 'integrated') return 'shared';
  if (form === 'discrete') return 'dedicated';
  return 'unknown';
}

function computeFor(vendor) {
  if (vendor === 'nvidia') return 'cuda';
  if (vendor === 'amd' || vendor === 'intel') return 'vulkan';
  return null;
}

// Joins CIM controllers with their registry subkeys (longest MatchingDeviceId
// prefix of the PNP id, else equal DriverDesc) and lets nvidia-smi describe
// the NVIDIA cards: when it answered it is the authority for that vendor, so
// every NVIDIA CIM controller is dropped (CIM and nvidia-smi spell a card's
// name differently often enough that a name match would list it twice).
// Shared memory is stated as a field, never hidden in the VRAM number:
// vram_bytes is exactly what the registry (or nvidia-smi) reports.
export function mergeWindowsGpuInventory(controllers = [], regEntries = [], nvidiaSmiGpus = []) {
  const gpus = [...nvidiaSmiGpus];
  const ignored = [];
  const errors = [];
  let nvidiaWithoutSmi = false;
  for (const controller of controllers) {
    const pnp = String(controller.pnp_device_id || '');
    const name = String(controller.name || 'unknown');
    if (!/^PCI\\/i.test(pnp) || NON_ACCELERATOR.test(name)) {
      ignored.push(name);
      continue;
    }
    if (controller.vendor === 'nvidia') {
      if (nvidiaSmiGpus.length) continue; // nvidia-smi describes the NVIDIA cards
      nvidiaWithoutSmi = true;
    }
    const reg = matchRegistryEntry(controller, regEntries);
    const registryBytes = reg && Number(reg.qw_memory_size_bytes) > 0 ? Math.floor(Number(reg.qw_memory_size_bytes)) : 0;
    const vramBytes = registryBytes || Math.max(0, Math.floor(Number(controller.adapter_ram_bytes) || 0));
    const form = formFor(controller.vendor, name);
    gpus.push({
      vendor: controller.vendor || 'unknown',
      model: name,
      uuid: `pnp:${pnp}`,
      vram_bytes: vramBytes,
      driver: controller.driver_version || reg?.driver_version || null,
      compute: computeFor(controller.vendor),
      form,
      memory: memoryFor(form),
      vram_source: registryBytes ? 'registry' : (vramBytes ? 'cim' : 'none')
    });
  }
  if (nvidiaWithoutSmi) errors.push('nvidia-smi: unavailable for an NVIDIA adapter');
  return { gpus, ignored_controllers: ignored, errors };
}

function powershellCandidates(env) {
  return [`${env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, 'powershell.exe'];
}

function regCandidates(env) {
  return [`${env.SystemRoot || 'C:\\Windows'}\\System32\\reg.exe`, 'reg.exe'];
}

// The Windows probe: nvidia-smi (PATH, then its two absolute homes), the CIM
// controller list through powershell.exe and the display-class registry dump
// through reg.exe. `exec` and `env` are injectable so the path runs on any host.
export function windowsInventory({ exec = execText, env = process.env } = {}) {
  const methods = ['nvidia-smi', 'win32-cim', 'win32-reg'];
  const errors = [];
  const nvidia = nvidiaInventory({ exec, platform: 'win32', env });

  let ok = false;
  let controllers = [];
  const cim = firstSuccess(exec, powershellCandidates(env), () => POWERSHELL_ARGS);
  if (cim.error) {
    errors.push(`win32-cim: ${safeErrorText(cim.error)}`);
  } else {
    const text = String(cim.text ?? '').trim();
    let parsed = null;
    let parsable = true;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsable = false; }
    }
    if (parsable) {
      ok = true;
      controllers = parseWindowsVideoControllers(text);
    } else {
      errors.push('win32-cim: output was not JSON');
    }
    void parsed;
  }

  let regEntries = [];
  const reg = firstSuccess(exec, regCandidates(env), () => ['query', DISPLAY_CLASS_KEY, '/s']);
  if (reg.error) errors.push(`win32-reg: ${safeErrorText(reg.error)}`);
  else regEntries = parseWindowsDisplayClassReg(reg.text);

  const merged = mergeWindowsGpuInventory(controllers, regEntries, nvidia);
  errors.push(...merged.errors);
  return {
    gpus: merged.gpus,
    probe: { ok, platform: 'win32', methods, errors, ignored_controllers: merged.ignored_controllers }
  };
}

// hardware_mode is derived by code, never asserted by a label:
//   gpu-verified           an engine loaded a model with VRAM within the TTL
//   gpu-present-unverified an accelerator was found, no engine evidence yet
//   cpu-only               the probe ran and found no accelerator
//   unknown                the probe could not run
export function deriveHardwareMode({ gpus = [], probe = null, gpuVerifiedAt = null, now = Date.now(), ttlMs = GPU_EVIDENCE_TTL_MS } = {}) {
  const verifiedAt = typeof gpuVerifiedAt === 'string' ? Date.parse(gpuVerifiedAt) : NaN;
  if (Number.isFinite(verifiedAt) && now - verifiedAt <= ttlMs) return 'gpu-verified';
  if (Array.isArray(gpus) && gpus.length > 0) return 'gpu-present-unverified';
  if (probe?.ok === true) return 'cpu-only';
  return 'unknown';
}

export function discoverHardware({ platform = process.platform, exec = execText, env = process.env, diskPath = null } = {}) {
  let gpus;
  let probe;
  if (platform === 'win32') {
    ({ gpus, probe } = windowsInventory({ exec, env }));
  } else if (platform === 'darwin') {
    gpus = [...nvidiaInventory({ exec, platform, env }), ...appleInventory({ exec, platform })];
    probe = { ok: true, platform, methods: ['nvidia-smi', 'system_profiler'], errors: [], ignored_controllers: [] };
  } else {
    gpus = [...nvidiaInventory({ exec, platform, env }), ...amdInventoryFromSysfs()];
    probe = { ok: true, platform, methods: ['nvidia-smi', 'sysfs'], errors: [], ignored_controllers: [] };
  }
  return {
    hostname: os.hostname(),
    platform,
    arch: os.arch(),
    cpu_count: os.cpus().length,
    memory_bytes: os.totalmem(),
    disk_free_bytes: diskFreeBytes(diskPath, platform),
    gpus,
    runtime: {
      node: process.version,
      kernel: os.release(),
      agent_platform: 'mccluster-compute',
      // Apple system memory is shared by CPU/GPU, not dedicated GPU VRAM or
      // memory pooled with OVH. Unknown GPU utilization/power stays unknown.
      // On Windows the per-GPU `memory` field says shared or dedicated.
      memory_architecture: platform === 'darwin' && process.arch === 'arm64' ? 'unified' : 'unspecified',
      gpu_probe: probe
    }
  };
}

export function loadSnapshot(runningLeases = 0, { diskPath = null, platform = process.platform, exec = execText, env = process.env } = {}) {
  return {
    running_leases: Math.max(0, Number(runningLeases) || 0),
    memory_free_bytes: os.freemem(),
    disk_free_bytes: diskFreeBytes(diskPath, platform),
    gpu: [...nvidiaLoad({ exec, platform, env }), ...(platform === 'linux' ? amdLoadFromSysfs() : [])]
  };
}
