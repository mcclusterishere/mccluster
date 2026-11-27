import { rest } from '../supabase.mjs';
import { computeTaskById, listNodes } from './store.mjs';
import { validateNodeId } from './protocol.mjs';

export const OWNER_MODELS = Object.freeze({
  'qwen3.8b.local': 'qwen3:8b',
  'qwen3-vl.8b.local': 'qwen3-vl:8b',
  'qwen3-vl.4b.local': 'qwen3-vl:4b',
  'qwen3.14b.local': 'qwen3:14b',
});
export const OWNER_TARGETS = Object.freeze(['ovh', 'prime', 'connected']);
const TARGET_HARDWARE = { ovh: 'cpu-only', prime: 'gpu-verified' };

// The role and enrolled trust are fixed at enrollment. A display name can change.
export function ownerComputeTarget(node) {
  const role = node.labels?.role;
  if (role === 'control-cpu') return node.inventory?.platform === 'linux' && node.labels?.site === 'ovh-primary' ? 'ovh' : null;
  if (role === 'gpu-laptop' && node.inventory?.platform === 'win32' && node.labels?.site === 'owner-windows-gpu') return 'prime';
  if (node.display_name === 'ovh-primary' || node.labels?.site === 'ovh-primary' || node.labels?.site === 'owner-windows-gpu' ||
      (node.inventory?.platform === 'win32' && ['prime-windows', 'owner-windows-gpu', 'owner-windows-pilot'].includes(node.display_name))) return null;
  return node.labels?.enrolled_trust === 'owned' ? 'connected' : null;
}

export function ownerTargetReady(node, target, implementation, now = Date.now()) {
  const age = now - Date.parse(node.last_seen_at);
  return Boolean(target && ownerComputeTarget(node) === target && node.labels?.enrolled_trust === 'owned' &&
    node.state === 'online' && !node.revoked_at && !node.pair_cleanup_required && age >= 0 && age < 180_000 &&
    (!TARGET_HARDWARE[target] || node.inventory?.runtime?.hardware_mode === TARGET_HARDWARE[target]) &&
    (node.capabilities || []).some(entry => entry.capability === 'ai.chat' && Object.hasOwn(OWNER_MODELS, entry.implementation) &&
      (!implementation || implementation === entry.implementation) && entry.model === OWNER_MODELS[entry.implementation]));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function workspaceError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status, retryable: false });
}
export function requireWorkspaceOwner(orgId, actor, env = process.env) {
  if (actor?.kind !== 'owner' || !UUID.test(actor?.user_id || '')) throw workspaceError('AI_OWNER_REQUIRED', 'Sign in as the house owner to use this workspace.', 403);
  if (!env.MCCLUSTER_ORG_ID || orgId !== env.MCCLUSTER_ORG_ID) throw workspaceError('CROSS_ORG_DENIED', 'This workspace belongs to the house organization.', 403);
}
export function normalizeOwnerRoute(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw workspaceError('AI_ROUTE_INVALID', 'Choose Auto or an enrolled worker.', 400);
  const mode = value.mode || 'auto';
  if (!['auto', 'node', 'pair'].includes(mode)) throw workspaceError('AI_ROUTE_INVALID', 'Unknown route.', 400);
  const implementation = value.implementation || 'qwen3.8b.local';
  if (Object.hasOwn(value, 'target') && (mode !== 'node' || !OWNER_TARGETS.includes(value.target) || typeof value.implementation !== 'string' || !value.implementation)) throw workspaceError('AI_ROUTE_INVALID', 'Choose an explicit compute target and its enrolled worker.', 400);
  if (!Object.hasOwn(OWNER_MODELS, implementation) && mode !== 'pair') throw workspaceError('AI_MODEL_UNAVAILABLE', 'This model implementation is not supported by the workspace.', 400);
  if (mode === 'node') { try { validateNodeId(value.node_id); } catch { throw workspaceError('AI_ROUTE_INVALID', 'Choose an enrolled worker.', 400); } }
  if (mode === 'pair' && !UUID.test(value.pair_id || '')) throw workspaceError('PAIR_UNAVAILABLE', 'Create and test a two-Mac pair first.', 400);
  return { mode, implementation: mode === 'pair' ? 'qwen3.5.27b.pair' : implementation, ...(mode === 'node' ? { node_id: value.node_id } : {}), ...(value.target ? { target: value.target } : {}), ...(mode === 'pair' ? { pair_id: value.pair_id } : {}) };
}
export async function assertWorkspaceSchema(restImpl = rest) {
  try {
    const { body } = await restImpl('rpc/compute_owner_workspace_status', { method: 'POST', body: '{}' });
    if (body?.version === 1 && body?.node_pinning === true && body?.pair_reservations === true && body?.turn_stop === true) return body;
  } catch { /* No downgrade to the old scheduler: it cannot enforce a pin. */ }
  throw workspaceError('AI_WORKSPACE_MIGRATION_PENDING', 'The owner workspace needs its reviewed Core and database release before jobs can run.', 503);
}
export async function taskExecution({ orgId, task, restImpl = rest, nodes = [] }) {
  if (!task) return { status: 'unknown', content: '', node: null };
  if (task.org_id && task.org_id !== orgId) throw workspaceError('CROSS_ORG_DENIED', 'This execution receipt belongs to a different workspace.', 403);
  // Leases inherit organization through their task FK; the canonical lease
  // table intentionally has no independent org_id column.
  const params = new URLSearchParams({ task_id: `eq.${task.id}`, select: 'node_id,status,attempt,progress,created_at,completed_at', order: 'attempt.desc,created_at.desc', limit: '1' });
  const { body: leases = [] } = await restImpl(`ops_compute_leases?${params}`);
  const lease = leases.find(item => item.attempt === task.attempts && (task.status !== 'done' || item.status === 'done'));
  const nodeId = lease?.node_id || (task.status === 'done' ? null : task.locked_by_node_id) || null;
  const device = nodes.find(item => item.id === nodeId);
  const progress = lease?.progress || {};
  return {
    status: task.status,
    content: task.status === 'done' ? String(task.output?.content || '') : String(progress.content || ''),
    sequence: Number(progress.sequence) || 0,
    task_id: task.id,
    attempt: task.attempts,
    node: nodeId ? { node_id: nodeId, node_name: device?.display_name || nodeId, route: 'fabric', hardware_mode: device?.inventory?.runtime?.hardware_mode || null } : null,
    time_to_first_token_ms: task.output?.time_to_first_token_ms ?? progress.time_to_first_token_ms ?? null,
  };
}

// Serializes queue creation with Stop and executor recovery. A stale runner
// cannot enqueue another round after the owner stopped its durable turn.
export async function enqueueWorkspaceTask(args, execution, restImpl = rest) {
  if (!execution?.turnId || !execution.jobLease || !Number.isInteger(execution.jobAttempt)) throw workspaceError('AI_TURN_LEASE_LOST', 'The saved run no longer owns an executor lease.');
  let body;
  try { ({ body } = await restImpl('rpc/ops_ai_enqueue_workspace_task', { method: 'POST', body: JSON.stringify({
    p_org_id: args.orgId, p_turn_id: execution.turnId, p_job_lease: execution.jobLease, p_job_attempt: execution.jobAttempt,
    p_task: { capability: args.capability, implementation: args.implementation, input: args.input, requirements: args.requirements || {}, priority: args.priority || 0, max_attempts: args.maxAttempts || 3, metadata: args.metadata || {} },
    p_idempotency_key: args.idempotencyKey || null,
  }) })); } catch (error) {
    if (/AI_TURN_(LEASE_LOST|ALREADY_COMPLETED)/.test(String(error.detail?.message || error.message))) throw workspaceError('AI_TURN_LEASE_LOST', 'This run was stopped, completed, or recovered by a newer Core attempt.');
    throw error;
  }
  if (body?.conflict) throw workspaceError('IDEMPOTENCY_CONFLICT', 'This saved run already queued a different request. Its original work was preserved.');
  return { task: body?.task || null, replayed: body?.replayed === true };
}

// An owner route always uses the existing durable fabric, including OVH. No
// browser disconnection cancels it and a pinned node never silently falls back.
export async function ownerRoutedChat({ route: requestedRoute, orgId, input, priority = 100, metadata = {}, timeoutMs = 240_000, signal, onProgress, onTask, ownerExecution }, dependencies = {}) {
  const route = normalizeOwnerRoute(requestedRoute);
  const restImpl = dependencies.rest || rest;
  const enqueue = dependencies.enqueue || (args => enqueueWorkspaceTask(args, ownerExecution, restImpl));
  const readTask = dependencies.readTask || computeTaskById;
  const getNodes = dependencies.listNodes || listNodes;
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = dependencies.now || Date.now;
  await assertWorkspaceSchema(restImpl);
  if (route.mode === 'pair') {
    const { runReservedPair } = await import('./pairs.mjs');
    return runReservedPair({ orgId, pairId: route.pair_id, input, signal, onProgress, metadata, ownerExecution }, dependencies);
  }
  const idempotencyKey = metadata.turn_id ? `owner:${metadata.turn_id}:${metadata.round || 0}` : null;
  let existing = null;
  if (idempotencyKey) {
    const { body = [] } = await restImpl(`ops_compute_tasks?${new URLSearchParams({ org_id: `eq.${orgId}`, idempotency_key: `eq.${idempotencyKey}`, select: '*', limit: '1' })}`);
    existing = body[0] || null;
    if (existing) {
      const savedRoute = existing.metadata?.requested_route;
      if (existing.implementation !== route.implementation || savedRoute?.mode !== route.mode || savedRoute?.implementation !== route.implementation || (savedRoute?.node_id || null) !== (route.node_id || null) || savedRoute?.target !== route.target) throw workspaceError('IDEMPOTENCY_CONFLICT', 'The saved run has a different route. Its original work was preserved.');
    }
  }
  // A completed durable task remains recoverable if its worker goes offline
  // before Core saves the assistant message. Availability gates only new work.
  const nodes = await getNodes({ orgId, liveOnly: false, limit: 500, includeCleanup: true });
  const eligible = nodes.filter(node => node.state === 'online' && !node.revoked_at && !node.pair_cleanup_required && Date.parse(node.last_seen_at) >= now() - 180_000 &&
    (node.capabilities || []).some(entry => entry.capability === 'ai.chat' && entry.implementation === route.implementation));
  const pinned = route.mode === 'node' ? eligible.find(node => node.id === route.node_id) : null;
  if (!existing && route.target && (!pinned || !ownerTargetReady(pinned, route.target, route.implementation, now()))) {
    throw workspaceError('AI_DEVICE_UNAVAILABLE', 'The selected compute target does not have a current check-in for this hardware and model.', 503);
  }
  if (!existing && route.mode === 'node' && !pinned) throw workspaceError('AI_DEVICE_UNAVAILABLE', 'The selected worker is offline, paused, revoked, or does not have this model ready. Select another worker or resume it in Devices.', 503);
  if (!existing && !eligible.length) throw workspaceError('AI_DEVICE_UNAVAILABLE', 'No healthy worker has this model ready. Open Devices to connect and test one.', 503);
  const { task } = existing ? { task: existing } : await enqueue({ orgId, capability: 'ai.chat', implementation: route.implementation,
    input: { ...input, strict_model: true, ...(route.target ? { model: OWNER_MODELS[route.implementation] } : {}),
      ...(TARGET_HARDWARE[route.target] ? { required_hardware: TARGET_HARDWARE[route.target] } : {}) }, requirements: route.mode === 'node' ? { node_id: route.node_id } : {},
    priority, maxAttempts: 3, metadata: { ...metadata, source: 'owner-ai-workspace', requested_route: route },
    // The same durable turn/round reattaches after a Core restart.
    idempotencyKey });
  if (!task?.id) throw workspaceError('AI_TURN_NOT_QUEUED', 'Core could not durably queue this run.', 503);
  await onTask?.(task.id);
  const deadline = now() + timeoutMs;
  let last = task, previousNode = null;
  while (now() < deadline) {
    if (signal?.aborted) throw signal.reason || workspaceError('AI_TURN_STOPPED', 'The run was stopped.');
    last = await readTask({ orgId, taskId: task.id });
    if (!last) throw workspaceError('AI_TASK_UNAVAILABLE', 'Core could not read this run. Reconnect to recover its status.', 503);
    const receipt = await taskExecution({ orgId, task: last, restImpl, nodes });
    if (route.mode === 'node') {
      const actualNode = receipt.node?.node_id;
      if ((actualNode && actualNode !== route.node_id) || (last.status === 'done' && !actualNode)) {
        throw workspaceError('AI_ROUTE_RECEIPT_MISMATCH', 'The execution receipt did not match the pinned worker. The answer was withheld.', 502);
      }
      if (last.status === 'done' && (last.output?.fallback_from || last.output?.model !== OWNER_MODELS[route.implementation] || last.implementation !== route.implementation ||
          (route.target && last.output?.runtime_model !== OWNER_MODELS[route.implementation]))) {
        throw workspaceError('AI_ROUTE_MODEL_MISMATCH', 'The selected worker did not verify the requested model. The answer was withheld.', 502);
      }
      if (last.status === 'done' && TARGET_HARDWARE[route.target] && last.output?.hardware_mode !== TARGET_HARDWARE[route.target]) {
        throw workspaceError('AI_ROUTE_HARDWARE_MISMATCH', 'The selected worker did not verify the requested hardware for this model. The answer was withheld.', 502);
      }
      if (route.target) {
        // An older worker can stream request-derived metadata. Await the
        // completing signed lease before publishing its answer.
        if (last.status !== 'done') receipt.content = '';
        if (receipt.node) receipt.node.hardware_mode = last.status === 'done' ? last.output?.hardware_mode || null : null;
      }
    }
    let fallbackReason = last.output?.fallback_from ? `The worker used ${last.output.model} because ${last.output.fallback_from} was unavailable.` : null;
    if (route.mode === 'auto' && receipt.attempt > 1) fallbackReason = 'The previous lease ended without a result. Core reassigned the job under its lease recovery rules.';
    if (previousNode && receipt.node?.node_id && previousNode !== receipt.node.node_id) fallbackReason = 'The previous worker lost its lease. Auto resumed the job on another eligible worker.';
    if (receipt.node) previousNode = receipt.node.node_id;
    await onProgress?.({ ...receipt, fallback_reason: fallbackReason });
    if (last.status === 'done') {
      const data = last.output || {};
      return { model: data.model || OWNER_MODELS[route.implementation], implementation: last.implementation || route.implementation,
        message: { role: 'assistant', content: String(data.content || ''), ...(data.tool_calls?.length ? { tool_calls: data.tool_calls } : {}) },
        node: { ...receipt.node, generation_tokens_per_second: data.usage?.generation_tokens_per_second ?? null },
        compute_task_id: task.id, route: 'fabric', requested_route: route, fallback_reason: fallbackReason,
        usage: data.usage || {}, settings: data.settings || null, done_reason: data.done_reason || null,
        time_to_first_token_ms: receipt.time_to_first_token_ms };
    }
    if (last.status === 'canceled') throw workspaceError('AI_TURN_STOPPED', 'The run was stopped.');
    if (last.status === 'failed') throw workspaceError('AI_WORKER_FAILED', 'The worker could not complete this run. Open Devices for recovery or retry on another worker.', 502);
    await sleep(600);
  }
  // The durable task still owns its work. A retry reattaches via idempotency;
  // it never duplicates a task whose ownership is uncertain.
  throw Object.assign(workspaceError('AI_RUN_RECOVERING', 'The worker is still processing or recovering its lease. Reconnect to see the saved run.', 504), { retryable: true, compute_task_id: task.id });
}
