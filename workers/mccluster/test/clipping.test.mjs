/* Clipping in the Worker: the platform reads that settlement pays on, the
   cron that carries them to the database, and the member routes. Supabase
   and the Graph API are mocked; the database's own behaviour is covered by
   supabase/tests/action_clipping_regression.sql. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { platformStatus, readClip, isGone } from '../src/clipping/platforms.js';
import { runClipping } from '../src/clipping/runner.js';
import { handleClippingRequest } from '../src/clipping/router.js';
import { linkRows } from './support/auth-links.mjs';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SOCIAL_IG_CLIPPER_ACCESS_TOKEN: 'ig-token' };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const USER = { id: '11111111-1111-4111-8111-111111111111' };
const M_UID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const MISSION = '44444444-4444-4444-8444-444444444444';

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    return handler(String(url), init);
  };
  return Promise.resolve().then(() => fn(calls)).finally(() => { globalThis.fetch = original; });
}

const graphMedia = (url) => {
  if (url.includes('/IGUSER1/media?')) return json({ data: [{ id: '18000000000000001', shortcode: 'ABCdef12345', caption: 'The hook #pullup', timestamp: '2026-10-06T12:00:00+0000', like_count: 2000, comments_count: 100 }], paging: {} });
  if (url.includes('/18000000000000001/insights?metric=views')) return json({ data: [{ values: [{ value: 20000 }] }] });
  if (url.includes('/18000000000000001/insights?metric=shares')) return json({ data: [{ values: [{ value: 50 }] }] });
  if (url.includes('/18000000000000001/insights')) return json({ data: [{ values: [{ value: 0 }] }] });
  if (url.includes('/18000000000000001?fields=')) return json({ id: '18000000000000001', like_count: 2000, comments_count: 100, caption: 'The hook #pullup', timestamp: '2026-10-06T12:00:00+0000' });
  return null;
};

const job = (over = {}) => ({
  submission_id: 's1', status: 'submitted', platform: 'instagram', external_media_id: 'ABCdef12345', m_uid: M_UID,
  accounts: [{ id: ACCOUNT, external_account_id: 'IGUSER1', handle: 'clipperk', credential_ref: 'env:SOCIAL_IG_CLIPPER_ACCESS_TOKEN' }],
  ...over
});

test('only Instagram is paid for; YouTube and TikTok say why they are off', () => {
  const s = Object.fromEntries(platformStatus().map((p) => [p.platform, p]));
  assert.equal(s.instagram.enabled, true);
  assert.equal(s.youtube.enabled, false);
  assert.match(s.youtube.reason, /cannot be verified yet/);
  assert.equal(s.tiktok.enabled, false);
});

test('a clip is read from the account that owns it, with its real metrics', async () => {
  await withFetch((url) => graphMedia(url) || json({}, 404), async (calls) => {
    const read = await readClip(env, job(), async () => null);
    assert.deepEqual({ ...read, raw: undefined }, {
      available: true, found: true, live: true, owner_account_id: 'IGUSER1', platform_media_id: '18000000000000001',
      caption: 'The hook #pullup', posted_at: '2026-10-06T12:00:00+0000', views: 20000, likes: 2000, comments: 100, shares: 50, raw: undefined
    });
    assert.ok(calls.every((c) => c.url.startsWith('https://graph.facebook.com/')), 'only the platform is asked');
  });
});

test('nothing is paid on trust: unavailable platforms and missing credentials wait', async () => {
  assert.equal((await readClip(env, job({ platform: 'youtube' }), async () => null)).available, false);
  assert.equal((await readClip(env, job({ platform: 'tiktok' }), async () => null)).available, false);
  const noCred = await readClip(env, job({ accounts: [{ external_account_id: 'IGUSER1', credential_ref: null }] }), async () => null);
  assert.equal(noCred.available, false);
  assert.match(noCred.reason, /desk connects it/);
});

test('a deleted post reads as gone, a clip on someone else\'s account as not found', async () => {
  const gone = Object.assign(new Error('x'), { status: 400, detail: { error: { code: 100, error_subcode: 33, message: 'Object does not exist' } } });
  assert.equal(isGone(gone), true);
  assert.equal(isGone(Object.assign(new Error('rate'), { status: 400, detail: { error: { code: 4 } } })), false, 'a rate limit is not a deletion');
  await withFetch((url) => (url.includes('/18000000000000001?fields=')
    ? json({ error: { code: 100, error_subcode: 33, message: 'Unsupported get request. Object with ID does not exist' } }, 400)
    : json({ data: [] })), async () => {
    const read = await readClip(env, job({ status: 'tracking', platform_media_id: '18000000000000001', post_account: 'IGUSER1' }), async () => null);
    assert.deepEqual(read, { available: true, found: false, live: false });
  });
  await withFetch((url) => (url.includes('/media?') ? json({ data: [{ id: '9', shortcode: 'SOMEONEELSE' }], paging: {} }) : json({})), async () => {
    const read = await readClip(env, job(), async () => null);
    assert.deepEqual(read, { available: true, found: false, live: false }, 'not in the clipper\'s own media: not theirs');
  });
});

test('the cron carries each read to the database and lets the database decide', async () => {
  await withFetch((url, init) => {
    const g = graphMedia(url);
    if (g) return g;
    if (url.endsWith('/rpc/clip_work_due')) return json([job(), job({ submission_id: 's2', status: 'tracking', platform_media_id: '18000000000000001', post_account: 'IGUSER1' })]);
    if (url.endsWith('/rpc/clip_record_verification')) return json({ status: 'tracking' });
    if (url.endsWith('/rpc/clip_record_metrics')) return json({ status: 'tracking' });
    if (url.endsWith('/rpc/clip_release_due')) return json({ released: 2 });
    if (url.endsWith('/rpc/clip_attribute_conversions')) return json({ conversions: 1 });
    return json({}, 404);
  }, async (calls) => {
    const out = await runClipping(env, { now: Date.parse('2026-10-08T00:00:00Z') });
    assert.equal(out.checked, 2);
    assert.equal(out.released, 2);
    const verify = calls.find((c) => c.url.endsWith('/rpc/clip_record_verification'));
    assert.equal(verify.body.p_submission, 's1');
    assert.equal(verify.body.p.views, 20000, 'the platform\'s number, not anyone\'s report');
    const metrics = calls.find((c) => c.url.endsWith('/rpc/clip_record_metrics'));
    assert.equal(metrics.body.p_submission, 's2');
    const conv = calls.find((c) => c.url.endsWith('/rpc/clip_attribute_conversions'));
    assert.equal(conv.body.p_since, '2026-10-06T00:00:00.000Z');
  });
});

test('before the migration is live the cron stands down quietly', async () => {
  await withFetch(() => json({ code: 'PGRST202', message: 'Could not find the function' }, 404), async () => {
    assert.deepEqual(await runClipping(env), { skipped: 'not provisioned' });
  });
});

test('account verification needs the desk\'s credential and the member\'s code in the bio', async () => {
  const request = new Request(`https://api.example/v1/clips/accounts/${ACCOUNT}/verify`, { method: 'POST' });
  const url = new URL(request.url);
  let account = { id: ACCOUNT, platform: 'instagram', handle: 'clipperk', credential_ref: null, owner_verified_at: null, owner_verification: { code: 'MCC-1A2B3C4D' } };
  let bio = 'clips daily';
  const handler = (u) => {
    if (u.includes('/m_auth_user_links?')) return json([{ m_uid: M_UID }]);
    if (u.includes('/social_accounts?')) { assert.match(u, new RegExp(`owner_m_uid=eq.${M_UID}`), 'only your own account'); return json([account]); }
    if (u.includes('me/accounts')) return json({ data: [{ instagram_business_account: { id: 'IGUSER1', username: 'ClipperK', biography: bio } }] });
    if (u.endsWith('/rpc/clip_account_mark_verified')) return json({ verified: true });
    return json({}, 404);
  };
  await withFetch(handler, async () => {
    await assert.rejects(handleClippingRequest(request, env, null, url), { status: 401 });
    let out = await handleClippingRequest(request, env, USER, url);
    assert.equal(out.verified, false);
    assert.match(out.reason, /desk to connect/);
    account = { ...account, credential_ref: 'env:SOCIAL_IG_CLIPPER_ACCESS_TOKEN' };
    out = await handleClippingRequest(request, env, USER, url);
    assert.match(out.reason, /MCC-1A2B3C4D in your bio/);
    bio = 'clips daily MCC-1A2B3C4D';
  });
  await withFetch(handler, async (calls) => {
    const out = await handleClippingRequest(request, env, USER, url);
    assert.equal(out.verified, true);
    const mark = calls.find((c) => c.url.endsWith('/rpc/clip_account_mark_verified'));
    assert.deepEqual(mark.body, { p_account: ACCOUNT, p: { external_account_id: 'IGUSER1', handle: 'ClipperK' } });
  });
});

/* A campaign's source files are its creator's own uploads, and the creator can
   still edit those network_media_assets rows after launch. A clipper is only
   ever given a link to mnet-media/<the creator's auth user id>/<uuid>-<name>;
   a row that says anything else is reported unavailable and never signed. */
const CREATOR = '99999999-9999-4999-8999-999999999999';
const CREATOR_AUTH = '66666666-6666-4666-8666-666666666666';
const STRANGER_AUTH = '77777777-7777-4777-8777-777777777777';
const HOOK = `${CREATOR_AUTH}/88888888-8888-4888-8888-888888888888-hook.mp3`;
function sourceFiles({ file = {}, links = [{ auth_user_id: CREATOR_AUTH, m_uid: CREATOR }], claimed = () => true } = {}) {
  return (u, init) => {
    if (u.includes('/m_auth_user_links?') && u.includes('select=auth_user_id')) return json(linkRows(u, links));
    if (u.includes('/m_auth_user_links?')) return json([{ m_uid: M_UID }]);
    if (u.includes('/action_clip_claims?')) return json(claimed() ? [{ id: 'c1' }] : []);
    if (u.includes('/action_clip_assets?')) return json([
      { id: 'a1', kind: 'audio', label: 'Hook stem', network_media_asset_id: 'f1', sort: 0 },
      { id: 'a2', kind: 'moment', label: 'The hook', start_ms: 42000, end_ms: 58000, sort: 1 }]);
    if (u.includes('/network_media_assets?')) return json([{ id: 'f1', bucket_id: 'mnet-media', object_path: HOOK, owner_m_uid: CREATOR, media_type: 'audio', mime_type: 'audio/mpeg', ...file }]);
    if (u.includes('/storage/v1/object/sign/')) {
      // Storage signs whatever a service-role caller names, in any bucket: the Worker is the only gate.
      const bucket = u.split('/storage/v1/object/sign/')[1];
      return json((JSON.parse(init.body).paths || []).map((path) => ({ path, signedURL: `/object/sign/${bucket}/${path}?token=t` })));
    }
    return json({}, 404);
  };
}

test('source files go only to clippers with an active claim, as expiring links', async () => {
  const request = new Request(`https://api.example/v1/clips/campaigns/${MISSION}/assets`);
  const url = new URL(request.url);
  let claimed = false;
  await withFetch(sourceFiles({ claimed: () => claimed }), async (calls) => {
    await assert.rejects(handleClippingRequest(request, env, USER, url), { status: 403 });
    claimed = true;
    const out = await handleClippingRequest(request, env, USER, url);
    assert.equal(out.expires_in, 900);
    assert.equal(out.assets[0].url, `https://db.example/storage/v1/object/sign/mnet-media/${HOOK}?token=t`);
    assert.equal(out.assets[1].url, undefined, 'a moment is a time range, not a file');
    const signs = calls.filter((c) => c.url.includes('/storage/v1/object/sign/'));
    assert.equal(signs.length, 1);
    assert.equal(signs[0].url, 'https://db.example/storage/v1/object/sign/mnet-media');
    assert.deepEqual(signs[0].body.paths, [HOOK]);
  });
});

test('a source file row repointed at another bucket, prefix or path is unavailable and never signed', async () => {
  const request = new Request(`https://api.example/v1/clips/campaigns/${MISSION}/assets`);
  const url = new URL(request.url);
  const forged = [
    { bucket_id: 'mcc-gated-audio', object_path: 'albums/i-am-here/01-master.wav' },
    { bucket_id: 'creator-masters', object_path: HOOK },
    { bucket_id: 'mnet-media', object_path: `${STRANGER_AUTH}/88888888-8888-4888-8888-888888888888-hook.mp3` },
    { bucket_id: 'mnet-media', object_path: 'm/hook.mp3' },
    { bucket_id: 'mnet-media', object_path: `${CREATOR_AUTH}/../${STRANGER_AUTH}/88888888-8888-4888-8888-888888888888-hook.mp3` },
    { owner_m_uid: undefined },
  ];
  for (const file of forged) {
    await withFetch(sourceFiles({ file }), async (calls) => {
      const out = await handleClippingRequest(request, env, USER, url);
      assert.equal(out.assets[0].url, undefined, JSON.stringify(file));
      assert.equal(out.assets[0].unavailable, true);
      assert.deepEqual(calls.filter((c) => c.url.includes('/storage/v1/object/sign/')), [], 'nothing is signed');
    });
  }
  // the prefix is a real auth user, but not one linked to the file's owner
  await withFetch(sourceFiles({ links: [{ auth_user_id: CREATOR_AUTH, m_uid: M_UID }] }), async (calls) => {
    const out = await handleClippingRequest(request, env, USER, url);
    assert.equal(out.assets[0].unavailable, true);
    assert.deepEqual(calls.filter((c) => c.url.includes('/storage/v1/object/sign/')), []);
  });
});
