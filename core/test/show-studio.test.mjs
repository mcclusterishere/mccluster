import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildBlenderArgs,
  normalizeShot,
  parseRenderLine,
  renderShotBoundaries,
  resolveAssetPath,
} from '../src/show-studio/blender-runtime.mjs';
import {
  buildAssemblyArgs,
  buildConcatFile,
  quoteConcatPath,
  assembleShow,
} from '../src/show-studio/assembly.mjs';

const ASSET_ROOT = '/srv/mccluster/assets';

function fakeSpawn({ stdout = '', code = 0 } = {}) {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf8'));
      child.emit('close', code, null);
    });
    return child;
  };
  return { spawnImpl, calls };
}

// ---- asset containment ----------------------------------------------------

test('an asset path outside the asset root is refused', () => {
  // A shot spec arrives on the job queue and may be model-written, so an
  // unconstrained path would be a file-read primitive.
  assert.throws(() => resolveAssetPath('../../etc/shadow', ASSET_ROOT), /escapes the asset root/);
  assert.throws(() => resolveAssetPath('/etc/shadow', ASSET_ROOT), /escapes the asset root/);
  assert.throws(() => resolveAssetPath('a/../../../etc/shadow', ASSET_ROOT), /escapes the asset root/);
});

test('an asset path inside the asset root resolves', () => {
  assert.equal(resolveAssetPath('env/street.glb', ASSET_ROOT), `${ASSET_ROOT}/env/street.glb`);
  assert.equal(resolveAssetPath('./env/../env/street.glb', ASSET_ROOT), `${ASSET_ROOT}/env/street.glb`);
});

// ---- shot normalization ---------------------------------------------------

test('a shot needs an id, a filename-safe one, and at least one asset', () => {
  assert.throws(() => normalizeShot({ assets: ['a.glb'] }, ASSET_ROOT), /requires an id/);
  assert.throws(() => normalizeShot({ id: '../escape', assets: ['a.glb'] }, ASSET_ROOT), /filename-safe/);
  assert.throws(() => normalizeShot({ id: 'shot-1', assets: [] }, ASSET_ROOT), /at least one asset/);
});

test('a shot fills in camera and lighting defaults without inventing assets', () => {
  const shot = normalizeShot({ id: 'shot-1', assets: ['env/street.glb'] }, ASSET_ROOT);
  assert.equal(shot.assets.length, 1);
  assert.equal(shot.assets[0].path, `${ASSET_ROOT}/env/street.glb`);
  assert.deepEqual(shot.assets[0].scale, [1, 1, 1]);
  assert.equal(shot.camera.focal_length, 40);
  assert.equal(shot.resolution.width, 1920);
});

test('a malformed camera vector falls back instead of reaching Blender', () => {
  const shot = normalizeShot(
    { id: 'shot-1', assets: ['a.glb'], camera: { start: ['x', 2, 3], focal_length: 9999 } },
    ASSET_ROOT
  );
  assert.deepEqual(shot.camera.start, [7, -7, 4]);
  assert.equal(shot.camera.focal_length, 300);
});

test('blender is invoked headless with factory startup so host config cannot alter a render', () => {
  const args = buildBlenderArgs({ specPath: '/tmp/spec.json' });
  assert.ok(args.includes('--background'));
  assert.ok(args.includes('--factory-startup'));
  assert.ok(args.includes('--spec=/tmp/spec.json'));
});

test('only MCCLUSTER_EVENT lines are parsed out of Blender chatter', () => {
  assert.equal(parseRenderLine('Fra:1 Mem:12M | Rendering'), null);
  assert.equal(parseRenderLine('MCCLUSTER_EVENT {not json}'), null);
  assert.deepEqual(parseRenderLine('MCCLUSTER_EVENT {"kind":"rendered","boundary":"first"}'), {
    kind: 'rendered',
    boundary: 'first',
  });
});

test('a render is only ok when both boundary frames were reported', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'show-render-'));
  const bothFrames = [
    'MCCLUSTER_EVENT {"kind":"rendered","boundary":"first","path":"a.png"}',
    'MCCLUSTER_EVENT {"kind":"rendered","boundary":"last","path":"b.png"}',
    '',
  ].join('\n');

  const good = fakeSpawn({ stdout: bothFrames });
  const ok = await renderShotBoundaries({
    shot: { id: 'shot-1', assets: ['a.glb'] },
    artifactRoot: dir,
    assetRoot: ASSET_ROOT,
    spawnImpl: good.spawnImpl,
  });
  assert.equal(ok.ok, true);
  assert.ok(ok.frames.first.endsWith('shot-1-first.png'));
  assert.ok(ok.frames.last.endsWith('shot-1-last.png'));

  // A model that interpolates between two frames cannot be handed one.
  const partial = fakeSpawn({
    stdout: 'MCCLUSTER_EVENT {"kind":"rendered","boundary":"first","path":"a.png"}\n',
  });
  const half = await renderShotBoundaries({
    shot: { id: 'shot-2', assets: ['a.glb'] },
    artifactRoot: dir,
    assetRoot: ASSET_ROOT,
    spawnImpl: partial.spawnImpl,
  });
  assert.equal(half.ok, false);
  assert.equal(half.frames, null);
});

test('the spec handed to Blender is written next to the frames', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'show-spec-'));
  const { spawnImpl } = fakeSpawn({ code: 1 });
  const evidence = await renderShotBoundaries({
    shot: { id: 'shot-3', assets: ['env/street.glb'], seed: 7 },
    artifactRoot: dir,
    assetRoot: ASSET_ROOT,
    spawnImpl,
  });
  const spec = JSON.parse(await readFile(evidence.spec_path, 'utf8'));
  assert.equal(spec.seed, 7);
  assert.equal(spec.assets[0].path, `${ASSET_ROOT}/env/street.glb`);
  assert.ok(spec.output.first.endsWith('shot-3-first.png'));
});

// ---- assembly -------------------------------------------------------------

test('a concat path with an apostrophe is escaped, not broken', () => {
  assert.equal(quoteConcatPath("/srv/it's/a.mp4"), "'/srv/it'\\''s/a.mp4'");
});

test('a concat path with a newline is refused rather than becoming a second directive', () => {
  assert.throws(() => quoteConcatPath("/srv/a.mp4\nfile '/etc/shadow'"), /may not contain a newline/);
});

test('the concat file lists every clip in order', () => {
  assert.equal(
    buildConcatFile(['/a/1.mp4', { path: '/a/2.mp4' }]),
    "file '/a/1.mp4'\nfile '/a/2.mp4'\n"
  );
  assert.throws(() => buildConcatFile([]), /at least one clip/);
});

test('with no audio the video is stream-copied', () => {
  const args = buildAssemblyArgs({ concatPath: '/t/c.txt', outputPath: '/t/out.mp4' });
  assert.ok(args.includes('-safe'));           // absolute concat paths need it
  assert.ok(args.join(' ').includes('-c copy'));
});

test('one audio track is mapped, several are mixed', () => {
  const single = buildAssemblyArgs({ concatPath: '/t/c.txt', audio: ['/t/score.wav'], outputPath: '/t/o.mp4' });
  assert.ok(single.includes('-shortest'));
  assert.ok(single.join(' ').includes('-map 1:a:0'));
  assert.equal(single.join(' ').includes('amix'), false);

  const many = buildAssemblyArgs({
    concatPath: '/t/c.txt',
    audio: ['/t/score.wav', '/t/sfx.wav'],
    outputPath: '/t/o.mp4',
  });
  assert.ok(many.join(' ').includes('amix=inputs=2'));
  assert.ok(many.join(' ').includes('-map [mix]'));
});

test('assembly reports the cut it produced', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'show-cut-'));
  const { spawnImpl, calls } = fakeSpawn({ code: 0 });
  const result = await assembleShow({
    clips: ['/a/1.mp4', '/a/2.mp4'],
    audio: ['/a/score.wav'],
    outputPath: path.join(dir, 'episode-1.mp4'),
    spawnImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.clip_count, 2);
  assert.equal(result.audio_track_count, 1);
  assert.equal(calls[0].binary, 'ffmpeg');
  assert.equal(await readFile(result.concat_path, 'utf8'), "file '/a/1.mp4'\nfile '/a/2.mp4'\n");
});

test('a non-zero ffmpeg exit is not reported as a finished cut', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'show-fail-'));
  const { spawnImpl } = fakeSpawn({ code: 1 });
  const result = await assembleShow({
    clips: ['/a/1.mp4'],
    outputPath: path.join(dir, 'episode-1.mp4'),
    spawnImpl,
  });
  assert.equal(result.ok, false);
});
