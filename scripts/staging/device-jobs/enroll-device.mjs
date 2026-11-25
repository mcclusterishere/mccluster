#!/usr/bin/env node
// Enrol THIS device into a running device-jobs staging (serve.mjs) and keep it
// working: starts the REAL Ollama adapter (core/src/compute/ollama-adapter.mjs)
// against the local Ollama daemon with one implementation mapping, then the
// REAL node agent (core/src/compute/node-agent.mjs) pointed at the staging
// gateway, with a fresh identity in --state-dir. The manifest advertises
// ai.chat with exactly that implementation at concurrency 1. The same file
// runs on Windows, macOS and Linux.
//
// On the machine that runs serve.mjs:
//   node scripts/staging/device-jobs/enroll-device.mjs --run-dir <run dir> \
//     --state-dir <dir> --implementation qwen3-vl.4b.local --model qwen3-vl:4b
//
// On another device (the run directory is not there), through the hostname the
// owner published behind Cloudflare Access (docs/control-plane/DEVICE-STAGING-ACCESS.md):
//   node scripts/staging/device-jobs/enroll-device.mjs \
//     --compute-url https://<staging-hostname> --trust system --org <org id> \
//     --enroll-token-file <file> --state-dir <dir> --implementation qwen3.8b.local --model qwen3:8b
// Trust is exactly one of --trust system (a public-CA hostname) or --ca <file>
// (a pinned CA); nothing turns verification off. The enrolment token is read
// from MCCLUSTER_NODE_ENROLL_TOKEN or --enroll-token-file and never printed. An
// Access service token is read only from MCCLUSTER_ACCESS_CLIENT_ID and
// MCCLUSTER_ACCESS_CLIENT_SECRET, sent on every request to the staging host,
// and never logged or written to disk. --preflight checks DNS, TLS, /health and
// an Access block from this device, prints one report and exits (0 ready,
// 3 blocked by Access, 1 otherwise). The production hosts are refused.
//
// It stays up until SIGINT/SIGTERM, until stdin closes (unless --no-stdin), or
// until a file named "stop" appears in the state directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDeviceManifest, connectStaging, requestJson, validateEnrollOptions } from './real-device-lib.mjs';
import { ACCESS_ENV, preflightExitCode, preflightStaging, redactSecrets } from './staging-access.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let options;
try { options = validateEnrollOptions(process.argv.slice(2)); }
catch (error) { console.error(JSON.stringify({ event: 'enroll_usage_error', error: error.message })); process.exit(2); }

const { stateDir, implementation, model } = options;
const file = (name) => path.join(stateDir, name);
const children = new Map();
// The node agent's own stop file (MCCLUSTER_NODE_STOP_FILE) and how long it gets: its 30 s drain plus a margin.
const AGENT_STOP_FILE = 'node-agent.stop';
const AGENT_STOP_WAIT_MS = 40_000;
let stopping = false;
let stopWatch;
// Every credential this process holds; nothing it prints may contain one.
let secrets = [process.env.MCCLUSTER_NODE_ENROLL_TOKEN, process.env[ACCESS_ENV.id], process.env[ACCESS_ENV.secret]].filter(Boolean).map((value) => String(value).trim());
const say = (stream, record) => stream(JSON.stringify(redactSecrets(record, secrets)));

function fail(event, error, code = 1) {
  say(console.error, { event, error: error.message || String(error), code: error.code || null, ...(error.preflight ? { preflight: error.preflight } : {}) });
  return shutdown(event, error.exitCode || code);
}

async function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(stopWatch);
  // --preflight has no state directory and started nothing.
  if (!stateDir) process.exit(code);
  // The agent first, so it stops claiming before its executor goes away. It is
  // asked through its stop file on every platform: on Windows a SIGTERM is
  // TerminateProcess, no handler runs and a lease it is running would be left
  // to expire. The stop file drains instead (a running lease finishes and
  // commits within the agent's grace period). The kill is only the fallback.
  const agent = children.get('node-agent');
  if (agent && agent.exitCode === null) {
    await new Promise((resolve) => {
      agent.once('exit', resolve);
      try { fs.writeFileSync(file(AGENT_STOP_FILE), ''); } catch { agent.kill('SIGTERM'); }
      setTimeout(() => { try { agent.kill('SIGKILL'); } catch {} resolve(); }, AGENT_STOP_WAIT_MS).unref();
    });
  }
  // The adapter holds no lease and no durable state; once the agent is gone a signal is enough.
  const adapter = children.get('adapter');
  if (adapter && adapter.exitCode === null) {
    await new Promise((resolve) => { adapter.once('exit', resolve); adapter.kill('SIGTERM'); setTimeout(() => { try { adapter.kill('SIGKILL'); } catch {} resolve(); }, 10_000).unref(); });
  }
  fs.rmSync(file(AGENT_STOP_FILE), { force: true });
  try {
    const current = JSON.parse(fs.readFileSync(file('device.json'), 'utf8'));
    fs.writeFileSync(file('device.json'), JSON.stringify({ ...current, stopped_at: new Date().toISOString(), stop_reason: reason }, null, 2));
  } catch {}
  fs.rmSync(file('stop'), { force: true });
  process.exit(code);
}

function start(name, script, env) {
  const out = fs.createWriteStream(file(`${name}.log`), { flags: 'a' });
  const child = spawn(process.execPath, [script], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(out); child.stderr.pipe(out);
  child.on('exit', (code, signal) => { if (!stopping) fail(`${name.replace('-', '_')}_exited`, new Error(`${name} exited (code ${code}, signal ${signal}); see ${name}.log in the state directory`)); });
  child.on('error', (error) => { if (!stopping) fail(`${name.replace('-', '_')}_exited`, error); });
  children.set(name, child);
  return child;
}

// Resolves with the first stdout JSON line that satisfies `match`.
function waitForLine(child, match, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lines = readline.createInterface({ input: child.stdout });
    // Closing a readline interface pauses its input, which would also stop the
    // pipe into the child's log file (and, once the pipe fills, the child).
    const release = () => { lines.close(); child.stdout.resume(); };
    const timer = setTimeout(() => { release(); reject(new Error(`${label} did not happen within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
    lines.on('line', (line) => {
      let record; try { record = JSON.parse(line); } catch { return; }
      if (!match(record)) return;
      clearTimeout(timer); release(); resolve(record);
    });
  });
}

// Environment for the children: nothing named for a node, the Core or the
// adapter is inherited from the caller; each child gets only what is set here.
function cleanEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(?:SUPABASE_|CORE_|MCCLUSTER_)/i.test(key)) env[key] = value;
  return { ...env, ...extra };
}

// DNS, TLS, /health as the compute gateway, and an Access block, from this device.
function preflight(staging) {
  return preflightStaging({ computeUrl: staging.computeUrl, trust: staging.trust, ca: staging.ca, access: staging.access, request: requestJson });
}

async function main() {
  const staging = connectStaging(options.staging, { tokenEnv: 'MCCLUSTER_NODE_ENROLL_TOKEN', needToken: !options.preflight });
  secrets = [...new Set([...secrets, ...staging.secrets])];
  if (options.preflight) {
    const report = await preflight(staging);
    say(console.log, { event: 'staging_preflight', ...report });
    process.exit(preflightExitCode(report));
  }
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.rmSync(file('stop'), { force: true });
  fs.rmSync(file(AGENT_STOP_FILE), { force: true });

  // The same preflight opens every enrolment: nothing local is started and no
  // token is sent until the staging answers as the compute gateway.
  const reachable = await preflight(staging);
  if (!reachable.ok) {
    throw Object.assign(new Error(`the staging is not reachable from this device (${reachable.verdict}): ${reachable.fix}`), {
      code: reachable.verdict === 'blocked-by-access' ? 'ACCESS_BLOCKED' : 'STAGING_UNREACHABLE', exitCode: preflightExitCode(reachable), preflight: reachable
    });
  }

  let executorBase = options.executorUrl;
  let installed = null;
  let adapterPort = null;
  let runtimeVersion = null;
  if (!executorBase) {
    // The model must be installed here before anything is advertised.
    const tags = await requestJson(`${options.ollamaUrl}/api/tags`, { timeoutMs: 5_000 }).catch((error) => { throw Object.assign(new Error(`the local Ollama daemon is not reachable (${error.code || error.message})`), { code: 'OLLAMA_UNREACHABLE' }); });
    installed = (tags.body?.models || []).find((item) => item?.name === model || item?.model === model) || null;
    if (!installed?.digest) throw Object.assign(new Error(`model ${model} is not installed in the local Ollama daemon; pull it first`), { code: 'MODEL_NOT_INSTALLED' });
    // The engine version this device enrols with, published beside the digest so a result can be held against both.
    const version = await requestJson(`${options.ollamaUrl}/api/version`, { timeoutMs: 5_000 }).catch(() => null);
    runtimeVersion = version?.status === 200 && version.body?.version ? String(version.body.version) : null;
    if (!runtimeVersion) throw Object.assign(new Error('the local Ollama daemon did not report its version'), { code: 'OLLAMA_VERSION_UNKNOWN' });
    const adapter = start('adapter', path.join(ROOT, 'core/src/compute/ollama-adapter.mjs'), cleanEnv({
      MCCLUSTER_OLLAMA_ADAPTER_PORT: String(options.adapterPort), MCCLUSTER_OLLAMA_URL: options.ollamaUrl,
      MCCLUSTER_OLLAMA_MODEL: model, MCCLUSTER_OLLAMA_IMPLEMENTATIONS: `${implementation}=${model}`,
      MCCLUSTER_OLLAMA_EVIDENCE_TTL_MS: '5000', ...(options.context ? { MCCLUSTER_OLLAMA_CONTEXT: String(options.context) } : {})
    }));
    const ready = await waitForLine(adapter, (record) => record.event === 'ollama_adapter_ready', 'the Ollama adapter start', 20_000);
    adapterPort = ready.port;
    executorBase = `http://127.0.0.1:${adapterPort}`;
  }

  const manifest = buildDeviceManifest({ implementation, model, executorBase, site: options.site, fixture: Boolean(options.executorUrl), modelDigest: installed?.digest || null, runtimeVersion });
  fs.writeFileSync(file('capabilities.json'), JSON.stringify(manifest, null, 2));

  const name = options.name || os.hostname();
  const agent = start('node-agent', path.join(ROOT, 'core/src/compute/node-agent.mjs'), cleanEnv({
    MCCLUSTER_COMPUTE_URL: staging.computeUrl, MCCLUSTER_ORG_ID: staging.org, MCCLUSTER_NODE_NAME: name,
    MCCLUSTER_NODE_ENROLL_TOKEN: staging.token, MCCLUSTER_NODE_STATE_DIR: stateDir, MCCLUSTER_NODE_MANIFEST: file('capabilities.json'), MCCLUSTER_NODE_STOP_FILE: file(AGENT_STOP_FILE),
    MCCLUSTER_NODE_POLL_MS: '1000', MCCLUSTER_NODE_HEARTBEAT_MS: '10000', MCCLUSTER_NODE_ENGINE_PROBE_MS: '5000',
    // The Access service token travels in the agent's environment only: it is
    // in no file, no argument and no log line of this script or of the agent.
    ...(staging.access.configured ? { [ACCESS_ENV.id]: process.env[ACCESS_ENV.id], [ACCESS_ENV.secret]: process.env[ACCESS_ENV.secret] } : {}),
    // A pinned CA is handed to the agent as its extra root; with system trust
    // the agent verifies against the runtime's public roots and, where this
    // Node supports it, the operating system's store. Neither disables verification.
    ...(staging.trust === 'system' ? { NODE_USE_SYSTEM_CA: '1' } : { NODE_EXTRA_CA_CERTS: staging.caPath })
  }));
  const enrolled = await waitForLine(agent, (record) => record.event === 'compute_node_enrolled' || record.event === 'compute_node_existing_identity', 'enrolment', 90_000);

  const device = {
    schema: 'mccluster-device-jobs-device/1',
    enrolled_at: new Date().toISOString(),
    node_id: enrolled.node_id, display_name: name, platform: process.platform, arch: process.arch,
    implementation, model, model_digest: installed?.digest || null, runtime_version: runtimeVersion,
    fixture: Boolean(options.executorUrl),
    advertised_at_enrolment: enrolled.advertised ?? null, hardware_mode_at_enrolment: enrolled.hardware_mode ?? null,
    compute_url: staging.computeUrl, org_id: staging.org, adapter_port: adapterPort,
    // How the staging is reached. Booleans and names only: no credential is written here.
    trust: staging.trust, access_service_token: staging.access.configured,
    pids: { enroll_device: process.pid, node_agent: agent.pid, adapter: children.get('adapter')?.pid ?? null },
    files: { identity: 'identity.json', manifest: 'capabilities.json', agent_log: 'node-agent.log', adapter_log: 'adapter.log', stop: 'stop' },
    stop: 'create a file named "stop" in the state directory, or send SIGINT'
  };
  fs.writeFileSync(file('device.json'), JSON.stringify(device, null, 2));
  say(console.log, { event: 'device_enrolled', ...device });
  stopWatch = setInterval(() => { if (fs.existsSync(file('stop'))) shutdown('stop-file'); }, 1_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (process.platform === 'win32') process.on('SIGBREAK', () => shutdown('SIGBREAK'));
if (options.watchStdin) { process.stdin.on('end', () => shutdown('stdin-closed')); process.stdin.on('error', () => {}); process.stdin.resume(); }

main().catch((error) => fail('enroll_failed', error));
