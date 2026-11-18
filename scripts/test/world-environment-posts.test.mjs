/* ENVIRONMENTAL OBSERVATION POSTS (owner, 2026-11-17: "the environmental globe updates should be updates like as posts from the
   admin system … obviously what time the event was recorded"; docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md, target 13,
   slice G1 lane L2). The pure parts in js/world-environment-posts.js, run on the feed fixture: which events are significant, how a
   post is stamped (the recorded time, else the retrieval time labelled as such, never a fetch time in the recorded slot), how
   long ago (the same rules as js/mnet.js timeAgo), one post per event id with fires summarised per area, the Equity Uprise tab's
   merge by time and Global's one-in-six (the whole stream, key global; labelled Everything from 2026-11-17 to 2026-11-18). Nothing here touches the page, the network or storage.
     node --test scripts/test/world-environment-posts.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const req = createRequire(import.meta.url);
const P = req(ROOT + 'js/world-environment-posts.js');
const FEED = JSON.parse(read('scripts/e2e/fixtures/environment/feed.json'));
const NOW = Date.parse('2026-11-17T21:00:00Z');
const row = (id) => FEED.events.find((e) => e.id === id);
const detail = (extra = {}) => ({ events: FEED.events, sources: FEED.sources, fetched_at: '2026-11-17T20:05:00Z', checked_at: '2026-11-17T20:05:30Z', unavailable: false, code: null, layers: {}, ...extra });
const quakeRow = (id, mag, extra = {}) => ({ id: 'usgs:' + id, title: 'Fixture', lat: 1, lon: 2, category: 'quake', facts: [{ label: 'Magnitude', value: String(mag) }, { label: 'Depth', value: '10 km' }], ...extra });

test('significance: one pure rule per provider, read from the feed row and its facts, never from the clock', () => {
  assert.equal(typeof P.significance, 'function');
  assert.equal(P.significance(row('usgs:us7000tyhr')), false, 'M5.4 is below the line');
  assert.equal(P.significance(row('usgs:us7000tyca')), true, 'M5.6');
  assert.equal(P.significance(quakeRow('line', 5.5)), true, 'M5.5 is on the line');
  assert.equal(P.significance(quakeRow('mag54', 5.4)), false);
  assert.equal(P.significance({ ...row('usgs:us7000tyhr'), shakemap_available: true }), true, 'a ShakeMap makes a smaller quake significant');
  assert.equal(P.significance({ ...row('usgs:us7000tyhr'), shakemap_available: 'yes' }), false, 'only the boolean true counts');
  assert.equal(P.significance({ id: 'usgs:nomag', facts: [] }), false, 'no magnitude: not significant');
  assert.equal(P.significance(row('nws:fx-flood-az')), true, 'Severe, placed');
  assert.equal(P.significance(row('nws:fx-flood-tx')), true);
  assert.equal(P.significance(row('nws:fx-tornado-ok')), true, 'Extreme, placed');
  assert.equal(P.significance(row('nws:fx-heat-ca')), false, 'Severe but zone-only: never placed, never significant');
  assert.equal(P.significance({ ...row('nws:fx-flood-az'), lat: undefined, lon: undefined }), false, 'an absent point is not a point');
  assert.equal(P.significance(row('nws:fx-wind-wy')), false, 'Moderate');
  assert.equal(P.significance(row('nws:fx-fog-fl')), false, 'Minor');
  assert.equal(P.significance(row('nhc:fx-al19')), true, 'every NHC storm');
  for (const id of ['eonet:EONET_fx_fire_1', 'eonet:EONET_fx_fire_2', 'eonet:EONET_fx_storm_1', 'eonet:EONET_fx_storm_2', 'eonet:EONET_fx_volcano_1']) assert.equal(P.significance(row(id)), true, id);
  assert.equal(P.significance({ id: 'eonet:x', category: 'tornado', lat: 1, lon: 1 }), true);
  assert.equal(P.significance(row('eonet:EONET_fx_ice_1')), false, 'ice');
  assert.equal(P.significance({ id: 'other:x', facts: [{ label: 'Magnitude', value: '9' }] }), false, 'an unknown provider is never significant');
  assert.equal(P.significance(null), false);
  assert.equal(P.significance({ id: 42 }), false);
  /* the fixture carries exactly the sixteen the design names */
  assert.deepEqual(FEED.events.filter(P.significance).map((e) => e.id).sort(), ['eonet:EONET_fx_fire_1', 'eonet:EONET_fx_fire_2', 'eonet:EONET_fx_storm_1', 'eonet:EONET_fx_storm_2', 'eonet:EONET_fx_volcano_1', 'nhc:fx-al19', 'nws:fx-flood-az', 'nws:fx-flood-tx', 'nws:fx-tornado-ok', 'usgs:fx-gen-12', 'usgs:fx-gen-24', 'usgs:fx-gen-36', 'usgs:fx-gen-48', 'usgs:fx-m62', 'usgs:fx-m71', 'usgs:us7000tyca']);
  /* digest rows: a 1-degree fire area by its summed radiative power, a perimeter by its acres */
  assert.equal(P.significanceOfDigest('fire_cell', { frp_sum_mw: 500 }), true);
  assert.equal(P.significanceOfDigest('fire_cell', { frp_sum_mw: 499.9 }), false);
  assert.equal(P.significanceOfDigest('perimeter', { gis_acres: 10000 }), true);
  assert.equal(P.significanceOfDigest('perimeter', { gis_acres: 9999 }), false);
  assert.equal(P.significanceOfDigest('perimeter', { gis_acres: null }), false, 'a missing number is never a big number');
  assert.equal(P.significanceOfDigest('station', { value_m: 9 }), false);
  assert.doesNotMatch(read('js/world-environment-posts.js'), /Date\.now|new Date\(\)/, 'no function reads the clock: the page passes now');
});

test('agoLabel follows the feed\'s own rules (js/mnet.js timeAgo): now, minutes, hours, days, then a short date', () => {
  const at = (ms) => new Date(NOW - ms).toISOString();
  assert.equal(P.agoLabel(at(30e3), NOW), 'now');
  assert.equal(P.agoLabel(at(59e3), NOW), 'now');
  assert.equal(P.agoLabel(at(5 * 60e3), NOW), '5m');
  assert.equal(P.agoLabel(at(59 * 60e3 + 59e3), NOW), '59m');
  assert.equal(P.agoLabel(at(3 * 3600e3), NOW), '3h');
  assert.equal(P.agoLabel(at(2 * 86400e3), NOW), '2d');
  assert.equal(P.agoLabel(at(6 * 86400e3 + 3600e3), NOW), '6d');
  const old = at(10 * 86400e3);
  assert.equal(P.agoLabel(old, NOW), new Date(old).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: undefined }), 'this year: month and day');
  const lastYear = '2025-03-02T12:00:00Z';
  assert.equal(P.agoLabel(lastYear, NOW), new Date(lastYear).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), 'another year names it');
  assert.equal(P.agoLabel(new Date(NOW + 60e3).toISOString(), NOW), 'now', 'a time just ahead of the clock is now, never negative');
  assert.equal(P.agoLabel('not a time', NOW), '');
  assert.equal(P.agoLabel(null, NOW), '');
  /* the same rules the page uses, read from its source */
  const src = read('js/mnet.js');
  assert.match(src, /if \(sec < 60\) return "now";/); assert.match(src, /if \(min < 60\) return min \+ "m";/); assert.match(src, /if \(hr < 24\) return hr \+ "h";/); assert.match(src, /if \(day < 7\) return day \+ "d";/);
});

test('stamp: the recorded time, else the retrieval time labelled as such, else "not supplied"; a fetch time never stands in the recorded slot', () => {
  const quake = row('usgs:us7000tyhr'), recorded = P.stamp(quake, NOW);
  assert.equal(recorded.kind, 'recorded');
  assert.equal(recorded.iso, quake.observed_at);
  assert.equal(recorded.local, new Date(quake.observed_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  assert.equal(recorded.ago, P.agoLabel(quake.observed_at, NOW));
  assert.equal(recorded.text, 'Recorded ' + recorded.local + ' · ' + recorded.ago);
  assert.equal(recorded.sort_key, quake.observed_at);
  const storm = row('nhc:fx-al19'), retrieved = P.stamp(storm, NOW);
  assert.equal(storm.observed_at, null, 'the fixture\'s NHC row has no observation time, as the provider gives none');
  assert.equal(retrieved.kind, 'retrieved');
  assert.equal(retrieved.iso, new Date(storm.fetched_at).toISOString());
  assert.equal(retrieved.text, 'Retrieved ' + retrieved.local + ' · ' + retrieved.ago + ' · source gives no event time');
  assert.match(retrieved.text, /^Retrieved /, 'the retrieval time is labelled, never shown as the recorded time');
  assert.equal(retrieved.sort_key, retrieved.iso);
  const none = P.stamp({ id: 'x:1' }, NOW);
  assert.deepEqual(none, { kind: 'none', iso: null, local: '', ago: '', text: 'Time not supplied by provider', sort_key: '' });
  assert.equal(P.stamp({ observed_at: 'yesterday', fetched_at: 'bad' }, NOW).kind, 'none', 'an unreadable time is no time');
  assert.equal(P.stamp({ observed_at: 'bad', fetched_at: '2026-11-17T20:05:00Z' }, NOW).kind, 'retrieved');
  assert.ok(P.stamp({ observed_at: '2026-11-17T20:00:00Z' }, NOW).sort_key > none.sort_key, 'a dated stamp sorts before an undated one');
});

test('observationPosts: one post per event id by the Environmental desk, typed, stamped, with the source\'s coverage and status', () => {
  const posts = P.observationPosts(detail(), NOW);
  assert.equal(posts.length, FEED.events.length, 'every event once, the unplaced ones too');
  assert.equal(new Set(posts.map((p) => p.id)).size, posts.length);
  for (const p of posts) {
    assert.equal(p.observationPost, true); assert.equal(p.author, 'Environmental desk'); assert.equal(p.type, 'Environmental observation');
    assert.ok(['quake', 'alert', 'fire', 'storm', 'volcano', 'water', 'other'].includes(p.icon), p.icon);
    assert.ok(p.title && p.title.length <= 160); assert.ok(Array.isArray(p.facts) && p.facts.length <= 16);
    assert.ok(typeof p.coverage === 'string' && p.coverage); assert.ok(['available', 'stale', 'unavailable'].includes(p.status), p.status);
    assert.equal(p.sort_key, p.stamp.sort_key); assert.match(p.hash, /^[0-9a-f]{8}$/);
    assert.equal(typeof p.significant, 'boolean');
    for (const s of [p.title, p.coverage, p.stamp.text, ...p.facts.flatMap((f) => [f.label, f.value])]) assert.doesNotMatch(s, /<|&lt;|&amp;/, 'plain words, no markup: the page escapes');
  }
  const quake = posts.find((p) => p.id === 'usgs:us7000tyhr');
  assert.equal(quake.title, 'M5.4 · 20 km NW of Anamizu, Japan'); assert.equal(quake.icon, 'quake'); assert.equal(quake.kind, 'quake');
  assert.deepEqual(quake.facts, [{ label: 'Magnitude', value: '5.4' }, { label: 'Depth', value: '273.6 km' }]);
  assert.deepEqual(quake.source, { label: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000tyhr' });
  assert.equal(quake.coverage, 'Global earthquakes reported in the past day'); assert.equal(quake.status, 'available'); assert.equal(quake.reason, null);
  assert.equal(quake.stamp.kind, 'recorded'); assert.equal(quake.lat, 37.3664); assert.equal(quake.lon, 136.7444); assert.equal(quake.globe_id, 'usgs:us7000tyhr');
  const alert = posts.find((p) => p.id === 'nws:fx-flood-az');
  assert.equal(alert.title, 'Flood Warning · Maricopa, AZ; Yuma, AZ'); assert.equal(alert.icon, 'alert');
  const zone = posts.find((p) => p.id === 'nws:fx-heat-ca');
  assert.equal(zone.lat, null); assert.equal(zone.lon, null, 'a zone-only alert keeps no point: the page offers no Show on globe');
  const stale = posts.find((p) => p.id === 'eonet:EONET_fx_fire_1');
  assert.equal(stale.status, 'stale'); assert.equal(stale.reason, 'upstream_error'); assert.equal(stale.icon, 'fire'); assert.equal(stale.title, 'Fixture Ridge Fire, Montana');
  assert.equal(posts.find((p) => p.id === 'eonet:EONET_fx_storm_1').icon, 'storm'); assert.equal(posts.find((p) => p.id === 'eonet:EONET_fx_volcano_1').icon, 'volcano'); assert.equal(posts.find((p) => p.id === 'eonet:EONET_fx_ice_1').icon, 'water');
  const storm = posts.find((p) => p.id === 'nhc:fx-al19');
  assert.equal(storm.title, 'Tropical Storm Sara · TS'); assert.equal(storm.icon, 'storm'); assert.equal(storm.stamp.kind, 'retrieved'); assert.equal(storm.significant, true);
  /* the hash follows the content, not the clock */
  const later = P.observationPosts(detail(), NOW + 3600e3), recent = posts.find((p) => p.id === 'usgs:fx-m45');
  assert.equal(later.find((p) => p.id === 'usgs:us7000tyhr').hash, quake.hash, 'an hour later, the same content hashes the same');
  assert.equal(recent.stamp.ago, '1h'); assert.equal(later.find((p) => p.id === 'usgs:fx-m45').stamp.ago, '2h', 'while the "ago" moved on');
  assert.equal(later.find((p) => p.id === 'usgs:fx-m45').hash, recent.hash);
  const changed = P.observationPosts(detail({ events: FEED.events.map((e) => e.id === 'usgs:us7000tyhr' ? { ...e, facts: [{ label: 'Magnitude', value: '5.5' }, e.facts[1]] } : e) }), NOW);
  assert.notEqual(changed.find((p) => p.id === 'usgs:us7000tyhr').hash, quake.hash, 'a revised magnitude is a change');
  assert.equal(changed.find((p) => p.id === 'usgs:us7000tyhr').significant, true);
  /* an id that left the feed has no post */
  assert.equal(P.observationPosts(detail({ events: FEED.events.filter((e) => e.id !== 'usgs:us7000tyhr') }), NOW).some((p) => p.id === 'usgs:us7000tyhr'), false);
  /* while the module is unavailable there are none, whatever else the detail carries */
  assert.deepEqual(P.observationPosts(detail({ unavailable: true, code: 'module_policy_unavailable' }), NOW), []);
  assert.deepEqual(P.observationPosts(null, NOW), []);
  /* hostile rows: clipped, deduplicated, never a link that is not https */
  const hostile = P.observationPosts(detail({ events: [{ id: 'usgs:h', title: 'x'.repeat(500), lat: 1, lon: 2, category: 'quake', facts: [{ label: 'Magnitude', value: '<b>9</b>' }], source: { label: 'y'.repeat(300), url: 'javascript:alert(1)' } }, { id: 'usgs:h', title: 'twice' }, { id: 7 }, null] }), NOW);
  assert.equal(hostile.length, 1); assert.ok(hostile[0].title.length <= 160); assert.ok(hostile[0].source.label.length <= 120); assert.equal(hostile[0].source.url, '');
  assert.equal(hostile[0].facts[0].value, '<b>9</b>', 'the words stay words: escaping is the page\'s job at paint time');
});

test('fires are summarised per 1-degree area, never one post per detection; perimeters post with their acres and dates', () => {
  const layers = {
    fires: { status: 'available', fetched_at: '2026-11-17T20:00:30Z', generated_at: '2026-11-17T20:00:00Z', cell_degrees: 1, label: 'NASA FIRMS VIIRS NOAA-20', url: 'https://firms.modaps.eosdis.nasa.gov/', attribution: 'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)', license: 'NASA data, CC0 1.0 (U.S. public domain)', coverage: 'Global VIIRS active-fire detections from NOAA-20 in the 24 hours before retrieval',
      cells: [[-119, 34, 220, 1830.4, 212.5, '2026-11-17T19:30:00Z'], [-63, -10, 180, 420.2, 96.1, '2026-11-17T18:00:00Z'], [95, 61, 80, 0, null, null]] },
    perimeters: { status: 'available', fetched_at: '2026-11-17T20:01:00Z', label: 'NIFC WFIGS perimeters', url: 'https://data-nifc.opendata.arcgis.com/', attribution: 'National Interagency Fire Center, WFIGS Interagency Fire Perimeters (current)', license: 'U.S. federal data with no named licence, provided as is under the NIFC disclaimer',
      top: [{ id: 'wfigs:2026-CAXXX-000001', name: 'Fixture Ridge', gis_acres: 45210.5, polygon_captured_at: '2026-11-17T06:10:00Z', last_edited_at: '2026-11-17T07:00:00Z', discovered_at: '2026-11-15T20:00:00Z', lon: -118.9, lat: 34.6 }, { id: 'wfigs:2026-CAXXX-000002', name: 'Pine Flat', gis_acres: null, polygon_captured_at: null, last_edited_at: null, discovered_at: null, lon: -120.1, lat: 36.2 }] },
    alerts: { status: 'available', counts: { polygon: 70, zone_only: 25, rejected: 5 } }
  };
  const posts = P.observationPosts(detail({ events: [], layers }), NOW);
  const cells = posts.filter((p) => p.kind === 'fire_cell'), rims = posts.filter((p) => p.kind === 'perimeter');
  assert.equal(cells.length, 2, 'one post per area with any radiative power, none for the area that reported none, never one per detection');
  assert.equal(cells[0].id, 'firecell:-119:34'); assert.equal(cells[0].globe_id, 'cell:-119:34');
  assert.equal(cells[0].title, 'Fire detections · 1° area at 34°, -119° (south-west corner)');
  assert.deepEqual(cells[0].facts.map((f) => f.label), ['Detections', 'Summed radiative power', 'Peak radiative power', 'Latest overpass', 'Sensor']);
  assert.equal(cells[0].facts[0].value, '220'); assert.equal(cells[0].facts[1].value, '1830.4 MW'); assert.equal(cells[0].facts[2].value, '212.5 MW'); assert.equal(cells[0].facts[4].value, 'VIIRS NOAA-20/21');
  assert.equal(cells[0].stamp.kind, 'recorded'); assert.equal(cells[0].stamp.iso, '2026-11-17T19:30:00.000Z'); assert.equal(cells[0].icon, 'fire');
  assert.equal(cells[0].significant, true, '1,830 MW summed'); assert.equal(cells[1].significant, false, '420 MW summed');
  assert.equal(cells[0].lat, 34); assert.equal(cells[0].lon, -119);
  assert.equal(cells[0].source.label, 'NASA FIRMS VIIRS NOAA-20'); assert.equal(cells[0].source.url, 'https://firms.modaps.eosdis.nasa.gov/'); assert.equal(cells[0].coverage, layers.fires.coverage);
  assert.equal(rims.length, 2);
  assert.equal(rims[0].id, 'wfigs:2026-CAXXX-000001'); assert.equal(rims[0].globe_id, 'wfigs:2026-CAXXX-000001'); assert.equal(rims[0].title, 'Fixture Ridge fire perimeter');
  assert.deepEqual(rims[0].facts.map((f) => f.label), ['GIS acres', 'Captured', 'Last edited', 'Discovered']);
  assert.equal(rims[0].facts[0].value, (45210.5).toLocaleString()); assert.equal(rims[0].stamp.kind, 'recorded'); assert.equal(rims[0].stamp.iso, '2026-11-17T06:10:00.000Z');
  assert.equal(rims[0].significant, true); assert.equal(rims[1].significant, false);
  assert.equal(rims[1].facts[0].value, 'not supplied'); assert.equal(rims[1].stamp.kind, 'retrieved', 'no capture time: the retrieval time, labelled');
  assert.equal(rims[0].lat, 34.6); assert.equal(rims[0].lon, -118.9);
  assert.equal(posts.some((p) => /zone/i.test(p.title)), false, 'alert counts are a digest for the panel, never posts');
  assert.deepEqual(P.observationPosts(detail({ events: [], layers: { fires: { status: 'unavailable', cells: 'nope' } } }), NOW), [], 'a malformed digest yields nothing');
});

test('interleaveByTime: missions and observations in one list, newest first, undated last in their own order, each once, a page at a time', () => {
  const M = (n, created_at) => ({ missionPost: true, id: `0e1f0000-0000-4000-8000-${String(n).padStart(12, '0')}`, title: 'Mission ' + n, created_at });
  const O = (id, sort_key) => ({ observationPost: true, id, sort_key });
  const out = P.interleaveByTime([M(1, '2026-11-17T10:00:00Z'), M(2, ''), M(3, '2026-11-17T18:00:00Z')], [O('usgs:a', '2026-11-17T12:00:00Z'), O('nhc:b', ''), O('usgs:a', '2026-11-17T12:00:00Z'), O('usgs:c', '2026-11-17T19:00:00Z')]);
  assert.deepEqual(out.map((x) => x.missionPost ? 'm' + x.id.slice(-1) : x.id), ['usgs:c', 'm3', 'usgs:a', 'm1', 'm2', 'nhc:b'], 'by time, then the undated in input order (mission first, as given)');
  assert.equal(P.interleaveByTime([M(1, '2026-11-17T10:00:00Z')], [O('usgs:a', '2026-11-17T12:00:00Z'), O('usgs:b', '2026-11-17T11:00:00Z')], { pageSize: 2 }).length, 2, 'sliced to the page');
  assert.deepEqual(P.interleaveByTime(null, null), []);
  assert.deepEqual(P.interleaveByTime([M(1, 'x')], 'no').map((m) => m.id.slice(-1)), ['1']);
});

test('withObservations: in Global one significant observation after every six other items, each once, never padding a short feed', () => {
  assert.equal(P.EVERY_OBS, 6);
  const others = Array.from({ length: 14 }, (_, k) => ({ other: k + 1 }));
  const obs = [{ observationPost: true, id: 'a', significant: true }, { observationPost: true, id: 'b', significant: false }, { observationPost: true, id: 'c', significant: true }, { observationPost: true, id: 'a', significant: true }, { observationPost: true, id: 'd', significant: true }];
  const out = P.withObservations(others, obs);
  assert.deepEqual(out.map((x) => x.observationPost ? x.id : 'o' + x.other), ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'a', 'o7', 'o8', 'o9', 'o10', 'o11', 'o12', 'c', 'o13', 'o14'], 'after the sixth and the twelfth; b is not significant; a once; d waits for more items');
  assert.equal(P.withObservations([{ other: 1 }, { other: 2 }], obs).length, 2, 'two items carry no observation: at most one per six, never a tail of observations');
  assert.equal(P.withObservations(others, []).length, 14);
  assert.deepEqual(P.withObservations(null, obs), []);
  assert.equal(P.withObservations(others, obs, { every: 3 }).filter((x) => x.observationPost).length, 3, 'the ratio is a parameter');
});

test('the module is a UMD like js/world-mission-posts.js and names its author, type and icons without the brand', () => {
  const src = read('js/world-environment-posts.js');
  assert.match(src, /module\.exports = api/); assert.match(src, /root\.MCC_ENVIRONMENT_POSTS = api/);
  assert.equal(P.AUTHOR, 'Environmental desk'); assert.equal(P.TYPE, 'Environmental observation');
  assert.doesNotMatch(src, /equity-uprise-mark|\.png|\.webp|<img/i, 'never the logo');
  for (const p of P.observationPosts(detail(), NOW)) assert.doesNotMatch(JSON.stringify([p.author, p.type, p.title, p.facts, p.source.label]), /Equity Uprise|Human Uprise/, 'the posts never write the brand out: a plain system author');
  for (const k of ['significance', 'significanceOfDigest', 'stamp', 'agoLabel', 'observationPosts', 'interleaveByTime', 'withObservations', 'iconFor', 'titleFor', 'factsFor', 'contentHash']) assert.equal(typeof P[k], 'function', k);
  assert.equal(P.iconFor({ id: 'usgs:x' }), 'quake'); assert.equal(P.iconFor({ id: 'nws:x' }), 'alert'); assert.equal(P.iconFor({ id: 'eonet:x', category: 'flood' }), 'water'); assert.equal(P.iconFor({ id: 'eonet:x', category: 'dust' }), 'other'); assert.equal(P.iconFor({ id: 'nhc:x' }), 'storm');
  assert.equal(P.titleFor({ id: 'usgs:x', title: 'Somewhere', facts: [] }), 'Somewhere', 'a quake without a magnitude keeps its place name');
  assert.equal(P.titleFor({ id: 'nws:x', title: 'Flood Warning issued …', facts: [{ label: 'Area', value: 'Here' }] }), 'Flood Warning · Here');
  assert.equal(P.titleFor({ id: 'nws:x', title: 'Some headline', facts: [] }), 'Some headline');
  assert.equal(P.contentHash({ title: 'a' }), P.contentHash({ title: 'a' })); assert.notEqual(P.contentHash({ title: 'a' }), P.contentHash({ title: 'b' }));
});

/* G1R-7, the page's side: js/mnet.js's mcc:world-environment-events listener, sliced out of the page as it ships and run with a
   captured listener, the page's state and the real posts module. A detail that changed no post's words (the panel re-handing the
   same feed, the tour re-selecting a quake) repaints nothing; a changed word, a changed significance or the gate refusing does. */
test('G1R-7: the page repaints the feed only when an observation post changed, never for the same words again', () => {
  const js = read('js/mnet.js');
  const from = js.indexOf('  /* the observation posts\' words as one ordered line');
  const to = js.indexOf('  /* a post by the system: where a post names its author');
  assert.ok(from > 0 && to > from, 'js/mnet.js still has the listener and its signature');
  const listeners = {}, draws = [];
  const state = { environment: { posts: {}, order: [], unavailable: false, code: null }, feedAnswered: true, loadingFeed: false };
  const window = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  new Function('window', 'state', 'ENV_POSTS', 'renderFeed', from === -1 ? '' : js.slice(from, to))(window, state, P, (append) => draws.push(append));
  const fire = (d) => listeners['mcc:world-environment-events']({ detail: d });
  assert.equal(typeof listeners['mcc:world-environment-events'], 'function');
  fire(detail());
  assert.equal(draws.length, 1, 'the first posts are painted');
  assert.equal(state.environment.order.length, FEED.events.length);
  fire(detail());
  fire(detail({ checked_at: '2026-11-17T20:10:30Z' }));
  assert.equal(draws.length, 1, 'the same words again repaint nothing');
  /* a word that changed: the quake's magnitude was revised (still below the significance line) */
  const revised = FEED.events.map((e) => e.id === 'usgs:us7000tyhr' ? { ...e, facts: [{ label: 'Magnitude', value: '5.3' }, { label: 'Depth', value: '273.6 km' }] } : e);
  fire(detail({ events: revised }));
  assert.equal(draws.length, 2, 'a revised post repaints');
  assert.ok(state.environment.posts['usgs:us7000tyhr'].updated_at > 0, 'and says it was updated');
  fire(detail({ events: revised }));
  assert.equal(draws.length, 2);
  /* significance alone (a ShakeMap found for the quake) changes where the post rides in Global: that repaints */
  assert.equal(state.environment.posts['usgs:us7000tyhr'].significant, false);
  fire(detail({ events: revised.map((e) => e.id === 'usgs:us7000tyhr' ? { ...e, shakemap_available: true } : e) }));
  assert.equal(state.environment.posts['usgs:us7000tyhr'].significant, true);
  assert.equal(draws.length, 3);
  /* the gate refuses: the posts go, and that is painted once */
  fire({ events: [], sources: [], unavailable: true, code: 'module_policy_unavailable' });
  fire({ events: [], sources: [], unavailable: true, code: 'module_policy_unavailable' });
  assert.equal(draws.length, 4); assert.deepEqual(state.environment.order, []);
});
