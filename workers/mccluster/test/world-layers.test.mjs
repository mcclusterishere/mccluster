/* THE WORLD'S DATA LAYERS (owner, 2026-10-15): flights for everyone,
   satellites and launches for members; one provider request per window;
   the last good answer while a provider is down; honest when there is none. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleWorldLayers, LAYERS, fetchFlights, fetchOpenSky, fetchAdsbLol, normalizeAdsbAircraft, FLIGHT_REGIONS, fetchSatellites, fetchLaunches } from '../src/world-layers.js';
import { workersFetch, hangingResponse } from './support/workers-fetch-semantics.mjs';

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const req = (path, headers = {}) => new Request(`https://api.mccluster.org${path}`, { headers: { origin: 'https://matthew.mccluster.org', ...headers } });
const text = (body, status = 200, type = 'application/json') => new Response(body, { status, headers: { 'content-type': type } });
const json = (body, status = 200) => text(JSON.stringify(body), status);
/* a cache like the Worker's: match and put by request URL */
function memoryCache() { const m = new Map(); return { calls: [], async match(k) { this.calls.push('match'); const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { this.calls.push('put'); m.set(k.url, await r.text()); }, raw: m }; }

const STATES = { time: 1760500000, states: [
  ['a1b2c3', 'UAL123  ', 'United States', 1, 2, -73.9, 40.7, 10668.0, false, 250.1, 270.0],
  ['ground1', 'GRND', 'France', 1, 2, 2.5, 49.0, 0, true, 5, 90],
  ['nopos', 'NOPOS', 'Spain', 1, 2, null, null, null, false, null, null],
  ['d4e5f6', 'BAW9', 'United Kingdom', 1, 2, -0.45, 51.47, 11000, false, 240, 180]
] };
/* adsb.lol's /v2/point answer, the shape probed live 2026-10-16T02:31Z: feet, knots, 'ground', dbFlags */
const ADSB = { msg: 'No error', now: 1792117865501, total: 6, ac: [
  { hex: 'a1440c', flight: 'SWA4592 ', alt_baro: 37000, alt_geom: 38900, gs: 543.2, track: 88.31, lat: 41.284103, lon: -79.408508, seen_pos: 0.4, dbFlags: 0 },
  { hex: 'gnd001', flight: 'TAXI1', alt_baro: 'ground', gs: 10, track: 0, lat: 40.64, lon: -73.78 },
  { hex: 'nopos1', flight: 'NOPOS', alt_baro: 30000, gs: 400, track: 0 },
  { hex: 'ladd01', flight: 'N1LADD', alt_baro: 20000, gs: 300, track: 10, lat: 40.1, lon: -74.2, dbFlags: 8 },
  { hex: 'old001', flight: 'OLD', alt_baro: 20000, gs: 300, track: 10, lat: 40.2, lon: -74.3, seen_pos: 300 },
  { hex: 'mil001', flight: 'RCH1', alt_geom: 25000, gs: 420, track: 45, lat: '40.5', lon: '-73.5', dbFlags: 1 }
] };
const TLES = 'ISS (ZARYA)\n1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000\n2 25544  51.6400 208.9163 0006703  32.5223 327.6271 15.49580730400000\nHST\n1 20580U 90037B   24001.50000000  .00001000  00000-0  50000-4 0  9001\n2 20580  28.4700 100.0000 0002500  90.0000 270.0000 15.09000000100000\n';
const LAUNCHES = { results: [
  { id: 'L1', name: 'Falcon 9 Block 5 | Starlink Group 10-1', net: '2026-10-16T12:00:00Z', status: { abbrev: 'Go' }, launch_service_provider: { name: 'SpaceX' }, pad: { name: 'SLC-40', latitude: '28.56', longitude: '-80.57', location: { name: 'Cape Canaveral, FL, USA' } }, mission: { name: 'Starlink Group 10-1', type: 'Communications' }, url: 'https://ll.thespacedevs.com/2.3.0/launches/L1/' },
  { id: 'L2', name: 'No pad coordinates', net: '2026-10-17T00:00:00Z', status: { abbrev: 'TBD' }, pad: { name: 'Unknown' }, mission: null },
  { id: 'L3', name: 'Explicit null coordinates', net: '2026-10-18T00:00:00Z', status: { abbrev: 'TBD' }, pad: { name: 'TBD', latitude: null, longitude: null }, mission: null },
  { id: 'L4', name: 'No pad at all', net: '2026-10-19T00:00:00Z', status: { abbrev: 'TBD' }, pad: null, mission: null },
  { id: 'L5', name: 'One axis null', net: '2026-10-20T00:00:00Z', status: { abbrev: 'TBD' }, pad: { name: 'Half', latitude: '5.26', longitude: null }, mission: null }
] };

function provider({ flightsFail = false, celestrakFail = false } = {}) {
  /* flightsFail: every flights provider down */
  const calls = [];
  /* every provider call is validated the way workerd validates fetch init */
  const fetchImpl = workersFetch(async (url, init = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    calls.push({ url: u, auth: init.headers && init.headers.authorization || '' });
    if (u.startsWith('https://opensky-network.org/api/states/all')) return flightsFail ? text('nope', 503, 'text/plain') : json(STATES);
    if (u.startsWith('https://api.adsb.lol/v2/point/')) return flightsFail ? text('nope', 503, 'text/plain') : json(ADSB);
    if (u.startsWith('https://celestrak.org/NORAD/elements/gp.php')) return celestrakFail ? text('down', 503, 'text/plain') : text(u.includes('GROUP=stations') ? TLES : '', 200, 'text/plain');
    if (u.startsWith('https://ll.thespacedevs.com/2.3.0/launches/upcoming/')) return json(LAUNCHES);
    if (u === 'https://sb.test/auth/v1/user') return init.headers.authorization === 'Bearer member-token' ? json({ id: 'auth-member' }) : json({ msg: 'no' }, 401);
    throw new Error('unexpected ' + u);
  });
  return { fetchImpl, calls };
}

test('the routes are only these three, GET only', async () => {
  assert.equal(await handleWorldLayers(req('/v1/world/layers/weather'), ENV), null);
  assert.equal((await handleWorldLayers(new Request('https://api.mccluster.org/v1/world/layers/flights', { method: 'POST' }), ENV)).status, 405);
  assert.deepEqual(Object.keys(LAYERS), ['flights', 'satellites', 'launches']);
  assert.equal(LAYERS.flights.public, true); assert.equal(LAYERS.satellites.public, false); assert.equal(LAYERS.launches.public, false);
});

test('flights are public: trimmed to airborne, positioned aircraft, cached for the window, and attributed', async () => {
  const { fetchImpl, calls } = provider(); const cache = memoryCache();
  const r = await handleWorldLayers(req('/v1/world/layers/flights'), ENV, { fetchImpl, cacheImpl: cache });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://matthew.mccluster.org');
  const body = await r.json();
  assert.equal(body.layer, 'flights'); assert.equal(body.provider, 'adsb_lol', 'without the OpenSky credentials the World asks adsb.lol');
  assert.equal(body.attribution, 'adsb.lol, Open Database License (ODbL) 1.0'); assert.equal(body.license, 'ODbL-1.0'); assert.equal(body.credit, 'Flights: adsb.lol (ODbL)');
  assert.equal(body.stale, false); assert.equal(body.authenticated, false);
  assert.equal(calls.filter((c) => c.url.includes('opensky')).length, 0, 'anonymous OpenSky is never attempted');
  assert.deepEqual(body.providers.map((p) => [p.provider, p.status]), [['opensky', 'skipped'], ['adsb_lol', 'ok']]);
  assert.equal(body.coverage.kind, 'regional_sample'); assert.match(body.coverage.note, /^a sample of 2 aircraft .* not every flight/);
  assert.equal(body.count, 2, 'one airborne row plus the military one; ground, no position, LADD and stale positions are not drawn');
  assert.equal(body.withheld, 1, 'the LADD airframe is withheld and counted');
  assert.deepEqual(body.aircraft[0], ['a1440c', 'SWA4592', -79.409, 41.284, 11277.6, 279.446, 88.31]);
  const adsbCalls = () => calls.filter((c) => c.url.startsWith('https://api.adsb.lol/')).length;
  assert.equal(adsbCalls(), FLIGHT_REGIONS.length, 'one request per region circle');
  assert.ok(calls.filter((c) => c.url.startsWith('https://api.adsb.lol/')).every((c) => /\/v2\/point\/-?[\d.]+\/-?[\d.]+\/250$/.test(c.url)));
  const again = await (await handleWorldLayers(req('/v1/world/layers/flights'), ENV, { fetchImpl, cacheImpl: cache })).json();
  assert.equal(again.count, 2);
  assert.equal(adsbCalls(), FLIGHT_REGIONS.length, 'the second look hits the cache, adsb.lol is not asked again');
});

test('with the research credentials the Worker asks OpenSky with a token', async () => {
  const calls = [];
  const fetchImpl = workersFetch(async (url, init = {}) => { const u = String(url); calls.push({ u, auth: init.headers && init.headers.authorization }); if (u.includes('openid-connect/token')) return json({ access_token: 'osk' }); return json(STATES); });
  const body = await fetchFlights({ OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'secret' }, fetchImpl);
  assert.equal(body.authenticated, true); assert.equal(body.provider, 'opensky'); assert.equal(body.attribution, 'OpenSky Network'); assert.equal(body.coverage.kind, 'global');
  assert.equal(body.total, 4); assert.equal(body.count, 2, 'the one on the ground and the one without a position are dropped');
  assert.deepEqual(body.aircraft[0], ['a1b2c3', 'UAL123', -73.9, 40.7, 10668, 250.1, 270]);
  assert.deepEqual(body.providers, [{ provider: 'opensky', status: 'ok', authenticated: true, count: 2 }]);
  assert.equal(calls.find((c) => c.u.includes('states/all')).auth, 'Bearer osk');
  assert.equal(calls.filter((c) => c.u.includes('adsb.lol')).length, 0, 'adsb.lol is not asked when OpenSky answers');
});

test('a provider that is down: the last good answer is served as stale, and with nothing cached the layer says unavailable', async () => {
  const cache = memoryCache();
  const good = provider();
  await handleWorldLayers(req('/v1/world/layers/flights'), ENV, { fetchImpl: good.fetchImpl, cacheImpl: cache });
  /* age the cached answer past the window */
  const k = [...cache.raw.keys()][0]; const old = JSON.parse(cache.raw.get(k)); old.fetched_at = new Date(Date.now() - 3600e3).toISOString(); cache.raw.set(k, JSON.stringify(old));
  const down = provider({ flightsFail: true });
  const stale = await (await handleWorldLayers(req('/v1/world/layers/flights'), ENV, { fetchImpl: down.fetchImpl, cacheImpl: cache })).json();
  assert.equal(stale.stale, true); assert.equal(stale.count, 2, 'the last good snapshot, marked stale');
  const empty = await (await handleWorldLayers(req('/v1/world/layers/flights'), ENV, { fetchImpl: down.fetchImpl, cacheImpl: memoryCache() })).json();
  assert.equal(empty.unavailable, true); assert.deepEqual(empty.aircraft, []); assert.equal(empty.count, 0);
  assert.equal(empty.upstream_error, 'upstream_http');
  assert.deepEqual(empty.providers.map((p) => [p.provider, p.status]), [['opensky', 'skipped'], ['adsb_lol', 'failed']]);
  assert.equal(stale.refresh_providers.at(-1).status, 'failed', 'the stale answer says why it was not refreshed');
});

/* ---------- the flights provider chain (2026-10-16: anonymous OpenSky timed out from Cloudflare egress) ---------- */
const CREDS = { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'secret' };

test('OpenSky configured but timing out: adsb.lol answers, and both attempts are reported', { timeout: 30000 }, async () => {
  const fetchImpl = workersFetch(async (url, init) => {
    if (url.hostname === 'auth.opensky-network.org') return json({ access_token: 'osk' });
    if (url.hostname === 'opensky-network.org') return hangingResponse(init);
    if (url.hostname === 'api.adsb.lol') return json(ADSB);
    throw new Error('unexpected ' + url);
  });
  const r = await handleWorldLayers(req('/v1/world/layers/flights'), { ...ENV, ...CREDS }, { fetchImpl, cacheImpl: memoryCache() });
  const body = await r.json();
  assert.equal(body.unavailable, undefined);
  assert.equal(body.provider, 'adsb_lol'); assert.equal(body.count, 2);
  assert.deepEqual(body.providers[0], { provider: 'opensky', status: 'failed', error: 'upstream_timeout', provider_status: null });
  assert.equal(body.providers[1].provider, 'adsb_lol'); assert.equal(body.providers[1].status, 'ok');
  for (const call of fetchImpl.calls) assert.equal(call.init.redirect, 'manual');
});

test('every flights provider down: unavailable, typed per provider and per region, never success-with-zero, never cached', async () => {
  const fetchImpl = workersFetch(async (url) => {
    if (url.hostname === 'auth.opensky-network.org') return json({ access_token: 'osk' });
    if (url.hostname === 'opensky-network.org') return text('busy', 503, 'text/plain');
    if (url.hostname === 'api.adsb.lol') return text('slow down', 429, 'text/plain');
    throw new Error('unexpected ' + url);
  });
  await assert.rejects(() => fetchFlights(CREDS, fetchImpl), (e) => e.code === 'upstream_rate_limited' && e.providers.length === 2);
  const cache = memoryCache();
  const body = await (await handleWorldLayers(req('/v1/world/layers/flights'), { ...ENV, ...CREDS }, { fetchImpl, cacheImpl: cache })).json();
  assert.equal(body.unavailable, true); assert.equal(body.count, 0); assert.deepEqual(body.aircraft, []);
  assert.equal(body.upstream_error, 'upstream_rate_limited');
  assert.deepEqual(body.providers.map((p) => [p.provider, p.status, p.error]), [['opensky', 'failed', 'upstream_http'], ['adsb_lol', 'failed', 'upstream_rate_limited']]);
  assert.equal(body.providers[0].provider_status, 503); assert.equal(body.providers[1].provider_status, 429);
  assert.equal(body.providers[1].regions.length, FLIGHT_REGIONS.length);
  assert.ok(body.providers[1].regions.every((r) => r.status === 'failed' && r.error === 'upstream_rate_limited'));
  assert.equal(cache.raw.size, 0, 'a failure is never stored as the answer');
});

test('adsb.lol with some regions down is a partial sample, said so; deduplicated across overlapping circles', async () => {
  let n = 0;
  const fetchImpl = workersFetch(async (url) => {
    n += 1;
    if (url.pathname.startsWith('/v2/point/1.35/')) return text('down', 502, 'text/plain');
    if (url.pathname.startsWith('/v2/point/35.6/')) throw new TypeError('fetch failed');
    return json(ADSB);
  });
  const body = await fetchAdsbLol({}, fetchImpl);
  assert.equal(n, FLIGHT_REGIONS.length);
  assert.equal(body.partial, true);
  assert.equal(body.coverage.regions_ok, FLIGHT_REGIONS.length - 2); assert.equal(body.coverage.regions_failed, 2);
  assert.equal(body.count, 2, 'the same transponder seen by six circles is one aircraft');
  assert.equal(body.total, 6); assert.equal(body.reported, 6 * (FLIGHT_REGIONS.length - 2));
  assert.deepEqual(body.region_status.filter((r) => r.status === 'failed').map((r) => [r.region, r.error]), [['singapore', 'upstream_http'], ['tokyo', 'upstream_network']]);
  const chain = await fetchFlights({}, fetchImpl);
  assert.equal(chain.providers.at(-1).status, 'partial');
  /* an answer without an aircraft list is a failure, not zero */
  await assert.rejects(() => fetchAdsbLol({}, workersFetch(async () => json({ msg: 'error' }))), (e) => e.code === 'upstream_invalid_json');
});

test('adsb.lol normalisation: feet to metres, knots to m/s, string coordinates, and nothing drawn at 0,0', () => {
  assert.deepEqual(normalizeAdsbAircraft({ hex: 'abc', flight: 'X1 ', alt_baro: 1000, gs: 100, track: 90, lat: 10, lon: 20 }), ['abc', 'X1', 20, 10, 304.8, 51.444, 90]);
  assert.deepEqual(normalizeAdsbAircraft({ hex: 'abc', alt_geom: 1000, lat: '10.5', lon: '-20.25' }), ['abc', '', -20.25, 10.5, 304.8, null, null]);
  assert.equal(normalizeAdsbAircraft({ hex: 'g', alt_baro: 'ground', lat: 1, lon: 1 }), null);
  assert.equal(normalizeAdsbAircraft({ hex: 'n', alt_baro: 1000, lat: null, lon: null }), null);
  assert.equal(normalizeAdsbAircraft({ hex: 'n', alt_baro: 1000, lat: '', lon: 5 }), null);
  assert.equal(normalizeAdsbAircraft({ hex: 'n', alt_baro: 1000, lat: 95, lon: 5 }), null);
  assert.equal(normalizeAdsbAircraft({ hex: 's', alt_baro: 1000, lat: 1, lon: 1, seen_pos: 61 }), null);
  assert.equal(normalizeAdsbAircraft(null), null);
});

test('satellites and launches are for members: the bearer is checked with Supabase, never a page flag', async () => {
  const { fetchImpl, calls } = provider(); const cache = memoryCache();
  for (const layer of ['satellites', 'launches']) {
    const anon = await handleWorldLayers(req(`/v1/world/layers/${layer}`), ENV, { fetchImpl, cacheImpl: cache });
    assert.equal(anon.status, 401, layer);
    assert.equal((await anon.json()).detail.members_only, true);
    const wrong = await handleWorldLayers(req(`/v1/world/layers/${layer}`, { authorization: 'Bearer forged' }), ENV, { fetchImpl, cacheImpl: cache });
    assert.equal(wrong.status, 401, 'a token Supabase does not recognise');
  }
  assert.equal(calls.filter((c) => c.url.includes('celestrak') || c.url.includes('thespacedevs')).length, 0, 'no provider is asked for a request that is refused');
  const sats = await handleWorldLayers(req('/v1/world/layers/satellites', { authorization: 'Bearer member-token' }), ENV, { fetchImpl, cacheImpl: cache });
  assert.equal(sats.status, 200);
  assert.equal(sats.headers.get('cache-control'), 'private, no-store');
  const sb = await sats.json();
  assert.equal(sb.attribution, 'CelesTrak (celestrak.org), Dr. T.S. Kelso');
  assert.equal(sb.count, 2); assert.equal(sb.satellites[0].name, 'ISS (ZARYA)'); assert.equal(sb.satellites[0].id, '25544'); assert.match(sb.satellites[0].tle2, /^2 25544/);
  const launches = await handleWorldLayers(req('/v1/world/layers/launches', { authorization: 'Bearer member-token' }), ENV, { fetchImpl, cacheImpl: cache });
  const lb = await launches.json();
  assert.equal(lb.attribution, 'Launch Library 2 — The Space Devs');
  assert.equal(lb.count, 1, 'a launch without pad coordinates, with null ones, with no pad, or with one axis missing cannot be pinned: null never becomes 0°');
  assert.deepEqual(lb.launches[0].pad, { name: 'SLC-40', location: 'Cape Canaveral, FL, USA', lat: 28.56, lon: -80.57 });
  assert.equal(lb.launches[0].provider, 'SpaceX');
  assert.equal(calls.find((c) => c.url.includes('thespacedevs')).auth, '', 'anonymous without LL2_API_TOKEN');
});

test('CelesTrak down on every group is the provider down, never zero satellites cached as the truth', async () => {
  const down = provider({ celestrakFail: true });
  await assert.rejects(() => fetchSatellites({}, down.fetchImpl), /celestrak unavailable/);
  const r = await handleWorldLayers(req('/v1/world/layers/satellites', { authorization: 'Bearer member-token' }), ENV, { fetchImpl: down.fetchImpl, cacheImpl: memoryCache() });
  const body = await r.json();
  assert.equal(body.unavailable, true); assert.equal(body.count, 0); assert.deepEqual(body.satellites, []);
  /* one group down while the other answers is tolerated */
  const half = { fetchImpl: async (url, init = {}) => { const u = String(url); if (u.includes('GROUP=visual')) return text('down', 503, 'text/plain'); return down.fetchImpl(url, init); } };
  const okFetch = provider().fetchImpl;
  const partial = await fetchSatellites({}, workersFetch(async (url, init = {}) => (String(url).includes('GROUP=visual') ? text('down', 503, 'text/plain') : okFetch(url, init))));
  assert.equal(partial.count, 2);
  void half;
});

test('the fetchers trim what the Earth needs and nothing more', async () => {
  const { fetchImpl } = provider();
  const s = await fetchSatellites({}, fetchImpl); assert.deepEqual(Object.keys(s.satellites[0]), ['id', 'name', 'group', 'tle1', 'tle2']);
  const l = await fetchLaunches({}, fetchImpl); assert.deepEqual(Object.keys(l.launches[0]), ['id', 'name', 'net', 'status', 'provider', 'pad', 'mission', 'url']);
});

test('the API dispatches the three routes before the Halo projection', async () => {
  const src = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const i = src.indexOf("path.startsWith('/v1/world/layers/')"), j = src.indexOf("path === '/v1/equity-uprise/halo-globe'");
  assert.ok(i > 0 && j > i);
  assert.match(src, /import \{ handleWorldLayers \} from '\.\/world-layers\.js';/);
});

/* ---------- Workers fetch semantics (workerd rejects redirect: 'error') ---------- */
const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });

test('regression: every layer fetch uses a fetch init the Workers runtime accepts, so flights are not "unavailable" in production', async () => {
  const { fetchImpl } = provider();
  const r = await handleWorldLayers(req('/v1/world/layers/flights'), ENV, { fetchImpl, cacheImpl: memoryCache() });
  const body = await r.json();
  assert.equal(body.unavailable, undefined, `flights must not be unavailable (got ${body.upstream_error})`);
  assert.equal(body.count, 2);
  for (const call of fetchImpl.calls) assert.equal(call.init.redirect, 'manual');
  for (const layer of ['satellites', 'launches']) {
    const m = await (await handleWorldLayers(req(`/v1/world/layers/${layer}`, { authorization: 'Bearer member-token' }), ENV, { fetchImpl, cacheImpl: memoryCache() })).json();
    assert.equal(m.unavailable, undefined, layer);
    assert.ok(m.count > 0, layer);
  }
});

test('a same-host https redirect is followed (bounded); the data arrives', async () => {
  const fetchImpl = workersFetch(async (url) => {
    if (url.pathname === '/api/states/all') return redirect('https://opensky-network.org/api/v2/states/all', 301);
    if (url.pathname === '/api/v2/states/all') return json(STATES);
    throw new Error('unexpected ' + url);
  });
  const body = await fetchOpenSky({}, fetchImpl);
  assert.equal(body.count, 2);
  assert.deepEqual(fetchImpl.calls.map((c) => c.url), ['https://opensky-network.org/api/states/all', 'https://opensky-network.org/api/v2/states/all']);
});

test('a provider redirect off its host, to http, with userinfo, to another port, or past two hops is upstream_redirect, never followed and never success-with-zero', async () => {
  const cases = [
    ['cross-host', () => redirect('https://evil.example/states')],
    ['downgrade', () => redirect('http://opensky-network.org/api/states/all')],
    ['userinfo', () => redirect('https://user:pw@opensky-network.org/x')],
    ['port', () => redirect('https://opensky-network.org:8443/x')],
    ['no location', () => new Response(null, { status: 302 })]
  ];
  for (const [name, make] of cases) {
    const fetchImpl = workersFetch(async () => make());
    await assert.rejects(() => fetchOpenSky({}, fetchImpl), (e) => e.code === 'upstream_redirect', name);
    assert.equal(fetchImpl.calls.length, 1, `${name}: the redirect target is never requested`);
    /* the whole chain (adsb.lol redirected the same way) */
    const body = await (await handleWorldLayers(req('/v1/world/layers/flights'), ENV, { fetchImpl, cacheImpl: memoryCache() })).json();
    assert.equal(body.unavailable, true, name); assert.equal(body.upstream_error, 'upstream_redirect', name);
    assert.ok(fetchImpl.calls.every((c) => ['opensky-network.org', 'api.adsb.lol'].includes(new URL(c.url).hostname)), `${name}: never followed off the provider's host`);
  }
  let n = 0;
  const loop = workersFetch(async () => redirect(`https://opensky-network.org/hop${(n += 1)}`));
  await assert.rejects(() => fetchOpenSky({}, loop), (e) => e.code === 'upstream_redirect' && /exceeded 2 redirects/.test(e.message));
  assert.equal(loop.calls.length, 3, 'the first request plus two followed hops, no more');
});

test('provider failures are typed: http, rate limit, invalid JSON, network', async () => {
  const run = async (handler) => { try { await fetchLaunches({}, workersFetch(handler)); return null; } catch (e) { return e.code; } };
  assert.equal(await run(async () => text('no', 503, 'text/plain')), 'upstream_http');
  assert.equal(await run(async () => text('slow down', 429, 'text/plain')), 'upstream_rate_limited');
  assert.equal(await run(async () => text('<html>', 200, 'text/html')), 'upstream_invalid_json');
  assert.equal(await run(async () => { throw new TypeError('fetch failed'); }), 'upstream_network');
  const down = provider({ celestrakFail: true });
  await assert.rejects(() => fetchSatellites({}, down.fetchImpl), (e) => e.code === 'upstream_http' && /celestrak unavailable/.test(e.message));
});

test('the Workers fetch double rejects what workerd rejects', async () => {
  const f = workersFetch(async () => json({}));
  await assert.rejects(() => f('https://x.test/', { redirect: 'error' }), /Invalid redirect value/);
  await assert.rejects(() => f('https://x.test/', { mode: 'cors' }), /not implemented/);
  await assert.rejects(() => f('https://x.test/', { credentials: 'include' }), /not implemented/);
  await f('https://x.test/', { redirect: 'manual' });
});
