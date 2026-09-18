/* THE GATE ON A RECORD — the contract, not the paint.
   ============================================================
   A gated track keeps its master out of this repository and behind an
   M Account. Four things make that true, and each one broke at least
   once while it was being built, silently:

     1. the master is not committed, so the gate cannot be walked around
     2. the deck opts into CORS, or the analyser plays SILENCE
     3. the waveform fetches the signed URL whole, token and all
     4. the row's slot does not borrow a class that is already a
        full-screen modal somewhere else in the stylesheet

   None of these show up in a screenshot of a happy path, which is
   exactly why they are asserted here.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
const exists = (p) => access(join(ROOT, p)).then(() => true, () => false);

async function gatedTracks() {
  const { albums } = JSON.parse(await read('data/albums.json'));
  return albums.flatMap((a) => (a.tracks || [])
    .filter((t) => t.gated)
    .map((t) => ({ ...t, albumSlug: a.slug })));
}

test('every gated track declares a private object and a public preview', async () => {
  const tracks = await gatedTracks();
  assert.ok(tracks.length, 'no gated tracks — delete this suite or fix the registry');
  for (const t of tracks) {
    assert.ok(t.gated.bucket, `${t.title} has no bucket`);
    assert.ok(t.gated.object, `${t.title} has no object path`);
    assert.ok(t.src, `${t.title} has no preview to play`);
    assert.ok(await exists(t.src), `${t.title}: preview ${t.src} is not in the repo`);
  }
});

test('the master of a gated track is NOT committed to the site', async () => {
  /* This is the whole gate. The site is a static host: a master under
     assets/ is public the second it deploys, and the account check
     becomes decoration. */
  for (const t of await gatedTracks()) {
    const base = t.gated.object.split('/').pop();
    for (const candidate of [`assets/audio/${base}`, t.gated.object]) {
      assert.equal(await exists(candidate), false,
        `${t.title}: ${candidate} is committed — the gate is walkable`);
    }
    assert.match(t.src, /preview/i,
      `${t.title}: the public file should be recognisable as the preview`);
  }
});

test('the deck opts into CORS so a cross-origin master is not silenced', async () => {
  const html = await read('album.html');
  const deck = /<audio[^>]*id="deck"[^>]*>/.exec(html);
  assert.ok(deck, 'no deck element on album.html');
  assert.match(deck[0], /crossorigin="anonymous"/,
    'js/chamber.js runs the deck through createMediaElementSource; a ' +
    'cross-origin element without crossorigin is tainted and that graph ' +
    'outputs silence, so a gated record would play to nobody');
});

test('the waveform fetches the signed URL, token and all', async () => {
  const src = await read('js/filament.js');
  assert.match(src, /fetch\(src\)/,
    'filament must fetch the full src: fetching the query-stripped cache ' +
    'key drops the Supabase signing token, and the JSON error that comes ' +
    'back goes straight into decodeAudioData');
  assert.doesNotMatch(src, /fetch\(key\)/, 'fetching the stripped key is the bug');
});

test('the row slot does not reuse a class the stylesheet already owns', async () => {
  const html = await read('album.html');
  const css = await read('css/style.css');
  /* .gate in css/style.css is the booking modal: position fixed, inset 0.
     A row slot wearing it is in the DOM, passes a presence assertion, and
     paints across the whole viewport. */
  assert.match(css, /\.gate\s*\{[^}]*position:\s*fixed/,
    'this guard assumes .gate is still the fixed modal; if that changed, ' +
    'retarget the guard rather than deleting it');
  assert.doesNotMatch(html, /<span class="gate" data-gate>/,
    'the track row must not reuse the modal .gate class');
});

test('the gated registry and the publisher agree on where the master lives', async () => {
  const script = await read('scripts/publish-gated-track.mjs');
  const bucket = /const BUCKET = '([^']+)'/.exec(script);
  assert.ok(bucket, 'publish-gated-track.mjs no longer names a bucket');
  for (const t of await gatedTracks()) {
    assert.equal(t.gated.bucket, bucket[1],
      `${t.title} points at ${t.gated.bucket} but the publisher writes to ${bucket[1]}`);
  }
});

test('the bucket is private and only signed-in listeners may read it', async () => {
  const sql = await read('supabase/migrations/20260918230000_gated_audio.sql');
  assert.match(sql, /'mcc-gated-audio',\s*'mcc-gated-audio',\s*false/,
    'the bucket must be created private');
  assert.match(sql, /for select\s+to authenticated/,
    'the read policy must be scoped to authenticated, never public: anon ' +
    'holds the publishable key too');
  assert.doesNotMatch(sql, /for (insert|update|delete)/,
    'no browser-side write policy belongs on a bucket of masters');
});

test('an album billed to another name says so everywhere it credits', async () => {
  /* The artist was hardcoded in five places on album.html. An album that
     carries an "artist" in data/albums.json is billed to that name in the
     header, the now-playing sheet, the MediaSession metadata the phone lock
     screen reads, and the default credit line. The copyright footer is a
     rights notice, not a credit, and deliberately still names the owner. */
  const { albums } = JSON.parse(await read('data/albums.json'));
  const billed = albums.filter((a) => a.artist);
  if (!billed.length) return;
  const html = await read('album.html');
  assert.match(html, /ARTIST = head\.artist \|\| HOUSE/, 'the album must set the billed artist');
  for (const id of ['albArtist', 'nowBy']) {
    assert.match(html, new RegExp(`getElementById\\("${id}"\\)\\.textContent = ARTIST`),
      `#${id} must follow the billed artist`);
  }
  assert.match(html, /artist: ARTIST,/, 'MediaSession must follow the billed artist');
  assert.doesNotMatch(html, /artist: "Matthew McCluster"/, 'no hardcoded artist left in the player');
  assert.match(html, /© 2026 Matthew McCluster/, 'the rights notice stays with the owner');
});

test('the pocket player banks a durable url, never a signed one', async () => {
  /* A signed URL dies within the hour. Banking it means the pocket tries to
     resume the record from a dead link on the next page the listener opens. */
  const html = await read('album.html');
  assert.match(html, /src: row\.getAttribute\("data-preview-src"\) \|\| row\.getAttribute\("data-src"\)/,
    'the pocket must prefer the durable public preview');
});
