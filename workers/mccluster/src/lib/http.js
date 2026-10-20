const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const DEFAULT_ORIGINS = [
  'https://matthew.mccluster.org',
  'https://mccluster.org',
  'https://humanuprise.com',
  'https://www.humanuprise.com',
  'https://api.mccluster.org',
  'https://esmer.mccluster.org',
  'https://mcclusterishere.github.io',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:4173',
  'http://127.0.0.1:4173'
];

export function allowedOrigins(env) {
  const extra = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const single = env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' ? [env.ALLOWED_ORIGIN] : [];
  return [...new Set([...DEFAULT_ORIGINS, ...single, ...extra])];
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowlist = allowedOrigins(env);
  const allowOrigin = origin && allowlist.includes(origin) ? origin : allowlist[0];
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-we-user-id,x-we-role,stripe-signature,x-mccluster-org-id,x-mccluster-trace-id,x-mccluster-parent-span-id',
    'access-control-expose-headers': 'x-mccluster-trace-id,x-mccluster-request-id',
    'access-control-allow-credentials': 'true',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

export function applyCors(request, env, response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function reply(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) }
  });
}

/* SQL errors can contain row values in both message and detail. Recognize
   standard and extended upstream error shapes, sanitize both response fields,
   and record only the code/status in shared logs. Domain-safe errors retain
   their explicitly shaped retry, budget, or provisioning details. */
const POSTGREST_ERROR_KEYS = ['code', 'details', 'hint', 'message'];
const SAFE_DATABASE_ERRORS = {
  MN429: 'Too many requests. Please try again later.',
  MN413: 'The submission exceeds the permitted size.',
  MN409: 'This action cannot be completed in its current state.'
};

export function isPostgrestError(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false;
  return POSTGREST_ERROR_KEYS.every(key => key in detail) ||
    (typeof detail.message === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9A-Z]+)$/.test(String(detail.code || '')));
}

export function fail(request, env, message, status = 400, detail) {
  if (isPostgrestError(detail)) {
    // Log the code, not row values or user-supplied strings. Both response
    // message and detail can originate in the same upstream SQL error.
    logEvent('warn', { event: 'error_detail_redacted', status, code: detail.code });
    message = SAFE_DATABASE_ERRORS[detail.code] || 'McCluster database request failed';
    detail = { code: detail.code };
  }
  const response = reply(request, env, { error: message, detail }, status);
  response.headers.set('cache-control', 'no-store');
  return response;
}

export function logEvent(level, fields) {
  const line = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    service: 'mccluster',
    ...fields
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function fourDigitPin() {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return String(1000 + ((bytes[0] * 256 + bytes[1]) % 9000));
}
