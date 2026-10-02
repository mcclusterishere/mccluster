/* The Fashion Bureau of Investigation: a public board, case files that wait
   for the owner, votes that fit the case, and no faces unless you turned
   yourself in. Driven against a fake Supabase. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi, fbiVerdict } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const MUID = '22222222-2222-4222-8222-222222222222';
const OTHER = '44444444-4444-4444-8444-444444444444';
const CASE = '33333333-3333-4333-8333-333333333333';
const IMG = '55555555-5555-4555-8555-555555555555';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s });

function fake({ signedIn = true, admin = false, assets = [{ id: IMG, media_type: 'image' }], caseRow = { id: CASE, kind: 'sighting', reporter_m_uid: OTHER } } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m, body: init.body ? JSON.parse(init.body) : null, prefer: init.headers?.prefer });
    if (u.endsWith('/auth/v1/user')) return signedIn ? ok({ id: 'user-1' }) : ok({}, 401);
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID }]);
    if (u.endsWith('/rpc/eu_is_admin')) return ok(admin);
    if (u.includes('/fbi_board?')) return ok([{ id: CASE, kind: 'sighting', title: 'Fake lows', media_asset_ids: [IMG], legit: 1, cap: 6, guilty: 0, acquitted: 0 }]);
    if (u.includes('/network_media_assets?id=in.') && u.includes('select=id,bucket_id')) return ok([{ id: IMG, bucket_id: 'mnet-media', object_path: 'u/a.jpg' }]);
    if (u.includes('/network_media_assets?')) return ok(assets);
    if (u.includes('/storage/v1/object/sign/mnet-media')) return ok([{ path: 'u/a.jpg', signedURL: '/object/sign/mnet-media/u/a.jpg?token=t' }]);
    if (u.includes('/fbi_cases?id=') && m === 'GET') return ok(caseRow ? [caseRow] : []);
    if (u.includes('/fbi_cases') && m === 'POST') return ok([{ id: CASE }], 201);
    if (u.includes('/fbi_cases?id=') && m === 'PATCH') return ok([{ id: CASE, status: JSON.parse(init.body).status }]);
    return ok([]);
  };
  return calls;
}
const call = async (path, method = 'GET', body, auth = true) => {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = 'Bearer user';
  const req = new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  try { return await handlePlatformApi(req, ENV); }
  catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 }); }
};
const goodCase = { kind: 'sighting', title: 'Fake Travis lows on the 2 train', media_asset_ids: [IMG], no_faces_attested: true, city: 'Atlanta' };

test('the verdict waits for five votes and seven in ten agreeing', () => {
  assert.equal(fbiVerdict({ kind: 'sighting', cap: 3, legit: 1 }).verdict, 'under_investigation');
  assert.equal(fbiVerdict({ kind: 'sighting', cap: 6, legit: 1 }).verdict, 'cap');
  assert.equal(fbiVerdict({ kind: 'legit_check', cap: 1, legit: 9 }).verdict, 'legit');
  assert.equal(fbiVerdict({ kind: 'most_wanted', guilty: 8, acquitted: 2 }).verdict, 'guilty');
  assert.equal(fbiVerdict({ kind: 'most_wanted', guilty: 3, acquitted: 3 }).verdict, 'hung_jury');
});

test('the board is public, with signed photos and a verdict, and needs no sign-in', async () => {
  fake({ signedIn: false });
  const res = await call('/v1/fbi/board?kind=sighting', 'GET', null, false);
  assert.equal(res.status, 200);
  const { cases } = await res.json();
  assert.equal(cases[0].verdict, 'cap');
  assert.equal(cases[0].photos[0], 'https://db.test/storage/v1/object/sign/mnet-media/u/a.jpg?token=t');
  assert.equal(cases[0].my_vote, null);
});

test('filing a case needs a sign-in', async () => {
  fake({ signedIn: false });
  assert.equal((await call('/v1/fbi/cases', 'POST', goodCase)).status, 401);
});

test('a case waits for the owner: it is filed as pending', async () => {
  const calls = fake();
  const res = await call('/v1/fbi/cases', 'POST', goodCase);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).case.status, 'pending');
  const insert = calls.find((c) => c.u.includes('/fbi_cases') && c.m === 'POST').body;
  assert.equal(insert.reporter_m_uid, MUID);
  assert.equal(insert.status, undefined, 'the client cannot choose the status');
});

test('no faces: a case without the attestation is refused, unless you turned yourself in', async () => {
  fake();
  assert.equal((await call('/v1/fbi/cases', 'POST', { ...goodCase, no_faces_attested: false })).status, 400);
  assert.equal((await call('/v1/fbi/cases', 'POST', { ...goodCase, kind: 'sighting', self_surrender: true, no_faces_attested: false })).status, 400, 'only Most Wanted can be a surrender');
  assert.equal((await call('/v1/fbi/cases', 'POST', { kind: 'most_wanted', title: 'I wore socks with slides', media_asset_ids: [IMG], self_surrender: true })).status, 201);
});

test('photos must be your own images', async () => {
  fake({ assets: [] });
  assert.equal((await call('/v1/fbi/cases', 'POST', goodCase)).status, 400);
  fake({ assets: [{ id: IMG, media_type: 'video' }] });
  assert.equal((await call('/v1/fbi/cases', 'POST', goodCase)).status, 400);
});

test('a vote must fit the case, and nobody votes on their own case', async () => {
  fake();
  assert.equal((await call(`/v1/fbi/cases/${CASE}/vote`, 'POST', { vote: 'guilty' })).status, 400);
  const calls = fake();
  const res = await call(`/v1/fbi/cases/${CASE}/vote`, 'POST', { vote: 'cap' });
  assert.equal(res.status, 200);
  const write = calls.find((c) => c.u.includes('/fbi_votes') && c.m === 'POST');
  assert.match(write.prefer, /merge-duplicates/, 'changing your vote replaces it');
  fake({ caseRow: { id: CASE, kind: 'sighting', reporter_m_uid: MUID } });
  assert.equal((await call(`/v1/fbi/cases/${CASE}/vote`, 'POST', { vote: 'cap' })).status, 403);
});

test('only public cases take votes', async () => {
  const calls = fake({ caseRow: null });
  assert.equal((await call(`/v1/fbi/cases/${CASE}/vote`, 'POST', { vote: 'cap' })).status, 404);
  assert.match(calls.find((c) => c.u.includes('/fbi_cases?id=')).u, /status=eq\.public/);
});

test('the desk is the owner\'s alone, and approving publishes the case', async () => {
  fake({ admin: false });
  assert.equal((await call('/v1/fbi/desk')).status, 404);
  assert.equal((await call(`/v1/fbi/cases/${CASE}/review`, 'POST', { decision: 'public' })).status, 404);
  const calls = fake({ admin: true });
  const res = await call(`/v1/fbi/cases/${CASE}/review`, 'POST', { decision: 'public' });
  assert.equal(res.status, 200);
  const patch = calls.find((c) => c.m === 'PATCH').body;
  assert.equal(patch.status, 'public');
  assert.ok(patch.published_at);
});

test('a spam refusal from the database reaches the member as a 429', async () => {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return ok({ id: 'user-1' });
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID }]);
    if (u.includes('/network_media_assets?')) return ok([{ id: IMG, media_type: 'image' }]);
    if (u.includes('/fbi_cases')) return ok({ code: 'MN429', message: 'That is the limit for today: 10 case files a day.' }, 400);
    return ok([]);
  };
  const res = await call('/v1/fbi/cases', 'POST', goodCase);
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /10 case files a day/);
});
