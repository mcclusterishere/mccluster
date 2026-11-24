/* E=Up → Environment: the house owner's controls for the E=UP environmental event timeline (owner direction 2026-11-19:
   "Start with owner controls for source health, review and rollback"; slice S2 of docs/control-plane/EUP-EVENT-TIMELINE.md).
   Reached only through ../router.js after the verified house-owner check (requireHouseOwner in index.js): a signed-out
   request is 401 and a signed-in account that is not a house owner is 403 before anything here runs, and every answer is
   private, no-store. The acting owner is always the verified session user, never a body field; the store's functions
   check house ownership again in their own transaction (42501).

     GET  /v1/eup/environment/health          every E=UP source, three facts each: what a signed-out visitor gets for it NOW
                                              (off, outage, no data or reporting), what the provider answers now (a live read
                                              through the public routes' own code and kept copies, whatever the module's state),
                                              and the event store's durable view (provider policy, last ingest run, last success)
     GET  /v1/eup/environment/review          the store's review queue, provider policies and decision log (?limit=1..200)
     GET  /v1/eup/environment/events/:id      one event in full: revisions, aliases, coverage, decisions, its public shape
     GET  /v1/eup/environment/preview         the public timeline page exactly as the public read projects it, readable while
                                              the module is off (?since&until&cursor&limit). Decision D11, default adopted
                                              pending Matthew's confirmation: an authorization addition (the owner reads what
                                              the public cannot yet), which ships only with his approval of the pull request.
     POST /v1/eup/environment/commands        { command, target, expected_revision, idempotency_key, reason, payload? }
                                              hold, release, retract (the owner's withdrawal), restore, rollback
                                              {to_revision}; set_rule {rule?}, pause_provider, resume_provider, hide_provider,
                                              show_provider; attach_coverage, reject_coverage, retract_coverage. The body rules
                                              are the module policy's (./../modules.js): a key of 8-128 safe characters, a reason
                                              of 1-500 characters on one line, the revision that was read. The same key and the
                                              same command answer the stored receipt (idempotent); a moved revision is 409.

   HONEST WHEN THE STORE IS ABSENT. The five reviewed store parts are named in ENVIRONMENT_STORE_PARTS below.
   If its functions do not exist, a read answers 200 with store.status
   'not_applied' and everything else it knows (the module, the providers now); a command answers 503 store_not_applied and
   records nothing. An unreachable store is store.status 'unavailable' on the health read and 503 storage_unavailable
   elsewhere. While the environment module is off (never installed, or disabled) every route here still answers, so the
   owner sees sources, review and preview before anything is public; nothing here installs, enables or changes the module.

   OFF, OUTAGE AND NO DATA, PER SOURCE (the same words as the public answers, ../../world-environment-guard.js):
     off        the public answers 404 module_disabled (the module is not installed or is disabled), or the provider is not
                configured here (FIRMS without the Worker secret FIRMS_MAP_KEY, named, never read into an answer)
     outage     the module policy cannot be read (503), or the provider failed or timed out (a kept copy may still be served:
                reason 'stale')
     no data    the provider answered and reported nothing
     reporting  the provider answered with items
   The live read goes through the public routes' own kept copies (the Cache API keys `consumer-environment-v1-*` and the
   shared in-flight reads of ../../world-environment-guard.js), so an owner check never asks a provider twice for what a
   visitor's page is already asking, and what it fills is what the public would be served once the module is on.

   NOTHING PRIVATE LEAVES THE OWNER: no store table is read directly; the three owner functions answer whitelisted JSON.
   No provider message, URL with a credential, or store message is passed on: codes and fixed sentences only. */
import { readModulePolicy } from '../modules.js';
import { environmentFeed } from '../../world-environment.js';
import { handleEnvironmentLayers } from '../../world-environment-layers.js';
import { OFF, refusalOf } from '../../world-environment-guard.js';

export const ENVIRONMENT_STORE_PARTS = Object.freeze([
  'supabase/migrations/20261120061725_eup_environment_events_v1_01.sql',
  'supabase/migrations/20261120061759_eup_environment_events_v1_02.sql',
  'supabase/migrations/20261123173831_eup_environment_events_v1_03.sql',
  'supabase/migrations/20261123173951_eup_environment_events_v1_04.sql',
  'supabase/migrations/20261123174034_eup_environment_events_v1_05.sql'
]);
export const GOVERNMENT_PROVIDERS = Object.freeze(['usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops']);
export const EVENT_COMMANDS = Object.freeze(['hold', 'release', 'retract', 'restore', 'rollback']);
export const PROVIDER_COMMANDS = Object.freeze(['set_rule', 'pause_provider', 'resume_provider', 'hide_provider', 'show_provider']);
export const COVERAGE_COMMANDS = Object.freeze(['attach_coverage', 'reject_coverage', 'retract_coverage']);
export const COMMANDS = Object.freeze([...EVENT_COMMANDS, ...PROVIDER_COMMANDS, ...COVERAGE_COMMANDS]);
export const SOURCE_STATES = Object.freeze(['off', 'outage', 'no_data', 'reporting']);
export const STORE_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 4096;
const EVENT_ID = /^(usgs|nws|nhc|eonet|firms|wfigs|coops):[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/;
const COVERAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const CURSOR = /^-?[0-9]{1,17}\|(usgs|nws|nhc|eonet|firms|wfigs|coops):[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const STORE_STATUS = Object.freeze({ not_applied: 'not_applied', applied: 'applied', unavailable: 'unavailable' });

/* SQLSTATE (or PostgREST code) of the store's three owner functions -> [HTTP status, reason]. Anything not named here, an
   unreachable store, a redirect, a timeout and an unreadable body are 503 storage_unavailable: for a command that means
   the outcome is UNKNOWN (read back and look for the key), never "failed". */
const table = (rows) => Object.freeze(Object.fromEntries(Object.entries(rows).map(([code, pair]) => [code, Object.freeze(pair)])));
export const ENVIRONMENT_STORE_ERRORS = table({
  '42501': [403, 'owner_required'], '22023': [422, 'invalid'], '40001': [409, 'revision_conflict'],
  '55P03': [503, 'store_busy'], '57014': [503, 'store_busy'],
  EUE01: [409, 'provider_not_configured'], EUE03: [404, 'not_found'], EUE04: [409, 'invalid_transition'],
  EUE06: [409, 'idempotency_conflict'], EUE07: [422, 'provider_not_supported'],
  PGRST202: [503, 'store_not_applied'], '42883': [503, 'store_not_applied']
});
/* What the owner is told. Fixed text per reason: a store or provider message is never passed through. */
const MESSAGES = Object.freeze({
  owner_required: 'House owner required',
  invalid: 'The environment command or read is not valid',
  revision_conflict: 'It changed since it was read; nothing was changed. Read it again and decide again',
  store_busy: 'The event store is busy with this record; nothing was changed. The same command can be sent again with the same key',
  provider_not_configured: 'The provider has no rule yet; set its rule first',
  not_found: 'No such event or coverage in the event store',
  invalid_transition: 'Not allowed from the current state; nothing was changed',
  idempotency_conflict: 'This idempotency key was already used for a different command',
  provider_not_supported: 'Only USGS has an ingest so far; nothing was changed',
  provider_refused: 'Only the seven government providers can be configured; news is never a provider',
  store_not_applied: 'The E=UP event store is not applied; nothing was recorded',
  storage_unavailable: 'The E=UP event store did not answer readably; the outcome is unknown',
  read_busy: 'The E=UP event store is busy; nothing was read. Read again',
  read_unavailable: 'The E=UP event store did not answer readably; nothing is shown as if it had',
  invalid_target: 'The command target is not valid for this command',
  invalid_command: 'Unknown environment command',
  invalid_payload: 'The command payload is not valid for this command',
  invalid_event: 'Not an event id (<provider>:<id>)',
  invalid_request: 'The query is not valid'
});

/* ---------------------------------------------------------------- the store */
/* One service-role RPC to one of the three owner functions. Throws fail(status, message, reason) with the store's own code
   as .sqlstate when the code is one this file names. */
async function storeRpc(env, fetchImpl, fail, name, args, timeoutMs = STORE_TIMEOUT_MS) {
  const unavailable = () => fail(503, MESSAGES.storage_unavailable, 'storage_unavailable');
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) throw unavailable();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs > 0 ? timeoutMs : STORE_TIMEOUT_MS) : null;
  try {
    let response;
    try {
      response = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', redirect: 'manual', signal: controller ? controller.signal : undefined,
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(args)
      });
    } catch { throw unavailable(); }
    if (response.status >= 300 && response.status < 400) throw unavailable();
    let value;
    try { value = await response.json(); } catch { value = undefined; }
    if (!response.ok) {
      const code = typeof value?.code === 'string' ? value.code : '';
      if (!Object.hasOwn(ENVIRONMENT_STORE_ERRORS, code)) throw unavailable();
      const [status, reason] = ENVIRONMENT_STORE_ERRORS[code];
      throw Object.assign(fail(status, MESSAGES[reason], reason), { sqlstate: code });
    }
    if (value === undefined) throw unavailable();
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const ownerRead = (env, fetchImpl, fail, actor, eventId, limit, timeoutMs) =>
  storeRpc(env, fetchImpl, fail, 'eup_environment_owner_read', { p_actor: actor, p_event_id: eventId, p_limit: limit }, timeoutMs);
const ownerPreview = (env, fetchImpl, fail, actor, q, timeoutMs) =>
  storeRpc(env, fetchImpl, fail, 'eup_environment_owner_preview', { p_actor: actor, p_since: q.since, p_until: q.until, p_cursor: q.cursor, p_limit: q.limit }, timeoutMs);
const ownerCommand = (env, fetchImpl, fail, args, timeoutMs) => storeRpc(env, fetchImpl, fail, 'eup_environment_owner_command', args, timeoutMs);

/* A failed READ: the store not applied is a state the owner is told, not an error; a refused owner is the router's 403;
   anything else is the store being unavailable. */
function storeState(error) {
  if (error?.reason === 'store_not_applied') return { status: STORE_STATUS.not_applied, reason: 'store_not_applied', parts: ENVIRONMENT_STORE_PARTS };
  if (error?.status === 403) throw error;
  return { status: STORE_STATUS.unavailable, reason: error?.reason === 'store_busy' ? 'store_busy' : 'storage_unavailable' };
}
/* A failed read that is not a state, in words about reading (the command sentences speak of outcomes and of sending again). */
const readRefusal = (fail, reason) => (reason === 'store_busy' ? fail(503, MESSAGES.read_busy, 'store_busy') : fail(503, MESSAGES.read_unavailable, 'storage_unavailable'));
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/* The owner read as the store builds it (part 04): anything else is not drawn as if it were. */
function ownerShape(v) {
  return isObject(v) && v.schema === 'mccluster.environment-owner/v1' && isObject(v.module) && Array.isArray(v.providers)
    && Array.isArray(v.health) && isObject(v.review) && Array.isArray(v.decisions);
}

/* ---------------------------------------------------------------- the module, as the public gate reads it */
/* The environment module's policy, read exactly as the public routes' gate reads it (no identity, the service key, no
   cache). gate: 'on' (enabled or draining: the public routes answer), 'off' (never installed, or disabled: 404
   module_disabled), 'outage' (the policy cannot be read: 503 module_policy_unavailable). */
export async function environmentModule(env, fetchImpl) {
  try {
    const p = await readModulePolicy(env, fetchImpl, 'environment');
    return { status: 'read', installed: true, state: p.state, revision: p.revision, gate: p.state === 'disabled' ? 'off' : 'on', reason: null };
  } catch (error) {
    if (refusalOf(error) === OFF) return { status: 'read', installed: false, state: null, revision: null, gate: 'off', reason: null };
    return { status: 'unreadable', installed: null, state: null, revision: null, gate: 'outage', reason: typeof error?.reason === 'string' ? error.reason : 'module_policy_unavailable' };
  }
}

/* ---------------------------------------------------------------- the providers now */
export const PROVIDER_LABELS = Object.freeze({
  usgs: 'USGS earthquakes', nws: 'NOAA National Weather Service alerts', nhc: 'NOAA National Hurricane Center storms',
  eonet: 'NASA EONET natural events', firms: 'NASA FIRMS fire detections', wfigs: 'NIFC WFIGS fire perimeters', coops: 'NOAA CO-OPS water levels'
});
/* Every public read a visitor's page makes, by provider. The feed's four sources come from one read of the feed; each
   globe layer is its own route. ShakeMap and one station's water level are on-demand lookups a visitor asks for one
   event or station at a time: they are not part of a source check. */
const ROOT = '/v1/world/environment';
export const LIVE_SURFACES = Object.freeze([
  { id: 'feed:usgs', provider: 'usgs', kind: 'feed', source: 'usgs', label: 'Feed: earthquakes of the past day' },
  { id: 'feed:nws', provider: 'nws', kind: 'feed', source: 'nws', label: 'Feed: active alerts' },
  { id: 'layer:alerts', provider: 'nws', kind: 'layer', path: `${ROOT}/layers/alerts`, label: 'Globe layer: alert polygons', items: (b) => b.count },
  { id: 'feed:nhc', provider: 'nhc', kind: 'feed', source: 'nhc', label: 'Feed: tropical cyclones' },
  { id: 'feed:eonet', provider: 'eonet', kind: 'feed', source: 'eonet', label: 'Feed: open natural events' },
  { id: 'layer:eonet', provider: 'eonet', kind: 'layer', path: `${ROOT}/layers/eonet`, label: 'Globe layer: natural-event tracks', items: (b) => b.count },
  { id: 'layer:fires', provider: 'firms', kind: 'layer', path: `${ROOT}/layers/fires`, label: 'Globe layer: fire detections (24 h)', items: (b) => b.count },
  { id: 'layer:perimeters', provider: 'wfigs', kind: 'layer', path: `${ROOT}/layers/perimeters`, label: 'Globe layer: fire perimeters', items: (b) => b.count },
  { id: 'layer:tides', provider: 'coops', kind: 'layer', path: `${ROOT}/layers/tides`, label: 'Globe layer: latest water levels', items: (b) => b.latest && b.latest.answered }
].map((s) => Object.freeze(s)));
const LIVE_ORIGIN = 'https://api.mccluster.org';
const iso = (v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
/* the health record of one provider read (../../world-layers.js sourceHealth), whitelisted */
function healthRecord(s) {
  if (!isObject(s)) return null;
  return { id: typeof s.id === 'string' ? s.id : null, label: typeof s.label === 'string' ? s.label : null,
    status: ['available', 'stale', 'unavailable'].includes(s.status) ? s.status : 'unavailable', reason: typeof s.reason === 'string' ? s.reason : null,
    fetched_at: iso(s.fetched_at), last_success_at: iso(s.last_success_at) };
}
/* One surface's state from its health records and its item count. Pure; exported for the tests. */
export function surfaceState(sources, items) {
  const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
  if (!list.length) return { state: 'outage', reason: 'no_answer' };
  const notConfigured = (s) => s.status === 'unavailable' && s.reason === 'not_configured';
  if (list.every(notConfigured)) return { state: 'off', reason: 'not_configured' };
  const bad = list.find((s) => s.status !== 'available' && !notConfigured(s));
  if (bad) return { state: 'outage', reason: bad.status === 'stale' ? 'stale' : (bad.reason || 'upstream_error') };
  if (items === null) return { state: 'outage', reason: 'unreadable' };
  return items > 0 ? { state: 'reporting', reason: null } : { state: 'no_data', reason: null };
}
/* A provider's state from its surfaces: off when every surface is off; an outage when any surface is; no data when
   nothing reported; else reporting. Pure. */
export function providerState(surfaces) {
  const list = Array.isArray(surfaces) ? surfaces : [];
  if (!list.length) return { state: 'outage', reason: 'no_answer' };
  if (list.every((s) => s.state === 'off')) return { state: 'off', reason: list[0].reason };
  const down = list.find((s) => s.state === 'outage');
  if (down) return { state: 'outage', reason: down.reason };
  if (list.every((s) => s.state === 'no_data' || s.state === 'off')) return { state: 'no_data', reason: null };
  return { state: 'reporting', reason: null };
}
/* What a signed-out visitor gets for one provider right now. Pure. */
export function publicState(module, provider) {
  if (module.gate === 'off') return { state: 'off', reason: module.installed ? 'module_disabled' : 'module_not_installed' };
  if (module.gate !== 'on') return { state: 'outage', reason: 'module_policy_unreadable' };
  return { state: provider.state, reason: provider.reason };
}
/* The live read of every surface, through the public routes' own code with the gate passed (this is the owner's check,
   behind the owner's route; nothing it reads is answered to anyone else). Each surface settles on its own provider
   timeouts (at most FIRMS's 25 s); one failing never hides another. */
export async function liveSurfaces(env, fetchImpl, { cacheImpl = null } = {}) {
  const pass = async () => null;
  const layer = (s) => handleEnvironmentLayers(new Request(LIVE_ORIGIN + s.path, { headers: { accept: 'application/json' } }), env, { fetchImpl, cacheImpl, gate: pass })
    .then(async (r) => (r && r.ok ? r.json() : null)).catch(() => null);
  const [feed, ...layers] = await Promise.all([
    environmentFeed(env, { fetchImpl, cacheImpl }).catch(() => null),
    ...LIVE_SURFACES.filter((s) => s.kind === 'layer').map(layer)
  ]);
  const answers = new Map(LIVE_SURFACES.filter((s) => s.kind === 'layer').map((s, i) => [s.id, layers[i]]));
  return LIVE_SURFACES.map((s) => {
    let sources = [], items = null;
    if (s.kind === 'feed') {
      const record = feed && Array.isArray(feed.sources) ? feed.sources.find((x) => x && x.id === s.source) : null;
      sources = record ? [healthRecord(record)] : [];
      items = feed && Array.isArray(feed.events) ? feed.events.filter((e) => e && e.source && e.source.id === s.source).length : null;
    } else {
      const b = answers.get(s.id);
      sources = b && Array.isArray(b.sources) ? b.sources.map(healthRecord).filter(Boolean) : [];
      items = b ? count(s.items(b)) : null;
    }
    return { id: s.id, provider: s.provider, kind: s.kind, label: s.label, items, sources, ...surfaceState(sources, items) };
  });
}

/* ---------------------------------------------------------------- the store's view of one provider */
const RUN_STATES = Object.freeze({ ok: 'ok', empty: 'no_data', unavailable: 'outage', paused: 'paused' });
export function storeProvider(p) {
  if (!isObject(p)) return null;
  const last = isObject(p.last_run) ? p.last_run : null;
  const state = !p.configured ? 'not_configured' : p.ingest === 'paused' ? 'paused' : !last ? 'never_run' : (RUN_STATES[last.status] || 'outage');
  return {
    state, configured: p.configured === true, supported: p.supported === true, ingest: p.ingest ?? null, publication: p.publication ?? null,
    rule: isObject(p.rule) ? p.rule : null, default_rule: isObject(p.default_rule) ? p.default_rule : null, revision: count(p.revision) ?? 0,
    updated_at: iso(p.updated_at), last_run: last, last_success_at: iso(p.last_success_at), events: isObject(p.events) ? p.events : {}
  };
}

/* ---------------------------------------------------------------- routes */
function limitOf(url, fail, fallback = 50) {
  const asked = url?.searchParams.get('limit');
  if (asked === null || asked === undefined) return fallback;
  if (!/^\d{1,3}$/.test(asked) || Number(asked) < 1 || Number(asked) > 200) throw fail(400, 'limit must be 1 to 200', 'invalid_request');
  return Number(asked);
}
async function health(env, { user, fetchImpl, fail, now, rpcTimeoutMs }) {
  /* three independent reads: one failing never hides the other two (a store outage still shows the providers) */
  const [gate, read, live] = await Promise.all([
    environmentModule(env, fetchImpl),
    ownerRead(env, fetchImpl, fail, user.id, null, 50, rpcTimeoutMs).then(
      (v) => (ownerShape(v) ? { status: STORE_STATUS.applied, value: v } : { status: STORE_STATUS.unavailable, reason: 'storage_unavailable' }),
      (error) => storeState(error)),
    liveSurfaces(env, fetchImpl)
  ]);
  const applied = read.status === STORE_STATUS.applied;
  const store = applied ? { status: STORE_STATUS.applied } : read;
  const sources = GOVERNMENT_PROVIDERS.map((provider) => {
    const surfaces = live.filter((s) => s.provider === provider);
    const current = providerState(surfaces);
    const row = applied ? read.value.providers.find((p) => p && p.provider === provider) : null;
    return { provider, label: PROVIDER_LABELS[provider], public: publicState(gate, current), provider_now: { ...current, surfaces }, store: row ? storeProvider(row) : null };
  });
  return { ok: true, schema: 'mccluster.environment-owner-health/v1', checked_at: new Date(now()).toISOString(), module: gate, store, sources,
    log: applied ? read.value.health : [] };
}
async function review(env, url, { user, fetchImpl, fail, rpcTimeoutMs }) {
  const limit = limitOf(url, fail);
  let v;
  try { v = await ownerRead(env, fetchImpl, fail, user.id, null, limit, rpcTimeoutMs); } catch (error) {
    const s = storeState(error);
    if (s.status === STORE_STATUS.not_applied) return { ok: true, schema: 'mccluster.environment-owner-review/v1', store: s, module: null, providers: [], review: null, decisions: [] };
    throw readRefusal(fail, s.reason);
  }
  if (!ownerShape(v)) throw readRefusal(fail, 'storage_unavailable');
  return { ok: true, schema: 'mccluster.environment-owner-review/v1', store: { status: STORE_STATUS.applied }, module: v.module,
    providers: v.providers.map((p) => (isObject(p) ? { provider: p.provider, label: PROVIDER_LABELS[p.provider] || p.provider, ...storeProvider(p) } : null)).filter(Boolean),
    review: v.review, decisions: v.decisions };
}
async function eventDetail(env, id, { user, fetchImpl, fail, rpcTimeoutMs }) {
  if (!EVENT_ID.test(id)) throw fail(400, MESSAGES.invalid_event, 'invalid_event');
  let v;
  try { v = await ownerRead(env, fetchImpl, fail, user.id, id, 1, rpcTimeoutMs); } catch (error) {
    const s = storeState(error);
    if (s.status === STORE_STATUS.not_applied) return { ok: true, store: s, event: null };
    throw readRefusal(fail, s.reason);
  }
  if (!ownerShape(v) || !Object.hasOwn(v, 'event') || (v.event !== null && !isObject(v.event))) throw readRefusal(fail, 'storage_unavailable');
  if (v.event === null) throw fail(404, MESSAGES.not_found, 'event_not_found');
  return { ok: true, store: { status: STORE_STATUS.applied }, event: v.event };
}
function previewQuery(url, fail) {
  const at = (name) => {
    const raw = url?.searchParams.get(name);
    if (raw === null || raw === undefined || raw === '') return null;
    const t = raw.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(raw) ? Date.parse(raw) : NaN;
    if (!Number.isFinite(t)) throw fail(400, `${name} must be an ISO 8601 time`, 'invalid_request');
    return new Date(t).toISOString();
  };
  const since = at('since'), until = at('until');
  if (since && until && Date.parse(since) >= Date.parse(until)) throw fail(400, 'since must be before until', 'invalid_request');
  const cursor = url?.searchParams.get('cursor') || null;
  if (cursor !== null && !CURSOR.test(cursor)) throw fail(400, 'cursor is not one this route gave', 'invalid_request');
  return { since, until, cursor, limit: limitOf(url, fail) };
}
async function preview(env, url, { user, fetchImpl, fail, rpcTimeoutMs }) {
  const q = previewQuery(url, fail);
  const [gate, read] = await Promise.all([
    environmentModule(env, fetchImpl),
    ownerPreview(env, fetchImpl, fail, user.id, q, rpcTimeoutMs).then((v) => ({ value: v }), (error) => ({ error }))
  ]);
  const base = { ok: true, schema: 'mccluster.environment-owner-preview/v1', owner_preview: true, module: gate, query: q };
  if (read.error) {
    const s = storeState(read.error);
    if (s.status === STORE_STATUS.not_applied) return { ...base, store: s, events: [], next_cursor: null, sources: [] };
    if (read.error?.status === 422) throw read.error;
    throw readRefusal(fail, s.reason);
  }
  const v = read.value;
  if (!isObject(v) || v.schema !== 'mccluster.environment-events/v1' || !Array.isArray(v.events) || !Array.isArray(v.sources)) throw readRefusal(fail, 'storage_unavailable');
  return { ...base, store: { status: STORE_STATUS.applied }, page_schema: v.schema, events: v.events, next_cursor: typeof v.next_cursor === 'string' ? v.next_cursor : null, sources: v.sources };
}

async function body(request, fail) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw fail(415, 'JSON required', 'json_required');
  const reader = request.body?.getReader();
  if (!reader) throw fail(400, 'Body required', 'body_required');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw fail(413, 'Body too large', 'body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let b;
  try { b = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw fail(400, 'Invalid JSON', 'invalid_json'); }
  if (!isObject(b)) throw fail(400, 'Invalid JSON', 'invalid_json');
  return b;
}
/* The command as the store will receive it, or a refusal before any call. */
export function commandArgs(b, actor, fail) {
  if (typeof b.idempotency_key !== 'string' || !KEY.test(b.idempotency_key)) throw fail(400, 'Idempotency key required (8 to 128 safe characters)', 'idempotency_key_required');
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  const length = [...reason].length;
  if (length < 1 || length > 500 || CONTROL_CHARACTER.test(reason)) throw fail(422, 'A reason of 1 to 500 characters is required', 'reason_required');
  if (!COMMANDS.includes(b.command)) throw fail(422, MESSAGES.invalid_command, 'invalid_command');
  const command = b.command, target = b.target;
  if (EVENT_COMMANDS.includes(command) && !(typeof target === 'string' && EVENT_ID.test(target))) throw fail(400, MESSAGES.invalid_target, 'invalid_target');
  if (PROVIDER_COMMANDS.includes(command)) {
    if (typeof target !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(target)) throw fail(400, MESSAGES.invalid_target, 'invalid_target');
    if (!GOVERNMENT_PROVIDERS.includes(target)) throw fail(422, MESSAGES.provider_refused, 'provider_refused');
  }
  if (COVERAGE_COMMANDS.includes(command) && !(typeof target === 'string' && COVERAGE_ID.test(target))) throw fail(400, MESSAGES.invalid_target, 'invalid_target');
  if (!Number.isSafeInteger(b.expected_revision) || b.expected_revision < 0) throw fail(400, 'Expected revision required', 'expected_revision_required');
  const payload = b.payload === undefined || b.payload === null ? {} : b.payload;
  if (!isObject(payload)) throw fail(422, MESSAGES.invalid_payload, 'invalid_payload');
  const keys = Object.keys(payload);
  if (command === 'rollback') {
    if (keys.length !== 1 || keys[0] !== 'to_revision' || !Number.isSafeInteger(payload.to_revision) || payload.to_revision < 1) throw fail(422, MESSAGES.invalid_payload, 'invalid_payload');
  } else if (command === 'set_rule') {
    if (keys.length > 1 || (keys.length === 1 && (keys[0] !== 'rule' || !isObject(payload.rule)))) throw fail(422, MESSAGES.invalid_payload, 'invalid_payload');
  } else if (keys.length) throw fail(422, MESSAGES.invalid_payload, 'invalid_payload');
  if (JSON.stringify(payload).length > 2000) throw fail(422, MESSAGES.invalid_payload, 'invalid_payload');
  return { p_actor: actor, p_command: command, p_target: target, p_expected_revision: b.expected_revision, p_key: b.idempotency_key, p_reason: reason, p_payload: payload };
}
/* The store's receipt (part 04), whitelisted. A 200 with anything else may still have been recorded: the outcome is
   unknown (503) and the caller reads back and looks for its key in the decision log. */
export function receiptShape(v) {
  if (!isObject(v) || v.schema !== 'mccluster.environment-decision/v1' || !COMMANDS.includes(v.command) || !['event', 'provider', 'coverage'].includes(v.target_kind)
    || typeof v.target !== 'string' || typeof v.changed !== 'boolean' || typeof v.recorded_at !== 'string') return null;
  return { schema: v.schema, command: v.command, target_kind: v.target_kind, target: v.target, changed: v.changed,
    prior: isObject(v.prior) ? v.prior : null, result: isObject(v.result) ? v.result : null, recorded_at: iso(v.recorded_at) };
}
async function command(request, env, { user, fetchImpl, fail, rpcTimeoutMs }) {
  const args = commandArgs(await body(request, fail), user.id, fail);
  const receipt = receiptShape(await ownerCommand(env, fetchImpl, fail, args, rpcTimeoutMs));
  if (!receipt) throw fail(503, MESSAGES.storage_unavailable, 'storage_unavailable');
  return { ok: true, receipt };
}

/* GET health | review | events/:id | preview, POST commands. Anything else under the section is 404; a known path with
   another method is 405. */
export async function handleEnvironmentOwner(request, env, ctx) {
  const { parts, url, fail } = ctx;
  const method = request.method;
  const route = parts.length === 1 ? parts[0] : parts.length === 2 && parts[0] === 'events' ? 'events' : null;
  const known = ['health', 'review', 'preview', 'commands', 'events'];
  if (!route || !known.includes(route) || (route === 'events' && parts.length !== 2)) throw fail(404, 'Environment route not found', 'not_found');
  const want = route === 'commands' ? 'POST' : 'GET';
  if (method !== want) throw fail(405, 'Method not allowed', 'method_not_allowed');
  const fetchImpl = ctx.fetchImpl || fetch;
  const c = { ...ctx, fetchImpl, now: typeof ctx.now === 'function' ? ctx.now : Date.now };
  if (route === 'health') return health(env, c);
  if (route === 'review') return review(env, url, c);
  if (route === 'preview') return preview(env, url, c);
  if (route === 'events') {
    let id;
    try { id = decodeURIComponent(parts[1]); } catch { throw fail(400, MESSAGES.invalid_event, 'invalid_event'); }
    return eventDetail(env, id, c);
  }
  return command(request, env, c);
}
