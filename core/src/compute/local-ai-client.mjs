const ADAPTER = String(process.env.MCCLUSTER_OLLAMA_ADAPTER_URL || 'http://127.0.0.1:4790').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';

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

export async function localAiChat({
  messages,
  prompt,
  temperature = 0.2,
  numCtx = Number(process.env.MCCLUSTER_OLLAMA_CONTEXT || 16384),
  json = false,
  priority = -20,
  timeoutMs = Number(process.env.MCCLUSTER_OLLAMA_TIMEOUT_MS || 10 * 60_000),
  metadata = {},
} = {}, { fetchImpl = globalThis.fetch } = {}) {
  const normalizedMessages = Array.isArray(messages) ? messages : undefined;
  const normalizedPrompt = normalizedMessages ? undefined : String(prompt || '');
  if ((!normalizedMessages || !normalizedMessages.some((item) => String(item?.content || '').trim())) && !normalizedPrompt.trim()) {
    throw Object.assign(new Error('local AI requires messages or prompt'), { status: 400, retryable: false });
  }

  let response;
  try {
    response = await fetchImpl(`${ADAPTER}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capability: 'ai.chat',
        implementation: 'core-local',
        priority: normalizePriority(priority),
        input: {
          ...(normalizedMessages ? { messages: normalizedMessages } : { prompt: normalizedPrompt }),
          temperature: Number(temperature),
          num_ctx: Math.min(16384, Math.max(2048, Number(numCtx || 8192))),
          json: Boolean(json),
        },
        metadata: {
          source: 'core-local-ai-client',
          ...metadata,
        },
      }),
      signal: AbortSignal.timeout(Math.max(30_000, Number(timeoutMs || 600_000))),
    });
  } catch (error) {
    if (error && error.retryable === undefined) error.retryable = true;
    throw error;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || `Local AI adapter returned HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.code || null;
    error.retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    throw error;
  }

  const content = String(data?.content || '');
  return {
    model: data?.model || MODEL,
    implementation: data?.implementation || null,
    message: { content },
    prompt_eval_count: data?.usage?.prompt_eval_count ?? null,
    eval_count: data?.usage?.eval_count ?? null,
    total_duration: data?.usage?.total_duration_ns ?? null,
    queue_wait_ms: data?.queue_wait_ms ?? null,
  };
}
