// Disposable staging/runtime fixture. It runs the production broker, gateway,
// node agent, Ollama adapter, signed leases and pending SQL. Only identities
// and Ollama generation are synthetic. Never point this at a hosted database.
import fs from 'node:fs';
import './loopback-only.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createOwnerWorkspaceDatabase, startOwnerWorkspaceRestFixture, WORKSPACE_FIXTURE_ORG as ORG, WORKSPACE_FIXTURE_OWNER as OWNER, WORKSPACE_FIXTURE_MEMBER as MEMBER } from './owner-workspace-db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const fixturePause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function fixtureUntil(predicate, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await predicate(); if (value) return value; await fixturePause(100); }
  throw new Error('Owner workspace fixture condition timed out.');
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function port() { const server = http.createServer(); const value = await listen(server); await new Promise(resolve => server.close(resolve)); return value; }

export async function startOwnerWorkspaceRuntime({ modulePath = process.env.PGLITE_MODULE_PATH, workers = 2, fixtureUsers } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mccluster-owner-fixture-')); fs.chmodSync(temp, 0o700);
  const children = [], servers = [], logs = [], credentials = [], testWorkers = [];
  const db = await createOwnerWorkspaceDatabase({ modulePath });
  const restFixture = await startOwnerWorkspaceRestFixture(db, { serviceKey: randomBytes(32).toString('hex'), ...(fixtureUsers ? { users: fixtureUsers } : {}) });
  const brokerToken = randomBytes(32).toString('hex'), signingKey = randomBytes(32).toString('hex');
  const gatewayPort = await port(), brokerPort = await port();
  const env = { ...process.env, SUPABASE_URL: restFixture.url, SUPABASE_SECRET_KEY: restFixture.serviceKey, SUPABASE_SERVICE_ROLE_KEY: restFixture.serviceKey,
    MCCLUSTER_ORG_ID: ORG, CORE_OWNER_AI_WORKSPACE_ENABLED: '1', CORE_COMPUTE_HOST: '127.0.0.1', CORE_COMPUTE_PORT: String(gatewayPort), CORE_BROKER_HOST: '127.0.0.1', CORE_BROKER_PORT: String(brokerPort),
    CORE_BROKER_TOKEN: brokerToken, CORE_EDGE_SIGNING_KEY: signingKey, MCCLUSTER_POLL_MS: '2000', MCCLUSTER_CONTEXT_TOKEN: '' };
  delete env.CORE_COMPUTE_ENROLL_TOKEN; delete env.CORE_COMPUTE_ALLOW_LEGACY_ENROLL;
  Object.assign(process.env, env);
  const spawnService = (file, extra = {}, input) => {
    const child = spawn(process.execPath, ['--import', path.join(ROOT, 'core/test/helpers/loopback-only.mjs'), path.join(ROOT, file)], { env: { ...env, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
    child.fixtureLog = '';
    const record = chunk => { child.fixtureLog = (child.fixtureLog + String(chunk)).slice(-160_000); logs.push(String(chunk)); };
    child.stdout.on('data', record); child.stderr.on('data', record);
    child.stdin.end(input || ''); children.push(child); return child;
  };
  const ready = async (child, marker) => fixtureUntil(() => {
    if (child.fixtureLog.includes(marker)) return true;
    if (child.exitCode !== null) throw new Error(`Fixture service exited before ${marker}: ${child.fixtureLog.slice(-1200)}`);
    return false;
  });
  async function stopChild(child) {
    if (!child || child.exitCode !== null || child.signalCode) return;
    const ended = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000); await ended; clearTimeout(timer);
  }
  const close = async () => {
    await Promise.allSettled(children.map(stopChild));
    await Promise.allSettled(servers.map(server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }));
    await restFixture.close(); await db.close(); fs.rmSync(temp, { recursive: true, force: true });
  };
  try {
    const gateway = spawnService('core/src/compute/gateway.mjs'); await ready(gateway, 'compute_gateway_ready');
    const keyFile = path.join(temp, 'fixture-tls.key'), certFile = path.join(temp, 'fixture-tls.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    fs.chmodSync(keyFile, 0o600);
    const tls = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
      const forwarded = http.request(`http://127.0.0.1:${gatewayPort}${req.url}`, { method: req.method, headers: req.headers }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
      forwarded.on('error', () => res.destroy()); req.pipe(forwarded);
    });
    servers.push(tls); const tlsPort = await listen(tls); const localComputeUrl = `https://localhost:${tlsPort}`; env.CORE_COMPUTE_PUBLIC_URL = localComputeUrl; process.env.CORE_COMPUTE_PUBLIC_URL = localComputeUrl;
    let broker = spawnService('core/src/tool-broker.mjs'); await ready(broker, 'core_tool_broker_ready');
    const { createDeviceService } = await import('../../src/compute/devices.mjs');
    const { handleCoreMcp } = await import('../../../workers/mccluster-mcp/src/mcp.js');
    const deviceService = createDeviceService();
    const edgeEnv = { SUPABASE_URL: restFixture.url, SUPABASE_SERVICE_ROLE_KEY: restFixture.serviceKey, CORE_BROKER_URL: `http://127.0.0.1:${brokerPort}`, CORE_BROKER_TOKEN: brokerToken, CORE_EDGE_SIGNING_KEY: signingKey };
    // The existing edge accepts literal loopback for local development. A
    // remote broker still requires HTTPS; no production auth flag is changed.
    async function mcp(name, args = {}, who = 'owner') {
      const request = new Request('https://fixture.invalid/v1/core/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      return handleCoreMcp(request, edgeEnv, who === 'owner' ? { id: OWNER } : who === 'member' ? { id: MEMBER } : null);
    }
    const ownerOptions = { actor: { kind: 'owner', user_id: OWNER } };
    async function addWorker(name = `Test worker ${testWorkers.length + 1}`, suppliedEnrollment = null, simulated = false) {
      const childStart = children.length, serverStart = servers.length;
      const workerDir = path.join(temp, `worker-${testWorkers.length + 1}`);
      try {
      const issued = suppliedEnrollment || await deviceService.createEnrollment({ org_id: ORG, display_name: name, platform: simulated ? 'darwin' : process.platform }, ownerOptions); credentials.push(issued.credential);
      fs.mkdirSync(workerDir, { mode: 0o700 });
      const requests = [], generation = { delayMs: 350, words: ['**Staging', 'test', 'output.**', 'This', 'answer', 'came', 'through', name + '.', 'The', 'model', 'text', 'is', 'synthetic.'], active: 0, peak: 0, aborted: 0 };
      const ollama = http.createServer(async (req, res) => {
        const json = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
        if (req.url === '/api/tags') return json({ models: [{ name: 'qwen3:8b', digest: 'a'.repeat(64), size: 5000000000 }] });
        if (req.url === '/api/ps') return json({ models: [{ name: 'qwen3:8b', digest: 'a'.repeat(64), size: 5000000000, size_vram: 0 }] });
        if (req.url !== '/api/chat') { res.writeHead(404); return res.end(); }
        let text = ''; for await (const chunk of req) text += chunk;
        const body = JSON.parse(text || '{}'); requests.push(body); generation.active += 1; generation.peak = Math.max(generation.peak, generation.active);
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        try {
          for (const word of generation.words) { if (res.destroyed) { generation.aborted += 1; break; } res.write(JSON.stringify({ model: 'qwen3:8b', message: { role: 'assistant', content: word + ' ' }, done: false }) + '\n'); await fixturePause(generation.delayMs); }
          if (!res.destroyed) res.end(JSON.stringify({ model: 'qwen3:8b', done: true, done_reason: 'stop', prompt_eval_count: 40, eval_count: generation.words.length, eval_duration: Math.max(1, generation.words.length * generation.delayMs) * 1_000_000, total_duration: 5000000000 }) + '\n');
        } finally { generation.active -= 1; }
      });
      servers.push(ollama); const ollamaPort = await listen(ollama), adapterPort = await port();
      const adapter = spawnService('core/src/compute/ollama-adapter.mjs', { MCCLUSTER_OLLAMA_ADAPTER_PORT: String(adapterPort), MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`, MCCLUSTER_OLLAMA_CONTEXT: '4096', MCCLUSTER_OLLAMA_IMPLEMENTATIONS: 'qwen3.8b.local=qwen3:8b' });
      await ready(adapter, 'ollama_adapter_ready');
      const manifest = { max_leases: 1, labels: { fixture: 'true', site: 'owner-workspace-staging' }, capabilities: [{ capability: 'ai.chat', implementation: 'qwen3.8b.local', model: 'qwen3:8b', backend: 'ollama', max_concurrency: 1, features: { chat: true, tools: true }, executor: { type: 'http', url: `http://127.0.0.1:${adapterPort}/execute`, health_url: `http://127.0.0.1:${adapterPort}/ready?implementation=qwen3.8b.local`, timeout_ms: 60000 } }] };
      const manifestPath = path.join(workerDir, 'capabilities.json'); fs.writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
      const workerEnv = { MCCLUSTER_COMPUTE_URL: localComputeUrl, MCCLUSTER_NODE_STATE_DIR: workerDir, MCCLUSTER_NODE_MANIFEST: manifestPath, MCCLUSTER_NODE_NAME: name, MCCLUSTER_NODE_POLL_MS: '1000', MCCLUSTER_NODE_HEARTBEAT_MS: '10000', NODE_EXTRA_CA_CERTS: certFile, ...(simulated ? { MCCLUSTER_SIMULATED_MAC_WORKER: '1', MCCLUSTER_SIMULATED_MAC_ADAPTER_URL: `http://127.0.0.1:${adapterPort}/execute` } : {}) };
      const workerFile = simulated ? 'core/test/helpers/simulated-mac-worker.mjs' : 'core/src/compute/node-agent.mjs';
      const enrolled = spawnService(workerFile, { ...workerEnv, MCCLUSTER_NODE_ENROLL_TOKEN_STDIN: '1', MCCLUSTER_NODE_ENROLL_ONLY: '1' }, issued.credential + '\n');
      await ready(enrolled, simulated ? 'simulated_mac_worker_enroll_only_done' : 'compute_node_enroll_only_done');
      if (enrolled.exitCode === null && !enrolled.signalCode) await once(enrolled, 'exit');
      const identityPath = path.join(workerDir, 'identity.json');
      const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      const agent = spawnService(workerFile, workerEnv);
      const worker = { name, nodeId: identity.nodeId, identityPath, manifestPath, agent, adapter, requests, generation, workerEnv, simulated, start: () => { worker.agent = spawnService(workerFile, workerEnv); return worker.agent; }, stop: () => stopChild(worker.agent) };
      testWorkers.push(worker);
      await fixtureUntil(async () => (await db.query('select last_seen_at from ops_compute_nodes where id=$1', [worker.nodeId])).rows[0]?.last_seen_at);
      return worker;
      } catch (error) {
        await Promise.allSettled(children.slice(childStart).map(stopChild));
        await Promise.allSettled(servers.slice(serverStart).map(server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }));
        fs.rmSync(workerDir, { recursive: true, force: true });
        throw error;
      }
    }
    for (let index = 0; index < workers; index += 1) await addWorker(`Test worker ${String.fromCharCode(65 + index)} (Linux)`);
    async function setPublicComputeUrl(origin) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Staging compute URL must be a plain HTTPS origin.');
      env.CORE_COMPUTE_PUBLIC_URL = url.origin; process.env.CORE_COMPUTE_PUBLIC_URL = url.origin;
      await stopChild(broker); broker = spawnService('core/src/tool-broker.mjs'); await ready(broker, 'core_tool_broker_ready');
    }
    return { db, restFixture, env, edgeEnv, gateway, broker, gatewayUrl: `http://127.0.0.1:${gatewayPort}`, computeUrl: localComputeUrl, deviceService, ownerOptions, mcp, handleCoreMcp, workers: testWorkers, logs, credentials, addWorker, setPublicComputeUrl, close, spawnService, ready, stopChild, ORG, OWNER, MEMBER };
  } catch (error) { await close(); throw error; }
}
