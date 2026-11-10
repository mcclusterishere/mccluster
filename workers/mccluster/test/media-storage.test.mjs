/* ./src/lib/media-storage.js decides which network_media_assets rows the Worker
   may sign. The rows are written by their owners, so the rule is the media
   function's own: bucket mnet-media, path <auth user>/<uuid>-<name>, and that
   auth user linked to the row's owner. The path rule must stay identical to
   supabase/functions/mnet-media/storage-path.mjs, which issues the uploads. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MEDIA_BUCKET, canonicalMediaUploader, isOwnMediaUpload, ownMediaSignPath, ownMediaUploads } from '../src/lib/media-storage.js';
import { canonicalMediaUploader as edgeUploader } from '../../../supabase/functions/mnet-media/storage-path.mjs';
import { linkRows } from './support/auth-links.mjs';

/* Fixture ids carry letters on purpose: with digits-only ids an uppercase spelling is the same
   string, and every "case does not matter" assertion below would pass whatever the code did. */
const A = '6666abcd-6666-4666-8666-6666abcdef66';
const B = '7777bcde-7777-4777-8777-7777bcdefa77';
const OWNER_A = '3333cdef-3333-4333-8333-3333cdefab33';
const OWNER_B = '5555defa-5555-4555-8555-5555defabc55';
const FID = '8888abcd-8888-4888-8888-8888abcdef88';
const FILE = `${FID}-clip.mp4`;
const row = (over = {}) => ({ id: 'x', bucket_id: 'mnet-media', object_path: `${A}/${FILE}`, owner_m_uid: OWNER_A, ...over });
const reader = (links, seen = []) => async (path) => { seen.push(path); return linkRows(`https://db.test/rest/v1/${path}`, links); };

/* Every shape the media function can issue, and nothing else. */
const WELL_FORMED = [
  `${A}/${FILE}`, `${A.toUpperCase()}/${FILE}`, `${A}/${FID.toUpperCase()}-Clip.MP4`, `${A}/${FID}-a`,
  `${A}/${FID}-${'n'.repeat(180)}`, `${A}/${FID}-my_clip-01.final.mp4`, `${A}/${FID}-..`, `${A}/${FID}----`,
];
const REFUSED = [
  `${A}/${FID}-${'n'.repeat(181)}`, `${A}/${FID}-`, `${A}/${FID}`, `${A}/${FILE}/x`, `${A}/x/${FILE}`, `${A}/${FILE}/`,
  `${A}/../${B}/${FILE}`, `./${A}/${FILE}`, `/${A}/${FILE}`, `${A}//${FILE}`, `${A}/${FILE}\n`, `\n${A}/${FILE}`, `${A}/${FILE} `, ` ${A}/${FILE}`,
  `${A}/${FILE}?x=1`, `${A}/${FILE}#x`, `${A}%2F${FILE}`, `${A}/${FID}-clip one.mp4`, `${A}/${FID}-clip/one.mp4`, `${A}\\${FILE}`,
  `${A}/${FID}_clip.mp4`, `${A}-${FILE}`, `${A}_${FILE}`, `${A}/${FID}-clip+one.mp4`, `${A}/${FID}-clip~.mp4`, `${A}/${FID}-clip(1).mp4`,
  `${A}/${FID}-clip%20one.mp4`, `${A}/${FID}-clip@2x.mp4`, `${A}/${FID}-a,b.mp4`, `${A}/${FID}-a=b.mp4`,
  'm/clip.mp4', 'clip.mp4', '', ' ', `${A}/${FILE}\u0000`, `${A}/${FID}-ｃlip.mp4`, `g666abcd-6666-4666-8666-6666abcdef66/${FILE}`,
  `${A.slice(0, 14)}0${A.slice(15)}x/${FILE}`, `${A.replace(/-/g, '')}/${FILE}`,
  // U+017F and U+212A fold to s and k: a `u` flag added to either twin would start accepting them
  `${A}/${FID}-ſong.mp4`, `${A}/${FID}-Klip.mp4`,
];
const PATHS = [...WELL_FORMED, ...REFUSED];
const BUCKETS = ['mnet-media', 'MNET-MEDIA', 'mnet-media ', ' mnet-media', 'mnet-media/', 'mnet-media/..', 'mnet-avatars', 'mcc-gated-audio', 'creator-masters', '', null, undefined, 7];

test('the path rule is the media function\'s rule, case for case', () => {
  assert.notEqual(A.toUpperCase(), A, 'the fixture can tell cases apart');
  assert.equal(new Set(PATHS).size, PATHS.length, 'no path is listed twice');
  const accepted = [];
  for (const bucket_id of BUCKETS) for (const object_path of [...PATHS, null, undefined, 7, {}, [`${A}/${FILE}`]]) {
    const asset = { bucket_id, object_path };
    assert.equal(canonicalMediaUploader(asset), edgeUploader(asset), `${JSON.stringify(bucket_id)} ${JSON.stringify(object_path)}`);
    if (canonicalMediaUploader(asset)) accepted.push(`${bucket_id}|${object_path}`);
  }
  assert.deepEqual(accepted, WELL_FORMED.map((p) => `mnet-media|${p}`), 'only the upload bucket, only the well-formed paths');
  for (const object_path of WELL_FORMED) assert.equal(canonicalMediaUploader(row({ object_path })), A, 'the uploader is always the lowercased prefix');
  assert.equal(canonicalMediaUploader(null), null);
  assert.equal(MEDIA_BUCKET, 'mnet-media');
});

test('the two rules are the same two lines of source, not only the same answers on a list', async () => {
  const lines = async (url) => (await readFile(url, 'utf8')).split('\n').filter((l) => /^const (UUID|PATH) = /.test(l));
  const worker = await lines(new URL('../src/lib/media-storage.js', import.meta.url));
  const edge = await lines(new URL('../../../supabase/functions/mnet-media/storage-path.mjs', import.meta.url));
  assert.equal(worker.length, 2);
  assert.deepEqual(worker, edge);
  assert.match(worker[1], /, 'i'\);$/, 'case-insensitive only: no u, m, g or y flag');
});

test('a canonical row is the owner\'s own upload only when its prefix is linked to that owner', async () => {
  const links = [{ auth_user_id: A, m_uid: OWNER_A }, { auth_user_id: B, m_uid: OWNER_B }];
  assert.equal(await isOwnMediaUpload(row(), reader(links)), true);
  assert.equal(await isOwnMediaUpload(row({ object_path: `${B}/${FILE}` }), reader(links)), false, 'another member\'s prefix');
  assert.equal(await isOwnMediaUpload(row({ owner_m_uid: OWNER_B }), reader(links)), false, 'the prefix belongs to a different owner');
  assert.equal(await isOwnMediaUpload(row(), reader([])), false, 'no link, no proof');
  assert.equal(await isOwnMediaUpload(row({ owner_m_uid: undefined }), reader(links)), false);
  const asked = [];
  for (const owner_m_uid of [`${OWNER_A},${OWNER_B}`, `${OWNER_A})&or=(m_uid.not.is.null`, `in.(${OWNER_A})`, `${OWNER_A}\n`, ` ${OWNER_A}`, '*', '', 7, null, [OWNER_A], { toString: () => OWNER_A }]) {
    assert.equal(await isOwnMediaUpload(row({ owner_m_uid }), reader(links, asked)), false, JSON.stringify(owner_m_uid));
  }
  assert.deepEqual(asked, [], 'an owner that is not one uuid never reaches the query');
  const cased = [];
  assert.equal(await isOwnMediaUpload(row({ owner_m_uid: OWNER_A.toUpperCase(), object_path: `${A.toUpperCase()}/${FILE}` }), reader(links, cased)), true, 'uuid case does not matter');
  assert.equal(cased[0], `m_auth_user_links?auth_user_id=in.(${A})&m_uid=in.(${OWNER_A})&select=auth_user_id,m_uid`, 'and the lookup is asked in lower case');
  assert.equal(await isOwnMediaUpload(row(), reader([{ auth_user_id: A.toUpperCase(), m_uid: OWNER_A.toUpperCase() }])), true, 'however the link table spells it');
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

test('the sign path exists only for a proven row, so no route can sign an unchecked pointer', async () => {
  const links = [{ auth_user_id: A, m_uid: OWNER_A }];
  const seen = [];
  assert.equal(await ownMediaSignPath(row(), reader(links, seen)), `mnet-media/${A}/${FILE}`);
  assert.equal(seen.length, 1);
  assert.equal(await ownMediaSignPath(row(), reader([])), null, 'canonical but not linked to the owner');
  assert.equal(await ownMediaSignPath(row({ owner_m_uid: OWNER_B }), reader(links)), null);
  // `..` survives encodeURIComponent and a client resolves it into another bucket: such a row never gets a path at all
  for (const object_path of ['../mcc-gated-audio/albums/i-am-here/01-master.wav', `${A}/../${B}/${FILE}`, `${A}/%2e%2e/${FILE}`, 'a b/c?d', `${A}/${FILE}?download=1`]) {
    const asked = [];
    assert.equal(await ownMediaSignPath(row({ object_path }), reader(links, asked)), null, object_path);
    assert.deepEqual(asked, [], 'and costs no lookup');
  }
  assert.equal(await ownMediaSignPath(row({ bucket_id: 'mcc-gated-audio' }), reader(links)), null);
  assert.equal(await ownMediaSignPath(null, reader(links)), null);
  await assert.rejects(ownMediaSignPath(row(), async () => { throw new Error('link table unreachable'); }), /unreachable/);
});
