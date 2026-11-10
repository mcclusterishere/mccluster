/* The Instagram publisher signs a job's uploaded video only when the job names
   a plain object path inside its own organization's outbox folder.

   An upload is issued as <org id>/<uuid>.<ext> and a job is accepted only with
   a path under its own org's folder (src/social/router.js). The publisher reads
   storage_path back from the job row later, with the service role, so it holds
   the row to the same thing itself (src/social/meta.js, outboxPathFor): a job
   that does not pass is not signed and fails like any other unpublishable job.

   The Storage double answers for whatever the request really reaches: the URL
   is parsed the way fetch parses it before anything is matched. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as meta from '../src/social/meta.js';

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
  ['something that is not text', { toString: () => VIDEO }],
];
for (const [what, path] of NOT_THIS_JOBS_UPLOAD) {
  test(`${what} is not signed and the job fails: ${typeof path === 'string' ? JSON.stringify(path) : 'an object'}`, async () => {
    const got = await publish({ storage_path: path, caption: 'hi' });
    assert.deepEqual(got.signs.filter((s) => s.bucket !== OUTBOX_BUCKET || !s.object.startsWith(`${ORG}/`)), [], 'nothing outside the job\'s own folder is signed');
    assert.deepEqual(got.signs, [], 'Storage is not asked');
    assert.deepEqual(got.graph, [], 'nothing is sent to Meta');
    assert.match(got.result.error, /storage_path is not in its organization's outbox/);
    assert.equal(got.patches.at(-1).last_error, got.result.error);
    assert.equal(got.patches.at(-1).attempts, 1);
  });
}

test('the folder is the job\'s own organization, read from the job row', async () => {
  const elsewhere = await publish({ storage_path: VIDEO, caption: 'hi' }, { org: OTHER_ORG });
  assert.deepEqual(elsewhere.signs, []);
  assert.match(elsewhere.result.error, /storage_path is not in its organization's outbox/);
  assert.equal(typeof meta.outboxPathFor, 'function', 'meta.js exports the check');
  assert.equal(meta.outboxPathFor({ org_id: ORG, payload: { storage_path: VIDEO } }), VIDEO);
  for (const job of [{ payload: { storage_path: VIDEO } }, { org_id: '', payload: { storage_path: VIDEO } }, { org_id: null, payload: { storage_path: VIDEO } },
    { org_id: ORG, payload: {} }, { org_id: ORG }, null]) assert.equal(meta.outboxPathFor(job), null, JSON.stringify(job));
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
