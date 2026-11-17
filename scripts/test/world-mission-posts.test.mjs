/* MISSIONS AS POSTS IN THE WORLD FEED (owner, 2026-11-17: "having the missions as like just another post in the newsfeed, not a
   big, large post, just the same size post as all the other [posts]"; "when you click on America, you should be able to say, see
   X amount of news, X amount of missions"). docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md, targets 3, 5, 6 and 9.

   The pure parts in js/world-mission-posts.js, run on fixtures: the interleave, a place's missions and their count, the credit
   and its links, what the page accepts from the database, and the share link. Then the globe's side (js/world-countries.js,
   missionIdsIn) and the page's wiring, read from the source. The behaviour in a browser is
   scripts/e2e/world-missions-guest.e2e.mjs.
     node --test scripts/test/world-mission-posts.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const req = createRequire(import.meta.url);
const P = req(ROOT + 'js/world-mission-posts.js');
const C = req(ROOT + 'js/world-countries.js');

const id = (n) => `0e1f0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M = (n, extra = {}) => ({ missionPost: true, id: id(n), title: 'Mission ' + n, ...extra });
const O = (n) => ({ other: n });
const order = (list) => list.map((x) => (x.missionPost ? 'm' + x.id.slice(-2).replace(/^0/, '') : 'o' + x.other)).join(' ');

test('Everything: one mission after every three other items, each once, then the rest up to the page size', () => {
  assert.equal(P.EVERY, 3);
  assert.equal(P.PAGE, 20);
  const others = Array.from({ length: 7 }, (_, k) => O(k + 1)), missions = [M(1), M(2), M(3)];
  assert.equal(order(P.interleave(others, missions)), 'o1 o2 o3 m1 o4 o5 o6 m2 o7 m3', 'every third, then the last one carries on');
  /* a long feed: never more than one mission per three other items, and each mission only once */
  const many = Array.from({ length: 30 }, (_, k) => O(k + 1)), out = P.interleave(many, [M(1), M(2), M(3), M(1), M(2)]);
  assert.equal(out.filter((x) => x.missionPost).length, 3, 'a mission listed twice is drawn once');
  let run = 0;
  for (const x of out) { if (x.missionPost) { assert.equal(run, 3, 'three other items before each mission'); run = 0; } else run++; }
  /* the other items run out: the missions carry on until the list holds a page */
  const tail = P.interleave([O(1), O(2)], Array.from({ length: 30 }, (_, k) => M(k + 1)));
  assert.equal(tail.length, 20, 'up to the page size');
  assert.equal(order(tail.slice(0, 4)), 'o1 o2 m1 m2');
  assert.equal(P.interleave([], [M(1), M(2)]).length, 2, 'missions alone, when nothing else is there');
  assert.equal(P.interleave(many, []).length, 30, 'no missions: the feed as it was');
  assert.equal(order(P.interleave([O(1), O(2), O(3), O(4)], [M(1)], { every: 2, pageSize: 3 })), 'o1 o2 m1 o3 o4', 'the ratio and the page are parameters');
  assert.deepEqual(P.interleave(null, null), []);
});

test('newest first: the server order is checked, a dateless mission keeps its place after the dated ones, the same mission once', () => {
  const rows = [M(1, { created_at: '2026-11-01T00:00:00Z' }), M(2, { created_at: '' }), M(3, { created_at: '2026-11-17T00:00:00Z' }), M(1, { created_at: '2026-11-20T00:00:00Z' }), M(4)];
  assert.deepEqual(P.newestFirst(rows).map((m) => m.id.slice(-1)), ['3', '1', '2', '4']);
  assert.deepEqual(P.newestFirst('no'), []);
});

test('a place\'s missions: the ones pinned in it and the ones pinned nowhere; a count is never a made-up zero', () => {
  const open = [M(1), M(2), M(3), M(4)];
  /* 1 is pinned in the United States, 2 in Brazil, 3 and 4 nowhere (they can be done anywhere) */
  const pins = { [id(1)]: true, [id(2)]: true };
  assert.deepEqual(P.placeMissions(open, pins, [id(1)]).map((m) => m.id), [id(1), id(3), id(4)], 'the US: its pin and the anywhere ones, in order');
  assert.deepEqual(P.placeMissions(open, pins, [id(2)]).map((m) => m.id), [id(2), id(3), id(4)]);
  assert.deepEqual(P.placeMissions(open, pins, []).map((m) => m.id), [id(3), id(4)], 'a country with no pin: the anywhere missions');
  assert.deepEqual(P.placeMissions(open, new Set([id(1)]), new Set([id(1)])).length, 4, 'a Set does as well as a map');
  assert.equal(P.missionCount(open, pins, [id(1)]), 3);
  assert.equal(P.missionCount(open, {}, undefined), 4, 'no pin anywhere: every mission can be done here, whatever the globe said');
  assert.equal(P.missionCount(open, pins, undefined), null, 'pins exist but the globe did not say which are here: unknown');
  assert.equal(P.missionCount(null, pins, []), null, 'the missions have not loaded: unknown');
  assert.equal(P.missionCount(open, null, []), null, 'the pins have not loaded: unknown');
  assert.equal(P.missionCount([], {}, []), 0, 'a real zero when nothing is open');
});

test('the globe says which missions are pinned in a country, or inside a picked state\'s shape', () => {
  /* a square "country" XX with a state in its west half; a mission pinned in each half, one carrying its own country code */
  const sq = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
  const country = { properties: { a2: 'XX', bbox: [0, 0, 10, 10] }, geometry: { type: 'Polygon', coordinates: sq(0, 0, 10, 10) } };
  const westState = { properties: { key: 'XX-W', bbox: [0, 0, 5, 10] }, geometry: { type: 'Polygon', coordinates: sq(0, 0, 5, 10) } };
  const pins = [
    { mission_id: id(1), latitude: 5, longitude: 2 },
    { mission_id: id(2), latitude: 5, longitude: 8 },
    { mission_id: id(2), latitude: 6, longitude: 8 },
    { mission_id: id(3), latitude: 50, longitude: 50, country_code: 'XX' },
    { mission_id: id(4), latitude: 50, longitude: 50 }
  ];
  assert.deepEqual(C.missionIdsIn(pins, [], [country], 'XX'), [id(1), id(2), id(3)], 'the country: by its shape, or by the row\'s own code; each once');
  assert.deepEqual(C.missionIdsIn(pins, [], [country], 'XX', westState), [id(1)], 'a state: only the pins whose own point is inside its shape');
  assert.deepEqual(C.missionIdsIn(pins, [], [country], null), [], 'no country, no missions');
  assert.equal(C.missionIdsIn(pins, [], [country], 'XX').length, C.missionCounts(pins, [], [country]).XX, 'the same missions the card counts');
  const src = read('js/world-countries.js');
  assert.match(src, /missionIds: missionIdsIn\(o\.missions \? o\.missions\(\) : \[\], o\.regions \? o\.regions\(\) : \[\], st\.features, f\.properties\.a2, sf\)/, 'the selection the page is told carries them');
});

test('the credit: shown in full with each address a link, the sentence\'s own punctuation left out of every address', () => {
  const credit = 'Solution summary from Project Drawdown (https://drawdown.org/explorer/deploy-alternative-insulation-materials), used with permission; assessment "Deploy Alternative Insulation Materials- Solution Assessment Spreadsheet" by Sarah Gleeson, https://doi.org/10.5281/zenodo.21231150, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Adapted: the mission wording is original.';
  const parts = P.parseCredit(credit);
  assert.deepEqual(parts.filter((p) => p.url).map((p) => p.url), ['https://drawdown.org/explorer/deploy-alternative-insulation-materials', 'https://doi.org/10.5281/zenodo.21231150', 'https://creativecommons.org/licenses/by/4.0/']);
  assert.equal(parts.map((p) => p.url || p.text).join(''), credit, 'nothing is lost or added: the words and the addresses make the line again');
  assert.deepEqual(P.parseCredit('see https://doi.org/10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0.').filter((p) => p.url).map((p) => p.url), ['https://doi.org/10.1002/(SICI)1097-4571(199806)49:8'], 'brackets an address opened stay with it');
  assert.deepEqual(P.parseCredit('no links here'), [{ text: 'no links here' }]);
  assert.deepEqual(P.parseCredit(null), []);
  assert.deepEqual(P.parseCredit('javascript:alert(1) data:text/html,x').filter((p) => p.url), [], 'only http(s) addresses become links');
  /* every source, DOI and licence address the line does not already carry is added after it, once */
  const row = P.cleanDetails({ mission_id: id(1), catalog: 'drawdown', credit_line: credit, source_url: 'https://drawdown.org/explorer/deploy-alternative-insulation-materials', license_name: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/', doi: 'https://doi.org/10.5281/zenodo.21231150' });
  assert.deepEqual(P.creditLinks(row), [], 'the Drawdown credit lines carry their own links');
  assert.deepEqual(P.creditLinks(P.cleanDetails({ mission_id: id(2), credit_line: 'Written from a public guide.', source_url: 'https://example.org/guide', license_name: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/' })),
    [{ label: 'Source', url: 'https://example.org/guide' }, { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }]);
});

test('the compact source line on a post names the source, and the licence when there is one', () => {
  const drawdown = P.cleanDetails({ mission_id: id(1), catalog: 'drawdown', credit_line: 'Solution summary from Project Drawdown (https://drawdown.org/explorer/x), used with permission.', license_name: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/' });
  assert.equal(P.sourceLine(drawdown), 'Source: Project Drawdown · CC BY 4.0');
  assert.equal(P.sourceLine({ ...drawdown, license_name: '' }), 'Source: Project Drawdown');
  assert.equal(P.sourceLabel({ catalog: 'other', credit_line: 'Adapted from City Parks Department (https://parks.example/x).' }), 'City Parks Department', 'the name the credit gives');
  assert.equal(P.sourceLabel({ catalog: 'other', credit_line: 'A guide.', source_url: 'https://www.example.org/guide' }), 'example.org', 'else the source\'s host');
  assert.equal(P.sourceLine(null), '');
  assert.equal(P.sourceLine({ catalog: '', credit_line: 'Written here.', source_url: '' }), '', 'no source named: no line');
});

test('what the page accepts: an open, non-clip mission with an id and a title; details with a credit and https addresses only', () => {
  const ok = P.cleanMission({ id: id(1), title: '  Plant  a tree ', description: 'Dig.', domain: 'community', kind: 'civic', difficulty: 2, base_points: 100, discovery_category: 'explore', status: 'open', created_at: '2026-11-17T10:00:00Z' });
  assert.deepEqual(ok, { missionPost: true, id: id(1), title: 'Plant a tree', description: 'Dig.', domain: 'community', kind: 'civic', category: 'explore', difficulty: 2, points: 100, created_at: '2026-11-17T10:00:00Z' });
  assert.equal(P.cleanMission({ id: id(2), title: 'Clip the song', kind: 'clip' }), null, 'clip campaigns live in the Clips tab');
  assert.equal(P.cleanMission({ id: id(3), title: 'Draft', status: 'draft' }), null, 'never a draft');
  assert.equal(P.cleanMission({ id: 'nope', title: 'x' }), null);
  assert.equal(P.cleanMission({ id: id(4), title: '   ' }), null);
  const odd = P.cleanMission({ id: id(5), title: 'x', difficulty: 9, base_points: -3, created_at: 'soon' });
  assert.deepEqual([odd.difficulty, odd.points, odd.created_at], [null, null, '']);
  const d = P.cleanDetails({ mission_id: id(1), credit_line: ' Credit ', about: 'Their words.', about_credit: '', source_url: 'http://plain.example/x', license_name: 'CC BY 4.0', license_url: 'javascript:alert(1)', doi: 'https://evil.example/10.1/x', proof_hint: 'A photo.', safety_note: 'Stay on public land.' });
  assert.equal(d.credit_line, 'Credit');
  assert.equal(d.about, '', 'a quotation is never shown without its credit');
  assert.equal(d.source_url, '', 'https only');
  assert.equal(d.license_name + d.license_url, '', 'a licence only with its https address');
  assert.equal(d.doi, '', 'a DOI only as a doi.org address');
  assert.deepEqual([d.proof_hint, d.safety_note], ['A photo.', 'Stay on public land.']);
  assert.equal(P.cleanDetails({ mission_id: id(1), credit_line: '' }), null, 'no credit, no details');
  /* the details table is pending SQL: a 404 or PostgREST's unknown-table code means absent, anything else is a passing failure */
  assert.equal(P.detailsAbsent(404, { code: 'PGRST205' }), true);
  assert.equal(P.detailsAbsent(400, { code: 'PGRST205' }), true);
  assert.equal(P.detailsAbsent(400, { code: '42P01' }), true);
  assert.equal(P.detailsAbsent(500, { code: 'XX000' }), false);
  assert.equal(P.detailsAbsent(0, null), false);
});

test('the words of a post: kind and field where the author is, difficulty and points where the handle is, never the brand', () => {
  const m = P.cleanMission({ id: id(1), title: 'x', kind: 'civic', domain: 'mutual_aid', difficulty: 1, base_points: 10 });
  assert.equal(P.headLine(m), 'Civic mission · Mutual aid');
  assert.equal(P.metaLine(m), 'Difficulty 1 · 10 points');
  assert.equal(P.metaLine({ difficulty: null, points: 1 }), '1 point');
  assert.equal(P.metaLine({ difficulty: 3, points: 1200 }), 'Difficulty 3 · 1,200 points');
  assert.equal(P.headLine({ kind: '', domain: 'environment' }), 'Mission · Environment', 'a field the enum lacks is still said plainly');
  assert.equal(P.headLine({ kind: 'civic', domain: 'other' }), 'Civic mission');
  for (const label of [P.headLine(m), P.metaLine(m), P.kindLabel('civic'), P.kindLabel('x')]) assert.doesNotMatch(label, /equity|uprise/i);
});

test('Share is the mission\'s address on the page\'s own origin and path', () => {
  assert.equal(P.missionLink({ origin: 'https://mccluster.org', pathname: '/' }, id(1)), 'https://mccluster.org/?mission=' + id(1));
  assert.equal(P.missionLink({ origin: 'https://matthew.mccluster.org', pathname: '/mnet.html' }, id(1)), 'https://matthew.mccluster.org/mnet.html?mission=' + id(1));
  assert.equal(P.missionLink({ origin: 'https://mccluster.org', pathname: '/' }, 'x"><script>'), '', 'only a mission id');
});

test('the page wires them: one read of the open missions, the details asked once, the posts in Everything, Local and the tab', () => {
  const js = read('js/mnet.js'), html = read('mnet.html');
  const helperTag = html.indexOf('<script src="js/world-mission-posts.js'), pageTag = html.indexOf('<script src="js/mnet.js');
  assert.ok(helperTag > 0 && helperTag < pageTag, 'the helper loads before the page script');
  assert.match(js, /sbRest\("action_missions\?status=eq\.open&select=" \+ MISSION_FEED_FIELDS \+ "&order=created_at\.desc&limit=500"\)/, 'the anonymous read the page already uses, with only the columns it needs');
  assert.match(js, /var MISSION_FEED_FIELDS = "id,title,description,domain,kind,difficulty,base_points,discovery_category,created_at";/);
  assert.doesNotMatch(js.slice(js.indexOf('function loadOpenMissions'), js.indexOf('function wantMissionDetails')), /sbRpc\(/, 'no RPC: production lacks the pending ones');
  assert.match(js, /sbRest\("action_mission_details\?select=" \+ MISSION_DETAIL_FIELDS \+ "&mission_id=in\.\(" \+ chunk\.join\(","\) \+ "\)"\)/);
  assert.match(js, /if \(!MISSION_POSTS\.detailsAbsent\(e && e\.status, e && e\.data\)\) return;\s*f\.detailsAbsent = true;\s*try \{ sessionStorage\.setItem\(DETAILS_ABSENT, "1"\); \} catch \(_\) \{\}/, 'absence is remembered for the session');
  assert.match(js, /if \(!MISSION_POSTS \|\| f\.detailsAbsent \|\| !want\.length\) return Promise\.resolve\(false\);/, 'and nothing more is asked');
  assert.match(js, /drawn = withMissions\(interleaveFeed\(items, news\), feedMissions\)/, 'Everything and Local: the missions into the one stream');
  assert.match(js, /if \(scope === "local" && c && state\.world\.pinsKnown\) return MISSION_POSTS\.placeMissions\(all, state\.world\.pins, c\.missionIds \|\| \[\]\);/);
  assert.match(js, /cell\(placeMissionCount\(c\), "missions"\)/, 'the place card counts them');
  assert.match(js, /'<p class="mn__feed-note">' \+ esc\(note\) \+ '<\/p>'/, 'Local with only missions says above them that the place has no news today');
  /* the post: a post's card, never a member post (data-post-id), and its three doors */
  const post = js.slice(js.indexOf('function missionPostHtml'), js.indexOf('function bindMissionPosts'));
  assert.match(post, /<article class="mn__post-card mn__mission-post" data-mission-post="/);
  assert.doesNotMatch(post, /data-post-id|data-take-mission|data-fund-mission/);
  assert.match(post, /aria-label="Join this mission">' \+ EUP_MARKS \+ '<\/button>/, 'the emblem alone is the join, with no words beside it');
  assert.doesNotMatch(post, /Equity Uprise/i, 'the brand is never written out on a post');
  assert.match(js, /var EUP_MARKS = '<img class="mn__eup mn__eup--white" src="assets\/img\/equity-uprise-mark-white\.png" alt="" width="40" height="40">' \+\s*'<img class="mn__eup mn__eup--dark" src="assets\/img\/equity-uprise-mark\.png" alt="" width="40" height="40">';/, 'the two supplied marks, scaled only (square, as supplied), at the strip\'s size');
  assert.match(js, /if \(m\) acceptWorldMission\(\{ id: m\.id, title: m\.title \}\);/, 'Join is the one join every mission entry shares');
  assert.match(js, /openMission\(id, credit \? \{ at: "credit" \} : null\);/, 'Details and the source line open the dialog');
  /* the dialog: quotation with its credit beneath, the credit in full, links only through safeHttpUrl */
  const dialog = js.slice(js.indexOf('function missionDetailHtml'), js.indexOf('function openMission'));
  assert.match(dialog, /'<figure class="mn__mission-about"><blockquote>'\+esc\(d\.about\)\+'<\/blockquote><figcaption>'\+esc\(d\.about_credit\)\+'<\/figcaption><\/figure>'/);
  assert.match(dialog, /var safe=safeHttpUrl\(url\);/);
  assert.doesNotMatch(dialog, /innerHTML/);
});

test('the styles are mobile first: no max-width query, the clamp and the day mark', () => {
  const css = read('css/human-uprise-editorial.css'), day = read('css/daylight.css'), env = read('css/world-environment.css');
  const block = css.slice(css.indexOf('MISSIONS AS POSTS'));
  assert.doesNotMatch(block, /@media\s*\(max-width|(?<!minmax\(0, ?)\b1fr/);
  assert.match(block, /\.hu-editorial #mnFeed \.mn__mission-post \.mn__post-body \{[^}]*-webkit-line-clamp:2;/);
  assert.match(day, /html\[data-daylight="day"\] \.mn__mission-join \.mn__eup--dark \{ display:block; \}/);
  assert.match(env, /html:not\(\[data-we-feed="ready"\]\) #wePanel \{ display:none !important; \}/, 'never a broken panel for the public');
});
