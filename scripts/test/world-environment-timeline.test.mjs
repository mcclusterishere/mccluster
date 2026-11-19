/* THE ENVIRONMENTAL TIMELINE IN THE EQUITY UPRISE TAB (event timeline slice S4, 2026-11-19; the record is
   docs/control-plane/EUP-EVENT-TIMELINE.md). js/world-environment-timeline.js turns the public timeline routes' answers
   (GET /v1/world/environment/events and /events/:id, workers/mccluster/src/world-environment-events.js) into posts that carry the
   store's canonical id and revision, the observed, provider-updated and retrieved times, automatic or reviewed, an official
   correction as old -> new (with a deep link's earlier corrections) and a withdrawal as a tombstone with no globe object; it puts
   them in one list with the live posts of the providers the store does not hold yet; and it keeps the address: a deep link
   ?feed=equity&event=<id> opens and marks the event, an alias lands on the canonical id with no new entry, a visitor's choice of
   an event is one history entry, Back and Forward choose again. Pure parts and the controller over a fake window here; the real
   page over the real Worker and the real SQL at 390, 820 and 1280 is scripts/e2e/environment-timeline.e2e.mjs.
     node --test scripts/test/world-environment-timeline.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const T = createRequire(import.meta.url)(ROOT + 'js/world-environment-timeline.js');
const NOW = Date.parse('2026-11-19T12:00:00Z');
const API = 'https://api.mccluster.org/v1/world/environment/events';

/* one public event in the Worker's whitelisted shape (publicEvent) */
function quake(over = {}) {
  return {
    id: 'usgs:us7000abcd', revision: 1, provider: 'usgs', kind: 'earthquake', state: 'published', title: 'M 6.3 - 40 km SW of Somewhere, Chile',
    place: '40 km SW of Somewhere, Chile', magnitude: 6.3, magnitude_type: 'mww', observed_at: '2026-11-19T11:00:00.000Z', depth_km: 35,
    lon: -71.5, lat: -33.2, review_status: 'reviewed', tsunami: false, alert: 'yellow',
    source: { id: 'us7000abcd', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd', updated_at: '2026-11-19T11:40:00.000Z', fetched_at: '2026-11-19T11:45:00.000Z' },
    first_published_at: '2026-11-19T11:20:00.000Z', revised_at: null, correction: null, news_coverage: [], ...over
  };
}
const corrected = () => quake({
  revision: 2, revised_at: '2026-11-19T11:40:00.000Z',
  correction: { revision: 2, cause: 'source_revised', recorded_at: '2026-11-19T11:41:00.000Z', changes: { magnitude: { from: 6.6, to: 6.3 }, location: { from: [-71.48, -33.18], to: [-71.5, -33.2], km: 2.9 }, status: { from: 'automatic', to: 'reviewed' } } }
});
const tomb = (over = {}) => ({
  id: 'usgs:us7000gone', revision: 3, provider: 'usgs', kind: 'earthquake', state: 'withdrawn_by_source', title: 'M 5.1 - Offshore', place: 'Offshore',
  magnitude: 5.1, magnitude_type: 'mb', observed_at: '2026-11-19T09:00:00.000Z', source: { id: 'us7000gone', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000gone' },
  first_published_at: '2026-11-19T09:10:00.000Z', withdrawn_at: '2026-11-19T10:00:00.000Z', retracted_at: null, ...over
});
/* a live post as js/world-environment-posts.js builds it from the panel's feed (only the fields the merge reads) */
const live = (id, at) => ({ observationPost: true, id, globe_id: id, sort_key: at || '', title: id });

test('a published event becomes a post with its canonical id and revision, its times, automatic or reviewed, and its source', () => {
  const p = T.timelinePost(quake(), NOW);
  assert.equal(p.id, 'usgs:us7000abcd');
  assert.equal(p.globe_id, 'usgs:us7000abcd', 'one id drives the post, the globe object, the selection and the deep link');
  assert.equal(p.revision, 1);
  assert.equal(p.timeline, true);
  assert.equal(p.observationPost, true);
  assert.equal(p.title, 'M6.3 · 40 km SW of Somewhere, Chile');
  assert.deepEqual(p.facts.map((f) => f.label), ['Magnitude', 'Depth', 'PAGER alert']);
  assert.equal(p.facts[0].value, '6.3 mww');
  assert.match(p.stamp.text, /^Observed .+ · .+$/, 'the observed time, with how long ago');
  assert.equal(p.stamp.kind, 'recorded');
  assert.match(p.times, /^USGS updated .+ · Retrieved .+$/, 'the provider\'s own update time and the retrieval time; a first revision is not numbered');
  assert.equal(p.review, 'Reviewed by USGS');
  assert.equal(T.timelinePost(quake({ review_status: 'automatic' }), NOW).review, 'Automatic, not yet reviewed by USGS');
  assert.equal(p.correction, '');
  assert.equal(p.tombstone, '');
  assert.deepEqual([p.lat, p.lon], [-33.2, -71.5]);
  assert.deepEqual(p.source, { label: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd' });
  assert.equal(p.significant, true, 'M5.5 and larger rides in Global, as the live quake does');
  assert.equal(p.sort_key, '2026-11-19T11:00:00.000Z');
  assert.match(p.hash, /^[0-9a-f]{8}$/);
  /* a tsunami flag is said as the source's flag, never as a warning */
  assert.deepEqual(T.timelinePost(quake({ tsunami: true }), NOW).facts.find((f) => f.label === 'USGS tsunami flag'), { label: 'USGS tsunami flag', value: 'Flagged by source; consult official warnings' });
});

test('an official correction says old -> new, field by field, and the revision is numbered', () => {
  const p = T.timelinePost(corrected(), NOW);
  assert.equal(p.revision, 2);
  assert.match(p.times, /^Revision 2 · USGS updated /);
  assert.equal(p.correction, 'Corrected by USGS: magnitude 6.6 → 6.3; location moved 2.9 km; review automatic → reviewed');
  assert.equal(T.correctionLine({ cause: 'source_restored', changes: { depth_km: { from: 10, to: 12.5 } } }), 'Restored by USGS: depth 10 → 12.5 km');
  assert.equal(T.correctionLine({ cause: 'owner_rollback', changes: { magnitude_type: { from: 'mb', to: 'mww' } } }), 'Restored to an earlier USGS reading: magnitude type mb → mww');
  assert.equal(T.correctionLine({ cause: 'source_revised', changes: { tsunami: { from: false, to: true }, alert: { from: null, to: 'yellow' } } }), 'Corrected by USGS: tsunami flag off → on; PAGER alert none → yellow');
  assert.match(T.correctionLine({ cause: 'source_revised', changes: { observed_at: { from: '2026-11-19T10:59:00Z', to: '2026-11-19T11:00:00Z' } } }), /^Corrected by USGS: origin time .+ → .+$/);
  assert.equal(T.correctionLine({ cause: 'source_revised', changes: {} }), '', 'no words, no line');
  assert.equal(T.correctionLine({ cause: 'source_deleted', changes: {} }), '', 'a withdrawal is the tombstone\'s line, not a correction');
  assert.equal(T.correctionLine(null), '');
  assert.equal(T.correctionLine({ cause: 'whatever', changes: { magnitude: { from: 1, to: 2 } } }), '');
});

test('a deep link\'s history adds the earlier corrections, newest first, the one already shown left out', () => {
  const e = corrected();
  e.history = [
    { revision: 2, cause: 'source_revised', changes: e.correction.changes, recorded_at: '2026-11-19T11:41:00.000Z' },
    { revision: 1, cause: 'source_deleted', changes: {}, recorded_at: '2026-11-19T11:30:00.000Z' },
    { revision: 1, cause: 'source_restored', changes: { depth_km: { from: 30, to: 35 } }, recorded_at: '2026-11-19T11:35:00.000Z' }
  ];
  const p = T.timelinePost(e, NOW);
  assert.deepEqual(p.earlier, ['Revision 1: Restored by USGS: depth 30 → 35 km']);
  assert.deepEqual(T.timelinePost(corrected(), NOW).earlier, [], 'a page carries no history');
  assert.notEqual(p.hash, T.timelinePost(corrected(), NOW).hash, 'the history is part of what the post says');
});

test('a withdrawn event stays as a tombstone with no globe object; a retracted one says the timeline withdrew it', () => {
  const p = T.timelinePost(tomb(), NOW);
  assert.equal(p.state, 'withdrawn_by_source');
  assert.match(p.tombstone, /^Withdrawn by USGS on .+$/);
  assert.equal(p.lat, null);
  assert.equal(p.lon, null, 'no coordinates, so no globe object and no Show on globe (decision D12)');
  assert.equal(p.review, '');
  assert.equal(p.times, 'Revision 3', 'its revision; no provider update or retrieval time for an event that is gone');
  assert.equal(p.correction, '');
  assert.deepEqual(p.facts.map((f) => f.label), ['Magnitude'], 'what it was: no depth, no alert');
  assert.equal(p.title, 'M5.1 · Offshore');
  const r = T.timelinePost(tomb({ id: 'usgs:us7000held', state: 'retracted', withdrawn_at: null, retracted_at: '2026-11-19T10:30:00.000Z' }), NOW);
  assert.match(r.tombstone, /^Withdrawn from the timeline on .+$/);
  assert.equal(T.timelinePost(tomb({ withdrawn_at: null }), NOW).tombstone, 'Withdrawn by USGS', 'no date, no date');
});

test('only a shown event with a canonical id is a post; links are https only; nothing writes the brand out', () => {
  for (const bad of [null, 'usgs:x', {}, quake({ id: 'gdelt:123', provider: 'gdelt' }), quake({ id: 'usgs:' }), quake({ state: 'held' }), quake({ state: 'candidate' }), quake({ state: 'not_available' })]) {
    assert.equal(T.timelinePost(bad, NOW), null, JSON.stringify(bad));
  }
  assert.equal(T.timelinePost(quake({ source: { url: 'http://earthquake.usgs.gov/x' } }), NOW).source.url, '');
  assert.equal(T.timelinePost(quake({ source: { url: 'javascript:alert(1)' } }), NOW).source.url, '');
  assert.equal(T.timelinePost(quake({ lat: 95 }), NOW).lat, null, 'an impossible point is no point');
  assert.equal(T.timelinePost(quake({ place: 'A\u0000place\n  with   breaks' }), NOW).title, 'M6.3 · A place with breaks');
  assert.equal(T.timelinePost(quake({ magnitude: 5 }), NOW).title, 'M5.0 · 40 km SW of Somewhere, Chile', 'a magnitude as USGS writes it, one decimal');
  assert.equal(T.timelinePost(quake({ magnitude: 4.85, magnitude_type: 'ml' }), NOW).facts[0].value, '4.9 ml');
  const words = JSON.stringify([T.timelinePost(corrected(), NOW), T.timelinePost(tomb(), NOW), T.NOTES, T.COVERAGE]);
  assert.doesNotMatch(words, /E\s*=\s*Up/i, 'the brand is never written beside the emblem');
  assert.doesNotMatch(read('js/world-environment-timeline.js'), /E\s*=\s*Up/i);
});

test('one list: the store\'s posts in place of the feed\'s quakes, the other providers\' live posts by time, each id once', () => {
  const a = T.timelinePost(quake({ id: 'usgs:a', observed_at: '2026-11-19T11:00:00Z' }), NOW);
  const b = T.timelinePost(quake({ id: 'usgs:b', observed_at: '2026-11-19T08:00:00Z' }), NOW);
  const list = T.mergeTimeline([a, b], [live('usgs:a', '2026-11-19T11:00:00Z'), live('usgs:zz', '2026-11-19T11:30:00Z'), live('eonet:E1', '2026-11-19T10:00:00Z'), live('nws:undated'), live('coops:8443970', '2026-11-19T07:00:00Z')]);
  assert.deepEqual(list.map((p) => p.id), ['usgs:a', 'eonet:E1', 'usgs:b', 'coops:8443970', 'nws:undated'], 'newest first, the undated last; the feed\'s USGS posts give way to the store\'s');
  assert.equal(list[0].timeline, true, 'the store\'s own post, not the live copy');
  /* while the store has older pages, a live post older than the oldest loaded timeline post waits: what shows is a true prefix */
  const paged = T.mergeTimeline([a, b], [live('eonet:E1', '2026-11-19T10:00:00Z'), live('coops:8443970', '2026-11-19T07:00:00Z'), live('nws:undated')], { hasMore: true });
  assert.deepEqual(paged.map((p) => p.id), ['usgs:a', 'eonet:E1', 'usgs:b']);
  /* a deep-linked event from outside the loaded pages joins by its time */
  const old = T.timelinePost(quake({ id: 'usgs:old', observed_at: '2026-11-10T00:00:00Z' }), NOW);
  assert.deepEqual(T.mergeTimeline([a], [], { extra: [old, a] }).map((p) => p.id), ['usgs:a', 'usgs:old']);
  assert.deepEqual(T.mergeTimeline(null, null), []);
});

test('the address: ?feed=equity&event=<id>, every other parameter kept, the id readable', () => {
  assert.equal(T.eventIdFromSearch('?feed=equity&event=usgs:us7000abcd'), 'usgs:us7000abcd');
  assert.equal(T.eventIdFromSearch('?event=usgs%3Aus7000abcd'), 'usgs:us7000abcd');
  for (const bad of ['', '?event=', '?event=gdelt:1', '?event=usgs:', '?event=<script>', '?event=usgs:' + 'x'.repeat(200)]) assert.equal(T.eventIdFromSearch(bad), '', bad);
  assert.equal(T.searchWithEvent('?view=feed', 'usgs:us7000abcd'), '?view=feed&feed=equity&event=usgs:us7000abcd');
  assert.equal(T.searchWithEvent('?feed=global&event=usgs:old&song=x', 'usgs:new'), '?song=x&feed=equity&event=usgs:new');
  assert.equal(T.searchWithEvent('?feed=equity&event=usgs:a', ''), '?feed=equity', 'no event, no event');
  assert.equal(T.searchWithEvent('', 'not an id'), '?feed=equity');
});

/* ---------- the controller over a fake window ---------- */
function fakeWindow({ search = '', scope = 'global', answer } = {}) {
  const listeners = {}, calls = [], pushes = [], replaces = [], focused = [];
  let clock = NOW, renders = 0;
  const frame = { contentWindow: { name: 'the World frame' } };
  const w = {
    location: { pathname: '/mnet.html', search, hash: '', origin: 'https://mccluster.org' },
    document: { getElementById: (id) => (id === 'mnWorldFrame' ? frame : null) },
    history: {
      state: null,
      pushState(st, _t, href) { pushes.push(href); w.history.state = st; w.location.search = href.slice(href.indexOf('?')).replace(/#.*$/, ''); },
      replaceState(st, _t, href) { replaces.push(href); w.history.state = st; w.location.search = href.includes('?') ? href.slice(href.indexOf('?')) : ''; }
    },
    MCC_FEED_SCOPE: { get: () => scope },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    setTimeout: () => 0, clearTimeout() {},
    async fetch(url, init) {
      calls.push({ url, init });
      const a = answer(url, calls.length);
      if (a instanceof Error) throw a;
      return { status: a.status, async json() { return a.body; } };
    }
  };
  const c = T.createController(w, { now: () => clock });
  c.attach({ render: () => { renders++; }, focus: (id) => focused.push(id) });
  c.listen();
  const fire = (type, detail) => (listeners[type] || []).forEach((fn) => fn({ detail }));
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    c, w, calls, pushes, replaces, focused, settle,
    renders: () => renders,
    tick(ms) { clock += ms; },
    setScope(next) { scope = next; fire('mcc:feed-scope', { scope: next }); },
    feed(detail) { fire('mcc:world-environment-events', detail); },
    back(searchNext) { w.location.search = searchNext; fire('popstate', null); },
    /* a message from the World frame (or from elsewhere) */
    frameSays(data, { source = frame.contentWindow, origin = 'https://mccluster.org' } = {}) { (listeners.message || []).forEach((fn) => fn({ source, origin, data })); }
  };
}
const page = (events, next = null) => ({ status: 200, body: { ok: true, schema: 'mccluster.environment-events/v1', events, next_cursor: next, sources: [] } });
const one = (event, status = 200) => ({ status, body: { ok: true, schema: 'mccluster.environment-event/v1', status: event.state, id: event.id, event } });
const OPEN = { events: [], sources: [], layers: {} };

test('the timeline is read only after the feed answered, only for the tab or a deep link, at most once a minute, never after a refusal', async () => {
  const f = fakeWindow({ answer: () => page([quake()]) });
  f.setScope('equity');
  await f.settle();
  assert.equal(f.calls.length, 0, 'nothing before the panel\'s feed has answered (the gate is not asked twice)');
  f.setScope('global');
  f.feed(OPEN);
  await f.settle();
  assert.equal(f.calls.length, 0, 'Global, no deep link: nothing read');
  f.setScope('equity');
  await f.settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, API + '?limit=20');
  assert.equal(f.calls[0].init.credentials, 'omit', 'a public read carries no credential');
  assert.deepEqual(f.c.state().posts, [['usgs:us7000abcd', 1, 'published']]);
  assert.ok(f.renders() > 0, 'the page draws again');
  f.setScope('global'); f.setScope('equity');
  f.feed(OPEN);
  await f.settle();
  assert.equal(f.calls.length, 1, 'within the minute the Worker keeps a page, the page is not asked again');
  f.tick(61000);
  f.setScope('global'); f.setScope('equity');
  await f.settle();
  assert.equal(f.calls.length, 2, 'after a minute it is');

  const refused = fakeWindow({ search: '?feed=equity&event=usgs:us7000abcd', scope: 'equity', answer: () => page([]) });
  refused.feed({ unavailable: true, code: 'module_disabled' });
  refused.setScope('global'); refused.setScope('equity');
  await refused.settle();
  assert.equal(refused.calls.length, 0, 'the gate refused (off or outage): the timeline is never asked, not even for a deep link');
  assert.equal(refused.c.merged([live('eonet:E1', '2026-11-19T10:00:00Z')]).length, 1, 'the page keeps what it has');
});

test('a failed read keeps the feed\'s own posts and is not retried within the minute', async () => {
  const f = fakeWindow({ scope: 'equity', answer: (url, n) => (n === 1 ? new TypeError('offline') : page([quake()])) });
  f.feed(OPEN);
  await f.settle();
  assert.equal(f.c.state().status, 'failed');
  const liveList = [live('usgs:us7000abcd', '2026-11-19T11:00:00Z')];
  assert.deepEqual(f.c.merged(liveList), liveList, 'the live quake (the same canonical id) stays');
  f.setScope('global'); f.setScope('equity');
  await f.settle();
  assert.equal(f.calls.length, 1, 'not asked again at once');
  f.tick(60001);
  f.setScope('global'); f.setScope('equity');
  await f.settle();
  assert.equal(f.c.state().status, 'ready');
  assert.equal(f.c.merged(liveList)[0].timeline, true);
});

test('a deep link opens its event: marked, shown on the globe, and the address kept as it came', async () => {
  const f = fakeWindow({ search: '?feed=equity&event=usgs:us7000abcd', scope: 'equity', answer: (url) => (url === API + '?limit=20' ? page([quake()]) : one(quake())) });
  f.feed(OPEN);
  await f.settle(); await f.settle();
  assert.equal(f.c.selected(), 'usgs:us7000abcd');
  assert.deepEqual(f.focused, ['usgs:us7000abcd'], 'the globe is pointed at it once');
  assert.equal(f.calls[1].url, API + '/usgs%3Aus7000abcd', 'its own answer is read for its history');
  assert.deepEqual([f.pushes, f.replaces], [[], []], 'a deep link writes no history');
  assert.equal(f.c.note(), '');
});

test('a deep link by alias or to a merged event lands on the canonical id, with no new history entry', async () => {
  const canonical = quake({ id: 'usgs:attn6uqd', source: { id: 'us6000u3jl', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u3jl' } });
  const f = fakeWindow({ search: '?view=feed&event=usgs:us6000u3jl', scope: 'global', answer: (url) => (url.includes('?limit=') ? page([]) : one(canonical)) });
  f.feed(OPEN);
  await f.settle(); await f.settle();
  assert.equal(f.calls.length, 2, 'the page, then the event');
  assert.equal(f.c.selected(), 'usgs:attn6uqd');
  assert.deepEqual(f.replaces, ['/mnet.html?view=feed&feed=equity&event=usgs:attn6uqd'], 'the address now names the canonical id, replaced');
  assert.deepEqual(f.pushes, []);
  assert.deepEqual(f.c.state().extra, ['usgs:attn6uqd'], 'an event outside the loaded pages joins the list');
  assert.deepEqual(f.c.merged([]).map((p) => p.id), ['usgs:attn6uqd']);
  assert.deepEqual(f.focused, ['usgs:attn6uqd']);
});

test('a deep link to a held, unknown or unreadable event says so in one line; a tombstone opens as a tombstone', async () => {
  const cases = [
    [{ status: 404, body: { ok: false, code: 'not_available', status: 'not_available' } }, T.NOTES.held],
    [{ status: 404, body: { ok: false, code: 'not_found', status: 'not_found' } }, T.NOTES.gone],
    [{ status: 503, body: { ok: false, code: 'events_unavailable' } }, T.NOTES.failed],
    [new TypeError('offline'), T.NOTES.failed]
  ];
  for (const [answer, words] of cases) {
    const f = fakeWindow({ search: '?event=usgs:us7000held', scope: 'equity', answer: (url) => (url.includes('?limit=') ? page([]) : answer) });
    f.feed(OPEN);
    await f.settle(); await f.settle();
    assert.equal(f.c.note(), words);
    assert.equal(f.c.selected(), '');
    assert.deepEqual(f.focused, []);
  }
  const bad = fakeWindow({ search: '?event=usgs:', scope: 'equity', answer: () => page([]) });
  bad.feed(OPEN);
  await bad.settle();
  assert.equal(bad.calls.length, 1, 'an id that is not one is never sent');
  const t = fakeWindow({ search: '?event=usgs:us7000gone', scope: 'equity', answer: (url) => (url.includes('?limit=') ? page([]) : one(tomb())) });
  t.feed(OPEN);
  await t.settle(); await t.settle();
  assert.equal(t.c.selected(), 'usgs:us7000gone');
  assert.match(t.c.post('usgs:us7000gone').tombstone, /^Withdrawn by USGS on /);
  assert.deepEqual(t.focused, [], 'a tombstone has no globe object to point at');
});

test('choosing an event is one history entry; the same event again is none; Back and Forward choose from the address', async () => {
  const a = quake({ id: 'usgs:a', observed_at: '2026-11-19T11:00:00Z' }), b = quake({ id: 'usgs:b', observed_at: '2026-11-19T10:00:00Z' });
  const f = fakeWindow({ search: '?view=feed', scope: 'equity', answer: (url) => (url.includes('?limit=') ? page([a, b]) : one(url.endsWith('usgs%3Aa') ? a : b)) });
  f.feed(OPEN);
  await f.settle();
  assert.equal(f.c.select('usgs:a', { push: true }), true);
  assert.deepEqual(f.pushes, ['/mnet.html?view=feed&feed=equity&event=usgs:a']);
  f.c.select('usgs:a', { push: true });
  assert.equal(f.pushes.length, 1, 'the same event twice: one entry');
  f.c.select('usgs:b', { push: true });
  assert.equal(f.pushes.length, 2);
  assert.equal(f.c.select('eonet:E1', { push: true }), false, 'a provider the store does not hold yet: its live post is not addressable');
  assert.equal(f.c.select('usgs:notloaded', { push: true }), true, 'a store-held id not loaded yet is chosen all the same (Global\'s quakes have the canonical id)');
  assert.equal(f.c.selected(), 'usgs:notloaded');
  assert.equal(f.pushes.length, 3);
  f.back('?view=feed&feed=equity&event=usgs:a');
  await f.settle(); await f.settle();
  assert.equal(f.c.selected(), 'usgs:a', 'Back chose the earlier event again');
  assert.ok(f.focused.includes('usgs:a'));
  f.back('?view=feed');
  await f.settle();
  assert.equal(f.c.selected(), '', 'back to the address with no event: nothing chosen');
  assert.equal(f.pushes.length, 3, 'Back writes nothing');
});

test('older pages come by the cursor and keep the list a true prefix', async () => {
  const a = quake({ id: 'usgs:a', observed_at: '2026-11-19T11:00:00Z' }), b = quake({ id: 'usgs:b', observed_at: '2026-11-18T11:00:00Z' });
  const f = fakeWindow({ scope: 'equity', answer: (url) => (url.includes('cursor=') ? page([b]) : page([a], '1763550000000000|usgs:a')) });
  f.feed(OPEN);
  await f.settle();
  assert.equal(f.c.hasMore(), true);
  assert.deepEqual(f.c.merged([live('eonet:E1', '2026-11-19T01:00:00Z')]).map((p) => p.id), ['usgs:a'], 'a live post older than the loaded page waits');
  await f.c.more();
  assert.equal(f.calls[1].url, API + '?limit=20&cursor=' + encodeURIComponent('1763550000000000|usgs:a'));
  assert.equal(f.c.hasMore(), false);
  assert.deepEqual(f.c.merged([live('eonet:E1', '2026-11-19T01:00:00Z')]).map((p) => p.id), ['usgs:a', 'eonet:E1', 'usgs:b']);
});

test('the page wires it: the script before js/mnet.js, the tab\'s list, the posts\' lines, the address and the history entry', () => {
  const html = read('mnet.html'), page = read('js/mnet.js'), css = read('css/world-environment.css');
  const at = (s) => html.indexOf(s);
  assert.ok(at('js/world-environment-posts.js') < at('js/world-environment-timeline.js') && at('js/world-environment-timeline.js') < at('js/mnet.js?'), 'posts, then the timeline, then the page');
  assert.match(page, /var TIMELINE = window\.MCC_ENVIRONMENT_TIMELINE \|\| null;/);
  assert.match(page, /if \(TIMELINE\) list = TIMELINE\.merged\(list\);/, 'the tab\'s one list of observations');
  assert.match(page, /if \(TIMELINE\) TIMELINE\.select\(p\.id, \{ push: true \}\);/, 'Show on globe names the event in the address');
  assert.match(page, /q\.has\("event"\)/, 'a deep link opens the Equity Uprise tab');
  assert.match(page, /aria-current="true"/);
  assert.match(page, /data-timeline-post data-revision="/);
  assert.match(page, /"Withdrawn: not on the globe"/);
  assert.match(css, /\.mn__timeline-line \{/);
  assert.doesNotMatch(css.slice(css.indexOf('THE TIMELINE\'S POSTS')), /@media|max-width/, 'phone first: no breakpoint needed');
});

test('a deep link that spoke before the globe was up points it again when the frame says it is ready, until the globe has it', async () => {
  const f = fakeWindow({ search: '?feed=equity&event=usgs:us7000abcd', scope: 'equity', answer: (url) => (url.includes('?limit=') ? page([quake()]) : one(quake())) });
  f.feed(OPEN);
  await f.settle(); await f.settle();
  assert.deepEqual(f.focused, ['usgs:us7000abcd']);
  f.frameSays({ type: 'hu:globe-ready', boot: 'b1' }, { source: { name: 'another window' } });
  f.frameSays({ type: 'hu:globe-ready', boot: 'b1' }, { origin: 'https://elsewhere.example' });
  assert.equal(f.focused.length, 1, 'only the World frame, from this origin, is heard');
  f.frameSays({ type: 'hu:globe-ready', boot: 'b1' });
  assert.deepEqual(f.focused, ['usgs:us7000abcd', 'usgs:us7000abcd'], 'the frame booted after the deep link: told again');
  f.frameSays({ type: 'hu:environment-selected', id: 'usgs:other', via: 'tour' });
  f.frameSays({ type: 'hu:globe-ready', boot: 'b2' });
  assert.equal(f.focused.length, 3, 'the tour\'s own selection is not the event: still wanted');
  f.frameSays({ type: 'hu:environment-selected', id: 'usgs:us7000abcd', via: 'focus' });
  f.frameSays({ type: 'hu:globe-ready', boot: 'b3' });
  assert.equal(f.focused.length, 3, 'the globe has it: never told again');
  /* a visitor's own pick on the globe ends the wish too */
  const g = fakeWindow({ search: '?event=usgs:us7000abcd', scope: 'equity', answer: (url) => (url.includes('?limit=') ? page([quake()]) : one(quake())) });
  g.feed(OPEN);
  await g.settle(); await g.settle();
  g.frameSays({ type: 'hu:environment-selected', id: 'eonet:E1', via: 'pick' });
  g.frameSays({ type: 'hu:globe-ready', boot: 'b1' });
  assert.equal(g.focused.length, 1);
});

test('the module turned off after the timeline had loaded: its posts go with it, and nothing is asked until the feed is back', async () => {
  const f = fakeWindow({ scope: 'equity', answer: () => page([quake()]) });
  f.feed(OPEN);
  await f.settle();
  assert.equal(f.c.state().status, 'ready');
  assert.equal(f.c.merged([]).length, 1);
  f.feed({ unavailable: true, code: 'module_disabled' });
  assert.deepEqual([f.c.state().status, f.c.state().posts, f.c.merged([]).length], ['idle', [], 0], 'the tab keeps its honest line, not stale posts');
  f.setScope('global'); f.setScope('equity');
  await f.settle();
  assert.equal(f.calls.length, 1, 'refused: never asked again');
  f.feed(OPEN);
  await f.settle();
  assert.equal(f.calls.length, 2, 'the feed answered again: read again');
  assert.equal(f.c.state().status, 'ready');
});
