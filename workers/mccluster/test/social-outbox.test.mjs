/* The Instagram outbox: private uploads, drafts the owner approves, cancel
   before Meta has the post, and a connection check that asks Meta itself.
   Driven against a fake Supabase and a fake Graph API. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSocialRequest } from '../src/social/router.js';
import { processInstagramPublishQueue } from '../src/social/meta.js';

const ORG = '123e4567-e89b-42d3-a456-426614174000';
const ACCOUNT = '223e4567-e89b-42d3-a456-426614174000';
const JOB = '323e4567-e89b-42d3-a456-426614174000';
const USER = { id: 'user-1' };
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', META_GRAPH_API_VERSION: 'v26.0' };
const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

function fake({ role = 'owner', moved = [{ id: JOB, state: 'queued' }], token = null, graph = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m, body: init.body ? JSON.parse(init.body) : null });
    if (u.includes('/org_members?')) return ok([{ org_id: ORG, role }]);
    if (u.includes('/social_accounts?')) return ok([{ id: ACCOUNT, org_id: ORG, platform: 'instagram', external_account_id: 'ig-1' }]);
    if (u.includes('/org_channels?')) return ok(token ? [{ token_env: 'SOCIAL_IG_TEST_ACCESS_TOKEN', secret_id: null, account_id: 'ig-1' }] : []);
    if (u.includes('/storage/v1/object/upload/sign/')) return ok({ url: '/object/upload/sign/social-outbox/x?token=t' });
    if (u.includes('/storage/v1/object/sign/')) return ok({ signedURL: '/object/sign/social-outbox/x?token=dl' });
    if (u.includes('/social_publish_jobs') && m === 'POST') return ok([{ id: JOB, ...JSON.parse(init.body) }], 201);
    if (u.includes('/social_publish_jobs') && m === 'PATCH') return ok(moved);
    if (u.includes('graph.facebook.com')) return graph ? graph(u, init) : ok({ error: { message: 'no graph' } }, 400);
    return ok([]);
  };
  return calls;
}
const req = (path, method = 'GET', body) => new Request(`https://api.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const run = async (...a) => { try { return { data: await handleSocialRequest(req(...a), { ...ENV, SOCIAL_IG_TEST_ACCESS_TOKEN: 'tok' }, USER) }; } catch (error) { return { error }; } };
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

test('a draft is saved as a draft, with its private upload, and is never queued', async () => {
  const calls = fake();
  const { data } = await run('/v1/social/publish', 'POST', { org_id: ORG, account_id: ACCOUNT, storage_path: `${ORG}/a.mp4`, caption: 'hi', publish_mode: 'reel', draft: true, drafted_by: 'claude' });
  assert.equal(data.publish_job.state, 'draft');
  const insert = calls.find((c) => c.u.includes('/social_publish_jobs') && c.m === 'POST').body;
  assert.equal(insert.payload.storage_path, `${ORG}/a.mp4`);
  assert.equal(insert.payload.drafted_by, 'claude');
});

test('a post without draft still goes straight to the queue', async () => {
  fake();
  const { data } = await run('/v1/social/publish', 'POST', { org_id: ORG, account_id: ACCOUNT, storage_path: `${ORG}/a.mp4`, publish_mode: 'reel' });
  assert.equal(data.publish_job.state, 'queued');
});

test('an upload outside this org\'s folder is refused', async () => {
  fake();
  const other = '999e4567-e89b-42d3-a456-426614174000';
  for (const p of [`${other}/a.mp4`, `${ORG}/../${other}/a.mp4`]) {
    const { error } = await run('/v1/social/publish', 'POST', { org_id: ORG, account_id: ACCOUNT, storage_path: p });
    assert.equal(error?.status, 400, p);
  }
});

test('a caption over Instagram\'s 2,200 characters is refused', async () => {
  fake();
  const { error } = await run('/v1/social/publish', 'POST', { org_id: ORG, account_id: ACCOUNT, video_url: 'https://x/v.mp4', caption: 'a'.repeat(2201) });
  assert.equal(error?.status, 400);
});

test('an upload link is signed into the org\'s own private folder, for videos only', async () => {
  fake();
  const { data } = await run('/v1/social/uploads', 'POST', { org_id: ORG, mime_type: 'video/mp4', byte_size: 1000 });
  assert.ok(data.storage_path.startsWith(`${ORG}/`) && data.storage_path.endsWith('.mp4'));
  assert.equal(data.upload_url, 'https://db.test/storage/v1/object/upload/sign/social-outbox/x?token=t');
  assert.equal((await run('/v1/social/uploads', 'POST', { org_id: ORG, mime_type: 'text/html', byte_size: 10 })).error?.status, 400);
  assert.equal((await run('/v1/social/uploads', 'POST', { org_id: ORG, mime_type: 'video/mp4', byte_size: 524288001 })).error?.status, 413);
});

test('only the owner uploads, approves or cancels', async () => {
  fake({ role: 'staff' });
  assert.equal((await run('/v1/social/uploads', 'POST', { org_id: ORG, mime_type: 'video/mp4', byte_size: 1 })).error?.status, 403);
  assert.equal((await run(`/v1/social/publish/${JOB}/approve`, 'POST', { org_id: ORG })).error?.status, 403);
  assert.equal((await run(`/v1/social/publish/${JOB}/cancel`, 'POST', { org_id: ORG })).error?.status, 403);
});

test('approve only moves a draft, and says so when it is not one', async () => {
  const calls = fake();
  const { data } = await run(`/v1/social/publish/${JOB}/approve`, 'POST', { org_id: ORG });
  assert.equal(data.publish_job.state, 'queued');
  const patch = calls.find((c) => c.m === 'PATCH');
  assert.match(patch.u, /state=eq\.draft/);
  assert.match(patch.u, new RegExp(`org_id=eq\\.${ORG}`));
  fake({ moved: [] });
  assert.equal((await run(`/v1/social/publish/${JOB}/approve`, 'POST', { org_id: ORG })).error?.status, 409);
});

test('cancel cannot pull back a post Meta already has', async () => {
  const calls = fake({ moved: [{ id: JOB, state: 'cancelled' }] });
  await run(`/v1/social/publish/${JOB}/cancel`, 'POST', { org_id: ORG });
  assert.match(calls.find((c) => c.m === 'PATCH').u, /state=in\.\(draft,queued\)&external_creation_id=is\.null/);
});

test('the connection check reports a missing key without calling Meta', async () => {
  const calls = fake({ token: false });
  const { data } = await run(`/v1/social/accounts/${ACCOUNT}/check?org_id=${ORG}`);
  assert.equal(data.connected, false);
  assert.equal(data.reason, 'no_key');
  assert.ok(!calls.some((c) => c.u.includes('graph.facebook.com')));
});

test('the connection check asks Meta and reports the day\'s allowance', async () => {
  fake({ token: true, graph: (u) => u.includes('content_publishing_limit') ? ok({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] }) : ok({ username: 'mcclusterishere', followers_count: 10, media_count: 5 }) });
  const { data } = await run(`/v1/social/accounts/${ACCOUNT}/check?org_id=${ORG}`);
  assert.deepEqual([data.connected, data.username, data.quota_used, data.quota_total], [true, 'mcclusterishere', 3, 100]);
});

test('the connection check passes on Meta\'s refusal, such as an expired key', async () => {
  fake({ token: true, graph: () => ok({ error: { message: 'Error validating access token: Session has expired' } }, 400) });
  const { data } = await run(`/v1/social/accounts/${ACCOUNT}/check?org_id=${ORG}`);
  assert.equal(data.connected, false);
  assert.match(data.message, /expired/);
});

test('the publisher hands Meta a signed link to the private upload', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ u, body: init.body });
    if (u.endsWith('/rpc/claim_social_publish_jobs')) return ok([{ id: JOB, org_id: ORG, account_id: ACCOUNT, publish_mode: 'reel', state: 'queued', attempts: 0, payload: { storage_path: `${ORG}/a.mp4`, caption: 'hi' } }]);
    if (u.includes('/social_accounts?')) return ok([{ id: ACCOUNT, org_id: ORG, platform: 'instagram', external_account_id: 'ig-1' }]);
    if (u.includes('/org_channels?')) return ok([{ token_env: 'SOCIAL_IG_TEST_ACCESS_TOKEN', secret_id: null, account_id: 'ig-1' }]);
    if (u.includes('/storage/v1/object/sign/social-outbox/')) return ok({ signedURL: '/object/sign/social-outbox/a.mp4?token=dl' });
    if (u.includes('graph.facebook.com')) return ok({ id: 'container-1' });
    return ok([]);
  };
  const out = await processInstagramPublishQueue({ ...ENV, SOCIAL_IG_TEST_ACCESS_TOKEN: 'tok' });
  assert.equal(out.results[0].state, 'processing');
  const media = calls.find((c) => c.u.includes('graph.facebook.com') && c.u.includes('/media'));
  assert.equal(new URLSearchParams(media.body).get('video_url'), 'https://db.test/storage/v1/object/sign/social-outbox/a.mp4?token=dl');
});
