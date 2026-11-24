import http from 'node:http';
import { inferenceFetch, inferenceJson, inferenceError } from './inference-http.mjs';
import { inferenceSettings, inferenceUsage } from './inference-settings.mjs';
import { validateChatImages } from './ai-chat-images.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.MCCLUSTER_OLLAMA_ADAPTER_PORT || 4790);
const OLLAMA = String(process.env.MCCLUSTER_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';
// Extra local models a caller may name (comma-separated allowlist). Anything
// else, or an extra model that is not installed yet, runs on MODEL instead.
const EXTRA_MODELS = String(process.env.MCCLUSTER_OLLAMA_EXTRA_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
// Resident models stay loaded (keep_alive from inference-settings); every other
// allowlisted model is on demand and unloads after a short idle window so it
// never pushes the resident ones out of memory.
const RESIDENT_MODELS = new Set([MODEL, ...String(process.env.MCCLUSTER_OLLAMA_RESIDENT_MODELS || '').split(',').map(s => s.trim()).filter(Boolean)]);
const ON_DEMAND_KEEP_ALIVE = /^(?:\d{1,4}[smh])$/.test(String(process.env.MCCLUSTER_OLLAMA_ON_DEMAND_KEEP_ALIVE || '')) ? String(process.env.MCCLUSTER_OLLAMA_ON_DEMAND_KEEP_ALIVE) : '5m';
const EMBED_MODEL = String(process.env.MCCLUSTER_OLLAMA_EMBED_MODEL || 'nomic-embed-text:v1.5');
const MAX_QUEUE = Math.max(1, Math.min(256, Number(process.env.MCCLUSTER_OLLAMA_ADAPTER_MAX_QUEUE || 32)));

// Implementation -> model map (MCCLUSTER_OLLAMA_IMPLEMENTATIONS=impl=model,...).
// The implementation id is the durable contract the scheduler matched, so it
// decides the model before any caller-named model. A bad map is a start-up
// error: say so on stderr and refuse to listen.
const IMPLEMENTATION_ID = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9._-]+)?$/;
function parseImplementations(raw) {
  const map = {};
  for (const part of String(raw || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const index = part.indexOf('=');
    if (index < 0) throw new Error(`entry "${part}" is not impl=model`);
    const implementation = part.slice(0, index).trim();
    const model = part.slice(index + 1).trim();
    if (!IMPLEMENTATION_ID.test(implementation)) throw new Error(`implementation id "${implementation}" is invalid`);
    if (!MODEL_NAME.test(model)) throw new Error(`model name for "${implementation}" is invalid`);
    if (Object.hasOwn(map, implementation)) throw new Error(`implementation "${implementation}" is listed twice`);
    map[implementation] = model;
  }
  return map;
}
let IMPLEMENTATIONS = {};
try {
  IMPLEMENTATIONS = parseImplementations(process.env.MCCLUSTER_OLLAMA_IMPLEMENTATIONS);
} catch (error) {
  console.error(JSON.stringify({ event: 'ollama_adapter_config_error', setting: 'MCCLUSTER_OLLAMA_IMPLEMENTATIONS', error: error.message }));
  process.exit(1);
}
const MAPPED_MODELS = new Set(Object.values(IMPLEMENTATIONS));
const ALLOWED_MODELS = new Set([MODEL, ...EXTRA_MODELS, ...MAPPED_MODELS]);
// Models that take images: the exact set from MCCLUSTER_OLLAMA_VISION_MODELS
// when given, else every allowlisted model whose name says it sees
// (qwen3-vl:* or gemma4:*). A text model never receives an image.
const VISION_MODELS_ENV = String(process.env.MCCLUSTER_OLLAMA_VISION_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
const VISION_MODELS = VISION_MODELS_ENV.length
  ? new Set(VISION_MODELS_ENV)
  : new Set([...ALLOWED_MODELS].filter(model => /^(?:qwen3-vl|gemma4):/i.test(model)));
// The think key is sent only to thinking models; instruct-only builds reject
// it. MCCLUSTER_OLLAMA_THINK_MODELS is the exact set when given; the default is
// the default model plus every mapped qwen3 or qwen3-vl model that is not an
// instruct build, which is byte-identical to the old "default model only" rule
// without a map.
const THINK_MODELS_ENV = String(process.env.MCCLUSTER_OLLAMA_THINK_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
const THINK_MODELS = THINK_MODELS_ENV.length
  ? new Set(THINK_MODELS_ENV)
  : new Set([MODEL, ...[...MAPPED_MODELS].filter(model => /^qwen3(?:-vl)?:(?!.*instruct)/i.test(model))]);
// GET /api/ps is the engine's own account of what is loaded and whether it sits
// in VRAM; it is read at most once per window and never costs a generation.
const EVIDENCE_TTL_MS = Math.max(5_000, Number(process.env.MCCLUSTER_OLLAMA_EVIDENCE_TTL_MS) || 60_000);
// Load each installed resident model once after start-up (laptop nodes), so the
// node has engine evidence within a minute of a reboot. Off by default. While
// the daemon does not answer (the tray app starts after the adapter's startup
// task) the attempt repeats every WARM_RETRY_MS for at most WARM_WINDOW_MS.
const WARM_ON_START = String(process.env.MCCLUSTER_OLLAMA_WARM_ON_START || '') === 'true';
const WARM_RETRY_MS = Math.max(1_000, Number(process.env.MCCLUSTER_OLLAMA_WARM_RETRY_MS) || 30_000);
const WARM_WINDOW_MS = Math.max(WARM_RETRY_MS, Number(process.env.MCCLUSTER_OLLAMA_WARM_WINDOW_MS) || 900_000);

function keepAliveFor(model, settings) { return RESIDENT_MODELS.has(model) ? settings.keep_alive : ON_DEMAND_KEEP_ALIVE; }
function pickModel(body) {
  const implementation = body?.implementation;
  if (implementation && Object.hasOwn(IMPLEMENTATIONS, implementation)) return { model: IMPLEMENTATIONS[implementation], source: 'implementation' };
  const requested = body?.input?.model;
  if (requested && ALLOWED_MODELS.has(String(requested))) return { model: String(requested), source: 'input' };
  return { model: MODEL, source: 'default' };
}

let active = null;
let sequence = 0;
let lastStartedAt = null;
let lastCompletedAt = null;
let lastError = null;
const pending = [];

function send(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Loopback only; large enough for a vision request's base64 image.
    if (size > 8 * 1024 * 1024) throw Object.assign(new Error('request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function normalizePriority(value) {
  const parsed = Math.trunc(Number(value || 0));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-100, Math.min(100, parsed));
}

function callerAbortedError() {
  return Object.assign(new Error('Local AI caller disconnected before inference completed'), {
    status: 499,
    code: 'CALLER_ABORTED',
  });
}

async function execute(body, queuedAt, callerSignal) {
  const queueWaitMs = Math.max(0, Date.now() - queuedAt);
  if (body.capability !== 'ai.chat') {
    throw Object.assign(new Error(`unsupported capability: ${body.capability}`), { status: 400, code: 'UNSUPPORTED_CAPABILITY' });
  }

  const input = body.input || {};
  const settings = inferenceSettings(input);
  const messages = Array.isArray(input.messages)
    ? input.messages
    : [{ role: 'user', content: String(input.prompt || '') }];

  if (!messages.length || !messages.some((m) => String(m?.content || '').trim())) {
    throw Object.assign(new Error('messages or prompt is required'), { status: 400, code: 'INPUT_REQUIRED' });
  }

  // Images ride on messages[].images exactly as Ollama takes them: validated
  // from the bytes by the shared module, passed through untouched, and never
  // put in front of a model that cannot see.
  const { images: imagesIn } = validateChatImages(input);
  const { model: requestedModel, source: modelSource } = pickModel(body);
  if (imagesIn > 0 && !VISION_MODELS.has(requestedModel)) {
    throw Object.assign(new Error(`model ${requestedModel} does not take images`), { status: 400, code: 'AI_CHAT_IMAGE_MODEL_NOT_VISION' });
  }
  // One existing deadline covers the full execution, including a model fallback.
  const timeout = AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS || 600000));
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const callOllama = async (model) => {
    try {
      const response = await inferenceFetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          messages,
          // Only thinking models take the flag; instruct-only builds reject it.
          ...(THINK_MODELS.has(model) ? { think: settings.think } : {}),
          keep_alive: keepAliveFor(model, settings),
          tools: Array.isArray(input.tools) ? input.tools.slice(0, 16) : undefined,
          // A JSON Schema object constrains decoding to that shape (Ollama structured
          // outputs); plain json:true keeps the old free-form JSON mode.
          format: input.schema && typeof input.schema === 'object' ? input.schema : (input.json === true ? 'json' : undefined),
          options: {
            temperature: settings.temperature,
            num_ctx: settings.num_ctx,
            num_predict: settings.num_predict,
            ...(settings.num_thread ? { num_thread: settings.num_thread } : {}),
          },
        }),
        signal,
      });
      return { response, data: await inferenceJson(response) };
    } catch (error) {
      throw inferenceError(error, { signal, peer: 'ollama' });
    }
  };

  let usedModel = requestedModel;
  let fallbackFrom = null;
  let { response, data } = await callOllama(usedModel);
  // A missing mapped model falls back to the default model, except when the
  // request carries images and the default cannot see them.
  if (!response.ok && usedModel !== MODEL && (imagesIn === 0 || VISION_MODELS.has(MODEL)) && (response.status === 404 || /not found|pull/i.test(String(data?.error || '')))) {
    fallbackFrom = usedModel; usedModel = MODEL;
    ({ response, data } = await callOllama(usedModel));
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Ollama returned HTTP ${response.status}`), {
      status: response.status,
      code: 'OLLAMA_UPSTREAM_ERROR'
    });
  }
  // Metering (the contract is docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md
  // on branch prime/contribution-ledger, not in this tree): the digest of the
  // model that served this execution and the daemon's version, read from the
  // same daemon (GET /api/tags, GET /api/version) right after the generation,
  // while this execution still holds the adapter's single slot, and returned
  // with the result rather than taken from an earlier /health probe. Ollama's
  // /api/chat answer carries no digest, so this is a second read and not
  // atomic with the completion: a pull of the same tag that lands between the
  // two is not detected. Null when the daemon cannot say; never a failure.
  const runtime = await runtimeEvidence(usedModel);

  return {
    model: usedModel,
    model_source: modelSource,
    ...(fallbackFrom ? { fallback_from: fallbackFrom } : {}),
    implementation: body.implementation || null,
    content: String(data?.message?.content || ''),
    tool_calls: Array.isArray(data?.message?.tool_calls) ? data.message.tool_calls : [],
    done_reason: data?.done_reason || null,
    settings,
    thinking_chars: String(data?.message?.thinking || '').length,
    images_in: imagesIn,
    queue_wait_ms: queueWaitMs,
    usage: { ...inferenceUsage(data), model_digest: runtime.model_digest, ollama_version: runtime.ollama_version },
  };
}

async function readVersion() {
  try {
    const response = await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.version ? String(data.version).slice(0, 64) : null;
  } catch { return null; }
}

async function runtimeEvidence(model) {
  const [{ tags }, version] = await Promise.all([readTags(), readVersion()]);
  const installed = tags?.models?.find(item => modelMatches(item, model));
  return { model_digest: installed?.digest ? String(installed.digest) : null, ollama_version: version };
}

function pump() {
  if (active || !pending.length) return;
  pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
  const item = pending.shift();
  active = item;
  lastStartedAt = new Date().toISOString();

  if (item.signal?.aborted) {
    active = null;
    item.cleanup?.();
    item.reject(callerAbortedError());
    queueMicrotask(pump);
    return;
  }

  execute(item.body, item.queuedAt, item.signal)
    .then((result) => {
      lastError = null;
      lastCompletedAt = new Date().toISOString();
      item.resolve(result);
    })
    .catch((error) => {
      lastError = String(error?.message || error).slice(0, 1000);
      lastCompletedAt = new Date().toISOString();
      item.reject(error);
    })
    .finally(() => {
      item.cleanup?.();
      active = null;
      queueMicrotask(pump);
    });
}

function enqueueInference(body, signal) {
  if (pending.length >= MAX_QUEUE) {
    throw Object.assign(new Error('Local AI queue is full'), { status: 503, code: 'AI_QUEUE_FULL' });
  }
  if (signal?.aborted) throw callerAbortedError();

  return new Promise((resolve, reject) => {
    const item = {
      body,
      priority: normalizePriority(body.priority),
      sequence: ++sequence,
      queuedAt: Date.now(),
      signal,
      resolve,
      reject,
      cleanup: null,
    };
    const onAbort = () => {
      const index = pending.indexOf(item);
      if (index >= 0) {
        pending.splice(index, 1);
        item.cleanup?.();
        reject(callerAbortedError());
      }
      // If this item is active, execute() observes the same signal and aborts
      // the upstream Ollama fetch rather than burning the only model slot for
      // a caller that can no longer receive the result.
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      item.cleanup = () => signal.removeEventListener('abort', onAbort);
    }
    pending.push(item);
    pump();
  });
}

function modelMatches(item, name) { return item && (item.name === name || item.model === name); }

// One bounded read of the daemon's model list; the error text is bounded too.
async function readTags() {
  try {
    const response = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { tags: null, error: `tags: HTTP ${response.status}` };
    const tags = await response.json();
    return { tags: { models: Array.isArray(tags?.models) ? tags.models : [] }, error: null };
  } catch (error) {
    return { tags: null, error: String(error?.message || error).slice(0, 300) };
  }
}

function implementationsFrom(tags) {
  const models = tags?.models || [];
  return Object.entries(IMPLEMENTATIONS).map(([implementation, model]) => {
    const installed = models.find(item => modelMatches(item, model));
    return { implementation, model, installed: Boolean(installed), digest: installed?.digest ? String(installed.digest) : null, vision: VISION_MODELS.has(model) };
  });
}

// Engine evidence for the node's hardware_mode: the loaded model with the most
// VRAM, as GET /api/ps reports it (size_vram 0 = loaded on the CPU). Cached for
// EVIDENCE_TTL_MS; null when the daemon cannot answer.
let evidenceCache = { at: 0, value: null };
async function gpuEvidence() {
  if (Date.now() - evidenceCache.at < EVIDENCE_TTL_MS) return evidenceCache.value;
  let value = null;
  try {
    const response = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const data = await response.json();
      const models = Array.isArray(data?.models) ? data.models.filter(item => item && typeof item === 'object') : [];
      const checked_at = new Date().toISOString();
      if (!models.length) {
        value = { source: 'ollama:/api/ps', model: null, size_vram_bytes: 0, size_bytes: 0, processor_gpu_percent: null, running_models: 0, checked_at };
      } else {
        const top = models.reduce((best, item) => ((Number(item.size_vram) || 0) > (Number(best.size_vram) || 0) ? item : best), models[0]);
        const size = Math.max(0, Number(top.size) || 0);
        const vram = Math.max(0, Number(top.size_vram) || 0);
        value = {
          source: 'ollama:/api/ps', model: top.name || top.model || null, size_vram_bytes: vram, size_bytes: size,
          processor_gpu_percent: size > 0 ? Math.max(0, Math.min(100, Math.round(vram / size * 100))) : null,
          running_models: models.length, checked_at,
        };
      }
    }
  } catch { value = null; }
  evidenceCache = { at: Date.now(), value };
  return value;
}

// Readiness probe. Liveness (daemon reachable) and readiness (configured
// default model installed with a digest; optional bounded inference) are
// reported separately so a daemon with zero installed models is never "ok".
const READY_PROBE = String(process.env.MCCLUSTER_OLLAMA_READY_PROBE || '') === 'true';
const READY_PROBE_TTL_MS = 60_000;
let lastInferenceProbe = null;
async function readiness({ inference = false } = {}) {
  const result = {
    ok: false, daemon_reachable: false, model_installed: false, digest: null,
    inference_probe: inference ? 'pending' : 'skipped', error: null, implementations: [],
  };
  const { tags, error } = await readTags();
  if (!tags) { result.error = error; return result; }
  result.daemon_reachable = true;
  result.implementations = implementationsFrom(tags);
  const installed = tags.models.find(item => modelMatches(item, MODEL));
  if (!installed || !installed.digest) {
    result.error = installed ? 'default model has no digest' : 'default model is not installed';
    return result;
  }
  result.model_installed = true;
  result.digest = String(installed.digest);
  if (!inference) { result.ok = true; return result; }
  // Bounded one-token probe, never while a real job holds the single slot, and
  // cached briefly so repeated deploy probes do not reload the model.
  if (lastInferenceProbe && Date.now() - lastInferenceProbe.at < READY_PROBE_TTL_MS && lastInferenceProbe.digest === result.digest) {
    result.inference_probe = lastInferenceProbe.ok ? 'ok' : 'failed';
    result.ok = lastInferenceProbe.ok;
    if (!lastInferenceProbe.ok) result.error = lastInferenceProbe.error;
    return result;
  }
  if (active) { result.inference_probe = 'busy'; result.ok = true; return result; }
  try {
    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, stream: false, think: false, messages: [{ role: 'user', content: 'ok' }], options: { num_predict: 1 } }),
      signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_READY_PROBE_TIMEOUT_MS || 20_000)),
    });
    const ok = response.ok;
    const error = ok ? null : `inference probe: HTTP ${response.status}`;
    lastInferenceProbe = { at: Date.now(), digest: result.digest, ok, error };
    result.inference_probe = ok ? 'ok' : 'failed'; result.ok = ok; result.error = error;
  } catch (error) {
    const message = String(error?.message || error).slice(0, 300);
    lastInferenceProbe = { at: Date.now(), digest: result.digest, ok: false, error: message };
    result.inference_probe = 'failed'; result.error = message;
  }
  return result;
}

// Per-implementation readiness (GET /ready?implementation=<id>): 200 only when
// that implementation's model is installed with a digest, so a model that is
// not pulled yet takes only its own manifest entry down.
async function implementationReadiness(implementation) {
  if (!Object.hasOwn(IMPLEMENTATIONS, implementation)) {
    return { status: 404, body: { ok: false, error: 'unknown implementation', code: 'UNKNOWN_IMPLEMENTATION', implementation } };
  }
  const model = IMPLEMENTATIONS[implementation];
  const body = {
    ok: false, daemon_reachable: false, implementation, model, vision: VISION_MODELS.has(model), model_installed: false, digest: null,
    inference_probe: 'skipped', gpu_evidence: await gpuEvidence(), error: null, busy: Boolean(active), queue_depth: pending.length,
  };
  const { tags, error } = await readTags();
  if (!tags) return { status: 503, body: { ...body, error } };
  body.daemon_reachable = true;
  const installed = tags.models.find(item => modelMatches(item, model));
  if (!installed || !installed.digest) return { status: 503, body: { ...body, error: installed ? 'model has no digest' : 'model is not installed' } };
  return { status: 200, body: { ...body, ok: true, model_installed: true, digest: String(installed.digest) } };
}

// Resident models are loaded once with a 16-token chat through the normal
// single-slot queue (lowest priority), so a rebooted node earns engine
// evidence within a minute instead of waiting for its first task. After a
// reboot the adapter's startup task runs before the Ollama tray app exists,
// so a daemon that does not answer is tried again every WARM_RETRY_MS until
// WARM_WINDOW_MS has passed; every attempt is logged, and so is the window
// ending without a daemon.
async function warmResidentModels({ startedAt = Date.now(), attempt = 1 } = {}) {
  const { tags, error } = await readTags();
  if (!tags) {
    const retry = Date.now() - startedAt + WARM_RETRY_MS <= WARM_WINDOW_MS;
    console.log(JSON.stringify({ event: 'ollama_adapter_warm', model: null, ok: false, wall_ms: 0, error, attempt, next_in_ms: retry ? WARM_RETRY_MS : null }));
    if (!retry) {
      console.log(JSON.stringify({ event: 'ollama_adapter_warm_window_ended', attempts: attempt, window_ms: WARM_WINDOW_MS }));
      return;
    }
    const timer = setTimeout(() => {
      warmResidentModels({ startedAt, attempt: attempt + 1 }).catch((retryError) => console.log(JSON.stringify({ event: 'ollama_adapter_warm', model: null, ok: false, wall_ms: 0, error: String(retryError?.message || retryError).slice(0, 200), attempt: attempt + 1, next_in_ms: null })));
    }, WARM_RETRY_MS);
    timer.unref();
    return;
  }
  for (const model of RESIDENT_MODELS) {
    if (!ALLOWED_MODELS.has(model) || !tags.models.some(item => modelMatches(item, model))) continue;
    const started = Date.now();
    try {
      await enqueueInference({ capability: 'ai.chat', implementation: null, input: { prompt: 'ok', num_predict: 16, think: false, model }, priority: -100 });
      console.log(JSON.stringify({ event: 'ollama_adapter_warm', model, ok: true, wall_ms: Date.now() - started }));
    } catch (warmError) {
      console.log(JSON.stringify({ event: 'ollama_adapter_warm', model, ok: false, wall_ms: Date.now() - started, error: String(warmError?.message || warmError).slice(0, 200) }));
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    let url;
    try { url = new URL(req.url || '/', 'http://127.0.0.1'); }
    catch { return send(res, 400, { error: 'invalid request url' }); }
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /diagnostics') {
      const read = async (path, body) => {
        const response = await fetch(`${OLLAMA}/api/${path}`, {
          ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        return response.json();
      };
      const [version, tags, show, running, evidence] = await Promise.all([
        read('version'), read('tags'), read('show', { model: MODEL }), read('ps'), gpuEvidence(),
      ]);
      const installed = tags.models?.find(item => item.name === MODEL || item.model === MODEL);
      const isInstalled = name => Boolean(tags.models?.some(item => item.name === name || item.model === name));
      const isRunning = name => Boolean((running.models || []).some(item => item.name === name || item.model === name));
      return send(res, 200, {
        observed_at: new Date().toISOString(), ollama_version: version.version, model: MODEL,
        digest: installed?.digest || null, size_bytes: installed?.size || null,
        details: show.details || installed?.details || null, capabilities: show.capabilities || [],
        model_info: show.model_info || {}, model_parameters: show.parameters || null,
        thinking_support: show.thinking || null,
        running: (running.models || []).filter(item => item.name === MODEL || item.model === MODEL),
        extra_models: EXTRA_MODELS.map(name => ({ name, installed: isInstalled(name), running: isRunning(name) })),
        implementations: Object.entries(IMPLEMENTATIONS).map(([implementation, model]) => ({ implementation, model, installed: isInstalled(model), running: isRunning(model), vision: VISION_MODELS.has(model) })),
        gpu_evidence: evidence,
        defaults: inferenceSettings(), busy: Boolean(active), queue_depth: pending.length,
        max_concurrency: 1,
      });
    }
    // Liveness: this process is up and the Ollama daemon answers. It says
    // nothing about whether the configured model can run; /ready does.
    if (route === 'GET /health') {
      const [probe, evidence] = await Promise.all([readiness({ inference: false }), gpuEvidence()]);
      return send(res, probe.daemon_reachable ? 200 : 503, {
        ok: probe.daemon_reachable,
        ready: probe.ok,
        service: 'mccluster-ollama-adapter',
        model: MODEL,
        model_installed: probe.model_installed,
        implementations: probe.implementations,
        gpu_evidence: evidence,
        busy: Boolean(active),
        queue_depth: pending.length,
        max_queue: MAX_QUEUE,
        last_started_at: lastStartedAt,
        last_completed_at: lastCompletedAt,
        last_error: lastError,
      });
    }
    // Readiness: the configured default model is installed with a digest (and,
    // when MCCLUSTER_OLLAMA_READY_PROBE=true, a bounded one-token inference
    // succeeds). A daemon with no usable model answers 503 here, so a deploy
    // gate that probes this route cannot pass on liveness alone. With
    // ?implementation=<id> the verdict is that implementation's model instead.
    if (route === 'GET /ready') {
      const implementation = url.searchParams.get('implementation');
      if (implementation !== null) {
        const verdict = await implementationReadiness(implementation);
        return send(res, verdict.status, verdict.body);
      }
      const [probe, evidence] = await Promise.all([readiness({ inference: READY_PROBE }), gpuEvidence()]);
      return send(res, probe.ok ? 200 : 503, {
        ...probe,
        service: 'mccluster-ollama-adapter',
        model: MODEL,
        gpu_evidence: evidence,
        busy: Boolean(active),
        queue_depth: pending.length,
      });
    }

    // Embeddings: text in, vectors out, on the allowlisted embedding model.
    if (route === 'POST /embed') {
      const body = await readJson(req);
      const model = body.model ? String(body.model) : EMBED_MODEL;
      if (model !== EMBED_MODEL && !EXTRA_MODELS.includes(model)) return send(res, 400, { error: 'model is not an allowlisted embedding model', code: 'MODEL_NOT_ALLOWED' });
      const input = (Array.isArray(body.input) ? body.input : [body.input]).map(t => String(t ?? '').slice(0, 8000));
      if (!input.length || input.length > 64 || input.some(t => !t.trim())) return send(res, 400, { error: 'input must be 1 to 64 non-empty texts', code: 'INPUT_REQUIRED' });
      const started = Date.now();
      const response = await fetch(`${OLLAMA}/api/embed`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input, keep_alive: '24h' }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) return send(res, response.status === 404 ? 503 : 502, { error: data?.error || `Ollama returned HTTP ${response.status}`, code: 'OLLAMA_UPSTREAM_ERROR', model });
      const embeddings = Array.isArray(data?.embeddings) ? data.embeddings : [];
      return send(res, 200, { model, embeddings, dims: embeddings[0]?.length || 0, wall_ms: Date.now() - started });
    }

    // Install an allowlisted model (the default, MCCLUSTER_OLLAMA_EXTRA_MODELS
    // or a mapped implementation model) through the Ollama daemon and report
    // exactly what it said. Loopback only, like every route here; any other
    // model name is refused.
    if (route === 'POST /models/pull') {
      const body = await readJson(req);
      const name = String(body.model || '');
      if (!ALLOWED_MODELS.has(name)) return send(res, 400, { ok: false, error: 'model is not an allowlisted model', model: name });
      const started = Date.now();
      try {
        const pulled = await fetch(`${OLLAMA}/api/pull`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: name, stream: false }),
          signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_PULL_TIMEOUT_MS || 1_500_000)),
        });
        const data = await pulled.json().catch(() => null);
        return send(res, pulled.ok ? 200 : 502, { ok: pulled.ok && data?.status === 'success', model: name, http_status: pulled.status, status: data?.status || null, error: data?.error || null, wall_ms: Date.now() - started });
      } catch (error) {
        return send(res, 502, { ok: false, model: name, error: String(error?.message || error).slice(0, 300), wall_ms: Date.now() - started });
      }
    }

    if (route === 'POST /execute') {
      const body = await readJson(req);
      const caller = new AbortController();
      const abortCaller = () => caller.abort();
      req.once('aborted', abortCaller);
      res.once('close', () => {
        if (!res.writableEnded) abortCaller();
      });
      const result = await enqueueInference(body, caller.signal);
      return send(res, 200, result);
    }

    return send(res, 404, { error: 'not found' });
  } catch (error) {
    return send(res, Number(error?.status || 500), {
      error: String(error?.message || error),
      code: error?.code || null,
      busy: Boolean(active),
      queue_depth: pending.length,
    });
  }
});

server.listen(PORT, HOST, () => {
  // The ready event stays the first stdout line; fixtures read it to find the port.
  console.log(JSON.stringify({ event: 'ollama_adapter_ready', host: HOST, port: server.address().port, model: MODEL, max_queue: MAX_QUEUE, implementations: Object.keys(IMPLEMENTATIONS).length }));
  if (WARM_ON_START) {
    warmResidentModels().catch((error) => console.log(JSON.stringify({ event: 'ollama_adapter_warm', model: null, ok: false, wall_ms: 0, error: String(error?.message || error).slice(0, 200) })));
  }
});
