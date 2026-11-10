/* The Instagram publisher signs a job's uploaded video only when the job names
   a plain object path inside its own organization's outbox folder.

   An upload is issued as <org id>/<uuid>.<ext> (src/social/router.js). One
   test says whether a job names such an upload (src/social/meta.js,
   outboxPathFor). The publisher reads storage_path back from the job row
   later, with the service role, and applies it before it signs: a job that
   does not pass is not signed and fails like any other unpublishable job. The
   route that queues a job applies the same test, so a job the publisher would
   refuse is refused when it is made.

   The Storage double answers for whatever the request really reaches: the URL
   is parsed the way fetch parses it before anything is matched. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as meta from '../src/social/meta.js';
import { handleSocialRequest } from '../src/social/router.js';

const { processInstagramPublishQueue, OUTBOX_BUCKET } = meta;

const ORG = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_ORG = '999e4567-e89b-42d3-a456-426614174000';
const ACCOUNT = '223e4567-e89b-42d3-a456-426614174000';
const JOB = '323e4567-e89b-42d3-a456-426614174000';
const VIDEO = `${ORG}/423e4567-e89b-42d3-a456-426614174000.mp4`;
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', META_GRAPH_API_VERSION: 'v26.0', SOCIAL_IG_TEST_ACCESS_TOKEN: 'tok' };
const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

async function publish(payload, { org = ORG } = {}) {
  const signs = [];
  const graph = [];
  const patches = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    if (url.hostname === 'graph.facebook.com') { graph.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return ok({ id: 'container-1' }); }
    if (url.origin !== ENV.SUPABASE_URL) throw new Error('unexpected request: ' + String(input));
    const sign = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.*)$/.exec(url.pathname);
    if (sign) {
      signs.push({ method, bucket: sign[1], object: decodeURIComponent(sign[2]), search: url.search });
      return ok({ signedURL: `/object/sign/${sign[1]}/${sign[2]}?token=dl` });
    }
    if (url.pathname === '/rest/v1/rpc/claim_social_publish_jobs') return ok([{ id: JOB, org_id: org, account_id: ACCOUNT, publish_mode: 'reel', state: 'queued', attempts: 0, payload }]);
    if (url.pathname === '/rest/v1/social_accounts') return ok([{ id: ACCOUNT, org_id: org, platform: 'instagram', external_account_id: 'ig-1' }]);
    if (url.pathname === '/rest/v1/org_channels') return ok([{ token_env: 'SOCIAL_IG_TEST_ACCESS_TOKEN', secret_id: null, account_id: 'ig-1' }]);
    if (url.pathname === '/rest/v1/social_publish_jobs' && method === 'PATCH') { patches.push(JSON.parse(String(init.body))); return ok([{ id: JOB }]); }
    return ok([]);
  };
  const out = await processInstagramPublishQueue(ENV);
  return { result: out.results[0], signs, graph, patches };
}

test('a video in the job\'s own outbox folder is signed for a day and handed to Meta', async () => {
  const got = await publish({ storage_path: VIDEO, caption: 'hi' });
  assert.equal(got.result.state, 'processing');
  assert.deepEqual(got.signs, [{ method: 'POST', bucket: OUTBOX_BUCKET, object: VIDEO, search: '' }]);
  assert.equal(got.graph[0].video_url, `https://db.test/storage/v1/object/sign/${OUTBOX_BUCKET}/${VIDEO}?token=dl`);
});

/* [what, storage_path] for a job that belongs to ORG */
const NOT_THIS_JOBS_UPLOAD = [
  ['another organization\'s folder', `${OTHER_ORG}/a.mp4`],
  ['a parent segment out of the bucket', `${ORG}/../../other-bucket/secret.mp4`],
  ['a parent segment into another organization', `${ORG}/../${OTHER_ORG}/a.mp4`],
  ['a parent segment first', `../other-bucket/${ORG}/a.mp4`],
  ['a current-directory segment', `${ORG}/./a.mp4`],
  ['an empty segment', `${ORG}//a.mp4`],
  ['the folder itself', `${ORG}/`],
  ['the org id as a name prefix, not a folder', `${ORG}-other/a.mp4`],
  ['a leading slash', `/${ORG}/a.mp4`],
  ['percent-encoded dots', `${ORG}/%2e%2e/${OTHER_ORG}/a.mp4`],
  ['a backslash', `${ORG}\\..\\${OTHER_ORG}\\a.mp4`],
  ['a query', `${ORG}/a.mp4?x=1`],
  ['a fragment', `${ORG}/a.mp4#x`],
  ['a trailing newline', `${ORG}/a.mp4\n`],
  ['a trailing space', `${ORG}/a.mp4 `],
  ['something that is not text (a row holding a number)', 42],
];
for (const [what, path] of NOT_THIS_JOBS_UPLOAD) {
  test(`${what} is not signed and the job fails: ${JSON.stringify(path)}`, async () => {
    const got = await publish({ storage_path: path, caption: 'hi' });
    assert.deepEqual(got.signs.filter((s) => s.bucket !== OUTBOX_BUCKET || !s.object.startsWith(`${ORG}/`)), [], 'nothing outside the job\'s own folder is signed');
    assert.deepEqual(got.signs, [], 'Storage is not asked');
    assert.deepEqual(got.graph, [], 'nothing is sent to Meta');
    assert.equal(got.result.error, 'Publish job storage_path is not a plain path in its organization\'s outbox');
    assert.equal(got.patches.at(-1).last_error, got.result.error);
    assert.equal(got.patches.at(-1).attempts, 1);
  });
}

test('the folder is the job\'s own organization, read from the job row', async () => {
  const elsewhere = await publish({ storage_path: VIDEO, caption: 'hi' }, { org: OTHER_ORG });
  assert.deepEqual(elsewhere.signs, []);
  assert.match(elsewhere.result.error, /not a plain path in its organization's outbox/);
  assert.equal(typeof meta.outboxPathFor, 'function', 'meta.js exports the check');
  assert.equal(meta.outboxPathFor({ org_id: ORG, payload: { storage_path: VIDEO } }), VIDEO);
  for (const job of [{ payload: { storage_path: VIDEO } }, { org_id: '', payload: { storage_path: VIDEO } }, { org_id: null, payload: { storage_path: VIDEO } },
    { org_id: ORG, payload: {} }, { org_id: ORG }, null]) assert.equal(meta.outboxPathFor(job), null, JSON.stringify(job));
  /* only text is a path: nothing is coerced, whatever it would print as */
  for (const notText of [{ toString: () => VIDEO }, [VIDEO], new String(VIDEO), 42, true]) assert.equal(meta.outboxPathFor({ org_id: ORG, payload: { storage_path: notText } }), null, String(notText));
});

/* ---- the route that queues a job applies the same test ---- */
const USER = { id: 'user-1' };
async function queue(storagePath) {
  const inserts = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    if (url.origin !== ENV.SUPABASE_URL) throw new Error('unexpected request: ' + String(input));
    if (url.pathname.startsWith('/storage/')) throw new Error('queueing a job must not touch Storage: ' + String(input));
    if (url.pathname === '/rest/v1/org_members') return ok([{ org_id: ORG, role: 'owner' }]);
    if (url.pathname === '/rest/v1/social_accounts') return ok([{ id: ACCOUNT, org_id: ORG, platform: 'instagram', external_account_id: 'ig-1' }]);
    if (url.pathname === '/rest/v1/social_publish_jobs' && method === 'POST') { const row = JSON.parse(String(init.body)); inserts.push(row); return ok([{ id: JOB, ...row }], 201); }
    if (url.pathname === '/rest/v1/social_content_items' && method === 'POST') return ok([{ id: '623e4567-e89b-42d3-a456-426614174000', ...JSON.parse(String(init.body)) }], 201);
    return ok([]);
  };
  const request = new Request('https://api.test/v1/social/publish', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_id: ORG, account_id: ACCOUNT, storage_path: storagePath, caption: 'hi', publish_mode: 'reel', draft: true, drafted_by: 'test' }) });
  try { return { data: await handleSocialRequest(request, ENV, USER), inserts }; } catch (error) { return { error, inserts }; }
}

test('a job is queued with a path the publisher will sign', async () => {
  const got = await queue(VIDEO);
  assert.equal(got.error, undefined);
  assert.equal(got.inserts.length, 1);
  assert.equal(got.inserts[0].payload.storage_path, VIDEO);
  assert.equal(meta.outboxPathFor({ org_id: ORG, payload: got.inserts[0].payload }), VIDEO);
});

test('a job the publisher would refuse is refused when it is made, and nothing is queued', async () => {
  for (const [what, path] of NOT_THIS_JOBS_UPLOAD.filter((c) => typeof c[1] === 'string')) {
    const got = await queue(path);
    assert.equal(got.error?.status, 400, `${what}: ${JSON.stringify(path)}`);
    assert.match(String(got.error?.message), /storage_path is not in this organization's outbox/);
    assert.deepEqual(got.inserts, [], what);
  }
  /* and the route still refuses any "..", as it did before */
  assert.equal((await queue(`${ORG}/final..cut.mp4`)).error?.status, 400);
});

test('no path can be queued that the publisher would then refuse', async () => {
  const pieces = ['.', '..', '/', '//', '\\', '%2e', '%', ' ', '\t', '\n', '?', '#', 'a', 'B', '0', '-', '_', 'a.mp4', ORG, OTHER_ORG, `${ORG}/`, `${OTHER_ORG}/`];
  let seed = 0x50c1a1;
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let queued = 0;
  for (let i = 0; i < 1500; i += 1) {
    let path = random() < 0.7 ? `${ORG}/` : '';
    for (let n = 1 + Math.floor(random() * 5); n > 0; n -= 1) path += pieces[Math.floor(random() * pieces.length)];
    const got = await queue(path);
    if (got.error) { assert.equal(got.error.status, 400, JSON.stringify(path)); continue; }
    queued += 1;
    assert.equal(meta.outboxPathFor({ org_id: ORG, payload: got.inserts[0].payload }), path, `queued ${JSON.stringify(path)}`);
  }
  assert.ok(queued > 50, `only ${queued} generated paths were queued`);
});

test('a job with a public video URL or a media asset is unaffected', async () => {
  const direct = await publish({ video_url: 'https://cdn.example.test/v.mp4', caption: 'hi' });
  assert.equal(direct.result.state, 'processing');
  assert.equal(direct.graph[0].video_url, 'https://cdn.example.test/v.mp4');
  assert.deepEqual(direct.signs, []);
});

test('the publisher checks the row before it builds the signing request', () => {
  const src = readFileSync(new URL('../src/social/meta.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ safeObjectPath \} from '\.\.\/lib\/storage-object-path\.js';/);
  const resolve = src.slice(src.indexOf('async function resolveVideoUrl('), src.indexOf('async function accountForJob('));
  assert.ok(resolve.indexOf('outboxPathFor(job)') > 0 && resolve.indexOf('outboxPathFor(job)') < resolve.indexOf('signOutboxUrl('), 'checked first');
  assert.doesNotMatch(resolve, /signOutboxUrl\(env, job\.payload\.storage_path\)/, 'the row\'s path is never signed unchecked');
  assert.equal((src.match(/signOutboxUrl\(/g) || []).length, 2, 'one definition, one call');
});
