import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { sourceCatalog } from '../src/geo/source-registry.js';

const FAKE_SECRET = 'do-not-leak-this-value';

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

test('canonical mccluster worker routes geo bootstrap without requiring database config', async () => {
  const response = await worker.fetch(
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

test('canonical source endpoint does not leak a configured secret', async () => {
  const response = await worker.fetch(
    new Request('https://api.mccluster.org/v1/geo/sources'),
    { CENSUS_API_KEY: FAKE_SECRET }
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /CENSUS_API_KEY/);
  assert.doesNotMatch(body, new RegExp(FAKE_SECRET));
});
