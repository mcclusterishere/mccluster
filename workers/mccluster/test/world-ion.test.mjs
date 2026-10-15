/* THE WORLD'S CESIUM ION (owner, 2026-10-15: "I added an ion, cesium ion key
   to the McCluster worker"): the account's token stays in the Worker; a page
   gets ion's answer for one asset at a time, only for the assets the World
   draws, only from the ecosystem's own pages; one ion call per asset per
   window; a kept answer while ion is down. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleWorldIon, cesiumIonToken, ION_ASSETS, ION_TOKEN_BINDINGS, WORLD_ION_PATH } from '../src/world-ion.js';

const TOKEN = 'ion-master-token-SECRET';
const ENV = { ALLOWED_ORIGINS: 'https://matthew.mccluster.org', CESIUM_ION_TOKEN: TOKEN };
const ORIGIN = 'https://matthew.mccluster.org';
const req = (path, { origin = ORIGIN, method = 'GET' } = {}) => new Request(`https://api.mccluster.org${path}`, { method, headers: origin ? { origin } : {} });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function memoryCache() { const m = new Map(); return { async match(k) { const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { m.set(k.url, await r.text()); }, raw: m }; }

const TERRAIN = { type: 'TERRAIN', url: 'https://assets.ion.cesium.com/1/', accessToken: 'asset-1-short-lived', attributions: [{ html: '<span>Cesium World Terrain</span>', collapsible: false }] };
const BING = { type: 'IMAGERY', externalType: 'BING', options: { url: 'https://dev.virtualearth.net', mapStyle: 'AerialWithLabels', key: 'bing-session' }, attributions: [] };

function ion({ status = 200, body = null, throwIt = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {}, redirect: init.redirect });
    if (throwIt) throw new Error('network down');
    const id = Number(String(url).match(/assets\/(\d+)\/endpoint$/)[1]);
    return json(body || (id === 1 ? TERRAIN : BING), status);
  };
  return { fetchImpl, calls };
}

test('the route answers only under /v1/world/ion, GET and HEAD only', async () => {
  assert.equal(WORLD_ION_PATH, '/v1/world/ion');
  assert.equal(await handleWorldIon(req('/v1/world/layers/flights'), ENV), null);
  assert.equal(await handleWorldIon(req('/v1/world/ionic'), ENV), null);
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { method: 'POST' }), ENV)).status, 405);
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { method: 'OPTIONS' }), ENV)).status, 204);
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1'), ENV)).status, 404);
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/abc/endpoint'), ENV)).status, 404);
});

test('the status says whether the World has ion, which binding holds it, and never the token', async () => {
  const on = await handleWorldIon(req('/v1/world/ion'), ENV);
  assert.equal(on.status, 200);
  const body = await on.json();
  assert.equal(body.available, true);
  assert.equal(body.binding, 'CESIUM_ION_TOKEN');
  assert.deepEqual(body.assets, { terrain: 1, imagery: [3, 2, 3954], buildings: 96188 });
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
  assert.equal(on.headers.get('access-control-allow-origin'), ORIGIN);
  const off = await (await handleWorldIon(req('/v1/world/ion/'), { ALLOWED_ORIGINS: ORIGIN })).json();
  assert.equal(off.available, false);
  assert.equal(off.binding, null);
});

test('a token saved under a near name is found; CESIUM_ION_TOKEN wins; blanks do not count', () => {
  assert.equal(ION_TOKEN_BINDINGS[0], 'CESIUM_ION_TOKEN');
  assert.deepEqual(cesiumIonToken({ CESIUM_ION_KEY: ' k ' }), { name: 'CESIUM_ION_KEY', token: 'k' });
  assert.deepEqual(cesiumIonToken({ CESIUM_TOKEN: 'x', CESIUM_ION_TOKEN: 'y' }), { name: 'CESIUM_ION_TOKEN', token: 'y' });
  assert.equal(cesiumIonToken({ CESIUM_ION_TOKEN: '   ' }), null);
  assert.equal(cesiumIonToken({}), null);
  assert.equal(cesiumIonToken(undefined), null);
});

test('only the assets the World draws are served', async () => {
  const { fetchImpl, calls } = ion();
  for (const id of [2275207, 4, 0, 999999999]) {
    const res = await handleWorldIon(req(`/v1/world/ion/v1/assets/${id}/endpoint`), ENV, { fetchImpl, cacheImpl: memoryCache() });
    assert.equal(res.status, 404, `asset ${id}`);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual([ION_ASSETS.terrain, ...ION_ASSETS.imagery, ION_ASSETS.buildings], [1, 3, 2, 3954, 96188]);
});

test('only the ecosystem\'s own pages are served', async () => {
  const { fetchImpl, calls } = ion();
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { origin: 'https://elsewhere.example' }), ENV, { fetchImpl, cacheImpl: memoryCache() })).status, 403);
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { origin: '' }), ENV, { fetchImpl, cacheImpl: memoryCache() })).status, 403);
  assert.equal(calls.length, 0);
});

test('without a token the asset route says so plainly and calls nobody', async () => {
  const { fetchImpl, calls } = ion();
  const res = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), { ALLOWED_ORIGINS: ORIGIN }, { fetchImpl, cacheImpl: memoryCache() });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('ion is asked with the token in a header; the page\'s query never travels; ion\'s answer passes through whole', async () => {
  const { fetchImpl, calls } = ion();
  const res = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint?access_token=cesium-built-in-demo'), ENV, { fetchImpl, cacheImpl: memoryCache() });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), TERRAIN);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.cesium.com/v1/assets/1/endpoint');
  assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].headers.origin, ORIGIN);
  assert.equal(calls[0].redirect, 'error');
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
});

test('the account token never appears in any answer', async () => {
  const leaky = ion({ body: { type: 'IMAGERY', url: 'https://assets.ion.cesium.com/3954/', accessToken: 'asset-3954' } });
  for (const id of [1, 3, 2, 3954, 96188]) {
    const res = await handleWorldIon(req(`/v1/world/ion/v1/assets/${id}/endpoint`), ENV, { fetchImpl: leaky.fetchImpl, cacheImpl: memoryCache() });
    assert.equal((await res.text()).includes(TOKEN), false, `asset ${id}`);
  }
  const failed = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), ENV, { fetchImpl: ion({ status: 401 }).fetchImpl, cacheImpl: memoryCache() });
  assert.equal((await failed.text()).includes(TOKEN), false);
});

test('one ion call per asset per window; a fresh kept answer is served from the cache', async () => {
  const { fetchImpl, calls } = ion();
  const cache = memoryCache();
  let t = 1_000_000;
  const now = () => t;
  await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), ENV, { fetchImpl, cacheImpl: cache, now });
  t += 19 * 60 * 1000;
  const again = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { origin: 'https://humanuprise.com' }), ENV, { fetchImpl, cacheImpl: cache, now });
  assert.equal(calls.length, 1);
  assert.deepEqual(await again.json(), TERRAIN);
  assert.equal(again.headers.get('access-control-allow-origin'), 'https://humanuprise.com');
  t += 2 * 60 * 1000;
  await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), ENV, { fetchImpl, cacheImpl: cache, now });
  assert.equal(calls.length, 2, 'past 20 minutes ion is asked again');
});

test('while ion is down a kept answer under 45 minutes old still serves; older than that is a plain 502', async () => {
  const cache = memoryCache();
  let t = 5_000_000;
  const now = () => t;
  await handleWorldIon(req('/v1/world/ion/v1/assets/2/endpoint'), ENV, { fetchImpl: ion().fetchImpl, cacheImpl: cache, now });
  t += 30 * 60 * 1000;
  const kept = await handleWorldIon(req('/v1/world/ion/v1/assets/2/endpoint'), ENV, { fetchImpl: ion({ throwIt: true }).fetchImpl, cacheImpl: cache, now });
  assert.equal(kept.status, 200);
  assert.deepEqual(await kept.json(), BING);
  assert.equal(kept.headers.get('cache-control'), 'public, max-age=60');
  t += 20 * 60 * 1000;
  const gone = await handleWorldIon(req('/v1/world/ion/v1/assets/2/endpoint'), ENV, { fetchImpl: ion({ status: 500 }).fetchImpl, cacheImpl: cache, now });
  assert.equal(gone.status, 502);
  const body = await gone.json();
  assert.equal(body.detail.asset, 2);
  assert.equal(body.detail.upstream_status, 500);
});

test('an ion refusal or a nonsense answer is a 502, never a broken pass-through', async () => {
  for (const bad of [ion({ status: 401 }), ion({ status: 404 }), ion({ body: { hello: 'world' } }), ion({ body: [1, 2] })]) {
    const res = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), ENV, { fetchImpl: bad.fetchImpl, cacheImpl: memoryCache() });
    assert.equal(res.status, 502);
  }
});

test('the dispatch sits beside the data layers, ahead of the Supabase gate', async () => {
  const src = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const ionAt = src.indexOf('path === WORLD_ION_PATH');
  assert.ok(ionAt > src.indexOf("path.startsWith('/v1/world/layers/')"));
  assert.ok(ionAt < src.indexOf('if (!configured(env))'));
  const seek = await readFile(new URL('../src/seek-first/index.js', import.meta.url), 'utf8');
  assert.match(seek, /const ion = cesiumIonToken\(env\);/);
});
