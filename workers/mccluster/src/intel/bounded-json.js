/* Bounded reads for the private news-context projection. Redirects are never
 * followed, so database credentials cannot travel to a provider-controlled URL.
 * Timeout covers both headers and streamed response body. */
export class ContextReadError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export async function contextJson(url, headers, { fetchImpl = fetch, timeoutMs = 8000, maxBytes = 524288 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(10000, Math.max(1, timeoutMs)));
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers });
    if (res.status >= 300 && res.status < 400) throw new ContextReadError('upstream_redirect');
    if (!res.ok) throw new ContextReadError('upstream_http_' + res.status);
    if (!res.body || Number(res.headers.get('content-length') || 0) > maxBytes) throw new ContextReadError('upstream_response_size');
    const reader = res.body.getReader(), chunks = []; let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > maxBytes) { await reader.cancel(); throw new ContextReadError('upstream_response_size'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new ContextReadError('upstream_invalid_json'); }
  } catch (error) {
    if (error instanceof ContextReadError) throw error;
    throw new ContextReadError(controller.signal.aborted ? 'upstream_timeout' : 'upstream_unavailable');
  } finally { clearTimeout(timer); }
}
