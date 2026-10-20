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
  assert.match(fnSource(js, 'bindNewsActions'), /tellWorld\(\{ type: "hu:focus-place", lat: lat, lon: lon, label: label \}\);/);
  assert.match(fnSource(js, 'bindNewsActions'), /MCC_WORLD_NEWS_READER\.open\(story, b\)/, 'legacy feed opens the shared first-party reader');
  assert.match(fnSource(js, 'bindNewsActions'), /mentioned in this story/, 'the place is mentioned, never "where it happened"');
  /* the clean-up, run: only absolute http(s) links, and a place only when both numbers are real and in range */
  const clean = new Function('location', 'URL', fnSource(js, 'safeHttpUrl') + '\n' + fnSource(js, 'cleanNews') + '\nreturn cleanNews;')({ origin: 'https://mccluster.org' }, URL);
  const ok = clean({ id: 'a', title: '  A  headline ', url: 'https://www.publisher.example/x', domain: '', seen_at: '2026-10-15T22:00:00.000Z', place: 'Nairobi, Kenya', lat: -1.28, lon: 36.81 });
  assert.deepEqual(ok, { news: true, id: 'a', title: 'A headline', url: 'https://www.publisher.example/x', domain: 'publisher.example', seen_at: '2026-10-15T22:00:00.000Z', place: 'Nairobi, Kenya', lat: -1.28, lon: 36.81 });
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
  const render = fnSource(js, 'renderFeed');
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

test('Local matches a story to the picked country by its tail, by name or alias, never by substring', async () => {
  const js = await read('js/mnet.js');
  const inCountry = new Function(fnSource(js, 'placeInCountry') + '\nreturn placeInCountry;')();
  assert.equal(inCountry('Nairobi, Nairobi Area, Kenya', { code:'KE', name:'Kenya' }), true);
  assert.equal(inCountry('New Haven, Connecticut, United States', { code:'US', name:'United States of America' }), true, 'the globe says United States of America, publishers say United States');
  assert.equal(inCountry('Port Moresby, National Capital, Papua New Guinea', { code:'GN', name:'Guinea' }), false, 'Guinea is not Papua New Guinea');
  assert.equal(inCountry('Lagos, Lagos, Nigeria', { code:'NE', name:'Niger' }), false, 'Niger is not Nigeria');
  assert.equal(inCountry('Seoul, Seoul-teukbyeolsi, Korea, South', { code:'KR', name:'South Korea' }), true, 'a comma inside the publisher name still matches');
  assert.equal(inCountry('Kenya', { name:'Kenya' }), true, 'a country-level label matches on its own');
  assert.equal(inCountry('', { name:'Kenya' }), false);
  assert.equal(inCountry('Nairobi, Nairobi Area, Kenya', null), false);
});
