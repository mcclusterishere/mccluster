import http from 'node:http';
import { COMPUTE_PROTOCOL, DEFAULT_CLOCK_SKEW_MS, validateCapabilityManifest, validateEnrollment, validateInventory, validateLoad, validateNodeId } from './protocol.mjs';
import { keyFingerprint, nodeIdFromPublicKey, SIGNATURE_HEADERS, verifySignedRequest } from './signature.mjs';
import { acceptNonce, claimLease, completeLease, enqueueComputeTask, enrollNode, failLease, heartbeatLease, heartbeatNode, listNodes, liveCapabilityImplementations, nodeById, startLease } from './store.mjs';

const HOST = process.env.CORE_COMPUTE_HOST || '127.0.0.1';
const PORT = Number(process.env.CORE_COMPUTE_PORT || 4788);
const BODY_LIMIT = Number(process.env.CORE_COMPUTE_BODY_LIMIT || 2_097_152);
const CLOCK_SKEW_MS = Number(process.env.CORE_COMPUTE_CLOCK_SKEW_MS || DEFAULT_CLOCK_SKEW_MS);

if (!['127.0.0.1', '::1', 'localhost'].includes(HOST)) {
  throw new Error('Compute gateway must bind to loopback; publish it through an authenticated reverse tunnel/proxy');
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(bytes) {
  if (!bytes.length) return {};
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function requireSecret(req, envName, label) {
  const expected = process.env[envName];
  if (!expected) throw Object.assign(new Error(`${label} is not configured`), { status: 503 });
  const got = bearer(req);
  if (!got || got !== expected) throw Object.assign(new Error('Unauthorized'), { status: 401 });
}

async function authenticateNode(req, url, bodyBytes) {
  const nodeId = validateNodeId(req.headers[SIGNATURE_HEADERS.node]);
  const node = await nodeById(nodeId);
  if (!node) throw Object.assign(new Error('Unknown compute node'), { status: 401, code: 'UNKNOWN_NODE' });
  if (node.state === 'revoked' || node.revoked_at) throw Object.assign(new Error('Compute node is revoked'), { status: 403, code: 'NODE_REVOKED' });
  if (node.state === 'quarantined') throw Object.assign(new Error('Compute node is quarantined'), { status: 403, code: 'NODE_QUARANTINED' });
  if (nodeIdFromPublicKey(node.public_key_pem) !== node.id) throw Object.assign(new Error('Stored node identity is inconsistent'), { status: 500, code: 'NODE_IDENTITY_CORRUPT' });

  const verified = verifySignedRequest({
    publicKeyPem: node.public_key_pem,
    method: req.method,
    path: url.pathname,
    headers: req.headers,
    bodyBytes,
    maxClockSkewMs: CLOCK_SKEW_MS
  });
  if (verified.nodeId !== node.id) throw Object.assign(new Error('Node id mismatch'), { status: 401 });
  const replayExpiresAt = new Date(Date.parse(verified.timestamp) + CLOCK_SKEW_MS).toISOString();
  if (!await acceptNonce(node.id, verified.nonce, replayExpiresAt)) {
    throw Object.assign(new Error('Compute request nonce was already used'), { status: 409, code: 'REPLAY_DETECTED' });
  }
  return node;
}

function leasePath(url) {
  const match = url.pathname.match(/^\/v1\/compute\/leases\/([0-9a-f-]{36})\/(start|heartbeat|complete|fail)$/i);
  return match ? { leaseId: match[1], action: match[2] } : null;
}

async function route(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (url.pathname === '/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, service: 'mccluster-compute-gateway', protocol: COMPUTE_PROTOCOL });
  }

  const bodyBytes = await readBody(req);
  const body = parseJson(bodyBytes);

  if (url.pathname === '/v1/compute/enroll' && req.method === 'POST') {
    requireSecret(req, 'CORE_COMPUTE_ENROLL_TOKEN', 'Compute enrollment');
    const enrollment = validateEnrollment(body);
    const canonicalOrg = process.env.MCCLUSTER_ORG_ID;
    if (canonicalOrg && enrollment.org_id !== canonicalOrg) {
      throw Object.assign(new Error('Enrollment token is not valid for that organization'), { status: 403 });
    }
    const nodeId = nodeIdFromPublicKey(enrollment.public_key);
    const record = await enrollNode({
      id: nodeId,
      org_id: enrollment.org_id,
      display_name: enrollment.display_name,
      public_key_pem: enrollment.public_key,
      key_fingerprint: keyFingerprint(enrollment.public_key),
      protocol_version: enrollment.protocol,
      agent_version: enrollment.agent_version,
      inventory: enrollment.inventory,
      capabilities: enrollment.capabilities,
      labels: enrollment.labels,
      max_leases: enrollment.max_leases
    });
    return json(res, 201, {
      node_id: record.id,
      protocol: COMPUTE_PROTOCOL,
      heartbeat_seconds: Number(process.env.CORE_COMPUTE_HEARTBEAT_SECONDS || 30),
      lease_seconds: Number(process.env.CORE_COMPUTE_LEASE_SECONDS || 120)
    });
  }

  if (url.pathname === '/v1/compute/nodes' && req.method === 'GET') {
    requireSecret(req, 'CORE_COMPUTE_ADMIN_TOKEN', 'Compute admin');
    return json(res, 200, { nodes: await listNodes({ orgId: url.searchParams.get('org_id') || process.env.MCCLUSTER_ORG_ID }) });
  }

  if (url.pathname === '/v1/compute/capabilities' && req.method === 'GET') {
    requireSecret(req, 'CORE_COMPUTE_ADMIN_TOKEN', 'Compute admin');
    return json(res, 200, { implementations: await liveCapabilityImplementations({ orgId: url.searchParams.get('org_id') || process.env.MCCLUSTER_ORG_ID }) });
  }

  if (url.pathname === '/v1/compute/tasks' && req.method === 'POST') {
    requireSecret(req, 'CORE_COMPUTE_ADMIN_TOKEN', 'Compute admin');
    const orgId = body.org_id || process.env.MCCLUSTER_ORG_ID;
    if (!orgId || !body.capability) throw Object.assign(new Error('org_id and capability are required'), { status: 400 });
    const task = await enqueueComputeTask({
      orgId,
      capability: body.capability,
      implementation: body.implementation || null,
      input: body.input || {},
      requirements: body.requirements || {},
      priority: body.priority || 0,
      runAfter: body.run_after,
      maxAttempts: body.max_attempts || 3,
      metadata: body.metadata || {}
    });
    return json(res, 202, { task });
  }

  const node = await authenticateNode(req, url, bodyBytes);

  if (url.pathname === '/v1/compute/heartbeat' && req.method === 'POST') {
    const capabilities = body.capabilities ? validateCapabilityManifest(body.capabilities) : undefined;
    const inventory = body.inventory ? validateInventory(body.inventory) : undefined;
    const load = body.load ? validateLoad(body.load) : undefined;
    const updated = await heartbeatNode(node.id, {
      capabilities,
      inventory,
      load,
      labels: body.labels && typeof body.labels === 'object' ? body.labels : undefined,
      agentVersion: body.agent_version,
      maxLeases: body.max_leases
    });
    return json(res, 200, { ok: true, node_id: updated.id, state: updated.state, server_time: new Date().toISOString() });
  }

  if (url.pathname === '/v1/compute/lease' && req.method === 'POST') {
    const manifest = Array.isArray(node.capabilities) ? node.capabilities : [];
    const capabilities = [...new Set(manifest.map((item) => item.capability).filter(Boolean))];
    const implementations = [...new Set(manifest.map((item) => item.implementation).filter(Boolean))];
    const lease = await claimLease(node.id, {
      capabilities,
      implementations,
      leaseSeconds: Math.max(30, Math.min(900, Number(body.lease_seconds || process.env.CORE_COMPUTE_LEASE_SECONDS || 120)))
    });
    return json(res, 200, { lease: lease || null });
  }

  const parsed = leasePath(url);
  if (parsed && req.method === 'POST') {
    if (!body.lease_token) throw Object.assign(new Error('lease_token is required'), { status: 400 });
    let result;
    if (parsed.action === 'start') result = await startLease(node.id, parsed.leaseId, body.lease_token, body.extend_seconds || 120);
    if (parsed.action === 'heartbeat') result = await heartbeatLease(node.id, parsed.leaseId, body.lease_token, body.progress || {}, body.extend_seconds || 120);
    if (parsed.action === 'complete') result = await completeLease(node.id, parsed.leaseId, body.lease_token, body.result || {});
    if (parsed.action === 'fail') result = await failLease(node.id, parsed.leaseId, body.lease_token, body.error || 'compute node failure', body.retry !== false);
    if (!result) throw Object.assign(new Error('Lease transition rejected'), { status: 409, code: 'LEASE_REJECTED' });
    return json(res, 200, { ok: true, result });
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  route(req, res).catch((error) => {
    console.error(JSON.stringify({ event: 'compute_gateway_error', message: error.message, code: error.code || null }));
    if (!res.headersSent) json(res, Number(error.status || 500), { error: error.message || 'Compute gateway failure', code: error.code || null });
    else res.end();
  }).finally(() => {
    console.log(JSON.stringify({ event: 'compute_gateway_request', method: req.method, path: req.url, duration_ms: Date.now() - startedAt }));
  });
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: 'compute_gateway_ready', host: HOST, port: PORT, protocol: COMPUTE_PROTOCOL, pid: process.pid }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ event: 'compute_gateway_shutdown', signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
