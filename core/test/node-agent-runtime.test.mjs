import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { amdInventoryFromSysfs, amdLoadFromSysfs, parseNvidiaInventoryCsv, parseNvidiaLoadCsv, parseAppleDisplayInventory } from '../src/compute/hardware.mjs';
import { assertLoopbackUrl, capabilityReadiness, engineHealthSummary, healthyCapabilities, probeExecutors, probeHttpExecutor } from '../src/compute/engine-probes.mjs';
import {
  DEFAULT_LIMITS, DEVICE_PROBE_SCRIPT, IDLE_SENTINEL_TASK, LIMITS_SCHEMA, acPowerState, claimGate, contributionLabels, contributionPaths, cpuBusyPercent, createClaimGuard,
  deviceProbeCommand, deviceProbeMs, limitsNeedDeviceProbe, parseDeviceProbe, readLimitsFile
} from '../src/compute/node-agent-config.mjs';

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

/* ---- the owner's contribution controls: pause marker, limits.json, device probe, claim gate ---- */
const idleDevice = { ok: true, error: null, idle_seconds: 900, idle_source: 'wts', battery_present: true, on_ac: true, battery_percent: 80, battery_status: 2, thermal_c: 61.5, thermal_supported: true, thermal_error: null };
const limitsText = (limits) => JSON.stringify({ schema: LIMITS_SCHEMA, ...limits });

// A fake state root: which files exist and what they say, a fake device, a fake os.cpus and a clock.
function fakeGuard({ files = {}, device = idleDevice, cpus = null, probeMs = 30_000, now = null } = {}) {
  let clock = 1_000_000;
  const events = [];
  let probes = 0;
  const guard = createClaimGuard({
    pausedPath: 'STATE/paused', limitsPath: 'STATE/limits.json',
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readText: (p) => files[p],
    probe: () => { probes += 1; return typeof device === 'function' ? device() : device; },
    cpus: cpus || (() => [{ times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }]),
    now: now || (() => clock),
    probeMs,
    onEvent: (record) => events.push(record)
  });
  return { guard, files, events, tick: (ms) => { clock += ms; }, probes: () => probes };
}

test('contribution files sit beside the manifest in the state root', () => {
  const win = contributionPaths({ platform: 'win32', env: { ProgramData: 'C:\\ProgramData' } });
  assert.deepEqual(win, { pausedPath: 'C:\\ProgramData\\mccluster-node\\paused', limitsPath: 'C:\\ProgramData\\mccluster-node\\limits.json', heartbeatPath: 'C:\\ProgramData\\mccluster-node\\last-heartbeat.json' });
  const posix = contributionPaths({ platform: 'linux', env: { MCCLUSTER_NODE_STATE_DIR: '/opt/node' } });
  assert.equal(posix.pausedPath, '/opt/node/paused');
  assert.equal(deviceProbeMs({}), 30_000);
  assert.equal(deviceProbeMs({ MCCLUSTER_NODE_DEVICE_PROBE_MS: '1000' }), 5_000, 'floor');
  assert.equal(deviceProbeMs({ MCCLUSTER_NODE_DEVICE_PROBE_MS: '45000' }), 45_000);
});

test('limits.json is sanitized: absent means the defaults, a foreign or broken file means the defaults with a reason', () => {
  assert.deepEqual(readLimitsFile(null), { limits: { ...DEFAULT_LIMITS }, error: null });
  assert.deepEqual(readLimitsFile('{nope'), { limits: { ...DEFAULT_LIMITS }, error: 'invalid_json' });
  assert.equal(readLimitsFile(JSON.stringify({ schema: 'other/1', idle_only: true })).error, 'schema_mismatch');
  assert.equal(readLimitsFile(JSON.stringify({ schema: 'other/1', idle_only: true })).limits.idle_only, false, 'a foreign file never widens or narrows anything');
  const full = readLimitsFile(limitsText({ idle_only: true, on_ac_only: 'yes', max_concurrency: 9, cpu_busy_percent: 55.9, battery_floor_percent: 30, thermal_limit_c: 85.26 }));
  assert.equal(full.error, null);
  assert.deepEqual(full.limits, { idle_only: true, on_ac_only: false, max_concurrency: 1, cpu_busy_percent: 55, battery_floor_percent: 30, thermal_limit_c: 85.3 });
  assert.equal(readLimitsFile(limitsText({ max_concurrency: 4 })).limits.max_concurrency, 4);
  assert.equal(readLimitsFile(limitsText({ cpu_busy_percent: 5 })).limits.cpu_busy_percent, null, 'under 10 is not a limit');
  assert.equal(readLimitsFile(limitsText({ thermal_limit_c: 0 })).limits.thermal_limit_c, null, '0 means not set');
  assert.equal(limitsNeedDeviceProbe(DEFAULT_LIMITS), false);
  assert.equal(limitsNeedDeviceProbe({ ...DEFAULT_LIMITS, cpu_busy_percent: 50 }), false, 'the CPU limit reads os.cpus, not the probe');
  for (const key of ['idle_only', 'on_ac_only']) assert.equal(limitsNeedDeviceProbe({ ...DEFAULT_LIMITS, [key]: true }), true);
  assert.equal(limitsNeedDeviceProbe({ ...DEFAULT_LIMITS, battery_floor_percent: 20 }), true);
  assert.equal(limitsNeedDeviceProbe({ ...DEFAULT_LIMITS, thermal_limit_c: 80 }), true);
});

test('CPU busy percent is the non-idle share of the time deltas between two samples', () => {
  const a = [{ times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }, { times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }];
  const b = [{ times: { user: 400, nice: 0, sys: 150, idle: 1450, irq: 0 } }, { times: { user: 100, nice: 0, sys: 100, idle: 1800, irq: 0 } }];
  // cpu0: 300+100 busy of 1000; cpu1: 200 busy of 1000 → 600 of 2000 = 30 %
  assert.equal(cpuBusyPercent(a, b), 30);
  assert.equal(cpuBusyPercent(a, a), null, 'no elapsed time, no reading');
  assert.equal(cpuBusyPercent(null, b), null);
  assert.equal(cpuBusyPercent(a, [b[0]]), null, 'a changed CPU count is not comparable');
});

test('the device probe is parsed and sanitized; a missing or broken probe is not ok', () => {
  const parsed = parseDeviceProbe('WARNING: noise\n{"idle_seconds":42.9,"idle_source":"wts","battery_present":true,"on_ac":false,"battery_percent":57,"battery_status":1,"thermal_c":71.44,"thermal_supported":true,"thermal_error":null}\n');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.idle_seconds, 42);
  assert.equal(parsed.on_ac, false);
  assert.equal(parsed.battery_percent, 57);
  assert.equal(parsed.thermal_c, 71.4);
  assert.equal(parsed.thermal_supported, true);
  assert.equal(parsed.idle_scheduler, false);
  const scheduler = parseDeviceProbe(JSON.stringify({ idle_seconds: null, idle_source: 'task-scheduler', idle_scheduler: true, battery_present: false, on_ac: true, thermal_supported: false }));
  assert.equal(scheduler.idle_seconds, null);
  assert.equal(scheduler.idle_scheduler, true);
  const noThermal = parseDeviceProbe(JSON.stringify({ idle_seconds: 5, battery_present: false, on_ac: true, thermal_supported: false, thermal_error: 'Access denied' }));
  assert.equal(noThermal.ok, true);
  assert.equal(noThermal.thermal_supported, false);
  assert.equal(noThermal.thermal_c, null);
  assert.equal(noThermal.thermal_error, 'Access denied');
  assert.equal(parseDeviceProbe(JSON.stringify({ thermal_supported: true })).thermal_supported, false, 'supported needs a number');
  assert.equal(parseDeviceProbe(null).ok, false);
  assert.equal(parseDeviceProbe('', 'ETIMEDOUT').error, 'ETIMEDOUT');
  assert.equal(parseDeviceProbe('not json').error, 'invalid_json');
  assert.equal(parseDeviceProbe(JSON.stringify({ battery_percent: 400 })).battery_percent, null, 'an impossible percent is dropped');
});

test('the probe is one encoded powershell.exe command on Windows and nothing elsewhere', () => {
  assert.equal(deviceProbeCommand('linux'), null);
  assert.equal(deviceProbeCommand('darwin'), null);
  const command = deviceProbeCommand('win32');
  assert.equal(command.command, 'powershell.exe');
  assert.deepEqual(command.args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
  const decoded = Buffer.from(command.args[5], 'base64').toString('utf16le');
  assert.equal(decoded, DEVICE_PROBE_SCRIPT);
  for (const word of ['WTSEnumerateSessions', 'WTSQuerySessionInformation', 'GetLastInputInfo', 'RunOnlyIfIdle', 'console-unmeasurable', 'Win32_Battery', 'BatteryStatus', 'MSAcpi_ThermalZoneTemperature', 'ConvertTo-Json -Compress']) {
    assert.ok(decoded.includes(word), `the probe script carries ${word}`);
  }
  assert.doesNotMatch(decoded, /Invoke-(?:Expression|WebRequest|RestMethod)|DownloadString|https?:\/\//, 'the probe reads the device and nothing else');
  // Idle from session 0: the sentinel task Windows stops at idle end, and only while it is Running.
  assert.equal(IDLE_SENTINEL_TASK, 'McCluster Node Idle');
  assert.ok(decoded.includes("Get-ScheduledTask -TaskName 'McCluster Node Idle'"), 'the probe reads the idle sentinel task, not the agent task');
  assert.ok(!decoded.includes("Get-ScheduledTask -TaskName 'McCluster Node Agent'"), 'the agent task is not stopped at idle end, so its flag is not an idle signal');
  assert.match(decoded, /StopOnIdleEnd -eq \$true -and \[string\]\$task\.State -eq 'Running'/);
  assert.ok(decoded.includes('task-scheduler-not-idle'));
  // Power: the probe reports raw readings only and never decides "on AC" itself; a failed battery query is null.
  assert.doesNotMatch(decoded, /\$out\.on_ac\b/, 'the probe never writes on_ac: acPowerState decides');
  assert.match(decoded, /battery_present = \$null; power_online = \$null/);
  assert.match(decoded, /Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop/);
  assert.match(decoded, /catch \{ \$out\.battery_present = \$null \}/);
  assert.match(decoded, /if \(\[int\]::TryParse\(\[string\]\$battery\[0\]\.BatteryStatus, \[ref\]\$status\)\) \{ \$out\.battery_status = \$status \}/, 'an unparsable status stays null, not 0');
});

test('AC detection fails closed: only an explicit reading says on AC or on battery, everything else is unknown', () => {
  assert.equal(acPowerState({ battery_present: false }), true, 'the battery query answered with no battery: a desktop on AC');
  assert.equal(acPowerState({ battery_present: null }), null, 'the battery query failed: unknown, never "no battery"');
  assert.equal(acPowerState({}), null);
  for (const status of [1, 4, 5]) assert.equal(acPowerState({ battery_present: true, battery_status: status }), false, `status ${status} is on battery`);
  for (const status of [2, 3, 6, 7, 8, 9]) assert.equal(acPowerState({ battery_present: true, battery_status: status }), true, `status ${status} is on AC`);
  for (const status of [null, 0, 10, 11, 12, 99]) assert.equal(acPowerState({ battery_present: true, battery_status: status }), null, `status ${status} says nothing about the power source`);
  assert.equal(acPowerState({ battery_present: true, battery_status: 10, power_online: true }), true, 'PowerOnline decides when readable');
  assert.equal(acPowerState({ battery_present: true, battery_status: 2, power_online: false }), false, 'PowerOnline outranks the status');
  // Through the probe parser and the gate: Undefined status, PowerOnline unreadable -> power_unknown, said in claim_gate.
  const undefinedStatus = parseDeviceProbe(JSON.stringify({ idle_seconds: 900, battery_present: true, battery_status: 10, power_online: null, battery_percent: 80, on_ac: true }));
  assert.equal(undefinedStatus.on_ac, null, 'a bare on_ac in the probe output is not trusted');
  const acOnly = { ...DEFAULT_LIMITS, on_ac_only: true };
  const refused = claimGate({ limits: acOnly, device: undefinedStatus });
  assert.deepEqual(refused, { allowed: false, reason: 'power_unknown', thermal: 'unset' });
  assert.equal(contributionLabels({ limits: acOnly, gate: refused, device: undefinedStatus }).claim_gate, 'power_unknown');
  const missingStatus = parseDeviceProbe(JSON.stringify({ battery_present: true, battery_percent: 80 }));
  assert.equal(claimGate({ limits: acOnly, device: missingStatus }).reason, 'power_unknown');
  const queryFailed = parseDeviceProbe(JSON.stringify({ battery_present: null }));
  assert.equal(claimGate({ limits: acOnly, device: queryFailed }).reason, 'power_unknown');
  assert.equal(claimGate({ limits: acOnly, device: parseDeviceProbe(JSON.stringify({ battery_present: true, battery_status: 1 })) }).reason, 'on_battery');
  assert.equal(claimGate({ limits: acOnly, device: parseDeviceProbe(JSON.stringify({ battery_present: true, battery_status: 2 })) }).allowed, true);
  assert.equal(claimGate({ limits: acOnly, device: parseDeviceProbe(JSON.stringify({ battery_present: false })) }).allowed, true);
  // Without on_ac_only an unknown power state refuses nothing.
  assert.equal(claimGate({ limits: DEFAULT_LIMITS, device: undefinedStatus }).allowed, true);
});

test('idle-only from session 0: the sentinel task running is idle, registered but not running is user_active, absent is idle_unknown', () => {
  const idleOnly = { ...DEFAULT_LIMITS, idle_only: true };
  const base = { battery_present: false };
  const running = parseDeviceProbe(JSON.stringify({ ...base, idle_seconds: null, idle_source: 'task-scheduler', idle_scheduler: true }));
  assert.equal(claimGate({ limits: idleOnly, device: running }).allowed, true);
  const stopped = parseDeviceProbe(JSON.stringify({ ...base, idle_seconds: null, idle_source: 'task-scheduler-not-idle', idle_scheduler: false }));
  assert.equal(claimGate({ limits: idleOnly, device: stopped }).reason, 'user_active', 'Windows stopped the sentinel: the idle state ended; the agent itself keeps running and heartbeating');
  const absent = parseDeviceProbe(JSON.stringify({ ...base, idle_seconds: null, idle_source: 'console-unmeasurable', idle_scheduler: false }));
  assert.equal(claimGate({ limits: idleOnly, device: absent }).reason, 'idle_unknown');
});

test('the claim gate: open by default, paused first, then each limit the owner set, each with its reason', () => {
  assert.deepEqual(claimGate({ limits: DEFAULT_LIMITS, device: idleDevice }), { allowed: true, reason: null, thermal: 'unset' });
  assert.equal(claimGate({ paused: true, limits: DEFAULT_LIMITS, device: idleDevice }).reason, 'paused');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, idle_only: true }, device: { ...idleDevice, idle_seconds: 30 } }).reason, 'user_active');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, idle_only: true }, device: idleDevice }).allowed, true, 'idle for 15 minutes is idle');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, idle_only: true }, device: { ...idleDevice, idle_seconds: null } }).reason, 'idle_unknown', 'no reading fails closed');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, idle_only: true }, device: parseDeviceProbe(null) }).reason, 'idle_unknown');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, idle_only: true }, device: { ...idleDevice, idle_seconds: 119 }, idleThresholdSeconds: 120 }).reason, 'user_active');
  // From the task's session 0 the console's idle is unmeasurable: the idle sentinel task Windows stops at idle end is the gate, and only while it runs.
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, idle_only: true }, device: { ...idleDevice, idle_seconds: null, idle_source: 'task-scheduler', idle_scheduler: true } }).allowed, true);
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, idle_only: true }, device: { ...idleDevice, idle_seconds: null, idle_source: 'console-unmeasurable', idle_scheduler: false } }).reason, 'idle_unknown');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, on_ac_only: true }, device: { ...idleDevice, on_ac: false } }).reason, 'on_battery');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, on_ac_only: true }, device: { ...idleDevice, on_ac: null } }).reason, 'power_unknown');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, on_ac_only: true }, device: { ...idleDevice, battery_present: false, on_ac: true } }).allowed, true, 'a desktop without a battery is on AC');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, battery_floor_percent: 40 }, device: { ...idleDevice, battery_percent: 39 } }).reason, 'battery_low');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, battery_floor_percent: 40 }, device: { ...idleDevice, battery_percent: 40 } }).allowed, true, 'at the floor is allowed');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, battery_floor_percent: 40 }, device: { ...idleDevice, battery_present: false, battery_percent: null } }).allowed, true, 'no battery, nothing to protect');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, battery_floor_percent: 40 }, device: { ...idleDevice, battery_percent: null } }).reason, 'battery_unknown');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, cpu_busy_percent: 50 }, device: idleDevice, cpuBusy: 50.1 }).reason, 'cpu_busy');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, cpu_busy_percent: 50 }, device: idleDevice, cpuBusy: 50 }).allowed, true);
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, cpu_busy_percent: 50 }, device: idleDevice, cpuBusy: null }).reason, 'cpu_unknown', 'the first poll has no delta yet');
  const hot = claimGate({ limits: { ...DEFAULT_LIMITS, thermal_limit_c: 60 }, device: idleDevice });
  assert.deepEqual(hot, { allowed: false, reason: 'thermal_hot', thermal: 'enforced' });
  assert.deepEqual(claimGate({ limits: { ...DEFAULT_LIMITS, thermal_limit_c: 70 }, device: idleDevice }), { allowed: true, reason: null, thermal: 'enforced' });
  // By contract the thermal limit is best effort: without a zone reading it is reported as unsupported, never silently off and never a permanent refusal.
  const unsupported = claimGate({ limits: { ...DEFAULT_LIMITS, thermal_limit_c: 60 }, device: { ...idleDevice, thermal_supported: false, thermal_c: null } });
  assert.deepEqual(unsupported, { allowed: true, reason: null, thermal: 'unsupported' });
  // Order: paused outranks every limit; the first failing limit names the reason.
  assert.equal(claimGate({ paused: true, limits: { ...DEFAULT_LIMITS, idle_only: true }, device: { ...idleDevice, idle_seconds: 0 } }).reason, 'paused');
  assert.equal(claimGate({ limits: { ...DEFAULT_LIMITS, idle_only: true, on_ac_only: true }, device: { ...idleDevice, idle_seconds: 0, on_ac: false } }).reason, 'user_active');
});

test('the heartbeat labels carry paused, every limit, thermal_supported and the gate verdict', () => {
  const labels = contributionLabels({ paused: true, limits: { ...DEFAULT_LIMITS, idle_only: true, thermal_limit_c: 80 }, gate: claimGate({ paused: true, limits: { ...DEFAULT_LIMITS, idle_only: true, thermal_limit_c: 80 }, device: idleDevice }), device: idleDevice });
  assert.deepEqual(labels, { paused: true, idle_only: true, on_ac_only: false, max_concurrency: 1, cpu_busy_percent: null, battery_floor_percent: null, thermal_limit_c: 80, thermal_supported: true, thermal_limit: 'enforced', idle_source: 'wts', claim_gate: 'paused' });
  const noZone = { ...idleDevice, thermal_supported: false, thermal_c: null, thermal_error: 'Access denied' };
  const unsupported = contributionLabels({ limits: { ...DEFAULT_LIMITS, thermal_limit_c: 80 }, gate: claimGate({ limits: { ...DEFAULT_LIMITS, thermal_limit_c: 80 }, device: noZone }), device: noZone });
  assert.equal(unsupported.thermal_supported, false);
  assert.equal(unsupported.thermal_limit, 'unsupported', 'a set limit without a reading says unsupported, not off');
  assert.equal(unsupported.claim_gate, 'open');
  assert.equal(contributionLabels({ limitsError: 'invalid_json' }).limits_error, 'invalid_json');
  assert.equal(contributionLabels({}).claim_gate, 'unknown');
  assert.equal(contributionLabels({}).thermal_limit, 'unset');
});

test('the claim guard honours the pause marker within one poll and lifts it when the marker goes', () => {
  const { guard, files, events } = fakeGuard();
  assert.equal(guard.evaluate().gate.allowed, true);
  files['STATE/paused'] = '2026-11-23T00:00:00Z';
  const paused = guard.evaluate();
  assert.equal(paused.paused, true);
  assert.equal(paused.gate.reason, 'paused');
  assert.equal(paused.labels.paused, true);
  assert.equal(paused.labels.claim_gate, 'paused');
  delete files['STATE/paused'];
  assert.equal(guard.evaluate().gate.allowed, true, 'resume takes effect on the next poll');
  assert.deepEqual(events.filter((e) => e.event === 'compute_node_claim_gate').map((e) => e.claim_gate), ['open', 'paused', 'open'], 'each transition is logged once');
});

test('the claim guard refuses on each limit from limits.json with the fakes, and re-reads the file when it changes', () => {
  const { guard, files, events } = fakeGuard({ device: { ...idleDevice, idle_seconds: 10, on_ac: false, battery_percent: 15, thermal_c: 95 } });
  assert.equal(guard.evaluate().gate.allowed, true, 'no limits: open');
  files['STATE/limits.json'] = limitsText({ idle_only: true });
  assert.equal(guard.evaluate().gate.reason, 'user_active');
  files['STATE/limits.json'] = limitsText({ on_ac_only: true });
  assert.equal(guard.evaluate().gate.reason, 'on_battery');
  files['STATE/limits.json'] = limitsText({ battery_floor_percent: 20 });
  assert.equal(guard.evaluate().gate.reason, 'battery_low');
  files['STATE/limits.json'] = limitsText({ thermal_limit_c: 90 });
  const hot = guard.evaluate();
  assert.equal(hot.gate.reason, 'thermal_hot');
  assert.equal(hot.labels.thermal_limit, 'enforced');
  files['STATE/limits.json'] = limitsText({ max_concurrency: 3 });
  const wider = guard.evaluate();
  assert.equal(wider.gate.allowed, true);
  assert.equal(wider.limits.max_concurrency, 3);
  files['STATE/limits.json'] = '{broken';
  const broken = guard.evaluate();
  assert.equal(broken.limitsError, 'invalid_json');
  assert.deepEqual(broken.limits, { ...DEFAULT_LIMITS }, 'a broken file is the defaults, never a wider limit');
  assert.equal(broken.labels.limits_error, 'invalid_json');
  assert.ok(events.some((e) => e.event === 'compute_node_limits_invalid' && e.error === 'invalid_json'));
});

test('the CPU limit refuses on the delta between two polls, never on the first', () => {
  let sample = 0;
  const samples = [
    [{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }],
    [{ times: { user: 900, nice: 0, sys: 0, idle: 1100, irq: 0 } }],   // 90 % busy
    [{ times: { user: 950, nice: 0, sys: 0, idle: 2050, irq: 0 } }]    // 5 % busy
  ];
  const { guard, files } = fakeGuard({ cpus: () => samples[Math.min(sample++, samples.length - 1)] });
  files['STATE/limits.json'] = limitsText({ cpu_busy_percent: 50 });
  assert.equal(guard.evaluate().gate.reason, 'cpu_unknown', 'first poll: no delta yet');
  const busy = guard.evaluate();
  assert.equal(busy.cpuBusy, 90);
  assert.equal(busy.gate.reason, 'cpu_busy');
  const calm = guard.evaluate();
  assert.equal(calm.cpuBusy, 5);
  assert.equal(calm.gate.allowed, true);
});

test('the device probe is cached for 30 s while a limit needs it, and the thermal limit without a zone reading is reported unsupported', () => {
  const noZone = { ...idleDevice, thermal_supported: false, thermal_c: null, thermal_error: 'Access denied' };
  const { guard, files, tick, probes } = fakeGuard({ device: noZone });
  files['STATE/limits.json'] = limitsText({ thermal_limit_c: 75 });
  const first = guard.evaluate();
  assert.equal(first.gate.allowed, true, 'unsupported never blocks by itself');
  assert.equal(first.labels.thermal_supported, false);
  assert.equal(first.labels.thermal_limit, 'unsupported');
  assert.equal(first.labels.thermal_limit_c, 75, 'the limit is still reported as set');
  guard.evaluate(); tick(29_000); guard.evaluate();
  assert.equal(probes(), 1, 'one probe within 30 s');
  tick(1_500); guard.evaluate();
  assert.equal(probes(), 2, 'a fresh probe after 30 s');
  // A failing probe is not a crash: the limits that need it fail closed with their reason.
  const failing = createClaimGuard({ pausedPath: 'P', limitsPath: 'L', exists: (p) => p === 'L', readText: () => limitsText({ on_ac_only: true }), probe: () => { throw new Error('spawn ENOENT'); }, cpus: () => [], now: () => 1 });
  const refused = failing.evaluate();
  assert.equal(refused.gate.reason, 'power_unknown');
  assert.equal(refused.device.ok, false);
  assert.match(refused.device.error, /ENOENT/);
});

test('without any limit the probe runs at the idle cadence only (no PowerShell every poll on a device with nothing set)', () => {
  const { guard, tick, probes } = fakeGuard({ probeMs: 30_000 });
  guard.evaluate(); tick(31_000); guard.evaluate(); tick(31_000); guard.evaluate();
  assert.equal(probes(), 1, 'the default 10-minute cadence applies when no limit needs the probe');
  tick(600_000); guard.evaluate();
  assert.equal(probes(), 2);
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
