/* THE ENVIRONMENTAL GLOBE'S PUBLIC LAYERS (./src/world-environment-layers.js), reached the way the
   Worker reaches them: through handleWorldEnvironment, behind the persisted environment module policy.
   Fake fetch and an in-memory cache only (the offline guard refuses anything else). Fixtures under
   test/fixtures/environment/ are small real samples of public-domain U.S. Government data, trimmed;
   anything built here in code is labelled as built. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { handleWorldEnvironment, environmentGate } from '../src/world-environment.js';
import { FIRES, LAYER_SOURCES, fetchFirmsSatellite, GEOMETRY, strictRing, strictPolygons, strictLine, publicPerimetersQuery, PERIMETERS, TIDE_LATEST_STATIONS, TIDES_PUBLIC, latestWaterLevelUrl } from '../src/world-environment-layers.js';
import { TIDES, waterLevelUrl } from '../src/world-halo-ops.js';
import { SHAKEMAP, USGS_EVENT_ID, shakemapDetailUrl, readShakemapContours } from '../src/world-environment-layers.js';
import { environmentFeed } from '../src/world-environment.js';
import { ENVIRONMENT_PUBLIC_ROUTES, environmentRouteForPath, globeFeatureForPath } from '../../../packages/release-policy/globe.mjs';
import { guardWorldRelease } from '../src/world-release.js';
import { workersFetch } from './support/workers-fetch-semantics.mjs';
registerHooks({ resolve(s, c, n) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true }; return n(s, c); }, load(u, c, n) { if (/\.html$/.test(u)) return { format: 'module', source: 'export default ' + JSON.stringify(readFileSync(new URL(u), 'utf8')) + ';', shortCircuit: true }; return n(u, c); } });
const { default: core } = await import('../src/index.js');

const ORIGIN = 'https://mccluster.org';
const FIRMS_KEY = 'firms-map-key-SECRET-0123456789abcdef';
const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', ALLOWED_ORIGINS: ORIGIN };
const P = '/v1/world/environment';
const LAYER_PATHS = [`${P}/layers/fires`, `${P}/layers/perimeters`, `${P}/layers/alerts`, `${P}/layers/eonet`, `${P}/layers/tides`, `${P}/tides/8518750`, `${P}/quakes/us7000tyhr/shakemap`];
/* every mapped route is served */
const SERVED_PATHS = LAYER_PATHS;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const text = (body, status = 200, type = 'text/plain') => new Response(body, { status, headers: { 'content-type': type } });
const req = (path, { method = 'GET', auth = false } = {}) => new Request(`https://api.mccluster.org${path}`, { method, headers: { origin: ORIGIN, ...(auth ? { authorization: 'Bearer member' } : {}) } });
function memoryCache() {
  const raw = new Map();
  return { raw, async match(k) { return raw.has(k.url) ? new Response(raw.get(k.url)) : undefined; }, async put(k, r) { raw.set(k.url, await r.text()); } };
}
function age(cache, seconds) {
  for (const [k, v] of cache.raw) {
    const b = JSON.parse(v);
    if (typeof b.fetched_at !== 'string') continue;
    b.fetched_at = new Date(Date.parse(b.fetched_at) - seconds * 1000).toISOString();
    cache.raw.set(k, JSON.stringify(b));
  }
}
const headersOk = (r) => {
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('vary'), 'origin, authorization');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
};
const POLICY_RPC = '/rest/v1/rpc/eup_module_policy_read';
const policyOf = (state = 'enabled', revision = 3) => ({ schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: 'environment', state, revision });
const isPolicyRead = (c) => c.url.endsWith(POLICY_RPC);
/* the policy store plus whatever providers a test supplies; every call is logged */
function world(providers = (url) => { throw new Error('no provider expected: ' + url.href); }, { policy = policyOf() } = {}) {
  return workersFetch(async (url, init, call) => {
    if (url.href.endsWith(POLICY_RPC)) {
      const answer = typeof policy === 'function' ? policy() : policy;
      if (answer instanceof Error) throw answer;
      return answer instanceof Response ? answer.clone() : json(answer);
    }
    return providers(url, init, call);
  });
}
const providerCalls = (f) => f.calls.filter((c) => !c.url.endsWith(POLICY_RPC));
const HEALTH_KEYS = ['attribution', 'coverage', 'fetched_at', 'id', 'label', 'last_success_at', 'license', 'reason', 'status', 'url'];
/* nothing about people, Halo or the owner's feeds may ride along on a public answer */
const PRIVATE = /user_id|m_uid|assignment|profile|display_name|email|aircraft|vessel|callsign|mmsi|squawk|cctv|camera|halo|owner/i;
function publicOnly(body) {
  const raw = JSON.stringify(body);
  assert.equal(raw.includes(FIRMS_KEY), false, 'the FIRMS key never appears');
  assert.equal(raw.includes('server-secret'), false, 'the service key never appears');
  for (const key of keysOf(body)) assert.doesNotMatch(key, PRIVATE, `no private field (${key})`);
}
function keysOf(v, out = new Set()) {
  if (Array.isArray(v)) { for (const x of v) keysOf(x, out); } else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); } }
  return out;
}

/* ---------- the release policy and the gate ---------- */
test('the release policy maps every public environmental path to the environment module, and none of them to a Halo feature', () => {
  /* event timeline slice S5 (changed on purpose): a quake's documented rupture joins the public routes, behind the same gate */
  assert.deepEqual(ENVIRONMENT_PUBLIC_ROUTES.map((r) => r.id), ['feed', 'fires', 'perimeters', 'alerts', 'eonet', 'tides', 'water-level', 'shakemap', 'rupture']);
  assert.deepEqual(environmentRouteForPath(P), { id: 'feed', module: 'environment', param: null });
  for (const path of LAYER_PATHS) {
    const route = environmentRouteForPath(path);
    assert.equal(route.module, 'environment', path);
    assert.equal(globeFeatureForPath(path), null, `${path} is public, not an owner-only globe feature`);
  }
  assert.equal(environmentRouteForPath(`${P}/tides/8518750`).param, '8518750');
  assert.equal(environmentRouteForPath(`${P}/quakes/us7000tyhr/shakemap`).param, 'us7000tyhr');
  for (const path of ['/v1/world/layers/fires', '/v1/world/layers/perimeters', '/v1/world/layers/tides', '/v1/world/tides/8518750', '/v1/world/layers/quakes', '/v1/world/layers/weather', '/v1/world/layers/natural', `${P}/team`, `${P}/layers`, `${P}/layers/fires/x`, `${P}/quakes/x`, `${P}x/layers/fires`]) {
    assert.equal(environmentRouteForPath(path), null, path);
  }
  for (const [path, feature] of [['/v1/world/layers/fires', 'fires'], ['/v1/world/layers/perimeters', 'perimeters'], ['/v1/world/layers/tides', 'tides'], ['/v1/world/tides/8518750', 'tides'], ['/v1/world/layers/quakes', 'quakes'], ['/v1/world/layers/weather', 'weather'], ['/v1/world/layers/natural', 'natural'], ['/v1/world/halo/people', 'halo-ops']]) {
    assert.equal(globeFeatureForPath(path), feature, `${path} stays an owner-only feature`);
  }
});

test('the release guard leaves the public environmental paths to their own gate and still refuses the Halo paths before dispatch', async () => {
  const noAuth = () => { throw new Error('the guard must not ask anyone about a public path'); };
  for (const path of [P, ...LAYER_PATHS]) assert.equal(await guardWorldRelease(req(path), ENV, { fetchImpl: noAuth }), null, path);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const s = String(url);
      if (s.endsWith('/auth/v1/user')) return json({ id: '11111111-1111-4111-8111-111111111111' });
      if (s.includes('/orgs?')) return json([{ id: 'house' }]);
      if (s.includes('/org_members?')) return json([]);
      throw new Error('a refused Halo request must not reach a provider: ' + s);
    };
    for (const auth of [false, true]) {
      for (const path of ['/v1/world/layers/fires', '/v1/world/layers/perimeters', '/v1/world/layers/weather', '/v1/world/layers/natural', '/v1/world/layers/quakes', '/v1/world/layers/cyclones', '/v1/world/layers/tides', '/v1/world/tides/8518750', '/v1/world/halo/missions', '/v1/world/halo/people', '/v1/world/layers/military', '/v1/world/layers/vessels']) {
        const r = await core.fetch(req(path, { auth }), { ...ENV, FIRMS_MAP_KEY: FIRMS_KEY, AISSTREAM_API_KEY: 'k' });
        assert.equal(r.status, 403, `${path} refuses a ${auth ? 'member' : 'guest'}`);
        assert.equal((await r.json()).code, 'admin_preview');
      }
    }
  } finally { globalThis.fetch = original; }
});

/* E=UP slice S0 (2026-11-19), changed on purpose: a module never installed (EUM01) is off on every layer route, the disabled answer */
test('a module never installed (EUM01) is off on every new route: 404 module_disabled, before any provider is asked', async () => {
  for (const path of LAYER_PATHS) {
    const f = world(undefined, { policy: () => json({ code: 'EUM01', message: 'module_not_installed' }, 400) });
    const r = await handleWorldEnvironment(req(path), { ...ENV, FIRMS_MAP_KEY: FIRMS_KEY }, { fetchImpl: f, cacheImpl: memoryCache() });
    assert.equal(r.status, 404, path); headersOk(r);
    assert.deepEqual(await r.json(), { ok: false, code: 'module_disabled' }, path);
    assert.equal(f.calls.length, 1, `${path}: only the policy read`); assert.ok(isPolicyRead(f.calls[0]));
  }
});
test('a missing, unapplied, unreachable or malformed policy is 503 module_policy_unavailable on every new route, before any provider is asked', async () => {
  const refusals = [
    ['policy schema not applied (PGRST202)', json({ code: 'PGRST202', message: 'Could not find the function' }, 404)],
    ['a policy function missing (42883)', json({ code: '42883', message: 'function does not exist' }, 404)],
    ['store answers 500', json({ message: 'boom' }, 500)],
    ['store redirects', new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } })],
    ['store unreachable', new Error('offline')],
    ['empty answer', {}], ['null answer', null],
    ['another installation', { ...policyOf(), installationId: 'elsewhere' }],
    ['another module', { ...policyOf(), moduleId: 'league' }],
    ['unknown state', { ...policyOf(), state: 'on' }],
    ['text revision', { ...policyOf(), revision: '3' }]
  ];
  for (const [label, answer] of refusals) {
    for (const path of LAYER_PATHS) {
      const f = world(undefined, { policy: () => answer });
      const r = await handleWorldEnvironment(req(path), { ...ENV, FIRMS_MAP_KEY: FIRMS_KEY }, { fetchImpl: f, cacheImpl: memoryCache() });
      assert.equal(r.status, 503, `${label} ${path}`); headersOk(r);
      assert.deepEqual(await r.json(), { ok: false, code: 'module_policy_unavailable' }, label);
      assert.equal(f.calls.length, 1, `${label} ${path}: only the policy read`); assert.ok(isPolicyRead(f.calls[0]));
      assert.equal(f.calls[0].init.headers.authorization, 'Bearer server-secret');
      assert.deepEqual(JSON.parse(f.calls[0].init.body), { p_module: 'environment' });
    }
  }
  for (const path of LAYER_PATHS) {
    const f = world();
    const r = await handleWorldEnvironment(req(path), {}, { fetchImpl: f, cacheImpl: memoryCache() });
    assert.equal(r.status, 503); assert.equal((await r.json()).code, 'module_policy_unavailable'); assert.equal(f.calls.length, 0, 'no store configured: nobody is asked');
  }
});

test('every new route answers each policy state exactly as GET /v1/world/environment does: disabled 404, draining and enabled read', async () => {
  for (const [state, status, code] of [['disabled', 404, 'module_disabled'], ['draining', 200, null], ['enabled', 200, null]]) {
    const feed = await handleWorldEnvironment(req(P), ENV, { fetchImpl: world(feedProviders, { policy: policyOf(state, 4) }), cacheImpl: memoryCache() });
    assert.equal(feed.status, status, `feed ${state}`);
    if (code) assert.deepEqual(await feed.json(), { ok: false, code });
    for (const path of code ? LAYER_PATHS : SERVED_PATHS) {
      const f = world(() => text('down', 503), { policy: policyOf(state, 4) });
      const r = await handleWorldEnvironment(req(path), ENV, { fetchImpl: f, cacheImpl: memoryCache() });
      assert.equal(r.status, status, `${path} ${state}`); headersOk(r);
      if (code) { assert.deepEqual(await r.json(), { ok: false, code }); assert.equal(f.calls.length, 1, 'refused before any provider'); }
      else assert.ok(Array.isArray((await r.json()).sources), `${path} ${state} reports its sources`);
    }
  }
  /* the policy is read again on every request: nothing is remembered between them */
  let state = 'enabled';
  const f = world(() => text('down', 503), { policy: () => policyOf(state, state === 'enabled' ? 3 : 5) });
  assert.equal((await handleWorldEnvironment(req(`${P}/layers/fires`), ENV, { fetchImpl: f, cacheImpl: memoryCache() })).status, 200);
  state = 'disabled';
  assert.equal((await handleWorldEnvironment(req(`${P}/layers/fires`), ENV, { fetchImpl: f, cacheImpl: memoryCache() })).status, 404);
  assert.equal(f.calls.filter(isPolicyRead).length, 2);
});
function feedProviders(url) {
  if (url.hostname === 'api.weather.gov') return json({ features: [] });
  if (url.hostname === 'eonet.gsfc.nasa.gov') return json({ events: [] });
  if (url.hostname === 'earthquake.usgs.gov') return json({ metadata: { generated: Date.now() }, features: [] });
  if (url.hostname === 'www.nhc.noaa.gov') return json({ activeStorms: [] });
  if (url.hostname === 'db.example') return json([]);
  throw new Error('unexpected ' + url);
}

test('the gate itself: the module policy decides, by the pinned product\'s rules', async () => {
  const gate = (policy, method = 'GET') => environmentGate(req(P, { method }), ENV, world(undefined, { policy }));
  assert.equal(await gate(policyOf('enabled')), null);
  assert.equal(await gate(policyOf('draining')), null, 'draining still answers reads');
  assert.deepEqual({ ...(await gate(policyOf('draining'), 'POST')) }, { code: 'module_draining', status: 503 });
  assert.deepEqual({ ...(await gate(policyOf('disabled'))) }, { code: 'module_disabled', status: 404 });
  assert.deepEqual(await gate({}), { code: 'module_policy_unavailable', status: 503 });
});

test('the new routes are GET only, other paths in their namespaces are 404 after the gate, and the product keeps every other path', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
    const f = world();
    const r = await handleWorldEnvironment(req(`${P}/layers/fires`, { method }), ENV, { fetchImpl: f, cacheImpl: memoryCache() });
    assert.equal(r.status, 405, method); assert.deepEqual(await r.json(), { ok: false, code: 'method_not_allowed' });
    assert.equal(providerCalls(f).length, 0);
  }
  for (const path of [`${P}/layers`, `${P}/layers/flights`, `${P}/layers/military`, `${P}/layers/fires/extra`, `${P}/tides`, `${P}/tides/8518750/extra`, `${P}/quakes`, `${P}/quakes/us1`, `${P}/quakes/us1/dyfi`]) {
    const f = world();
    const r = await handleWorldEnvironment(req(path), ENV, { fetchImpl: f, cacheImpl: memoryCache() });
    assert.equal(r.status, 404, path); assert.deepEqual(await r.json(), { ok: false, code: 'not_found' }); headersOk(r);
    assert.equal(providerCalls(f).length, 0);
  }
  /* a guest asking for the team is still the pinned product's 401, not a layer */
  const team = await handleWorldEnvironment(req(`${P}/team`), ENV, { fetchImpl: world(), cacheImpl: memoryCache() });
  assert.equal(team.status, 401); assert.equal((await team.json()).code, 'sign_in_required');
});

/* ---------- fires ---------- */
const FIRMS_HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
/* one VIIRS row acquired `minutesAgo` before now (built here, in the provider's column order) */
function firmsRow(lat, lon, frp, minutesAgo, { conf = 'n', dn = 'D', sat = 'N20' } = {}) {
  const t = new Date(Date.now() - minutesAgo * 60000);
  const date = t.toISOString().slice(0, 10), hhmm = t.toISOString().slice(11, 16).replace(':', '');
  return [lat, lon, 330.5, 0.39, 0.36, date, String(Number(hhmm)), sat, 'VIIRS', conf, '2.0NRT', 290.1, frp, dn].join(',');
}
function streamed(str, size = 7) {
  const bytes = new TextEncoder().encode(str);
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); } }), { headers: { 'content-type': 'text/csv' } });
}
const NOAA20 = [FIRMS_HEADER,
  firmsRow(34.1234567, -118.2345678, 88.8, 60, { conf: 'h' }),
  firmsRow(34.5, -118.5, 4.25, 120, { conf: 'l', dn: 'N' }),
  firmsRow(-12.3, 23.4, 5.2, 23 * 60),
  firmsRow(10, 10, 99, 25 * 60),
  firmsRow(11, 11, 99, -3 * 60),
  '45.0,7.0,330,0.4,0.4,2026-13-40,9999,N20,VIIRS,n,2.0NRT,290,9,D',
  '95.0,10.0,330,0.4,0.4,2026-11-17,0130,N20,VIIRS,l,2.0NRT,290,3.3,N',
  '10.0,10.0,330,0.4'
].join('\r\n') + '\r\n';
const NOAA21 = [FIRMS_HEADER, firmsRow(34.9, -118.1, 120.5, 30, { sat: 'N21' }), firmsRow(-33.9, 151.2, null, 90, { sat: 'N21' })].join('\n') + '\n';
function firms({ n20 = () => streamed(NOAA20), n21 = () => streamed(NOAA21) } = {}) {
  return (url, init) => {
    assert.equal(url.hostname, 'firms.modaps.eosdis.nasa.gov');
    if (url.pathname.includes('VIIRS_NOAA20_NRT')) return n20(url, init);
    if (url.pathname.includes('VIIRS_NOAA21_NRT')) return n21(url, init);
    throw new Error('unexpected FIRMS product ' + url.pathname);
  };
}
async function fires(fetchImpl, cacheImpl = memoryCache(), env = { ...ENV, FIRMS_MAP_KEY: FIRMS_KEY }) {
  const r = await handleWorldEnvironment(req(`${P}/layers/fires`), env, { fetchImpl, cacheImpl });
  assert.equal(r.status, 200); headersOk(r);
  const raw = await r.text();
  assert.equal(raw.includes(FIRMS_KEY), false, 'the key is never in an answer');
  for (const [, v] of r.headers) assert.equal(v.includes(FIRMS_KEY), false, 'nor in a header');
  return JSON.parse(raw);
}

test('fires without FIRMS_MAP_KEY: both satellites unavailable, reason not_configured, NASA never asked, nothing kept', async () => {
  for (const key of [undefined, '', '   ']) {
    const f = world(firms()), cache = memoryCache();
    const b = await fires(f, cache, { ...ENV, ...(key === undefined ? {} : { FIRMS_MAP_KEY: key }) });
    assert.equal(providerCalls(f).length, 0); assert.equal(cache.raw.size, 0);
    assert.deepEqual(b.sources.map((s) => [s.id, s.status, s.reason, s.fetched_at, s.last_success_at]), [
      ['firms_viirs_noaa20', 'unavailable', 'not_configured', null, null], ['firms_viirs_noaa21', 'unavailable', 'not_configured', null, null]]);
    for (const s of b.sources) assert.deepEqual(Object.keys(s).sort(), HEALTH_KEYS);
    assert.deepEqual([b.ok, b.schema, b.count, b.detections, b.summary.cells], [true, 'world-environment-fires/v1', 0, [], []]);
    publicOnly(b);
  }
});

test('fires: NOAA-20 and NOAA-21 (never Suomi NPP) over two UTC days, kept to the trailing 24 hours, strongest first, with an area summary', async () => {
  const f = world(firms());
  const b = await fires(f);
  const asked = providerCalls(f).map((c) => new URL(c.url).pathname).sort();
  assert.deepEqual(asked, [`/api/area/csv/${FIRMS_KEY}/VIIRS_NOAA20_NRT/world/2`, `/api/area/csv/${FIRMS_KEY}/VIIRS_NOAA21_NRT/world/2`]);
  for (const c of providerCalls(f)) { assert.equal(c.init.redirect, 'manual'); assert.match(c.init.headers['user-agent'], /^McCluster-World\/1\.0 \(https:\/\/mccluster\.org\)$/); }
  assert.deepEqual(b.columns, ['lon', 'lat', 'frp_mw', 'confidence', 'acquired_at', 'satellite', 'day_night']);
  assert.deepEqual(b.detections.map((d) => [d[0], d[1], d[2], d[3], d[5], d[6]]), [
    [-118.1, 34.9, 120.5, 'nominal', 'NOAA-21', 'D'],
    [-118.2346, 34.1235, 88.8, 'high', 'NOAA-20', 'D'],
    [23.4, -12.3, 5.2, 'nominal', 'NOAA-20', 'D'],
    [-118.5, 34.5, 4.3, 'low', 'NOAA-20', 'N'],
    [151.2, -33.9, null, 'nominal', 'NOAA-21', 'D']
  ], 'rounded to 4 decimals; outside the window, in the future, untimed, off the globe and ragged rows are left out');
  for (const d of b.detections) assert.ok(Date.now() - Date.parse(d[4]) <= 24 * 3600e3 && Date.parse(d[4]) <= Date.now(), 'acquired within the trailing day');
  assert.equal(b.count, 5); assert.equal(b.total, 5); assert.equal(b.truncated, false); assert.equal(b.cap, FIRES.cap);
  assert.equal(b.outside_window, 2, 'a day old and three hours ahead'); assert.equal(b.untimed, 1); assert.equal(b.dropped, 2);
  assert.equal(b.footprint_m, 375); assert.match(b.notes.detection, /not a confirmed fire/);
  assert.deepEqual(b.summary.columns, ['west', 'south', 'detections', 'frp_sum_mw', 'frp_max_mw', 'latest_acquired_at']);
  const la = b.summary.cells.find((c) => c[0] === -119 && c[1] === 34);
  assert.deepEqual(la.slice(0, 5), [-119, 34, 3, 213.6, 120.5], 'both satellites add into one cell; the sum and the maximum are of FRP in MW');
  assert.equal(la[5], b.detections[0][4], 'the cell\'s latest acquisition');
  assert.deepEqual(b.summary.cells.find((c) => c[0] === 151), [151, -34, 1, 0, null, b.detections[4][4]], 'a detection without FRP counts, adds nothing to the sum');
  assert.deepEqual(b.sources.map((s) => [s.id, s.status, s.reason]), [['firms_viirs_noaa20', 'available', null], ['firms_viirs_noaa21', 'available', null]]);
  for (const s of b.sources) { assert.equal(s.attribution.startsWith('NASA FIRMS'), true); assert.match(s.license, /CC0/); assert.equal(s.url, 'https://firms.modaps.eosdis.nasa.gov/'); }
  for (const w of b.windows) assert.equal(Date.parse(w.until) - Date.parse(w.since), 24 * 3600e3);
  publicOnly(b);
});

test('fires: past the cap the weakest detections go, while the summary still counts every one in the window', async () => {
  const lines = [FIRMS_HEADER];
  for (let i = 0; i < FIRES.cap + 50; i += 1) lines.push(firmsRow(40 + (i % 5) / 10, -100 - (i % 7) / 10, i / 10, 30));
  const f = world(firms({ n20: () => streamed(lines.join('\n'), 4096), n21: () => streamed(FIRMS_HEADER + '\n') }));
  const b = await fires(f);
  assert.equal(b.count, FIRES.cap); assert.equal(b.total, FIRES.cap + 50); assert.equal(b.truncated, true);
  assert.equal(b.detections[0][2], (FIRES.cap + 49) / 10, 'the strongest first');
  assert.equal(Math.min(...b.detections.map((d) => d[2])), 5, 'the 50 weakest are the ones left out');
  assert.equal(b.summary.cells.reduce((n, c) => n + c[2], 0), FIRES.cap + 50, 'every detection in the window is counted in an area');
});

test('fires: one satellite failing leaves the other; a kept copy is served stale with its reason; a timeout says so', async () => {
  const half = await fires(world(firms({ n21: () => text('busy', 500) })));
  assert.deepEqual(half.sources.map((s) => [s.status, s.reason]), [['available', null], ['unavailable', 'upstream_error']]);
  assert.equal(half.count, 3, 'NOAA-20 alone'); assert.ok(half.detections.every((d) => d[5] === 'NOAA-20'));
  const cache = memoryCache();
  const good = await fires(world(firms()), cache);
  age(cache, FIRES.ttl + 60);
  const stale = await fires(world(firms({ n20: () => text('down', 500), n21: () => { throw Object.assign(new Error('slow'), { name: 'AbortError' }); } })), cache);
  assert.deepEqual(stale.sources.map((s) => [s.status, s.reason]), [['stale', 'upstream_error'], ['stale', 'timeout']]);
  assert.deepEqual(stale.detections, good.detections, 'the last good copy');
  for (const s of stale.sources) assert.equal(s.last_success_at, s.fetched_at);
  const none = await fires(world(firms({ n20: () => { throw Object.assign(new Error('slow'), { name: 'AbortError' }); }, n21: () => text('Invalid MAP_KEY.') })));
  assert.deepEqual(none.sources.map((s) => [s.status, s.reason]), [['unavailable', 'timeout'], ['unavailable', 'invalid_data']]);
  assert.equal(none.count, 0);
});

test('fires: the key never reaches an answer, a header, a cache key or a log line, on any path', async () => {
  const logged = [], saved = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) { saved[m] = console[m]; console[m] = (...a) => logged.push(a.map(String).join(' ')); }
  try {
    const failing = [
      () => { throw new TypeError(`fetch failed for https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_KEY}/x`); },
      () => text(`error for key ${FIRMS_KEY}`, 500),
      () => text(`Invalid MAP_KEY: ${FIRMS_KEY}`),
      () => new Response(null, { status: 302, headers: { location: `https://elsewhere.example/${FIRMS_KEY}` } }),
      () => { throw Object.assign(new Error(FIRMS_KEY), { name: 'AbortError' }); }
    ];
    for (const fail of failing) {
      const cache = memoryCache();
      const b = await fires(world(firms({ n20: fail, n21: fail })), cache);
      assert.ok(b.sources.every((s) => s.status === 'unavailable'));
      for (const k of cache.raw.keys()) assert.equal(k.includes(FIRMS_KEY), false);
      for (const v of cache.raw.values()) assert.equal(v.includes(FIRMS_KEY), false);
    }
    const cache = memoryCache();
    await fires(world(firms()), cache);
    for (const [k, v] of cache.raw) { assert.equal(k.includes(FIRMS_KEY), false); assert.equal(v.includes(FIRMS_KEY), false); }
    await assert.rejects(() => fetchFirmsSatellite({}, null, FIRES.satellites[0]), (e) => e.code === 'not_configured' && !String(e.message).includes(FIRMS_KEY));
  } finally { for (const m of Object.keys(saved)) console[m] = saved[m]; }
  assert.equal(logged.some((l) => l.includes(FIRMS_KEY)), false, 'no log line carries the key');
  assert.deepEqual(Object.keys(LAYER_SOURCES).filter((k) => k.startsWith('firms')), ['firms_viirs_noaa20', 'firms_viirs_noaa21']);
});

/* ---------- geometry exactly as published ---------- */
const square = (x, y, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
test('a ring is kept only as the provider closed it: unclosed, short, non-finite or off-globe rings are malformed and never mended', () => {
  assert.deepEqual(strictRing(square(-120.123456, 47.98765)).ring, [[-120.1235, 47.9877], [-120.1135, 47.9877], [-120.1135, 47.9977], [-120.1235, 47.9977], [-120.1235, 47.9877]]);
  const open = square(-120, 47).slice(0, 4);
  assert.deepEqual(strictRing(open), { ring: null, why: 'malformed' }, 'an unclosed ring is not closed by guesswork');
  assert.deepEqual(strictRing([[0, 0], [1, 0], [0, 0]]), { ring: null, why: 'malformed' }, 'fewer than four positions');
  for (const bad of [NaN, Infinity, -Infinity, null, '1.5', undefined]) {
    const r = square(10, 10); r[2] = [bad, 10.01];
    assert.equal(strictRing(r).why, 'malformed', `a ${String(bad)} coordinate`);
  }
  for (const [x, y] of [[181, 0], [-180.0001, 0], [0, 90.5], [0, -91]]) {
    const r = square(0, 0); r[1] = [x, y];
    assert.equal(strictRing(r).why, 'malformed', `off the globe at ${x},${y}`);
  }
  assert.deepEqual(strictRing([[5, 5], [5.00001, 5.00001], [5.00002, 5], [5, 5]]), { ring: null, why: 'tiny' }, 'rounds to one point');
  assert.deepEqual(strictRing([[0, 0], [1, 1], [2, 2], [0, 0]]), { ring: null, why: 'tiny' }, 'no area');
  assert.equal(strictRing('nope').why, 'malformed');
});

test('polygons: a malformed ring drops its whole polygon, a tiny hole is left out, and nothing is promoted or invented', () => {
  const good = square(-100, 40, 1), hole = square(-99.6, 40.4, 0.2), tinyHole = [[-99.5, 40.5], [-99.50001, 40.50001], [-99.50002, 40.5], [-99.5, 40.5]];
  const unclosedHole = square(-99.3, 40.3, 0.1).slice(0, 4);
  assert.deepEqual(strictPolygons({ type: 'Polygon', coordinates: [good, hole] }).polygons.map((p) => p.length), [2]);
  const tiny = strictPolygons({ type: 'Polygon', coordinates: [good, tinyHole] });
  assert.deepEqual([tiny.polygons.length, tiny.polygons[0].length, tiny.polygons_dropped], [1, 1, 0]);
  const bad = strictPolygons({ type: 'Polygon', coordinates: [good, unclosedHole] });
  assert.deepEqual([bad.polygons.length, bad.polygons_dropped], [0, 1], 'never drawn without the hole it had');
  const noExterior = strictPolygons({ type: 'Polygon', coordinates: [square(-100, 40).slice(0, 4), hole] });
  assert.deepEqual([noExterior.polygons.length, noExterior.polygons_dropped], [0, 1], 'a hole is never promoted to an exterior');
  const multi = strictPolygons({ type: 'MultiPolygon', coordinates: [[good], [[[0, 0], [1, 0], [1, 1]]], [square(10, 10)], 'x', []] });
  assert.deepEqual([multi.polygons.length, multi.polygons_dropped], [2, 3]);
  for (const g of [null, { type: 'Point', coordinates: [0, 0] }, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { type: 'Polygon', coordinates: 'x' }]) {
    const out = strictPolygons(g);
    assert.deepEqual(out.polygons, []); assert.equal(out.supported, Boolean(g && g.type === 'Polygon'), 'only Polygon and MultiPolygon are polygons');
  }
  const many = strictPolygons({ type: 'MultiPolygon', coordinates: Array.from({ length: GEOMETRY.maxPolygons + 5 }, (_, i) => [square(i % 170, 0)]) });
  assert.equal(many.polygons.length, GEOMETRY.maxPolygons); assert.equal(many.truncated, true);
});

test('lines need two distinct positions on the globe; long lines are thinned keeping both ends', () => {
  assert.deepEqual(strictLine([[1.234567, 2.345678], [1.3, 2.4], [1.3, 2.4]]), [[1.2346, 2.3457], [1.3, 2.4]]);
  for (const bad of [[[0, 0]], [[0, 0], [0, 0]], [[0, 0], [NaN, 1]], [[0, 0], [200, 1]], 'x', null]) assert.equal(strictLine(bad), null);
  const long = Array.from({ length: 5001 }, (_, i) => [i / 1000, 0]);
  const thin = strictLine(long, 100);
  assert.equal(thin.length, 100); assert.deepEqual(thin[0], [0, 0]); assert.deepEqual(thin[99], [5, 0]);
});

/* ---------- perimeters ---------- */
const WFIGS = JSON.parse(readFileSync(new URL('./fixtures/environment/wfigs-perimeters-sample.json', import.meta.url), 'utf8'));
function nifc(body = WFIGS, status = 200) {
  return (url) => { assert.equal(url.hostname, 'services3.arcgis.com'); return status === 200 ? json(body) : text('down', status); };
}
async function layer(name, fetchImpl, cacheImpl = memoryCache(), env = ENV) {
  const r = await handleWorldEnvironment(req(`${P}/layers/${name}`), env, { fetchImpl, cacheImpl });
  assert.equal(r.status, 200, name); headersOk(r);
  const b = await r.json();
  publicOnly(b);
  for (const s of b.sources) assert.deepEqual(Object.keys(s).sort(), HEALTH_KEYS);
  return b;
}

test('perimeters: NIFC WFIGS polygons with GIS acres and the three NIFC times, largest first (real sample)', async () => {
  const f = world(nifc());
  const b = await layer('perimeters', f);
  const asked = new URL(providerCalls(f)[0].url);
  assert.equal(asked.href, publicPerimetersQuery());
  assert.deepEqual(Object.fromEntries(asked.searchParams), {
    where: '1=1', outFields: 'poly_IncidentName,attr_UniqueFireIdentifier,poly_GISAcres,poly_PolygonDateTime,poly_DateCurrent,attr_FireDiscoveryDateTime',
    returnGeometry: 'true', outSR: '4326', maxAllowableOffset: PERIMETERS.offset, geometryPrecision: '4', orderByFields: 'poly_GISAcres DESC', resultRecordCount: '400', f: 'geojson'
  });
  assert.equal(b.schema, 'world-environment-perimeters/v1'); assert.equal(b.count, 3); assert.equal(b.truncated, true, 'NIFC said more perimeters exist than were asked for');
  assert.deepEqual(b.perimeters[0], {
    id: '2026-MSMSR-000553', name: 'Park N Ride', gis_acres: 0.01,
    polygon_captured_at: new Date(1787676955741).toISOString(), last_edited_at: new Date(1790095832160).toISOString(), discovered_at: new Date(1787676788000).toISOString(),
    polygons: [[[[-88.6564, 30.4376], [-88.6568, 30.4375], [-88.6567, 30.4377], [-88.6564, 30.4376]]]], polygons_dropped: 0, geometry_truncated: false
  });
  assert.deepEqual(b.sources.map((s) => [s.id, s.status, s.reason]), [['wfigs', 'available', null]]);
  assert.match(b.sources[0].license, /no named licence/); assert.match(b.notes.geometry, /never repaired/);
});

test('perimeters: unclosed, non-finite, off-globe and tiny rings are dropped and counted, never closed', async () => {
  const feature = (id, coordinates, type = 'Polygon') => ({ type: 'Feature', properties: { attr_UniqueFireIdentifier: id, poly_IncidentName: id, poly_GISAcres: 'big', poly_PolygonDateTime: 'yesterday', poly_DateCurrent: null, attr_FireDiscoveryDateTime: 9e15 }, geometry: { type, coordinates } });
  const body = { type: 'FeatureCollection', features: [
    feature('unclosed', [square(-110, 40).slice(0, 4)]),
    feature('nan', [[[-110, 40], [NaN, 40], [-109, 41], [-110, 40]]]),
    feature('null', [[[-110, 40], [null, 40], [-109, 41], [-110, 40]]]),
    feature('off', [[[-110, 40], [-190, 40], [-109, 41], [-110, 40]]]),
    feature('tiny', [[[-110, 40], [-110.00001, 40.00001], [-110.00002, 40], [-110, 40]]]),
    feature('mixed', [[square(-120, 45)], [square(-121, 45).slice(0, 4)]], 'MultiPolygon'),
    { type: 'Feature', properties: { attr_UniqueFireIdentifier: 'nogeom' }, geometry: null },
    { type: 'Feature', properties: { attr_UniqueFireIdentifier: 'point' }, geometry: { type: 'Point', coordinates: [-100, 40] } }
  ] };
  const b = await layer('perimeters', world(nifc(body)));
  assert.deepEqual(b.perimeters.map((p) => p.id), ['mixed']);
  assert.equal(b.perimeters[0].polygons.length, 1); assert.equal(b.perimeters[0].polygons_dropped, 1);
  assert.deepEqual([b.perimeters[0].gis_acres, b.perimeters[0].polygon_captured_at, b.perimeters[0].last_edited_at, b.perimeters[0].discovered_at], [null, null, null, null], 'unreadable values are null, never invented');
  assert.equal(b.dropped, 7); assert.equal(b.polygons_dropped, 6); assert.equal(b.truncated, false);
  for (const ring of b.perimeters[0].polygons.flat()) assert.deepEqual(ring[0], ring.at(-1));
});

test('perimeters: an ArcGIS error body or a 500 is unavailable; a kept copy is served stale', async () => {
  const err = await layer('perimeters', world(nifc({ error: { code: 400, message: 'Invalid field' } })));
  assert.deepEqual([err.sources[0].status, err.sources[0].reason, err.count], ['unavailable', 'upstream_error', 0]);
  const cache = memoryCache();
  const good = await layer('perimeters', world(nifc()), cache);
  age(cache, PERIMETERS.ttl + 30);
  const stale = await layer('perimeters', world(nifc(null, 500)), cache);
  assert.deepEqual([stale.sources[0].status, stale.sources[0].reason], ['stale', 'upstream_error']);
  assert.deepEqual(stale.perimeters, good.perimeters);
});

/* ---------- alerts ---------- */
const NWS_SAMPLE = JSON.parse(readFileSync(new URL('./fixtures/environment/nws-alerts-sample.json', import.meta.url), 'utf8'));
/* the real sample, every CAP time moved by the same amount so it is current when the test runs */
function nwsNow(extra = []) {
  const shift = Date.now() - 30 * 60000 - Date.parse(NWS_SAMPLE.features[0].properties.sent);
  const move = (v) => (typeof v === 'string' ? new Date(Date.parse(v) + shift).toISOString() : v);
  const features = [...NWS_SAMPLE.features, ...extra].map((f) => ({ ...f, properties: { ...f.properties, ...Object.fromEntries(['sent', 'effective', 'onset', 'expires', 'ends'].map((k) => [k, move(f.properties[k])])) } }));
  return { ...NWS_SAMPLE, features };
}
function nws(body) {
  return (url, init) => {
    if (url.hostname === 'api.weather.gov') { assert.equal(init.headers.accept, 'application/geo+json'); return body instanceof Response ? body : json(body); }
    return feedProviders(url);
  };
}

test('alerts: the alert\'s own polygon, zone-only alerts listed and never placed, ids equal to the feed\'s (real sample)', async () => {
  const body = nwsNow();
  const f = world(nws(body));
  const b = await layer('alerts', f);
  const call = providerCalls(f)[0];
  assert.equal(call.url, 'https://api.weather.gov/alerts/active?status=actual');
  assert.equal(call.init.headers['user-agent'], 'McCluster-World/1.0 (https://mccluster.org)', 'an identifying application User-Agent, no person or email');
  assert.equal(b.schema, 'world-environment-alerts/v1'); assert.equal(b.count, 4);
  assert.deepEqual(b.counts, { polygon: 2, zone_only: 2, rejected: 0 });
  const polygon = b.alerts.filter((a) => a.geometry === 'polygon'), zone = b.alerts.filter((a) => a.geometry === 'zone_only');
  for (const a of zone) { assert.equal(a.polygons, null); assert.equal('lat' in a || 'lon' in a, false, 'no point is invented'); }
  const first = body.features[0];
  const drawn = polygon.find((a) => a.id === `nws:${first.properties.id}`);
  assert.deepEqual(drawn.polygons, [[first.geometry.coordinates[0].map(([x, y]) => [x, y])]], 'the published polygon itself');
  assert.deepEqual([drawn.event, drawn.severity, drawn.certainty, drawn.urgency], ['Flood Warning', 'Severe', 'Likely', 'Expected']);
  assert.equal(drawn.sent, body.features[0].properties.sent); assert.equal(drawn.ends, body.features[0].properties.ends);
  assert.equal(drawn.url, first.properties['@id']);
  for (const a of b.alerts) for (const k of ['sent', 'onset', 'expires', 'ends']) assert.ok(a[k] === null || /Z$/.test(a[k]), `${k} is UTC ISO`);
  const feed = await environmentFeed(ENV, { fetchImpl: world(nws(body)), cacheImpl: memoryCache() });
  assert.deepEqual(b.alerts.map((a) => a.id).sort(), feed.events.filter((e) => e.source.id === 'nws').map((e) => e.id).sort(), 'the same ids as the World feed');
});

test('alerts: a broken polygon is rejected and not drawn; expired, test and cancelled messages are not current', async () => {
  const base = NWS_SAMPLE.features[0];
  const later = new Date(Date.now() + 3600e3).toISOString(), earlier = new Date(Date.now() - 3600e3).toISOString();
  const extra = [
    { ...base, id: 'https://api.weather.gov/alerts/open', properties: { ...base.properties, id: 'open-ring' }, geometry: { type: 'Polygon', coordinates: [base.geometry.coordinates[0].slice(0, -1)] } },
    { ...base, id: 'https://api.weather.gov/alerts/test', properties: { ...base.properties, id: 'test', status: 'Test' } },
    { ...base, id: 'https://api.weather.gov/alerts/cancel', properties: { ...base.properties, id: 'cancel', messageType: 'Cancel' } }
  ];
  const b = await layer('alerts', world(nws(nwsNow(extra))));
  assert.equal(b.alerts.find((a) => a.id === 'nws:open-ring').geometry, 'rejected');
  assert.equal(b.alerts.find((a) => a.id === 'nws:open-ring').polygons, null);
  assert.equal(b.alerts.some((a) => a.id === 'nws:test' || a.id === 'nws:cancel'), false);
  assert.deepEqual(b.counts, { polygon: 2, zone_only: 2, rejected: 1 });
  /* a kept copy past an alert's end does not show it as current */
  const cache = memoryCache();
  const short = { ...base, id: 'https://api.weather.gov/alerts/short', properties: { ...base.properties, id: 'short', sent: earlier, onset: earlier, expires: new Date(Date.now() + 1000).toISOString(), ends: later } };
  await layer('alerts', world(nws({ type: 'FeatureCollection', features: [short] })), cache);
  await new Promise((r) => setTimeout(r, 1100));
  const kept = await layer('alerts', world(nws(text('down', 500))), cache);
  assert.equal(kept.sources[0].status, 'available', 'still inside the 2 minute window'); assert.equal(kept.count, 0, 'the expired alert is left out');
});

test('alerts: NWS down is unavailable with its reason; a kept copy is stale', async () => {
  const down = await layer('alerts', world(nws(text('down', 503))));
  assert.deepEqual([down.sources[0].status, down.sources[0].reason, down.count], ['unavailable', 'upstream_error', 0]);
  const junk = await layer('alerts', world(nws({ type: 'FeatureCollection' })));
  assert.equal(junk.sources[0].reason, 'invalid_data');
  const cache = memoryCache();
  await layer('alerts', world(nws(nwsNow())), cache);
  age(cache, 125);
  const stale = await layer('alerts', world(() => { throw Object.assign(new Error('slow'), { name: 'AbortError' }); }), cache);
  assert.deepEqual([stale.sources[0].status, stale.sources[0].reason, stale.count], ['stale', 'timeout', 4]);
});

/* ---------- natural events (EONET) ----------
   EONET answered HTTP 500 on 2026-11-17, so no live sample could be taken that day: these events are
   built here in the shape EONET v3 documents (id, title, closed, categories, sources, geometry[]). */
const day = (n, time = '00:00:00') => `${new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10)}T${time}Z`;
const EONET_BUILT = { title: 'EONET Events', events: [
  { id: 'EONET_9001', title: 'Tropical Storm Built', closed: null, categories: [{ id: 'severeStorms', title: 'Severe Storms' }], sources: [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/' }],
    geometry: [
      { magnitudeValue: 45, magnitudeUnit: 'kts', date: day(1, '06:00:00'), type: 'Point', coordinates: [140.1234567, 15.2] },
      { magnitudeValue: 35, magnitudeUnit: 'kts', date: day(2), type: 'Point', coordinates: [141.5, 14.1] },
      { magnitudeValue: 40, magnitudeUnit: 'kts', date: day(1), type: 'Point', coordinates: [140.8, 14.7] },
      { magnitudeValue: 50, magnitudeUnit: 'kts', date: day(0, '00:00:00'), type: 'Point', coordinates: [139.6, 15.9] },
      { magnitudeValue: 55, magnitudeUnit: 'kts', date: 'not a date', type: 'Point', coordinates: [139, 16] },
      { magnitudeValue: 55, magnitudeUnit: 'kts', date: day(0, '06:00:00'), type: 'Point', coordinates: [139, 95] }
    ] },
  { id: 'EONET_9002', title: 'Built Wildfire', closed: null, categories: [{ id: 'wildfires', title: 'Wildfires' }], sources: [{ id: 'InciWeb' }],
    geometry: [
      { magnitudeValue: 1200, magnitudeUnit: 'acres', date: day(3), type: 'Polygon', coordinates: [square(-118, 34, 0.1)] },
      { magnitudeValue: null, magnitudeUnit: null, date: day(2), type: 'Polygon', coordinates: [square(-118, 34, 0.2).slice(0, 4)] }
    ] },
  { id: 'EONET_9003', title: 'Closed report', closed: day(1), categories: [{ id: 'volcanoes', title: 'Volcanoes' }], geometry: [{ date: day(1), type: 'Point', coordinates: [0, 0] }] },
  { id: 'EONET_9004', title: 'Nothing placeable', closed: null, categories: [{ id: 'volcanoes', title: 'Volcanoes' }], geometry: [{ date: day(1), type: 'Point', coordinates: [500, 0] }] }
] };
function eonet(body) {
  return (url) => (url.hostname === 'eonet.gsfc.nasa.gov' ? (body instanceof Response ? body : json(body)) : feedProviders(url));
}

test('eonet: every reported geometry, oldest first, as a track; 00:00 UTC dates flagged; ids equal to the feed\'s', async () => {
  const f = world(eonet(EONET_BUILT));
  const b = await layer('eonet', f);
  assert.equal(providerCalls(f)[0].url, 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=500');
  assert.equal(b.schema, 'world-environment-eonet/v1');
  assert.deepEqual(b.events.map((e) => e.id), ['eonet:EONET_9001', 'eonet:EONET_9002'], 'closed and unplaceable events are not listed');
  const storm = b.events[0];
  assert.equal(storm.kind, 'cyclone'); assert.deepEqual(storm.categories, ['Severe Storms']); assert.deepEqual(storm.reported_by, ['JTWC']);
  assert.deepEqual(storm.track.map((t) => [t.date, t.placeholder_time, t.coordinates, t.magnitude, t.unit]), [
    [new Date(day(2)).toISOString(), true, [141.5, 14.1], 35, 'kts'],
    [new Date(day(1)).toISOString(), true, [140.8, 14.7], 40, 'kts'],
    [new Date(day(1, '06:00:00')).toISOString(), false, [140.1235, 15.2], 45, 'kts'],
    [new Date(day(0)).toISOString(), true, [139.6, 15.9], 50, 'kts']
  ]);
  assert.equal(storm.geometry_dropped, 2, 'an undated entry and one off the globe'); assert.equal(storm.placeholder_times, 3); assert.equal(storm.url, 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_9001');
  const fire = b.events[1];
  assert.equal(fire.track.length, 1, 'the unclosed polygon is dropped, never closed'); assert.equal(fire.track[0].type, 'Polygon'); assert.equal(fire.geometry_dropped, 1);
  assert.deepEqual([fire.track[0].magnitude, fire.track[0].unit], [1200, 'acres']);
  const feed = await environmentFeed(ENV, { fetchImpl: world(eonet(EONET_BUILT)), cacheImpl: memoryCache() });
  for (const e of b.events) assert.ok(feed.events.some((x) => x.id === e.id), `${e.id} is the feed's id`);
});

test('eonet: an HTTP 500 (as EONET answered on 2026-11-17) is unavailable; with a kept copy it is served stale', async () => {
  const down = await layer('eonet', world(eonet(text('<!DOCTYPE html><title>Server Error</title>', 500, 'text/html'))));
  assert.deepEqual([down.sources[0].status, down.sources[0].reason, down.sources[0].fetched_at, down.count], ['unavailable', 'upstream_error', null, 0]);
  const cache = memoryCache();
  const good = await layer('eonet', world(eonet(EONET_BUILT)), cache);
  age(cache, 3600);
  const stale = await layer('eonet', world(eonet(text('<!DOCTYPE html><title>Server Error</title>', 500, 'text/html'))), cache);
  assert.deepEqual([stale.sources[0].status, stale.sources[0].reason], ['stale', 'upstream_error']);
  assert.deepEqual(stale.events, good.events, 'the last good copy');
  assert.equal(stale.sources[0].fetched_at, new Date(Date.parse(good.sources[0].fetched_at) - 3600e3).toISOString());
});

/* ---------- coastal water levels (NOAA CO-OPS; real samples, 2026-11-17) ---------- */
const FX = (name) => JSON.parse(readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8'));
const STATIONS_SAMPLE = FX('coops-stations-sample.json'), LATEST_SAMPLE = FX('coops-latest-8518750.json'), WATER_SAMPLE = FX('coops-water-8461490.json'), NO_MLLW = FX('coops-no-mllw-9099064.json');
/* NOAA by URL: the station list, `date=latest` per station (the real Battery answer under each asked id), or 24 hours */
function coops({ stations = () => json(STATIONS_SAMPLE), latest = (id) => json({ ...LATEST_SAMPLE, metadata: { ...LATEST_SAMPLE.metadata, id, name: `Station ${id}` } }), water = () => json(WATER_SAMPLE) } = {}) {
  let inFlight = 0;
  const impl = async (url) => {
    assert.equal(url.hostname, 'api.tidesandcurrents.noaa.gov');
    if (url.pathname === '/mdapi/prod/webapi/stations.json') return stations();
    const id = url.searchParams.get('station');
    for (const [k, v] of [['product', 'water_level'], ['datum', 'MLLW'], ['units', 'metric'], ['time_zone', 'gmt'], ['format', 'json'], ['application', 'mccluster']]) assert.equal(url.searchParams.get(k), v, k);
    inFlight += 1; impl.peak = Math.max(impl.peak, inFlight);
    try { await new Promise((r) => setTimeout(r, 2)); return url.searchParams.get('date') === 'latest' ? latest(id) : water(id); } finally { inFlight -= 1; }
  };
  impl.peak = 0;
  return impl;
}
async function tides(fetchImpl, cacheImpl = memoryCache()) {
  const r = await handleWorldEnvironment(req(`${P}/layers/tides`), ENV, { fetchImpl, cacheImpl, tideGapMs: 0 });
  assert.equal(r.status, 200); headersOk(r);
  const b = await r.json(); publicOnly(b);
  for (const s of b.sources) assert.deepEqual(Object.keys(s).sort(), HEALTH_KEYS);
  return b;
}

test('tides: the station list with NOAA\'s own flags, and the latest MLLW level at the 20 documented stations, two at a time, preliminary kept', async () => {
  const noaa = coops({ latest: (id) => (id === '8461490' ? text('busy', 500) : json({ ...LATEST_SAMPLE, metadata: { ...LATEST_SAMPLE.metadata, id, name: `Station ${id}` } })) });
  const f = world(noaa);
  const b = await tides(f);
  assert.equal(b.schema, 'world-environment-tides/v1'); assert.deepEqual([b.product, b.datum, b.units], ['observed_water_level', 'MLLW', 'm']);
  assert.deepEqual(b.stations.columns, ['id', 'name', 'lon', 'lat', 'state', 'tidal', 'great_lakes']);
  const duluth = STATIONS_SAMPLE.stations.find((x) => x.id === '9099064');
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  assert.deepEqual(b.stations.rows.find((r) => r[0] === '9099064'), ['9099064', 'Duluth', r4(duluth.lng), r4(duluth.lat), 'MN', false, true], 'rounded to 4 decimals');
  assert.deepEqual(b.stations.rows.find((r) => r[0] === '8518750').slice(5), [true, false]);
  const asked = providerCalls(f).map((c) => new URL(c.url));
  assert.equal(asked.filter((u) => u.pathname.endsWith('stations.json')).length, 1);
  assert.deepEqual(asked.filter((u) => u.searchParams.get('date') === 'latest').map((u) => u.searchParams.get('station')).sort(), TIDE_LATEST_STATIONS.map((s) => s.id).sort());
  assert.equal(latestWaterLevelUrl('8518750'), 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&application=mccluster&station=8518750&datum=MLLW&units=metric&time_zone=gmt&format=json&date=latest');
  assert.ok(noaa.peak <= TIDES_PUBLIC.concurrency, `at most ${TIDES_PUBLIC.concurrency} requests at a time (peak ${noaa.peak})`);
  assert.equal(b.latest.stations, 20); assert.equal(b.latest.answered, 19); assert.equal(b.latest.refresh_s, 900);
  const battery = b.latest.readings.find((r) => r.station === '8518750');
  assert.deepEqual(battery, { station: '8518750', place: 'The Battery, NY', name: 'Station 8518750', lon: -74.0142, lat: 40.7006, value_m: 1.024, observed_at: '2026-11-17T15:48:00.000Z', quality: 'preliminary', q: 'p', status: 'available', reason: null });
  const failed = b.latest.readings.find((r) => r.station === '8461490');
  assert.deepEqual([failed.status, failed.reason, failed.value_m, failed.observed_at], ['unavailable', 'upstream_error', null, null]);
  assert.deepEqual([failed.name, failed.lon, failed.lat], ['New London', -72.0956, 41.3717], 'placed from NOAA\'s station list, never guessed');
  assert.deepEqual(b.sources.map((s) => [s.id, s.status]), [['coops_stations', 'available'], ['coops_latest', 'available']]);
  assert.match(b.notes.value, /not a tide prediction/); assert.match(b.notes.quality, /preliminary/);
  /* within the windows nobody is asked again */
  const cache = memoryCache(), again = world(coops());
  await tides(again, cache); const n = providerCalls(again).length;
  await tides(again, cache);
  assert.equal(providerCalls(again).length, n);
});

test('tides: with every station failing the latest set is unavailable (or the last good set, stale); the station list stands alone', async () => {
  const none = await tides(world(coops({ latest: () => text('down', 503) })));
  assert.deepEqual(none.sources.map((s) => [s.id, s.status, s.reason]), [['coops_stations', 'available', null], ['coops_latest', 'unavailable', 'upstream_error']]);
  assert.ok(none.latest.readings.every((r) => r.status === 'unavailable' && r.value_m === null)); assert.equal(none.latest.answered, 0);
  assert.equal(none.stations.count, 4);
  const cache = memoryCache();
  await tides(world(coops()), cache);
  age(cache, TIDES_PUBLIC.latestTtl + 60);
  const stale = await tides(world(coops({ latest: () => { throw Object.assign(new Error('slow'), { name: 'AbortError' }); } })), cache);
  assert.deepEqual(stale.sources.map((s) => [s.id, s.status, s.reason]), [['coops_stations', 'available', null], ['coops_latest', 'stale', 'timeout']]);
  assert.equal(stale.latest.answered, 20);
});

async function station(id, fetchImpl, cacheImpl = memoryCache()) {
  const r = await handleWorldEnvironment(req(`${P}/tides/${id}`), ENV, { fetchImpl, cacheImpl });
  headersOk(r);
  return { status: r.status, body: await r.json() };
}

test('tides/{station}: 24 hours of observed MLLW water level for one listed tidal station (real sample), preliminary kept', async () => {
  const f = world(coops());
  const { status, body: b } = await station('8461490', f);
  assert.equal(status, 200); publicOnly(b);
  assert.equal(b.schema, 'world-environment-water-level/v1');
  assert.deepEqual(b.station, { id: '8461490', name: 'New London', lat: 41.3717, lon: -72.0956 });
  assert.deepEqual(b.columns, ['observed_at', 'value_m', 'quality']);
  assert.equal(b.count, WATER_SAMPLE.data.length); assert.deepEqual(b.observations[0], ['2026-11-17T12:54:00.000Z', 0.425, 'preliminary']);
  assert.ok(b.observations.every((o) => o[2] === 'preliminary'), 'q p stays preliminary');
  const last = WATER_SAMPLE.data.at(-1);
  assert.deepEqual(b.latest, { observed_at: `${last.t.replace(' ', 'T')}:00.000Z`, value_m: Number(last.v), quality: 'preliminary', q: 'p' });
  assert.equal(b.url, 'https://tidesandcurrents.noaa.gov/stationhome.html?id=8461490');
  assert.deepEqual(b.sources.map((s) => [s.id, s.status]), [['coops_water_level', 'available']]);
  assert.ok(providerCalls(f).some((c) => c.url === waterLevelUrl('8461490')), 'the 24 hour range, MLLW, metres, UTC');
});

test('tides/{station}: a malformed id is 400, an unlisted one 404, a station NOAA marks non-tidal (no MLLW) 404, before NOAA is asked for data', async () => {
  for (const bad of ['851875', '85187500', 'abcdefg', '8518750x', '85-1875', '8518750%20']) {
    const f = world(coops());
    const { status, body } = await station(bad, f);
    assert.equal(status, 400, bad); assert.deepEqual(body, { ok: false, code: 'invalid_station' }); assert.equal(providerCalls(f).length, 0);
  }
  const unknown = world(coops());
  assert.deepEqual(await station('1234567', unknown), { status: 404, body: { ok: false, code: 'unknown_station' } });
  assert.ok(providerCalls(unknown).every((c) => c.url.includes('stations.json')), 'only the station list was read');
  const lakes = world(coops());
  assert.deepEqual(await station('9099064', lakes), { status: 404, body: { ok: false, code: 'no_mllw_datum' } });
  assert.ok(providerCalls(lakes).every((c) => c.url.includes('stations.json')));
});

test('tides/{station}: NOAA errors are unavailable with their reason, a kept copy is stale, and an unreadable list does not block a reading', async () => {
  const listDown = coops({ stations: () => text('down', 503), water: () => json(NO_MLLW) });
  const r = await station('9099064', world(listDown));
  assert.equal(r.status, 200, 'without the list the id is asked for, and NOAA\'s own error is reported');
  assert.deepEqual([r.body.sources[0].status, r.body.sources[0].reason, r.body.count, r.body.latest], ['unavailable', 'upstream_error', 0, null]);
  const cache = memoryCache();
  const good = await station('8461490', world(coops()), cache);
  age(cache, TIDES.waterTtl + 30);
  const stale = await station('8461490', world(coops({ water: () => text('down', 500) })), cache);
  assert.deepEqual([stale.body.sources[0].status, stale.body.sources[0].reason], ['stale', 'upstream_error']);
  assert.deepEqual(stale.body.observations, good.body.observations);
});

/* ---------- ShakeMap (USGS; real samples, 2026-11-17, trimmed) ----------
   us7000tyhr: M5.4 near Anamizu, Japan, ShakeMap version 5 with two isoseismals; us7000tyca: M5.5 deep
   Fiji region event whose ShakeMap has no contour at all; nc75467542: M1.0 at The Geysers, no ShakeMap. */
const DETAIL = { us7000tyhr: FX('usgs-detail-us7000tyhr.json'), us7000tyca: FX('usgs-detail-us7000tyca.json'), nc75467542: FX('usgs-detail-nc75467542.json') };
const CONT = { us7000tyhr: FX('usgs-cont-mmi-us7000tyhr.json'), us7000tyca: FX('usgs-cont-mmi-us7000tyca.json') };
function usgs({ detail = (id) => (DETAIL[id] ? json(DETAIL[id]) : new Response(null, { status: 302, headers: { location: `/fdsnws/event/1/query?eventid=${id}&format=geojson` } })), contours = (id) => json(CONT[id]) } = {}) {
  return (url) => {
    assert.equal(url.hostname, 'earthquake.usgs.gov', 'USGS\'s own host only');
    const m = url.pathname.match(/^\/earthquakes\/feed\/v1\.0\/detail\/([a-z0-9]+)\.geojson$/);
    if (m) return detail(m[1]);
    if (url.pathname === '/fdsnws/event/1/query') return text('Error 404: No Data Found', 404);
    const c = url.pathname.match(/:shakemap:([a-z0-9]+):\d+\/contents\/download\/cont_mmi\.json$/);
    if (c) return contours(c[1]);
    throw new Error('unexpected USGS path ' + url.pathname);
  };
}
async function shakemap(id, fetchImpl, cacheImpl = memoryCache()) {
  const r = await handleWorldEnvironment(req(`${P}/quakes/${id}/shakemap`), ENV, { fetchImpl, cacheImpl });
  headersOk(r);
  const b = await r.json();
  if (r.status === 200) { publicOnly(b); for (const s of b.sources) assert.deepEqual(Object.keys(s).sort(), HEALTH_KEYS); }
  return { status: r.status, body: b };
}

test('shakemap: a USGS event id is validated before anyone is asked', async () => {
  for (const bad of ['US7000TYHR', 'u', 'us', 'us-7000', 'us7000tyhr.geojson', 'us_7000', 'a'.repeat(40), '7000tyhr', 'us7000tyhr%00']) {
    const f = world(usgs());
    const { status, body } = await shakemap(bad, f);
    assert.equal(status, 400, bad); assert.deepEqual(body, { ok: false, code: 'invalid_event' }); assert.equal(providerCalls(f).length, 0, bad);
  }
  for (const good of ['us7000tyhr', 'nc75467542', 'aka2026wufnha', 'ci41363007']) assert.match(good, USGS_EVENT_ID);
});

test('shakemap present: version, process time, review status and MMI contours, coordinates checked, labelled modelled', async () => {
  const f = world(usgs());
  const { status, body: b } = await shakemap('us7000tyhr', f);
  assert.equal(status, 200);
  assert.deepEqual(providerCalls(f).map((c) => c.url), [shakemapDetailUrl('us7000tyhr'), DETAIL.us7000tyhr.properties.products.shakemap[0].contents['download/cont_mmi.json'].url]);
  assert.equal(b.schema, 'world-environment-shakemap/v1'); assert.equal(b.available, true); assert.equal(b.reason, null);
  assert.deepEqual([b.version, b.process_time, b.review_status, b.map_status, b.max_mmi, b.modelled, b.units], [5, '2026-11-17T04:28:22.000Z', 'automatic', 'automatic', 2.9, true, 'MMI']);
  assert.deepEqual(b.contours.map((c) => [c.mmi, c.color, c.lines.length]), [[2, '#bfccff', 2], [2.5, '#afd9ff', 8]]);
  const published = CONT.us7000tyhr.features.flatMap((f) => f.geometry.coordinates);
  assert.deepEqual(b.contours.flatMap((c) => c.lines.map((l) => l.length)), published.map((l) => l.length), 'every published line, every vertex');
  for (const line of b.contours.flatMap((c) => c.lines)) for (const [x, y] of line) assert.ok(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90);
  assert.deepEqual(b.counts, { contours: 2, lines: 10, vertices: published.reduce((n, l) => n + l.length, 0) });
  assert.deepEqual(b.sources.map((s) => [s.id, s.status]), [['usgs_event', 'available'], ['usgs_shakemap', 'available']]);
  assert.match(b.notes.shakemap, /modelled estimate/);
});

test('shakemap is kept by event and product version: within 5 minutes nobody is asked; a newer version is fetched again', async () => {
  const cache = memoryCache(), f = world(usgs());
  await shakemap('us7000tyhr', f, cache);
  await shakemap('us7000tyhr', f, cache);
  assert.equal(providerCalls(f).length, 2, 'the second answer came from the cache');
  age(cache, SHAKEMAP.detailTtl + 10);
  await shakemap('us7000tyhr', f, cache);
  assert.equal(providerCalls(f).length, 3, 'the detail is read again; the same version\'s contours are not');
  const v6 = structuredClone(DETAIL.us7000tyhr);
  const sm = v6.properties.products.shakemap[0];
  sm.properties.version = '6'; sm.updateTime += 600000; sm.contents['download/cont_mmi.json'].url = sm.contents['download/cont_mmi.json'].url.replace(':1794889743207/', `:${sm.updateTime}/`);
  age(cache, SHAKEMAP.detailTtl + 10);
  const g = world(usgs({ detail: () => json(v6) }));
  const { body } = await shakemap('us7000tyhr', g, cache);
  assert.equal(body.version, 6); assert.equal(providerCalls(g).length, 2, 'a new version brings its own contours');
});

test('shakemap absent, empty, unknown or unreachable: available false with the reason, never an error page', async () => {
  const none = await shakemap('nc75467542', world(usgs()));
  assert.equal(none.status, 200); assert.deepEqual([none.body.available, none.body.reason, none.body.contours], [false, 'no_shakemap', []]);
  assert.deepEqual(none.body.sources.map((s) => s.id), ['usgs_event'], 'no contour source was consulted');
  const empty = await shakemap('us7000tyca', world(usgs()));
  assert.deepEqual([empty.body.available, empty.body.contours, empty.body.counts, empty.body.version, empty.body.max_mmi], [true, [], { contours: 0, lines: 0, vertices: 0 }, 3, 1.7], 'a ShakeMap with no contour is still a ShakeMap');
  const unknown = await shakemap('zz0000000000', world(usgs()));
  assert.deepEqual([unknown.status, unknown.body.available, unknown.body.reason, unknown.body.sources[0].status], [200, false, 'event_not_found', 'available'], 'USGS said it has no such event');
  const down = await shakemap('us7000tyhr', world(usgs({ detail: () => text('down', 503) })));
  assert.deepEqual([down.body.available, down.body.reason, down.body.sources[0].status, down.body.sources[0].reason], [false, 'source_unavailable', 'unavailable', 'upstream_error']);
  const contoursDown = await shakemap('us7000tyhr', world(usgs({ contours: () => { throw Object.assign(new Error('slow'), { name: 'AbortError' }); } })));
  assert.deepEqual([contoursDown.body.available, contoursDown.body.reason, contoursDown.body.version], [false, 'source_unavailable', 5]);
  assert.deepEqual(contoursDown.body.sources.map((s) => [s.id, s.status, s.reason]), [['usgs_event', 'available', null], ['usgs_shakemap', 'unavailable', 'timeout']]);
  /* the detail past its 5 minutes and the version's contours past their day: both served stale, with the reason */
  const cache = memoryCache();
  await shakemap('us7000tyhr', world(usgs()), cache);
  ageWhere(cache, (k) => k.endsWith('-shakemap-us7000tyhr'), SHAKEMAP.detailTtl + 60);
  ageWhere(cache, (k) => k.includes('-shakemap-us7000tyhr-'), SHAKEMAP.contoursTtl + 60);
  const stale = await shakemap('us7000tyhr', world(usgs({ detail: () => text('down', 500), contours: () => text('down', 500) })), cache);
  assert.deepEqual([stale.body.available, stale.body.contours.length], [true, 2]);
  assert.deepEqual(stale.body.sources.map((s) => [s.id, s.status, s.reason]), [['usgs_event', 'stale', 'upstream_error'], ['usgs_shakemap', 'stale', 'upstream_error']]);
});
function ageWhere(cache, pick, seconds) {
  for (const [k, v] of cache.raw) {
    if (!pick(k)) continue;
    const b = JSON.parse(v);
    if (typeof b.fetched_at !== 'string') continue;
    b.fetched_at = new Date(Date.parse(b.fetched_at) - seconds * 1000).toISOString();
    cache.raw.set(k, JSON.stringify(b));
  }
}

test('shakemap: a contour link off USGS, another event\'s answer, or a non-finite maxmmi are never trusted', async () => {
  const offHost = structuredClone(DETAIL.us7000tyhr);
  offHost.properties.products.shakemap[0].contents['download/cont_mmi.json'].url = 'https://evil.example/cont_mmi.json';
  offHost.properties.products.shakemap[0].properties.maxmmi = 'nan';
  const f = world(usgs({ detail: () => json(offHost) }));
  const { body } = await shakemap('us7000tyhr', f);
  assert.deepEqual([body.available, body.reason, body.max_mmi], [false, 'no_contours', null]);
  assert.ok(providerCalls(f).every((c) => new URL(c.url).hostname === 'earthquake.usgs.gov'));
  const other = await shakemap('us7000tyca', world(usgs({ detail: () => json(DETAIL.us7000tyhr) })));
  assert.deepEqual([other.body.available, other.body.reason, other.body.sources[0].reason], [false, 'source_unavailable', 'invalid_data']);
  const deleted = structuredClone(DETAIL.us7000tyhr);
  deleted.properties.products.shakemap[0].status = 'DELETE';
  assert.equal((await shakemap('us7000tyhr', world(usgs({ detail: () => json(deleted) })))).body.reason, 'no_shakemap', 'a deleted product is not a ShakeMap');
});

test('shakemap contours: bad values, units, colours and lines are dropped and counted; past the vertex budget lines are thinned keeping both ends (built input)', () => {
  const line = (n, x0 = 136, y0 = 37) => Array.from({ length: n }, (_, i) => [x0 + i / 1000, y0 + i / 2000]);
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { value: 3, units: 'mmi', color: '#AABBCC' }, geometry: { type: 'MultiLineString', coordinates: [line(5), [[136, 37]], [[136, 37], [NaN, 37]], [[136, 37], [200, 37]], 'x'] } },
    { type: 'Feature', properties: { value: 3, units: 'mmi', color: 'red' }, geometry: { type: 'LineString', coordinates: line(3, 137) } },
    { type: 'Feature', properties: { value: 13, units: 'mmi', color: '#ffffff' }, geometry: { type: 'MultiLineString', coordinates: [line(3)] } },
    { type: 'Feature', properties: { value: 4, units: 'pga', color: '#ffffff' }, geometry: { type: 'MultiLineString', coordinates: [line(3)] } },
    { type: 'Feature', properties: { value: 4, units: 'mmi', color: '#ffffff' }, geometry: { type: 'Polygon', coordinates: [line(3)] } },
    { type: 'Feature', properties: { value: 'x' }, geometry: null }
  ] };
  const out = readShakemapContours(fc);
  assert.deepEqual(out.contours.map((c) => [c.mmi, c.color, c.lines.length]), [[3, '#aabbcc', 2]], 'colours keep only #rrggbb; the first seen colour of a level is kept');
  assert.equal(out.lines_dropped, 4); assert.equal(out.features_dropped, 4);
  const big = readShakemapContours({ features: [{ properties: { value: 5, units: 'mmi', color: '#ff0000' }, geometry: { type: 'MultiLineString', coordinates: [line(1500), line(1500, 140)] } }] }, { ...SHAKEMAP, maxVertices: 1000 });
  assert.equal(big.thinned, true); assert.ok(big.counts.vertices <= 1000, `vertices ${big.counts.vertices}`);
  for (const [i, l] of big.contours[0].lines.entries()) { const src = line(1500, i ? 140 : 136); assert.deepEqual(l[0], src[0]); assert.deepEqual(l.at(-1), [Math.round(src.at(-1)[0] * 1e4) / 1e4, Math.round(src.at(-1)[1] * 1e4) / 1e4]); }
  assert.throws(() => readShakemapContours({ features: 'no' }), (e) => e.code === 'upstream_invalid_json');
});

/* ---------- the source keeps its promises ---------- */
test('the layers module reaches providers only through the safe fetch, logs nothing, and builds the FIRMS URL in one place', () => {
  const src = readFileSync(new URL('../src/world-environment-layers.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code, /\bfetchImpl\(/, 'providers are only reached through upstream() (fetchNoCrossHostRedirect)');
  assert.doesNotMatch(code, /redirect:\s*['"](error|follow)['"]/);
  assert.doesNotMatch(code, /console\.|logEvent/, 'nothing here logs');
  assert.doesNotMatch(code, /\.message\b/, 'no provider or error message is read into an answer');
  assert.equal((code.match(/FIRMS_MAP_KEY/g) || []).length, 2, 'the key is read once for the request URL and once to know it is configured');
  assert.equal((code.match(/api\/area\/csv/g) || []).length, 1);
  assert.doesNotMatch(code, /VIIRS_SNPP/, 'Suomi NPP production ceased on 2026-11-02');
  for (const host of ['firms.modaps.eosdis.nasa.gov', 'api.weather.gov', 'eonet.gsfc.nasa.gov', 'api.tidesandcurrents.noaa.gov', 'earthquake.usgs.gov']) assert.ok(src.includes(host), host);
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(index.indexOf('await guardWorldRelease(request, env)') < index.indexOf('return handleWorldEnvironment(request, env)'), 'the release guard still runs first');
});
