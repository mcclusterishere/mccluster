/* ============================================================
   core.production.* — NAMED PRODUCTION ACTIONS.

   The agent's whole production surface. Each tool is one named action
   on the production job service (core/src/production/service.mjs);
   none takes a command, a script, a path on a machine or code. Workers
   run fixed adapters chosen by the job kind, configured by the machine
   owner (core/src/production/executor.mjs).

     core.production.project.get       read   project, shots, assets, consents
     core.production.asset.lookup      read   registered assets by kind/query
     core.production.shot.validate     read   normalize + validate a shot manifest
     core.production.render.submit     write  queue one shot render (or a retake)
     core.production.job.get           read   status, worker, engine, logs, outputs
     core.production.job.cancel        write  cancel queued, or request cancel of running
     core.production.artifact.get      read   artifacts a job produced
     core.production.facetrack.submit  write  queue a consented face-track range
     core.production.transcript.submit write  queue a transcript

   The actor comes from the broker (the edge stamps it), never from the
   arguments; org_id is overwritten with the house org at the edge.
   Contract: docs/control-plane/PRODUCTION-PIPELINE.md
   ============================================================ */

import { cancelQueuedComputeTask, computeTaskById, enqueueComputeTask } from '../compute/store.mjs';
import { createProductionService } from '../production/service.mjs';
import { supabaseProductionStore } from '../production/store.mjs';

const ORG = { type: 'string' };
const PROJECT = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,62}$' };
const UUID = { type: 'string', maxLength: 64 };
const SHOT_MANIFEST = {
  type: 'object',
  description: 'mccluster-shot-render/1: project_id, shot_id, take, engine (unreal|blender), frames {start,end,fps}, resolution {width,height}, unreal {project_id, sequence_id} (approved ids: render that Level Sequence, no master needed), source {master, master_sha256, set_asset, set_version, export_id, camera, subjects[], props[]}, audio {path, offset_s, line_id}, actors [{id, pose, performance}], checks {scale, framing, phone_grip, timing, expect_duration_s}, note. Paths are project-relative.',
  required: ['project_id', 'shot_id', 'frames'],
  properties: {
    schema: { type: 'string' }, project_id: PROJECT, episode: { type: 'string' }, shot_id: { type: 'string' }, take: { type: 'integer', minimum: 1 },
    engine: { type: 'string', enum: ['unreal', 'blender'] }, frames: { type: 'object' }, resolution: { type: 'object' }, source: { type: 'object' },
    unreal: { type: 'object', required: ['project_id', 'sequence_id'], properties: { project_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]{0,63}$' }, sequence_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]{0,63}$' } }, additionalProperties: false },
    audio: { type: 'object' }, actors: { type: 'array' }, checks: { type: 'object' }, note: { type: 'string', maxLength: 2000 }
  }
};

export const PRODUCTION_TOOLS = Object.freeze([
  {
    name: 'core.production.project.get', title: 'Read production project',
    description: 'Read one production project the caller may see: shots, registered assets (versioned, with hashes), and actor consent state. Read-only.',
    inputSchema: { type: 'object', required: ['org_id', 'project_id'], properties: { org_id: ORG, project_id: PROJECT }, additionalProperties: false }
  },
  {
    name: 'core.production.asset.lookup', title: 'Look up production assets',
    description: 'List registered assets of a production project by kind (master, set, prop, audio, recording, export, unreal_sequence) and an optional name query. Read-only.',
    inputSchema: { type: 'object', required: ['org_id', 'project_id'], properties: { org_id: ORG, project_id: PROJECT, kind: { type: 'string', enum: ['master', 'set', 'prop', 'audio', 'recording', 'export', 'character', 'script', 'unreal_sequence'] }, query: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false }
  },
  {
    name: 'core.production.shot.validate', title: 'Validate a shot',
    description: 'Normalize a mccluster-shot-render/1 manifest and validate it against the project: registered and approved assets, master version, actor consent, frame range and duration, required checks. Returns errors, warnings, the manifest hash and the job key. Queues nothing.',
    inputSchema: { type: 'object', required: ['org_id', 'manifest'], properties: { org_id: ORG, manifest: SHOT_MANIFEST }, additionalProperties: false }
  },
  {
    name: 'core.production.render.submit', title: 'Submit a shot render',
    description: 'Queue one shot render on an owned worker (Unreal Movie Render Queue on Prime, or the local Blender fallback). Idempotent: the same manifest returns the same job. A retake (retake_of + changes) queues a new take of that one shot only. Bounded retries (1..3).',
    inputSchema: { type: 'object', required: ['org_id'], properties: { org_id: ORG, manifest: SHOT_MANIFEST, retake_of: UUID, changes: { type: 'object' }, max_attempts: { type: 'integer', minimum: 1, maximum: 3 }, priority: { type: 'integer', minimum: -100, maximum: 100 } }, additionalProperties: false }
  },
  {
    name: 'core.production.job.get', title: 'Read production job',
    description: 'Status of one production job: worker node, attempts, live progress, engine name and version, Unreal project/map/sequence, checks, playback probe, output paths and logs. Read-only.',
    inputSchema: { type: 'object', required: ['org_id', 'job_id'], properties: { org_id: ORG, job_id: UUID }, additionalProperties: false }
  },
  {
    name: 'core.production.job.cancel', title: 'Cancel production job',
    description: 'Cancel a queued job atomically, or ask the worker holding a running job to stop at its next heartbeat. Never deletes outputs.',
    inputSchema: { type: 'object', required: ['org_id', 'job_id'], properties: { org_id: ORG, job_id: UUID, reason: { type: 'string', maxLength: 200 } }, additionalProperties: false }
  },
  {
    name: 'core.production.artifact.get', title: 'Read production artifacts',
    description: 'The artifacts one job produced (preview MP4, frames, logs, export, Unreal project and sequence, checks), each with its node-local path, hash and the worker that holds it. Read-only.',
    inputSchema: { type: 'object', required: ['org_id'], properties: { org_id: ORG, job_id: UUID, artifact_id: UUID }, additionalProperties: false }
  },
  {
    name: 'core.production.facetrack.submit', title: 'Submit a face-track range',
    description: 'Queue MediaPipe face tracking of one approved range of a consented recording on an owned worker (Shiloh). Refused without the actor\'s face_tracking consent.',
    inputSchema: { type: 'object', required: ['org_id', 'manifest'], properties: { org_id: ORG, manifest: { type: 'object', required: ['project_id', 'actor_id', 'take', 'in_s', 'out_s'] }, max_attempts: { type: 'integer', minimum: 1, maximum: 3 } }, additionalProperties: false }
  },
  {
    name: 'core.production.transcript.submit', title: 'Submit a transcript',
    description: 'Queue a Faster Whisper transcript of one registered project media file on an owned worker (Shiloh). Recordings need the actor\'s consent.',
    inputSchema: { type: 'object', required: ['org_id', 'manifest'], properties: { org_id: ORG, manifest: { type: 'object', required: ['project_id', 'media'] }, max_attempts: { type: 'integer', minimum: 1, maximum: 3 } }, additionalProperties: false }
  }
]);

let defaultService = null;
function service() {
  if (!defaultService) {
    defaultService = createProductionService({
      store: supabaseProductionStore(),
      compute: { enqueue: enqueueComputeTask, taskById: computeTaskById, cancelQueued: cancelQueuedComputeTask }
    });
  }
  return defaultService;
}

export async function callProductionTool(name, args = {}, options = {}, { svc = service() } = {}) {
  const orgId = String(args.org_id || '').trim();
  if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400 });
  const actor = options?.actor || null;
  const source = options?.source || 'core-mcp';
  switch (name) {
    case 'core.production.project.get': return svc.projectGet({ orgId, projectId: args.project_id, actor });
    case 'core.production.asset.lookup': return svc.assetLookup({ orgId, projectId: args.project_id, actor, kind: args.kind, query: args.query, limit: args.limit });
    case 'core.production.shot.validate': return svc.shotValidate({ orgId, actor, manifest: args.manifest });
    case 'core.production.render.submit': return svc.renderSubmit({ orgId, actor, manifest: args.manifest || null, retakeOf: args.retake_of || null, changes: args.changes || {}, maxAttempts: args.max_attempts, priority: args.priority, source });
    case 'core.production.job.get': return svc.jobGet({ orgId, jobId: args.job_id, actor });
    case 'core.production.job.cancel': return svc.jobCancel({ orgId, jobId: args.job_id, actor, reason: args.reason });
    case 'core.production.artifact.get': return svc.artifactGet({ orgId, actor, jobId: args.job_id, artifactId: args.artifact_id });
    case 'core.production.facetrack.submit': return svc.facetrackSubmit({ orgId, actor, manifest: args.manifest, maxAttempts: args.max_attempts, source });
    case 'core.production.transcript.submit': return svc.transcriptSubmit({ orgId, actor, manifest: args.manifest, maxAttempts: args.max_attempts, source });
    default: throw Object.assign(new Error(`Unknown production tool ${name}`), { status: 404, code: 'TOOL_NOT_FOUND' });
  }
}
