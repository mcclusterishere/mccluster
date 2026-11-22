// Bounded incremental JSON for the two loopback inference hops. Only the
// assistant's visible content is published; thinking text stays on the worker.
export async function readJsonLines(response, onItem, { maxBytes = 1_500_000, maxLineBytes = 1_000_000 } = {}) {
  if (!response?.body) throw Object.assign(new Error('Streaming response has no body'), { code: 'INFERENCE_INVALID_RESPONSE' });
  const decoder = new TextDecoder();
  let buffered = '', bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw Object.assign(new Error('Streaming response exceeded its limit'), { code: 'INFERENCE_RESPONSE_TOO_LARGE' });
    buffered += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (Buffer.byteLength(line) > maxLineBytes) throw Object.assign(new Error('Streaming line exceeded its limit'), { code: 'INFERENCE_RESPONSE_TOO_LARGE' });
      if (line) await onItem(JSON.parse(line));
    }
    if (Buffer.byteLength(buffered) > maxLineBytes) throw Object.assign(new Error('Streaming line exceeded its limit'), { code: 'INFERENCE_RESPONSE_TOO_LARGE' });
  }
  buffered += decoder.decode();
  if (buffered.trim()) await onItem(JSON.parse(buffered));
}

export async function collectOllamaStream(response, onProgress, { now = () => performance.now(), startedAt = now() } = {}) {
  let content = '', thinkingChars = 0, final = null, sequence = 0, firstTokenMs = null;
  const toolCalls = [];
  await readJsonLines(response, async (item) => {
    if (item.error) throw Object.assign(new Error('Ollama stream failed'), { code: 'OLLAMA_UPSTREAM_ERROR' });
    const delta = typeof item.message?.content === 'string' ? item.message.content : '';
    if (delta && firstTokenMs === null) firstTokenMs = Math.max(0, now() - startedAt);
    content += delta;
    if (content.length > 60_000) throw Object.assign(new Error('Assistant response exceeded its limit'), { code: 'INFERENCE_RESPONSE_TOO_LARGE' });
    thinkingChars += String(item.message?.thinking || '').length;
    if (Array.isArray(item.message?.tool_calls)) toolCalls.push(...item.message.tool_calls);
    if (toolCalls.length > 32) throw Object.assign(new Error('Too many tool calls'), { code: 'INFERENCE_RESPONSE_TOO_LARGE' });
    if (delta) await onProgress?.({ content, sequence: ++sequence, time_to_first_token_ms: firstTokenMs });
    if (item.done === true) final = item;
  });
  if (!final) throw Object.assign(new Error('Ollama stream ended before completion'), { code: 'INFERENCE_INVALID_RESPONSE' });
  return { ...final, message: { role: 'assistant', content, tool_calls: toolCalls }, thinking_chars: thinkingChars, time_to_first_token_ms: firstTokenMs };
}

export async function collectAdapterStream(response, onProgress) {
  let result, content = '';
  await readJsonLines(response, async (item) => {
    if (item.type === 'progress') {
      content += typeof item.progress?.delta === 'string' ? item.progress.delta : '';
      if (content.length > 60_000) throw Object.assign(new Error('Assistant response exceeded its limit'), { code: 'INFERENCE_RESPONSE_TOO_LARGE' });
      await onProgress?.({ ...item.progress, content });
    }
    else if (item.type === 'result') result = item.result;
    else if (item.type === 'error') throw Object.assign(new Error('Local inference stream stopped'), { code: item.code || 'INFERENCE_STREAM_FAILED', retryable: item.retryable === true });
    else throw Object.assign(new Error('Invalid inference stream event'), { code: 'INFERENCE_INVALID_RESPONSE' });
  });
  if (!result || typeof result !== 'object') throw Object.assign(new Error('Inference stream ended without a result'), { code: 'INFERENCE_INVALID_RESPONSE' });
  return result;
}
