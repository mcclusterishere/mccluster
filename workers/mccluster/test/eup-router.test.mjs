import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEup, EUP_PREFIX, EUP_SECTIONS } from '../src/eup/router.js';

const env = { ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const req = (path, init) => new Request(`https://api.mccluster.org${path}`, init);
const owner = async () => ({ id: '11111111-1111-4111-8111-111111111111' });
const denied = async () => { throw Object.assign(new Error('McCluster house owner access required'), { status: 403 }); };
const anon = async () => { throw Object.assign(new Error('Authentication required'), { status: 401 }); };

test('E=Up answers nothing outside its prefix', async () => {
  assert.equal(await handleEup(req('/v1/world/environment'), env, { requireHouseOwner: owner }), null);
});

test('every E=Up route is owner-only, private and no-store', async () => {
  for (const section of [...EUP_SECTIONS, '']) {
    const path = `${EUP_PREFIX}${section ? '/' + section : ''}`;
    const a = await handleEup(req(path), env, { requireHouseOwner: anon });
    assert.equal(a.status, 401); assert.equal((await a.json()).reason, 'authentication_required');
    const d = await handleEup(req(path), env, { requireHouseOwner: denied });
    assert.equal(d.status, 403); assert.equal((await d.json()).reason, 'owner_required');
    assert.equal(d.headers.get('cache-control'), 'private, no-store');
  }
  const none = await handleEup(req(`${EUP_PREFIX}/overview`), env, {});
  assert.equal(none.status, 503);
});

test('a hidden tab or admin parameter is not authorization', async () => {
  const r = await handleEup(req(`${EUP_PREFIX}/league?admin=true`, { headers: { 'x-mcc-admin': 'true' } }), env, { requireHouseOwner: denied });
  assert.equal(r.status, 403);
});

test('the owner gets the section index and unknown sections 404', async () => {
  const r = await handleEup(req(EUP_PREFIX), env, { requireHouseOwner: owner });
  assert.equal(r.status, 200); assert.deepEqual((await r.json()).sections, EUP_SECTIONS);
  const u = await handleEup(req(`${EUP_PREFIX}/halo`), env, { requireHouseOwner: owner });
  assert.equal(u.status, 404);
});
