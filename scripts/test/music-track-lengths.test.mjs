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
