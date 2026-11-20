// E=UP event timeline slice S4 (2026-11-19): the public USGS timeline from the event store, proven on the timeline plane, the
// REAL Worker handler over the REAL module policy and the five PENDING store parts in PGlite
// (scripts/test/support/eup-environment-timeline-plane.mjs). It is the local stand-in for "staging" (decision D1, default adopted
// pending Matthew's confirmation): no staging Worker or Supabase branch exists, and creating one is his call.
//   the store not applied                  -> 503 events_unavailable (store_not_applied); the feed's USGS says so, USGS never asked
//   the module not installed, or disabled  -> 404 module_disabled on both routes, and the store never read
//   enabled, USGS not set up, never read   -> the timeline is empty; the feed's USGS: not_shown, then no_reading
//   a qualifying quake with no news        -> published, news_coverage [], whitelisted fields only (E3, E8)
//   a correction, an alias, a deletion     -> revision 2 with old -> new; the canonical event with redirected_from; a tombstone
//   an owner hold                          -> 404 not_available, out of the page
//   the edge cache                         -> a page is kept at most a minute; a new reading shows after it
//   the feed                               -> its USGS rows are the store's canonical ids with their revisions; E6's origin time
//   news                                   -> never a provider (the store refuses it); the page holds government events only
//   PGLITE_MODULE=<PGlite 0.3.x dist/index.js> node scripts/test/eup-environment-timeline.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelinePlane, usgsEvent } from './support/eup-environment-timeline-plane.mjs';

const EVENTS = '/v1/world/environment/events', FEED = '/v1/world/environment';
const OFF = { ok: false, code: 'module_disabled' };
const PUBLISHED_KEYS = ['alert', 'correction', 'depth_km', 'first_published_at', 'id', 'kind', 'lat', 'lon', 'magnitude', 'magnitude_type',
  'news_coverage', 'observed_at', 'place', 'provider', 'review_status', 'revised_at', 'revision', 'source', 'state', 'title', 'tsunami'];
const TOMBSTONE_KEYS = ['first_published_at', 'id', 'kind', 'magnitude', 'magnitude_type', 'observed_at', 'place', 'provider', 'retracted_at',
  'revision', 'source', 'state', 'title', 'withdrawn_at'];
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const ids = (body) => body.events.map((e) => e.id);
const QUAKE = usgsEvent({ provider_id: 'us7000s4aa', observed_at: hoursAgo(2), source_updated_at: hoursAgo(1.9), magnitude: 5.2, magnitude_type: 'mww',
  place: '40 km E of Example, Japan', title: 'M 5.2 - 40 km E of Example, Japan', significance: 416, lon: 142.1, lat: 38.3, depth_km: 10 });
const SMALL = usgsEvent({ provider_id: 'nc75s4small', status: 'automatic', observed_at: hoursAgo(1), magnitude: 3.1, magnitude_type: 'md', significance: 160,
  place: '5 km S of Example, CA', title: 'M 3.1 - 5 km S of Example, CA', lon: -122, lat: 37.5 });
const VAN = usgsEvent({ provider_id: 'attn6uqd', status: 'automatic', observed_at: hoursAgo(5), source_updated_at: hoursAgo(4.9), lon: 167.95, lat: -15.12, depth_km: 25,
  magnitude: 6.6, magnitude_type: 'mi', place: 'Vanuatu Islands', title: 'M 6.6 - Vanuatu Islands', significance: 670, net: 'at', code: 'tn6uqd' });

test('the store not applied: the timeline says so, the feed\'s USGS says so, and USGS\'s live feed is never read', async () => {
  const plane = await createTimelinePlane({ apply: false });
  try {
    await plane.enable();
    const page = await plane.get(EVENTS);
    assert.equal(page.status, 503); assert.deepEqual(page.body, { ok: false, code: 'events_unavailable', reason: 'store_not_applied' });
    assert.equal(page.headers.get('cache-control'), 'private, no-store');
    const event = await plane.get(`${EVENTS}/usgs:us7000s4aa`);
    assert.deepEqual([event.status, event.body.reason], [503, 'store_not_applied']);
    const feed = await plane.get(FEED);
    assert.equal(feed.status, 200);
    const usgs = feed.body.sources.find((s) => s.id === 'usgs');
    assert.deepEqual([usgs.status, usgs.reason], ['unavailable', 'store_not_applied']);
    assert.ok(!feed.providerCalls.includes('earthquake.usgs.gov'), 'no live read with a second id');
    assert.ok(feed.body.events.some((e) => e.id === 'eonet:EONET_TIMELINE_1'), 'the other sources stand');
  } finally { await plane.close(); }
});

const plane = await createTimelinePlane();
test.after(() => plane.close());

test('off before anything: not installed and installed-but-disabled are the same 404 on both routes, and the store is never read', async () => {
  for (const path of [EVENTS, `${EVENTS}/usgs:us7000s4aa`]) {
    const r = await plane.get(path);
    assert.deepEqual([r.status, r.body, r.storeReads, r.policyReads], [404, OFF, 0, 1], path);
  }
  await plane.install();
  const disabled = await plane.get(EVENTS);
  assert.deepEqual([disabled.status, disabled.body, disabled.storeReads], [404, OFF, 0]);
});

test('enabled with USGS not set up, then set up but never read: an empty timeline, and the feed\'s USGS tells the two apart', async () => {
  await plane.enable();
  const empty = await plane.get(EVENTS, { cache: plane.freshCache() });
  assert.equal(empty.status, 200);
  assert.deepEqual([empty.body.events, empty.body.next_cursor, empty.body.sources], [[], null, []]);
  let usgs = (await plane.get(FEED, { cache: plane.freshCache() })).body.sources.find((s) => s.id === 'usgs');
  assert.deepEqual([usgs.status, usgs.reason], ['unavailable', 'not_shown']);
  await plane.setUsgsRule();
  const shown = await plane.get(EVENTS, { cache: plane.freshCache() });
  assert.deepEqual(shown.body.sources, [{ provider: 'usgs', status: null, checked_at: null, last_success_at: null }]);
  usgs = (await plane.get(FEED, { cache: plane.freshCache() })).body.sources.find((s) => s.id === 'usgs');
  assert.deepEqual([usgs.status, usgs.reason], ['unavailable', 'no_reading']);
});

test('E3: a qualifying quake publishes with no news coverage at all; the M3.1 stays a candidate; only whitelisted fields leave', async () => {
  const fetchedAt = new Date().toISOString();
  await plane.store.ingest([QUAKE, SMALL], { fetchedAt });
  const r = await plane.get(EVENTS, { cache: plane.freshCache() });
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r.body), ['usgs:us7000s4aa'], 'the candidate is never public');
  const e = r.body.events[0];
  assert.deepEqual(Object.keys(e).sort(), PUBLISHED_KEYS);
  assert.deepEqual([e.state, e.revision, e.magnitude, e.review_status, e.correction, e.news_coverage], ['published', 1, 5.2, 'reviewed', null, []]);
  assert.deepEqual(e.source, { id: 'us7000s4aa', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000s4aa', updated_at: QUAKE.source_updated_at, fetched_at: fetchedAt });
  assert.equal(r.body.sources[0].status, 'ok');
  assert.doesNotMatch(JSON.stringify(r.body), /significance|416|held_at|decided|actor|reason/, 'nothing the store keeps for the owner leaves');
  /* the feed: the same canonical id, with its revision, and E6's origin time; USGS itself never asked */
  const feed = await plane.get(FEED, { cache: plane.freshCache() });
  const quakes = feed.body.events.filter((x) => x.source.id === 'usgs');
  assert.deepEqual(quakes.map((x) => [x.id, x.revision]), [['usgs:us7000s4aa', 1]]);
  const usgs = feed.body.sources.find((s) => s.id === 'usgs');
  assert.deepEqual([usgs.status, usgs.reason, usgs.observed_at, usgs.fetched_at], ['available', null, QUAKE.observed_at, fetchedAt]);
  assert.ok(!feed.providerCalls.includes('earthquake.usgs.gov'));
});

test('news is never a provider: the store refuses a non-government ingest, and the page holds government events only', async () => {
  await assert.rejects(() => plane.store.ingest([{ ...QUAKE, provider_id: 'gdelt123' }], { provider: 'gdelt' }), (e) => typeof e.code === 'string');
  const r = await plane.get(EVENTS, { cache: plane.freshCache() });
  assert.ok(r.body.events.every((e) => e.provider === 'usgs' && e.id.startsWith('usgs:')));
});

test('a correction is revision 2 with old -> new; the edge cache keeps the page a minute, then the new reading shows', async () => {
  const cache = plane.freshCache();
  const before = await plane.get(EVENTS, { cache });
  assert.equal(before.body.events[0].revision, 1);
  await plane.store.ingest([{ ...QUAKE, magnitude: 5.6, source_updated_at: hoursAgo(0.5) }]);
  const kept = await plane.get(EVENTS, { cache });
  assert.deepEqual([kept.body.events[0].revision, kept.storeReads], [1, 0], 'within the minute: the kept page, no store read');
  const t0 = Date.now();
  plane.now = () => t0 + 61e3;
  try {
    const after = await plane.get(EVENTS, { cache });
    assert.deepEqual([after.body.events[0].revision, after.storeReads], [2, 1], 'after the minute: read again');
    assert.deepEqual(after.body.events[0].correction.changes, { magnitude: { from: 5.2, to: 5.6 } });
    assert.equal(after.body.events[0].correction.cause, 'source_revised');
  } finally { plane.now = () => Date.now(); }
  const one = await plane.get(`${EVENTS}/usgs:us7000s4aa`, { cache: plane.freshCache() });
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.event.history.map((h) => [h.revision, h.cause]), [[2, 'source_revised']]);
});

test('an alias: a deep link by the new preferred id answers the canonical event with redirected_from', async () => {
  await plane.store.ingest([VAN]);
  await plane.store.ingest([{ ...VAN, provider_id: 'us6000u3jl', aliases: ['attn6uqd', 'pt26293000', 'us6000u3jl'], status: 'reviewed', magnitude: 6.3, magnitude_type: 'mww',
    lat: -15.147, source_updated_at: hoursAgo(4.5) }]);
  for (const alias of ['usgs:us6000u3jl', 'usgs:pt26293000']) {
    const r = await plane.get(`${EVENTS}/${alias}`, { cache: plane.freshCache() });
    assert.equal(r.status, 200, alias);
    assert.deepEqual([r.body.status, r.body.id, r.body.redirected_from, r.body.event.id, r.body.event.revision], ['published', 'usgs:attn6uqd', alias, 'usgs:attn6uqd', 2], alias);
  }
  const page = await plane.get(EVENTS, { cache: plane.freshCache() });
  assert.deepEqual(ids(page.body), ['usgs:us7000s4aa', 'usgs:attn6uqd'], 'one event, the canonical id, newest observation first');
  const feed = await plane.get(FEED, { cache: plane.freshCache() });
  assert.ok(feed.body.events.some((e) => e.id === 'usgs:attn6uqd' && e.revision === 2), 'the globe gets the same id and revision');
  assert.ok(!feed.body.events.some((e) => e.id === 'usgs:us6000u3jl'), 'never a second id');
});

test('a USGS deletion is a tombstone: kept in the timeline without coordinates, answered by its deep link, gone from the globe', async () => {
  await plane.store.ingest([{ provider_id: 'us7000s4aa', status: 'deleted' }]);
  const page = await plane.get(EVENTS, { cache: plane.freshCache() });
  const tomb = page.body.events.find((e) => e.id === 'usgs:us7000s4aa');
  assert.deepEqual(Object.keys(tomb).sort(), TOMBSTONE_KEYS);
  assert.equal(tomb.state, 'withdrawn_by_source'); assert.ok(tomb.withdrawn_at); assert.equal(tomb.retracted_at, null);
  const one = await plane.get(`${EVENTS}/usgs:us7000s4aa`, { cache: plane.freshCache() });
  assert.deepEqual([one.status, one.body.status, 'lat' in one.body.event], [200, 'withdrawn_by_source', false]);
  assert.equal(one.body.event.history[0].cause, 'source_deleted');
  const feed = await plane.get(FEED, { cache: plane.freshCache() });
  assert.ok(!feed.body.events.some((e) => e.id === 'usgs:us7000s4aa'), 'no globe object for a tombstone');
});

test('an owner hold: the deep link answers 404 not_available and the page leaves it out', async () => {
  const held = await plane.store.command('hold', 'usgs:attn6uqd', 2, { reason: 'Timeline plane: hold while checking.' });
  assert.equal(held.changed, true);
  const one = await plane.get(`${EVENTS}/usgs:attn6uqd`, { cache: plane.freshCache() });
  assert.deepEqual([one.status, one.body.ok, one.body.code, one.body.event], [404, false, 'not_available', null]);
  const page = await plane.get(EVENTS, { cache: plane.freshCache() });
  assert.ok(!ids(page.body).includes('usgs:attn6uqd'));
  const none = await plane.get(`${EVENTS}/usgs:us0000none`, { cache: plane.freshCache() });
  assert.deepEqual([none.status, none.body.code], [404, 'not_found']);
});

test('paging: a keyset cursor walks the whole timeline once, newest observation first', async () => {
  const more = [1, 2, 3, 4, 5].map((k) => usgsEvent({ provider_id: `us7000s4p${k}`, observed_at: hoursAgo(6 + k), magnitude: 4.5 + k / 10, magnitude_type: 'mb', place: `Built place ${k}`, title: `M ${4.5 + k / 10} - Built place ${k}` }));
  await plane.store.ingest(more);
  const seen = [];
  let cursor = null, pages = 0;
  do {
    const r = await plane.get(`${EVENTS}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: plane.freshCache() });
    assert.equal(r.status, 200);
    assert.ok(r.body.events.length <= 2);
    seen.push(...ids(r.body));
    cursor = r.body.next_cursor; pages += 1;
  } while (cursor && pages < 10);
  assert.deepEqual(seen, ['usgs:us7000s4aa', 'usgs:us7000s4p1', 'usgs:us7000s4p2', 'usgs:us7000s4p3', 'usgs:us7000s4p4', 'usgs:us7000s4p5']);
  assert.equal(new Set(seen).size, seen.length, 'each event once');
});

test('the gate stays first: a disabled module refuses both routes again, before any store read', async () => {
  await plane.disable();
  for (const path of [EVENTS, `${EVENTS}/usgs:us7000s4aa`]) {
    const r = await plane.get(path, { cache: plane.freshCache() });
    assert.deepEqual([r.status, r.body, r.storeReads], [404, OFF, 0], path);
  }
  plane.storeDown = true;
  const down = await plane.get(EVENTS, { cache: plane.freshCache() });
  assert.deepEqual([down.status, down.body.code], [503, 'module_policy_unavailable'], 'an unreachable store is an outage, never off');
  plane.storeDown = false;
});
