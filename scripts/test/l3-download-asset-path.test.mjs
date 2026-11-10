/* Level 3 downloads: a buyer is handed the product's own file, in the product
   bucket, and nothing else.

   l3_products.asset_path is a value on a row, not a fact about what was
   uploaded. The download function accepts it only as a plain object path
   (supabase/functions/_shared/storage-object-path.ts) and signs it by request
   body in its own bucket, so the value never becomes part of a URL. Anything
   else is answered like a product with no file: asset_missing (409), nothing
   signed, nothing written.

   This drives the function's real index.ts (./support/edge-function.mjs)
   against a stand-in Storage that signs whatever a request actually reaches,
   routed on the path a WHATWG fetch really sends. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEdgeFunction, storageSigner } from './support/edge-function.mjs';

const FUNCTION = 'supabase/functions/l3-download/index.ts';
const SB = 'https://db.test';
const BUCKET = 'l3-product-files';
const GOOD = 'packs/sound-pack-v1.zip';
const ORDER = {
  id: '70000000-0000-4000-8000-0000000000a1', product_id: '71000000-0000-4000-8000-0000000000a1',
  stripe_checkout_session_id: 'cs_test_order1', connected_account_id: 'acct_seller',
  amount_cents: 2500, currency: 'usd', status: 'pending', customer_email: null, paid_at: null,
};
const SESSION = {
  id: ORDER.stripe_checkout_session_id, object: 'checkout.session', mode: 'payment', payment_status: 'paid',
  amount_total: 2500, currency: 'usd', payment_intent: 'pi_1', metadata: { l3_order_id: ORDER.id },
  customer_details: { email: 'buyer@example.test', name: 'A Buyer' },
};
const ENTITLEMENT = { id: '72000000-0000-4000-8000-0000000000a1', order_id: ORDER.id, product_id: ORDER.product_id, download_count: 0, revoked_at: null };
/* What exists. `x` is in both buckets so a request that reaches either one is answered. */
const OBJECTS = {
  [BUCKET]: [GOOD, 'x', 'packs/Drum Kit (v2) + extras.zip', 'packs/v1.2/final..mix.zip', 'packs/été-2026.zip', 'packs/.../notes.txt'],
  'other-bucket': ['x', 'private/report.pdf'],
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

async function download(assetPath, { answerBatch = null } = {}) {
  const sign = storageSigner(OBJECTS, { base: SB, answerBatch });
  const writes = [];
  const product = { id: ORDER.product_id, title: 'Sound Pack', asset_path: assetPath, file_name: 'sound-pack-v1.zip', version: '1.0' };
  const fetchStub = async (input, init = {}) => {
    const href = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    const signedAnswer = await sign.respond(href, init);
    if (signedAnswer) return signedAnswer;
    const url = new URL(href);
    if (url.origin !== SB || !url.pathname.startsWith('/rest/v1/')) throw new Error('unexpected egress: ' + href);
    const table = url.pathname.slice('/rest/v1/'.length);
    if (method === 'GET') {
      if (table === 'l3_orders') return json([ORDER]);
      if (table === 'l3_products') return json([product]);
      if (table === 'l3_entitlements') return json([]);
      throw new Error('unexpected read: ' + href);
    }
    writes.push({ method, table, body: init.body ? JSON.parse(String(init.body)) : null });
    if (table === 'l3_entitlements' && method === 'POST') return json([ENTITLEMENT], 201);
    return new Response(null, { status: 204 });
  };
  class Stripe {
    constructor() { this.checkout = { sessions: { retrieve: async () => SESSION } }; }
  }
  const fn = await loadEdgeFunction(FUNCTION, {
    env: { STRIPE_SK: 'not-a-real-key', SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key' },
    stubs: { 'npm:stripe@14': { default: Stripe } },
    fetch: fetchStub,
  });
  const res = await fn.handler(new Request('https://api.test/functions/v1/l3-download', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'node-test', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify({ session_id: ORDER.stripe_checkout_session_id }),
  }));
  return { status: res.status, body: await res.json(), sign, writes };
}

/* Every shape that is not a plain object path. */
const REFUSED = [
  ['a parent segment first', '../other-bucket/x'],
  ['parent segments after a folder', 'a/../../other-bucket/x'],
  ['parent segments to another object', 'packs/../x'],
  ['a current-directory segment', './x'],
  ['a leading slash', '/x'],
  ['an empty segment', 'a//b'],
  ['a trailing slash', 'packs/'],
  ['percent-encoded dots', '%2e%2e/other-bucket/x'],
  ['percent-encoded dots, upper case', '%2E%2E/other-bucket/x'],
  ['a half-encoded parent segment', '.%2e/other-bucket/x'],
  ['a percent-encoded slash', '..%2fother-bucket/x'],
  ['any percent sign', 'packs/100%25.zip'],
  ['a trailing newline', GOOD + '\n'],
  ['a newline inside the dots', '.\n./other-bucket/x'],
  ['a tab inside the dots', '.\t./other-bucket/x'],
  ['a carriage return', 'packs/a\r.zip'],
  ['a NUL', 'packs/a\u0000.zip'],
  ['a backslash', 'a\\..\\..\\other-bucket\\x'],
  ['a query', GOOD + '?download=1'],
  ['a fragment', GOOD + '#part'],
  ['dots padded with spaces', '.. /other-bucket/x'],
  ['a blank segment', 'packs/ /x'],
  ['a trailing space', GOOD + ' '],
  ['a folder name ending in a space', 'packs /sound-pack-v1.zip'],
];

for (const [what, path] of REFUSED) {
  test(`${what} is answered asset_missing and nothing is signed or written: ${JSON.stringify(path)}`, async () => {
    const got = await download(path);
    assert.deepEqual(got.sign.signed, [], `signed ${JSON.stringify(got.sign.signed)}`);
    assert.deepEqual({ status: got.status, body: got.body }, { status: 409, body: { error: 'asset_missing' } });
    assert.deepEqual(got.sign.requests, [], 'no request reaches Storage');
    assert.deepEqual(got.writes, [], 'the order, entitlement and download log are untouched');
  });
}

test('a refused path is answered exactly like a product with no file', async () => {
  const none = await download(null);
  assert.deepEqual({ status: none.status, body: none.body, writes: none.writes, requests: none.sign.requests }, { status: 409, body: { error: 'asset_missing' }, writes: [], requests: [] });
  const empty = await download('');
  assert.deepEqual({ status: empty.status, body: empty.body, writes: empty.writes, requests: empty.sign.requests }, { status: 409, body: { error: 'asset_missing' }, writes: [], requests: [] });
});

test('no asset_path makes the function sign outside its own bucket', async () => {
  const outside = [];
  for (const path of [GOOD, ...REFUSED.map((c) => c[1])]) {
    const got = await download(path);
    for (const s of got.sign.signed) if (s.bucket !== BUCKET) outside.push({ asset_path: path, signed: `${s.bucket}/${s.name}`, answered: got.body.url || null });
    if (got.body.url) assert.ok(String(got.body.url).startsWith(`${SB}/storage/v1/object/sign/${BUCKET}/`), `${JSON.stringify(path)} answered ${got.body.url}`);
  }
  assert.deepEqual(outside, []);
});

test('a normal path is still signed, for five minutes, and the download is recorded', async () => {
  const got = await download(GOOD);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, {
    url: `${SB}/storage/v1/object/sign/${BUCKET}/${GOOD}?token=test-token`, expires_in: 300,
    file_name: 'sound-pack-v1.zip', title: 'Sound Pack', version: '1.0',
  });
  assert.deepEqual(got.sign.signed, [{ bucket: BUCKET, name: GOOD }]);
  assert.deepEqual(got.writes.map((w) => `${w.method} ${w.table}`), ['PATCH l3_orders', 'POST l3_entitlements', 'PATCH l3_entitlements', 'POST l3_download_events']);
  assert.equal(got.writes[0].body.status, 'paid');
  assert.equal(got.writes[2].body.download_count, 1);
});

test('ordinary file names keep working: spaces, brackets, accents, dots inside a name', async () => {
  for (const path of OBJECTS[BUCKET].filter((p) => p !== 'x')) {
    const got = await download(path);
    assert.equal(got.status, 200, JSON.stringify(path));
    assert.equal(got.body.url, `${SB}/storage/v1/object/sign/${BUCKET}/${path}?token=test-token`);
    assert.deepEqual(got.sign.signed, [{ bucket: BUCKET, name: path }]);
  }
});

test('the path travels in the request body: the signing URL names the bucket and nothing else', async () => {
  const got = await download(GOOD);
  assert.equal(got.sign.requests.length, 1);
  const [request] = got.sign.requests;
  assert.deepEqual(
    { form: request.form, method: request.method, sent: request.sent, body: request.body },
    { form: 'body', method: 'POST', sent: `${SB}/storage/v1/object/sign/${BUCKET}`, body: { expiresIn: 300, paths: [GOOD] } },
  );
});

test('only the answer for the path that was asked is used', async () => {
  const other = { error: null, path: 'x', signedURL: `/object/sign/${BUCKET}/x?token=test-token` };
  const answers = [
    ['an entry for another path', () => [other]],
    ['an entry for another path first, none for this one', () => [other, { error: null, path: GOOD + ' ', signedURL: `/object/sign/${BUCKET}/${GOOD}?token=test-token` }]],
    ['the object is not there', ({ paths }) => paths.map((path) => ({ error: 'Either the object does not exist or you do not have access to it', path, signedURL: null }))],
    ['a single-object answer', () => ({ signedURL: '/object/sign/other-bucket/x?token=test-token' })],
    ['an empty list', () => []],
    ['null', () => null],
  ];
  for (const [what, answerBatch] of answers) {
    const got = await download(GOOD, { answerBatch });
    assert.deepEqual({ status: got.status, body: got.body }, { status: 500, body: { error: 'sign_failed' } }, what);
    assert.ok(!got.writes.some((w) => w.table === 'l3_download_events' || w.body?.download_count), `${what}: no download is counted`);
  }
  const mixed = await download(GOOD, { answerBatch: ({ paths }) => [other, { error: null, path: paths[0], signedURL: `/object/sign/${BUCKET}/${paths[0]}?token=mine` }] });
  assert.equal(mixed.body.url, `${SB}/storage/v1/object/sign/${BUCKET}/${GOOD}?token=mine`, 'the entry whose path is the asset path');
});

test('a missing object is a signing failure, not a download', async () => {
  const got = await download('packs/not-uploaded.zip');
  assert.deepEqual({ status: got.status, body: got.body }, { status: 500, body: { error: 'sign_failed' } });
  assert.deepEqual(got.sign.signed, []);
  assert.ok(!got.writes.some((w) => w.table === 'l3_download_events'));
});
