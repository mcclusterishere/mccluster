import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* THE ALBUM ROOM'S LIGHT IS MEASURED ONCE (music slice M1).

   The album room drew its light and its waveform by sending the deck through
   Web Audio and by downloading and decoding every song a second time; iOS
   silences Web Audio when the screen locks (music map 01 PB-1, 03 EXT-1, 00 G-8).
   scripts/music-peaks.mjs now measures every public catalogue file once and
   writes data/peaks/<file>.json; the page only reads it. A song added to
   data/albums.json without re-running the script, or a song whose audio changed,
   fails here instead of drawing a dark room for a listener. */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const peaks = await import('../music-peaks.mjs');

test('every public catalogue track has a fresh peaks file (run: node scripts/music-peaks.mjs)', () => {
  assert.deepEqual(peaks.check(), [], 'run: node scripts/music-peaks.mjs');
});

test('the catalogue the peaks cover is every public file of data/albums.json, and nothing private', () => {
  const albums = JSON.parse(readFileSync(join(ROOT, 'data/albums.json'), 'utf8'));
  const srcs = new Set();
  for (const a of albums.albums) for (const t of a.tracks) srcs.add(t.src);
  const files = peaks.catalogueFiles();
  assert.equal(files.length, srcs.size, 'one peaks file per public catalogue file');
  for (const f of files) {
    assert.ok(srcs.has(f.src), `${f.src} is in data/albums.json`);
    assert.match(f.src, /^assets\/audio\/[a-z0-9][a-z0-9._-]*\.(mp3|m4a)$/i, 'only the public audio folder is measured');
  }
  /* The gated closer: its row's public file is the preview, and that is all that is
     measured. Its master lives in private storage and is never read for its shape. */
  for (const a of albums.albums) for (const t of a.tracks) {
    if (!t.gated) continue;
    const master = String(t.gated.object).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
    assert.ok(files.some(f => f.src === t.src), `${t.title}: its public preview has peaks`);
    assert.ok(!files.some(f => f.key === master), `${t.title}: no peaks file is ever made from the private master`);
  }
  const written = readdirSync(join(ROOT, 'data/peaks')).filter(n => n.endsWith('.json')).sort();
  assert.deepEqual(written, files.map(f => f.key + '.json').sort(), 'data/peaks holds exactly the catalogue');
});

test('every peaks file has the shape the album room reads: 168 bars and three bands at 20 a second', () => {
  for (const f of peaks.catalogueFiles()) {
    const doc = JSON.parse(readFileSync(join(ROOT, 'data/peaks', f.key + '.json'), 'utf8'));
    assert.equal(doc.version, peaks.VERSION, f.key);
    assert.equal(doc.src, f.src, f.key);
    assert.match(doc.sha256, /^[0-9a-f]{64}$/, f.key);
    assert.ok(doc.seconds > 1 && doc.seconds < 600, `${f.key}: seconds ${doc.seconds}`);
    assert.equal(doc.bars.length, peaks.BARS, `${f.key}: bars`);
    assert.ok(doc.bars.every(v => typeof v === 'number' && v >= 0 && v <= 1), `${f.key}: bars within 0..1`);
    assert.equal(Math.max(...doc.bars), 1, `${f.key}: the loudest bar is the full height`);
    assert.equal(doc.light.rate, peaks.LIGHT_RATE, `${f.key}: light rate`);
    const bands = ['bass', 'mid', 'high'].map(b => Buffer.from(doc.light[b], 'base64'));
    assert.ok(bands.every(b => b.length === bands[0].length), `${f.key}: the three bands are the same length`);
    const expected = Math.ceil(doc.seconds * peaks.LIGHT_RATE);
    assert.ok(Math.abs(bands[0].length - expected) <= 2, `${f.key}: ${bands[0].length} light values for ${doc.seconds} s`);
    assert.ok(bands.some(b => b.some(v => v > 0)), `${f.key}: the light is not empty`);
  }
});

/* The light is the analyser js/chamber.js used to run on the deck, measured offline:
   a 512-point FFT with a Blackman window, 0.82 smoothing at 60 frames a second, dB
   between -100 and -30 as bytes, then bins 1-8 (bass), 9-47 (mid) and 48-139 (high). */
function tone(hz, seconds = 2, amp = 0.5, rate = peaks.RATE) {
  const n = Math.round(seconds * rate), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * hz * i / rate);
  return out;
}
function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function settled(light) {
  const from = Math.floor(light.bass.length / 2);
  return { bass: mean(light.bass.slice(from)), mid: mean(light.mid.slice(from)), high: mean(light.high.slice(from)) };
}

test('the measured bands answer like the analyser did: low, middle and high tones light their own band', () => {
  const low = settled(peaks.lightOf(tone(200)));
  const middle = settled(peaks.lightOf(tone(2000)));
  const high = settled(peaks.lightOf(tone(8000)));
  assert.ok(low.bass > low.mid && low.bass > low.high, `200 Hz lights the bass: ${JSON.stringify(low)}`);
  assert.ok(middle.mid > middle.high && middle.mid > low.mid, `2 kHz lights the middle: ${JSON.stringify(middle)}`);
  assert.ok(high.high > high.bass && high.high > low.high && high.high > middle.high, `8 kHz lights the top: ${JSON.stringify(high)}`);
  const quiet = peaks.lightOf(new Float32Array(peaks.RATE));
  assert.ok(['bass', 'mid', 'high'].every(b => quiet[b].every(v => v === 0)), 'silence is dark');
  assert.equal(quiet.bass.length, peaks.LIGHT_RATE, 'one second gives twenty values');
});

test('the waveform is the loudest sample of each of 168 slices, the loudest bar full height', () => {
  const left = new Float32Array(168 * 100);
  for (let i = 0; i < 168; i++) left[i * 100 + 50] = (i + 1) / 168 * 0.8;
  const bars = peaks.barsOf(left);
  assert.equal(bars.length, 168);
  assert.equal(bars[167], 1);
  assert.equal(bars[0], Math.round(1 / 168 * 1000) / 1000);
  assert.ok(bars.every((v, i) => i === 0 || v >= bars[i - 1]), 'a rising signal draws rising bars');
});

test('a peaks file is the same bytes every time it is written', () => {
  const mono = tone(440, 1.5, 0.3), left = tone(440, 1.5, 0.4);
  const one = peaks.render({ src: 'assets/audio/probe.mp3' }, 'a'.repeat(64), 1.5, peaks.barsOf(left), peaks.lightOf(mono));
  const two = peaks.render({ src: 'assets/audio/probe.mp3' }, 'a'.repeat(64), 1.5, peaks.barsOf(left), peaks.lightOf(mono));
  assert.equal(one, two);
  assert.ok(one.endsWith('\n'));
  const doc = JSON.parse(one);
  assert.deepEqual(Object.keys(doc), ['version', 'src', 'sha256', 'seconds', 'bars', 'light']);
  assert.deepEqual(Object.keys(doc.light), ['rate', 'bass', 'mid', 'high']);
});
