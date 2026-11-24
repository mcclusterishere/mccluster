// The device job contract: what an admin client (the Control Room, Prime's
// Windows client, a Mac fixture) can rely on when it sends AI work to our own
// devices and reads the answer back. Pure functions only: no I/O, no env.
//
//   submit  -> POST /v1/compute/jobs          (validateJobSubmission)
//   status  -> GET  /v1/compute/jobs/:id      (jobView)
//   result  -> GET  /v1/compute/jobs/:id/result   (jobResult)
//   receipt -> GET  /v1/compute/jobs/:id/receipt  (buildReceipt + signReceipt)
//
// A job is a durable ops_compute_tasks row plus its ops_compute_leases rows.
// Nothing here is a second queue: the view is derived from those rows and the
// node that held the completing lease. The receipt is versioned
// (mccluster-job-receipt/1), hashes the input and output canonically, carries
// the node's own completion signature when the gateway recorded one, and is
// signed by the Core receipt key so the admin app can verify it offline.
import crypto from 'node:crypto';
import { canonicalRequest } from './signature.mjs';

export const JOB_CONTRACT = 'mccluster-job/1';
export const JOB_RESULT_SCHEMA = 'mccluster-job-result/1';
export const RECEIPT_SCHEMA = 'mccluster-job-receipt/1';
export const RECEIPT_KEY_SCHEMA = 'mccluster-receipt-key/1';
export const ATTESTATION_SCHEMA = 'mccluster-completion-attestation/1';
export const DEVICE_FACTS_SCHEMA = 'mccluster-device-facts/1';
export const DEVICE_FACTS_SOURCE = 'node-reported-at-completion';
export const JOB_STATES = Object.freeze(['queued', 'leased', 'running', 'done', 'failed', 'canceled']);
export const TERMINAL_STATES = new Set(['done', 'failed', 'canceled']);
// Only two inference modes are ever reported. 'shared-inference' is claimed
// only by a future group receipt carrying completion attestations from at
// least two distinct enrolled nodes; one lease is always one device.
export const INFERENCE_MODES = Object.freeze(['single-device', 'shared-inference']);

const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const IMPLEMENTATION_ID = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTING_KEYS = new Set(['provider', 'transport', 'hosting', 'billing']);
export const MAX_INPUT_BYTES = 1_048_576;

function httpError(message, status, code, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Canonical JSON: object keys sorted recursively, arrays in order, undefined
// and functions dropped exactly as JSON.stringify drops them. Two parties that
// hold the same parsed value compute the same string, whatever key order
// PostgREST or a node happened to emit.
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : sortKeys(item)));
  if (isObject(value)) {
    // A null prototype keeps every own key a data property: a "__proto__" key
    // would otherwise vanish and two different outputs would share one hash.
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined || typeof value[key] === 'function') continue;
      out[key] = sortKeys(value[key]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(text) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(text) ? text : String(text), 'utf8').digest('hex');
}

export function hashJson(value) {
  if (value === undefined || value === null) return null;
  return sha256Hex(canonicalJson(value));
}

function text(value, max) {
  return value == null ? null : String(value).slice(0, max);
}

// Requirements the admin may ask for become feature requirements the claim
// enforces (requirements.features <@ advertised.features). Routing keys are
// dropped: a node is chosen by capability and implementation, never by a
// provider name.
export function featureRequirements(requirements = {}) {
  const features = {};
  for (const [key, value] of Object.entries(isObject(requirements) ? requirements : {})) {
    if (ROUTING_KEYS.has(key) || value === undefined || value === null || value === false) continue;
    if (key === 'features' && isObject(value)) {
      for (const [inner, innerValue] of Object.entries(value)) {
        if (innerValue !== undefined && innerValue !== null && innerValue !== false) features[inner] = innerValue;
      }
      continue;
    }
    features[key] = value;
  }
  return Object.keys(features).length ? { features } : {};
}

export function validateJobSubmission(body, { canonicalOrg = null } = {}) {
  if (!isObject(body)) throw httpError('Job submission must be a JSON object', 400, 'JOB_INVALID');
  const requested = body.org_id == null ? null : String(body.org_id);
  if (requested && !UUID.test(requested)) throw httpError('org_id must be a UUID', 400, 'JOB_INVALID');
  if (canonicalOrg && requested && requested !== canonicalOrg) {
    throw httpError('Cross-organization job submission is not allowed', 403, 'CROSS_ORG_DENIED');
  }
  const orgId = requested || canonicalOrg;
  if (!orgId) throw httpError('org_id is required', 400, 'ORG_REQUIRED');
  if (!CAPABILITY_ID.test(body.capability || '')) throw httpError('capability is required (lowercase dotted id)', 400, 'JOB_INVALID');
  const implementation = body.implementation == null || body.implementation === '' ? null : String(body.implementation);
  if (implementation && !IMPLEMENTATION_ID.test(implementation)) throw httpError('implementation id is invalid', 400, 'JOB_INVALID');
  const input = body.input === undefined ? {} : body.input;
  if (!isObject(input)) throw httpError('input must be a JSON object', 400, 'JOB_INVALID');
  const inputBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  if (inputBytes > MAX_INPUT_BYTES) throw httpError(`input exceeds ${MAX_INPUT_BYTES} bytes`, 413, 'JOB_INPUT_TOO_LARGE');
  if (body.metadata !== undefined && !isObject(body.metadata)) throw httpError('metadata must be a JSON object', 400, 'JOB_INVALID');
  const priority = body.priority === undefined ? 0 : Math.trunc(Number(body.priority));
  if (!Number.isFinite(priority) || priority < -100 || priority > 100) throw httpError('priority must be between -100 and 100', 400, 'JOB_INVALID');
  const maxAttempts = body.max_attempts === undefined ? 3 : Math.trunc(Number(body.max_attempts));
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw httpError('max_attempts must be between 1 and 100', 400, 'JOB_INVALID');
  let runAfter = null;
  if (body.run_after != null) {
    const parsed = Date.parse(body.run_after);
    if (!Number.isFinite(parsed)) throw httpError('run_after must be an ISO-8601 timestamp', 400, 'JOB_INVALID');
    runAfter = new Date(parsed).toISOString();
  }
  const client = isObject(body.client)
    ? { name: text(body.client.name, 80) || 'unknown', version: text(body.client.version, 40) || null, contract: JOB_CONTRACT }
    : { name: 'unknown', version: null, contract: JOB_CONTRACT };
  return {
    org_id: orgId,
    capability: body.capability,
    implementation,
    input,
    requirements: featureRequirements(body.requirements),
    priority,
    max_attempts: maxAttempts,
    run_after: runAfter,
    metadata: body.metadata || {},
    client,
    allow_offline: body.allow_offline === true
  };
}

export function nodeSummary(node) {
  if (!node) return null;
  const runtime = node.inventory?.runtime || {};
  const gpus = Array.isArray(node.inventory?.gpus) ? node.inventory.gpus.map((gpu) => ({
    vendor: gpu?.vendor ?? null, model: gpu?.model ?? null, vram_bytes: gpu?.vram_bytes ?? null,
    form: gpu?.form ?? null, memory: gpu?.memory ?? null, compute: gpu?.compute ?? null
  })) : [];
  return {
    node_id: node.id,
    display_name: node.display_name ?? null,
    key_fingerprint: node.key_fingerprint ?? null,
    state: node.state ?? null,
    platform: node.inventory?.platform ?? null,
    arch: node.inventory?.arch ?? null,
    agent_version: node.agent_version ?? runtime.agent_version ?? null,
    hardware_mode: runtime.hardware_mode ?? null,
    gpu_verified_at: runtime.gpu_verified_at ?? null,
    enrolled_trust: node.labels?.enrolled_trust ?? null,
    site: node.labels?.site ?? null,
    gpus,
    measured_inference: runtime.measured_inference ?? null,
    last_seen_at: node.last_seen_at ?? null
  };
}

export function latestLease(leases = []) {
  const list = (Array.isArray(leases) ? leases : []).filter(Boolean);
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const byAttempt = Number(b.attempt || 0) - Number(a.attempt || 0);
    if (byAttempt) return byAttempt;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  })[0];
}

// The lease whose result the task's output came from: the one marked done for
// a done task, else the latest lease.
export function completingLease(task, leases = []) {
  const list = (Array.isArray(leases) ? leases : []).filter(Boolean);
  if (task?.status === 'done') {
    const done = list.filter((lease) => lease.status === 'done');
    if (done.length) return latestLease(done);
  }
  return latestLease(list);
}

function leaseSummary(lease) {
  if (!lease) return null;
  return {
    lease_id: lease.id,
    node_id: lease.node_id,
    implementation: lease.implementation ?? null,
    attempt: lease.attempt ?? null,
    status: lease.status,
    created_at: lease.created_at ?? null,
    started_at: lease.started_at ?? null,
    completed_at: lease.completed_at ?? null,
    expires_at: lease.expires_at ?? null,
    progress: isObject(lease.progress) ? lease.progress : {},
    last_error: lease.last_error ?? null
  };
}

export function jobView({ task, leases = [], node = null }) {
  if (!task) throw httpError('compute job not found', 404, 'JOB_NOT_FOUND');
  const lease = latestLease(leases);
  const status = JOB_STATES.includes(task.status) ? task.status : 'queued';
  return {
    schema: JOB_CONTRACT,
    job_id: task.id,
    org_id: task.org_id,
    capability: task.capability,
    implementation: task.implementation ?? null,
    status,
    terminal: TERMINAL_STATES.has(status),
    attempts: Number(task.attempts || 0),
    max_attempts: Number(task.max_attempts || 0),
    priority: Number(task.priority || 0),
    run_after: task.run_after ?? null,
    created_at: task.created_at ?? null,
    updated_at: task.updated_at ?? null,
    input_sha256: hashJson(task.input ?? {}),
    last_error: task.last_error ?? null,
    locked_by_node_id: task.locked_by_node_id ?? null,
    execution: leaseSummary(lease),
    node: nodeSummary(node),
    result_available: status === 'done' && task.output != null,
    receipt_available: TERMINAL_STATES.has(status),
    metadata: isObject(task.metadata) ? task.metadata : {}
  };
}

export function jobResult({ task, leases = [], node = null }) {
  if (!task) throw httpError('compute job not found', 404, 'JOB_NOT_FOUND');
  if (task.status !== 'done') {
    throw httpError(`compute job is ${task.status}, not done`, 409, 'JOB_NOT_DONE', { job_status: task.status });
  }
  const lease = completingLease(task, leases);
  return {
    schema: JOB_RESULT_SCHEMA,
    job_id: task.id,
    status: 'done',
    capability: task.capability,
    implementation: lease?.implementation ?? task.implementation ?? null,
    output: task.output ?? null,
    output_sha256: hashJson(task.output),
    completed_at: lease?.completed_at ?? task.updated_at ?? null,
    lease_id: lease?.id ?? null,
    attempt: lease?.attempt ?? null,
    node: nodeSummary(node)
  };
}

// ---- Node completion attestation -------------------------------------------
// At POST /v1/compute/leases/:id/complete the node signed (method, path,
// node id, timestamp, nonce, body digest) with its own Ed25519 key. The gateway
// keeps those public fields plus the canonical hash of the result it committed.
// The body itself is never stored: it carries the lease token.
// device_facts (deviceFactsAtCompletion) rides in the same record: the facts
// are bound in the step that accepts the completion and never rewritten.
export function completionAttestation({ node, leaseId, attempt = null, method = 'POST', path, headers, result, implementation = null, capturedAt = undefined }) {
  const read = (name) => (typeof headers?.get === 'function' ? headers.get(name) : headers?.[name]) ?? null;
  const attestation = {
    schema: ATTESTATION_SCHEMA,
    lease_id: leaseId,
    node_id: node?.id ?? read('x-mccluster-node-id'),
    attempt,
    protocol: read('x-mccluster-compute-protocol'),
    method: String(method).toUpperCase(),
    path: String(path),
    signed_at: read('x-mccluster-timestamp'),
    nonce: read('x-mccluster-nonce'),
    body_digest: read('x-mccluster-content-sha256'),
    signature: read('x-mccluster-signature'),
    result_sha256: hashJson(result ?? {}),
    device_facts: deviceFactsAtCompletion({ node, implementation, result, capturedAt })
  };
  for (const key of ['node_id', 'protocol', 'signed_at', 'nonce', 'body_digest', 'signature']) {
    if (!attestation[key]) throw httpError(`completion attestation is missing ${key}`, 500, 'ATTESTATION_INCOMPLETE');
  }
  return attestation;
}

export function verifyAttestation(attestation, nodePublicKeyPem) {
  if (!isObject(attestation)) return { ok: false, reason: 'missing attestation' };
  if (!nodePublicKeyPem) return { ok: false, reason: 'node public key unavailable' };
  try {
    const canonical = canonicalRequest({
      method: attestation.method, path: attestation.path, nodeId: attestation.node_id,
      timestamp: attestation.signed_at, nonce: attestation.nonce, digest: attestation.body_digest
    });
    const ok = crypto.verify(null, Buffer.from(canonical), nodePublicKeyPem, Buffer.from(String(attestation.signature), 'base64url'));
    return ok ? { ok: true, reason: null } : { ok: false, reason: 'node signature does not verify' };
  } catch (error) {
    return { ok: false, reason: `attestation unverifiable: ${error.message}` };
  }
}

// ---- Receipt key -----------------------------------------------------------
export function receiptKeyId(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
}

export function generateReceiptKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { publicKeyPem, privateKeyPem, keyId: receiptKeyId(publicKeyPem) };
}

// CORE_RECEIPT_SIGNING_KEY: a PKCS#8 Ed25519 private key PEM (literal "\n"
// accepted, as systemd EnvironmentFile lines are single-line). Absent means
// receipts are issued unsigned and say so; a malformed key is refused loudly.
export function receiptKeyFromEnv(env = process.env) {
  const raw = String(env.CORE_RECEIPT_SIGNING_KEY || '').trim();
  if (!raw) return null;
  const pem = raw.replace(/\\n/g, '\n');
  let privateKey;
  try { privateKey = crypto.createPrivateKey(pem); }
  catch (error) { throw httpError(`CORE_RECEIPT_SIGNING_KEY is not a valid private key PEM: ${error.message}`, 500, 'RECEIPT_KEY_INVALID'); }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw httpError('CORE_RECEIPT_SIGNING_KEY must be an Ed25519 key', 500, 'RECEIPT_KEY_INVALID');
  const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem, keyId: receiptKeyId(publicKeyPem) };
}

export function receiptKeyInfo(key) {
  if (!key) return { schema: RECEIPT_KEY_SCHEMA, configured: false, alg: 'ed25519', key_id: null, public_key_pem: null };
  return { schema: RECEIPT_KEY_SCHEMA, configured: true, alg: 'ed25519', key_id: key.keyId, public_key_pem: key.publicKeyPem };
}

// ---- Receipt -----------------------------------------------------------------
function durationMs(lease) {
  const start = Date.parse(lease?.started_at || lease?.created_at || '');
  const end = Date.parse(lease?.completed_at || '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

// The node's own account of why it reports its hardware_mode: when an engine
// last proved a model loaded with VRAM, that observation, and the adapters it
// found. Node-reported inventory, bounded to named fields; the Core signs that
// this is what the enrolled node published, not that it inspected the machine.
function hardwareEvidence(node) {
  const runtime = node?.inventory?.runtime;
  if (!isObject(runtime)) return null;
  const seen = isObject(runtime.gpu_evidence) ? runtime.gpu_evidence : null;
  const count = (value) => (value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null);
  return {
    gpu_verified_at: text(runtime.gpu_verified_at, 40),
    engine: seen ? {
      source: text(seen.source, 80), model: text(seen.model, 200), digest: text(seen.digest, 200),
      size_vram_bytes: count(seen.size_vram_bytes), size_bytes: count(seen.size_bytes),
      processor_gpu_percent: count(seen.processor_gpu_percent), checked_at: text(seen.checked_at, 40)
    } : null,
    gpus: (Array.isArray(node.inventory.gpus) ? node.inventory.gpus : []).slice(0, 8).map((gpu) => ({
      vendor: text(gpu?.vendor, 80), model: text(gpu?.model, 160), form: text(gpu?.form, 40),
      memory: text(gpu?.memory, 40), compute: text(gpu?.compute, 120)
    }))
  };
}

// The model the node says answered, taken from the committed output (which
// output_sha256 and the node attestation's result_sha256 cover): name, the
// engine's digest for it and the engine version. Null when the output names no
// model; a field the node did not report is null, never guessed.
function executedModel(output) {
  if (!isObject(output) || output.model == null) return null;
  const usage = isObject(output.usage) ? output.usage : {};
  return {
    name: text(output.model, 200),
    digest: text(usage.model_digest, 200),
    runtime_version: text(usage.ollama_version, 80),
    reported_by: 'node-result'
  };
}

// What the node's capability manifest said about the implementation that ran:
// the backend, the model and, when the enrolment published them, the model
// digest and engine version (features.model_digest / features.runtime_version).
function advertisedImplementation(node, implementation) {
  if (!implementation) return null;
  const entry = (Array.isArray(node?.capabilities) ? node.capabilities : []).find((item) => item?.implementation === implementation);
  if (!entry) return null;
  const features = isObject(entry.features) ? entry.features : {};
  return {
    backend: text(entry.backend, 120), model: text(entry.model, 200),
    model_digest: text(features.model_digest, 200), runtime_version: text(features.runtime_version, 80)
  };
}

// ---- Device facts, bound at completion --------------------------------------
// The device, its compute mode with the engine evidence, what it advertised
// for the implementation and the model in the committed result, exactly as the
// node row and the result stood when the gateway accepted the completion. They
// are stored once with the completion attestation (first write wins) and every
// receipt is built from that stored snapshot, so a later change of the node's
// inventory cannot change what a receipt says about a job that already ran.
// All of it is NODE-REPORTED: the node's own heartbeat inventory and its own
// result, never a third party's inspection of the hardware.
export function deviceFactsAtCompletion({ node, implementation = null, result = null, capturedAt = new Date().toISOString() } = {}) {
  return {
    schema: DEVICE_FACTS_SCHEMA,
    source: DEVICE_FACTS_SOURCE,
    captured_at: text(capturedAt, 40),
    node_display_name: text(node?.display_name, 200),
    platform: text(node?.inventory?.platform, 40),
    arch: text(node?.inventory?.arch, 40),
    hardware_mode: text(node?.inventory?.runtime?.hardware_mode, 40),
    hardware_evidence: hardwareEvidence(node),
    advertised: advertisedImplementation(node, implementation),
    model: executedModel(result)
  };
}

function boundDeviceFacts(attestation) {
  const facts = attestation?.device_facts;
  return isObject(facts) && facts.schema === DEVICE_FACTS_SCHEMA && Boolean(facts.captured_at) ? facts : null;
}

export function buildReceipt({ task, leases = [], node = null, attestation = null, nodePublicKeyPem = null, issuedAt = new Date().toISOString(), issuer = {} }) {
  if (!task) throw httpError('compute job not found', 404, 'JOB_NOT_FOUND');
  if (!TERMINAL_STATES.has(task.status)) {
    throw httpError(`compute job is ${task.status}; a receipt exists once it is done, failed or canceled`, 409, 'JOB_NOT_TERMINAL', { job_status: task.status });
  }
  const lease = completingLease(task, leases);
  const done = task.status === 'done';
  const resultConsistent = done && lease ? canonicalJson(lease.result ?? null) === canonicalJson(task.output ?? null) : null;
  const attestationView = attestation ? (() => {
    const verification = verifyAttestation(attestation, nodePublicKeyPem || node?.public_key_pem || null);
    return {
      schema: attestation.schema || ATTESTATION_SCHEMA,
      lease_id: attestation.lease_id, node_id: attestation.node_id, attempt: attestation.attempt ?? null,
      protocol: attestation.protocol, method: attestation.method, path: attestation.path,
      signed_at: attestation.signed_at, nonce: attestation.nonce, body_digest: attestation.body_digest,
      signature: attestation.signature, result_sha256: attestation.result_sha256,
      matches_output: done ? attestation.result_sha256 === hashJson(task.output) : null,
      verified: verification.ok,
      verification_note: verification.reason
    };
  })() : null;
  // The device facts come only from the snapshot bound when the completion was
  // accepted, never from the node row as it reads today. Without a snapshot
  // (a failed or canceled job, a completion recorded before the snapshot
  // existed, or an attestation store that is not promoted) they are null and
  // the receipt says it is unbound, instead of signing whatever the node
  // reports at read time.
  const facts = lease && attestation?.lease_id === lease.id ? boundDeviceFacts(attestation) : null;
  return {
    schema: RECEIPT_SCHEMA,
    // A receipt built from a bound snapshot is dated by the binding, so every
    // read of it returns the same signed bytes; otherwise it is dated by the read.
    issued_at: facts ? facts.captured_at : issuedAt,
    issuer: { kind: 'mccluster-core', instance: issuer.instance ?? null, deployment_sha: issuer.deployment_sha ?? null },
    job: {
      id: task.id, org_id: task.org_id, capability: task.capability,
      implementation: lease?.implementation ?? task.implementation ?? null,
      status: task.status, attempts: Number(task.attempts || 0), max_attempts: Number(task.max_attempts || 0),
      created_at: task.created_at ?? null, completed_at: lease?.completed_at ?? task.updated_at ?? null,
      client: isObject(task.metadata?.client) ? task.metadata.client : null,
      source: task.metadata?.source ?? null
    },
    input_sha256: hashJson(task.input ?? {}),
    output_sha256: done ? hashJson(task.output) : null,
    failure: done ? null : { last_error: task.last_error ?? null, attempts: Number(task.attempts || 0) },
    execution: lease ? {
      lease_id: lease.id, attempt: lease.attempt ?? null, status: lease.status,
      node_id: lease.node_id, node_key_fingerprint: node?.key_fingerprint ?? null,
      node_display_name: facts ? facts.node_display_name ?? null : node?.display_name ?? null,
      device_facts: { bound: Boolean(facts), source: facts ? facts.source ?? DEVICE_FACTS_SOURCE : null, captured_at: facts ? facts.captured_at : null },
      hardware_mode: facts?.hardware_mode ?? null,
      platform: facts?.platform ?? null,
      arch: facts?.arch ?? null,
      hardware_evidence: facts?.hardware_evidence ?? null,
      advertised: facts?.advertised ?? null,
      // The committed output is itself immutable and inside output_sha256, so
      // the model is read from it; the snapshot holds the same three fields.
      model: done ? executedModel(task.output) : null,
      started_at: lease.started_at ?? null, completed_at: lease.completed_at ?? null,
      duration_ms: durationMs(lease),
      result_consistent: resultConsistent
    } : null,
    node_public_key_pem: nodePublicKeyPem || node?.public_key_pem || null,
    // One lease is one device. A shared-inference claim needs a group receipt
    // with attestations from at least two distinct enrolled nodes; none exists
    // here, so the honest report is single-device.
    inference: { mode: 'single-device', devices: lease ? [lease.node_id] : [], group: null },
    node_attestation: attestationView,
    signature: null
  };
}

export function signReceipt(receipt, key) {
  if (!key?.privateKeyPem) return { ...receipt, signature: null, signed: false };
  const unsigned = { ...receipt, signature: null };
  const payload = canonicalJson(unsigned);
  const value = crypto.sign(null, Buffer.from(payload, 'utf8'), key.privateKeyPem).toString('base64url');
  return { ...unsigned, signed: true, signature: { alg: 'ed25519', key_id: key.keyId ?? receiptKeyId(key.publicKeyPem), value, covers: 'canonical JSON of this receipt with signature set to null and without the signed flag' } };
}

export function verifyReceipt(receipt, publicKeyPem) {
  if (!isObject(receipt) || receipt.schema !== RECEIPT_SCHEMA) return { ok: false, reason: 'not a mccluster-job-receipt/1' };
  if (!isObject(receipt.signature) || !receipt.signature.value) return { ok: false, reason: 'receipt is unsigned' };
  if (!publicKeyPem) return { ok: false, reason: 'Core receipt public key unavailable' };
  if (receipt.signed !== true) return { ok: false, reason: 'receipt does not claim to be signed' };
  if (receipt.signature.alg !== 'ed25519') return { ok: false, reason: `unsupported receipt signature alg ${String(receipt.signature.alg)}` };
  if (!receipt.signature.key_id) return { ok: false, reason: 'receipt signature names no key' };
  try {
    if (receipt.signature.key_id !== receiptKeyId(publicKeyPem)) return { ok: false, reason: 'receipt was signed by a different Core key' };
    const { signature, signed, ...rest } = receipt;
    const payload = canonicalJson({ ...rest, signature: null });
    const ok = crypto.verify(null, Buffer.from(payload, 'utf8'), publicKeyPem, Buffer.from(String(signature.value), 'base64url'));
    return ok ? { ok: true, reason: null } : { ok: false, reason: 'Core signature does not verify' };
  } catch (error) {
    return { ok: false, reason: `receipt unverifiable: ${error.message}` };
  }
}
