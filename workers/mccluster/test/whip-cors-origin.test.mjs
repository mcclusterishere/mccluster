/* The Whip layers' own CORS answer, for the day one is mounted without
   applyCors (src/index.js wraps the chain today): an origin that is not
   allowlisted gets the first allowlisted origin, never '*'.
   Audit finding 3 (audit/security-headers). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import identityGateway from '../src/whip/identity-gateway.js';
import security from '../src/whip/security.js';
import gateway from '../src/whip/gateway.js';
import router from '../src/whip/router.js';
import worker from '../src/whip/worker.js';

const LAYERS = { 'identity-gateway': identityGateway, security, gateway, router, worker };
const preflight = (origin) => new Request('https://api.mccluster.org/api/config', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET' } });

test('an unknown origin gets the first allowlisted origin from every layer, with ALLOWED_ORIGIN unset, empty or *', async () => {
  for (const [name, layer] of Object.entries(LAYERS)) {
    for (const env of [{}, { ALLOWED_ORIGIN: '' }, { ALLOWED_ORIGIN: '*' }]) {
      const res = await layer.fetch(preflight('https://evil.example'), env, {});
      assert.equal(res.status, 204, name);
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://matthew.mccluster.org', `${name} ${JSON.stringify(env)}`);
    }
    const pinned = await layer.fetch(preflight('https://evil.example'), { ALLOWED_ORIGIN: 'https://whip.example' }, {});
    assert.equal(pinned.headers.get('access-control-allow-origin'), 'https://whip.example', `${name}: a configured origin stands`);
  }
});

test('no wildcard fallback is left in the chain', async () => {
  for (const f of ['worker', 'security', 'router', 'gateway', 'identity-gateway']) {
    const src = await readFile(new URL(`../src/whip/${f}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /ALLOWED_ORIGIN\s*\|\|\s*'\*'/, f);
    assert.doesNotMatch(src, /'access-control-allow-origin':\s*'\*'/, f);
  }
});
