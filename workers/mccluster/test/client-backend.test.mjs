import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { handleClientRequest } from '../src/client.js';

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

test('client OPTIONS preflight works without database configuration', async () => {
  const request = new Request('https://api.mccluster.org/v1/clients/esmer/me', {
    method: 'OPTIONS',
    headers: { origin: 'https://mcclusterishere.github.io' }
  });
  const response = await handleClientRequest(request, {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://mcclusterishere.github.io');
});
