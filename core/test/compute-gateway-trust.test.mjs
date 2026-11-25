// Owned-only capabilities rest on the trust recorded at enrolment (review
// N2R-3), proven against the real gateway process with a fake Supabase REST
// endpoint and signed node requests: the enrol call (gated by the owner's
// enrolment token) records the node's trust as labels.enrolled_trust; a
// heartbeat (signed by the node's own key only) can no longer change trust,
// role or that record; and a node whose recorded trust is not 'owned' cannot
// claim browser.act tasks, whatever its manifest or labels say. Re-enrolling
// with the owner's token is the one way to change the record.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { generateNodeIdentity, signRequest } from '../src/compute/signature.mjs';
import { COMPUTE_PROTOCOL } from '../src/compute/protocol.mjs';

const GATEWAY = fileURLToPath(new URL('../src/compute/gateway.mjs', import.meta.url));
const ORG = '00000000-0000-4000-8000-0000000000aa';
const ENROLL = 'enrol-fixture-value';
const CAPABILITIES = [
  { capability: 'ai.chat', implementation: 'qwen3.8b.local', backend: 'ollama', model: 'qwen3:8b', features: { chat: true, self_hosted: true } },
  { capability: 'browser.act', implementation: 'chromium.local', backend: 'playwright', model: null, features: { browser: true, screenshot: true, self_hosted: true } }
];

// The rows the gateway reads and writes, and every call it made.
const db = { nodes: new Map(), calls: [] };
let supabase;
let gateway;
let base;

function startFakeSupabase() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://fake.invalid');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    db.calls.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), body });
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    const id = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
    if (path === 'ops_compute_nodes' && req.method === 'GET') return reply(200, id ? (db.nodes.has(id) ? [db.nodes.get(id)] : []) : []);
    if (path === 'ops_compute_nodes' && req.method === 'POST') {
      const row = { ...body, state: body.state || 'online' };
      db.nodes.set(body.id, row);
      return reply(201, [row]);
    }
    if (path === 'ops_compute_nodes' && req.method === 'PATCH') {
      const row = db.nodes.get(id);
      if (!row) return reply(200, []);
      Object.assign(row, body);
      return reply(200, [row]);
    }
    if (path === 'rpc/compute_accept_nonce') return reply(200, true);
    if (path === 'rpc/compute_claim_task') return reply(200, null);
    return reply(404, { message: `unexpected ${req.method} ${path}` });
  });
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => server);
}

async function freePort() {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

before(async () => {
  supabase = await startFakeSupabase();
  const port = await freePort();
  const env = { ...process.env, CORE_COMPUTE_PORT: String(port), CORE_COMPUTE_ENROLL_TOKEN: ENROLL, MCCLUSTER_ORG_ID: ORG, SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`, SUPABASE_SECRET_KEY: 'fixture-key' };
  delete env.CORE_COMPUTE_HOST;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  gateway = spawn(process.execPath, [GATEWAY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  gateway.stderr.on('data', (chunk) => { err += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`gateway not ready: ${err}`)), 15000);
    gateway.stdout.on('data', (chunk) => { out += chunk; if (out.includes('compute_gateway_ready')) { clearTimeout(timer); resolve(); } });
    gateway.once('exit', (code) => { clearTimeout(timer); reject(new Error(`gateway exited ${code}: ${err}`)); });
  });
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
    const exited = once(gateway, 'exit');
    gateway.kill('SIGTERM');
    await exited;
  }
  if (supabase) { supabase.closeAllConnections?.(); await new Promise((resolve) => supabase.close(resolve)); }
});

async function enrol(identity, labels) {
  const response = await fetch(`${base}/v1/compute/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ENROLL}` },
    body: JSON.stringify({ protocol: COMPUTE_PROTOCOL, org_id: ORG, display_name: labels.site, public_key: identity.publicKeyPem, agent_version: 'test', inventory: {}, capabilities: CAPABILITIES, labels, max_leases: 1 })
  });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

async function signed(identity, path, body) {
  const bodyBytes = Buffer.from(JSON.stringify(body));
  const headers = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path, nodeId: identity.nodeId, bodyBytes });
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: bodyBytes });
  const text = await response.text();
  assert.equal(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text);
}

const lastCall = (method, path) => db.calls.filter((call) => call.method === method && call.path === path).at(-1);

test('enrolment records the trust; a heartbeat cannot rewrite trust, role or the record, while its other labels still update', async () => {
  const node = generateNodeIdentity();
  await enrol(node, { site: 'box-partner', trust: 'partner', role: 'cpu-helper', enrolled_trust: 'owned' });
  const enrolled = lastCall('POST', 'ops_compute_nodes').body.labels;
  assert.equal(enrolled.trust, 'partner');
  assert.equal(enrolled.enrolled_trust, 'partner', 'the record is the trust the enrolment carried, not a value the node sent for the record');

  await signed(node, '/v1/compute/heartbeat', { labels: { site: 'box-partner', trust: 'owned', role: 'gpu-laptop', enrolled_trust: 'owned', hardware_mode: 'gpu-verified' } });
  const patched = lastCall('PATCH', 'ops_compute_nodes').body.labels;
  assert.equal(patched.trust, 'partner', 'a heartbeat cannot raise the trust');
  assert.equal(patched.role, 'cpu-helper', 'a heartbeat cannot change the role');
  assert.equal(patched.enrolled_trust, 'partner', 'a heartbeat cannot rewrite the enrolment record');
  assert.equal(patched.hardware_mode, 'gpu-verified', 'labels that are not pinned still update');
  assert.equal(db.nodes.get(node.nodeId).labels.enrolled_trust, 'partner');
});

test('a node whose enrolment did not record trust owned cannot claim browser.act, whatever it advertises; an owned enrolment can', async () => {
  const partner = generateNodeIdentity();
  await enrol(partner, { site: 'box-claim', trust: 'partner', role: 'cpu-helper' });
  await signed(partner, '/v1/compute/heartbeat', { labels: { site: 'box-claim', trust: 'owned', role: 'gpu-laptop' }, capabilities: CAPABILITIES });
  await signed(partner, '/v1/compute/lease', {});
  const partnerClaim = lastCall('POST', 'rpc/compute_claim_task').body;
  assert.equal(partnerClaim.p_node_id, partner.nodeId);
  assert.deepEqual(partnerClaim.p_capabilities, ['ai.chat'], 'browser.act is not claimable by a node enrolled as partner');
  assert.deepEqual(partnerClaim.p_implementations, ['qwen3.8b.local']);

  const owned = generateNodeIdentity();
  await enrol(owned, { site: 'box-owned', trust: 'owned', role: 'gpu-laptop' });
  await signed(owned, '/v1/compute/lease', {});
  const ownedClaim = lastCall('POST', 'rpc/compute_claim_task').body;
  assert.equal(ownedClaim.p_node_id, owned.nodeId);
  assert.deepEqual([...ownedClaim.p_capabilities].sort(), ['ai.chat', 'browser.act']);
  assert.deepEqual([...ownedClaim.p_implementations].sort(), ['chromium.local', 'qwen3.8b.local']);

  // The owner's enrolment token is the one way to change the record.
  await enrol(partner, { site: 'box-claim', trust: 'owned', role: 'gpu-laptop' });
  await signed(partner, '/v1/compute/lease', {});
  assert.deepEqual([...lastCall('POST', 'rpc/compute_claim_task').body.p_capabilities].sort(), ['ai.chat', 'browser.act'], 'after an owner re-enrolment as owned');
});

test('a node enrolled before the record existed (labels.trust only) is not admitted for browser.act until it enrols again', async () => {
  const legacy = generateNodeIdentity();
  await enrol(legacy, { site: 'box-legacy', trust: 'owned', role: 'gpu-laptop' });
  // The row as an earlier gateway wrote it: trust without the enrolment record.
  const row = db.nodes.get(legacy.nodeId);
  row.labels = { site: 'box-legacy', trust: 'owned', role: 'gpu-laptop' };
  await signed(legacy, '/v1/compute/lease', {});
  assert.deepEqual(lastCall('POST', 'rpc/compute_claim_task').body.p_capabilities, ['ai.chat']);
  await signed(legacy, '/v1/compute/heartbeat', { labels: { site: 'box-legacy', trust: 'owned', role: 'gpu-laptop', enrolled_trust: 'owned' } });
  assert.equal(lastCall('PATCH', 'ops_compute_nodes').body.labels.enrolled_trust, undefined, 'a heartbeat cannot create the record either');
});
