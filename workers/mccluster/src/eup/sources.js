/* E=Up Sources & Review: connector registry state, rights/configuration,
   coverage, imports, review queue, corrections, bounded refresh/pause.
   Owner-only (router). Reads and writes go through the service-role RPCs in
   ./intake.js. No connector is configured in this release: every refresh
   answers 503 not_configured honestly until an owner review records approval
   and the credential bindings exist. Held sources (OpenFEC, market prices,
   LegiScan secondary, congressional disclosures) are never fetched.
   Refresh, resume and correct are guarded writes of module intake: while that module is not installed,
   draining or disabled the store refuses them and ./intake.js answers with the shared module-policy reasons
   (module_not_installed, module_draining, module_disabled, module_policy_changed, module_busy) instead of
   storage_unavailable. Pause only removes work, so the store keeps it possible in every state. Reads are
   never guarded: the registry, the runs and the review queue answer whatever the module state is. */
import { FEED_REGISTRY, RETIRED_DEPENDENCIES, feedById, sourceRow, bindingsPresent } from './registry.js';
import { readSourceStates, readReview, readRuns, sourcesCommand, assertFetchAllowed, storageConfigured } from './intake.js';

const KEY = /^[A-Za-z0-9._:-]{8,128}$/;

async function readBody(request, fail) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw fail(415, 'JSON required', 'invalid_request');
  const text = await request.text();
  if (text.length > 16384) throw fail(413, 'Body too large', 'invalid_request');
  try { const b = JSON.parse(text); if (!b || typeof b !== 'object' || Array.isArray(b)) throw 0; return b; } catch { throw fail(400, 'Invalid JSON', 'invalid_request'); }
}

/* Existing civic_source_registry rows (the applied 20261014021057 schema) are
   reflected by key, not duplicated: a feed that names a civic_source_key shows
   that row's enabled flag as `civic_registry`. Reads use the service role;
   failure to read is reported, not turned into "disabled". */
async function civicRegistry(env, ctx) {
  if (!storageConfigured(env)) return { status: 'unavailable', rows: [] };
  /* bare call: the Worker's fetch throws "Illegal invocation" when called as a method of ctx */
  const fetchImpl = typeof ctx?.fetchImpl === 'function' ? ctx.fetchImpl : fetch;
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/civic_source_registry?select=source_key,enabled,last_checked_at&limit=100`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }
    });
    if (!res.ok) return { status: 'unavailable', rows: [] };
    const rows = await res.json();
    return { status: 'available', rows: Array.isArray(rows) ? rows : [] };
  } catch { return { status: 'unavailable', rows: [] }; }
}

export async function listSources(env, ctx) {
  const now = typeof ctx.now === 'function' ? ctx.now() : Date.now();
  let states = []; let storage = 'available';
  try { states = await readSourceStates(env, ctx); } catch (error) { if (error?.reason !== 'storage_unavailable') throw error; storage = 'unavailable'; }
  const byId = new Map(states.map((s) => [s.source_id, s]));
  const registry = await civicRegistry(env, ctx);
  const civicByKey = new Map(registry.rows.map((r) => [r.source_key, r]));
  const sources = FEED_REGISTRY.map((feedEntry) => {
    const row = sourceRow(feedEntry, byId.get(feedEntry.id) || null, { now }, env);
    const civic = feedEntry.civic_source_key ? civicByKey.get(feedEntry.civic_source_key) || null : null;
    return { ...row, bindings_present: bindingsPresent(feedEntry, env), civic_registry: civic ? { enabled: civic.enabled === true, last_checked_at: civic.last_checked_at || null } : null };
  });
  return { sources, storage, civic_registry: registry.status, retired_dependencies: RETIRED_DEPENDENCIES, ingestion_enabled: sources.some((s) => s.configured && !s.paused) };
}

/* Overview rows: one line per source with its honest status. */
export async function sourcesSummary(env, ctx = {}) {
  const context = { fetchImpl: ctx.fetchImpl || fetch, now: ctx.now || Date.now };
  const { sources, storage } = await listSources(env, context);
  return sources.map((s) => ({ source: s.id, status: s.access === 'held' ? 'held' : (!s.configured ? 'not_configured' : (s.paused ? 'paused' : s.availability)), fetched_at: s.last_success_at, upstream_updated_at: null, storage }));
}

export async function handleSources(request, env, ctx) {
  const { user, parts, url, fail } = ctx;
  const method = request.method;
  if (parts.length === 0 && method === 'GET') return { ok: true, ...(await listSources(env, ctx)) };
  if (parts[0] === 'review' && parts.length === 1 && method === 'GET') {
    const status = url.searchParams.get('status') || 'open';
    if (!['open', 'resolved', 'rejected'].includes(status)) throw fail(400, 'status must be open, resolved or rejected', 'invalid_request');
    const review = await readReview(env, ctx, status);
    return { ok: true, items: review?.items || [], corrections: review?.corrections || [] };
  }
  if (parts[0] === 'review' && parts.length === 3 && parts[2] === 'correct' && method === 'POST') {
    const body = await readBody(request, fail);
    if (!KEY.test(String(body.idempotency_key || ''))) throw fail(400, 'idempotency_key required (8-128 safe characters)', 'invalid_request');
    if (!Number.isInteger(body.expected_revision)) throw fail(400, 'expected_revision required', 'invalid_request');
    const result = await sourcesCommand(env, ctx, 'correct', { review_item_id: parts[1], expected_revision: body.expected_revision, idempotency_key: body.idempotency_key, correction: body.correction || {} }, user.id);
    return { ok: true, ...result };
  }
  const feedEntry = feedById(parts[0]);
  if (!feedEntry) throw fail(404, 'Unknown source', 'unknown_source');
  if (parts.length === 1 && method === 'GET') {
    const [states, runs] = await Promise.all([readSourceStates(env, ctx), readRuns(env, ctx, feedEntry.id)]);
    const state = states.find((s) => s.source_id === feedEntry.id) || null;
    return { ok: true, source: { ...sourceRow(feedEntry, state, { now: ctx.now() }, env), bindings_present: bindingsPresent(feedEntry, env) }, runs: runs || [] };
  }
  if (parts.length === 2 && parts[1] === 'refresh' && method === 'POST') {
    const body = await readBody(request, fail);
    if (!KEY.test(String(body.idempotency_key || ''))) throw fail(400, 'idempotency_key required (8-128 safe characters)', 'invalid_request');
    const states = await readSourceStates(env, ctx);
    const state = states.find((s) => s.source_id === feedEntry.id) || null;
    /* The gate decides before anything is queued: rights, configuration, bindings, pause. */
    assertFetchAllowed(feedEntry.id, state, env, { now: ctx.now() });
    const result = await sourcesCommand(env, ctx, 'refresh', { source_id: feedEntry.id, idempotency_key: body.idempotency_key }, user.id);
    return { ok: true, ...result, bounded: true, note: 'Queued for the canonical persistent executor; a queued run is not a successful import.' };
  }
  if (parts.length === 2 && (parts[1] === 'pause' || parts[1] === 'resume') && method === 'POST') {
    const result = await sourcesCommand(env, ctx, parts[1], { source_id: feedEntry.id }, user.id);
    return { ok: true, ...result };
  }
  throw fail(404, 'Unknown sources route', 'not_found');
}
