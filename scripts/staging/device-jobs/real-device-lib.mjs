// Shared, side-effect-free pieces of the real-device staging mode
// (serve.mjs, enroll-device.mjs, submit-job.mjs). Importing this file starts
// nothing: argument validation, the device manifest, a small HTTP(S) client
// that trusts one CA file, and the offline evidence check that turns a job,
// its result and its receipt into verify.json.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { DEVICE_FACTS_SOURCE, hashJson, verifyAttestation, verifyReceipt, RECEIPT_SCHEMA } from '../../../core/src/compute/jobs.mjs';
import { keyFingerprint, nodeIdFromPublicKey } from '../../../core/src/compute/signature.mjs';
import { accessBlockedError, accessFromEnv, assertNotProduction, classifyAccessBlock, redactSecrets, resolveTrust, tlsOptionsFor } from './staging-access.mjs';

export const STAGING_SCHEMA = 'mccluster-device-jobs-staging/1';
export const VERIFY_SCHEMA = 'mccluster-device-job-verify/1';
export const REFUSAL_SCHEMA = 'mccluster-device-job-refusal/1';
export const DEFAULT_ORG = '00000000-0000-4000-8000-00000000c0de';
export const DEFAULT_PORT_BASE = 47800;
// How far outside the lease window (started_at..completed_at) the node's engine
// reading may have been taken and still count for that job. The agent probes its
// engine every few seconds and publishes the reading on its next heartbeat, so
// the reading held at completion is normally seconds old; a minute is the bound.
export const ENGINE_READING_BOUND_MS = 60_000;
// Names only. The values live in the run directory and in process environment.
export const RUN_FILES = Object.freeze({
  staging: 'staging.json', admin_token: 'admin.token', enroll_token: 'enroll.token',
  receipt_signing_key: 'receipt-signing-key.pem', receipt_public_key: 'receipt-key.public.pem',
  tls_key: 'tls-key.pem', ca_cert: 'ca-cert.pem', gateway_log: 'gateway.log', serve_log: 'serve.log', stop: 'stop'
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMPLEMENTATION_ID = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9._-]+)?$/;
const TLS_SAN = /^(?:DNS:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252}[A-Za-z0-9])?|IP:[0-9A-Fa-f:.]{2,45})$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export function usageError(message) {
  return Object.assign(new Error(message), { code: 'USAGE' });
}

// --flag value, --flag=value and bare --flag for booleans. Unknown flags and
// missing values are errors, never silently ignored.
export function parseFlags(argv, spec) {
  const out = {};
  for (const [name, def] of Object.entries(spec)) if (def.default !== undefined) out[name] = def.default;
  for (let i = 0; i < argv.length; i += 1) {
    const raw = String(argv[i]);
    if (!raw.startsWith('--')) throw usageError(`unexpected argument "${raw}"`);
    const eq = raw.indexOf('=');
    const flag = eq < 0 ? raw.slice(2) : raw.slice(2, eq);
    const name = flag.replace(/-/g, '_');
    const def = spec[name];
    if (!def) throw usageError(`unknown flag --${flag}`);
    if (def.type === 'boolean') {
      if (eq >= 0) throw usageError(`--${flag} takes no value`);
      out[name] = true;
      continue;
    }
    const value = eq >= 0 ? raw.slice(eq + 1) : argv[i += 1];
    if (value === undefined || (eq < 0 && String(value).startsWith('--'))) throw usageError(`--${flag} needs a value`);
    if (def.type === 'int') {
      if (!/^\d{1,9}$/.test(String(value))) throw usageError(`--${flag} must be a whole number`);
      out[name] = Number(value);
    } else out[name] = String(value);
  }
  return out;
}

function requireText(value, flag) {
  if (typeof value !== 'string' || !value.trim()) throw usageError(`--${flag} is required`);
  return value;
}

function loopbackUrl(value, flag) {
  let url;
  try { url = new URL(value); } catch { throw usageError(`--${flag} must be a URL`); }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) throw usageError(`--${flag} must be an http:// loopback URL`);
  return url.toString().replace(/\/$/, '');
}

function httpsUrl(value, flag) {
  let url;
  try { url = new URL(value); } catch { throw usageError(`--${flag} must be a URL`); }
  if (url.protocol !== 'https:') throw usageError(`--${flag} must be an https:// URL`);
  if (url.username || url.password) throw usageError(`--${flag} must not carry credentials`);
  // Staging only: the production compute and Core hosts are refused outright.
  assertNotProduction(url, flag);
  return url.origin;
}

export const SERVE_FLAGS = { run_dir: { type: 'string' }, port_base: { type: 'int', default: DEFAULT_PORT_BASE }, org: { type: 'string', default: DEFAULT_ORG }, tls_san: { type: 'string' }, lease_seconds: { type: 'int', default: 120 }, no_stdin: { type: 'boolean' } };
export function validateServeOptions(argv) {
  const flags = parseFlags(argv, SERVE_FLAGS);
  const runDir = path.resolve(requireText(flags.run_dir, 'run-dir'));
  if (flags.port_base < 1024 || flags.port_base > 65000) throw usageError('--port-base must be between 1024 and 65000');
  if (!UUID.test(flags.org)) throw usageError('--org must be a UUID');
  if (flags.lease_seconds < 30 || flags.lease_seconds > 900) throw usageError('--lease-seconds must be between 30 and 900');
  const sans = String(flags.tls_san || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const san of sans) if (!TLS_SAN.test(san)) throw usageError(`--tls-san entry "${san}" must be DNS:<name> or IP:<address>`);
  return {
    runDir, org: flags.org.toLowerCase(), leaseSeconds: flags.lease_seconds, watchStdin: flags.no_stdin !== true,
    ports: { gateway: flags.port_base, tls: flags.port_base + 1, shim: flags.port_base + 2 },
    // The listener is loopback only whatever names the certificate carries.
    tlsSans: ['IP:127.0.0.1', ...sans.filter((san) => san !== 'IP:127.0.0.1')]
  };
}

// Where the staging lives, either from a run directory on this machine or from
// explicit flags on another device. Never both halves of each.
// Trust is exactly one of two things, never neither: the platform trust store
// (--trust system, for a public-CA hostname such as an Access-protected one) or
// one pinned CA file (--ca; in the loopback mode the run directory's own CA is
// the pin when neither flag is given). No flag turns verification off.
function resolveStaging(flags, { tokenFile, tokenFlag, preflight = false }) {
  if (flags.run_dir) {
    const runDir = path.resolve(flags.run_dir);
    const trust = resolveTrust({ trust: flags.trust, ca: flags.ca, haveDefaultCa: true });
    return { runDir, computeUrl: flags.compute_url ? httpsUrl(flags.compute_url, 'compute-url') : null, org: flags.org || null, trust, ca: trust === 'system' ? null : flags.ca ? path.resolve(flags.ca) : path.join(runDir, RUN_FILES.ca_cert), tokenFile: flags[tokenFlag] ? path.resolve(flags[tokenFlag]) : path.join(runDir, tokenFile) };
  }
  const computeUrl = httpsUrl(requireText(flags.compute_url, 'compute-url (or --run-dir)'), 'compute-url');
  // The preflight reads /health only: it needs neither the org nor a token.
  if (!preflight && !UUID.test(String(flags.org || ''))) throw usageError('--org must be a UUID (or pass --run-dir)');
  if (flags.org !== undefined && !UUID.test(String(flags.org))) throw usageError('--org must be a UUID (or pass --run-dir)');
  if (flags.trust === undefined && !flags.ca) throw usageError('--ca <file> or --trust system is required (or pass --run-dir): exactly one of them');
  const trust = resolveTrust({ trust: flags.trust, ca: flags.ca });
  return { runDir: null, computeUrl, org: flags.org ? flags.org.toLowerCase() : null, trust, ca: trust === 'system' ? null : path.resolve(flags.ca), tokenFile: flags[tokenFlag] ? path.resolve(flags[tokenFlag]) : null };
}

export const ENROLL_FLAGS = {
  implementation: { type: 'string' }, model: { type: 'string' }, state_dir: { type: 'string' }, name: { type: 'string' },
  run_dir: { type: 'string' }, compute_url: { type: 'string' }, org: { type: 'string' }, ca: { type: 'string' }, trust: { type: 'string' }, preflight: { type: 'boolean' }, enroll_token_file: { type: 'string' },
  ollama_url: { type: 'string', default: 'http://127.0.0.1:11434' }, adapter_port: { type: 'int', default: 0 }, context: { type: 'int' },
  executor_url: { type: 'string' }, site: { type: 'string', default: 'staging-real-device' }, no_stdin: { type: 'boolean' }
};
export function validateEnrollOptions(argv) {
  const flags = parseFlags(argv, ENROLL_FLAGS);
  // --preflight checks the path to the staging and exits: no device flags, no token.
  if (flags.preflight === true) return { preflight: true, staging: resolveStaging(flags, { tokenFile: RUN_FILES.enroll_token, tokenFlag: 'enroll_token_file', preflight: true }) };
  const implementation = requireText(flags.implementation, 'implementation');
  if (!IMPLEMENTATION_ID.test(implementation)) throw usageError('--implementation is not a valid implementation id');
  const model = requireText(flags.model, 'model');
  if (!MODEL_NAME.test(model)) throw usageError('--model is not a valid model name');
  const stateDir = path.resolve(requireText(flags.state_dir, 'state-dir'));
  if (flags.name !== undefined && !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(flags.name)) throw usageError('--name must be 1 to 80 letters, digits, spaces, dots, dashes or underscores');
  if (flags.adapter_port !== 0 && (flags.adapter_port < 1024 || flags.adapter_port > 65535)) throw usageError('--adapter-port must be 0 (any free port) or between 1024 and 65535');
  if (flags.context !== undefined && (flags.context < 2048 || flags.context > 32768)) throw usageError('--context must be between 2048 and 32768');
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(flags.site)) throw usageError('--site must be a short lowercase label');
  return {
    implementation, model, stateDir, name: flags.name || null, site: flags.site, adapterPort: flags.adapter_port, context: flags.context ?? null,
    ollamaUrl: loopbackUrl(flags.ollama_url, 'ollama-url'),
    // A stand-in executor is for tests only and is labelled as a fixture everywhere it shows.
    executorUrl: flags.executor_url ? loopbackUrl(flags.executor_url, 'executor-url') : null,
    watchStdin: flags.no_stdin !== true, preflight: false,
    staging: resolveStaging(flags, { tokenFile: RUN_FILES.enroll_token, tokenFlag: 'enroll_token_file' })
  };
}

export const SUBMIT_FLAGS = {
  implementation: { type: 'string' }, out: { type: 'string' }, prompt: { type: 'string', default: 'Reply with one short sentence about what a signed receipt proves.' },
  num_predict: { type: 'int', default: 512 }, idempotency_key: { type: 'string' }, timeout_ms: { type: 'int', default: 600_000 },
  run_dir: { type: 'string' }, compute_url: { type: 'string' }, org: { type: 'string' }, ca: { type: 'string' }, trust: { type: 'string' }, preflight: { type: 'boolean' }, admin_token_file: { type: 'string' },
  expect_refusal: { type: 'boolean' }, bound_ms: { type: 'int', default: 15_000 }, expect_hardware_mode: { type: 'string' }, client_name: { type: 'string', default: 'submit-job-cli' }
};
export function validateSubmitOptions(argv) {
  const flags = parseFlags(argv, SUBMIT_FLAGS);
  if (flags.preflight === true) return { preflight: true, staging: resolveStaging(flags, { tokenFile: RUN_FILES.admin_token, tokenFlag: 'admin_token_file', preflight: true }) };
  const implementation = requireText(flags.implementation, 'implementation');
  if (!IMPLEMENTATION_ID.test(implementation)) throw usageError('--implementation is not a valid implementation id');
  const out = path.resolve(requireText(flags.out, 'out'));
  if (!flags.prompt.trim() || flags.prompt.length > 8000) throw usageError('--prompt must be 1 to 8000 characters');
  if (flags.num_predict < 16 || flags.num_predict > 4096) throw usageError('--num-predict must be between 16 and 4096');
  if (flags.idempotency_key !== undefined && !/^[\x21-\x7e]{1,128}$/.test(flags.idempotency_key)) throw usageError('--idempotency-key must be 1 to 128 printable ASCII characters without spaces');
  if (flags.timeout_ms < 1000 || flags.timeout_ms > 3_600_000) throw usageError('--timeout-ms must be between 1000 and 3600000');
  if (flags.bound_ms < 1000 || flags.bound_ms > 300_000) throw usageError('--bound-ms must be between 1000 and 300000');
  if (flags.expect_hardware_mode !== undefined && !['gpu-verified', 'gpu-present-unverified', 'cpu-only', 'unknown'].includes(flags.expect_hardware_mode)) throw usageError('--expect-hardware-mode is not a hardware mode');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(flags.client_name)) throw usageError('--client-name must be a short identifier');
  return {
    implementation, out, prompt: flags.prompt, numPredict: flags.num_predict, idempotencyKey: flags.idempotency_key || null, timeoutMs: flags.timeout_ms,
    expectRefusal: flags.expect_refusal === true, boundMs: flags.bound_ms, expectHardwareMode: flags.expect_hardware_mode || null, clientName: flags.client_name, preflight: false,
    staging: resolveStaging(flags, { tokenFile: RUN_FILES.admin_token, tokenFlag: 'admin_token_file' })
  };
}

// staging.json fills what the flags left out. It holds URLs, the org and file
// names; it never holds a secret.
export function readStagingFile(runDir) {
  const file = path.join(runDir, RUN_FILES.staging);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw Object.assign(new Error(`no readable ${RUN_FILES.staging} in the run directory (${error.code || 'invalid JSON'}); is serve.mjs running with this --run-dir?`), { code: 'STAGING_NOT_FOUND' }); }
  if (parsed?.schema !== STAGING_SCHEMA) throw Object.assign(new Error(`${RUN_FILES.staging} is not ${STAGING_SCHEMA}`), { code: 'STAGING_NOT_FOUND' });
  return parsed;
}

// The token comes from the named environment variable or from the token file
// the operator supplied, in that order; it is never a flag value and is never
// printed. `needToken: false` is the preflight, which reads /health only.
// The Cloudflare Access service token, when there is one, comes from the
// environment only (staging-access.mjs). `request` is the one way the scripts
// talk to the staging host: it adds the Access headers to every call, verifies
// TLS under the chosen trust, and turns an Access block into a named error.
export function connectStaging(staging, { tokenEnv, env = process.env, needToken = true } = {}) {
  let { computeUrl, org } = staging;
  if (staging.runDir && (!computeUrl || !org)) {
    const file = readStagingFile(staging.runDir);
    computeUrl = computeUrl || file.urls.compute;
    org = org || file.org_id;
  }
  assertNotProduction(computeUrl, 'compute-url');
  let token = needToken ? String(env[tokenEnv] || '').trim() : '';
  if (needToken && !token && staging.tokenFile) {
    try { token = fs.readFileSync(staging.tokenFile, 'utf8').trim(); }
    catch (error) { throw Object.assign(new Error(`token file is not readable (${error.code || error.message})`), { code: 'TOKEN_UNAVAILABLE' }); }
  }
  if (needToken && !token) throw Object.assign(new Error(`no token: set ${tokenEnv} or pass a token file`), { code: 'TOKEN_UNAVAILABLE' });
  const trust = staging.trust === 'system' ? 'system' : 'ca';
  let ca = null;
  if (trust === 'ca') {
    try { ca = fs.readFileSync(staging.ca); }
    catch (error) { throw Object.assign(new Error(`CA certificate is not readable (${error.code || error.message})`), { code: 'CA_UNAVAILABLE' }); }
  }
  const access = accessFromEnv(env);
  const secrets = [...access.secrets, ...(token ? [token] : [])];
  const request = async (pathname, init = {}) => {
    let reply;
    try { reply = await requestJson(`${computeUrl}${pathname}`, { ...init, trust, ca, headers: { ...access.headers, ...(init.headers || {}) } }); }
    catch (error) { throw Object.assign(new Error(redactSecrets(String(error.message || error), secrets)), { code: error.code || null }); }
    const block = classifyAccessBlock(reply);
    if (block.blocked) throw accessBlockedError(block, { tokenSent: access.configured });
    return reply;
  };
  return { computeUrl, org, token, trust, ca, caPath: trust === 'ca' ? staging.ca : null, access, secrets, request, redact: (value) => redactSecrets(value, secrets) };
}

// One advertised implementation, concurrency 1, behind a loopback executor.
// A real device also publishes what it enrolled with: the engine's digest for
// the model and the engine version (features.model_digest / runtime_version),
// so a later result can be held against them. A fixture publishes neither.
export function buildDeviceManifest({ implementation, model, executorBase, site = 'staging-real-device', fixture = false, modelDigest = null, runtimeVersion = null }) {
  const enrolledWith = fixture ? {} : { ...(modelDigest ? { model_digest: String(modelDigest).slice(0, 200) } : {}), ...(runtimeVersion ? { runtime_version: String(runtimeVersion).slice(0, 80) } : {}) };
  return {
    max_leases: 1,
    labels: { site, trust: 'owned', role: fixture ? 'staging-fixture' : 'staging-real-device' },
    capabilities: [{
      capability: 'ai.chat', implementation, backend: fixture ? 'fixture' : 'ollama', model, version: '1',
      features: { chat: true, self_hosted: true, ...(fixture ? { fixture: true } : {}), ...enrolledWith },
      input_schema: { type: 'object', properties: { prompt: { type: 'string' }, messages: { type: 'array' } } },
      output_schema: { type: 'object', properties: { model: { type: 'string' }, content: { type: 'string' } } },
      max_concurrency: 1, min_vram_bytes: 0,
      executor: { type: 'http', url: `${executorBase}/execute`, health_url: `${executorBase}/ready?implementation=${encodeURIComponent(implementation)}`, health_method: 'GET', health_timeout_ms: 5000, timeout_ms: 600000 }
    }]
  };
}

// JSON over http or https. An https call trusts exactly the CA bytes given, or
// with trust "system" the platform trust store; the peer is always verified.
// Redirects are never followed: the status and Location are handed back.
export function requestJson(url, { method = 'GET', headers = {}, body, ca, trust = 'ca', timeoutMs = 15_000 } = {}) {
  const target = new URL(url);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, {
      method, ...(target.protocol === 'https:' ? tlsOptionsFor({ trust, ca }) : {}),
      headers: { accept: 'application/json', ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 2000) }; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error(`request timed out after ${timeoutMs} ms`), { code: 'REQUEST_TIMEOUT' })));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// The offline check. Inputs are what a client holds after a job: what it
// submitted, the result, the receipt, the Core receipt key as published, and
// the node row as the fabric lists it (its enrolled key fingerprint). Nothing
// here talks to the network. Every check is a boolean; ok is their conjunction.
export function verifyJobEvidence({ submitted, job = null, result, receipt, receiptKey, pinnedReceiptKeyPem = null, enrolledNode = null, replay = null, expectHardwareMode = null, engineReadingBoundMs = ENGINE_READING_BOUND_MS }) {
  const checks = {};
  const notes = {};
  const execution = receipt?.execution || null;
  const attestation = receipt?.node_attestation || null;
  const nodePem = receipt?.node_public_key_pem || null;
  const output = result?.output ?? null;

  const core = verifyReceipt(receipt, receiptKey?.public_key_pem || null);
  checks.receipt_schema = receipt?.schema === RECEIPT_SCHEMA;
  checks.core_signature_verifies_against_published_key = core.ok;
  if (!core.ok) notes.core_signature = core.reason;
  checks.core_key_id_matches_published_key = Boolean(receipt?.signature?.key_id) && receipt.signature.key_id === receiptKey?.key_id;
  if (pinnedReceiptKeyPem) checks.published_key_is_the_pinned_key = verifyReceipt(receipt, pinnedReceiptKeyPem).ok;

  checks.job_done = receipt?.job?.status === 'done' && execution?.status === 'done';
  checks.implementation_is_the_pinned_one = Boolean(submitted?.implementation) && receipt?.job?.implementation === submitted.implementation && result?.implementation === submitted.implementation;
  checks.input_hash_matches_submission = Boolean(receipt?.input_sha256) && receipt.input_sha256 === hashJson(submitted?.input ?? {});
  checks.output_hash_matches_result = output != null && receipt?.output_sha256 === hashJson(output) && result?.output_sha256 === receipt.output_sha256;
  checks.result_consistent_with_lease = execution?.result_consistent === true;
  checks.result_and_receipt_name_the_same_lease = Boolean(execution?.lease_id) && result?.lease_id === execution.lease_id && result?.job_id === receipt?.job?.id;

  const node = verifyAttestation(attestation, nodePem);
  checks.node_attestation_present = Boolean(attestation);
  checks.node_signature_verifies_against_enrolled_key = node.ok;
  if (!node.ok) notes.node_signature = node.reason;
  checks.node_attestation_names_this_output = Boolean(attestation) && output != null && attestation.result_sha256 === hashJson(output);
  checks.node_attestation_binds_this_lease = Boolean(attestation) && Boolean(execution)
    && attestation.lease_id === execution.lease_id && attestation.node_id === execution.node_id
    && attestation.attempt === execution.attempt && attestation.method === 'POST'
    && attestation.path === `/v1/compute/leases/${execution.lease_id}/complete`;
  let derivedId = null;
  let derivedFingerprint = null;
  try { derivedId = nodeIdFromPublicKey(nodePem); derivedFingerprint = keyFingerprint(nodePem); } catch { /* reported by the checks below */ }
  checks.node_id_derives_from_its_public_key = Boolean(derivedId) && derivedId === execution?.node_id;
  checks.node_key_fingerprint_matches_receipt = Boolean(derivedFingerprint) && derivedFingerprint === execution?.node_key_fingerprint;
  // Independent of the receipt: the fabric's own node listing names the same key.
  checks.node_key_is_the_enrolled_key = Boolean(derivedFingerprint) && enrolledNode?.id === execution?.node_id && enrolledNode?.key_fingerprint === derivedFingerprint;
  checks.single_device_reported = receipt?.inference?.mode === 'single-device' && Array.isArray(receipt.inference.devices)
    && receipt.inference.devices.length === 1 && receipt.inference.devices[0] === execution?.node_id;
  if (replay) checks.idempotent_replay_returns_same_job = replay.status === 200 && replay.replayed === true && replay.job_id === receipt?.job?.id;
  if (expectHardwareMode) checks.hardware_mode_is_the_expected_one = execution?.hardware_mode === expectHardwareMode;

  const usage = output && typeof output.usage === 'object' && output.usage ? output.usage : {};
  const model = execution?.model || null;
  const ok = Object.values(checks).every((value) => value === true);
  const hardware = hardwareChecks({ execution, usage, enrolledNode, implementation: receipt?.job?.implementation ?? null, engineReadingBoundMs });
  // A label can only ever take proof away: an executor that says it is a
  // fixture is one. Leaving the label off earns nothing, because hardware_proof
  // rests on the positive checks below, not on the label's absence.
  const fixture = output?.fixture === true || enrolledNode?.labels?.role === 'staging-fixture' || execution?.advertised?.backend === 'fixture';
  const hardwareProof = ok && !fixture && Object.values(hardware.checks).every((value) => value === true);
  return {
    schema: VERIFY_SCHEMA,
    ok,
    checks,
    notes,
    fixture,
    // True only when every check above AND every hardware check holds: the
    // executor is the repository's Ollama adapter with the digest and engine
    // version it enrolled with, and an engine reading for the same model was
    // taken inside the lease window (or within engine_reading_bound_ms of it).
    hardware_proof: hardwareProof,
    hardware_checks: hardware.checks,
    engine_reading_bound_ms: engineReadingBoundMs,
    // What the evidence supports, said plainly. 'gpu' only for gpu-verified
    // with the model in VRAM; 'cpu' for a cpu-only device whose engine held
    // the model with no VRAM; null when the evidence proves neither
    // (gpu-present-unverified and unknown never count as GPU proof).
    compute_mode: { reported_hardware_mode: execution?.hardware_mode ?? null, proven: hardwareProof ? hardware.mode : null, gpu_proof: hardwareProof && hardware.mode === 'gpu' },
    job_id: receipt?.job?.id ?? job?.job_id ?? null,
    device: {
      node_id: execution?.node_id ?? null,
      node_key_fingerprint: execution?.node_key_fingerprint ?? null,
      node_display_name: execution?.node_display_name ?? null,
      platform: execution?.platform ?? null,
      arch: execution?.arch ?? null,
      hardware_mode: execution?.hardware_mode ?? null,
      hardware_evidence: execution?.hardware_evidence ?? null,
      advertised: execution?.advertised ?? null,
      facts: execution?.device_facts ?? null
    },
    model: {
      implementation: receipt?.job?.implementation ?? null,
      name: model?.name ?? null,
      digest: model?.digest ?? null,
      runtime_version: model?.runtime_version ?? null
    },
    execution: {
      attempts: receipt?.job?.attempts ?? null,
      attempt: execution?.attempt ?? null,
      lease_id: execution?.lease_id ?? null,
      lease_duration_ms: execution?.duration_ms ?? null,
      started_at: execution?.started_at ?? null,
      completed_at: execution?.completed_at ?? null
    },
    counters: {
      prompt_eval_count: usage.prompt_eval_count ?? null, eval_count: usage.eval_count ?? null,
      generation_tokens_per_second: usage.generation_tokens_per_second ?? null, prompt_tokens_per_second: usage.prompt_tokens_per_second ?? null,
      total_duration_ns: usage.total_duration_ns ?? null, load_duration_ns: usage.load_duration_ns ?? null,
      queue_wait_ms: output?.queue_wait_ms ?? null, done_reason: output?.done_reason ?? null, content_chars: typeof output?.content === 'string' ? output.content.length : null
    },
    receipt: { issued_at: receipt?.issued_at ?? null, key_id: receipt?.signature?.key_id ?? null, input_sha256: receipt?.input_sha256 ?? null, output_sha256: receipt?.output_sha256 ?? null, inference_mode: receipt?.inference?.mode ?? null },
    limits: 'This is node-reported evidence under the node\'s signature, not third-party attestation. The model name, digest and engine version are in the result the node signed at completion; the compute mode, the engine reading and the advertised implementation are the inventory and manifest the node itself published, as the Core recorded them when it accepted that completion. The Core signature says the enrolled node reported these facts for this job and that they have not changed since; it does not say anyone but the node inspected the hardware. A node operator who controls the device controls what it reports.'
  };
}

// The positive evidence hardware_proof needs. Everything is read from the
// receipt's execution block (bound at completion and inside the Core
// signature), the result the node signed, and, independently of the receipt,
// the fabric's own listing of the node.
function hardwareChecks({ execution, usage, enrolledNode, implementation, engineReadingBoundMs }) {
  const facts = execution?.device_facts || null;
  const model = execution?.model || null;
  const advertised = execution?.advertised || null;
  const engine = execution?.hardware_evidence?.engine || null;
  const mode = execution?.hardware_mode ?? null;
  const listed = (Array.isArray(enrolledNode?.capabilities) ? enrolledNode.capabilities : []).find((item) => item?.implementation === implementation) || null;
  const same = (a, b) => typeof a === 'string' && a.length > 0 && a === b;
  const started = Date.parse(execution?.started_at || '');
  const completed = Date.parse(execution?.completed_at || '');
  const checked = Date.parse(engine?.checked_at || '');
  const vram = engine?.size_vram_bytes;
  const checks = {
    device_facts_bound_at_completion: facts?.bound === true && facts.source === DEVICE_FACTS_SOURCE && Boolean(facts.captured_at),
    // The executor is the repository's Ollama adapter: the node advertised it
    // as such at completion and still lists it as such.
    executor_advertised_as_the_ollama_adapter: advertised?.backend === 'ollama' && listed?.backend === 'ollama',
    result_carries_model_digest_and_runtime_version: same(model?.digest, usage.model_digest) && same(model?.runtime_version, usage.ollama_version),
    result_model_is_the_advertised_model: same(model?.name, advertised?.model) && same(model?.name, listed?.model),
    result_digest_matches_the_enrolled_digest: same(model?.digest, advertised?.model_digest) && same(model?.digest, listed?.features?.model_digest),
    result_runtime_version_matches_the_enrolled_version: same(model?.runtime_version, advertised?.runtime_version) && same(model?.runtime_version, listed?.features?.runtime_version),
    engine_reading_present: Boolean(engine) && typeof engine.source === 'string' && engine.source.startsWith('ollama:') && Number.isFinite(checked) && Number.isFinite(vram),
    engine_reading_names_the_result_model: same(model?.name, engine?.model),
    engine_reading_digest_matches_the_result: same(model?.digest, engine?.digest),
    engine_reading_within_the_lease_window: Number.isFinite(checked) && Number.isFinite(started) && Number.isFinite(completed)
      && checked >= started - engineReadingBoundMs && checked <= completed + engineReadingBoundMs,
    // gpu-present-unverified and unknown prove no mode at all.
    hardware_mode_is_a_proven_mode: mode === 'gpu-verified' || mode === 'cpu-only',
    // A GPU claim needs the model in VRAM in that reading; a CPU report needs it out of VRAM.
    engine_reading_agrees_with_the_hardware_mode: Number.isFinite(vram) && ((mode === 'gpu-verified' && vram > 0) || (mode === 'cpu-only' && vram === 0))
  };
  return { checks, mode: mode === 'gpu-verified' ? 'gpu' : mode === 'cpu-only' ? 'cpu' : null };
}
