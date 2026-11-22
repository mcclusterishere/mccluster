import { inferenceFetch, inferenceJson, inferenceError } from './inference-http.mjs';
import { cancelQueuedComputeTask, computeTaskById, enqueueComputeTask, listNodes } from './store.mjs';
import { validateChatImages } from './ai-chat-images.mjs';
import { ownerRoutedChat } from './owner-routing.mjs';

const ADAPTER = String(process.env.MCCLUSTER_OLLAMA_ADAPTER_URL || 'http://127.0.0.1:4790').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';
// The name this box answers under in the node badge of a local-route reply.
const LOCAL_NODE_NAME = process.env.MCCLUSTER_NODE_NAME || 'core-local';

function assertLoopbackAdapter(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error('MCCLUSTER_OLLAMA_ADAPTER_URL must be a loopback HTTP(S) endpoint');
  }
  return value;
}

assertLoopbackAdapter(ADAPTER);

function normalizePriority(value) {
  const parsed = Math.trunc(Number(value || 0));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-100, Math.min(100, parsed));
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

// Fabric-first (MCCLUSTER_LOCAL_AI_FABRIC=prefer): Core's own ai.chat work is
// offered to a live GPU-verified compute node through the durable task queue,
// with a bounded wait, before the loopback adapter on this box runs it. Off by
// default; the fabric path only ever talks to Supabase through store.mjs,
// never to a node directly.
const FABRIC_MODES = new Set(['off', 'prefer']);

// The implementations that can see, tried in order for any turn that carries
// an image (or asks for vision): the owner's resident vision model first.
export function visionImplementations(env = process.env) {
  return String(env.MCCLUSTER_LOCAL_AI_VISION_IMPLEMENTATIONS || 'qwen3-vl.8b.local,qwen3-vl.4b.local').split(',').map((s) => s.trim()).filter(Boolean);
}

export function fabricConfigFromEnv(env = process.env) {
  const rawMode = String(env.MCCLUSTER_LOCAL_AI_FABRIC || 'off').trim().toLowerCase();
  const excludeNodes = new Set(String(env.MCCLUSTER_LOCAL_AI_FABRIC_EXCLUDE_NODES ?? 'ovh-primary').split(',').map((s) => s.trim()).filter(Boolean));
  if (env.MCCLUSTER_NODE_NAME) excludeNodes.add(String(env.MCCLUSTER_NODE_NAME).trim());
  return {
    mode: FABRIC_MODES.has(rawMode) ? rawMode : 'invalid',
    waitMs: clampInt(env.MCCLUSTER_LOCAL_AI_FABRIC_WAIT_MS, 120_000, 10_000, 600_000),
    pollMs: clampInt(env.MCCLUSTER_LOCAL_AI_FABRIC_POLL_MS, 1_500, 250, 10_000),
    runningWaitMs: clampInt(env.MCCLUSTER_LOCAL_AI_FABRIC_RUNNING_WAIT_MS, 600_000, 30_000, 3_600_000),
    implementation: String(env.MCCLUSTER_LOCAL_AI_FABRIC_IMPLEMENTATION || 'qwen3.8b.local'),
    visionImplementations: visionImplementations(env),
    // A vision model on this box's own adapter (unset on OVH): without it an
    // image turn never runs locally.
    localVisionModel: env.MCCLUSTER_OLLAMA_VISION_MODEL ? String(env.MCCLUSTER_OLLAMA_VISION_MODEL).trim() || null : null,
    excludeNodes,
    orgId: env.MCCLUSTER_ORG_ID || null,
  };
}

function defaultFabric() {
  return { ...fabricConfigFromEnv(), listNodes, enqueueComputeTask, computeTaskById, cancelQueuedComputeTask };
}

const defaultLog = (record) => console.log(JSON.stringify(record));
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let fabricDisabledLogged = null;

// One input object for both paths: what the local adapter receives as
// /execute input is exactly what a node's adapter receives as the task input.
function buildInput({ messages, prompt, temperature, numCtx, json, think, numPredict, tools, schema, model }) {
  const normalizedMessages = Array.isArray(messages) ? messages : undefined;
  const normalizedPrompt = normalizedMessages ? undefined : String(prompt || '');
  return {
    ...(normalizedMessages ? { messages: normalizedMessages } : { prompt: normalizedPrompt }),
    temperature: Number(temperature),
    num_ctx: Math.min(32768, Math.max(2048, Number(numCtx || 16384))),
    num_predict: numPredict,
    think: think === true,
    ...(Array.isArray(tools) && tools.length ? { tools } : {}),
    json: Boolean(json),
    ...(schema && typeof schema === 'object' ? { schema, json: true } : {}),
    ...(model ? { model: String(model) } : {}),
  };
}

// The adapter's /execute JSON (posted verbatim by a node as the lease result,
// or answered by the local adapter) in the shape every caller reads.
// Which device answered: the live node row by the task's locked_by_node_id for
// the fabric route, this box for the local route. The measured rate is the
// doctor's sidecar figure for exactly the model that answered, never a guess.
function nodeBadge({ route, node = null, nodeId = null, data }) {
  const rate = Number.isFinite(Number(data?.usage?.generation_tokens_per_second)) && data?.usage?.generation_tokens_per_second != null ? Number(data.usage.generation_tokens_per_second) : null;
  if (route !== 'fabric') {
    return { route: 'local', node_id: null, node_name: LOCAL_NODE_NAME, site: null, hardware_mode: null, generation_tokens_per_second: rate, measured_generation_tokens_per_second: null };
  }
  const model = data?.model || null;
  const measured = model ? node?.inventory?.runtime?.measured_inference_by_model?.[model]?.generation_tokens_per_second : null;
  return {
    route: 'fabric',
    node_id: node?.id || nodeId || null,
    node_name: node?.display_name || null,
    site: node?.labels?.site ?? null,
    hardware_mode: node?.inventory?.runtime?.hardware_mode ?? null,
    generation_tokens_per_second: rate,
    measured_generation_tokens_per_second: measured != null && Number.isFinite(Number(measured)) ? Number(measured) : null
  };
}

function shapeChatResult(data, { route, computeTaskId = null, fabric, node = null, nodeId = null, imagesIn = 0 }) {
  const content = String(data?.content || '');
  return {
    model: data?.model || MODEL,
    implementation: data?.implementation || null,
    message: { role: 'assistant', content, ...(Array.isArray(data?.tool_calls) && data.tool_calls.length ? { tool_calls: data.tool_calls } : {}) },
    usage: data?.usage || {},
    settings: data?.settings || null,
    done_reason: data?.done_reason || null,
    thinking_chars: data?.thinking_chars ?? null,
    prompt_eval_count: data?.usage?.prompt_eval_count ?? null,
    eval_count: data?.usage?.eval_count ?? null,
    total_duration: data?.usage?.total_duration_ns ?? null,
    queue_wait_ms: data?.queue_wait_ms ?? null,
    route,
    compute_task_id: computeTaskId,
    fabric,
    node: nodeBadge({ route, node, nodeId, data }),
    images_in: Number.isInteger(data?.images_in) ? data.images_in : imagesIn,
  };
}

// Live gpu-verified nodes (this box and the excluded names aside) advertising
// ai.chat/<implementation> with every required feature other than gpu (which
// gpu-verified already proves) set true on that entry.
function eligibleNodes(nodes, fabric, implementation, features = {}) {
  const required = Object.entries(features || {}).filter(([key, value]) => value === true && key !== 'gpu').map(([key]) => key);
  return (Array.isArray(nodes) ? nodes : []).filter((node) => node
    && !fabric.excludeNodes.has(node.display_name)
    && node?.inventory?.runtime?.hardware_mode === 'gpu-verified'
    && (Array.isArray(node.capabilities) ? node.capabilities : []).some((entry) => entry?.capability === 'ai.chat'
      && entry?.implementation === implementation
      && required.every((key) => entry?.features?.[key] === true)));
}

// The first implementation candidate some live node can take right now.
function chooseImplementation(nodes, fabric, candidates, features) {
  for (const implementation of candidates) {
    const eligible = eligibleNodes(nodes, fabric, implementation, features);
    if (eligible.length) return { implementation, eligible };
  }
  return { implementation: null, eligible: [] };
}

function callerAborted(taskId) {
  return Object.assign(new Error('Local AI caller cancelled inference'), { status: 499, code: 'CALLER_ABORTED', retryable: false, compute_task_id: taskId });
}

// Returns { outcome: 'done', data, waitMs } or { outcome: 'fallback', reason, waitMs };
// throws LOCAL_AI_FABRIC_TIMEOUT or CALLER_ABORTED. Never runs anything itself,
// and never reports a fallback while a node may still own the task: a local run
// follows only a task that was canceled while queued, or one that failed.
async function fabricChat({ input, priority, metadata, signal, fabric, now, sleep, log, budgetMs, candidates, features }) {
  let nodes;
  try { nodes = await fabric.listNodes({ orgId: fabric.orgId, liveOnly: true, limit: 500 }); }
  catch (error) {
    log({ event: 'local_ai_fabric_fallback', reason: 'no_eligible_node', task_id: null, error: String(error?.message || error).slice(0, 200) });
    return { outcome: 'fallback', reason: 'no_eligible_node', waitMs: null, logged: true };
  }
  const { implementation, eligible } = chooseImplementation(nodes, fabric, candidates, features);
  if (!implementation) return { outcome: 'fallback', reason: 'no_eligible_node', waitMs: null, candidates };

  let taskId = null;
  try {
    const { task } = await fabric.enqueueComputeTask({
      orgId: fabric.orgId,
      capability: 'ai.chat',
      implementation,
      input,
      requirements: { features: { gpu: true, ...features } },
      priority: normalizePriority(priority),
      maxAttempts: 1,
      metadata: { source: 'local-ai-fabric', requested_at: new Date().toISOString(), ...metadata },
    });
    taskId = task?.id || null;
  } catch (error) {
    log({ event: 'local_ai_fabric_fallback', reason: 'enqueue_failed', task_id: null, error: String(error?.message || error).slice(0, 200) });
    return { outcome: 'fallback', reason: 'enqueue_failed', waitMs: null, logged: true };
  }
  if (!taskId) return { outcome: 'fallback', reason: 'enqueue_failed', waitMs: null };
  log({ event: 'local_ai_fabric_enqueued', task_id: taskId, nodes: eligible.length, implementation, candidates });

  const start = now();
  // The caller's budget (timeoutMs) bounds the fabric: at most half of it is
  // spent waiting for a claim, so a local fallback keeps the other half, and
  // the whole of it is the most a held task may take before the retryable
  // timeout. The configured waits only ever shorten those bounds.
  const queuedDeadline = start + Math.min(fabric.waitMs, Math.floor(budgetMs / 2));
  const runningBound = start + Math.min(fabric.waitMs + fabric.runningWaitMs, budgetMs);
  let failedReads = 0;
  let lastStatus = 'queued';
  const tryCancel = async (reason) => {
    try { return await fabric.cancelQueuedComputeTask({ orgId: fabric.orgId, taskId, reason }); }
    catch { return null; }
  };
  const abort = async () => {
    // Still queued, or nobody could say: take it back if it is still ours.
    if (lastStatus === 'queued' || lastStatus === 'unknown') await tryCancel('canceled: caller aborted');
    throw callerAborted(taskId);
  };
  const timeout = (status) => {
    log({ event: 'local_ai_fabric_timeout', task_id: taskId, status, wait_ms: now() - start });
    return Object.assign(new Error('Local AI fabric task is still running after the bounded wait'), {
      status: 504, code: 'LOCAL_AI_FABRIC_TIMEOUT', retryable: true, compute_task_id: taskId,
    });
  };
  while (true) {
    if (signal?.aborted) await abort();
    await sleep(fabric.pollMs);
    if (signal?.aborted) await abort();
    let task = null;
    try { task = await fabric.computeTaskById({ orgId: fabric.orgId, taskId }); }
    catch { task = null; }
    if (!task) {
      failedReads += 1;
      if (failedReads < 3) continue;
      // Three reads failed, so ownership is unknown. A queued task is taken
      // back first: a returned row means it is gone and a local run is safe.
      // Null (a node holds it, or it already ended) or a failed cancel means
      // a node may own it, so the local adapter is never called; polling goes
      // on to the running bound and then the retryable timeout is thrown.
      failedReads = 0;
      const canceled = await tryCancel('canceled: local-ai-fabric task reads failed');
      if (canceled) {
        const waitMs = now() - start;
        log({ event: 'local_ai_fabric_canceled', task_id: taskId, wait_ms: waitMs, reason: 'poll_failed' });
        return { outcome: 'fallback', reason: 'poll_failed', waitMs, taskId };
      }
      lastStatus = 'unknown';
      if (now() >= runningBound) throw timeout('unknown');
      continue;
    }
    failedReads = 0;
    lastStatus = task.status;
    if (task.status === 'done') {
      const waitMs = now() - start;
      const nodeId = task.locked_by_node_id || null;
      log({ event: 'local_ai_fabric_done', task_id: taskId, wait_ms: waitMs, node_id: nodeId, implementation });
      return { outcome: 'done', data: task.output, waitMs, taskId, implementation, nodeId, node: (Array.isArray(nodes) ? nodes : []).find((node) => node?.id === nodeId) || null };
    }
    if (task.status === 'failed' || task.status === 'canceled') {
      return { outcome: 'fallback', reason: 'failed', waitMs: now() - start, status: task.status, taskId, lastError: task.last_error == null ? null : String(task.last_error).slice(0, 300) };
    }
    if (now() < queuedDeadline) continue;
    if (task.status === 'queued') {
      const canceled = await tryCancel('canceled: local-ai-fabric wait exceeded');
      if (canceled) {
        const waitMs = now() - start;
        log({ event: 'local_ai_fabric_canceled', task_id: taskId, wait_ms: waitMs, reason: 'wait_timeout' });
        return { outcome: 'fallback', reason: 'wait_timeout_canceled', waitMs, taskId };
      }
      // The status moved under us (a node owns it now), or the cancel itself
      // failed: either way the task is not ours to run, so keep polling.
      if (now() >= runningBound) throw timeout(task.status);
      continue;
    }
    if ((task.status === 'leased' || task.status === 'running') && now() >= runningBound) throw timeout(task.status);
  }
}

export async function localAiChat({
  messages,
  prompt,
  temperature = 0.2,
  numCtx = Number(process.env.MCCLUSTER_OLLAMA_CONTEXT || 16384),
  json = false,
  think = false,
  numPredict = 1024,
  tools,
  schema,
  model,
  priority = -20,
  timeoutMs = Number(process.env.MCCLUSTER_OLLAMA_TIMEOUT_MS || 10 * 60_000),
  metadata = {},
  route = 'auto',
  implementation,
  requirements,
  signal: callerSignal,
  ownerRoute,
  ownerExecution,
  orgId,
  onProgress,
  onTask,
} = {}, { fetchImpl = inferenceFetch, fabric = defaultFabric, now = Date.now, sleep = defaultSleep, log = defaultLog } = {}) {
  const normalizedMessages = Array.isArray(messages) ? messages : undefined;
  const normalizedPrompt = normalizedMessages ? undefined : String(prompt || '');
  if ((!normalizedMessages || !normalizedMessages.some((item) => String(item?.content || '').trim())) && !normalizedPrompt.trim()) {
    throw Object.assign(new Error('local AI requires messages or prompt'), { status: 400, retryable: false });
  }
  // Images are validated here, before any node or adapter sees them (400 codes).
  const imagesIn = normalizedMessages ? validateChatImages({ messages: normalizedMessages }).images : 0;
  const input = buildInput({ messages, prompt, temperature, numCtx, json, think, numPredict, tools, schema, model });

  if (ownerRoute) return ownerRoutedChat({ route: ownerRoute, orgId, input, priority, metadata, timeoutMs, signal: callerSignal, onProgress, onTask, ownerExecution });

  // One budget for the whole call, fabric attempt included: the local floor of
  // 30 s is the only thing that can stretch it.
  const budgetMs = Math.max(30_000, Number(timeoutMs || 600_000));
  const startedAt = now();
  let fabricResult = { attempted: false, reason: 'disabled', wait_ms: null };
  const config = typeof fabric === 'function' ? fabric() : fabric;

  // Per-call routing: the caller may name implementation candidates (tried in
  // order) and feature requirements. Any image, or an explicit vision
  // requirement, means the vision implementations and features.vision; the
  // local adapter may take an image only when this box names a vision model.
  const requestedFeatures = Object.fromEntries(Object.entries(requirements?.features || {}).filter(([, value]) => value === true));
  const wantsVision = imagesIn > 0 || requestedFeatures.vision === true;
  const features = { ...requestedFeatures, ...(imagesIn > 0 ? { vision: true } : {}) };
  const explicit = Array.isArray(implementation) ? implementation.filter(Boolean).map(String) : (implementation ? [String(implementation)] : []);
  const candidates = explicit.length
    ? explicit
    : (wantsVision ? (config?.visionImplementations || visionImplementations()) : [config?.implementation || 'qwen3.8b.local']);
  const localVisionModel = config?.localVisionModel || null;
  const forcedFabric = route === 'fabric' || (imagesIn > 0 && !localVisionModel);
  const noNodeError = () => (wantsVision
    ? Object.assign(new Error(`No live GPU-verified node advertises a vision implementation (${candidates.join(', ')}); the images were not sent to a text model`), { status: 503, code: 'LOCAL_AI_NO_VISION_NODE', retryable: false })
    : Object.assign(new Error(`No live GPU-verified node advertises ${candidates.join(', ')}`), { status: 503, code: 'LOCAL_AI_NO_FABRIC_NODE', retryable: true }));

  if (route !== 'local' && (forcedFabric || config?.mode !== 'off')) {
    const disabledReason = !config?.orgId ? 'no_org' : (!forcedFabric && config?.mode !== 'prefer' ? 'invalid_mode' : null);
    if (disabledReason) {
      if (forcedFabric) throw noNodeError();
      if (fabricDisabledLogged !== disabledReason) {
        fabricDisabledLogged = disabledReason;
        log({ event: 'local_ai_fabric_disabled', reason: disabledReason });
      }
    } else {
      const attempt = await fabricChat({ input, priority, metadata, signal: callerSignal, fabric: config, now, sleep, log, budgetMs, candidates, features });
      if (attempt.outcome === 'done') {
        return shapeChatResult(attempt.data, { route: 'fabric', computeTaskId: attempt.taskId ?? null, fabric: { attempted: true, reason: 'done', wait_ms: attempt.waitMs }, node: attempt.node, nodeId: attempt.nodeId, imagesIn });
      }
      if (!attempt.logged) log({ event: 'local_ai_fabric_fallback', reason: attempt.reason, task_id: attempt.taskId ?? null, ...(attempt.status ? { status: attempt.status } : {}) });
      if (forcedFabric) {
        // No local run for a forced fabric turn: say exactly why instead.
        if (attempt.reason === 'no_eligible_node') throw noNodeError();
        if (attempt.reason === 'failed') {
          throw Object.assign(new Error(`Local AI fabric task ${attempt.status}${attempt.lastError ? `: ${attempt.lastError}` : ''}`), { status: 502, code: 'LOCAL_AI_FABRIC_FAILED', retryable: false, compute_task_id: attempt.taskId ?? null });
        }
        throw Object.assign(new Error(`Local AI fabric could not run the task (${attempt.reason})`), { status: 503, code: 'LOCAL_AI_FABRIC_UNAVAILABLE', retryable: true, compute_task_id: attempt.taskId ?? null });
      }
      fabricResult = { attempted: true, reason: attempt.reason, wait_ms: attempt.waitMs };
    }
  }
  if (imagesIn > 0 && localVisionModel && !input.model) input.model = localVisionModel;

  const timeout = AbortSignal.timeout(Math.max(30_000, budgetMs - (now() - startedAt)));
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  let response;
  let data;
  try {
    response = await fetchImpl(`${ADAPTER}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capability: 'ai.chat',
        implementation: 'core-local',
        priority: normalizePriority(priority),
        input,
        metadata: {
          source: 'core-local-ai-client',
          ...metadata,
        },
      }),
      signal,
    });
    data = await inferenceJson(response);
  } catch (error) {
    throw inferenceError(error, { signal });
  }
  if (!response.ok) {
    const safeCode = typeof data?.code === 'string' && /^(?:INPUT_REQUIRED|UNSUPPORTED_CAPABILITY|OLLAMA_TIMEOUT|CALLER_ABORTED|AI_QUEUE_FULL|OLLAMA_UPSTREAM_ERROR|INFERENCE_(?:TRANSPORT_ERROR|INVALID_RESPONSE|RESPONSE_TOO_LARGE)|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_(?:HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET))$/.test(data?.code) ? data.code : null;
    const error = new Error(`Local AI adapter returned HTTP ${response.status}${safeCode ? ` (${safeCode})` : ''}`);
    error.status = response.status;
    error.code = safeCode;
    error.retryable = safeCode !== 'INFERENCE_RESPONSE_TOO_LARGE' && (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500);
    throw error;
  }

  return shapeChatResult(data, { route: 'local', computeTaskId: null, fabric: fabricResult, imagesIn });
}

export async function localAiEmbed(input, { model, fetchImpl = globalThis.fetch, timeoutMs = 130_000 } = {}) {
  const response = await fetchImpl(`${ADAPTER}/embed`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, ...(model ? { model: String(model) } : {}) }), signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.error || `Local embedding returned ${response.status}`), { status: response.status, code: data?.code || null, retryable: response.status >= 500 });
  return data;
}

export async function localAiPullModel(model, { fetchImpl = globalThis.fetch, timeoutMs = 1_560_000 } = {}) {
  const response = await fetchImpl(`${ADAPTER}/models/pull`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: String(model || '') }), signal: AbortSignal.timeout(timeoutMs),
  });
  return response.json().catch(() => ({ ok: false, error: `adapter returned ${response.status}` }));
}

export async function localAiDiagnostics({ fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(`${ADAPTER}/diagnostics`, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `AI diagnostics returned ${response.status}`);
  return body;
}
