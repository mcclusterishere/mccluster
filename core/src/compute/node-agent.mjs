import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMPUTE_PROTOCOL, validateCapabilityManifest } from './protocol.mjs';
import { generateNodeIdentity, nodeIdFromPublicKey, signRequest } from './signature.mjs';
import { discoverHardware, loadSnapshot } from './hardware.mjs';
import { engineHealthSummary, healthyCapabilities, probeExecutors } from './engine-probes.mjs';

const BASE_URL = String(process.env.MCCLUSTER_COMPUTE_URL || '').replace(/\/$/, '');
const ORG_ID = process.env.MCCLUSTER_ORG_ID || '';
const STATE_DIR = process.env.MCCLUSTER_NODE_STATE_DIR || '/var/lib/mccluster-node';
const MANIFEST_PATH = process.env.MCCLUSTER_NODE_MANIFEST || '/etc/mccluster-node/capabilities.json';
const IDENTITY_PATH = path.join(STATE_DIR, 'identity.json');
const AGENT_VERSION = '0.2.0';
const POLL_MS = Math.max(1_000, Number(process.env.MCCLUSTER_NODE_POLL_MS || 5_000));
const HEARTBEAT_MS = Math.max(10_000, Number(process.env.MCCLUSTER_NODE_HEARTBEAT_MS || 30_000));
const ENGINE_PROBE_MS = Math.max(5_000, Number(process.env.MCCLUSTER_NODE_ENGINE_PROBE_MS || 15_000));
const SHUTDOWN_GRACE_MS = Math.max(5_000, Number(process.env.MCCLUSTER_NODE_SHUTDOWN_GRACE_MS || 30_000));

if (!BASE_URL || !/^https:\/\//.test(BASE_URL)) throw new Error('MCCLUSTER_COMPUTE_URL must be an https:// URL');
if (!ORG_ID) throw new Error('MCCLUSTER_ORG_ID is required');

let stopping = false;

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

function ensureIdentity() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(STATE_DIR, 0o700);
  if (fs.existsSync(IDENTITY_PATH)) {
    const saved = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
    if (!saved.privateKeyPem || !saved.publicKeyPem) throw new Error('Compute node identity file is incomplete');
    const nodeId = nodeIdFromPublicKey(saved.publicKeyPem);
    if (saved.nodeId && saved.nodeId !== nodeId) throw new Error('Compute node identity file fingerprint mismatch');
    fs.chmodSync(IDENTITY_PATH, 0o600);
    return { ...saved, nodeId };
  }
  const identity = generateNodeIdentity();
  const tmp = `${IDENTITY_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(identity, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, IDENTITY_PATH);
  fs.chmodSync(IDENTITY_PATH, 0o600);
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

function inventory(engineHealth = []) {
  const value = discoverHardware();
  value.runtime = { ...(value.runtime || {}), agent_version: AGENT_VERSION, engine_health: engineHealth };
  return value;
}

async function rawRequest(pathname, { method = 'POST', body = {}, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  if (!res.ok) {
    const error = new Error(parsed?.error || `${res.status} ${res.statusText}`);
    error.status = res.status;
    error.code = parsed?.code;
    throw error;
  }
  return parsed;
}

async function signedRequest(identity, pathname, body = {}) {
  const bodyBytes = Buffer.from(JSON.stringify(body));
  const headers = signRequest({
    privateKeyPem: identity.privateKeyPem,
    method: 'POST',
    path: pathname,
    nodeId: identity.nodeId,
    bodyBytes
  });
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: bodyBytes
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  if (!res.ok) {
    const error = new Error(parsed?.error || `${res.status} ${res.statusText}`);
    error.status = res.status;
    error.code = parsed?.code;
    throw error;
  }
  return parsed;
}

async function enroll(identity, manifest, capabilities, engineHealth) {
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
      inventory: inventory(engineHealthSummary(engineHealth)),
      capabilities,
      labels: manifest.labels,
      max_leases: manifest.maxLeases
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

async function executeHttp(executor, task) {
  const url = assertLoopbackExecutor(executor.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(30_000, Number(executor.timeout_ms || 3_600_000)));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(executor.headers || {}) },
      body: JSON.stringify({ capability: task.capability, implementation: task.implementation, input: task.input, metadata: task.metadata || {} }),
      signal: controller.signal
    });
    const text = await res.text();
    let result;
    try { result = text ? JSON.parse(text) : {}; } catch { result = { text }; }
    if (!res.ok) {
      const error = new Error(result?.error || `Local executor returned HTTP ${res.status}`);
      error.status = res.status;
      error.retryable = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
      throw error;
    }
    return result;
  } finally { clearTimeout(timeout); }
}

async function executeTask(executor, task) {
  if (!executor) throw permanentError(`No local executor configured for ${task.implementation || task.capability}`);
  if (executor.type === 'http') return executeHttp(executor, task);
  throw permanentError(`Unsupported local executor type: ${executor.type || 'unknown'}`);
}

async function gracefulShutdown(active, signal) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: 'compute_node_draining', signal, active_leases: active.size }));
  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  while (active.size && Date.now() < deadline) {
    await Promise.race([
      Promise.allSettled([...active.values()]),
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);
  }
  console.log(JSON.stringify({ event: 'compute_node_shutdown', signal, remaining_leases: active.size }));
}

async function run() {
  const identity = ensureIdentity();
  let manifest = readManifest();
  let engineHealth = await probeExecutors(manifest);
  let advertised = healthyCapabilities(manifest, engineHealth);
  const enrolled = await enroll(identity, manifest, advertised, engineHealth);
  if (enrolled) console.log(JSON.stringify({ event: 'compute_node_enrolled', node_id: identity.nodeId, protocol: enrolled.protocol, advertised: advertised.length }));
  else console.log(JSON.stringify({ event: 'compute_node_existing_identity', node_id: identity.nodeId }));

  const active = new Map();
  process.on('SIGTERM', () => gracefulShutdown(active, 'SIGTERM').then(() => process.exit(active.size ? 1 : 0)));
  process.on('SIGINT', () => gracefulShutdown(active, 'SIGINT').then(() => process.exit(active.size ? 1 : 0)));

  let lastHeartbeat = 0;
  let lastProbe = 0;
  let consecutiveErrors = 0;

  while (!stopping) {
    try {
      if (Date.now() - lastProbe >= ENGINE_PROBE_MS) {
        manifest = readManifest();
        engineHealth = await probeExecutors(manifest);
        advertised = healthyCapabilities(manifest, engineHealth);
        lastProbe = Date.now();
      }

      if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
        await signedRequest(identity, '/v1/compute/heartbeat', {
          agent_version: AGENT_VERSION,
          inventory: inventory(engineHealthSummary(engineHealth)),
          capabilities: advertised,
          labels: manifest.labels,
          max_leases: manifest.maxLeases,
          load: loadSnapshot(active.size)
        });
        lastHeartbeat = Date.now();
      }

      if (!stopping && advertised.length && active.size < manifest.maxLeases) {
        const { lease } = await signedRequest(identity, '/v1/compute/lease', {});
        if (lease) {
          const { lease_id: leaseId, lease_token: leaseToken, task } = lease;
          const executor = executorFor(task, manifest);
          const healthy = task.implementation
            ? engineHealth.get(task.implementation)?.healthy === true
            : advertised.some((item) => item.capability === task.capability);
          if (!healthy) {
            await signedRequest(identity, `/v1/compute/leases/${leaseId}/fail`, {
              lease_token: leaseToken,
              error: 'Local execution engine became unavailable before task start',
              retry: true
            });
            continue;
          }

          await signedRequest(identity, `/v1/compute/leases/${leaseId}/start`, { lease_token: leaseToken, extend_seconds: 120 });
          const leaseHeartbeat = setInterval(() => {
            signedRequest(identity, `/v1/compute/leases/${leaseId}/heartbeat`, {
              lease_token: leaseToken,
              progress: { state: 'running', agent_time: new Date().toISOString() },
              extend_seconds: 120
            }).catch((error) => console.error(JSON.stringify({ event: 'lease_heartbeat_failed', lease_id: leaseId, error: error.message })));
          }, 30_000);
          leaseHeartbeat.unref();

          const promise = executeTask(executor, task)
            .then((result) => signedRequest(identity, `/v1/compute/leases/${leaseId}/complete`, { lease_token: leaseToken, result }))
            .catch(async (error) => {
              try {
                await signedRequest(identity, `/v1/compute/leases/${leaseId}/fail`, {
                  lease_token: leaseToken,
                  error: error.message,
                  retry: error.retryable !== false
                });
              } catch (reportError) {
                console.error(JSON.stringify({ event: 'lease_failure_report_failed', lease_id: leaseId, task_id: task.id, error: reportError.message }));
              }
            })
            .finally(() => { clearInterval(leaseHeartbeat); active.delete(leaseId); });
          active.set(leaseId, promise);
        }
      }
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      console.error(JSON.stringify({ event: 'compute_node_loop_error', node_id: identity.nodeId, error: error.message, code: error.code || null, consecutive_errors: consecutiveErrors }));
    }

    const backoff = Math.min(60_000, POLL_MS * (2 ** Math.min(4, consecutiveErrors)));
    const jitter = Math.floor(Math.random() * Math.min(1_000, Math.max(1, backoff / 5)));
    await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
  }

  await gracefulShutdown(active, 'loop-exit');
}

run().catch((error) => {
  console.error(JSON.stringify({ event: 'compute_node_fatal', error: error.message }));
  process.exit(1);
});
