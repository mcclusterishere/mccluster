// The production job service, end to end against an in-memory store and
// compute queue with the Supabase semantics: authorization, consent,
// validation, idempotency, bounded retries, cancellation (queued and
// running), retake scoping and artifact lookup. No real worker runs here;
// worker outputs below are labelled simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionService } from '../src/production/service.mjs';
import { memoryProductionStore } from '../src/production/store.mjs';
import {
  ProductionContractError, RENDER_OUTPUT_SCHEMA, normalizeShotRender, manifestHash, planRetake, productionStatus,
  validateShotAgainstProject, isRelativeProjectPath, boundedAttempts, canonicalJson, validateRenderOutput
} from '../src/production/contract.mjs';
import { callProductionTool, PRODUCTION_TOOLS } from '../src/tools/production.mjs';
import { ORG, OWNER, EDITOR, VIEWER, STRANGER, project, s31Manifest, memoryCompute } from './helpers/production-fixtures.mjs';

function setup() {
  const store = memoryProductionStore({ projects: [project()], orgOwners: [{ org_id: ORG, profile_id: OWNER.user_id }] });
  const compute = memoryCompute();
  const svc = createProductionService({ store, compute });
  return { store, compute, svc };
}

function simulatedOutput(task, overrides = {}) {
  const m = task.input.manifest;
  return {
    schema: RENDER_OUTPUT_SCHEMA, ok: true, simulated: true, job_id: task.input.job_id, shot_id: m.shot_id, take: m.take,
    engine: { name: 'unreal', version: '5.8.4', changelist: 58902052, executable: 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe' },
    worker: { node_id: 'node_prime', hostname: 'prime', adapter: 'mccluster-unreal-mrq/1' },
    unreal: { uproject: 'C:/p/unreal/McCPreviz/McCPreviz.uproject', map: `/Game/Shots/${m.shot_id}/T00${m.take}/Map_${m.shot_id}`, sequence: `/Game/Shots/${m.shot_id}/T00${m.take}/LS_${m.shot_id}_T00${m.take}.LS_${m.shot_id}_T00${m.take}` },
    outputs: [{ kind: 'preview_mp4', path: `C:/p/renders/unreal/${m.shot_id}/t00${m.take}/${m.shot_id}_t00${m.take}_unreal.mp4`, project_path: `renders/unreal/${m.shot_id}/t00${m.take}/${m.shot_id}_t00${m.take}_unreal.mp4`, sha256: 'a'.repeat(64), bytes: 1234 },
      { kind: 'log', path: 'C:/p/jobs/x/worker.log', sha256: 'b'.repeat(64), bytes: 99 }],
    checks: { scale: { pass: true }, framing: { pass: true }, phone_grip: { pass: true }, timing: { pass: true } },
    playback: { duration_s: 5, frames: 120, width: 720, height: 1280, has_audio: true, codec: 'h264', decoded_ok: true },
    ...overrides
  };
}

test('contract: normalization drops unknown fields, bounds the shot, and hashes canonically', () => {
  const m = normalizeShotRender({ ...s31Manifest(), command: 'rm -rf /', source: { ...s31Manifest().source, script: 'import os' } });
  assert.equal('command' in m, false);
  assert.equal('script' in m.source, false);
  assert.equal(m.frames.count, 120);
  assert.equal(m.frames.duration_s, 5);
  assert.deepEqual(m.frames.cut, { start: 2360, end: 2451 });
  assert.equal(manifestHash(m), manifestHash(normalizeShotRender(structuredClone(s31Manifest()))));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  assert.throws(() => normalizeShotRender(s31Manifest({ frames: { start: 0, end: 24 * 30, fps: 24 } })), /outside/);
  assert.throws(() => normalizeShotRender(s31Manifest({ frames: { start: 10, end: 20, fps: 23 } })), /fps/);
  assert.throws(() => normalizeShotRender(s31Manifest({ frames: { start: 2350, end: 2469, fps: 24, cut: { start: 2300, end: 2400 } } })), /cut/);
  assert.throws(() => normalizeShotRender(s31Manifest({ engine: 'shell' })), /engine/);
  assert.throws(() => normalizeShotRender(s31Manifest({ resolution: { width: 721, height: 1280 } })), /even/);
  for (const bad of ['../x.blend', '/etc/passwd', 'C:/Windows/x', 'blend\\x.blend', 'a//b', './a', 'a/../b', '']) {
    assert.equal(isRelativeProjectPath(bad), false, bad);
  }
  assert.equal(isRelativeProjectPath('blend/proof_phone_call-s31-phone-v3.blend'), true);
  assert.throws(() => normalizeShotRender(s31Manifest({ source: { ...s31Manifest().source, master: '../../secrets.blend' } })), ProductionContractError);
  assert.equal(boundedAttempts(50), 3);
  assert.equal(boundedAttempts(0), 1);
});

test('contract: validation against the project checks assets, versions, approval and consent', () => {
  const p = project();
  const ok = validateShotAgainstProject(normalizeShotRender(s31Manifest()), p);
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.warnings.some((w) => /handles/.test(w)));
  const wrongVersion = validateShotAgainstProject(normalizeShotRender(s31Manifest({ source: { ...s31Manifest().source, master_sha256: 'c'.repeat(64) } })), p);
  assert.ok(wrongVersion.errors.some((e) => /master_sha256/.test(e)));
  const unapprovedSet = structuredClone(p);
  unapprovedSet.assets[1].approved = false;
  assert.ok(validateShotAgainstProject(normalizeShotRender(s31Manifest()), unapprovedSet).errors.some((e) => /not approved/.test(e)));
  const withPerformance = normalizeShotRender(s31Manifest({ actors: [{ id: 'dave', performance: 'capture/takes/t01/dave.webm' }] }));
  assert.ok(validateShotAgainstProject(withPerformance, p).errors.some((e) => /dave consent does not cover performance/.test(e)));
  const revoked = structuredClone(p);
  revoked.consents[0].revoked_at = '2026-11-28T01:00:00Z';
  const perf = normalizeShotRender(s31Manifest({ actors: [{ id: 'matthew', performance: 'capture/takes/t01/matthew_camera.webm' }] }));
  assert.ok(validateShotAgainstProject(perf, revoked).errors.some((e) => /no active consent/.test(e)));
  const outside = normalizeShotRender(s31Manifest({ frames: { start: 10, end: 129, fps: 24 } }));
  assert.ok(validateShotAgainstProject(outside, p).errors.some((e) => /do not overlap/.test(e)));
  const noPhone = normalizeShotRender(s31Manifest({ source: { ...s31Manifest().source, props: [] } }));
  assert.ok(validateShotAgainstProject(noPhone, p).errors.some((e) => /phone_grip/.test(e)));
});

test('service: authorization follows org ownership and project roles; the actor is required', async () => {
  const { svc } = setup();
  await assert.rejects(svc.projectGet({ orgId: ORG, projectId: 'get-it-back', actor: null }), { code: 'PRODUCTION_ACTOR_REQUIRED' });
  await assert.rejects(svc.projectGet({ orgId: ORG, projectId: 'get-it-back', actor: STRANGER }), { code: 'PRODUCTION_FORBIDDEN' });
  assert.equal((await svc.projectGet({ orgId: ORG, projectId: 'get-it-back', actor: OWNER })).role, 'owner');
  assert.equal((await svc.projectGet({ orgId: ORG, projectId: 'get-it-back', actor: VIEWER })).role, 'viewer');
  await assert.rejects(svc.renderSubmit({ orgId: ORG, actor: VIEWER, manifest: s31Manifest() }), { code: 'PRODUCTION_FORBIDDEN' });
  const { job } = await svc.renderSubmit({ orgId: ORG, actor: EDITOR, manifest: s31Manifest() });
  assert.equal(job.status, 'queued');
  const assets = await svc.assetLookup({ orgId: ORG, projectId: 'get-it-back', actor: VIEWER, kind: 'master' });
  assert.deepEqual(assets.assets.map((a) => a.asset_id), ['proof-phone-call-s31', 'episode-60']);
  await assert.rejects(svc.projectGet({ orgId: '00000000-0000-4000-8000-000000000999', projectId: 'get-it-back', actor: OWNER }), { code: 'PRODUCTION_FORBIDDEN' });
});

test('service: one shot queues one owned-worker task; resubmitting is idempotent; a changed manifest is a new job', async () => {
  const { svc, compute } = setup();
  const first = await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest(), maxAttempts: 9 });
  assert.equal(compute.tasks.size, 1);
  const task = [...compute.tasks.values()][0];
  assert.equal(task.capability, 'production.render.unreal');
  assert.equal(task.max_attempts, 3, 'retries are bounded at 3 attempts');
  assert.equal(task.input.protocol, 'mccluster-production/1');
  assert.equal(task.input.manifest_sha256, manifestHash(task.input.manifest));
  assert.equal(JSON.stringify(task.input).includes('C:\\'), false, 'no machine path reaches a worker');
  const again = await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest() });
  assert.equal(again.job.id, first.job.id);
  assert.equal(again.job.replayed, true);
  assert.equal(compute.tasks.size, 1);
  const blender = await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest({ engine: 'blender' }) });
  assert.notEqual(blender.job.id, first.job.id);
  assert.equal([...compute.tasks.values()][1].capability, 'production.render.blender');
});

test('service: invalid shots are refused before anything is queued', async () => {
  const { svc, compute } = setup();
  await assert.rejects(svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest({ source: { ...s31Manifest().source, master: 'blend/unregistered.blend' } }) }), { code: 'PRODUCTION_SHOT_INVALID' });
  await assert.rejects(svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest({ project_id: 'missing-project' }) }), { code: 'PRODUCTION_PROJECT_NOT_FOUND' });
  assert.equal(compute.tasks.size, 0);
  const validation = await svc.shotValidate({ orgId: ORG, actor: VIEWER, manifest: s31Manifest() });
  assert.equal(validation.ok, true);
  assert.match(validation.job_key, /^render:get-it-back:s31:t1:/);
});

test('service: a worker result becomes job status, engine version, outputs and artifacts (simulated worker)', async () => {
  const { svc, compute, store } = setup();
  const { job } = await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest() });
  const claimed = compute.claim('node_prime', ['production.render.unreal']);
  store._leases.set(claimed.id, { node_id: 'node_prime', status: 'running', progress: { state: 'running', step: 'render', frames_done: 40, frames_total: 120 } });
  const running = await svc.jobGet({ orgId: ORG, jobId: job.id, actor: VIEWER });
  assert.equal(running.job.status, 'running');
  assert.equal(running.job.progress.frames_done, 40);
  assert.equal(running.job.worker.node_id, 'node_prime');
  compute.complete(claimed.id, simulatedOutput(claimed));
  const done = await svc.jobGet({ orgId: ORG, jobId: job.id, actor: VIEWER });
  assert.equal(done.job.status, 'succeeded');
  assert.equal(done.job.engine_version.version, '5.8.4');
  assert.equal(done.job.simulated, true, 'a simulated result says so');
  assert.equal(done.job.checks_passed, true);
  assert.match(done.job.unreal.sequence, /LS_s31_T001/);
  const { artifacts } = await svc.artifactGet({ orgId: ORG, actor: VIEWER, jobId: job.id });
  assert.deepEqual(artifacts.map((a) => a.kind).sort(), ['log', 'preview_mp4']);
  assert.ok(artifacts.every((a) => a.storage === 'node-local' && a.node_id === 'node_prime' && a.simulated === true));
  await svc.artifactGet({ orgId: ORG, actor: VIEWER, jobId: job.id });
  assert.equal(store._artifacts.length, 2, 'artifact sync is idempotent');
  await assert.rejects(svc.artifactGet({ orgId: ORG, actor: STRANGER, jobId: job.id }), { code: 'PRODUCTION_FORBIDDEN' });
});

test('service: bounded retries end in failed with the last error', async () => {
  const { svc, compute } = setup();
  const { job } = await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest(), maxAttempts: 2 });
  for (let i = 0; i < 5; i += 1) {
    const t = compute.claim('node_prime', ['production.render.unreal']);
    if (!t) break;
    compute.fail(t.id, `RENDER_INCOMPLETE attempt ${t.attempts}`, true);
  }
  const { job: after } = await svc.jobGet({ orgId: ORG, jobId: job.id, actor: OWNER });
  assert.equal(after.status, 'failed');
  assert.deepEqual(after.attempts, { used: 2, max: 2 });
  assert.match(after.error, /attempt 2/);
});

test('service: cancel is atomic for a queued job and a request for a running one', async () => {
  const { svc, compute, store } = setup();
  const queued = (await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest() })).job;
  const c1 = await svc.jobCancel({ orgId: ORG, jobId: queued.id, actor: OWNER });
  assert.equal(c1.canceled, true);
  assert.equal(c1.job.status, 'canceled');
  assert.equal(compute.claim('node_prime', ['production.render.unreal']), null, 'a canceled task cannot be claimed');

  const running = (await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest({ take: 2 }) })).job;
  const t = compute.claim('node_prime', ['production.render.unreal']);
  await assert.rejects(svc.jobCancel({ orgId: ORG, jobId: running.id, actor: VIEWER }), { code: 'PRODUCTION_FORBIDDEN' });
  const c2 = await svc.jobCancel({ orgId: ORG, jobId: running.id, actor: EDITOR, reason: 'wrong lens' });
  assert.equal(c2.canceled, false);
  assert.equal(c2.cancel_requested, true);
  assert.equal(c2.job.status, 'cancel_requested');
  assert.deepEqual(store._cancels.at(-1), { orgId: ORG, taskId: t.id, reason: 'wrong lens' });
  compute.fail(t.id, 'CANCELED: task canceled by its owner', false);
  assert.equal((await svc.jobGet({ orgId: ORG, jobId: running.id, actor: OWNER })).job.status, 'canceled');
  const late = await svc.jobCancel({ orgId: ORG, jobId: running.id, actor: OWNER });
  assert.equal(late.canceled, false);
  assert.match(late.reason, /already canceled/);
});

test('service: a retake queues exactly one new take of the same shot and nothing else', async () => {
  const { svc, compute } = setup();
  const t1 = (await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest() })).job;
  const other = (await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31Manifest({ shot_id: 's31b' }) })).job;
  const claimed = [compute.claim('node_prime', ['production.render.unreal']), compute.claim('node_prime', ['production.render.unreal'])];
  for (const c of claimed) compute.complete(c.id, simulatedOutput(c));
  const before = compute.tasks.size;
  const retake = await svc.renderSubmit({ orgId: ORG, actor: OWNER, retakeOf: t1.id, changes: { note: 'tighter grip' } });
  assert.equal(compute.tasks.size, before + 1, 'exactly one task');
  const newTask = [...compute.tasks.values()].at(-1);
  assert.equal(newTask.input.manifest.shot_id, 's31');
  assert.equal(newTask.input.manifest.take, 2);
  assert.equal(newTask.input.manifest.retake_of, t1.id);
  assert.equal(retake.job.retake_of, t1.id);
  assert.equal(other.shot_id, 's31b');
  await assert.rejects(svc.renderSubmit({ orgId: ORG, actor: OWNER, retakeOf: t1.id, changes: { shot_id: 's32' } }), { code: 'RETAKE_SCOPE' });
  const third = await svc.renderSubmit({ orgId: ORG, actor: OWNER, retakeOf: t1.id, changes: { note: 'again' } });
  assert.equal(third.job.take, 3, 'takes count up per shot, not per retake source');
  assert.throws(() => planRetake(null), { code: 'RETAKE_UNKNOWN' });
});

test('service: face-track and transcript need consent and a registered recording', async () => {
  const { svc, compute } = setup();
  const ft = { project_id: 'get-it-back', actor_id: 'matthew', take: 'capture/takes/t01/matthew_camera.webm', in_s: 1.5, out_s: 6.5, selection_id: 'sel-01' };
  const { job } = await svc.facetrackSubmit({ orgId: ORG, actor: OWNER, manifest: ft });
  assert.equal([...compute.tasks.values()].at(-1).capability, 'production.facetrack.mediapipe');
  assert.equal(job.kind, 'facetrack');
  await assert.rejects(svc.facetrackSubmit({ orgId: ORG, actor: OWNER, manifest: { ...ft, actor_id: 'dave' } }), { code: 'PRODUCTION_CONSENT_REQUIRED' });
  await assert.rejects(svc.facetrackSubmit({ orgId: ORG, actor: OWNER, manifest: { ...ft, take: 'capture/takes/t09/unknown.webm' } }), { code: 'PRODUCTION_SHOT_INVALID' });
  await assert.rejects(svc.facetrackSubmit({ orgId: ORG, actor: OWNER, manifest: { ...ft, take: '../../Users/x.webm' } }), ProductionContractError);
  const tr = await svc.transcriptSubmit({ orgId: ORG, actor: OWNER, manifest: { project_id: 'get-it-back', media: 'capture/takes/t01/matthew_camera.webm', actor_id: 'matthew' } });
  assert.equal([...compute.tasks.values()].at(-1).capability, 'production.transcript.whisper');
  assert.equal(tr.job.kind, 'transcript');
  await assert.rejects(svc.transcriptSubmit({ orgId: ORG, actor: OWNER, manifest: { project_id: 'get-it-back', media: 'capture/takes/t01/matthew_camera.webm', actor_id: 'dave' } }), { code: 'PRODUCTION_CONSENT_REQUIRED' });
});

test('worker output is validated; status mapping covers every task state', () => {
  assert.throws(() => validateRenderOutput({ schema: 'x' }), { code: 'OUTPUT_INVALID' });
  assert.throws(() => validateRenderOutput({ schema: RENDER_OUTPUT_SCHEMA, outputs: [{ kind: 'shell', path: 'x' }] }), /artifact kind/);
  assert.equal(productionStatus({ status: 'queued' }), 'queued');
  assert.equal(productionStatus({ status: 'leased' }), 'running');
  assert.equal(productionStatus({ status: 'running' }, { cancel_requested_at: 'x' }), 'cancel_requested');
  assert.equal(productionStatus({ status: 'failed' }, { cancel_requested_at: 'x' }), 'canceled');
  assert.equal(productionStatus({ status: 'done', output: { ok: false } }), 'failed');
  assert.equal(productionStatus({ status: 'done', output: { ok: true } }), 'succeeded');
});

test('tools: nine named actions, none takes a command, and the actor comes from the broker', async () => {
  assert.equal(PRODUCTION_TOOLS.length, 9);
  for (const tool of PRODUCTION_TOOLS) {
    const keys = [];
    (function walk(node) { if (node && typeof node === 'object') { if (node.properties) keys.push(...Object.keys(node.properties)); Object.values(node).forEach(walk); } })(tool.inputSchema);
    assert.equal(keys.some((k) => /^(command|cmd|script|code|shell|exec|argv|executable|python|args)$/.test(k)), false, tool.name);
    assert.match(tool.name, /^core\.production\./);
  }
  const { svc } = setup();
  await assert.rejects(callProductionTool('core.production.project.get', { org_id: ORG, project_id: 'get-it-back', actor: OWNER }, {}, { svc }), { code: 'PRODUCTION_ACTOR_REQUIRED' });
  const ok = await callProductionTool('core.production.project.get', { org_id: ORG, project_id: 'get-it-back' }, { actor: OWNER }, { svc });
  assert.equal(ok.project.id, 'get-it-back');
  await assert.rejects(callProductionTool('core.production.shell', { org_id: ORG }, { actor: OWNER }, { svc }), { code: 'TOOL_NOT_FOUND' });
});

test('service: a sequence-mode s31 job — approved sequence, live progress while running, the lease node and a preview once done', async () => {
  const { s31SequenceManifest, s31SequenceAsset } = await import('./helpers/production-fixtures.mjs');
  const p = project();
  p.assets.push(s31SequenceAsset());
  const store = memoryProductionStore({ projects: [p], orgOwners: [{ org_id: ORG, profile_id: OWNER.user_id }] });
  const compute = memoryCompute();
  const svc = createProductionService({ store, compute });
  const { job } = await svc.renderSubmit({ orgId: ORG, actor: OWNER, manifest: s31SequenceManifest(), source: 'creator-suite' });
  assert.equal(job.status, 'queued');
  assert.equal(job.preview, null);
  const task = compute.claim('node_prime', ['production.render.unreal']);
  assert.deepEqual(task.input.manifest.unreal, { project_id: 'gib-s31-proof', sequence_id: 's31-standin' });
  assert.equal(task.input.manifest.source.master, null);
  store._leases.set(task.id, { node_id: 'node_prime', status: 'running', progress: { step: 'render', frames_done: 61, frames_total: 120 } });
  const running = (await svc.jobGet({ orgId: ORG, actor: OWNER, jobId: job.id })).job;
  assert.equal(running.status, 'running');
  assert.equal(running.progress.frames_done, 61);
  // Done: the executor reports no node id; the lease node is the worker of record.
  compute.complete(task.id, simulatedOutput(task, {
    worker: { node_id: null, hostname: 'prime', adapter: 'mccluster-unreal-sequence/1' },
    unreal: { uproject: 'C:/proof/GIBProof.uproject', map: '/Game/Proof/S31_Map', sequence: '/Game/Proof/S31_Seq', project_id: 'gib-s31-proof', sequence_id: 's31-standin', mode: 'sequence' },
    device: { rhi: 'D3D12', adapter: 'AMD Radeon RX 7800 XT', vendor_id: '0x1002', driver: '32.0', software: false, gpu_verified: true, evidence: ['LogD3D12RHI: Found D3D12 adapter 0: AMD Radeon RX 7800 XT (VendorId: 1002'] },
    output_dir: 'C:/p/renders/unreal/s31/t001-abcdef12-20261128T101858Z',
    playback: { duration_s: 5, frames: 120, width: 720, height: 1280, has_audio: false, codec: 'h264', decoded_ok: true }
  }));
  compute.tasks.get(task.id).locked_by_node_id = null; // the lease RPC clears it on completion
  const done = (await svc.jobGet({ orgId: ORG, actor: OWNER, jobId: job.id })).job;
  assert.equal(done.status, 'succeeded');
  assert.equal(done.progress, null, 'a finished job shows no stale progress');
  assert.equal(done.worker.node_id, 'node_prime');
  assert.equal(done.worker.adapter, 'mccluster-unreal-sequence/1');
  assert.equal(done.device.adapter, 'AMD Radeon RX 7800 XT');
  assert.equal(done.output_dir, 'C:/p/renders/unreal/s31/t001-abcdef12-20261128T101858Z');
  assert.equal(done.preview.frames, 120);
  assert.equal(done.preview.sha256, 'a'.repeat(64));
  // A failed render never offers a preview to open.
  const { job: retake } = await svc.renderSubmit({ orgId: ORG, actor: OWNER, retakeOf: job.id, changes: { note: 'one change' } });
  assert.equal(retake.take, 2);
  const t2 = compute.claim('node_prime', ['production.render.unreal']);
  assert.equal(t2.input.manifest.shot_id, 's31');
  compute.complete(t2.id, simulatedOutput(t2, { ok: false, error: 'render is not accepted: device: no GPU' }));
  const failed = (await svc.jobGet({ orgId: ORG, actor: OWNER, jobId: retake.id })).job;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.preview, null);
  assert.equal(compute.claim('node_prime', ['production.render.unreal']), null, 'nothing else was queued');
});
