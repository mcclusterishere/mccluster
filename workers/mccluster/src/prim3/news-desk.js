/* PRIM3 NEWS DESK, READ SIDE (owner only).

   The 24 stationed agents' reactions and regional briefs are written by
   McCluster Core on the OVH box (core/src/executors/prim3-agent-news.mjs) into
   prim3_agent_news_comments / prim3_agent_news_briefs, which have RLS on and no
   client policies. This route is the only reader: the house owner's PRIM3 World
   card asks for one country, or for every agent's latest brief.

   GET /v1/prim3/news-desk               -> { briefs: [{ agent_key, country_iso, brief, headline_count, created_at }] }
   GET /v1/prim3/news-desk?country=JP    -> { country_iso, brief|null, comments: [{ headline, comment, url|null, created_at }] }

   Comments are fiction voiced by McCluster about real headlines (the headline
   only, never the article). Headlines link out to their publisher. */
import { fail, reply } from '../lib/http.js';

export const NEWS_DESK_PATH = '/v1/prim3/news-desk';
const COMMENT_LIMIT = 30;

async function service(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { signal: AbortSignal.timeout(12_000), headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error('Database request failed'), { status: 503 });
  return Array.isArray(data) ? data : [];
}
function httpUrl(value) {
  try { const u = new URL(String(value || '')); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}

export async function readCountry(env, iso) {
  const [briefs, comments] = await Promise.all([
    service(env, `prim3_agent_news_briefs?country_iso=eq.${iso}&select=agent_key,brief,headline_count,created_at&order=created_at.desc&limit=1`),
    service(env, `prim3_agent_news_comments?country_iso=eq.${iso}&select=agent_key,article_id,headline,comment,created_at&order=created_at.desc&limit=${COMMENT_LIMIT}`),
  ]);
  const ids = [...new Set(comments.map(row => row.article_id).filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
  const urls = ids.length ? await service(env, `media_news_articles?id=in.(${ids.join(',')})&select=id,canonical_url`) : [];
  const urlBy = new Map(urls.map(row => [row.id, httpUrl(row.canonical_url)]));
  return {
    country_iso: iso,
    brief: briefs[0] ? { agent_key: briefs[0].agent_key, text: briefs[0].brief, headline_count: briefs[0].headline_count, created_at: briefs[0].created_at } : null,
    comments: comments.map(row => ({ agent_key: row.agent_key, headline: row.headline, comment: row.comment, url: urlBy.get(row.article_id) || null, created_at: row.created_at })),
    label: 'Fiction voiced by McCluster about real headlines.',
  };
}

export async function readLatestBriefs(env) {
  // Newest first; keep the first per agent (24 agents x a few briefs a day fits in one page).
  const rows = await service(env, 'prim3_agent_news_briefs?select=agent_key,country_iso,brief,headline_count,created_at&order=created_at.desc&limit=200');
  const seen = new Set();
  const briefs = [];
  for (const row of rows) { if (seen.has(row.agent_key)) continue; seen.add(row.agent_key); briefs.push(row); }
  return { briefs, label: 'Fiction voiced by McCluster about real headlines.' };
}

export async function handleNewsDesk(request, env, options = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== NEWS_DESK_PATH) return null;
  const respond = (res) => { res.headers.set('cache-control', 'private, no-store'); return res; };
  try {
    if (request.method !== 'GET') return respond(fail(request, env, 'Method not allowed', 405));
    if (typeof options.requireHouseOwner !== 'function') return respond(fail(request, env, 'Authorization is unavailable', 503));
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return respond(fail(request, env, 'News desk is not configured', 503));
    await options.requireHouseOwner(request, env);
    const country = url.searchParams.get('country');
    if (country == null) return respond(reply(request, env, await readLatestBriefs(env)));
    const iso = String(country).toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso)) return respond(fail(request, env, 'country must be a two-letter code', 400));
    return respond(reply(request, env, await readCountry(env, iso)));
  } catch (error) {
    const status = error.status === 401 || error.status === 403 ? error.status : 503;
    return respond(fail(request, env, status < 500 ? error.message : 'News desk is unavailable right now', status));
  }
}
