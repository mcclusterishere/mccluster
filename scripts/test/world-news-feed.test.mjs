/* WORLD NEWS IN THE WORLD FEED (owner, 2026-10-15: "GDELT news as the feed … sprinkled into that. At a ratio to like
   one … from them. But like, we gotta ingest it so it's still from us.").

   The Worker ingests GDELT into #432's news store and serves it back (GET /v1/world/news). The World screen reads it,
   free for everyone: one member post to one news item in the feed, a credit to The GDELT Project whenever news shows,
   and "On the Earth" on a card turns the globe to the place the story mentions. The globe's News layer is not here: it
   joins the layers in world-layers.js with the World's layer access (#442). The behaviour is proven in a browser by
   scripts/e2e/world-screen.e2e.mjs; these pin the contract in the source, and run the feed's own interleave and
   clean-up functions on fixtures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
/* one function's source, from its declaration to its closing brace (these functions carry no braces in strings) */
function fnSource(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at !== -1, name + ' exists');
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1);
}

test('one member post to one news item, as a single named constant', async () => {
  const js = await read('js/mnet.js');
  assert.match(js, /var FEED_NEWS_PER_POST = 1, NEWS_API = "https:\/\/api\.mccluster\.org\/v1\/world\/news"/);
  assert.equal((js.match(/FEED_NEWS_PER_POST\s*=[^=]/g) || []).length, 1, 'set in one place, never reassigned');
  assert.match(fnSource(js, 'interleaveFeed'), /for \(k = 0; k < FEED_NEWS_PER_POST && n < news\.length; k\+\+\) out\.push\(news\[n\+\+\]\);/, 'the interleave reads it');
  const interleave = new Function('FEED_NEWS_PER_POST', fnSource(js, 'interleaveFeed') + '\nreturn interleaveFeed;');
  const P = (id, pinned) => ({ post_id: id, payload: pinned ? { pinned: true } : {} }), N = (id) => ({ news: true, id });
  const order = (out) => out.map((x) => x.news ? 'n' + x.id : 'p' + x.post_id).join(' ');
  const one = interleave(1);
  assert.equal(order(one([P(1), P(2), P(3)], [N(1), N(2), N(3)])), 'p1 n1 p2 n2 p3 n3', 'post, news, post, news');
  assert.equal(order(one([P(1), P(2, true), P(3)], [N(1), N(2)])), 'p2 p1 n1 p3 n2', 'a pinned post leads, then the alternation');
  assert.equal(order(one([P(1)], [N(1), N(2), N(3)])), 'p1 n1 n2 n3', 'when the posts run out the news carries on');
  assert.equal(order(one([P(1), P(2), P(3)], [N(1)])), 'p1 n1 p2 p3', 'when the news runs out the posts carry on');
  assert.equal(order(one([], [N(1), N(2)])), 'n1 n2', 'news alone, with no posts yet');
  assert.equal(order(interleave(2)([P(1), P(2)], [N(1), N(2), N(3), N(4)])), 'p1 n1 n2 p2 n3 n4', 'the constant is the ratio');
});

test('the news read is a bare public GET with no session, beside the posts, and it never breaks them', async () => {
  const js = await read('js/mnet.js');
  const fetchNews = fnSource(js, 'fetchNews');
  assert.match(fetchNews, /return fetch\(NEWS_API \+ "\?limit=20" \+ \(before \? "&before=" \+ encodeURIComponent\(before\) : ""\)\);/, 'a bare fetch: no headers, no credentials');
  assert.match(fetchNews, /^function fetchNews\(before\) \{\n    return Promise\.resolve\(\)\.then\(function \(\) \{/, 'even a cursor that cannot be encoded fails inside the promise, never out of loadFeed');
  assert.doesNotMatch(fetchNews, /api\(|MCC|authorization|access_token|session|headers/i, 'never through api(), which sends the session');
  assert.match(fetchNews, /\.catch\(function \(\) \{ return \{ ok: false, status: 0 \}; \}\);/, 'it never rejects, so a failure cannot reach the posts');
  assert.match(fetchNews, /if \(!d \|\| d\.ok !== true \|\| !Array\.isArray\(d\.items\) \|\| d\.unavailable\) return \{ ok: false, status: 0 \};/, '{} and unavailable are not a page');
  const load = fnSource(js, 'loadFeed');
  assert.match(load, /var newsFrom = reset \? undefined : state\.newsBefore, wantNews = newsFrom !== null/, 'undefined: not read yet; null: no more');
  assert.match(load, /return Promise\.all\(\[read, settled\]\)/, 'the two reads run side by side');
  assert.match(load, /var read = !reset && !state\.nextBefore \? Promise\.resolve\(null\) :/, 'Load more reads the posts only while they have another page');
  assert.doesNotMatch(load, /console\./, 'a news failure logs nothing a browser test would read as an error');
  assert.match(js, /news: \[\],\n    newsBefore: undefined,/);
  assert.match(fnSource(js, 'paintMore'), /more\.hidden = !\(state\.nextBefore \|\| \(state\.newsBefore && !\(focus && focus\.filter\)\)\);/, 'Load more while either stream has another page');
  assert.match(fnSource(js, 'applyNews'), /else if \(before && res && res\.status === 400\) state\.newsBefore = null;/, 'a refused cursor stops the news paging');
});

test('a news card is the World card keyed data-news-id: first-party reader with no outbound headline link, and the place on the Earth', async () => {
  const js = await read('js/mnet.js'), html = await read('mnet.html'), css = await read('css/mnet.css');
  const card = fnSource(js, 'newsCard');
  assert.match(card, /'<article class="mn__post-card mn__news-card" data-news-id="' \+ esc\(n\.id\) \+ '">'/);
  assert.doesNotMatch(card, /data-post-id/, 'tests and handlers key member posts on data-post-id');
  assert.match(card, /<button type="button" class="mn__news-title" data-news-open="' \+ esc\(n\.id\) \+ '">' \+ esc\(n\.title\)/);
  assert.doesNotMatch(card, /target="_blank"|href="/, 'a news headline cannot take the user to a publisher');
  assert.doesNotMatch(card, /<img|background-image|favicon|logo/i, 'no pictures and no publisher marks (CLAUDE.md rule 10)');
  assert.match(card, /data-news-place data-lat="' \+ esc\(n\.lat\) \+ '" data-lon="' \+ esc\(n\.lon\) \+ '"/);
  assert.match(card, /on the Earth">' \+ esc\(from \|\| "On the Earth"\) \+ '<\/button>'/, 'the chip names where the story is from');
  const country = new Function('navigator', fnSource(js, 'newsCountry') + '\nreturn newsCountry;')({ language: 'en' });
  assert.equal(country({ place: 'Lagos, Lagos, Nigeria' }), 'Nigeria');
  assert.equal(country({ place: 'Nairobi, Nairobi Area, Kenya', country_code: 'KE' }), 'Kenya');
  assert.equal(country({ place: '' }), '', 'no place, the chip falls back to "On the Earth"');
  assert.match(fnSource(js, 'bindNewsActions'), /tellWorld\(\{ type: "hu:focus-place", lat: lat, lon: lon, label: label, id: card \? card\.getAttribute\("data-news-id"\) : "" \}\);/, 'the story\'s id rides along, so its own pin is the one marked');
  assert.match(fnSource(js, 'bindNewsActions'), /MCC_WORLD_NEWS_READER\.open\(story, b\)/, 'legacy feed opens the shared first-party reader');
  assert.match(fnSource(js, 'bindNewsActions'), /mentioned in this story/, 'the place is mentioned, never "where it happened"');
  /* the clean-up, run: only absolute http(s) links, and a place only when both numbers are real and in range */
  const clean = new Function('location', 'URL', fnSource(js, 'safeHttpUrl') + '\n' + fnSource(js, 'cleanNews') + '\nreturn cleanNews;')({ origin: 'https://mccluster.org' }, URL);
  const ok = clean({ id: 'a', title: '  A  headline ', url: 'https://www.publisher.example/x', domain: '', seen_at: '2026-10-15T22:00:00.000Z', place: 'Nairobi, Kenya', lat: -1.28, lon: 36.81, country: 'KE' });
  assert.deepEqual(ok, { news: true, id: 'a', title: 'A headline', url: 'https://www.publisher.example/x', domain: 'publisher.example', seen_at: '2026-10-15T22:00:00.000Z', place: 'Nairobi, Kenya', lat: -1.28, lon: 36.81, country_code: 'KE' });
  /* only an ISO code is kept: the Worker never sends FIPS, and nothing else gets through */
  assert.equal(clean({ id: 'b', title: 't', url: 'https://x.example/b', country: 'Kenya' }).country_code, '');
  assert.equal(clean({ id: 'c', title: 't', url: 'https://x.example/c' }).country_code, '');
  for (const url of ['javascript:alert(1)', '/relative', 'data:text/html,x', '']) assert.equal(clean({ id: 'b', title: 't', url }), null, url + ' is refused');
  assert.equal(clean({ id: 'c', title: '', url: 'https://p.example/' }), null, 'no headline, no card');
  for (const [lat, lon] of [[91, 0], [0, 181], ['1', 2], [null, 3], [NaN, 0], [Infinity, 0]]) {
    const n = clean({ id: 'd', title: 't', url: 'https://p.example/', lat, lon });
    assert.ok(n && n.lat === null && n.lon === null, `${lat},${lon} carries no place on the Earth`);
  }
  assert.match(html, /<div class="mn__world-feed" id="mnWorldFeed" aria-label="World content" tabindex="0">/);
  assert.match(html, /Sign in to share an update and connect\./, 'the guest card explains the sign-in action');
  const news = css.slice(css.indexOf('WORLD NEWS IN THE FEED'), css.indexOf('THE SCREEN IS THE WHOLE SCREEN'));
  assert.match(news, /\.mn__news-meta > \.mn__news-domain \{[^}]*overflow: hidden; text-overflow: ellipsis;/, 'a long publisher name truncates');
  assert.match(news, /\.mn__news-title \{ display: -webkit-box; -webkit-line-clamp: 3;[^}]*overflow-wrap: anywhere;/, 'a long headline wraps and clamps');
  assert.doesNotMatch(news, /max-width\s*:\s*\d+px\)|(?<!minmax\(0, )\b1fr/, 'mobile first: no max-width queries, no bare 1fr');
});

test('the GDELT credit is one quiet line over the feed, shown whenever news is, linking to the project in a new tab', async () => {
  const js = await read('js/mnet.js'), html = await read('mnet.html');
  assert.match(html, /<p class="mn__news-credit" id="mnNewsCredit" hidden>World news from <a href="https:\/\/www\.gdeltproject\.org\/" target="_blank" rel="noopener noreferrer">The GDELT Project<\/a><\/p>\n        <div class="mn__feed" id="mnFeed"/);
  const render = fnSource(js, 'paintFeed');
  assert.match(render, /paintNewsCredit\(news\.length > 0\);/);
  assert.match(render, /var news = focus && focus\.filter \? \[\] : state\.news;/, 'a mission picked on the Earth narrows the feed to its posts: the news steps aside');
  assert.match(render, /news = news\.filter\(function \(n\) \{ return feedMatches\(n, query\); \}\);/, 'search reads the news too');
  assert.match(fnSource(js, 'feedMatches'), /if \(item && item\.news\) return \[item\.title, item\.domain, item\.place\]\.join\(" "\)/);
});

test('a news card flies the Earth to the place it mentions, and the frame checks the numbers itself', async () => {
  const globe = await read('js/action-globe.js'), js = await read('js/mnet.js');
  const focus = fnSource(globe, 'focusPlace');
  assert.match(focus, /if\(typeof lat!=='number'\|\|typeof lon!=='number'\|\|!isFinite\(lat\)\|\|!isFinite\(lon\)\|\|Math\.abs\(lat\)>90\|\|Math\.abs\(lon\)>180\)return false;/, 'numbers, finite, in range');
  assert.match(focus, /viewer\.camera\.flyTo\(\{destination:Cesium\.Cartesian3\.fromDegrees\(lon,lat,900000\),duration:1\.4\}\)/);
  const prefix = "window.addEventListener('message',", start = globe.indexOf(prefix), end = globe.indexOf(');let missions=', start);
  assert.ok(start >= 0 && end > start, 'the globe registers its parent message handler');
  const listener = globe.slice(start + prefix.length, end), parentFrame = {}, calls = [];
  const receive = new Function('parentFrame', 'location', 'viewer', 'focusPlace', 'return (' + listener + ');')(parentFrame, { origin: 'https://mccluster.org' }, {}, d => calls.push(d));
  const data = { type: 'hu:focus-place', lat: -1.28, lon: 36.81, label: 'Nairobi' };
  receive({ source: {}, origin: 'https://mccluster.org', data });
  receive({ source: parentFrame, origin: 'https://untrusted.example', data });
  assert.equal(calls.length, 0, 'a sibling frame or another origin cannot move the globe');
  receive({ source: parentFrame, origin: 'https://mccluster.org', data });
  assert.deepEqual(calls, [data], 'the same-origin parent can focus the place a story mentions');
  for (const src of [globe, js]) assert.doesNotMatch(src, /event here|events? happened|happened here/i, 'a story mentions a place; it does not put an event there');
});

test('news cards fail closed until backend capability explicitly enables comment controls', async () => {
  const js = await read('js/mnet.js');
  const card = new Function('state','esc','timeAgo','ICON','discussionHtml',
    fnSource(js, 'newsCountry') + '\n' + fnSource(js, 'newsCard') + '\nreturn newsCard;');
  const story = { id:'11111111-1111-4111-8111-111111111111',title:'A public news headline',
    domain:'publisher.example',seen_at:'2026-10-18T12:00:00Z',place:'',lat:null,lon:null };
  const esc = s => String(s);
  const args = [esc,()=>'',{comment:'COMMENT_ICON'},()=>'<section class="mn__comments">'];
  const inactive = card({newsCommentsAvailable:false},...args)(story);
  assert.doesNotMatch(inactive,/data-discussion-toggle|COMMENT_ICON|mn__comments/);
  const active = card({newsCommentsAvailable:true},...args)(story);
  assert.match(active,/data-discussion-toggle/);
  assert.match(active,/COMMENT_ICON/);
  assert.match(js,/\/v1\/world\/news\/comments-capability/);
  assert.match(js,/data\.available === true/);
});

test('Local reads the picked place\'s own news from the Worker: the stories the card counts, never a filter over the world\'s first page (owner, 2026-10-21)', async () => {
  const js = await read('js/mnet.js');
  const paint = fnSource(js, 'paintFeed'), load = fnSource(js, 'loadPlaceNews');
  assert.match(paint, /if \(pk && pn\.key !== pk\) loadPlaceNews\(true\);/, 'a newly picked place is read for itself');
  assert.match(paint, /news = pk && pn\.key === pk && !\(focus && focus\.filter\) \? pn\.items\.slice\(\) : \[\];/, 'Local shows only what was read for that place');
  assert.ok(paint.indexOf('pn.items.slice()') < paint.indexOf('if (!items.length && !news.length)'), 'before the empty check, so the country feed\'s own empty message never hides the place\'s news');
  assert.doesNotMatch(paint, /news\.filter\(function \(n\) \{ return n\.country_code/, 'no filter over the world\'s first page');
  assert.match(load, /NEWS_API \+ "\?limit=50&country=" \+ encodeURIComponent\(c\.code\) \+ \(box \? "&bbox=" \+ box\.join\(","\) : ""\)/);
  assert.match(load, /\(!pick \|\| newsInState\(onHeatGrid\(n\), pick\)\)/, 'a state keeps the stories inside its own shape, placed as the heat map counts them');
  assert.match(load, /if \(pick && p\.before && p\.items\.length < 20 && \+\+pages < 6\) return step\(p\.before\);/, 'a state reads on past its box\'s corners, a few pages at most');
  assert.match(paint, /"No news from " \+ place \+ " in the last 24 hours\."/, 'a place with none says so');
  assert.match(js, /if \(state\.feedScope === "local"\) \{ loadPlaceNews\(false\); if \(state\.placeScope\.enabled\) loadPlaceFeed\(false\); \}/, 'Load more pages the place');
  const box = new Function(fnSource(js, 'stateBox') + '\nreturn stateBox;')();
  assert.deepEqual(box({ polygons: [[[[9, 45], [11, 45], [11, 46.5], [9, 46.5], [9, 45]]]] }), [8.95, 44.95, 11.05, 46.55], 'the state\'s box, a little wider');
  assert.equal(box({ polygons: [[[[170, 60], [-170, 60], [-170, 65], [170, 65], [170, 60]]]] }), null, 'across the date line: no box, the country is read');
});

test('the pins on the Earth are the stories on the screen (owner, 2026-10-20: "I saw a post in Russia posted somewhere else on the map")', async () => {
  const js = await read('js/mnet.js'), bridge = await read('js/world-news-globe.js'), globe = await read('js/action-globe.js');
  /* the globe is sent what the feed rendered, never the whole stream behind it */
  assert.match(js, /window\.MCC_WORLD_NEWS_ITEMS = function \(\) \{ return \(state\.shownNews \|\| \[\]\)\.slice\(\); \};/);
  assert.doesNotMatch(js, /MCC_WORLD_NEWS_ITEMS = function \(\) \{ return state\.news\.slice\(\); \}/);
  const wrapper = fnSource(js, 'renderFeed'), paint = fnSource(js, 'paintFeed');
  assert.match(wrapper, /state\.shownNews = \[\];\s*try \{ return paintFeed\(append\); \}/, 'every exit of a render starts from nothing shown');
  assert.match(wrapper, /new CustomEvent\("mcc:world-news-shown"\)/);
  assert.match(paint, /state\.shownNews = news\.slice\(\);\s*host\.innerHTML =/, 'only the list that is drawn is shown');
  assert.match(bridge, /window\.addEventListener\('mcc:world-news-shown', sync\);/);
  /* no pin per story (the heat map counts them); a tapped story's place is the one pin, marked */
  assert.match(fnSource(globe, 'focusPlace'), /focusedNews=lastPlace\.id;drawWorldNewsPins\(\);/);
  assert.match(fnSource(globe, 'drawWorldNewsPins'), /publicNewsItems\.filter\(x=>focusedNews&&x\.id===focusedNews\)/);
  assert.match(fnSource(globe, 'drawWorldNewsPins'), /markNewsPin\(\);/);
});

test('a story names its country: the ISO code the Worker sends, else the place\'s last part without GDELT\'s gazetteer forms', async () => {
  const js = await read('js/mnet.js');
  const sandbox = { navigator: { language: 'en-US' }, Intl };
  const newsCountry = new Function('navigator', 'Intl', fnSource(js, 'newsCountry') + '; return newsCountry;')(sandbox.navigator, Intl);
  assert.equal(newsCountry({ country_code: 'RU', place: 'Somewhere, Else, Ukraine' }), 'Russia');
  assert.equal(newsCountry({ place: 'Nassau, New Providence, Bahamas, The' }), 'Bahamas');
  assert.equal(newsCountry({ place: 'Hanoi, Ha Noi, Vietnam, Republic Of' }), 'Vietnam');
  assert.equal(newsCountry({ place: 'Belgrade, Serbia (General), ' }), 'Serbia');
  assert.equal(newsCountry({ place: 'Serbia (General), Serbia (General)' }), 'Serbia');
  assert.equal(newsCountry({ place: 'Pacific Ocean, Oceans' }), 'Pacific Ocean');
  assert.equal(newsCountry({ place: 'Lagos, Lagos, Nigeria' }), 'Nigeria');
  assert.equal(newsCountry({ place: '' }), '');
  const clean = fnSource(js, 'cleanNews');
  assert.match(clean, /country_code: \/\^\[A-Z\]\{2\}\$\/\.test\(country\) \? country : ""/);
});

/* A STATE (owner, 2026-10-21): a double tap inside the selected country picks a state; Local keeps the stories placed in it */
test('a picked state keeps the stories placed inside its shape, and checks the shape it is given', async () => {
  const js = await read('js/mnet.js');
  const worldState = new Function(fnSource(js, 'worldState') + '\nreturn worldState;')();
  const newsInState = new Function(fnSource(js, 'newsInState') + '\nreturn newsInState;')();
  const square = [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]], hole = [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]];
  const s = worldState({ key: 'XX-1', name: ' Somewhere ', type: 'State', polygons: [[square, hole]] });
  assert.deepEqual([s.key, s.name, s.type], ['XX-1', 'Somewhere', 'State']);
  assert.equal(newsInState({ lon: 5, lat: 5 }, s), true);
  assert.equal(newsInState({ lon: 0, lat: 0 }, s), false, 'a hole (an enclave) is not the state');
  assert.equal(newsInState({ lon: 20, lat: 0 }, s), false);
  assert.equal(newsInState({ lon: null, lat: null }, s), false, 'a story with no point cannot be placed in a state');
  /* a story just inside a border whose grid point (where the heat map counted it) is outside is not the state's (Codex #590) */
  const onHeatGrid = new Function(fnSource(js, 'onHeatGrid') + '\nreturn onHeatGrid;')();
  assert.deepEqual(onHeatGrid({ lon: 10.02, lat: 36.83 }), { lon: 10, lat: 36.85 });
  const edge = worldState({ key: 'XX-2', name: 'Edge', polygons: [[[[-10, -10], [10.04, -10], [10.04, 10], [-10, 10], [-10, -10]]]] });
  assert.equal(newsInState({ lon: 10.03, lat: 5 }, edge), true);
  assert.equal(newsInState(onHeatGrid({ lon: 10.03, lat: 5 }), edge), false, 'counted at 10.05, outside');
  assert.equal(newsInState(onHeatGrid({ lon: 10.01, lat: 5 }), edge), true, 'counted at 10.00, inside');
  assert.deepEqual(onHeatGrid({ lon: null }), { lon: null, lat: null });
  assert.equal(worldState(null), null);
  assert.equal(worldState({ name: 'x', polygons: 'no' }), null);
  assert.equal(worldState({ name: 'x', polygons: [[[[0, 0], [1, 'a'], [1, 1], [0, 0]]]] }), null, 'a ring with a bad point is dropped');
  assert.equal(worldState({ name: '', polygons: [[square]] }), null);
  /* Local reads the state's stories and keeps those inside its shape */
  assert.match(fnSource(js, 'loadPlaceNews'), /var seq = \+\+p\.seq, pick = c\.state, box = pick \? stateBox\(pick\) : null/);
  /* the label leads with the state, and a state of the country already read does not read it again */
  assert.match(js, /\(tappedState \? tappedState\.name \+ ", " : ""\) \+ d\.country\.name\.slice\(0, 80\)/);
  assert.match(js, /state\.placeScope\.enabled && !\(sameCountry && state\.placeScope\.country === state\.world\.country\.code\)\) loadPlaceFeed\(true\);/);
});

test('a state picked or let go keeps the member\'s choice to place their post; another country clears it', async () => {
  const js = await read('js/mnet.js');
  assert.match(js, /if \(\$\("mnPostPlaceOptIn"\) && !sameCountry\) \$\("mnPostPlaceOptIn"\)\.checked = false;/);
  const handler = js.slice(js.indexOf('var prevCountry = state.world.country'), js.indexOf('paintFeedScope();', js.indexOf('var prevCountry = state.world.country')));
  assert.doesNotMatch(handler, /if \(\$\("mnPostPlaceOptIn"\)\) \$\("mnPostPlaceOptIn"\)\.checked = false;/, 'no unconditional reset when the globe speaks');
});
