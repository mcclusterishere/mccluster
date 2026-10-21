/* Browsers send a CORS preflight (OPTIONS, no Authorization header) before
 * every signed-in fetch from the Control Room. /v1/analytics, /v1/social,
 * /v1/comms and /v1/ai authenticate before they look at the method, so the
 * preflight used to get a 401, Safari refused the real request, and
 * Control > Analytics showed "business / identity / forensics did not load:
 * Load failed" while every server-side check passed.
 *
 * These tests drive the real entry.js. entry.js cannot be imported in Node
 * as-is: it pulls in `cloudflare:workers` and wrangler's Text-rule .html
 * modules, so both are stubbed below the way the Workers runtime supplies
 * them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') {
      return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.html$/.test(url)) {
      const text = readFileSync(new URL(url), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return next(url, context);
  }
});

const { default: entry } = await import('../src/entry.js');

const ORIGIN = 'https://matthew.mccluster.org';
const env = {};

function call(path, method, headers = {}) {
  return entry.fetch(new Request(`https://api.mccluster.org${path}`, {
    method,
    headers: { origin: ORIGIN, ...headers }
  }), env, {});
}

for (const path of [
  '/v1/analytics/business',
  '/v1/analytics/identity',
  '/v1/analytics/forensics',
  '/v1/social/accounts',
  '/v1/comms/threads',
  '/v1/ai/chat',
  '/v1/work/tasks',
  '/v1/work/leads',
  '/v1/work/tasks/623e4567-e89b-42d3-a456-426614174666'
]) {
  test(`preflight for ${path} is answered before the sign-in gate`, async () => {
    const response = await call(path, 'OPTIONS', {
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization, content-type'
    });
    assert.equal(response.status, 204, 'a non-2xx preflight makes the browser drop the real request');
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
    assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/);
    assert.match(response.headers.get('access-control-allow-methods') || '', /GET/);
  });
}

test('analytics router responses carry CORS headers', async () => {
  /* The router builds bare JSON responses; the browser discards any
     response without Access-Control-Allow-Origin, even a 200. */
  const response = await call('/v1/analytics/domains/00000000-0000-0000-0000-000000000000/verify', 'GET');
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
});

test('the preflight exemption does not open the real request', async () => {
  const response = await call('/v1/analytics/business', 'GET');
  assert.notEqual(response.status, 200, 'an unsigned GET must still be refused');
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN,
    'the refusal must be readable by the page so it can show the real reason');
});
