// Shared fixtures for the production pipeline tests: the get-it-back
// project record as the store returns it, the first-proof shot manifest
// (s31, five seconds, Matthew on the phone), and an in-memory compute
// queue with the same semantics the Supabase RPCs have (idempotency key,
// bounded attempts, atomic cancel of a queued task).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ORG = '00000000-0000-4000-8000-000000000001';
export const OWNER = { user_id: '00000000-0000-4000-8000-0000000000aa', kind: 'owner', source: 'cloudflare-owner-session' };
export const EDITOR = { user_id: '00000000-0000-4000-8000-0000000000bb', kind: 'member', source: 'cloudflare-owner-session' };
export const VIEWER = { user_id: '00000000-0000-4000-8000-0000000000cc', kind: 'member', source: 'cloudflare-owner-session' };
export const STRANGER = { user_id: '00000000-0000-4000-8000-0000000000dd', kind: 'member', source: 'cloudflare-owner-session' };
export const MASTER_SHA = 'df66799173bc7c5c5b850166ccb1248aa40d06706a8c95fc9fac3847344e1ba1';

export function project() {
  return {
    id: 'get-it-back', org_id: ORG, title: 'GET IT BACK', status: 'active', storage: {}, settings: {},
    members: [{ profile_id: EDITOR.user_id, role: 'editor' }, { profile_id: VIEWER.user_id, role: 'viewer' }],
    assets: [
      { asset_id: 'proof-phone-call-s31', version: 3, kind: 'master', path: 'blend/proof_phone_call-s31-phone-v3.blend', sha256: MASTER_SHA, approved: true, editable: true },
      { asset_id: 'floor-06-core-v2', version: 1, kind: 'set', path: 'sets/equity-uprise-floor-06-core-v2.glb', approved: true },
      { asset_id: 'line-m5-scratch', version: 1, kind: 'audio', path: 'audio/scratch/line_m5.wav', approved: false },
      { asset_id: 'take-matthew-t01', version: 1, kind: 'recording', path: 'capture/takes/t01/matthew_camera.webm', approved: false },
      { asset_id: 'episode-60', version: 1, kind: 'master', path: 'blend/get-it-back-60.blend', approved: true }
    ],
    consents: [
      { actor_id: 'matthew', scope: ['camera', 'microphone', 'face_tracking', 'performance', 'likeness', 'render', 'transcript'], granted_at: '2026-11-28T00:00:00Z', revoked_at: null },
      { actor_id: 'dave', scope: ['camera'], granted_at: '2026-11-28T00:00:00Z', revoked_at: null }
    ],
    shots: [{ shot_id: 's31', episode: 'get-it-back', start_frame: 2360, end_frame: 2451, fps: 24, camera: 'Cam_s31', line_id: 'm5', actors: ['matthew'] }]
  };
}

export function s31Manifest(overrides = {}) {
  return {
    schema: 'mccluster-shot-render/1',
    project_id: 'get-it-back',
    episode: 'get-it-back',
    shot_id: 's31',
    take: 1,
    engine: 'unreal',
    frames: { start: 2350, end: 2469, fps: 24, cut: { start: 2360, end: 2451 } },
    resolution: { width: 720, height: 1280 },
    source: {
      master: 'blend/proof_phone_call-s31-phone-v3.blend', master_sha256: MASTER_SHA,
      set_asset: 'floor-06-core-v2', set_version: 1, camera: 'Cam_s31', set_root: 'Floor6_Root_CoreV2',
      subjects: ['Actor_matthew_floor6'], props: ['S31']
    },
    audio: { path: 'audio/scratch/line_m5.wav', offset_s: -0.621, line_id: 'm5' },
    actors: [{ id: 'matthew', pose: 'phone', performance: null }],
    checks: { scale: true, framing: true, phone_grip: true, timing: true, expect_duration_s: 5 },
    ...overrides
  };
}

export function memoryCompute({ now = () => new Date() } = {}) {
  const tasks = new Map();
  const keys = new Map();
  const api = {
    tasks,
    async enqueue({ orgId, capability, implementation, input, requirements, priority, maxAttempts, idempotencyKey, metadata }) {
      if (idempotencyKey && keys.has(idempotencyKey)) {
        const task = tasks.get(keys.get(idempotencyKey));
        if (JSON.stringify(task.input) !== JSON.stringify(input)) throw Object.assign(new Error('Idempotency-Key was already used for a different compute task request'), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
        return { task: structuredClone(task), replayed: true };
      }
      const task = { id: crypto.randomUUID(), org_id: orgId, capability, implementation, input, requirements, priority, status: 'queued', attempts: 0, max_attempts: Math.max(1, Math.min(100, maxAttempts)), locked_by_node_id: null, output: null, last_error: null, metadata, created_at: now().toISOString(), updated_at: now().toISOString() };
      tasks.set(task.id, task);
      if (idempotencyKey) keys.set(idempotencyKey, task.id);
      return { task: structuredClone(task), replayed: false };
    },
    async taskById({ orgId, taskId }) { const t = tasks.get(taskId); return t && t.org_id === orgId ? structuredClone(t) : null; },
    async cancelQueued({ orgId, taskId, reason }) {
      const t = tasks.get(taskId);
      if (!t || t.org_id !== orgId || t.status !== 'queued') return null;
      Object.assign(t, { status: 'canceled', last_error: reason });
      return structuredClone(t);
    },
    // Worker side, mirroring compute_claim_task / compute_*_lease.
    claim(nodeId, capabilities) {
      const t = [...tasks.values()].find((x) => x.status === 'queued' && capabilities.includes(x.capability));
      if (!t) return null;
      Object.assign(t, { status: 'running', attempts: t.attempts + 1, locked_by_node_id: nodeId });
      return structuredClone(t);
    },
    complete(taskId, output) { Object.assign(tasks.get(taskId), { status: 'done', output }); },
    fail(taskId, error, retry = true) {
      const t = tasks.get(taskId);
      t.last_error = error;
      t.status = retry && t.attempts < t.max_attempts ? 'queued' : 'failed';
      if (t.status === 'queued') t.locked_by_node_id = null;
    }
  };
  return api;
}

// A SIMULATED UnrealEditor.exe for the in-editor render: it does what the
// real editor + tools/production/unreal/mcc_render_sequence.py do on disk
// (frames in the job's output folder, the result file, the engine log)
// and nothing else. Real renders are verified on Prime only.
export const RADEON_LOG = [
  'LogInit: Display: Engine Version: 5.8.4-58902052+++UE5+Release-5.8',
  'LogD3D12RHI: Display: Creating D3D12 RHI with Max Feature Level SM6',
  'LogD3D12RHI: Found D3D12 adapter 0: AMD Radeon RX 7800 XT (VendorId: 1002, DeviceId: 747e, SubSysId: 0, Revision: 00c8',
  'LogD3D12RHI: Found D3D12 adapter 1: Microsoft Basic Render Driver (VendorId: 1414, DeviceId: 008c, SubSysId: 0000, Revision: 0000',
  'LogD3D12RHI: Chosen D3D12 Adapter Id = 0',
  'LogInit: RHI Adapter Info:',
  'LogInit:             Name : AMD Radeon RX 7800 XT',
  'LogInit:   Driver Version : 32.0.21025.1024 (internal:32.0.21025.1024, unified:25.10.2)'
].join('\n');
export const WARP_LOG = [
  'LogInit: Display: Engine Version: 5.8.4-58902052+++UE5+Release-5.8',
  'LogD3D12RHI: Display: Creating D3D12 RHI with Max Feature Level SM5',
  'LogD3D12RHI: Found D3D12 adapter 0: Microsoft Basic Render Driver (VendorId: 1414, DeviceId: 008c, SubSysId: 0000, Revision: 0000',
  'LogD3D12RHI: Chosen D3D12 Adapter Id = 0',
  'LogInit: RHI Adapter Info:',
  'LogInit:             Name : Microsoft Basic Render Driver'
].join('\n');

export function simulateInEditorRender(args, env, { frames = 120, log = RADEON_LOG, result = true, executorSuccess = true, writeFrames = true, startFrame = null } = {}) {
  const job = JSON.parse(fs.readFileSync(env.MCC_UNREAL_JOB, 'utf8'));
  const abslog = args.find((a) => a.startsWith('-abslog=')).slice('-abslog='.length);
  fs.writeFileSync(abslog, `${log}\nLogMovieRenderPipeline: Display: Finished rendering\n`);
  fs.mkdirSync(job.output_dir, { recursive: true });
  const first = startFrame ?? job.frames.start;
  if (writeFrames) for (let i = 0; i < frames; i += 1) fs.writeFileSync(path.join(job.output_dir, `frame.${String(first + i).padStart(4, '0')}.png`), 'png');
  if (result) fs.writeFileSync(job.result, JSON.stringify({ schema: 'mccluster-unreal-render-result/1', job_id: job.job_id, ok: executorSuccess, executor_success: executorSuccess, engine_version: '5.8.4-58902052+++UE5+Release-5.8', map: job.map, sequence: job.sequence, output_dir: job.output_dir, frames_written: frames, error: executorSuccess ? null : 'Movie Render Queue reported failure' }));
  return job;
}

// The proven s31 job on Prime as a typed sequence-mode manifest: an
// approved Unreal project and Level Sequence by id, the shot range, and
// nothing else (no master, no command, no path). 120 frames, 24 fps,
// 720x1280, five seconds, silent, stand-in actor.
export const S31_UNREAL = Object.freeze({ project_id: 'gib-s31-proof', sequence_id: 's31-standin' });

export function s31SequenceManifest(overrides = {}) {
  return {
    schema: 'mccluster-shot-render/1',
    project_id: 'get-it-back',
    episode: 'get-it-back',
    shot_id: 's31',
    take: 1,
    engine: 'unreal',
    frames: { start: 0, end: 119, fps: 24 },
    resolution: { width: 720, height: 1280 },
    unreal: { ...S31_UNREAL },
    actors: [],
    checks: { expect_duration_s: 5 },
    note: 'proof: stand-in actor, silent',
    ...overrides
  };
}

export function s31SequenceAsset(overrides = {}) {
  return { asset_id: 's31-standin', version: 1, kind: 'unreal_sequence', path: 'unreal/gib-s31-proof/s31-standin', approved: true, editable: false, label: 'S31 stand-in Level Sequence (proven on Prime)', metadata: { unreal_project_id: 'gib-s31-proof', shot_ids: ['s31'], frame_start: 0, frame_end: 119 }, ...overrides };
}
