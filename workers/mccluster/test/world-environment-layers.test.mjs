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
import { FIRES, LAYER_SOURCES, fetchFirmsSatellite } from '../src/world-environment-layers.js';
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
/* the routes answered so far (the rest are gated and mapped, and answer 404 until they land) */
const SERVED_PATHS = [`${P}/layers/fires`];
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
  assert.deepEqual(ENVIRONMENT_PUBLIC_ROUTES.map((r) => r.id), ['feed', 'fires', 'perimeters', 'alerts', 'eonet', 'tides', 'water-level', 'shakemap']);
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

test('a missing, unapplied, unreachable or malformed policy is 503 module_policy_unavailable on every new route, before any provider is asked', async () => {
  const refusals = [
    ['module not installed (EUM01)', json({ code: 'EUM01', message: 'module_not_installed' }, 400)],
    ['policy schema not applied (PGRST202)', json({ code: 'PGRST202', message: 'Could not find the function' }, 404)],
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
