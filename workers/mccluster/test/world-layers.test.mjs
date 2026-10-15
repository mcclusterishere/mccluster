/* THE WORLD'S DATA LAYERS (owner, 2026-10-15): flights for everyone,
   satellites and launches for members; one provider request per window;
   the last good answer while a provider is down; honest when there is none. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleWorldLayers, LAYERS, fetchFlights, fetchSatellites, fetchLaunches } from '../src/world-layers.js';

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
const TLES = 'ISS (ZARYA)\n1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000\n2 25544  51.6400 208.9163 0006703  32.5223 327.6271 15.49580730400000\nHST\n1 20580U 90037B   24001.50000000  .00001000  00000-0  50000-4 0  9001\n2 20580  28.4700 100.0000 0002500  90.0000 270.0000 15.09000000100000\n';
const LAUNCHES = { results: [
  { id: 'L1', name: 'Falcon 9 Block 5 | Starlink Group 10-1', net: '2026-10-16T12:00:00Z', status: { abbrev: 'Go' }, launch_service_provider: { name: 'SpaceX' }, pad: { name: 'SLC-40', latitude: '28.56', longitude: '-80.57', location: { name: 'Cape Canaveral, FL, USA' } }, mission: { name: 'Starlink Group 10-1', type: 'Communications' }, url: 'https://ll.thespacedevs.com/2.3.0/launches/L1/' },
  { id: 'L2', name: 'No pad coordinates', net: '2026-10-17T00:00:00Z', status: { abbrev: 'TBD' }, pad: { name: 'Unknown' }, mission: null }
] };

function provider({ flightsFail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    calls.push({ url: u, auth: init.headers && init.headers.authorization || '' });
    if (u.startsWith('https://opensky-network.org/api/states/all')) return flightsFail ? text('nope', 503, 'text/plain') : json(STATES);
    if (u.startsWith('https://celestrak.org/NORAD/elements/gp.php')) return text(u.includes('GROUP=stations') ? TLES : '', 200, 'text/plain');
    if (u.startsWith('https://ll.thespacedevs.com/2.3.0/launches/upcoming/')) return json(LAUNCHES);
    if (u === 'https://sb.test/auth/v1/user') return init.headers.authorization === 'Bearer member-token' ? json({ id: 'auth-member' }) : json({ msg: 'no' }, 401);
    throw new Error('unexpected ' + u);
  };
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
  assert.equal(body.layer, 'flights'); assert.equal(body.attribution, 'OpenSky Network'); assert.equal(body.stale, false); assert.equal(body.authenticated, false, 'anonymous without the research credentials');
  assert.equal(body.total, 4); assert.equal(body.count, 2, 'the one on the ground and the one without a position are dropped');
  assert.deepEqual(body.aircraft[0], ['a1b2c3', 'UAL123', -73.9, 40.7, 10668, 250.1, 270]);
  assert.equal(calls.filter((c) => c.url.includes('opensky')).length, 1);
  const again = await (await handleWorldLayers(req('/v1/world/layers/flights'), ENV, { fetchImpl, cacheImpl: cache })).json();
  assert.equal(again.count, 2);
  assert.equal(calls.filter((c) => c.url.includes('opensky')).length, 1, 'the second look hits the cache, OpenSky is not asked again');
});

test('with the research credentials the Worker asks OpenSky with a token', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => { const u = String(url); calls.push({ u, auth: init.headers && init.headers.authorization }); if (u.includes('openid-connect/token')) return json({ access_token: 'osk' }); return json(STATES); };
  const body = await fetchFlights({ OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'secret' }, fetchImpl);
  assert.equal(body.authenticated, true);
  assert.equal(calls.find((c) => c.u.includes('states/all')).auth, 'Bearer osk');
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
  assert.equal(lb.count, 1, 'a launch without pad coordinates cannot be pinned');
  assert.deepEqual(lb.launches[0].pad, { name: 'SLC-40', location: 'Cape Canaveral, FL, USA', lat: 28.56, lon: -80.57 });
  assert.equal(lb.launches[0].provider, 'SpaceX');
  assert.equal(calls.find((c) => c.url.includes('thespacedevs')).auth, '', 'anonymous without LL2_API_TOKEN');
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
