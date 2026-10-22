import { handlePlatformApi as existingPlatformApi } from './platform-api.js';
import { handleDeveloperSecurity, readPublicDeveloperProfile } from './developer-security.js';
import { fail, reply } from './lib/http.js';

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
  if (!res.ok) throw Object.assign(new Error(data?.message || data?.error || 'Database request failed'), { status: res.status, detail: data });
  return data;
}

async function rpc(env, name, body = {}) {
  return service(env, `rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function apiKeyPrincipal(request, env) {
  const auth = request.headers.get('authorization') || '';
  const raw = auth.toLowerCase().startsWith('bearer mcc_') ? auth.slice(7).trim() : '';
  if (!raw) return null;
  const prefix = raw.slice(0, 16);
  const hash = await sha256(raw);
  const keys = await service(env, `api_keys?key_prefix=eq.${encodeURIComponent(prefix)}&secret_hash=eq.${hash}&status=eq.active&select=id,consumer_id,scopes,expires_at&limit=1`);
  const key = keys?.[0];
  if (!key || (key.expires_at && (!Number.isFinite(Date.parse(key.expires_at)) || Date.parse(key.expires_at) <= Date.now()))) return null;
  const consumers = await service(env, `api_consumers?id=eq.${key.consumer_id}&status=eq.active&select=id,plan_code&limit=1`);
  const consumer = consumers?.[0];
  return consumer ? { key, consumer } : null;
}

function hasScope(principal, scope) {
  return !!principal?.key?.scopes?.includes(scope);
}

function requestId(request) {
  // A GET returns fresh data, not a persisted replay. Reusing a settled
  // reservation would serve unlimited new responses for one charge.
  return crypto.randomUUID();
}

async function reserve(env, principal, id, product, endpoint, method) {
  const rows = await rpc(env, 'api_reserve_usage', {
    p_request_id: id,
    p_consumer_id: principal.consumer.id,
    p_api_key_id: principal.key.id,
    p_product_key: product,
    p_endpoint: endpoint,
    p_method: method,
    p_units: null,
    p_metadata: {},
  });
  return rows?.[0] || null;
}

async function settle(env, id, statusCode, started, { release = false, metadata = {} } = {}) {
  const rows = await rpc(env, 'api_settle_usage', {
    p_request_id: id,
    p_status_code: statusCode,
    p_actual_units: null,
    p_latency_ms: Date.now() - started,
    p_source_app_id: null,
    p_metadata: metadata,
    p_release: release,
  });
  return rows?.[0] || null;
}

async function handleMeteredMnetRead(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const feed = path === '/v1/mnet/feed' && request.method === 'GET';
  const person = request.method === 'GET' ? path.match(/^\/v1\/mnet\/people\/([^/]+)$/) : null;
  if (!feed && !person) return null;

  const auth = request.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer mcc_')) return null;

  const principal = await apiKeyPrincipal(request, env);
  if (!principal) return fail(request, env, 'Valid McCluster API key required', 401);
  if (!hasScope(principal, 'mnet:read')) return fail(request, env, 'API key scope does not allow this operation', 403);

  const started = Date.now();
  const id = requestId(request);
  await reserve(env, principal, id, 'mnet.read', path, request.method);

  try {
    if (feed) {
      const publicUrl = new URL(request.url); publicUrl.pathname = '/v1/mnet/public-feed';
      const response = await existingPlatformApi(new Request(publicUrl, request), env);
      if (!response.ok) {
        await settle(env, id, response.status, started, { release: true });
        return response;
      }
      const data = await response.json();
      const billing = await settle(env, id, 200, started);
      const result = reply(request, env, { ...data, request_id: id, billing });
      result.headers.set('cache-control', 'private, no-store');
      return result;
    }

    let mcclusterId;
    try { mcclusterId = decodeURIComponent(person[1]); } catch { mcclusterId = ''; }
    const data = await readPublicDeveloperProfile(env, mcclusterId);
    if (!data) {
      await settle(env, id, 404, started, { release: true, metadata: { reason: 'not_found' } });
      return fail(request, env, 'Person not found', 404);
    }
    const billing = await settle(env, id, 200, started);
    const result = reply(request, env, { ...data, request_id: id, billing });
    result.headers.set('cache-control', 'private, no-store');
    return result;
  } catch (error) {
    await settle(env, id, error.status || 500, started, { release: true, metadata: { reason: 'request_failed' } }).catch(() => {});
    throw error;
  }
}

export async function handlePlatformApi(request, env) {
  const developer = await handleDeveloperSecurity(request, env);
  if (developer) return developer;
  const metered = await handleMeteredMnetRead(request, env);
  if (metered) return metered;
  if (/^bearer mcc_/i.test(request.headers.get('authorization') || '') && new URL(request.url).pathname.startsWith('/v1/mnet/')) {
    return fail(request, env, 'This developer endpoint is not available through the metered public API', 403);
  }
  return existingPlatformApi(request, env);
}
