#!/usr/bin/env node
/* SONG LENGTHS FOR THE SERVER.

   The listen ledger (workers/mccluster/src/music/) only counts a song as
   finished when real time between its start and its end covers the song.
   That needs every song's length on the server, where a listener cannot
   edit it, so this reads the lengths out of the committed audio files and
   writes them next to the Worker code (workers/mccluster/src/music/tracks.js).
   The same lengths are stamped as `seconds` on every ungated track in
   data/albums.json, so album.html paints each row's clock from the file it
   already fetched instead of opening an audio request per row to probe it.

   No ffmpeg: MP3 length is the sum of its frames, and M4A length is the
   movie header's duration over its timescale. Both are exact.

     node scripts/music-track-lengths.mjs          write both files
     node scripts/music-track-lengths.mjs --check  exit 1 if either is stale, or if a
                                                   catalogue file is not what its name
                                                   says or keeps its index at the end

   A track's key is its file name without the extension (a gated track
   uses its bucket folder), which is what the players send. */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'workers/mccluster/src/music/tracks.js');
const ALBUMS = resolve(root, 'data/albums.json');

const BITRATES = {
  // [version-group][layer] in kbps; index 0 is "free", 15 is invalid
  1: {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  },
  2: {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  }
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function mp3Seconds(buf) {
  let i = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size = (buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f);
    i = 10 + size + ((buf[5] & 0x10) ? 10 : 0);
  }
  let seconds = 0, frames = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3;          // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layerBits = (buf[i + 1] >> 1) & 3;    // 3 = I, 2 = II, 1 = III
    const brIdx = (buf[i + 2] >> 4) & 15;
    const srIdx = (buf[i + 2] >> 2) & 3;
    const pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) { i++; continue; }
    const layer = 4 - layerBits;
    const rate = RATES[ver][srIdx];
    const kbps = BITRATES[ver === 3 ? 1 : 2][layer][brIdx];
    const samples = layer === 1 ? 384 : layer === 2 ? 1152 : ver === 3 ? 1152 : 576;
    const len = layer === 1
      ? Math.floor((12 * kbps * 1000 / rate + pad) * 4)
      : Math.floor(samples / 8 * kbps * 1000 / rate) + pad;
    if (len < 4) { i++; continue; }
    seconds += samples / rate;
    frames++;
    i += len;
  }
  if (!frames) throw new Error('no MPEG audio frames found');
  return seconds;
}

export function m4aSeconds(buf) {
  function atoms(start, end, cb) {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      let head = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); head = 16; }
      else if (size === 0) size = end - p;
      if (size < head) break;
      if (cb(type, p + head, p + size) === false) return;
      p += size;
    }
  }
  let found = null;
  atoms(0, buf.length, (type, s, e) => {
    if (type !== 'moov') return true;
    atoms(s, e, (t, ms) => {
      if (t !== 'mvhd') return true;
      const v = buf[ms];
      found = v === 1
        ? Number(buf.readBigUInt64BE(ms + 24)) / buf.readUInt32BE(ms + 20)
        : buf.readUInt32BE(ms + 16) / buf.readUInt32BE(ms + 12);
      return false;
    });
    return false;
  });
  if (!found) throw new Error('no mvhd atom found');
  return found;
}

/* The container decides, not the file name: dealer-plates-b.mp3 is an MP4
   (AAC) file with an .mp3 name, and reading it as MPEG frames found false
   syncs and called a 97-second record 23 seconds long. An ISO media file
   says so at byte 4 ('ftyp'); anything else goes by its extension. */
export function audioSeconds(buf, ext) {
  if (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp') return m4aSeconds(buf);
  const e = String(ext || '').toLowerCase();
  return e === '.mp3' ? mp3Seconds(buf) : e === '.m4a' ? m4aSeconds(buf) : null;
}

/* WHAT A FILE REALLY IS, AND WHETHER IT STARTS FAST (music map 02 DEL-8, 01 PB-12).
   dealer-plates-b.mp3 was an MP4 (AAC) file under an .mp3 name, so it was served as
   audio/mp3 and an iPhone could refuse it; four MP4 files kept their index (the moov
   atom) after the audio (the mdat atom), so a player had to fetch the end of the file
   before it could make the first sound. A file the catalogue plays must be what its
   name says (an MP4 under .m4a, MPEG audio under .mp3), and an MP4 must carry its
   index before its audio. The fix for both is the same lossless remux:
     ffmpeg -i in -map 0 -c copy -movflags +faststart out.m4a
   Each problem is { kind: 'misnamed' | 'index-at-end' | 'no-index', detail }. */
export function containerProblems(buf, ext) {
  const e = String(ext || '').toLowerCase();
  const iso = buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp';
  const problems = [];
  if (iso && e !== '.m4a') problems.push({ kind: 'misnamed', detail: `an MP4 (AAC) file named ${e || 'without an extension'}; publish it as .m4a` });
  if (!iso && e === '.m4a') problems.push({ kind: 'misnamed', detail: 'not an MP4 file, but named .m4a' });
  if (!iso) return problems;
  let p = 0, moov = -1, mdat = -1;
  while (p + 8 <= buf.length) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let head = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); head = 16; }
    else if (size === 0) size = buf.length - p;
    if (size < head) break;
    if (type === 'moov' && moov < 0) moov = p;
    if (type === 'mdat' && mdat < 0) mdat = p;
    p += size;
  }
  if (moov < 0) problems.push({ kind: 'no-index', detail: 'no moov atom' });
  else if (mdat >= 0 && mdat < moov) problems.push({ kind: 'index-at-end', detail: `the index (moov at byte ${moov}) comes after the audio (mdat at byte ${mdat}); remux with -movflags +faststart` });
  return problems;
}

export function trackKey(track) {
  if (track.gated && track.gated.object) return String(track.gated.object).split('/')[0];
  return basename(String(track.src || ''), extname(String(track.src || '')));
}

/* data/albums.json with each ungated track's `seconds` set to its measured
   length (one decimal, the same figure as tracks.js). The file keeps its
   one-space indentation. A gated track's master is not in the repository,
   so it carries no `seconds` and its row is still measured in the browser. */
export function stampAlbums() {
  const doc = JSON.parse(readFileSync(ALBUMS, 'utf8'));
  for (const album of doc.albums) {
    for (const t of album.tracks || []) {
      if (t.gated) { delete t.seconds; continue; }
      const file = resolve(root, t.src);
      const seconds = audioSeconds(readFileSync(file), extname(file));
      if (!seconds) throw new Error(`${t.src}: unsupported audio type ${extname(file)}`);
      t.seconds = Math.round(seconds * 10) / 10;
    }
  }
  return JSON.stringify(doc, null, 1) + '\n';
}

/* Every file data/albums.json plays from the repository (a gated row plays its public
   preview), each checked once: [{ src, kind, detail }], empty when all are sound. */
export function catalogueContainerProblems() {
  const doc = JSON.parse(readFileSync(ALBUMS, 'utf8'));
  const seen = new Set(), out = [];
  for (const album of doc.albums) {
    for (const t of album.tracks || []) {
      const src = String(t.src || '');
      if (!/^assets\/audio\//.test(src) || seen.has(src)) continue;
      seen.add(src);
      const file = resolve(root, src);
      for (const p of containerProblems(readFileSync(file), extname(file))) out.push({ src, ...p });
    }
  }
  return out;
}

export function build() {
  const albums = JSON.parse(readFileSync(ALBUMS, 'utf8')).albums;
  const tracks = {};
  for (const album of albums) {
    for (const t of album.tracks || []) {
      const key = trackKey(t);
      if (!key) throw new Error(`${album.slug}: a track has no src`);
      if (tracks[key]) throw new Error(`${key} appears twice; keys must be unique`);
      if (t.gated) {
        /* The master is not in this repository, so its length is not
           measured here; the gate never needs it to count a finish. */
        tracks[key] = { title: t.title, album: album.slug, gated: true };
        continue;
      }
      const file = resolve(root, t.src);
      const buf = readFileSync(file);
      const seconds = audioSeconds(buf, extname(file));
      if (!seconds) throw new Error(`${t.src}: unsupported audio type ${extname(file)}`);
      tracks[key] = { title: t.title, album: album.slug, seconds: Math.round(seconds * 10) / 10 };
    }
  }
  return '/* Generated by scripts/music-track-lengths.mjs from data/albums.json and\n' +
    '   assets/audio. Do not edit by hand: re-run the script after adding a song. */\n' +
    'export const TRACKS = ' + JSON.stringify(tracks, null, 2) + ';\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = build();
  const albums = stampAlbums();
  const containers = catalogueContainerProblems();
  for (const p of containers) console.error(`${p.src}: ${p.kind}: ${p.detail}`);
  if (process.argv.includes('--check')) {
    let current = '', currentAlbums = '';
    try { current = readFileSync(OUT, 'utf8'); } catch {}
    try { currentAlbums = readFileSync(ALBUMS, 'utf8'); } catch {}
    if (current !== next || currentAlbums !== albums) {
      console.error('workers/mccluster/src/music/tracks.js or data/albums.json is stale: run node scripts/music-track-lengths.mjs');
      process.exit(1);
    }
    if (containers.length) process.exit(1);
    console.log('track lengths are current; every catalogue file is what its name says and starts fast');
  } else {
    writeFileSync(OUT, next);
    writeFileSync(ALBUMS, albums);
    console.log('wrote', OUT, 'and', ALBUMS);
    if (containers.length) process.exit(1);
  }
}
