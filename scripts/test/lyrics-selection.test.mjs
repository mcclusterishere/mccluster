import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectMissing, missing } from '../../tools/lyrics/transcribe.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'lyrics-selection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'data/lyrics/src'), { recursive: true });
  const albums = { albums: [{ tracks: [
    { title: 'Dive In', src: 'assets/audio/dive-in.mp3', lyrics_generation: 'awaiting-vocal-take' },
    { title: 'Ready', src: 'assets/audio/ready.mp3' },
    { title: 'Wired', src: 'assets/audio/wired.mp3', lyrics: 'data/lyrics/wired.json' },
    { title: 'Existing', src: 'assets/audio/existing.mp3' },
    { title: 'Gated', src: 'assets/audio/gated.mp3', gated: true },
    { title: 'No audio' },
  ] }] };
  await writeFile(join(root, 'data/albums.json'), JSON.stringify(albums));
  await writeFile(join(root, 'data/lyrics/existing.json'), '{}');
  // A sheet and even a stale generated output cannot make the instrumental eligible.
  await writeFile(join(root, 'data/lyrics/src/dive-in.txt'), 'owner sheet waiting for vocals');
  await writeFile(join(root, 'data/lyrics/dive-in.json'), '{}');
  return { root, albums };
}

test('selection excludes unavailable vocals, gated and already timed tracks', async (t) => {
  const { root, albums } = await fixture(t);
  assert.deepEqual((await selectMissing(albums, { root })).map(x => x.slug), ['ready']);
  assert.deepEqual((await selectMissing(albums, { root, force: true })).map(x => x.slug), ['ready', 'wired', 'existing']);
});

for (const force of [false, true]) test(`missing --wire never processes or wires a pending vocal take (force=${force})`, async (t) => {
  const { root } = await fixture(t);
  const calls = [];
  const made = await missing({ wire: true, force }, { root, processTrack: async (o) => { calls.push(o); } });
  assert.equal(calls.some(o => o.title === 'Dive In'), false);
  assert.equal(made.includes('data/lyrics/dive-in.json'), false);
  const tracks = JSON.parse(await readFile(join(root, 'data/albums.json'), 'utf8')).albums[0].tracks;
  assert.equal(tracks[0].lyrics, undefined);
  assert.equal(tracks[0].lyrics_generation, 'awaiting-vocal-take');
  assert.equal(tracks[1].lyrics, 'data/lyrics/ready.json');
  assert.equal(calls.length, force ? 3 : 1);
});

test('missing without --wire leaves the catalog unchanged', async (t) => {
  const { root } = await fixture(t);
  const before = await readFile(join(root, 'data/albums.json'), 'utf8');
  await missing({}, { root, processTrack: async () => {} });
  assert.equal(await readFile(join(root, 'data/albums.json'), 'utf8'), before);
});

test('published instrumental is explicitly excluded from CI selection, even with force', async () => {
  const albums = JSON.parse(await readFile(new URL('../../data/albums.json', import.meta.url), 'utf8'));
  const dive = albums.albums.flatMap(a => a.tracks).find(t => t.title === 'Dive In');
  assert.equal(dive.lyrics_generation, 'awaiting-vocal-take');
  assert.equal(dive.lyrics, undefined);
  for (const force of [false, true]) {
    assert.equal((await selectMissing(albums, { force })).some(x => x.slug === 'dive-in'), false);
  }
});
