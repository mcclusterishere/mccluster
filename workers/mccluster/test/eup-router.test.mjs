import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEup, EUP_PREFIX, EUP_SECTIONS, EUP_MEMBER_LEAGUE_PREFIX } from '../src/eup/router.js';

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

test('modules is one of the sections: listed in the index, and its commands are owner-only before anything is read', async () => {
  assert.deepEqual([...EUP_SECTIONS], ['overview', 'league', 'civic', 'companies', 'sources', 'modules']);
  let fetched = 0;
  const fetchImpl = async () => { fetched += 1; return Response.json({}); };
  const command = (path, body) => req(`${EUP_PREFIX}/modules/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  for (const [path, body] of [['league/install', { idempotency_key: 'router-key-0001', reason: 'Test fixture.' }], ['league/state', { idempotency_key: 'router-key-0002', reason: 'Test fixture.', state: 'enabled', expected_revision: 0 }]]) {
    const a = await handleEup(command(path, body), env, { requireHouseOwner: anon, fetchImpl });
    assert.equal(a.status, 401); assert.equal((await a.json()).reason, 'authentication_required');
    const d = await handleEup(command(`${path}?admin=true`, { ...body, actor: '11111111-1111-4111-8111-111111111111' }), env, { requireHouseOwner: denied, fetchImpl });
    assert.equal(d.status, 403); assert.equal((await d.json()).reason, 'owner_required'); assert.equal(d.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(fetched, 0, 'a refused caller reaches neither the store nor the body parser');
});

// --- the one member branch: /v1/eup/member/league ------------------------------------------------------
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const storeEnv = { ...env, SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
const counted = () => {
  const seen = { owner: 0, session: 0, fetched: 0 };
  return {
    seen,
    requireHouseOwner: async () => { seen.owner += 1; throw Object.assign(new Error('McCluster house owner access required'), { status: 403 }); },
    authUser: async (request) => { seen.session += 1; return request.headers.get('authorization') === 'Bearer fixture-member-session' ? { id: MEMBER_ID } : null; },
    fetchImpl: async () => { seen.fetched += 1; return Response.json({ code: 'EU011', message: 'synthetic' }, { status: 400 }); }
  };
};

test('the League member branch is the one exception: it never asks for a house owner, and nothing else under /v1/eup opens without one', async () => {
  assert.equal(EUP_MEMBER_LEAGUE_PREFIX, '/v1/eup/member/league');
  assert.ok(!EUP_SECTIONS.includes('member'), 'the member branch is not an owner section');
  for (const path of [EUP_MEMBER_LEAGUE_PREFIX, `${EUP_MEMBER_LEAGUE_PREFIX}/`, `${EUP_MEMBER_LEAGUE_PREFIX}/uploads/0a000000-0000-4000-8000-000000000008/url`]) {
    const c = counted();
    const r = await handleEup(req(path, { headers: { authorization: 'Bearer fixture-member-session' } }), storeEnv, { ...c, fetchImpl: c.fetchImpl });
    assert.equal(r.status, 404, path); assert.deepEqual(await r.json(), { ok: false, error: 'Not available', reason: 'not_available' });
    assert.deepEqual([c.seen.owner, c.seen.session], [0, 1], `${path}: the session check, never the owner check`);
  }
  /* Everything else under the prefix, the member root included, stays owner-only. */
  for (const path of ['/v1/eup/member', '/v1/eup/member/', '/v1/eup/member/environment', '/v1/eup/member/leagues', '/v1/eup/member/league-x', '/v1/eup/memberleague']) {
    const c = counted();
    const r = await handleEup(req(path, { headers: { authorization: 'Bearer fixture-member-session' } }), storeEnv, { ...c, fetchImpl: c.fetchImpl });
    assert.equal(r.status, 403, path); assert.equal((await r.json()).reason, 'owner_required');
    assert.deepEqual([c.seen.owner, c.seen.session, c.seen.fetched], [1, 0, 0], path);
  }
});

test('the member branch: no bearer is 401 before anything; a hidden tab, an admin parameter or a header is not identity; answers vary on Origin and Authorization', async () => {
  for (const init of [{}, { headers: { 'x-mcc-admin': 'true', 'x-we-user-id': MEMBER_ID, 'x-we-role': 'owner' } }]) {
    const c = counted();
    const r = await handleEup(req(`${EUP_MEMBER_LEAGUE_PREFIX}?admin=true&actor=${MEMBER_ID}`, init), storeEnv, { ...c, fetchImpl: c.fetchImpl });
    assert.equal(r.status, 401); assert.equal((await r.json()).reason, 'authentication_required');
    assert.deepEqual([c.seen.owner, c.seen.session, c.seen.fetched], [0, 0, 0], 'nothing was asked');
    assert.equal(r.headers.get('cache-control'), 'private, no-store'); assert.equal(r.headers.get('vary'), 'Origin, Authorization');
  }
  const c = counted();
  const unknown = await handleEup(req(EUP_MEMBER_LEAGUE_PREFIX, { headers: { authorization: 'Bearer someone-else' } }), storeEnv, { ...c, fetchImpl: c.fetchImpl });
  assert.equal(unknown.status, 401); assert.deepEqual([c.seen.session, c.seen.fetched], [1, 0]);
  /* The owner sections keep their answer headers. */
  const o = await handleEup(req(EUP_PREFIX), env, { requireHouseOwner: owner });
  assert.equal(o.headers.get('cache-control'), 'private, no-store');
});
