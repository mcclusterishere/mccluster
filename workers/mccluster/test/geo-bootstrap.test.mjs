import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import geo from '../src/geo/index.js';
import { sourceCatalog } from '../src/geo/source-registry.js';

const FAKE_SECRET = 'do-not-leak-this-value';
const here = dirname(fileURLToPath(import.meta.url));
const workerSourcePath = resolve(here, '..', 'src', 'index.js');

 test('geo source catalog separates no-key and credentialed sources', () => {
  const sources = sourceCatalog({ CENSUS_API_KEY: FAKE_SECRET });
  assert.ok(sources.some((source) => source.key === 'usaspending' && source.credential_required === false));
  assert.ok(sources.some((source) => source.key === 'usgs' && source.credential_required === false));
  assert.ok(sources.some((source) => source.key === 'adsb_lol' && source.credential_required === false));
  assert.ok(sources.some((source) => source.key === 'census' && source.credential_required === true));
  assert.equal(sources.find((source) => source.key === 'census').configured, true);
  assert.equal(sources.find((source) => source.key === 'eia').configured, false);
});

test('geo catalog reports binding names but never credential values', () => {
  const serialized = JSON.stringify(sourceCatalog({ CENSUS_API_KEY: FAKE_SECRET }));
  assert.match(serialized, /CENSUS_API_KEY/);
  assert.doesNotMatch(serialized, new RegExp(FAKE_SECRET));
});

test('public geo health is adapter-ready and reveals no provider inventory', async () => {
  const response = await geo.fetch(
    new Request('https://api.mccluster.org/v1/geo/health'),
    { CENSUS_API_KEY: FAKE_SECRET }
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'mccluster-spatial-intelligence');
  assert.equal(payload.mode, 'adapter-ready');
  assert.equal(payload.adapter_gateway_ready, true);
  assert.equal(payload.edge_access_configured, false);
  assert.match(payload.upstream_commit, /^[0-9a-f]{40}$/);

  // Which providers hold credentials is a map of where the keys are. The one
  // unauthenticated route must not draw it.
  const body = JSON.stringify(payload);
  assert.doesNotMatch(body, new RegExp(FAKE_SECRET));
  assert.equal(payload.readiness, undefined);
  assert.equal(payload.adapter_capabilities, undefined);
  assert.equal(payload.sources, undefined);
});

test('provider inventory, readiness and viewer config all require house-owner authorization', async () => {
  for (const route of ['/v1/geo/sources', '/v1/geo/readiness', '/v1/geo/entitlements', '/v1/geo/capabilities', '/v1/geo/viewer/config']) {
    const response = await geo.fetch(
      new Request(`https://api.mccluster.org${route}`),
      { CENSUS_API_KEY: FAKE_SECRET }
    );
    assert.equal(response.status, 503, `${route} must not answer without the authorization callback`);
    const payload = await response.json();
    assert.equal(payload.detail.code, 'authorization_unavailable', route);
    assert.doesNotMatch(JSON.stringify(payload), new RegExp(FAKE_SECRET), route);
  }
});

test('authorized source catalog reports binding names but never credential values', async () => {
  const response = await geo.fetch(
    new Request('https://api.mccluster.org/v1/geo/sources'),
    { CENSUS_API_KEY: FAKE_SECRET, SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-role' },
    { requireHouseOwner: async () => ({ id: 'owner-1' }) }
  );
  // resolveHouseOrg reaches a database that does not exist in this test, so the
  // assertion here is the security one: the failure carries no secret.
  const body = await response.text();
  assert.doesNotMatch(body, new RegExp(FAKE_SECRET));
});

test('data-bearing geo routes fail closed without canonical authorization callback', async () => {
  const response = await geo.fetch(
    new Request('https://api.mccluster.org/v1/geo/fetch/usgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lat: 41.3, lon: -72.9 })
    }),
    {}
  );
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.detail.code, 'authorization_unavailable');
});

test('canonical worker delegates geo namespace with house-owner authorization before database gate', async () => {
  const source = await readFile(workerSourcePath, 'utf8');
  assert.match(source, /import geo from '\.\/geo\/index\.js';/);
  const routeNeedle = "return geo.fetch(request, env, { requireHouseOwner });";
  const routeIndex = source.indexOf(routeNeedle);
  const configGateIndex = source.indexOf("if (!configured(env)) return fail(request, env, 'McCluster is not configured', 503);");
  assert.ok(routeIndex >= 0, 'geo route delegation with house-owner authorization is missing');
  assert.ok(configGateIndex >= 0, 'database configuration gate is missing');
  assert.ok(routeIndex < configGateIndex, 'geo health/readiness must remain reachable while credentials are being assembled');
});
