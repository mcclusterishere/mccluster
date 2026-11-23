import { reply } from '../lib/http.js';

export const WORLD_DISPLAY_PATH = '/v1/world/display';
const problem = (status, message, reason) => Object.assign(new Error(message), { status, reason });
const unavailable = () => problem(503, 'Public globe display setting unavailable', 'storage_unavailable');

async function rpc(env, fetchImpl, name, args) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) throw unavailable();
  let res, value;
  try {
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    res = await fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
      headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(args)
    });
    value = await res.json();
  } catch { throw unavailable(); }
  if (!res.ok && value?.code === '42501' && name === 'eup_world_display_set') {
    throw problem(403, 'House owner required', 'owner_required');
  }
  if (!res.ok || typeof value !== 'boolean') throw unavailable();
  return value;
}

const read = (env, fetchImpl) => rpc(env, fetchImpl, 'eup_world_display_read', {});

export async function handleWorldDisplay(request, env, { fetchImpl = fetch } = {}) {
  const result = request.method === 'GET'
    ? { ok: true, publicNewsHeatMap: await read(env, fetchImpl).catch(() => false) }
    : { ok: false, error: 'Method not allowed' };
  const response = reply(request, env, result, result.ok ? 200 : 405);
  response.headers.set('cache-control', 'no-store');
  return response;
}

export async function handleWorldDisplayOwner(request, env, { user, parts, fetchImpl }) {
  if (parts.length) throw problem(404, 'Not found', 'not_found');
  if (request.method === 'GET') return { ok: true, publicNewsHeatMap: await read(env, fetchImpl) };
  if (request.method !== 'PATCH') throw problem(405, 'Method not allowed', 'method_not_allowed');
  let body;
  try { body = await request.json(); } catch { throw problem(400, 'Expected JSON', 'invalid_json'); }
  if (!body || typeof body.publicNewsHeatMap !== 'boolean' || Object.keys(body).length !== 1) {
    throw problem(422, 'Expected only publicNewsHeatMap as a boolean', 'invalid_input');
  }
  return { ok: true, publicNewsHeatMap: await rpc(env, fetchImpl, 'eup_world_display_set', {
    p_actor: user.id, p_public_news_heat_map: body.publicNewsHeatMap
  }) };
}
