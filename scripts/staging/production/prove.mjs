#!/usr/bin/env node
// Proof of one real production job through the production staging:
// submit (or take the id Creator Suite submitted), watch the worker claim
// and render it, then check the result independently of the worker:
// decode the preview and count every frame with ffprobe, compare hashes,
// fetch it through the same URL the app opens, read the engine log for the
// Unreal version and the GPU. Then one retake with one change, and check
// that only s31 rendered again.
//
//   node scripts/staging/production/prove.mjs --run-dir <staging run dir> --out <proof dir>
//     [--job <id>]          a job Creator Suite submitted (else this script submits, labelled proof-cli)
//     [--retake-job <id>]   the retake Creator Suite submitted (else this script submits it)
//     [--manifest scripts/staging/production/s31-proof.manifest.json]
//     [--ffprobe <path>] [--ffmpeg <path>] [--timeout-s 3600]
//
// Exit 0 only when every check is true. <out>/proof.json and PROOF.md say
// what ran, where it is and who submitted it. No secret is written.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { productionClient } from './client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArgs(argv) {
  const o = { manifest: path.join(ROOT, 'scripts/staging/production/s31-proof.manifest.json'), ffprobe: 'ffprobe', ffmpeg: 'ffmpeg', timeoutS: 3600 };
  for (let i = 0; i < argv.length; i += 2) {
    const [a, v] = [argv[i], argv[i + 1]];
    if (a === '--run-dir') o.runDir = path.resolve(v);
    else if (a === '--out') o.out = path.resolve(v);
    else if (a === '--job') o.job = v;
    else if (a === '--retake-job') o.retakeJob = v;
    else if (a === '--manifest') o.manifest = path.resolve(v);
    else if (a === '--ffprobe') o.ffprobe = v;
    else if (a === '--ffmpeg') o.ffmpeg = v;
    else if (a === '--timeout-s') o.timeoutS = Number(v);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.runDir || !o.out) throw new Error('--run-dir and --out are required');
  return o;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function probe(o, file) {
  const raw = JSON.parse(execFileSync(o.ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 << 20 }));
  const video = raw.streams.find((s) => s.codec_type === 'video');
  let decodeErrors = '';
  try { decodeErrors = execFileSync(o.ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { decodeErrors = String(error.stderr || error.message); }
  return {
    frames_counted: Number(video?.nb_read_frames), width: video?.width, height: video?.height, codec: video?.codec_name, r_frame_rate: video?.r_frame_rate,
    duration_s: Number(raw.format?.duration), audio_streams: raw.streams.filter((s) => s.codec_type === 'audio').length, decode_errors: decodeErrors.trim().slice(0, 2000)
  };
}

function logLines(file, patterns) {
  if (!file || !fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  return text.filter((line) => patterns.some((p) => p.test(line))).slice(0, 20).map((l) => l.trim().slice(0, 300));
}

async function verify(o, core, job, { submittedAt, expectTake, earlier = [] }) {
  const checks = {};
  const add = (name, pass, detail) => { checks[name] = { pass: Boolean(pass), detail }; };
  add('succeeded', job.status === 'succeeded', `status ${job.status}${job.error ? `: ${job.error}` : ''}`);
  add('claimed_by_worker', Boolean(job.worker?.node_id) && job.attempts?.used >= 1, `node ${job.worker?.node_id || 'none'} (${job.worker?.hostname || '?'}), attempts ${job.attempts?.used}/${job.attempts?.max}`);
  add('unreal_version_logged', job.engine_version?.name === 'unreal' && /^5\.\d+\.\d+/.test(job.engine_version?.version || ''), `Unreal ${job.engine_version?.version} CL ${job.engine_version?.changelist}`);
  add('gpu_device_logged', job.device?.gpu_verified === true && job.device?.rhi === 'D3D12' && job.device?.software === false, `${job.device?.adapter} via ${job.device?.rhi}${job.device?.driver ? `, driver ${job.device.driver}` : ''}`);
  add('approved_sequence', job.unreal?.mode === 'sequence' && job.unreal?.sequence_id === 's31-standin' && job.unreal?.project_id === 'gib-s31-proof', `${job.unreal?.project_id}/${job.unreal?.sequence_id} = ${job.unreal?.sequence}`);
  add('take', job.shot_id === 's31' && job.take === expectTake, `shot ${job.shot_id} take ${job.take}`);
  const outDir = job.output_dir;
  const created = outDir && fs.existsSync(outDir) ? fs.statSync(outDir).birthtimeMs || fs.statSync(outDir).ctimeMs : 0;
  add('new_output_dir', Boolean(outDir) && created >= submittedAt - 2000 && !earlier.includes(outDir), `${outDir} (created ${created ? new Date(created).toISOString() : 'never'})`);
  const preview = job.preview;
  add('preview_in_output_dir', Boolean(preview?.path) && path.dirname(preview.path) === outDir, preview?.path || 'no preview');
  let measured = null; let opened = null;
  if (preview?.path && fs.existsSync(preview.path)) {
    add('preview_hash', sha256(preview.path) === preview.sha256, `sha256 ${preview.sha256}`);
    measured = probe(o, preview.path);
    add('decoded_120_frames', measured.frames_counted === 120 && !measured.decode_errors, `ffprobe -count_frames: ${measured.frames_counted} frames; ffmpeg decode errors: ${measured.decode_errors || 'none'}`);
    add('format', measured.width === 720 && measured.height === 1280 && Math.abs(measured.duration_s - 5) <= 1.5 / 24 && measured.audio_streams === 0, `${measured.width}x${measured.height}, ${measured.duration_s} s, ${measured.r_frame_rate} fps, ${measured.audio_streams} audio streams`);
    // The app's path: a ticketed URL, played with Range requests.
    opened = await core.openPreview(job.id);
    const full = Buffer.from(await (await fetch(opened.url)).arrayBuffer());
    const part = await fetch(opened.url, { headers: { range: 'bytes=0-1023' } });
    add('app_opens_preview', crypto.createHash('sha256').update(full).digest('hex') === preview.sha256 && part.status === 206, `GET ${opened.url.replace(/ticket=[^&]+/, 'ticket=…')} → ${full.length} bytes, Range → ${part.status}`);
  } else add('preview_hash', false, 'preview file missing');
  const logs = (job.outputs || []).filter((x) => x.kind === 'log').map((x) => x.path);
  const ueLog = logs.find((p) => /unreal_render\.log$/.test(p));
  const evidence = logLines(ueLog, [/Engine Version/, /D3D12 adapter|Chosen D3D12|Creating D3D12 RHI|RHI Adapter Info|\bName\s*:|Driver Version/, /LogMovieRenderPipeline.*(Finished|Rendering|Error)/]);
  add('logs_present', logs.length >= 2 && evidence.some((l) => /Engine Version/.test(l)), `${logs.length} logs; ${evidence.length} engine/device lines`);
  return { job_id: job.id, compute_task_id: job.compute_task_id, status: job.status, take: job.take, retake_of: job.retake_of, worker: job.worker, attempts: job.attempts, engine: job.engine_version, device: job.device, unreal: job.unreal, output_dir: outDir, preview, measured, opened: opened ? { path: opened.path, bytes: opened.bytes } : null, logs, engine_log_evidence: evidence, worker_checks: job.checks, checks, ok: Object.values(checks).every((c) => c.pass) };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const staging = JSON.parse(fs.readFileSync(path.join(o.runDir, 'staging.json'), 'utf8'));
  const token = fs.readFileSync(path.join(o.runDir, staging.files.owner_token), 'utf8').trim();
  const core = productionClient({ baseUrl: staging.urls.production_api, token, client: 'proof-cli' });
  fs.mkdirSync(o.out, { recursive: true });
  const progress = [];
  const onProgress = (job) => { const p = { at: new Date().toISOString(), job_id: job.id, status: job.status, node: job.worker?.node_id || null, progress: job.progress }; progress.push(p); console.error(JSON.stringify({ event: 'progress', ...p })); };
  const manifest = JSON.parse(fs.readFileSync(o.manifest, 'utf8'));

  // Take 1.
  let submittedAt = Date.now(); let first; let submittedBy = 'creator-suite';
  if (o.job) first = await core.job(o.job);
  else {
    submittedBy = 'proof-cli (NOT Creator Suite)';
    const validation = await core.validate(manifest);
    if (!validation.ok) throw new Error(`the s31 manifest does not validate: ${validation.errors.join('; ')}`);
    first = (await core.submit(manifest)).job;
    const replay = (await core.submit(manifest)).job;
    if (replay.id !== first.id || replay.replayed !== true) throw new Error('the same manifest did not return the same job');
  }
  const done1 = await core.waitFor(first.id, { onProgress, timeoutMs: o.timeoutS * 1000 });
  const one = await verify(o, core, done1, { submittedAt: o.job ? Date.parse(done1.created_at) : submittedAt, expectTake: done1.take });
  const firstPreviewSha = one.preview?.sha256 || null;

  // Retake: one change, the same shot only.
  submittedAt = Date.now(); let retake; let retakeBy = 'creator-suite';
  if (o.retakeJob) retake = await core.job(o.retakeJob);
  else { retakeBy = 'proof-cli (NOT Creator Suite)'; retake = (await core.retake(done1.id, { note: 'retake: one change (note) — only s31 renders again' })).job; }
  const done2 = await core.waitFor(retake.id, { onProgress, timeoutMs: o.timeoutS * 1000 });
  const two = await verify(o, core, done2, { submittedAt: o.retakeJob ? Date.parse(done2.created_at) : submittedAt, expectTake: done1.take + 1, earlier: [one.output_dir] });
  two.checks.retake_scope = { pass: done2.retake_of === done1.id && done2.shot_id === 's31' && done2.id !== done1.id, detail: `retake ${done2.id} of ${done2.retake_of}, shot ${done2.shot_id}` };
  two.checks.first_render_untouched = { pass: Boolean(firstPreviewSha) && fs.existsSync(one.preview.path) && sha256(one.preview.path) === firstPreviewSha, detail: one.preview?.path || 'no first preview' };
  const after1 = await core.job(done1.id);
  two.checks.first_job_unchanged = { pass: after1.status === 'succeeded' && after1.output_dir === one.output_dir && after1.take === one.take, detail: `take ${after1.take} still ${after1.status} at ${after1.output_dir}` };
  two.ok = Object.values(two.checks).every((c) => c.pass);

  const proof = {
    schema: 'mccluster-production-proof/1', at: new Date().toISOString(), staging: { org_id: staging.org_id, urls: staging.urls, production: staging.production, database: staging.database, schema_files: staging.schema_files },
    submitted_by: { take_1: submittedBy, retake: retakeBy }, take_1: one, retake: two, progress, ok: one.ok && two.ok
  };
  fs.writeFileSync(path.join(o.out, 'proof.json'), JSON.stringify(proof, null, 2));
  const md = [`# s31 through Core (production staging) — ${proof.ok ? 'PASS' : 'FAIL'}`, '', `- Staging: ${staging.database}; production: ${staging.production}`, `- Submitted by: take 1 ${submittedBy}; retake ${retakeBy}`, ''];
  for (const [label, r] of [['Take 1', one], ['Retake', two]]) {
    md.push(`## ${label}: job ${r.job_id}`, '', `- Worker: ${r.worker?.node_id} (${r.worker?.hostname}), adapter ${r.worker?.adapter}`, `- Unreal ${r.engine?.version} CL ${r.engine?.changelist}; ${r.device?.adapter} via ${r.device?.rhi}`, `- Output: ${r.output_dir}`, `- Preview: ${r.preview?.path} (${r.measured?.frames_counted} frames counted, ${r.measured?.width}x${r.measured?.height}, ${r.measured?.duration_s} s)`, '', '| check | pass | detail |', '| --- | --- | --- |');
    for (const [name, c] of Object.entries(r.checks)) md.push(`| ${name} | ${c.pass ? 'yes' : '**no**'} | ${String(c.detail).replace(/\|/g, '/')} |`);
    md.push('', 'Engine log:', '', ...r.engine_log_evidence.map((l) => `    ${l}`), '');
  }
  fs.writeFileSync(path.join(o.out, 'PROOF.md'), md.join('\n'));
  console.log(JSON.stringify({ event: 'production_proof', ok: proof.ok, take_1: { job_id: one.job_id, output_dir: one.output_dir, preview: one.preview?.path, frames: one.measured?.frames_counted }, retake: { job_id: two.job_id, output_dir: two.output_dir, preview: two.preview?.path, frames: two.measured?.frames_counted }, out: o.out }));
  process.exit(proof.ok ? 0 : 1);
}

main().catch((error) => { console.error(JSON.stringify({ event: 'production_proof_failed', error: error.message, code: error.code || null, body: error.body || null })); process.exit(2); });
