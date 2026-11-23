import http from 'node:http';
import { COMPUTE_PROTOCOL, DEFAULT_CLOCK_SKEW_MS, clampYieldSeconds, claimableManifest, countLiveGpuNodes, enrollmentLabels, heartbeatLabels, validateCapabilityManifest, validateEnrollment, validateInventory, validateLoad, validateNodeId } from './protocol.mjs';
import { keyFingerprint, nodeIdFromPublicKey, SIGNATURE_HEADERS, verifySignedRequest } from './signature.mjs';
import { acceptNonce, claimLease, completeLease, enqueueComputeTask, enrollNode, failLease, heartbeatLease, heartbeatNode, listNodes, liveCapabilityImplementations, nodeById, startLease } from './store.mjs';
import { assertJsonContentType, normalizeRequestId, parseIdempotencyKey, resolveScopedOrg, secureSecretEqual } from './http-security.mjs';
import { handleJobRoute } from './jobs-routes.mjs';
import { recordCompletionAttestation, resolveReceiptKey } from './jobs-service.mjs';
import { RUNNING_DEPLOYMENT_SHA } from '../runtime-revision.mjs';
import { assertActiveScheduler, createSupabaseSchedulerStore, electionConfigFromEnv, SchedulerElection } from './scheduler-election.mjs';

const HOST = process.env.CORE_COMPUTE_HOST || '127.0.0.1';
const PORT = Number(process.env.CORE_COMPUTE_PORT || 4788);
const BODY_LIMIT = Number(process.env.CORE_COMPUTE_BODY_LIMIT || 2_097_152);
const CLOCK_SKEW_MS = Number(process.env.CORE_COMPUTE_CLOCK_SKEW_MS || DEFAULT_CLOCK_SKEW_MS);
// How long a node's completion acknowledgement may wait for the attestation write.
const ATTESTATION_WAIT_MS = Math.max(100, Math.min(10_000, Number(process.env.CORE_COMPUTE_ATTESTATION_WAIT_MS || 1_500)));
// A malformed CORE_RECEIPT_SIGNING_KEY is a startup failure, not a 500 on the first receipt.
resolveReceiptKey(process.env);

if (!['127.0.0.1', '::1', 'localhost'].includes(HOST)) {
  throw new Error('Compute gateway must bind to loopback; publish it through an authenticated reverse tunnel/proxy');
}

// Scheduler election (docs/control-plane/DEVICE-JOBS-SCHEDULER-STANDBY.md). With
// MCCLUSTER_SCHEDULER_ROLE unset there is no election and every admission check
// passes: today's single-scheduler behaviour. With a role, this instance hands
// out device leases and accepts job submissions only while it holds the
// per-org scheduler lease; a standby answers 503 SCHEDULER_STANDBY and names the
// live holder. Heartbeats, enrolment and reads are liveness, never gated.
const electionConfig = electionConfigFromEnv(process.env);
const election = electionConfig
  ? new SchedulerElection({
    ...electionConfig,
    store: await createSupabaseSchedulerStore(),
    onEvent: (event, detail, scheduler) => console.log(JSON.stringify({ event, detail: detail instanceof Error ? { message: detail.message, code: detail.code || null } : (detail ?? null), scheduler }))
  })
  : null;

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    ...extraHeaders
  });
  res.end(payload);
}

async function readBody(req) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    throw Object.assign(new Error('Request body too large'), { status: 413, code: 'BODY_TOO_LARGE' });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('Request body too large'), { status: 413, code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(bytes) {
  if (!bytes.length) return {};
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400, code: 'INVALID_JSON' }); }
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function requireSecret(req, envName, label) {
  const expected = process.env[envName];
  if (!expected) throw Object.assign(new Error(`${label} is not configured`), { status: 503, code: 'AUTH_NOT_CONFIGURED' });
  if (!secureSecretEqual(bearer(req), expected)) throw Object.assign(new Error('Unauthorized'), { status: 401, code: 'UNAUTHORIZED' });
}

function adminOrg(requested) {
  return resolveScopedOrg(requested, process.env.MCCLUSTER_ORG_ID);
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
  if (verified.nodeId !== node.id) throw Object.assign(new Error('Node id mismatch'), { status: 401, code: 'NODE_ID_MISMATCH' });
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
    return json(res, 200, { ok: true, service: 'mccluster-compute-gateway', protocol: COMPUTE_PROTOCOL, scheduler: election ? election.snapshot() : null });
  }

  if (req.method === 'POST') assertJsonContentType(req.headers['content-type']);
  const bodyBytes = await readBody(req);
  const body = parseJson(bodyBytes);

  if (url.pathname === '/v1/compute/enroll' && req.method === 'POST') {
    requireSecret(req, 'CORE_COMPUTE_ENROLL_TOKEN', 'Compute enrollment');
    const enrollment = validateEnrollment(body);
    const scopedOrg = adminOrg(enrollment.org_id);
    if (!scopedOrg) throw Object.assign(new Error('Enrollment organization is required'), { status: 400, code: 'ORG_REQUIRED' });
    const nodeId = nodeIdFromPublicKey(enrollment.public_key);
    const record = await enrollNode({
      id: nodeId,
      org_id: scopedOrg,
      display_name: enrollment.display_name,
      public_key_pem: enrollment.public_key,
      key_fingerprint: keyFingerprint(enrollment.public_key),
      protocol_version: enrollment.protocol,
      agent_version: enrollment.agent_version,
      inventory: enrollment.inventory,
      capabilities: enrollment.capabilities,
      // The owner's enrolment token authorised this call: the trust it carries
      // is recorded (labels.enrolled_trust) where no heartbeat can reach it.
      labels: enrollmentLabels(enrollment.labels),
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
    const orgId = adminOrg(url.searchParams.get('org_id'));
    return json(res, 200, { nodes: await listNodes({ orgId }) });
  }

  if (url.pathname === '/v1/compute/capabilities' && req.method === 'GET') {
    requireSecret(req, 'CORE_COMPUTE_ADMIN_TOKEN', 'Compute admin');
    const orgId = adminOrg(url.searchParams.get('org_id'));
    return json(res, 200, { implementations: await liveCapabilityImplementations({ orgId }) });
  }

  if (url.pathname === '/v1/compute/tasks' && req.method === 'POST') {
    requireSecret(req, 'CORE_COMPUTE_ADMIN_TOKEN', 'Compute admin');
    const orgId = adminOrg(body.org_id);
    if (!orgId || !body.capability) throw Object.assign(new Error('org_id and capability are required'), { status: 400, code: 'TASK_INVALID' });
    const idempotencyKey = parseIdempotencyKey(req.headers['idempotency-key']);
    const { task, replayed } = await enqueueComputeTask({
      orgId,
      capability: body.capability,
      implementation: body.implementation || null,
      input: body.input || {},
      requirements: body.requirements || {},
      priority: body.priority || 0,
      runAfter: body.run_after || null,
      maxAttempts: body.max_attempts || 3,
      metadata: body.metadata || {},
      idempotencyKey
    });
    return json(res, replayed ? 200 : 202, { task, replayed }, idempotencyKey ? { 'idempotency-replayed': replayed ? 'true' : 'false' } : {});
  }

  // Device job contract (docs/control-plane/DEVICE-JOBS-CONTRACT.md): admin
  // submit/status/result/receipt over the same durable task and lease rows.
  const jobRoute = await handleJobRoute({
    req, url, body,
    requireAdmin: () => requireSecret(req, 'CORE_COMPUTE_ADMIN_TOKEN', 'Compute admin'),
    adminOrg,
    canonicalOrg: String(process.env.MCCLUSTER_ORG_ID || '').trim() || null,
    election,
    issuer: { instance: process.env.MCCLUSTER_CORE_ID || null, deployment_sha: RUNNING_DEPLOYMENT_SHA || null }
  });
  if (jobRoute) return json(res, jobRoute.status, jobRoute.body, jobRoute.headers || {});

  const node = await authenticateNode(req, url, bodyBytes);

  if (url.pathname === '/v1/compute/heartbeat' && req.method === 'POST') {
    const capabilities = body.capabilities ? validateCapabilityManifest(body.capabilities) : undefined;
    const inventory = body.inventory ? validateInventory(body.inventory) : undefined;
    const load = body.load ? validateLoad(body.load) : undefined;
    const updated = await heartbeatNode(node.id, {
      capabilities,
      inventory,
      load,
      // A heartbeat is signed by the node's own key only: trust, role and the
      // enrolment record keep what the owner-gated enrolment stored.
      labels: body.labels && typeof body.labels === 'object' && !Array.isArray(body.labels) ? heartbeatLabels(node.labels, body.labels) : undefined,
      agentVersion: body.agent_version,
      maxLeases: body.max_leases
    });
    // Other live gpu-verified nodes, so a CPU node can leave fresh tasks to
    // them (MCCLUSTER_NODE_YIELD_TO_GPU_MS). A failed read never fails the heartbeat.
    let liveGpuNodes = null;
    try {
      const live = await listNodes({ orgId: node.org_id, liveOnly: true, limit: 500 });
      liveGpuNodes = countLiveGpuNodes(live, { excludeNodeId: node.id });
    } catch (error) {
      console.error(JSON.stringify({ event: 'compute_gateway_live_gpu_unavailable', node_id: node.id, message: error.message }));
    }
    return json(res, 200, { ok: true, node_id: updated.id, state: updated.state, server_time: new Date().toISOString(), live_gpu_nodes: liveGpuNodes });
  }

  if (url.pathname === '/v1/compute/lease' && req.method === 'POST') {
    // Owned-only capabilities are claimable only by a node whose enrolment
    // recorded trust 'owned', whatever its manifest advertises.
    // Only the active scheduler hands out leases (a standby answers 503).
    assertActiveScheduler(election);
    const manifest = claimableManifest(node.capabilities, node.labels);
    const capabilities = [...new Set(manifest.map((item) => item.capability).filter(Boolean))];
    const implementations = [...new Set(manifest.map((item) => item.implementation).filter(Boolean))];
    const lease = await claimLease(node.id, {
      capabilities,
      implementations,
      leaseSeconds: Math.max(30, Math.min(900, Number(body.lease_seconds || process.env.CORE_COMPUTE_LEASE_SECONDS || 120))),
      // 0..300 s; the store drops it while the yield SQL is not promoted.
      yieldSeconds: clampYieldSeconds(body.yield_seconds)
    });
    return json(res, 200, { lease: lease || null });
  }

  const parsed = leasePath(url);
  if (parsed && req.method === 'POST') {
    if (!body.lease_token) throw Object.assign(new Error('lease_token is required'), { status: 400, code: 'LEASE_TOKEN_REQUIRED' });
    let result;
    if (parsed.action === 'start') result = await startLease(node.id, parsed.leaseId, body.lease_token, body.extend_seconds || 120);
    if (parsed.action === 'heartbeat') result = await heartbeatLease(node.id, parsed.leaseId, body.lease_token, body.progress || {}, body.extend_seconds || 120);
    if (parsed.action === 'complete') result = await completeLease(node.id, parsed.leaseId, body.lease_token, body.result || {});
    if (parsed.action === 'fail') result = await failLease(node.id, parsed.leaseId, body.lease_token, body.error || 'compute node failure', body.retry !== false);
    if (!result) throw Object.assign(new Error('Lease transition rejected'), { status: 409, code: 'LEASE_REJECTED' });
    // The node's own signature over this accepted completion becomes part of
    // the job receipt. Best-effort and after the commit: it never undoes a result.
    if (parsed.action === 'complete') {
      // Bounded: the node's acknowledgement never waits on a slow attestation
      // write; the write itself continues in the background and logs its outcome.
      const attest = recordCompletionAttestation({ node, leaseId: parsed.leaseId, path: url.pathname, headers: req.headers, result: body.result || {} });
      attest.then((outcome) => { if (outcome?.recorded === false && outcome.available === null) return; }).catch(() => {});
      await Promise.race([attest, new Promise((resolve) => setTimeout(resolve, ATTESTATION_WAIT_MS).unref?.())]);
    }
    return json(res, 200, { ok: true, result });
  }

  return json(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
}

const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  const requestId = normalizeRequestId(req.headers['x-request-id']);
  res.setHeader('x-request-id', requestId);
  route(req, res).catch((error) => {
    console.error(JSON.stringify({ event: 'compute_gateway_error', request_id: requestId, message: error.message, code: error.code || null }));
    if (!res.headersSent) {
      json(res, Number(error.status || 500), {
        error: error.message || 'Compute gateway failure', code: error.code || null, request_id: requestId,
        // A standby names the live scheduler so a client can follow it; a retryable refusal says so.
        ...(error.retryable === true ? { retryable: true } : {}),
        ...(error.active_holder !== undefined ? { active_holder: error.active_holder } : {}),
        ...(error.job_status ? { job_status: error.job_status } : {})
      });
    }
    else res.end();
  }).finally(() => {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', `http://${HOST}:${PORT}`).pathname; } catch {}
    console.log(JSON.stringify({ event: 'compute_gateway_request', request_id: requestId, method: req.method, path: pathname, status: res.statusCode, duration_ms: Date.now() - startedAt }));
  });
});

if (election) {
  // Acquire (or learn who holds) the scheduler lease before taking traffic. A
  // failed first call is an event, not a crash: the instance starts as standby.
  await election.start();
}
server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: 'compute_gateway_ready', host: HOST, port: PORT, protocol: COMPUTE_PROTOCOL, pid: process.pid, scheduler: election ? election.snapshot() : null }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ event: 'compute_gateway_shutdown', signal }));
  // A clean stop releases the scheduler lease so the other side takes over at once.
  const released = election ? election.stop().catch(() => {}) : Promise.resolve();
  released.then(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
