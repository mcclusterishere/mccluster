/* ============================================================
   McCLUSTER DISPATCH LAYER: the conversational front end.

   One owner message in; one routed outcome out, recorded before
   anything runs:

     answer     the message is chat. With a thread_id it becomes a
                durable resident McCluster turn (the existing
                core.ai.turn.submit path, VPS-owned inference); without
                one the front-end model's own short reply is returned.
     clarify    the front end is not confident, or a required detail
                is missing: one question back, nothing runs.
     run        a route whose approval is "none": a catalog capability
                through the Core capability registry, or a runner job
                type enqueued on ops_agent_jobs for the OVH runners.
     approval   anything the catalog gates: a pending
                public.control_approvals row (shown in Control next to
                every other approval). Nothing runs until the owner
                approves it there and calls core.dispatch.execute.
     refused    production, outreach, destructive, spend, owner-only:
                a plain answer saying where that is done instead.

   Every outcome is written first, in one transaction, to
   ai_context.dispatch_turns plus one ai_context.decisions row (the
   audit). If that write fails nothing runs: the layer fails closed.
   Results flow back through Supabase: core.dispatch.get reads the
   turn with its live ops_agent_jobs row, approval and resident turn.

   Contract: docs/control-plane/DISPATCH-LAYER.md
   Storage:  supabase/migrations/20261128094143_ai_context_dispatch_v1.sql
   ============================================================ */

import { createHash, randomUUID } from 'node:crypto';
import { DISPATCH_SCHEMA, routeFor, buildArgs } from './routes.mjs';
import { classifyDeterministic, classifyWithModel, decide, dispatchModel, thresholds } from './classify.mjs';
import { gateFor, requireOwner } from './policy.mjs';

export const DISPATCH_PENDING_SQL = 'supabase/migrations/20261128094143_ai_context_dispatch_v1.sql';
export const DISPATCH_NOT_APPLIED = 'DISPATCH_NOT_APPLIED';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value, max = 12000) { return String(value ?? '').trim().slice(0, max); }

function requireUuid(value, label) {
  const id = clean(value, 100).toLowerCase();
  if (!UUID.test(id)) throw Object.assign(new Error(`${label} must be a UUID`), { status: 400, code: 'DISPATCH_INVALID_INPUT' });
  return id;
}

/* Stable JSON so the same tool call always hashes the same. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function requestHash(tool, args) {
  return createHash('sha256').update(stableJson({ tool, args })).digest('hex');
}

/* PostgREST answers a missing function with 404/PGRST202: the dispatch
   SQL is not applied yet. That is a known state, said plainly. */
export function isNotApplied(error) {
  if (error?.detail?.code === 'PGRST202') return true;
  return error?.status === 404 && /ops_ai_dispatch_/.test(String(error?.message || ''));
}

export function makeRpc(rest) {
  return async function rpc(name, args) {
    try {
      const { body } = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
      return body;
    } catch (error) {
      if (isNotApplied(error)) {
        throw Object.assign(new Error(`The dispatch layer is not applied on this database (${DISPATCH_PENDING_SQL}); nothing was routed or run`), { status: 503, code: DISPATCH_NOT_APPLIED });
      }
      throw error;
    }
  };
}

/* Context for the front end, from Supabase: the active workstreams and
   a few relevant durable memories. Best effort: a context outage never
   blocks routing, it is reported on the turn instead. */
export async function loadDispatchContext({ orgId, message, actorId }, { rpc, memory } = {}) {
  const out = { available: { workstreams: false, memories: false }, workstreams: [], memories: [], summary: '' };
  const [workstreams, memories] = await Promise.allSettled([
    rpc ? rpc('ops_ai_workstream_resume', { p_org: orgId, p_limit: 5, p_max_sensitivity: 'internal', p_workstream_key: null, p_actor_id: actorId }) : Promise.reject(new Error('no rpc')),
    memory ? memory({ orgId, content: message }) : Promise.reject(new Error('no memory reader')),
  ]);
  if (workstreams.status === 'fulfilled' && Array.isArray(workstreams.value)) {
    out.available.workstreams = true;
    out.workstreams = workstreams.value.filter((row) => row && !row.withheld).slice(0, 5)
      .map((row) => ({ id: row.id, status: row.status, title: clean(row.title, 120), next: clean(row.next, 200) }));
  }
  if (memories.status === 'fulfilled' && memories.value?.available !== false) {
    out.available.memories = true;
    out.memories = (Array.isArray(memories.value?.memories) ? memories.value.memories : []).slice(0, 3)
      .map((row) => ({ id: row.id ?? null, text: clean(row.content ?? row.summary ?? row.text, 240) }));
  }
  const parts = [];
  if (out.workstreams.length) parts.push(`Active work: ${out.workstreams.map((w) => `${w.title || w.id} (${w.status}${w.next ? `; next: ${w.next}` : ''})`).join(' | ')}`);
  if (out.memories.length) parts.push(`Relevant memory: ${out.memories.map((m) => m.text).filter(Boolean).join(' | ')}`);
  out.summary = parts.join('\n');
  return out;
}

/* Find a queued job id in whatever a tool or capability returned: the
   control tools answer {job_id}, a capability call wraps the tool result
   as {result: {result: ...}}, a fresh ops_agent_jobs row has {id, job_type}. */
export function jobIdOf(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  for (const key of ['job_id', 'jobId']) if (UUID.test(String(value[key] || ''))) return String(value[key]).toLowerCase();
  if (value.job_type && UUID.test(String(value.id || ''))) return String(value.id).toLowerCase();
  for (const key of ['result', 'job', 'task']) {
    const found = jobIdOf(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/* Run one routed call. Three paths, all existing Core machinery:
     job route         -> enqueueJob on ops_agent_jobs for the OVH runner
     catalog route     -> the broker's capability registry (the same
                          resolve/bind/fallback path an MCP call takes)
     local-control     -> the Core control tool, when no registry is wired */
export async function runRoute(route, toolArgs, { orgId, actor, turnId }, deps = {}) {
  if (route.via === 'job') {
    if (typeof deps.enqueue !== 'function') throw Object.assign(new Error('job queue is not wired for dispatch'), { status: 503, code: 'DISPATCH_NOT_WIRED' });
    const row = await deps.enqueue({
      jobId: randomUUID(),
      orgId,
      jobType: route.jobType,
      targetType: route.targetType,
      targetId: toolArgs.target_id,
      input: { ...(toolArgs.input || {}), dispatch_turn_id: turnId },
      priority: 30,
      maxAttempts: 2,
    });
    return { job_id: row?.id ?? null, job_type: route.jobType };
  }
  if (typeof deps.callCapability === 'function') return deps.callCapability(route.capability, toolArgs, { actor });
  if (route.transport === 'local-control' && typeof deps.callTool === 'function') return deps.callTool(route.tool, toolArgs, { actor });
  throw Object.assign(new Error(`${route.capability} needs the Core capability registry, which is not wired here`), { status: 503, code: 'DISPATCH_NOT_WIRED' });
}

function boundedResult(value, max = 8000) {
  const text = JSON.stringify(value ?? null);
  if (text.length <= max) return value ?? null;
  return { truncated: true, excerpt: text.slice(0, max - 200) };
}

function defaultReply(route, gate, toolName) {
  if (route === 'approval') return `That needs your approval first. I've put it in Control as a pending approval for ${toolName}; nothing has started.`;
  if (route === 'run') return 'On it. I have started that on McCluster Core and will report back when it finishes.';
  return null;
}

/* ---------------------------------------------------------------- turn */

export async function dispatchTurn(args = {}, options = {}, deps = {}) {
  const actorId = requireOwner(options.actor);
  const orgId = requireUuid(args.org_id, 'org_id');
  const messageId = requireUuid(args.message_id, 'message_id');
  const message = clean(args.message, 12000);
  if (!message) throw Object.assign(new Error('message is required'), { status: 400, code: 'DISPATCH_INVALID_INPUT' });
  const threadId = args.thread_id ? requireUuid(args.thread_id, 'thread_id') : null;
  const { rpc, chat, catalog, submitAnswer, memory, env = process.env } = deps;
  if (typeof rpc !== 'function') throw Object.assign(new Error('dispatch is not wired'), { status: 503, code: 'DISPATCH_NOT_WIRED' });

  const limits = thresholds(env);
  const context = await loadDispatchContext({ orgId, message, actorId }, { rpc, memory });
  const hint = { intent: typeof args.intent === 'string' ? args.intent.trim() : null, args: args.args };
  const deterministic = classifyDeterministic(message, hint);
  const skipModel = deterministic.source === 'refusal' || deterministic.confidence >= limits.strong;
  const model = skipModel ? null : await classifyWithModel(message, { chat, model: dispatchModel(env), context: context.summary });
  const decision = decide(deterministic, model, limits, message, { messageId });

  let routeKind = decision.route;
  let route = null, gate = null, toolArgs = null, hash = null;
  if (decision.route === 'capability') {
    route = routeFor(decision.intent);
    gate = gateFor(route, catalog);
    routeKind = gate.decision === 'run' ? 'run' : gate.decision === 'approval' ? 'approval' : 'refused';
    toolArgs = { ...(decision.args || buildArgs(route, decision.slots || {}, message, { messageId })) };
    if (route.takesOrg) toolArgs.org_id = orgId;
    hash = requestHash(route.tool, toolArgs);
  }
  if (routeKind === 'answer' && !threadId && !decision.reply) {
    decision.reply = model?.ok ? null : 'The front-end model is not answering right now. Send this with a McCluster thread and the resident model will answer it.';
  }
  const reply = decision.reply || defaultReply(routeKind, gate, route?.tool) || (routeKind === 'refused' ? `I can't start ${route?.tool || 'that'} from chat (${gate?.reason || 'not routable'}).` : null);

  const recorded = await rpc('ops_ai_dispatch_record', {
    p_org: orgId,
    p_actor: actorId,
    p_turn: {
      operation_key: `dispatch:${messageId}`,
      message,
      thread_id: threadId,
      intent: decision.intent,
      route: routeKind,
      capability: route?.capability ?? null,
      tool: route?.tool ?? null,
      args: toolArgs || {},
      request_hash: hash,
      risk_class: gate?.risk_class || 'low',
      reply,
      classifier: {
        schema: DISPATCH_SCHEMA,
        confidence: decision.confidence,
        reason: decision.reason,
        gate: gate ? { decision: gate.decision, risk: gate.risk ?? null, approval: gate.approval ?? null, reason: gate.reason } : null,
        deterministic: { intent: deterministic.intent, confidence: deterministic.confidence, source: deterministic.source },
        model: decision.model,
        missing: decision.missing || [],
        context: { available: context.available, workstreams: context.workstreams.map((w) => w.id), memories: context.memories.map((m) => m.id).filter(Boolean) },
      },
    },
  });
  const turn = recorded?.turn || recorded;
  if (!turn?.id) throw Object.assign(new Error('dispatch turn was not recorded; nothing ran'), { status: 503, code: 'DISPATCH_NOT_RECORDED' });
  const base = { schema: DISPATCH_SCHEMA, turn_id: turn.id, intent: turn.intent, route: turn.route, confidence: decision.confidence, capability: turn.capability, tool: turn.tool, reply: turn.reply, approval_id: turn.approval_id ?? null, decision_id: turn.decision_id ?? null, front_end_model: model?.model || null, poll: { tool: 'core.dispatch.get', turn_id: turn.id } };
  if (recorded?.replayed) return { ...base, replayed: true, status: turn.status, job_id: turn.job_id ?? null, resident_turn_id: turn.resident_turn_id ?? null };

  if (routeKind === 'run') {
    try {
      const result = await runRoute(route, toolArgs, { orgId, actor: options.actor, turnId: turn.id }, deps);
      const jobId = jobIdOf(result);
      const status = jobId ? 'queued' : 'done';
      await rpc('ops_ai_dispatch_attach', { p_org: orgId, p_turn: turn.id, p_patch: { status, job_id: jobId, result: jobId ? { queued: true, job_type: result?.job_type ?? route?.jobType ?? null } : boundedResult(result) } });
      return { ...base, status, job_id: jobId, result: jobId ? null : boundedResult(result, 4000) };
    } catch (error) {
      const message = clean(error?.message || error, 1000);
      await rpc('ops_ai_dispatch_attach', { p_org: orgId, p_turn: turn.id, p_patch: { status: 'failed', error: message } }).catch(() => null);
      return { ...base, status: 'failed', error: message, reply: `That did not start: ${message}` };
    }
  }

  if (routeKind === 'answer' && threadId && typeof submitAnswer === 'function') {
    try {
      const submitted = await submitAnswer({ orgId, threadId, messageId, content: message, actor: options.actor });
      await rpc('ops_ai_dispatch_attach', { p_org: orgId, p_turn: turn.id, p_patch: { status: 'queued', resident_turn_id: submitted.turn_id } });
      return { ...base, status: 'queued', resident_turn_id: submitted.turn_id, reply: decision.reply || null };
    } catch (error) {
      const message = clean(error?.message || error, 1000);
      await rpc('ops_ai_dispatch_attach', { p_org: orgId, p_turn: turn.id, p_patch: { status: 'failed', error: message } }).catch(() => null);
      return { ...base, status: 'failed', error: message };
    }
  }

  return { ...base, status: turn.status };
}

/* ---------------------------------------------------------------- read */

export function relayText(view) {
  const turn = view?.turn || {};
  const job = view?.job || null;
  const approval = view?.approval || null;
  if (turn.route === 'approval') {
    if (turn.status === 'pending_approval') {
      if (approval?.state === 'approved') return 'You approved it. Say go and I will start it.';
      if (approval?.state === 'denied') return 'You denied it, so nothing ran.';
      if (approval?.state === 'expired' || (approval?.expires_at && Date.parse(approval.expires_at) < Date.now())) return 'The approval expired before it was decided. Ask again if you still want it.';
      return 'Still waiting for your approval in Control. Nothing has started.';
    }
    if (turn.status === 'denied') return 'You denied it, so nothing ran.';
    if (turn.status === 'expired') return 'The approval expired. Nothing ran.';
  }
  if (job) {
    if (job.status === 'done') return 'Finished.';
    if (job.status === 'failed' || job.status === 'dead') return `It failed${job.last_error ? `: ${String(job.last_error).slice(0, 300)}` : '.'}`;
    if (job.status === 'running') return 'Running now on McCluster Core.';
    return 'Queued on McCluster Core.';
  }
  if (turn.status === 'failed') return `It did not start${turn.error ? `: ${String(turn.error).slice(0, 300)}` : '.'}`;
  return turn.reply || null;
}

export async function getDispatch(args = {}, options = {}, deps = {}) {
  requireOwner(options.actor);
  const orgId = requireUuid(args.org_id, 'org_id');
  const turnId = requireUuid(args.turn_id, 'turn_id');
  const { rpc, getAnswer } = deps;
  const view = await rpc('ops_ai_dispatch_get', { p_org: orgId, p_turn: turnId });
  if (!view?.turn) throw Object.assign(new Error('dispatch turn not found'), { status: 404, code: 'DISPATCH_NOT_FOUND' });
  let answer = null;
  if (view.turn.resident_turn_id && typeof getAnswer === 'function') {
    try {
      const resident = await getAnswer({ orgId, turnId: view.turn.resident_turn_id });
      answer = { status: resident?.turn?.status ?? null, content: resident?.assistant_message?.content ?? null };
    } catch (error) {
      answer = { status: 'unavailable', error: clean(error?.message || error, 300) };
    }
  }
  const job = view.job ? { id: view.job.id, job_type: view.job.job_type, status: view.job.status, attempts: view.job.attempts, last_error: view.job.last_error ?? null, output: boundedResult(view.job.output, 6000), updated_at: view.job.updated_at } : null;
  return {
    schema: DISPATCH_SCHEMA,
    turn: view.turn,
    job,
    approval: view.approval || null,
    answer,
    relay: answer?.content || relayText({ ...view, job }),
  };
}

/* ---------------------------------------------------------------- execute an approved turn */

export async function executeDispatch(args = {}, options = {}, deps = {}) {
  const actorId = requireOwner(options.actor);
  const orgId = requireUuid(args.org_id, 'org_id');
  const turnId = requireUuid(args.turn_id, 'turn_id');
  const { rpc, catalog } = deps;
  // The database decides: owner actor, pending turn, approval approved,
  // unexpired and bound to the same request hash. It flips the turn to
  // "executing" in the same statement, so a second call gets nothing.
  const claim = await rpc('ops_ai_dispatch_claim', { p_org: orgId, p_actor: actorId, p_turn: turnId });
  if (!claim?.claimed) return { schema: DISPATCH_SCHEMA, turn_id: turnId, executed: false, state: claim?.state || 'unknown', relay: relayText({ turn: claim?.turn || {}, approval: claim?.approval || null }) };
  const turn = claim.turn;
  const route = routeFor(turn.intent);
  const gate = gateFor(route, catalog);
  const args2 = turn.args || {};
  // Belt and braces: the claimed call must still be exactly the routed
  // tool with exactly the approved arguments for this organization.
  if (!route || route.tool !== turn.tool || gate.decision === 'refused' || (route.takesOrg && args2.org_id !== orgId) || (!route.takesOrg && 'org_id' in args2) || requestHash(turn.tool, args2) !== turn.request_hash) {
    await rpc('ops_ai_dispatch_attach', { p_org: orgId, p_turn: turnId, p_patch: { status: 'failed', error: 'approved request no longer matches the routing table; nothing ran' } }).catch(() => null);
    throw Object.assign(new Error('approved request no longer matches the routing table; nothing ran'), { status: 409, code: 'DISPATCH_REQUEST_CHANGED' });
  }
  try {
    const result = await runRoute(route, args2, { orgId, actor: options.actor, turnId }, deps);
    const jobId = jobIdOf(result);
    const status = jobId ? 'queued' : 'done';
    await rpc('ops_ai_dispatch_attach', { p_org: orgId, p_turn: turnId, p_patch: { status, job_id: jobId, result: jobId ? { queued: true, job_type: result?.job_type ?? route?.jobType ?? null } : boundedResult(result) } });
    return { schema: DISPATCH_SCHEMA, turn_id: turnId, executed: true, status, job_id: jobId, relay: jobId ? 'Approved and started on McCluster Core.' : 'Approved and done.' };
  } catch (error) {
    const message = clean(error?.message || error, 1000);
    await rpc('ops_ai_dispatch_attach', { p_org: orgId, p_turn: turnId, p_patch: { status: 'failed', error: message } }).catch(() => null);
    return { schema: DISPATCH_SCHEMA, turn_id: turnId, executed: false, status: 'failed', error: message, relay: `It was approved but did not start: ${message}` };
  }
}
