/* THE NEWS TINT STEPS ASIDE IN THE EQUITY UPRISE TAB (release polish, 2026-11-18; review V2-M3). The World's news heat map
   ("News mentions · last 24 h": each country shaded by the stories that mention it, js/world-countries.js) stayed on in the Equity
   Uprise tab and coloured whole countries under the environmental layers, competing with them (owner, 2026-11-17: "make the visuals
   proportionate to the geographical data we are collecting"). While the feed's scope is the Equity Uprise tab the page tells the
   globe so over the existing message spine (js/world-news-globe.js: hu:world-news-pins carries tint:false), and the globe hides
   the shading and its legend while keeping the counts (a country's card still says how many stories); leaving the tab brings the
   same shading back. Run on fakes here; the real page and frame by night and by day at 390, 820 and 1280 are
   scripts/e2e/environment-world.e2e.mjs.
   CHANGED ON PURPOSE BY DECISION D9 (event timeline slice S4, 2026-11-19; default adopted pending Matthew's confirmation; owner
   direction 2026-11-19: no news on the E=UP globe): in the tab the news LAYER is off, not only its tint (on:false, tint:false): no
   heat read, no shading or legend, no story pin, and no news count on a country's card; leaving the tab brings it back. The
   assertions that pinned "the news layer itself stays on" in the tab and behind the sign-in door now pin it off (carried release
   item 6: the door's backdrop goes as quiet as the tab).
     node --test scripts/test/world-news-tint.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const ORIGIN = 'https://world.example.invalid';

/* js/world-news-globe.js in a sandbox: a frame that records what it is told, the World's mode and the feed's tab */
function newsGlobe({ scope = 'global', mode = 'posts', door = false } = {}) {
  const sent = [], listeners = {}, frame = { contentWindow: { postMessage: (data, origin) => sent.push({ data: JSON.parse(JSON.stringify(data)), origin }) } };
  const node = () => ({ id: '', className: '', textContent: '', hidden: false, setAttribute() {}, append() {}, addEventListener() {}, close() {}, showModal() {} });
  const sandbox = {
    location: { origin: ORIGIN },
    document: { getElementById: (id) => (id === 'mnWorldFrame' ? frame : null), createElement: node, body: { appendChild() {} }, documentElement: { dataset: {}, classList: { contains: (c) => door && c === 'mn-door-open' } } },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    MCC_WORLD_MODE: { get: () => mode, set() {} },
    MCC_FEED_SCOPE: { get: () => scope, set() {} },
    MCC_WORLD_NEWS_ITEMS: () => [{ id: 'n1', title: 'A story', domain: 'news.example', url: 'https://news.example/1', lat: 41.76, lon: -72.68 }],
    console
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read('js/world-news-globe.js'), sandbox, { filename: 'js/world-news-globe.js' });
  const fire = (type, e = {}) => (listeners[type] || []).forEach((fn) => fn(e));
  return {
    sent, fire,
    setScope(next) { scope = next; fire('mcc:feed-scope', { detail: { scope: next } }); },
    setMode(next) { mode = next; fire('mcc:world-mode'); },
    /* js/mnet.js showGate: html.mn-door-open, then mcc:door */
    setDoor(open) { door = open; fire('mcc:door', { detail: { open } }); },
    ready() { fire('message', { source: frame.contentWindow, origin: ORIGIN, data: { type: 'hu:globe-ready', boot: 'b1' } }); },
    last: () => sent.filter((m) => m.data.type === 'hu:world-news-pins').at(-1).data
  };
}

test('the page tells the globe to turn the news off (the layer and its tint) exactly while the feed\'s scope is the Equity Uprise tab, over the message it already sends', () => {
  const g = newsGlobe();
  assert.deepEqual(g.last(), { type: 'hu:world-news-pins', on: true, tint: true, items: [{ id: 'n1', lat: 41.76, lon: -72.68 }] }, 'Global: the news on, the tint shown');
  assert.equal(g.sent[0].origin, ORIGIN, 'same origin only');
  g.setScope('equity');
  const quiet = g.last();
  assert.equal(quiet.tint, false, 'the Equity Uprise tab: the tint steps aside');
  /* D9, on purpose: the news layer itself is off in the tab (it stayed on before slice S4) */
  assert.equal(quiet.on, false, 'D9: the news layer is off in the tab: no heat read and no news count on a country\'s card');
  assert.deepEqual(quiet.items, [], 'and no story is sent while it is off');
  /* a globe that (re)booted while the tab is open is told again, with the tint still quiet */
  const before = g.sent.length;
  g.ready();
  assert.equal(g.sent.length, before + 1);
  assert.equal(g.last().tint, false, 'hu:globe-ready while on the tab: still quiet');
  assert.equal(g.last().on, false, 'and still off');
  g.setScope('global');
  assert.equal(g.last().tint, true, 'leaving the tab brings the tint back');
  assert.deepEqual(g.last(), { type: 'hu:world-news-pins', on: true, tint: true, items: [{ id: 'n1', lat: 41.76, lon: -72.68 }] }, 'and the news layer, as it was on Global');
  g.setScope('local');
  assert.equal(g.last().tint, true, 'Local keeps the tint');
  g.setScope('news');
  assert.equal(g.last().tint, true, 'News keeps the tint');
  /* Travel turns the news off altogether, as it always did */
  g.setMode('travel');
  assert.equal(g.last().on, false);
  assert.deepEqual(g.last().items, []);
});

test('a page that lands on the Equity Uprise tab tells the globe the news is off from the first message', () => {
  const g = newsGlobe({ scope: 'equity' });
  assert.equal(g.last().tint, false);
  assert.equal(g.last().on, false, 'D9, on purpose: off from the first message (it was on before slice S4)');
});

/* js/world-countries.js mounted on a fake viewer (the shapes never arrive here, so nothing is drawn): the legend and the counts */
function countries() {
  const made = [];
  class Color { constructor(r = 1, g = 1, b = 1, a = 1) { Object.assign(this, { red: r, green: g, blue: b, alpha: a }); } withAlpha(a) { return new Color(this.red, this.green, this.blue, a); } static fromCssColorString() { return new Color(); } }
  Color.WHITE = new Color();
  const el = () => { const e = { hidden: false, id: '', className: '', style: {}, children: [], setAttribute() {}, querySelector: () => ({ style: {} }), appendChild(c) { this.children.push(c); } }; let html = ''; Object.defineProperty(e, 'innerHTML', { get: () => html, set: (v) => { html = v; } }); Object.defineProperty(e, 'textContent', { get: () => html.replace(/<[^>]+>/g, ''), set: (v) => { html = v; } }); made.push(e); return e; };
  const sandbox = {
    Cesium: { Color, Cartographic: class {}, Cartesian3: class {}, Rectangle: class {}, Material: { fromType: () => ({ uniforms: { color: new Color() } }) } },
    document: { createElement: el, body: { appendChild() {} } },
    matchMedia: () => ({ matches: false }),
    fetch: () => Promise.reject(new Error('offline in the unit test')),
    console: { warn() {}, log() {} },
    performance: { now: () => 0 }, setTimeout, clearTimeout
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.runInNewContext(read('js/world-countries.js'), sandbox, { filename: 'js/world-countries.js' });
  let legendCalls = 0;
  const viewer = { scene: { canvas: { addEventListener() {} }, requestRenderMode: false, requestRender() {}, primitives: { add: (p) => p, remove() {} }, preRender: { addEventListener() {} } } };
  const api = sandbox.HuCountries.mount(viewer, { quiet: true, onLegend: () => { legendCalls++; } });
  const legend = made.find((e) => e.id === 'heatLegend');
  return { api, legend, legendCalls: () => legendCalls };
}

test('the globe hides the news shading\'s legend while the tint is quiet, keeps the counts, and shows the same legend again after', () => {
  const { api, legend, legendCalls } = countries();
  assert.ok(legend, 'the legend exists');
  assert.match(legend.innerHTML, /News mentions · last 24 h/);
  assert.equal(typeof api.quietHeat, 'function', 'the globe can hide the tint without forgetting it');
  api.heat({ countries: { US: 6 }, total: 6, posts: {} });
  assert.equal(legend.hidden, false, 'with stories counted the legend shows');
  const calls = legendCalls();
  api.quietHeat(true);
  assert.equal(legend.hidden, true, 'quiet: the legend hides');
  assert.ok(legendCalls() > calls, 'and the frame is told to lay its corner out again');
  const s = api.state();
  assert.equal(s.heat.quiet, true);
  assert.equal(s.heat.total, 6, 'the counts stay: a country\'s card still says how many stories');
  /* a refresh of the counts while the tint is quiet keeps it quiet */
  api.heat({ countries: { US: 7, BR: 2 }, total: 9, posts: {} });
  assert.equal(legend.hidden, true, 'a new answer does not bring the legend back while the tab is open');
  assert.equal(api.state().heat.total, 9);
  api.quietHeat(false);
  assert.equal(legend.hidden, false, 'leaving the tab: the legend is back');
  assert.equal(api.state().heat.quiet, false);
  /* asking twice changes nothing */
  const again = legendCalls();
  api.quietHeat(false);
  assert.equal(legendCalls(), again);
  /* no stories at all: no legend, quiet or not */
  api.heat(null);
  api.quietHeat(true); api.quietHeat(false);
  assert.equal(legend.hidden, true, 'no shading, no legend');
});

test('the frame applies the page\'s tint flag to the countries, at mount too, and the countries hide the fill, a country\'s states and the legend while quiet', () => {
  const globe = read('js/action-globe.js'), c = read('js/world-countries.js');
  assert.match(globe, /if\(d\.type==='hu:world-news-pins'&&!ANALYTICS\)\{setWorldNewsPins\(d\.items,d\.on,d\.tint\);return\}/, 'the message carries the flag to the news pins');
  assert.match(globe, /newsTintQuiet=tint===false/, 'only an explicit false quiets the tint (an older page that never sends it keeps it)');
  assert.match(globe, /function quietNewsTint\(\)\{if\(countries&&countries\.quietHeat\)countries\.quietHeat\(newsTintQuiet\)\}/);
  assert.match(globe, /countries=HuCountries\.mount\([\s\S]*?\);quietNewsTint\(\);loadNewsHeat\(\);loadMembers\(\)\}/, 'a flag that arrived before the countries mounted is applied when they do');
  const frame = c.slice(c.indexOf('function frame()'), c.indexOf('function usAlpha()'));
  assert.match(frame, /applyHeatShow\(\);/, 'every frame keeps the shading as the flag says');
  const apply = c.slice(c.indexOf('function applyHeatShow()'), c.indexOf('function heatShown()'));
  assert.match(apply, /const on = !st\.heatQuiet && st\.lineAlpha > 0\.15;/);
  assert.match(apply, /if \(st\.heatFill\) st\.heatFill\.show = on;/);
  assert.match(apply, /if \(st\.stateHeat\) st\.stateHeat\.show = on;/);
  assert.match(apply, /const hide = st\.heatQuiet \|\| !heatShown\(\) \|\| st\.lineAlpha <= 0\.15;/);
  assert.match(c, /heat: setHeat, members: setMembers, quietHeat,/, 'the api says it');
  /* the card's news count still reads the counts, never the shading's visibility */
  assert.match(c, /const news = sp \? \(st\.stateCounts \? Number\(st\.stateCounts\[sp\.key\]\) \|\| 0 : null\) : \(st\.heat && a2 \? Number\(st\.heat\[a2\]\) \|\| 0 : null\);/);
});

/* release review RS-9 (2026-11-19): behind the sign-in door the shading's orange, gold and red competed with the card's gold and
   read as a news map. While the door is open (html.mn-door-open; js/mnet.js says so with mcc:door) the tint steps aside, and it
   comes back when the door closes, unless the tab is Equity Uprise. The browser proof is scripts/e2e/world-gate.e2e.mjs (door-art). */
test('the tint steps aside while the sign-in door is open and comes back when it closes', () => {
  const g = newsGlobe();
  assert.equal(g.last().tint, true);
  g.setDoor(true);
  assert.equal(g.last().tint, false, 'the door open: no shading behind the card');
  /* carried release item 6 with D9, on purpose: the door's backdrop goes as quiet as the tab (the news stayed on before slice S4) */
  assert.equal(g.last().on, false, 'the door open: the news layer is off behind the card, as in the Equity Uprise tab');
  g.setDoor(false);
  assert.equal(g.last().tint, true, 'the door closed: the shading is back');
  assert.equal(g.last().on, true, 'and the news layer');
  g.setScope('equity');
  g.setDoor(true); g.setDoor(false);
  assert.equal(g.last().tint, false, 'closing the door over the Equity Uprise tab leaves the tint quiet');
  assert.equal(g.last().on, false, 'and the news layer stays off');
  const landed = newsGlobe({ door: true });
  assert.equal(landed.last().tint, false, 'a page that opens with the door up says so from the first message');
  assert.equal(landed.last().on, false);
  /* Travel's own off is unchanged: the news off, the tint flag kept, so a country's card keeps its dash */
  const travel = newsGlobe({ mode: 'travel' });
  assert.deepEqual([travel.last().on, travel.last().tint], [false, true]);
});

/* D9 (event timeline slice S4): while the page has the news off for the tab or the door (on:false with tint:false), the frame tells
   the countries, which drop the card's news count (never a dash for a layer that is off) and say so to the page, whose own card
   drops it too; Travel's off (the tint flag kept) leaves both cards as they were */
test('D9: with the news off for the tab or the door, a country\'s card says nothing about news, and says so again when it is on', () => {
  const { api } = countries();
  assert.equal(typeof api.newsOff, 'function', 'the countries take the flag');
  assert.equal(api.state().newsOff, false, 'the news on by default');
  api.newsOff(true);
  assert.equal(api.state().newsOff, true);
  api.newsOff(true);
  assert.equal(api.state().newsOff, true, 'asking twice changes nothing');
  api.newsOff(false);
  assert.equal(api.state().newsOff, false, 'the news back: the card counts it again');
  const globe = read('js/action-globe.js'), c = read('js/world-countries.js'), page = read('js/mnet.js');
  assert.match(globe, /function newsCardOff\(\)\{if\(countries&&countries\.newsOff\)countries\.newsOff\(!publicNewsOn&&newsTintQuiet\)\}/, 'off for the tab or the door only: on:false with tint:false');
  assert.match(globe, /publicNewsOn=on===true;newsTintQuiet=tint===false;quietNewsTint\(\);newsCardOff\(\);/, 'every message applies it');
  assert.match(globe, /\}\}\);newsCardOff\(\);quietNewsTint\(\);loadNewsHeat\(\);loadMembers\(\)\}/, 'and the countries\' mount, for a flag that came first');
  assert.match(globe, /if\(!publicNewsOn\|\|travelMode\|\|ANALYTICS\)\{countries\.heat\(null\);clearTimeout\(newsHeatTimer\);newsHeatTimer=0;return\}/, 'the news off: no heat read, the timer stopped');
  assert.match(c, /'<div class="country-card__stats">' \+ \(stats\.newsOff \? '' : cell\(stats\.news, 'news · 24 h'\)\)/, 'the frame\'s card drops the cell');
  assert.match(c, /return \{ news, newsOff: st\.newsOff === true, /, 'and tells the page');
  assert.match(page, /'<div class="mn__place-stats">' \+ \(s\.newsOff \? "" : cell\(s\.news, "news \\u00b7 24 h"\)\)/, 'the page\'s card drops it too');
  assert.match(page, /newsOff: s\.newsOff === true/, 'from the globe\'s own word');
});
