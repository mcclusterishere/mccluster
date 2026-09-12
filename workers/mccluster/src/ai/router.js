import { fail, reply } from '../lib/http.js';
import { queueObjectiveSynthesis } from './objectives.js';

const MAX_BODY = 512 * 1024;

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function houseOrgId(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orgs?slug=eq.mccluster&select=id&limit=1`, {
    headers: serviceHeaders(env)
  });
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

async function callContextFunction(request, env, name, body) {
  const authorization = request.headers.get('authorization') || '';
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const message = data?.error || data?.message || `${name} failed`;
    throw Object.assign(new Error(message), {
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
      detail: data
    });
  }
  return { status: res.status, data };
}

async function countJobs(env, orgId, status) {
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, select: 'id' });
  if (status) params.set('status', `eq.${status}`);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?${params.toString()}`, {
    headers: { ...serviceHeaders(env), Prefer: 'count=exact', Range: '0-0' }
  });
  if (!res.ok) return null;
  const range = res.headers.get('content-range') || '';
  const match = range.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
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
    { headers: serviceHeaders(env) }
  );
  const memberships = await membershipsRes.json().catch(() => []);
  if (!memberships?.length) return fail(request, env, 'McCluster house owner access required', 403);

  if (path === '/v1/ai' && request.method === 'GET') {
    return reply(request, env, {
      ok: true,
      harness: 'ai_context-v2',
      durable_jobs: 'ops_agent_jobs',
      ingest: '/v1/ai/ingest',
      objective_synthesis: 'automatic after ingest unless synthesize_objectives=false',
      retrieve: '/v1/ai/retrieve',
      decisions: '/v1/ai/decisions',
      status: '/v1/ai/status'
    });
  }

  if (path === '/v1/ai/status' && request.method === 'GET') {
    const [total, queued, running, failed] = await Promise.all([
      countJobs(env, orgId),
      countJobs(env, orgId, 'queued'),
      countJobs(env, orgId, 'running'),
      countJobs(env, orgId, 'failed')
    ]);
    return reply(request, env, {
      ok: true,
      harness: 'ai_context-v2',
      context: {
        ingest: 'context-ingest',
        query: 'context-query',
        decisions: 'context-decision'
      },
      execution: {
        table: 'ops_agent_jobs',
        jobs: { total, queued, running, failed },
        conversation_objectives: 'objective_synthesis'
      }
    });
  }

  if (path === '/v1/ai/ingest' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.org_id) body.org_id = orgId;
    if (body.org_id !== orgId) return fail(request, env, 'cross-org ingestion denied', 403);
    const { status, data } = await callContextFunction(request, env, 'context-ingest', body);
    let synthesis;
    try {
      synthesis = await queueObjectiveSynthesis(env, { orgId, ingestBody: body, ingestResult: data });
    } catch (error) {
      synthesis = { queued: false, error: error instanceof Error ? error.message : String(error) };
    }
    return reply(request, env, {
      ...(data && typeof data === 'object' ? data : { ingest_result: data }),
      objective_synthesis: synthesis
    }, status);
  }

  if (path === '/v1/ai/retrieve' && request.method === 'POST') {
    const body = await readJson(request);
    const payload = {
      org_id: body.org_id || orgId,
      query: String(body.query || body.q || '').slice(0, 4000),
      limit: Math.max(1, Math.min(Number(body.limit) || 12, 50)),
      include_messages: body.include_messages,
      include_memories: body.include_memories
    };
    if (payload.org_id !== orgId) return fail(request, env, 'cross-org retrieval denied', 403);
    const { status, data } = await callContextFunction(request, env, 'context-query', payload);
    return reply(request, env, data, status);
  }

  if (path === '/v1/ai/decisions' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.org_id) body.org_id = orgId;
    if (body.org_id !== orgId) return fail(request, env, 'cross-org decision denied', 403);
    if (!String(body.title || '').trim()) return fail(request, env, 'title required', 400);
    if (!String(body.decision || body.rationale || '').trim()) return fail(request, env, 'decision required', 400);
    const { status, data } = await callContextFunction(request, env, 'context-decision', body);
    return reply(request, env, data, status);
  }

  return fail(request, env, 'Not found', 404);
}
