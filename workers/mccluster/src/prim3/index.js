import { fail, reply } from '../lib/http.js';

const DEFAULT_FEED = 'https://raw.githubusercontent.com/mcclusterishere/Prim3/main/learning/course/course-feed.json';
const COURSE_ID = 'prim3-foundation';
const CACHE_SECONDS = 300;

function feedUrl(env) {
  return String(env.PRIM3_COURSE_FEED_URL || DEFAULT_FEED).trim();
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

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

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
