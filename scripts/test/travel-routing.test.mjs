import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinate, distanceBetween, normalizeRouteRequest, normalizeRoute, boundedJson } from '../../js/travel/route-core.mjs';
import { fetchRoute } from '../../js/travel/route-client.mjs';
import { navigationProgress } from '../../js/travel/navigation-progress.mjs';
import { rideHandoff } from '../../js/travel/ride-handoff.mjs';

// These are measured paths, not mocks of the implementation's projection math.
// Equatorial coordinates make the expected distances readable in meters.
const meters = (x, y) => [x / 111195.0802335329, y / 111195.0802335329];
const copy = value => structuredClone(value);
function road(points = [[0, 0], [100, 0], [100, 100], [200, 100]], mode = 'walk') {
  const geometry = points.map(([x, y]) => meters(x, y));
  const lengths = geometry.map((p, i) => i < geometry.length - 1 ? distanceBetween(p, geometry[i + 1]) : 0);
  return normalizeRoute({
    origin: geometry[0], destination: geometry.at(-1), mode, provider: 'Test street engine', attribution: 'Map attribution',
    distanceMeters: lengths.reduce((a, b) => a + b, 0), durationSeconds: 240, geometry,
    steps: geometry.map((location, i) => ({ location, geometryIndex: i, distanceMeters: lengths[i], durationSeconds: i < geometry.length - 1 ? 80 : 0,
      instruction: i === 0 ? 'Start on First Street' : i === geometry.length - 1 ? 'Arrive at your destination' : `Turn onto Street ${i + 1}`,
      maneuver: { type: i === 0 ? 'depart' : i === geometry.length - 1 ? 'arrive' : 'turn', modifier: i === 1 ? 'left' : 'right' }
    }))
  });
}
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const closeTo = (actual, expected, tolerance = 0.5) => assert.ok(Math.abs(actual - expected) < tolerance, `expected ${actual} within ${tolerance} of ${expected}`);

test('route requests accept numeric longitude/latitude pairs and the three supported street modes', () => {
  const original = [180, -90];
  assert.deepEqual(coordinate(original), original);
  assert.notEqual(coordinate(original), original, 'the caller cannot mutate the normalized point');
  for (const mode of ['drive', 'walk', 'cycle']) {
    const input = { origin: [-72.9, 41.3], destination: [-72.91, 41.31], mode, originLabel: 'Private home', userId: 'person', email: 'private@example.test', accuracy: 5 };
    assert.deepEqual(normalizeRouteRequest(input), { origin: input.origin, destination: input.destination, mode });
  }
  closeTo(distanceBetween([0, 0], [0.001, 0]), 111.195, 0.01);
  closeTo(distanceBetween([179.999, 0], [-179.999, 0]), 222.390, 0.02);
});

test('invalid, sparse, out-of-range and ambiguous route points never become usable coordinates', () => {
  for (const point of [null, {}, '0,0', [], [0], [0, 0, 0], ['0', 0], [false, 0], [null, 0], [undefined, 0], [NaN, 0], [Infinity, 0], [181, 0], [0, -91], Array(2), [, 0], [0, ,]]) {
    assert.throws(() => coordinate(point), TypeError, `accepted invalid point ${String(point)}`);
  }
  for (const mode of ['flight', 'transit', 'rides', 'DRIVE', '', null]) {
    assert.throws(() => normalizeRouteRequest({ origin: [0, 0], destination: [1, 0], mode }));
  }
  for (const input of [null, [], 4]) assert.throws(() => normalizeRouteRequest(input));
  assert.throws(() => normalizeRouteRequest({ origin: [0, 0], destination: meters(4, 0), mode: 'walk' }), /same/i);
});

test('normalization preserves street metrics and strips unrelated provider and traveler data', () => {
  const input = road();
  input.steps[1].instruction = '\u0000Turn left\nonto Chapel Street';
  input.steps[1].rawProviderKey = 'private-key';
  input.identity = { email: 'private@example.test' };
  input.raw = { token: 'provider-token' };
  input.warnings = ['First warning', '\u0000Second warning', '', 'Third', 'Fourth', 'Fifth'];
  const result = normalizeRoute(input);
  assert.equal(result.steps[1].instruction, 'Turn left onto Chapel Street');
  assert.equal(result.distanceMeters, input.distanceMeters);
  assert.equal(result.durationSeconds, 240);
  assert.equal(result.geometry.length, 4);
  assert.equal(result.warnings.length, 4);
  assert.equal(result.traffic, false);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('provider-token'));
  result.geometry[0][0] = 1;
  assert.equal(input.geometry[0][0], 0, 'a returned geometry must be independent of provider input');
});

test('incomplete, degenerate and unrelated geometry is rejected instead of inventing a successful route', () => {
  const changes = [
    r => { r.geometry = []; }, r => { r.geometry = [[0, 0]]; },
    r => { r.geometry = r.geometry.map(() => [0, 0]); r.steps = [r.steps[0]]; },
    r => { r.geometry = Array(4); }, r => { r.geometry = Array.from({ length: 10001 }, () => [0, 0]); },
    r => { r.steps = []; }, r => { r.steps = Array(4); }, r => { r.steps = Array.from({ length: 1501 }, () => r.steps[0]); },
    r => { r.steps[1] = null; }, r => { r.steps[1].instruction = ''; },
    r => { r.steps[1].geometryIndex = 4; }, r => { r.steps[2].geometryIndex = 0; },
    r => { r.steps[1].location = meters(300, 300); },
    r => { r.origin = meters(2000, 0); }, r => { r.destination = meters(2000, 2000); },
    r => { r.distanceMeters = 0; }, r => { r.durationSeconds = 0; },
    r => { r.distanceMeters = Infinity; }, r => { r.durationSeconds = -1; },
    r => { r.steps[0].distanceMeters = '100'; }, r => { r.steps[0].durationSeconds = NaN; }
  ];
  for (const change of changes) {
    const input = road(); change(input);
    assert.throws(() => normalizeRoute(input), undefined, change.toString());
  }
});

test('bounded JSON handles split Unicode and refuses a body exceeding its byte budget', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ instruction: 'Turn onto Rue de l’Église 🚲' }));
  let offset = 0;
  const stream = new ReadableStream({ pull(controller) { if (offset === bytes.length) return controller.close(); controller.enqueue(bytes.slice(offset, offset += 1)); } });
  assert.deepEqual(await boundedJson(new Response(stream), bytes.length), { instruction: 'Turn onto Rue de l’Église 🚲' });
  let cancelled = false;
  const tooLarge = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
  await assert.rejects(boundedJson(new Response(tooLarge), 10), RangeError);
  assert.equal(cancelled, true, 'an over-budget stream is actively cancelled');
  let reads = 0;
  const announced = new ReadableStream({ pull() { reads++; }, cancel() { cancelled = true; } });
  cancelled = false;
  await assert.rejects(boundedJson(new Response(announced, { headers: { 'content-length': '200' } }), 100), RangeError);
  assert.equal(cancelled, true);
  assert.ok(reads <= 1, 'an advertised oversized response is never consumed');
  await assert.rejects(boundedJson(new Response(null)), /empty/i);
  await assert.rejects(boundedJson(new Response('not JSON')), SyntaxError);
});

test('the route client sends only endpoints and mode in an uncached anonymous POST to the canonical Worker', async () => {
  const route = road();
  const result = await fetchRoute({ ...route, originLabel: 'Private home', destinationLabel: 'Private appointment', accessToken: 'do-not-send' }, { request: async (url, options) => {
    assert.equal(url, 'https://api.mccluster.org/v1/travel/route');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { origin: route.origin, destination: route.destination, mode: route.mode });
    assert.deepEqual(options.headers, { 'content-type': 'application/json' });
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.referrerPolicy, 'origin');
    assert.ok(options.signal instanceof AbortSignal);
    return response({ route });
  } });
  assert.deepEqual(result, route);
});

test('a pre-cancelled request never reaches the network and an in-flight cancellation aborts fetch', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(fetchRoute(road(), { signal: before.signal, request: () => assert.fail('cancelled request fetched') }), { name: 'AbortError' });
  const during = new AbortController();
  let networkSignal;
  const pending = fetchRoute(road(), { signal: during.signal, request: (_url, options) => {
    networkSignal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  } });
  during.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(networkSignal.aborted, true);
});

test('a response which finishes racing cancellation cannot revive a cancelled trip', async () => {
  const controller = new AbortController();
  const pending = fetchRoute(road(), { signal: controller.signal, request: async () => {
    // The body is already locally buffered when the caller edits the trip.
    const ready = response({ route: road() });
    controller.abort();
    return ready;
  } });
  await assert.rejects(pending, { name: 'AbortError' });
});

test('the client has a finite timeout, releases its timer and reports a useful retry message', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = fetchRoute(road(), { request: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }) });
  t.mock.timers.tick(18001);
  await assert.rejects(pending, /took too long/i);
});

test('completed requests remove their timeout and caller abort listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let networkSignal;
  await fetchRoute(road(), { signal: controller.signal, request: async (_url, { signal }) => {
    networkSignal = signal; return response({ route: road() });
  } });
  t.mock.timers.tick(18001);
  assert.equal(networkSignal.aborted, false, 'a completed request must not leave its timeout running');
  controller.abort();
  assert.equal(networkSignal.aborted, false, 'the settled request must detach from later trip edits');
});

test('a successful HTTP response for another trip or malformed directions is refused', async () => {
  const route = road();
  for (const patch of [{ mode: 'drive' }, { destination: meters(220, 100) }, { origin: meters(-20, 0) }]) {
    await assert.rejects(fetchRoute(route, { request: async () => response({ route: { ...route, ...patch } }) }), /different trip/i);
  }
  for (const invalid of [{}, { route: { ...route, geometry: [] } }, { route: { ...route, steps: [] } }]) {
    await assert.rejects(fetchRoute(route, { request: async () => response(invalid) }));
  }
  await assert.rejects(fetchRoute(route, { request: async () => new Response('<html>broken gateway</html>') }), SyntaxError);
});

test('HTTP failures retain actionable status and a bounded retry delay without surfacing proxy HTML', async () => {
  await assert.rejects(fetchRoute(road(), { request: async () => response({ error: 'The street service is busy.', retryAfter: 60 }, 429) }), error => error.status === 429 && error.retryAfter === 60 && /busy/.test(error.message));
  await assert.rejects(fetchRoute(road(), { request: async () => response({ error: 'Wait.' }, 503, { 'retry-after': '45' }) }), error => error.status === 503 && error.retryAfter === 45);
  await assert.rejects(fetchRoute(road(), { request: async () => response({ error: 'x'.repeat(800), retryAfter: 999999999 }, 503) }), error => error.message.length === 400 && error.retryAfter === 86400);
  await assert.rejects(fetchRoute(road(), { request: async () => new Response('<html>internal gateway secret</html>', { status: 502 }) }), error => error.status === 502 && !error.message.includes('secret') && /unavailable/.test(error.message));
});

test('navigation shows the approaching turn, keeps it through the junction and advances after it', () => {
  const route = road();
  const start = navigationProgress(route, meters(0, 0), { accuracy: 8 });
  assert.equal(start.nextStep.maneuver.type, 'depart');
  const approach = navigationProgress(route, meters(90, 0), { accuracy: 8, previousProgressMeters: 70 });
  assert.equal(approach.stepIndex, 1);
  closeTo(approach.distanceToNextMeters, 10);
  const junction = navigationProgress(route, meters(100, 3), { accuracy: 8, previousProgressMeters: 98 });
  assert.equal(junction.stepIndex, 1, 'do not change an instruction while crossing its junction');
  const after = navigationProgress(route, meters(100, 12), { accuracy: 8, previousProgressMeters: 100 });
  assert.equal(after.stepIndex, 2);
  closeTo(after.distanceToNextMeters, 88);
  assert.ok(after.remainingSeconds < approach.remainingSeconds);
});

test('poor GPS cannot advance, request a reroute or declare arrival', () => {
  const route = road();
  for (const accuracy of [101, 250, -1, Infinity, NaN, '5']) {
    const result = navigationProgress(route, route.destination, { accuracy, previousProgressMeters: 80 });
    assert.equal(result.usable, false);
    assert.equal(result.distanceAlongMeters, 80);
    assert.equal(result.offRoute, false);
    assert.equal(result.arrived, false);
  }
  const uncertain = navigationProgress(route, route.destination, { accuracy: 50, previousProgressMeters: 290 });
  assert.equal(uncertain.arrived, false, '50 m accuracy cannot establish a 30 m arrival');
});

test('off-route fixes preserve progress and backward GPS jitter never reverses completed steps', () => {
  const route = road();
  const offRoute = navigationProgress(route, meters(400, 400), { accuracy: 10, previousProgressMeters: 100 });
  assert.equal(offRoute.offRoute, true);
  assert.equal(offRoute.distanceAlongMeters, 100);
  assert.equal(offRoute.arrived, false);
  const jitter = navigationProgress(route, meters(100, 10), { accuracy: 10, previousProgressMeters: 125 });
  assert.equal(jitter.distanceAlongMeters, 125);
  assert.equal(jitter.stepIndex, 2);
});

test('arrival requires both progress to the end and a precise fix near the requested destination', () => {
  const route = road();
  const arrival = navigationProgress(route, meters(196, 100), { accuracy: 8, previousProgressMeters: 275 });
  assert.equal(arrival.arrived, true);
  closeTo(arrival.remainingDistanceMeters, 4);
  const snapped = copy(route); snapped.destination = meters(245, 100);
  assert.equal(navigationProgress(snapped, meters(200, 100), { accuracy: 8, previousProgressMeters: 275 }).arrived, false,
    'reaching a road snap 45 m from the requested entrance is not reaching that entrance');
});

test('nearby crossing roads do not skip the intervening journey after ordinary GPS drift', () => {
  const route = road([[-100, 0], [100, 0], [100, 100], [-100, 100], [-100, -100], [0, -100], [0, 100]]);
  const result = navigationProgress(route, meters(0, 5), { accuracy: 10, previousProgressMeters: 90, maximumAdvanceMeters: 2000 });
  assert.ok(result.distanceAlongMeters >= 90 && result.distanceAlongMeters <= 130, `crossing jumped to ${result.distanceAlongMeters} m`);
  assert.equal(result.stepIndex, 1);
  assert.equal(result.arrived, false);
});

test('a short loop ending near its start cannot report arrival on its first GPS fix', () => {
  const route = road([[0, 0], [40, 0], [40, 40], [0, 40], [0, 10]]);
  const result = navigationProgress(route, meters(0, 10), { accuracy: 10, previousProgressMeters: 0 });
  assert.equal(result.arrived, false, 'the 150 m loop has not been traveled');
  assert.ok(result.distanceAlongMeters < 30, `first fix skipped ${result.distanceAlongMeters} m`);
});

test('maximum advancement applies inside long road segments and projection survives the antimeridian', () => {
  const route = road([[0, 0], [10000, 0]], 'drive');
  const jump = navigationProgress(route, meters(9000, 0), { accuracy: 10, previousProgressMeters: 0, maximumAdvanceMeters: 200 });
  assert.ok(jump.distanceAlongMeters <= 200.001, 'a long segment must not bypass the advancement bound');
  assert.equal(jump.arrived, false);
  const dateline = road([[0, 0], [200, 0]]);
  dateline.origin = [179.999, 0]; dateline.destination = [-179.999, 0];
  dateline.geometry = [dateline.origin, dateline.destination];
  dateline.distanceMeters = distanceBetween(...dateline.geometry);
  dateline.steps.forEach((s, i) => { s.location = dateline.geometry[i]; });
  const progress = navigationProgress(dateline, [180, 0], { accuracy: 5, previousProgressMeters: 90 });
  closeTo(progress.distanceAlongMeters, dateline.distanceMeters / 2);
  assert.equal(progress.offRoute, false);
});

test('Uber handoff uses the documented mobile web contract and preserves selected address labels exactly', () => {
  const origin = [-72.9293, 41.3081], destination = [-72.9251, 41.2989];
  const originLabel = '12 O’Connell St, Apt #4 & rear entrance';
  const destinationLabel = 'Café / Clínica “São José” [North] = Entrance 2';
  const url = new URL(rideHandoff({ origin, destination, originLabel, destinationLabel }));
  assert.equal(url.origin + url.pathname, 'https://m.uber.com/looking');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['drop[0]', 'pickup']);
  assert.deepEqual(JSON.parse(url.searchParams.get('pickup')), { latitude: origin[1], longitude: origin[0], addressLine1: originLabel });
  assert.deepEqual(JSON.parse(url.searchParams.get('drop[0]')), { latitude: destination[1], longitude: destination[0], addressLine1: destinationLabel });
  assert.equal(url.hash, '', 'address punctuation must not turn into navigation or query syntax');
  assert.ok(!url.searchParams.has('client_id') && !url.searchParams.has('product_id') && !url.searchParams.has('fare'));
  assert.throws(() => rideHandoff({ origin, destination: origin }), /same/i);
});
