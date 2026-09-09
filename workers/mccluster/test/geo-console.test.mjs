import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { accessConfigured, verifyAccess } from '../src/geo/access.js';

const here = dirname(fileURLToPath(import.meta.url));
const consolePath = resolve(here, '..', 'src', 'geo', 'console.html');
const workerPath = resolve(here, '..', 'src', 'index.js');
const repoRoot = resolve(here, '..', '..', '..');

test('the console carries no credential and no public entry point', async () => {
  const html = await readFile(consolePath, 'utf8');
  // The publishable Supabase key is public by design and already ships in
  // js/mcc-auth.js; nothing else may be baked in.
  assert.doesNotMatch(html, /service_role/i);
  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE/i);
  assert.doesNotMatch(html, /eyJhbGciOi/, 'no JWT may be embedded in the console');
  assert.doesNotMatch(html, /sb_secret/i);
  assert.match(html, /name="robots" content="noindex/i);
  assert.match(html, /GET \/v1\/geo\/viewer\/config|\/v1\/geo\/viewer\/config/);
});

/*
  The regression that produced the original stuck loading screen: a startup
  dependency that never settles, with no deadline and no way out.
*/
test('the console cannot rest on an undismissable loading cover', async () => {
  const html = await readFile(consolePath, 'utf8');
  assert.match(html, /BOOT_DEADLINE_MS/, 'boot must have a hard deadline');
  assert.match(html, /function withTimeout/, 'each step must be timed out');
  assert.match(html, /\.finally\(function \(\) \{[\s\S]*?uncover\(\)/, 'the cover must come down in a finally');
  assert.match(html, /function stall/, 'a fatal error must show a diagnostic, not a spinner');
  assert.match(html, /id="retry"/);
  assert.match(html, /id="continue"/);
});

test('the globe is constructed without any provider credential', async () => {
  const html = await readFile(consolePath, 'utf8');
  // baseLayerPicker and geocoder are the two Viewer features that reach Cesium
  // ion with or without a token; both must be off for a truthful keyless boot.
  assert.match(html, /baseLayerPicker: false/);
  assert.match(html, /geocoder: false/);
  assert.match(html, /OpenStreetMapImageryProvider/);
  assert.match(html, /EllipsoidTerrainProvider/);
  // A tile outage must still leave a planet on screen.
  assert.match(html, /globe\.baseColor/);
  // Number.isFinite, not the global: isFinite(null) coerces to 0.
  assert.match(html, /Number\.isFinite\(item\.lat\)/);
  assert.doesNotMatch(html, /if \(!isFinite\(item\.lat\)/);
});

test('paid basemaps are optional, timed out, and fall back to the open stack', async () => {
  const html = await readFile(consolePath, 'utf8');
  for (const needle of ['useGoogleTiles', 'useIonTerrain']) {
    const start = html.indexOf('function ' + needle);
    assert.ok(start > 0, needle + ' is missing');
    const body = html.slice(start, start + 1400);
    assert.match(body, /withTimeout\(/, needle + ' must be bounded');
    assert.match(body, /\.catch\(/, needle + ' must report failure');
  }
});

test('the Worker serves the console with hardened headers and a Cesium-capable CSP', async () => {
  const source = await readFile(workerPath, 'utf8');
  assert.match(source, /path === '\/internal\/gev'/);
  assert.match(source, /verifyAccess\(request, env\)/);
  assert.match(source, /x-robots-tag/);
  assert.match(source, /'x-frame-options': 'DENY'/);
  assert.match(source, /cache-control': 'private, no-store'/);
  // Verified in a cold browser: without these Cesium never constructs, and
  // without the tile host in connect-src the globe renders blank.
  assert.match(source, /script-src[^"]*'wasm-unsafe-eval'/);
  assert.match(source, /connect-src[^"]*tile\.openstreetmap\.org/);
  assert.doesNotMatch(source, /connect-src[^"]*\s\*\s/, 'no wildcard connect-src');
});

test('the internal console is never published to the public site', async () => {
  const workflow = await readFile(resolve(repoRoot, '.github', 'workflows', 'deploy-pages.yml'), 'utf8');
  assert.doesNotMatch(workflow, /gev/i, 'the public Pages pipeline must not build or publish GEV');
  assert.match(workflow, /branches:\s*\n\s*- main\s*\n/, 'only main publishes the public site');
});

test('Access verification is off until configured and fails closed once it is', async () => {
  assert.equal(accessConfigured({}), false);
  assert.equal(await verifyAccess(new Request('https://api.mccluster.org/internal/gev'), {}), null);

  const env = { GEV_ACCESS_TEAM_DOMAIN: 'mccluster', GEV_ACCESS_AUD: 'aud-tag' };
  await assert.rejects(
    () => verifyAccess(new Request('https://api.mccluster.org/internal/gev'), env),
    (error) => error.code === 'access_assertion_missing'
  );
  await assert.rejects(
    () => verifyAccess(new Request('https://api.mccluster.org/internal/gev', {
      headers: { 'cf-access-jwt-assertion': 'not-a-jwt' }
    }), env),
    (error) => error.code === 'access_assertion_malformed'
  );

  // A structurally valid but expired assertion must not pass on shape alone.
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expired = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ exp: 1, aud: ['aud-tag'], iss: 'https://mccluster.cloudflareaccess.com' })}.sig`;
  await assert.rejects(
    () => verifyAccess(new Request('https://api.mccluster.org/internal/gev', {
      headers: { 'cf-access-jwt-assertion': expired }
    }), env),
    (error) => error.code === 'access_assertion_expired'
  );
});

test('the AIS Durable Object survives eviction and backs off', async () => {
  const source = await readFile(resolve(here, '..', 'src', 'here-tenant-agent.js'), 'utf8');
  assert.deepEqual([...source.matchAll(/export class\s+(\w+)/g)].map((m) => m[1]), ['HereTenantAgent']);
  // An outbound WebSocket cannot hibernate, so state has to be durable and the
  // alarm has to re-arm itself or the "persistent" stream dies on first evict.
  assert.match(source, /aisState\(\)/);
  assert.match(source, /async alarm\(\)/);
  assert.match(source, /armAlarm\(/);
  assert.match(source, /backoffMs\(/);
  assert.match(source, /AIS_ROW_TTL_MS/, 'stale vessels must be pruned');
  assert.match(source, /payload\?\.error \|\| payload\?\.Error/, 'in-band AISStream errors must fail the connection');
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*AISSTREAM_API_KEY/);
});
