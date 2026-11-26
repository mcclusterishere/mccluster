// Pure helpers for the node agent: platform defaults, the Windows ACL
// command, shutdown signals, the yield claim body, GPU evidence selection, the
// doctor-written measured-inference sidecar, and the owner's contribution
// limits: the pause marker, limits.json, the device probe and the claim gate.
// (The contract is docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md on branch
// prime/contribution-ledger; it is not in this tree until that branch is
// merged.) No I/O here: the claim
// guard takes its file reads and probes as functions, so every rule is
// testable on any host and the tests fake the device.
import path from 'node:path';

export const MEASURED_INFERENCE_SCHEMA = 'mccluster-measured-inference/1';
export const LIMITS_SCHEMA = 'mccluster-node-limits/1';
export const HEARTBEAT_FILE_SCHEMA = 'mccluster-node-heartbeat/1';
export const PAUSED_MARKER = 'paused';
export const LIMITS_FILE = 'limits.json';
export const HEARTBEAT_FILE = 'last-heartbeat.json';
// A user is "active" when any session saw input within this many seconds.
export const DEFAULT_IDLE_SECONDS = 120;
export const DEFAULT_DEVICE_PROBE_MS = 30_000;
const MIN_DEVICE_PROBE_MS = 5_000;
export const MAX_CONCURRENCY_LIMIT = 4;
export const DEFAULT_LIMITS = Object.freeze({
  idle_only: false,
  on_ac_only: false,
  max_concurrency: 1,
  cpu_busy_percent: null,
  battery_floor_percent: null,
  thermal_limit_c: null
});
export const DEFAULT_GPU_EVIDENCE_TTL_MS = 86_400_000;
const MIN_GPU_EVIDENCE_TTL_MS = 60_000;
export const DEFAULT_HARDWARE_REFRESH_MS = 600_000;
const MIN_HARDWARE_REFRESH_MS = 60_000;
const MAX_YIELD_MS = 300_000;
const MAX_MEASUREMENTS = 64;
const TEXT_LIMIT = 120;

// Windows defaults live under %ProgramData%\mccluster-node (no user name in
// the path); every other platform keeps /var/lib and /etc. Environment values
// always win; `defaultsApplied` names what was defaulted for the start-up log.
export function resolveNodePaths({ platform = process.platform, env = process.env } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const defaultsApplied = [];
  let stateDir = env.MCCLUSTER_NODE_STATE_DIR;
  if (!stateDir) {
    defaultsApplied.push('MCCLUSTER_NODE_STATE_DIR');
    stateDir = platform === 'win32' ? p.join(env.ProgramData || 'C:\\ProgramData', 'mccluster-node') : '/var/lib/mccluster-node';
  }
  let manifest = env.MCCLUSTER_NODE_MANIFEST;
  if (!manifest) {
    defaultsApplied.push('MCCLUSTER_NODE_MANIFEST');
    manifest = platform === 'win32' ? p.join(stateDir, 'capabilities.json') : '/etc/mccluster-node/capabilities.json';
  }
  return { stateDir, manifest, defaultsApplied };
}

// The browser executor's files: its own persistent Chromium profile under the
// state directory (never the owner's own browser profile) and the allowlist
// policy file beside the manifest. Environment values win; defaults follow the
// node paths on both platforms (%ProgramData%\mccluster-node on Windows).
export function browserPaths({ platform = process.platform, env = process.env, nodePaths = null } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const paths = nodePaths || resolveNodePaths({ platform, env });
  const defaultsApplied = [];
  let profileDir = env.MCCLUSTER_BROWSER_PROFILE_DIR;
  if (!profileDir) {
    defaultsApplied.push('MCCLUSTER_BROWSER_PROFILE_DIR');
    profileDir = p.join(paths.stateDir, 'browser-profile');
  }
  let policyPath = env.MCCLUSTER_BROWSER_POLICY;
  if (!policyPath) {
    defaultsApplied.push('MCCLUSTER_BROWSER_POLICY');
    policyPath = p.join(p.dirname(paths.manifest), 'browser-policy.json');
  }
  return { profileDir, policyPath, defaultsApplied };
}

// Best-effort NTFS ACL: the state directory and identity file readable by the
// current user only (chmod has no effect on Windows). Null anywhere else.
export function aclCommand({ platform = process.platform, env = process.env, target, isDirectory = false } = {}) {
  if (platform !== 'win32' || !env.USERNAME || !target) return null;
  const who = env.USERDOMAIN ? `${env.USERDOMAIN}\\${env.USERNAME}` : env.USERNAME;
  return { command: 'icacls.exe', args: [target, '/inheritance:r', '/grant:r', `${who}:${isDirectory ? '(OI)(CI)F' : 'F'}`] };
}

// Windows consoles deliver Ctrl+Break as SIGBREAK; schtasks /End is a hard kill
// and never reaches here (the lease expires within 120 s and the task requeues).
export function shutdownSignals(platform = process.platform) {
  return platform === 'win32' ? ['SIGTERM', 'SIGINT', 'SIGBREAK'] : ['SIGTERM', 'SIGINT'];
}

export function yieldToGpuMs(env = process.env) {
  const n = Number(env.MCCLUSTER_NODE_YIELD_TO_GPU_MS || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_YIELD_MS, Math.floor(n)));
}

export function gpuEvidenceTtlMs(env = process.env) {
  const n = Number(env.MCCLUSTER_NODE_GPU_EVIDENCE_TTL_MS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_GPU_EVIDENCE_TTL_MS;
  return Math.max(MIN_GPU_EVIDENCE_TTL_MS, Math.floor(n));
}

// Full hardware discovery spawns processes (powershell.exe, reg.exe and the
// nvidia-smi attempts on Windows), so the agent repeats it only this often and
// serves the cached snapshot to the engine probe in between (floor one minute).
export function hardwareRefreshMs(env = process.env) {
  const n = Number(env.MCCLUSTER_NODE_HARDWARE_REFRESH_MS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HARDWARE_REFRESH_MS;
  return Math.max(MIN_HARDWARE_REFRESH_MS, Math.floor(n));
}

// A node that is not GPU-verified leaves fresh tasks to a live GPU node for
// `yieldMs`, but only when it was told one is live and the owner enabled it.
export function yieldClaimBody({ yieldMs = 0, liveGpuNodes = 0, hardwareMode = 'unknown' } = {}) {
  const ms = Number(yieldMs) || 0;
  const live = Number(liveGpuNodes) || 0;
  if (ms > 0 && live > 0 && hardwareMode !== 'gpu-verified') return { yield_seconds: Math.ceil(ms / 1000) };
  return {};
}

function observation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const vram = Number(value.size_vram_bytes);
  return Number.isFinite(vram) && vram >= 0 ? value : null;
}

// The node's observation is the executor observation with the most VRAM in use.
export function selectGpuEvidence(items = []) {
  let best = null;
  for (const item of Array.isArray(items) ? items : []) {
    const value = observation(item);
    if (!value) continue;
    if (!best || Number(value.size_vram_bytes) > Number(best.size_vram_bytes)) best = value;
  }
  return best;
}

// Only a model loaded with VRAM verifies the GPU; a CPU load (size_vram 0) does not.
export function isPositiveGpuEvidence(evidence) {
  return Boolean(observation(evidence)) && Number(evidence.size_vram_bytes) > 0;
}

function nonNegativeNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function percent(value) {
  const n = nonNegativeNumber(value);
  return n != null && n <= 100 ? n : null;
}

function nonNegativeInteger(value) {
  const n = nonNegativeNumber(value);
  return n == null ? null : Math.floor(n);
}

function isoTime(value) {
  return typeof value === 'string' && value.length <= TEXT_LIMIT && Number.isFinite(Date.parse(value)) ? value : null;
}

function boundedText(value) {
  return value == null ? null : String(value).slice(0, TEXT_LIMIT);
}

function sanitizeMeasurement(value) {
  return {
    generation_tokens_per_second: nonNegativeNumber(value.generation_tokens_per_second),
    prompt_tokens_per_second: nonNegativeNumber(value.prompt_tokens_per_second),
    processor_gpu_percent: percent(value.processor_gpu_percent),
    measured_at: isoTime(value.measured_at),
    num_ctx: nonNegativeInteger(value.num_ctx),
    num_predict: nonNegativeInteger(value.num_predict),
    prompt_tokens: nonNegativeInteger(value.prompt_tokens),
    generation_tokens: nonNegativeInteger(value.generation_tokens),
    ollama_version: boundedText(value.ollama_version),
    backend_note: boundedText(value.backend_note)
  };
}

// measured-inference.json beside the manifest: written by the doctor's
// benchmark, read by the agent. Evidence, not policy; a foreign or broken file
// is ignored with a reason.
export function readMeasuredInferenceSidecar(text) {
  let parsed;
  try { parsed = JSON.parse(String(text ?? '')); }
  catch { return { measurements: {}, error: 'invalid_json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== MEASURED_INFERENCE_SCHEMA) {
    return { measurements: {}, error: 'schema_mismatch' };
  }
  const raw = parsed.measurements;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { measurements: {}, error: 'invalid_measurements' };
  const measurements = {};
  for (const [model, value] of Object.entries(raw).slice(0, MAX_MEASUREMENTS)) {
    if (!model || model.length > TEXT_LIMIT || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    measurements[model] = sanitizeMeasurement(value);
  }
  return { measurements, error: null };
}

// The best measurement among the models the manifest advertises (highest
// generation rate; ties keep the first manifest entry).
export function selectMeasuredInference(measurements = {}, capabilities = []) {
  let best = null;
  const seen = new Set();
  for (const entry of Array.isArray(capabilities) ? capabilities : []) {
    const model = entry?.model;
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const measurement = measurements?.[model];
    const rate = measurement?.generation_tokens_per_second;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) continue;
    if (!best || rate > best.generation_tokens_per_second) {
      best = {
        model,
        generation_tokens_per_second: rate,
        prompt_tokens_per_second: measurement.prompt_tokens_per_second ?? null,
        processor_gpu_percent: measurement.processor_gpu_percent ?? null,
        measured_at: measurement.measured_at ?? null,
        num_ctx: measurement.num_ctx ?? null
      };
    }
  }
  return best;
}

// ---- contribution: pause marker, limits.json, device probe, claim gate -------------------------

// The files the doctor writes beside the manifest and the agent only reads
// (plus the heartbeat file the agent writes for the desktop to read).
export function contributionPaths({ platform = process.platform, env = process.env, nodePaths = null } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const paths = nodePaths || resolveNodePaths({ platform, env });
  return {
    pausedPath: p.join(paths.stateDir, PAUSED_MARKER),
    limitsPath: p.join(paths.stateDir, LIMITS_FILE),
    heartbeatPath: p.join(paths.stateDir, HEARTBEAT_FILE)
  };
}

export function deviceProbeMs(env = process.env) {
  const n = Number(env.MCCLUSTER_NODE_DEVICE_PROBE_MS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DEVICE_PROBE_MS;
  return Math.max(MIN_DEVICE_PROBE_MS, Math.floor(n));
}

function boundedInteger(value, min, max) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= min && i <= max ? i : null;
}

// limits.json: the owner's limits as the doctor wrote them. Absent means the
// defaults; a foreign or broken file means the defaults with a reason, never a
// silently wider limit.
export function readLimitsFile(text) {
  if (text == null || String(text).trim() === '') return { limits: { ...DEFAULT_LIMITS }, error: null };
  let parsed;
  try { parsed = JSON.parse(String(text)); }
  catch { return { limits: { ...DEFAULT_LIMITS }, error: 'invalid_json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== LIMITS_SCHEMA) {
    return { limits: { ...DEFAULT_LIMITS }, error: 'schema_mismatch' };
  }
  const thermal = Number(parsed.thermal_limit_c);
  return {
    limits: {
      idle_only: parsed.idle_only === true,
      on_ac_only: parsed.on_ac_only === true,
      max_concurrency: boundedInteger(parsed.max_concurrency, 1, MAX_CONCURRENCY_LIMIT) ?? 1,
      cpu_busy_percent: boundedInteger(parsed.cpu_busy_percent, 10, 100),
      battery_floor_percent: boundedInteger(parsed.battery_floor_percent, 0, 100),
      thermal_limit_c: Number.isFinite(thermal) && thermal > 0 ? Math.round(thermal * 10) / 10 : null
    },
    error: null
  };
}

// Which limits need the device probe at all (a device with none set is never probed every 30 s).
export function limitsNeedDeviceProbe(limits = DEFAULT_LIMITS) {
  return Boolean(limits.idle_only || limits.on_ac_only || limits.battery_floor_percent != null || limits.thermal_limit_c != null);
}

// Busy percent over the interval between two os.cpus() samples: 100 minus the
// idle share of the summed time deltas. Null without two comparable samples.
export function cpuBusyPercent(previous, current) {
  if (!Array.isArray(previous) || !Array.isArray(current) || previous.length === 0 || previous.length !== current.length) return null;
  let total = 0;
  let idle = 0;
  for (let i = 0; i < current.length; i++) {
    const a = previous[i]?.times || {};
    const b = current[i]?.times || {};
    for (const key of ['user', 'nice', 'sys', 'idle', 'irq']) {
      const delta = Number(b[key] || 0) - Number(a[key] || 0);
      if (delta > 0) { total += delta; if (key === 'idle') idle += delta; }
    }
  }
  if (total <= 0) return null;
  return Math.round((1 - idle / total) * 1000) / 10;
}

// Win32_Battery.BatteryStatus values that state the power source outright.
// 1 discharging, 4 low, 5 critical: on battery. 2 on AC, 3 fully charged,
// 6..9 charging: on AC. Everything else (10 Undefined, 11 Partially Charged,
// absent, unparsable) says nothing about the power source.
const BATTERY_STATUS_ON_BATTERY = new Set([1, 4, 5]);
const BATTERY_STATUS_ON_AC = new Set([2, 3, 6, 7, 8, 9]);
export const IDLE_SENTINEL_TASK = 'McCluster Node Idle';

// Is the device on AC power? true / false only when a reading says so; null
// (unknown) otherwise, and the claim gate then refuses on_ac_only work with
// power_unknown. Order: no battery at all (the battery query answered, with
// none) is AC; root\wmi BatteryStatus.PowerOnline when readable; else the
// Win32_Battery status when it is one of the unambiguous values. A battery
// query that failed (battery_present null) is unknown, never "no battery".
export function acPowerState({ battery_present = null, battery_status = null, power_online = null } = {}) {
  if (battery_present === false) return true;
  if (battery_present !== true) return null;
  if (typeof power_online === 'boolean') return power_online;
  const status = Number.isInteger(battery_status) ? battery_status : null;
  if (status != null && BATTERY_STATUS_ON_BATTERY.has(status)) return false;
  if (status != null && BATTERY_STATUS_ON_AC.has(status)) return true;
  return null;
}

// The device probe's answer, sanitized. `ok` false means the probe did not run
// or did not parse: every limit that needs it then fails closed. on_ac is
// derived here (acPowerState) from the probe's raw readings; a bare on_ac in
// the probe output is not trusted.
export function parseDeviceProbe(text, error = null) {
  const unknown = {
    ok: false, error: error ? String(error).slice(0, TEXT_LIMIT) : 'no_probe',
    idle_seconds: null, idle_source: null, idle_scheduler: false, battery_present: null, on_ac: null, power_online: null, battery_percent: null, battery_status: null,
    thermal_c: null, thermal_supported: false, thermal_error: null
  };
  if (text == null || String(text).trim() === '') return unknown;
  let parsed;
  try {
    const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('{'));
    parsed = JSON.parse(lines[lines.length - 1]);
  } catch { return { ...unknown, error: 'invalid_json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...unknown, error: 'invalid_json' };
  const idle = nonNegativeNumber(parsed.idle_seconds);
  const thermal = Number(parsed.thermal_c);
  const thermalSupported = parsed.thermal_supported === true && Number.isFinite(thermal);
  const batteryPresent = typeof parsed.battery_present === 'boolean' ? parsed.battery_present : null;
  const batteryStatus = nonNegativeInteger(parsed.battery_status);
  const powerOnline = typeof parsed.power_online === 'boolean' ? parsed.power_online : null;
  return {
    ok: true,
    error: null,
    idle_seconds: idle == null ? null : Math.floor(idle),
    idle_source: boundedText(parsed.idle_source),
    // The idle sentinel task ("McCluster Node Idle") is running: Windows stops it when the idle state ends and
    // restarts it on idle, so "running" is Windows' own live statement that the device is idle now.
    idle_scheduler: parsed.idle_scheduler === true,
    battery_present: batteryPresent,
    on_ac: acPowerState({ battery_present: batteryPresent, battery_status: batteryStatus, power_online: powerOnline }),
    power_online: powerOnline,
    battery_percent: percent(parsed.battery_percent),
    battery_status: batteryStatus,
    thermal_c: thermalSupported ? Math.round(thermal * 10) / 10 : null,
    thermal_supported: thermalSupported,
    thermal_error: thermalSupported ? null : boundedText(parsed.thermal_error)
  };
}

// The one PowerShell probe (Windows only): idle seconds (GetLastInputInfo inside
// a user session; from session 0 the RDP sessions' idle through wtsapi32, and for
// the console, which Windows keeps no input time for, whether the idle sentinel
// task "McCluster Node Idle" is running: Windows stops that task when the idle
// state ends and restarts it on idle, while the agent's own task is deliberately
// not stopped at idle end, so its RunOnlyIfIdle flag alone says nothing about
// now), the raw battery readings (Win32_Battery status and charge, root\wmi
// BatteryStatus.PowerOnline; battery_present is null when the battery query
// itself failed, and the power state is decided in acPowerState, not here),
// MSAcpi_ThermalZoneTemperature when readable. One JSON line.
export const DEVICE_PROBE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$out = @{ idle_seconds = $null; idle_source = $null; battery_present = $null; power_online = $null; battery_percent = $null; battery_status = $null; thermal_c = $null; thermal_supported = $false; thermal_error = $null }
$wts = @'
using System; using System.Runtime.InteropServices;
public static class McWts {
  [StructLayout(LayoutKind.Sequential)] public struct SESSION_INFO { public int SessionId; public IntPtr pWinStationName; public int State; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct INFOEX_LEVEL1 { public int SessionId; public int SessionState; public int SessionFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 33)] public string WinStationName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 21)] public string UserName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 18)] public string DomainName; public long LogonTime; public long ConnectTime; public long DisconnectTime; public long LastInputTime; public long CurrentTime; public int IncomingBytes; public int OutgoingBytes; public int IncomingFrames; public int OutgoingFrames; public int IncomingCompressedBytes; public int OutgoingCompressedBytes; }
  [StructLayout(LayoutKind.Sequential)] public struct INFOEX { public int Level; public INFOEX_LEVEL1 Data; }
  [DllImport("wtsapi32.dll", SetLastError = true)] static extern bool WTSEnumerateSessions(IntPtr hServer, int Reserved, int Version, ref IntPtr ppSessionInfo, ref int pCount);
  [DllImport("wtsapi32.dll", SetLastError = true)] static extern bool WTSQuerySessionInformation(IntPtr hServer, int SessionId, int WTSInfoClass, out IntPtr ppBuffer, out int pBytesReturned);
  [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr pMemory);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  // Active sessions: "console" when the console session is active (Windows keeps no LastInputTime for
  // it, so its idle is unmeasurable from another session), else the smallest RDP idle in seconds,
  // -1 when no session is active, -2 when the enumeration failed.
  public static string ActiveSessions() {
    IntPtr buffer = IntPtr.Zero; int count = 0;
    if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, ref buffer, ref count)) return "-2";
    long best = -1; bool console = false;
    try {
      int size = Marshal.SizeOf(typeof(SESSION_INFO));
      for (int i = 0; i < count; i++) {
        SESSION_INFO info = (SESSION_INFO)Marshal.PtrToStructure(new IntPtr(buffer.ToInt64() + (long)i * size), typeof(SESSION_INFO));
        if (info.State != 0) continue;
        IntPtr p; int bytes;
        if (!WTSQuerySessionInformation(IntPtr.Zero, info.SessionId, 25, out p, out bytes)) continue;
        try {
          INFOEX ex = (INFOEX)Marshal.PtrToStructure(p, typeof(INFOEX));
          if (string.Equals(ex.Data.WinStationName, "Console", StringComparison.OrdinalIgnoreCase)) { console = true; continue; }
          if (ex.Data.LastInputTime <= 0 || ex.Data.CurrentTime <= 0) continue;
          long idle = (ex.Data.CurrentTime - ex.Data.LastInputTime) / 10000000L;
          if (idle < 0) idle = 0;
          if (best < 0 || idle < best) best = idle;
        } finally { WTSFreeMemory(p); }
      }
    } finally { WTSFreeMemory(buffer); }
    if (console) return "console";
    return best.ToString();
  }
  public static long LastInputSeconds() {
    LASTINPUTINFO info = new LASTINPUTINFO(); info.cbSize = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) return -1;
    // Both readings use the low 32 bits of uptime. Subtract before widening so
    // a signed tick or a counter wrap still measures short idle intervals.
    uint elapsed = unchecked((uint)Environment.TickCount - info.dwTime);
    // A future input time and an idle interval over half a cycle are ambiguous.
    return elapsed > Int32.MaxValue ? 0L : elapsed / 1000L;
  }
}
'@
$out.idle_scheduler = $false
try {
  Add-Type -TypeDefinition $wts -ErrorAction Stop
  $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  if ($sessionId -ne 0) {
    # Inside a user session (a console run): the session's own last input.
    $last = [McWts]::LastInputSeconds()
    if ($last -ge 0) { $out.idle_seconds = $last; $out.idle_source = 'lastinput' }
  } else {
    # Session 0 (the scheduled task): RDP sessions carry an idle time; the console does not.
    $sessions = [McWts]::ActiveSessions()
    if ($sessions -eq 'console') {
      $task = Get-ScheduledTask -TaskName '${IDLE_SENTINEL_TASK}' -ErrorAction SilentlyContinue
      if ($null -ne $task -and $task.Settings.RunOnlyIfIdle -eq $true -and $task.Settings.IdleSettings.StopOnIdleEnd -eq $true -and [string]$task.State -eq 'Running') { $out.idle_scheduler = $true; $out.idle_source = 'task-scheduler' }
      elseif ($null -ne $task) { $out.idle_source = 'task-scheduler-not-idle' }
      else { $out.idle_source = 'console-unmeasurable' }
    }
    elseif ($sessions -eq '-1') { $out.idle_seconds = 86400; $out.idle_source = 'no-active-session' }
    elseif ($sessions -match '^\d+$') { $out.idle_seconds = [int64]$sessions; $out.idle_source = 'wts' }
  }
} catch { }
try {
  # -ErrorAction Stop: a battery query that fails leaves battery_present null (power unknown), never "no battery".
  $battery = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop)
  if ($battery.Count -gt 0 -and $null -ne $battery[0]) {
    $out.battery_present = $true
    $status = 0; if ([int]::TryParse([string]$battery[0].BatteryStatus, [ref]$status)) { $out.battery_status = $status }
    $charge = 0; if ([int]::TryParse([string]$battery[0].EstimatedChargeRemaining, [ref]$charge)) { $out.battery_percent = $charge }
    $wmi = @(Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue)
    if ($wmi.Count -gt 0 -and $null -ne $wmi[0] -and $null -ne $wmi[0].PowerOnline) { $out.power_online = [bool]$wmi[0].PowerOnline }
  } else { $out.battery_present = $false }
} catch { $out.battery_present = $null }
try {
  $zones = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop)
  $max = $null
  foreach ($zone in $zones) { $t = [double]$zone.CurrentTemperature; if ($t -gt 0) { $c = [math]::Round($t / 10 - 273.15, 1); if ($null -eq $max -or $c -gt $max) { $max = $c } } }
  if ($null -ne $max) { $out.thermal_c = $max; $out.thermal_supported = $true } else { $out.thermal_error = 'no thermal zone reported a temperature' }
} catch { $out.thermal_error = (([string]$_.Exception.Message) -replace '\s+', ' ').Trim() }
if ($null -ne $out.thermal_error -and $out.thermal_error.Length -gt 120) { $out.thermal_error = $out.thermal_error.Substring(0, 120) }
Write-Output ($out | ConvertTo-Json -Compress)
`;

// powershell.exe with the probe as an encoded command (no quoting, no file); null off Windows.
export function deviceProbeCommand(platform = process.platform) {
  if (platform !== 'win32') return null;
  const encoded = Buffer.from(DEVICE_PROBE_SCRIPT, 'utf16le').toString('base64');
  return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded] };
}

// Before every claim: paused, then each limit the owner set. A limit whose
// reading is unavailable fails closed (the reason says so); the thermal limit
// is the one exception, by contract: without a zone reading it cannot be
// enforced, so it is reported as unsupported, never silently ignored.
export function claimGate({ paused = false, limits = DEFAULT_LIMITS, device = null, cpuBusy = null, idleThresholdSeconds = DEFAULT_IDLE_SECONDS } = {}) {
  const thermal = limits.thermal_limit_c == null ? 'unset' : (device?.ok && device.thermal_supported ? 'enforced' : 'unsupported');
  const refuse = (reason) => ({ allowed: false, reason, thermal });
  if (paused) return refuse('paused');
  if (limits.idle_only) {
    if (!device?.ok) return refuse('idle_unknown');
    if (device.idle_seconds != null) {
      if (device.idle_seconds < idleThresholdSeconds) return refuse('user_active');
    } else if (!device.idle_scheduler) {
      // The console's idle is not measurable from the task's session. With the idle sentinel task registered
      // but not running, Windows itself says the device is not idle; without it nothing says anything.
      return refuse(device.idle_source === 'task-scheduler-not-idle' ? 'user_active' : 'idle_unknown');
    }
  }
  if (limits.on_ac_only) {
    if (!device?.ok || device.on_ac == null) return refuse('power_unknown');
    if (device.on_ac === false) return refuse('on_battery');
  }
  if (limits.battery_floor_percent != null) {
    if (!device?.ok || device.battery_present == null) return refuse('battery_unknown');
    if (device.battery_present && device.battery_percent == null) return refuse('battery_unknown');
    if (device.battery_present && device.battery_percent < limits.battery_floor_percent) return refuse('battery_low');
  }
  if (limits.cpu_busy_percent != null) {
    if (cpuBusy == null) return refuse('cpu_unknown');
    if (cpuBusy > limits.cpu_busy_percent) return refuse('cpu_busy');
  }
  if (thermal === 'enforced' && device.thermal_c > limits.thermal_limit_c) return refuse('thermal_hot');
  return { allowed: true, reason: null, thermal };
}

// What the heartbeat says about the owner's limits: every limit as set, paused,
// whether a thermal reading exists, and why the last claim was refused.
export function contributionLabels({ paused = false, limits = DEFAULT_LIMITS, limitsError = null, gate = null, device = null } = {}) {
  const labels = {
    paused: Boolean(paused),
    idle_only: Boolean(limits.idle_only),
    on_ac_only: Boolean(limits.on_ac_only),
    max_concurrency: limits.max_concurrency ?? 1,
    cpu_busy_percent: limits.cpu_busy_percent ?? null,
    battery_floor_percent: limits.battery_floor_percent ?? null,
    thermal_limit_c: limits.thermal_limit_c ?? null,
    thermal_supported: Boolean(device?.ok && device.thermal_supported),
    thermal_limit: gate?.thermal || (limits.thermal_limit_c == null ? 'unset' : 'unsupported'),
    idle_source: device?.ok ? (device.idle_source || null) : null,
    claim_gate: gate ? (gate.allowed ? 'open' : gate.reason) : 'unknown'
  };
  if (limitsError) labels.limits_error = limitsError;
  return labels;
}

// The guard the agent calls once per poll. Every read and probe is injected:
// `exists(path)`, `readText(path)`, `probe()` (the device probe, already
// parsed), `cpus()` (os.cpus), `now()`. The device probe is cached for
// `probeMs` while a limit needs it and for `probeIdleMs` otherwise (the
// heartbeat still reports thermal_supported); the CPU sample is the delta
// between two consecutive polls.
export function createClaimGuard({
  pausedPath, limitsPath, exists, readText, probe, cpus,
  now = Date.now, probeMs = DEFAULT_DEVICE_PROBE_MS, probeIdleMs = DEFAULT_HARDWARE_REFRESH_MS,
  idleThresholdSeconds = DEFAULT_IDLE_SECONDS, onEvent = () => {}
} = {}) {
  let limitsCache = { text: undefined, limits: { ...DEFAULT_LIMITS }, error: null };
  let probeCache = { at: 0, value: null };
  let cpuSample = null;
  let cpuBusy = null;
  let lastGate = undefined;

  function readLimits() {
    let text = null;
    try { text = exists(limitsPath) ? readText(limitsPath) : null; } catch { text = limitsCache.text ?? null; }
    if (text !== limitsCache.text) {
      const parsed = readLimitsFile(text);
      if (parsed.error) onEvent({ event: 'compute_node_limits_invalid', error: parsed.error });
      else onEvent({ event: 'compute_node_limits', ...parsed.limits });
      limitsCache = { text, ...parsed };
    }
    return limitsCache;
  }

  function sampleCpu() {
    const current = typeof cpus === 'function' ? cpus() : null;
    if (cpuSample && current) cpuBusy = cpuBusyPercent(cpuSample, current);
    cpuSample = current;
    return cpuBusy;
  }

  function readDevice(limits) {
    const at = now();
    const ttl = limitsNeedDeviceProbe(limits) ? probeMs : Math.max(probeMs, probeIdleMs);
    if (!probeCache.value || at - probeCache.at >= ttl) {
      let value;
      try { value = typeof probe === 'function' ? probe() : parseDeviceProbe(null, 'no_probe'); }
      catch (error) { value = parseDeviceProbe(null, error?.code || error?.message || error); }
      probeCache = { at, value: value || parseDeviceProbe(null, 'no_probe') };
    }
    return probeCache.value;
  }

  return {
    evaluate() {
      let paused = false;
      try { paused = Boolean(exists(pausedPath)); } catch { paused = false; }
      const { limits, error } = readLimits();
      const busy = sampleCpu();
      const device = readDevice(limits);
      const gate = claimGate({ paused, limits, device, cpuBusy: busy, idleThresholdSeconds });
      const key = gate.allowed ? 'open' : gate.reason;
      if (key !== lastGate) {
        onEvent({ event: 'compute_node_claim_gate', claim_gate: key, paused, cpu_busy_percent: busy, idle_seconds: device?.idle_seconds ?? null, on_ac: device?.on_ac ?? null, battery_percent: device?.battery_percent ?? null, thermal_c: device?.thermal_c ?? null, thermal_supported: Boolean(device?.ok && device.thermal_supported) });
        lastGate = key;
      }
      return { paused, limits, limitsError: error, device, cpuBusy: busy, gate, labels: contributionLabels({ paused, limits, limitsError: error, gate, device }) };
    }
  };
}
