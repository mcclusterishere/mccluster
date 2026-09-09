import { fail, reply } from '../lib/http.js';
import { validateEnvelope } from './envelope.js';

const MAX_BODY = 512 * 1024;

function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function rpc(env, name, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: sbHeaders(env),
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = (data && (data.message || data.hint || data.error)) || 'McCluster AI request failed';
    throw Object.assign(new Error(message), { status: res.status >= 400 && res.status < 500 ? 400 : 502, detail: data });
  }
  return data;
}

async function houseOrgId(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orgs?slug=eq.mccluster&select=id&limit=1`, { headers: sbHeaders(env) });
  const rows = await res.json().catch(() => []);
  return rows?.[0]?.id || null;
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) throw Object.assign(new Error('payload too large'), { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('payload too large'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('invalid json'), { status: 400 }); }
}

export async function handleAiRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/v1/ai' && !path.startsWith('/v1/ai/')) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(request, env, 'McCluster is not configured', 503);
  }
  if (!user) return fail(request, env, 'Authentication required', 401);

  const orgId = url.searchParams.get('org_id') || (await houseOrgId(env));
  if (!orgId) return fail(request, env, 'McCluster house organization is not configured', 503);

  const membershipsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&select=org_id,role&limit=1`,
    { headers: sbHeaders(env) }
  );
  const memberships = await membershipsRes.json().catch(() => []);
  if (!memberships?.length) return fail(request, env, 'McCluster house owner access required', 403);

  if (path === '/v1/ai' && request.method === 'GET') {
    return reply(request, env, {
      ok: true,
      harness: 'ai_context',
      ingest: '/v1/ai/ingest',
      retrieve: '/v1/ai/retrieve',
      decisions: '/v1/ai/decisions',
      status: '/v1/ai/status'
    });
  }

  if (path === '/v1/ai/status' && request.method === 'GET') {
    const data = await rpc(env, 'ai_harness_status', { p_org: orgId });
    return reply(request, env, data);
  }

  if (path === '/v1/ai/ingest' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.org_id) body.org_id = orgId;
    const envelope = validateEnvelope(body);
    const data = await rpc(env, 'ai_ingest', { envelope });
    return reply(request, env, data, data?.duplicate ? 200 : 202);
  }

  if (path === '/v1/ai/retrieve' && request.method === 'POST') {
    const body = await readJson(request);
    const query = String(body.query || body.q || '').slice(0, 500);
    const limit = Math.max(1, Math.min(Number(body.limit) || 8, 32));
    const data = await rpc(env, 'ai_retrieve', {
      p_org: body.org_id || orgId,
      p_query: query,
      p_limit: limit
    });
    return reply(request, env, data);
  }

  if (path === '/v1/ai/decisions' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.org_id) body.org_id = orgId;
    if (!String(body.title || '').trim()) return fail(request, env, 'title required', 400);
    const data = await rpc(env, 'ai_record_decision', { envelope: body });
    return reply(request, env, data, 202);
  }

  return fail(request, env, 'Not found', 404);
}
