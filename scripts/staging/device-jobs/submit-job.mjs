#!/usr/bin/env node
// Submit one mccluster-job/1 ai.chat job pinned to an implementation, wait for
// it, read the result and the receipt, and verify the receipt offline with the
// repository's own verifier: the Core signature against the published receipt
// key AND the node's completion attestation against the node's enrolled key.
// Writes job.json, result.json, receipt.json and verify.json to --out and
// exits 0 only when every check is true.
//
//   node scripts/staging/device-jobs/submit-job.mjs --run-dir <run dir> \
//     --implementation qwen3-vl.4b.local --out <dir> [--prompt "..."] [--num-predict 512]
//
// --expect-refusal turns it into the routing fence check: a job pinned to an
// implementation no enrolled device advertises must be refused with a named
// code, and a queued job pinned to an implementation nobody advertises must
// stay unclaimed for --bound-ms while live devices keep polling. It writes
// refusal.json and exits 0 only when both hold.
//
// From another device, through the Access-protected staging hostname
// (docs/control-plane/DEVICE-STAGING-ACCESS.md): --compute-url https://<staging-hostname>
// --trust system --org <org id> --admin-token-file <file>. Trust is exactly one
// of --trust system or --ca <file>. The Access service token is read only from
// MCCLUSTER_ACCESS_CLIENT_ID / MCCLUSTER_ACCESS_CLIENT_SECRET. --preflight
// checks the path and exits. The production hosts are refused.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REFUSAL_SCHEMA, RUN_FILES, connectStaging, requestJson, validateSubmitOptions, verifyJobEvidence } from './real-device-lib.mjs';
import { ACCESS_ENV, preflightExitCode, preflightStaging, redactSecrets } from './staging-access.mjs';

let options;
try { options = validateSubmitOptions(process.argv.slice(2)); }
catch (error) { console.error(JSON.stringify({ event: 'submit_usage_error', error: error.message })); process.exit(2); }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Every credential this process holds; nothing it prints or writes may contain one.
let secrets = [process.env.MCCLUSTER_STAGING_ADMIN_TOKEN, process.env[ACCESS_ENV.id], process.env[ACCESS_ENV.secret]].filter(Boolean).map((value) => String(value).trim());
const write = (name, value) => fs.writeFileSync(path.join(options.out, name), JSON.stringify(redactSecrets(value, secrets), null, 2));
const say = (stream, record) => stream(JSON.stringify(redactSecrets(record, secrets)));

async function main() {
  const staging = connectStaging(options.staging, { tokenEnv: 'MCCLUSTER_STAGING_ADMIN_TOKEN', needToken: !options.preflight });
  secrets = [...new Set([...secrets, ...staging.secrets])];
  if (options.preflight) {
    const report = await preflightStaging({ computeUrl: staging.computeUrl, trust: staging.trust, ca: staging.ca, access: staging.access, request: requestJson });
    say(console.log, { event: 'staging_preflight', ...report });
    return preflightExitCode(report);
  }
  fs.mkdirSync(options.out, { recursive: true });
  // staging.request adds the Access headers (when set), verifies TLS under the
  // chosen trust and names an Access block instead of returning its login page.
  const admin = (pathname, init = {}) => staging.request(pathname, { ...init, headers: { authorization: `Bearer ${staging.token}`, ...(init.headers || {}) } });
  const org = encodeURIComponent(staging.org);
  const liveFor = async (implementation) => {
    const caps = await admin(`/v1/compute/capabilities?org_id=${org}`);
    if (caps.status !== 200) throw new Error(`capabilities read failed: HTTP ${caps.status} ${caps.body?.code || ''}`);
    return caps.body.implementations.filter((item) => item.capability === 'ai.chat' && (!implementation || item.implementation === implementation));
  };
  const body = (implementation, extra = {}) => ({
    capability: 'ai.chat', implementation, input: { prompt: options.prompt, num_predict: options.numPredict },
    client: { name: options.clientName, version: '1' }, ...extra
  });

  if (options.expectRefusal) return refusal({ admin, org, liveFor, body, staging });

  const key = await admin('/v1/compute/receipt-key');
  if (key.status !== 200 || key.body?.configured !== true) throw new Error(`the gateway publishes no receipt key (HTTP ${key.status})`);
  let pinnedReceiptKeyPem = null;
  if (options.staging.runDir) { try { pinnedReceiptKeyPem = fs.readFileSync(path.join(options.staging.runDir, RUN_FILES.receipt_public_key), 'utf8'); } catch { /* not on this machine */ } }

  const submitted = body(options.implementation);
  const idempotencyKey = options.idempotencyKey || `device-job-${crypto.randomUUID()}`;
  const submittedAt = Date.now();
  const first = await admin('/v1/compute/jobs', { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: submitted });
  if (![200, 202].includes(first.status)) {
    write('job.json', { submitted, idempotency_key: idempotencyKey, accepted: false, http_status: first.status, response: first.body });
    throw Object.assign(new Error(`submission refused: HTTP ${first.status} ${first.body?.code || ''} ${first.body?.error || ''}`.trim()), { code: first.body?.code || 'SUBMIT_REFUSED' });
  }
  const jobId = first.body.job.job_id;

  const transitions = [{ status: first.body.job.status, at_ms: 0 }];
  let job = first.body.job;
  const deadline = submittedAt + options.timeoutMs;
  while (!job.terminal) {
    if (Date.now() > deadline) {
      write('job.json', { submitted, idempotency_key: idempotencyKey, accepted: true, job, transitions, timed_out: true });
      throw Object.assign(new Error(`job ${jobId} is still ${job.status} after ${options.timeoutMs} ms`), { code: 'JOB_TIMEOUT' });
    }
    await sleep(1_000);
    const read = await admin(`/v1/compute/jobs/${jobId}?org_id=${org}`);
    if (read.status !== 200) throw new Error(`status read failed: HTTP ${read.status} ${read.body?.code || ''}`);
    job = read.body;
    if (job.status !== transitions.at(-1).status) transitions.push({ status: job.status, at_ms: Date.now() - submittedAt });
  }
  const wallMs = Date.now() - submittedAt;

  const result = job.status === 'done' ? (await admin(`/v1/compute/jobs/${jobId}/result?org_id=${org}`)).body : null;
  const receipt = (await admin(`/v1/compute/jobs/${jobId}/receipt?org_id=${org}`)).body;
  const nodes = await admin(`/v1/compute/nodes?org_id=${org}`);
  const enrolledNode = (nodes.body?.nodes || []).find((node) => node.id === receipt?.execution?.node_id) || null;
  const again = await admin('/v1/compute/jobs', { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: submitted });
  const replay = { status: again.status, replayed: again.body?.replayed ?? null, job_id: again.body?.job?.job_id ?? null };

  const verify = {
    ...verifyJobEvidence({ submitted, job, result, receipt, receiptKey: key.body, pinnedReceiptKeyPem, enrolledNode, replay, expectHardwareMode: options.expectHardwareMode }),
    verified_at: new Date().toISOString(),
    client: { submit_to_terminal_ms: wallMs, transitions, live_nodes_at_submit: first.body.live_nodes ?? null, idempotency_replay: replay },
    enrolled_node: enrolledNode ? { id: enrolledNode.id, display_name: enrolledNode.display_name, state: enrolledNode.state, key_fingerprint: enrolledNode.key_fingerprint, role: enrolledNode.labels?.role ?? null, enrolled_trust: enrolledNode.labels?.enrolled_trust ?? null, measured_inference: enrolledNode.inventory?.runtime?.measured_inference ?? null } : null
  };
  write('job.json', { submitted, idempotency_key: idempotencyKey, accepted: true, job, transitions, submit_to_terminal_ms: wallMs });
  write('result.json', result);
  write('receipt.json', receipt);
  write('verify.json', verify);
  say(console.log, ({
    event: 'job_verified', ok: verify.ok, hardware_proof: verify.hardware_proof, fixture: verify.fixture, job_id: jobId, status: job.status,
    node_id: verify.device.node_id, hardware_mode: verify.device.hardware_mode, model: verify.model.name, model_digest: verify.model.digest,
    lease_duration_ms: verify.execution.lease_duration_ms, submit_to_terminal_ms: wallMs,
    failed_checks: Object.entries(verify.checks).filter(([, value]) => value !== true).map(([name]) => name), out: options.out
  }));
  return verify.ok ? 0 : 1;
}

async function refusal({ admin, org, liveFor, body, staging }) {
  const implementation = options.implementation;
  const startedAt = Date.now();
  const advertisedBefore = await liveFor(implementation);
  // Exact lookups, never a count of a capped page: the job a submission with
  // this Idempotency-Key created (the key is unique per org), or none.
  const jobsForKey = async (key) => {
    const found = await admin(`/v1/compute/jobs?org_id=${org}&idempotency_key=${encodeURIComponent(key)}`);
    return found.status === 200 && Array.isArray(found.body?.jobs) ? found.body.jobs : null;
  };
  const cancel = async (jobId, reason) => {
    const reply = await admin(`/v1/compute/jobs/${jobId}/cancel`, { method: 'POST', body: { org_id: staging.org, reason } });
    return { http_status: reply.status, status: reply.body?.status ?? null, code: reply.body?.code ?? null };
  };

  // 1. The door: nothing live advertises the pinned implementation, so the submit is refused by name.
  const refusalKey = `refusal-${crypto.randomUUID()}`;
  const refused = await admin('/v1/compute/jobs', { method: 'POST', headers: { 'idempotency-key': refusalKey }, body: body(implementation) });
  const refusedMs = Date.now() - startedAt;
  const createdByRefusedSubmit = await jobsForKey(refusalKey);
  let strayJob = null;
  let strayCancel = null;
  if ([200, 202].includes(refused.status)) {
    // It was accepted: some live device advertises it. Watch it so the report
    // says where it went, and do not leave it queued behind this check.
    const deadline = Date.now() + options.boundMs;
    strayJob = refused.body.job;
    while (Date.now() < deadline && !strayJob.terminal) { await sleep(1_000); strayJob = (await admin(`/v1/compute/jobs/${strayJob.job_id}?org_id=${org}`)).body; }
    if (!strayJob.terminal) strayCancel = await cancel(strayJob.job_id, 'submit-job --expect-refusal: the submit was accepted, not refused');
  }

  // 2. The claim: a job queued past the door, pinned to an implementation
  // nobody advertises, must stay unclaimed while the live devices keep polling.
  // The probe id is derived so that no real device will ever take it later.
  const probeImplementation = `${implementation}.unclaimed-probe`;
  const candidates = await liveFor();
  const controlImplementation = candidates.find((item) => item.implementation !== probeImplementation)?.implementation;
  const probeKey = `unclaimed-${crypto.randomUUID()}`;
  const queued = await admin('/v1/compute/jobs', { method: 'POST', headers: { 'idempotency-key': probeKey }, body: body(probeImplementation, { allow_offline: true, max_attempts: 1 }) });
  let probe = queued.body?.job || null;
  const probeId = probe?.job_id;
  let probeCancel = null;
  let control = null;
  let controlCancel = null;
  let witnessed = null;
  const observations = [];
  if (queued.status === 202 && probeId) {
    const deadline = Date.now() + options.boundMs;
    try {
      // A stale online row cannot claim this new job. A lease on this supported
      // implementation proves a device polled while the unsupported probe was queued.
      if (controlImplementation) {
        const reply = await admin('/v1/compute/jobs', {
          method: 'POST', headers: { 'idempotency-key': `poll-control-${crypto.randomUUID()}` },
          body: body(controlImplementation, { input: { prompt: 'Reply OK.', num_predict: 16 }, max_attempts: 1 })
        });
        if (reply.status === 202) control = reply.body?.job;
      }
      while (Date.now() < deadline) {
        const [observedProbe, observedControl] = await Promise.all([
          admin(`/v1/compute/jobs/${probeId}?org_id=${org}`),
          control && !witnessed ? admin(`/v1/compute/jobs/${control.job_id}?org_id=${org}`) : null
        ]);
        if (observedProbe.status !== 200) throw new Error(`unclaimed probe read failed: HTTP ${observedProbe.status}`);
        probe = observedProbe.body;
        if (observedControl?.status === 200) control = observedControl.body;
        const now = Date.now();
        if (now > deadline) break;
        observations.push({ at_ms: now - startedAt, status: probe.status, attempts: probe.attempts, locked_by_node_id: probe.locked_by_node_id, has_execution: Boolean(probe.execution) });
        if (!witnessed && control?.attempts > 0 && control.execution?.node_id && control.implementation === controlImplementation) {
          witnessed = { node_id: control.execution.node_id, lease_id: control.execution.lease_id, at_ms: now - startedAt };
        }
        await sleep(Math.min(500, deadline - now));
      }
    } finally {
      // Both jobs belong to this run. A started control may finish its bounded
      // response; remove any queued control before disconnecting.
      try {
        if (control && !control.terminal && !witnessed) controlCancel = await cancel(control.job_id, 'submit-job --expect-refusal: polling control finished');
      } finally {
        probeCancel = await cancel(probeId, 'submit-job --expect-refusal: unclaimed probe finished');
      }
    }
  }
  const probeAfter = (await jobsForKey(probeKey)) || [];
  const advertisedAfter = await liveFor(implementation);

  const checks = {
    nothing_live_advertises_the_implementation: advertisedBefore.length === 0 && advertisedAfter.length === 0,
    submit_refused_with_named_code: refused.status === 503 && refused.body?.code === 'COMPUTE_NO_LIVE_NODE',
    refused_within_bound: refusedMs <= options.boundMs,
    no_job_row_created_by_the_refused_submit: Array.isArray(createdByRefusedSubmit) && createdByRefusedSubmit.length === 0,
    queued_probe_accepted_only_as_offline: queued.status === 202 && queued.body?.live_nodes === 0,
    queued_probe_never_claimed: observations.length > 0 && observations.every((seen) => seen.status === 'queued' && seen.attempts === 0 && !seen.locked_by_node_id && !seen.has_execution),
    live_devices_were_polling_during_the_probe: Boolean(witnessed),
    queued_probe_canceled_afterwards: probeCancel?.http_status === 200 && probeCancel.status === 'canceled' && probeAfter.length === 1 && probeAfter[0].job_id === probe?.job_id && probeAfter[0].status === 'canceled' && probeAfter[0].attempts === 0
  };
  const report = {
    schema: REFUSAL_SCHEMA,
    ok: Object.values(checks).every((value) => value === true),
    checks,
    implementation,
    refusal: { http_status: refused.status, code: refused.body?.code ?? null, reason: refused.body?.error ?? null, retryable: refused.body?.retryable ?? null, elapsed_ms: refusedMs },
    refused_submit_lookup: { by: 'idempotency_key', jobs_found: Array.isArray(createdByRefusedSubmit) ? createdByRefusedSubmit.length : null },
    stray_job: strayJob ? { job_id: strayJob.job_id, status: strayJob.status, node_id: strayJob.execution?.node_id ?? null, cancel: strayCancel } : null,
    unclaimed_probe: {
      implementation: probeImplementation, reason: 'NO_NODE_ADVERTISES_IMPLEMENTATION', job_id: probe?.job_id ?? null, bound_ms: options.boundMs,
      final_status: probe?.status ?? null, attempts: probe?.attempts ?? null, observations: observations.length,
      cancel: probeCancel, status_after_cancel: probeAfter[0]?.status ?? null,
      note: 'final_status is the last observation inside the bound; the probe is then canceled and read back by its Idempotency-Key'
    },
    polling_control: { implementation: controlImplementation ?? null, job_id: control?.job_id ?? null, observed_claim: witnessed, cancel: controlCancel },
    live_devices_during_probe: witnessed ? [{ id: witnessed.node_id, implementations: [controlImplementation] }] : [],
    checked_at: new Date().toISOString()
  };
  write('refusal.json', report);
  say(console.log, { event: 'refusal_checked', ok: report.ok, implementation, http_status: refused.status, code: report.refusal.code, elapsed_ms: refusedMs, probe_final_status: report.unclaimed_probe.final_status, failed_checks: Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name), out: options.out });
  return report.ok ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((error) => {
  say(console.error, { event: 'submit_failed', error: error.message, code: error.code || null });
  process.exit(error.code === 'ACCESS_BLOCKED' ? 3 : 1);
});
