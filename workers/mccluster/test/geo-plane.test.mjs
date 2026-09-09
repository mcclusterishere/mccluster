import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import geo from '../src/geo/index.js';
import { executeProvider } from '../src/geo/gateway.js';
import { GeoAdapterError } from '../src/geo/errors.js';
import { sourceByKey, sourceCatalog } from '../src/geo/source-registry.js';
import { assertLane, normalizeConsumer } from '../src/geo/lanes.js';
import { CATALOG } from '../src/ai/envelope.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const workerSourcePath = resolve(here, '..', 'src', 'index.js');
const pagesWorkflow = resolve(repoRoot, '.github', 'workflows', 'deploy-pages.yml');
const buildGev = resolve(repoRoot, 'tools', 'build-gev.sh');

const owner = {
  requireHouseOwner: async () => ({ id: 'owner-1', email: 'owner@mccluster.org' })
};

function post(path, body) {
  return new Request(`https://api.mccluster.org${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('house INTERNAL sources exist and never require a vendor key', () => {
  for (const key of ['house', 'equity_uprise', 'scsu_docket']) {
    const source = sourceByKey(key);
    assert.ok(source, `${key} missing from registry`);
    assert.equal(source.lane, 'INTERNAL');
    assert.equal(source.sourceClass, 'INTERNAL');
    assert.equal(source.credentialEnv.length, 0);
  }
  const catalog = sourceCatalog({});
  assert.ok(catalog.some((row) => row.key === 'equity_uprise' && row.configured === true));
});

test('lane firewall forbids Whip from academic and house INTERNAL sources', () => {
  const whip = normalizeConsumer('whip');
  assert.equal(whip, 'whip');
  assert.throws(
    () => assertLane(sourceByKey('planet_research'), 'whip'),
    (error) => error instanceof GeoAdapterError && error.status === 403 && error.code === 'lane_forbidden'
  );
  assert.throws(
    () => assertLane(sourceByKey('opensky_research'), 'whip'),
    (error) => error.code === 'lane_forbidden'
  );
  assert.throws(
    () => assertLane(sourceByKey('equity_uprise'), 'whip'),
    (error) => error.code === 'lane_forbidden'
  );
  assert.throws(
    () => assertLane(sourceByKey('house'), 'whip'),
    (error) => error.code === 'lane_forbidden'
  );
  assert.throws(
    () => assertLane(sourceByKey('scsu_docket'), 'mobility'),
    (error) => error.code === 'lane_forbidden'
  );
  assert.doesNotThrow(() => assertLane(sourceByKey('usgs'), 'whip'));
  assert.doesNotThrow(() => assertLane(sourceByKey('planet_research'), 'policy'));
  assert.doesNotThrow(() => assertLane(sourceByKey('house'), 'house'));
});

test('executeProvider denies Whip Planet before asking for credentials', async () => {
  await assert.rejects(
    () => executeProvider('planet_research', { consumer: 'whip' }, { PLANET_RESEARCH_API_KEY: 'secret-must-not-matter' }),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'lane_forbidden');
      assert.equal(error.detail.consumer, 'whip');
      return true;
    }
  );
});

test('GET /v1/geo/plane is the satellite contract and never a Cesium clone', async () => {
  const response = await geo.fetch(new Request('https://api.mccluster.org/v1/geo/plane'), {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.plane, 'spatial');
  assert.equal(payload.satellite_of, 'control');
  assert.equal(payload.worker, 'mccluster');
  assert.equal(payload.durable_object, 'HereTenantAgent');
  assert.equal(payload.branch, 'grok/spatial-plane');
  assert.equal(payload.do_not_merge, true);
  assert.equal(payload.prize, true);
  assert.equal(payload.forbidden.second_worker, true);
  assert.equal(payload.forbidden.gev_proxy, true);
  assert.equal(payload.forbidden.vercel, true);
  assert.equal(payload.forbidden.pages_hijack, true);
  assert.equal(payload.forbidden.cesium_clone, true);
  assert.equal(payload.lanes.SCSU_RESEARCH.whip, false);
  assert.equal(payload.lanes.INTERNAL.whip, false);
  assert.equal(payload.lanes.OPEN.whip, true);
  assert.ok(payload.sites.some((site) => site.id === 'eu-dc'));
  assert.ok(payload.sites.some((site) => site.id === 'scsu'));
  assert.ok(payload.sources.some((source) => source.key === 'equity_uprise'));
  assert.doesNotMatch(JSON.stringify(payload), /sk-|api[_-]?key\s*[:=]/i);
});

test('house adapter returns McCluster entities without a vendor roundtrip', async () => {
  const result = await executeProvider('house', { consumer: 'house', persist: false }, {});
  assert.equal(result.source, 'house');
  assert.ok(result.records.some((row) => row.external_id === 'house' && row.point?.lat === 41.1865));
  assert.equal(result.persistence, 'persistent');
});

test('geo fetch of INTERNAL source as Whip is 403 even with house-owner auth', async () => {
  const response = await geo.fetch(
    post('/v1/geo/fetch/equity_uprise', { consumer: 'whip', persist: false }),
    {},
    owner
  );
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.detail.code, 'lane_forbidden');
});

test('catalog lists the plane so satellites do not guess', () => {
  const paths = CATALOG.routes.map((row) => row.path);
  assert.ok(paths.includes('/v1/geo'));
  assert.ok(paths.includes('/v1/geo/plane'));
  assert.ok(paths.includes('/v1/geo/fetch/:source'));
});

test('prize branch did not take ChatGPT Pages hijack or gev build script', async () => {
  const pages = await readFile(pagesWorkflow, 'utf8');
  assert.match(pages, /branches:\s*\n\s*-\s*main/s);
  assert.doesNotMatch(pages, /feature\/gev-spatial-intelligence/);
  await assert.rejects(() => readFile(buildGev, 'utf8'), { code: 'ENOENT' });
});

test('canonical worker still wires geo before the database gate', async () => {
  const source = await readFile(workerSourcePath, 'utf8');
  const routeNeedle = "return geo.fetch(request, env, { requireHouseOwner });";
  const routeIndex = source.indexOf(routeNeedle);
  const configGateIndex = source.indexOf("if (!configured(env)) return fail(request, env, 'McCluster is not configured', 503);");
  assert.ok(routeIndex >= 0);
  assert.ok(routeIndex < configGateIndex);
  assert.match(source, /import geo from '\.\/geo\/index\.js';/);
  assert.doesNotMatch(source, /gev-proxy/);
  assert.doesNotMatch(source, /class GeoAgent/);
});
