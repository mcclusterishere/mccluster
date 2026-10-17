/* The admin analytics globe, owner 2026-10-16: one selection shared by the console and the globe, countries drawn
   at 1:50m (the selected one at 1:10m), states and provinces for every country fetched on demand, state counts
   admin-only (pending read, folded under 5), a grey sphere that lights up only for the selection, one accent token. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import vm from 'node:vm';

const read = (p) => readFile(p, 'utf8');
async function globeLib() {
  const ctx = { window: { CR: {} }, console };
  vm.createContext(ctx);
  vm.runInContext(await read('js/control-room/analytics-globe.js'), ctx);
  return ctx.window.CR.analyticsGlobe;
}
async function panel() {
  const ctx = { window: { CR: {} }, console, fetch: () => new Promise(() => {}) };
  vm.createContext(ctx);
  vm.runInContext(await read('js/control-room/analytics-globe.js'), ctx);
  vm.runInContext(await read('js/control-room/analytics.js'), ctx);
  const A = ctx.window.CR.analytics;
  A.state.geo.layer="pageviews";A.state.ui.reach="views";
  const asked = [];
  A.init({ request: (u) => { asked.push(u); return new Promise(() => {}); }, supa: () => Promise.resolve([]) });
  A.state.range = { id: '24h', label: '24 hours', since: '2026-10-15T00:00:00Z', until: '2026-10-16T00:00:00Z' };
  A.state.geo.places = { US: [-97.48, 39.54, 'United States'], GB: [-2.12, 54.4, 'United Kingdom'] };
  Object.assign(A.state.data, { traffic: { byHour: [], byDay: [], totals: { page_views: 133, visitors: 40 }, sources: [], countries: [], networks: [], pages: [] }, geo: [{ key: 'US', n: 61 }] });
  return { A, asked };
}

test('region rows map onto state shapes by code, then name, then grouping; nothing is guessed', async () => {
  const G = await globeLib();
  const US = JSON.parse(await read('data/geo/admin1/US.json'));
  const m = G.matchRegions(US.states, [{ code: 'CT', name: 'Connecticut', page_views: 22 }, { code: null, name: 'New York', page_views: 14 }, { code: 'ZZ', name: 'Atlantis', page_views: 9 }]);
  assert.equal(m.byKey['US-CT'].value, 22);
  assert.equal(m.byKey['US-NY'].value, 14);
  assert.equal(m.unmatched, 9, 'an unknown region is counted, never placed');
  const GB = JSON.parse(await read('data/geo/admin1/GB.json'));
  const g = G.matchRegions(GB.states, [{ code: 'ENG', name: 'England', page_views: 40 }]);
  const keys = Object.keys(g.byKey);
  assert.ok(keys.length > 20 && keys.every((k) => g.byKey[k].area === 'England'), 'a UK nation lights its councils as one area');
  const box = G.fitBox(US.outline, 6);
  assert.ok(box[0] > -140 && box[2] < -50 && box[2] - box[0] < 80 && box[1] > 15 && box[3] < 56, 'the US fits the lower 48, not Alaska + Hawaii: ' + box);
});

test('data: Natural Earth admin-1 for every country, one file each, public domain, with a 1:10m outline', async () => {
  const idx = JSON.parse(await read('data/geo/admin1/index.json'));
  assert.match(idx.license, /Public domain/);
  assert.match(idx.version, /v5\.1\.2/);
  assert.match(idx.use, /Admin analytics only/);
  const files = (await readdir('data/geo/admin1')).filter((f) => /^[A-Z]{2}\.json$/.test(f));
  assert.ok(files.length >= 230, 'states for all countries: ' + files.length);
  assert.equal(Object.keys(idx.countries).length, files.length);
  let biggest = 0;
  for (const f of files) biggest = Math.max(biggest, (await stat('data/geo/admin1/' + f)).size);
  assert.ok(biggest < 250000, 'a phone downloads one country, never a heavy one (Russia is the largest): ' + biggest);
  const US = JSON.parse(await read('data/geo/admin1/US.json'));
  assert.equal(US.states.length, 51);
  const ct = US.states.find((s) => s.k === 'US-CT');
  assert.ok(ct && ct.codes.includes('CT') && ct.names.includes('connecticut') && ct.l[0] < -72 && ct.l[1] > 41);
  assert.ok(Array.isArray(US.outline) && US.outline.length > 10, 'the country at 1:10m, the dissolve of its states');
  const JP = JSON.parse(await read('data/geo/admin1/JP.json'));
  assert.equal(JP.states.length, 47);
  const tool = await read('tools/build-admin1-boundaries.mjs');
  assert.match(tool, /ne_10m_admin_1_states_provinces\.geojson/);
  assert.match(tool, /-dissolve iso_a2/);
});

test('data: 1:50m countries and large lakes, delta-encoded, small enough for a phone', async () => {
  const text = await read('data/geo/country-boundaries-50m.json');
  assert.ok(text.length < 700000, 'raw ' + text.length);
  const b = JSON.parse(text);
  assert.match(b.source, /1:50m/);
  assert.match(b.license, /Public domain/);
  assert.match(b.encoding, /^delta-0\.01/);
  assert.equal(b.countries.length, 242);
  assert.ok(b.lakes.length >= 30 && b.lakes.length <= 80);
  const us = b.countries.find((c) => c.c === 'US');
  /* first vertex absolute, the rest small integer steps */
  const r = us.p[0][0];
  assert.ok(r.every((v) => Number.isInteger(v)) && Math.abs(r[0]) <= 18000);
  /* the 110m file stays for the World globe */
  assert.equal(JSON.parse(await read('data/geo/country-boundaries-110m.json')).countries.length, 177);
});

test('applied region read: admin only (service_role), folds under 5, never finer than a region', async () => {
  const sql = await read('supabase/migrations/20261017030554_analytics_region_v1.sql');
  const ledger = JSON.parse(await read('supabase/production-ledger.json'));
  assert.ok(ledger.migrations.some(m => m.name === 'analytics_region_v1' && m.version === '20261017030554'));
  assert.match(sql, /revoke all on function public\.analytics_region_totals\(text, timestamptz, timestamptz, uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.analytics_region_totals\(text, timestamptz, timestamptz, uuid\) to service_role;/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /to authenticated/);
  assert.match(sql, /drop function if exists public\.analytics_region_totals/);
  assert.match(sql, /per\.pv >= 5/);
  assert.match(sql, /between 1 and 4/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''"), /\b(city|postal|latitude|longitude|asn|ip)\b/, 'no such column is read (comments and strings aside)');
  const router = await read('workers/mccluster/src/analytics/router.js');
  assert.match(router, /if \(path === '\/v1\/analytics\/regions'\)/);
  assert.match(router, /async function handleRegionAnalytics\(request, env, user, url\) \{\n  await requireHouseOwner\(env, user\);/);
});

test('one selection: the dropdown value "US/US-CT" selects the state in its country; Clear returns to the world', async () => {
  const { A, asked } = await panel();
  A.geo.pick('US/US-CT', false);
  assert.equal(A.state.geo.region, 'US');
  assert.equal(A.state.geo.state, 'US-CT');
  const p = A.geo.payload();
  assert.equal(p.selected, 'US');
  assert.equal(p.state, 'US-CT');
  assert.ok(asked.some((u) => /^\/v1\/analytics\/regions\?country=US&since=/.test(u)), 'the state counts are read for the selected country');
  /* a state that does not belong to the country is refused */
  A.geo.select({ country: 'GB', state: 'US-CT' }, false);
  assert.equal(A.state.geo.region, 'GB');
  assert.equal(A.state.geo.state, null);
  /* pending: the label says so instead of a number */
  A.state.geo.adm.US = JSON.parse(await read('data/geo/admin1/US.json'));
  A.geo.select({ country: 'US', state: 'US-CT' }, false);
  const k = Object.keys(A.state.geo.rg).find((x) => x.startsWith('US|'));
  A.state.geo.rg[k] = { ok: true, pending: true, regions: [] };
  const t = A.geo.tooltip({ country: 'US', state: 'US-CT' });
  assert.equal(t.title, 'Connecticut');
  assert.equal(t.context, 'United States');
  assert.equal(t.line, 'State counts not collected yet');
  A.state.geo.rg[k] = { ok: true, pending: false, regions: [{ code: 'CT', name: 'Connecticut', page_views: 22 }], folded: 3, unknown: 1 };
  assert.equal(A.geo.tooltip({ country: 'US', state: 'US-CT' }).line, '22 page views');
  assert.match(A.render(), /Connecticut · 24 hours/);
  A.geo.pick('', false);
  assert.equal(A.state.geo.region, null);
  assert.equal(A.state.geo.state, null);
});

test('a measured heat map without arcs; state files stay admin-only', async () => {
  const globe = await read('js/control-room/analytics-globe.js');
  assert.doesNotMatch(globe, /arcPositions|glowImage|bucket\(/);
  assert.equal((globe.match(/new Cs\.BillboardCollection/g) || []).length, 1, 'the one white dot at the selected place');
  assert.match(globe, /Cs\.Color\.lerp\(C\.land,C\.accent/);
  assert.match(globe, /return C\.land;/);
  const js = await read('js/control-room/analytics.js');
  assert.doesNotMatch(js, /data-cra-legend|ORIGIN/);
  for (const f of ['js/action-globe.js', 'js/mnet.js', 'js/world-globe.js']) {
    const src = await read(f).catch(() => '');
    assert.doesNotMatch(src, /admin1|analytics\/regions/, f + ' must never load state data');
  }
  const html = await read('control.html');
  assert.match(html, /js\/control-room\/analytics-globe\.js/);
});

test('one accent token: --an-accent drives every red on the analytics screen', async () => {
  const css = await read('css/control-analytics.css');
  const charcoal = css.slice(css.indexOf('THE CHARCOAL ANALYTICS'), css.indexOf('/* the Control Room around it'));
  assert.equal((charcoal.match(/--an-accent:/g) || []).length, 1);
  const noDefs = charcoal.replace(/--an-accent:#[0-9a-f]{6}/i, '');
  assert.doesNotMatch(noDefs, /#(e11d2e|ff2b3c|d42032|7a1f29|ff3d5e|ff3346|e5383b)|rgba\((255,43,60|225,29,46|229,56,59)/i);
  assert.match(charcoal, /\.cra-seg__b\.is-on\{background:var\(--an-accent-ruby\)/);
  assert.match(charcoal, /\.cra-ac__line\{[^}]*stroke:var\(--an-accent\)/);
  assert.match(charcoal, /--an-rim:/);
  const js = await read('js/control-room/analytics.js');
  assert.doesNotMatch(js.slice(js.indexOf('function area(')), /#ff2b3c/);
});

test('polish: quiet inner lines, one crisp edge, whole sphere for a country, the Admin chip out of the content', async () => {
  const globe = await read('js/control-room/analytics-globe.js');
  assert.doesNotMatch(globe, /PolylineGlow/, 'no wide glow line: it spikes at every miter of a jagged coast');
  assert.match(globe, /var faint = Cs\.Color\.lerp\(C\.accent, C\.earth, 0\.55, new Cs\.Color\(\)\)\.withAlpha\(0\.55\);/);
  assert.match(globe, /edge\(main, 9000, C\.outline, 1\.5\);/);
  assert.match(globe, /homeAltitude\(0\.9\)/, 'a country is turned to face the viewer, the sphere stays whole');
  assert.match(globe, /spanDeg \* pxPerDeg >= 40/, 'only a state under about 40 px is approached');
  assert.match(globe, /HeadingPitchRange\(0, Cs\.Math\.toRadians\(-40\), range\)/, 'approached at an angle so the limb stays in view');
  assert.match(globe, /msaaSamples: 4/);
  const css = await read('css/control-analytics.css');
  assert.match(css, /body\.cr\[data-cr-surface="analytics"\] \.mcc-auth-chip\{position:absolute;top:/);
  assert.doesNotMatch(css, /@media[^{]*max-width/);
});
