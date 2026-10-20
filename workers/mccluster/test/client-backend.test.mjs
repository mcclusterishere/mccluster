import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { handleClientRequest, PUBLIC_WRITE_LIMITS, resetPublicWriteLimits } from '../src/client.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = resolve(here, '..', 'src', 'client.js');
const entryPath = resolve(here, '..', 'src', 'entry.js');
const httpPath = resolve(here, '..', 'src', 'lib', 'http.js');

async function text(path) {
  return readFile(path, 'utf8');
}

test('client owner authorization is membership based, not an email bypass', async () => {
  const source = await text(clientPath);
  assert.match(source, /org_members\?org_id=eq\./);
  assert.match(source, /profile_id=eq\.\$\{encodeURIComponent\(user\.id\)\}/);
  assert.match(source, /Client tenant access required/);
  assert.doesNotMatch(source, /justinesmer@gmail\.com|owner_email/i);
});

test('public inquiries are tenant resolved and written to canonical leads', async () => {
  const source = await text(clientPath);
  assert.match(source, /path === '\/v1\/inquiries'/);
  assert.match(source, /org_id: org\.id/);
  assert.match(source, /sbRequest\(env, 'leads\?select=id,at,status'/);
  assert.match(source, /status: 'new'/);
});

test('public content exposes only the published side of tenant content', async () => {
  const source = await text(clientPath);
  assert.match(source, /value\.published == null/);
  assert.match(source, /out\[key\] = value\.published/);
  assert.doesNotMatch(source.match(/function publishedContent[\s\S]*?return out;/)?.[0] || '', /draft/);
});

test('entry delegates client routes without replacing the canonical worker', async () => {
  const source = await text(entryPath);
  assert.match(source, /handleClientRequest/);
  assert.match(source, /return core\.fetch\(request, env, ctx\)/);
  assert.match(source, /export \{ HereTenantAgent \}/);
});

test('Esmer GitHub Pages origin is explicitly allowed', async () => {
  const source = await text(httpPath);
  assert.match(source, /https:\/\/mcclusterishere\.github\.io/);
  assert.match(source, /https:\/\/esmer\.mccluster\.org/);
});

test('house owners can operate a client tenant from Control', async () => {
  const source = await text(clientPath);
  assert.match(source, /orgs\?slug=eq\.mccluster/);
  assert.match(source, /role=eq\.owner/);
  assert.match(source, /upsertConversation/);
  assert.match(source, /notifyOwners/);
});

test('client OPTIONS preflight works without database configuration', async () => {
  const request = new Request('https://api.mccluster.org/v1/clients/esmer/me', {
    method: 'OPTIONS',
    headers: { origin: 'https://mcclusterishere.github.io' }
  });
  const response = await handleClientRequest(request, {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://mcclusterishere.github.io');
});

/* Public writes that mail someone or save a lead are rate limited per IP
   (and, for sign-in links, per address) before any Supabase call. */
const CLIENT_ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function withClientPlane(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (href.includes('/rest/v1/orgs?slug=eq.esmer')) return json([{ id: 'org-esmer', slug: 'esmer', name: 'Esmer', kind: 'client', settings: {} }]);
    if (href.endsWith('/auth/v1/otp')) return json({}, 200);
    if (href.includes('/rest/v1/leads?')) return json([{ id: 'lead-1', at: '2026-10-20T00:00:00Z', status: 'new' }], 201);
    throw new Error('delivery not mocked: ' + href);
  };
  resetPublicWriteLimits();
  return Promise.resolve().then(() => fn(calls)).finally(() => { globalThis.fetch = original; resetPublicWriteLimits(); });
}

function clientPost(path, body, ip = '203.0.113.7') {
  return handleClientRequest(new Request(`https://api.mccluster.org${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://esmer.mccluster.org', 'cf-connecting-ip': ip },
    body: JSON.stringify(body)
  }), CLIENT_ENV);
}

test('sign-in link requests are limited per IP before Supabase Auth is asked', async () => {
  await withClientPlane(async (calls) => {
    for (let i = 0; i < PUBLIC_WRITE_LIMITS.accountStartPerIp; i += 1) {
      const res = await clientPost('/v1/account/start', { org: 'esmer', email: `person${i}@example.test` });
      assert.equal(res.status, 202);
    }
    const otpCalls = calls.filter((h) => h.endsWith('/auth/v1/otp')).length;
    const res = await clientPost('/v1/account/start', { org: 'esmer', email: 'another@example.test' });
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) >= 1);
    assert.equal(calls.filter((h) => h.endsWith('/auth/v1/otp')).length, otpCalls);
    const other = await clientPost('/v1/account/start', { org: 'esmer', email: 'another@example.test' }, '198.51.100.9');
    assert.equal(other.status, 202, 'another IP is unaffected');
  });
});

test('one address cannot be flooded with sign-in links from many IPs', async () => {
  await withClientPlane(async () => {
    for (let i = 0; i < PUBLIC_WRITE_LIMITS.accountStartPerEmail; i += 1) {
      const res = await clientPost('/v1/account/start', { org: 'esmer', email: 'Victim@Example.test' }, `192.0.2.${i + 1}`);
      assert.equal(res.status, 202);
    }
    const res = await clientPost('/v1/account/start', { org: 'esmer', email: 'victim@example.test' }, '192.0.2.200');
    assert.equal(res.status, 429);
  });
});

test('public inquiries are limited per IP before a lead is written', async () => {
  await withClientPlane(async (calls) => {
    for (let i = 0; i < PUBLIC_WRITE_LIMITS.inquiriesPerIp; i += 1) {
      const res = await clientPost('/v1/inquiries', { org: 'esmer', name: 'Pat', email: 'pat@example.test' });
      assert.equal(res.status, 201);
    }
    const leads = calls.filter((h) => h.includes('/rest/v1/leads?')).length;
    const res = await clientPost('/v1/inquiries', { org: 'esmer', name: 'Pat', email: 'pat@example.test' });
    assert.equal(res.status, 429);
    assert.equal(calls.filter((h) => h.includes('/rest/v1/leads?')).length, leads);
  });
});
