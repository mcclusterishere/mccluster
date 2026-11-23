#!/usr/bin/env node
// Cloud staging for the device job contract (docs/control-plane/DEVICE-JOBS-CONTRACT.md).
//
// Composes the REAL Core compute gateway (core/src/compute/gateway.mjs) and the
// REAL node agent (core/src/compute/node-agent.mjs) around a disposable PGlite
// database that runs the repository's own compute SQL, with a loopback
// PostgREST shim in place of Supabase and a fixture executor in place of a
// device's Ollama adapter. TLS ingress is a self-signed loopback proxy, because
// a node agent only ever talks https. Nothing here reaches the canonical
// Supabase project, the OVH Core or any real device; every identity, token and
// result is synthetic and dies with the run. The output directory receives a
// proof (proof.json, PROOF.md) that lists exactly what passed.
//
//   PGLITE_MODULE_PATH=<dir>/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/staging/device-jobs/run.mjs --out /tmp/device-jobs-proof [--full]
//
// --full adds the slow hard-disconnect case (lease expiry after SIGKILL, about
// two and a half minutes). The default run finishes in about a minute.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadComputeSchema, openPglite, startPostgrestShim } from './pglite-postgrest.mjs';
import { generateNodeIdentity, signRequest } from '../../../core/src/compute/signature.mjs';
import { generateReceiptKey, hashJson, verifyAttestation, verifyReceipt } from '../../../core/src/compute/jobs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = new Map(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(String(args.get('out') || path.join(os.tmpdir(), `device-jobs-staging-${Date.now()}`)));
const FULL = args.get('full') === true;
fs.mkdirSync(OUT, { recursive: true });

const ORG = '00000000-0000-4000-8000-00000000c0de';
const OTHER_ORG = '00000000-0000-4000-8000-00000000beef';
const secrets = {
  apiKey: crypto.randomBytes(24).toString('hex'),
  enroll: crypto.randomBytes(24).toString('hex'),
  admin: crypto.randomBytes(24).toString('hex')
};
const receiptKey = generateReceiptKey();
const ports = { shim: 0, gateway: 47880 + Math.floor(Math.random() * 100), tls: 47990 + Math.floor(Math.random() * 100), executor: 47700 + Math.floor(Math.random() * 100) };
const children = new Map();
const steps = [];
const startedAt = new Date().toISOString();
let shim;
let db;
let tls;

function log(record) { console.log(JSON.stringify({ at: new Date().toISOString(), ...record })); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(label, fn, { timeoutMs = 30_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${last.message}` : ''}`);
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, duration_ms: Date.now() - started, detail: detail ?? null });
    log({ step: name, ok: true });
  } catch (error) {
    steps.push({ name, ok: false, duration_ms: Date.now() - started, error: error.message, code: error.code || null });
    log({ step: name, ok: false, error: error.message });
  }
}

function assert(condition, message) { if (!condition) throw new Error(message); }

function spawnChild(name, script, env, { cwd = ROOT } = {}) {
  const out = fs.createWriteStream(path.join(OUT, `${name}.log`), { flags: 'a' });
  const child = spawn(process.execPath, [script], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(out); child.stderr.pipe(out);
  child.on('exit', (code, signal) => log({ child: name, exited: true, code, signal }));
  children.set(name, child);
  return child;
}

async function stopChild(name, signal = 'SIGTERM') {
  const child = children.get(name);
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => { child.once('exit', resolve); child.kill(signal); setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 8_000).unref(); });
}

function tail(name, lines = 40) {
  try { return fs.readFileSync(path.join(OUT, `${name}.log`), 'utf8').trim().split('\n').slice(-lines); } catch { return []; }
}

const gatewayUrl = () => `http://127.0.0.1:${ports.gateway}`;

async function call(url, { method = 'GET', headers = {}, body, raw } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const res = await fetch(url, { method, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: payload });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json, headers: res.headers };
}

const admin = (pathname, init = {}) => call(`${gatewayUrl()}${pathname}`, { ...init, headers: { authorization: `Bearer ${secrets.admin}`, ...(init.headers || {}) } });

function signed(identity, pathname, body) {
  const bodyBytes = Buffer.from(JSON.stringify(body));
  const headers = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path: pathname, nodeId: identity.nodeId, bodyBytes });
  return { headers, bodyBytes, send: () => call(`${gatewayUrl()}${pathname}`, { method: 'POST', headers, raw: bodyBytes }) };
}

async function pollJob(jobId, want, { timeoutMs = 45_000 } = {}) {
  return waitFor(`job ${jobId} to be ${want}`, async () => {
    const { status, body } = await admin(`/v1/compute/jobs/${jobId}`);
    assert(status === 200, `status read failed: HTTP ${status} ${JSON.stringify(body)}`);
    return (Array.isArray(want) ? want : [want]).includes(body.status) ? body : null;
  }, { timeoutMs, intervalMs: 750 });
}

function writeControl(mode) { fs.writeFileSync(path.join(OUT, 'fixture-control.json'), JSON.stringify(mode)); }

function makeCert() {
  const key = path.join(OUT, 'tls-key.pem');
  const cert = path.join(OUT, 'tls-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  return { key, cert };
}

function startTlsIngress({ key, cert }) {
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const upstream = http.request({ host: '127.0.0.1', port: ports.gateway, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${ports.gateway}` } }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(ports.tls, '127.0.0.1', () => resolve(server)));
}

// The proof names no machine: the container hostname and the run directory
// are replaced before anything is written.
function redact(value) {
  const host = os.hostname();
  return JSON.parse(JSON.stringify(value).split(OUT).join('[out]').split(host).join('[host]'));
}

async function main() {
  log({ event: 'staging_start', out: OUT, full: FULL, node: process.version });
  db = await openPglite();
  const loaded = await loadComputeSchema(db, ROOT);
  await db.query('insert into public.orgs(id, slug, enabled) values ($1, $2, true), ($3, $4, true)', [ORG, 'mccluster', OTHER_ORG, 'other']);
  shim = await startPostgrestShim({ db, apiKey: secrets.apiKey, log });
  const tlsFiles = makeCert();
  tls = await startTlsIngress(tlsFiles);

  spawnChild('gateway', path.join(ROOT, 'core/src/compute/gateway.mjs'), {
    SUPABASE_URL: shim.url, SUPABASE_SERVICE_ROLE_KEY: secrets.apiKey, MCCLUSTER_ORG_ID: ORG, MCCLUSTER_CORE_ID: 'staging-gateway',
    CORE_COMPUTE_HOST: '127.0.0.1', CORE_COMPUTE_PORT: String(ports.gateway), CORE_COMPUTE_ENROLL_TOKEN: secrets.enroll, CORE_COMPUTE_ADMIN_TOKEN: secrets.admin,
    CORE_COMPUTE_LEASE_SECONDS: '30', CORE_RECEIPT_SIGNING_KEY: receiptKey.privateKeyPem
  });
  await waitFor('gateway health', async () => (await call(`${gatewayUrl()}/health`)).status === 200);

  writeControl({ mode: 'ok' });
  spawnChild('executor', path.join(ROOT, 'scripts/staging/device-jobs/fixture-executor.mjs'), { FIXTURE_EXECUTOR_PORT: String(ports.executor), FIXTURE_CONTROL_FILE: path.join(OUT, 'fixture-control.json') });
  await waitFor('executor ready', async () => (await call(`http://127.0.0.1:${ports.executor}/ready`)).status === 200);

  const manifest = {
    max_leases: 1,
    labels: { site: 'cloud-staging', trust: 'owned', role: 'staging-fixture' },
    capabilities: [{
      capability: 'ai.chat', implementation: 'fixture.echo.local', backend: 'fixture', model: 'fixture-echo', version: '1',
      features: { chat: true, self_hosted: true, fixture: true },
      input_schema: { type: 'object', properties: { prompt: { type: 'string' }, messages: { type: 'array' } } },
      output_schema: { type: 'object', properties: { model: { type: 'string' }, content: { type: 'string' } } },
      max_concurrency: 1, min_vram_bytes: 0,
      executor: { type: 'http', url: `http://127.0.0.1:${ports.executor}/execute`, health_url: `http://127.0.0.1:${ports.executor}/ready?implementation=fixture.echo.local`, health_method: 'GET', health_timeout_ms: 2000, timeout_ms: 120000 }
    }]
  };
  fs.mkdirSync(path.join(OUT, 'node'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'node', 'capabilities.json'), JSON.stringify(manifest, null, 2));
  const agentEnv = {
    MCCLUSTER_COMPUTE_URL: `https://127.0.0.1:${ports.tls}`, MCCLUSTER_ORG_ID: ORG, MCCLUSTER_NODE_NAME: 'staging-fixture-node',
    MCCLUSTER_NODE_ENROLL_TOKEN: secrets.enroll, MCCLUSTER_NODE_STATE_DIR: path.join(OUT, 'node', 'state'), MCCLUSTER_NODE_MANIFEST: path.join(OUT, 'node', 'capabilities.json'),
    MCCLUSTER_NODE_POLL_MS: '1000', MCCLUSTER_NODE_HEARTBEAT_MS: '10000', MCCLUSTER_NODE_ENGINE_PROBE_MS: '5000', NODE_EXTRA_CA_CERTS: tlsFiles.cert
  };
  const startAgent = () => spawnChild('node-agent', path.join(ROOT, 'core/src/compute/node-agent.mjs'), agentEnv);
  startAgent();

  let fixtureNode = null;
  let job1 = null;
  let receipt1 = null;

  await step('preflight: gateway health and receipt key', async () => {
    const health = await call(`${gatewayUrl()}/health`);
    const key = await admin('/v1/compute/receipt-key');
    assert(health.body?.ok === true, 'gateway health');
    assert(key.status === 200 && key.body.configured === true && key.body.key_id === receiptKey.keyId, 'receipt key published');
    assert(!JSON.stringify(key.body).includes('PRIVATE'), 'receipt key endpoint leaks no private material');
    return { protocol: health.body.protocol, receipt_key_id: key.body.key_id, schema_files: loaded };
  });

  await step('authorization: admin routes refuse a missing or wrong token; enrolment refuses a wrong token; an unknown key is refused', async () => {
    const none = await call(`${gatewayUrl()}/v1/compute/jobs`, { method: 'POST', body: { capability: 'ai.chat' } });
    const wrong = await call(`${gatewayUrl()}/v1/compute/jobs`, { method: 'POST', body: { capability: 'ai.chat' }, headers: { authorization: 'Bearer nope' } });
    const list = await call(`${gatewayUrl()}/v1/compute/jobs?org_id=${ORG}`);
    const badEnroll = await call(`${gatewayUrl()}/v1/compute/enroll`, { method: 'POST', headers: { authorization: 'Bearer nope' }, body: { protocol: 'mccluster-compute/1', org_id: ORG, public_key: generateNodeIdentity().publicKeyPem } });
    const stranger = generateNodeIdentity();
    const unknown = await signed(stranger, '/v1/compute/lease', {}).send();
    assert(none.status === 401 && wrong.status === 401 && list.status === 401, `admin gate: ${none.status}/${wrong.status}/${list.status}`);
    assert(badEnroll.status === 401, `enrol gate: ${badEnroll.status}`);
    assert(unknown.status === 401 && unknown.body.code === 'UNKNOWN_NODE', `unknown node: ${unknown.status} ${unknown.body?.code}`);
    return { admin_without_token: none.status, admin_wrong_token: wrong.status, enroll_wrong_token: badEnroll.status, unknown_node: unknown.body.code };
  });

  await step('enrolment and capability reporting: the real node agent enrols over TLS and advertises ai.chat/fixture.echo.local', async () => {
    fixtureNode = await waitFor('fixture node online', async () => {
      const { status, body } = await admin(`/v1/compute/nodes?org_id=${ORG}`);
      assert(status === 200, `nodes read ${status}`);
      return body.nodes.find((n) => n.display_name === 'staging-fixture-node' && n.state === 'online' && (n.capabilities || []).some((c) => c.implementation === 'fixture.echo.local')) || null;
    }, { timeoutMs: 45_000 });
    const caps = await admin(`/v1/compute/capabilities?org_id=${ORG}`);
    const live = caps.body.implementations.filter((i) => i.node_id === fixtureNode.id);
    assert(live.length === 1 && live[0].hosting === 'self-hosted' && live[0].billing === 'compute', 'live capability normalized');
    assert(fixtureNode.labels.enrolled_trust === 'owned', 'enrolment recorded trust');
    assert(['cpu-only', 'gpu-present-unverified', 'unknown'].includes(fixtureNode.inventory?.runtime?.hardware_mode), 'hardware_mode derived by code');
    assert(!JSON.stringify(fixtureNode).includes(secrets.enroll), 'enrol token never stored');
    return redact({ node_id: fixtureNode.id, hardware_mode: fixtureNode.inventory.runtime.hardware_mode, platform: fixtureNode.inventory.platform, agent_version: fixtureNode.agent_version, capabilities: fixtureNode.capabilities.map((c) => `${c.capability}/${c.implementation}`) });
  });

  await step('cross-organization submission is refused', async () => {
    const { status, body } = await admin('/v1/compute/jobs', { method: 'POST', body: { org_id: OTHER_ORG, capability: 'ai.chat', input: { prompt: 'x' } } });
    assert(status === 403 && body.code === 'CROSS_ORG_DENIED', `${status} ${body?.code}`);
    return { status, code: body.code };
  });

  await step('submit: idempotent per key, conflict on a different body under the same key, refusal when no live node serves the capability', async () => {
    const body = { capability: 'ai.chat', implementation: 'fixture.echo.local', input: { prompt: 'say hello to the staging fabric', num_predict: 32 }, client: { name: 'device-jobs-staging', version: '1' } };
    const first = await admin('/v1/compute/jobs', { method: 'POST', headers: { 'idempotency-key': 'staging-job-1' }, body });
    const replay = await admin('/v1/compute/jobs', { method: 'POST', headers: { 'idempotency-key': 'staging-job-1' }, body });
    const conflict = await admin('/v1/compute/jobs', { method: 'POST', headers: { 'idempotency-key': 'staging-job-1' }, body: { ...body, input: { prompt: 'different' } } });
    const offline = await admin('/v1/compute/jobs', { method: 'POST', body: { capability: 'video.generate', input: {} } });
    assert(first.status === 202 && first.body.job.schema === 'mccluster-job/1' && first.body.replayed === false, `first ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`);
    assert(replay.status === 200 && replay.body.replayed === true && replay.body.job.job_id === first.body.job.job_id && replay.headers.get('idempotency-replayed') === 'true', 'replay');
    assert(conflict.status === 409 && conflict.body.code === 'IDEMPOTENCY_CONFLICT', `conflict ${conflict.status} ${conflict.body?.code}`);
    assert(offline.status === 503 && offline.body.code === 'COMPUTE_NO_LIVE_NODE', `offline ${offline.status} ${offline.body?.code}`);
    job1 = first.body.job;
    return { job_id: job1.job_id, live_nodes: first.body.live_nodes, replayed_status: replay.status, conflict_code: conflict.body.code, offline_code: offline.body.code };
  });

  await step('status, result and signed receipt: the fixture node leases, runs and completes the job; the receipt verifies offline', async () => {
    const done = await pollJob(job1.job_id, 'done');
    assert(done.execution?.node_id === fixtureNode.id && done.execution.status === 'done', 'completing lease belongs to the fixture node');
    const result = await admin(`/v1/compute/jobs/${job1.job_id}/result?org_id=${ORG}`);
    assert(result.status === 200 && result.body.output.content === 'ECHO: say hello to the staging fabric', `result ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
    assert(result.body.output_sha256 === hashJson(result.body.output), 'result hash');
    const receipt = (await admin(`/v1/compute/jobs/${job1.job_id}/receipt?org_id=${ORG}`)).body;
    receipt1 = receipt;
    assert(receipt.schema === 'mccluster-job-receipt/1' && receipt.signed === true, 'receipt is versioned and signed');
    const verified = verifyReceipt(receipt, receiptKey.publicKeyPem);
    assert(verified.ok, `receipt verification: ${verified.reason}`);
    assert(receipt.output_sha256 === result.body.output_sha256 && receipt.input_sha256 === hashJson(job1.metadata ? { prompt: 'say hello to the staging fabric', num_predict: 32 } : {}), 'receipt hashes match the result and the submitted input');
    assert(receipt.execution.node_id === fixtureNode.id && receipt.execution.result_consistent === true, 'execution evidence');
    assert(receipt.inference.mode === 'single-device' && receipt.inference.devices.length === 1, 'inference mode reported as single-device');
    assert(receipt.node_attestation && receipt.node_attestation.verified === true && receipt.node_attestation.matches_output === true, `node attestation: ${JSON.stringify(receipt.node_attestation)}`);
    const independent = verifyAttestation(receipt.node_attestation, receipt.node_public_key_pem);
    assert(independent.ok, `independent attestation check: ${independent.reason}`);
    const tampered = { ...receipt, output_sha256: hashJson({ forged: true }) };
    assert(verifyReceipt(tampered, receiptKey.publicKeyPem).ok === false, 'a tampered receipt fails verification');
    return redact({ attempts: done.attempts, duration_ms: receipt.execution.duration_ms, output_sha256: receipt.output_sha256, receipt_key_id: receipt.signature.key_id, attestation_verified: receipt.node_attestation.verified });
  });

  await step('duplicate results are rejected: same payload replays idempotently, a different payload is refused, a replayed nonce is refused, a late failure cannot undo a commit', async () => {
    const harness = generateNodeIdentity();
    const enrol = await call(`${gatewayUrl()}/v1/compute/enroll`, { method: 'POST', headers: { authorization: `Bearer ${secrets.enroll}` }, body: {
      protocol: 'mccluster-compute/1', org_id: ORG, display_name: 'staging-harness-node', public_key: harness.publicKeyPem, agent_version: 'harness',
      inventory: { platform: 'linux', arch: 'x64', cpu_count: 1, memory_bytes: 1, disk_free_bytes: 1, gpus: [], runtime: { hardware_mode: 'cpu-only' } },
      capabilities: [{ capability: 'ai.chat', implementation: 'harness.manual.local', backend: 'fixture', model: 'manual', version: '1', features: { chat: true }, max_concurrency: 1 }],
      labels: { trust: 'owned', site: 'cloud-staging' }, max_leases: 1 } });
    assert(enrol.status === 201 && enrol.body.node_id === harness.nodeId, `harness enrol ${enrol.status}`);
    const submitted = await admin('/v1/compute/jobs', { method: 'POST', body: { capability: 'ai.chat', implementation: 'harness.manual.local', input: { prompt: 'manual' } } });
    assert(submitted.status === 202, `submit ${submitted.status}`);
    const jobId = submitted.body.job.job_id;
    await signed(harness, '/v1/compute/heartbeat', { load: { running_leases: 0 } }).send();
    const claim = await signed(harness, '/v1/compute/lease', {}).send();
    assert(claim.status === 200 && claim.body.lease?.task?.id === jobId, `claim ${claim.status} ${JSON.stringify(claim.body).slice(0, 200)}`);
    const { lease_id: leaseId, lease_token: token } = claim.body.lease;
    const started = await signed(harness, `/v1/compute/leases/${leaseId}/start`, { lease_token: token, extend_seconds: 60 }).send();
    assert(started.status === 200 && started.body.result?.status === 'running', 'start');
    const payloadA = { model: 'manual', content: 'A', fixture: true };
    const complete = signed(harness, `/v1/compute/leases/${leaseId}/complete`, { lease_token: token, result: payloadA });
    const firstNonce = complete.headers['x-mccluster-nonce'];
    const first = await complete.send();
    assert(first.status === 200 && first.body.ok === true, `first complete ${first.status}`);
    const replayedNonce = await complete.send();
    assert(replayedNonce.status === 409 && replayedNonce.body.code === 'REPLAY_DETECTED', `nonce replay ${replayedNonce.status} ${replayedNonce.body?.code}`);
    const samePayload = await signed(harness, `/v1/compute/leases/${leaseId}/complete`, { lease_token: token, result: payloadA }).send();
    assert(samePayload.status === 200 && samePayload.body.ok === true, `same payload re-complete ${samePayload.status}`);
    const differentPayload = await signed(harness, `/v1/compute/leases/${leaseId}/complete`, { lease_token: token, result: { ...payloadA, content: 'B' } }).send();
    assert(differentPayload.status === 409 && differentPayload.body.code === 'LEASE_REJECTED', `different payload ${differentPayload.status} ${differentPayload.body?.code}`);
    const lateFail = await signed(harness, `/v1/compute/leases/${leaseId}/fail`, { lease_token: token, error: 'late' }).send();
    assert(lateFail.status === 409, `late fail ${lateFail.status}`);
    const wrongToken = await signed(harness, `/v1/compute/leases/${leaseId}/complete`, { lease_token: 'forged', result: payloadA }).send();
    assert(wrongToken.status === 409, `wrong token ${wrongToken.status}`);
    const result = await admin(`/v1/compute/jobs/${jobId}/result?org_id=${ORG}`);
    assert(result.body.output.content === 'A', 'committed result is the first payload');
    const receipt = (await admin(`/v1/compute/jobs/${jobId}/receipt?org_id=${ORG}`)).body;
    assert(receipt.node_attestation?.verified === true && receipt.node_attestation.result_sha256 === hashJson(payloadA), 'attestation verifies and names the committed result');
    assert(receipt.node_attestation.nonce === firstNonce, `attestation is the FIRST accepted completion (nonce ${receipt.node_attestation.nonce} vs ${firstNonce})`);
    assert(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(receipt.node_attestation.signed_at), `signed_at survives the round trip verbatim: ${receipt.node_attestation.signed_at}`);
    return { job_id: jobId, nonce_replay: replayedNonce.body.code, same_payload: samePayload.status, different_payload: differentPayload.body.code, late_fail: lateFail.status, wrong_token: wrongToken.status, first_nonce_kept: true };
  });

  await step('disconnect and retry: an injected executor failure fails the lease, the task requeues with backoff and the second attempt completes', async () => {
    writeControl({ mode: 'fail-once', match: 'retry me' });
    const submitted = await admin('/v1/compute/jobs', { method: 'POST', body: { capability: 'ai.chat', implementation: 'fixture.echo.local', input: { prompt: 'retry me' }, max_attempts: 3 } });
    assert(submitted.status === 202, `submit ${submitted.status}`);
    const jobId = submitted.body.job.job_id;
    const failedOnce = await waitFor('first attempt to fail', async () => {
      const { body } = await admin(`/v1/compute/jobs/${jobId}`);
      return body.attempts >= 1 && body.status === 'queued' && /injected/.test(body.last_error || '') ? body : null;
    }, { timeoutMs: 30_000 });
    const done = await pollJob(jobId, 'done', { timeoutMs: 90_000 });
    writeControl({ mode: 'ok' });
    const receipt = (await admin(`/v1/compute/jobs/${jobId}/receipt?org_id=${ORG}`)).body;
    assert(done.attempts === 2 && receipt.execution.attempt === 2 && receipt.job.attempts === 2, `attempts ${done.attempts}/${receipt.execution.attempt}`);
    assert(receipt.node_attestation?.verified === true && receipt.node_attestation.attempt === 2, 'attestation belongs to the second attempt');
    return { job_id: jobId, requeued_after_first_failure: failedOnce.status, first_error: failedOnce.last_error, backoff_run_after: failedOnce.run_after, final_attempts: done.attempts };
  });

  if (FULL) {
    await step('hard disconnect (--full): the agent is killed mid-task, the lease expires server-side, a restarted agent reclaims and completes', async () => {
      writeControl({ mode: 'hang', hang_ms: 600_000, match: 'survive a crash' });
      const submitted = await admin('/v1/compute/jobs', { method: 'POST', body: { capability: 'ai.chat', implementation: 'fixture.echo.local', input: { prompt: 'survive a crash' }, max_attempts: 3 } });
      const jobId = submitted.body.job.job_id;
      const running = await pollJob(jobId, 'running', { timeoutMs: 30_000 });
      await stopChild('node-agent', 'SIGKILL');
      writeControl({ mode: 'ok' });
      await stopChild('executor', 'SIGTERM');
      spawnChild('executor', path.join(ROOT, 'scripts/staging/device-jobs/fixture-executor.mjs'), { FIXTURE_EXECUTOR_PORT: String(ports.executor), FIXTURE_CONTROL_FILE: path.join(OUT, 'fixture-control.json') });
      await waitFor('executor ready', async () => (await call(`http://127.0.0.1:${ports.executor}/ready`)).status === 200);
      startAgent();
      const done = await pollJob(jobId, 'done', { timeoutMs: 200_000 });
      const receipt = (await admin(`/v1/compute/jobs/${jobId}/receipt?org_id=${ORG}`)).body;
      assert(done.attempts === 2 && receipt.execution.attempt === 2, `attempts ${done.attempts}`);
      return { job_id: jobId, killed_while: running.status, lease_expired_at: running.execution.expires_at, final_attempts: done.attempts, duration_ms: receipt.execution.duration_ms };
    });
  }

  await step('revocation: a revoked node is refused on its next signed request and the fabric no longer offers its capability', async () => {
    const revoked = await fetch(`${shim.url}/rest/v1/ops_compute_nodes?id=eq.${fixtureNode.id}`, { method: 'PATCH', headers: { apikey: secrets.apiKey, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ state: 'revoked', revoked_at: new Date().toISOString() }) });
    assert(revoked.status === 200, `revoke ${revoked.status}`);
    const exited = await waitFor('agent exit after revocation', async () => children.get('node-agent')?.exitCode !== null, { timeoutMs: 30_000 });
    const refused = await admin('/v1/compute/jobs', { method: 'POST', body: { capability: 'ai.chat', implementation: 'fixture.echo.local', input: { prompt: 'x' } } });
    assert(refused.status === 503 && refused.body.code === 'COMPUTE_NO_LIVE_NODE', `after revoke ${refused.status} ${refused.body?.code}`);
    const logLine = tail('node-agent', 200).find((line) => /NODE_REVOKED/.test(line)) || null;
    assert(logLine, 'the agent must have been refused with NODE_REVOKED by the gateway');
    const revokedClaim = await signed(generateNodeIdentity(), '/v1/compute/lease', {}).send();
    assert(revokedClaim.status === 401, 'an unknown key is still refused');
    return { agent_exited: Boolean(exited), refusal_seen_by_agent: true, submit_after_revoke: refused.body.code };
  });

  await step('pending SQL hygiene: the attestation rollback drops exactly its table and the file re-applies cleanly', async () => {
    await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/pending/compute_job_attestations_v1.rollback.sql'), 'utf8'));
    const gone = (await db.query("select to_regclass('public.ops_compute_attestations') as t")).rows[0].t;
    assert(gone === null, 'rollback left the table behind');
    const leases = (await db.query('select count(*)::int as n from public.ops_compute_leases')).rows[0].n;
    assert(leases > 0, 'rollback must not touch the lease rows');
    await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/pending/compute_job_attestations_v1.sql'), 'utf8'));
    const back = (await db.query("select to_regclass('public.ops_compute_attestations') as t")).rows[0].t;
    assert(back !== null, 're-apply failed');
    return { rollback_reapplied: true, lease_rows_untouched: leases };
  });

  const ok = steps.every((s) => s.ok);
  const proof = {
    schema: 'mccluster-device-jobs-staging-proof/1',
    started_at: startedAt, finished_at: new Date().toISOString(), ok, full: FULL,
    environment: { node: process.version, platform: process.platform, pglite: 'PostgreSQL via PGlite (PGLITE_MODULE_PATH)', commit: gitSha() },
    schema_files: loaded,
    processes: ['core/src/compute/gateway.mjs', 'core/src/compute/node-agent.mjs', 'scripts/staging/device-jobs/fixture-executor.mjs', 'scripts/staging/device-jobs/pglite-postgrest.mjs', 'TLS loopback ingress'],
    synthetic: 'All identities, tokens, keys and model output are synthetic fixtures. No real device, no canonical Supabase, no OVH Core, no model inference.',
    steps,
    sample_receipt: receipt1 ? redact(receipt1) : null,
    shim_requests: shim.requests.length,
    gateway_log_tail: redact(tail('gateway', 25)),
    node_agent_log_tail: redact(tail('node-agent', 25))
  };
  fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2));
  fs.writeFileSync(path.join(OUT, 'PROOF.md'), renderProof(proof));
  log({ event: 'staging_finished', ok, steps: steps.length, passed: steps.filter((s) => s.ok).length, out: OUT });
  return ok;
}

function gitSha() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '';
    return dirty ? `${sha}-dirty` : sha;
  } catch { return null; }
}

function renderProof(proof) {
  const lines = [
    '# Device jobs: cloud staging proof', '',
    `Run: ${proof.started_at} to ${proof.finished_at}. Result: **${proof.ok ? 'PASS' : 'FAIL'}** (${proof.steps.filter((s) => s.ok).length}/${proof.steps.length} steps). Commit ${proof.environment.commit || 'unknown'}, Node ${proof.environment.node}.`, '',
    proof.synthetic, '',
    '## Processes', '', ...proof.processes.map((p) => `- ${p}`), '',
    '## Schema loaded from the repository', '', ...proof.schema_files.map((f) => `- ${f}`), '',
    '## Steps', '', '| Step | Result | ms | Detail |', '| --- | --- | --- | --- |',
    ...proof.steps.map((s) => `| ${s.name} | ${s.ok ? 'pass' : `FAIL: ${s.error}`} | ${s.duration_ms} | ${s.detail ? '`' + JSON.stringify(s.detail).replace(/\|/g, '\\|').slice(0, 400) + '`' : ''} |`), '',
    '## Sample receipt (job 1)', '', '```json', JSON.stringify(proof.sample_receipt, null, 2), '```', ''
  ];
  return lines.join('\n');
}

let exitCode = 1;
try {
  exitCode = (await main()) ? 0 : 1;
} catch (error) {
  log({ event: 'staging_fatal', error: error.message, stack: String(error.stack).split('\n').slice(0, 5) });
  steps.push({ name: 'harness', ok: false, error: error.message });
  try { fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify({ schema: 'mccluster-device-jobs-staging-proof/1', ok: false, fatal: error.message, steps }, null, 2)); } catch {}
} finally {
  for (const name of [...children.keys()]) await stopChild(name);
  try { tls?.close(); } catch {}
  try { await shim?.close(); } catch {}
  try { await db?.close(); } catch {}
  process.exit(exitCode);
}
