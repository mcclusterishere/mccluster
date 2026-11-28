// Shared fixtures for the production pipeline tests: the get-it-back
// project record as the store returns it, the first-proof shot manifest
// (s31, five seconds, Matthew on the phone), and an in-memory compute
// queue with the same semantics the Supabase RPCs have (idempotency key,
// bounded attempts, atomic cancel of a queued task).
import crypto from 'node:crypto';

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
