const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const DEFAULT_ORIGINS = [
  'https://matthew.mccluster.org',
  'https://mccluster.org',
  'https://api.mccluster.org',
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
    'access-control-allow-headers': 'authorization,content-type,x-we-user-id,x-we-role,stripe-signature',
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

export function fail(request, env, message, status = 400, detail) {
  return reply(request, env, { error: message, detail }, status);
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
