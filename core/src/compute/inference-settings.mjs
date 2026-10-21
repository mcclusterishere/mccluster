export function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? Math.trunc(number) : fallback));
}

export function inferenceSettings(input = {}) {
  return {
    think: input.think === true,
    num_ctx: boundedInt(input.num_ctx ?? 16384, 16384, 2048, 32768),
    num_predict: boundedInt(input.num_predict ?? 1024, 1024, 16, 4096),
    temperature: Number.isFinite(Number(input.temperature)) ? Math.min(2, Math.max(0, Number(input.temperature))) : 0.3,
    keep_alive: '30m',
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
