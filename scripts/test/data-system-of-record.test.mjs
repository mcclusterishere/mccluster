import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { build, clock, trackSlug } from '../../tools/build-music-registry.mjs';
import { audioSeconds } from '../music-track-lengths.mjs';

/* data/README.md says which file is the record for a fact and which is
   derived from it. These tests make that true: a derived file that drifted
   from its source fails here, not on a listener, a crawler or a buyer. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const check = (cmd) => execFileSync('node', [cmd, '--check'], { cwd: ROOT, stdio: 'pipe' });

test('data/catalogue.json is generated from the shelf, the ISRC ledger and the measured lengths', () => {
  check('tools/build-music-registry.mjs');
  const cat = json('data/catalogue.json');
  const albums = json('data/albums.json');
  const shelf = albums.albums.flatMap((a) => a.tracks.map(trackSlug));
  assert.deepEqual(cat.tracks.map((t) => t.slug), shelf, 'one row per track, in shelf order');
  assert.equal(cat.count, cat.tracks.length);
  assert.ok(!('generated_at' in cat), 'no timestamp: the file must be reproducible for --check');
  const ledger = json('data/ddex/identifiers.json');
  for (const r of ledger.recordings) {
    const row = cat.tracks.find((t) => t.slug === r.slug);
    assert.ok(row, `${r.slug} has an ISRC but is not on the shelf`);
    assert.equal(row.isrc, r.isrc, `${r.slug}: the registry carries the ledger's code`);
    assert.equal(row.no, +r.isrc.slice(-5), `${r.slug}: the house number is the ISRC designation`);
  }
  for (const t of cat.tracks) {
    if (t.gated) { assert.equal(t.length, '', 'a gated master is not measured here'); continue; }
    assert.match(t.length, /^\d+:\d{2}$/, `${t.slug}: a measured length`);
  }
  /* the registry used to leave Money or the Power blank long after its file
     was in the repository; and nothing on the shelf is left out any more */
  assert.equal(cat.tracks.find((t) => t.slug === 'money-or-the-power').length, '3:36');
  for (const slug of ['environmental-injustice-brave', 'deep-end', 'heal-the-3rd-world']) {
    assert.ok(cat.tracks.some((t) => t.slug === slug), `${slug} is registered`);
  }
});

test('the registry builder states credits only as the shelf states them', () => {
  const out = build({
    albums: { albums: [
      { slug: 'x', name: 'X', artist: 'Act', tracks: [
        { title: 'A', src: 'assets/audio/a.mp3', sub: 'ft. B', credit: '' },
        { title: 'B', src: 'assets/audio/b.mp3', sub: 'ft. C' },
        { title: 'C', src: 'assets/audio/c.m4a' },
        { title: 'D', src: 'assets/audio/d-preview.mp3', gated: { object: 'd/d.mp3' } }
      ] }
    ] },
    ledger: { prefix: 'QT6KV', recordings: [{ slug: 'b', isrc: 'QT6KV2600042' }] },
    lengths: { a: { seconds: 129.8 }, b: { seconds: 59.5 }, c: { seconds: 0 } }
  });
  assert.deepEqual(out.tracks.map((t) => [t.slug, t.credit, t.no, t.length, t.isrc || null, !!t.gated]), [
    ['a', '', 43, '2:10', null, false],     // an explicit empty credit is a statement
    ['b', 'ft. C', 42, '1:00', 'QT6KV2600042', false],
    ['c', 'Act', 44, '', null, false],       // the album's act when the track says nothing
    ['d', 'Act', 45, '', null, true]         // a gated slug is its bucket folder
  ]);
  assert.equal(clock(97.4), '1:37');
  assert.throws(() => build({ albums: { albums: [{ slug: 'x', name: 'X', tracks: [{ title: 'A', src: 'a.mp3' }, { title: 'A2', src: 'b/a.mp3' }] }] }, ledger: {}, lengths: {} }), /appears twice/);
});

test('a song length is read from the container, not the file name', () => {
  /* dealer-plates-b.mp3 is an MP4 (AAC) file with an .mp3 name; parsed as
     MPEG frames it measured 22.8 s of a 97 s record */
  const buf = readFileSync(join(ROOT, 'assets/audio/dealer-plates-b.mp3'));
  assert.equal(buf.toString('latin1', 4, 8), 'ftyp', 'the fixture is still an ISO media file');
  assert.ok(audioSeconds(buf, '.mp3') > 95, 'measured as the M4A it is');
  const TRACKS = JSON.parse(read('workers/mccluster/src/music/tracks.js').replace(/^[\s\S]*?export const TRACKS = /, '').replace(/;\s*$/, ''));
  assert.ok(TRACKS['dealer-plates-b'].seconds > 95);
});

test('the World looks a track\'s lyrics up on the shelf, never by guessing the file name', () => {
  const js = read('js/world-audio-continuity.js');
  assert.match(js, /lyricsBySlug = words; lyricCache = \{\};/, 'the shelf\'s answer replaces any guess made before it arrived');
  assert.match(js, /words\[fileSlug\] = typeof t\.lyrics === "string" && \/\^data\\\/lyrics\\\/\[a-z0-9\._-\]\+\\\.json\$\/i\.test\(t\.lyrics\) \? t\.lyrics : "";/, 'only a same-origin data/lyrics path is taken from the shelf');
  assert.match(js, /if \(named === ""\) return null;/, 'a track the shelf names with no words gets none');
  assert.match(js, /var path = lyricsPath\(slug\); if \(!path\) return Promise\.resolve\(null\);/);
  /* the case that was wrong: the file the shelf names differs from the slug */
  const albums = json('data/albums.json');
  const money = albums.albums.flatMap((a) => a.tracks).find((t) => trackSlug(t) === 'money-or-the-power');
  assert.equal(money.lyrics, 'data/lyrics/money-or-the-power.dk.json');
  for (const t of albums.albums.flatMap((a) => a.tracks)) {
    if (t.lyrics) assert.doesNotThrow(() => read(t.lyrics), `${t.title}: ${t.lyrics} exists`);
  }
});

test('data/gallery.json lists exactly the frames that landed on disk', () => {
  check('tools/wall-index.mjs');
});

test('data/README.md names every generator that has a --check, and the offerings note points at the real ledger', () => {
  const readme = read('data/README.md');
  for (const g of ['tools/build-music-registry.mjs', 'scripts/music-track-lengths.mjs', 'tools/build-catalogue.mjs', 'tools/wall-index.mjs',
    'tools/build-company-site.mjs', 'tools/build-profile-entity.mjs', 'tools/build-newsroom.mjs', 'tools/build-sitemap.mjs']) {
    assert.ok(readme.includes(g), `${g} is in the map`);
  }
  assert.match(json('data/offerings.json').note, /supabase\/replay_migrations\/0007_offerings\.sql/);
  assert.match(read('docs/control-plane/DOMAINS-AND-ENTITIES.md'), /`data\/README\.md`/);
});
