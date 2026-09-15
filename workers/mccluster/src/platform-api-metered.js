import { handlePlatformApi as existingPlatformApi } from './platform-api.js';
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
  if (!key || (key.expires_at && Date.parse(key.expires_at) < Date.now())) return null;
  const consumers = await service(env, `api_consumers?id=eq.${key.consumer_id}&status=eq.active&select=id,plan_code&limit=1`);
  const consumer = consumers?.[0];
  return consumer ? { key, consumer } : null;
}

function hasScope(principal, scope) {
  return !!principal?.key?.scopes?.includes(scope);
}

function requestId(request) {
  return request.headers.get('idempotency-key') || request.headers.get('x-request-id') || crypto.randomUUID();
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
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
      const rows = await service(env, `network_feed_items?visibility=eq.public&order=occurred_at.desc&limit=${limit}&select=*`);
      const billing = await settle(env, id, 200, started);
      return reply(request, env, { items: rows || [], scope: 'public', request_id: id, billing });
    }

    const mcclusterId = decodeURIComponent(person[1]);
    const identities = await service(env, `platform_profiles?mccluster_id=ilike.${encodeURIComponent(mcclusterId)}&select=user_id,display_name,avatar_url,mccluster_id&limit=1`);
    if (!identities?.length) {
      await settle(env, id, 404, started, { release: true, metadata: { reason: 'not_found' } });
      return fail(request, env, 'Person not found', 404);
    }
    const links = await service(env, `m_auth_user_links?auth_user_id=eq.${identities[0].user_id}&is_primary=eq.true&select=m_uid&limit=1`);
    const muid = links?.[0]?.m_uid;
    const profiles = muid ? await service(env, `network_profiles?m_uid=eq.${muid}&select=*&limit=1`) : [];
    const billing = await settle(env, id, 200, started);
    return reply(request, env, { identity: identities[0], profile: profiles?.[0] || null, request_id: id, billing });
  } catch (error) {
    await settle(env, id, error.status || 500, started, { release: true, metadata: { reason: 'request_failed' } }).catch(() => {});
    throw error;
  }
}

export async function handlePlatformApi(request, env) {
  const metered = await handleMeteredMnetRead(request, env);
  if (metered) return metered;
  return existingPlatformApi(request, env);
}
