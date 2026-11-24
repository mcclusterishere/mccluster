import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runLease, systemClock } from './lease-runtime.mjs';
import { requestJson, readBoundedText } from './request-json.mjs';
import { COMPUTE_PROTOCOL, validateCapabilityManifest } from './protocol.mjs';
import { generateNodeIdentity, nodeIdFromPublicKey, signRequest } from './signature.mjs';
import { deriveHardwareMode, discoverHardware, loadSnapshot } from './hardware.mjs';
import { capabilityReadiness, engineHealthSummary, healthyCapabilities, probeExecutors } from './engine-probes.mjs';
import {
  HEARTBEAT_FILE_SCHEMA, aclCommand, contributionPaths, createClaimGuard, deviceProbeCommand, deviceProbeMs, gpuEvidenceTtlMs,
  hardwareRefreshMs, isPositiveGpuEvidence, parseDeviceProbe, readMeasuredInferenceSidecar, resolveNodePaths,
  selectGpuEvidence, selectMeasuredInference, shutdownSignals, yieldClaimBody, yieldToGpuMs
} from './node-agent-config.mjs';

const BASE_URL = String(process.env.MCCLUSTER_COMPUTE_URL || '').replace(/\/$/, '');
const ORG_ID = process.env.MCCLUSTER_ORG_ID || '';
// Windows defaults live under %ProgramData%\mccluster-node; POSIX keeps /var/lib and /etc.
const NODE_PATHS = resolveNodePaths({ platform: process.platform, env: process.env });
const STATE_DIR = NODE_PATHS.stateDir;
const MANIFEST_PATH = NODE_PATHS.manifest;
const IDENTITY_PATH = path.join(STATE_DIR, 'identity.json');
// The last engine observation that proved a model loaded with VRAM (24 h TTL).
const GPU_EVIDENCE_PATH = path.join(STATE_DIR, 'gpu-evidence.json');
// measured-inference.json beside the manifest: the doctor's benchmark writes it, the agent only reads it.
const MEASURED_INFERENCE_PATH = path.join(path.dirname(MANIFEST_PATH), 'measured-inference.json');
// The owner's contribution controls: the doctor writes the pause marker and limits.json, the agent
// honours them before every claim and writes last-heartbeat.json. (Contract:
// docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md on branch prime/contribution-ledger, not in this tree.)
const CONTRIBUTION_PATHS = contributionPaths({ platform: process.platform, env: process.env, nodePaths: NODE_PATHS });
const DEVICE_PROBE_MS = deviceProbeMs(process.env);
const AGENT_VERSION = '0.5.0';
const REQUEST_TIMEOUT_MS = Number(process.env.MCCLUSTER_NODE_REQUEST_TIMEOUT_MS || 10_000);
const POLL_MS = Math.max(1_000, Number(process.env.MCCLUSTER_NODE_POLL_MS || 5_000));
const HEARTBEAT_MS = Math.max(10_000, Number(process.env.MCCLUSTER_NODE_HEARTBEAT_MS || 30_000));
const ENGINE_PROBE_MS = Math.max(5_000, Number(process.env.MCCLUSTER_NODE_ENGINE_PROBE_MS || 15_000));
const SHUTDOWN_GRACE_MS = Math.max(5_000, Number(process.env.MCCLUSTER_NODE_SHUTDOWN_GRACE_MS || 30_000));
const GPU_EVIDENCE_TTL_MS = gpuEvidenceTtlMs(process.env);
// Full hardware discovery (process spawns) this often; the engine probe in between reuses the snapshot.
const HARDWARE_REFRESH_MS = hardwareRefreshMs(process.env);
// Leave fresh tasks to a live GPU node for this long (0 = never; the OVH node's deploy-gated lever).
const YIELD_MS = yieldToGpuMs(process.env);
// MCCLUSTER_NODE_ENROLL_ONLY=1: enrol (or confirm the identity) and exit, so a bootstrap token never lingers.
const ENROLL_ONLY = ['1', 'true'].includes(String(process.env.MCCLUSTER_NODE_ENROLL_ONLY || '').trim().toLowerCase());

if (!BASE_URL || !/^https:\/\//.test(BASE_URL)) throw new Error('MCCLUSTER_COMPUTE_URL must be an https:// URL');
if (!ORG_ID) throw new Error('MCCLUSTER_ORG_ID is required');

let stopping = false;
let labelOverrideLogged = false;
let lastMeasurementError = null;

// What the node has observed about itself: engine evidence, the derived
// hardware_mode, the gateway's count of other live GPU nodes, measurements.
const observed = {
  gpuEvidence: null,
  gpuVerifiedAt: null,
  hardwareMode: 'unknown',
  liveGpuNodes: 0,
  measurements: {},
  // The last claim-guard evaluation: paused, limits, device probe, gate, labels.
  contribution: null
};

function normalizeMaxLeases(value) {
  const parsed = Math.floor(Number(value || 1));
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(64, parsed));
}

function permanentError(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}

function log(record) { console.log(JSON.stringify(record)); }
function warn(record) { console.error(JSON.stringify(record)); }

// Best-effort NTFS ACL (chmod is a no-op on Windows); never fatal.
function applyAcl(target, isDirectory) {
  const acl = aclCommand({ platform: process.platform, env: process.env, target, isDirectory });
  if (!acl) return;
  try {
    execFileSync(acl.command, acl.args, { timeout: 5_000, windowsHide: true, stdio: 'ignore' });
  } catch (error) {
    warn({ event: 'compute_node_acl_unavailable', target: path.basename(target), error: String(error?.code || error?.message || error).slice(0, 200) });
  }
}

function ensureIdentity() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(STATE_DIR, 0o700);
  applyAcl(STATE_DIR, true);
  if (fs.existsSync(IDENTITY_PATH)) {
    const saved = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
    if (!saved.privateKeyPem || !saved.publicKeyPem) throw new Error('Compute node identity file is incomplete');
    const nodeId = nodeIdFromPublicKey(saved.publicKeyPem);
    if (saved.nodeId && saved.nodeId !== nodeId) throw new Error('Compute node identity file fingerprint mismatch');
    fs.chmodSync(IDENTITY_PATH, 0o600);
    applyAcl(IDENTITY_PATH, false);
    return { ...saved, nodeId };
  }
  const identity = generateNodeIdentity();
  const tmp = `${IDENTITY_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(identity, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, IDENTITY_PATH);
  fs.chmodSync(IDENTITY_PATH, 0o600);
  applyAcl(IDENTITY_PATH, false);
  return identity;
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { publicCapabilities: [], executors: new Map(), labels: {}, maxLeases: 1 };
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const entries = Array.isArray(raw) ? raw : (raw.capabilities || []);
  const publicCapabilities = validateCapabilityManifest(entries);
  const executors = new Map();
  entries.forEach((entry) => {
    if (entry?.implementation && entry?.executor) executors.set(entry.implementation, entry.executor);
  });
  return {
    publicCapabilities,
    executors,
    labels: (!Array.isArray(raw) && raw.labels && typeof raw.labels === 'object') ? raw.labels : {},
    maxLeases: normalizeMaxLeases(!Array.isArray(raw) ? raw.max_leases : 1)
  };
}

// The sidecar is evidence, not policy: an invalid or foreign file is ignored
// (logged once per reason) and the manifest is never touched.
function readMeasurements() {
  if (!fs.existsSync(MEASURED_INFERENCE_PATH)) { lastMeasurementError = null; return {}; }
  let text;
  try { text = fs.readFileSync(MEASURED_INFERENCE_PATH, 'utf8'); }
  catch { return observed.measurements; }
  const { measurements, error } = readMeasuredInferenceSidecar(text);
  if (error) {
    if (lastMeasurementError !== error) {
      warn({ event: 'compute_node_measurement_invalid', error });
      lastMeasurementError = error;
    }
    return {};
  }
  lastMeasurementError = null;
  return measurements;
}

function readPersistedEvidence() {
  try {
    const saved = JSON.parse(fs.readFileSync(GPU_EVIDENCE_PATH, 'utf8'));
    return isPositiveGpuEvidence(saved) && typeof saved.checked_at === 'string' && Number.isFinite(Date.parse(saved.checked_at)) ? saved : null;
  } catch { return null; }
}

function persistEvidence(evidence) {
  const record = {
    source: evidence.source || null,
    model: evidence.model || null,
    size_vram_bytes: Number(evidence.size_vram_bytes) || 0,
    size_bytes: Number(evidence.size_bytes) || 0,
    processor_gpu_percent: evidence.processor_gpu_percent ?? null,
    checked_at: evidence.checked_at
  };
  const tmp = `${GPU_EVIDENCE_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, GPU_EVIDENCE_PATH);
  } catch (error) {
    warn({ event: 'compute_node_evidence_persist_failed', error: String(error?.code || error?.message || error).slice(0, 200) });
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

function verifiedAtWithinTtl(now = Date.now()) {
  const at = typeof observed.gpuVerifiedAt === 'string' ? Date.parse(observed.gpuVerifiedAt) : NaN;
  return Number.isFinite(at) && now - at <= GPU_EVIDENCE_TTL_MS ? observed.gpuVerifiedAt : null;
}

// The executor health bodies are the engine's witness: the observation with
// the most VRAM in use becomes the node observation, and only a model loaded
// with VRAM (size_vram_bytes > 0) verifies the GPU and is persisted.
function observeEngines(healthSummary) {
  const evidence = selectGpuEvidence(healthSummary.map((item) => item.evidence));
  if (!evidence) return;
  observed.gpuEvidence = evidence;
  if (!isPositiveGpuEvidence(evidence)) return;
  const checkedAt = typeof evidence.checked_at === 'string' && Number.isFinite(Date.parse(evidence.checked_at)) ? evidence.checked_at : new Date().toISOString();
  observed.gpuVerifiedAt = checkedAt;
  persistEvidence({ ...evidence, checked_at: checkedAt });
}

function updateHardwareMode(hardware) {
  const mode = deriveHardwareMode({ gpus: hardware.gpus, probe: hardware.runtime?.gpu_probe, gpuVerifiedAt: observed.gpuVerifiedAt, ttlMs: GPU_EVIDENCE_TTL_MS });
  if (mode !== observed.hardwareMode) {
    log({
      event: 'compute_node_gpu_evidence', hardware_mode: mode, previous: observed.hardwareMode, gpus: hardware.gpus.length,
      gpu_verified_at: verifiedAtWithinTtl(), model: observed.gpuEvidence?.model || null, size_vram_bytes: observed.gpuEvidence?.size_vram_bytes ?? null
    });
    observed.hardwareMode = mode;
  }
  return mode;
}

// labels.hardware_mode always equals the derived value: a hand-written label
// cannot assert anything, and the Control pane and the code see one value.
// The contribution labels (paused, every limit, thermal_supported, claim_gate)
// come from the last claim-guard evaluation and override any hand-written copy.
function labelsFor(manifest) {
  const labels = { ...(manifest.labels || {}) };
  const asserted = labels.hardware_mode;
  if (asserted !== undefined && asserted !== observed.hardwareMode && !labelOverrideLogged) {
    log({ event: 'compute_node_label_overridden', label: 'hardware_mode', manifest_value: String(asserted).slice(0, 80), derived: observed.hardwareMode });
    labelOverrideLogged = true;
  }
  labels.hardware_mode = observed.hardwareMode;
  Object.assign(labels, observed.contribution?.labels || {});
  return labels;
}

// The device probe: one PowerShell on Windows (idle seconds across sessions, battery, thermal zone),
// bounded, output parsed into the sanitized shape; off Windows there is no probe and every limit
// that needs one fails closed with its reason.
function probeDevice() {
  const command = deviceProbeCommand(process.platform);
  if (!command) return parseDeviceProbe(null, `no device probe on ${process.platform}`);
  try {
    const text = execFileSync(command.command, command.args, { timeout: 20_000, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 65_536 });
    return parseDeviceProbe(text);
  } catch (error) {
    return parseDeviceProbe(null, error?.code || error?.message || error);
  }
}

const claimGuard = createClaimGuard({
  pausedPath: CONTRIBUTION_PATHS.pausedPath,
  limitsPath: CONTRIBUTION_PATHS.limitsPath,
  exists: (target) => fs.existsSync(target),
  readText: (target) => fs.readFileSync(target, 'utf8'),
  probe: probeDevice,
  cpus: () => os.cpus(),
  probeMs: DEVICE_PROBE_MS,
  probeIdleMs: HARDWARE_REFRESH_MS,
  onEvent: (record) => (record.event === 'compute_node_limits_invalid' ? warn(record) : log(record))
});

// The desktop reads this file (never the identity): when the last heartbeat was accepted and what it said.
function persistHeartbeat(nodeId, labels, advertisedCount) {
  const record = { schema: HEARTBEAT_FILE_SCHEMA, node_id: nodeId, at: new Date().toISOString(), agent_version: AGENT_VERSION, advertised: advertisedCount, live_gpu_nodes: observed.liveGpuNodes, labels };
  const tmp = `${CONTRIBUTION_PATHS.heartbeatPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, CONTRIBUTION_PATHS.heartbeatPath);
  } catch (error) {
    warn({ event: 'compute_node_heartbeat_persist_failed', error: String(error?.code || error?.message || error).slice(0, 200) });
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

function inventory(hardware, engineHealth = [], manifest = { publicCapabilities: [] }) {
  const value = structuredClone(hardware);
  value.runtime = {
    ...(value.runtime || {}),
    agent_version: AGENT_VERSION,
    engine_health: engineHealth,
    hardware_mode: observed.hardwareMode,
    gpu_evidence: observed.gpuEvidence,
    gpu_verified_at: verifiedAtWithinTtl(),
    measured_inference: selectMeasuredInference(observed.measurements, manifest.publicCapabilities),
    measured_inference_by_model: observed.measurements
  };
  return value;
}

async function rawRequest(pathname, { method = 'POST', body = {}, headers = {}, signal } = {}) {
  return requestJson(`${BASE_URL}${pathname}`, {
    method, signal, timeoutMs: REQUEST_TIMEOUT_MS,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
}

async function signedRequest(identity, pathname, body = {}, signal) {
  const bodyBytes = Buffer.from(JSON.stringify(body));
  const headers = signRequest({
    privateKeyPem: identity.privateKeyPem,
    method: 'POST', path: pathname, nodeId: identity.nodeId, bodyBytes
  });
  return requestJson(`${BASE_URL}${pathname}`, {
    method: 'POST', signal, timeoutMs: REQUEST_TIMEOUT_MS,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: bodyBytes
  });
}

async function enroll(identity, manifest, capabilities, hardware, healthSummary) {
  const token = process.env.MCCLUSTER_NODE_ENROLL_TOKEN;
  if (!token) return null;
  return rawRequest('/v1/compute/enroll', {
    headers: { authorization: `Bearer ${token}` },
    body: {
      protocol: COMPUTE_PROTOCOL,
      org_id: ORG_ID,
      display_name: process.env.MCCLUSTER_NODE_NAME || os.hostname(),
      public_key: identity.publicKeyPem,
      agent_version: AGENT_VERSION,
      inventory: inventory(hardware, healthSummary, manifest),
      capabilities,
      labels: labelsFor(manifest),
      max_leases: Math.max(1, Math.min(manifest.maxLeases, observed.contribution?.limits?.max_concurrency ?? manifest.maxLeases))
    }
  });
}

function executorFor(task, manifest) {
  if (task.implementation && manifest.executors.has(task.implementation)) return manifest.executors.get(task.implementation);
  for (const capability of manifest.publicCapabilities) {
    if (capability.capability === task.capability && manifest.executors.has(capability.implementation)) {
      return manifest.executors.get(capability.implementation);
    }
  }
  return null;
}

function assertLoopbackExecutor(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw permanentError('Executor must use HTTP(S)');
  if (!['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw permanentError('Node executors must be loopback services; remote provider calls belong behind Core policy');
  }
  return url;
}

async function executeHttp(executor, task, signal) {
  const url = assertLoopbackExecutor(executor.url);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const configuredTimeout = Number(executor.timeout_ms || 600_000);
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1000, Math.min(3_600_000, configuredTimeout)) : 600_000;
  const timeout = setTimeout(() => controller.abort(new Error('Executor deadline passed')), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', ...(executor.headers || {}) },
      body: JSON.stringify({ capability: task.capability, implementation: task.implementation, input: task.input, metadata: task.metadata || {}, priority: Number(task.priority || 0) }),
      signal: controller.signal
    });
    // Leave room for the signed gateway completion envelope (2 MiB limit).
    const text = await readBoundedText(res, 1_500_000);
    let result;
    try { result = text ? JSON.parse(text) : {}; } catch { result = { text }; }
    if (!res.ok) {
      const error = new Error(result?.error || `Local executor returned HTTP ${res.status}`);
      error.status = res.status;
      error.retryable = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
      throw error;
    }
    return result;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

async function executeTask(executor, task, signal) {
  if (!executor) throw permanentError(`No local executor configured for ${task.implementation || task.capability}`);
  if (executor.type === 'http') return executeHttp(executor, task, signal);
  throw permanentError(`Unsupported local executor type: ${executor.type || 'unknown'}`);
}

async function gracefulShutdown(active, signal) {
  if (stopping) return;
  stopping = true;
  log({ event: 'compute_node_draining', signal, active_leases: active.size });
  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  while (active.size && Date.now() < deadline) {
    await Promise.race([
      Promise.allSettled([...active.values()]),
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);
  }
  log({ event: 'compute_node_shutdown', signal, remaining_leases: active.size });
}

// Hardware discovery spawns processes (on Windows powershell.exe, reg.exe and
// the nvidia-smi attempts, each with a 5 s timeout), so it runs once at start
// and again only every HARDWARE_REFRESH_MS; the ENGINE_PROBE_MS cycle keeps
// the cached snapshot and stays the cheap loopback health read.
let hardwareCache = { at: 0, value: null };
function hardwareSnapshot(now = Date.now()) {
  if (!hardwareCache.value || now - hardwareCache.at >= HARDWARE_REFRESH_MS) {
    hardwareCache = { at: now, value: discoverHardware({ diskPath: STATE_DIR }) };
  }
  return hardwareCache.value;
}

// One probe cycle: manifest, sidecar, hardware (cached), executor health, evidence, mode.
async function probe() {
  const manifest = readManifest();
  observed.measurements = readMeasurements();
  const hardware = hardwareSnapshot();
  const engineHealth = await probeExecutors(manifest);
  const readiness = capabilityReadiness(manifest, engineHealth, hardware);
  const advertised = healthyCapabilities(manifest, engineHealth, hardware);
  const healthSummary = engineHealthSummary(engineHealth, readiness);
  observeEngines(healthSummary);
  updateHardwareMode(hardware);
  return { manifest, hardware, advertised, healthSummary };
}

async function run() {
  log({ event: 'compute_node_paths', platform: process.platform, state_dir: STATE_DIR, manifest: MANIFEST_PATH, defaults_applied: NODE_PATHS.defaultsApplied });
  const identityExisted = fs.existsSync(IDENTITY_PATH);
  if (ENROLL_ONLY && !process.env.MCCLUSTER_NODE_ENROLL_TOKEN && !identityExisted) {
    warn({ event: 'compute_node_enroll_token_missing' });
    process.exit(2);
  }
  const identity = ensureIdentity();
  const saved = readPersistedEvidence();
  if (saved) {
    observed.gpuEvidence = saved;
    observed.gpuVerifiedAt = saved.checked_at;
  }
  let { manifest, hardware, advertised, healthSummary } = await probe();
  observed.contribution = claimGuard.evaluate();

  const enrolled = await enroll(identity, manifest, advertised, hardware, healthSummary);
  if (enrolled) log({ event: 'compute_node_enrolled', node_id: identity.nodeId, protocol: enrolled.protocol, advertised: advertised.length, hardware_mode: observed.hardwareMode });
  else log({ event: 'compute_node_existing_identity', node_id: identity.nodeId, hardware_mode: observed.hardwareMode });
  if (ENROLL_ONLY) {
    log({ event: 'compute_node_enroll_only_done', node_id: identity.nodeId, enrolled: Boolean(enrolled) });
    process.exit(0);
  }

  const active = new Map();
  const shutdown = new AbortController();
  for (const signalName of shutdownSignals(process.platform)) {
    process.on(signalName, () => {
      shutdown.abort(new Error('Node shutdown'));
      gracefulShutdown(active, signalName).then(() => process.exit(active.size ? 1 : 0));
    });
  }

  let lastHeartbeat = 0;
  let lastProbe = Date.now();
  let consecutiveErrors = 0;

  while (!stopping) {
    try {
      if (Date.now() - lastProbe >= ENGINE_PROBE_MS) {
        ({ manifest, hardware, advertised, healthSummary } = await probe());
        lastProbe = Date.now();
      }

      // The owner's pause marker and limits are read before every claim (within one poll of a change).
      observed.contribution = claimGuard.evaluate();
      const maxLeases = Math.max(1, Math.min(manifest.maxLeases, observed.contribution.limits.max_concurrency));

      if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
        const labels = labelsFor(manifest);
        const reply = await signedRequest(identity, '/v1/compute/heartbeat', {
          agent_version: AGENT_VERSION,
          inventory: inventory(hardware, healthSummary, manifest),
          capabilities: advertised,
          labels,
          max_leases: maxLeases,
          load: loadSnapshot(active.size, { diskPath: STATE_DIR })
        });
        // Other live gpu-verified nodes, as the gateway counts them (null before the gateway is promoted).
        observed.liveGpuNodes = Number(reply?.live_gpu_nodes) || 0;
        lastHeartbeat = Date.now();
        persistHeartbeat(identity.nodeId, labels, advertised.length);
      }

      if (!stopping && advertised.length && observed.contribution.gate.allowed && active.size < maxLeases) {
        const sentAt = systemClock();
        const claimBody = yieldClaimBody({ yieldMs: YIELD_MS, liveGpuNodes: observed.liveGpuNodes, hardwareMode: observed.hardwareMode });
        const { lease } = await signedRequest(identity, '/v1/compute/lease', claimBody, shutdown.signal);
        if (lease) {
          const { lease_id: leaseId, lease_token: leaseToken, task } = lease;
          const executor = executorFor(task, manifest);
          const ready = task.implementation
            ? advertised.some((item) => item.implementation === task.implementation)
            : advertised.some((item) => item.capability === task.capability);
          if (!ready) {
            await signedRequest(identity, `/v1/compute/leases/${leaseId}/fail`, {
              lease_token: leaseToken,
              error: 'Local execution engine or hardware became unavailable before task start',
              retry: true
            });
            continue;
          }

          const promise = runLease({
            lease, nodeId: identity.nodeId, sentAt, signal: shutdown.signal,
            request: (pathname, body, signal) => signedRequest(identity, pathname, body, signal),
            execute: (leasedTask, signal) => executeTask(executor, leasedTask, signal),
            onEvent: (event, error) => warn({ event, lease_id: leaseId, task_id: task.id, error: error.message })
          }).catch((error) => {
            warn({ event: 'lease_execution_rejected', lease_id: leaseId, task_id: task.id, error: error.message });
          }).finally(() => active.delete(leaseId));
          active.set(leaseId, promise);
        }
      }
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      warn({ event: 'compute_node_loop_error', node_id: identity.nodeId, error: error.message, code: error.code || null, consecutive_errors: consecutiveErrors });
      if ([401, 403].includes(error.status)) {
        shutdown.abort(error);
        break;
      }
    }

    const backoff = Math.min(60_000, POLL_MS * (2 ** Math.min(4, consecutiveErrors)));
    const jitter = Math.floor(Math.random() * Math.min(1_000, Math.max(1, backoff / 5)));
    await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
  }

  await gracefulShutdown(active, 'loop-exit');
}

run().catch((error) => {
  warn({ event: 'compute_node_fatal', error: error.message });
  process.exit(1);
});
