/* Every JSON answer from api.mccluster.org carries HSTS, nosniff and a
   framing answer beside its CORS answer (src/lib/http.js), and applyCors
   completes a bare response without clobbering what a route chose.
   Audit finding 2 (audit/security-headers). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reply, fail, applyCors, corsHeaders } from '../src/lib/http.js';

const env = {};
const req = (origin) => new Request('https://api.mccluster.org/v1/thing', { headers: origin ? { origin } : {} });
const EXPECTED = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
};

test('reply() and fail() carry HSTS, nosniff and DENY beside the CORS answer', async () => {
  const r = reply(req('https://mccluster.org'), env, { ok: true });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  for (const [k, v] of Object.entries(EXPECTED)) assert.equal(r.headers.get(k), v, k);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://mccluster.org');
  assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
  assert.deepEqual(await r.json(), { ok: true });
  const f = fail(req(), env, 'nope', 418, { why: 'teapot' });
  assert.equal(f.status, 418);
  for (const [k, v] of Object.entries(EXPECTED)) assert.equal(f.headers.get(k), v, k);
  assert.equal(f.headers.get('access-control-allow-origin'), 'https://matthew.mccluster.org', 'no Origin: the first allowlisted origin, never *');
  assert.deepEqual(await f.json(), { error: 'nope', detail: { why: 'teapot' } });
});

test('applyCors completes a bare JSON response, keeps its status and body, and clobbers nothing a route chose', async () => {
  const bare = applyCors(req('https://mccluster.org'), env, new Response('{"a":1}', { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' } }));
  assert.equal(bare.status, 201);
  for (const [k, v] of Object.entries(EXPECTED)) assert.equal(bare.headers.get(k), v, k);
  assert.equal(bare.headers.get('access-control-allow-origin'), 'https://mccluster.org');
  assert.deepEqual(await bare.json(), { a: 1 });

  const chosen = applyCors(req(), env, new Response('{}', { headers: { 'content-type': 'application/json', 'x-frame-options': 'SAMEORIGIN', 'strict-transport-security': 'max-age=1' } }));
  assert.equal(chosen.headers.get('x-frame-options'), 'SAMEORIGIN', 'a route\'s own framing answer stands');
  assert.equal(chosen.headers.get('strict-transport-security'), 'max-age=1', 'a route\'s own HSTS stands');
  assert.equal(chosen.headers.get('x-content-type-options'), 'nosniff', 'the missing one is added');
});

test('applyCors does not tell a document it may not be framed', () => {
  const html = applyCors(req(), env, new Response('<!doctype html><title>x</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  assert.equal(html.headers.get('x-frame-options'), null, 'a page decides its own framing');
  assert.equal(html.headers.get('strict-transport-security'), EXPECTED['strict-transport-security']);
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
  const empty = applyCors(req(), env, new Response(null, { status: 204 }));
  assert.equal(empty.status, 204);
  assert.equal(empty.headers.get('x-frame-options'), null, 'no content type, no framing answer');
  assert.equal(empty.headers.get('x-content-type-options'), 'nosniff');
});

test('an origin off the allowlist is never echoed and never answered with *', () => {
  for (const e of [env, { ALLOWED_ORIGIN: '*' }, { ALLOWED_ORIGINS: 'https://partner.example' }]) {
    assert.equal(corsHeaders(req('https://evil.example'), e)['access-control-allow-origin'], 'https://matthew.mccluster.org', JSON.stringify(e));
  }
  assert.equal(corsHeaders(req('https://partner.example'), { ALLOWED_ORIGINS: 'https://partner.example' })['access-control-allow-origin'], 'https://partner.example');
});
