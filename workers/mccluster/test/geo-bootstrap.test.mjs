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
  assert.ok(sources.some((source) => source.key === 'equity_uprise' && source.credential_required === false && source.lane === 'INTERNAL'));
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

test('geo router is adapter-ready without database configuration', async () => {
  const response = await geo.fetch(
    new Request('https://api.mccluster.org/v1/geo/health'),
    { CENSUS_API_KEY: FAKE_SECRET }
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'mccluster-spatial-intelligence');
  assert.equal(payload.mode, 'adapter-ready');
  assert.equal(payload.database_schema_ready, false);
  assert.equal(payload.adapter_gateway_ready, true);
  assert.match(payload.upstream_commit, /^[0-9a-f]{40}$/);
  assert.ok(payload.adapter_capabilities.persistent.includes('usgs'));
});

test('geo source endpoint does not leak a configured secret', async () => {
  const response = await geo.fetch(
    new Request('https://api.mccluster.org/v1/geo/sources'),
    { CENSUS_API_KEY: FAKE_SECRET }
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /CENSUS_API_KEY/);
  assert.doesNotMatch(body, new RegExp(FAKE_SECRET));
});

test('data-bearing geo routes fail closed without app identity', async () => {
  const response = await geo.fetch(
    new Request('https://api.mccluster.org/v1/geo/fetch/usgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lat: 41.3, lon: -72.9 })
    }),
    {}
  );
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.detail.code, 'unidentified_app');
});

test('canonical worker delegates geo namespace with house-owner authorization before database gate', async () => {
  const source = await readFile(workerSourcePath, 'utf8');
  assert.match(source, /import geo from '\.\/geo\/index\.js';/);
  const routeNeedle = 'return geo.fetch(request, env, { requireHouseOwner, authUser, resolveAppIdentity: resolveRequestIdentity });';
  const routeIndex = source.indexOf(routeNeedle);
  const configGateIndex = source.indexOf("if (!configured(env)) return fail(request, env, 'McCluster is not configured', 503);");
  assert.ok(routeIndex >= 0, 'geo route delegation with house-owner authorization is missing');
  assert.ok(configGateIndex >= 0, 'database configuration gate is missing');
  assert.ok(routeIndex < configGateIndex, 'geo health/readiness must remain reachable while credentials are being assembled');
});
