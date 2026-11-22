// Owner device controls use the existing Supabase compute inventory. Bootstrap
// credentials exist only in the response that issues them and the installer's
// memory; the data plane stores a digest, never a usable enrollment credential.
import { createHash, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { rest } from '../supabase.mjs';
import { keyFingerprint, nodeIdFromPublicKey } from './signature.mjs';
import { validateEnrollment, validateNodeId } from './protocol.mjs';
import { OWNER_MODELS } from './owner-routing.mjs';

export const ENROLLMENT_TTL_MS = 10 * 60_000;
export const ENROLLMENT_PREFIX = 'mcen1_';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const NODE_SELECT = 'id,org_id,display_name,state,inventory,capabilities,labels,load,max_leases,enrolled_at,last_seen_at,revoked_at,updated_at';
const NODE_RECOVERY_SELECT = `${NODE_SELECT},pair_cleanup_required,pair_cleanup_details`;
const ENROLLMENT_SELECT = 'id,org_id,display_name,platform,created_at,expires_at,consumed_at,node_id';
const TEST_SELECT = 'id,status,implementation,output,metadata,updated_at,ops_compute_leases(node_id,status,completed_at)';

function failure(message, code, status = 400) { return Object.assign(new Error(message), { code, status }); }
function first(body) { return Array.isArray(body) ? body[0] || null : null; }
function array(body) { return Array.isArray(body) ? body : []; }
function query(table, params) { return `${table}?${new URLSearchParams(params)}`; }
function nameOf(value) {
  const valueString = typeof value === 'string' ? value.trim() : '';
  if (!valueString || valueString.length > 80 || /[\x00-\x1f\x7f]/.test(valueString)) {
    throw failure('Name the device using 1–80 visible characters.', 'DEVICE_NAME_INVALID');
  }
  return valueString;
}
function uuid(value, label) {
  if (!UUID.test(value || '')) throw failure(`${label} must be a UUID.`, 'DEVICE_REQUEST_INVALID');
  return value;
}
function nodeId(value) {
  try { return validateNodeId(value); }
  catch { throw failure('Select an enrolled device.', 'DEVICE_ID_INVALID'); }
}
function missingEnrollmentSchema(error) {
  return ['42P01', 'PGRST205', 'PGRST202'].includes(error?.detail?.code) || Number(error?.status) === 404;
}
function missingRecoveryColumns(error) { return ['42703', 'PGRST204'].includes(error?.detail?.code); }
function schemaError(error) {
  if (missingEnrollmentSchema(error)) return failure('Device enrollment needs the pending Core database update. Ask the owner to approve that release first.', 'DEVICE_SCHEMA_UNAVAILABLE', 503);
  return error;
}

export function computePublicUrl(env = process.env) {
  const value = env.CORE_COMPUTE_PUBLIC_URL || 'https://compute.mccluster.org';
  let url;
  try { url = new URL(value); } catch { throw failure('Core has no valid public enrollment address.', 'DEVICE_COORDINATOR_UNAVAILABLE', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw failure('Core enrollment requires an HTTPS origin without credentials, a path, or URL parameters.', 'DEVICE_COORDINATOR_UNAVAILABLE', 503);
  }
  return url.origin;
}

export async function assertDeviceWorkspaceSchema({ restImpl = rest } = {}) {
  let body;
  try { ({ body } = await restImpl('rpc/compute_owner_workspace_status', { method: 'POST', body: '{}' })); }
  catch { throw failure('The running Core needs the pending owner workspace database update before it can safely pin device jobs.', 'DEVICE_SCHEMA_UNAVAILABLE', 503); }
  if (body?.version !== 1 || body?.node_pinning !== true) throw failure('The running Core cannot safely pin device jobs yet.', 'DEVICE_SCHEMA_UNAVAILABLE', 503);
  return body;
}

export function isScopedEnrollmentCredential(credential) {
  return typeof credential === 'string' && credential.startsWith(ENROLLMENT_PREFIX);
}
export function enrollmentDigest(credential) {
  if (!/^mcen1_[A-Za-z0-9_-]{43}$/.test(credential || '')) {
    throw failure('This enrollment credential is invalid or expired. Create a fresh one in Devices.', 'ENROLLMENT_INVALID_OR_EXPIRED', 401);
  }
  return createHash('sha256').update(credential).digest('hex');
}

function testForDevice(tests, id) {
  return tests.find((item) => item?.metadata?.device_id === id) || null;
}

export function deviceSummary(node, tests = [], now = Date.now()) {
  const capabilities = Array.isArray(node.capabilities) ? node.capabilities : [];
  const live = Number.isFinite(Date.parse(node.last_seen_at)) && now - Date.parse(node.last_seen_at) < 180_000;
  const modelReady = capabilities.some((entry) => entry.capability === 'ai.chat');
  const test = testForDevice(tests, node.id);
  const completedLease = array(test?.ops_compute_leases).find((lease) => lease.node_id === node.id && lease.status === 'done');
  const testPassed = test?.status === 'done' && Boolean(completedLease) && test?.metadata?.expected_model === 'qwen3:8b' && test?.output?.model === test.metadata.expected_model && typeof test?.output?.content === 'string' && test.output.content.trim().length > 0;
  let state = 'connected';
  let recovery = 'The worker is connected. Start Ollama locally and install the model to make it ready.';
  if (node.state === 'revoked' || node.revoked_at) {
    state = 'revoked'; recovery = 'This key cannot take work or publish results. Reinstall with a new device identity and a new enrollment credential to reconnect.';
  } else if (node.pair_cleanup_required || node.state === 'draining' || node.state === 'quarantined') {
    state = 'paused'; recovery = node.pair_cleanup_required ? 'The shared model did not confirm unloading. Stop and unload the pair runtime on this Mac, then send its signed cleanup confirmation. Resume stays unavailable until Core verifies that receipt.' : node.state === 'quarantined' ? 'This device is quarantined. Review it with the operator before restoring it.' : 'Existing jobs can finish. Resume this device when you want it to accept new work.';
  } else if (!live || node.state === 'offline') {
    state = 'offline'; recovery = 'Wake the device, connect it to Wi-Fi, and start its worker. Signed heartbeats will reconnect it; expired jobs follow the existing retry rules.';
  } else if (modelReady && testPassed) {
    state = 'test_passed'; recovery = 'The worker completed its test. It can accept one job at a time.';
  } else if (modelReady) {
    state = 'model_ready'; recovery = 'The local model is available. Run the device test to verify a job through Core.';
  }
  return {
    id: node.id, node_id: node.id, display_name: node.display_name,
    state, state_label: { connected: 'Connected', model_ready: 'Model ready', test_passed: 'Test passed', offline: 'Offline', paused: 'Paused', revoked: 'Revoked' }[state],
    node_state: node.state, recovery,
    platform: node.inventory?.platform || 'unknown', arch: node.inventory?.arch || 'unknown',
    cpu_count: node.inventory?.cpu_count ?? null, memory_bytes: node.inventory?.memory_bytes ?? null,
    hardware_mode: node.inventory?.runtime?.hardware_mode || 'unknown',
    last_seen_at: node.last_seen_at, enrolled_at: node.enrolled_at,
    max_leases: node.max_leases || 1, active_jobs: Number(node.load?.running_leases || 0),
    capabilities, models: capabilities.filter((entry) => entry.capability === 'ai.chat').map((entry) => ({ implementation: entry.implementation, model: entry.model || OWNER_MODELS[entry.implementation] || null, ready: live && node.state === 'online' && !node.revoked_at && !node.pair_cleanup_required })),
    eligible: live && node.state === 'online' && !node.revoked_at && !node.pair_cleanup_required && modelReady,
    cleanup_required: node.pair_cleanup_required === true,
    cleanup: node.pair_cleanup_details || null,
    resume_available: !node.pair_cleanup_required && !node.revoked_at && !['revoked','quarantined'].includes(node.state),
    coordinator: node.labels?.role === 'control-cpu' || node.display_name === 'ovh-primary',
    test: test ? { task_id: test.id, status: test.status, passed: testPassed, completed_at: completedLease?.completed_at || null } : null,
  };
}

function pendingSummary(row, now) {
  const expired = Date.parse(row.expires_at) <= now;
  return { id: row.id, enrollment_id: row.id, display_name: row.display_name, platform: row.platform, created_at: row.created_at, expires_at: row.expires_at, expired, state: 'pending', recovery: expired ? 'This credential expired. Sign in on the target device and issue a fresh credential.' : 'Sign in on the target device, then install the worker. If you lost the credential, issue a fresh one here.' };
}

export function createDeviceService({ restImpl = rest, now = Date.now, secret = () => randomBytes(32).toString('base64url'), env = process.env } = {}) {
  async function rpc(name, payload) {
    const { body } = await restImpl(`rpc/${name}`, { method: 'POST', body: JSON.stringify(payload) });
    return body;
  }
  async function requireOwner(orgId, actor) {
    if (actor?.kind !== 'owner' || !UUID.test(actor?.user_id || '')) throw failure('A signed-in house owner is required to manage devices.', 'DEVICE_OWNER_REQUIRED', 403);
    uuid(orgId, 'org_id');
    const { body: orgs } = await restImpl('orgs?slug=eq.mccluster&select=id,enabled&limit=1');
    const house = first(orgs);
    if (!house?.id || house.enabled !== true) throw failure('The house workspace is unavailable.', 'DEVICE_HOUSE_UNAVAILABLE', 503);
    if (house.id !== orgId) throw failure('Devices belong to the house workspace.', 'DEVICE_ORG_DENIED', 403);
    const { body: memberships } = await restImpl(query('org_members', { org_id: `eq.${orgId}`, profile_id: `eq.${actor.user_id}`, role: 'eq.owner', select: 'org_id', limit: '1' }));
    if (!first(memberships)) throw failure('House owner access is required to manage devices.', 'DEVICE_OWNER_REQUIRED', 403);
    return orgId;
  }
  async function readNode(orgId, id) {
    const { body } = await readNodes({ org_id: `eq.${orgId}`, id: `eq.${nodeId(id)}`, limit: '1' });
    const node = first(body);
    if (!node) throw failure('That device was not found in this workspace.', 'DEVICE_NOT_FOUND', 404);
    return node;
  }
  async function readNodes(params) {
    try { return await restImpl(query('ops_compute_nodes', { ...params, select: NODE_RECOVERY_SELECT })); }
    catch (error) {
      if (!missingRecoveryColumns(error)) throw error;
      return restImpl(query('ops_compute_nodes', { ...params, select: NODE_SELECT }));
    }
  }
  async function list({ org_id: orgId }, { actor } = {}) {
    await requireOwner(orgId, actor);
    const [nodeResult, testResult, enrollmentResult] = await Promise.allSettled([
      readNodes({ org_id: `eq.${orgId}`, order: 'enrolled_at.asc', limit: '500' }),
      restImpl(query('ops_compute_tasks', { org_id: `eq.${orgId}`, 'metadata->>purpose': 'eq.owner-device-test', select: TEST_SELECT, order: 'updated_at.desc', limit: '500' })),
      restImpl(query('ops_compute_enrollments', { org_id: `eq.${orgId}`, consumed_at: 'is.null', select: ENROLLMENT_SELECT, order: 'created_at.desc', limit: '100' })),
    ]);
    if (nodeResult.status === 'rejected') throw nodeResult.reason;
    if (testResult.status === 'rejected') throw testResult.reason;
    if (enrollmentResult.status === 'rejected' && !missingEnrollmentSchema(enrollmentResult.reason)) throw enrollmentResult.reason;
    const time = now();
    return { devices: array(nodeResult.value.body).map((node) => deviceSummary(node, array(testResult.value.body), time)),
      enrollments: enrollmentResult.status === 'fulfilled' ? array(enrollmentResult.value.body).map((row) => pendingSummary(row, time)) : [],
      enrollment_available: enrollmentResult.status === 'fulfilled',
      ...(enrollmentResult.status === 'rejected' ? { enrollment_unavailable_reason: schemaError(enrollmentResult.reason).message } : {}),
      coordinator: 'McCluster Core on OVH', observed_at: new Date(time).toISOString() };
  }
  async function createEnrollment(args, { actor } = {}) {
    const orgId = await requireOwner(args.org_id, actor);
    await assertDeviceWorkspaceSchema({ restImpl });
    const coordinatorUrl = computePublicUrl(env);
    const displayName = nameOf(args.display_name);
    const platform = args.platform || 'darwin';
    if (!PLATFORMS.has(platform)) throw failure('Select macOS, Windows or Linux.', 'DEVICE_PLATFORM_INVALID');
    const id = args.enrollment_id ? uuid(args.enrollment_id, 'enrollment_id') : randomUUID();
    const credential = `${ENROLLMENT_PREFIX}${secret()}`;
    const issuedAtMs = now();
    const issuedAt = new Date(issuedAtMs).toISOString();
    const expiresAt = new Date(issuedAtMs + ENROLLMENT_TTL_MS).toISOString();
    const record = { id, org_id: orgId, issued_by: actor.user_id, display_name: displayName, platform, credential_hash: enrollmentDigest(credential), issued_at: issuedAt, expires_at: expiresAt, allowed_implementations: ['qwen3.8b.local', 'exo.mlx.local'], max_leases: 1 };
    let row;
    try {
      const result = args.enrollment_id
        ? await restImpl(query('ops_compute_enrollments', { id: `eq.${id}`, org_id: `eq.${orgId}`, consumed_at: 'is.null' }), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) })
        : await restImpl('ops_compute_enrollments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) });
      row = first(result.body);
    } catch (error) { throw schemaError(error); }
    if (!row) throw failure('This enrollment was already used or is unavailable. Add a new device instead.', 'ENROLLMENT_ALREADY_USED', 409);
    return { enrollment_id: id, display_name: displayName, platform, expires_at: expiresAt, credential,
      setup: { org_id: orgId, compute_url: coordinatorUrl, enrollment_id: id, display_name: displayName, platform, implementation: 'qwen3.8b.local', model: 'qwen3:8b', context: 4096, max_leases: 1 } };
  }
  async function update(args, { actor } = {}) {
    const orgId = await requireOwner(args.org_id, actor);
    const node = await readNode(orgId, args.node_id);
    if (!['rename', 'pause', 'resume', 'revoke'].includes(args.action)) throw failure('Choose rename, pause, resume or revoke.', 'DEVICE_ACTION_INVALID');
    if (node.state === 'revoked' || node.revoked_at) throw failure('A revoked identity cannot be restored. Install with a fresh identity.', 'DEVICE_REVOKED', 409);
    if (node.state === 'quarantined' && args.action !== 'revoke' && args.action !== 'rename') throw failure('Quarantined devices need an operator review.', 'DEVICE_QUARANTINED', 409);
    if (args.action === 'resume') {
      let updated;
      try { updated = await rpc('compute_resume_owner_device', { p_org_id: orgId, p_node_id: node.id }); }
      catch (error) {
        const reason = error?.detail?.message || error?.message || '';
        if (reason.includes('DEVICE_PAIR_CLEANUP_REQUIRED')) throw failure('The shared model has not confirmed unloading. Run local pair cleanup on this Mac and send its signed confirmation before resuming.', 'DEVICE_PAIR_CLEANUP_REQUIRED', 409);
        if (reason.includes('DEVICE_REVOKED')) throw failure('A revoked identity cannot be restored. Install with a fresh identity.', 'DEVICE_REVOKED', 409);
        if (reason.includes('DEVICE_QUARANTINED')) throw failure('Quarantined devices need an operator review.', 'DEVICE_QUARANTINED', 409);
        throw schemaError(error);
      }
      if (!updated?.id) throw failure('Core could not resume this worker. Refresh Devices and try again.', 'DEVICE_UPDATE_CONFLICT', 409);
      return { device: deviceSummary(updated, [], now()), in_flight_policy: null };
    }
    const patch = { updated_at: new Date(now()).toISOString() };
    if (args.action === 'rename') patch.display_name = nameOf(args.display_name);
    if (args.action === 'pause') patch.state = 'draining';
    if (args.action === 'revoke') { patch.state = 'revoked'; patch.revoked_at = patch.updated_at; }
    const { body } = await restImpl(query('ops_compute_nodes', { id: `eq.${node.id}`, org_id: `eq.${orgId}`, state: `eq.${node.state}`, revoked_at: 'is.null' }), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    const updated = first(body);
    if (!updated) throw failure('The device changed while you were updating it. Refresh Devices and try again.', 'DEVICE_UPDATE_CONFLICT', 409);
    return { device: deviceSummary(updated, [], now()), in_flight_policy: args.action === 'revoke' ? 'New leases and renewals are denied. The worker aborts when it loses lease authority; late results are rejected. The lease expires and its job is retried or fails under the existing attempt limit.' : args.action === 'pause' ? 'No new leases. Existing jobs keep their lease and can finish.' : null };
  }
  async function test(args, { actor } = {}) {
    const orgId = await requireOwner(args.org_id, actor);
    await assertDeviceWorkspaceSchema({ restImpl });
    const node = await readNode(orgId, args.node_id);
    const summary = deviceSummary(node, [], now());
    if (!summary.eligible) throw failure(`This device is ${summary.state_label.toLowerCase()}. ${summary.recovery}`, 'DEVICE_NOT_READY', 409);
    if (!summary.capabilities.some((entry) => entry.capability === 'ai.chat' && entry.implementation === 'qwen3.8b.local')) throw failure('Install qwen3:8b locally before running this test.', 'DEVICE_MODEL_NOT_READY', 409);
    const result = await rpc('compute_enqueue_task', { p_org_id: orgId, p_capability: 'ai.chat', p_implementation: 'qwen3.8b.local', p_input: { prompt: 'Reply with a short sentence confirming this worker can answer.', temperature: 0, num_predict: 64, num_ctx: 4096, strict_model: true }, p_requirements: { node_id: node.id }, p_priority: 30, p_run_after: null, p_max_attempts: 1, p_metadata: { purpose: 'owner-device-test', device_id: node.id, expected_model: 'qwen3:8b' }, p_idempotency_key: `device-test:${node.id}:${randomUUID()}` });
    if (!result?.task?.id) throw failure('Core did not accept the device test. Refresh and try again.', 'DEVICE_TEST_NOT_QUEUED', 503);
    return { task_id: result.task.id, status: result.task.status || 'queued', node_id: node.id };
  }
  return { list, createEnrollment, update, test };
}

// Called by the existing gateway only. Consumption and node insertion are one
// transaction. A malformed/replayed/expired credential never falls back to the
// legacy shared token, and a failed insert never burns an otherwise valid token.
export async function consumeScopedEnrollment(credential, body, { restImpl = rest } = {}) {
  const digest = enrollmentDigest(credential);
  let enrollment;
  try {
    enrollment = validateEnrollment(body);
    if (createPublicKey(enrollment.public_key).asymmetricKeyType !== 'ed25519') throw new Error('wrong key type');
  } catch { throw failure('The worker enrollment request is invalid. Update the installer and try again.', 'ENROLLMENT_REQUEST_INVALID'); }
  const record = { id: nodeIdFromPublicKey(enrollment.public_key), org_id: enrollment.org_id, public_key_pem: enrollment.public_key, key_fingerprint: keyFingerprint(enrollment.public_key), protocol_version: enrollment.protocol, agent_version: enrollment.agent_version, inventory: enrollment.inventory, capabilities: enrollment.capabilities, labels: enrollment.labels, max_leases: enrollment.max_leases };
  let result;
  try { ({ body: result } = await restImpl('rpc/compute_enroll_once', { method: 'POST', body: JSON.stringify({ p_credential_hash: digest, p_node: record }) })); }
  catch (error) { throw schemaError(error); }
  if (!result?.node_id) throw failure('This enrollment credential is invalid, expired or already used. Create a fresh one in Devices.', 'ENROLLMENT_INVALID_OR_EXPIRED', 401);
  return { id: result.node_id };
}

export function constrainScopedHeartbeat(node, { capabilities, maxLeases, labels }) {
  const scope = node.labels?.enrollment_scope;
  if (!scope || typeof scope !== 'object') return { capabilities, maxLeases, labels };
  const allowed = new Set(Array.isArray(scope.implementations) ? scope.implementations : []);
  return { capabilities: capabilities?.filter((entry) => allowed.has(entry.implementation) && ((entry.capability === 'ai.chat' && entry.implementation === 'qwen3.8b.local') || (entry.capability === 'compute.pair.control' && entry.implementation === 'exo.mlx.local'))).map((entry) => ({ ...entry, max_concurrency: 1 })), maxLeases: 1, labels: { ...(labels || node.labels), enrollment_scope: scope, enrollment_id: node.labels.enrollment_id } };
}

export async function acknowledgePairCleanup(node, body, { restImpl = rest } = {}) {
  if (node.labels?.enrolled_trust !== 'owned') throw failure('Only an enrolled owner device can confirm its local cleanup.', 'DEVICE_PAIR_CLEANUP_DENIED', 403);
  if (!UUID.test(body?.reservation_id || '') || !body?.receipt || body.receipt.schema !== 'mccluster-pair-cleanup/1' || body.receipt.runtime !== 'exo' || body.receipt.unloaded !== true || body.receipt.model_instances !== 0 || !Number.isFinite(Date.parse(body.receipt.observed_at))) {
    throw failure('The local pair controller must unload its model and provide a fresh cleanup receipt.', 'DEVICE_PAIR_CLEANUP_INVALID');
  }
  const receipt = { schema: 'mccluster-pair-cleanup/1', runtime: 'exo', unloaded: true, model_instances: 0, observed_at: new Date(body.receipt.observed_at).toISOString() };
  let result;
  try { ({ body: result } = await restImpl('rpc/compute_ack_pair_cleanup', { method: 'POST', body: JSON.stringify({ p_node_id: node.id, p_reservation_id: body.reservation_id, p_receipt: receipt }) })); }
  catch (error) { throw schemaError(error); }
  if (!result?.cleanup_confirmed) throw failure('Core could not match this cleanup receipt to the current hold, or this worker still has active work. Refresh local status and retry cleanup.', 'DEVICE_PAIR_CLEANUP_REJECTED', 409);
  return result;
}
