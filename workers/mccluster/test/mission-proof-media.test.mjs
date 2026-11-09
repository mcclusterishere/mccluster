/* The reviewer routes that sign a member's uploaded mission proof.
   Only the owner desk may ask; the file must be the one on the proof, belong
   to the member who submitted it, and BE that member's own upload. The bucket
   and path on a network_media_assets row are written by the member (RLS lets
   an owner insert and update the row), so before anything is signed they are
   checked against the only place the media function ever puts an upload:
   mnet-media/<the member's auth user id>/<uuid>-<name>.
   Driven against a fake Supabase. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api.js';
import { linkRows } from './support/auth-links.mjs';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const PROOF = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const ASSIGNMENT = '44444444-4444-4444-8444-444444444444';
const STRANGER = '55555555-5555-4555-8555-555555555555';
const MEMBER_AUTH = '66666666-6666-4666-8666-666666666666'; // the auth user the member uploads as
const STRANGER_AUTH = '77777777-7777-4777-8777-777777777777';
const FILE = '88888888-8888-4888-8888-888888888888-clip-one.mp4';
const OBJECT = `${MEMBER_AUTH}/${FILE}`;
const LINKS = [{ auth_user_id: MEMBER_AUTH, m_uid: MEMBER }, { auth_user_id: STRANGER_AUTH, m_uid: STRANGER }];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fake({ admin = true, owner = MEMBER, bucket = 'mnet-media', objectPath = OBJECT, links = LINKS } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push(u);
    const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (u.endsWith('/auth/v1/user')) return ok({ id: 'reviewer' });
    if (u.includes('/rpc/eu_is_admin')) return ok(admin);
    if (u.includes('/action_proofs')) return ok([{ id: PROOF, metadata: { asset_id: ASSET, media_type: 'video' }, assignment_id: ASSIGNMENT }]);
    if (u.includes('/action_antisocial_levels')) return ok([{ assignment_id: ASSIGNMENT, media_asset_id: ASSET }]);
    if (u.includes('/action_mission_assignments')) return ok([{ m_uid: MEMBER }]);
    if (u.includes('/network_media_assets')) return ok([{ id: ASSET, bucket_id: bucket, object_path: objectPath, owner_m_uid: owner, media_type: 'video', mime_type: 'video/mp4' }]);
    if (u.includes('/m_auth_user_links')) return ok(linkRows(u, links));
    if (u.includes('/storage/v1/object/sign/')) return ok({ signedURL: `/object/sign/${u.split('/storage/v1/object/sign/')[1]}?token=t` });
    return ok([]);
  };
  return calls;
}
const get = (path) => handlePlatformApi(new Request(`https://api.test${path}`, { headers: { authorization: 'Bearer user' } }), ENV);
const ask = () => get(`/v1/mnet/missions/proofs/${PROOF}/media`);
const askLevel = () => get(`/v1/mnet/missions/antisocial/${ASSIGNMENT}/2/media`);
const signed = (calls) => calls.filter((c) => c.includes('/storage/v1/object/sign/'));
async function refused(ask_, calls) {
  const res = await ask_();
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Proof has no upload');
  assert.deepEqual(signed(calls), [], 'nothing is signed');
}

test('the owner desk gets a short-lived link to the uploaded proof', async () => {
  const calls = fake();
  const res = await ask();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.url, `https://db.test/storage/v1/object/sign/mnet-media/${OBJECT}?token=t`);
  assert.equal(body.expires_in, 900);
  assert.deepEqual(signed(calls), [`https://db.test/storage/v1/object/sign/mnet-media/${OBJECT}`], 'one link, to the member\'s own upload');
});

test('anyone who is not the desk is told there is nothing there', async () => {
  const calls = fake({ admin: false });
  assert.equal((await ask()).status, 404);
  assert.ok(!calls.some((c) => c.includes('/storage/')), 'nothing is signed');
});

test('a file that is not the submitter\'s own is never signed', async () => {
  const calls = fake({ owner: STRANGER });
  assert.equal((await ask()).status, 404);
  assert.ok(!calls.some((c) => c.includes('/storage/')));
});

test('an asset row repointed at another bucket is never signed', async () => {
  // The member edited their own row to name a paid master; the desk must not be shown it as their proof.
  await refused(ask, fake({ bucket: 'mcc-gated-audio', objectPath: 'albums/i-am-here/01-master.wav' }));
  // Even a path of the right shape is refused outside the upload bucket.
  await refused(ask, fake({ bucket: 'creator-masters', objectPath: OBJECT }));
  for (const bucket of ['MNET-MEDIA', 'mnet-media ', 'mnet-media/..', '', null]) await refused(ask, fake({ bucket }));
});

test('an asset row repointed at another member\'s upload prefix is never signed', async () => {
  await refused(ask, fake({ objectPath: `${STRANGER_AUTH}/${FILE}` }));
});

test('an upload prefix that is not linked to the submitting member is never signed', async () => {
  // the prefix belongs to an auth user linked to somebody else
  await refused(ask, fake({ links: [{ auth_user_id: MEMBER_AUTH, m_uid: STRANGER }] }));
  // or to nobody at all
  await refused(ask, fake({ links: [] }));
});

test('a path that is not the canonical <auth user>/<uuid>-<name> is never signed', async () => {
  const forged = [
    'm/clip one.mp4',
    `${MEMBER_AUTH}`,
    `${MEMBER_AUTH}/`,
    `${MEMBER_AUTH}/clip-one.mp4`,
    `${MEMBER_AUTH}/${FILE}/extra`,
    `${MEMBER_AUTH}/../${STRANGER_AUTH}/${FILE}`,
    `${MEMBER_AUTH}/sub/${FILE}`,
    `/${OBJECT}`,
    `${OBJECT}/`,
    `${OBJECT}?download=1`,
    `${OBJECT}#x`,
    `${MEMBER_AUTH}%2F${FILE}`,
    `${MEMBER_AUTH}/${FILE} `,
    `${MEMBER_AUTH}/${FILE}\n`,
    `${OBJECT}\n${STRANGER_AUTH}/${FILE}`,
    '',
  ];
  for (const objectPath of forged) await refused(ask, fake({ objectPath }));
  // a row that carries no usable path at all (undefined would fall back to the fake's default, so it is not listed)
  for (const objectPath of [null, 7, {}, [OBJECT]]) await refused(ask, fake({ objectPath }));
});

test('Anti-Social level clips follow the same rule', async () => {
  const calls = fake();
  const res = await askLevel();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.url, `https://db.test/storage/v1/object/sign/mnet-media/${OBJECT}?token=t`);
  assert.equal(body.expires_in, 900);
  assert.deepEqual(signed(calls), [`https://db.test/storage/v1/object/sign/mnet-media/${OBJECT}`]);

  await refused(askLevel, fake({ bucket: 'mcc-gated-audio', objectPath: 'albums/i-am-here/01-master.wav' }));
  await refused(askLevel, fake({ objectPath: `${STRANGER_AUTH}/${FILE}` }));
  await refused(askLevel, fake({ objectPath: 'm/clip one.mp4' }));
  await refused(askLevel, fake({ links: [] }));
  await refused(askLevel, fake({ owner: STRANGER }));
});
