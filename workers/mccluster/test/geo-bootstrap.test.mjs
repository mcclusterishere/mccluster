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
  assert.ok(sources.some((source) => source.key === 'census' && source.credential_required === true));
  assert.equal(sources.find((source) => source.key === 'census').configured, true);
  assert.equal(sources.find((source) => source.key === 'eia').configured, false);
});

test('geo catalog reports binding names but never credential values', () => {
  const serialized = JSON.stringify(sourceCatalog({ CENSUS_API_KEY: FAKE_SECRET }));
  assert.match(serialized, /CENSUS_API_KEY/);
  assert.doesNotMatch(serialized, new RegExp(FAKE_SECRET));
});

test('geo router serves bootstrap health without requiring database config', async () => {
  const response = await geo.fetch(
    new Request('https://api.mccluster.org/v1/geo/health'),
    { CENSUS_API_KEY: FAKE_SECRET }
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'mccluster-spatial-intelligence');
  assert.equal(payload.mode, 'bootstrap');
  assert.equal(payload.database_schema_ready, false);
  assert.equal(payload.adapters_live, false);
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

test('canonical worker delegates the v1 geo namespace before database configuration gate', async () => {
  const source = await readFile(workerSourcePath, 'utf8');
  assert.match(source, /import geo from '\.\/geo\/index\.js';/);
  const routeIndex = source.indexOf("if (path === '/v1/geo' || path.startsWith('/v1/geo/'))");
  const configGateIndex = source.indexOf("if (!configured(env)) return fail(request, env, 'McCluster is not configured', 503);");
  assert.ok(routeIndex >= 0, 'geo route delegation is missing');
  assert.ok(configGateIndex >= 0, 'database configuration gate is missing');
  assert.ok(routeIndex < configGateIndex, 'geo bootstrap must be reachable while credentials/database bindings are still being assembled');
});
