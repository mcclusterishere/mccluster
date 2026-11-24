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

   The same lengths bound how long js/listen-ledger.js lets each song's
   start wait for the previous song's finish (finishWaits below), so every
   song keeps half its margin; that table is written here too.

     node scripts/music-track-lengths.mjs          write all three
     node scripts/music-track-lengths.mjs --check  exit 1 if any is stale, or if a
                                                   catalogue file is not what its name
                                                   says or keeps its index at the end

   A track's key is its file name without the extension (a gated track
   uses its bucket folder), which is what the players send. */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNT_SHARE } from '../workers/mccluster/src/music/router.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'workers/mccluster/src/music/tracks.js');
const ALBUMS = resolve(root, 'data/albums.json');
const LEDGER = resolve(root, 'js/listen-ledger.js');

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
   index before its audio. The fix moves the index and nothing else:
     qt-faststart in out.m4a
   (ffmpeg's own tool: ftyp, then moov with its chunk offsets moved, then every other box
   byte for byte). Not a remux (ffmpeg -c copy -movflags +faststart): that rewrites the file
   and drops the encoder's gapless note (iTunSMPB), so a player decodes the encoder's padding
   as silence at the end (music slice M3 follow-up; reviews PB-R9, RL-13).
   Each problem is { kind: 'misnamed' | 'index-at-end' | 'no-index', detail }. */
export function containerProblems(buf, ext) {
  const e = String(ext || '').toLowerCase();
  const iso = buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp';
  const problems = [];
  if (iso && e !== '.m4a') problems.push({ kind: 'misnamed', detail: `an MP4 (AAC) file named ${e || 'without an extension'}; publish it as .m4a (qt-faststart in out.m4a, which also puts its index first)` });
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
  else if (mdat >= 0 && mdat < moov) problems.push({ kind: 'index-at-end', detail: `the index (moov at byte ${moov}) comes after the audio (mdat at byte ${mdat}); move it with qt-faststart, not a remux` });
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

/* HOW LONG EACH SONG'S START MAY WAIT FOR THE LAST ONE'S FINISH (music slice M3 follow-up; reviews PB-R10 and RF-1).
   js/listen-ledger.js holds the next song's start until the previous song's finish has answered, so the database
   never closes a song heard to the end as unfinished (DEL-4). But a listen is credited from the moment its start
   reaches the database, and the Worker counts it once floor(seconds x COUNT_SHARE) seconds are heard
   (workers/mccluster/src/music/router.js): whatever the start waits comes out of that song's own margin. So each song
   waits half its own margin, and the other half is left for what the page cannot time (its start's own trip, a hidden
   page's late timers); never more than FINISH_WAIT_CAP_MS, so a finish that never answers cannot hold a start for
   long. One wait for every song, half the smallest margin (1.85 s), kept the shortest song's count but cost the song
   just heard whenever its finish took longer than that, before every song: a completed listen answers the song test
   and earns the gated closer's play. A gated track is left out: its master is not here, the gated record never
   counts toward itself, and a song the table does not hold waits the cap (the server counts no listen of it).
   Margins are whole tenths of a second, so each wait is a whole 50 ms. */
export const FINISH_WAIT_CAP_MS = 5000;
export function finishWaits() {
  const albums = JSON.parse(readFileSync(ALBUMS, 'utf8')).albums;
  const songs = [];
  for (const album of albums) {
    for (const t of album.tracks || []) {
      if (t.gated) continue;
      const file = resolve(root, t.src);
      const seconds = Math.round(audioSeconds(readFileSync(file), extname(file)) * 10) / 10;
      const need = Math.max(1, Math.floor(seconds * COUNT_SHARE));
      const tenths = Math.round((seconds - need) * 10);
      songs.push({ key: trackKey(t), title: t.title, seconds, need, margin: tenths / 10, ms: Math.min(FINISH_WAIT_CAP_MS, tenths * 50) });
    }
  }
  const least = songs.reduce((a, s) => (!a || s.margin < a.margin ? s : a), null);
  const ms = {};
  for (const s of [...songs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) ms[s.key] = s.ms;
  return { cap: FINISH_WAIT_CAP_MS, least, ms };
}
const WAIT_BEGIN = /^(\s*)\/\* FINISH WAIT BEGIN[^\n]*\n/m, WAIT_END = /^\s*\/\* FINISH WAIT END \*\/\n/m;
/* js/listen-ledger.js with the waits written between its FINISH WAIT BEGIN and FINISH WAIT END lines */
export function ledgerWithWait(src, waits = finishWaits()) {
  const b = WAIT_BEGIN.exec(src), e = WAIT_END.exec(src);
  if (!b || !e || e.index < b.index) throw new Error('js/listen-ledger.js: no FINISH WAIT BEGIN / FINISH WAIT END block');
  const pad = b[1], least = waits.least;
  const lines = [];
  let line = '';
  for (const [key, ms] of Object.entries(waits.ms)) {
    const item = `${JSON.stringify(key)}: ${ms}`;
    if (line && (pad + '  ' + line + ', ' + item + ',').length > 118) { lines.push(line + ','); line = item; }
    else line = line ? line + ', ' + item : item;
  }
  if (line) lines.push(line);
  const body = `${pad}/* each song's wait in ms: half its own margin, ${waits.cap / 1000} s at most; the smallest is ${least.title}'s,\n` +
    `${pad}   half of ${least.margin} s (${least.seconds} s, counted after ${least.need} s) */\n` +
    `${pad}var FINISH_WAIT_CAP_MS = ${waits.cap};\n` +
    `${pad}var FINISH_WAIT_MS = {\n` + lines.map((l) => `${pad}  ${l}\n`).join('') + `${pad}};\n`;
  return src.slice(0, b.index + b[0].length) + body + src.slice(e.index);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = build();
  const albums = stampAlbums();
  const ledgerNow = readFileSync(LEDGER, 'utf8');
  const ledger = ledgerWithWait(ledgerNow);
  const containers = catalogueContainerProblems();
  for (const p of containers) console.error(`${p.src}: ${p.kind}: ${p.detail}`);
  if (process.argv.includes('--check')) {
    let current = '', currentAlbums = '';
    try { current = readFileSync(OUT, 'utf8'); } catch {}
    try { currentAlbums = readFileSync(ALBUMS, 'utf8'); } catch {}
    if (current !== next || currentAlbums !== albums || ledgerNow !== ledger) {
      console.error('workers/mccluster/src/music/tracks.js, data/albums.json or js/listen-ledger.js is stale: run node scripts/music-track-lengths.mjs');
      process.exit(1);
    }
    if (containers.length) process.exit(1);
    console.log('track lengths are current; every catalogue file is what its name says and starts fast; the listen ledger\'s waits fit each song');
  } else {
    writeFileSync(OUT, next);
    writeFileSync(ALBUMS, albums);
    writeFileSync(LEDGER, ledger);
    console.log('wrote', OUT, ALBUMS, 'and', LEDGER);
    if (containers.length) process.exit(1);
  }
}
