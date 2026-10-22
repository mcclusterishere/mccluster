/* The charcoal analytics screen (owner, 2026-10-15) and the owner's five-tab bar: metric classification, filter sync,
   privacy suppression (under 5 folded, never 0,0, never an invented place), the boundary data, the pending country
   reads, and the role rule for the bar (server truth, never this browser's storage). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (p) => readFile(p, 'utf8');
async function analytics(data) {
  const ctx = { window: { CR: {} }, console };
  vm.createContext(ctx);
  vm.runInContext(await read('js/control-room/analytics.js'), ctx);
  const A = ctx.window.CR.analytics;
  A.state.geo.layer="pageviews";A.state.ui.reach="views";
  A.init({ request: () => Promise.resolve({}), supa: () => Promise.resolve([]) });
  A.state.range = { id: '24h', label: '24 hours', since: '2026-10-15T00:00:00Z', until: '2026-10-16T00:00:00Z' };
  A.state.geo.places = { US: [-97.48, 39.54, 'United States'], GB: [-2.12, 54.4, 'United Kingdom'], BR: [-49.56, -12.1, 'Brazil'], NL: [0, 0, 'Nowhere'] };
  Object.assign(A.state.data, data || {});
  return A;
}
const BASE = () => ({
  traffic: { byHour: [], byDay: [], totals: { page_views: 133, visitors: 40 }, sources: [{ source: 'x.com', count: 22 }], countries: [], networks: [], pages: [] },
  geo: [{ key: 'US', n: 61 }, { key: 'GB', n: 18 }, { key: 'BR', n: 12 }, { key: 'CA', n: 3 }, { key: 'XX', n: 2 }, { key: 'NL', n: 9 }, { key: 'ZZ', n: 7 }]
});

test('privacy: the globe payload carries only countries with 5+, at real label points, never 0,0, never invented', async () => {
  const A = await analytics(BASE());
  const p = A.geo.payload();
  const codes = JSON.parse(JSON.stringify(p.points.map((x) => x.code).sort()));
  assert.deepEqual(codes, ['BR', 'GB', 'US'], 'CA (3) folded; XX not a country; NL sits at 0,0 so it is not placed; ZZ has no label point');
  for (const x of p.points) assert.ok(!(x.lon === 0 && x.lat === 0) && Number.isFinite(x.lon) && Number.isFinite(x.lat));
  const a = A.geo.aggregate();
  assert.equal(a.located, 91);
  assert.equal(a.suppressed, 3);
  /* page views: 133 total - 112 recorded + XX 2 + NL 9 + ZZ 7 unplaced = 39 without a country on the globe */
  assert.equal(a.unknown, 39);
  assert.equal(a.located + a.suppressed + a.unknown, 133, 'located + under 5 + no country = total');
  assert.equal(p.origin, undefined, 'no arcs: the payload carries no origin (owner, 2026-10-16: "just modern selection")');
});

test('metric classification: the label speaks the layer\'s unit; under 5 says so instead of a number', async () => {
  const A = await analytics(BASE());
  assert.deepEqual(JSON.parse(JSON.stringify(A.geo.tooltip('US'))), { title: 'United States', line: '61 page views' });
  assert.match(A.geo.tooltip('CA').line, /Under 5/);
  A.state.geo.layer = 'signups';
  A.state.data.identity = { journeys: [...Array(6)].map(() => ({ country: 'US' })).concat([{ country: 'GB' }]) };
  assert.equal(A.geo.tooltip('US').line, '6 sign-ups');
  assert.match(A.geo.tooltip('GB').line, /Under 5/);
  const ctx = { window: { CR: {} }, console, document: undefined };
  vm.createContext(ctx);
  vm.runInContext(await read('js/control-room/analytics-globe.js'), ctx);
  const G = ctx.window.CR.analyticsGlobe;
  assert.equal(G.bucket, undefined, 'heat map uses continuous intensity rather than arbitrary buckets');
  assert.equal(G.lonLat(0, 0), null);
  assert.equal(G.lonLat(-97.48, null), null);
  assert.deepEqual(JSON.parse(JSON.stringify(G.lonLat(-97.48, 39.54))), [-97.48, 39.54]);
});

test('filter sync: one selection drives the globe, the pill, the cards; Clear resets everything', async () => {
  const A = await analytics(BASE());
  const html0 = A.render();
  assert.match(html0, /133/);
  A.geo.pick('US', false);
  assert.equal(A.state.geo.region, 'US');
  assert.equal(A.geo.payload().selected, 'US');
  assert.equal(A.geo.filterCount(), 2);
  const html = A.render();
  assert.match(html, /United States · 24 hours/);
  assert.match(html, /Reading this location/);

  /* without the pending country read, visitors by country say so instead of inventing one */
  A.state.data.countryTotals = { ok: false, missing: true, rows: [] };

  A.state.data.countryTotals = { ok: true, missing: false, rows: [{ country: 'US', page_views: 61, visitors: 18, sessions: 22 }] };

  A.geo.pick('', false);
  assert.equal(A.state.geo.region, null);
  assert.equal(A.geo.payload().selected, null);
  assert.equal(A.geo.filterCount(), 1);
  assert.match(A.top(), /Analytics <span class="cra-live/);
  assert.match(A.top(), /data-cra-range="24h"[^>]*aria-pressed="true"/);
});

test('real data only: no illustrative footnote, no fixture numbers in production code', async () => {
  const js = await read('js/control-room/analytics.js') + await read('js/control-room/analytics-globe.js');
  assert.doesNotMatch(js, /Illustrative data|Design concept/i);
  assert.doesNotMatch(js, /Math\.random/);
});

test('boundaries: Natural Earth 110m, public domain, ISO-2 keyed, provenance and build script recorded', async () => {
  const b = JSON.parse(await read('data/geo/country-boundaries-110m.json'));
  assert.match(b.source, /Natural Earth/);
  assert.match(b.license, /Public domain/);
  assert.match(b.version, /v5\.1\.2/);
  assert.equal(b.countries.length, 177);
  const us = b.countries.find((c) => c.c === 'US');
  assert.ok(us && us.p.length >= 2, 'the US is a multipolygon (lower 48, Alaska, …)');
  for (const c of b.countries) {
    assert.ok(c.c === null || /^[A-Z]{2}$/.test(c.c));
    for (const poly of c.p) for (const ring of poly) {
      assert.ok(ring.length >= 6 && ring.length % 2 === 0);
      for (let i = 0; i < ring.length; i += 2) assert.ok(Math.abs(ring[i]) <= 180 && Math.abs(ring[i + 1]) <= 90);
    }
  }
  for (const code of ['FR', 'NO']) assert.ok(b.countries.some((c) => c.c === code), code + ' keyed through ISO_A2_EH');
  const tool = await read('tools/build-country-boundaries.mjs');
  assert.match(tool, /natural-earth-vector\/\$\{VERSION\}\/geojson\/ne_110m_admin_0_countries\.geojson/);
});

test('applied country reads: security invoker over events_lean, country only, anon revoked, rollback written', async () => {
  const sql = await read('supabase/migrations/20261017030551_analytics_country_v1.sql');
  for (const fn of ['analytics_country_totals', 'analytics_country_series']) {
    assert.match(sql, new RegExp('create or replace function public\\.' + fn));
    assert.match(sql, new RegExp('revoke all on function public\\.' + fn + '\\([^)]*\\) from public, anon'));
    assert.match(sql, new RegExp('drop function if exists public\\.' + fn));
  }
  assert.equal((sql.match(/^security invoker$/gm) || []).length, 2);
  assert.doesNotMatch(sql, /security definer/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(city|region|latitude|longitude|ip)\b/, 'nothing finer than country leaves these reads');
  assert.match(sql, /not e\.is_bot/);
});

test('owner bar: five tabs for the owner from the server\'s answer, three for everyone else; the M is the supplied PNG', async () => {
  const js = await read('js/tabbar.js');
  const block = js.slice(js.indexOf("THE OWNER'S FIVE TABS"), js.indexOf('function loadCanonicalAuth'));
  assert.match(block, /fetch\(API_ORIGIN \+ "\/v1\/status"/, 'the same owner check the Control Room uses');
  assert.doesNotMatch(block, /localStorage\.(get|set)Item\(ADMIN_KEY/, 'never this browser\'s long-lived storage');
  assert.match(block, /sessionStorage\.setItem\(ADMIN_KEY, JSON\.stringify\(\{ sub: sub, at: Date\.now\(\), admin: r\.ok \}\)\)/);
  assert.match(block, /if \(r\.ok \|\| r\.status === 401 \|\| r\.status === 403\)/, 'only a definite answer changes the bar');
  const order = [...block.matchAll(/data-appnav="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['music', 'admin-home', 'home', 'analytics', 'halo']);
  assert.match(block, /control\.html#home/);
  assert.match(block, /control\.html#analytics/);
  assert.match(block, /<img class="appbar__m" src="' \+ ROOT \+ 'assets\/img\/m-mark\.png" alt="">/, 'the supplied mark, no plate, nothing drawn');
  assert.doesNotMatch(block, /appbar__m[^"]*--plate|border-radius:50%[^"]*appbar__m/);
  assert.match(block, /dock\.classList\.toggle\("appbar--admin", on\)/, 'the integration point other bar add-ons check');
  assert.match(js, /paintAuthState\(false, null, true\);\n\s*paintAdmin\(false\);/, 'signed out: back to three');
  assert.match(js, /var ORDER = \["music", "home", "world"\];/, 'everyone else keeps Music | M | Globe');
  const css = await read('css/style.css');
  const adminCss = css.slice(css.indexOf('THE OWNER\'S FIVE TABS'));
  assert.doesNotMatch(adminCss, /@media[^{]*max-width/);
  assert.doesNotMatch(adminCss, /\.appbar__m\{[^}]*(background|border-radius)/, 'no plate behind the M');
});

test('the bar never leaves: the Control Room carries the shared bar (no data-no-appbar), analytics is reachable by URL', async () => {
  const html = await read('control.html');
  assert.doesNotMatch(html, /<body[^>]*data-no-appbar/);
  assert.match(html, /js\/tabbar\.js/);
  assert.match(html, /js\/control-room\/analytics-globe\.js[^]*js\/control-room\/analytics\.js/);
  const v2 = await read('js/control-room-v2.js');
  assert.match(v2, /document\.body\.setAttribute\("data-cr-surface", state\.surface\)/);
  const css = await read('css/control-analytics.css');
  assert.match(css, /body\.cr\.has-appbar\[data-cr-surface="analytics"\] \.cr-bottom\{display:none\}/);
  assert.doesNotMatch(css, /\.appbar\{display:none|\.appbar[^{]*\{[^}]*display:none/);
});
