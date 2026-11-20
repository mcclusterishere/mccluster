/* E=UP environmental event timeline, slice S3: the USGS ingest into the pending event store (src/eup/environment/usgs.js and
   ingest.js), the cron hook behind its flag (src/entry.js) and the ShakeMap route's answer for a deleted event
   (src/world-environment-layers.js). Offline: every USGS answer here is a recorded one (test/fixtures/environment/usgs-ingest/,
   each with its request and retrieval time; test/support/usgs-ingest-fixtures.mjs), the store is a double that answers the
   two entry points the ingest calls, and the suite's guard refuses any other network call. Anything built for a test is
   labelled BUILT. The same ingest over the real pending SQL in PGlite: scripts/test/eup-environment-ingest.integration.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { normalizeUsgsEvent, parseUsgsCollection, readUsgsLookup, splitIds, usgsFeedFor, usgsFeedUrl, usgsLookupUrl } from '../src/eup/environment/usgs.js';
import { USGS_INGEST, USGS_INGEST_FLAG, mergeInputs, runUsgsIngest, sweepDue, usgsIngestEnabled, usgsRunId } from '../src/eup/environment/ingest.js';
import { shakemapDetailUrl } from '../src/world-environment-layers.js';
import { workersFetch } from './support/workers-fetch-semantics.mjs';
import { USGS_FIXTURES as F, beforeDeletion, feedOf, historyTimes, historyView, recorded, usgsAnswer } from './support/usgs-ingest-fixtures.mjs';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.html$/.test(url)) return { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true };
    return next(url, context);
  }
});

const STORE = 'https://store.invalid';
const ENV = Object.freeze({ SUPABASE_URL: STORE, SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests', [USGS_INGEST_FLAG]: 'true' });
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const FEED = recorded(F.feed).body;
const GENERATED = FEED.metadata.generated; // the recorded feed's generation time, 2026-11-19T04:50:10Z
const TICK = Date.UTC(2026, 10, 19, 4, 50);
const HISTORY = recorded(F.history).body;
const RULE = Object.freeze({ min_magnitude: 4.5, include_automatic: true, significance_above: 600, pager_alert: true, tsunami: true });
const stateOf = (over = {}) => ({ schema: 'mccluster.environment-ingest-state/v1', provider: 'usgs', configured: true, ingest: 'active', rule: RULE, rule_revision: 1, watch: [], ...over });
/* BUILT: one entry of the store's watch list (what eup_environment_ingest_state answers for an event ever published) */
const watched = (id, observedMs, extra = {}) => ({ id: `usgs:${id}`, provider_event_id: id, observed_at: new Date(observedMs).toISOString(), magnitude: 4.8, aliases: [id], ...extra });
const receiptOf = (body) => ({ schema: 'mccluster.environment-ingest/v1', provider: 'usgs', run_id: body.p_run_id, status: body.p_events.length ? 'ok' : 'empty',
  counts: { received: body.p_events.length }, refusals: [], fetched_at: body.p_fetched_at, recorded_at: new Date().toISOString() });

/* The store double and USGS by URL; every call is logged by workersFetch, which also applies the Workers fetch rules. */
function plane({ state = stateOf(), stateAnswer = null, ingestAnswer = null, usgs = () => usgsAnswer(F.feed) } = {}) {
  const ingests = [];
  const states = [];
  const fetchImpl = workersFetch(async (url, init) => {
    if (url.origin === STORE) {
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY, 'the service-role key, as every store entry point needs');
      const body = JSON.parse(init.body);
      if (url.pathname === '/rest/v1/rpc/eup_environment_ingest_state') { states.push(body); return stateAnswer ? stateAnswer(body) : json(state); }
      if (url.pathname === '/rest/v1/rpc/eup_environment_ingest') { ingests.push(body); return ingestAnswer ? ingestAnswer(body) : json(receiptOf(body)); }
      throw new Error(`the ingest called another store function: ${url.pathname}`);
    }
    if (url.hostname === 'earthquake.usgs.gov') return usgs(url);
    throw new Error(`the ingest asked another host: ${url.href}`);
  });
  const usgsCalls = () => fetchImpl.calls.map((c) => new URL(c.url)).filter((u) => u.hostname === 'earthquake.usgs.gov').map((u) => u.href);
  return { fetchImpl, ingests, states, usgsCalls, calls: fetchImpl.calls };
}
const run = (p, opts = {}) => runUsgsIngest(opts.env ?? ENV, { fetchImpl: p.fetchImpl, now: opts.now ?? GENERATED, scheduledTime: opts.scheduledTime ?? TICK });

/* ---------------------------------------------------------------- the normaliser, on recorded answers */

test('the recorded M2.5+ day reads row by row into the store\'s input shape', () => {
  assert.equal(usgsFeedUrl('2.5_day'), recorded(F.feed).recorded.request.slice(4), 'the URL the ingest reads is the one recorded');
  const read = parseUsgsCollection(FEED);
  assert.equal(read.total, 15); assert.equal(read.dropped, 0); assert.equal(read.events.length, 15);
  assert.equal(read.generatedAt, '2026-11-19T04:50:10.000Z');
  const by = Object.fromEntries(read.events.map((e) => [e.provider_id, e]));
  assert.deepEqual(by.us6000ubw3.aliases, ['us6000ubw3', 'aka2026wwodfo'], 'every id USGS associates, the preferred one first');
  assert.deepEqual(by.aka2026wvqdhv.aliases, ['aka2026wvqdhv', 'av94504698', 'us7000tyyu']);
  assert.equal(by.us7000tz37.alert, 'green'); assert.equal(by.us7000tz37.magnitude, 6.1); assert.equal(by.us7000tz37.magnitude_type, 'mww');
  assert.equal(by.aka2026wxbuhs.status, 'automatic'); assert.equal(by.us6000ubxb.status, 'reviewed');
  assert.equal(by.ci41363495.observed_at, '2026-11-18T23:39:21.280Z'); assert.equal(by.ci41363495.source_updated_at, '2026-11-19T04:40:55.465Z');
  for (const e of read.events) {
    assert.deepEqual(Object.keys(e).sort(), ['alert', 'aliases', 'code', 'depth_km', 'lat', 'lon', 'magnitude', 'magnitude_type', 'net', 'observed_at', 'place',
      'provider_id', 'significance', 'source_updated_at', 'source_url', 'status', 'title', 'tsunami'], `${e.provider_id}: exactly the store's fields`);
    assert.match(e.source_url, /^https:\/\/earthquake\.usgs\.gov\/earthquakes\/eventpage\/[a-z0-9]+$/);
    assert.equal(typeof e.tsunami, 'boolean');
    assert.equal(e.net + e.code, e.provider_id, `${e.provider_id}: the preferred id is net + code`);
  }
});

test('what the store would refuse is dropped and counted, never guessed', () => {
  const row = FEED.features[0];
  /* BUILT: the recorded row with one thing broken at a time */
  const broken = [
    { ...row, id: '', properties: { ...row.properties, net: null, code: null } },
    { ...row, properties: { ...row.properties, status: 'preliminary' } },
    { ...row, properties: { ...row.properties, time: null } },
    { ...row, geometry: { type: 'Point', coordinates: [190, 10, 5] } },
    null
  ];
  assert.deepEqual(broken.map((f) => normalizeUsgsEvent(f).reason), ['id', 'status', 'observed_at', 'coordinates', 'not_a_feature']);
  const read = parseUsgsCollection({ type: 'FeatureCollection', metadata: { generated: GENERATED }, features: [row, ...broken] });
  assert.equal(read.events.length, 1); assert.equal(read.dropped, 5);
  assert.throws(() => parseUsgsCollection({ type: 'Feature' }), /not a FeatureCollection/, 'a shape USGS did not send is never "no events"');
  assert.deepEqual(splitIds(',us6000u3jl,BAD ID,attn6uqd,,'), ['us6000u3jl', 'attn6uqd']);
  const out = normalizeUsgsEvent({ ...row, properties: { ...row.properties, depth: undefined, magType: 'MB_LG', alert: 'purple', url: 'https://example.org/x', place: 'a\u0007b' } });
  assert.equal(out.event.magnitude_type, 'mb_lg'); assert.equal(out.event.alert, null);
  assert.equal(out.event.source_url, `https://earthquake.usgs.gov/earthquakes/eventpage/${row.id}`, 'a link off USGS is replaced by the USGS event page');
  assert.equal(out.event.place, 'a b', 'control characters never reach the store');
});

test('an alias lookup returns the preferred event: attn6uqd answers us6000u3jl with every associated id', () => {
  assert.equal(usgsLookupUrl('attn6uqd'), recorded(F.alias).recorded.request.slice(4), 'the look-up URL is the one recorded');
  const r = readUsgsLookup(recorded(F.alias).body, 200);
  assert.equal(r.kind, 'event');
  assert.equal(r.event.provider_id, 'us6000u3jl');
  assert.deepEqual(r.event.aliases, ['us6000u3jl', 'attn6uqd', 'usauto6000u3jl', 'attn6uqj', 'pt26293000']);
  assert.equal(r.event.magnitude, 6.3); assert.equal(r.event.status, 'reviewed'); assert.equal(r.event.tsunami, true);
});

test('a deleted event is a deletion however USGS says it; an unknown id changes nothing', () => {
  assert.deepEqual(readUsgsLookup(recorded(F.deletedJson).body, 200), { kind: 'deleted' }, 'jsonerror=true: 200 with metadata.status 409');
  assert.equal(recorded(F.deletedPlain).recorded.http_status, 409);
  assert.deepEqual(readUsgsLookup(null, 409), { kind: 'deleted' }, 'plain: HTTP 409');
  const rec = readUsgsLookup(recorded(F.deletedRecord).body, 200);
  assert.equal(rec.kind, 'deleted'); assert.deepEqual(rec.event, { provider_id: 'aka2026wpvhsf', aliases: ['aka2026wpvhsf'], status: 'deleted', source_updated_at: '2026-11-15T09:19:00.089Z' });
  assert.deepEqual(readUsgsLookup(recorded(F.unknownJson).body, 200), { kind: 'not_found' }, 'jsonerror=true: 200 with metadata.status 404');
  assert.deepEqual(readUsgsLookup(null, 404), { kind: 'not_found' });
  assert.equal(readUsgsLookup({ type: 'Feature', metadata: { status: 500 } }, 200).kind, 'invalid');
});

test('an includesuperseded history is read correctly: the event\'s own values, never a superseded origin\'s', () => {
  const now = normalizeUsgsEvent(HISTORY);
  assert.equal(now.ok, true);
  assert.equal(now.event.provider_id, 'us6000u3jl'); assert.equal(now.event.magnitude, 6.3); assert.equal(now.event.magnitude_type, 'mww');
  assert.equal(now.event.status, 'reviewed'); assert.equal(now.event.observed_at, '2026-10-20T04:20:38.782Z');
  assert.deepEqual([...now.event.aliases].sort(), ['attn6uqd', 'attn6uqj', 'pt26293000', 'us6000u3jl', 'usauto6000u3jl']);
  const origins = HISTORY.properties.products.origin;
  assert.equal(origins.length, 5, 'the recorded history keeps every origin version');
  assert.ok(origins.some((o) => o.properties.magnitude === '6.6'), 'and the superseded M6.6 versions are in it, unread by the normaliser');
  /* BUILT from the recorded history: the preferred id moment by moment */
  const preferred = [];
  for (const t of historyTimes(HISTORY)) {
    const id = normalizeUsgsEvent(historyView(HISTORY, t)).event.provider_id;
    if (preferred[preferred.length - 1] !== id) preferred.push(id);
  }
  assert.deepEqual(preferred, ['attn6uqd', 'pt26293000', 'us6000u3jl'], 'NTWC first, then PTWC, then NEIC (weight 158) for good');
  const first = normalizeUsgsEvent(historyView(HISTORY, historyTimes(HISTORY)[0])).event;
  assert.deepEqual([first.magnitude, first.magnitude_type, first.status, first.aliases], [6.6, 'mwp', 'automatic', ['attn6uqd']]);
});

test('a DYFI-only update moves USGS updated and nothing the store counts as a revision', () => {
  const ORIGIN_V4 = Date.UTC(2026, 9, 20, 4, 58, 8, 40), DYFI_V1 = Date.UTC(2026, 9, 20, 5, 9, 13, 719);
  const dyfi = HISTORY.properties.products.dyfi.map((p) => p.updateTime);
  assert.ok(dyfi.includes(DYFI_V1), 'the recorded DYFI version');
  assert.ok(!HISTORY.properties.products.origin.some((o) => o.updateTime > ORIGIN_V4 && o.updateTime <= DYFI_V1), 'no origin version between the two moments');
  const before = normalizeUsgsEvent(historyView(HISTORY, DYFI_V1 - 1)).event;
  const after = normalizeUsgsEvent(historyView(HISTORY, DYFI_V1)).event;
  assert.equal(before.source_updated_at, '2026-10-20T04:58:08.040Z'); assert.equal(after.source_updated_at, '2026-10-20T05:09:13.719Z');
  assert.deepEqual({ ...after, source_updated_at: null }, { ...before, source_updated_at: null }, 'only USGS updated moved (the store proves it makes no revision)');
});

test('the feed follows the owner\'s rule: the M2.5+ day unless the rule asks lower', () => {
  assert.deepEqual(usgsFeedFor(RULE), { name: '2.5_day', floor: 2.5 });
  assert.deepEqual(usgsFeedFor({ ...RULE, min_magnitude: 2.5 }), { name: '2.5_day', floor: 2.5 });
  assert.deepEqual(usgsFeedFor({ ...RULE, min_magnitude: 1.5 }), { name: '1.0_day', floor: 1 });
  assert.deepEqual(usgsFeedFor({ ...RULE, min_magnitude: 0.5 }), { name: 'all_day', floor: null });
  assert.deepEqual(usgsFeedFor(null), { name: '2.5_day', floor: 2.5 });
});

/* ---------------------------------------------------------------- the flag */

test('flag off: no network call and no store call', async () => {
  for (const value of [undefined, '', 'false', '0', 'yes', 'on']) {
    const p = plane();
    const env = { ...ENV, [USGS_INGEST_FLAG]: value };
    assert.equal(usgsIngestEnabled(env), false, JSON.stringify(value));
    const r = await run(p, { env });
    assert.equal(r.skipped, 'disabled');
    assert.equal(p.calls.length, 0, `${JSON.stringify(value)}: nothing was fetched`);
  }
  assert.equal(usgsIngestEnabled({ [USGS_INGEST_FLAG]: ' TRUE ' }), true, 'the same reading as the private collector\'s flag');
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^EUP_ENVIRONMENT_USGS_INGEST_ENABLED = "false"$/m, 'the committed configuration keeps it off');
  const p = plane();
  assert.equal((await run(p, { env: { [USGS_INGEST_FLAG]: 'true' } })).skipped, 'store_not_configured');
  assert.equal(p.calls.length, 0, 'flag on without the store\'s credentials: still nothing');
});

test('the cron hook runs the ingest only with the flag, and the hook is wired', async () => {
  const { default: entry } = await import('../src/entry.js');
  const saved = globalThis.fetch;
  const seen = [];
  /* every other scheduled job of the cron gets a refusal; the test only reads where the ingest went */
  globalThis.fetch = async (input) => { seen.push(String(input instanceof Request ? input.url : input)); return json({ message: 'refused in the test' }, 503); };
  const tick = async (env) => {
    seen.length = 0;
    const pending = [];
    await entry.scheduled({ scheduledTime: TICK }, env, { waitUntil(promise) { pending.push(promise); } });
    await Promise.allSettled(pending);
    return { usgs: seen.filter((u) => new URL(u).hostname === 'earthquake.usgs.gov'), store: seen.filter((u) => u.includes('/rest/v1/rpc/eup_environment_')) };
  };
  const quiet = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = () => {};
  try {
    const base = { SUPABASE_URL: STORE, SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests' };
    for (const env of [base, { ...base, [USGS_INGEST_FLAG]: 'false' }]) {
      const r = await tick(env);
      assert.deepEqual(r, { usgs: [], store: [] }, 'flag absent or "false": no USGS request and no store call');
    }
    const on = await tick({ ...base, [USGS_INGEST_FLAG]: 'true' });
    assert.deepEqual(on.store, [`${STORE}/rest/v1/rpc/eup_environment_ingest_state`], 'flag "true": the run starts with the store\'s view');
    assert.deepEqual(on.usgs, [], 'and an unreadable store stops it before USGS is asked');
  } finally {
    globalThis.fetch = saved;
    Object.assign(console, quiet);
  }
});

/* ---------------------------------------------------------------- one run */

test('the store first: not applied, no rule yet or unreadable, and USGS is never asked', async () => {
  const notApplied = plane({ stateAnswer: () => json({ code: 'PGRST202', message: 'Could not find the function' }, 404) });
  assert.equal((await run(notApplied)).skipped, 'store_not_applied');
  const noRule = plane({ state: stateOf({ configured: false, ingest: null, rule: null, rule_revision: null }) });
  assert.equal((await run(noRule)).skipped, 'provider_not_configured');
  const down = plane({ stateAnswer: () => { throw new TypeError('fetch failed'); } });
  const r = await run(down);
  assert.deepEqual([r.skipped, r.error], ['store_unavailable', 'network']);
  const odd = plane({ stateAnswer: () => json({ configured: 'yes' }) });
  assert.deepEqual([(await run(odd)).skipped], ['store_unavailable']);
  for (const p of [notApplied, noRule, down, odd]) {
    assert.deepEqual(p.usgsCalls(), []); assert.equal(p.ingests.length, 0);
    assert.equal(p.states.length, 1); assert.equal(p.states[0].p_provider, 'usgs');
  }
  assert.equal(noRule.states[0].p_since, new Date(GENERATED - 26 * 3600e3).toISOString(), 'a regular run watches the last 26 hours');
  assert.equal(noRule.states[0].p_limit, USGS_INGEST.watchLimit);
});

test('paused: the run records its health row and asks USGS nothing', async () => {
  const p = plane({ state: stateOf({ ingest: 'paused' }) });
  const r = await run(p);
  assert.deepEqual(p.usgsCalls(), []);
  assert.equal(p.ingests.length, 1);
  assert.deepEqual([p.ingests[0].p_events, p.ingests[0].p_health], [[], { status: 'ok' }], 'the store marks the run paused itself');
  assert.equal(r.error, null);
});

test('one run: the feed, bounded look-ups of published events it no longer lists, one ingest call', async () => {
  const h = (n) => GENERATED - n * 3600e3;
  /* BUILT: the store's watch list; the look-up answers are the recorded ones */
  const watch = [
    watched('aka2026wpvhsf', h(2)), watched('attn6uqd', h(3)), watched('us0000zzzz99', h(4)), watched('uw0000net01', h(5)),
    watched('ak0000plain', h(6)), watched('nc0000sixth', h(7)), watched('us0000seventh', h(8)),
    watched('us0000edge', GENERATED - 24 * 3600e3 + 10 * 60e3), watched('us0000small', h(1), { magnitude: 2.0 }),
    watched('ak9999listed', h(1), { aliases: ['ak9999listed', 'aka2026wwodfo'] })
  ];
  const p = plane({
    state: stateOf({ watch }),
    usgs: (url) => {
      if (url.pathname.endsWith('/summary/2.5_day.geojson')) return usgsAnswer(F.feed);
      const id = url.searchParams.get('eventid');
      assert.equal(url.searchParams.get('jsonerror'), 'true');
      if (id === 'aka2026wpvhsf') return usgsAnswer(F.deletedJson);
      if (id === 'attn6uqd') return usgsAnswer(F.alias);
      if (id === 'us0000zzzz99') return usgsAnswer(F.unknownJson);
      if (id === 'uw0000net01') throw new TypeError('fetch failed');
      if (id === 'ak0000plain') return usgsAnswer(F.deletedPlain);
      throw new Error(`not looked up: ${id}`);
    }
  });
  const r = await run(p);
  assert.deepEqual(p.usgsCalls(), [usgsFeedUrl('2.5_day'), ...['aka2026wpvhsf', 'attn6uqd', 'us0000zzzz99', 'uw0000net01', 'ak0000plain'].map(usgsLookupUrl)],
    'the feed, then at most five look-ups, newest first; nothing ageing out of the day, below the feed, or listed under an alias');
  assert.deepEqual(r.lookups, { asked: 5, deleted: 2, found: 1, not_found: 1, failed: 1 });
  assert.equal(p.ingests.length, 1, 'one store write per run');
  const body = p.ingests[0];
  assert.equal(body.p_provider, 'usgs'); assert.equal(body.p_run_id, 'usgs-20261119T0450Z'); assert.match(body.p_fetched_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(body.p_health, { status: 'ok', http_status: 200, dropped: 0, upstream_generated_at: '2026-11-19T04:50:10.000Z' });
  assert.equal(body.p_events.length, 15 + 3);
  assert.deepEqual(body.p_events.slice(15).map((e) => [e.provider_id, e.status]), [['aka2026wpvhsf', 'deleted'], ['us6000u3jl', 'reviewed'], ['ak0000plain', 'deleted']]);
  assert.deepEqual(body.p_events[15], { provider_id: 'aka2026wpvhsf', aliases: ['aka2026wpvhsf'], status: 'deleted', source_updated_at: null });
  assert.deepEqual(r.counts, { received: 18 }); assert.equal(r.status, 'ok'); assert.equal(r.error, null);
});

test('the daily sweep: once, on the 03:10 UTC tick, kept only for published events', async () => {
  const SWEEP_TICK = Date.UTC(2026, 10, 17, 3, 10);
  const deletedAt = Date.UTC(2026, 10, 15, 6, 10, 11, 557);
  /* BUILT: a published M3.8 under an owner's rule of M3.5, and a feed of that tick with nothing in it */
  const state = stateOf({ rule: { ...RULE, min_magnitude: 3.5 }, watch: [watched('aka2026wpvhsf', deletedAt, { magnitude: 3.8 })] });
  const route = (url) => (url.pathname.endsWith('/summary/2.5_day.geojson') ? json(feedOf([], SWEEP_TICK)) : usgsAnswer(F.sweep));
  assert.equal(sweepDue(SWEEP_TICK), true); assert.equal(sweepDue(SWEEP_TICK + 5 * 60e3), false); assert.equal(sweepDue(SWEEP_TICK - 5 * 60e3), false);
  const p = plane({ state, usgs: route });
  const r = await run(p, { now: SWEEP_TICK, scheduledTime: SWEEP_TICK });
  assert.equal(p.states[0].p_since, new Date(SWEEP_TICK - 30 * 86400e3).toISOString(), 'the sweep watches the last 30 days');
  const calls = p.usgsCalls().map((u) => new URL(u));
  assert.equal(calls.length, 2, 'the feed and one sweep; the event is outside the feed\'s day, so no look-up');
  const q = Object.fromEntries(calls[1].searchParams);
  assert.deepEqual(q, { format: 'geojson', updatedafter: '2026-11-15T03:10:00', starttime: '2026-10-18T03:10:00', includedeleted: 'true', minmagnitude: '2.5', orderby: 'time', limit: '2000' });
  assert.equal(r.run_id, 'usgs-20261117T0310Z-sweep'); assert.equal(r.sweep, true); assert.equal(r.sweep_rows, 1);
  assert.deepEqual(p.ingests[0].p_events, [{ provider_id: 'aka2026wpvhsf', aliases: ['aka2026wpvhsf'], status: 'deleted', source_updated_at: '2026-11-15T09:19:00.089Z' }],
    'the recorded sweep\'s deleted row for the published event; its other row (aka2026wputwc, never published) is not the sweep\'s business');
  const later = plane({ state, usgs: route });
  await run(later, { now: SWEEP_TICK + 5 * 60e3, scheduledTime: SWEEP_TICK + 5 * 60e3 });
  assert.equal(later.usgsCalls().length, 1, 'the next tick does not sweep');
});

test('a feed that fails is the run\'s health and nothing else', async () => {
  const cases = [
    [() => json({ message: 'down' }, 503), { status: 'unavailable', reason: 'upstream_error', http_status: 503 }],
    [() => { throw new TypeError('fetch failed'); }, { status: 'unavailable', reason: 'upstream_error' }],
    [() => new Response('not json', { status: 200 }), { status: 'unavailable', reason: 'invalid_data', http_status: 200 }],
    [() => json({ type: 'Feature' }), { status: 'unavailable', reason: 'invalid_data' }]
  ];
  for (const [usgs, health] of cases) {
    const p = plane({ state: stateOf({ watch: [watched('aka2026wpvhsf', GENERATED - 3600e3)] }), usgs });
    await run(p);
    assert.equal(p.ingests.length, 1);
    assert.deepEqual([p.ingests[0].p_events, p.ingests[0].p_health], [[], health]);
    assert.equal(p.usgsCalls().length, 1, 'no look-up is made from a feed that could not be read');
  }
});

test('the store\'s refusals are named codes: a tick delivered twice, a busy store, the store gone', async () => {
  const answer = (code, status) => () => json({ code, message: 'store text never passed on' }, status);
  for (const [code, status, reason] of [['EUE05', 400, 'run_already_recorded'], ['55P03', 503, 'store_busy'], ['PGRST202', 404, 'store_not_applied'], ['XX000', 500, 'store_unavailable']]) {
    const p = plane({ ingestAnswer: answer(code, status) });
    const r = await run(p);
    assert.deepEqual([r.error, r.store_code], [reason, code]);
    assert.ok(!JSON.stringify(r).includes('store text'), 'no store message reaches the report');
  }
});

test('one answer per event: the newest by USGS update wins, deletions stay past the cap', () => {
  const a = { provider_id: 'us1', aliases: ['us1', 'ak1'], status: 'reviewed', source_updated_at: '2026-11-19T01:00:00.000Z', magnitude: 5 };
  const b = { provider_id: 'ak1', aliases: ['ak1'], status: 'automatic', source_updated_at: '2026-11-19T00:00:00.000Z', magnitude: 5.2 };
  const d = { provider_id: 'us9', aliases: ['us9'], status: 'deleted', source_updated_at: null };
  assert.deepEqual(mergeInputs([[b], [a]]).events, [a], 'an event USGS lists under two ids is sent once, as its newest answer');
  assert.deepEqual(mergeInputs([[a], [{ ...a }]]).events.length, 1);
  const many = Array.from({ length: 6 }, (_, i) => ({ provider_id: `us${i + 10}`, aliases: [`us${i + 10}`], status: 'reviewed', source_updated_at: null, magnitude: i }));
  const capped = mergeInputs([many, [d]], 4);
  assert.equal(capped.capped, 3);
  assert.deepEqual(capped.events.map((e) => e.provider_id), ['us13', 'us14', 'us15', 'us9'], 'the largest stay, in arrival order, and the deletion is never cut');
  assert.equal(usgsRunId(Date.UTC(2026, 0, 2, 3, 4, 59)), 'usgs-20260102T0304Z');
  assert.match(usgsRunId(TICK, true), /^[A-Za-z0-9._:-]{8,128}$/, 'the store\'s run id pattern');
});

/* ---------------------------------------------------------------- the ShakeMap route */

test('ShakeMap: a deleted event is withdrawn by USGS, not a source outage', async () => {
  const { handleWorldEnvironment } = await import('../src/world-environment.js');
  const policy = { schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: 'environment', state: 'enabled', revision: 3 };
  const f = workersFetch(async (url) => {
    if (url.href.endsWith('/rest/v1/rpc/eup_module_policy_read')) return json(policy);
    if (url.href === shakemapDetailUrl('aka2026wpvhsf')) return usgsAnswer(F.detail); // recorded: HTTP 409, text/plain
    throw new Error(`unexpected ${url.href}`);
  });
  const raw = new Map();
  const cacheImpl = { async match(k) { return raw.has(k.url) ? new Response(raw.get(k.url)) : undefined; }, async put(k, res) { raw.set(k.url, await res.text()); } };
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', ALLOWED_ORIGINS: 'https://mccluster.org' };
  const res = await handleWorldEnvironment(new Request('https://api.mccluster.org/v1/world/environment/quakes/aka2026wpvhsf/shakemap', { headers: { origin: 'https://mccluster.org' } }), env, { fetchImpl: f, cacheImpl });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual([body.available, body.reason, body.contours], [false, 'withdrawn', []]);
  assert.deepEqual(body.sources.map((s) => [s.id, s.status]), [['usgs_event', 'available']], 'USGS answered: the source is not down');
  assert.equal(recorded(F.detail).recorded.http_status, 409);
});
