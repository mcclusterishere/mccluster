import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { COMPUTE_PROTOCOL, validateCapabilityManifest } from './protocol.mjs';
import { generateNodeIdentity, nodeIdFromPublicKey, signRequest } from './signature.mjs';

const BASE_URL = String(process.env.MCCLUSTER_COMPUTE_URL || '').replace(/\/$/, '');
const ORG_ID = process.env.MCCLUSTER_ORG_ID || '';
const STATE_DIR = process.env.MCCLUSTER_NODE_STATE_DIR || '/var/lib/mccluster-node';
const MANIFEST_PATH = process.env.MCCLUSTER_NODE_MANIFEST || '/etc/mccluster-node/capabilities.json';
const IDENTITY_PATH = path.join(STATE_DIR, 'identity.json');
const AGENT_VERSION = '0.1.0';
const POLL_MS = Math.max(1_000, Number(process.env.MCCLUSTER_NODE_POLL_MS || 5_000));
const HEARTBEAT_MS = Math.max(10_000, Number(process.env.MCCLUSTER_NODE_HEARTBEAT_MS || 30_000));

if (!BASE_URL || !/^https:\/\//.test(BASE_URL)) throw new Error('MCCLUSTER_COMPUTE_URL must be an https:// URL');
if (!ORG_ID) throw new Error('MCCLUSTER_ORG_ID is required');

function ensureIdentity() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  if (fs.existsSync(IDENTITY_PATH)) {
    const saved = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
    if (!saved.privateKeyPem || !saved.publicKeyPem) throw new Error('Compute node identity file is incomplete');
    const nodeId = nodeIdFromPublicKey(saved.publicKeyPem);
    if (saved.nodeId && saved.nodeId !== nodeId) throw new Error('Compute node identity file fingerprint mismatch');
    return { ...saved, nodeId };
  }
  const identity = generateNodeIdentity();
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2), { mode: 0o600, flag: 'wx' });
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
    maxLeases: (!Array.isArray(raw) && raw.max_leases) ? Number(raw.max_leases) : 1
  };
}

function nvidiaGpus() {
  try {
    const out = execFileSync('nvidia-smi', [
      '--query-gpu=name,uuid,memory.total,driver_version,compute_cap',
      '--format=csv,noheader,nounits'
    ], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const [model, uuid, mib, driver, compute] = line.split(',').map((v) => v.trim());
      return { vendor: 'nvidia', model, uuid, vram_bytes: Number(mib || 0) * 1024 * 1024, driver, compute };
    });
  } catch { return []; }
}

function inventory() {
  let diskFree = 0;
  try {
    const stat = fs.statfsSync('/');
    diskFree = Number(stat.bavail) * Number(stat.bsize);
  } catch {}
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpu_count: os.cpus().length,
    memory_bytes: os.totalmem(),
    disk_free_bytes: diskFree,
    gpus: nvidiaGpus(),
    runtime: { node: process.version }
  };
}

function loadSnapshot(runningLeases) {
  return {
    running_leases: runningLeases,
    memory_free_bytes: os.freemem(),
    disk_free_bytes: inventory().disk_free_bytes,
    gpu: []
  };
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

async function enroll(identity, manifest) {
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
      inventory: inventory(),
      capabilities: manifest.publicCapabilities,
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
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Executor must use HTTP(S)');
  if (!['127.0.0.1', '::1', 'localhost'].includes(url.hostname)) {
    throw new Error('Node executors must be loopback services; remote provider calls belong behind Core policy');
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
    if (!res.ok) throw new Error(result?.error || `Local executor returned HTTP ${res.status}`);
    return result;
  } finally { clearTimeout(timeout); }
}

async function executeTask(executor, task) {
  if (!executor) throw new Error(`No local executor configured for ${task.implementation || task.capability}`);
  if (executor.type === 'http') return executeHttp(executor, task);
  throw new Error(`Unsupported local executor type: ${executor.type || 'unknown'}`);
}

async function run() {
  const identity = ensureIdentity();
  let manifest = readManifest();
  const enrolled = await enroll(identity, manifest);
  if (enrolled) console.log(JSON.stringify({ event: 'compute_node_enrolled', node_id: identity.nodeId, protocol: enrolled.protocol }));
  else console.log(JSON.stringify({ event: 'compute_node_existing_identity', node_id: identity.nodeId }));

  const active = new Map();
  let lastHeartbeat = 0;

  while (true) {
    try {
      if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
        manifest = readManifest();
        await signedRequest(identity, '/v1/compute/heartbeat', {
          agent_version: AGENT_VERSION,
          inventory: inventory(),
          capabilities: manifest.publicCapabilities,
          labels: manifest.labels,
          max_leases: manifest.maxLeases,
          load: loadSnapshot(active.size)
        });
        lastHeartbeat = Date.now();
      }

      if (active.size < manifest.maxLeases) {
        const { lease } = await signedRequest(identity, '/v1/compute/lease', {});
        if (lease) {
          const { lease_id: leaseId, lease_token: leaseToken, task } = lease;
          await signedRequest(identity, `/v1/compute/leases/${leaseId}/start`, { lease_token: leaseToken, extend_seconds: 120 });
          const executor = executorFor(task, manifest);
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
            .catch((error) => signedRequest(identity, `/v1/compute/leases/${leaseId}/fail`, { lease_token: leaseToken, error: error.message, retry: false }))
            .finally(() => { clearInterval(leaseHeartbeat); active.delete(leaseId); });
          active.set(leaseId, promise);
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'compute_node_loop_error', node_id: identity.nodeId, error: error.message, code: error.code || null }));
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ event: 'compute_node_fatal', error: error.message }));
  process.exit(1);
});
