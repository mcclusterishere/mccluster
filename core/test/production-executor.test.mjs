// The production executor on a node: path containment, named actions only,
// manifest tamper refusal, Unreal version detection, and the Unreal render
// flow end to end with a SIMULATED runner (no Blender, Unreal or ffmpeg runs
// here: the runner writes the files each real process would write). The real
// render is verified on Prime; see docs/control-plane/PRODUCTION-PIPELINE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createProductionExecutor, loadExecutorConfig, resolveInProject, detectUnreal } from '../src/production/executor.mjs';
import { normalizeShotRender, manifestHash, PRODUCTION_PROTOCOL, validateRenderOutput } from '../src/production/contract.mjs';
import { s31Manifest, simulateInEditorRender } from './helpers/production-fixtures.mjs';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-prod-exec-'));
  const root = path.join(dir, 'get-it-back');
  fs.mkdirSync(path.join(root, 'blend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'audio', 'scratch'), { recursive: true });
  fs.writeFileSync(path.join(root, 'blend', 'proof_phone_call-s31-phone-v3.blend'), 'BLENDER-master-v3');
  fs.writeFileSync(path.join(root, 'audio', 'scratch', 'line_m5.wav'), 'RIFF');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const tools = {};
  for (const name of ['blender', 'ffmpeg', 'ffprobe', 'python']) { tools[name] = path.join(bin, name); fs.writeFileSync(tools[name], ''); }
  tools.unreal_root = path.join(dir, 'UE_5.8');
  const sha = crypto.createHash('sha256').update('BLENDER-master-v3').digest('hex');
  return { dir, root, tools, sha };
}

function job(manifestRaw, capability = 'production.render.unreal') {
  const manifest = normalizeShotRender(manifestRaw);
  return { capability, input: { protocol: PRODUCTION_PROTOCOL, job_id: crypto.randomUUID(), kind: 'render', manifest, manifest_sha256: manifestHash(manifest) } };
}

const FAKE_UE = { ok: true, name: 'unreal', version: '5.8.4', changelist: 58902052, supported: true, editor: '/ue/UnrealEditor', editor_cmd: '/ue/UnrealEditor-Cmd', plugins: { python: true, movie_render_pipeline: true } };

function simulatedRunner(calls, { frames = 120, duration = 5 } = {}) {
  return async (file, args, opts = {}) => {
    calls.push({ file: path.basename(file), args, env: opts.env || null });
    if (opts.logFile) fs.appendFileSync(opts.logFile, `${path.basename(file)} ${args.length} args\n`);
    if (path.basename(file) === 'blender') {
      const jobFile = JSON.parse(fs.readFileSync(args[args.length - 1], 'utf8'));
      fs.writeFileSync(path.join(jobFile.out, 'export.json'), JSON.stringify({ schema: 'mccluster-shot-export/1', ok: true, parts: [] }));
    } else if (file === FAKE_UE.editor_cmd) {
      const ue = JSON.parse(fs.readFileSync(opts.env.MCC_UNREAL_JOB, 'utf8'));
      fs.writeFileSync(ue.result, JSON.stringify({ ok: true, map: '/Game/Shots/s31/T1/Map_s31', sequence: '/Game/Shots/s31/T1/LS_s31_T1', queue_manifest: path.join(path.dirname(ue.result), 'queue.utxt'), frame_pattern: 's31.%04d.png', frame_start_number: 0,
        checks: { scale: { pass: true }, framing: { pass: true }, phone_grip: { pass: true }, sequence_timing: { pass: true } } }));
      const shotDir = path.dirname(ue.frames_dir);
      globalThis.__framesDir = ue.frames_dir;
      void shotDir;
    } else if (file === FAKE_UE.editor) {
      simulateInEditorRender(args, opts.env, { frames });
      opts.onLine?.('LogMovieRenderPipeline: [ 1 / 120 ]');
    } else if (path.basename(file) === 'ffmpeg') {
      const out = args[args.length - 1];
      if (out !== '-') fs.writeFileSync(out, 'mp4');
    } else if (path.basename(file) === 'ffprobe') {
      return { code: 0, tail: '', stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, nb_read_frames: String(frames) }, { codec_type: 'audio' }], format: { duration: String(duration) } }) };
    }
    return { code: 0, tail: '', stdout: '' };
  };
}

test('executor config: absolute project roots, production capabilities only', () => {
  assert.throws(() => loadExecutorConfig({ projects: { 'get-it-back': 'relative/path' } }), { code: 'CONFIG_INVALID' });
  const cfg = loadExecutorConfig({ projects: { 'get-it-back': '/p' }, capabilities: ['production.render.unreal', 'shell.exec', 'production.transcript.whisper'] });
  assert.deepEqual(cfg.capabilities, ['production.render.unreal', 'production.transcript.whisper']);
});

test('executor: paths stay inside the project, symlinks included', () => {
  const { dir, root } = sandbox();
  for (const bad of ['../outside.blend', '/etc/passwd', 'C:/Windows/x', 'blend\\x.blend', 'blend/../../x']) assert.throws(() => resolveInProject(root, bad), { code: 'PATH_REFUSED' }, bad);
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
  fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(root, 'link.txt'));
  assert.throws(() => resolveInProject(root, 'link.txt'), { code: 'PATH_REFUSED' });
  assert.ok(resolveInProject(root, 'blend/proof_phone_call-s31-phone-v3.blend').endsWith('.blend'));
});

test('executor: Unreal detection reads Build.version and enforces the supported range', () => {
  const files = { 'Engine/Build/Build.version': JSON.stringify({ MajorVersion: 5, MinorVersion: 8, PatchVersion: 4, Changelist: 58902052, BranchName: '++UE5+Release-5.8' }) };
  const exists = (p) => /Build\.version$|UnrealEditor(-Cmd)?\.exe$|PythonScriptPlugin\.uplugin$|MovieRenderPipeline$|SequencerScripting$/.test(p);
  const readFile = () => files['Engine/Build/Build.version'];
  const ue = detectUnreal('C:/UE_5.8', { exists, readFile, platform: 'win32' });
  assert.equal(ue.ok, true);
  assert.equal(ue.version, '5.8.4');
  assert.equal(ue.changelist, 58902052);
  assert.match(ue.editor_cmd, /UnrealEditor-Cmd\.exe$/);
  files['Engine/Build/Build.version'] = JSON.stringify({ MajorVersion: 5, MinorVersion: 2, PatchVersion: 0 });
  const old = detectUnreal('C:/UE_5.2', { exists, readFile, platform: 'win32' });
  assert.equal(old.ok, false);
  assert.match(old.reason, /outside the adapter's supported/);
});

test('executor: refuses unknown actions, disabled capabilities and tampered manifests', async () => {
  const { root, tools, sha } = sandbox();
  const ex = createProductionExecutor(loadExecutorConfig({ projects: { 'get-it-back': root }, capabilities: ['production.render.unreal'], tools }), { runner: simulatedRunner([]), detect: () => FAKE_UE });
  await assert.rejects(ex.execute({ capability: 'shell.exec', input: {} }), { code: 'CAPABILITY_REFUSED' });
  await assert.rejects(ex.execute(job(s31Manifest({ source: { ...s31Manifest().source, master_sha256: sha } }), 'production.render.blender')), { code: 'CAPABILITY_NOT_ON_NODE' });
  const tampered = job(s31Manifest({ source: { ...s31Manifest().source, master_sha256: sha } }));
  tampered.input.manifest.source.master = '../../elsewhere.blend';
  await assert.rejects(ex.execute(tampered), { code: 'MANIFEST_TAMPERED' });
  const wrongMaster = job(s31Manifest());
  await assert.rejects(ex.execute(wrongMaster), { code: 'MASTER_VERSION_MISMATCH' });
});

test('executor (SIMULATED runner): Unreal build flow exports, builds, renders in the editor queue, encodes and reports', async () => {
  const { root, tools, sha } = sandbox();
  const calls = [];
  const ex = createProductionExecutor(loadExecutorConfig({ projects: { 'get-it-back': root }, capabilities: ['production.render.unreal'], tools }), { runner: simulatedRunner(calls), detect: () => FAKE_UE });
  const body = job(s31Manifest({ source: { ...s31Manifest().source, master_sha256: sha } }));
  const out = await ex.execute(body);
  assert.equal(validateRenderOutput(out).ok, true, JSON.stringify(validateRenderOutput(out)));
  assert.equal(out.ok, true);
  assert.equal(out.engine.version, '5.8.4');
  assert.equal(out.unreal.sequence, '/Game/Shots/s31/T1/LS_s31_T1');
  assert.ok(fs.existsSync(out.unreal.uproject));
  assert.equal(JSON.parse(fs.readFileSync(out.unreal.uproject, 'utf8')).EngineAssociation, '5.8');
  const preview = out.outputs.find((o) => o.kind === 'preview_mp4');
  assert.equal(preview.project_path, 'renders/unreal/s31/t001/s31_t001_unreal.mp4');
  assert.deepEqual(calls.map((c) => c.file), ['blender', 'UnrealEditor-Cmd', 'UnrealEditor', 'ffmpeg', 'ffprobe', 'ffmpeg']);
  // Every process is started with an argument list: no shell, no script text from the job.
  for (const c of calls) assert.ok(Array.isArray(c.args) && c.args.every((a) => typeof a === 'string'));
  assert.ok(calls[1].args.some((a) => a.startsWith('-ExecutePythonScript=') && a.endsWith(path.join('unreal', 'mcc_build_shot.py'))));
  // The render uses the in-editor queue that worked on Prime, not -game -MoviePipelineConfig.
  assert.ok(calls[2].args.some((a) => a.startsWith('-ExecutePythonScript=') && a.endsWith(path.join('unreal', 'mcc_render_sequence.py'))));
  assert.ok(calls[2].args.includes('-d3d12'));
  assert.ok(!calls[2].args.includes('-game') && !calls[2].args.some((a) => a.startsWith('-MoviePipelineConfig=')));
  assert.equal(out.checks.device.pass, true);
  assert.equal(out.device.adapter, 'AMD Radeon RX 7800 XT');
  // Negative audio offset: the line starts 0.621 s after the first frame.
  const enc = calls[3].args;
  assert.ok(enc.join(' ').includes('adelay=621:all=1,apad'));
  assert.equal(enc[enc.indexOf('-t') + 1], '5.000');
  assert.equal(ex.progress(body.input.job_id).step, 'done');
  // The master is untouched.
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'blend', 'proof_phone_call-s31-phone-v3.blend'))).digest('hex'), sha);
  // A retake of the same shot reuses nothing it should not: a new take dir, a new export id.
  const retake = job(s31Manifest({ take: 2, retake_of: crypto.randomUUID(), source: { ...s31Manifest().source, master_sha256: sha } }));
  const out2 = await ex.execute(retake);
  assert.equal(out2.outputs.find((o) => o.kind === 'preview_mp4').project_path, 'renders/unreal/s31/t002/s31_t002_unreal.mp4');
  assert.ok(fs.existsSync(path.join(root, 'renders', 'unreal', 's31', 't001', 's31_t001_unreal.mp4')), 'take 1 is kept');
});

test('executor (SIMULATED runner): a short render is retryable, a wrong-length preview is a failed job', async () => {
  const { root, tools, sha } = sandbox();
  const short = createProductionExecutor(loadExecutorConfig({ projects: { 'get-it-back': root }, capabilities: ['production.render.unreal'], tools }), { runner: simulatedRunner([], { frames: 80 }), detect: () => FAKE_UE });
  await assert.rejects(short.execute(job(s31Manifest({ source: { ...s31Manifest().source, master_sha256: sha } }))), (e) => e.code === 'RENDER_INCOMPLETE' && e.retryable === true);
  const long = createProductionExecutor(loadExecutorConfig({ projects: { 'get-it-back': root }, capabilities: ['production.render.unreal'], tools }), { runner: simulatedRunner([], { duration: 6.2 }), detect: () => FAKE_UE });
  const out = await long.execute(job(s31Manifest({ source: { ...s31Manifest().source, master_sha256: sha } })));
  assert.equal(out.ok, false);
  assert.equal(out.checks.timing.pass, false);
});

test('node manifests: Prime and Shiloh declare only production worker capabilities on loopback executors', async () => {
  const { validateCapabilityManifest, OWNED_ONLY_CAPABILITIES } = await import('../src/compute/protocol.mjs');
  const here = path.dirname(new URL(import.meta.url).pathname);
  for (const [file, expected] of [['prime-production.json', ['production.render.unreal', 'production.render.blender']], ['shiloh-production.json', ['production.facetrack.mediapipe', 'production.transcript.whisper']]]) {
    const raw = JSON.parse(fs.readFileSync(path.join(here, '..', 'node-manifests', file), 'utf8'));
    assert.equal(raw.labels.trust, 'owned');
    assert.deepEqual(validateCapabilityManifest(raw.capabilities).map((c) => c.capability), expected);
    for (const c of raw.capabilities) {
      assert.ok([...OWNED_ONLY_CAPABILITIES].includes(c.capability), `${c.capability} is owned-only`);
      for (const key of ['url', 'progress_url', 'health_url']) assert.match(c.executor[key], /^http:\/\/127\.0\.0\.1:4792\//);
    }
  }
});
