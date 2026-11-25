export function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? Math.trunc(number) : fallback));
}

// Box tuning (OVH Core, 8 vCPU EPYC, CPU only, Ollama capped at 6 CPUs).
// Measured 2026-10-20: a request whose num_ctx differs from the loaded runner
// forces Ollama to reload the model (~10 s on this box). Smaller requests are
// therefore raised to the resident context instead of reloading it; only a
// caller that genuinely needs MORE context pays for a reload.
// keep_alive keeps the 6.6 GB model resident (a cold load measured ~8 s).
// num_thread is optional and set by the adapter's unit when measured better.
const RESIDENT_CTX = () => boundedInt(process.env.MCCLUSTER_OLLAMA_CONTEXT, 16384, 2048, 32768);
const KEEP_ALIVE = () => /^(?:-1|\d{1,4}[smh])$/.test(String(process.env.MCCLUSTER_OLLAMA_KEEP_ALIVE || '')) ? String(process.env.MCCLUSTER_OLLAMA_KEEP_ALIVE) : '24h';

export function inferenceSettings(input = {}) {
  const resident = RESIDENT_CTX();
  const asked = boundedInt(input.num_ctx ?? resident, resident, 2048, 32768);
  const threadsEnv = Number(process.env.MCCLUSTER_OLLAMA_NUM_THREAD);
  const threads = input.num_thread != null ? boundedInt(input.num_thread, 0, 1, 64) : (Number.isFinite(threadsEnv) && threadsEnv > 0 ? boundedInt(threadsEnv, 0, 1, 64) : null);
  return {
    think: input.think === true,
    num_ctx: Math.max(asked, resident),
    num_predict: boundedInt(input.num_predict ?? 1024, 1024, 16, 4096),
    temperature: Number.isFinite(Number(input.temperature)) ? Math.min(2, Math.max(0, Number(input.temperature))) : 0.3,
    keep_alive: KEEP_ALIVE(),
    ...(threads ? { num_thread: threads } : {}),
  };
}

export function inferenceUsage(data = {}) {
  const rate = (count, duration) => Number(duration) > 0 ? Math.round(Number(count || 0) * 1e11 / duration) / 100 : null;
  return {
    prompt_eval_count: data.prompt_eval_count ?? null,
    prompt_eval_cached_count: data.prompt_eval_cached_count ?? null,
    eval_count: data.eval_count ?? null,
    total_duration_ns: data.total_duration ?? null,
    load_duration_ns: data.load_duration ?? null,
    prompt_eval_duration_ns: data.prompt_eval_duration ?? null,
    eval_duration_ns: data.eval_duration ?? null,
    prompt_tokens_per_second: rate(data.prompt_eval_count, data.prompt_eval_duration),
    generation_tokens_per_second: rate(data.eval_count, data.eval_duration),
  };
}
