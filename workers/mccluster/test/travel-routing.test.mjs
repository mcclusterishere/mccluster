import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { routingProvider, osrmRoute, tomtomRoute, performStreetRoute } from '../src/travel-routing-provider.js';
import { reserveRoutingQuota, releaseRoutingQuota } from '../src/travel-routing-quota.js';
import { handleTravelRouting } from '../src/travel-routing.js';

// Supply only runtime/build features that Node lacks. The canonical entry,
// routing handler, provider adapter and Durable Object method run unmodified.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
    if (specifier.endsWith('/.wrangler/build-provenance.mjs')) return { url: 'data:text/javascript,export const build = {sha:"test",ref:"test",dirty:true};', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.html$/.test(url)) return { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true };
    return next(url, context);
  }
});
const { default: entry, HereTenantAgent } = await import('../src/entry-platform.js');

const PILOT = { TRAVEL_ROUTING_PROVIDER: 'fossgis-pilot', TRAVEL_ROUTING_PILOT: 'noncommercial' };
const ORIGIN = 'https://mccluster.org';
const copy = value => structuredClone(value);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

// A bounded, public-place New Haven car route captured by the implementation
// smoke check on 2026-10-17. All 66 road geometry points and all seven maneuvers
// are retained; verbose intersections and per-step duplicate geometry are
// omitted. No live provider requests run in this suite.
const ROAD_GEOMETRY = [
  [-72.929252,41.307889],[-72.92924,41.307874],[-72.929236,41.307868],[-72.92924,41.307825],[-72.929247,41.307814],[-72.929266,41.307783],
  [-72.929299,41.307763],[-72.929313,41.307741],[-72.929379,41.307643],[-72.929414,41.307591],[-72.928766,41.307327],[-72.92867,41.307288],
  [-72.928592,41.307257],[-72.927082,41.306622],[-72.926999,41.306589],[-72.926921,41.306557],[-72.926727,41.306474],[-72.926625,41.30643],
  [-72.92588,41.306111],[-72.925772,41.306065],[-72.925658,41.306015],[-72.925056,41.305762],[-72.924353,41.305466],[-72.92429,41.30544],
  [-72.924224,41.305413],[-72.922956,41.304889],[-72.922894,41.304863],[-72.922813,41.304826],[-72.922869,41.304745],[-72.922894,41.304709],
  [-72.923178,41.304304],[-72.923493,41.30388],[-72.923728,41.303564],[-72.923763,41.303518],[-72.92381,41.303453],[-72.924309,41.30275],
  [-72.924395,41.302619],[-72.924479,41.302485],[-72.924501,41.302425],[-72.924526,41.302333],[-72.924532,41.302241],[-72.924531,41.302181],
  [-72.92452,41.302088],[-72.924513,41.302032],[-72.924438,41.301561],[-72.924434,41.301534],[-72.924408,41.301456],[-72.924404,41.301383],
  [-72.924398,41.301365],[-72.924389,41.301208],[-72.924357,41.300863],[-72.924357,41.300717],[-72.924366,41.300634],[-72.924391,41.300572],
  [-72.924439,41.3005],[-72.925448,41.299421],[-72.92551,41.29935],[-72.925793,41.299028],[-72.925687,41.298969],[-72.925389,41.298804],
  [-72.92526,41.298732],[-72.925231,41.298729],[-72.925187,41.298735],[-72.925135,41.298765],[-72.92511,41.29879],[-72.925065,41.298863]
];
const TRIP = { origin: ROAD_GEOMETRY[0], destination: ROAD_GEOMETRY.at(-1), mode: 'drive' };
function osrmFixture() {
  return {
    code: 'Ok', waypoints: [{ location: TRIP.origin, hint: 'provider-only-hint' }, { location: TRIP.destination }],
    routes: [{ distance: 1466.6, duration: 143.2, weight: 143.2, geometry: { type: 'LineString', coordinates: copy(ROAD_GEOMETRY) }, legs: [{ steps: [
      { name: '', distance: 37.6, duration: 14.2, mode: 'driving', maneuver: { bearing_after: 149, bearing_before: 0, location: copy(ROAD_GEOMETRY[0]), modifier: 'left', type: 'depart' } },
      { name: 'Chapel Street', distance: 632.3, duration: 56.5, mode: 'driving', maneuver: { bearing_after: 118, bearing_before: 206, location: copy(ROAD_GEOMETRY[9]), modifier: 'left', type: 'turn' } },
      { name: 'State Street', distance: 410.6, duration: 28.9, mode: 'driving', maneuver: { bearing_after: 206, bearing_before: 118, location: copy(ROAD_GEOMETRY[27]), modifier: 'right', type: 'turn' } },
      { name: 'Union Avenue', ref: 'US 1', distance: 306.6, duration: 23.9, mode: 'driving', maneuver: { bearing_after: 175, bearing_before: 171, location: copy(ROAD_GEOMETRY[46]), modifier: 'straight', type: 'new name' } },
      { name: '', distance: 55.5, duration: 14, mode: 'driving', maneuver: { bearing_after: 125, bearing_before: 212, location: copy(ROAD_GEOMETRY[57]), modifier: 'left', type: 'turn' } },
      { name: '', distance: 24.1, duration: 5.7, mode: 'driving', maneuver: { bearing_after: 73, bearing_before: 125, location: copy(ROAD_GEOMETRY[60]), modifier: 'left', type: 'turn' } },
      { name: '', distance: 0, duration: 0, mode: 'driving', maneuver: { bearing_after: 0, bearing_before: 25, location: copy(ROAD_GEOMETRY[65]), type: 'arrive' } }
    ] }] }]
  };
}
function tomtomFixture() {
  const instruction = (index, offset, time, maneuver, message) => ({ routeOffsetInMeters: offset, travelTimeInSeconds: time, maneuver, message,
    point: { longitude: ROAD_GEOMETRY[index][0], latitude: ROAD_GEOMETRY[index][1] } });
  return { routes: [{ summary: { lengthInMeters: 1466.6, travelTimeInSeconds: 143.2 }, legs: [{ points: ROAD_GEOMETRY.map(([longitude, latitude]) => ({ longitude, latitude })) }], guidance: { instructions: [
    instruction(0, 0, 0, 'DEPART', 'Head toward Chapel Street'), instruction(9, 37.6, 14.2, 'TURN_LEFT', 'Turn left onto Chapel Street'), instruction(65, 1466.6, 143.2, 'ARRIVE', 'You have reached your destination')
  ] } }] };
}

test('OSRM street geometry and structured maneuvers become real, ordered, attributed directions', () => {
  const raw = osrmFixture();
  const route = osrmRoute(raw, TRIP);
  assert.equal(route.distanceMeters, 1466.6);
  assert.equal(route.durationSeconds, 143.2);
  assert.deepEqual(route.geometry, ROAD_GEOMETRY, 'all road bends survive normalization');
  assert.deepEqual(route.steps.map(s => s.geometryIndex), [0, 9, 27, 46, 57, 60, 65]);
  assert.equal(route.steps[1].instruction, 'Turn left onto Chapel Street');
  assert.equal(route.steps[2].instruction, 'Turn right onto State Street');
  assert.equal(route.steps[3].instruction, 'Continue on Union Avenue');
  assert.equal(route.steps.at(-1).instruction, 'Arrive at your destination');
  assert.equal(route.steps[1].distanceMeters, 632.3);
  assert.equal(route.traffic, false);
  assert.match(route.attribution, /OpenStreetMap.*FOSSGIS.*OSRM/);
  assert.match(route.warnings[0], /without live traffic/);
  assert.ok(!JSON.stringify(route).includes('provider-only-hint'));
  assert.equal(raw.routes[0].legs[0].steps[1].maneuver.type, 'turn', 'normalization does not modify the provider fixture');
});

test('roundabouts, motorway exits, merges, forks and unnamed streets retain actionable instructions', () => {
  const cases = [
    [{ type: 'roundabout', exit: 3 }, {}, /Enter the roundabout and take exit 3 onto Chapel Street/],
    [{ type: 'rotary', exit: 2 }, {}, /take exit 2/],
    [{ type: 'off ramp', modifier: 'right' }, { exits: '42', destinations: 'Downtown' }, /Take the exit 42 onto Chapel Street toward Downtown/],
    [{ type: 'on ramp', modifier: 'right' }, { destinations: 'I-95 North' }, /Take the ramp right onto Chapel Street toward I-95 North/],
    [{ type: 'merge', modifier: 'left' }, {}, /Merge left onto Chapel Street/],
    [{ type: 'fork', modifier: 'right' }, {}, /Keep right at the fork/],
    [{ type: 'turn', modifier: 'uturn' }, {}, /Make a U-turn/],
    [{ type: 'end of road', modifier: 'left' }, {}, /Turn left at the end of the road/],
    [{ type: 'turn', modifier: 'right' }, { name: '', ref: 'US 1' }, /Turn right onto US 1/]
  ];
  for (const [maneuver, fields, expected] of cases) {
    const raw = osrmFixture(), step = raw.routes[0].legs[0].steps[1];
    Object.assign(step.maneuver, maneuver); Object.assign(step, fields);
    assert.match(osrmRoute(raw, TRIP).steps[1].instruction, expected);
  }
});

test('unconnected/non-drivable routes, incomplete steps and unrelated snapped locations never return a made-up success', () => {
  for (const code of ['NoRoute', 'NoSegment']) assert.throws(() => osrmRoute({ code, routes: [] }, TRIP), error => error.status === 422 && /No connected/.test(error.message));
  for (const change of [
    raw => { raw.code = 'InvalidQuery'; }, raw => { raw.routes = []; },
    raw => { raw.routes[0].geometry.type = 'Point'; }, raw => { raw.routes[0].geometry.coordinates = []; },
    raw => { raw.routes[0].legs[0].steps = []; }, raw => { delete raw.routes[0].legs[0].steps[1].maneuver.location; },
    raw => { raw.routes[0].legs[0].steps[1].maneuver.location = [-73.1, 41.4]; },
    raw => { raw.routes[0].distance = 0; }, raw => { raw.routes[0].duration = -1; }
  ]) { const raw = osrmFixture(); change(raw); assert.throws(() => osrmRoute(raw, TRIP), undefined, change.toString()); }
  assert.throws(() => osrmRoute(osrmFixture(), { ...TRIP, destination: [-73.1, 41.4] }), /nearby road|path/i);
});

test('TomTom text guidance preserves real offsets, metrics and its separate attribution', () => {
  const route = tomtomRoute(tomtomFixture(), TRIP);
  assert.equal(route.provider, 'TomTom');
  assert.equal(route.attribution, '© TomTom');
  assert.equal(route.traffic, true);
  assert.equal(route.steps[1].instruction, 'Turn left onto Chapel Street');
  assert.equal(route.steps[1].distanceMeters, 1429);
  assert.equal(route.steps[1].durationSeconds, 129);
  assert.equal(route.steps.at(-1).maneuver.type, 'arrive');
  assert.equal(tomtomRoute(tomtomFixture(), { ...TRIP, mode: 'walk' }).traffic, false);
  assert.throws(() => tomtomRoute({ routes: [] }, TRIP), error => error.status === 422);
  const noGuidance = tomtomFixture(); delete noGuidance.routes[0].guidance;
  assert.throws(() => tomtomRoute(noGuidance, TRIP), /incomplete turn/);
});

test('provider selection requires the explicit noncommercial pilot or an independent McCluster routing key', () => {
  for (const env of [{}, { TRAVEL_ROUTING_PROVIDER: 'fossgis-pilot' }, { ...PILOT, TRAVEL_ROUTING_PILOT: 'commercial' },
    { TRAVEL_ROUTING_PROVIDER: 'tomtom' }, { TRAVEL_ROUTING_PROVIDER: 'tomtom', TOMTOM_API_KEY: 'halo-must-stay-isolated' },
    { TRAVEL_ROUTING_PROVIDER: 'anything-else', TRAVEL_TOMTOM_API_KEY: 'test-only' }]) assert.equal(routingProvider(env), null);
  assert.equal(routingProvider(PILOT), 'fossgis-pilot');
  assert.equal(routingProvider({ TRAVEL_ROUTING_PROVIDER: 'tomtom', TRAVEL_TOMTOM_API_KEY: 'test-only' }), 'tomtom');
});

test('the three public profiles use distinct reviewed services and request geometry plus steps without identity', async () => {
  for (const [mode, profile] of [['drive', 'car'], ['walk', 'foot'], ['cycle', 'bike']]) {
    let calls = 0;
    const result = await performStreetRoute({ ...TRIP, mode, originLabel: 'Private home', userId: 'private-person' }, PILOT, { request: async (href, options) => {
      calls++;
      const url = new URL(href);
      assert.equal(url.origin, 'https://routing.openstreetmap.de');
      assert.equal(url.pathname, `/routed-${profile}/route/v1/driving/${TRIP.origin.join(',')};${TRIP.destination.join(',')}`);
      assert.equal(url.searchParams.get('geometries'), 'geojson');
      assert.equal(url.searchParams.get('overview'), 'full');
      assert.equal(url.searchParams.get('steps'), 'true');
      assert.equal(url.searchParams.get('alternatives'), 'false');
      assert.equal(url.searchParams.get('generate_hints'), 'false');
      assert.equal(options.redirect, 'manual');
      assert.match(options.headers['user-agent'], /McCluster-Travel/);
      assert.equal(options.headers.referer, ORIGIN + '/');
      assert.ok(!JSON.stringify([href, options.headers]).includes('private'));
      assert.ok(!('authorization' in options.headers));
      return json(osrmFixture());
    } });
    assert.equal(calls, 1, 'routing is one foreground request, without prefetch');
    assert.equal(result.mode, mode);
  }
});

test('operator routing URLs are pinned and no traveler can redirect a request to another host', async () => {
  for (const base of ['http://routing.openstreetmap.de/', 'https://evil.example/', 'https://user:password@routing.openstreetmap.de/', 'https://routing.openstreetmap.de/?key=x', 'https://routing.openstreetmap.de/#fragment']) {
    await assert.rejects(performStreetRoute(TRIP, { ...PILOT, TRAVEL_OSRM_BASE: base }, { request: () => assert.fail('invalid configuration reached network') }), /configuration/);
  }
  await assert.rejects(performStreetRoute({ ...TRIP, origin: ['1;evil', 0] }, PILOT, { request: () => assert.fail('invalid coordinate reached network') }));
  await assert.rejects(performStreetRoute(TRIP, {}, { request: () => assert.fail('unconfigured provider reached network') }), /not connected/);
});

test('TomTom requests use the dedicated secret and latitude/longitude API order', async () => {
  const env = { TRAVEL_ROUTING_PROVIDER: 'tomtom', TRAVEL_TOMTOM_API_KEY: 'mccluster-test-key', TOMTOM_API_KEY: 'wrong-project-key' };
  const result = await performStreetRoute(TRIP, env, { request: async (href, options) => {
    const url = new URL(href);
    assert.equal(url.origin, 'https://api.tomtom.com');
    assert.equal(url.pathname, `/routing/1/calculateRoute/${TRIP.origin[1]},${TRIP.origin[0]}:${TRIP.destination[1]},${TRIP.destination[0]}/json`);
    assert.equal(url.searchParams.get('key'), 'mccluster-test-key');
    assert.equal(url.searchParams.get('travelMode'), 'car');
    assert.equal(url.searchParams.get('instructionsType'), 'text');
    assert.equal(url.searchParams.get('language'), 'en-US');
    assert.equal(url.searchParams.get('traffic'), 'true');
    assert.equal(options.redirect, 'manual');
    return json(tomtomFixture());
  } });
  assert.ok(!JSON.stringify(result).includes('mccluster-test-key'));
  assert.ok(!JSON.stringify(result).includes('wrong-project-key'));
});

test('provider errors and malformed or oversized responses return safe errors without coordinates or keys', async () => {
  for (const [status, expected] of [[400, 422], [429, 429], [500, 503]]) {
    await assert.rejects(performStreetRoute(TRIP, PILOT, { request: async () => new Response('upstream diagnostic', { status }) }), error => error.status === expected && (status !== 429 || error.retryAfter === 60));
  }
  await assert.rejects(performStreetRoute(TRIP, PILOT, { request: async () => json({ code: 'NoRoute' }) }), error => error.status === 422);
  for (const request of [
    async () => new Response('broken JSON'),
    async () => json(osrmFixture(), 200, { 'content-length': '9000000' }),
    async () => { throw new Error(`fetch failed https://api.tomtom.com/route/${TRIP.origin}?key=SECRET-TEST-KEY`); }
  ]) await assert.rejects(performStreetRoute(TRIP, PILOT, { request }), error => error.status === 503 && !error.message.includes('http') && !error.message.includes('SECRET') && !error.message.includes(String(TRIP.origin[0])));
});

test('provider redirects are rejected without forwarding endpoints or a secret to a new host', async () => {
  for (const env of [PILOT, { TRAVEL_ROUTING_PROVIDER: 'tomtom', TRAVEL_TOMTOM_API_KEY: 'test-secret' }]) {
    let calls = 0;
    await assert.rejects(performStreetRoute(TRIP, env, { request: async (_href, options) => {
      calls++;
      assert.equal(options.redirect, 'manual', 'workerd supports manual redirect handling');
      return new Response('private upstream diagnostic', { status: 302, headers: { location: 'https://unexpected.example/?key=test-secret' } });
    } }), error => error.status === 503 && !/unexpected|private|test-secret|https:/.test(error.message));
    assert.equal(calls, 1, 'a redirect never produces a second outbound request');
  }
});

test('provider timeout cancels the connection before the persisted single-flight lease expires', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  const pending = performStreetRoute(TRIP, PILOT, { request: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  }) });
  t.mock.timers.tick(12001);
  await assert.rejects(pending, error => error.status === 503 && /too long/.test(error.message));
  assert.equal(aborted, true);
});

function binding(result = { status: 200, route: osrmRoute(osrmFixture(), TRIP) }) {
  const calls = [];
  return { calls, idFromName(name) { calls.push({ name }); return name; }, get(id) { return { async routeTravel(input) { calls.push({ id, input }); return typeof result === 'function' ? result(input) : result; } }; } };
}
function request({ origin = ORIGIN, method = 'POST', type = 'application/json', body = TRIP, search = '', headers = {} } = {}) {
  const h = { ...headers };
  if (origin !== null) h.origin = origin;
  if (type !== null) h['content-type'] = type;
  return new Request('https://api.mccluster.org/v1/travel/route' + search, { method, headers: h,
    ...(['POST', 'PUT', 'PATCH'].includes(method) ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
const call = (req, env) => entry.fetch(req, env, { waitUntil() {} });

test('the canonical platform Worker serves anonymous routing before auth and uses one global quota object', async () => {
  const namespace = binding(), env = { ...PILOT, HereTenantAgent: namespace };
  for (const origin of [ORIGIN, 'https://matthew.mccluster.org', 'https://humanuprise.com', 'https://api.mccluster.org']) {
    const res = await call(request({ origin, body: { ...TRIP, originLabel: 'Private home', email: 'private@example.test' } }), env);
    assert.equal(res.status, 200, `${origin} must not require account creation for directions`);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.equal(res.headers.get('cache-control'), 'no-store, private');
    assert.equal((await res.json()).route.provider, 'FOSSGIS / OSRM');
  }
  assert.deepEqual([...new Set(namespace.calls.filter(c => c.name).map(c => c.name))], ['travel:street-routing:mccluster']);
  for (const event of namespace.calls.filter(c => c.input)) assert.deepEqual(event.input, TRIP, 'only coordinate endpoints and mode enter the DO');
});

test('public CORS preflight is answered without authentication or provider work', async () => {
  const namespace = binding();
  const res = await call(request({ method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } }), { HereTenantAgent: namespace });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
  assert.match(res.headers.get('access-control-allow-headers'), /content-type/);
  assert.equal(await res.text(), '');
  assert.equal(namespace.calls.length, 0);
});

test('unapproved origins, unsupported methods, query coordinates and non-JSON bodies cannot consume quota', async () => {
  const namespace = binding(), env = { ...PILOT, HereTenantAgent: namespace };
  for (const origin of [null, 'null', 'https://evil.example', 'https://mccluster.org.evil.example']) {
    const res = await call(request({ origin }), env);
    assert.equal(res.status, 403);
    assert.notEqual(res.headers.get('access-control-allow-origin'), origin);
  }
  const get = await call(request({ method: 'GET' }), env);
  assert.equal(get.status, 405); assert.match(get.headers.get('allow'), /POST/);
  assert.equal((await call(request({ search: '?origin=0,0&destination=1,1' }), env)).status, 400);
  assert.equal((await call(request({ type: 'text/plain' }), env)).status, 415);
  assert.equal((await call(request({ type: null }), env)).status, 415);
  assert.equal(namespace.calls.length, 0);
});

test('invalid or oversized JSON is rejected before a provider or quota reservation', async () => {
  const namespace = binding(), env = { ...PILOT, HereTenantAgent: namespace };
  for (const body of ['{invalid', { ...TRIP, destination: TRIP.origin }, { ...TRIP, origin: [null, 0] }, { ...TRIP, mode: 'flight' }, { ...TRIP, extra: 'x'.repeat(2200) }]) {
    const res = await call(request({ body }), env);
    assert.equal(res.status, 400);
    assert.match(res.headers.get('cache-control'), /no-store/);
  }
  assert.equal(namespace.calls.length, 0);
  assert.equal(await handleTravelRouting(new Request('https://api.mccluster.org/v1/unrelated'), env), null);
});

test('missing provider configuration and RPC failure remain explicit unavailable responses', async () => {
  for (const env of [{}, { ...PILOT }, { HereTenantAgent: binding() }, { TRAVEL_ROUTING_PROVIDER: 'tomtom', TOMTOM_API_KEY: 'other-project', HereTenantAgent: binding() }]) {
    const res = await call(request(), env);
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not connected/);
  }
  const res = await call(request(), { ...PILOT, HereTenantAgent: binding(() => { throw new Error(`DO diagnostic with endpoint ${TRIP.origin}`); }) });
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes(String(TRIP.origin[0])));
});

test('quota refusal remains an uncached actionable 429 through the actual public endpoint', async () => {
  const res = await call(request(), { ...PILOT, HereTenantAgent: binding({ status: 429, error: 'Wait for the current directions.', retryAfter: 12 }) });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '12');
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.deepEqual(await res.json(), { error: 'Wait for the current directions.', retryAfter: 12 });
});

test('quota counts calls, enforces a single active lease and spaces starts by more than one second', () => {
  const now = 10 * 86400000 + 10000;
  const first = reserveRoutingQuota({}, now);
  assert.equal(first.allowed, true);
  assert.equal(first.state.count, 1);
  assert.equal(reserveRoutingQuota(first.state, now + 1500).allowed, false, 'a slow active connection still holds the global lease');
  const finished = releaseRoutingQuota(first.state, now + 2000);
  assert.equal(reserveRoutingQuota(finished, now + 3000).allowed, false, 'completion must not immediately admit the next request');
  assert.equal(reserveRoutingQuota(finished, now + 3100).allowed, true);
  const paused = releaseRoutingQuota(first.state, now + 2000, 60);
  assert.equal(reserveRoutingQuota(paused, now + 61000).allowed, false);
  assert.equal(reserveRoutingQuota(paused, now + 62000).allowed, true);
});

test('daily pilot budget resets only at the next UTC day and survives serializing its state', () => {
  const day = 42, now = day * 86400000 + 12000;
  const last = reserveRoutingQuota({ day, count: 999 }, now);
  const saved = JSON.parse(JSON.stringify(releaseRoutingQuota(last.state, now)));
  const denied = reserveRoutingQuota(saved, now + 2000);
  assert.equal(denied.allowed, false); assert.equal(denied.daily, true);
  assert.ok(denied.retryAfter > 0 && denied.retryAfter <= 86400);
  const tomorrow = reserveRoutingQuota(saved, (day + 1) * 86400000);
  assert.equal(tomorrow.allowed, true); assert.equal(tomorrow.state.count, 1);
});

// The SQLite double implements the actual metadata statements, not quota
// logic. Synchronous reads/writes let overlapping calls exercise the real
// reservation-before-await behavior of HereTenantAgent.routeTravel.
function quotaStorage(initial) {
  let saved = initial === undefined ? undefined : JSON.stringify(initial);
  const writes = [];
  return { writes, get state() { return saved === undefined ? undefined : JSON.parse(saved); }, set state(value) { saved = JSON.stringify(value); },
    sql: { exec(statement, ...args) {
      if (/^\s*CREATE (TABLE|INDEX)/.test(statement)) return { toArray: () => [] };
      if (/SELECT v FROM tenant_meta WHERE k = 'travel_routing_quota'/.test(statement)) return { toArray: () => saved === undefined ? [] : [{ v: saved }] };
      if (/INSERT INTO tenant_meta \(k, v\) VALUES \('travel_routing_quota', \?\)/.test(statement)) {
        assert.equal(args.length, 1); saved = args[0]; writes.push(JSON.parse(saved)); return { toArray: () => [] };
      }
      assert.fail(`unexpected routing storage access: ${statement}`);
    } }
  };
}

test('the real Durable Object serializes concurrent requests across restart and stores no trip coordinates or identity', async t => {
  let now = 100 * 86400000 + 10000, releaseFirst, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { releaseFirst = () => resolve(json(osrmFixture())); });
    return json(osrmFixture());
  });
  const storage = quotaStorage(), firstAgent = new HereTenantAgent({ storage }, PILOT);
  const pending = firstAgent.routeTravel({ ...TRIP, originLabel: 'Private home', userId: 'private-person' });
  const concurrent = await firstAgent.routeTravel(TRIP);
  const restarted = new HereTenantAgent({ storage }, PILOT);
  const afterRestart = await restarted.routeTravel(TRIP);
  const reserved = copy(storage.state);
  releaseFirst();
  const completed = await pending;
  assert.equal(completed.status, 200);
  assert.equal(concurrent.status, 429); assert.equal(afterRestart.status, 429);
  assert.equal(calls, 1, 'concurrent/restarted callers must not create a second provider connection');
  assert.ok(reserved.activeUntil > now);
  assert.equal(storage.state.activeUntil, 0);
  assert.equal((await restarted.routeTravel(TRIP)).status, 429, 'restart does not erase the post-completion spacing');
  now += 1100;
  assert.equal((await restarted.routeTravel(TRIP)).status, 200);
  assert.equal(calls, 2);
  assert.equal(storage.state.count, 2);
  const serialized = JSON.stringify(storage.writes);
  assert.ok(!serialized.includes(String(TRIP.origin[0])) && !serialized.includes(String(TRIP.destination[1])));
  assert.ok(!serialized.includes('Private home') && !serialized.includes('private-person'));
  for (const value of storage.writes) assert.deepEqual(Object.keys(value).sort(), ['activeUntil', 'count', 'day', 'nextAt', 'token']);
});

test('the actual Durable Object keeps the daily budget through eviction and resumes the next day', async t => {
  const day = 120; let now = day * 86400000 + 10000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json(osrmFixture()); });
  const storage = quotaStorage({ day, count: 999, nextAt: 0, activeUntil: 0 });
  assert.equal((await new HereTenantAgent({ storage }, PILOT).routeTravel(TRIP)).status, 200);
  now += 2000;
  const denied = await new HereTenantAgent({ storage }, PILOT).routeTravel(TRIP);
  assert.equal(denied.status, 429); assert.match(denied.error, /daily limit/);
  assert.equal(calls, 1);
  now = (day + 1) * 86400000;
  assert.equal((await new HereTenantAgent({ storage }, PILOT).routeTravel(TRIP)).status, 200);
  assert.equal(storage.state.count, 1); assert.equal(calls, 2);
});

test('upstream throttling releases the active lease while persisting the provider cooldown', async t => {
  let now = 150 * 86400000 + 10000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response('busy', { status: 429 }) : json(osrmFixture()));
  const storage = quotaStorage(), agent = new HereTenantAgent({ storage }, PILOT);
  const first = await agent.routeTravel(TRIP);
  assert.equal(first.status, 429); assert.equal(first.retryAfter, 60);
  assert.equal(storage.state.activeUntil, 0);
  now += 59000;
  assert.equal((await new HereTenantAgent({ storage }, PILOT).routeTravel(TRIP)).status, 429);
  assert.equal(calls, 1);
  now += 1000;
  assert.equal((await agent.routeTravel(TRIP)).status, 200);
  assert.equal(calls, 2);
});

test('a late completion cannot release a newer durable quota reservation', async t => {
  let release;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { release = () => resolve(json(osrmFixture())); }));
  const storage = quotaStorage(), agent = new HereTenantAgent({ storage }, PILOT);
  const pending = agent.routeTravel(TRIP);
  const newer = { ...storage.state, token: 'newer-reservation', count: storage.state.count + 1, activeUntil: Date.now() + 30000 };
  storage.state = newer;
  release(); await pending;
  assert.deepEqual(storage.state, newer, 'finally must release only its own reservation token');
});
