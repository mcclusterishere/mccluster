/* THE NEWS TINT STEPS ASIDE IN THE EQUITY UPRISE TAB (release polish, 2026-11-18; review V2-M3). The World's news heat map
   ("News mentions · last 24 h": each country shaded by the stories that mention it, js/world-countries.js) stayed on in the Equity
   Uprise tab and coloured whole countries under the environmental layers, competing with them (owner, 2026-11-17: "make the visuals
   proportionate to the geographical data we are collecting"). While the feed's scope is the Equity Uprise tab the page tells the
   globe so over the existing message spine (js/world-news-globe.js: hu:world-news-pins carries tint:false), and the globe hides
   the shading and its legend while keeping the counts (a country's card still says how many stories); leaving the tab brings the
   same shading back. Run on fakes here; the real page and frame by night and by day at 390, 820 and 1280 are
   scripts/e2e/environment-world.e2e.mjs.
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
function newsGlobe({ scope = 'global', mode = 'posts' } = {}) {
  const sent = [], listeners = {}, frame = { contentWindow: { postMessage: (data, origin) => sent.push({ data: JSON.parse(JSON.stringify(data)), origin }) } };
  const node = () => ({ id: '', className: '', textContent: '', hidden: false, setAttribute() {}, append() {}, addEventListener() {}, close() {}, showModal() {} });
  const sandbox = {
    location: { origin: ORIGIN },
    document: { getElementById: (id) => (id === 'mnWorldFrame' ? frame : null), createElement: node, body: { appendChild() {} }, documentElement: { dataset: {} } },
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
    ready() { fire('message', { source: frame.contentWindow, origin: ORIGIN, data: { type: 'hu:globe-ready', boot: 'b1' } }); },
    last: () => sent.filter((m) => m.data.type === 'hu:world-news-pins').at(-1).data
  };
}

test('the page tells the globe to hide the news tint exactly while the feed\'s scope is the Equity Uprise tab, over the message it already sends', () => {
  const g = newsGlobe();
  assert.deepEqual(g.last(), { type: 'hu:world-news-pins', on: true, tint: true, items: [{ id: 'n1', lat: 41.76, lon: -72.68 }] }, 'Global: the news on, the tint shown');
  assert.equal(g.sent[0].origin, ORIGIN, 'same origin only');
  g.setScope('equity');
  const quiet = g.last();
  assert.equal(quiet.tint, false, 'the Equity Uprise tab: the tint steps aside');
  assert.equal(quiet.on, true, 'the news layer itself stays on, so the globe keeps its counts for a country\'s card');
  /* a globe that (re)booted while the tab is open is told again, with the tint still quiet */
  const before = g.sent.length;
  g.ready();
  assert.equal(g.sent.length, before + 1);
  assert.equal(g.last().tint, false, 'hu:globe-ready while on the tab: still quiet');
  g.setScope('global');
  assert.equal(g.last().tint, true, 'leaving the tab brings the tint back');
  g.setScope('local');
  assert.equal(g.last().tint, true, 'Local keeps the tint');
  g.setScope('news');
  assert.equal(g.last().tint, true, 'News keeps the tint');
  /* Travel turns the news off altogether, as it always did */
  g.setMode('travel');
  assert.equal(g.last().on, false);
  assert.deepEqual(g.last().items, []);
});

test('a page that lands on the Equity Uprise tab tells the globe the tint is quiet from the first message', () => {
  const g = newsGlobe({ scope: 'equity' });
  assert.equal(g.last().tint, false);
  assert.equal(g.last().on, true);
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
