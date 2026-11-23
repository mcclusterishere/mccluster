import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, stampAlbums } from '../music-track-lengths.mjs';

/* The listen ledger counts a song as finished only when real time covers
   its length, and that length comes from this generated file. A song added
   to data/albums.json without re-running the script would be refused as
   unknown, so a stale file fails here instead of on a listener. */
test('workers/mccluster/src/music/tracks.js matches data/albums.json and assets/audio', () => {
  const current = readFileSync(new URL('../../workers/mccluster/src/music/tracks.js', import.meta.url), 'utf8');
  assert.equal(current, build(), 'run: node scripts/music-track-lengths.mjs');
});

/* album.html paints every row's clock from these stamped lengths instead of
   probing each file's metadata, so they must match the audio. */
test('data/albums.json carries the measured length of every ungated track', () => {
  const current = readFileSync(new URL('../../data/albums.json', import.meta.url), 'utf8');
  assert.equal(current, stampAlbums(), 'run: node scripts/music-track-lengths.mjs');
});

/* WHAT EACH FILE REALLY IS (music slice M3; music map 02 DEL-8, 01 PB-12). dealer-plates-b.mp3 was
   an MP4 (AAC) file under an .mp3 name, served as audio/mp3, and iPhones refused it; four MP4 files
   kept their index (moov) after the audio (mdat), so a player had to fetch the end of the file before
   the first sound, and the World theme was read twice on every music page. Every file data/albums.json
   plays must be what its name says, and an MP4 must start fast (moov before mdat). */
const atom = (type, body = Buffer.alloc(0)) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length, 0); head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const FTYP = atom('ftyp', Buffer.from('M4A \0\0\0\0M4A mp42isom\0\0\0\0', 'latin1'));

test('the container check names a misnamed file and an index at the end', async () => {
  const { containerProblems } = await import('../music-track-lengths.mjs');
  assert.equal(typeof containerProblems, 'function', 'scripts/music-track-lengths.mjs exports containerProblems');
  const late = Buffer.concat([FTYP, atom('mdat', Buffer.alloc(64)), atom('moov', Buffer.alloc(16))]);
  const fast = Buffer.concat([FTYP, atom('moov', Buffer.alloc(16)), atom('free'), atom('mdat', Buffer.alloc(64))]);
  const mp3 = Buffer.concat([Buffer.from('ID3\x04\0\0\0\0\0\0', 'latin1'), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(413)]);
  assert.deepEqual(containerProblems(late, '.mp3').map((p) => p.kind).sort(), ['index-at-end', 'misnamed']);
  assert.deepEqual(containerProblems(late, '.m4a').map((p) => p.kind), ['index-at-end']);
  assert.deepEqual(containerProblems(fast, '.m4a'), []);
  assert.deepEqual(containerProblems(fast, '.mp3').map((p) => p.kind), ['misnamed']);
  assert.deepEqual(containerProblems(mp3, '.mp3'), []);
  assert.deepEqual(containerProblems(mp3, '.m4a').map((p) => p.kind), ['misnamed']);
});

test('every file data/albums.json plays is what its name says and starts fast', async () => {
  const { catalogueContainerProblems } = await import('../music-track-lengths.mjs');
  assert.equal(typeof catalogueContainerProblems, 'function');
  assert.deepEqual(catalogueContainerProblems(), [], 'remux with ffmpeg -c copy -movflags +faststart; publish an MP4 under .m4a');
});

/* THE FOUR FILES MOVED TO START FAST KEEP THEIR ENCODER'S GAPLESS NOTE (music slice M3 follow-up; reviews PB-R9 and
   RL-13). M3 moved their index with a remux (ffmpeg -c copy -movflags +faststart), which rewrote each file: it dropped
   the iTunes gapless note (iTunSMPB: the encoder's priming, its padding and the true number of samples) for an edit list
   that trims only the priming, and Chromium decoded 119 to 713 more samples of silence at the end of each. They are
   rebuilt from their b51ede03 bytes with only the index moved (qt-faststart: ftyp, then moov with its chunk offsets
   moved, then every other box byte for byte). These notes are those files' own, as their encoder wrote them. */
const GAPLESS = {
  'assets/audio/dealer-plates-b.m4a': { priming: 0x840, padding: 0x2c3, samples: 0x4184fd },
  'assets/audio/deep-end.m4a': { priming: 0x840, padding: 0x77, samples: 0x6f7749 },
  'assets/audio/heal-the-3rd-world.m4a': { priming: 0x840, padding: 0x2a7, samples: 0x623919 },
  'assets/audio/you-the-feds.m4a': { priming: 0x800, padding: 0x2c9, samples: 0x9cb137 },
};
function gaplessNote(buf) {
  const at = buf.indexOf('iTunSMPB', 0, 'latin1');
  if (at < 0) return null;
  const data = buf.indexOf('data', at, 'latin1');
  const size = buf.readUInt32BE(data - 4);
  const fields = buf.toString('latin1', data + 12, data - 4 + size).trim().split(/\s+/).map((h) => parseInt(h, 16));
  return { priming: fields[1], padding: fields[2], samples: fields[3] };
}
function topBoxes(buf) {
  const out = [];
  for (let p = 0; p + 8 <= buf.length;) {
    let size = buf.readUInt32BE(p);
    if (size === 1) size = Number(buf.readBigUInt64BE(p + 8));
    else if (size === 0) size = buf.length - p;
    out.push({ type: buf.toString('latin1', p + 4, p + 8), start: p, size });
    p += size;
  }
  return out;
}
test('the four files moved to start fast keep their encoder\'s gapless note, and carry no edit list of their own', () => {
  for (const [path, want] of Object.entries(GAPLESS)) {
    const buf = readFileSync(new URL('../../' + path, import.meta.url));
    const boxes = topBoxes(buf), moov = boxes.find((b) => b.type === 'moov'), mdat = boxes.find((b) => b.type === 'mdat');
    assert.ok(moov && mdat && moov.start < mdat.start, `${path}: the index comes before the audio`);
    assert.deepEqual(gaplessNote(buf), want, `${path}: the iTunes gapless note, as the encoder wrote it`);
    const index = buf.subarray(moov.start, moov.start + moov.size);
    assert.equal(index.indexOf('edts', 0, 'latin1'), -1, `${path}: no edit list (the remux added one that trimmed only the priming)`);
  }
});

/* THE LISTEN LEDGER'S WAIT IS WRITTEN FROM THE CATALOGUE (music slice M3 follow-up; review PB-R10): half the smallest
   margin between a song's length and the time the Worker needs to count it, so the shortest song always keeps its
   count. A song added with a smaller margin makes the file stale here. */
test('js/listen-ledger.js waits for the previous finish no longer than half the smallest margin in the catalogue', async () => {
  const lengths = await import('../music-track-lengths.mjs');
  assert.equal(typeof lengths.finishWait, 'function', 'scripts/music-track-lengths.mjs exports finishWait');
  assert.equal(typeof lengths.ledgerWithWait, 'function', 'and writes it into js/listen-ledger.js');
  const wait = lengths.finishWait();
  assert.deepEqual({ key: wait.key, seconds: wait.seconds, need: wait.need, margin: wait.margin, ms: wait.ms },
    { key: 'towyard-killer', seconds: 65.7, need: 62, margin: 3.7, ms: 1850 });
  const ledger = readFileSync(new URL('../../js/listen-ledger.js', import.meta.url), 'utf8');
  assert.equal(ledger, lengths.ledgerWithWait(ledger, wait), 'run: node scripts/music-track-lengths.mjs');
  assert.match(ledger, /var FINISH_WAIT_MS = 1850;/);
});
