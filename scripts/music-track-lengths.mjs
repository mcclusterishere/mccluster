#!/usr/bin/env node
/* SONG LENGTHS FOR THE SERVER.

   The listen ledger (workers/mccluster/src/music/) only counts a song as
   finished when real time between its start and its end covers the song.
   That needs every song's length on the server, where a listener cannot
   edit it, so this reads the lengths out of the committed audio files and
   writes them next to the Worker code (workers/mccluster/src/music/tracks.js).

   No ffmpeg: MP3 length is the sum of its frames, and M4A length is the
   movie header's duration over its timescale. Both are exact.

     node scripts/music-track-lengths.mjs          write the file
     node scripts/music-track-lengths.mjs --check  exit 1 if it is stale

   A track's key is its file name without the extension (a gated track
   uses its bucket folder), which is what the players send. */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'workers/mccluster/src/music/tracks.js');

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

export function trackKey(track) {
  if (track.gated && track.gated.object) return String(track.gated.object).split('/')[0];
  return basename(String(track.src || ''), extname(String(track.src || '')));
}

export function build() {
  const albums = JSON.parse(readFileSync(resolve(root, 'data/albums.json'), 'utf8')).albums;
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
      const ext = extname(file).toLowerCase();
      const seconds = ext === '.mp3' ? mp3Seconds(buf) : ext === '.m4a' ? m4aSeconds(buf) : null;
      if (!seconds) throw new Error(`${t.src}: unsupported audio type ${ext}`);
      tracks[key] = { title: t.title, album: album.slug, seconds: Math.round(seconds * 10) / 10 };
    }
  }
  return '/* Generated by scripts/music-track-lengths.mjs from data/albums.json and\n' +
    '   assets/audio. Do not edit by hand: re-run the script after adding a song. */\n' +
    'export const TRACKS = ' + JSON.stringify(tracks, null, 2) + ';\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = build();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUT, 'utf8'); } catch {}
    if (current !== next) {
      console.error('workers/mccluster/src/music/tracks.js is stale: run node scripts/music-track-lengths.mjs');
      process.exit(1);
    }
    console.log('track lengths are current');
  } else {
    writeFileSync(OUT, next);
    console.log('wrote', OUT);
  }
}
