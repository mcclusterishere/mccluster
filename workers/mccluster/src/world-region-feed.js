/* REGION FEED V1 — public country-scoped member posts + GDELT news.
   Off until pending SQL is applied and WORLD_PLACE_SCOPE_ENABLED=true. Never
   derive a member post's country from IP. A country association is explicit.
   News "in a country" means GDELT mentioned a place there, NOT that the
   reported event has been independently geolocated. All reads are public
   projections: service-role access must NEVER turn into a private-post leak.
*/
import { fail, reply } from './lib/http.js';
import { ISO_TO_FIPS, isCountry, isoFromGdelt } from './intel/news-country-codes.js';

export const REGION_STATUS = '/v1/world/place-scope';
export const REGION_FEED = '/v1/world/region-feed';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function placeScopeEnabled(env) {
  return String(env?.WORLD_PLACE_SCOPE_ENABLED || '').trim().toLowerCase() === 'true';
}
export function visitorCountry(req) {
  // request.cf is provided by Cloudflare at the edge; never trust a
  // user-supplied query, X-Forwarded-For or CF-IPCountry request header.
  const c = req?.cf?.country;
  return typeof c === 'string' && isCountry(c) ? c : null;
}
export function parseCountry(value) {
  return typeof value === 'string' && isCountry(value) ? value : null;
}
function parseCursor(value) {
  if (!value) return null;
  const m = /^(.+)~([0-9a-f-]{36})$/i.exec(value);
  if (!m || !ISO_TIME.test(m[1]) || !UUID.test(m[2])) return false;
  const t = new Date(m[1]);
  if (!Number.isFinite(t.valueOf()) || t.toISOString() !== m[1]) return false;
  return { at: m[1], id: m[2] };
}
function cursor(row, timeCol) {
  return row && row[timeCol] && UUID.test(row.id)
    ? new Date(row[timeCol]).toISOString() + '~' + row.id : null;
}
async function db(env, path, fetchImpl) {
  const response = await fetchImpl(env.SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, accept: 'application/json' }
  });
  if (!response.ok) throw new Error('regional_store_unavailable');
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('regional_store_invalid_response');
  return rows;
}
function query(table, filters, clock, previous, size, select) {
  const p = new URLSearchParams(filters);
  p.set('select', select);
  p.set('order', clock + '.desc,id.desc');
  p.set('limit', String(size));
  if (previous) {
    // Stable (timestamp,id) keyset cursor. ISO is validated, not interpolated
    // from arbitrary input. No offset page drift when a newer item arrives.
    p.set('or', '(' + clock + '.lt.' + previous.at +
      ',and(' + clock + '.eq.' + previous.at + ',id.lt.' + previous.id + '))');
  }
  return table + '?' + p.toString();
}
function safeMeta(m) {
  const t = m && typeof m === 'object' ? m.track : null;
  // Keep the same bounded public track projection as /v1/mnet/public-feed.
  return t && typeof t === 'object' ? { track: {
    ...(typeof t.title === 'string' ? { title: t.title.slice(0,150) } : {}),
    ...(typeof t.artist === 'string' ? { artist: t.artist.slice(0,120) } : {}),
    ...(typeof t.slug === 'string' ? { slug: t.slug.slice(0,120) } : {})
  } } : {};
}
function publicPost(row, actor) {
  const mediaCount = Array.isArray(row.media) ? row.media.length : 0;
  return {
    item_type: 'post', post_id: row.id, occurred_at: row.created_at,
    actor: { display_name: actor.display_name || '', avatar_url: actor.avatar_url || '',
      verification_state: actor.verification_state || 'unverified' },
    post: { id: row.id, body: row.body || '', post_type: row.post_type || 'post',
      visibility: 'public', country_code: row.country_code, created_at: row.created_at,
      media_locked: mediaCount, metadata: safeMeta(row.metadata),
      liked_by_me: false, bookmarked_by_me: false, like_count: 0 }
  };
}
export async function handleRegionScope(req, env, { fetchImpl = fetch } = {}) {
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '');
  if (path !== REGION_FEED && path !== REGION_STATUS) return null;
  if (req.method !== 'GET') return fail(req, env, 'Method not allowed', 405);
  const enabled = placeScopeEnabled(env);
  if (path === REGION_STATUS) {
    const r = reply(req, env, {
      ok: true, enabled, country: enabled ? visitorCountry(req) : null,
      source: 'cloudflare_country', precision: 'country', personal_post_location: 'explicit_opt_in'
    });
    r.headers.set('cache-control','private, no-store');
    return r;
  }
  if (!enabled || !env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY)
    return fail(req, env, 'Country feed is not enabled', 503, { enabled: false });
  const country = parseCountry(url.searchParams.get('country'));
  if (!country) return fail(req, env, 'A valid ISO 3166-1 country code is required', 400);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 30)
    return fail(req, env, 'limit must be 1 to 30', 400);
  const postBefore = parseCursor(url.searchParams.get('post_before'));
  const newsBefore = parseCursor(url.searchParams.get('news_before'));
  if (postBefore === false || newsBefore === false)
    return fail(req, env, 'Invalid regional feed cursor', 400);

  const postPath = query('network_posts', {
    country_code: 'eq.' + country, visibility: 'eq.public', deleted_at: 'is.null',
    group_id: 'is.null', reply_to_id: 'is.null'
  }, 'created_at', postBefore, limit * 3,
  'id,author_m_uid,body,post_type,visibility,media,metadata,country_code,created_at');
  const fips = ISO_TO_FIPS[country];
  const newsPath = query('media_news_articles', {
    location_country_fips: 'eq.' + fips, ingestion_provider: 'eq.gdelt_gkg_v2',
    published_at: 'not.is.null'
  }, 'published_at', newsBefore, limit,
  'id,title,canonical_url,published_at,headline_location_label,headline_latitude,headline_longitude,location_country_fips,source_id');

  try {
    const [rawPosts, rawNews] = await Promise.all([
      db(env, postPath, fetchImpl), db(env, newsPath, fetchImpl)
    ]);
    const authors = [...new Set(rawPosts.map(p => p.author_m_uid).filter(id => UUID.test(id)))];
    const profiles = authors.length ? await db(env, 'network_profiles?m_uid=in.(' +
      authors.join(',') + ')&visibility=eq.public&select=m_uid,display_name,avatar_url,verification_state', fetchImpl) : [];
    const byUid = new Map(profiles.map(p => [p.m_uid,p]));
    const allowed = rawPosts.filter(p => p.visibility === 'public' &&
      p.country_code === country && !p.deleted_at && !p.reply_to_id &&
      !p.group_id && byUid.has(p.author_m_uid));
    const posts = allowed.slice(0,limit).map(p => publicPost(p,byUid.get(p.author_m_uid)));
    const sourceIds = [...new Set(rawNews.map(n=>n.source_id).filter(id=>UUID.test(id)))];
    const sources = sourceIds.length ? await db(env,'media_news_sources?id=in.(' +
      sourceIds.join(',') + ')&select=id,domain',fetchImpl):[];
    const domain = new Map(sources.map(s => [s.id,s.domain]));
    const news = rawNews.filter(n => isoFromGdelt(n.location_country_fips) === country &&
      typeof n.canonical_url === 'string' && /^https:\/\//i.test(n.canonical_url) &&
      n.title && n.published_at).map(n=>({
      id:n.id,title:n.title,url:n.canonical_url,domain:domain.get(n.source_id)||'',
      seen_at:n.published_at,place:n.headline_location_label||null,
      lat:Number.isFinite(n.headline_latitude)?n.headline_latitude:null,
      lon:Number.isFinite(n.headline_longitude)?n.headline_longitude:null,
      country_code:country,location_basis:'article_mentions_place'
    }));
    const nextPost = allowed.length > limit
      ? cursor(allowed[limit-1],'created_at')
      : rawPosts.length === limit * 3 ? cursor(rawPosts[rawPosts.length-1],'created_at') : null;
    const nextNews = rawNews.length === limit
      ? cursor(rawNews[rawNews.length-1],'published_at') : null;
    const res = reply(req, env, { ok:true, available:true,country,posts,news,
      next_post_before:nextPost,next_news_before:nextNews,
      location_disclaimer:'News is associated with a place mentioned in the article; not a verified event location.' });
    res.headers.set('cache-control','public, max-age=30');
    res.headers.set('vary','origin');
    return res;
  } catch (error) {
    return fail(req, env, 'Country feed is unavailable', 503, { available: false });
  }
}
