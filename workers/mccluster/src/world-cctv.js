/* MISSION-GATED CCTV ON THE WORLD (owner, 2026-10-15: CCTV for members
   "ONLY after they are logged in, have given location consent, AND have
   completed a mission"; then, the same day: "When they come to the website
   they agree to the privacy agreement. We get their location. Period.").

     GET    /v1/world/cctv/eligibility      member   the three checks, each true or false
     GET    /v1/world/cctv/sources          eligible public camera records, proxied from Halo
     GET    /v1/world/cctv/frame/:id        eligible one live snapshot, proxied from Halo

   The three checks, all server-side (hiding a button is not authorization):

   1. signed_in: the bearer is a Supabase user (the same check the World's
      member layers use, ./world-layers.js bearerUser).
   2. privacy_acknowledged: LOCATION CONSENT IS THE PRIVACY ACKNOWLEDGEMENT.
      The member has acknowledged the CURRENT Privacy Policy version
      (PRIVACY_VERSION below, the same string as js/live-content.js VERSION
      and js/analytics.js MCC_PRIVACY_REQUIRED_VERSION). The server-side
      record is the member's own Supabase auth user_metadata:
      privacy_policy_version + privacy_acknowledged_at, written at sign-up
      by the join flow (js/action.js) and, for members who signed up another
      way, by the member's own tap on the CCTV lock (js/action-globe.js,
      PUT /auth/v1/user with their session). The site-entry gate itself
      (js/live-content.js, mcc_privacy_ack) is browser storage the Worker
      cannot read, so it does not count here on its own. privacy.html
      discloses the automatic IP-derived country/region/city and that
      precise device location is read only when the browser permission is
      granted. No separate location-consent table or route exists.
      Location for CCTV and "Near me" is the IP-derived approximate location
      Cloudflare attaches to the request (request.cf; never stored here);
      precise GPS comes only through the browser's own permission prompt,
      which browsers enforce and this code does not try to get around.
   3. mission_completed: the ONE predicate, identical to PR #444's
      public.action_member_verified_mission_count(): a verified
      action_mission_assignments row on a mission whose kind is not 'clip'
        where a.user_id = p_user and a.status = 'verified'
          and coalesce(m.kind, 'civic') <> 'clip'
      (PostgREST: an inner join on action_missions with kind null or not
      'clip'). An assignment becomes 'verified' only when an admin reviews
      its proof (review_action_proof); there is no auto-verify path.

   Eligibility is re-checked on every request (no per-member cache), so a
   revoked proof takes effect on the next call. Frames reach the page by
   fetch() with the member's Authorization header and are shown from a
   blob: object URL (js/action-globe.js openCamera); no bearer or signed
   token ever rides in a URL, and <img src> never points at this route.

   Halo is called server to server: base HALO_API_BASE (default
   https://prime.mccluster.org) with header x-halo-internal from the secret
   HALO_INTERNAL_TOKEN (name only; set with wrangler secret put). The
   member's own bearer is never forwarded to Halo. Without the secret the
   proxy answers 503 after the eligibility check, so nothing is leaked.
   Halo is fetched with redirect: 'manual' (workerd rejects the "error" mode); any
   3xx is a typed failure (halo_redirect) and is never followed.

   A frame is passed through only when Halo says it is a live upstream
   snapshot (x-cctv-source: upstream-image) and it is a raster image.
   Halo's Street View and synthetic SVG fallbacks are refused here with
   502 no_live_frame: neither is ever shown as a live camera.

   Every answer is private, no-store and varies on authorization. Rate
   limits are per member and per isolate (best effort: Workers spread load
   across isolates, so the true ceiling is a small multiple of these). */
import { fail, reply } from './lib/http.js';
import { bearerUser } from './world-layers.js';

export const HALO_DEFAULT_BASE = 'https://prime.mccluster.org';
export const LIMITS = Object.freeze({ eligibility: 30, sources: 6, frame: 60 });
/* the current Privacy Policy version: js/live-content.js VERSION, js/analytics.js MCC_PRIVACY_REQUIRED_VERSION */
export const PRIVACY_VERSION = '2026-09-26';
const WINDOW_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const SOURCES_TTL_MS = 60_000;
const MAX_SOURCES = 5000;
const CAMERA_ID = /^[A-Za-z0-9._:~-]{1,160}$/;
/* the fields a camera record may carry out of here; Halo's own internals (upstream URLs, keys) never do */
const SOURCE_FIELDS = ['id', 'name', 'city', 'cityId', 'provider', 'lat', 'lon', 'headingDeg', 'fovDeg', 'feedType', 'sourceKind', 'license'];
const FRAME_PASS_HEADERS = ['content-type', 'x-cctv-source', 'x-cctv-provider', 'x-cctv-captured-at', 'last-modified'];

/* ---------- per-member, per-isolate sliding window ---------- */
const buckets = new Map();

export function rateLimited(key, limit, now = Date.now()) {
  const list = (buckets.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= limit) { buckets.set(key, list); return Math.ceil((WINDOW_MS - (now - list[0])) / 1000); }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 5000) for (const k of buckets.keys()) { buckets.delete(k); if (buckets.size <= 4000) break; }
  return 0;
}
export function resetRateLimits() { buckets.clear(); sourcesCache.at = 0; sourcesCache.body = null; }

/* ---------- Supabase, as the service role ---------- */
export async function service(env, path, fetchImpl) {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error('supabase ' + res.status), { status: res.status, code: data && data.code });
  return Array.isArray(data) ? data : [];
}
export const uuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

/* the member acknowledged the current Privacy Policy: their own auth record says so (see the header) */
export function privacyAcknowledged(user) {
  const m = (user && user.user_metadata) || {};
  return m.privacy_policy_version === PRIVACY_VERSION && !!m.privacy_acknowledged_at && !Number.isNaN(Date.parse(m.privacy_acknowledged_at));
}

/* IP-derived, approximate, never stored: what Cloudflare attaches to this request (request.cf) */
export function approximateLocation(request) {
  const cf = (request && request.cf) || {};
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; };
  const lat = num(cf.latitude), lon = num(cf.longitude);
  const out = { source: 'ip_approximate', country: cf.country || null, region: cf.region || null, city: cf.city || null };
  /* a coordinate only when Cloudflare gave one: never 0,0 in its place */
  if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) { out.lat = lat; out.lon = lon; }
  return out;
}

/* THE ONE PREDICATE (PR #444, action_member_verified_mission_count): a verified assignment on a non-clip mission */
export const MISSION_COMPLETED_QUERY = (userId) =>
  `action_mission_assignments?user_id=eq.${userId}&status=eq.verified&select=id,action_missions!inner(kind)&action_missions.or=(kind.is.null,kind.neq.clip)&limit=1`;
export async function missionCompleted(env, userId, fetchImpl = fetch) {
  const rows = await service(env, MISSION_COMPLETED_QUERY(userId), fetchImpl);
  return rows.length > 0;
}

export async function eligibility(request, env, fetchImpl = fetch) {
  const user = await bearerUser(request, env, fetchImpl);
  if (!user || !uuid(user.id)) return { user: null, eligible: false, checks: { signed_in: false, privacy_acknowledged: false, mission_completed: false } };
  /* checked on EVERY request, never cached (Halo's contract, docs/AUTH-BOUNDARY.md there): a revoked proof stops the
     very next frame */
  const completed = await missionCompleted(env, user.id, fetchImpl);
  const checks = { signed_in: true, privacy_acknowledged: privacyAcknowledged(user), mission_completed: completed };
  return { user, eligible: checks.signed_in && checks.privacy_acknowledged && checks.mission_completed, checks };
}

function reasonOf(checks) {
  if (!checks.signed_in) return 'sign_in_required';
  if (!checks.privacy_acknowledged) return 'privacy_acknowledgement_required';
  if (!checks.mission_completed) return 'mission_required';
  return null;
}

function privateJson(request, env, body, status = 200, extra = {}) {
  const res = status >= 400 ? fail(request, env, body.error, status, body.detail) : reply(request, env, body, status);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
  return res;
}
function tooMany(request, env, retry) {
  return privateJson(request, env, { error: 'Too many requests', detail: { retry_after: retry } }, 429, { 'retry-after': String(retry) });
}

/* ---------- Halo, server to server ---------- */
function haloBase(env) {
  const raw = String(env.HALO_API_BASE || HALO_DEFAULT_BASE).trim().replace(/\/+$/, '');
  try { const u = new URL(raw); return u.protocol === 'https:' ? u.origin + u.pathname.replace(/\/+$/, '') : null; } catch { return null; }
}
async function halo(env, path, fetchImpl, accept) {
  const base = haloBase(env);
  if (!base) throw Object.assign(new Error('bad HALO_API_BASE'), { status: 503 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    /* workerd rejects the "error" redirect mode; manual hands back the 3xx, which is a failure here, never followed */
    const res = await fetchImpl(`${base}${path}`, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept, 'x-halo-internal': env.HALO_INTERNAL_TOKEN, 'user-agent': 'McCluster-World/1.0 (+https://mccluster.org)' }
    });
    if (res.status >= 300 && res.status < 400) {
      if (res.body && res.body.cancel) await res.body.cancel().catch(() => {});
      throw Object.assign(new Error('halo redirected'), { status: 502, code: 'halo_redirect', upstream: res.status });
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
/* a camera with no real position is dropped, never put at 0,0 */
export function cleanSource(s) {
  if (!s || typeof s !== 'object') return null;
  const lat = Number(s.lat), lon = Number(s.lon);
  if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  if (!CAMERA_ID.test(String(s.id || ''))) return null;
  const out = {};
  for (const k of SOURCE_FIELDS) if (s[k] !== undefined && s[k] !== null) out[k] = typeof s[k] === 'string' ? s[k].slice(0, 200) : s[k];
  out.lat = lat; out.lon = lon; out.id = String(s.id);
  return out;
}

const sourcesCache = { at: 0, body: null };
async function cameraSources(env, fetchImpl) {
  if (sourcesCache.body && Date.now() - sourcesCache.at < SOURCES_TTL_MS) return sourcesCache.body;
  const res = await halo(env, '/api/cctv/sources', fetchImpl, 'application/json');
  if (!res.ok) throw Object.assign(new Error('halo sources ' + res.status), { status: 502, upstream: res.status });
  const data = await res.json().catch(() => null);
  const raw = Array.isArray(data && data.sources) ? data.sources : [];
  const sources = raw.map(cleanSource).filter(Boolean).slice(0, MAX_SOURCES);
  const body = { sources, upstream_total: raw.length, dropped_without_position: raw.length - sources.length, retrieved_at: new Date().toISOString() };
  sourcesCache.at = Date.now();
  sourcesCache.body = body;
  return body;
}

export async function handleWorldCctv(request, env, { fetchImpl = fetch } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const frame = path.match(/^\/v1\/world\/cctv\/frame\/([^/]+)$/);
  if (path !== '/v1/world/cctv/eligibility' && path !== '/v1/world/cctv/sources' && !frame) return null;

  if (request.method !== 'GET' && request.method !== 'HEAD') return privateJson(request, env, { error: 'Method not allowed' }, 405);
  const result = await eligibility(request, env, fetchImpl);
  const who = result.user ? result.user.id : null;

  if (path === '/v1/world/cctv/eligibility') {
    if (who) { const retry = rateLimited(`elig:${who}`, LIMITS.eligibility); if (retry) return tooMany(request, env, retry); }
    return privateJson(request, env, { eligible: result.eligible, checks: result.checks, reason: reasonOf(result.checks), privacy_version: PRIVACY_VERSION, privacy_url: 'privacy.html', approximate_location: approximateLocation(request), missions_url: 'mnet.html?view=missions' });
  }

  /* nothing below is reached by anyone who is not eligible: no list, no frame, no upstream call */
  if (!result.eligible) {
    const reason = reasonOf(result.checks);
    return privateJson(request, env, { error: 'CCTV is for signed-in members who acknowledged the Privacy Policy and completed a mission', detail: { reason, checks: result.checks } }, reason === 'sign_in_required' ? 401 : 403);
  }
  const retry = rateLimited(`${frame ? 'frame' : 'sources'}:${who}`, frame ? LIMITS.frame : LIMITS.sources);
  if (retry) return tooMany(request, env, retry);
  if (!env.HALO_INTERNAL_TOKEN) return privateJson(request, env, { error: 'CCTV is not connected yet', detail: { reason: 'halo_not_configured' } }, 503);

  try {
    const list = await cameraSources(env, fetchImpl);
    if (!frame) return privateJson(request, env, { ok: true, ...list, provenance: 'Hitman\'s Halo public camera catalogue; each record keeps its provider and licence' });

    let id;
    try { id = decodeURIComponent(frame[1]); } catch { id = ''; }
    if (!CAMERA_ID.test(id)) return privateJson(request, env, { error: 'Unknown camera' }, 404);
    const camera = list.sources.find((s) => s.id === id);
    if (!camera) return privateJson(request, env, { error: 'Unknown camera' }, 404);

    const res = await halo(env, `/api/cctv/frame/${encodeURIComponent(id)}`, fetchImpl, 'image/*');
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    const source = String(res.headers.get('x-cctv-source') || '').toLowerCase();
    const live = res.ok && source === 'upstream-image' && type.startsWith('image/') && !type.startsWith('image/svg');
    if (!live) {
      if (res.body && res.body.cancel) await res.body.cancel().catch(() => {});
      return privateJson(request, env, { error: 'No live frame from this camera right now', detail: { reason: 'no_live_frame', upstream_status: res.status, upstream_source: source || null } }, 502);
    }
    const headers = new Headers();
    for (const h of FRAME_PASS_HEADERS) { const v = res.headers.get(h); if (v) headers.set(h, v.slice(0, 200)); }
    if (!headers.get('x-cctv-provider') && camera.provider) headers.set('x-cctv-provider', String(camera.provider).slice(0, 200));
    if (camera.license) headers.set('x-cctv-license', String(typeof camera.license === 'string' ? camera.license : JSON.stringify(camera.license)).slice(0, 200));
    headers.set('x-cctv-retrieved-at', new Date().toISOString());
    const upstreamDate = res.headers.get('date');
    if (upstreamDate) headers.set('x-cctv-upstream-date', upstreamDate);
    headers.set('cache-control', 'private, no-store');
    headers.set('vary', 'origin, authorization');
    headers.set('x-content-type-options', 'nosniff');
    const cors = reply(request, env, {}).headers;
    for (const [k, v] of cors) if (k.startsWith('access-control-')) headers.set(k, v);
    headers.set('access-control-expose-headers', 'x-cctv-source,x-cctv-provider,x-cctv-captured-at,x-cctv-retrieved-at,x-cctv-upstream-date,x-cctv-license,last-modified,content-type');
    return new Response(request.method === 'HEAD' ? null : res.body, { status: 200, headers });
  } catch (e) {
    return privateJson(request, env, { error: 'CCTV is unavailable right now', detail: { reason: e && e.code === 'halo_redirect' ? 'halo_redirect' : 'halo_unavailable' } }, 502);
  }
}
