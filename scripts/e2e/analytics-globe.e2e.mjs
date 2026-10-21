/* The charcoal analytics screen and the owner's five-tab bar, end to end in a real browser.

   Serves this checkout and fakes api.mccluster.org and Supabase in memory with FIXTURES (labelled
   as such below; no production call, no production number). Renders control.html#analytics at
   390x844, 768x1024 and 1280x800 as the house owner, checks: the header, Live, the range and
   property selectors, the globe drawn with every country segmented, a grey sphere with no
   choropleth, no arcs, no dots and no legend (owner 2026-10-16: "a grey sphere that only lights up
   when selected boundaries are selected"), a country under five never carried, the filter pill
   and summary, the Reach and Audience cards. ONE SELECTION, both ways:
   the dropdown selects a country -> the globe fills and outlines it and flies to fit it; the
   dropdown selects a state -> the globe loads that country's states and flies to the state;
   a tap on a state on the globe -> the dropdown shows it; a tap on a country -> the cards
   follow; Clear -> the world. Region counts pending -> "not collected yet", shapes still
   selectable. The five-tab bar, reduced motion, scrollWidth === clientWidth, no console errors.
   A member who is not the owner keeps three tabs.

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
  /* a country's 24 buckets: the worldwide hourly shape scaled to that country's total, rounded by largest remainder so
     the buckets add up to the country's page views (the earlier fixture alternated 0/1/2 for every other country, which
     drew a sawtooth: a fixture artefact, not the chart or the bucketing) */
  series: (cc) => {
    const total = { US: 61, GB: 18, BR: 12, JP: 7 }[cc] || 0, all = HOURS.reduce((a, h) => a + h.page_views, 0);
    const raw = HOURS.map((h) => h.page_views * total / all), out = raw.map(Math.floor);
    raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).slice(0, total - out.reduce((a, b) => a + b, 0)).forEach(([, i]) => { out[i]++; });
    return HOURS.map((h, i) => ({ bucket: h.hour, bucket_label: '', page_views: out[i], visitors: Math.min(out[i], 1) }));
  },
  visitors: { ok: true, total: 40, counts: { all: 40, returning: 9 }, visitors: [] },
  flows: { ok: true, flows: { sessions: 52, bounced: 20, bounce_rate: 38, pages_per_session: { 1: 20, 2: 14, 3: 9, 4: 5, '5+': 4 }, entries: [{ path: '/', sessions: 30 }], exits: [], transitions: [], paths: [], pages: [] } },
  errors: { ok: true, totals: { errors: 6, site_errors: 2, injected_errors: 4, friction: 9, journey: 3, sessions_affected: 11 }, errors: [], friction: [], journey: [{ kind: 'gated_preview_end', detail: 'Track · gate', sessions: 3 }] },
  missions: [{ mission_id: 'm1', joined: 14, in_progress: 6, submitted: 5, verified: 2, rejected: 1 }, { mission_id: 'm2', joined: 4, in_progress: 3, submitted: 1, verified: 0, rejected: 0 }],
  business: { window: {}, users: { total: 110, created_in_window: 4, confirmed_in_window: 3, active_in_window: 9, created_by_day: [{ day: '2026-10-14', count: 1 }, { day: '2026-10-15', count: 3 }] },
    music: { plays: { total: 900, in_window: 30 }, preview_plays: { in_window: 21 }, full_plays: { in_window: 9 }, completions: { in_window: 5 }, paid_orders: { in_window: 0 }, revenue: {} },
    mnet: { profiles: { total: 64, created_in_window: 2 }, posts: { created_in_window: 7 }, follows: { created_in_window: 5 }, reactions: { created_in_window: 19 } }, commerce: { available: false, reason: 'fixture' } },
  regions: { ok: true, pending: false, country: 'US', min: 5, regions: [{ code: 'CT', name: 'Connecticut', page_views: 22, visitors: 9 }, { code: 'NY', name: 'New York', page_views: 14, visitors: 6 }, { code: null, name: 'California', page_views: 9, visitors: 4 }], folded: 7, unknown: 9 },
  identity: { coverage: { accounts: 4 }, journeys: [{ source: 'x.com', country: 'US', created_at: new Date().toISOString() }, { source: 'x.com', country: 'US' }, { source: 'direct', country: 'GB' }, { source: 'x.com', country: null }], tracks: [] }
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' }, body: JSON.stringify(body) });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function context(viewport, { owner = true, reduced = false, pendingRpc = true } = {}) {
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(() => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
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
    if (p === '/v1/analytics/regions') return json(route, pendingRpc ? (new URL(req.url()).searchParams.get('country') === 'US' ? FIX.regions : { ok: true, pending: false, country: new URL(req.url()).searchParams.get('country'), min: 5, regions: [], folded: 0, unknown: 0 }) : { ok: true, pending: true, country: new URL(req.url()).searchParams.get('country'), regions: [], folded: 0, unknown: 0 });
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
const settle = (page) => page.waitForFunction(() => window.__craGlobe && window.__craGlobe().ready && window.__craGlobe().valued.length > 0, null, { timeout: 60000 }).then(() => true).catch(() => false);
const SHOTS = process.env.SHOTS_DIR || OUT;
const NEAR = (l, lon, lat, d) => !!l && Math.abs(l.lon - lon) < d && Math.abs(l.lat - lat) < d;
const widths = (page) => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));

const SIZES = [{ name: '390', viewport: { width: 390, height: 844 } }, { name: '768', viewport: { width: 768, height: 1024 } }, { name: '1280', viewport: { width: 1280, height: 800 } }];
for (const size of SIZES) {
  const S = `owner-${size.name}`;
  const { ctx, page, errors } = await context(size.viewport);
  await page.goto(BASE + '/control.html#analytics', { waitUntil: 'domcontentloaded' });
  const ready = await settle(page);
  check(S, 'the globe is ready and draws countries', ready, await page.evaluate(() => window.__craGlobe && window.__craGlobe()));
  await page.waitForFunction(() => /Page views/.test((document.getElementById('craPanel') || {}).textContent || '') && document.querySelector('.cra-live.is-live'), null, { timeout: 30000 }).catch(() => {});
  const g = await page.evaluate(() => { const x = window.__craGlobe(); return { countries: x.countries, lakes: x.lakes, valued: x.valued, arcs: x.arcs, dots: x.dots, us: x.fill('US'), fr: x.fill('FR'), ca: x.fill('CA') }; });
  check(S, 'every Natural Earth 1:50m country is segmented (242), with the 1:50m lakes cut out', g.countries === 242 && g.lakes > 30, { countries: g.countries, lakes: g.lakes });
  const codes = g.valued.slice().sort();
  check(S, 'values only for countries with 5+: US, GB, BR, JP (CA under five and XX never carried)', JSON.stringify(codes) === JSON.stringify(['BR', 'GB', 'JP', 'US']), codes);
  check(S, 'no arcs and no dots on the globe at rest', g.arcs === 0 && g.dots === 0, g);
  const rest = await page.evaluate(() => window.__craGlobe().sphere);
  check(S, 'the whole sphere floats in the stage, never clipped', !!rest && rest.fits, rest);
  check(S, 'no choropleth: the US (61) is the same grey as Canada (3) and France (none)', !!g.us && !!g.ca && !!g.fr && JSON.stringify(g.us) === JSON.stringify(g.ca) && JSON.stringify(g.us) === JSON.stringify(g.fr) && Math.abs(g.us[0] - g.us[1]) < 12, g);
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
  check(S, 'no globe legend (nothing unselected is coloured)', ui.legend === '', ui.legend);
  check(S, 'filter pill and summary line', /Filters/.test(ui.pill) && /All countries/.test(ui.pill) && /24 hours · Page views · All sources/.test(ui.summary), { pill: ui.pill, summary: ui.summary });
  check(S, 'Reach (133 page views worldwide) and Audience (40 visitors) cards', /133/.test(ui.reach) && /Page views/.test(ui.reach) && /40/.test(ui.audience) && /New/.test(ui.audience) && /Returning/.test(ui.audience), { reach: ui.reach.slice(0, 120), audience: ui.audience.slice(0, 120) });
  check(S, 'Reach, Audience, Action carousels with dots', ['Reach', 'Audience', 'Action'].every((h) => ui.headings.includes(h)) && ui.dots >= 7, ui.headings);
  check(S, 'the owner bar: Play, Home, M, Analytics, Globe; Analytics is the current tab; the M is the supplied PNG', ui.bar && JSON.stringify(ui.tabs) === JSON.stringify(['music', 'admin-home', 'home', 'analytics', 'world']) && ui.here === 'analytics' && /assets\/img\/m-mark\.png$/.test(ui.mImg || ''), ui);
  check(S, 'no "Illustrative data" footnote on real screens', !ui.illustrative);
  let w = await widths(page);
  check(S, 'no sideways overflow (scrollWidth === clientWidth)', w.scrollW === w.clientW, w);
  const lay = await page.evaluate(() => {
    const r = (el) => el ? el.getBoundingClientRect() : null, chip = r(document.getElementById('mccAuthChip'));
    const hit = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const content = [...document.querySelectorAll('.cra-slide, .cra-h, .cra-top__title, .cra-top__me, .cra-top__controls, .cra-pill, .cra-top__eyebrow')].map(r);
    const aud = r(document.getElementById('craH-audience')), bar = r(document.querySelector('.appbar'));
    return { chip, overlaps: content.filter((c) => hit(chip, c)).length, audTop: aud && aud.top, barTop: bar && bar.top, vh: innerHeight };
  });
  check(S, 'the Admin chip never covers content', lay.overlaps === 0, lay);
  const aud = await page.evaluate(() => { const a = document.querySelector('[data-cra-slide="audience"]'), bar = document.querySelector('.appbar').getBoundingClientRect(); let r = a.getBoundingClientRect(); scrollBy({ top: r.bottom - (bar.top - 8), behavior: 'instant' }); r = a.getBoundingClientRect(); const out = { top: r.top, bottom: r.bottom, barTop: bar.top, h: r.height }; scrollTo({ top: 0, behavior: 'instant' }); return out; });
  check(S, 'the Audience card below Reach scrolls into full view above the bottom bar', aud.h > 100 && aud.top >= 0 && aud.bottom <= aud.barTop + 1, aud);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, `analytics-${size.name}.png`) });

  /* select from the dropdown: the globe flies there and the cards follow */
  await page.selectOption('#craCountry', 'US');
  await page.waitForFunction(() => { const x = window.__craGlobe(); return x.selected === 'US' && x.statesFor === 'US' && x.look && Math.abs(x.look.lon + 96) < 6 && Math.abs(x.look.lat - 38) < 8; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const sel = await page.evaluate(() => ({ g: window.__craGlobe(), us: window.__craGlobe().fill('US'), reach: document.querySelector('[data-cra-slide="reach"]').textContent, aud: document.querySelector('[data-cra-slide="audience"]').textContent, pill: document.querySelector('[data-cra-pill]').textContent, opts: [...document.querySelectorAll('#craCountry option')].map((o) => o.value) }));
  check(S, 'dropdown -> the globe turns the lower 48 to face the viewer and keeps the whole sphere in view', sel.g.selected === 'US' && NEAR(sel.g.look, -96, 38, 8) && sel.g.sphere.fits, { look: sel.g.look, sphere: sel.g.sphere });
  check(S, 'the selection is the accent fill, with one white dot, no arcs', !!sel.us && sel.us[0] > 180 && sel.us[1] < 70 && sel.g.dots === 1 && sel.g.arcs === 0, { us: sel.us, dots: sel.g.dots });
  check(S, 'the US states load for the selected country only (51) and join the dropdown', sel.g.statesFor === 'US' && sel.g.states === 51 && sel.opts.includes('US/US-CT') && sel.opts.includes('US/US-TX'), { statesFor: sel.g.statesFor, states: sel.g.states, n: sel.opts.length });
  check(S, 'dropdown -> Reach says 61 page views · United States, 133 worldwide', /61/.test(sel.reach) && /United States · 24 hours/.test(sel.reach) && /133 worldwide/.test(sel.reach), sel.reach.slice(0, 160));
  check(S, 'dropdown -> Audience says 18 visitors in the United States (pending read fixture)', /18/.test(sel.aud) && /United States/.test(sel.aud), sel.aud.slice(0, 160));
  check(S, 'the tooltip reads "United States 61 page views"', /United States/.test(sel.g.tip || '') && /61 page views/.test(sel.g.tip || ''), sel.g.tip);
  check(S, 'Filters (1) counts the country', /Filters1/.test(sel.pill.replace(/\s+/g, '')), sel.pill);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, `analytics-${size.name}-us.png`) });

  /* a state from the dropdown: the globe flies to it and labels it in its country */
  await page.selectOption('#craCountry', 'US/US-CT');
  await page.waitForFunction(() => { const x = window.__craGlobe(); return x.state === 'US-CT' && x.look && Math.abs(x.look.lon + 72.7) < 1.5 && Math.abs(x.look.lat - 41.6) < 1.5 && x.camera.height < 2e6; }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const ct = await page.evaluate(() => ({ g: window.__craGlobe(), fill: window.__craGlobe().stateFill('US-CT'), ny: window.__craGlobe().stateFill('US-NY'), us: window.__craGlobe().fill('US'), dd: document.getElementById('craCountry').value, reach: document.querySelector('[data-cra-slide="reach"]').textContent, cap: document.querySelector('[data-cra-globe-caption]').textContent }));
  check(S, 'dropdown -> Connecticut (too small to see from the whole-sphere view): approached at an angle, centred, the curve of the Earth kept', ct.g.state === 'US-CT' && NEAR(ct.g.look, -72.7, 41.6, 1.5) && ct.g.camera.height < 2e6 && ct.g.camera.pitch > -60 && ct.g.camera.pitch < -20, { look: ct.g.look, cam: ct.g.camera });
  check(S, 'Connecticut alone is the accent; New York (14 views) stays grey; the US steps back to context grey', !!ct.fill && ct.fill[0] > 180 && ct.fill[1] < 70 && !!ct.ny && Math.abs(ct.ny[0] - ct.ny[1]) < 12 && !!ct.us && Math.abs(ct.us[0] - ct.us[1]) < 12, { ct: ct.fill, ny: ct.ny, us: ct.us });
  check(S, 'the label reads "United States / Connecticut / 22 page views"', /United States/.test(ct.g.tip || '') && /Connecticut/.test(ct.g.tip || '') && /22 page views/.test(ct.g.tip || ''), ct.g.tip);
  check(S, 'Reach follows the state: 22 · Connecticut · 24 hours, with its country (United States: 61)', /22/.test(ct.reach) && /Connecticut · 24 hours/.test(ct.reach) && /United States: 61/.test(ct.reach), ct.reach.slice(0, 160));
  check(S, 'the caption reports the state fold honestly (3 with 5+, under 5 folded 7, no region 9)', /by state: 3 with 5\+ · under 5 folded 7 · no region 9/.test(ct.cap), ct.cap);
  await page.screenshot({ path: join(SHOTS, `analytics-${size.name}-us-ct.png`) });

  /* back to the US, then tap Texas on the globe: the dropdown follows */
  await page.selectOption('#craCountry', 'US');
  await page.waitForFunction(() => { const x = window.__craGlobe(); return x.state === null && x.camera && x.camera.height > 3e6; }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const txy = await page.evaluate(() => window.__craGlobeProject && window.__craGlobeProject('US-TX'));
  if (txy) {
    const r = await page.evaluate(() => { const c = document.querySelector('.crg-canvas canvas').getBoundingClientRect(); return { x: c.left, y: c.top }; });
    if (size.viewport.width < 600) await page.touchscreen.tap(r.x + txy.x, r.y + txy.y); else await page.mouse.click(r.x + txy.x, r.y + txy.y);
    await page.waitForFunction(() => window.__craGlobe().state === 'US-TX', null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1100);
  }
  const tx = await page.evaluate(() => ({ g: window.__craGlobe(), dd: document.getElementById('craCountry').value, label: (document.getElementById('craCountry').selectedOptions[0] || {}).textContent }));
  check(S, 'tap Texas on the globe -> the dropdown shows Texas (under the United States)', !!txy && tx.g.state === 'US-TX' && tx.dd === 'US/US-TX' && tx.label === 'Texas', { txy, state: tx.g.state, dd: tx.dd, label: tx.label });
  check(S, 'Texas has no region row: the label says so instead of a number', /Texas/.test(tx.g.tip || '') && /Under 5 or none/.test(tx.g.tip || ''), tx.g.tip);
  check(S, 'tap -> the view centres on Texas', NEAR(tx.g.look, -99.5, 31, 4), { look: tx.g.look, cam: tx.g.camera });
  await page.screenshot({ path: join(SHOTS, `analytics-${size.name}-us-tx.png`) });

  /* Clear with a state selected -> the world view, nothing selected, no state lines */
  await page.click('[data-cra-clear]');
  await page.waitForFunction(() => { const x = window.__craGlobe(); return x.selected === null && x.camera && x.camera.height > 1e7; }, null, { timeout: 8000 }).catch(() => {});
  const world = await page.evaluate(() => ({ g: window.__craGlobe(), dd: document.getElementById('craCountry').value }));
  check(S, 'Clear -> the world: nothing selected, the dropdown says All countries, states dropped, camera home', world.g.selected === null && world.g.state === null && world.g.statesFor === null && world.g.dots === 0 && world.dd === '' && world.g.camera.height > 1e7, { sel: world.g.selected, statesFor: world.g.statesFor, cam: world.g.camera, dd: world.dd });
  await page.waitForTimeout(600);
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

  /* Japan: a country with no traffic is still selectable; drawn at 1:10m with its prefectures */
  await page.selectOption('#craCountry', 'JP');
  await page.waitForFunction(() => { const x = window.__craGlobe(); return x.selected === 'JP' && x.statesFor === 'JP' && x.look && Math.abs(x.look.lon - 137) < 8 && Math.abs(x.look.lat - 36) < 8; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const jp = await page.evaluate(() => ({ g: window.__craGlobe(), fill: window.__craGlobe().fill('JP') }));
  check(S, 'dropdown -> Japan (no traffic): selected, 47 prefectures loaded, the camera over Japan, accent fill', jp.g.selected === 'JP' && jp.g.states === 47 && NEAR(jp.g.look, 137, 36, 8) && jp.g.sphere.fits && !!jp.fill && jp.fill[0] > 180, { states: jp.g.states, look: jp.g.look, sphere: jp.g.sphere, fill: jp.fill, tip: jp.g.tip });
  await page.screenshot({ path: join(SHOTS, `analytics-${size.name}-jp.png`) });
  await page.click('[data-cra-clear]');
  await page.waitForTimeout(1200);

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
  const cam = await page.evaluate(() => ({ look: window.__craGlobe().look, sphere: window.__craGlobe().sphere }));
  check('reduced-390', 'reduced motion: the view is already on the UK, whole sphere in view (no flight)', NEAR(cam.look, -2.5, 54, 5) && cam.sphere.fits, cam);
  await page.waitForFunction(() => window.__craGlobe().statesFor === 'GB', null, { timeout: 10000 }).catch(() => {});
  await page.selectOption('#craCountry', 'US');
  await page.waitForFunction(() => window.__craGlobe().statesFor === 'US', null, { timeout: 10000 }).catch(() => {});
  await page.selectOption('#craCountry', 'US/US-CA');
  await page.waitForTimeout(300);
  const pend = await page.evaluate(() => ({ g: window.__craGlobe(), cap: document.querySelector('[data-cra-globe-caption]').textContent }));
  check('reduced-390', 'region counts pending: California is still selectable and mapped, its label says "not collected yet"', pend.g.state === 'US-CA' && NEAR(pend.g.look, -119.5, 37, 5) && /not collected yet/.test(pend.g.tip || '') && /not collected yet/.test(pend.cap), { state: pend.g.state, look: pend.g.look, tip: pend.g.tip, cap: pend.cap });
  await page.screenshot({ path: join(SHOTS, 'analytics-390-pending-state.png') });
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
