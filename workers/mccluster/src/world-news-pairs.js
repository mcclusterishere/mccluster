/* NEWS ABOUT THIS MAP ITEM, AND THE MAP ITEM FOR THIS HEADLINE.

     GET /v1/world/news-pairs?layer=<layer>&entity_key=<key>   the headlines paired with one Halo item
     GET /v1/world/news-pairs?article_id=<uuid>                the Halo items paired with one headline

   Pairs are made on McCluster Core (core/src/executors/world-news-pairing.mjs)
   and kept in world_news_pairs for seven days; see
   docs/control-plane/WORLD-NEWS-PAIRING.md. The Halo layers are owner-only,
   so this is too: the bearer must be the house owner's (houseOwnerOf, checked
   with Supabase, failing closed), every answer is `private, no-store`, and
   Supabase is read with the service role, read only. An article's location
   is where it MENTIONS a place, and a pair is a match, not a verified fact:
   each carries its method, score and reason. A layer the owner withdrew
   (WORLD_GLOBE_WITHDRAWN) stays withdrawn here too: asking by it is refused
   and its pairs are left out of an answer by article. */
import { globeRelease } from '../../../packages/release-policy/globe.mjs';
import { fail, reply } from './lib/http.js';
import { houseOwnerOf } from './world-halo-ops.js';
import { service, uuid } from './world-cctv.js';

export const NEWS_PAIRS_PATH = '/v1/world/news-pairs';
export const NEWS_PAIR_LAYERS = Object.freeze(['quakes', 'cyclones', 'natural', 'fires', 'perimeters', 'launches', 'satellites', 'vessels', 'weather']);
const ENTITY_KEY = /^[A-Za-z0-9:._{}-]{1,160}$/;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const PAIR_FIELDS = 'article_id,layer,entity_key,entity_name,entity_lat,entity_lon,entity_time,score,method,reason,created_at';

function privately(res) {
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
const send = (request, env, body, status = 200) => privately(reply(request, env, body, status));

const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n) || null : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function httpUrl(v) {
  if (typeof v !== 'string' || v.length > 2000) return null;
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null; } catch { return null; }
}

export function parsePairsQuery(url) {
  const q = url.searchParams;
  const rawLimit = Number(q.get('limit') || DEFAULT_LIMIT);
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(MAX_LIMIT, rawLimit)) : DEFAULT_LIMIT;
  const articleId = q.get('article_id');
  if (articleId !== null) {
    if (!uuid(articleId) || q.has('layer') || q.has('entity_key')) return { error: 'article_id must be a UUID, on its own' };
    return { by: 'article', articleId: articleId.toLowerCase(), limit };
  }
  const layer = q.get('layer'), key = q.get('entity_key');
  if (!NEWS_PAIR_LAYERS.includes(layer || '') || !ENTITY_KEY.test(key || '')) return { error: 'ask with layer and entity_key, or with article_id' };
  return { by: 'entity', layer, key, limit };
}

export async function handleWorldNewsPairs(request, env, { fetchImpl = fetch } = {}) {
  const url = new URL(request.url);
  if ((url.pathname.replace(/\/+$/, '') || '/') !== NEWS_PAIRS_PATH) return null;
  if (request.method !== 'GET') return privately(fail(request, env, 'Method not allowed', 405));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return send(request, env, { ok: false, error: 'not configured' }, 503);
  if (!(await houseOwnerOf(request, env, fetchImpl))) return send(request, env, { ok: false, code: 'owner_only', error: 'Only the house owner may see this.' }, 403);
  const query = parsePairsQuery(url);
  if (query.error) return send(request, env, { ok: false, code: 'invalid_query', error: query.error }, 400);
  const withdrawn = (layer) => globeRelease(layer, env) === 'withdrawn';
  if (query.by === 'entity' && withdrawn(query.layer)) return send(request, env, { ok: false, code: 'feature_withdrawn', error: 'This globe feature is withdrawn.' }, 403);

  const filter = query.by === 'article'
    ? `article_id=eq.${query.articleId}&order=score.desc,created_at.desc`
    : `layer=eq.${query.layer}&entity_key=eq.${encodeURIComponent(query.key)}&order=created_at.desc`;
  let pairs, articles;
  try {
    pairs = (await service(env, `world_news_pairs?${filter}&select=${PAIR_FIELDS}&limit=${query.limit}`, fetchImpl))
      .filter((p) => NEWS_PAIR_LAYERS.includes(p.layer) && !withdrawn(p.layer));
    const ids = [...new Set(pairs.map((p) => p.article_id).filter(uuid))];
    articles = ids.length ? await service(env, `media_news_articles?id=in.(${ids.join(',')})&select=id,title,canonical_url,published_at,headline_location_label`, fetchImpl) : [];
  } catch {
    return send(request, env, { ok: false, code: 'unavailable', error: 'Pairs are unavailable right now.' }, 503);
  }
  const byId = new Map(articles.map((a) => [a.id, a]));
  const out = [];
  for (const p of pairs) {
    const a = byId.get(p.article_id);
    if (!a) continue; // the article was pruned; its pair goes with it
    out.push({
      article: { id: a.id, title: text(a.title, 300), url: httpUrl(a.canonical_url), published_at: text(a.published_at, 40), place: text(a.headline_location_label, 120) },
      layer: p.layer, entity_key: p.entity_key, entity_name: text(p.entity_name, 200),
      entity_lat: num(p.entity_lat), entity_lon: num(p.entity_lon), entity_time: text(p.entity_time, 40),
      score: num(p.score), method: p.method, reason: text(p.reason, 300), paired_at: text(p.created_at, 40),
    });
  }
  return send(request, env, {
    ok: true,
    query: query.by === 'article' ? { article_id: query.articleId } : { layer: query.layer, entity_key: query.key },
    note: 'Automatic matches from headlines; an article location is where it mentions a place.',
    count: out.length,
    pairs: out,
  });
}
