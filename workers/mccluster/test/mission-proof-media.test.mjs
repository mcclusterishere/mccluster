/* The reviewer route that signs a member's uploaded mission proof.
   Only the owner desk may ask; the file must be the one on the proof and
   belong to the member who submitted it. Driven against a fake Supabase. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const PROOF = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fake({ admin = true, owner = MEMBER } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push(u);
    const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (u.endsWith('/auth/v1/user')) return ok({ id: 'reviewer' });
    if (u.includes('/rpc/eu_is_admin')) return ok(admin);
    if (u.includes('/action_proofs')) return ok([{ id: PROOF, metadata: { asset_id: ASSET, media_type: 'video' }, assignment_id: '44444444-4444-4444-8444-444444444444' }]);
    if (u.includes('/action_mission_assignments')) return ok([{ m_uid: MEMBER }]);
    if (u.includes('/network_media_assets')) return ok([{ id: ASSET, bucket_id: 'mnet-media', object_path: 'm/clip one.mp4', owner_m_uid: owner, media_type: 'video', mime_type: 'video/mp4' }]);
    if (u.includes('/storage/v1/object/sign/')) return ok({ signedURL: '/object/sign/mnet-media/m/clip%20one.mp4?token=t' });
    return ok([]);
  };
  return calls;
}
const ask = () => handlePlatformApi(new Request(`https://api.test/v1/mnet/missions/proofs/${PROOF}/media`, { headers: { authorization: 'Bearer user' } }), ENV);

test('the owner desk gets a short-lived link to the uploaded proof', async () => {
  const calls = fake();
  const res = await ask();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.url, 'https://db.test/storage/v1/object/sign/mnet-media/m/clip%20one.mp4?token=t');
  assert.equal(body.expires_in, 900);
  assert.ok(calls.some((c) => c.includes('/storage/v1/object/sign/mnet-media/m/clip%20one.mp4')));
});

test('anyone who is not the desk is told there is nothing there', async () => {
  const calls = fake({ admin: false });
  assert.equal((await ask()).status, 404);
  assert.ok(!calls.some((c) => c.includes('/storage/')), 'nothing is signed');
});

test('a file that is not the submitter\'s own is never signed', async () => {
  const calls = fake({ owner: '55555555-5555-4555-8555-555555555555' });
  assert.equal((await ask()).status, 404);
  assert.ok(!calls.some((c) => c.includes('/storage/')));
});
