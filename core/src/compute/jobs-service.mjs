// Orchestration for the device job contract, shared by the gateway's HTTP
// routes (admin token, staging and ops) and the Core control tools (the owner's
// path through the Worker). Durable truth stays in ops_compute_tasks and
// ops_compute_leases; this layer only reads them into the contract shapes.
import { computeTaskById, enqueueComputeTask, liveCapabilityImplementations, nodeById } from './store.mjs';
import { attestationForLease, leaseById, leasesForTask, listComputeTasks, nodesById, recordAttestation } from './jobs-store.mjs';
import { buildReceipt, completingLease, completionAttestation, jobResult, jobView, latestLease, receiptKeyFromEnv, receiptKeyInfo, signReceipt, validateJobSubmission } from './jobs.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const JOB_SOURCE = 'device-jobs/1';

function httpError(message, status, code, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

export function defaultDeps(env = process.env) {
  let key;
  return {
    env,
    enqueue: enqueueComputeTask,
    taskById: computeTaskById,
    live: liveCapabilityImplementations,
    nodeById,
    leasesForTask,
    leaseById,
    listTasks: listComputeTasks,
    nodesById,
    recordAttestation,
    attestationForLease,
    // Resolved lazily so a gateway without the key still starts; a malformed key fails here, loudly, on first use.
    receiptKey: () => { if (key === undefined) key = receiptKeyFromEnv(env); return key; },
    now: () => new Date().toISOString(),
    log: (record) => console.log(JSON.stringify(record))
  };
}

function requireJobId(value) {
  if (!UUID.test(String(value || ''))) throw httpError('job_id must be a UUID', 400, 'JOB_ID_INVALID');
  return String(value).toLowerCase();
}

export async function submitJob(body, { canonicalOrg = null, idempotencyKey = null, actor = null, via = 'gateway' } = {}, deps = defaultDeps()) {
  const submission = validateJobSubmission(body, { canonicalOrg });
  const advertised = (await deps.live({ orgId: submission.org_id }))
    .filter((item) => item.capability === submission.capability && (!submission.implementation || item.implementation === submission.implementation));
  if (!advertised.length && !submission.allow_offline) {
    throw httpError(`No live compute node serves ${submission.capability}${submission.implementation ? `/${submission.implementation}` : ''}; pass allow_offline:true to queue anyway`, 503, 'COMPUTE_NO_LIVE_NODE', { retryable: true });
  }
  // Metadata is part of the idempotency request hash (compute_enqueue_task), so
  // it holds only what a legitimate retry of the same submission repeats:
  // nothing time- or fleet-dependent. The task row's created_at is the time of
  // acceptance; the live-node snapshot travels in the response, not the row.
  const metadata = {
    ...submission.metadata,
    source: JOB_SOURCE,
    via,
    client: submission.client,
    submitted_by: actor ? { kind: actor.kind || 'owner', user_id: actor.user_id || null, source: actor.source || null } : null
  };
  const liveNodes = [...new Set(advertised.map((item) => item.node_id))];
  const { task, replayed } = await deps.enqueue({
    orgId: submission.org_id,
    capability: submission.capability,
    implementation: submission.implementation,
    input: submission.input,
    requirements: submission.requirements,
    priority: submission.priority,
    runAfter: submission.run_after,
    maxAttempts: submission.max_attempts,
    metadata,
    idempotencyKey
  });
  if (!task) throw httpError('Failed to enqueue compute job', 503, 'COMPUTE_ENQUEUE_FAILED');
  return { job: jobView({ task, leases: [], node: null }), replayed: Boolean(replayed), live_nodes: liveNodes.length, live_node_ids: liveNodes };
}

async function loadJob(orgId, jobId, deps) {
  const taskId = requireJobId(jobId);
  const task = await deps.taskById({ orgId, taskId });
  if (!task || task.org_id !== orgId) throw httpError('compute job not found', 404, 'JOB_NOT_FOUND');
  const leases = await deps.leasesForTask({ taskId });
  const lease = completingLease(task, leases) || latestLease(leases);
  const nodeId = lease?.node_id || task.locked_by_node_id || null;
  const node = nodeId ? await deps.nodeById(nodeId) : null;
  return { task, leases, lease, node };
}

export async function getJob({ orgId, jobId }, deps = defaultDeps()) {
  const { task, leases, node } = await loadJob(orgId, jobId, deps);
  return jobView({ task, leases, node });
}

export async function getJobResult({ orgId, jobId }, deps = defaultDeps()) {
  const { task, leases, node } = await loadJob(orgId, jobId, deps);
  return jobResult({ task, leases, node });
}

export async function getJobReceipt({ orgId, jobId, issuer = {} }, deps = defaultDeps()) {
  const { task, leases, lease, node } = await loadJob(orgId, jobId, deps);
  const attestation = lease ? await deps.attestationForLease({ leaseId: lease.id }) : null;
  const receipt = buildReceipt({ task, leases, node, attestation, nodePublicKeyPem: node?.public_key_pem || null, issuedAt: deps.now(), issuer });
  return signReceipt(receipt, deps.receiptKey());
}

export async function listJobs({ orgId, status = null, capability = null, limit = 50 }, deps = defaultDeps()) {
  const tasks = await deps.listTasks({ orgId, status, capability, limit });
  const nodes = await deps.nodesById({ ids: tasks.map((task) => task.locked_by_node_id).filter(Boolean) });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return { schema: 'mccluster-job-list/1', org_id: orgId, count: tasks.length, jobs: tasks.map((task) => jobView({ task, leases: [], node: byId.get(task.locked_by_node_id) || null })) };
}

export function receiptKey(deps = defaultDeps()) {
  return receiptKeyInfo(deps.receiptKey());
}

// Called by the gateway after compute_complete_lease accepted the completion.
// Best-effort: a failure to record never undoes the committed result; it is
// logged and the receipt reports the attestation as absent.
export async function recordCompletionAttestation({ node, leaseId, path, headers, result }, deps = defaultDeps()) {
  try {
    const lease = await deps.leaseById({ leaseId });
    const attestation = completionAttestation({ node, leaseId, attempt: lease?.attempt ?? null, method: 'POST', path, headers, result });
    const outcome = await deps.recordAttestation({ ...attestation, task_id: lease?.task_id ?? null }, { log: (line) => deps.log(typeof line === 'string' ? JSON.parse(line) : line) });
    return { ...outcome, lease_id: leaseId };
  } catch (error) {
    deps.log({ event: 'compute_attestation_record_failed', lease_id: leaseId, node_id: node?.id ?? null, message: error.message, code: error.code || null });
    return { recorded: false, replayed: false, available: null, error: error.code || error.message };
  }
}
