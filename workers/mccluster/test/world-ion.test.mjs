/* THE WORLD'S CESIUM ION (owner, 2026-10-15: "I added an ion, cesium ion key
   to the McCluster worker"): the account's token stays in the Worker; a
   signed-in member's page gets ion's answer for one asset at a time, only for
   the assets the World draws, only from the ecosystem's own pages; anonymous
   and spoofed-Origin callers get nothing; per-IP and per-member brakes; one
   ion call per asset per window; a kept answer while ion is down. */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleWorldIon, cesiumIonToken, ION_ASSETS, ION_TOKEN_BINDINGS, WORLD_ION_PATH, RATE_LIMITS, createLimiter, resetWorldIonLimits } from '../src/world-ion.js';

const TOKEN = 'ion-master-token-SECRET';
const ENV = { ALLOWED_ORIGINS: 'https://matthew.mccluster.org', CESIUM_ION_TOKEN: TOKEN, SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const ORIGIN = 'https://matthew.mccluster.org';
const MEMBER = 'member-session-jwt';
/* a member's request by default: the page sends the session as a bearer header, never in the URL */
const req = (path, { origin = ORIGIN, method = 'GET', bearer = MEMBER, ip = '203.0.113.7' } = {}) => {
  const headers = {};
  if (origin) headers.origin = origin;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (ip) headers['cf-connecting-ip'] = ip;
  return new Request(`https://api.mccluster.org${path}`, { method, headers });
};
beforeEach(() => resetWorldIonLimits());
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function memoryCache() { const m = new Map(); return { async match(k) { const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { m.set(k.url, await r.text()); }, raw: m }; }

const TERRAIN = { type: 'TERRAIN', url: 'https://assets.ion.cesium.com/1/', accessToken: 'asset-1-short-lived', attributions: [{ html: '<span>Cesium World Terrain</span>', collapsible: false }] };
const BING = { type: 'IMAGERY', externalType: 'BING', options: { url: 'https://dev.virtualearth.net', mapStyle: 'AerialWithLabels', key: 'bing-session' }, attributions: [] };

/* a Workers-semantics fetch double: Supabase's /auth/v1/user knows member bearers; ion answers the asset endpoint.
   Like workerd, it refuses a redirect mode other than 'follow' or 'manual'. calls holds only the ion calls. */
const MEMBERS = { [MEMBER]: 'auth-member', 'second-member-jwt': 'auth-member-2' };
function ion({ status = 200, body = null, throwIt = false } = {}) {
  const calls = [], auth = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.redirect !== undefined && init.redirect !== 'follow' && init.redirect !== 'manual') throw new TypeError(`Invalid redirect value, must be one of "follow" or "manual" ("${init.redirect}" won't be implemented).`);
    const u = String(url);
    if (u === 'https://sb.test/auth/v1/user') {
      const h = (init.headers && init.headers.authorization) || '';
      auth.push(h);
      const who = MEMBERS[h.replace(/^Bearer /, '')];
      return who ? json({ id: who }) : json({ msg: 'invalid JWT' }, 401);
    }
    calls.push({ url: u, headers: init.headers || {}, redirect: init.redirect });
    if (throwIt) throw new Error('network down');
    const id = Number(String(url).match(/assets\/(\d+)\/endpoint$/)[1]);
    return json(body || (id === 1 ? TERRAIN : BING), status);
  };
  return { fetchImpl, calls, auth };
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
  assert.equal(body.members_only, true);
  assert.equal(body.binding, 'CESIUM_ION_TOKEN');
  assert.deepEqual(body.assets, { terrain: 1, imagery: [3, 2, 3954], buildings: 96188 });
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
  assert.equal(on.headers.get('access-control-allow-origin'), ORIGIN);
  const off = await (await handleWorldIon(req('/v1/world/ion/', { bearer: null }), { ALLOWED_ORIGINS: ORIGIN })).json();
  assert.equal(off.available, false);
  assert.equal(off.members_only, true);
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
  const { CESIUM_ION_TOKEN: _drop, ...noIon } = ENV;
  const res = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), noIon, { fetchImpl, cacheImpl: memoryCache() });
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
  assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`, "ion gets the account's token, never the member's session");
  assert.equal(calls[0].headers.origin, ORIGIN);
  assert.equal(calls[0].redirect, 'manual', "workerd throws on redirect: 'error'");
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.get('cache-control'), 'private, max-age=300');
  assert.match(res.headers.get('vary'), /Authorization/);
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
  assert.equal(kept.headers.get('cache-control'), 'private, max-age=60');
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

test("no World fetch asks for redirect: 'error' (workerd throws on it, so every call would fail in production)", async () => {
  // Comments may name the forbidden value; only code counts.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const f of ['world-ion.js', 'world-layers.js']) {
    const src = code(await readFile(new URL(`../src/${f}`, import.meta.url), 'utf8'));
    assert.doesNotMatch(src, /redirect:\s*'error'/, f);
    assert.match(src, /redirect:\s*'manual'|fetchNoCrossHostRedirect\(/, f);
  }
  // Every Worker source file, not only the World's.
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(new URL('../src/', import.meta.url), { recursive: true });
  for (const f of files.filter((name) => name.endsWith('.js'))) {
    const src = code(await readFile(new URL(`../src/${f}`, import.meta.url), 'utf8'));
    assert.doesNotMatch(src, /redirect:\s*['"]error['"]/, f);
  }
});

test('the spatial console reads the ion token the same way the World does', async () => {
  const { sourceConfigured, sourceByKey } = await import('../src/seek-first/source-registry.js');
  assert.equal(sourceConfigured(sourceByKey('cesium_ion'), { CESIUM_ION_KEY: 'k' }), true);
  assert.equal(sourceConfigured(sourceByKey('cesium_ion'), { CESIUM_ION_TOKEN: 'k' }), true);
  assert.equal(sourceConfigured(sourceByKey('cesium_ion'), {}), false);
});

/* ---------- members only (anonymous visitors never reach paid ion assets) ---------- */

test('an anonymous request is a 401 and neither ion nor the cache is touched', async () => {
  const { fetchImpl, calls, auth } = ion();
  const cache = memoryCache();
  const res = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { bearer: null }), ENV, { fetchImpl, cacheImpl: cache });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.detail.members_only, true);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 0);
  assert.equal(auth.length, 0, 'no bearer, no Supabase call');
  assert.equal(cache.raw.size, 0);
});

test('a spoofed allowlisted Origin without a bearer is a 401: Origin is not the gate', async () => {
  const { fetchImpl, calls } = ion();
  for (const origin of [ORIGIN, 'https://humanuprise.com', 'https://mccluster.org']) {
    const res = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { origin, bearer: null }), ENV, { fetchImpl, cacheImpl: memoryCache() });
    assert.equal(res.status, 401, origin);
  }
  assert.equal(calls.length, 0);
});

test('a bearer Supabase does not recognise is a 401, even with a kept answer in the cache', async () => {
  const { fetchImpl, calls, auth } = ion();
  const cache = memoryCache();
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), ENV, { fetchImpl, cacheImpl: cache })).status, 200);
  const res = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { bearer: 'forged.jwt.value' }), ENV, { fetchImpl, cacheImpl: cache });
  assert.equal(res.status, 401);
  assert.equal((await res.text()).includes('asset-1-short-lived'), false, 'a cached asset token never reaches a non-member');
  assert.equal(calls.length, 1);
  assert.equal(auth.at(-1), 'Bearer forged.jwt.value', 'the bearer is checked with Supabase');
});

test('a member gets ion\'s answer (200), verified with Supabase first', async () => {
  const { fetchImpl, calls, auth } = ion();
  const res = await handleWorldIon(req('/v1/world/ion/v1/assets/96188/endpoint'), ENV, { fetchImpl, cacheImpl: memoryCache() });
  assert.equal(res.status, 200);
  assert.equal(auth[0], `Bearer ${MEMBER}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.cesium.com/v1/assets/96188/endpoint');
  assert.equal(JSON.stringify(calls[0].headers).includes(MEMBER), false, "the member's session never goes to ion");
});

test('a member asking for an asset the World does not draw is a 404, before any Supabase or ion call', async () => {
  const { fetchImpl, calls, auth } = ion();
  const res = await handleWorldIon(req('/v1/world/ion/v1/assets/2275207/endpoint'), ENV, { fetchImpl, cacheImpl: memoryCache() });
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
  assert.equal(auth.length, 0);
});

test('a member on a page outside the allowlist is still refused (403): Origin stays an extra check', async () => {
  const { fetchImpl, calls } = ion();
  const res = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { origin: 'https://elsewhere.example' }), ENV, { fetchImpl, cacheImpl: memoryCache() });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('the bearer is read only from the Authorization header, never from the URL', async () => {
  const { fetchImpl, calls, auth } = ion();
  const res = await handleWorldIon(req(`/v1/world/ion/v1/assets/1/endpoint?access_token=${MEMBER}&authorization=Bearer%20${MEMBER}`, { bearer: null }), ENV, { fetchImpl, cacheImpl: memoryCache() });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
  assert.equal(auth.length, 0);
});

test('per-member rate limit: past the window\'s allowance a member gets a 429 with retry-after; another member is unaffected', async () => {
  const { fetchImpl } = ion();
  const cache = memoryCache();
  const limits = { ip: createLimiter({ max: 1000 }), member: createLimiter({ max: 3 }) };
  let t = 10_000_000;
  const now = () => t;
  for (let n = 0; n < 3; n++) assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), ENV, { fetchImpl, cacheImpl: cache, now, limits })).status, 200);
  const over = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), ENV, { fetchImpl, cacheImpl: cache, now, limits });
  assert.equal(over.status, 429);
  assert.ok(Number(over.headers.get('retry-after')) >= 1);
  assert.equal((await over.text()).includes('asset-1-short-lived'), false);
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { bearer: 'second-member-jwt' }), ENV, { fetchImpl, cacheImpl: cache, now, limits })).status, 200);
  t += RATE_LIMITS.windowMs + 1;
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint'), ENV, { fetchImpl, cacheImpl: cache, now, limits })).status, 200, 'the window slides');
});

test('per-IP rate limit runs before the Supabase check, so a flood of bad bearers does not become a flood of Supabase calls', async () => {
  const { fetchImpl, auth } = ion();
  const limits = { ip: createLimiter({ max: 2 }), member: createLimiter({ max: 1000 }) };
  for (let n = 0; n < 2; n++) assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { bearer: `junk-${n}` }), ENV, { fetchImpl, cacheImpl: memoryCache(), limits })).status, 401);
  const over = await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { bearer: 'junk-3' }), ENV, { fetchImpl, cacheImpl: memoryCache(), limits });
  assert.equal(over.status, 429);
  assert.equal(auth.length, 2);
  assert.equal((await handleWorldIon(req('/v1/world/ion/v1/assets/1/endpoint', { ip: '198.51.100.9' }), ENV, { fetchImpl, cacheImpl: memoryCache(), limits })).status, 200, 'another IP is unaffected');
});

test('the default limits are the documented ones and the limiter keeps its memory bounded', () => {
  assert.deepEqual({ ...RATE_LIMITS }, { windowMs: 600000, perIp: 120, perMember: 60 });
  const l = createLimiter({ max: 1 });
  for (let n = 0; n < 6000; n++) l.take(`ip-${n}`, 1);
  assert.equal(l.take('ip-5999', 2).ok, false, 'a recent key is still remembered');
  assert.equal(l.take('ip-0', 2).ok, true, 'the oldest keys were let go past the bound');
});

test('the source keeps the gate: bearerUser is reused from the data layers, and Origin is never the only check', async () => {
  const src = await readFile(new URL('../src/world-ion.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ bearerUser \} from '\.\/world-layers\.js';/);
  const originAt = src.indexOf('allowedOrigins(env).includes(origin)');
  const memberAt = src.indexOf('await bearerUser(request, env, fetchImpl)');
  const ionAt = src.indexOf('await askIon(');
  const cacheAt = src.indexOf('store.match(key)');
  assert.ok(originAt > 0 && memberAt > originAt && ionAt > memberAt && cacheAt > memberAt, 'the member check comes before the cache and before ion');
});
