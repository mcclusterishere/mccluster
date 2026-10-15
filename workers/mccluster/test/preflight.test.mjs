/* The browser's preflight for a member route is answered before any gate (src/preflight.js).
   Owner, 2026-10-15: "when I'm logged in as Benji Chase … not seeing the globe". The World's
   bootstrap preflight was answered 401, so the browser never sent the real request. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preflightResponse, PREFLIGHT_FIRST_PREFIXES } from '../src/preflight.js';

const env = { ALLOWED_ORIGINS: 'https://matthew.mccluster.org,https://mccluster.org' };
const preflight = (path, origin = 'https://matthew.mccluster.org', extra = {}) => new Request('https://api.mccluster.org' + path, {
  method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,content-type', ...extra }
});

test('every route family the World and the studios call from a browser answers its preflight 204 with the allowlisted origin', () => {
  for (const path of ['/v1/mnet/bootstrap?app_key=mccluster-web', '/v1/mnet/feed', '/v1/mnet/notifications', '/v1/mnet/profile', '/v1/mnet/people/someone/follow',
    '/v1/mnet/live/directory', '/v1/mnet/media/upload-url', '/v1/developer/consumers', '/v1/fbi/desk', '/v1/compute/balance', '/v1/ai/route',
    '/v1/creator-sites/publish', '/v1/creator-billing/entitlement', '/v1/action-connect/status', '/v1/platform/plans', '/v1/mnet']) {
    const res = preflightResponse(preflight(path), env);
    assert.ok(res, path + ' is answered');
    assert.equal(res.status, 204, path);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://matthew.mccluster.org', path);
    assert.match(res.headers.get('access-control-allow-headers'), /authorization/, path);
    assert.match(res.headers.get('access-control-allow-methods'), /GET/, path);
  }
});

test('the World\'s other host is allowlisted the same way, and a stranger origin is not echoed', () => {
  assert.equal(preflightResponse(preflight('/v1/mnet/bootstrap', 'https://mccluster.org'), env).headers.get('access-control-allow-origin'), 'https://mccluster.org');
  assert.equal(preflightResponse(preflight('/v1/mnet/bootstrap', 'https://evil.example'), env).headers.get('access-control-allow-origin'), 'https://matthew.mccluster.org');
});

test('only a real preflight, only these families: everything else goes on to its own handler', () => {
  assert.equal(preflightResponse(new Request('https://api.mccluster.org/v1/mnet/bootstrap', { method: 'GET', headers: { origin: 'https://matthew.mccluster.org' } }), env), null, 'a GET is the handler\'s, with its sign-in check');
  assert.equal(preflightResponse(new Request('https://api.mccluster.org/v1/mnet/bootstrap', { method: 'OPTIONS' }), env), null, 'an OPTIONS that is not a CORS preflight is the handler\'s');
  for (const path of ['/v1/collect', '/v1/whip/session', '/v1/music/library', '/v1/auth/handoff', '/v1/world/layers/flights', '/v1/mnetwork', '/v1/aim']) {
    assert.equal(preflightResponse(preflight(path), env), null, path + ' keeps its own answer');
  }
});

test('the platform entry asks before any gated handler, right after health', async () => {
  const src = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ preflightResponse \} from '\.\/preflight\.js';/);
  const at = src.indexOf('const preflight = preflightResponse(request, env);');
  assert.ok(at > src.indexOf("url.pathname === '/v1/health'"), 'after health');
  for (const gate of ['handleCreatorBillingWebhook(request, env)', 'enforceApiRateLimit(request, env)', 'handleAuthHandoff(request, env)', 'handleCreatorPublish(request, env)', 'handleCreatorEntitlement(request, env)', 'handleComputeApi(request, env)', 'handlePlatformApi(request, env)']) {
    assert.ok(at < src.indexOf(gate), 'before ' + gate);
  }
  assert.ok(at > src.indexOf('humanUpriseResponse(request, env)'), 'the World hosts answer their own requests first');
  assert.deepEqual(PREFLIGHT_FIRST_PREFIXES.filter((p) => ['/v1/collect', '/v1/whip', '/v1/music'].includes(p)), [], 'the routes that answer other origins on purpose are not here');
});
