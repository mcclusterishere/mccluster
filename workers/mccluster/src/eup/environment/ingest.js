/* E=UP environmental event timeline, slice S3 (docs/control-plane/EUP-EVENT-TIMELINE.md): the USGS ingest into the pending
   event store. Private: nothing here answers a request, and nothing public changes until the store's parts are applied, the
   owner sets the USGS rule and the environment module is installed and enabled (each Matthew's separate go).

   FLAG. Nothing runs unless EUP_ENVIRONMENT_USGS_INGEST_ENABLED is exactly "true" (workers/mccluster/wrangler.toml sets
   "true" from Release 1 of 2026-11-23, Matthew's go; decision D20, default adopted pending Matthew's confirmation: the
   Worker's five-minute cron, like the private USGS collector). With the flag off the scheduled hook (../../entry.js)
   returns before any network or store call, and so does runUsgsIngest.

   ONE RUN (one cron tick), in order; every store call is service-role and names an entry point of store part 03
   (supabase/migrations/20261123173831_eup_environment_events_v1_03.sql, applied 2026-11-23):
     1. eup_environment_ingest_state: the provider's rule and switches, and the events ever published (neither withdrawn nor
        merged) observed in the last 26 hours, or 30 days on the sweep tick, with their aliases. Store not applied, provider
        not configured (no rule yet) or an unreadable store: the run stops here and asks USGS nothing. Paused: the run
        records its health row ('paused') and asks USGS nothing.
     2. The real-time summary feed for the rule (the M2.5+ day unless the rule's minimum magnitude is lower: ./usgs.js),
        through upstream() (../../world-layers.js: no cross-host redirect, typed failures, a 15 s deadline). A failed read
        is recorded as the run's health (unavailable, with the reason) and nothing else.
     3. Published events the feed no longer lists although they are still inside its day: at most 5 FDSN look-ups by id per
        run (jsonerror=true), newest first. 409 deleted -> a deletion (the store withdraws the event and keeps its tombstone);
        another preferred id -> the event under it (the store follows the alias, or merges two stored events); 404 -> asked
        again on a later run, nothing changes. USGS asks automated apps to prefer the feeds, so look-ups stay bounded.
     4. Once a day (the tick at 03:10 UTC): one FDSN search for what USGS updated in the last 48 hours, deletions included,
        kept only for events the store has published in the last 30 days: late corrections and late deletions. 48 hours,
        so one missed day is still covered.
     5. One eup_environment_ingest call with everything read, one health row: identity (aliases, merges, the canonical id
        first seen: D5), what is a revision (D6), what qualifies (D7) and tombstones (D12) are the store's, decided there.
   The run id is the cron tick's time ('usgs-20261119T0450Z', '-sweep' on the sweep tick): a tick delivered twice records
   once (the store answers the stored receipt, or EUE05 when the second read differs).

   WHAT LEAVES HERE. The report (counts and codes, the run id, no event content) is logged by the hook. No store message, no
   provider message and no credential is ever passed on. Nothing here imports the private intel collector, the news pairing
   or the Halo layers. */
import { upstream, healthReason } from '../../world-layers.js';
import { USGS_FEED_WINDOW_MS, normalizeUsgsEvent, parseUsgsCollection, readUsgsLookup, usgsFeedFor, usgsFeedUrl, usgsLookupUrl, usgsSweepUrl } from './usgs.js';

export const USGS_INGEST_FLAG = 'EUP_ENVIRONMENT_USGS_INGEST_ENABLED';
export const USGS_INGEST = Object.freeze({
  provider: 'usgs',
  watchHours: 26,            // a regular run looks for published events observed in the last 26 h (the feed's day and a margin)
  sweepWatchDays: 30,        // the sweep keeps what USGS changed for events published in the last 30 days
  sweepUpdatedHours: 48,     // the sweep reads what USGS updated in the last 48 h
  sweepUtc: Object.freeze({ hour: 3, minute: 10 }),
  edgeMarginMs: 30 * 60 * 1000, // an event this close to the start of the feed's day is ageing out, never "missing"
  maxLookups: 5,
  maxEvents: 1800,           // the store takes at most 2,000 events in one call
  watchLimit: 500,
  feedTimeoutMs: 15000, lookupTimeoutMs: 10000, sweepTimeoutMs: 20000, storeTimeoutMs: 15000
});
const STORE_CODES = Object.freeze({
  PGRST202: 'store_not_applied', '42883': 'store_not_applied', EUE01: 'provider_not_configured', EUE05: 'run_already_recorded',
  EUE07: 'provider_not_supported', '55P03': 'store_busy', '57014': 'store_busy', '22023': 'refused_invalid'
});

export function usgsIngestEnabled(env) {
  return String(env?.[USGS_INGEST_FLAG] ?? '').trim().toLowerCase() === 'true';
}
/* the one five-minute tick a day that sweeps */
export function sweepDue(time) {
  const d = new Date(time);
  return d.getUTCHours() === USGS_INGEST.sweepUtc.hour && d.getUTCMinutes() >= USGS_INGEST.sweepUtc.minute && d.getUTCMinutes() < USGS_INGEST.sweepUtc.minute + 5;
}
export function usgsRunId(time, sweep = false) {
  const t = new Date(time).toISOString();
  return `usgs-${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}T${t.slice(11, 13)}${t.slice(14, 16)}Z${sweep ? '-sweep' : ''}`;
}

/* One service-role RPC. Never throws: { ok, value } or { ok: false, code } with the store's SQLSTATE or PostgREST code
   (or network, timeout, redirect, unreadable); a store message is never read into the answer. */
async function storeCall(env, fetchImpl, name, args, timeoutMs = USGS_INGEST.storeTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(args)
      });
    } catch {
      return { ok: false, code: controller.signal.aborted ? 'timeout' : 'network' };
    }
    if (response.status >= 300 && response.status < 400) return { ok: false, code: 'redirect' };
    let value;
    try { value = await response.json(); } catch { value = undefined; }
    if (!response.ok) return { ok: false, code: typeof value?.code === 'string' && /^[A-Z0-9]{5,8}$/.test(value.code) ? value.code : `http_${response.status}` };
    if (value === undefined || value === null) return { ok: false, code: 'unreadable' };
    return { ok: true, value };
  } finally {
    clearTimeout(timer);
  }
}
const storeReason = (code) => STORE_CODES[code] || 'store_unavailable';

/* The ingest's read, checked: a shape the store did not send is never read as "nothing to watch". */
function readState(value) {
  if (!value || typeof value !== 'object' || typeof value.configured !== 'boolean' || !Array.isArray(value.watch)) return null;
  const watch = [];
  for (const w of value.watch) {
    if (!w || typeof w.provider_event_id !== 'string' || !Number.isFinite(Date.parse(w.observed_at))) return null;
    const aliases = Array.isArray(w.aliases) ? w.aliases.filter((a) => typeof a === 'string') : [];
    watch.push({ id: String(w.id), provider_event_id: w.provider_event_id, observed_ms: Date.parse(w.observed_at),
      magnitude: typeof w.magnitude === 'number' ? w.magnitude : null, aliases: aliases.length ? aliases : [w.provider_event_id] });
  }
  return { configured: value.configured, ingest: value.ingest, rule: value.rule, watch };
}

/* One event by id: { kind: 'event' | 'deleted' | 'not_found' | 'failed', event? } */
async function lookup(id, fetchImpl) {
  try {
    return readUsgsLookup(await upstream(usgsLookupUrl(id), {}, fetchImpl, 'json', USGS_INGEST.lookupTimeoutMs), 200);
  } catch (error) {
    /* without jsonerror USGS answers a deleted event 409 and an unknown id 404, as plain text */
    if (error && error.code === 'upstream_http' && (error.providerStatus === 409 || error.providerStatus === 404)) return readUsgsLookup(null, error.providerStatus);
    return { kind: 'failed', reason: healthReason(error && error.code) || 'upstream_error' };
  }
}

/* Every answer for the same event once (events share an id when USGS lists them as one): the newest by USGS's own update
   time wins, a later answer (a look-up or the sweep) on a tie; then back in arrival order. Past the store's limit the
   smallest magnitudes leave first (deletions always stay), counted as dropped. */
export function mergeInputs(groups, max = USGS_INGEST.maxEvents) {
  const all = groups.flat().map((e, i) => ({ e, i, t: Date.parse(e.source_updated_at ?? '') || 0 }));
  const claimed = new Set();
  let kept = [];
  for (const x of [...all].sort((a, b) => b.t - a.t || b.i - a.i)) {
    const ids = Array.isArray(x.e.aliases) && x.e.aliases.length ? x.e.aliases : [x.e.provider_id];
    if (ids.some((a) => claimed.has(a))) continue;
    ids.forEach((a) => claimed.add(a));
    kept.push(x);
  }
  let capped = 0;
  if (kept.length > max) {
    const deletions = kept.filter((x) => x.e.status === 'deleted');
    const rest = kept.filter((x) => x.e.status !== 'deleted').sort((a, b) => (b.e.magnitude ?? -9) - (a.e.magnitude ?? -9));
    const room = Math.max(0, max - deletions.length);
    capped = kept.length - deletions.length - Math.min(room, rest.length);
    kept = [...deletions, ...rest.slice(0, room)];
  }
  return { events: kept.sort((a, b) => a.i - b.i).map((x) => x.e), capped };
}

/* One run. `now` is the run's clock (the windows); `clock` stamps the feed's fetch time, which the store checks against
   its own clock; `scheduledTime` is the cron tick (the run id and the sweep). */
export async function runUsgsIngest(env, { fetchImpl = fetch, now = Date.now(), scheduledTime = null, clock = Date.now } = {}) {
  const report = { provider: USGS_INGEST.provider, run_id: null, feed: null, sweep: false, status: null, counts: null, dropped: 0,
    lookups: { asked: 0, deleted: 0, found: 0, not_found: 0, failed: 0 }, sweep_rows: null, skipped: null, error: null };
  if (!usgsIngestEnabled(env)) return { ...report, skipped: 'disabled' };
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return { ...report, skipped: 'store_not_configured' };
  const tick = Number.isFinite(scheduledTime) ? scheduledTime : now;
  report.sweep = sweepDue(tick);
  report.run_id = usgsRunId(tick, report.sweep);
  const since = new Date(now - (report.sweep ? USGS_INGEST.sweepWatchDays * 86400e3 : USGS_INGEST.watchHours * 3600e3)).toISOString();

  /* 1. the store's view first: nothing is asked of USGS for a store that cannot take it */
  const stateCall = await storeCall(env, fetchImpl, 'eup_environment_ingest_state', { p_provider: USGS_INGEST.provider, p_since: since, p_limit: USGS_INGEST.watchLimit });
  if (!stateCall.ok) return { ...report, skipped: storeReason(stateCall.code), error: storeReason(stateCall.code) === 'store_not_applied' ? null : stateCall.code };
  const state = readState(stateCall.value);
  if (!state) return { ...report, skipped: 'store_unavailable', error: 'unreadable_state' };
  if (!state.configured) return { ...report, skipped: 'provider_not_configured' };

  const ingest = async (events, health, fetchedAt) => {
    const call = await storeCall(env, fetchImpl, 'eup_environment_ingest', { p_provider: USGS_INGEST.provider, p_run_id: report.run_id,
      p_fetched_at: fetchedAt, p_health: health, p_events: events });
    if (!call.ok) return { ...report, error: storeReason(call.code), store_code: call.code };
    const receipt = call.value;
    return { ...report, status: typeof receipt.status === 'string' ? receipt.status : null, counts: receipt.counts && typeof receipt.counts === 'object' ? receipt.counts : null };
  };
  if (state.ingest === 'paused') return ingest([], { status: 'ok' }, new Date(clock()).toISOString());

  /* 2. the summary feed */
  const feed = usgsFeedFor(state.rule);
  report.feed = feed.name;
  let read;
  try {
    read = parseUsgsCollection(await upstream(usgsFeedUrl(feed.name), {}, fetchImpl, 'json', USGS_INGEST.feedTimeoutMs));
  } catch (error) {
    const http = error && Number.isInteger(error.providerStatus) && error.providerStatus >= 100 && error.providerStatus <= 599 ? { http_status: error.providerStatus } : {};
    return ingest([], { status: 'unavailable', reason: healthReason(error && error.code) || 'upstream_error', ...http }, new Date(clock()).toISOString());
  }
  const fetchedAt = new Date(clock()).toISOString();

  /* 3. published events the feed no longer lists although they are still inside its day */
  const listed = new Set(read.events.flatMap((e) => e.aliases));
  const dayStart = (Date.parse(read.generatedAt ?? fetchedAt) || now) - USGS_FEED_WINDOW_MS + USGS_INGEST.edgeMarginMs;
  const missing = state.watch.filter((w) => !w.aliases.some((a) => listed.has(a)) && w.observed_ms >= dayStart
    && (feed.floor === null || w.magnitude === null || w.magnitude >= feed.floor)).sort((a, b) => b.observed_ms - a.observed_ms);
  const looked = [];
  for (const w of missing.slice(0, USGS_INGEST.maxLookups)) {
    report.lookups.asked += 1;
    const answer = await lookup(w.provider_event_id, fetchImpl);
    if (answer.kind === 'deleted') {
      report.lookups.deleted += 1;
      looked.push({ provider_id: w.provider_event_id, aliases: [w.provider_event_id], status: 'deleted',
        source_updated_at: answer.event ? answer.event.source_updated_at : null });
    } else if (answer.kind === 'event') {
      report.lookups.found += 1;
      looked.push(answer.event);
    } else if (answer.kind === 'not_found') report.lookups.not_found += 1;
    else report.lookups.failed += 1;
  }

  /* 4. once a day: late corrections and deletions of published events */
  const swept = [];
  if (report.sweep) {
    const watched = new Set(state.watch.flatMap((w) => w.aliases));
    try {
      const sweep = parseUsgsCollection(await upstream(usgsSweepUrl({ updatedAfter: now - USGS_INGEST.sweepUpdatedHours * 3600e3, startTime: since,
        minMagnitude: feed.floor, limit: 2000 }), {}, fetchImpl, 'json', USGS_INGEST.sweepTimeoutMs));
      for (const e of sweep.events) if (e.aliases.some((a) => watched.has(a))) swept.push(e);
      report.sweep_rows = swept.length;
    } catch {
      report.sweep_rows = null;
      report.error = 'sweep_unavailable';
    }
  }

  /* 5. one call, one health row */
  const { events, capped } = mergeInputs([read.events, looked, swept]);
  report.dropped = read.dropped + capped;
  const health = { status: 'ok', http_status: 200, dropped: report.dropped, ...(read.generatedAt ? { upstream_generated_at: read.generatedAt } : {}) };
  return ingest(events, health, fetchedAt);
}

/* exported for the tests: the normaliser the ingest uses */
export { normalizeUsgsEvent };
