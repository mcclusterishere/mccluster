// Drive Blender headless to render the boundary frames of one shot.
//
// This is the piece that lets a show reuse the game's own assets instead of
// re-rolling a text prompt per shot. A shot names GLBs the media harness
// already produced, a camera move, and lighting; Blender renders the FIRST
// and LAST frame of that move deterministically. Those two frames are then
// handed to a first/last-frame video model (Wan 2.7 in the registry
// advertises supports_first_last_frame) which fills in the motion.
//
// Continuity therefore comes from geometry rather than from luck: two shots
// of the same environment are the same environment, because they are the
// same GLB under the same lamp.
//
// Blender is only ever invoked through this module. It is spawned the same
// way godot-runtime.mjs spawns Godot — injectable for tests, hard timeout,
// MCCLUSTER_EVENT lines on stdout, evidence written next to the frames.

import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blender', 'render_shot.py');

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function vector(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const out = value.map((n) => Number(n));
  return out.every((n) => Number.isFinite(n)) ? out : fallback;
}

export function resolveBlenderBinary(env = process.env) {
  return text(env.MCCLUSTER_BLENDER_BIN, 1000) || 'blender';
}

export function resolveAssetRoot({ env = process.env, cwd = process.cwd() } = {}) {
  return text(env.MCCLUSTER_SHOW_ASSET_ROOT, 2000) || path.join(cwd, '.mccluster-assets');
}

/** Resolve one asset path, refusing anything outside the asset root.
 *
 *  A shot spec arrives on the job queue and may have been written by a
 *  model. It names files Blender will open, so an unconstrained path is a
 *  file-read primitive: `../../../etc/shadow` baked into a render. Every
 *  asset therefore has to land inside the root, and an absolute path is
 *  rejected rather than silently honoured. */
export function resolveAssetPath(assetPath, assetRoot) {
  const raw = text(assetPath, 4000);
  if (!raw) throw new Error('shot asset requires a path');
  const root = path.resolve(assetRoot);
  const resolved = path.resolve(root, raw);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`shot asset escapes the asset root: ${raw}`);
  }
  return resolved;
}

/** Validate and normalize one shot into the spec the render script reads. */
export function normalizeShot(shot, assetRoot) {
  const id = text(shot?.id, 120);
  if (!id) throw new Error('shot requires an id');
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`shot id must be filename-safe: ${id}`);

  const rawAssets = Array.isArray(shot?.assets) ? shot.assets : [];
  if (!rawAssets.length) throw new Error(`shot ${id} requires at least one asset`);

  const assets = rawAssets.slice(0, 64).map((asset) => ({
    path: resolveAssetPath(typeof asset === 'string' ? asset : asset?.path, assetRoot),
    location: vector(asset?.location, [0, 0, 0]),
    rotation: vector(asset?.rotation, [0, 0, 0]),
    scale: vector(asset?.scale, [1, 1, 1]),
  }));

  const camera = shot?.camera || {};
  return {
    id,
    seed: integer(shot?.seed, 0, 0, 2_147_483_647),
    resolution: {
      width: integer(shot?.resolution?.width, 1920, 64, 7680),
      height: integer(shot?.resolution?.height, 1080, 64, 4320),
    },
    samples: integer(shot?.samples, 64, 1, 4096),
    assets,
    camera: {
      start: vector(camera.start, [7, -7, 4]),
      end: vector(camera.end, [5, -5, 3]),
      look_at: vector(camera.look_at, [0, 0, 1]),
      focal_length: integer(camera.focal_length, 40, 8, 300),
    },
    lighting: {
      sun_energy: Number.isFinite(Number(shot?.lighting?.sun_energy)) ? Number(shot.lighting.sun_energy) : 3,
      sun_rotation: vector(shot?.lighting?.sun_rotation, [0.9, 0, 0.6]),
      world_strength: Number.isFinite(Number(shot?.lighting?.world_strength)) ? Number(shot.lighting.world_strength) : 1,
    },
  };
}

export function buildBlenderArgs({ specPath, scriptPath = RENDER_SCRIPT }) {
  if (!specPath) throw new Error('blender runtime requires a spec path');
  return ['--background', '--factory-startup', '--python', scriptPath, '--', `--spec=${specPath}`];
}

export function parseRenderLine(line) {
  const prefix = 'MCCLUSTER_EVENT ';
  if (!line.startsWith(prefix)) return null;
  try {
    const value = JSON.parse(line.slice(prefix.length));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function ensureExecutable(binary) {
  if (!binary.includes('/')) return;
  await access(binary, fsConstants.X_OK);
}

/** Render the first and last frame of one shot's camera move. */
export async function renderShotBoundaries({
  shot,
  artifactRoot,
  assetRoot,
  env = process.env,
  spawnImpl = spawn,
  timeoutSeconds = 900,
} = {}) {
  const binary = resolveBlenderBinary(env);
  await ensureExecutable(binary);

  const root = resolveAssetRoot({ env });
  const normalized = normalizeShot(shot, assetRoot || root);

  const outputDir = artifactRoot || path.join(process.cwd(), '.mccluster-artifacts', 'shots', normalized.id);
  await mkdir(outputDir, { recursive: true });

  const spec = {
    ...normalized,
    output: {
      first: path.join(outputDir, `${normalized.id}-first.png`),
      last: path.join(outputDir, `${normalized.id}-last.png`),
    },
  };
  const specPath = path.join(outputDir, `${normalized.id}-spec.json`);
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

  const args = buildBlenderArgs({ specPath });
  const stdoutLines = [];
  const stderrLines = [];
  const events = [];

  const child = spawnImpl(binary, args, {
    cwd: outputDir,
    env: { ...env, MCCLUSTER_SHOT_ID: normalized.id },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buffer = '';
  const consume = (chunk) => {
    buffer += chunk.toString('utf8');
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';
    for (const line of parts) {
      stdoutLines.push(line);
      const event = parseRenderLine(line);
      if (event) events.push(event);
    }
  };

  child.stdout?.on('data', consume);
  child.stderr?.on('data', (chunk) => stderrLines.push(chunk.toString('utf8')));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  }, integer(timeoutSeconds, 900, 1, 21600) * 1000);
  timer.unref();

  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));

  if (buffer) consume(`${buffer}\n`);

  const rendered = events.filter((event) => event.kind === 'rendered');
  const ok = !timedOut && exit.code === 0 && rendered.length === 2;

  const evidence = {
    engine: 'blender',
    binary,
    args,
    shot: normalized,
    exit,
    timed_out: timedOut,
    ok,
    artifact_dir: outputDir,
    spec_path: specPath,
    frames: ok ? { first: spec.output.first, last: spec.output.last } : null,
    events,
    stdout_tail: stdoutLines.slice(-200),
    stderr_tail: stderrLines.join('').slice(-16000),
  };

  await writeFile(path.join(outputDir, `${normalized.id}-render-evidence.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}
