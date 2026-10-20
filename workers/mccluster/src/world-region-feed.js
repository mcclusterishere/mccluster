/* REGION FEED V1 — public country-scoped member posts + GDELT news.
   Off until pending SQL is applied and WORLD_PLACE_SCOPE_ENABLED=true. Never
   derive a member post's country from IP. A country association is explicit.
   News "in a country" means GDELT mentioned a place there, NOT that the
   reported event has been independently geolocated. All reads are public
   projections: service-role access must NEVER turn into a private-post leak.
*/
import { corsHeaders, fail, reply } from './lib/http.js';
import { gdeltCodesFor, isCountry, isoFromGdelt } from './intel/news-country-codes.js';
import { bearerUser } from './world-layers.js';

export const REGION_STATUS = '/v1/world/place-scope';
export const REGION_FEED = '/v1/world/region-feed';
export const LIVE_PLACES = '/v1/world/live-places';
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
      /* the post's real count, as the public feed shows it; never a placeholder zero */
      liked_by_me: false, bookmarked_by_me: false, like_count: Number(row.like_count) || 0 }
  };
}
export async function handleRegionScope(req, env, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '');
  if (path !== REGION_FEED && path !== REGION_STATUS && path !== LIVE_PLACES) return null;
  /* a member's country feed carries their session, so the browser asks first */
  if (req.method === 'OPTIONS' && path === REGION_FEED && req.headers.get('access-control-request-method'))
    return new Response(null, { status: 204, headers: corsHeaders(req, env) });
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
  if (path === LIVE_PLACES) {
    /* WHERE BROADCASTS ARE ON AIR, by the country their host placed them in: counts for the globe's live badges,
       never a session, a host or a point finer than the country */
    try {
      const rows = await db(env, 'network_live_sessions?' + new URLSearchParams({ status: 'eq.live', country_code: 'not.is.null',
        last_seen_at: 'gt.' + new Date(now() - 2 * 60 * 1000).toISOString(), select: 'country_code', limit: '500' }).toString(), fetchImpl);
      const count = {};
      rows.forEach(r => { if (parseCountry(r && r.country_code)) count[r.country_code] = (count[r.country_code] || 0) + 1; });
      const res = reply(req, env, { ok: true, places: Object.keys(count).sort().map(code => ({ code, count: count[code] })) });
      res.headers.set('cache-control', 'public, max-age=30');
      res.headers.set('vary', 'origin');
      return res;
    } catch (error) {
      return fail(req, env, 'Live places are unavailable', 503);
    }
  }
  const country = parseCountry(url.searchParams.get('country'));
  if (!country) return fail(req, env, 'A valid ISO 3166-1 country code is required', 400);
  /* A SIGNED-OUT VISITOR STAYS IN THEIR REGION (owner, 2026-10-20): the country Cloudflare read from this
     connection, and no other, unless a member's session rides with the request. The page's lock is a courtesy;
     this is the rule. */
  if (country !== visitorCountry(req) && !(await bearerUser(req, env, fetchImpl)))
    return fail(req, env, 'Sign in to read another country\'s feed', 403, { sign_in: true, home: visitorCountry(req) });
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 30)
    return fail(req, env, 'limit must be 1 to 30', 400);
  const readPosts = url.searchParams.get('posts') !== '0';
  const readNews = url.searchParams.get('news') !== '0';
  if (!readPosts && !readNews) return fail(req, env, 'Select posts or news', 400);
  const postBefore = parseCursor(url.searchParams.get('post_before'));
  const newsBefore = parseCursor(url.searchParams.get('news_before'));
  if (postBefore === false || newsBefore === false)
    return fail(req, env, 'Invalid regional feed cursor', 400);

  const postPath = query('network_posts', {
    /* removed_at: a post the desk took down (moderation) never reaches a country feed, whatever its visibility */
    country_code: 'eq.' + country, visibility: 'eq.public', deleted_at: 'is.null', removed_at: 'is.null',
    group_id: 'is.null', reply_to_id: 'is.null'
  }, 'created_at', postBefore, limit * 3,
  'id,author_m_uid,body,post_type,visibility,media,metadata,country_code,created_at,like_count,removed_at');
  /* Palestine's stories come filed under the West Bank (WE) and the Gaza Strip (GZ); Serbia's under RI and, from GDELT, RB */
  const fips = gdeltCodesFor(country);
  const newsPath = query('media_news_articles', {
    location_country_fips: fips.length > 1 ? 'in.(' + fips.join(',') + ')' : 'eq.' + fips[0], ingestion_provider: 'eq.gdelt_gkg_v2',
    published_at: 'not.is.null'
  }, 'published_at', newsBefore, limit,
  'id,title,canonical_url,published_at,headline_location_label,headline_latitude,headline_longitude,location_country_fips,source_id');

  /* LIVES OF THE PLACE (owner, 2026-10-19: "the news plus the posts and lives of that area"): broadcasts on air
     now that their host placed in this country, on the first page only. No stream URL or host id leaves here. */
  const firstPage = !postBefore && !newsBefore;
  const livePath = 'network_live_sessions?' + new URLSearchParams({ status: 'eq.live', country_code: 'eq.' + country,
    last_seen_at: 'gt.' + new Date(now() - 2 * 60 * 1000).toISOString(),
    select: 'id,title,room_kind,category_key,started_at,host_m_uid,country_code,status', order: 'started_at.desc', limit: '6' }).toString();
  try {
    const [rawPosts, rawNews, rawLives] = await Promise.all([
      readPosts ? db(env, postPath, fetchImpl) : [],
      readNews ? db(env, newsPath, fetchImpl) : [],
      firstPage ? db(env, livePath, fetchImpl).catch(() => []) : []
    ]);
    const authors = [...new Set(rawPosts.map(p => p.author_m_uid).concat(rawLives.map(l => l.host_m_uid)).filter(id => UUID.test(id)))];
    const profiles = authors.length ? await db(env, 'network_profiles?m_uid=in.(' +
      authors.join(',') + ')&visibility=eq.public&select=m_uid,display_name,avatar_url,verification_state', fetchImpl) : [];
    const byUid = new Map(profiles.map(p => [p.m_uid,p]));
    const lives = rawLives.filter(l => UUID.test(l.id) && l.status === 'live' && l.country_code === country).map(l => {
      const host = byUid.get(l.host_m_uid) || {};
      return { id: l.id, title: String(l.title || '').slice(0, 120), room_kind: l.room_kind === 'mission' ? 'mission' : 'home',
        category_key: typeof l.category_key === 'string' ? l.category_key.slice(0, 64) : '', started_at: l.started_at || null,
        country_code: country, host: { display_name: host.display_name || '', avatar_url: host.avatar_url || '' } };
    });
    const allowed = rawPosts.filter(p => p.visibility === 'public' &&
      p.country_code === country && !p.deleted_at && !p.removed_at && !p.reply_to_id &&
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
    const nextPost = readPosts && allowed.length > limit
      ? cursor(allowed[limit-1],'created_at')
      : rawPosts.length === limit * 3 ? cursor(rawPosts[rawPosts.length-1],'created_at') : null;
    const nextNews = readNews && rawNews.length === limit
      ? cursor(rawNews[rawNews.length-1],'published_at') : null;
    const res = reply(req, env, { ok:true, available:true,country,posts,news,lives,
      next_post_before:nextPost,next_news_before:nextNews,
      location_disclaimer:'News is associated with a place mentioned in the article; not a verified event location.' });
    /* who may read it depends on the connection's country and the session: no shared cache may keep it */
    res.headers.set('cache-control','private, max-age=30');
    res.headers.set('vary','origin, authorization');
    return res;
  } catch (error) {
    return fail(req, env, 'Country feed is unavailable', 503, { available: false });
  }
}
