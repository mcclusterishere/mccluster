#!/usr/bin/env node
/* THE ALBUM ROOM'S LIGHT, MEASURED ONCE.

   The album room (album.html) used to send its deck through Web Audio: js/chamber.js
   wired the <audio id="deck"> into an AnalyserNode so the GPU silk, the EQ bars and the
   --amp glow rode the record, and js/filament.js downloaded every song a second time and
   decoded all of it to draw the seek bar's waveform. iOS keeps a plain <audio> element
   playing when the screen locks and silences Web Audio in the background, so the album
   went quiet when Matthew left Safari (music map 01 PB-1, 03 EXT-1, 00 G-8; decision D-3,
   a default pending his review). The light is measured here instead, once, from the
   same file the deck plays, and the page reads it at the deck's current second.

   For every public catalogue file in data/albums.json (assets/audio/<name>.mp3|m4a) this
   decodes the file with ffmpeg and writes data/peaks/<name>.json:
     bars    168 peaks for the waveform: the left channel's loudest sample in each of 168
             equal slices, scaled so the loudest is 1 (what js/filament.js drew from its own
             decode, every sample read instead of every 64th)
     light   the three bands js/chamber.js read from its analyser, 20 times a second: the
             mono mix through a 512-point FFT with a Blackman window, magnitudes smoothed at
             0.82 per frame at 60 frames a second, -100 to -30 dB as bytes, then the mean of
             bins 1-8 (bass), 9-47 (mid) and 48-139 (high), each a byte (0-255), base64
     sha256  of the audio file, so a song whose audio changes has stale peaks
   <name> is the file's name without its extension, lower case: the same key the listen
   ledger uses for a public song. No private or gated master is ever read: the gated
   closer's row has a public preview (assets/audio/niggy-nigg-preview.mp3) and that is
   what is measured; its master never leaves private storage and the page gives it a
   quiet, even light (js/peaks.js).

     node scripts/music-peaks.mjs           write every missing or stale data/peaks file
     node scripts/music-peaks.mjs --all     write every file again
     node scripts/music-peaks.mjs --check   exit 1 when a catalogue file has no peaks or a
                                            stale one (reads the audio and the JSON; no ffmpeg)

   The same audio file and the same ffmpeg decode give the same bytes: no time stamps, a
   fixed key order, rounded numbers. */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALBUMS = resolve(root, 'data/albums.json');
export const PEAKS_DIR = resolve(root, 'data/peaks');
export const VERSION = 1;
export const BARS = 168;
export const LIGHT_RATE = 20;                  // light values a second
export const RATE = 48000;                     // decode rate: what a phone's audio hardware runs at
const FFT = 512, FRAME_RATE = 60, SMOOTHING = 0.82, MIN_DB = -100, MAX_DB = -30;
const BANDS = [['bass', 1, 9], ['mid', 9, 48], ['high', 48, 140]];   // [band, first bin, bin after], js/chamber.js's bins

/* the public catalogue files, one entry per file, in name order */
export function catalogueFiles() {
  const doc = JSON.parse(readFileSync(ALBUMS, 'utf8'));
  const byKey = new Map();
  for (const album of doc.albums || []) {
    for (const t of album.tracks || []) {
      const src = String(t.src || '');
      const m = /^assets\/audio\/([a-z0-9][a-z0-9._-]*)\.(?:mp3|m4a)$/i.exec(src);
      if (!m) continue;
      const key = m[1].toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { key, src, file: resolve(root, src) });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

/* ffmpeg decodes to interleaved stereo 32-bit floats at RATE; mono sources are doubled */
function decode(file) {
  const r = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0',
    '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], { maxBuffer: 1 << 30 });
  if (r.error) throw new Error(`ffmpeg could not run (${r.error.message}): install ffmpeg to write peaks`);
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${String(r.stderr || '').trim()}`);
  const view = new DataView(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength);
  const frames = Math.floor(r.stdout.byteLength / 8);
  const left = new Float32Array(frames), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const l = view.getFloat32(i * 8, true), rr = view.getFloat32(i * 8 + 4, true);
    left[i] = l; mono[i] = 0.5 * (l + rr);
  }
  return { left, mono, seconds: frames / RATE };
}

/* the waveform: the loudest sample of each of BARS equal slices, the loudest bar 1 */
export function barsOf(left) {
  const per = Math.floor(left.length / BARS), out = new Array(BARS).fill(0);
  let max = 0;
  for (let i = 0; i < BARS; i++) {
    let m = 0;
    for (let j = i * per, end = j + per; j < end; j++) { const v = Math.abs(left[j]); if (v > m) m = v; }
    out[i] = m;
    if (m > max) max = m;
  }
  return out.map(v => (max > 0 ? Math.round((v / max) * 1000) / 1000 : 0));
}

/* in-place radix-2 FFT of a FFT-point complex signal */
const TWIDDLE_RE = new Float64Array(FFT / 2), TWIDDLE_IM = new Float64Array(FFT / 2), REVERSED = new Uint16Array(FFT);
for (let k = 0; k < FFT / 2; k++) { TWIDDLE_RE[k] = Math.cos((-2 * Math.PI * k) / FFT); TWIDDLE_IM[k] = Math.sin((-2 * Math.PI * k) / FFT); }
for (let i = 0, bits = Math.log2(FFT); i < FFT; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  REVERSED[i] = r;
}
function fft(re, im) {
  for (let i = 0; i < FFT; i++) {
    const j = REVERSED[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= FFT; size <<= 1) {
    const half = size >> 1, step = FFT / size;
    for (let start = 0; start < FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = TWIDDLE_RE[k * step], wi = TWIDDLE_IM[k * step];
        const a = start + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/* the light: what the AnalyserNode would have handed js/chamber.js, 20 times a second */
export function lightOf(mono, rate = RATE) {
  const window = new Float64Array(FFT);
  for (let n = 0; n < FFT; n++) window[n] = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / FFT) + 0.08 * Math.cos((4 * Math.PI * n) / FFT);
  const smooth = new Float64Array(FFT / 2), bytes = new Uint8Array(FFT / 2);
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  const hop = rate / FRAME_RATE, step = FRAME_RATE / LIGHT_RATE;
  const frames = Math.ceil(mono.length / hop);
  const out = { bass: [], mid: [], high: [] };
  for (let f = 0; f < frames; f++) {
    const end = Math.round(f * hop);
    for (let n = 0; n < FFT; n++) {
      const s = end - FFT + n;
      re[n] = (s >= 0 && s < mono.length ? mono[s] : 0) * window[n];
      im[n] = 0;
    }
    fft(re, im);
    for (let k = 0; k < FFT / 2; k++) {
      smooth[k] = SMOOTHING * smooth[k] + (1 - SMOOTHING) * (Math.hypot(re[k], im[k]) / FFT);
      const b = Math.floor((255 / (MAX_DB - MIN_DB)) * (20 * Math.log10(smooth[k]) - MIN_DB));
      bytes[k] = b > 255 ? 255 : b > 0 ? b : 0;    // -Infinity (silence) and anything below -100 dB is 0
    }
    if (f % step !== 0) continue;
    for (const [band, from, to] of BANDS) {
      let sum = 0;
      for (let k = from; k < to; k++) sum += bytes[k];
      out[band].push(Math.round(sum / (to - from)));
    }
  }
  return out;
}

/* one peaks file, always the same bytes for the same measure */
export function render(entry, sha, seconds, bars, light) {
  const b64 = values => Buffer.from(Uint8Array.from(values)).toString('base64');
  const fields = [
    ['version', VERSION],
    ['src', entry.src],
    ['sha256', sha],
    ['seconds', Math.round(seconds * 100) / 100],
    ['bars', bars],
    ['light', { rate: LIGHT_RATE, bass: b64(light.bass), mid: b64(light.mid), high: b64(light.high) }],
  ];
  return '{\n' + fields.map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n';
}

export function measure(entry) {
  const buf = readFileSync(entry.file);
  const { left, mono, seconds } = decode(entry.file);
  return render(entry, sha256(buf), seconds, barsOf(left), lightOf(mono));
}

/* what is missing or stale, as sentences; [] when every catalogue file is current */
export function check() {
  const problems = [];
  const files = catalogueFiles();
  for (const e of files) {
    const path = join(PEAKS_DIR, e.key + '.json');
    if (!existsSync(path)) { problems.push(`${e.src}: no peaks (data/peaks/${e.key}.json)`); continue; }
    let doc = null;
    try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch { problems.push(`data/peaks/${e.key}.json: not readable JSON`); continue; }
    if (doc.version !== VERSION) { problems.push(`data/peaks/${e.key}.json: measured by version ${doc.version}, this script writes ${VERSION}`); continue; }
    if (doc.src !== e.src) problems.push(`data/peaks/${e.key}.json: measures ${doc.src}, the catalogue plays ${e.src}`);
    if (doc.sha256 !== sha256(readFileSync(e.file))) problems.push(`${e.src}: stale peaks (the audio changed after data/peaks/${e.key}.json was measured)`);
  }
  if (existsSync(PEAKS_DIR)) {
    const keys = new Set(files.map(e => e.key + '.json'));
    for (const name of readdirSync(PEAKS_DIR)) if (name.endsWith('.json') && !keys.has(name)) problems.push(`data/peaks/${name}: no catalogue file uses it`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = check();
    if (problems.length) {
      for (const p of problems) console.error(p);
      console.error('run: node scripts/music-peaks.mjs');
      process.exit(1);
    }
    console.log(`peaks are current (${catalogueFiles().length} files)`);
  } else {
    const all = process.argv.includes('--all');
    mkdirSync(PEAKS_DIR, { recursive: true });
    const files = catalogueFiles(), stale = new Set(check().map(p => p.split(':')[0]));
    let wrote = 0;
    for (const e of files) {
      const path = join(PEAKS_DIR, e.key + '.json');
      if (!all && existsSync(path) && !stale.has(e.src) && !stale.has(`data/peaks/${e.key}.json`)) continue;
      writeFileSync(path, measure(e));
      wrote++;
      console.log('wrote', `data/peaks/${e.key}.json`);
    }
    const keys = new Set(files.map(e => e.key + '.json'));
    for (const name of readdirSync(PEAKS_DIR)) {
      if (name.endsWith('.json') && !keys.has(name)) { unlinkSync(join(PEAKS_DIR, name)); console.log('removed', `data/peaks/${name}`); }
    }
    console.log(`${wrote} written, ${files.length} catalogue files`);
  }
}
