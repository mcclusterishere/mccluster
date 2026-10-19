#!/usr/bin/env node
/* Offline/server-side resonance feature extraction for artist-owned audio.
 * This does not upload audio, modify a master, or authorize publication.
 * Usage:
 *   node scripts/music-resonance-analyze.mjs song.wav --output out.json
 *   node scripts/music-resonance-analyze.mjs song.mp3 --output out.json
 *   node scripts/music-resonance-analyze.mjs --trackouts drums.wav bass.wav vocal.wav
 * MP3/AAC/FLAC require locally installed ffmpeg. Native PCM WAV works without it.
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { analyzePcm, analyzeTrackouts } from "../js/resonance/core.mjs";
import { estimateMusicTheory } from "../js/resonance/theory.mjs";

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 180;
const DECODER_SAMPLE_RATE = 22050;

function decodeWav(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE") throw Error("Invalid RIFF/WAVE file");
  let format = null, dataOffset = -1, dataLength = 0;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", p, p + 4), size = bytes.readUInt32LE(p + 4);
    if (p + 8 + size > bytes.length) throw Error("Truncated WAV chunk");
    if (id === "fmt ") {
      if (size < 16) throw Error("Unsupported WAV fmt chunk");
      format = {
        kind: bytes.readUInt16LE(p + 8), channels: bytes.readUInt16LE(p + 10),
        rate: bytes.readUInt32LE(p + 12), align: bytes.readUInt16LE(p + 20),
        bits: bytes.readUInt16LE(p + 22)
      };
      if (format.kind === 65534 && size >= 40) {
        format.kind = bytes.readUInt16LE(p + 32);
      }
    } else if (id === "data") { dataOffset = p + 8; dataLength = size; }
    p += 8 + size + (size % 2);
  }
  if (!format || dataOffset < 0) throw Error("WAV fmt or data missing");
  const {kind, channels, rate, align, bits} = format;
  const sampleWidth = bits / 8;
  if (![1, 3].includes(kind) || ![16, 24, 32].includes(bits) ||
      (kind === 3 && bits !== 32) || !Number.isInteger(sampleWidth) ||
      channels < 1 || channels > 16 || align !== channels * sampleWidth ||
      rate < 8000 || rate > 192000) {
    throw Error("WAV must be PCM16/24/32 or floating-point 32-bit, 8–192kHz");
  }
  const count = Math.min(Math.floor(dataLength / align),
    Math.floor(rate * MAX_DURATION_SECONDS));
  if (count < 256) throw Error("Audio must contain at least 256 samples");
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataOffset + i * align + c * sampleWidth;
      let value;
      if (kind === 3) value = bytes.readFloatLE(p);
      else if (bits === 16) value = bytes.readInt16LE(p) / 32768;
      else if (bits === 24) {
        let n = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
        if (n & 0x800000) n |= ~0xffffff;
        value = n / 8388608;
      } else value = bytes.readInt32LE(p) / 2147483648;
      sum += Number.isFinite(value) ? value : 0;
    }
    samples[i] = sum / channels;
  }
  return {samples, sampleRate: rate};
}

function decodeFfmpeg(file) {
  const p = spawnSync("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-i", file,
    "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", String(MAX_DURATION_SECONDS),
    "-ac", "1", "-ar", String(DECODER_SAMPLE_RATE), "-f", "f32le", "pipe:1"
  ], { encoding: null, timeout: 120000,
    maxBuffer: DECODER_SAMPLE_RATE * MAX_DURATION_SECONDS * 4 + 1048576 });
  if (p.error) throw Error("ffmpeg unavailable or decode failed: " + p.error.message);
  if (p.status !== 0) throw Error("ffmpeg could not decode audio: " +
    String(p.stderr || "").slice(0, 500));
  if (!p.stdout || p.stdout.length < 1024) throw Error("Audio decode returned no PCM");
  const samples = new Float32Array(Math.floor(p.stdout.length / 4));
  for (let i = 0; i < samples.length; i++) {
    const v = p.stdout.readFloatLE(i * 4);
    samples[i] = Number.isFinite(v) ? v : 0;
  }
  return { samples, sampleRate: DECODER_SAMPLE_RATE };
}

export function decodeLocal(file) {
  if (statSync(file).size > MAX_SOURCE_BYTES) throw Error("Source exceeds 100 MiB cap");
  return extname(file).toLowerCase() === ".wav" ? decodeWav(file) : decodeFfmpeg(file);
}

export function analyzePaths(files, { trackouts = false } = {}) {
  if (!files.length || files.length > 32) throw Error("1–32 audio files required");
  if (files.length > 1 && !trackouts) throw Error("Use --trackouts for multiple aligned files");
  const entries = files.map(file => ({name:basename(file), ...decodeLocal(file)}));
  const result = trackouts
    ? analyzeTrackouts(entries, {maxSeconds:MAX_DURATION_SECONDS})
    : analyzePcm(entries[0].samples, entries[0].sampleRate,
      {maxSeconds:MAX_DURATION_SECONDS});
  const theory = trackouts ? (() => {
    const length=Math.min(...entries.map(e=>e.samples.length));
    const sum=new Float32Array(length);
    for(const e of entries)for(let i=0;i<length;i++)sum[i]+=e.samples[i]/entries.length;
    return {combined:estimateMusicTheory(sum,entries[0].sampleRate),
      stems:entries.map(e=>({name:e.name,theory:estimateMusicTheory(e.samples,e.sampleRate)})),
      note:"Combined key/tempo reflects an aligned equal-gain estimate; not the mastered mix."};
  })() : estimateMusicTheory(entries[0].samples,entries[0].sampleRate);
  return {
    ...result,
    musicTheory:theory,
    pipeline: { kind: "offline-audio-analysis", version: "v1",
      sampleLimitSeconds: MAX_DURATION_SECONDS,
      originalMix: false, individualStems: trackouts, autonomousGeneClaim: false },
    input: entries.map(({name, sampleRate, samples}) => ({
      name, sampleRate, decodedSeconds: Number((samples.length / sampleRate).toFixed(3))
    }))
  };
}

const invoked = process.argv[1] && /music-resonance-analyze\.mjs$/.test(process.argv[1]);
if (invoked) {
  try {
    const args = process.argv.slice(2);
    const trackouts = args.includes("--trackouts");
    let output = null, files = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--trackouts") continue;
      if (args[i] === "--output") {
        output = args[++i]; if (!output) throw Error("--output requires a file");
      } else if (args[i].startsWith("--")) throw Error("Unknown argument: " + args[i]);
      else files.push(args[i]);
    }
    const result = JSON.stringify(analyzePaths(files, {trackouts}), null, 2) + "\n";
    if (output) writeFileSync(output, result, {flag:"wx",mode:0o600});
    else process.stdout.write(result);
  } catch (error) {
    process.stderr.write("[resonance] " + error.message + "\n");
    process.exitCode = 1;
  }
}
