import { corsHeaders } from './lib/http.js';

const encoder = new TextEncoder();

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function service(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: serviceHeaders(env, init.headers || {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error(data?.message || data?.error || 'Rate limit database request failed'), { status: res.status, detail: data });
  return data;
}

async function rpc(env, name, body = {}) {
  return service(env, `rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function rateLimitResponse(request, env, result) {
  const resetEpoch = Math.ceil(Date.parse(result.reset_at) / 1000);
  const retryAfter = Math.max(1, resetEpoch - Math.floor(Date.now() / 1000));
  return new Response(JSON.stringify({
    error: 'Rate limit exceeded',
    limit_per_minute: Number(result.limit_per_minute),
    remaining: 0,
    reset_at: result.reset_at,
  }), {
    status: 429,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
      'retry-after': String(retryAfter),
      'ratelimit-limit': String(result.limit_per_minute),
      'ratelimit-remaining': '0',
      'ratelimit-reset': String(resetEpoch),
    },
  });
}

export async function enforceApiRateLimit(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/')) return null;

  const auth = request.headers.get('authorization') || '';
  const raw = auth.toLowerCase().startsWith('bearer mcc_') ? auth.slice(7).trim() : '';
  if (!raw) return null;

  const prefix = raw.slice(0, 16);
  const hash = await sha256(raw);
  const keys = await service(
    env,
    `api_keys?key_prefix=eq.${encodeURIComponent(prefix)}&secret_hash=eq.${hash}&status=eq.active&select=id,consumer_id,expires_at&limit=1`,
  );
  const key = keys?.[0];
  if (!key) return null;
  if (key.expires_at && Date.parse(key.expires_at) < Date.now()) return null;

  const rows = await rpc(env, 'api_enforce_rate_limit', {
    p_consumer_id: key.consumer_id,
    p_api_key_id: key.id,
    p_route: `${request.method} ${url.pathname}`,
  });
  const result = rows?.[0];
  if (!result) throw Object.assign(new Error('Rate limit check returned no result'), { status: 503 });
  if (!result.allowed) return rateLimitResponse(request, env, result);
  return null;
}
