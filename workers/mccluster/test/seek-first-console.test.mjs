import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { accessConfigured, accessRequired, verifyAccess } from '../src/seek-first/access.js';

const here = dirname(fileURLToPath(import.meta.url));
const consolePath = resolve(here, '..', 'src', 'seek-first', 'console.html');
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
  assert.match(html, /GET \/v1\/seek-first\/viewer\/config|\/v1\/seek-first\/viewer\/config/);
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
  assert.match(source, /path === '\/internal\/seek-first'/);
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
  assert.doesNotMatch(workflow, /seek-first/i, 'the public Pages pipeline must not build or publish Seek First');
  assert.match(workflow, /branches:\s*\n\s*- main\s*\n/, 'only main publishes the public site');
});

test('both wrangler configs can bundle the console text module', async () => {
  // wrangler.toml at the repo root is the fail-safe mirror for an accidental
  // root deploy. Without the Text rule that deploy fails to bundle at all,
  // which defeats the point of having the mirror.
  for (const file of [
    resolve(here, '..', 'wrangler.toml'),
    resolve(repoRoot, 'wrangler.toml')
  ]) {
    const toml = await readFile(file, 'utf8');
    assert.match(toml, /\[\[rules\]\]/, file + ' has no module rules');
    assert.match(toml, /type = "Text"/, file + ' does not declare a Text module');
    assert.match(toml, /globs = \["\*\*\/\*\.html"\]/, file + ' does not cover the console html');
    assert.match(toml, /name = "mccluster"/, file + ' must stay the canonical Worker');
    assert.doesNotMatch(toml, /mccluster-core/, 'that Worker does not exist');
    assert.doesNotMatch(toml, /^\s*\[assets\]/m, 'the Worker must not gain an assets directory');
  }
});

test('Access verification is off until configured and fails closed once it is', async () => {
  assert.equal(accessConfigured({}), false);
  assert.equal(await verifyAccess(new Request('https://api.mccluster.org/internal/seek-first'), {}), null);

  const env = { SEEK_FIRST_ACCESS_TEAM_DOMAIN: 'mccluster', SEEK_FIRST_ACCESS_AUD: 'aud-tag' };
  await assert.rejects(
    () => verifyAccess(new Request('https://api.mccluster.org/internal/seek-first'), env),
    (error) => error.code === 'access_assertion_missing'
  );
  await assert.rejects(
    () => verifyAccess(new Request('https://api.mccluster.org/internal/seek-first', {
      headers: { 'cf-access-jwt-assertion': 'not-a-jwt' }
    }), env),
    (error) => error.code === 'access_assertion_malformed'
  );

  // A structurally valid but expired assertion must not pass on shape alone.
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expired = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ exp: 1, aud: ['aud-tag'], iss: 'https://mccluster.cloudflareaccess.com' })}.sig`;
  await assert.rejects(
    () => verifyAccess(new Request('https://api.mccluster.org/internal/seek-first', {
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

/*
  The deploy wipe.

  `wrangler deploy` uploads wrangler.toml's [vars] as the Worker's complete set
  of plaintext bindings, so a dashboard-set var that is absent from the toml is
  removed on the next ship. That is what kept switching the edge lock off, and
  the only trace was a boolean on a health route nobody reads on a good day.

  The flag survives the wipe because it lives in the toml. These tests are the
  reason it stays that way.
*/
test('an unconfigured edge stays a no-op until the owner says otherwise', async () => {
  const request = new Request('https://api.mccluster.org/internal/seek-first');

  // Bootstrap: Access is not set up yet, and failing closed here would lock the
  // owner out of their own console with no way back in.
  assert.equal(await verifyAccess(request, {}), null);
  assert.equal(await verifyAccess(request, { SEEK_FIRST_ACCESS_REQUIRED: 'false' }), null);
});

test('once Access is required, losing the config is a loud 503 that names the binding', async () => {
  const request = new Request('https://api.mccluster.org/internal/seek-first');

  await assert.rejects(
    () => verifyAccess(request, { SEEK_FIRST_ACCESS_REQUIRED: 'true' }),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'access_misconfigured');
      assert.deepEqual(error.detail.missing_bindings, ['SEEK_FIRST_ACCESS_TEAM_DOMAIN', 'SEEK_FIRST_ACCESS_AUD']);
      // The message has to say what happened, because the person reading it is
      // looking at a console that worked ten minutes ago.
      assert.match(error.message, /wrangler deploy clears plaintext vars/);
      return true;
    }
  );

  // A half-wipe names only the half that went missing.
  await assert.rejects(
    () => verifyAccess(request, { SEEK_FIRST_ACCESS_REQUIRED: 'true', SEEK_FIRST_ACCESS_TEAM_DOMAIN: 'mccluster' }),
    (error) => {
      assert.deepEqual(error.detail.missing_bindings, ['SEEK_FIRST_ACCESS_AUD']);
      return true;
    }
  );
});

test('a typo in the flag does not silence the lock', async () => {
  const request = new Request('https://api.mccluster.org/internal/seek-first');
  // Only an explicit "true" arms it; anything else leaves the bootstrap no-op,
  // so a mistyped flag never masquerades as a deliberate opt-out.
  for (const value of ['TRUE', ' true ', 'yes', '1', 'True']) {
    const armed = ['TRUE', ' true ', 'True'].includes(value);
    const result = armed
      ? await verifyAccess(request, { SEEK_FIRST_ACCESS_REQUIRED: value }).then(() => 'no-op', () => 'threw')
      : await verifyAccess(request, { SEEK_FIRST_ACCESS_REQUIRED: value }).then(() => 'no-op', () => 'threw');
    assert.equal(result, armed ? 'threw' : 'no-op', `SEEK_FIRST_ACCESS_REQUIRED=${JSON.stringify(value)}`);
  }
  assert.equal(accessRequired({ SEEK_FIRST_ACCESS_REQUIRED: 'yes' }), false);
  assert.equal(accessRequired({ SEEK_FIRST_ACCESS_REQUIRED: '1' }), false);
  assert.equal(accessRequired({ SEEK_FIRST_ACCESS_REQUIRED: ' TRUE ' }), true);
});

/*
  The flag is only a guard if it is in the file that wrangler uploads. If it
  ever moves to the dashboard it gets wiped by the same deploy it is supposed to
  survive, and the whole mechanism is decorative.
*/
test('the flag is declared in wrangler.toml, where the deploy cannot reach it', async () => {
  const toml = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.toml'), 'utf8');
  const vars = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[triggers]'));
  assert.match(vars, /^SEEK_FIRST_ACCESS_REQUIRED = "(true|false)"$/m,
    'SEEK_FIRST_ACCESS_REQUIRED must be an active [vars] entry, not a comment');
  assert.match(toml, /wrangler deploy` uploads THIS \[vars\] block/,
    'the reason has to stay next to the setting');
});
