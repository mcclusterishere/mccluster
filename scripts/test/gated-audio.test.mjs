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

test('the committed preview is really only the preview', async () => {
  /* The guard that matters: nothing stops someone dropping the whole record
     in as the "preview" file. A constant-bitrate MP3's length is its byte
     count, so the file itself is checked against what the registry claims,
     rather than trusting the filename. */
  const { stat } = await import('node:fs/promises');
  for (const t of await gatedTracks()) {
    const seconds = t.gated.preview_seconds;
    assert.ok(seconds > 0, `${t.title}: no preview_seconds declared`);
    const { size } = await stat(join(ROOT, t.src));
    const expected = (128000 / 8) * seconds;          // 128kbps CBR
    assert.ok(size < expected * 1.6,
      `${t.title}: ${t.src} is ${size} bytes, far past the ${seconds}s it claims ` +
      `(~${Math.round(expected)}). The full record may have been committed as the preview.`);
  }
});

test('every offered format has a recipe and lives under the track slug', async () => {
  const script = await read('scripts/publish-gated-track.mjs');
  const recipes = [...script.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1]);
  assert.ok(recipes.includes('m4r'), 'the ringtone recipe must exist');
  for (const t of await gatedTracks()) {
    const slug = t.gated.object.split('/')[0];
    for (const f of t.gated.formats || []) {
      assert.ok(recipes.includes(f.ext),
        `${t.title}: .${f.ext} is offered but publish-gated-track.mjs has no recipe for it`);
      assert.equal(f.object.split('/')[0], slug,
        `${t.title}: ${f.object} does not live under ${slug}/`);
      assert.equal(f.object.split('.').pop(), f.ext,
        `${t.title}: ${f.object} does not end in .${f.ext}`);
    }
  }
});

test('an iPhone ringtone is cut to something iOS will actually install', async () => {
  /* iOS refuses an .m4r longer than 40 seconds. A recipe without a duration
     cap produces a file that downloads fine and then silently will not
     install, which is worse than not offering it. */
  const script = await read('scripts/publish-gated-track.mjs');
  const m4r = /m4r: \{[^}]*\}/s.exec(script);
  assert.ok(m4r, 'no m4r recipe');
  const cap = /'-t', '(\d+)'/.exec(m4r[0]);
  assert.ok(cap, 'the ringtone recipe must cap its duration');
  assert.ok(Number(cap[1]) <= 40, `ringtone cap is ${cap[1]}s; iOS will not install past 40s`);
});

test('the unlock call to action asks for the song, not for paperwork', async () => {
  const html = await read('album.html');
  assert.match(html, /FULL SONG/, 'the locked row should offer the record');
  assert.doesNotMatch(html, />Free account</, 'the old mechanism-first copy is gone');
  assert.match(html, /@keyframes unlockFlash/, 'the call to action flashes');
  assert.match(html, /prefers-reduced-motion: reduce\)\s*\{\s*\.tr \.reclock \.unlock \{ animation: none/,
    'and stops for anyone who asked the OS for less motion');
});

test('no bar clearance is parked mid-document', async () => {
  /* The album page puts its comments block AFTER </main>. Bottom padding on
     .hr therefore is not clearance for the fixed bottom bar — it is a hole
     punched between the footer and the comments, and it was 12rem (232px of
     nothing on screen). body.has-appbar clears the bar; [data-comments]
     clears the deck. Neither job belongs to .hr. */
  const html = await read('album.html');
  assert.match(html, /<div data-comments=/, 'the comments block still follows main');
  for (const f of ['css/music-director.css', 'css/music-director-base.css']) {
    const css = await read(f);
    const rule = /\.music-room--album \.hr \{[^}]*\}/s.exec(css);
    assert.ok(rule, `${f}: no .hr rule`);
    const pad = /padding:[^;]*?(\d+(?:\.\d+)?)rem;/.exec(rule[0]);
    assert.ok(pad, `${f}: .hr has no padding shorthand`);
    assert.ok(Number(pad[1]) <= 4,
      `${f}: .hr bottom padding is ${pad[1]}rem — that lands between the footer ` +
      `and the comments, not under the bar`);
  }
  assert.match(html, /\[data-comments\] \{ margin-bottom: 6rem; \}/,
    'the last content must clear the deck, whose top sits 189px off the bottom');
});
