/* MISSION-GATED CCTV ON THE WORLD (owner, 2026-10-15: CCTV for members
   "ONLY after they are logged in, have given location consent, AND have
   completed a mission").

     GET    /v1/world/cctv/eligibility      member   the three checks, each true or false
     POST   /v1/world/location-consent      member   record an explicit precise-location opt-in
     DELETE /v1/world/location-consent      member   withdraw it
     GET    /v1/world/cctv/sources          eligible public camera records, proxied from Halo
     GET    /v1/world/cctv/frame/:id        eligible one live snapshot, proxied from Halo

   The three checks, all server-side (hiding a button is not authorization):

   1. signed_in: the bearer is a Supabase user (the same check the World's
      member layers use, ./world-layers.js bearerUser).
   2. location_consent: a row in public.world_location_consents for this
      user, granted and not revoked. No such record existed before this
      change: the browser's geolocation permission was only ever observed as
      an analytics event (js/analytics.js "location_permission"), which is
      not consent to anything. The table is defined in
      supabase/pending/world_location_consent_v1.sql and is NOT applied in
      production; until it is, this check is false for everyone and the
      eligibility answer says why (consent_store: "pending"). No coordinate
      is stored: the row records the decision, never a position.
   3. mission_completed: the one canonical definition, shared with the
      fellowship ladder (PR #440): the member has at least one
      public.action_mission_assignments row with status 'verified'. An
      assignment becomes 'verified' exactly when its action_proofs row is
      reviewed 'verified' (review_action_proof, admin-only, never on one's
      own proof); action_network_fellowship_v1 counts completions the same
      way. Production had 0 verified assignments on 2026-10-15, so no member
      qualifies today; the lock says so.

   Eligibility is re-checked on every request (no per-member cache), so
   withdrawing consent takes effect on the next call. Frames reach the page
   by fetch() with the member's Authorization header and are shown from a
   blob: object URL (js/action-globe.js openCamera); no bearer or signed
   token ever rides in a URL, and <img src> never points at this route.

   Halo is called server to server: base HALO_API_BASE (default
   https://prime.mccluster.org) with header x-halo-internal from the secret
   HALO_INTERNAL_TOKEN (name only; set with wrangler secret put). The
   member's own bearer is never forwarded to Halo. Without the secret the
   proxy answers 503 after the eligibility check, so nothing is leaked.

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
export const LIMITS = Object.freeze({ eligibility: 30, sources: 6, frame: 60, consent: 10 });
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
const missingTable = (e) => e && (e.status === 404 || e.code === 'PGRST205' || e.code === '42P01');
export const uuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

export async function locationConsent(env, userId, fetchImpl = fetch) {
  try {
    const rows = await service(env, `world_location_consents?user_id=eq.${userId}&select=scope,granted_at,revoked_at&limit=1`, fetchImpl);
    const row = rows[0];
    return { ok: !!(row && row.granted_at && !row.revoked_at), store: 'applied' };
  } catch (e) {
    if (missingTable(e)) return { ok: false, store: 'pending' };
    throw e;
  }
}

export async function missionCompleted(env, userId, fetchImpl = fetch) {
  /* THE canonical definition, shared with the fellowship ladder (PR #440): at least one of the member's own
     action_mission_assignments rows has status 'verified'. An assignment becomes 'verified' exactly when its
     action_proofs row is reviewed 'verified' (review_action_proof); action_network_fellowship_v1 counts it this way. */
  const rows = await service(env, `action_mission_assignments?user_id=eq.${userId}&status=eq.verified&select=id&limit=1`, fetchImpl);
  return rows.length > 0;
}

export async function eligibility(request, env, fetchImpl = fetch) {
  const user = await bearerUser(request, env, fetchImpl);
  if (!user || !uuid(user.id)) return { user: null, eligible: false, checks: { signed_in: false, location_consent: false, mission_completed: false }, consent_store: null };
  /* checked on EVERY request, never cached (Halo's contract, docs/AUTH-BOUNDARY.md there): a withdrawn consent or a
     revoked proof stops the very next frame */
  const [consent, completed] = await Promise.all([locationConsent(env, user.id, fetchImpl), missionCompleted(env, user.id, fetchImpl)]);
  const checks = { signed_in: true, location_consent: consent.ok, mission_completed: completed };
  return { user, eligible: checks.signed_in && checks.location_consent && checks.mission_completed, checks, consent_store: consent.store };
}

function reasonOf(checks) {
  if (!checks.signed_in) return 'sign_in_required';
  if (!checks.location_consent) return 'location_consent_required';
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
    return await fetchImpl(`${base}${path}`, {
      redirect: 'error',
      signal: controller.signal,
      headers: { accept, 'x-halo-internal': env.HALO_INTERNAL_TOKEN, 'user-agent': 'McCluster-World/1.0 (+https://mccluster.org)' }
    });
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
  const isConsent = path === '/v1/world/location-consent';
  const frame = path.match(/^\/v1\/world\/cctv\/frame\/([^/]+)$/);
  if (!isConsent && path !== '/v1/world/cctv/eligibility' && path !== '/v1/world/cctv/sources' && !frame) return null;

  if (isConsent) {
    if (request.method !== 'POST' && request.method !== 'DELETE') return privateJson(request, env, { error: 'Method not allowed' }, 405);
    const user = await bearerUser(request, env, fetchImpl);
    if (!user || !uuid(user.id)) return privateJson(request, env, { error: 'Sign in to share your location', detail: { reason: 'sign_in_required' } }, 401);
    const retry = rateLimited(`consent:${user.id}`, LIMITS.consent);
    if (retry) return tooMany(request, env, retry);
    let body = {};
    if (request.method === 'POST') body = await request.json().catch(() => ({}));
    /* the page says the browser granted the permission after the member tapped; nothing else counts */
    if (request.method === 'POST' && body.browser_permission !== 'granted') {
      return privateJson(request, env, { error: 'Location consent needs the browser permission, granted by you', detail: { reason: 'browser_permission_not_granted' } }, 400);
    }
    const now = new Date().toISOString();
    const row = request.method === 'POST'
      ? { user_id: user.id, scope: 'precise_gps', granted_at: now, revoked_at: null, source: 'world_cctv', consent_version: 'world-cctv-2026-10-15' }
      : { user_id: user.id, scope: 'precise_gps', revoked_at: now };
    const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/world_location_consents${request.method === 'DELETE' ? `?user_id=eq.${user.id}` : '?on_conflict=user_id'}`, {
      method: request.method === 'POST' ? 'POST' : 'PATCH',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: request.method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal' },
      body: JSON.stringify(row)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 404 || err.code === 'PGRST205' || err.code === '42P01') return privateJson(request, env, { error: 'Location consent cannot be recorded yet', detail: { reason: 'consent_store_pending' } }, 503);
      return privateJson(request, env, { error: 'Location consent was not saved' }, 502);
    }
    return privateJson(request, env, { ok: true, location_consent: request.method === 'POST', recorded_at: now });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return privateJson(request, env, { error: 'Method not allowed' }, 405);
  const result = await eligibility(request, env, fetchImpl);
  const who = result.user ? result.user.id : null;

  if (path === '/v1/world/cctv/eligibility') {
    if (who) { const retry = rateLimited(`elig:${who}`, LIMITS.eligibility); if (retry) return tooMany(request, env, retry); }
    return privateJson(request, env, { eligible: result.eligible, checks: result.checks, reason: reasonOf(result.checks), consent_store: result.consent_store, missions_url: 'mnet.html?view=missions' });
  }

  /* nothing below is reached by anyone who is not eligible: no list, no frame, no upstream call */
  if (!result.eligible) {
    const reason = reasonOf(result.checks);
    return privateJson(request, env, { error: 'CCTV is for signed-in members who shared their location and completed a mission', detail: { reason, checks: result.checks } }, reason === 'sign_in_required' ? 401 : 403);
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
    return privateJson(request, env, { error: 'CCTV is unavailable right now', detail: { reason: 'halo_unavailable' } }, 502);
  }
}
