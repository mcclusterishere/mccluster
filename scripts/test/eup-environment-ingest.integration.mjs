// E=UP event timeline slice S3 (2026-11-19): the USGS ingest, proven end to end in-process: the REAL Worker ingest
// (workers/mccluster/src/eup/environment/ingest.js and usgs.js, unchanged and unwrapped) over the REAL SQL in PGlite (the applied
// module policy and the five PENDING store parts, supabase/pending/20261119100000_eup_environment_events_v1_01.sql to _05.sql),
// through the League plane's PostgREST emulation (scripts/test/support/eup-league-plane.mjs: RPCs bound by argument name and
// declared type, the role from the key), with USGS answered ONLY from recorded answers
// (workers/mccluster/test/fixtures/environment/usgs-ingest/, each with its request and retrieval time; their loader and the
// few things built from them, each labelled BUILT: workers/mccluster/test/support/usgs-ingest-fixtures.mjs). No network, no
// Supabase, no Cloudflare. It is the local stand-in for "staging" (decision D1, default adopted pending Matthew's
// confirmation): none exists, and creating one is his call.
//   flag off                      no call of any kind
//   store not applied, no rule    the run stops at its read; USGS is never asked; nothing recorded
//   the recorded M2.5+ day        what the D7 rule qualifies is published, the rest are candidates, one health row a run; a
//                                 rerun of the same feed changes nothing
//   a recorded history replayed   NTWC attn6uqd -> PTWC pt26293000 -> NEIC us6000u3jl keeps ONE canonical id (usgs:attn6uqd,
//                                 D5); each substantive change is a revision (D6); a DYFI-only update is not; a late
//                                 correction three weeks on arrives through the daily sweep
//   an alias look-up              a published event the feed no longer lists is looked up by its id; USGS answers the
//                                 preferred event and the store follows the alias
//   a 409                         a deletion: the published event becomes a tombstone (withdrawn_by_source), by look-up or
//                                 by the daily sweep
//   paused, an outage, a re-run   one health row each: paused (USGS not asked), unavailable with its reason, and a tick
//                                 delivered twice records once
//   PGLITE_MODULE=<PGlite 0.3.x dist/index.js> node scripts/test/eup-environment-ingest.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentStoreDatabase, DEFAULT_USGS_RULE } from './support/eup-environment-database.mjs';
import { createLeaguePlane } from './support/eup-league-plane.mjs';
import { enableModule } from './support/eup-module-policy-database.mjs';
import { runUsgsIngest, USGS_INGEST_FLAG } from '../../workers/mccluster/src/eup/environment/ingest.js';
import { usgsFeedUrl } from '../../workers/mccluster/src/eup/environment/usgs.js';
import { USGS_FIXTURES as F, beforeDeletion, feedOf, historyTimes, historyView, recorded, usgsAnswer } from '../../workers/mccluster/test/support/usgs-ingest-fixtures.mjs';

const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const HISTORY = recorded(F.history).body;
const FEED = recorded(F.feed).body;
const FIVE = 5 * 60e3;

/* One store in PGlite behind PostgREST, and USGS answered by `usgs(url)`; every call is logged. */
async function plane({ apply = true } = {}) {
  const store = await createEnvironmentStoreDatabase({ apply });
  const league = await createLeaguePlane({ database: { db: store.db, close: () => store.close() } });
  const storeFetch = league.workerFetch; // called unbound, as the Worker calls fetch
  const calls = [];
  const p = {
    store, db: store.db, calls, usgs: () => { throw new Error('no USGS answer set for this run'); },
    env: { ...league.env, [USGS_INGEST_FLAG]: 'true' },
    usgsCalls: () => calls.filter((u) => new URL(u).hostname === 'earthquake.usgs.gov'),
    storeCalls: () => calls.filter((u) => new URL(u).origin === league.supabase).map((u) => new URL(u).pathname),
    reloadSchema: () => league.reloadSchema(), // PostgREST reloads its schema cache after DDL
    close: () => store.close()
  };
  p.fetchImpl = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url.href);
    if (url.origin === league.supabase) return storeFetch(input, init);
    if (url.hostname === 'earthquake.usgs.gov') return p.usgs(url);
    throw new TypeError(`the ingest asked another host: ${url.href}`);
  };
  /* one cron tick */
  p.tick = (tick, { env = p.env } = {}) => runUsgsIngest(env, { fetchImpl: p.fetchImpl, now: tick, scheduledTime: tick });
  p.rule = async (rule = null) => {
    const view = await store.ownerRead();
    const revision = view.providers.find((x) => x.provider === 'usgs')?.revision ?? 0;
    return store.command('set_rule', 'usgs', revision, rule ? { payload: { rule } } : {});
  };
  p.events = async () => (await store.db.query(`select id, state, revision, provider_event_id, snapshot, source_updated_at from public.eup_environment_events order by id`)).rows;
  p.revisions = async (id) => (await store.db.query(`select revision, cause, changes, run_id from public.eup_environment_event_revisions where event_id = $1 order by revision`, [id])).rows;
  p.aliases = async (id) => (await store.db.query(`select provider_event_id from public.eup_environment_event_aliases where event_id = $1 order by 1`, [id])).rows.map((r) => r.provider_event_id);
  p.health = async () => (await store.db.query(`select run_id, status, reason, http_status, counts from public.eup_environment_source_health order by seq`)).rows;
  return p;
}
const isFeed = (url, name = '2.5_day') => url.href === usgsFeedUrl(name);
const eventId = (url) => url.searchParams.get('eventid');

test('flag off: no network call and no store call; store not applied or no rule yet: USGS is never asked', async () => {
  const p = await plane({ apply: false });
  try {
    for (const value of [undefined, 'false', '']) {
      const r = await p.tick(Date.UTC(2026, 10, 19, 4, 50), { env: { ...p.env, [USGS_INGEST_FLAG]: value } });
      assert.equal(r.skipped, 'disabled');
    }
    assert.deepEqual(p.calls, [], 'nothing at all with the flag off');
    const notApplied = await p.tick(Date.UTC(2026, 10, 19, 4, 50));
    assert.deepEqual([notApplied.skipped, notApplied.error], ['store_not_applied', null]);
    assert.deepEqual(p.storeCalls(), ['/rest/v1/rpc/eup_environment_ingest_state']); assert.deepEqual(p.usgsCalls(), []);
    await p.store.apply(); // Matthew's go, emulated here
    p.reloadSchema();
    const noRule = await p.tick(Date.UTC(2026, 10, 19, 4, 55));
    assert.equal(noRule.skipped, 'provider_not_configured', 'the owner has set no rule: the ingest asks nothing');
    assert.deepEqual(p.usgsCalls(), []); assert.deepEqual(await p.health(), [], 'and records nothing');
  } finally { await p.close(); }
});

test('the recorded M2.5+ day: what D7 qualifies is published, the rest are candidates; a rerun changes nothing; nothing is public while the module is off', async () => {
  const p = await plane();
  try {
    await p.rule(); // the D7 default, adopted pending Matthew's confirmation
    p.usgs = (url) => { assert.ok(isFeed(url), url.href); return usgsAnswer(F.feed); };
    const tick = Math.ceil(FEED.metadata.generated / FIVE) * FIVE;
    const first = await p.tick(tick);
    assert.deepEqual([first.status, first.error, first.feed], ['ok', null, '2.5_day']);
    assert.deepEqual(first.counts, { received: 15, inserted: 15, revised: 0, refreshed: 0, unchanged: 0, published: 9, withdrawn: 0, restored: 0, merged: 0, refused: 0, conflicts: 0, unknown_deletions: 0, dropped: 0 });
    const events = await p.events();
    const published = events.filter((e) => e.state === 'published').map((e) => e.id).sort();
    assert.deepEqual(published, ['usgs:us6000ubw3', 'usgs:us6000ubxa', 'usgs:us6000ubxb', 'usgs:us6000ubxg', 'usgs:us7000tyy8', 'usgs:us7000tz1n', 'usgs:us7000tz2w', 'usgs:us7000tz33', 'usgs:us7000tz37'],
      'M4.5 and above (us7000tz33 is exactly 4.5)');
    assert.deepEqual(events.filter((e) => e.state === 'candidate').map((e) => e.id).sort(),
      ['usgs:aka2026wvqdhv', 'usgs:aka2026wxbuhs', 'usgs:ci41363495', 'usgs:nc75468022', 'usgs:us6000ubvt', 'usgs:us7000tz32'], 'stored, never public: below M4.5 with no alert');
    assert.deepEqual(await p.aliases('usgs:us6000ubw3'), ['aka2026wwodfo', 'us6000ubw3'], 'every id USGS associates is an alias');
    const again = await p.tick(tick + FIVE);
    assert.deepEqual([again.counts.unchanged, again.counts.inserted, again.counts.revised, again.counts.refreshed], [15, 0, 0, 0], 'the same feed five minutes on changes nothing');
    const health = await p.health();
    assert.deepEqual(health.map((h) => [h.run_id, h.status, h.http_status]), [['usgs-20261119T0455Z', 'ok', 200], ['usgs-20261119T0500Z', 'ok', 200]], 'one health row a run');
    assert.deepEqual(p.storeCalls().filter((s) => s.endsWith('/eup_environment_ingest')).length, 2, 'one store write a run');
    await assert.rejects(p.store.publicEvents(), (e) => e.code === 'EUM01', 'the module is not installed: nothing is public');
    const preview = await p.store.preview();
    assert.equal(preview.events.length, 9, 'the owner\'s preview shows what would be public');
  } finally { await p.close(); }
});

/* BUILT from the recorded includesuperseded history: what each five-minute tick would have seen */
const historyTicks = () => {
  const groups = new Map();
  for (const t of historyTimes(HISTORY)) groups.set(Math.ceil(t / FIVE) * FIVE, t);
  return [...groups].map(([tick, t]) => ({ tick, view: historyView(HISTORY, t) }));
};
const keys = (r) => Object.keys(r.changes).sort();

test('the change from attn6uqd to us6000u3jl keeps one canonical id; each substantive change is a revision, a DYFI-only update is not; a late correction comes by the sweep', async () => {
  const p = await plane();
  try {
    await p.rule();
    const ticks = historyTicks();
    const day = ticks.filter((t) => t.tick < Date.UTC(2026, 9, 21));
    assert.equal(day.length, 7, 'seven ticks on 2026-10-20 saw something new');
    const outcome = [];
    for (const { tick, view } of day) {
      p.usgs = (url) => { assert.ok(isFeed(url), url.href); return json(feedOf([view], tick)); };
      const r = await p.tick(tick);
      outcome.push([view.id, Object.entries(r.counts).filter(([k, v]) => v && ['inserted', 'revised', 'refreshed', 'unchanged'].includes(k)).map(([k]) => k).join()]);
    }
    assert.deepEqual(outcome, [['attn6uqd', 'inserted'], ['pt26293000', 'revised'], ['us6000u3jl', 'revised'], ['us6000u3jl', 'revised'], ['us6000u3jl', 'revised'],
      ['us6000u3jl', 'refreshed'], ['us6000u3jl', 'refreshed']], 'the 05:10 tick (DYFI only) and the 06:30 tick (ground failure, PAGER and ShakeMap reruns) refresh without a revision');
    /* weeks later the event is outside the feed's day: what USGS changes reaches the store through the daily sweep */
    for (const day of [Date.UTC(2026, 9, 28, 3, 10), Date.UTC(2026, 10, 11, 3, 10)]) {
      const latest = ticks.filter((t) => t.tick <= day).pop().view;
      p.usgs = (url) => (isFeed(url) ? json(feedOf([], day)) : (assert.equal(url.searchParams.get('includedeleted'), 'true'), json(feedOf([latest], day))));
      const r = await p.tick(day);
      assert.equal(r.sweep, true); assert.equal(r.sweep_rows, 1);
      outcome.push([latest.id, r.counts.revised ? 'revised' : r.counts.refreshed ? 'refreshed' : 'unchanged']);
    }
    assert.deepEqual(outcome.slice(-2), [['us6000u3jl', 'refreshed'], ['us6000u3jl', 'revised']], 'the 2026-11-10 relocation is a revision three weeks on');
    const [event, ...others] = await p.events();
    assert.equal(others.length, 0, 'one event, never a second one for the new id');
    assert.deepEqual([event.id, event.state, event.revision, event.provider_event_id], ['usgs:attn6uqd', 'published', 6, 'us6000u3jl'],
      'the canonical id is the first one seen (D5); the store follows USGS\'s preferred id');
    const revisions = await p.revisions('usgs:attn6uqd');
    assert.deepEqual(revisions.map((r) => [r.revision, r.cause, keys(r).join('+')]), [
      [1, 'source_first_seen', ''], [2, 'source_revised', 'location+magnitude_type+status'], [3, 'source_revised', 'location+magnitude+magnitude_type+observed_at'],
      [4, 'source_revised', 'alert'], [5, 'source_revised', 'depth_km+location'], [6, 'source_revised', 'location']]);
    assert.deepEqual(revisions[2].changes.magnitude, { from: 6.6, to: 6.3 }, 'NEIC\'s M6.3 replaced the warning centres\' M6.6');
    assert.deepEqual(await p.aliases('usgs:attn6uqd'), ['attn6uqd', 'pt26293000', 'us6000u3jl']);
    const s = event.snapshot, now = normalizeNow();
    assert.deepEqual([s.magnitude, s.magnitude_type, s.status, s.lat, s.lon, s.depth_km, s.observed_at, s.alert, s.tsunami, s.place],
      [now.magnitude, now.magnitude_type, now.status, now.lat, now.lon, now.depth_km, now.observed_at, now.alert, now.tsunami, now.place], 'it ends where USGS says the event is now');
    assert.equal(new Date(event.source_updated_at).toISOString(), '2026-11-10T06:14:18.790Z');
    await enableModule(p.db, 'environment');
    for (const asked of ['usgs:us6000u3jl', 'usgs:pt26293000']) {
      const read = await p.store.publicEvent(asked);
      assert.deepEqual([read.status, read.id, read.redirected_from], ['published', 'usgs:attn6uqd', asked], `a deep link by ${asked} answers the one event`);
    }
  } finally { await p.close(); }
});
function normalizeNow() {
  const e = HISTORY.properties, c = HISTORY.geometry.coordinates;
  return { magnitude: e.mag, magnitude_type: e.magType, status: e.status, lat: c[1], lon: c[0], depth_km: c[2], observed_at: new Date(e.time).toISOString(), alert: e.alert, tsunami: e.tsunami === 1, place: e.place };
}

test('an alias lookup returns the preferred event: attn6uqd, no longer listed, is looked up and followed', async () => {
  const p = await plane();
  try {
    await p.rule();
    const [first] = historyTicks();
    p.usgs = () => json(feedOf([first.view], first.tick));
    await p.tick(first.tick);
    /* BUILT: the next tick's feed, which no longer lists the event */
    const next = first.tick + FIVE;
    p.usgs = (url) => {
      if (isFeed(url)) return json(feedOf([], next));
      assert.equal(eventId(url), 'attn6uqd', 'the look-up asks by the id the store holds');
      return usgsAnswer(F.alias); // recorded: answers the preferred us6000u3jl
    };
    const r = await p.tick(next);
    assert.deepEqual(r.lookups, { asked: 1, deleted: 0, found: 1, not_found: 0, failed: 0 });
    const [event, ...others] = await p.events();
    assert.equal(others.length, 0);
    assert.deepEqual([event.id, event.revision, event.provider_event_id], ['usgs:attn6uqd', 2, 'us6000u3jl']);
    assert.deepEqual(keys((await p.revisions('usgs:attn6uqd'))[1]).join('+'), 'alert+depth_km+location+magnitude+magnitude_type+observed_at+status');
    assert.deepEqual(await p.aliases('usgs:attn6uqd'), ['attn6uqd', 'attn6uqj', 'pt26293000', 'us6000u3jl', 'usauto6000u3jl'], 'every id USGS now associates');
  } finally { await p.close(); }
});

const DELETED_AT = recorded(F.deletedRecord).body.properties.time; // 2026-11-15T06:10:11.557Z
const before = beforeDeletion(recorded(F.deletedRecord).body);

test('a 409 records a deletion: a published event USGS deleted becomes a tombstone, by look-up within its day', async () => {
  const p = await plane();
  try {
    await p.rule({ ...DEFAULT_USGS_RULE, min_magnitude: 3.5 }); // an owner's rule that publishes the M3.8
    const t1 = Math.ceil(DELETED_AT / FIVE) * FIVE + 9 * FIVE;
    p.usgs = () => json(feedOf([before], t1));
    await p.tick(t1);
    assert.deepEqual((await p.events()).map((e) => [e.id, e.state]), [['usgs:aka2026wpvhsf', 'published']]);
    const t2 = Date.UTC(2026, 10, 15, 9, 30);
    let asked = 0;
    p.usgs = (url) => {
      if (isFeed(url)) return json(feedOf([], t2)); // BUILT: USGS's feeds drop a deleted event
      asked += 1; assert.equal(eventId(url), 'aka2026wpvhsf'); assert.equal(url.searchParams.get('jsonerror'), 'true');
      return usgsAnswer(F.deletedJson); // recorded: 200 with metadata.status 409
    };
    const r = await p.tick(t2);
    assert.equal(asked, 1); assert.deepEqual(r.lookups, { asked: 1, deleted: 1, found: 0, not_found: 0, failed: 0 }); assert.equal(r.counts.withdrawn, 1);
    const [event] = await p.events();
    assert.deepEqual([event.state, event.revision, event.snapshot.status], ['withdrawn_by_source', 2, 'deleted']);
    assert.deepEqual((await p.revisions(event.id)).map((x) => x.cause), ['source_first_seen', 'source_deleted']);
    await enableModule(p.db, 'environment');
    const read = await p.store.publicEvent('usgs:aka2026wpvhsf');
    assert.equal(read.status, 'withdrawn_by_source', 'its deep link answers the tombstone (D12)');
    assert.ok(!('lon' in read.event) && !('lat' in read.event), 'a tombstone has no coordinates, so no globe object');
    const later = await p.tick(t2 + FIVE);
    assert.equal(later.lookups.asked, 0, 'a withdrawn event is no longer looked for');
  } finally { await p.close(); }
});

test('the daily sweep records a late deletion of a published event outside the feed\'s day', async () => {
  const p = await plane();
  try {
    await p.rule({ ...DEFAULT_USGS_RULE, min_magnitude: 3.5 });
    const t1 = Math.ceil(DELETED_AT / FIVE) * FIVE + 9 * FIVE;
    p.usgs = () => json(feedOf([before], t1));
    await p.tick(t1);
    const sweepTick = Date.UTC(2026, 10, 17, 3, 10);
    p.usgs = (url) => (isFeed(url) ? json(feedOf([], sweepTick)) : usgsAnswer(F.sweep)); // recorded sweep: the deleted row and an unpublished one
    const r = await p.tick(sweepTick);
    assert.deepEqual([r.run_id, r.lookups.asked, r.sweep_rows, r.counts.withdrawn, r.counts.received], ['usgs-20261117T0310Z-sweep', 0, 1, 1, 1]);
    const [event, ...others] = await p.events();
    assert.equal(others.length, 0, 'the sweep\'s other row, an event the store never published, is not stored');
    assert.equal(event.state, 'withdrawn_by_source');
    assert.equal(new Date(event.source_updated_at).toISOString(), '2026-11-15T09:19:00.089Z', 'USGS\'s own deletion time');
  } finally { await p.close(); }
});

test('paused: a health row and no USGS call; an outage: one unavailable row with its reason; a tick delivered twice records once', async () => {
  const p = await plane();
  try {
    await p.rule();
    const policy = async () => (await p.store.ownerRead()).providers.find((x) => x.provider === 'usgs').revision;
    await p.store.command('pause_provider', 'usgs', await policy());
    const t = Date.UTC(2026, 10, 19, 5, 0);
    p.usgs = () => { throw new Error('a paused provider is not asked'); };
    const paused = await p.tick(t);
    assert.equal(paused.status, 'paused'); assert.deepEqual(p.usgsCalls(), []);
    await p.store.command('resume_provider', 'usgs', await policy());
    p.usgs = () => json({ message: 'unavailable' }, 503);
    const down = await p.tick(t + FIVE);
    assert.equal(down.status, 'unavailable');
    p.usgs = () => usgsAnswer(F.feed);
    const ok = await p.tick(t + 2 * FIVE);
    const twice = await p.tick(t + 2 * FIVE);
    assert.deepEqual([ok.status, twice.error], ['ok', 'run_already_recorded'], 'the same tick again is refused by the store (EUE05) and records nothing');
    assert.deepEqual((await p.health()).map((h) => [h.run_id, h.status, h.reason, h.http_status]), [
      ['usgs-20261119T0500Z', 'paused', null, null], ['usgs-20261119T0505Z', 'unavailable', 'upstream_error', 503], ['usgs-20261119T0510Z', 'ok', null, 200]]);
    const view = await p.store.ownerRead();
    assert.equal(view.providers.find((x) => x.provider === 'usgs').last_run.status, 'ok', 'the owner\'s Sources view reads the last run');
  } finally { await p.close(); }
});
