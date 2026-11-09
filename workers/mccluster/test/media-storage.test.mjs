/* ./src/lib/media-storage.js decides which network_media_assets rows the Worker
   may sign. The rows are written by their owners, so the rule is the media
   function's own: bucket mnet-media, path <auth user>/<uuid>-<name>, and that
   auth user linked to the row's owner. The path rule must stay identical to
   supabase/functions/mnet-media/storage-path.mjs, which issues the uploads. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_BUCKET, canonicalMediaUploader, isOwnMediaUpload, mediaObjectUrlPath, ownMediaUploads } from '../src/lib/media-storage.js';
import { canonicalMediaUploader as edgeUploader } from '../../../supabase/functions/mnet-media/storage-path.mjs';
import { linkRows } from './support/auth-links.mjs';

const A = '66666666-6666-4666-8666-666666666666';
const B = '77777777-7777-4777-8777-777777777777';
const OWNER_A = '33333333-3333-4333-8333-333333333333';
const OWNER_B = '55555555-5555-4555-8555-555555555555';
const FILE = '88888888-8888-4888-8888-888888888888-clip.mp4';
const row = (over = {}) => ({ id: 'x', bucket_id: 'mnet-media', object_path: `${A}/${FILE}`, owner_m_uid: OWNER_A, ...over });
const reader = (links, seen = []) => async (path) => { seen.push(path); return linkRows(`https://db.test/rest/v1/${path}`, links); };

const PATHS = [
  `${A}/${FILE}`, `${A.toUpperCase()}/${FILE}`, `${A}/88888888-8888-4888-8888-888888888888-a`,
  `${A}/88888888-8888-4888-8888-888888888888-${'n'.repeat(180)}`, `${A}/88888888-8888-4888-8888-888888888888-${'n'.repeat(181)}`,
  `${A}/88888888-8888-4888-8888-888888888888-`, `${A}/88888888-8888-4888-8888-888888888888`, `${A}/${FILE}/x`, `${A}/x/${FILE}`,
  `${A}/../${B}/${FILE}`, `./${A}/${FILE}`, `/${A}/${FILE}`, `${A}//${FILE}`, `${A}/${FILE}\n`, `\n${A}/${FILE}`, `${A}/${FILE} `,
  `${A}/${FILE}?x=1`, `${A}/${FILE}#x`, `${A}%2F${FILE}`, `${A}/88888888-8888-4888-8888-888888888888-clip one.mp4`,
  `${A}/88888888-8888-4888-8888-888888888888-clip/one.mp4`, `${A}\\${FILE}`, 'm/clip.mp4', 'clip.mp4', '', ' ',
  `${A}/${FILE}\u0000`, `${A}/88888888-8888-4888-8888-888888888888-ｃlip.mp4`, `g6666666-6666-4666-8666-666666666666/${FILE}`,
];
const BUCKETS = ['mnet-media', 'MNET-MEDIA', 'mnet-media ', ' mnet-media', 'mnet-media/', 'mnet-media/..', 'mcc-gated-audio', 'creator-masters', '', null, undefined, 7];

test('the path rule is the media function\'s rule, case for case', () => {
  let accepted = 0;
  for (const bucket_id of BUCKETS) for (const object_path of [...PATHS, null, undefined, 7, {}, [`${A}/${FILE}`]]) {
    const asset = { bucket_id, object_path };
    assert.equal(canonicalMediaUploader(asset), edgeUploader(asset), `${JSON.stringify(bucket_id)} ${JSON.stringify(object_path)}`);
    if (canonicalMediaUploader(asset)) accepted += 1;
  }
  assert.equal(accepted, 4, 'only the upload bucket with the four well-formed paths');
  assert.equal(canonicalMediaUploader(null), null);
  assert.equal(canonicalMediaUploader(row()), A);
  assert.equal(canonicalMediaUploader(row({ object_path: `${A.toUpperCase()}/${FILE}` })), A, 'the uploader is compared lowercased');
  assert.equal(MEDIA_BUCKET, 'mnet-media');
});

test('a canonical row is the owner\'s own upload only when its prefix is linked to that owner', async () => {
  const links = [{ auth_user_id: A, m_uid: OWNER_A }, { auth_user_id: B, m_uid: OWNER_B }];
  assert.equal(await isOwnMediaUpload(row(), reader(links)), true);
  assert.equal(await isOwnMediaUpload(row({ object_path: `${B}/${FILE}` }), reader(links)), false, 'another member\'s prefix');
  assert.equal(await isOwnMediaUpload(row({ owner_m_uid: OWNER_B }), reader(links)), false, 'the prefix belongs to a different owner');
  assert.equal(await isOwnMediaUpload(row(), reader([])), false, 'no link, no proof');
  assert.equal(await isOwnMediaUpload(row({ owner_m_uid: undefined }), reader(links)), false);
  assert.equal(await isOwnMediaUpload(row({ owner_m_uid: `${OWNER_A},${OWNER_B}` }), reader(links)), false, 'an owner that is not one uuid never reaches the query');
  assert.equal(await isOwnMediaUpload(row({ owner_m_uid: OWNER_A.toUpperCase() }), reader(links)), true, 'uuid case does not matter');
  assert.equal(await isOwnMediaUpload(null, reader(links)), false);
});

test('rows that cannot be canonical never cost a lookup, and a failed lookup is not a pass', async () => {
  const seen = [];
  assert.deepEqual(await ownMediaUploads([row({ bucket_id: 'mcc-gated-audio' }), row({ object_path: 'm/clip.mp4' }), null, undefined, 'x'], reader([], seen)), []);
  assert.deepEqual(seen, [], 'nothing to ask about');
  assert.deepEqual(await ownMediaUploads(undefined, reader([], seen)), []);
  await assert.rejects(ownMediaUploads([row()], async () => { throw new Error('link table unreachable'); }), /unreachable/);
  for (const junk of [null, undefined, {}, 'rows', [null, {}, { auth_user_id: A }, { auth_user_id: 7, m_uid: 7 }]]) {
    assert.deepEqual(await ownMediaUploads([row()], async () => junk), [], 'a malformed answer proves nothing');
  }
});

test('a batch keeps its order, drops only the unproven rows and asks only about well-formed uuids', async () => {
  const links = [{ auth_user_id: A, m_uid: OWNER_A }, { auth_user_id: B, m_uid: OWNER_B }];
  const seen = [];
  const mine = row({ id: 'mine' }), theirs = row({ id: 'theirs', object_path: `${B}/${FILE}`, owner_m_uid: OWNER_B });
  const crossed = row({ id: 'crossed', object_path: `${B}/${FILE}` }); // A's row pointed into B's prefix
  const forged = row({ id: 'forged', bucket_id: 'creator-masters' });
  const out = await ownMediaUploads([forged, theirs, crossed, mine], reader(links, seen));
  assert.deepEqual(out.map((r) => r.id), ['theirs', 'mine']);
  assert.equal(seen.length, 1, 'one lookup for the batch');
  assert.match(seen[0], /^m_auth_user_links\?auth_user_id=in\.\([0-9a-f,-]+\)&m_uid=in\.\([0-9a-f,-]+\)&select=auth_user_id,m_uid$/);
  // The in.() filters are a cross product on the wire; only the exact (prefix, owner) pair counts.
  assert.equal(out.includes(crossed), false);
});

test('a large board is looked up in bounded batches', async () => {
  const many = [], links = [];
  for (let i = 0; i < 95; i += 1) {
    const hex = i.toString(16).padStart(12, '0');
    const auth = `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`, owner = `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`;
    many.push(row({ id: `r${i}`, object_path: `${auth}/${FILE}`, owner_m_uid: owner }));
    if (i % 5) links.push({ auth_user_id: auth, m_uid: owner });
  }
  const seen = [];
  const out = await ownMediaUploads(many, reader(links, seen));
  assert.equal(seen.length, 3, '95 pairs in batches of 40');
  for (const path of seen) assert.ok(path.length < 4000, 'each request stays short');
  assert.equal(out.length, 76);
  assert.deepEqual(out.map((r) => r.id), many.filter((_, i) => i % 5).map((r) => r.id));
});

test('the sign path is the row\'s path, segment-encoded', () => {
  assert.equal(mediaObjectUrlPath(row()), `${A}/${FILE}`);
  assert.equal(mediaObjectUrlPath({ object_path: 'a b/c?d' }), 'a%20b/c%3Fd');
});
