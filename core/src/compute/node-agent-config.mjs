// Pure helpers for the node agent: platform defaults, the Windows ACL
// command, shutdown signals, the yield claim body, GPU evidence selection and
// the doctor-written measured-inference sidecar. No I/O here, so every rule is
// testable on any host.
import path from 'node:path';

export const MEASURED_INFERENCE_SCHEMA = 'mccluster-measured-inference/1';
export const DEFAULT_GPU_EVIDENCE_TTL_MS = 86_400_000;
const MIN_GPU_EVIDENCE_TTL_MS = 60_000;
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
