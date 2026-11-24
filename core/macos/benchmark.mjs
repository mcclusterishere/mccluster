import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export const MAC_MODEL = 'qwen3:8b';
export const MAC_CONTEXT = 4096;
export const MAC_HEADROOM_BYTES = 4 * 1024 ** 3;
const MAX_RESPONSE_BYTES = 2 * 1024 ** 2;
const DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/i;

export function localOllamaUrl(value = 'http://127.0.0.1:11434') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Ollama must use an HTTP loopback origin with no credentials or path.');
  }
  return url.origin;
}

export function processRssBytes({ platform = process.platform, run = execFileSync } = {}) {
  if (platform !== 'darwin') return null;
  try {
    const rows = run('/bin/ps', ['-axo', 'rss=,comm='], { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 ** 2 });
    const values = rows.split('\n').map(line => line.trim().match(/^(\d+)\s+(.+)$/)).filter(Boolean)
      .filter(([, , command]) => /(?:^|\/)(?:ollama|ollama_llama_server|ollama-runner)(?:\s|$)/i.test(command));
    return values.length ? values.reduce((sum, row) => sum + Number(row[1]) * 1024, 0) : null;
  } catch { return null; }
}

async function boundedJson(response) {
  if (!response.ok) throw new Error(`Local Ollama returned HTTP ${response.status}.`);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('Local Ollama response exceeds the benchmark limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function ollamaJson(base, endpoint, { fetchImpl = fetch, timeoutMs = 10_000, body } = {}) {
  return boundedJson(await fetchImpl(`${localOllamaUrl(base)}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }));
}

/** Fixed 4K context, bounded public prompt. Metrics describe this single run, not a capacity promise. */
export async function benchmarkMac({
  ollamaUrl = 'http://127.0.0.1:11434', fetchImpl = fetch,
  freeMemory = () => os.freemem(), sampleRss = () => processRssBytes(),
  now = () => performance.now(), timestamp = () => new Date().toISOString(),
  timeoutMs = 180_000, sampleIntervalMs = 250
} = {}) {
  const base = localOllamaUrl(ollamaUrl);
  const [tags, version] = await Promise.all([
    ollamaJson(base, '/api/tags', { fetchImpl }), ollamaJson(base, '/api/version', { fetchImpl })
  ]);
  const model = (tags.models || []).find(item => item.name === MAC_MODEL || item.model === MAC_MODEL);
  if (!model || !DIGEST.test(model.digest || '')) throw new Error('Install qwen3:8b locally before benchmarking; a model digest is required.');
  let minimumFree = Infinity, peakRss = null, peakAllocated = 0, peakVram = 0, loadedDigest = null;
  let sampleCount = 0, modelSamples = 0, samplingError = false, sampling = false, timer;
  function sampleMemory() {
    const available = Number(freeMemory());
    if (Number.isFinite(available) && available >= 0) minimumFree = Math.min(minimumFree, available);
    else samplingError = true;
    const rss = sampleRss();
    if (typeof rss === 'number' && Number.isFinite(rss) && rss >= 0) peakRss = Math.max(peakRss || 0, rss);
    sampleCount++;
  }
  async function sampleModel() {
    if (sampling) return;
    sampling = true;
    try {
      const ps = await ollamaJson(base, '/api/ps', { fetchImpl, timeoutMs: 3000 });
      const item = (ps.models || []).find(value => value.name === MAC_MODEL || value.model === MAC_MODEL);
      if (item) {
        modelSamples++;
        loadedDigest = item.digest || loadedDigest;
        peakAllocated = Math.max(peakAllocated, Number(item.size) || 0);
        peakVram = Math.max(peakVram, Number(item.size_vram) || 0);
      }
    } catch { samplingError = true; }
    finally { sampling = false; }
  }
  sampleMemory();
  const freeBefore = Number.isFinite(minimumFree) ? minimumFree : null;
  await sampleModel();
  const started = now();
  let firstToken = null, final = null, contentBytes = 0, streamBytes = 0, pending = '';
  const decoder = new TextDecoder();
  function event(line) {
    if (!line.trim()) return;
    let item;
    try { item = JSON.parse(line); } catch { throw new Error('The benchmark stream contained invalid JSON.'); }
    if (item.error) throw new Error('Local Ollama refused the benchmark. Check the model and local service.');
    const content = typeof item.message?.content === 'string' ? item.message.content : '';
    if (content) { if (firstToken === null) firstToken = Math.max(0, now() - started); contentBytes += Buffer.byteLength(content); }
    if (item.done === true) final = item;
  }
  try {
    timer = setInterval(() => { sampleMemory(); void sampleModel(); }, sampleIntervalMs);
    const response = await fetchImpl(`${base}/api/chat`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MAC_MODEL, stream: true, think: false, keep_alive: '5m',
        options: { num_ctx: MAC_CONTEXT, num_predict: 256, temperature: 0, seed: 17 },
        messages: [{ role: 'user', content: 'Write four concise steps for checking a project draft: read the request, check the facts, test the result, and report any limitation. Use plain language.' }] })
    });
    if (!response.ok || !response.body) throw new Error(`Local Ollama benchmark returned HTTP ${response.status}.`);
    for await (const chunk of response.body) {
      streamBytes += chunk.byteLength;
      if (streamBytes > MAX_RESPONSE_BYTES) throw new Error('Benchmark stream exceeded its size limit.');
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) event(line);
    }
    pending += decoder.decode();
    event(pending);
    clearInterval(timer);
    sampleMemory();
    // Wait for an in-flight observation before the final one; no hidden work survives return.
    while (sampling) await new Promise(resolve => setTimeout(resolve, 10));
    await sampleModel();
  } finally { clearInterval(timer); }
  const elapsed = Math.max(0, now() - started);
  const afterTags = await ollamaJson(base, '/api/tags', { fetchImpl });
  const after = (afterTags.models || []).find(item => item.name === MAC_MODEL || item.model === MAC_MODEL);
  const normalizedDigest = value => String(value || '').replace(/^sha256:/i, '').toLowerCase();
  const sameModel = normalizedDigest(after?.digest) === normalizedDigest(model.digest)
    && normalizedDigest(loadedDigest) === normalizedDigest(model.digest);
  const rate = (count, duration) => Number(count) > 0 && Number(duration) > 0 ? Number(count) * 1e9 / Number(duration) : null;
  const outputSpeed = rate(final?.eval_count, final?.eval_duration);
  const freeMin = Number.isFinite(minimumFree) ? minimumFree : null;
  const headroom = freeMin !== null && freeMin >= MAC_HEADROOM_BYTES && !samplingError;
  const passed = Boolean(final?.done && contentBytes > 0 && firstToken !== null && outputSpeed > 0
    && sameModel && headroom && modelSamples > 0 && peakVram > 0 && peakRss !== null);
  return {
    model: MAC_MODEL, implementation: 'qwen3.8b.local', model_digest: normalizedDigest(model.digest),
    quantization: model.details?.quantization_level || null, parameter_size: model.details?.parameter_size || null,
    ollama_version: String(version.version || '').slice(0, 120), measured_at: timestamp(),
    num_ctx: MAC_CONTEXT, num_predict: 256, prompt_tokens: final?.prompt_eval_count ?? null,
    generation_tokens: final?.eval_count ?? null,
    prompt_tokens_per_second: rate(final?.prompt_eval_count, final?.prompt_eval_duration),
    generation_tokens_per_second: outputSpeed, time_to_first_token_ms: firstToken, wall_ms: elapsed,
    peak_memory_bytes: peakRss, peak_memory_source: 'sampled_ollama_process_rss',
    peak_model_allocated_bytes: peakAllocated || null, peak_gpu_allocated_bytes: peakVram || null,
    memory_sample_interval_ms: sampleIntervalMs, memory_sample_count: sampleCount,
    memory_is_sampled_lower_bound: true, free_memory_before_bytes: freeBefore, free_memory_min_bytes: freeMin,
    headroom_required_bytes: MAC_HEADROOM_BYTES, headroom_passed: headroom,
    processor_gpu_percent: peakAllocated > 0 ? Math.min(100, Math.round(peakVram / peakAllocated * 100)) : null,
    model_digest_verified: sameModel, benchmark_passed: passed,
    backend_note: passed ? 'Apple Metal observed; 4K context; sampled process RSS.' : 'Benchmark incomplete or outside the measured headroom/Metal requirements.',
    recovery: passed ? null : !headroom ? 'Close memory-heavy apps and repeat the benchmark. The model remains unavailable for jobs.'
      : !sameModel ? 'The installed model changed or its digest was not observed. Repeat the benchmark with a stable local model.'
      : peakRss === null ? 'Process memory could not be measured. Run the benchmark on the target Mac.'
      : peakVram <= 0 ? 'Metal inference was not observed. Check local Ollama and its GPU support, then benchmark again.'
      : 'The response was incomplete. Check local Ollama, then repeat the benchmark.'
  };
}
