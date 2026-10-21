export async function readBoundedText(response, maxBytes = 2_097_152) {
  const tooLarge = () => Object.assign(new Error('Response exceeded the allowed byte limit'), { code: 'RESPONSE_TOO_LARGE', retryable: false });
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw tooLarge(); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function requestJson(url, { signal, timeoutMs = 10_000, maxBytes = 2_097_152, ...options } = {}, fetchImpl = globalThis.fetch) {
  const parsedTimeout = Number(timeoutMs);
  const timeout = AbortSignal.timeout(Number.isFinite(parsedTimeout) ? Math.max(1000, Math.min(30_000, parsedTimeout)) : 10_000);
  const response = await fetchImpl(url, { ...options, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const text = await readBoundedText(response, maxBytes);
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) throw Object.assign(new Error(parsed?.error || `Gateway returned HTTP ${response.status}`), { status: response.status, code: parsed?.code });
  if (parsed === null || typeof parsed !== 'object') throw new Error('Invalid gateway JSON response');
  return parsed;
}
