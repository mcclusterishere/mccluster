const DEFAULT_TIMEOUT_MS = 15_000;

function safeUrl(raw) {
  const url = new URL(raw);
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error(`HTTP tool endpoint must use HTTPS (or loopback HTTP): ${url.origin}`);
  }
  return url;
}

function pick(source, keys = []) {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function authHeaders(definition) {
  const headers = {};
  if (definition.bearerEnv) {
    const token = process.env[definition.bearerEnv];
    if (token) headers.authorization = `Bearer ${token}`;
  }
  if (definition.headerEnv?.name && definition.headerEnv?.env) {
    const value = process.env[definition.headerEnv.env];
    if (value) headers[definition.headerEnv.name] = value;
  }
  return headers;
}

export async function callHttpTool(definition, args = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!definition?.request?.url) throw new Error('HTTP tool request.url is required');
  const url = safeUrl(definition.request.url);
  const method = String(definition.request.method || 'GET').toUpperCase();
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  if (!allowedMethods.has(method)) throw new Error(`HTTP tool method is not allowed: ${method}`);

  for (const [key, value] of Object.entries(pick(args, definition.request.query || []))) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers = {
    accept: 'application/json',
    ...authHeaders(definition)
  };

  let body;
  if (method !== 'GET' && method !== 'DELETE') {
    const payload = definition.request.body === '*' ? args : pick(args, definition.request.body || []);
    headers['content-type'] = 'application/json';
    body = JSON.stringify(payload);
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* text response is valid */ }

  if (!res.ok) {
    const error = new Error(`HTTP tool ${definition.name} failed with ${res.status}`);
    error.status = res.status;
    error.detail = data;
    throw error;
  }

  return {
    status: res.status,
    contentType: res.headers.get('content-type') || null,
    data
  };
}
