/* The reviewer's certificate link: signed only for a path of the shape the
   upload route issues, in the row's own learner's folder.

   learning_external_credentials.certificate_path is held to
   <user_id>/<36 hex-or-dash>.<pdf|png|jpg|webp> by the table's CHECKs
   (supabase/migrations/20261103182544_learning_evidence_v1.sql). The route
   places the row's path in a URL, so it repeats both checks itself; a row that
   does not pass has no file (404) and Storage is never asked.

   The Storage double answers for whatever the request really reaches: the URL
   is parsed the way fetch parses it before anything is matched. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as learning from '../src/prim3/learning.js';

const { handleLearning, LEARNING_PATH, CREDENTIAL_BUCKET } = learning;

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const LEARNER = '00000000-0000-4000-8000-0000000000b2';
const OTHER = '00000000-0000-4000-8000-0000000000c3';
const CREDENTIAL = '00000000-0000-4000-8000-00000000c001';
const FILE = `${LEARNER}/00000000-0000-4000-8000-00000000e001.pdf`;
const owner = async () => ({ id: OWNER, email: 'owner@example.invalid' });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function fileLink(row) {
  const signs = [];
  const selects = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/learning_external_credentials') { selects.push(url.searchParams.get('select')); return json(row ? [row] : []); }
    const m = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.*)$/.exec(url.pathname);
    if (!m) throw new Error('unexpected request: ' + String(input));
    signs.push({ method: init.method || 'GET', bucket: m[1], object: decodeURIComponent(m[2]), search: url.search });
    return json({ signedURL: `/object/sign/${m[1]}/${m[2]}?token=d` });
  };
  try {
    const res = await handleLearning(new Request(`https://api.mccluster.org${LEARNING_PATH}/review/credentials/${CREDENTIAL}/file`, {
      method: 'GET', headers: { origin: 'https://matthew.mccluster.org' },
    }), env, { requireHouseOwner: owner, authUser: owner });
    return { status: res.status, body: await res.json(), signs, selects };
  } finally { globalThis.fetch = original; }
}
const row = (certificate_path, user_id = LEARNER) => ({ id: CREDENTIAL, user_id, certificate_path });

test('a certificate in its learner\'s folder is signed for five minutes', async () => {
  const got = await fileLink(row(FILE));
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { ok: true, url: `https://db.example/storage/v1/object/sign/${CREDENTIAL_BUCKET}/${FILE}?token=d`, expires_in: 300 });
  assert.deepEqual(got.signs, [{ method: 'POST', bucket: CREDENTIAL_BUCKET, object: FILE, search: '' }]);
  assert.deepEqual(got.selects, ['user_id,certificate_path'], 'the row is read with the learner it belongs to');
  for (const ext of ['png', 'jpg', 'webp']) assert.equal((await fileLink(row(FILE.replace(/pdf$/, ext)))).status, 200, ext);
});

/* Everything that is not <this row's user_id>/<36 hex-or-dash>.<ext>. */
const NOT_A_CERTIFICATE = [
  ['another learner\'s folder', `${OTHER}/00000000-0000-4000-8000-00000000e001.pdf`],
  ['a parent segment', `../other-bucket/${FILE}`],
  ['parent segments after the folder', `${LEARNER}/../../other-bucket/secret.pdf`],
  ['a parent segment to another learner', `${LEARNER}/../${OTHER}/00000000-0000-4000-8000-00000000e001.pdf`],
  ['percent-encoded dots', `%2e%2e/other-bucket/${FILE}`],
  ['a backslash', `..\\other-bucket\\x.pdf`],
  ['a third segment', `${FILE}/x.pdf`],
  ['a current-directory segment', `./${FILE}`],
  ['a leading slash', `/${FILE}`],
  ['an empty segment', FILE.replace('/', '//')],
  ['a query', `${FILE}?download=x`],
  ['a fragment', `${FILE}#x`],
  ['a trailing newline', `${FILE}\n`],
  ['a newline inside the dots', `.\n./other-bucket/x.pdf`],
  ['another extension', FILE.replace(/pdf$/, 'html')],
  ['an upper-case folder', FILE.toUpperCase().replace(/PDF$/, 'pdf')],
  ['a short file name', `${LEARNER}/e001.pdf`],
  ['a folder only', `${LEARNER}/`],
];
for (const [what, path] of NOT_A_CERTIFICATE) {
  test(`${what} is not a file on the credential and nothing is signed: ${JSON.stringify(path)}`, async () => {
    const got = await fileLink(row(path));
    assert.deepEqual(got.signs.filter((s) => s.bucket !== CREDENTIAL_BUCKET), [], 'nothing outside the certificate bucket is signed');
    assert.deepEqual(got.signs, [], 'Storage is not asked');
    assert.equal(got.status, 404);
    assert.equal(got.body.error, 'No file on this credential');
  });
}

test('a credential with no file, or none at all, still answers 404 without touching Storage', async () => {
  for (const r of [row(null), row(''), null, { id: CREDENTIAL, certificate_path: FILE }, row(FILE, null), row(['x']), row(42)]) {
    const got = await fileLink(r);
    assert.equal(got.status, 404, JSON.stringify(r));
    assert.deepEqual(got.signs, []);
  }
});

test('the route\'s check is the table\'s own, shape and owner', () => {
  assert.equal(typeof learning.certificatePathOf, 'function', 'learning.js exports the check');
  assert.equal(learning.certificatePathOf(row(FILE)), FILE);
  assert.equal(learning.certificatePathOf(row(FILE, OTHER)), null);
  assert.equal(learning.certificatePathOf({ certificate_path: FILE }), null);
  const sql = readFileSync(new URL('../../../supabase/migrations/20261103182544_learning_evidence_v1.sql', import.meta.url), 'utf8');
  const tableShape = /certificate_path text check \(certificate_path ~ '\^(\[0-9a-f-\]\{36\})\/(\[0-9a-f-\]\{36\})\\\.\(pdf\|png\|jpg\|webp\)\$'\)/.exec(sql);
  assert.ok(tableShape, 'the table states the shape');
  assert.match(sql, /check \(certificate_path is null or split_part\(certificate_path, '\/', 1\) = user_id::text\)/, 'the table ties the folder to the row\'s user_id');
  const src = readFileSync(new URL('../src/prim3/learning.js', import.meta.url), 'utf8');
  assert.ok(src.includes(`const CERTIFICATE_PATH = /^(${tableShape[1]})\\/${tableShape[2]}\\.(?:pdf|png|jpg|webp)$/;`), 'the Worker repeats exactly that shape');
  const reader = src.slice(src.indexOf('async function credentialFile('), src.indexOf('async function reviewRating('));
  assert.ok(reader.indexOf('certificatePathOf(') > 0 && reader.indexOf('certificatePathOf(') < reader.indexOf('fetch('), 'the check runs before the request is built');
  assert.doesNotMatch(reader, /rows\?\.\[0\]\?\.certificate_path/, 'the row\'s path is never used unchecked');
});
