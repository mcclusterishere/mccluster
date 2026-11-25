import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

/* The World follows data/albums.json to a track's lyrics file (PR #648), and
   the files it names keep their lines as timed.line[] with begin/content,
   which is album.html's shape (paintLyrics). The World's reader once took
   only lines[] with t/text, so Money or the Power and the Brave mix, whose
   .dk.json files it now fetches, showed no words at all. This runs the real
   reader over the real files. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));

function reader() {
  const src = read('js/world-audio-continuity.js');
  const m = /\n  function lyricLines\(d\) \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(m, 'lyricLines is a standalone function in js/world-audio-continuity.js');
  const fn = vm.runInNewContext(m[0] + '; lyricLines', { Array, Number });
  /* the reader runs in its own realm; bring its answer home so deepEqual compares values */
  return (d) => { const r = fn(d); return r === null ? null : JSON.parse(JSON.stringify(r)); };
}

function sorted(lines) { return lines.every((l, i) => i === 0 || lines[i - 1].t <= l.t); }

test('the .dk.json files the shelf names yield their timed lines on the World', () => {
  const lyricLines = reader();
  const albums = json('data/albums.json');
  const named = {};
  for (const a of albums.albums) for (const t of a.tracks) if (t.lyrics) named[t.title] = t.lyrics;
  assert.equal(named['Money or the Power'], 'data/lyrics/money-or-the-power.dk.json');
  assert.equal(named['Environmental Injustice (Brave mix)'], 'data/lyrics/environmental-injustice-brave.dk.json');
  for (const [file, count] of [['data/lyrics/money-or-the-power.dk.json', 65], ['data/lyrics/environmental-injustice-brave.dk.json', 83]]) {
    const lines = lyricLines(json(file));
    assert.ok(lines && lines.length === count, `${file}: ${count} lines, got ${lines && lines.length}`);
    assert.ok(sorted(lines), `${file}: sorted by time`);
    assert.ok(lines.every((l) => Number.isFinite(l.t) && typeof l.text === 'string' && l.text.length), `${file}: every line has a time and words`);
  }
});

test('a plain file in the same shape reads the same way, and the older lines[] shape still does', () => {
  const lyricLines = reader();
  const plain = lyricLines(json('data/lyrics/antisocial.json'));
  assert.ok(plain && plain.length === 34 && sorted(plain), 'antisocial.json: 34 timed lines');
  assert.equal(plain[1].text, 'Scroll slow, homie');
  /* the shape the World accepted before (and the e2e fixture still sends) */
  const old = lyricLines({ lines: [{ t: 40, text: 'two' }, { t: 0.2, text: 'one' }, { t: 'x', text: 'dropped' }, { t: 3 }] });
  assert.deepEqual(old, [{ t: 0.2, text: 'one' }, { t: 40, text: 'two' }]);
  /* begin/content wins over lines when both are present, as on the album page */
  assert.deepEqual(lyricLines({ timed: { line: [{ begin: 1, content: 'a' }] }, lines: [{ t: 2, text: 'b' }] }), [{ t: 1, text: 'a' }]);
  for (const nothing of [null, {}, { plain: 'words' }, { timed: { line: [] } }, { lines: [] }, { lines: 'x' }]) assert.equal(lyricLines(nothing), null);
});

test('every lyrics file the shelf names exists and yields lines or is honestly plain', () => {
  const lyricLines = reader();
  const albums = json('data/albums.json');
  for (const a of albums.albums) for (const t of a.tracks) {
    if (!t.lyrics) continue;
    const d = json(t.lyrics);
    const lines = lyricLines(d);
    assert.ok(lines ? sorted(lines) : typeof d.plain === 'string', `${t.title}: ${t.lyrics} has timed lines or plain words`);
  }
});
