/* A QUAKE'S DOCUMENTED RUPTURE (./src/world-environment-layers.js, event timeline slice S5, 2026-11-19, decision D13), reached
   the way the Worker reaches it: through handleWorldEnvironment, behind the persisted environment module policy. Only the
   modelled up-dip edge of a USGS finite-fault plane is answered; a point source, a plane naming no finite fault, a withdrawn
   event and an unreachable USGS each say why nothing is drawn. Fake fetch and an in-memory cache only. Fixtures are real USGS
   answers recorded on 2026-11-19 (public domain, U.S. Government work), trimmed: us6000u43g, M7.0 "189 km ENE of Nagqu, China",
   whose ShakeMap rupture.json is a MultiPolygon from the USGS NEIC Rapid Finite Fault; nn00927068, M3.0 near Silver Springs,
   Nevada, whose ShakeMap (code us7000tyr4) models a Point at the origin. Anything built here in code is labelled as built. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleWorldEnvironment } from '../src/world-environment.js';
import { RUPTURE, readRupture, upDipEdge, shakemapDetailUrl } from '../src/world-environment-layers.js';
import { ENVIRONMENT_PUBLIC_ROUTES, environmentRouteForPath } from '../../../packages/release-policy/globe.mjs';
import { createPublicReadLimits, limitPublicRead } from '../src/world-environment-guard.js';
import { workersFetch } from './support/workers-fetch-semantics.mjs';

const ORIGIN = 'https://mccluster.org';
const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', ALLOWED_ORIGINS: ORIGIN };
const P = '/v1/world/environment';
const FX = (name) => JSON.parse(readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8'));
const DETAIL = { us6000u43g: FX('usgs-detail-us6000u43g.json'), nn00927068: FX('usgs-detail-nn00927068.json'), us7000tyhr: FX('usgs-detail-us7000tyhr.json') };
const RUPTURES = { us6000u43g: FX('usgs-rupture-us6000u43g.json'), us7000tyr4: FX('usgs-rupture-us7000tyr4.json') };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });
const req = (path, { method = 'GET' } = {}) => new Request(`https://api.mccluster.org${path}`, { method, headers: { origin: ORIGIN } });
function memoryCache() {
  const raw = new Map();
  return { raw, async match(k) { return raw.has(k.url) ? new Response(raw.get(k.url)) : undefined; }, async put(k, r) { raw.set(k.url, await r.text()); } };
}
const POLICY_RPC = '/rest/v1/rpc/eup_module_policy_read';
const policyOf = (state = 'enabled') => ({ schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: 'environment', state, revision: 3 });
function world(providers, { policy = policyOf() } = {}) {
  return workersFetch(async (url, init, call) => {
    if (url.href.endsWith(POLICY_RPC)) return json(policy);
    return providers(url, init, call);
  });
}
const providerCalls = (f) => f.calls.filter((c) => !c.url.endsWith(POLICY_RPC));
/* USGS's own host only: the detail feed by event id, and a ShakeMap product's rupture.json */
function usgs({ detail = (id) => (DETAIL[id] ? json(DETAIL[id]) : text('Error 404: No Data Found', 404)), rupture = (code) => json(RUPTURES[code]) } = {}) {
  return (url) => {
    assert.equal(url.hostname, 'earthquake.usgs.gov', 'USGS\'s own host only');
    const m = url.pathname.match(/^\/earthquakes\/feed\/v1\.0\/detail\/([a-z0-9]+)\.geojson$/);
    if (m) return detail(m[1]);
    const r = url.pathname.match(/:shakemap:([a-z0-9]+):\d+\/contents\/download\/rupture\.json$/);
    if (r) return rupture(r[1]);
    const c = url.pathname.match(/:shakemap:([a-z0-9]+):\d+\/contents\/download\/cont_mmi\.json$/);
    if (c) return json({ type: 'FeatureCollection', features: [] });
    throw new Error('unexpected USGS path ' + url.pathname);
  };
}
async function rupture(id, fetchImpl, cacheImpl = memoryCache()) {
  const r = await handleWorldEnvironment(req(`${P}/quakes/${id}/rupture`), ENV, { fetchImpl, cacheImpl });
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  return { status: r.status, body: await r.json() };
}

test('the route is public, mapped to the environment module and to no Halo feature; a lookup counted against the tighter limit', () => {
  assert.deepEqual(ENVIRONMENT_PUBLIC_ROUTES.map((r) => r.id).slice(-2), ['shakemap', 'rupture']);
  assert.deepEqual(environmentRouteForPath(`${P}/quakes/us6000u43g/rupture`), { id: 'rupture', module: 'environment', param: 'us6000u43g' });
  assert.equal(environmentRouteForPath(`${P}/quakes/us6000u43g/rupture/extra`), null);
  /* one client asking 31 ruptures inside a second: the 31st waits (lookups bucket: 30, one every 2 s) */
  const limits = createPublicReadLimits({ now: () => 0 });
  const ask = () => limitPublicRead(new Request(`https://api.mccluster.org${P}/quakes/us6000u43g/rupture`, { headers: { 'cf-connecting-ip': '203.0.113.7' } }), ENV, limits);
  for (let i = 0; i < 30; i += 1) assert.equal(ask(), null, `lookup ${i + 1}`);
  const refused = ask();
  assert.equal(refused.status, 429);
});

test('a finite-fault plane: the modelled up-dip edge, its depths, its model and reference, labelled a model (real sample)', async () => {
  const f = world(usgs());
  const { status, body: b } = await rupture('us6000u43g', f);
  assert.equal(status, 200);
  assert.deepEqual(providerCalls(f).map((c) => c.url), [shakemapDetailUrl('us6000u43g'), DETAIL.us6000u43g.properties.products.shakemap[0].contents['download/rupture.json'].url]);
  assert.equal(b.schema, 'world-environment-rupture/v1'); assert.equal(b.available, true); assert.equal(b.reason, null); assert.equal(b.modelled, true);
  /* the plane runs from 0.1 km to 22.7 km; its two vertices at 0.1 km are its up-dip edge */
  assert.deepEqual(b.edges, [[[93.92, 32.27], [94, 32.56]]]);
  assert.deepEqual([b.top_depth_km, b.bottom_depth_km], [0.1, 22.7]);
  assert.equal(b.label, 'modelled rupture plane (USGS finite fault)');
  assert.match(b.reference, /USGS NEIC Rapid Finite Fault/); assert.equal(b.reviewed, true); assert.equal(b.model_created, '2026-11-03 14:59:26');
  assert.match(b.notes.rupture, /a model: not a crack mapped at the surface/);
  assert.deepEqual(b.sources.map((s) => [s.id, s.status]), [['usgs_event', 'available'], ['usgs_rupture', 'available']]);
  assert.equal(b.usgs_preferred_id, 'us6000u43g'); assert.equal(b.version, 6);
  assert.doesNotMatch(JSON.stringify(b), /server-secret/);
});

test('a point source draws nothing and says so; so does a quake with no ShakeMap, an unknown one, and a ShakeMap with no rupture file', async () => {
  const point = await rupture('nn00927068', world(usgs()));
  assert.deepEqual([point.status, point.body.available, point.body.reason, point.body.edges], [200, false, 'point_source', []]);
  assert.equal(point.body.reference, 'Origin');
  /* us7000tyhr's ShakeMap lists no rupture.json (the trimmed sample keeps only its contours) */
  const none = await rupture('us7000tyhr', world(usgs()));
  assert.deepEqual([none.body.available, none.body.reason], [false, 'no_rupture']);
  const noShakemap = structuredClone(DETAIL.us6000u43g); noShakemap.properties.products.shakemap = [];
  const ns = await rupture('us6000u43g', world(usgs({ detail: () => json(noShakemap) })));
  assert.deepEqual([ns.body.available, ns.body.reason], [false, 'no_shakemap']);
  const unknown = await rupture('zz0000000000', world(usgs()));
  assert.deepEqual([unknown.body.available, unknown.body.reason], [false, 'event_not_found']);
});

test('a deleted event: USGS answers 409, and the rupture is withdrawn, even over a copy kept before the deletion', async () => {
  const deleted = () => text('Error 409: Conflict\n\nThe requested event has been deleted.', 409);
  const gone = await rupture('us6000u43g', world(usgs({ detail: deleted })));
  assert.deepEqual([gone.status, gone.body.available, gone.body.reason, gone.body.edges], [200, false, 'withdrawn', []]);
  /* a kept detail from before, past its 5 minutes: USGS now says deleted, so it is withdrawn, never the old plane */
  const cache = memoryCache();
  await rupture('us6000u43g', world(usgs()), cache);
  for (const [k, v] of cache.raw) { const b = JSON.parse(v); if (typeof b.fetched_at === 'string') { b.fetched_at = new Date(Date.parse(b.fetched_at) - 400000).toISOString(); cache.raw.set(k, JSON.stringify(b)); } }
  const after = await rupture('us6000u43g', world(usgs({ detail: deleted })), cache);
  assert.deepEqual([after.body.available, after.body.reason], [false, 'withdrawn']);
});

test('USGS unreachable or answering garbage: nothing drawn, the source says why; a rupture link off USGS is never followed', async () => {
  const down = await rupture('us6000u43g', world(usgs({ detail: () => text('down', 503) })));
  assert.deepEqual([down.body.available, down.body.reason, down.body.sources[0].status], [false, 'source_unavailable', 'unavailable']);
  const bad = await rupture('us6000u43g', world(usgs({ rupture: () => json({ nope: true }) })));
  assert.deepEqual([bad.body.available, bad.body.reason, bad.body.sources[1].reason], [false, 'source_unavailable', 'invalid_data']);
  const offHost = structuredClone(DETAIL.us6000u43g);
  offHost.properties.products.shakemap[0].contents['download/rupture.json'].url = 'https://evil.example/rupture.json';
  const f = world(usgs({ detail: () => json(offHost) }));
  const off = await rupture('us6000u43g', f);
  assert.deepEqual([off.body.available, off.body.reason], [false, 'no_rupture']);
  assert.ok(providerCalls(f).every((c) => new URL(c.url).hostname === 'earthquake.usgs.gov'));
});

test('the rupture and its ShakeMap share one event read: kept 5 minutes, the rupture file kept a day per product version', async () => {
  const cache = memoryCache(), f = world(usgs());
  await handleWorldEnvironment(req(`${P}/quakes/us6000u43g/shakemap`), ENV, { fetchImpl: f, cacheImpl: cache });
  await rupture('us6000u43g', f, cache);
  await rupture('us6000u43g', f, cache);
  const details = providerCalls(f).filter((c) => c.url === shakemapDetailUrl('us6000u43g')).length;
  const files = providerCalls(f).filter((c) => /rupture\.json$/.test(c.url)).length;
  assert.equal(details, 1, 'one detail read for both routes');
  assert.equal(files, 1, 'the rupture file read once');
  assert.ok([...cache.raw.keys()].some((k) => k.endsWith('consumer-environment-v1-rupture-us6000u43g-us-us6000u43g-6-1793743863256')));
  assert.equal(RUPTURE.ttl, 86400);
});

test('the gate answers first: off (404) and an outage (503) before USGS is asked; the id is checked before anyone is asked', async () => {
  for (const [state, status, code] of [['disabled', 404, 'module_disabled']]) {
    const f = world(usgs(), { policy: policyOf(state) });
    const r = await rupture('us6000u43g', f);
    assert.deepEqual([r.status, r.body.code], [status, code]);
    assert.equal(providerCalls(f).length, 0);
  }
  const outage = workersFetch(async (url) => { if (url.href.endsWith(POLICY_RPC)) return text('down', 500); throw new Error('no provider expected'); });
  const o = await rupture('us6000u43g', outage);
  assert.deepEqual([o.status, o.body.code], [503, 'module_policy_unavailable']);
  for (const id of ['US6000U43G', 'u', 'us6000u43g.json', 'us_6000']) {
    const f = world(usgs());
    const r = await rupture(id, f);
    assert.deepEqual([r.status, r.body], [400, { ok: false, code: 'invalid_event' }], id);
    assert.equal(providerCalls(f).length, 0, id);
  }
  const post = await handleWorldEnvironment(req(`${P}/quakes/us6000u43g/rupture`, { method: 'POST' }), ENV, { fetchImpl: world(usgs()), cacheImpl: memoryCache() });
  assert.equal(post.status, 405);
});

test('the up-dip edge rule (built input): the longest run of top vertices round the ring; open, level, depthless or off-globe rings give nothing', () => {
  const q = (d1, d2) => [[10, 0, d1], [11, 0, d1], [11, 1, d2], [10, 1, d2], [10, 0, d1]];
  assert.deepEqual(upDipEdge(q(0.1, 20)).line, [[10, 0], [11, 0]]);
  assert.deepEqual(upDipEdge(q(20, 0.1)).line, [[11, 1], [10, 1]], 'whichever side is shallower');
  /* a ring whose top run wraps round its start */
  const wrap = [[10, 0, 0.2], [10.5, 0.5, 15], [10, 1, 30], [9.5, 0.5, 0.2], [10, 0, 0.2]];
  assert.deepEqual(upDipEdge(wrap).line, [[9.5, 0.5], [10, 0]]);
  assert.equal(upDipEdge(q(5, 5)), null, 'a level plane has no up-dip edge');
  assert.equal(upDipEdge([[10, 0, 1], [11, 0, 1], [11, 1, 9], [10, 1, 9]]), null, 'an open ring is not mended');
  assert.equal(upDipEdge([[10, 0], [11, 0], [11, 1], [10, 1], [10, 0]]), null, 'no depths, no edge');
  assert.equal(upDipEdge(q(0.1, 20).map((p, i) => (i === 1 ? [200, 0, 0.1] : p))), null, 'off the globe');
  assert.equal(upDipEdge(q(0.1, NaN)), null);
  const many = Array.from({ length: 80 }, (_, i) => [10 + i / 100, 0, i < 2 ? 0.1 : 10]); many.push(many[0]);
  assert.equal(upDipEdge(many), null, 'more vertices than a rupture file carries');
  /* the file: a plane that names no finite fault is not drawn; a Point is a point source */
  const plane = { type: 'FeatureCollection', metadata: { reference: 'Hayes et al. 2017' }, features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [q(0.1, 20)] } }] };
  assert.deepEqual([readRupture(plane).finite, readRupture(plane).reason], [false, 'not_finite_fault']);
  plane.metadata.reference = 'Source: USGS finite-fault model';
  assert.equal(readRupture(plane).finite, true);
  const pointOnly = { type: 'FeatureCollection', metadata: { reference: 'Origin' }, features: [{ type: 'Feature', properties: { 'rupture type': 'rupture extent' }, geometry: { type: 'Point', coordinates: [1, 2, 10] } }] };
  assert.equal(readRupture(pointOnly).reason, 'point_source', '"rupture type" says rupture extent either way; the geometry decides');
  assert.throws(() => readRupture({ nope: 1 }), /not a feature collection/);
});
