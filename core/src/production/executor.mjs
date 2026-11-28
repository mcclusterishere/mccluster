/* ============================================================
   THE PRODUCTION EXECUTOR — a loopback executor for the compute node
   agent on an owned machine (Prime: Blender and Unreal; Shiloh:
   MediaPipe face tracking and Faster Whisper transcripts).

   The node agent (core/src/compute/node-agent.mjs) leases a production
   task over the signed compute protocol and POSTs it here, on
   127.0.0.1 only. This process:

     * accepts only the four named production capabilities;
     * re-normalizes the manifest and checks its hash, so a task can
       carry nothing the contract does not name;
     * resolves every path under the project root the MACHINE OWNER
       configured for that project id (the job never names a root, an
       executable or an argument), refusing anything that escapes it;
     * runs fixed adapters with fixed argument lists, shell: false;
     * writes logs and outputs to versioned folders in the project, and
       never writes the Blender master (its hash is checked after);
     * reports progress at /progress and stops the running adapter when
       the node agent aborts the request (lease lost or owner cancel).

   There is no endpoint, field or config key that runs a caller-supplied
   command, script or code.
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  UNREAL_RENDER_RESULT_SCHEMA, UNREAL_SEQUENCE_ADAPTER, copyProject, editorArgs, frameRun, freshOutputDir, loadUnrealRegistry,
  parseUnrealLog, projectFingerprint, resolveApprovedSequence, verifyDevice
} from './unreal-sequence.mjs';
import {
  PRODUCTION_PROTOCOL, PRODUCTION_WORKER_CAPABILITIES, RENDER_OUTPUT_SCHEMA, SHOT_EXPORT_SCHEMA, UNREAL_SUPPORTED,
  isRelativeProjectPath, manifestHash, normalizeFacetrack, normalizeShotRender, normalizeTranscript
} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ADAPTERS_DIR = path.resolve(HERE, '../../../tools/production');
const BODY_LIMIT = 256 * 1024;

export class ExecutorError extends Error {
  constructor(message, { code = 'EXECUTOR_FAILED', status = 500, retryable = false, detail = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

/* ---------- config ---------- */

export function loadExecutorConfig(raw, { platform = process.platform } = {}) {
  if (!raw || typeof raw !== 'object') throw new ExecutorError('production executor config must be an object', { code: 'CONFIG_INVALID' });
  const projects = {};
  for (const [id, root] of Object.entries(raw.projects || {})) {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)) throw new ExecutorError(`project id ${id} is invalid`, { code: 'CONFIG_INVALID' });
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new ExecutorError(`project ${id} root must be an absolute path`, { code: 'CONFIG_INVALID' });
    projects[id] = path.resolve(root);
  }
  const capabilities = (raw.capabilities || []).filter((c) => PRODUCTION_WORKER_CAPABILITIES.includes(c));
  return {
    nodeLabel: String(raw.node_label || os.hostname()).slice(0, 80),
    projects,
    capabilities,
    tools: { ...(raw.tools || {}) },
    adaptersDir: raw.adapters_dir ? path.resolve(raw.adapters_dir) : DEFAULT_ADAPTERS_DIR,
    timeouts: { export: 900_000, build: 1_800_000, render: 3_600_000, encode: 600_000, facetrack: 1_800_000, transcript: 1_800_000, ...(raw.timeouts || {}) },
    unrealProjectName: /^[A-Za-z][A-Za-z0-9]{2,30}$/.test(raw.unreal_project_name || '') ? raw.unreal_project_name : 'McCPreviz',
    // Approved Unreal projects and Level Sequences (sequence mode). A job
    // names ids from here; it never names a path, a map or an argument.
    unrealProjects: (() => { try { return loadUnrealRegistry(raw.unreal_projects, { platform }); } catch (error) { throw new ExecutorError(error.message, { code: 'CONFIG_INVALID' }); } })(),
    // The GPU every Unreal render must show in its own log (build mode too).
    unrealDevice: {
      rhi: 'd3d12',
      requireAdapter: typeof raw.unreal_device?.require_adapter === 'string' && /^[A-Za-z0-9 ()._-]{2,80}$/.test(raw.unreal_device.require_adapter) ? raw.unreal_device.require_adapter : null,
      renderOffscreen: raw.unreal_device?.render_offscreen === true
    },
    platform
  };
}

/* ---------- path containment ---------- */

export function resolveInProject(root, rel, { mustExist = true } = {}) {
  if (!isRelativeProjectPath(rel)) throw new ExecutorError(`path ${rel} is not project-relative`, { code: 'PATH_REFUSED', status: 400 });
  const full = path.resolve(root, ...rel.split('/'));
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ExecutorError(`path ${rel} escapes the project`, { code: 'PATH_REFUSED', status: 400 });
  if (mustExist) {
    if (!fs.existsSync(full)) throw new ExecutorError(`project file ${rel} does not exist on this node`, { code: 'PROJECT_FILE_MISSING', status: 422 });
    const real = fs.realpathSync(full);
    const realRoot = fs.realpathSync(root);
    const realRel = path.relative(realRoot, real);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new ExecutorError(`path ${rel} resolves outside the project`, { code: 'PATH_REFUSED', status: 400 });
  }
  return full;
}

export function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

/* ---------- engine detection ---------- */

export function detectUnreal(root, { readFile = fs.readFileSync, exists = fs.existsSync, platform = process.platform } = {}) {
  if (!root) return { ok: false, reason: 'unreal_root not configured' };
  const versionFile = path.join(root, 'Engine', 'Build', 'Build.version');
  if (!exists(versionFile)) return { ok: false, reason: `no Engine/Build/Build.version under ${root}` };
  let build;
  try { build = JSON.parse(String(readFile(versionFile, 'utf8')).replace(/^﻿/, '')); }
  catch (error) { return { ok: false, reason: `Build.version unreadable: ${error.message}` }; }
  const bin = path.join(root, 'Engine', 'Binaries', platform === 'win32' ? 'Win64' : (platform === 'darwin' ? 'Mac' : 'Linux'));
  const exe = (name) => path.join(bin, platform === 'win32' ? `${name}.exe` : name);
  const editor = exe('UnrealEditor');
  const editorCmd = exe('UnrealEditor-Cmd');
  const version = `${build.MajorVersion}.${build.MinorVersion}.${build.PatchVersion}`;
  const supported = build.MajorVersion === UNREAL_SUPPORTED.major && build.MinorVersion >= UNREAL_SUPPORTED.minMinor && build.MinorVersion <= UNREAL_SUPPORTED.maxMinor;
  const plugins = {
    python: exists(path.join(root, 'Engine', 'Plugins', 'Experimental', 'PythonScriptPlugin', 'PythonScriptPlugin.uplugin')),
    movie_render_pipeline: exists(path.join(root, 'Engine', 'Plugins', 'MovieScene', 'MovieRenderPipeline')),
    sequencer_scripting: exists(path.join(root, 'Engine', 'Plugins', 'MovieScene', 'SequencerScripting'))
  };
  return {
    ok: supported && exists(editor) && exists(editorCmd) && plugins.python && plugins.movie_render_pipeline,
    name: 'unreal',
    version,
    changelist: build.Changelist ?? null,
    branch: build.BranchName || null,
    supported,
    editor,
    editor_cmd: editorCmd,
    plugins,
    reason: supported ? null : `Unreal ${version} is outside the adapter's supported ${UNREAL_SUPPORTED.major}.${UNREAL_SUPPORTED.minMinor}-${UNREAL_SUPPORTED.major}.${UNREAL_SUPPORTED.maxMinor}`
  };
}

/* ---------- process runner (shell: false, killable) ---------- */

export function defaultRunner({ platform = process.platform } = {}) {
  return function run(file, args, { cwd, env, logFile, timeoutMs, signal, onLine } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new ExecutorError('canceled before start', { code: 'CANCELED' }));
      const log = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;
      log?.write(`\n# ${new Date().toISOString()} ${path.basename(file)} ${args.map((a) => JSON.stringify(a)).join(' ')}\n`);
      const child = spawn(file, args, { cwd, env: { ...process.env, ...(env || {}) }, shell: false, windowsHide: true, detached: platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      let tail = '';
      let stdout = '';
      child.stdout.on('data', (chunk) => { if (stdout.length < 1_000_000) stdout += chunk.toString('utf8'); });
      const take = (chunk) => {
        const textChunk = chunk.toString('utf8');
        log?.write(textChunk);
        tail = (tail + textChunk).slice(-8000);
        if (onLine) for (const line of textChunk.split(/\r?\n/)) if (line) onLine(line);
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      const kill = () => {
        try {
          if (platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true });
          else process.kill(-child.pid, 'SIGKILL');
        } catch { /* already gone */ }
      };
      const timer = setTimeout(() => { kill(); }, Math.max(1000, timeoutMs || 600_000));
      const onAbort = () => kill();
      signal?.addEventListener('abort', onAbort, { once: true });
      child.on('error', (error) => { clearTimeout(timer); log?.end(); reject(new ExecutorError(`could not start ${path.basename(file)}: ${error.message}`, { code: 'ADAPTER_START_FAILED' })); });
      child.on('close', (code, sig) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        log?.end(`\n# exit ${code}${sig ? ` signal ${sig}` : ''}\n`);
        if (signal?.aborted) return reject(new ExecutorError('canceled', { code: 'CANCELED' }));
        if (code === 0) return resolve({ code, tail, stdout });
        reject(new ExecutorError(`${path.basename(file)} exited ${code}${sig ? ` (${sig})` : ''}`, { code: 'ADAPTER_FAILED', retryable: false, detail: tail.slice(-2000) }));
      });
    });
  };
}

/* ---------- the executor ---------- */

export function createProductionExecutor(config, { runner = defaultRunner({ platform: config.platform }), detect = detectUnreal, now = () => new Date(), fsImpl = fs } = {}) {
  const progress = new Map();
  const setProgress = (jobId, patch) => progress.set(jobId, { ...(progress.get(jobId) || {}), ...patch, updated_at: now().toISOString() });

  function projectRoot(projectId) {
    const root = config.projects[projectId];
    if (!root) throw new ExecutorError(`project ${projectId} is not configured on this node`, { code: 'PROJECT_NOT_ON_NODE', status: 422 });
    if (!fsImpl.existsSync(root)) throw new ExecutorError(`project ${projectId} root is missing on this node`, { code: 'PROJECT_NOT_ON_NODE', status: 422 });
    return root;
  }

  function tool(name) {
    const value = config.tools[name];
    if (!value || !path.isAbsolute(value) || !fsImpl.existsSync(value)) throw new ExecutorError(`tool ${name} is not configured on this node`, { code: 'TOOL_NOT_CONFIGURED', status: 503 });
    return value;
  }

  function adapter(rel) {
    const full = path.join(config.adaptersDir, ...rel.split('/'));
    if (!fsImpl.existsSync(full)) throw new ExecutorError(`adapter ${rel} is missing`, { code: 'ADAPTER_MISSING', status: 503 });
    return full;
  }

  function jobDirs(root, manifest, jobId, engine) {
    const shotDir = path.join(root, 'renders', engine, manifest.shot_id, `t${String(manifest.take).padStart(3, '0')}`);
    const jobDir = path.join(root, 'jobs', jobId);
    for (const dir of [shotDir, jobDir]) fsImpl.mkdirSync(dir, { recursive: true });
    return { shotDir, jobDir, log: path.join(jobDir, 'worker.log') };
  }

  function artifact(kind, file, root, label = null) {
    const stat = fsImpl.statSync(file);
    const rel = path.relative(root, file).split(path.sep).join('/');
    return { kind, path: file, project_path: isRelativeProjectPath(rel) ? rel : null, sha256: stat.isFile() ? sha256File(file) : null, bytes: stat.isFile() ? stat.size : null, label };
  }

  async function probe(file, { log, signal }) {
    const ffprobe = tool('ffprobe');
    const outFile = `${file}.probe.json`;
    const { stdout } = await runner(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-count_frames', '-of', 'json', file], { logFile: null, timeoutMs: config.timeouts.encode, signal });
    let parsed = {};
    try { parsed = JSON.parse(stdout); } catch { parsed = {}; }
    fsImpl.writeFileSync(outFile, JSON.stringify(parsed, null, 1));
    const video = (parsed.streams || []).find((s) => s.codec_type === 'video') || {};
    const audio = (parsed.streams || []).find((s) => s.codec_type === 'audio');
    let decodedOk = false;
    try { await runner(tool('ffmpeg'), ['-v', 'error', '-i', file, '-f', 'null', '-'], { logFile: log, timeoutMs: config.timeouts.encode, signal }); decodedOk = true; } catch { decodedOk = false; }
    return {
      duration_s: Number(parsed.format?.duration ?? video.duration ?? NaN),
      frames: Number.parseInt(video.nb_read_frames ?? video.nb_frames, 10),
      width: video.width ?? null,
      height: video.height ?? null,
      has_audio: Boolean(audio),
      codec: video.codec_name || null,
      decoded_ok: decodedOk
    };
  }

  async function encodePreview({ framesDir, framePattern, startNumber, manifest, root, outFile, log, signal }) {
    const args = ['-hide_banner', '-y', '-framerate', String(manifest.frames.fps), '-start_number', String(startNumber ?? manifest.frames.start), '-i', path.join(framesDir, framePattern)];
    if (manifest.audio) {
      const audio = resolveInProject(root, manifest.audio.path);
      // offset_s: the time in the audio file at the shot's first frame.
      // Negative: the audio starts that long after the first frame.
      const offset = manifest.audio.offset_s;
      if (offset >= 0) args.push('-ss', offset.toFixed(3), '-i', audio);
      else args.push('-i', audio);
      const delayMs = offset < 0 ? Math.round(-offset * 1000) : 0;
      args.push('-filter_complex', `[1:a]${delayMs ? `adelay=${delayMs}:all=1,` : ''}apad[a]`, '-map', '0:v:0', '-map', '[a]', '-c:a', 'aac', '-b:a', '160k');
    }
    args.push('-t', manifest.frames.duration_s.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile);
    await runner(tool('ffmpeg'), args, { logFile: log, timeoutMs: config.timeouts.encode, signal });
  }

  function timingCheck(manifest, playback) {
    const expected = manifest.frames.duration_s;
    const okDuration = Number.isFinite(playback.duration_s) && Math.abs(playback.duration_s - expected) <= 1.5 / manifest.frames.fps;
    const okFrames = !Number.isFinite(playback.frames) || playback.frames === manifest.frames.count;
    return { pass: okDuration && okFrames && playback.decoded_ok, detail: `expected ${manifest.frames.count} frames / ${expected.toFixed(3)} s, got ${playback.frames} frames / ${Number(playback.duration_s).toFixed(3)} s, decoded ${playback.decoded_ok ? 'cleanly' : 'with errors'}`, measured: { expected_s: expected, duration_s: playback.duration_s, frames: playback.frames } };
  }

  function readJson(file) {
    try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch { return null; }
  }

  async function exportShot({ root, manifest, jobId, jobDir, log, signal }) {
    const exportId = manifest.source.export_id || `${manifest.shot_id}-t${String(manifest.take).padStart(3, '0')}-${manifestHash(manifest).slice(0, 10)}`;
    const exportDir = path.join(root, 'exports', exportId);
    const existing = readJson(path.join(exportDir, 'export.json'));
    if (existing?.schema === SHOT_EXPORT_SCHEMA && existing.ok === true) return { exportDir, exportId, manifest: existing, reused: true };
    const master = resolveInProject(root, manifest.source.master);
    const before = sha256File(master);
    if (manifest.source.master_sha256 && before !== manifest.source.master_sha256) {
      throw new ExecutorError('the master on this node is not the version the job names', { code: 'MASTER_VERSION_MISMATCH', status: 409 });
    }
    fsImpl.mkdirSync(exportDir, { recursive: true });
    const jobFile = path.join(jobDir, 'shot.json');
    fsImpl.writeFileSync(jobFile, JSON.stringify({ job_id: jobId, manifest, export_id: exportId, out: exportDir }, null, 1));
    setProgress(jobId, { step: 'export', detail: 'Blender export of set and shot' });
    await runner(tool('blender'), ['-b', '--factory-startup', master, '--python-exit-code', '3', '--python', adapter('blender/export_shot.py'), '--', jobFile], { logFile: log, timeoutMs: config.timeouts.export, signal });
    const after = sha256File(master);
    if (after !== before) throw new ExecutorError('the Blender master changed during export; the export adapter must never save it', { code: 'MASTER_MODIFIED' });
    const result = readJson(path.join(exportDir, 'export.json'));
    if (result?.schema !== SHOT_EXPORT_SCHEMA || result.ok !== true) throw new ExecutorError(`export did not finish: ${result?.error || 'no export.json'}`, { code: 'EXPORT_FAILED' });
    return { exportDir, exportId, manifest: result, reused: false, master_sha256: before };
  }

  function ensureUnrealProject(root, engine) {
    const dir = path.join(root, 'unreal', config.unrealProjectName);
    const uproject = path.join(dir, `${config.unrealProjectName}.uproject`);
    if (!fsImpl.existsSync(uproject)) {
      fsImpl.mkdirSync(path.join(dir, 'Content'), { recursive: true });
      fsImpl.mkdirSync(path.join(dir, 'Config'), { recursive: true });
      const template = JSON.parse(fsImpl.readFileSync(adapter('unreal/McCPreviz.uproject.json'), 'utf8'));
      template.EngineAssociation = engine.version.split('.').slice(0, 2).join('.');
      fsImpl.writeFileSync(uproject, JSON.stringify(template, null, '\t'));
      fsImpl.copyFileSync(adapter('unreal/DefaultEngine.ini'), path.join(dir, 'Config', 'DefaultEngine.ini'));
    }
    return { dir, uproject };
  }

  // The proven path on Prime: the editor opens the project and the
  // in-editor queue (PIE executor) renders the sequence. Returns only when
  // the result file, the frames on disk and the GPU in the engine log all
  // agree; the editor exiting proves nothing by itself.
  async function renderInEditor({ engine, jobId, uproject, map, sequence, framesDir, manifest, jobDir, log, settings = {}, device, signal }) {
    const resultFile = path.join(jobDir, 'unreal_render_result.json');
    const jobFile = path.join(jobDir, 'unreal_render_job.json');
    const renderLog = path.join(jobDir, 'unreal_render.log');
    fsImpl.rmSync(resultFile, { force: true });
    fsImpl.writeFileSync(jobFile, JSON.stringify({ job_id: jobId, map, sequence, output_dir: framesDir, result: resultFile, frames: { start: manifest.frames.start, end: manifest.frames.end, fps: manifest.frames.fps }, resolution: manifest.resolution, settings }, null, 1));
    setProgress(jobId, { step: 'render', detail: 'Movie Render Queue (in-editor, PIE executor)', frames_total: manifest.frames.count, frames_done: 0 });
    let editorError = null;
    // Progress is the frames on disk: the editor writes no stdout on Windows
    // when it logs to a file, so its output lines cannot be counted.
    const ticker = setInterval(() => { const done = countFrames(framesDir); if (done != null) setProgress(jobId, { frames_done: done }); }, 2000);
    ticker.unref?.();
    try {
      await runner(engine.editor, editorArgs({ uproject, script: adapter('unreal/mcc_render_sequence.py'), abslog: renderLog, rhi: device.rhi, renderOffscreen: device.renderOffscreen }),
        { env: { MCC_UNREAL_JOB: jobFile }, logFile: log, timeoutMs: config.timeouts.render, signal });
    } catch (error) {
      if (error.code === 'CANCELED') throw error;
      editorError = error;
    } finally {
      clearInterval(ticker);
    }
    const logText = fsImpl.existsSync(renderLog) ? fsImpl.readFileSync(renderLog, 'utf8') : '';
    const seen = parseUnrealLog(logText);
    const deviceCheck = verifyDevice(seen, device);
    const result = readJson(resultFile);
    const run = frameRun(fsImpl.existsSync(framesDir) ? fsImpl.readdirSync(framesDir) : []);
    const detail = { result, device: seen, frames: run, editor_error: editorError ? String(editorError.message) : null };
    if (!deviceCheck.pass) throw new ExecutorError(`Unreal did not render on the required GPU: ${deviceCheck.detail}`, { code: 'GPU_NOT_VERIFIED', status: 422, detail });
    if (editorError) throw new ExecutorError(`Unreal editor failed: ${editorError.message}`, { code: 'UNREAL_RENDER_FAILED', retryable: true, detail });
    if (result?.schema !== UNREAL_RENDER_RESULT_SCHEMA || result.job_id !== jobId) throw new ExecutorError('the editor exited without writing this job\'s render result', { code: 'UNREAL_NO_RESULT', retryable: true, detail });
    if (result.ok !== true || result.executor_success !== true) throw new ExecutorError(`Movie Render Queue did not succeed: ${result.error || 'executor reported failure'}`, { code: 'UNREAL_RENDER_FAILED', retryable: true, detail });
    if (run.count !== manifest.frames.count || !run.contiguous) throw new ExecutorError(`Movie Render Queue wrote ${run.count} of ${manifest.frames.count} frames${run.count && !run.contiguous ? ' (not contiguous)' : ''}`, { code: 'RENDER_INCOMPLETE', retryable: true, detail });
    setProgress(jobId, { frames_done: run.count });
    return { result, device: { ...seen, gpu_verified: true }, deviceCheck, run, renderLog };
  }

  function countFrames(dir) {
    try { return fsImpl.readdirSync(dir).filter((f) => /\.png$/i.test(f)).length; } catch { return null; }
  }

  async function renderUnreal({ input, manifest, signal }) {
    const engine = detect(config.tools.unreal_root);
    if (!engine.ok) throw new ExecutorError(`Unreal is not usable on this node: ${engine.reason || 'editor, Python or Movie Render Queue missing'}`, { code: 'ENGINE_UNSUPPORTED', status: 503, detail: engine });
    if (manifest.unreal) return renderUnrealSequence({ input, manifest, signal, engine });
    const root = projectRoot(manifest.project_id);
    const { shotDir, jobDir, log } = jobDirs(root, manifest, input.job_id, 'unreal');
    const started = now().toISOString();
    const exported = await exportShot({ root, manifest, jobId: input.job_id, jobDir, log, signal });
    const project = ensureUnrealProject(root, engine);
    const framesDir = path.join(shotDir, 'frames');
    fsImpl.rmSync(framesDir, { recursive: true, force: true });
    fsImpl.mkdirSync(framesDir, { recursive: true });
    const buildFile = path.join(jobDir, 'unreal_job.json');
    const buildResult = path.join(jobDir, 'unreal_build.json');
    fsImpl.writeFileSync(buildFile, JSON.stringify({ job_id: input.job_id, manifest, export_dir: exported.exportDir, frames_dir: framesDir, result: buildResult, engine: { version: engine.version, changelist: engine.changelist } }, null, 1));
    setProgress(input.job_id, { step: 'build', detail: 'Unreal import, level and Level Sequence' });
    await runner(engine.editor_cmd, [project.uproject, `-ExecutePythonScript=${adapter('unreal/mcc_build_shot.py')}`, '-unattended', '-nopause', '-nosplash', '-NoSound', '-stdout', '-FullStdOutLogOutput', `-abslog=${path.join(jobDir, 'unreal_build.log')}`],
      { env: { MCC_UNREAL_JOB: buildFile }, logFile: log, timeoutMs: config.timeouts.build, signal });
    const build = readJson(buildResult);
    if (!build?.ok) throw new ExecutorError(`Unreal build step failed: ${build?.error || 'no result written'}`, { code: 'UNREAL_BUILD_FAILED', detail: build });
    // The built sequence renders through the same in-editor queue as
    // sequence mode (the -game -MoviePipelineConfig launch failed on Prime).
    const rendered = await renderInEditor({ engine, jobId: input.job_id, uproject: project.uproject, map: build.map, sequence: build.sequence, framesDir, manifest, jobDir, log, device: config.unrealDevice, signal });
    const frames = Array.from({ length: rendered.run.count });
    setProgress(input.job_id, { step: 'encode', detail: 'preview MP4' });
    const preview = path.join(shotDir, `${manifest.shot_id}_t${String(manifest.take).padStart(3, '0')}_unreal.mp4`);
    await encodePreview({ framesDir, framePattern: rendered.run.pattern, startNumber: rendered.run.start, manifest, root, outFile: preview, log, signal });
    setProgress(input.job_id, { step: 'verify', detail: 'playback probe' });
    const playback = await probe(preview, { log, signal });
    const checks = { ...(build.checks || {}), device: rendered.deviceCheck, timing: timingCheck(manifest, playback) };
    const checksFile = path.join(shotDir, 'checks.json');
    fsImpl.writeFileSync(checksFile, JSON.stringify(checks, null, 1));
    const outputs = [
      artifact('preview_mp4', preview, root, 'Unreal Movie Render Queue preview'),
      { kind: 'frames', path: framesDir, project_path: path.relative(root, framesDir).split(path.sep).join('/'), sha256: null, bytes: null, label: `${frames.length} frames` },
      artifact('checks', checksFile, root),
      artifact('log', log, root, 'worker log'),
      { kind: 'unreal_project', path: project.uproject, project_path: path.relative(root, project.uproject).split(path.sep).join('/'), sha256: null, bytes: null, label: config.unrealProjectName },
      { kind: 'level_sequence', path: build.sequence, project_path: null, sha256: null, bytes: null, label: build.map },
      { kind: 'export', path: exported.exportDir, project_path: path.relative(root, exported.exportDir).split(path.sep).join('/'), sha256: null, bytes: null, label: exported.exportId }
    ];
    for (const extra of ['unreal_build.log', 'unreal_render.log']) {
      const file = path.join(jobDir, extra);
      if (fsImpl.existsSync(file)) outputs.push(artifact('log', file, root, extra));
    }
    return {
      schema: RENDER_OUTPUT_SCHEMA,
      // The job succeeded when a playable preview exists; the checks are
      // reported beside it (checks_passed on the job), never hidden.
      ok: playback.decoded_ok === true && checks.timing.pass === true,
      job_id: input.job_id,
      shot_id: manifest.shot_id,
      take: manifest.take,
      engine: { name: 'unreal', version: engine.version, changelist: engine.changelist, executable: engine.editor },
      worker: { node_id: process.env.MCCLUSTER_NODE_ID || null, hostname: os.hostname(), adapter: 'mccluster-unreal-mrq/1' },
      unreal: { uproject: project.uproject, map: build.map, sequence: build.sequence, mode: 'build' },
      device: deviceReport(rendered.device),
      output_dir: shotDir,
      outputs,
      checks,
      playback,
      error: playback.decoded_ok === true && checks.timing.pass === true ? null : `preview is not playable as specified: ${checks.timing.detail}`,
      started_at: started,
      finished_at: now().toISOString()
    };
  }

  function deviceReport(device) {
    return { rhi: device.rhi, adapter: device.adapter, vendor_id: device.vendor_id, driver: device.driver, software: device.software === true, gpu_verified: device.gpu_verified === true, evidence: device.evidence || [] };
  }

  // Sequence mode: an approved Level Sequence in an approved project, by
  // id. A per-job copy of the project is rendered (isolate: copy), so the
  // working project is never opened, and the render lands in a new folder.
  async function renderUnrealSequence({ input, manifest, signal, engine }) {
    const { project: approved, sequence } = resolveApprovedSequence(config.unrealProjects, manifest);
    const root = projectRoot(manifest.project_id);
    if (!fsImpl.existsSync(approved.uproject)) throw new ExecutorError(`approved Unreal project ${approved.id} is missing on this node`, { code: 'UNREAL_PROJECT_MISSING', status: 422 });
    const started = now().toISOString();
    const jobDir = path.join(root, 'jobs', input.job_id);
    fsImpl.mkdirSync(jobDir, { recursive: true });
    const log = path.join(jobDir, 'worker.log');
    const outputDir = freshOutputDir(root, manifest, input.job_id, { now: now(), fsImpl });
    const framesDir = path.join(outputDir, 'frames');
    const sourceDir = path.dirname(approved.uproject);
    const before = projectFingerprint(sourceDir, { fsImpl });
    fsImpl.appendFileSync(log, `${JSON.stringify({ event: 'unreal_sequence_start', job_id: input.job_id, engine: { version: engine.version, changelist: engine.changelist, editor: engine.editor }, unreal_project: approved.id, sequence_id: manifest.unreal.sequence_id, sequence: sequence.sequence, map: sequence.map, frames: manifest.frames, resolution: manifest.resolution, output_dir: outputDir, isolate: approved.isolate, project_fingerprint: before })}\n`);
    let uproject = approved.uproject;
    if (approved.isolate === 'copy') {
      setProgress(input.job_id, { step: 'prepare', detail: 'copying the approved Unreal project for this job' });
      const copyDir = path.join(jobDir, 'unreal-project', path.basename(sourceDir));
      fsImpl.rmSync(copyDir, { recursive: true, force: true });
      copyProject(sourceDir, copyDir, { fsImpl });
      uproject = path.join(copyDir, path.basename(approved.uproject));
    }
    const rendered = await renderInEditor({ engine, jobId: input.job_id, uproject, map: sequence.map, sequence: sequence.sequence, framesDir, manifest, jobDir, log, settings: sequence.settings, device: { rhi: approved.rhi, requireAdapter: approved.requireAdapter, renderOffscreen: approved.renderOffscreen }, signal });
    const after = projectFingerprint(sourceDir, { fsImpl });
    setProgress(input.job_id, { step: 'encode', detail: 'preview MP4' });
    const preview = path.join(outputDir, `${manifest.shot_id}_t${String(manifest.take).padStart(3, '0')}_unreal.mp4`);
    await encodePreview({ framesDir, framePattern: rendered.run.pattern, startNumber: rendered.run.start, manifest, root, outFile: preview, log, signal });
    setProgress(input.job_id, { step: 'verify', detail: 'decode and count every frame' });
    const playback = await probe(preview, { log, signal });
    const checks = {
      frames: { pass: rendered.run.count === manifest.frames.count && rendered.run.contiguous, detail: `${rendered.run.count} contiguous frames ${rendered.run.first}..${rendered.run.last}`, measured: { frames: rendered.run.count, expected: manifest.frames.count } },
      device: rendered.deviceCheck,
      project_preserved: { pass: before.sha256 === after.sha256, detail: before.sha256 === after.sha256 ? `approved project unchanged (${before.files} files)` : 'the approved Unreal project changed during the job', measured: { before: before.sha256, after: after.sha256, files: before.files } },
      timing: timingCheck(manifest, playback),
      resolution: { pass: playback.width === manifest.resolution.width && playback.height === manifest.resolution.height, detail: `${playback.width}x${playback.height}`, measured: { width: playback.width, height: playback.height } }
    };
    const checksFile = path.join(outputDir, 'checks.json');
    fsImpl.writeFileSync(checksFile, JSON.stringify(checks, null, 1));
    const resultFile = path.join(jobDir, 'unreal_render_result.json');
    const outputs = [
      artifact('preview_mp4', preview, root, 'Unreal Movie Render Queue preview (in-editor)'),
      { kind: 'frames', path: framesDir, project_path: path.relative(root, framesDir).split(path.sep).join('/'), sha256: null, bytes: null, label: `${rendered.run.count} frames` },
      artifact('checks', checksFile, root),
      artifact('render_result', resultFile, root, 'editor render result'),
      artifact('log', log, root, 'worker log'),
      artifact('log', rendered.renderLog, root, 'unreal_render.log'),
      { kind: 'level_sequence', path: sequence.sequence, project_path: null, sha256: null, bytes: null, label: `${manifest.unreal.sequence_id} in ${approved.id}` }
    ];
    const ok = playback.decoded_ok === true && Object.values(checks).every((c) => c.pass === true);
    return {
      schema: RENDER_OUTPUT_SCHEMA,
      ok,
      job_id: input.job_id,
      shot_id: manifest.shot_id,
      take: manifest.take,
      engine: { name: 'unreal', version: engine.version, changelist: engine.changelist, executable: engine.editor },
      worker: { node_id: process.env.MCCLUSTER_NODE_ID || null, hostname: os.hostname(), adapter: UNREAL_SEQUENCE_ADAPTER },
      unreal: { uproject: approved.uproject, map: sequence.map, sequence: sequence.sequence, project_id: approved.id, sequence_id: manifest.unreal.sequence_id, mode: 'sequence' },
      device: deviceReport(rendered.device),
      output_dir: outputDir,
      outputs,
      checks,
      playback,
      error: ok ? null : `render is not accepted: ${Object.entries(checks).filter(([, c]) => !c.pass).map(([k, c]) => `${k}: ${c.detail}`).join('; ')}`,
      started_at: started,
      finished_at: now().toISOString()
    };
  }

  async function renderBlender({ input, manifest, signal }) {
    const root = projectRoot(manifest.project_id);
    const { shotDir, jobDir, log } = jobDirs(root, manifest, input.job_id, 'blender');
    const started = now().toISOString();
    const master = resolveInProject(root, manifest.source.master);
    const before = sha256File(master);
    if (manifest.source.master_sha256 && before !== manifest.source.master_sha256) throw new ExecutorError('the master on this node is not the version the job names', { code: 'MASTER_VERSION_MISMATCH', status: 409 });
    const framesDir = path.join(shotDir, 'frames');
    fsImpl.rmSync(framesDir, { recursive: true, force: true });
    fsImpl.mkdirSync(framesDir, { recursive: true });
    const jobFile = path.join(jobDir, 'shot.json');
    const resultFile = path.join(jobDir, 'blender_render.json');
    fsImpl.writeFileSync(jobFile, JSON.stringify({ job_id: input.job_id, manifest, frames_dir: framesDir, result: resultFile }, null, 1));
    setProgress(input.job_id, { step: 'render', detail: 'Blender (local fallback)', frames_total: manifest.frames.count });
    let rendered = 0;
    await runner(tool('blender'), ['-b', '--factory-startup', master, '--python-exit-code', '3', '--python', adapter('blender/render_shot.py'), '--', jobFile],
      { logFile: log, timeoutMs: config.timeouts.render, signal, onLine: (line) => { if (/^Saved: /.test(line)) setProgress(input.job_id, { frames_done: ++rendered }); } });
    if (sha256File(master) !== before) throw new ExecutorError('the Blender master changed during render; the adapter must never save it', { code: 'MASTER_MODIFIED' });
    const result = readJson(resultFile);
    if (!result?.ok) throw new ExecutorError(`Blender render failed: ${result?.error || 'no result written'}`, { code: 'BLENDER_RENDER_FAILED' });
    const preview = path.join(shotDir, `${manifest.shot_id}_t${String(manifest.take).padStart(3, '0')}_blender.mp4`);
    setProgress(input.job_id, { step: 'encode', detail: 'preview MP4' });
    await encodePreview({ framesDir, framePattern: result.frame_pattern, startNumber: result.frame_start_number ?? manifest.frames.start, manifest, root, outFile: preview, log, signal });
    const playback = await probe(preview, { log, signal });
    const checks = { ...(result.checks || {}), timing: timingCheck(manifest, playback) };
    const checksFile = path.join(shotDir, 'checks.json');
    fsImpl.writeFileSync(checksFile, JSON.stringify(checks, null, 1));
    return {
      schema: RENDER_OUTPUT_SCHEMA,
      ok: playback.decoded_ok === true && checks.timing.pass === true,
      job_id: input.job_id, shot_id: manifest.shot_id, take: manifest.take,
      engine: { name: 'blender', version: result.blender_version || null, changelist: null, executable: tool('blender') },
      worker: { node_id: process.env.MCCLUSTER_NODE_ID || null, hostname: os.hostname(), adapter: 'mccluster-blender-shot/1' },
      unreal: null,
      outputs: [artifact('preview_mp4', preview, root, 'Blender preview'), artifact('checks', checksFile, root), artifact('log', log, root, 'worker log'),
        { kind: 'blend', path: master, project_path: manifest.source.master, sha256: before, bytes: null, label: 'editable master (unchanged)' }],
      checks, playback,
      error: playback.decoded_ok === true && checks.timing.pass === true ? null : `preview is not playable as specified: ${checks.timing.detail}`,
      started_at: started, finished_at: now().toISOString()
    };
  }

  async function facetrack({ input, signal }) {
    const manifest = normalizeFacetrack(input.manifest);
    const root = projectRoot(manifest.project_id);
    const take = resolveInProject(root, manifest.take);
    if (manifest.take_sha256 && sha256File(take) !== manifest.take_sha256) throw new ExecutorError('the take on this node is not the version the job names', { code: 'TAKE_VERSION_MISMATCH', status: 409 });
    const jobDir = path.join(root, 'jobs', input.job_id);
    const outDir = path.join(root, 'capture', 'extracted', manifest.actor_id, manifest.selection_id);
    for (const dir of [jobDir, outDir]) fsImpl.mkdirSync(dir, { recursive: true });
    const log = path.join(jobDir, 'worker.log');
    const curves = path.join(outDir, `curves_${manifest.actor_id}_${manifest.selection_id}.json`);
    setProgress(input.job_id, { step: 'facetrack', detail: 'MediaPipe Face Landmarker' });
    await runner(tool('python'), ['-I', tool('facetrack_script'), take, String(manifest.in_s), String(manifest.out_s), tool('face_model'), curves, '--work', path.join(jobDir, 'work'), '--selection', manifest.selection_id, '--actor', manifest.actor_id, '--ffmpeg', tool('ffmpeg')],
      { logFile: log, timeoutMs: config.timeouts.facetrack, signal });
    const doc = readJson(curves);
    const frames = Array.isArray(doc?.frames) ? doc.frames.length : (doc?.frames ? Object.keys(doc.frames).length : 0);
    const gaps = Array.isArray(doc?.gaps) ? doc.gaps.length : null;
    return {
      schema: RENDER_OUTPUT_SCHEMA, ok: Boolean(doc), job_id: input.job_id, shot_id: manifest.selection_id, take: null,
      engine: { name: 'mediapipe', version: doc?.mediapipe || doc?.receipt?.mediapipe || null, changelist: null, executable: tool('facetrack_script') },
      worker: { node_id: process.env.MCCLUSTER_NODE_ID || null, hostname: os.hostname(), adapter: 'mccluster-facetrack/1' },
      outputs: [artifact('curves', curves, root), artifact('log', log, root)],
      checks: { coverage: { pass: frames > 0, detail: `${frames} frames, ${gaps ?? 'unknown'} untracked`, measured: { frames, gaps } } },
      playback: null, error: doc ? null : 'no curves written', started_at: null, finished_at: now().toISOString()
    };
  }

  async function transcript({ input, signal }) {
    const manifest = normalizeTranscript(input.manifest);
    const root = projectRoot(manifest.project_id);
    const media = resolveInProject(root, manifest.media);
    const jobDir = path.join(root, 'jobs', input.job_id);
    const outDir = path.join(root, 'transcripts');
    for (const dir of [jobDir, outDir]) fsImpl.mkdirSync(dir, { recursive: true });
    const log = path.join(jobDir, 'worker.log');
    const out = path.join(outDir, `${path.basename(media).replace(/\.[^.]+$/, '')}.${manifest.model}.transcript.json`);
    setProgress(input.job_id, { step: 'transcript', detail: `Faster Whisper ${manifest.model}` });
    await runner(tool('python'), ['-I', config.tools.whisper_script ? tool('whisper_script') : adapter('shiloh/transcript.py'), '--media', media, '--model', manifest.model, '--language', manifest.language, '--out', out, ...(manifest.word_timestamps ? ['--words'] : []), ...(config.tools.whisper_models ? ['--models-dir', tool('whisper_models')] : [])],
      { logFile: log, timeoutMs: config.timeouts.transcript, signal });
    const doc = readJson(out);
    return {
      schema: RENDER_OUTPUT_SCHEMA, ok: Boolean(doc?.segments), job_id: input.job_id, shot_id: null, take: null,
      engine: { name: 'faster-whisper', version: doc?.engine_version || null, changelist: null, executable: null },
      worker: { node_id: process.env.MCCLUSTER_NODE_ID || null, hostname: os.hostname(), adapter: 'mccluster-transcript/1' },
      outputs: [artifact('transcript', out, root), artifact('log', log, root)],
      checks: { segments: { pass: Boolean(doc?.segments?.length), detail: `${doc?.segments?.length || 0} segments`, measured: { segments: doc?.segments?.length || 0 } } },
      playback: null, error: doc ? null : 'no transcript written', started_at: null, finished_at: now().toISOString()
    };
  }

  async function execute(body, { signal } = {}) {
    const capability = body?.capability;
    if (!PRODUCTION_WORKER_CAPABILITIES.includes(capability)) throw new ExecutorError(`capability ${capability} is not a production worker action`, { code: 'CAPABILITY_REFUSED', status: 400 });
    if (!config.capabilities.includes(capability)) throw new ExecutorError(`capability ${capability} is not enabled on this node`, { code: 'CAPABILITY_NOT_ON_NODE', status: 400 });
    const input = body.input || {};
    if (input.protocol !== PRODUCTION_PROTOCOL) throw new ExecutorError('task is not a production job', { code: 'PROTOCOL_MISMATCH', status: 400 });
    if (!/^[0-9a-f-]{36}$/i.test(String(input.job_id || ''))) throw new ExecutorError('job_id is invalid', { code: 'JOB_ID_INVALID', status: 400 });
    if (manifestHash(input.manifest || {}) !== input.manifest_sha256) throw new ExecutorError('manifest hash does not match', { code: 'MANIFEST_TAMPERED', status: 400 });
    setProgress(input.job_id, { step: 'start', capability });
    try {
      let result;
      if (capability === 'production.render.unreal' || capability === 'production.render.blender') {
        const manifest = normalizeShotRender(input.manifest);
        if (manifestHash(manifest) !== input.manifest_sha256) throw new ExecutorError('manifest is not normalized', { code: 'MANIFEST_TAMPERED', status: 400 });
        result = capability === 'production.render.unreal' ? await renderUnreal({ input, manifest, signal }) : await renderBlender({ input, manifest, signal });
      } else if (capability === 'production.facetrack.mediapipe') result = await facetrack({ input, signal });
      else result = await transcript({ input, signal });
      setProgress(input.job_id, { step: 'done', ok: result.ok });
      return result;
    } catch (error) {
      setProgress(input.job_id, { step: 'failed', error: String(error.message).slice(0, 300) });
      throw error;
    }
  }

  function ready() {
    const unreal = config.tools.unreal_root ? detect(config.tools.unreal_root) : null;
    const has = (name) => Boolean(config.tools[name] && fsImpl.existsSync(config.tools[name]));
    return {
      ok: true,
      node_label: config.nodeLabel,
      capabilities: config.capabilities,
      projects: Object.keys(config.projects),
      // Approved Unreal ids only (no paths): what sequence-mode jobs may name.
      unreal_projects: Object.fromEntries(Object.values(config.unrealProjects).map((p) => [p.id, { production_project: p.productionProject, rhi: p.rhi, require_adapter: p.requireAdapter, isolate: p.isolate, sequences: Object.keys(p.sequences) }])),
      engines: {
        unreal: unreal ? { ok: unreal.ok, version: unreal.version || null, changelist: unreal.changelist || null, reason: unreal.reason || null } : null,
        blender: has('blender'),
        ffmpeg: has('ffmpeg') && has('ffprobe'),
        python: has('python')
      }
    };
  }

  return { execute, ready, progress: (jobId) => progress.get(jobId) || null };
}

/* ---------- loopback HTTP server ---------- */

export function startExecutorServer(executor, { host = '127.0.0.1', port = 4792 } = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('The production executor binds to loopback only');
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
      res.end(payload);
    };
    try {
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && (url.pathname === '/ready' || url.pathname === '/health')) return send(200, executor.ready());
      if (req.method === 'GET' && url.pathname === '/progress') return send(200, executor.progress(String(url.searchParams.get('job_id') || '').slice(0, 64)) || {});
      if (req.method !== 'POST' || url.pathname !== '/execute') return send(404, { error: 'not found' });
      if (!String(req.headers['content-type'] || '').includes('application/json')) return send(415, { error: 'application/json required' });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) return send(413, { error: 'body too large' }); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      // The node agent aborts this request when the lease is lost or the
      // owner cancels: the adapter process tree is stopped.
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableFinished) controller.abort(); });
      const result = await executor.execute(body, { signal: controller.signal });
      return send(200, result);
    } catch (error) {
      const status = Number(error.status) || 500;
      // 5xx tells the node agent the failure may be retried; contract,
      // path and version errors are 4xx and final.
      return send(error.retryable ? 503 : (status >= 500 ? 422 : status), { error: error.message, code: error.code || null, detail: error.detail || null });
    }
  });
  server.listen(port, host);
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const configPath = process.env.MCCLUSTER_PRODUCTION_CONFIG || process.argv[2];
  if (!configPath) { console.error('usage: node executor.mjs <production-executor.json>'); process.exit(2); }
  const config = loadExecutorConfig(JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^﻿/, '')));
  const executor = createProductionExecutor(config);
  const port = Number(process.env.MCCLUSTER_PRODUCTION_PORT || 4792);
  startExecutorServer(executor, { port });
  console.log(JSON.stringify({ event: 'production_executor_listening', port, ...executor.ready() }));
}
