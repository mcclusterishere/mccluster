import http from 'node:http';
import https from 'node:https';

const TRANSPORT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);

// Only emit controlled labels/codes. Error messages and upstream response bodies
// can contain URLs, credentials or prompts and must not enter job/health logs.
export function inferenceError(error, { signal, peer = 'adapter' } = {}) {
  const label = peer === 'ollama' ? 'Ollama' : 'Local AI adapter';
  const prefix = peer === 'ollama' ? 'OLLAMA' : 'LOCAL_AI';
  let code = error?.code;
  for (let cause = error, depth = 0; cause && depth < 4; cause = cause.cause, depth++) {
    if (TRANSPORT_CODES.has(cause.code)) { code = cause.code; break; }
  }
  if (signal?.aborted) {
    if (signal.reason?.name === 'TimeoutError') {
      return Object.assign(new Error(`${label} request deadline exceeded`), { status: 504, code: `${prefix}_TIMEOUT`, retryable: true });
    }
    return Object.assign(new Error('Local AI caller cancelled inference'), { status: 499, code: 'CALLER_ABORTED', retryable: false });
  }
  if (code === 'INFERENCE_RESPONSE_TOO_LARGE') {
    return Object.assign(new Error(`${label} response exceeded the byte limit`), { status: 502, code, retryable: false });
  }
  if (error instanceof SyntaxError || code === 'INFERENCE_INVALID_RESPONSE') {
    return Object.assign(new Error(`${label} returned invalid JSON`), { status: 502, code: 'INFERENCE_INVALID_RESPONSE', retryable: true });
  }
  const safeCode = TRANSPORT_CODES.has(code) ? code : 'INFERENCE_TRANSPORT_ERROR';
  return Object.assign(new Error(`${label} transport failed (${safeCode})`), { status: 502, code: safeCode, retryable: true });
}

export async function inferenceJson(response) {
  const data = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('Invalid inference response'), { code: 'INFERENCE_INVALID_RESPONSE' });
  }
  return data;
}

// Non-streaming inference can legitimately withhold headers for over five
// minutes. Native fetch has an independent Undici headers timeout; an
// AbortSignal does not extend it. Use a dedicated, dependency-free transport
// for these two local inference hops, with the caller's existing total deadline
// covering both headers and body. No global dispatcher or budget is changed.
export function inferenceFetch(value, { method = 'GET', headers, body, signal, maxBytes = 8 * 1024 * 1024 } = {}) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Inference requires HTTP(S)');
  if (!signal) throw new Error('Inference requires a bounded cancellation signal');
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, { method, headers, signal, agent: false }, response => {
      const chunks = [];
      let size = 0;
      const tooLarge = () => {
        const error = Object.assign(new Error('Inference response too large'), { code: 'INFERENCE_RESPONSE_TOO_LARGE' });
        reject(error);
        request.destroy(error);
      };
      response.on('error', reject);
      if (Number(response.headers['content-length']) > maxBytes) { tooLarge(); return; }
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { tooLarge(); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: response.statusCode,
          ok: response.statusCode >= 200 && response.statusCode < 300,
          json: async () => JSON.parse(text),
        });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}
