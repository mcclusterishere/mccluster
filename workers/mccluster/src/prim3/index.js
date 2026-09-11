import { fail, reply } from '../lib/http.js';

const DEFAULT_FEED = 'https://raw.githubusercontent.com/mcclusterishere/Prim3/main/learning/course/course-feed.json';
const COURSE_ID = 'prim3-foundation';
const CACHE_SECONDS = 300;

function feedUrl(env) {
  return String(env.PRIM3_COURSE_FEED_URL || DEFAULT_FEED).trim();
}

function databaseConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}

async function authUser(request, env) {
  if (!databaseConfigured(env)) return null;
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  if (!response.ok) return null;
  return response.json();
}

async function dbRequest(env, path, options = {}) {
  if (!databaseConfigured(env)) throw Object.assign(new Error('McCluster learner database is not configured'), { status: 503 });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: serviceHeaders(env, options.headers || {})
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw Object.assign(new Error('PRIM3 learner database request failed'), { status: response.status, detail: data });
  return data;
}

function validModule(module, index) {
  return Boolean(
    module &&
    typeof module === 'object' &&
    /^M\d{2}$/.test(String(module.id || '')) &&
    Number(module.sequence) === index + 1 &&
    Number.isInteger(Number(module.season)) &&
    typeof module.episode_id === 'string' &&
    typeof module.episode_title === 'string' &&
    Array.isArray(module.concepts) &&
    Array.isArray(module.objectives) &&
    module.sources && Array.isArray(module.sources)
  );
}

function validateFeed(payload) {
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('PRIM3 course feed is not an object'), { status: 502 });
  if (payload.schema_version !== '1.0.0') throw Object.assign(new Error('Unsupported PRIM3 course feed schema'), { status: 502 });
  if (!payload.course || payload.course.id !== COURSE_ID) throw Object.assign(new Error('Unexpected PRIM3 course identity'), { status: 502 });
  if (!Array.isArray(payload.course.modules) || payload.course.modules.length !== 21) {
    throw Object.assign(new Error('PRIM3 course feed must publish exactly 21 module slots'), { status: 502 });
  }
  payload.course.modules.forEach((module, index) => {
    if (!validModule(module, index)) {
      throw Object.assign(new Error(`Invalid PRIM3 course module at sequence ${index + 1}`), { status: 502 });
    }
  });
  return payload;
}

async function fetchSource(env) {
  const source = feedUrl(env);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(source, { method: 'GET' });

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const payload = validateFeed(await hit.json());
      return {
        payload,
        meta: {
          repo: 'mcclusterishere/Prim3',
          branch: 'main',
          path: 'learning/course/course-feed.json',
          source_url: source,
          cache: 'hit',
          etag: hit.headers.get('etag') || null,
          fetched_at: hit.headers.get('x-prim3-fetched-at') || null
        }
      };
    }
  }

  const upstream = await fetch(source, {
    headers: {
      accept: 'application/json',
      'user-agent': 'McCluster-PRIM3-Course-Ingest/1.0'
    }
  });
  if (!upstream.ok) {
    throw Object.assign(new Error(`PRIM3 source feed returned ${upstream.status}`), { status: 502 });
  }

  const text = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('PRIM3 source feed is not valid JSON'), { status: 502 });
  }
  validateFeed(payload);

  const fetchedAt = new Date().toISOString();
  const etag = upstream.headers.get('etag') || null;
  if (cache) {
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      'x-prim3-fetched-at': fetchedAt
    });
    if (etag) headers.set('etag', etag);
    await cache.put(cacheKey, new Response(JSON.stringify(payload), { status: 200, headers }));
  }

  return {
    payload,
    meta: {
      repo: 'mcclusterishere/Prim3',
      branch: 'main',
      path: 'learning/course/course-feed.json',
      source_url: source,
      cache: 'miss',
      etag,
      fetched_at: fetchedAt
    }
  };
}

function normalizedModule(module) {
  return {
    id: module.id,
    sequence: Number(module.sequence),
    season: Number(module.season),
    episode_id: module.episode_id,
    episode_title: module.episode_title,
    song: module.song ?? null,
    status: module.status,
    source_slug: module.source_slug ?? null,
    concepts: module.concepts || [],
    objectives: module.objectives || [],
    labs: module.labs || {},
    sources: module.sources || []
  };
}

function normalizedCourse(payload) {
  const course = payload.course;
  return {
    id: course.id,
    title: course.title,
    subtitle: course.subtitle,
    schema_version: payload.schema_version,
    pass_mark: Number(course.pass_mark || 80),
    progression: course.progression || 'guided',
    module_count: course.modules.length,
    layers: Array.isArray(course.layers) ? course.layers : [],
    source_authorities: Array.isArray(course.source_authorities) ? course.source_authorities : [],
    modules: course.modules.map(normalizedModule)
  };
}

async function requireLearner(request, env) {
  const user = await authUser(request, env);
  if (!user) throw Object.assign(new Error('Authentication required for synced PRIM3 progress'), { status: 401 });
  return user;
}

async function getProgress(request, env) {
  const user = await requireLearner(request, env);
  const rows = await dbRequest(
    env,
    `prim3_course_progress?user_id=eq.${encodeURIComponent(user.id)}&course_id=eq.${encodeURIComponent(COURSE_ID)}&order=module_id.asc&select=module_id,reading_completed_at,assessment_score,assessment_attempts,passed_at,mastery,last_activity_at,updated_at`
  );
  return reply(request, env, { ok: true, course_id: COURSE_ID, user_id: user.id, progress: rows || [] });
}

async function saveProgress(request, env, moduleId) {
  const user = await requireLearner(request, env);
  const source = await fetchSource(env);
  const course = normalizedCourse(source.payload);
  const module = course.modules.find((item) => item.id === moduleId);
  if (!module) return fail(request, env, 'PRIM3 module not found', 404);

  let body;
  try { body = await request.json(); } catch { return fail(request, env, 'Valid JSON body required', 400); }

  const now = new Date().toISOString();
  const scoreProvided = body.assessment_score !== undefined && body.assessment_score !== null;
  const score = scoreProvided ? Math.round(Number(body.assessment_score)) : null;
  if (scoreProvided && (!Number.isFinite(score) || score < 0 || score > 100)) return fail(request, env, 'assessment_score must be 0 through 100', 400);

  const existing = await dbRequest(
    env,
    `prim3_course_progress?user_id=eq.${encodeURIComponent(user.id)}&course_id=eq.${encodeURIComponent(COURSE_ID)}&module_id=eq.${encodeURIComponent(moduleId)}&select=assessment_attempts,reading_completed_at,passed_at&limit=1`
  );
  const previous = existing?.[0] || {};
  const readingCompleted = body.reading_completed === true || Boolean(previous.reading_completed_at);
  const attempts = Number(previous.assessment_attempts || 0) + (scoreProvided ? 1 : 0);
  const passedAt = previous.passed_at || (scoreProvided && score >= course.pass_mark ? now : null);

  const row = {
    user_id: user.id,
    course_id: COURSE_ID,
    module_id: moduleId,
    reading_completed_at: readingCompleted ? (previous.reading_completed_at || now) : null,
    assessment_score: scoreProvided ? score : null,
    assessment_attempts: attempts,
    passed_at: passedAt,
    mastery: body.mastery && typeof body.mastery === 'object' && !Array.isArray(body.mastery) ? body.mastery : {},
    last_activity_at: now,
    updated_at: now
  };

  const rows = await dbRequest(
    env,
    'prim3_course_progress?on_conflict=user_id,course_id,module_id',
    {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(row)
    }
  );
  return reply(request, env, { ok: true, course_id: COURSE_ID, progress: rows?.[0] || row });
}

async function resetProgress(request, env) {
  const user = await requireLearner(request, env);
  await dbRequest(
    env,
    `prim3_course_progress?user_id=eq.${encodeURIComponent(user.id)}&course_id=eq.${encodeURIComponent(COURSE_ID)}`,
    { method: 'DELETE', headers: { prefer: 'return=minimal' } }
  );
  return reply(request, env, { ok: true, course_id: COURSE_ID, reset: true });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/v1/prim3/progress') {
    if (request.method === 'GET') return getProgress(request, env);
    if (request.method === 'DELETE') return resetProgress(request, env);
    return fail(request, env, 'Method not allowed', 405);
  }

  const progressMatch = path.match(/^\/v1\/prim3\/progress\/(M\d{2})$/i);
  if (progressMatch) {
    if (request.method !== 'POST') return fail(request, env, 'Method not allowed', 405);
    return saveProgress(request, env, progressMatch[1].toUpperCase());
  }

  if (request.method !== 'GET') return fail(request, env, 'Method not allowed', 405);

  const source = await fetchSource(env);
  const course = normalizedCourse(source.payload);

  if (path === '/v1/prim3' || path === '/v1/prim3/course') {
    return reply(request, env, { ok: true, source: source.meta, course });
  }

  if (path === '/v1/prim3/course/health') {
    return reply(request, env, {
      ok: true,
      source: source.meta,
      learner_progress: { configured: databaseConfigured(env) },
      course: {
        id: course.id,
        schema_version: course.schema_version,
        module_count: course.module_count,
        protected_open_slot: course.modules.some((module) => module.id === 'M18' && module.status === 'owner-source-required')
      }
    });
  }

  const match = path.match(/^\/v1\/prim3\/course\/modules\/(M\d{2})$/i);
  if (match) {
    const id = match[1].toUpperCase();
    const module = course.modules.find((item) => item.id === id);
    if (!module) return fail(request, env, 'PRIM3 module not found', 404);
    return reply(request, env, { ok: true, source: source.meta, course_id: course.id, module });
  }

  return fail(request, env, 'PRIM3 route not found', 404);
}

export default {
  fetch: route
};
