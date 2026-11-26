// node --test docs/control-plane/equityuprise-migration/staging/worker/router.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { route } from './router.mjs';

const reg = JSON.parse(readFileSync(new URL('../tenants.json', import.meta.url), 'utf8'));

test('equityuprise.com is the owner and serves the platform root', () => {
  assert.deepEqual(route('https://equityuprise.com/', reg), { kind: 'serve', tenant: 'equity-uprise', path: '/' });
  assert.equal(route('https://equityuprise.com/action-network-cohorts.html', reg).kind, 'serve');
});
test('www and the legacy humanuprise doors answer one 301 to the owner, path and query kept', () => {
  assert.equal(route('https://www.equityuprise.com/a?b=1', reg).location, 'https://equityuprise.com/a?b=1');
  assert.equal(route('https://humanuprise.com/x', reg).location, 'https://equityuprise.com/x');
});
test('mccluster.org is a tenant: keeps /company and /news/, sends platform paths to the owner', () => {
  assert.deepEqual(route('https://mccluster.org/', reg), { kind: 'serve', tenant: 'mccluster', path: '/company' });
  assert.equal(route('https://mccluster.org/news/post-1', reg).kind, 'serve');
  assert.deepEqual(route('https://mccluster.org/onboard.html?x=1', reg), { kind: 'redirect', status: 301, tenant: 'mccluster', location: 'https://equityuprise.com/onboard.html?x=1' });
});
test("matthew.mccluster.org stays Matthew's tenant and keeps every path", () => {
  assert.deepEqual(route('https://matthew.mccluster.org/', reg), { kind: 'serve', tenant: 'matthew', path: '/index.html' });
  assert.equal(route('https://matthew.mccluster.org/listen.html', reg).kind, 'serve');
});
test('unknown hosts pass through untouched', () => {
  assert.equal(route('https://api.mccluster.org/v1', reg).kind, 'pass');
});
