#!/usr/bin/env node
// TEST ONLY. This worker supplies a synthetic Mac inventory for the disposable
// staging walkthrough. It proves protocol behavior, never Mac/Metal performance.
import './loopback-only.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { generateNodeIdentity, nodeIdFromPublicKey, signRequest } from '../../src/compute/signature.mjs';
import { COMPUTE_PROTOCOL, validateCapabilityManifest } from '../../src/compute/protocol.mjs';
import { requestJson, readBoundedText } from '../../src/compute/request-json.mjs';
import { runLease, systemClock } from '../../src/compute/lease-runtime.mjs';
import { collectAdapterStream } from '../../src/compute/ndjson.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const VERSION = 'simulated-mac-fixture/1';
const CAPABILITIES = validateCapabilityManifest([{ capability: 'ai.chat', implementation: 'qwen3.8b.local', model: 'qwen3:8b', backend: 'ollama', version: VERSION, max_concurrency: 1, features: { chat: true, tools: true } }]);
const INVENTORY = { hostname: 'simulated-mac', platform: 'darwin', arch: 'arm64', cpu_count: 8, memory_bytes: 16 * 1024 ** 3, gpus: [], runtime: { fixture: true, hardware_mode: 'simulated' } };
const LABELS = { fixture: 'simulated-mac', site: 'owner-workspace-staging' };
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const log = (event, extra = {}) => console.log(JSON.stringify({ event, fixture: 'simulated-mac', ...extra }));

function configuration() {
  if (process.env.MCCLUSTER_SIMULATED_MAC_WORKER !== '1') throw fail('SIMULATION_NOT_ENABLED', 'Enable the explicit test-only simulated worker flag.');
  if (process.env.MCCLUSTER_NODE_ENROLL_TOKEN) throw fail('CREDENTIAL_ENV_REFUSED', 'The simulated worker accepts enrollment credentials only through stdin.');
  const compute = new URL(process.env.MCCLUSTER_COMPUTE_URL || '');
  if (compute.protocol !== 'https:' || !LOCAL.has(compute.hostname) || compute.username || compute.password || compute.pathname !== '/' || compute.search || compute.hash) throw fail('FIXTURE_COORDINATOR_INVALID', 'The simulated worker requires the disposable loopback HTTPS coordinator.');
  const adapter = new URL(process.env.MCCLUSTER_SIMULATED_MAC_ADAPTER_URL || '');
  if (adapter.protocol !== 'http:' || !LOCAL.has(adapter.hostname) || adapter.username || adapter.password || adapter.pathname !== '/execute' || adapter.search || adapter.hash) throw fail('FIXTURE_ADAPTER_INVALID', 'The simulated worker requires a loopback adapter /execute endpoint.');
  const orgId = process.env.MCCLUSTER_ORG_ID;
  if (!UUID.test(orgId || '')) throw fail('FIXTURE_ORG_INVALID', 'A fixture organization UUID is required.');
  const stateDir = process.env.MCCLUSTER_NODE_STATE_DIR;
  if (!stateDir || !path.isAbsolute(stateDir) || /[\x00-\x1f\x7f]/.test(stateDir) || path.parse(stateDir).root === stateDir) throw fail('FIXTURE_STATE_INVALID', 'A private absolute worker state directory is required.');
  const name = (process.env.MCCLUSTER_NODE_NAME || 'Simulated Mac').trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw fail('FIXTURE_NAME_INVALID', 'Name the simulated worker using 1–80 visible characters.');
  return { compute: compute.origin, adapter: adapter.href, health: new URL('/ready?implementation=qwen3.8b.local', adapter).href, orgId, stateDir, name,
    enrollOnly: process.env.MCCLUSTER_NODE_ENROLL_ONLY === '1', pollMs: Math.max(1000, Math.min(10000, Number(process.env.MCCLUSTER_NODE_POLL_MS) || 1000)), heartbeatMs: Math.max(1000, Math.min(30000, Number(process.env.MCCLUSTER_NODE_HEARTBEAT_MS) || 10000)) };
}

function noSymlinks(filename) {
  let cursor = path.parse(filename).root;
  for (const part of filename.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw fail('FIXTURE_STATE_SYMLINK', 'Worker state cannot use symbolic links.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function identityFor(stateDir) {
  noSymlinks(stateDir);
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const directory = fs.lstatSync(stateDir);
  if (!directory.isDirectory() || (process.getuid && directory.uid !== process.getuid())) throw fail('FIXTURE_STATE_OWNER', 'Worker state must belong to the current account.');
  fs.chmodSync(stateDir, 0o700);
  const filename = path.join(stateDir, 'identity.json');
  noSymlinks(filename);
  if (fs.existsSync(filename)) {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw fail('FIXTURE_IDENTITY_PERMISSIONS', 'The saved identity must be a private regular file belonging to this account.');
    try {
      const identity = JSON.parse(fs.readFileSync(filename, 'utf8'));
      const privateKey = createPrivateKey(identity.privateKeyPem);
      const publicKey = createPublicKey(identity.publicKeyPem);
      const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
      if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519' || derived !== publicKey.export({ type: 'spki', format: 'pem' }) || identity.nodeId !== nodeIdFromPublicKey(identity.publicKeyPem)) throw new Error('invalid identity');
      return { identity, existed: true };
    } catch { throw fail('FIXTURE_IDENTITY_INVALID', 'The saved simulated worker identity is invalid.'); }
  }
  const identity = generateNodeIdentity();
  fs.writeFileSync(filename, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  return { identity, existed: false };
}

async function stdinCredential() {
  if (process.env.MCCLUSTER_NODE_ENROLL_TOKEN_STDIN !== '1') return null;
  const chunks = []; let length = 0;
  try {
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 256) throw fail('FIXTURE_CREDENTIAL_INVALID', 'The enrollment credential is invalid.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    try {
      const value = bytes.toString('utf8').trim();
      if (!/^mcen1_[A-Za-z0-9_-]{43}$/.test(value)) throw fail('FIXTURE_CREDENTIAL_INVALID', 'The enrollment credential is invalid.');
      return value;
    } finally { bytes.fill(0); }
  } finally { for (const chunk of chunks) chunk.fill(0); }
}

function pause(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
  });
}

async function main() {
  const config = configuration();
  let credential = await stdinCredential();
  const { identity, existed } = identityFor(config.stateDir);
  const shutdown = new AbortController();
  for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => shutdown.abort(fail('FIXTURE_STOPPED', 'Simulated worker stopped.')));
  let active = false, capabilities = [], heartbeating = false, heartbeatTimer, heartbeatWork = Promise.resolve();
  const signed = (pathname, body = {}, signal = shutdown.signal) => {
    const bodyBytes = Buffer.from(JSON.stringify(body));
    return requestJson(`${config.compute}${pathname}`, { method: 'POST', signal, timeoutMs: 10000, headers: { 'content-type': 'application/json', ...signRequest({ privateKeyPem: identity.privateKeyPem, nodeId: identity.nodeId, method: 'POST', path: pathname, bodyBytes }) }, body: bodyBytes });
  };
  const probe = async () => {
    try {
      const result = await requestJson(config.health, { signal: shutdown.signal, timeoutMs: 3000 });
      capabilities = result.ok === true && result.model_installed === true && result.model === 'qwen3:8b' && result.implementation === 'qwen3.8b.local' && result.digest ? CAPABILITIES : [];
    }
    catch { capabilities = []; }
  };
  const heartbeat = async () => {
    await probe();
    return signed('/v1/compute/heartbeat', { inventory: INVENTORY, capabilities, labels: LABELS, max_leases: 1, load: { running_leases: Number(active) }, agent_version: VERSION });
  };
  let connected = false;
  if (existed) {
    try { connected = (await heartbeat()).ok === true; }
    catch (error) { if (error.code !== 'UNKNOWN_NODE') throw error; }
  }
  if (!connected) {
    if (!credential) throw fail('FIXTURE_ENROLLMENT_REQUIRED', 'Install this simulated worker with an owner-issued stdin credential.');
    const result = await requestJson(`${config.compute}/v1/compute/enroll`, { method: 'POST', signal: shutdown.signal, timeoutMs: 10000,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
      body: JSON.stringify({ protocol: COMPUTE_PROTOCOL, org_id: config.orgId, display_name: config.name, public_key: identity.publicKeyPem, inventory: INVENTORY, capabilities: [], labels: LABELS, max_leases: 1, agent_version: VERSION }) });
    if (result.node_id !== identity.nodeId) throw fail('FIXTURE_ENROLLMENT_MISMATCH', 'Core returned a different worker identity.');
    credential = null;
    connected = (await heartbeat()).ok === true;
  }
  credential = null;
  if (!connected) throw fail('FIXTURE_HEARTBEAT_UNCONFIRMED', 'Core did not acknowledge this simulated worker.');
  if (config.enrollOnly) { log('simulated_mac_worker_enroll_only_done', { node_id: identity.nodeId }); return; }
  log('simulated_mac_worker_ready', { node_id: identity.nodeId, inventory: INVENTORY, max_leases: 1, model_ready: capabilities.length > 0 });
  const execute = async (task, signal, onProgress) => {
    if (task.capability !== 'ai.chat' || task.implementation !== 'qwen3.8b.local') throw fail('FIXTURE_CAPABILITY_DENIED', 'The simulated Mac supports only its declared local chat mapping.', { retryable: false });
    const response = await fetch(config.adapter, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify({ capability: task.capability, implementation: task.implementation, input: { num_ctx: 4096, ...task.input, strict_model: true }, metadata: task.metadata || {}, priority: Number(task.priority || 0) }) });
    if (!response.ok) { await response.body?.cancel(); throw fail('FIXTURE_ADAPTER_FAILED', 'The loopback adapter refused simulated inference.', { retryable: true }); }
    if (response.headers.get('content-type')?.includes('application/x-ndjson')) return await collectAdapterStream(response, onProgress);
    const result = JSON.parse(await readBoundedText(response, 1500000));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('FIXTURE_ADAPTER_INVALID', 'The loopback adapter returned invalid output.');
    return result;
  };
  heartbeatTimer = setInterval(() => {
    if (heartbeating || shutdown.signal.aborted) return;
    heartbeating = true;
    heartbeatWork = heartbeat().catch(error => {
      log('simulated_mac_worker_heartbeat_failed', { code: error.code || 'TRANSPORT_ERROR' });
      if ([401, 403].includes(error.status)) shutdown.abort(error);
    }).finally(() => { heartbeating = false; });
  }, config.heartbeatMs);
  heartbeatTimer.unref();
  try {
    while (!shutdown.signal.aborted) {
      try {
        const sentAt = systemClock();
        const { lease } = await signed('/v1/compute/lease', { lease_seconds: 120 });
        if (lease) {
          active = true;
          try {
            const result = await runLease({ lease, nodeId: identity.nodeId, sentAt, signal: shutdown.signal, request: signed, execute,
              onEvent: (event, error) => log('simulated_mac_worker_lease_event', { lease_event: event, code: error?.code || 'LEASE_EVENT', task_id: lease.task?.id }) });
            log('simulated_mac_worker_task_finished', { task_id: result.task_id, status: result.status });
          } finally { active = false; }
        } else await pause(config.pollMs, shutdown.signal);
      } catch (error) {
        if (shutdown.signal.aborted) break;
        log('simulated_mac_worker_poll_failed', { code: error.code || 'TRANSPORT_ERROR' });
        if ([401, 403].includes(error.status)) { shutdown.abort(error); break; }
        await pause(config.pollMs, shutdown.signal);
      }
    }
  } finally { clearInterval(heartbeatTimer); await heartbeatWork; log('simulated_mac_worker_stopped', { node_id: identity.nodeId }); }
}

main().catch(error => {
  // Only controlled codes are logged; secrets, prompts and server bodies never
  // become fixture process output or staging artifacts.
  log('simulated_mac_worker_failed', { code: /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code || '') ? error.code : 'FIXTURE_FAILED' });
  process.exitCode = 1;
});
