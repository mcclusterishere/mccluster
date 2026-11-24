// Exercise the actual worker process over signed HTTPS, with only its
// coordinator responses and local streaming executor replaced by fixtures.
import './helpers/loopback-only.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateNodeIdentity, verifySignedRequest } from '../src/compute/signature.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORG = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const LEASE = '33333333-3333-4333-8333-333333333333';

async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function eventually(read, diagnostic) {
  const until = Date.now() + 5000;
  while (Date.now() < until) { if (await read()) return; await delay(20); }
  assert.fail(`Worker streaming condition timed out: ${diagnostic()}`);
}

async function workerStreamFixture(t, mode, { source, capability = 'ai.chat' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mccluster-stream-')); fs.chmodSync(directory, 0o700);
  const identity = generateNodeIdentity(), requests = [];
  fs.writeFileSync(path.join(directory, 'identity.json'), JSON.stringify(identity), { mode: 0o600 });
  const implementation = capability === 'ai.chat' ? 'qwen3.8b.local' : 'exo.mlx.local';
  const noProgress = mode.startsWith('prefill');
  let child, diagnostics = '', executionStarted = false, executionClosed = false, claimed = false, signatureError, startedAt, closedAt;
  const executor = http.createServer(async (req, res) => {
    if (req.url === '/health') { res.end('{"ok":true}'); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    assert.equal(JSON.parse(raw).capability, capability);
    assert.equal(req.headers.accept, capability === 'ai.chat' ? 'application/x-ndjson' : '*/*');
    executionStarted = true;
    startedAt = performance.now();
    res.setHeader('content-type', capability === 'ai.chat' ? 'application/x-ndjson' : 'application/json');
    res.once('close', () => { executionClosed = true; closedAt = performance.now(); });
    if (noProgress) res.flushHeaders();
    else res.write('{"type":"progress","progress":{"delta":"Synthetic first token","sequence":1}}\n');
    // Leave the body open. A worker-side deadline or lost lease must close it.
  });
  const key = path.join(directory, 'tls.key'), cert = path.join(directory, 'tls.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  fs.chmodSync(key, 0o600);
  const receipt = status => ({
    lease_id: LEASE, task_id: TASK, org_id: ORG, node_id: identity.nodeId, attempt: 1, status,
    server_time: new Date().toISOString(), expires_at: new Date(Date.now() + 120_000).toISOString(),
  });
  const coordinator = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bodyBytes = Buffer.concat(chunks), body = JSON.parse(bodyBytes);
    try { verifySignedRequest({ publicKeyPem: identity.publicKeyPem, method: req.method, path: req.url, headers: req.headers, bodyBytes }); }
    catch (error) { signatureError = error; res.writeHead(401); res.end('{"error":"Fixture signature rejected"}'); return; }
    requests.push({ path: req.url, body, at: performance.now() });
    const reply = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/v1/compute/heartbeat') return reply({ ok: true });
    if (req.url === '/v1/compute/lease') {
      if (claimed) return reply({ lease: null });
      claimed = true;
      return reply({ lease: { ...receipt('leased'), lease_token: 'synthetic-lease-token', task: {
        id: TASK, org_id: ORG, capability, implementation, input: { prompt: 'Synthetic test' }, metadata: source ? { source } : {},
      } } });
    }
    if (req.url === `/v1/compute/leases/${LEASE}/start`) return reply({ ok: true, result: receipt('running') });
    if (req.url === `/v1/compute/leases/${LEASE}/heartbeat`) {
      if (mode === 'cancel' || mode === 'prefill-stop') return reply({ error: 'Lease was cancelled by the owner', code: 'LEASE_NOT_ACTIVE' }, 409);
      if (mode === 'prefill-revoke') return reply({ error: 'Device revoked by the owner', code: 'NODE_REVOKED' }, 403);
      return reply({ ok: true, result: receipt('running') });
    }
    if (req.url.endsWith('/fail') || req.url.endsWith('/complete')) return reply({ ok: true, result: true });
    return reply({ error: 'Unknown fixture route' }, 404);
  });
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
      await exited; clearTimeout(timer);
    }
    await Promise.all([coordinator, executor].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const executorPort = await listen(executor), coordinatorPort = await listen(coordinator);
  const manifest = path.join(directory, 'capabilities.json');
  fs.writeFileSync(manifest, JSON.stringify({ max_leases: 1, capabilities: [{
    capability, implementation, ...(capability === 'ai.chat' ? { model: 'qwen3:8b' } : {}), max_concurrency: 1,
    executor: { type: 'http', url: `http://127.0.0.1:${executorPort}/execute`, health_url: `http://127.0.0.1:${executorPort}/health`, timeout_ms: mode === 'deadline' ? 1000 : 10_000 },
  }] }), { mode: 0o600 });
  const env = { ...process.env, MCCLUSTER_COMPUTE_URL: `https://127.0.0.1:${coordinatorPort}`, MCCLUSTER_ORG_ID: ORG,
    MCCLUSTER_NODE_STATE_DIR: directory, MCCLUSTER_NODE_MANIFEST: manifest, MCCLUSTER_NODE_POLL_MS: '1000',
    MCCLUSTER_NODE_HEARTBEAT_MS: '10000', NODE_EXTRA_CA_CERTS: cert };
  for (const name of ['MCCLUSTER_NODE_ENROLL_TOKEN', 'MCCLUSTER_NODE_ENROLL_TOKEN_STDIN', 'MCCLUSTER_NODE_ENROLL_ONLY']) delete env[name];
  child = spawn(process.execPath, ['--import', path.join(ROOT, 'core/test/helpers/loopback-only.mjs'), path.join(ROOT, 'core/src/compute/node-agent.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = chunk => { diagnostics = (diagnostics + chunk).slice(-8000); };
  child.stdout.on('data', record); child.stderr.on('data', record);
  await eventually(() => executionStarted, () => diagnostics);
  return { requests, closed: () => executionClosed, elapsed: () => (closedAt || performance.now()) - startedAt, diagnostic: () => diagnostics, signatureError: () => signatureError };
}

test('worker retains its executor body deadline after streaming headers', { timeout: 12000 }, async t => {
  const fixture = await workerStreamFixture(t, 'deadline');
  await eventually(() => fixture.closed() && fixture.requests.some(r => r.path.endsWith('/fail')), fixture.diagnostic);
  assert.equal(fixture.signatureError(), undefined);
  assert.equal(fixture.requests.filter(r => r.path.endsWith('/fail')).length, 1);
  assert.match(fixture.requests.find(r => r.path.endsWith('/fail')).body.error, /deadline|abort/i);
  assert.equal(fixture.requests.some(r => r.path.endsWith('/complete')), false);
});

test('lost signed lease authority cancels a worker response body already streaming', { timeout: 12000 }, async t => {
  const fixture = await workerStreamFixture(t, 'cancel');
  await eventually(fixture.closed, fixture.diagnostic);
  assert.equal(fixture.signatureError(), undefined);
  const progress = fixture.requests.find(r => r.path.endsWith('/heartbeat') && r.body.progress);
  assert.equal(progress.body.progress.content, 'Synthetic first token');
  assert.equal(fixture.requests.some(r => r.path.endsWith('/complete') || r.path.endsWith('/fail')), false,
    'a worker that lost lease authority cannot publish a result or fail a newer attempt');
});

for (const { source, capability, mode } of [
  { source: 'owner-ai-workspace', capability: 'ai.chat', mode: 'prefill-stop' },
  { source: 'owner-pair', capability: 'compute.pair.control', mode: 'prefill-revoke' },
]) {
  test(`${source} checks lease authority every two seconds before any progress`, { timeout: 12000 }, async t => {
    const fixture = await workerStreamFixture(t, mode, { source, capability });
    await eventually(fixture.closed, fixture.diagnostic);
    assert.equal(fixture.signatureError(), undefined);
    const renewal = fixture.requests.find(r => r.path.endsWith(`/leases/${LEASE}/heartbeat`));
    assert.deepEqual(renewal.body.progress, { state: 'running' }, 'no visible token triggered this renewal');
    assert.ok(fixture.elapsed() >= 1700 && fixture.elapsed() < 4500,
      `idle model loading must receive Stop/revoke on the 2s owner renewal; took ${fixture.elapsed()}ms`);
    assert.equal(fixture.requests.some(r => r.path.endsWith('/complete') || r.path.endsWith('/fail')), false);
  });
}

test('ordinary workloads retain the slower renewal cadence before any progress', { timeout: 12000 }, async t => {
  const fixture = await workerStreamFixture(t, 'prefill-ordinary', { source: 'ordinary-queue' });
  await delay(2300);
  assert.equal(fixture.closed(), false);
  assert.equal(fixture.requests.some(r => r.path.endsWith(`/leases/${LEASE}/heartbeat`)), false,
    'the owner-only 2s renewal must not increase traffic for other workloads');
});
