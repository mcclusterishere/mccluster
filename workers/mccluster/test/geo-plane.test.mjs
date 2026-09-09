import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import geo from '../src/geo/index.js';
import { executeProvider } from '../src/geo/gateway.js';
import { GeoAdapterError } from '../src/geo/errors.js';
import { identityFromAppKey } from '../src/geo/identity.js';
import { assertLane } from '../src/geo/lanes.js';
import { sourceByKey, sourceCatalog } from '../src/geo/source-registry.js';
import { CATALOG } from '../src/ai/envelope.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const workerSourcePath = resolve(here, '..', 'src', 'index.js');
const pagesWorkflow = resolve(repoRoot, '.github', 'workflows', 'deploy-pages.yml');
const buildGev = resolve(repoRoot, 'tools', 'build-gev.sh');
const authorityMigration = resolve(repoRoot, 'supabase', 'migrations', '20260909034200_spatial_authority.sql');

const whip = identityFromAppKey('whip-rider-web');
const house = identityFromAppKey('mccluster-web');
const policy = identityFromAppKey('equity-uprise-web');

const owner = {
  requireHouseOwner: async () => ({ id: 'owner-1', email: 'owner@mccluster.org' }),
  authUser: async () => ({
    id: 'owner-1',
    email: 'owner@mccluster.org',
    app_metadata: { mccluster_app: 'mccluster-web' }
  })
};

const whipCaller = {
  requireHouseOwner: async () => {
    throw Object.assign(new Error('McCluster house owner access required'), { status: 403 });
  },
  authUser: async () => ({
    id: 'whip-1',
    email: 'rider@whip.example',
    app_metadata: { mccluster_app: 'whip-rider-web' }
  })
};

function post(path, body, headers = {}) {
  return new Request(`https://api.mccluster.org${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
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

test('lane firewall uses app capabilities instead of caller-supplied consumer labels', () => {
  assert.equal(whip.app, 'WHIP_RIDER');
  assert.equal(whip.class, 'COMMERCIAL');
  assert.throws(
    () => assertLane(sourceByKey('planet_research'), whip),
    (error) => error instanceof GeoAdapterError && error.status === 403 && error.code === 'lane_forbidden'
  );
  assert.throws(
    () => assertLane(sourceByKey('opensky_research'), whip),
    (error) => error.code === 'lane_forbidden'
  );
  assert.throws(
    () => assertLane(sourceByKey('equity_uprise'), whip),
    (error) => error.code === 'lane_forbidden'
  );
  assert.throws(
    () => assertLane(sourceByKey('house'), whip),
    (error) => error.code === 'lane_forbidden'
  );
  assert.throws(
    () => assertLane(sourceByKey('scsu_docket'), policy),
    (error) => error.code === 'lane_forbidden'
  );
  assert.doesNotThrow(() => assertLane(sourceByKey('usgs'), whip));
  assert.doesNotThrow(() => assertLane(sourceByKey('tomtom'), whip));
  assert.doesNotThrow(() => assertLane(sourceByKey('aisstream'), whip));
  assert.doesNotThrow(() => assertLane(sourceByKey('planet_research'), house));
  assert.throws(
    () => assertLane(sourceByKey('planet_research'), policy),
    (error) => error.code === 'lane_forbidden'
  );
  assert.doesNotThrow(() => assertLane(sourceByKey('equity_uprise'), policy));
  assert.doesNotThrow(() => assertLane(sourceByKey('house'), house));
});

test('executeProvider denies Whip Planet before asking for credentials', async () => {
  await assert.rejects(
    () => executeProvider('planet_research', {}, { PLANET_RESEARCH_API_KEY: 'secret-must-not-matter' }, whip),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'lane_forbidden');
      assert.equal(error.detail.app, 'WHIP_RIDER');
      return true;
    }
  );
});

test('executeProvider allows Whip onto commercial traffic and AIS', async () => {
  await assert.rejects(
    () => executeProvider('tomtom', { point: { lat: 41.3, lon: -72.9 } }, {}, whip),
    (error) => error.code === 'credential_missing' && error.status === 503
  );
});

test('executeProvider refuses a missing app identity instead of defaulting to house', async () => {
  await assert.rejects(
    () => executeProvider('usgs', {}, {}),
    (error) => error.code === 'unidentified_app' && error.status === 403
  );
});

test('GET /v1/geo/plane is a sanitized public contract with no internal sites', async () => {
  const response = await geo.fetch(new Request('https://api.mccluster.org/v1/geo/plane'), {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  const serialized = JSON.stringify(payload);
  assert.equal(payload.ok, true);
  assert.equal(payload.plane, 'spatial');
  assert.equal(payload.satellite_of, 'control');
  assert.equal(payload.worker, 'mccluster');
  assert.equal(payload.durable_object, 'HereTenantAgent');
  assert.equal(payload.version, 1);
  assert.equal(payload.sites, undefined);
  assert.equal(payload.arcs, undefined);
  assert.equal(payload.prize, undefined);
  assert.equal(payload.do_not_merge, undefined);
  assert.equal(payload.branch, undefined);
  assert.equal(payload.forbidden.second_worker, true);
  assert.equal(payload.forbidden.gev_proxy, true);
  assert.equal(payload.forbidden.vercel, true);
  assert.equal(payload.forbidden.pages_hijack, true);
  assert.equal(payload.forbidden.cesium_clone, true);
  assert.equal(payload.lanes.SCSU_RESEARCH.whip, false);
  assert.equal(payload.lanes.INTERNAL.whip, false);
  assert.equal(payload.lanes.OPEN.whip, true);
  assert.equal(payload.lanes.COMMERCIAL.whip, true);
  assert.ok(payload.public_layers.includes('usgs'));
  assert.equal(payload.routes.plane_internal, 'GET /v1/geo/plane/internal');
  assert.doesNotMatch(serialized, /Shiloh|PRIM3|eu-dc|scsu|41\.3327|do_not_merge|prize-branch/);
  assert.doesNotMatch(serialized, /sk-|api[_-]?key\s*[:=]/i);
});

test('GET /v1/geo/plane/internal is house-owner only', async () => {
  const denied = await geo.fetch(new Request('https://api.mccluster.org/v1/geo/plane/internal'), {});
  assert.equal(denied.status, 503);
  const payload = await denied.json();
  assert.equal(payload.detail.code, 'authorization_unavailable');

  const allowed = await geo.fetch(new Request('https://api.mccluster.org/v1/geo/plane/internal'), {}, owner);
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.ok, true);
  assert.equal(body.prize, undefined);
  assert.equal(body.do_not_merge, undefined);
  assert.ok(Array.isArray(body.sites));
  assert.ok(body.sources.some((source) => source.key === 'equity_uprise'));
});

test('house adapter does not invent McCluster coordinates without authoritative tables', async () => {
  const result = await executeProvider('house', {}, {}, house);
  assert.equal(result.source, 'house');
  assert.equal(result.authoritative, false);
  assert.equal(result.authority, 'unavailable');
  assert.equal(result.records.length, 0);
  assert.equal(result.persistence, 'persistent');
});

test('house adapter reads facilities when the authority table is present', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/rest/v1/facilities?source_key=eq.house')) {
      return new Response(JSON.stringify([
        {
          facility_key: 'house',
          name: 'Control plane',
          kind: 'studio',
          city: 'Bridgeport',
          lat: 41.1865,
          lon: -73.1956,
          visibility: 'internal',
          source_key: 'house',
          metadata: { detail: 'from facilities' }
        }
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await executeProvider('house', {}, {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role'
  }, house);
  assert.equal(result.authoritative, true);
  assert.equal(result.authority, 'facilities');
  assert.equal(result.records[0].external_id, 'house');
  assert.equal(result.records[0].point.lat, 41.1865);
});

test('geo fetch of INTERNAL source as Whip is 403 even with a valid Whip session', async () => {
  const response = await geo.fetch(
    post('/v1/geo/fetch/equity_uprise', {}),
    {},
    whipCaller
  );
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.detail.code, 'lane_forbidden');
});

test('body.consumer is rejected so callers cannot self-label', async () => {
  const response = await geo.fetch(
    post('/v1/geo/fetch/planet_research', { consumer: 'policy' }),
    { PLANET_RESEARCH_API_KEY: 'secret-must-not-matter' },
    whipCaller
  );
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.detail.code, 'consumer_not_accepted');
});

test('POST /v1/geo/fetch never persists even when asked', async () => {
  const persist = await geo.fetch(
    post('/v1/geo/fetch/house', { persist: true }),
    {},
    owner
  );
  assert.equal(persist.status, 400);
  const denied = await persist.json();
  assert.equal(denied.detail.code, 'persist_not_allowed_on_fetch');

  const fetched = await geo.fetch(
    post('/v1/geo/fetch/house', {}),
    {},
    owner
  );
  assert.equal(fetched.status, 200);
  const payload = await fetched.json();
  assert.equal(payload.result.persistence.persisted, false);
  assert.equal(payload.result.persistence.reason, 'fetch_never_persists');
  assert.equal(payload.app.app, 'INTERNAL_GEV');
});

test('catalog lists the public plane and the authenticated internal plane', () => {
  const paths = CATALOG.routes.map((row) => row.path);
  assert.ok(paths.includes('/v1/geo'));
  assert.ok(paths.includes('/v1/geo/plane'));
  assert.ok(paths.includes('/v1/geo/plane/internal'));
  assert.ok(paths.includes('/v1/geo/fetch/:source'));
  const fetchRoute = CATALOG.routes.find((row) => row.path === '/v1/geo/fetch/:source');
  assert.equal(fetchRoute.auth, 'app-identity');
  const internal = CATALOG.routes.find((row) => row.path === '/v1/geo/plane/internal');
  assert.equal(internal.auth, 'house-owner');
});

test('prize branch did not take ChatGPT Pages hijack or gev build script', async () => {
  const pages = await readFile(pagesWorkflow, 'utf8');
  assert.match(pages, /branches:\s*\n\s*-\s*main/s);
  assert.doesNotMatch(pages, /feature\/gev-spatial-intelligence/);
  await assert.rejects(() => readFile(buildGev, 'utf8'), { code: 'ENOENT' });
});

test('canonical worker still wires geo before the database gate', async () => {
  const source = await readFile(workerSourcePath, 'utf8');
  const routeNeedle = 'return geo.fetch(request, env, { requireHouseOwner, authUser, resolveAppIdentity: resolveRequestIdentity });';
  const routeIndex = source.indexOf(routeNeedle);
  const configGateIndex = source.indexOf("if (!configured(env)) return fail(request, env, 'McCluster is not configured', 503);");
  assert.ok(routeIndex >= 0);
  assert.ok(routeIndex < configGateIndex);
  assert.match(source, /import geo from '\.\/geo\/index\.js';/);
  assert.doesNotMatch(source, /gev-proxy/);
  assert.doesNotMatch(source, /class GeoAgent/);
});

test('authority migration keeps facilities off anon/authenticated roles', async () => {
  const sql = await readFile(authorityMigration, 'utf8');
  assert.match(sql, /create table if not exists public\.facilities/i);
  assert.match(sql, /create table if not exists public\.facility_links/i);
  assert.match(sql, /visibility text not null default 'internal'/);
  assert.match(sql, /revoke all on table public\.%I from anon, authenticated/i);
  assert.match(sql, /'house'/);
  assert.match(sql, /'equity_uprise'/);
  assert.match(sql, /'scsu_docket'/);
  assert.match(sql, /mccluster-gev/);
});
