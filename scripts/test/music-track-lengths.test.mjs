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
