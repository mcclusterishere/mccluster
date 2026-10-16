/* The charcoal analytics screen and the owner's five-tab bar, end to end in a real browser.

   Serves this checkout and fakes api.mccluster.org and Supabase in memory with FIXTURES (labelled
   as such below; no production call, no production number). Renders control.html#analytics at
   390x844, 768x1024 and 1280x800 as the house owner, checks: the header, Live, the range and
   property selectors, the globe drawn with every country segmented, the choropleth (US red), arcs
   only between real label points, a country under five never drawn, the legend, the filter pill
   and summary, the Reach and Audience cards, tap a country -> the cards follow, the country
   dropdown -> the globe flies there, Clear resets, the five-tab bar, reduced motion,
   scrollWidth === clientWidth, no console errors. A member who is not the owner keeps three tabs.

   Run:  node scripts/e2e/analytics-globe.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable) and network access to the Cesium CDN.
   Exits non-zero on any failed check. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT, { recursive: true });

let failed = 0;
function check(scope, name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 500)}`);
  if (!ok) failed++;
}

/* ---------- FIXTURES (test data only; shaped like the real reads) ---------- */
const now = Date.now();
const HOURS = [...Array(24)].map((_, i) => { const at = new Date(now - (23 - i) * 3600000); at.setMinutes(0, 0, 0); return { hour: at.toISOString(), hour_label: '', page_views: [2, 3, 2, 4, 5, 4, 6, 5, 3, 4, 6, 5, 7, 6, 9, 8, 8, 9, 7, 6, 7, 5, 4, 4][i], visitors: 2, sessions: 3, plays: 1, events: 9 }; });
const FIX = {
  totals: [{ page_views: 133, visits: 40, visitors: 40, sessions: 52, plays: 30, events: 900 }],
  country: [{ key: 'US', n: 61 }, { key: 'GB', n: 18 }, { key: 'BR', n: 12 }, { key: 'JP', n: 7 }, { key: 'CA', n: 3 }, { key: 'XX', n: 2 }],
  source: [{ key: 'x.com', n: 22 }, { key: 'direct', n: 14 }, { key: 't.co', n: 4 }],
  network: [{ key: '4g', n: 70 }, { key: 'wifi', n: 40 }],
  countryTotals: [{ country: 'US', page_views: 61, visitors: 18, sessions: 22 }, { country: 'GB', page_views: 18, visitors: 7, sessions: 8 }, { country: 'BR', page_views: 12, visitors: 5, sessions: 6 }],
  series: (cc) => HOURS.map((h, i) => ({ bucket: h.hour, bucket_label: '', page_views: cc === 'US' ? Math.max(0, h.page_views - 2) : i % 3, visitors: 1 })),
  visitors: { ok: true, total: 40, counts: { all: 40, returning: 9 }, visitors: [] },
  flows: { ok: true, flows: { sessions: 52, bounced: 20, bounce_rate: 38, pages_per_session: { 1: 20, 2: 14, 3: 9, 4: 5, '5+': 4 }, entries: [{ path: '/', sessions: 30 }], exits: [], transitions: [], paths: [], pages: [] } },
  errors: { ok: true, totals: { errors: 6, site_errors: 2, injected_errors: 4, friction: 9, journey: 3, sessions_affected: 11 }, errors: [], friction: [], journey: [{ kind: 'gated_preview_end', detail: 'Track · gate', sessions: 3 }] },
  missions: [{ mission_id: 'm1', joined: 14, in_progress: 6, submitted: 5, verified: 2, rejected: 1 }, { mission_id: 'm2', joined: 4, in_progress: 3, submitted: 1, verified: 0, rejected: 0 }],
  business: { window: {}, users: { total: 110, created_in_window: 4, confirmed_in_window: 3, active_in_window: 9, created_by_day: [{ day: '2026-10-14', count: 1 }, { day: '2026-10-15', count: 3 }] },
    music: { plays: { total: 900, in_window: 30 }, preview_plays: { in_window: 21 }, full_plays: { in_window: 9 }, completions: { in_window: 5 }, paid_orders: { in_window: 0 }, revenue: {} },
    mnet: { profiles: { total: 64, created_in_window: 2 }, posts: { created_in_window: 7 }, follows: { created_in_window: 5 }, reactions: { created_in_window: 19 } }, commerce: { available: false, reason: 'fixture' } },
  identity: { coverage: { accounts: 4 }, journeys: [{ source: 'x.com', country: 'US', created_at: new Date().toISOString() }, { source: 'x.com', country: 'US' }, { source: 'direct', country: 'GB' }, { source: 'x.com', country: null }], tracks: [] }
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' }, body: JSON.stringify(body) });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function context(viewport, { owner = true, reduced = false, pendingRpc = true } = {}) {
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(() => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: '11111111-1111-4111-8111-111111111111', email: 'owner@test' })).replace(/=+$/, '') + '.y', refresh_token: 'r', expires_at: exp, user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@test' } }));
  });
  const calls = [];
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname;
    calls.push(p);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/health') return json(route, { ok: true });
    if (p === '/v1/status') return owner ? json(route, { ok: true, operator: { email: 'owner@test' } }) : json(route, { error: 'Forbidden' }, 403);
    if (!owner) return json(route, { error: 'Forbidden' }, 403);
    if (p === '/v1/workspaces/me') return json(route, { default_org_id: 'o1', workspaces: [{ org_id: 'o1', slug: 'mccluster', kind: 'studio', name: 'McCluster', role: 'owner', enabled: true }] });
    if (p === '/v1/analytics/business') return json(route, FIX.business);
    if (p === '/v1/analytics/identity') return json(route, FIX.identity);
    if (p === '/v1/analytics/visitors') return json(route, FIX.visitors);
    if (p === '/v1/analytics/flows') return json(route, FIX.flows);
    if (p === '/v1/analytics/errors') return json(route, FIX.errors);
    if (p === '/v1/intel/geo') return json(route, { code: 'intel_schema_not_ready' }, 503);
    return json(route, { ok: true });
  });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname, body = JSON.parse(req.postData() || '{}');
    if (p === '/auth/v1/user') return json(route, { id: '11111111-1111-4111-8111-111111111111', email: 'owner@test' });
    if (p === '/rest/v1/rpc/analytics_totals') return json(route, FIX.totals);
    if (p === '/rest/v1/rpc/analytics_hourly') return json(route, HOURS);
    if (p === '/rest/v1/rpc/analytics_top') return json(route, body.p_dim === 'country' ? FIX.country : body.p_dim === 'source' ? FIX.source : body.p_dim === 'network' ? FIX.network : []);
    if (p === '/rest/v1/rpc/analytics_country_totals') return pendingRpc ? json(route, FIX.countryTotals) : json(route, { code: 'PGRST202', message: 'Could not find the function public.analytics_country_totals' }, 404);
    if (p === '/rest/v1/rpc/analytics_country_series') return pendingRpc ? json(route, FIX.series(body.p_country)) : json(route, { code: 'PGRST202', message: 'Could not find the function' }, 404);
    if (p === '/rest/v1/rpc/action_mission_stats') return json(route, FIX.missions);
    return json(route, []);
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  /* the fixtures answer two reads with deliberate failures (intel switched off: 503; the pending country read absent: 404),
     which the browser logs as "Failed to load resource"; every other console error counts */
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { ctx, page, errors, calls };
}
const settle = (page) => page.waitForFunction(() => window.__craGlobe && window.__craGlobe().ready && window.__craGlobe().placed.length > 0, null, { timeout: 60000 }).then(() => true).catch(() => false);
const widths = (page) => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));

const SIZES = [{ name: '390', viewport: { width: 390, height: 844 } }, { name: '768', viewport: { width: 768, height: 1024 } }, { name: '1280', viewport: { width: 1280, height: 800 } }];
for (const size of SIZES) {
  const S = `owner-${size.name}`;
  const { ctx, page, errors } = await context(size.viewport);
  await page.goto(BASE + '/control.html#analytics', { waitUntil: 'domcontentloaded' });
  const ready = await settle(page);
  check(S, 'the globe is ready and draws countries', ready, await page.evaluate(() => window.__craGlobe && window.__craGlobe()));
  await page.waitForFunction(() => /Page views/.test((document.getElementById('craPanel') || {}).textContent || '') && document.querySelector('.cra-live.is-live'), null, { timeout: 30000 }).catch(() => {});
  const g = await page.evaluate(() => { const x = window.__craGlobe(); return { countries: x.countries, placed: x.placed, arcs: x.arcs, us: x.fill('US'), fr: x.fill('FR'), ca: x.fill('CA') }; });
  check(S, 'every Natural Earth country is segmented (177)', g.countries === 177, g.countries);
  const codes = g.placed.map((p) => p.code).sort();
  check(S, 'points only for countries with 5+: US, GB, BR, JP (CA under five and XX never drawn)', JSON.stringify(codes) === JSON.stringify(['BR', 'GB', 'JP', 'US']), codes);
  const us = g.placed.find((p) => p.code === 'US');
  check(S, 'the US glow sits at its Natural Earth label point (39.54N 97.48W), never 0,0', !!us && Math.abs(us.lat - 39.54) < 0.01 && Math.abs(us.lon + 97.48) < 0.01 && g.placed.every((p) => !(p.lon === 0 && p.lat === 0)), us);
  check(S, 'arcs from the origin country to each other drawn country (3)', g.arcs === 3, g.arcs);
  check(S, 'choropleth: the US is filled red, Canada (under five) stays charcoal', !!g.us && g.us[0] > 190 && g.us[1] < 60 && !!g.ca && g.ca[0] < 60, g);
  const ui = await page.evaluate(() => {
    const t = (s) => (document.querySelector(s) || {}).textContent || '';
    const vis = (s) => { const n = document.querySelector(s); if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; };
    return { title: t('.cra-top__title'), live: !!document.querySelector('.cra-live.is-live'), prop: (document.getElementById('craProperty') || {}).value, range: t('.cra-seg--range .is-on'), legend: t('[data-cra-legend]'), pill: t('[data-cra-pill]'), summary: t('[data-cra-summary]'),
      reach: t('[data-cra-slide="reach"]'), audience: t('[data-cra-slide="audience"]'), headings: [...document.querySelectorAll('.cra-h')].map((h) => h.textContent), dots: document.querySelectorAll('.cra-dot').length,
      bar: vis('.appbar.appbar--admin'), tabs: [...document.querySelectorAll('.appbar [data-appnav]')].map((a) => a.getAttribute('data-appnav')), here: (document.querySelector('.appbar .is-here') || {}).getAttribute ? document.querySelector('.appbar .is-here').getAttribute('data-appnav') : null,
      mImg: (document.querySelector('.appbar [data-appnav="home"] img') || {}).getAttribute ? document.querySelector('.appbar [data-appnav="home"] img').getAttribute('src') : null,
      illustrative: /Illustrative data|Design concept/i.test(document.body.textContent) };
  });
  check(S, 'header: Analytics + Live, McCluster first-party, 24h', /Analytics/.test(ui.title) && ui.live && ui.prop === '__first_party__' && ui.range === '24h', ui);
  check(S, 'legend Page views 100+ / 10–100 / 5–10, under 5 not drawn', /Page views/.test(ui.legend) && /100\+/.test(ui.legend) && /10–100/.test(ui.legend) && /under 5 not drawn/.test(ui.legend), ui.legend);
  check(S, 'filter pill and summary line', /Filters/.test(ui.pill) && /All countries/.test(ui.pill) && /24 hours · Page views · All sources/.test(ui.summary), { pill: ui.pill, summary: ui.summary });
  check(S, 'Reach (133 page views worldwide) and Audience (40 visitors) cards', /133/.test(ui.reach) && /Page views/.test(ui.reach) && /40/.test(ui.audience) && /New/.test(ui.audience) && /Returning/.test(ui.audience), { reach: ui.reach.slice(0, 120), audience: ui.audience.slice(0, 120) });
  check(S, 'Reach, Audience, Action carousels with dots', ['Reach', 'Audience', 'Action'].every((h) => ui.headings.includes(h)) && ui.dots >= 7, ui.headings);
  check(S, 'the owner bar: Play, Home, M, Analytics, Globe; Analytics is the current tab; the M is the supplied PNG', ui.bar && JSON.stringify(ui.tabs) === JSON.stringify(['music', 'admin-home', 'home', 'analytics', 'world']) && ui.here === 'analytics' && /assets\/img\/m-mark\.png$/.test(ui.mImg || ''), ui);
  check(S, 'no "Illustrative data" footnote on real screens', !ui.illustrative);
  let w = await widths(page);
  check(S, 'no sideways overflow (scrollWidth === clientWidth)', w.scrollW === w.clientW, w);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `analytics-${size.name}.png`) });

  /* select from the dropdown: the globe flies there and the cards follow */
  await page.selectOption('#craCountry', 'US');
  await page.waitForFunction(() => { const x = window.__craGlobe(); return x.selected === 'US' && x.camera && Math.abs(x.camera.lon + 97.48) < 3; }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const sel = await page.evaluate(() => ({ g: window.__craGlobe(), reach: document.querySelector('[data-cra-slide="reach"]').textContent, aud: document.querySelector('[data-cra-slide="audience"]').textContent, pill: document.querySelector('[data-cra-pill]').textContent }));
  check(S, 'dropdown -> the globe selects and flies to the US', sel.g.selected === 'US' && !!sel.g.camera && Math.abs(sel.g.camera.lon + 97.48) < 3, sel.g.camera);
  check(S, 'dropdown -> Reach says 61 page views · United States, 133 worldwide', /61/.test(sel.reach) && /United States · 24 hours/.test(sel.reach) && /133 worldwide/.test(sel.reach), sel.reach.slice(0, 160));
  check(S, 'dropdown -> Audience says 18 visitors in the United States (pending read fixture)', /18/.test(sel.aud) && /United States/.test(sel.aud), sel.aud.slice(0, 160));
  check(S, 'the tooltip reads "United States 61 page views"', /United States/.test(sel.g.tip || '') && /61 page views/.test(sel.g.tip || ''), sel.g.tip);
  check(S, 'Filters (1) counts the country', /Filters1/.test(sel.pill.replace(/\s+/g, '')), sel.pill);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `analytics-${size.name}-us.png`) });

  /* tap a country on the globe: Brazil (back to all countries first, so the camera returns home) */
  await page.selectOption('#craCountry', '');
  await page.waitForTimeout(1500);
  /* project Brazil's label point to the screen through the globe's own scene and click there */
  const xy = await page.evaluate(() => window.__craGlobeProject && window.__craGlobeProject('BR'));
  if (xy) {
    const r = await page.evaluate(() => { const c = document.querySelector('.crg-canvas canvas').getBoundingClientRect(); return { x: c.left, y: c.top }; });
    if (size.viewport.width < 600) await page.touchscreen.tap(r.x + xy.x, r.y + xy.y); else await page.mouse.click(r.x + xy.x, r.y + xy.y);
    await page.waitForTimeout(700);
  }
  const tapRes = await page.evaluate(() => ({ sel: window.__craGlobe().selected, dd: document.getElementById('craCountry').value, reach: document.querySelector('[data-cra-slide="reach"]').textContent }));
  check(S, 'tap Brazil on the globe -> selected, dropdown and Reach follow (12 page views)', !!xy && tapRes.sel === 'BR' && tapRes.dd === 'BR' && /12/.test(tapRes.reach) && /Brazil/.test(tapRes.reach), { xy, ...tapRes, reach: tapRes.reach.slice(0, 100) });
  await page.click('[data-cra-clear]').catch(() => {});
  await page.waitForTimeout(500);
  const cleared = await page.evaluate(() => ({ sel: window.__craGlobe().selected, dd: document.getElementById('craCountry').value, summary: document.querySelector('[data-cra-summary]').textContent }));
  check(S, 'Clear resets the country and the filters', cleared.sel === null && cleared.dd === '' && !/Clear/.test(cleared.summary), cleared);

  /* swipe the Reach carousel to the second card */
  await page.click('[data-cra-dot="reach"][data-i="1"]');
  await page.waitForTimeout(2500);
  const car = await page.evaluate(() => { const t = document.querySelector('[data-cra-car="reach"] .cra-car__track'); return { left: t.scrollLeft, target: t.children[1].offsetLeft - t.children[0].offsetLeft, w: t.clientWidth, on: [...document.querySelectorAll('[data-cra-dot="reach"]')].findIndex((d) => d.classList.contains('is-on')) }; });
  check(S, 'a dot moves the Reach carousel to its second card', car.on === 1 && Math.abs(car.left - car.target) < 3, car);
  w = await widths(page);
  check(S, 'still no sideways overflow after interaction', w.scrollW === w.clientW, w);
  check(S, 'no console or page errors', errors.length === 0, errors);
  await ctx.close();
}

/* reduced motion: selecting jumps (no camera flight) and nothing breaks */
{
  const { ctx, page, errors } = await context({ width: 390, height: 844 }, { reduced: true, pendingRpc: false });
  await page.goto(BASE + '/control.html#analytics', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.waitForFunction(() => /Page views/.test((document.getElementById('craPanel') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
  await page.selectOption('#craCountry', 'GB');
  await page.waitForTimeout(250);
  const cam = await page.evaluate(() => window.__craGlobe().camera);
  check('reduced-390', 'reduced motion: the camera is already over the UK (no flight)', !!cam && Math.abs(cam.lon + 2.12) < 3, cam);
  const aud = await page.evaluate(() => document.querySelector('[data-cra-slide="audience"]').textContent);
  check('reduced-390', 'pending read absent: Audience says so instead of inventing a number', /analytics_country_v1/.test(aud), aud.slice(0, 200));
  check('reduced-390', 'no console or page errors', errors.length === 0, errors);
  await ctx.close();
}

/* a signed-in member who is not the owner keeps the three-column bar */
{
  const { ctx, page, errors } = await context({ width: 390, height: 844 }, { owner: false });
  await page.goto(BASE + '/listen.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const tabs = await page.evaluate(() => ({ admin: !!document.querySelector('.appbar--admin'), tabs: [...document.querySelectorAll('.appbar [data-appnav]')].map((a) => a.getAttribute('data-appnav')) }));
  check('member-390', 'a member who is not the owner keeps Music | M | Globe', !tabs.admin && JSON.stringify(tabs.tabs) === JSON.stringify(['music', 'home', 'world']), tabs);
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
