import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../music-track-lengths.mjs';

/* The listen ledger counts a song as finished only when real time covers
   its length, and that length comes from this generated file. A song added
   to data/albums.json without re-running the script would be refused as
   unknown, so a stale file fails here instead of on a listener. */
test('workers/mccluster/src/music/tracks.js matches data/albums.json and assets/audio', () => {
  const current = readFileSync(new URL('../../workers/mccluster/src/music/tracks.js', import.meta.url), 'utf8');
  assert.equal(current, build(), 'run: node scripts/music-track-lengths.mjs');
});
