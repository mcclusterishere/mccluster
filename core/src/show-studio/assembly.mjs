// Cut finished shots into one deliverable.
//
// The media harness could generate shots but never join them, which is why
// the platform could mint ten-second clips and not a show. This is the
// join: an ffmpeg concat of the rendered shots plus an optional audio bed,
// spawned the same injectable way as the Blender and Godot runtimes.
//
// Concat is done through the demuxer rather than the filter graph because
// the shots are already encoded identically upstream; the demuxer copies
// them instead of re-encoding every shot on every assembly pass.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function resolveFfmpegBinary(env = process.env) {
  return text(env.MCCLUSTER_FFMPEG_BIN, 1000) || 'ffmpeg';
}

/** Quote one path for the concat demuxer.
 *
 *  The demuxer reads `file '<path>'`, so a literal apostrophe has to close
 *  the quote, escape itself, and reopen — the usual '\'' dance. A path
 *  carrying a newline cannot be represented at all and is refused rather
 *  than written out to become a second, attacker-chosen directive line. */
export function quoteConcatPath(value) {
  const raw = text(value, 4000);
  if (!raw) throw new Error('concat entry requires a path');
  if (/[\r\n]/.test(raw)) throw new Error(`concat path may not contain a newline: ${JSON.stringify(raw)}`);
  return `'${raw.replace(/'/g, "'\\''")}'`;
}

export function buildConcatFile(clips) {
  const list = Array.isArray(clips) ? clips : [];
  if (!list.length) throw new Error('assembly requires at least one clip');
  return `${list.map((clip) => `file ${quoteConcatPath(typeof clip === 'string' ? clip : clip?.path)}`).join('\n')}\n`;
}

/** ffmpeg arguments for one assembly pass.
 *
 *  `-safe 0` is required because the concat entries are absolute paths.
 *  With no audio the video is stream-copied; with audio it is still copied
 *  and only the audio is encoded, so assembly cost does not scale with the
 *  number of times a cut is revised. */
export function buildAssemblyArgs({ concatPath, audio = [], outputPath, fps = 24 }) {
  if (!concatPath) throw new Error('assembly requires a concat file');
  if (!outputPath) throw new Error('assembly requires an output path');
  const tracks = (Array.isArray(audio) ? audio : [audio]).map((item) => text(typeof item === 'string' ? item : item?.path)).filter(Boolean);

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath];
  for (const track of tracks) args.push('-i', track);

  if (!tracks.length) {
    args.push('-c', 'copy');
  } else if (tracks.length === 1) {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest');
  } else {
    const inputs = tracks.map((_, index) => `[${index + 1}:a]`).join('');
    args.push(
      '-filter_complex', `${inputs}amix=inputs=${tracks.length}:duration=longest:normalize=0[mix]`,
      '-map', '0:v:0', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-shortest'
    );
  }

  args.push('-r', String(integer(fps, 24, 1, 120)), outputPath);
  return args;
}

/** Concatenate shots into one file and report what was produced. */
export async function assembleShow({
  clips,
  audio = [],
  outputPath,
  workDir,
  fps = 24,
  env = process.env,
  spawnImpl = spawn,
  timeoutSeconds = 1800,
} = {}) {
  if (!outputPath) throw new Error('assembly requires an output path');
  const binary = resolveFfmpegBinary(env);
  const dir = workDir || path.dirname(outputPath);
  await mkdir(dir, { recursive: true });

  const concatPath = path.join(dir, 'concat.txt');
  await writeFile(concatPath, buildConcatFile(clips), 'utf8');

  const args = buildAssemblyArgs({ concatPath, audio, outputPath, fps });
  const stderrLines = [];

  const child = spawnImpl(binary, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr?.on('data', (chunk) => stderrLines.push(chunk.toString('utf8')));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  }, integer(timeoutSeconds, 1800, 1, 21600) * 1000);
  timer.unref();

  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));

  return {
    tool: 'ffmpeg',
    binary,
    args,
    concat_path: concatPath,
    output_path: outputPath,
    clip_count: Array.isArray(clips) ? clips.length : 0,
    audio_track_count: (Array.isArray(audio) ? audio : [audio]).filter(Boolean).length,
    exit,
    timed_out: timedOut,
    ok: !timedOut && exit.code === 0,
    stderr_tail: stderrLines.join('').slice(-16000),
  };
}
