import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlace, directionsLink, createPlan, legHandoff } from '../../js/travel/navigation-core.mjs';

const origin = { query: 'New Haven Union Station, Connecticut' };
const airport = { query: 'Bradley International Airport, Connecticut' };
const planInput = () => ({ id: 'example-trip', legs: [
  { id: 'airport-ride', kind: 'drive', origin, destination: airport },
  { id: 'flight', kind: 'flight', origin: airport, destination: { query: 'Arrival airport (example)' } },
  { id: 'pickup', kind: 'drive', origin: { query: 'Arrival airport (example)' }, destination: { query: 'Chosen hotel (example)' } },
  { id: 'hotel', kind: 'stay', destination: { query: 'Chosen hotel (example)' } },
] });

test('normalizes place text without inventing coordinates', () => {
  assert.deepEqual(normalizePlace({ query: '  New   Haven  ' }), { query: 'New Haven' });
});

test('rejects missing/ambiguous places', () => {
  for (const place of [null, false, [], {}, { query: '' }, { query: 12 },
    { query: 'A', coordinates: [1, 2] }, { query: 'A\nB' }, { query: 'x'.repeat(241) }]) {
    assert.throws(() => normalizePlace(place));
  }
});

test('does not coerce missing coordinates into the Gulf of Guinea', () => {
  for (const coordinates of [[null, 0], [false, 1], ['', 1], ['12', 1], [NaN, 1],
    [Infinity, 1], [181, 0], [0, 91], [0], [0, 0, 0]]) {
    assert.throws(() => normalizePlace({ coordinates }));
  }
  assert.deepEqual(normalizePlace({ coordinates: [0, 0] }).coordinates, [0, 0]);
});

test('copies and freezes numeric coordinates', () => {
  const coordinates = [-73, 41];
  const place = normalizePlace({ coordinates });
  coordinates[0] = 0;
  assert.deepEqual(place.coordinates, [-73, 41]);
  assert.throws(() => { place.coordinates[0] = 0; }, TypeError);
});

for (const provider of ['google', 'apple']) {
  test(`${provider}: text directions with explicit endpoints and no API key`, () => {
    const url = new URL(directionsLink({ provider, origin, destination: airport }));
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, provider === 'google' ? 'www.google.com' : 'maps.apple.com');
    assert.equal(url.searchParams.get('destination'), airport.query);
    assert.equal(url.searchParams.get(provider === 'google' ? 'origin' : 'source'), origin.query);
    assert.equal(url.searchParams.has('key'), false);
    if (provider === 'google') assert.equal(url.searchParams.get('api'), '1');
  });
  test(`${provider}: omitted origin is NOT resolved or fabricated here`, () => {
    const url = new URL(directionsLink({ provider, destination: airport }));
    assert.equal(url.searchParams.has('origin'), false);
    assert.equal(url.searchParams.has('source'), false);
  });
  test(`${provider}: GeoJSON lon/lat is converted to map URL lat/lon`, () => {
    const url = new URL(directionsLink({ provider, destination: { coordinates: [-72.68, 41.94] } }));
    assert.equal(url.searchParams.get('destination'), '41.94,-72.68');
  });
  test(`${provider}: Unicode and hostile query strings cannot replace host/parameters`, () => {
    const query = 'Café &mode=driving #? https://evil.example/<script>';
    const url = new URL(directionsLink({ provider, destination: { query }, mode: 'walking' }));
    assert.equal(url.searchParams.get('destination'), query);
    assert.equal(url.searchParams.get(provider === 'google' ? 'travelmode' : 'mode'), 'walking');
    assert.equal(url.hash, '');
    assert.equal(url.username, '');
    assert.equal(url.searchParams.size, provider === 'google' ? 3 : 2);
  });
  test(`${provider}: all ground modes retain their meaning`, () => {
    for (const mode of ['driving', 'walking', 'cycling', 'transit']) {
      const url = new URL(directionsLink({ provider, destination: airport, mode }));
      assert.equal(url.searchParams.get(provider === 'google' ? 'travelmode' : 'mode'),
        provider === 'google' && mode === 'cycling' ? 'bicycling' : mode);
    }
  });
}

test('fails closed for provider, mode and URL overflow', () => {
  assert.throws(() => directionsLink({ provider: 'javascript:', destination: airport }));
  assert.throws(() => directionsLink({ provider: '__proto__', destination: airport }));
  assert.throws(() => directionsLink({ provider: 'google', destination: airport, mode: 'flight' }));
  assert.throws(() => directionsLink({ provider: 'google', destination: { query: '東'.repeat(240) } }), RangeError);
});

test('itinerary preserves all leg kinds and order, without fake reservations or live values', () => {
  const plan = createPlan(planInput());
  assert.equal(plan.status, 'draft');
  assert.equal(plan.dataKind, 'user_plan');
  assert.deepEqual(plan.legs.map(leg => leg.kind), ['drive', 'flight', 'drive', 'stay']);
  for (const leg of plan.legs) {
    assert.equal(leg.status, 'unconfirmed');
    assert.equal(leg.price, null);
    assert.equal(leg.eta, null);
  }
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.legs));
});

test('untrusted confirmation, private data and URLs are not promoted into plan output', () => {
  const input = planInput();
  input.passport = 'private'; input.status = 'booked';
  input.legs[0].driverId = 'unverified'; input.legs[0].status = 'confirmed';
  input.legs[0].destination.url = 'https://evil.example/';
  const plan = createPlan(input);
  assert.equal(plan.passport, undefined);
  assert.equal(plan.legs[0].driverId, undefined);
  assert.equal(plan.legs[0].destination.url, undefined);
  assert.equal(plan.legs[0].status, 'unconfirmed');
});

test('invalid or duplicate identifiers, oversized plans and missing origins are refused', () => {
  for (const input of [null, { id: 'x', legs: [] }, { id: '../x', legs: planInput().legs },
    { id: 'x', legs: Array(33).fill(planInput().legs[0]) },
    { id: 'x', legs: [planInput().legs[0], planInput().legs[0]] },
    { id: 'x', legs: [{ id: 'a', kind: 'drive', destination: airport }] },
    { id: 'x', legs: [{ id: 'a', kind: '__proto__', origin, destination: airport }] }]) {
    assert.throws(() => createPlan(input));
  }
});

test('selected pickup opens only that leg, not the entire intercontinental itinerary', () => {
  const result = legHandoff(planInput(), 'pickup', 'google');
  const url = new URL(result.url);
  assert.equal(url.searchParams.get('origin'), 'Arrival airport (example)');
  assert.equal(url.searchParams.get('destination'), 'Chosen hotel (example)');
  assert.equal(result.routeGeometry, null);
  assert.equal(result.eta, null);
});

test('flight, scheduled train/bus and stay cannot silently become driving routes', () => {
  for (const kind of ['flight', 'train', 'bus', 'stay']) {
    const input = { id: 'x', legs: [{ id: 'leg', kind, origin, destination: airport }] };
    const result = legHandoff(input, 'leg', 'apple');
    assert.equal(result.available, false);
    assert.equal(result.url, null);
  }
});

test('explicit startHere omits origin; missing/invalid selection never chooses a different leg', () => {
  const plan = createPlan(planInput());
  const result = legHandoff(plan, 'airport-ride', 'google', { startHere: true });
  assert.equal(new URL(result.url).searchParams.has('origin'), false);
  assert.equal(plan.legs[0].origin.query, origin.query);
  assert.throws(() => legHandoff(plan, 'missing', 'google'), RangeError);
  assert.throws(() => legHandoff(plan, 'airport-ride', 'google', { startHere: 'true' }), TypeError);
});


test('sparse coordinates and sparse itineraries cannot bypass validation', () => {
  assert.throws(() => normalizePlace({ coordinates: new Array(2) }));
  assert.throws(() => createPlan({ id: 'x', legs: new Array(2) }));
});

test('normalization never mutates caller data or treats prototype fields as destinations', () => {
  const input = planInput();
  const before = JSON.stringify(input);
  const plan = createPlan(input);
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(plan.legs[0].origin, input.legs[0].origin);
  assert.throws(() => normalizePlace(Object.create({ query: 'London' })));
});

test('generic transit, cycling and walking handoffs preserve the chosen leg', () => {
  for (const [kind, mode] of [['walk', 'walking'], ['cycle', 'cycling'], ['transit', 'transit']]) {
    const input = { id: 'x', legs: [{ id: 'leg', kind, origin, destination: airport }] };
    const url = new URL(legHandoff(input, 'leg', 'apple').url);
    assert.equal(url.searchParams.get('mode'), mode);
    assert.equal(url.searchParams.get('destination'), airport.query);
  }
});
