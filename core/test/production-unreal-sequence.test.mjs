// Unreal sequence mode: the typed job (approved Unreal project and Level
// Sequence by id + the shot range), the owner's registry on the node, the
// GPU read from the engine's own log, a fresh output folder per run, the
// approved project left untouched, and no success without a valid artifact.
// Every editor run here is SIMULATED (tests/helpers simulateInEditorRender);
// the real render is verified on Prime (docs/control-plane/PRODUCTION-PIPELINE.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createProductionExecutor, loadExecutorConfig } from '../src/production/executor.mjs';
import { normalizeShotRender, manifestHash, planRetake, PRODUCTION_PROTOCOL, validateRenderOutput, validateShotAgainstProject } from '../src/production/contract.mjs';
import { editorArgs, frameRun, loadUnrealRegistry, parseUnrealLog, verifyDevice } from '../src/production/unreal-sequence.mjs';
import { RADEON_LOG, WARP_LOG, project, s31SequenceAsset, s31SequenceManifest, simulateInEditorRender } from './helpers/production-fixtures.mjs';

const FAKE_UE = { ok: true, name: 'unreal', version: '5.8.4', changelist: 58902052, supported: true, editor: '/ue/UnrealEditor', editor_cmd: '/ue/UnrealEditor-Cmd', plugins: { python: true, movie_render_pipeline: true } };

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-ue-seq-'));
  const root = path.join(dir, 'get-it-back');
  fs.mkdirSync(root, { recursive: true });
  const proof = path.join(dir, 'proof', 'GIBProof');
  fs.mkdirSync(path.join(proof, 'Content', 'Proof'), { recursive: true });
  fs.mkdirSync(path.join(proof, 'Config'), { recursive: true });
  fs.mkdirSync(path.join(proof, 'Saved', 'Logs'), { recursive: true });
  fs.writeFileSync(path.join(proof, 'GIBProof.uproject'), JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8' }));
  fs.writeFileSync(path.join(proof, 'Content', 'Proof', 'S31_Seq.uasset'), 'sequence');
  fs.writeFileSync(path.join(proof, 'Content', 'Proof', 'S31_Map.umap'), 'map');
  fs.writeFileSync(path.join(proof, 'Config', 'DefaultEngine.ini'), '[/Script/WindowsTargetPlatform.WindowsTargetSettings]\nDefaultGraphicsRHI=DefaultGraphicsRHI_DX12\n');
  fs.writeFileSync(path.join(proof, 'Saved', 'Logs', 'GIBProof.log'), 'old log');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const tools = { unreal_root: path.join(dir, 'UE_5.8') };
  for (const name of ['ffmpeg', 'ffprobe']) { tools[name] = path.join(bin, name); fs.writeFileSync(tools[name], ''); }
  const registry = {
    'gib-s31-proof': {
      production_project: 'get-it-back', uproject: path.join(proof, 'GIBProof.uproject'), isolate: 'copy', rhi: 'd3d12', require_adapter: 'Radeon',
      sequences: { 's31-standin': { map: '/Game/Proof/S31_Map', sequence: '/Game/Proof/S31_Seq', shot_ids: ['s31'], frame_start: 0, frame_end: 119, settings: { spatial_samples: 1, temporal_samples: 1 } } }
    }
  };
  return { dir, root, proof, tools, registry };
}

function job(raw) {
  const manifest = normalizeShotRender(raw);
  return { capability: 'production.render.unreal', input: { protocol: PRODUCTION_PROTOCOL, job_id: crypto.randomUUID(), kind: 'render', manifest, manifest_sha256: manifestHash(manifest) } };
}

function runner(calls, opts = {}) {
  return async (file, args, o = {}) => {
    calls.push({ file: path.basename(file), args, env: o.env || null });
    if (file === FAKE_UE.editor) {
      if (opts.editor) return opts.editor(args, o);
      simulateInEditorRender(args, o.env, opts);
      o.onLine?.('LogMovieRenderPipeline: Display: frame 120');
    } else if (path.basename(file) === 'ffmpeg') {
      const out = args[args.length - 1];
      if (out !== '-') fs.writeFileSync(out, 'mp4');
    } else if (path.basename(file) === 'ffprobe') {
      return { code: 0, tail: '', stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, nb_read_frames: String(opts.decoded ?? 120) }], format: { duration: String(opts.duration ?? 5) } }) };
    }
    return { code: 0, tail: '', stdout: '' };
  };
}

function executor(box, calls, opts) {
  return createProductionExecutor(loadExecutorConfig({ projects: { 'get-it-back': box.root }, capabilities: ['production.render.unreal'], tools: box.tools, unreal_projects: box.registry }), { runner: runner(calls, opts), detect: () => FAKE_UE });
}

test('contract: a sequence-mode job names approved ids and a shot range, no master, no path', () => {
  const m = normalizeShotRender(s31SequenceManifest());
  assert.deepEqual(m.unreal, { project_id: 'gib-s31-proof', sequence_id: 's31-standin' });
  assert.equal(m.source.master, null);
  assert.equal(m.frames.count, 120);
  assert.equal(m.frames.duration_s, 5);
  assert.equal(m.audio, null, 'silent');
  assert.throws(() => normalizeShotRender(s31SequenceManifest({ engine: 'blender' })), /need engine unreal/);
  assert.throws(() => normalizeShotRender(s31SequenceManifest({ unreal: { project_id: '../x', sequence_id: 's31' } })), /unreal.project_id is invalid/);
  assert.throws(() => normalizeShotRender(s31SequenceManifest({ unreal: { project_id: 'gib', sequence_id: 'C:/x.uasset' } })), /unreal.sequence_id is invalid/);
  // Unknown fields never reach a worker.
  const smuggled = normalizeShotRender({ ...s31SequenceManifest(), unreal: { ...s31SequenceManifest().unreal, command: 'calc.exe', uproject: 'C:/evil.uproject' }, exec: 'x' });
  assert.deepEqual(Object.keys(smuggled.unreal).sort(), ['project_id', 'sequence_id']);
  assert.equal(smuggled.exec, undefined);
  // Without the unreal block a master is still required.
  assert.throws(() => normalizeShotRender({ ...s31SequenceManifest(), unreal: undefined }), /source.master/);
});

test('contract: Core approves only a registered, approved sequence of this Unreal project, shot and range', () => {
  const p = project();
  const m = normalizeShotRender(s31SequenceManifest());
  assert.match(validateShotAgainstProject(m, p).errors.join(), /not a registered project asset/);
  p.assets.push(s31SequenceAsset({ approved: false }));
  assert.match(validateShotAgainstProject(m, p).errors.join(), /is not approved$/);
  p.assets[p.assets.length - 1] = s31SequenceAsset({ metadata: { ...s31SequenceAsset().metadata, unreal_project_id: 'other' } });
  assert.match(validateShotAgainstProject(m, p).errors.join(), /not approved in Unreal project gib-s31-proof/);
  p.assets[p.assets.length - 1] = s31SequenceAsset();
  const v = validateShotAgainstProject(m, p);
  assert.equal(v.ok, true, v.errors.join());
  const other = normalizeShotRender(s31SequenceManifest({ shot_id: 's32' }));
  assert.match(validateShotAgainstProject(other, p).errors.join(), /not approved for shot s32/);
  const long = normalizeShotRender(s31SequenceManifest({ frames: { start: 0, end: 200, fps: 24 }, checks: {} }));
  assert.match(validateShotAgainstProject(long, p).errors.join(), /outside the approved range/);
});

test('contract: a retake keeps the approved sequence and changes only what a retake may change', () => {
  const m = normalizeShotRender(s31SequenceManifest());
  const prev = { id: crypto.randomUUID(), manifest: m, latest_take: 1 };
  const next = planRetake(prev, { note: 'retake: tighter', resolution: { width: 720, height: 1280 } });
  assert.equal(next.take, 2);
  assert.equal(next.shot_id, 's31');
  assert.deepEqual(next.unreal, m.unreal);
  assert.throws(() => planRetake(prev, { unreal: { project_id: 'x', sequence_id: 'y' } }), { code: 'RETAKE_SCOPE' });
  assert.throws(() => planRetake(prev, { shot_id: 's32' }), { code: 'RETAKE_SCOPE' });
});

test('registry: the owner names absolute projects, /Game/ paths, shots, ranges and bounded settings only', () => {
  const ok = { production_project: 'get-it-back', uproject: '/p/GIBProof.uproject', sequences: { s: { map: '/Game/M', sequence: '/Game/S', shot_ids: ['s31'], frame_start: 0, frame_end: 119 } } };
  assert.equal(loadUnrealRegistry({ 'gib-s31-proof': ok })['gib-s31-proof'].rhi, 'd3d12');
  assert.equal(loadUnrealRegistry({ x1: { ...ok, uproject: 'C:\\Users\\M\\GIBProof.uproject' } }, { platform: 'win32' }).x1.isolate, 'copy');
  for (const [label, bad] of [
    ['relative', { ...ok, uproject: 'GIBProof.uproject' }],
    ['not a uproject', { ...ok, uproject: '/p/run.bat' }],
    ['rhi', { ...ok, rhi: 'null' }],
    ['map', { ...ok, sequences: { s: { ...ok.sequences.s, map: 'C:/x.umap' } } }],
    ['shots', { ...ok, sequences: { s: { ...ok.sequences.s, shot_ids: [] } } }],
    ['setting', { ...ok, sequences: { s: { ...ok.sequences.s, settings: { console_variables: 1 } } } }],
    ['bound', { ...ok, sequences: { s: { ...ok.sequences.s, settings: { spatial_samples: 999 } } } }]
  ]) assert.throws(() => loadUnrealRegistry({ p: bad }), { code: 'CONFIG_INVALID' }, label);
});

test('device: the GPU and RHI come from the engine log; a basic or software adapter never passes', () => {
  const radeon = parseUnrealLog(RADEON_LOG);
  assert.equal(radeon.rhi, 'D3D12');
  assert.equal(radeon.adapter, 'AMD Radeon RX 7800 XT');
  assert.equal(radeon.vendor_id, '0x1002');
  assert.equal(radeon.engine_version, '5.8.4-58902052+++UE5+Release-5.8');
  assert.equal(radeon.software, false);
  assert.equal(verifyDevice(radeon, { rhi: 'd3d12', requireAdapter: 'Radeon' }).pass, true);
  assert.equal(verifyDevice(radeon, { rhi: 'd3d12', requireAdapter: 'NVIDIA' }).pass, false);
  const warp = parseUnrealLog(WARP_LOG);
  assert.equal(warp.software, true);
  assert.match(verifyDevice(warp, { rhi: 'd3d12' }).detail, /no CPU fallback/);
  const empty = parseUnrealLog('');
  assert.equal(verifyDevice(empty, { rhi: 'd3d12' }).pass, false, 'an unknown device is not a GPU');
  assert.equal(verifyDevice(parseUnrealLog('LogVulkanRHI: Display: Creating Vulkan RHI\nLogInit:   RHI Adapter Info:\nLogInit:             Name : AMD Radeon RX 7800 XT'), { rhi: 'd3d12' }).pass, false);
});

test('editor command line: fixed flags, the D3D12 RHI, the render script, never -game or a queue manifest', () => {
  const args = editorArgs({ uproject: '/j/GIBProof.uproject', script: '/a/mcc_render_sequence.py', abslog: '/j/unreal_render.log' });
  assert.deepEqual(args, ['/j/GIBProof.uproject', '-ExecutePythonScript=/a/mcc_render_sequence.py', '-d3d12', '-unattended', '-nosplash', '-NoSound', '-NoLoadingScreen', '-log', '-abslog=/j/unreal_render.log']);
  assert.ok(!args.some((a) => /nullrhi|warp|-game$|MoviePipelineConfig/i.test(a)));
  assert.deepEqual(frameRun(['frame.0001.png', 'frame.0000.png', 'frame.0002.png']), { count: 3, contiguous: true, pattern: 'frame.%04d.png', start: 0, first: 'frame.0000.png', last: 'frame.0002.png' });
  assert.equal(frameRun(['frame.0000.png', 'frame.0002.png']).contiguous, false);
});

test('executor (SIMULATED editor): s31 renders the approved sequence from a project copy into a new folder and reports the GPU', async () => {
  const box = sandbox();
  const calls = [];
  const ex = executor(box, calls);
  const before = fs.readFileSync(path.join(box.proof, 'Content', 'Proof', 'S31_Seq.uasset'), 'utf8');
  const body = job(s31SequenceManifest());
  const out = await ex.execute(body);
  assert.equal(validateRenderOutput(out).ok, true, out.error);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.worker.adapter, 'mccluster-unreal-sequence/1');
  assert.deepEqual(out.unreal, { uproject: path.join(box.proof, 'GIBProof.uproject'), map: '/Game/Proof/S31_Map', sequence: '/Game/Proof/S31_Seq', project_id: 'gib-s31-proof', sequence_id: 's31-standin', mode: 'sequence' });
  assert.equal(out.device.adapter, 'AMD Radeon RX 7800 XT');
  assert.equal(out.device.rhi, 'D3D12');
  assert.equal(out.device.gpu_verified, true);
  for (const name of ['frames', 'device', 'project_preserved', 'timing', 'resolution']) assert.equal(out.checks[name].pass, true, name);
  assert.equal(out.checks.frames.measured.frames, 120);
  // Only the editor and ffmpeg/ffprobe ran: no Blender export, no build commandlet.
  assert.deepEqual(calls.map((c) => c.file), ['UnrealEditor', 'ffmpeg', 'ffprobe', 'ffmpeg']);
  const editor = calls[0];
  assert.ok(editor.args[0].startsWith(path.join(box.root, 'jobs', body.input.job_id, 'unreal-project')), 'the editor opens the per-job copy');
  assert.ok(editor.args.includes('-d3d12'));
  const ueJob = JSON.parse(fs.readFileSync(editor.env.MCC_UNREAL_JOB, 'utf8'));
  assert.deepEqual(ueJob.frames, { start: 0, end: 119, fps: 24 });
  assert.deepEqual(ueJob.settings, { spatial_samples: 1, temporal_samples: 1 });
  assert.equal(ueJob.sequence, '/Game/Proof/S31_Seq');
  // The copy left the regenerated caches behind; the approved project is untouched.
  assert.ok(!fs.existsSync(path.join(path.dirname(editor.args[0]), 'Saved')));
  assert.equal(fs.readFileSync(path.join(box.proof, 'Content', 'Proof', 'S31_Seq.uasset'), 'utf8'), before);
  // A new folder of its own; the preview is inside it.
  assert.match(path.relative(box.root, out.output_dir), /^renders[\\/]unreal[\\/]s31[\\/]t001-[0-9a-f]{8}-\d{8}T\d{6}Z$/);
  const preview = out.outputs.find((o) => o.kind === 'preview_mp4');
  assert.equal(path.dirname(preview.path), out.output_dir);
  assert.match(preview.sha256, /^[a-f0-9]{64}$/);
  const enc = calls[1].args;
  assert.equal(enc[enc.indexOf('-start_number') + 1], '0');
  assert.ok(enc.includes(path.join(out.output_dir, 'frames', 'frame.%04d.png')));
  assert.ok(!enc.includes('-filter_complex'), 'silent: no audio track is muxed');
  // The same job run again (a retry) never writes over the first render.
  const again = await ex.execute(body);
  assert.notEqual(again.output_dir, out.output_dir);
  assert.ok(fs.existsSync(preview.path), 'the first render is kept');
  assert.equal(ex.ready().unreal_projects['gib-s31-proof'].sequences[0], 's31-standin');
});

test('executor: ids the owner did not approve on this node are refused before anything runs', async () => {
  const box = sandbox();
  for (const [label, raw] of [
    ['unknown project', s31SequenceManifest({ unreal: { project_id: 'other-proof', sequence_id: 's31-standin' } })],
    ['unknown sequence', s31SequenceManifest({ unreal: { project_id: 'gib-s31-proof', sequence_id: 's32-standin' } })],
    ['other shot', s31SequenceManifest({ shot_id: 's32' })],
    ['outside the range', s31SequenceManifest({ frames: { start: 10, end: 129, fps: 24 } })]
  ]) {
    const calls = [];
    await assert.rejects(executor(box, calls).execute(job(raw)), (e) => e.code === 'UNREAL_NOT_APPROVED' && e.retryable === false, label);
    assert.equal(calls.length, 0, label);
  }
});

test('executor: no silent CPU fallback — a Basic Render Driver or an unknown device fails the job', async () => {
  const box = sandbox();
  const calls = [];
  await assert.rejects(executor(box, calls, { log: WARP_LOG }).execute(job(s31SequenceManifest())), (e) => e.code === 'GPU_NOT_VERIFIED' && e.retryable === false && /no CPU fallback/.test(e.message));
  assert.deepEqual(calls.map((c) => c.file), ['UnrealEditor'], 'nothing is encoded from a software render');
  await assert.rejects(executor(box, [], { log: 'LogInit: Display: Engine Version: 5.8.4' }).execute(job(s31SequenceManifest())), { code: 'GPU_NOT_VERIFIED' });
  box.registry['gib-s31-proof'].require_adapter = 'NVIDIA';
  await assert.rejects(executor(box, []).execute(job(s31SequenceManifest())), (e) => e.code === 'GPU_NOT_VERIFIED' && /not the required NVIDIA/.test(e.message));
});

test('executor: the editor exiting is not success — no result, a failed queue or missing frames all fail', async () => {
  const box = sandbox();
  await assert.rejects(executor(box, [], { result: false }).execute(job(s31SequenceManifest())), { code: 'UNREAL_NO_RESULT' });
  await assert.rejects(executor(box, [], { executorSuccess: false }).execute(job(s31SequenceManifest())), { code: 'UNREAL_RENDER_FAILED' });
  await assert.rejects(executor(box, [], { frames: 119 }).execute(job(s31SequenceManifest())), (e) => e.code === 'RENDER_INCOMPLETE' && e.retryable === true);
  await assert.rejects(executor(box, [], { writeFrames: false }).execute(job(s31SequenceManifest())), { code: 'RENDER_INCOMPLETE' });
  // A result file from another job is not this job's result.
  await assert.rejects(executor(box, [], { editor: (args, o) => {
    const ueJob = simulateInEditorRender(args, o.env);
    fs.writeFileSync(ueJob.result, JSON.stringify({ schema: 'mccluster-unreal-render-result/1', job_id: crypto.randomUUID(), ok: true, executor_success: true }));
    return { code: 0, tail: '', stdout: '' };
  } }).execute(job(s31SequenceManifest())), { code: 'UNREAL_NO_RESULT' });
  // A preview that does not decode to 120 frames is a failed job, reported, not hidden.
  const out = await executor(box, [], { decoded: 118, duration: 4.917 }).execute(job(s31SequenceManifest()));
  assert.equal(out.ok, false);
  assert.match(out.error, /timing/);
});

test('executor: a change to the approved project during the job is reported and fails the job', async () => {
  const box = sandbox();
  const out = await executor(box, [], { editor: (args, o) => {
    simulateInEditorRender(args, o.env);
    fs.writeFileSync(path.join(box.proof, 'Content', 'Proof', 'S31_Seq.uasset'), 'changed by someone');
    return { code: 0, tail: '', stdout: '' };
  } }).execute(job(s31SequenceManifest()));
  assert.equal(out.ok, false);
  assert.equal(out.checks.project_preserved.pass, false);
});
