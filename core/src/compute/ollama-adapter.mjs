import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number(process.env.MCCLUSTER_OLLAMA_ADAPTER_PORT || 4790);
const OLLAMA = String(process.env.MCCLUSTER_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';
const MAX_QUEUE = Math.max(1, Math.min(256, Number(process.env.MCCLUSTER_OLLAMA_ADAPTER_MAX_QUEUE || 32)));

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
  for await (const chunk of req) chunks.push(chunk);
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
  const messages = Array.isArray(input.messages)
    ? input.messages
    : [{ role: 'user', content: String(input.prompt || '') }];

  if (!messages.length || !messages.some((m) => String(m?.content || '').trim())) {
    throw Object.assign(new Error('messages or prompt is required'), { status: 400, code: 'INPUT_REQUIRED' });
  }

  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages,
      format: input.json === true ? 'json' : undefined,
      options: {
        temperature: Number(input.temperature ?? 0.2),
        num_ctx: Math.min(16384, Math.max(2048, Number(input.num_ctx || 8192))),
      },
    }),
    signal: callerSignal
      ? AbortSignal.any([
          callerSignal,
          AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS || 600000)),
        ])
      : AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS || 600000)),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(data?.error || `Ollama returned HTTP ${response.status}`), {
      status: response.status,
      code: 'OLLAMA_UPSTREAM_ERROR'
    });
  }

  return {
    model: MODEL,
    implementation: body.implementation || null,
    content: String(data?.message?.content || ''),
    queue_wait_ms: queueWaitMs,
    usage: {
      prompt_eval_count: data?.prompt_eval_count ?? null,
      eval_count: data?.eval_count ?? null,
      total_duration_ns: data?.total_duration ?? null,
    },
  };
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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const check = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return send(res, check.ok ? 200 : 503, {
        ok: check.ok,
        service: 'mccluster-ollama-adapter',
        model: MODEL,
        busy: Boolean(active),
        queue_depth: pending.length,
        max_queue: MAX_QUEUE,
        last_started_at: lastStartedAt,
        last_completed_at: lastCompletedAt,
        last_error: lastError,
      });
    }

    if (req.method === 'POST' && req.url === '/execute') {
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
  console.log(JSON.stringify({ event: 'ollama_adapter_ready', host: HOST, port: PORT, model: MODEL, max_queue: MAX_QUEUE }));
});
