/* ============================================================
   mccluster-production/1 — THE PRODUCTION JOB CONTRACT.

   One contract for script, performance capture, reaction editing,
   assets, Blender and Unreal. Creator Suite and the Core MCP reach the
   same job service (service.mjs) with these schemas; workers on owned
   machines lease the jobs over the existing signed compute protocol
   (mccluster-compute/1, docs/control-plane/COMPUTE-NODE-PROTOCOL.md)
   and answer with the output manifests below.

   Pure module: no I/O, no clock unless passed in. Everything a worker
   runs is a NAMED action with typed fields; there is no field anywhere
   in these schemas that carries a command, a script or code.

   Contract: docs/control-plane/PRODUCTION-PIPELINE.md
   ============================================================ */

import crypto from 'node:crypto';

export const PRODUCTION_PROTOCOL = 'mccluster-production/1';
export const SHOT_RENDER_SCHEMA = 'mccluster-shot-render/1';
export const RENDER_OUTPUT_SCHEMA = 'mccluster-render-output/1';
export const FACETRACK_SCHEMA = 'mccluster-facetrack/1';
export const TRANSCRIPT_SCHEMA = 'mccluster-transcript/1';
export const SHOT_EXPORT_SCHEMA = 'mccluster-shot-export/1';

// Named worker capabilities. Each is owned-only (protocol.mjs): a node
// whose enrolment did not record trust 'owned' can never lease one, so
// recordings, likeness and unreleased material stay on owned machines.
export const WORKER_CAPABILITIES = Object.freeze({
  'render.unreal': 'production.render.unreal',
  'render.blender': 'production.render.blender',
  facetrack: 'production.facetrack.mediapipe',
  transcript: 'production.transcript.whisper'
});
export const PRODUCTION_WORKER_CAPABILITIES = Object.freeze(Object.values(WORKER_CAPABILITIES));

export const JOB_KINDS = Object.freeze(['render', 'facetrack', 'transcript']);
export const ENGINES = Object.freeze(['unreal', 'blender']);
export const JOB_STATUSES = Object.freeze(['queued', 'running', 'succeeded', 'failed', 'canceled', 'cancel_requested']);
export const ROLES_THAT_SUBMIT = Object.freeze(['owner', 'editor']);
export const ROLES_THAT_READ = Object.freeze(['owner', 'editor', 'viewer']);

// Bounds. A first-proof shot is 5 s; nothing on this contract renders
// more than 20 s per job (an episode is many shot jobs, never one).
export const BOUNDS = Object.freeze({
  minDurationS: 0.5,
  maxDurationS: 20,
  fps: [24, 25, 30, 48, 50, 60],
  minEdge: 64,
  maxEdge: 3840,
  maxAttempts: 3,
  maxTake: 999,
  maxPathChars: 400,
  maxNoteChars: 2000,
  maxChecks: 16
});

export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const SHOT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const ACTOR_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const ASSET_ID = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
export const SHA256 = /^[a-f0-9]{64}$/;
// A project-relative path: forward slashes, no drive, no leading slash,
// no '..' segment, no NUL, a short allowlist of characters. Workers
// resolve it under the project root THEY were configured with; a job can
// never name an absolute path on a machine.
const REL_PATH = /^(?!\/)(?![A-Za-z]:)[A-Za-z0-9 _.,()+-]+(?:\/[A-Za-z0-9 _.,()+-]+)*$/;
// Unreal engine versions the adapter in tools/production/unreal supports.
export const UNREAL_SUPPORTED = Object.freeze({ major: 5, minMinor: 4, maxMinor: 8 });

export class ProductionContractError extends Error {
  constructor(message, { code = 'PRODUCTION_INVALID', status = 400, errors = [] } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.errors = errors;
    this.retryable = false;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Canonical JSON: sorted keys, no whitespace. The manifest hash is the
// version of a job's input; the same input always hashes the same.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new ProductionContractError('non-finite number in manifest');
  return JSON.stringify(value ?? null);
}

export function manifestHash(manifest) {
  return crypto.createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

export function isRelativeProjectPath(value) {
  const text = String(value ?? '');
  if (!text || text.length > BOUNDS.maxPathChars || text.includes('\0') || text.includes('\\')) return false;
  if (!REL_PATH.test(text)) return false;
  return !text.split('/').some((segment) => segment === '..' || segment === '.' || segment === '');
}

function str(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function int(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function relPath(value, label, errors) {
  if (!isRelativeProjectPath(value)) { errors.push(`${label} must be a project-relative path`); return null; }
  return value;
}

function hashOrNull(value, label, errors) {
  if (value == null || value === '') return null;
  if (!SHA256.test(String(value))) { errors.push(`${label} must be a lowercase sha256 hex`); return null; }
  return String(value);
}

/* ---------- shot render input manifest ---------- */

// The normalized manifest is what is hashed and what a worker receives.
// Unknown fields are dropped, so nothing outside this list reaches a
// worker (and nothing can smuggle a command into one).
export function normalizeShotRender(raw) {
  const errors = [];
  if (!isObject(raw)) throw new ProductionContractError('shot render manifest must be an object');
  if (raw.schema !== undefined && raw.schema !== SHOT_RENDER_SCHEMA) errors.push(`schema must be ${SHOT_RENDER_SCHEMA}`);
  const projectId = str(raw.project_id, 64);
  if (!PROJECT_ID.test(projectId)) errors.push('project_id is invalid');
  const shotId = str(raw.shot_id, 64);
  if (!SHOT_ID.test(shotId)) errors.push('shot_id is invalid');
  const take = int(raw.take ?? 1);
  if (!(take >= 1 && take <= BOUNDS.maxTake)) errors.push(`take must be an integer 1..${BOUNDS.maxTake}`);
  const engine = str(raw.engine || 'unreal', 20);
  if (!ENGINES.includes(engine)) errors.push(`engine must be one of ${ENGINES.join(', ')}`);

  const frames = isObject(raw.frames) ? raw.frames : {};
  const fps = int(frames.fps ?? 24);
  const start = int(frames.start);
  const end = int(frames.end);
  if (!BOUNDS.fps.includes(fps)) errors.push(`frames.fps must be one of ${BOUNDS.fps.join(', ')}`);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) errors.push('frames.start and frames.end must be integers with end >= start');
  const count = Number.isInteger(start) && Number.isInteger(end) ? end - start + 1 : NaN;
  // The editorial cut inside the rendered range (handles outside it hold
  // the cut's visibility state, so a prop swap at a cut does not pop).
  let cut = null;
  if (frames.cut != null) {
    const cs = int(frames.cut?.start);
    const ce = int(frames.cut?.end);
    if (!Number.isInteger(cs) || !Number.isInteger(ce) || ce < cs || cs < start || ce > end) errors.push('frames.cut must be a range inside frames.start..frames.end');
    else cut = { start: cs, end: ce };
  }
  const duration = Number.isFinite(count) && fps ? count / fps : NaN;
  if (Number.isFinite(duration) && (duration < BOUNDS.minDurationS || duration > BOUNDS.maxDurationS)) {
    errors.push(`shot duration ${duration.toFixed(3)} s is outside ${BOUNDS.minDurationS}..${BOUNDS.maxDurationS} s`);
  }

  const resolution = isObject(raw.resolution) ? raw.resolution : {};
  const width = int(resolution.width ?? 720);
  const height = int(resolution.height ?? 1280);
  for (const [label, v] of [['resolution.width', width], ['resolution.height', height]]) {
    if (!(v >= BOUNDS.minEdge && v <= BOUNDS.maxEdge) || v % 2) errors.push(`${label} must be an even integer ${BOUNDS.minEdge}..${BOUNDS.maxEdge}`);
  }

  const source = isObject(raw.source) ? raw.source : {};
  const normalizedSource = {
    master: relPath(source.master, 'source.master', errors),
    master_sha256: hashOrNull(source.master_sha256, 'source.master_sha256', errors),
    set_asset: source.set_asset == null ? null : (ASSET_ID.test(str(source.set_asset, 128)) ? str(source.set_asset, 128) : (errors.push('source.set_asset is invalid'), null)),
    set_version: source.set_version == null ? null : int(source.set_version),
    export_id: source.export_id == null ? null : (ASSET_ID.test(str(source.export_id, 128)) ? str(source.export_id, 128) : (errors.push('source.export_id is invalid'), null)),
    camera: str(source.camera, 120) || null,
    // Object names in the master: the set's root (exported static, in
    // world space), the subjects' rig roots and the props (exported as
    // moving parts with per-frame transforms). Names, never paths.
    set_root: str(source.set_root, 120) || null,
    subjects: Array.isArray(source.subjects) ? source.subjects.map((s) => str(s, 120)).filter(Boolean).slice(0, 64) : [],
    props: Array.isArray(source.props) ? source.props.map((s) => str(s, 160)).filter(Boolean).slice(0, 64) : []
  };
  if (normalizedSource.set_version != null && !(normalizedSource.set_version >= 1)) errors.push('source.set_version must be a positive integer');
  if (!normalizedSource.camera) errors.push('source.camera is required');

  const audio = raw.audio == null ? null : (isObject(raw.audio) ? {
    path: relPath(raw.audio.path, 'audio.path', errors),
    sha256: hashOrNull(raw.audio.sha256, 'audio.sha256', errors),
    offset_s: Number.isFinite(num(raw.audio.offset_s ?? 0)) ? num(raw.audio.offset_s ?? 0) : (errors.push('audio.offset_s must be a number'), 0),
    line_id: str(raw.audio.line_id, 64) || null
  } : (errors.push('audio must be an object'), null));

  const actors = Array.isArray(raw.actors) ? raw.actors : [];
  const normalizedActors = actors.slice(0, 16).map((actor, i) => {
    const id = str(actor?.id, 64);
    if (!ACTOR_ID.test(id)) errors.push(`actors[${i}].id is invalid`);
    const pose = str(actor?.pose, 40) || null;
    const performance = actor?.performance == null ? null : str(actor.performance, 128);
    return { id, pose, performance };
  });

  const checks = isObject(raw.checks) ? raw.checks : {};
  const normalizedChecks = {
    scale: checks.scale !== false,
    framing: checks.framing !== false,
    phone_grip: checks.phone_grip === true,
    timing: checks.timing !== false,
    expect_duration_s: checks.expect_duration_s == null ? null : num(checks.expect_duration_s),
    subject_height_m: checks.subject_height_m == null ? null : num(checks.subject_height_m)
  };
  if (normalizedChecks.expect_duration_s != null && !Number.isFinite(normalizedChecks.expect_duration_s)) errors.push('checks.expect_duration_s must be a number');

  const retakeOf = raw.retake_of == null ? null : str(raw.retake_of, 64);
  const note = str(raw.note, BOUNDS.maxNoteChars) || null;

  if (errors.length) throw new ProductionContractError(`shot render manifest is invalid: ${errors[0]}`, { errors });
  return {
    schema: SHOT_RENDER_SCHEMA,
    project_id: projectId,
    episode: str(raw.episode, 64) || null,
    shot_id: shotId,
    take,
    engine,
    frames: { start, end, fps, count, duration_s: Number(duration.toFixed(6)), cut },
    resolution: { width, height },
    source: normalizedSource,
    audio,
    actors: normalizedActors,
    checks: normalizedChecks,
    retake_of: retakeOf,
    note
  };
}

/* ---------- face-track and transcript inputs (Shiloh) ---------- */

export function normalizeFacetrack(raw) {
  const errors = [];
  if (!isObject(raw)) throw new ProductionContractError('face-track manifest must be an object');
  const projectId = str(raw.project_id, 64);
  if (!PROJECT_ID.test(projectId)) errors.push('project_id is invalid');
  const actor = str(raw.actor_id, 64);
  if (!ACTOR_ID.test(actor)) errors.push('actor_id is invalid');
  const take = relPath(raw.take, 'take', errors);
  const tIn = num(raw.in_s);
  const tOut = num(raw.out_s);
  if (!(tIn >= 0 && tOut > tIn && tOut - tIn <= 600)) errors.push('in_s/out_s must be a range of at most 600 s');
  const selection = str(raw.selection_id || 'sel', 64);
  if (!SHOT_ID.test(selection)) errors.push('selection_id is invalid');
  if (errors.length) throw new ProductionContractError(`face-track manifest is invalid: ${errors[0]}`, { errors });
  return {
    schema: FACETRACK_SCHEMA,
    project_id: projectId,
    actor_id: actor,
    take,
    take_sha256: hashOrNull(raw.take_sha256, 'take_sha256', errors),
    in_s: tIn,
    out_s: tOut,
    selection_id: selection,
    fps: 24
  };
}

export function normalizeTranscript(raw) {
  const errors = [];
  if (!isObject(raw)) throw new ProductionContractError('transcript manifest must be an object');
  const projectId = str(raw.project_id, 64);
  if (!PROJECT_ID.test(projectId)) errors.push('project_id is invalid');
  const media = relPath(raw.media, 'media', errors);
  const language = str(raw.language || 'en', 8);
  if (!/^[a-z]{2,3}$/.test(language)) errors.push('language must be an ISO 639 code');
  const model = str(raw.model || 'large-v3-turbo', 40);
  if (!/^[a-z0-9.-]{2,40}$/.test(model)) errors.push('model is invalid');
  const actor = raw.actor_id == null ? null : str(raw.actor_id, 64);
  if (actor != null && !ACTOR_ID.test(actor)) errors.push('actor_id is invalid');
  if (errors.length) throw new ProductionContractError(`transcript manifest is invalid: ${errors[0]}`, { errors });
  return {
    schema: TRANSCRIPT_SCHEMA,
    project_id: projectId,
    media,
    media_sha256: hashOrNull(raw.media_sha256, 'media_sha256', []),
    actor_id: actor,
    language,
    model,
    word_timestamps: raw.word_timestamps !== false
  };
}

/* ---------- shot validation against the project record ---------- */

// Checks that need the project record (assets, consents, shots). Pure:
// the caller hands in what the store returned. Returns errors (the job
// must not be queued) and warnings (it may, the reply says why).
export function validateShotAgainstProject(manifest, project) {
  const errors = [];
  const warnings = [];
  if (!project) return { ok: false, errors: ['project not found'], warnings };
  if (project.id !== manifest.project_id) errors.push('manifest project_id does not match the project');
  if (project.status && project.status !== 'active') errors.push(`project is ${project.status}`);

  const assets = Array.isArray(project.assets) ? project.assets : [];
  const byPath = new Map(assets.filter((a) => a?.path).map((a) => [a.path, a]));
  const master = byPath.get(manifest.source.master);
  if (!master) errors.push(`master ${manifest.source.master} is not a registered project asset`);
  else {
    if (master.kind !== 'master') errors.push(`${manifest.source.master} is registered as ${master.kind}, not a master`);
    if (manifest.source.master_sha256 && master.sha256 && master.sha256 !== manifest.source.master_sha256) {
      errors.push('source.master_sha256 does not match the registered master version');
    }
    if (master.editable === false) warnings.push('the master is marked read-only; the worker exports from it without saving');
  }
  if (manifest.source.set_asset) {
    const set = assets.find((a) => a.asset_id === manifest.source.set_asset && (manifest.source.set_version == null || a.version === manifest.source.set_version));
    if (!set) errors.push(`set ${manifest.source.set_asset}${manifest.source.set_version ? ` v${manifest.source.set_version}` : ''} is not registered`);
    else if (set.approved !== true) errors.push(`set ${set.asset_id} v${set.version} is not approved`);
  }
  if (manifest.audio) {
    const audio = byPath.get(manifest.audio.path);
    if (!audio) errors.push(`audio ${manifest.audio.path} is not a registered project asset`);
  }

  // Consent: every actor whose performance or likeness drives the shot
  // must have an active consent that covers rendering in this project.
  const consents = Array.isArray(project.consents) ? project.consents : [];
  for (const actor of manifest.actors) {
    const consent = consents.find((c) => c.actor_id === actor.id && !c.revoked_at);
    const needs = actor.performance ? 'performance' : 'likeness';
    if (!consent) {
      if (actor.performance) errors.push(`actor ${actor.id} has no active consent for a captured performance`);
      else warnings.push(`actor ${actor.id} has no consent record; only a provisional stand-in may be rendered`);
      continue;
    }
    const scope = Array.isArray(consent.scope) ? consent.scope : [];
    if (!scope.includes('render') && !scope.includes(needs)) errors.push(`actor ${actor.id} consent does not cover ${needs} rendering`);
  }

  // Shot record: frames inside the shot's registered range, if any.
  const shots = Array.isArray(project.shots) ? project.shots : [];
  const shot = shots.find((s) => s.shot_id === manifest.shot_id);
  if (shot && Number.isInteger(shot.start_frame) && Number.isInteger(shot.end_frame)) {
    if (manifest.frames.end < shot.start_frame || manifest.frames.start > shot.end_frame) {
      errors.push(`frames ${manifest.frames.start}-${manifest.frames.end} do not overlap shot ${shot.shot_id} (${shot.start_frame}-${shot.end_frame})`);
    } else if (manifest.frames.start < shot.start_frame || manifest.frames.end > shot.end_frame) {
      warnings.push(`frames extend past the cut of ${shot.shot_id} (${shot.start_frame}-${shot.end_frame}) for handles`);
    }
  } else if (!shot) warnings.push(`shot ${manifest.shot_id} has no shot record; frames are taken as given`);

  if (manifest.checks.expect_duration_s != null && Math.abs(manifest.checks.expect_duration_s - manifest.frames.duration_s) > 1 / manifest.frames.fps) {
    errors.push(`frames give ${manifest.frames.duration_s} s, expected ${manifest.checks.expect_duration_s} s`);
  }
  if (manifest.checks.phone_grip && !manifest.source.props.length) errors.push('checks.phone_grip needs the phone in source.props');
  if (manifest.engine === 'unreal' && !manifest.source.export_id) warnings.push('no export_id: the worker exports a new version of the set and shot from the master first');
  return { ok: errors.length === 0, errors, warnings };
}

/* ---------- job keys, retakes, idempotency ---------- */

// One render job per (project, shot, take, input version). The same
// manifest submitted twice is the same job; a changed manifest for the
// same take is a conflict the caller must resolve by taking a new take.
export function renderJobKey(manifest) {
  return `render:${manifest.project_id}:${manifest.shot_id}:t${manifest.take}:${manifestHash(manifest).slice(0, 24)}`;
}

export function computeIdempotencyKey(jobKey) {
  return `production:${crypto.createHash('sha256').update(jobKey).digest('hex').slice(0, 48)}`;
}

// A retake re-renders exactly one shot: the shot of the job it retakes.
// Returns the next take's manifest, or throws when the caller tries to
// widen it to another shot or project.
export function planRetake(previousJob, changes = {}) {
  if (!previousJob?.manifest) throw new ProductionContractError('retake_of names no render job', { code: 'RETAKE_UNKNOWN', status: 404 });
  const prev = previousJob.manifest;
  if (changes.shot_id && changes.shot_id !== prev.shot_id) throw new ProductionContractError('a retake re-renders only its own shot', { code: 'RETAKE_SCOPE' });
  if (changes.project_id && changes.project_id !== prev.project_id) throw new ProductionContractError('a retake stays in its project', { code: 'RETAKE_SCOPE' });
  const allowed = ['source', 'audio', 'actors', 'checks', 'note', 'engine', 'resolution', 'frames'];
  const next = { ...prev };
  for (const key of allowed) if (changes[key] !== undefined) next[key] = isObject(prev[key]) && isObject(changes[key]) ? { ...prev[key], ...changes[key] } : changes[key];
  next.take = Math.max(prev.take, Number(previousJob.latest_take || prev.take)) + 1;
  next.retake_of = previousJob.id;
  if (next.frames) next.frames = { start: next.frames.start, end: next.frames.end, fps: next.frames.fps, cut: next.frames.cut || null };
  return normalizeShotRender(next);
}

/* ---------- compute task <-> production job ---------- */

export function workerCapabilityFor(kind, engine) {
  if (kind === 'render') return engine === 'blender' ? WORKER_CAPABILITIES['render.blender'] : WORKER_CAPABILITIES['render.unreal'];
  if (kind === 'facetrack') return WORKER_CAPABILITIES.facetrack;
  if (kind === 'transcript') return WORKER_CAPABILITIES.transcript;
  throw new ProductionContractError(`unknown job kind ${kind}`);
}

export function boundedAttempts(value) {
  const n = Math.floor(Number(value ?? 2));
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(BOUNDS.maxAttempts, n));
}

// Production status from the durable compute task. The task is the
// truth; the production row only adds the cancel request.
export function productionStatus(task, job = {}) {
  if (!task) return job.status || 'queued';
  if (task.status === 'canceled') return 'canceled';
  if (job.cancel_requested_at && ['leased', 'running'].includes(task.status)) return 'cancel_requested';
  if (job.cancel_requested_at && task.status === 'failed') return 'canceled';
  if (task.status === 'done') return task.output?.ok === false ? 'failed' : 'succeeded';
  if (task.status === 'failed') return 'failed';
  if (task.status === 'leased' || task.status === 'running') return 'running';
  return 'queued';
}

/* ---------- worker output manifest ---------- */

const OUTPUT_KINDS = new Set(['preview_mp4', 'frames', 'log', 'export', 'unreal_project', 'level_sequence', 'checks', 'curves', 'transcript', 'receipt', 'blend']);

export function validateRenderOutput(raw) {
  const errors = [];
  if (!isObject(raw)) throw new ProductionContractError('worker output must be an object', { code: 'OUTPUT_INVALID' });
  if (raw.schema !== RENDER_OUTPUT_SCHEMA) errors.push(`schema must be ${RENDER_OUTPUT_SCHEMA}`);
  const outputs = Array.isArray(raw.outputs) ? raw.outputs : [];
  const normalized = outputs.slice(0, 64).map((item, i) => {
    if (!OUTPUT_KINDS.has(item?.kind)) errors.push(`outputs[${i}].kind is not a known artifact kind`);
    if (typeof item?.path !== 'string' || !item.path || item.path.length > 1000) errors.push(`outputs[${i}].path is required`);
    if (item?.sha256 != null && !SHA256.test(item.sha256)) errors.push(`outputs[${i}].sha256 is invalid`);
    return {
      kind: item?.kind,
      path: String(item?.path || ''),
      project_path: isRelativeProjectPath(item?.project_path) ? item.project_path : null,
      sha256: item?.sha256 || null,
      bytes: Number.isFinite(Number(item?.bytes)) ? Number(item.bytes) : null,
      label: str(item?.label, 200) || null
    };
  });
  const checks = isObject(raw.checks) ? raw.checks : {};
  const normalizedChecks = {};
  for (const [name, value] of Object.entries(checks).slice(0, BOUNDS.maxChecks)) {
    normalizedChecks[name] = { pass: value?.pass === true, detail: str(value?.detail, 1000) || null, measured: isObject(value?.measured) ? value.measured : null };
  }
  if (errors.length) throw new ProductionContractError(`worker output is invalid: ${errors[0]}`, { code: 'OUTPUT_INVALID', errors });
  return {
    schema: RENDER_OUTPUT_SCHEMA,
    ok: raw.ok === true,
    simulated: raw.simulated === true,
    job_id: str(raw.job_id, 64) || null,
    shot_id: str(raw.shot_id, 64) || null,
    take: Number.isInteger(raw.take) ? raw.take : null,
    engine: isObject(raw.engine) ? {
      name: str(raw.engine.name, 40), version: str(raw.engine.version, 40), changelist: raw.engine.changelist ?? null, executable: str(raw.engine.executable, 400) || null
    } : null,
    worker: isObject(raw.worker) ? { node_id: str(raw.worker.node_id, 80) || null, hostname: str(raw.worker.hostname, 120) || null, adapter: str(raw.worker.adapter, 80) || null } : null,
    unreal: isObject(raw.unreal) ? { uproject: str(raw.unreal.uproject, 400) || null, map: str(raw.unreal.map, 300) || null, sequence: str(raw.unreal.sequence, 300) || null } : null,
    outputs: normalized,
    checks: normalizedChecks,
    playback: isObject(raw.playback) ? {
      duration_s: Number.isFinite(Number(raw.playback.duration_s)) ? Number(raw.playback.duration_s) : null,
      frames: Number.isInteger(raw.playback.frames) ? raw.playback.frames : null,
      width: Number.isInteger(raw.playback.width) ? raw.playback.width : null,
      height: Number.isInteger(raw.playback.height) ? raw.playback.height : null,
      has_audio: raw.playback.has_audio === true,
      codec: str(raw.playback.codec, 40) || null,
      decoded_ok: raw.playback.decoded_ok === true
    } : null,
    error: raw.error ? str(raw.error, 4000) : null,
    started_at: str(raw.started_at, 40) || null,
    finished_at: str(raw.finished_at, 40) || null
  };
}

export function checksPassed(output) {
  const entries = Object.values(output?.checks || {});
  return entries.length > 0 && entries.every((check) => check.pass === true);
}
