import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { validateLyrics } from '../../core/src/lyrics/align.mjs';

/* The lyric machine (core/src/lyrics/, tools/lyrics/transcribe.mjs) writes
   data/lyrics/<slug>.json in the shape every player reads. This holds every
   file the shelf names to that shape: times in seconds, never backwards, inside
   the song, words inside their lines, and machine output honestly marked as
   unreviewed with the models that made it. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const albums = json('data/albums.json');
const shelf = albums.albums.flatMap((a) => a.tracks.map((t) => ({ ...t, album: a.slug })));
const MACHINE = new Set(['auto', 'aligned', 'imported']);

test('every lyrics file the shelf names is valid timed lyrics that fit its song', () => {
  for (const t of shelf) {
    if (!t.lyrics) continue;
    const d = json(t.lyrics);
    const errs = validateLyrics(d, { duration: t.seconds ?? null });
    assert.deepEqual(errs, [], `${t.title}: ${t.lyrics}`);
    assert.ok(Array.isArray(d.timed?.line) && d.timed.line.length > 0, `${t.title}: has timed lines (the players light them as the song plays)`);
  }
});

test('machine-made lyrics say so: unreviewed, with the engine, and word times in every line', () => {
  let machine = 0;
  for (const t of shelf) {
    if (!t.lyrics) continue;
    const d = json(t.lyrics);
    if (!MACHINE.has(d.source)) continue;
    machine += 1;
    assert.equal(typeof d.reviewed, 'boolean', `${t.lyrics}: reviewed is a boolean`);
    if (!d.reviewed) assert.ok(!d.reviewed_at, `${t.lyrics}: no review time on unreviewed lyrics`);
    const eng = d.machine?.engine || {};
    for (const k of ['separator', 'asr', 'aligner']) assert.equal(typeof eng[k], 'string', `${t.lyrics}: machine.engine.${k} recorded`);
    assert.deepEqual(validateLyrics(d, { duration: t.seconds, requireWords: true }), [], `${t.lyrics}: words in every line`);
    if (d.source === 'aligned') {
      const slug = t.lyrics.split('/').pop().replace(/\.json$/, '');
      assert.ok(existsSync(join(ROOT, `data/lyrics/src/${slug}.txt`)), `${t.lyrics}: aligned to a sheet kept at data/lyrics/src/${slug}.txt`);
    }
  }
  assert.ok(machine >= 9, `the Whip Equipped tracks and the two plain files carry machine timing (saw ${machine})`);
});

test('Whip Equipped: the story order, every track playable, timed, metadata stripped', () => {
  const we = albums.albums.find((a) => a.slug === 'whip-equipped');
  assert.deepEqual(we.tracks.map((t) => t.title), [
    'Test Drive', 'Salvage Title (B-Side)', 'Repo Guy (B-Side)', 'Hundun (B-Side)',
    'Dealer Plates (A-Side)', 'Dealer Plates (B-Side)', 'Towyard Killer', 'Mr. Lock Changer (Remix)',
    'Lana (B-Side)', 'Stand On Business (B-Side)', 'All in the Details',
  ], 'docs/music/WHIP-EQUIPPED-STORY.md is the order');
  for (const t of we.tracks) {
    assert.ok(existsSync(join(ROOT, t.src)), `${t.title}: ${t.src} exists`);
    assert.ok(t.seconds > 30, `${t.title}: measured length`);
    if (t.title !== 'Dealer Plates (B-Side)') assert.ok(t.lyrics, `${t.title}: has lyrics`);
    if (/^Dealer Plates/.test(t.title)) continue; /* shipped before this machine; their files are untouched */
    const head = readFileSync(join(ROOT, t.src)).subarray(0, 4096);
    if (t.src.endsWith('.mp3')) assert.notEqual(head.subarray(0, 3).toString('latin1'), 'ID3', `${t.title}: no ID3 tag (title/art stripped)`);
    if (t.src.endsWith('.m4a')) {
      const all = readFileSync(join(ROOT, t.src));
      for (const atom of ['covr', '©nam', '©ART']) assert.ok(all.indexOf(Buffer.from(atom, 'latin1')) < 0, `${t.title}: no ${atom} atom`);
    }
  }
});

test('lyric sheets are plain text in the repo, never the owner\'s .docx', () => {
  const src = readdirSync(join(ROOT, 'data/lyrics/src'));
  assert.ok(src.length >= 9);
  for (const f of src) assert.match(f, /^[a-z0-9-]+\.txt$/, `data/lyrics/src/${f}`);
});

test('stems and machine scratch never land in the repo', () => {
  assert.match(read('.gitignore'), /^\.lyrics-work\/$/m);
  const wf = read('.github/workflows/lyrics-machine.yml');
  assert.match(wf, /permissions:\n  contents: read/);
  assert.ok(!/git push|git commit|contents: write/.test(wf), 'the lyric workflow never pushes (AGENTS.md hard rule 2)');
});

/* the shared reader every player uses (js/lyrics-sync.js) */
function lyricsSync() {
  const ctx = { globalThis: {}, Array, Number, Math, isFinite };
  ctx.window = ctx.globalThis;
  vm.runInNewContext(read('js/lyrics-sync.js'), ctx);
  return ctx.globalThis.MCC_LYRICS;
}

test('the shared reader accepts every shape the shelf has and finds the sung line', () => {
  const L = lyricsSync();
  const machine = L.normalize(json('data/lyrics/hundun-b-side.json'));
  assert.ok(machine.timed && machine.lines.length > 20 && machine.lines.every((l) => l.words && l.words.length));
  const dk = L.normalize(json('data/lyrics/money-or-the-power.dk.json'));
  assert.ok(dk.timed && dk.lines.length === 65 && dk.lines.every((l) => l.words === null));
  const old = L.normalize({ lines: [{ t: 3, text: 'b' }, { t: 1, text: 'a' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(old.lines.map((l) => [l.t, l.text, l.end]))), [[1, 'a', 3], [3, 'b', 7]]);
  assert.equal(L.normalize({ plain: 'one\ntwo' }).timed, false);
  assert.equal(L.normalize({}), null);
  const lines = machine.lines;
  assert.equal(L.indexAt(lines, 0), lines[0].t <= 0 ? 0 : -1);
  for (const k of [1, 7, lines.length - 1]) {
    assert.equal(L.indexAt(lines, lines[k].t), k);
    assert.equal(L.indexAt(lines, lines[k].t + 0.0005), k);
  }
});

/* review finding (PR #684): a run whose inputs changed under it must not stand */
test('the upload trigger keys lyrics to their inputs and never lets a running job suppress a newer one', () => {
  const sql = read('supabase/pending/20261031180000_lyrics_machine_v1.sql');
  assert.match(sql, /new\.lyrics_input_rev := md5\(coalesce\(new\.master_path, ''\) \|\| chr\(10\) \|\| coalesce\(new\.lyrics_sheet, ''\)\)/);
  assert.match(sql, /before insert or update of master_path, lyrics_sheet on public\.creator_tracks/);
  assert.match(sql, /and j\.status = 'queued'/);
  assert.doesNotMatch(sql, /status in \('queued', 'running'\)/, 'a running job heard the old inputs');
  assert.match(sql, /'input_rev', new\.lyrics_input_rev/);
  const fn = read('supabase/functions/music-access/index.ts');
  const q = fn.slice(fn.indexOf('if (action === "operator-lyrics-queue")'));
  assert.match(q.slice(0, 1200), /\.eq\("status", "queued"\)/, 'Control re-run is suppressed only by a queued job');
  assert.match(read('core/src/executors/lyrics-align.mjs'), /lyrics_input_rev=eq\./);
});
