/* THE PUBLIC ENVIRONMENTAL EVENT TIMELINE, READ FROM THE EVENT STORE (E=UP event timeline slice S4, 2026-11-19; the record is
   docs/control-plane/EUP-EVENT-TIMELINE.md, the routes docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md).

     GET /v1/world/environment/events?since&until&cursor&limit   one page of the timeline, newest observation first: the published
                                                                 events and the tombstones of events that were published, each with
                                                                 its canonical id and revision, and each shown source's last read
     GET /v1/world/environment/events/:id                         one event for a deep link, by its canonical id or by any alias
                                                                 ('<provider>:<provider id>'), merges followed; its correction history

   BEHIND THE SAME GATE, FIRST. The persisted environment module policy (./world-environment.js environmentGate, read once per
   request: ./world-environment-guard.js) runs before anything else here, exactly as for the feed and the layer routes: off is 404
   module_disabled, an unreadable policy 503 module_policy_unavailable. The store's two public reads are gated in SQL by the same
   policy too (supabase/pending/20261119100000_eup_environment_events_v1_02.sql: EUM01 not installed, EUM03 disabled), so a route
   that forgot the gate would still be refused.

   ONE ID. The canonical id is the store's (decision D5, default adopted pending Matthew's confirmation: '<provider>:<the
   provider's preferred id when the store first saw the event>', never reassigned). The public feed's USGS rows come from the same
   store with the same ids and revisions (storeUsgsReader below, used by ./world-environment.js), so a post, a globe object, a
   selection and a deep link name one event. There is never a live fallback with a second id: a store that cannot be read makes
   the USGS source 'unavailable' with its reason, and USGS itself is not asked.

   WHITELISTED, FIELD BY FIELD. The store answers a public projection already; every field is checked again here and anything not
   named below is dropped: no actor, no decision or its reason, no candidate, no held event, no significance, no person or place of
   anyone, no store or provider message. Only the seven government providers' events pass (news is never a provider, E4).
     published  id, revision, provider, kind, state, title, place, magnitude, magnitude_type, depth_km, lon, lat, observed_at,
                review_status, tsunami, alert, source {id, url, updated_at, fetched_at}, first_published_at, revised_at,
                correction {revision, cause, changes, recorded_at} | null, news_coverage [...]
     tombstone  (withdrawn by the source, or by the owner) id, revision, provider, kind, state, title, place, magnitude,
                magnitude_type, observed_at, source {id, url}, first_published_at, withdrawn_at | retracted_at: no coordinates, no
                depth, no coverage, so no globe object (decision D12, default adopted pending Matthew's confirmation)
   A held event, or one whose provider the owner hid, is never in a page; its deep link answers 404 not_available.

   CACHED AT THE EDGE FOR AT MOST 60 SECONDS. A store read is kept per Cloudflare location for EVENTS_CACHE_SECONDS and shared by
   concurrent requests in one isolate; only a readable answer is kept, a refusal or a failure never. So an owner's hold or
   withdrawal reaches every page within a minute, and a burst of visitors asks the store once. The answer to the browser stays
   private, no-store: the gate decides every request.

   NOTHING PRIVATE IS IMPORTED. This module imports one response helper and nothing else: no intel/, news-pairing, Halo or owner
   module (workers/mccluster/test/world-environment-events.test.mjs checks the whole import graph). */
import { reply } from './lib/http.js';

export const EVENTS_PATH = '/v1/world/environment/events';
export const EVENTS_CACHE_SECONDS = 60;
export const STORE_TIMEOUT_MS = 8000;
export const PAGE_LIMITS = Object.freeze({ fallback: 20, max: 50 });
/* the public feed's USGS source: the store's published quakes of the past day, at most the pinned product's own row cap */
export const FEED_WINDOW_MS = 86400000;
export const FEED_LIMIT = 150;
/* the ingest runs every five minutes once Matthew turns it on; a last read older than this is not current */
export const NOT_RECENT_MS = 30 * 60000;
export const GOVERNMENT_PROVIDERS = Object.freeze(['usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops']);
export const PAGE_SCHEMA = 'mccluster.environment-events/v1';
export const EVENT_SCHEMA = 'mccluster.environment-event/v1';
export const STORE_USGS_COVERAGE = 'USGS earthquakes of the past day that the timeline publishes: by default M4.5 and larger, and any with a PAGER alert, a tsunami flag or a USGS significance above 600';
const EVENT_ID = /^(usgs|nws|nhc|eonet|firms|wfigs|coops):[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/;
const CURSOR = /^-?[0-9]{1,17}\|(usgs|nws|nhc|eonet|firms|wfigs|coops):[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/;
const SHOWN = Object.freeze(['published', 'withdrawn_by_source', 'retracted']);
const EVENT_STATUSES = Object.freeze([...SHOWN, 'not_available', 'not_found']);
const CAUSES = Object.freeze(['source_revised', 'source_deleted', 'source_restored', 'owner_rollback']);
const CHANGE_FIELDS = Object.freeze(['observed_at', 'location', 'depth_km', 'magnitude', 'magnitude_type', 'status', 'tsunami', 'alert']);
const RUN_STATUSES = Object.freeze(['ok', 'empty', 'unavailable', 'paused']);
const BASES = Object.freeze(['official_identifier', 'type_place_time']);
/* each provider's own hosts: a source link anywhere else is dropped, never shown */
const SOURCE_HOSTS = Object.freeze({
  usgs: ['earthquake.usgs.gov'], nws: ['api.weather.gov', 'www.weather.gov', 'alerts.weather.gov'], nhc: ['www.nhc.noaa.gov'],
  eonet: ['eonet.gsfc.nasa.gov'], firms: ['firms.modaps.eosdis.nasa.gov'], wfigs: ['data-nifc.opendata.arcgis.com'],
  coops: ['tidesandcurrents.noaa.gov']
});

/* ---------- what may leave, value by value ---------- */
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const iso = (v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
const text = (v, max) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
};
const word = (v, max) => (typeof v === 'string' && new RegExp(`^[A-Za-z0-9_]{1,${max}}$`).test(v) ? v : null);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const count = (v) => (Number.isSafeInteger(v) && v >= 1 ? v : null);
function httpsUrl(v, hosts = null) {
  if (typeof v !== 'string' || v.length > 600) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    if (hosts && !hosts.includes(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}
/* one value of a change: a number, a boolean, a short string (a time, a magnitude type, a status, a PAGER colour) or nothing */
function scalar(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return text(v, 40);
}
const lonLat = (v) => (Array.isArray(v) && v.length === 2 && num(v[0], -180, 180) !== null && num(v[1], -90, 90) !== null ? [v[0], v[1]] : null);
export function publicChanges(c) {
  const out = {};
  if (!isObject(c)) return out;
  for (const field of CHANGE_FIELDS) {
    const ch = c[field];
    if (!isObject(ch)) continue;
    out[field] = field === 'location'
      ? { from: lonLat(ch.from), to: lonLat(ch.to), km: num(ch.km, 0, 40100) }
      : { from: scalar(ch.from), to: scalar(ch.to) };
  }
  return out;
}
function revisionNote(r) {
  if (!isObject(r) || !CAUSES.includes(r.cause) || count(r.revision) === null) return null;
  return { revision: r.revision, cause: r.cause, changes: publicChanges(r.changes), recorded_at: iso(r.recorded_at) };
}
function coverageList(list) {
  return (Array.isArray(list) ? list : []).slice(0, 10).flatMap((c) => {
    if (!isObject(c) || !BASES.includes(c.basis)) return [];
    const url = httpsUrl(c.url), title = text(c.title, 300);
    if (!url || !title) return [];
    return [{ title, url, domain: text(c.domain, 120), seen_at: iso(c.seen_at), basis: c.basis, decided_at: iso(c.decided_at), event_revision: count(c.event_revision) }];
  });
}
/* One event as the public may see it, or null. `history`: the deep link's correction history (the page carries none). */
export function publicEvent(e, { history = false } = {}) {
  if (!isObject(e) || typeof e.id !== 'string' || !EVENT_ID.test(e.id)) return null;
  const provider = e.id.slice(0, e.id.indexOf(':'));
  if (e.provider !== provider || !SHOWN.includes(e.state) || count(e.revision) === null) return null;
  const src = isObject(e.source) ? e.source : {};
  const base = {
    id: e.id, revision: e.revision, provider, kind: word(e.kind, 20), state: e.state, title: text(e.title, 200), place: text(e.place, 200),
    magnitude: num(e.magnitude, -2, 10.5), magnitude_type: word(e.magnitude_type, 12), observed_at: iso(e.observed_at)
  };
  let out;
  if (e.state === 'published') {
    const lon = num(e.lon, -180, 180), lat = num(e.lat, -90, 90), placed = lon !== null && lat !== null;
    out = {
      ...base, depth_km: num(e.depth_km, -15, 800), lon: placed ? lon : null, lat: placed ? lat : null,
      review_status: ['automatic', 'reviewed'].includes(e.review_status) ? e.review_status : null,
      tsunami: e.tsunami === true, alert: ['green', 'yellow', 'orange', 'red'].includes(e.alert) ? e.alert : null,
      source: { id: text(src.id, 100), url: httpsUrl(src.url, SOURCE_HOSTS[provider]), updated_at: iso(src.updated_at), fetched_at: iso(src.fetched_at) },
      first_published_at: iso(e.first_published_at), revised_at: iso(e.revised_at),
      correction: revisionNote(e.correction), news_coverage: coverageList(e.news_coverage)
    };
  } else {
    out = {
      ...base, source: { id: text(src.id, 100), url: httpsUrl(src.url, SOURCE_HOSTS[provider]) }, first_published_at: iso(e.first_published_at),
      withdrawn_at: e.state === 'withdrawn_by_source' ? iso(e.withdrawn_at) : null, retracted_at: e.state === 'retracted' ? iso(e.retracted_at) : null
    };
  }
  if (history) out.history = (Array.isArray(e.history) ? e.history : []).slice(0, 50).map(revisionNote).filter(Boolean);
  return out;
}
function publicSource(s) {
  if (!isObject(s) || !GOVERNMENT_PROVIDERS.includes(s.provider)) return null;
  return { provider: s.provider, status: RUN_STATUSES.includes(s.status) ? s.status : null, checked_at: iso(s.checked_at), last_success_at: iso(s.last_success_at) };
}
/* the store's page, whitelisted; null when it is not one */
export function publicPage(v) {
  if (!isObject(v) || v.schema !== PAGE_SCHEMA || !Array.isArray(v.events) || !Array.isArray(v.sources)) return null;
  const seen = new Set();
  return {
    schema: PAGE_SCHEMA,
    events: v.events.slice(0, 200).map((e) => publicEvent(e)).filter((e) => e && !seen.has(e.id) && seen.add(e.id)),
    next_cursor: typeof v.next_cursor === 'string' && CURSOR.test(v.next_cursor) ? v.next_cursor : null,
    sources: v.sources.slice(0, GOVERNMENT_PROVIDERS.length).map(publicSource).filter(Boolean)
  };
}
/* the store's answer for one id, whitelisted; null when it is not one */
export function publicEventAnswer(v) {
  if (!isObject(v) || v.schema !== EVENT_SCHEMA || !EVENT_STATUSES.includes(v.status)) return null;
  const shown = SHOWN.includes(v.status), event = shown ? publicEvent(v.event, { history: true }) : null;
  if (shown && (!event || event.state !== v.status)) return null;
  const id = typeof v.id === 'string' && EVENT_ID.test(v.id) ? v.id : null;
  return { schema: EVENT_SCHEMA, status: v.status, id, redirected_from: typeof v.redirected_from === 'string' && EVENT_ID.test(v.redirected_from) && v.redirected_from !== id ? v.redirected_from : null, event };
}

/* ---------- the store ---------- */
/* What a store refusal means to the public. The store's own gate agrees with the Worker's (EUM01, EUM03 off; EUM00 the policy
   unreadable); anything not named here, an unreachable store, a redirect, a timeout and an unreadable body are 503
   events_unavailable with reason store_unavailable. Store text never reaches an answer. */
const OFF = Object.freeze({ status: 404, code: 'module_disabled' });
const POLICY_OUTAGE = Object.freeze({ status: 503, code: 'module_policy_unavailable' });
const unavailable = (reason) => Object.freeze({ status: 503, code: 'events_unavailable', reason });
const UNREADABLE = unavailable('store_unavailable');
export const STORE_REFUSALS = Object.freeze({
  EUM01: OFF, EUM03: OFF, EUM00: POLICY_OUTAGE,
  PGRST202: unavailable('store_not_applied'), '42883': unavailable('store_not_applied'),
  '55P03': unavailable('store_busy'), '57014': unavailable('store_busy'),
  '22023': Object.freeze({ status: 400, code: 'invalid_request' })
});
async function storeRead(env, fetchImpl, name, args, timeoutMs = STORE_TIMEOUT_MS) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return { refusal: UNREADABLE };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    let res;
    try {
      res = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', redirect: 'manual', signal: controller ? controller.signal : undefined,
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(args)
      });
    } catch { return { refusal: UNREADABLE }; }
    if (!res || (res.status >= 300 && res.status < 400)) return { refusal: UNREADABLE };
    let value;
    try { value = await res.json(); } catch { value = undefined; }
    if (!res.ok) {
      const code = isObject(value) && typeof value.code === 'string' ? value.code : '';
      return { refusal: Object.hasOwn(STORE_REFUSALS, code) ? STORE_REFUSALS[code] : UNREADABLE };
    }
    return value === undefined ? { refusal: UNREADABLE } : { value };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ---------- at most 60 seconds at the edge, one store read per burst ---------- */
const FLIGHTS = new WeakMap(); /* fetchImpl -> Map(cache key -> the read in flight), one isolate's memory only */
const NO_FETCH = {};
function flightsFor(fetchImpl) {
  const owner = typeof fetchImpl === 'function' || isObject(fetchImpl) ? fetchImpl : NO_FETCH;
  let map = FLIGHTS.get(owner);
  if (!map) { map = new Map(); FLIGHTS.set(owner, map); }
  return map;
}
const cacheRequest = (name, key) => new Request(`https://cache.mccluster.internal/world/environment/events/v1/${name}?${key}`);
/* One store read, kept EVENTS_CACHE_SECONDS: the kept copy when it is younger, else one read shared by every request in flight
   for the same key. `project` whitelists the answer (null: unreadable, never kept). `key` names what is read (a query, or a
   purpose whose arguments move with the clock). */
async function keptRead(env, { fetchImpl = fetch, cacheImpl = null, now = Date.now } = {}, name, args, project, key) {
  const store = cacheImpl || (globalThis.caches && globalThis.caches.default) || null;
  const request = cacheRequest(name, key);
  if (store) {
    const hit = await store.match(request).catch(() => null);
    const kept = hit ? await hit.json().catch(() => null) : null;
    const age = kept && Number.isFinite(kept.stored_at) ? now() - kept.stored_at : NaN;
    if (age >= 0 && age < EVENTS_CACHE_SECONDS * 1000 && isObject(kept.value)) return { value: kept.value };
  }
  const flights = flightsFor(fetchImpl), running = flights.get(request.url);
  if (running) return running;
  const run = (async () => {
    const r = await storeRead(env, fetchImpl, name, args);
    if (r.refusal) return r;
    const value = project(r.value);
    if (!value) return { refusal: UNREADABLE };
    if (store) {
      await store.put(request, new Response(JSON.stringify({ stored_at: now(), value }), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${EVENTS_CACHE_SECONDS}` }
      })).catch(() => {});
    }
    return { value };
  })();
  flights.set(request.url, run);
  const done = () => { if (flights.get(request.url) === run) flights.delete(request.url); };
  run.then(done, done);
  return run;
}

/* ---------- the routes ---------- */
function send(request, env, body, status = 200) {
  const res = reply(request, env, body, status);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
const refuse = (request, env, r) => send(request, env, { ok: false, code: r.code, ...(r.reason ? { reason: r.reason } : {}) }, r.status);
/* the page's query: since and until as ISO 8601 times (since before until), a cursor this route gave, a limit of 1 to 50 */
export function pageQuery(url) {
  const at = (name) => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === '') return null;
    const t = raw.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(raw) ? Date.parse(raw) : NaN;
    return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  };
  const since = at('since'), until = at('until');
  if (since === undefined || until === undefined) return null;
  if (since && until && Date.parse(since) >= Date.parse(until)) return null;
  const cursor = url.searchParams.get('cursor') || null;
  if (cursor !== null && !CURSOR.test(cursor)) return null;
  const asked = url.searchParams.get('limit');
  let limit = PAGE_LIMITS.fallback;
  if (asked !== null && asked !== '') {
    if (!/^\d{1,3}$/.test(asked) || Number(asked) < 1 || Number(asked) > PAGE_LIMITS.max) return null;
    limit = Number(asked);
  }
  return { since, until, cursor, limit };
}
const queryKey = (q) => new URLSearchParams(Object.entries(q).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)])).toString();

/* null when the path is not one of these routes. `gate` is required: without one, nothing is served. */
export async function handleEnvironmentEvents(request, env, { fetchImpl = fetch, cacheImpl = null, gate = null, now = Date.now } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== EVENTS_PATH && !path.startsWith(`${EVENTS_PATH}/`)) return null;
  let refusal;
  try { refusal = typeof gate === 'function' ? await gate() : POLICY_OUTAGE; } catch { refusal = POLICY_OUTAGE; }
  if (refusal) return send(request, env, { ok: false, code: refusal.code }, refusal.status);
  if (request.method !== 'GET') return send(request, env, { ok: false, code: 'method_not_allowed' }, 405);
  const ctx = { fetchImpl, cacheImpl, now };
  if (path === EVENTS_PATH) {
    const q = pageQuery(url);
    if (!q) return send(request, env, { ok: false, code: 'invalid_request' }, 400);
    const r = await keptRead(env, ctx, 'eup_environment_public_events', { p_since: q.since, p_until: q.until, p_cursor: q.cursor, p_limit: q.limit }, publicPage, queryKey(q));
    if (r.refusal) return refuse(request, env, r.refusal);
    return send(request, env, { ok: true, ...r.value, query: q });
  }
  const m = /^\/([^/]+)$/.exec(path.slice(EVENTS_PATH.length));
  if (!m) return send(request, env, { ok: false, code: 'not_found' }, 404);
  let id = '';
  try { id = decodeURIComponent(m[1]); } catch { id = ''; }
  if (!EVENT_ID.test(id)) return send(request, env, { ok: false, code: 'invalid_event' }, 400);
  const r = await keptRead(env, ctx, 'eup_environment_public_event', { p_id: id }, publicEventAnswer, queryKey({ id }));
  if (r.refusal) return refuse(request, env, r.refusal);
  const shown = SHOWN.includes(r.value.status);
  return send(request, env, { ok: shown, ...(shown ? {} : { code: r.value.status }), ...r.value }, shown ? 200 : 404);
}

/* ---------- the public feed's USGS source, from the same store ----------
   ./world-environment.js environmentFeed reads each source through readSource(spec); for the public answer the USGS source is
   this, not USGS's live summary feed (decision D7, default adopted pending Matthew's confirmation: the globe and the timeline show
   the same set). The rows are the store's published quakes of the past day in the pinned product's quake shape, so it builds the
   ids it always built ('usgs:' + id): the canonical ids. Each outcome carries `extra` (id -> { revision }) for the feed to add
   back, `reason` (what the source says when it is not current) and `last_success_at` (the store's last successful USGS read).
     reason  store_unavailable   the store did not answer readably (an outage)
             store_not_applied   the store's SQL is not applied (supabase/pending/20261119100000_eup_environment_events_v1_0*.sql)
             store_busy          the store is busy (an outage of this read)
             not_shown           the owner has not shown USGS on the timeline (no rule set yet, or hidden)
             no_reading          shown, but the store has never read USGS
             upstream_error      the store's last read of USGS failed: the earlier events are served, stale
             paused              the owner paused the ingest: the earlier events are served, stale
             not_recent          the store's last read of USGS is older than 30 minutes: stale
   A module the store finds off (EUM01, EUM03) reads 'module_disabled'; it cannot be, past the Worker's own gate, unless the
   owner turned it off within this request. */
export function storeUsgsReader(env, { fetchImpl = fetch, cacheImpl = null, now = Date.now } = {}) {
  return async () => {
    const t = now();
    const r = await keptRead(env, { fetchImpl, cacheImpl, now }, 'eup_environment_public_events',
      { p_since: new Date(t - FEED_WINDOW_MS).toISOString(), p_until: null, p_cursor: null, p_limit: FEED_LIMIT }, publicPage, 'feed=usgs-day');
    if (r.refusal) {
      return { body: { unavailable: true, fetched_at: null, quakes: [], coverage: STORE_USGS_COVERAGE }, stale: false,
        reason: r.refusal.reason || r.refusal.code, last_success_at: null, extra: new Map() };
    }
    const page = r.value, src = page.sources.find((s) => s.provider === 'usgs') || null;
    const quakes = [], extra = new Map();
    for (const e of page.events) {
      if (e.provider !== 'usgs' || e.state !== 'published' || e.lat === null || e.lon === null) continue;
      quakes.push({ id: e.id.slice('usgs:'.length), place: e.place || e.title, observed_at: e.observed_at, lat: e.lat, lon: e.lon,
        mag: e.magnitude, depth_km: e.depth_km, tsunami: e.tsunami, url: e.source.url });
      extra.set(e.id, { revision: e.revision });
    }
    const checked = src && src.checked_at ? Date.parse(src.checked_at) : NaN;
    let off = false, stale = false, reason = null;
    if (!src) { off = true; reason = 'not_shown'; }
    else if (!src.status) { off = !quakes.length; stale = !!quakes.length; reason = 'no_reading'; }
    else if (src.status === 'paused') { stale = true; reason = 'paused'; }
    else if (src.status === 'unavailable') { stale = true; reason = 'upstream_error'; }
    else if (!Number.isFinite(checked) || t - checked > NOT_RECENT_MS) { stale = true; reason = 'not_recent'; }
    const last = src ? src.last_success_at : null;
    return { body: { quakes, fetched_at: last, coverage: STORE_USGS_COVERAGE, ...(off ? { unavailable: true } : {}) }, stale, reason, last_success_at: last, extra };
  };
}
