// The travel desk's owner routes compare a caller key with OWNER_KEY. With the
// secret unset, the empty string used to equal the empty secret, so anyone
// sending no key was the owner. An unset key is now a 503, never a match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../workers/travel-quote.js', import.meta.url), 'utf8');
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function kv() {
  const store = new Map();
  return { store, async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); } };
}

const call = (env, path, { method = 'POST', body, key } = {}) => worker.fetch(new Request('https://travel.test' + path, {
  method,
  headers: { 'content-type': 'application/json', ...(key !== undefined ? { authorization: 'Bearer ' + key } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body)
}), env);

test('an unset or empty OWNER_KEY refuses every owner route with 503', async () => {
  for (const OWNER_KEY of [undefined, '']) {
    const env = { TRAVEL: kv(), OWNER_KEY };
    const routes = [
      ['/api/travel/base', { method: 'POST', body: { base: 'ga' } }],
      ['/api/travel/base', { method: 'POST', body: { base: 'ga', key: '' }, key: '' }],
      ['/api/travel/requests', { method: 'GET' }],
      ['/api/travel/profile', { method: 'POST', body: {} }],
      ['/api/travel/approve', { method: 'POST', body: {} }],
      ['/api/travel/purchase', { method: 'POST', body: {} }],
      ['/api/travel/pay', { method: 'POST', body: {} }]
    ];
    for (const [path, init] of routes) {
      const res = await call(env, path, init);
      assert.equal(res.status, 503, `${path} with OWNER_KEY=${JSON.stringify(OWNER_KEY)}`);
    }
    assert.equal(env.TRAVEL.store.has('base'), false, 'nothing was written');
  }
});

test('a configured OWNER_KEY still admits the owner and refuses everyone else', async () => {
  const env = { TRAVEL: kv(), OWNER_KEY: 'owner-secret' };
  assert.equal((await call(env, '/api/travel/base', { body: { base: 'ga' } })).status, 403);
  assert.equal((await call(env, '/api/travel/base', { body: { base: 'ga' }, key: 'wrong-secret' })).status, 403);
  const ok = await call(env, '/api/travel/base', { body: { base: 'ga' }, key: 'owner-secret' });
  assert.equal(ok.status, 200);
  assert.equal(env.TRAVEL.store.get('base'), 'ga');
});
