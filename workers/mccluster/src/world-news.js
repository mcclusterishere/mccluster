/* Keep metadata discovery separate from permission to publish full articles.
 * The prior GDELT implementation is unchanged in world-news-discovery.js.
 * Explicit cutover only: current GDELT rows contain NO licensed article body.
 * Until a reviewed full-text adapter/store is wired, strict mode fails closed.
 * No deletion, scraping, header stripping, or publisher protection bypass.
 */
export * from './world-news-discovery.js';
import { ingestGdeltNews as ingestDiscovery, handleWorldNews as serveDiscovery, handleWorldNewsHeat as serveHeat, NEWS_PATH, NEWS_HEAT_PATH, NEWS_ATTRIBUTION } from './world-news-discovery.js';
import { nativeReaderOnly, READER_POLICY_VERSION } from './news-reader-policy.js';
import { reply, fail } from './lib/http.js';

export async function ingestGdeltNews(env, options = {}) {
  if (nativeReaderOnly(env)) return { skipped: 'native_reader_only_metadata_source', policy: READER_POLICY_VERSION };
  return ingestDiscovery(env, options);
}
export async function handleWorldNews(request, env, options = {}) {
  if (!nativeReaderOnly(env)) return serveDiscovery(request, env, options);
  if (new URL(request.url).pathname.replace(/\/+$/, '') !== NEWS_PATH) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return fail(request, env, 'Method not allowed', 405);
  // Do not consult the old cache or DB: it has metadata, not readable articles.
  const body = { ok: true, items: [], next_before: null, attribution: NEWS_ATTRIBUTION,
    reading_mode: 'native_only', reader_status: 'awaiting_authorized_full_text',
    policy: READER_POLICY_VERSION };
  const res = reply(request, env, body);
  res.headers.set('cache-control', 'no-store');
  return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
/* the heat map counts the stories the feed shows: none shown, none counted */
export async function handleWorldNewsHeat(request, env, options = {}) {
  if (!nativeReaderOnly(env)) return serveHeat(request, env, options);
  if (new URL(request.url).pathname.replace(/\/+$/, '') !== NEWS_HEAT_PATH) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return fail(request, env, 'Method not allowed', 405);
  const res = reply(request, env, { ok: true, window_hours: 24, countries: {}, total: 0, attribution: NEWS_ATTRIBUTION, reading_mode: 'native_only', policy: READER_POLICY_VERSION });
  res.headers.set('cache-control', 'no-store');
  return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
