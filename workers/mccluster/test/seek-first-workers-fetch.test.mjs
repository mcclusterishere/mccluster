/* Seek First adapters under Cloudflare Workers fetch semantics.
   workerd rejects fetch init redirect: 'error' with a TypeError before any
   request is made; Node's fetch accepts it, so plain mocks never noticed that
   every adapter failed in production. These run the adapters through a
   double that validates init the way workerd does. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAdapter, GeoAdapterError } from '../src/seek-first/adapters.js';
import { epaEchoFacilities } from '../src/seek-first/verified-adapters.js';
import { fetchNoCrossHostRedirect } from '../src/lib/safe-fetch.js';
import { workersFetch } from './support/workers-fetch-semantics.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });
const METEO = {
  latitude: 41.3, longitude: -72.9, elevation: 20, timezone: 'UTC',
  current: { time: '2026-09-09T03:00', temperature_2m: 19.5, wind_speed_10m: 8 },
  current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h' }, hourly: {}
};

async function withWorkersFetch(handler, fn) {
  const original = globalThis.fetch;
  const fake = workersFetch(handler);
  globalThis.fetch = fake;
  try { return await fn(fake); } finally { globalThis.fetch = original; }
}

test('regression: a keyless adapter succeeds under Workers fetch semantics (no redirect: "error")', async () => {
  await withWorkersFetch(async () => json(METEO), async (fake) => {
    const result = await executeAdapter('open_meteo', { lat: 41.3, lon: -72.9 }, {});
    assert.equal(result.source, 'open_meteo');
    assert.equal(result.records.filter((row) => row.kind === 'observation').length, 2);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].init.redirect, 'manual');
  });
});

test('regression: the verified EPA ECHO adapter succeeds under Workers fetch semantics', async () => {
  await withWorkersFetch(async (url) => {
    if (url.pathname.endsWith('get_facilities')) return json({ Results: { QueryID: '77', QueryRows: '1' } });
    if (url.pathname.endsWith('get_geojson')) return json({ features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-72.9, 41.3] }, properties: { RegistryID: 'R1', FacName: 'Plant' } }] });
    throw new Error('unexpected ' + url);
  }, async (fake) => {
    const result = await epaEchoFacilities({ state: 'CT' });
    assert.equal(result.records.length, 1);
    assert.ok(fake.calls.every((c) => c.init.redirect === 'manual'));
  });
});

test('a same-host https redirect is followed; a cross-host one is upstream_redirect and its target is never requested', async () => {
  await withWorkersFetch(async (url) => (url.pathname === '/v1/forecast' ? redirect('/v2/forecast' + url.search, 308) : json(METEO)), async (fake) => {
    const result = await executeAdapter('open_meteo', { lat: 41.3, lon: -72.9 }, {});
    assert.equal(result.records.filter((row) => row.kind === 'observation').length, 2);
    assert.equal(fake.calls.length, 2);
    assert.equal(new URL(fake.calls[1].url).hostname, 'api.open-meteo.com');
  });
  await withWorkersFetch(async () => redirect('https://attacker.example/forecast'), async (fake) => {
    await assert.rejects(() => executeAdapter('open_meteo', { lat: 41.3, lon: -72.9 }, {}), (error) => {
      assert.ok(error instanceof GeoAdapterError);
      assert.equal(error.code, 'upstream_redirect');
      assert.equal(error.status, 502);
      assert.equal(error.detail.provider_status, 302);
      return true;
    });
    assert.equal(fake.calls.length, 1);
  });
});

test('a user-supplied GBFS URL may not be redirected to another (e.g. private) host', async () => {
  await withWorkersFetch(async () => redirect('https://127.0.0.1/gbfs.json'), async (fake) => {
    await assert.rejects(() => executeAdapter('gbfs', { url: 'https://gbfs.example.org/station_information.json' }, {}), (error) => error.code === 'upstream_redirect');
    assert.equal(fake.calls.length, 1);
  });
});

test('the helper never follows a redirect on a non-GET request, and honours an explicit host allowlist', async () => {
  const post = workersFetch(async () => redirect('https://same.example/next', 307));
  await assert.rejects(() => fetchNoCrossHostRedirect('https://same.example/x', { method: 'POST', body: '{}' }, { fetchImpl: post }), (e) => e.code === 'upstream_redirect');
  assert.equal(post.calls.length, 1);
  const multi = workersFetch(async (url) => (url.hostname === 'a.example' ? redirect('https://b.example/y') : json({ ok: true })));
  const res = await fetchNoCrossHostRedirect('https://a.example/x', {}, { fetchImpl: multi, allowedHosts: ['a.example', 'b.example'] });
  assert.equal(res.status, 200);
  const legacy = workersFetch(async () => json({}));
  await fetchNoCrossHostRedirect('https://a.example/x', { redirect: 'error' }, { fetchImpl: legacy });
  assert.equal(legacy.calls[0].init.redirect, 'manual', 'a caller-supplied redirect: "error" is replaced, never passed to workerd');
});
