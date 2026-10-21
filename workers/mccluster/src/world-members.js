/* THE PLACE CARD'S MEMBERS (owner, 2026-10-21: "It should just count how many people have logged in with an account from
   that IP region. Make it exact down to the state. So you can filter state versus country in that way of how many user
   accounts"). GET /v1/world/members counts accounts by the IP place of their latest signed-in visit, once each
   (supabase/pending/world_member_regions_v1.sql reads public.events; nothing new is collected).

   Two answers, by who asks:
   - The house owner (the bearer, checked with Supabase and org_members, as the Halo routes do): exact. Every country's
     count, the total, and the places (rounded to hundredths of a degree, with Cloudflare's region code) so the globe can
     count each state with the state shapes it already has.
   - Everyone else: the country totals of five or more, the floor the members' count has always had
     (docs/control-plane/WORLD-GLOBE-FEED-AND-ANALYTICS.md). No places, no states, no total under five.

   The database is read once per five minutes per data centre. The owner's answer is never cached on the way out; the
   public one is. A read that fails answers unavailable, which the card shows as a dash, never a made-up zero. */
import { reply, fail } from './lib/http.js';
import { houseOwnerOf } from './world-halo-ops.js';

export const MEMBERS_PATH = '/v1/world/members';
export const MEMBERS_K = 5;
const WINDOW_DAYS = 400, TTL_MS = 300e3;

const cc = (v) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : null);
const rc = (v) => (typeof v === 'string' && /^[A-Z0-9]{1,4}$/.test(v) ? v : '');
const deg = (v, max) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? Math.round(v * 100) / 100 : null);
const count = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };

/* the RPC's rows, checked and shaped: { countries, total, cells: [[lon, lat, n, country, region], ...] } */
export function shapeMemberRows(rows) {
  const countries = {}, cells = [];
  let total = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const c = cc(r && r.country), n = count(r && r.accounts);
    if (!c || !n) continue;
    countries[c] = (countries[c] || 0) + n;
    total += n;
    const lon = deg(r.lon, 180), lat = deg(r.lat, 90);
    if (lon !== null && lat !== null) cells.push([lon, lat, n, c, rc(r.region_code)]);
  }
  return { countries, total, cells };
}

/* what a viewer who is not the house owner may see: countries of five or more, nothing finer */
export function publicMembers(data) {
  const countries = {};
  for (const [c, n] of Object.entries((data && data.countries) || {})) if (n >= MEMBERS_K) countries[c] = n;
  return { exact: false, k: MEMBERS_K, countries };
}

async function kept(cacheImpl, key, load) {
  const store = cacheImpl || (globalThis.caches && globalThis.caches.default) || null;
  const req = new Request(key);
  if (store) {
    const hit = await store.match(req).catch(() => null);
    const body = hit ? await hit.json().catch(() => null) : null;
    if (body && Number.isFinite(body.at) && Date.now() - body.at < TTL_MS) return body.data;
  }
  const data = await load();
  if (store && data && !data.unavailable) {
    await store.put(req, new Response(JSON.stringify({ at: Date.now(), data }), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TTL_MS / 1000}` } })).catch(() => {});
  }
  return data;
}

export async function handleWorldMembers(request, env, { fetchImpl = fetch, cacheImpl = null, now = () => Date.now() } = {}) {
  const url = new URL(request.url);
  if ((url.pathname.replace(/\/+$/, '') || '/') !== MEMBERS_PATH) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(request, env, 'Method not allowed', 405);
  const configured = env && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY;
  /* only a request that carries a session is asked whether it is the owner's */
  const owner = request.headers.get('authorization') ? await houseOwnerOf(request, env, fetchImpl).catch(() => null) : null;
  const slot = Math.floor(now() / TTL_MS);
  const data = await kept(cacheImpl, `https://cache.mccluster.internal/world/members?slot=${slot}`, async () => {
    if (!configured) return { unavailable: true };
    try {
      const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/world_member_regions`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ p_days: WINDOW_DAYS })
      });
      if (!res.ok) return { unavailable: true };
      return shapeMemberRows(await res.json());
    } catch { return { unavailable: true }; }
  });
  const base = { ok: true, basis: 'accounts_by_latest_signed_in_ip_place', window_days: WINDOW_DAYS };
  const body = data.unavailable ? { ...base, unavailable: true, exact: !!owner, countries: {} }
    : owner ? { ...base, exact: true, countries: data.countries, total: data.total, cells: data.cells }
    : { ...base, ...publicMembers(data) };
  const res = reply(request, env, body);
  res.headers.set('cache-control', owner || data.unavailable ? 'private, no-store' : 'public, max-age=300');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
