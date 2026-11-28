/* ============================================================
   THE PRODUCTION JOB SERVICE.

   The one service Creator Suite and the Core MCP both call (through the
   named core.production.* tools, tools/production.mjs). It authorizes
   the actor against the project, validates the typed manifest, writes
   one production_jobs row and queues exactly one ops_compute_tasks row
   for an owned worker. It never runs anything itself.

     authorization   the caller's actor (stamped by the edge, never an
                     argument) must be an org owner or a project member;
                     submitting needs owner or editor.
     idempotency     a job is keyed by project, shot, take and the hash
                     of its normalized manifest; the compute task by a
                     key derived from that. Submitting the same thing
                     twice returns the first job.
     retries         at most BOUNDS.maxAttempts attempts per job, by the
                     compute lease protocol's own bounded retry.
     cancellation    queued: canceled atomically against the claim;
                     running: a cancel request the gateway hands the
                     worker on its next lease heartbeat.
     retakes         a retake is a new take of ONE shot; nothing else
                     is queued.
   ============================================================ */

import {
  JOB_KINDS, ROLES_THAT_READ, ROLES_THAT_SUBMIT, ProductionContractError,
  boundedAttempts, checksPassed, computeIdempotencyKey, manifestHash, normalizeFacetrack, normalizeShotRender,
  normalizeTranscript, planRetake, productionStatus, renderJobKey, validateRenderOutput, validateShotAgainstProject,
  workerCapabilityFor
} from './contract.mjs';

function fail(message, status, code, extra = {}) {
  return Object.assign(new Error(message), { status, code, retryable: false, ...extra });
}

function requireActor(actor) {
  if (!actor?.user_id) throw fail('Production tools need the signed actor the edge stamps on the call', 401, 'PRODUCTION_ACTOR_REQUIRED');
  return actor;
}

function text(value, max = 200) { return String(value ?? '').trim().slice(0, max); }

export function createProductionService({ store, compute, now = () => new Date() } = {}) {
  if (!store) throw new Error('production store is required');
  if (!compute?.enqueue || !compute?.taskById || !compute?.cancelQueued) throw new Error('compute adapter (enqueue, taskById, cancelQueued) is required');

  async function roleFor(orgId, projectId, actor) {
    requireActor(actor);
    if (await store.isOrgOwner(orgId, actor.user_id)) return 'owner';
    return store.memberRole(orgId, projectId, actor.user_id);
  }

  async function authorize(orgId, projectId, actor, allowed) {
    const role = await roleFor(orgId, projectId, actor);
    if (!role || !allowed.includes(role)) throw fail(`No ${allowed === ROLES_THAT_SUBMIT ? 'submit' : 'read'} access to project ${projectId}`, 403, 'PRODUCTION_FORBIDDEN');
    return role;
  }

  async function loadProject(orgId, projectId) {
    const project = await store.getProject(orgId, projectId);
    if (!project) throw fail(`project ${projectId} not found`, 404, 'PRODUCTION_PROJECT_NOT_FOUND');
    return project;
  }

  function publicJob(job, task, lease, extra = {}) {
    const output = task?.output ? safeOutput(task.output) : null;
    return {
      id: job.id,
      project_id: job.project_id,
      kind: job.kind,
      shot_id: job.shot_id,
      take: job.take,
      engine: job.engine,
      status: productionStatus(task, job),
      manifest_sha256: job.manifest_sha256,
      retake_of: job.retake_of || null,
      compute_task_id: job.compute_task_id || null,
      attempts: task ? { used: task.attempts, max: task.max_attempts } : null,
      worker: output?.worker || (lease?.node_id ? { node_id: lease.node_id } : (task?.locked_by_node_id ? { node_id: task.locked_by_node_id } : null)),
      progress: lease?.progress && Object.keys(lease.progress).length ? lease.progress : null,
      engine_version: output?.engine || null,
      unreal: output?.unreal || null,
      checks: output?.checks || null,
      checks_passed: output ? checksPassed(output) : null,
      playback: output?.playback || null,
      outputs: output?.outputs || [],
      simulated: output?.simulated === true,
      error: task?.last_error || output?.error || null,
      cancel_requested_at: job.cancel_requested_at || null,
      created_at: job.created_at,
      updated_at: task?.updated_at || job.updated_at,
      ...extra
    };
  }

  function safeOutput(raw) {
    try { return validateRenderOutput(raw); }
    catch (error) { return { ok: false, error: `worker output rejected: ${error.message}`, outputs: [], checks: {} }; }
  }

  // Record the artifacts a finished task reported (idempotent upsert).
  async function syncArtifacts(job, task) {
    if (!task || task.status !== 'done' || !task.output) return [];
    const output = safeOutput(task.output);
    const rows = output.outputs.map((item) => ({
      org_id: job.org_id,
      project_id: job.project_id,
      job_id: job.id,
      shot_id: job.shot_id,
      take: job.take,
      kind: item.kind,
      path: item.path,
      project_path: item.project_path,
      sha256: item.sha256,
      bytes: item.bytes,
      node_id: output.worker?.node_id || task.locked_by_node_id || null,
      storage: 'node-local',
      simulated: output.simulated === true,
      metadata: { label: item.label, engine: output.engine, unreal: output.unreal }
    }));
    return rows.length ? store.insertArtifacts(rows) : [];
  }

  async function enqueueFor(job, input, { maxAttempts, priority, source }) {
    const result = await compute.enqueue({
      orgId: job.org_id,
      capability: workerCapabilityFor(job.kind, job.engine),
      implementation: null,
      input,
      requirements: {},
      priority: Math.max(-100, Math.min(100, Number(priority || 0))),
      maxAttempts: boundedAttempts(maxAttempts),
      idempotencyKey: computeIdempotencyKey(job.job_key),
      metadata: { source: source || 'production-service', production_job_id: job.id, project_id: job.project_id, shot_id: job.shot_id, take: job.take, kind: job.kind, requested_at: now().toISOString() }
    });
    if (!result?.task?.id) throw fail('compute task was not queued', 503, 'PRODUCTION_ENQUEUE_FAILED', { retryable: true });
    const updated = await store.updateJob(job.org_id, job.id, { compute_task_id: result.task.id, status: 'queued' });
    return { job: updated || { ...job, compute_task_id: result.task.id }, task: result.task };
  }

  async function submitJob({ orgId, actor, kind, manifest, jobKey, retakeOf = null, options = {} }) {
    const existing = await store.findJobByKey(orgId, jobKey);
    if (existing) {
      if (existing.compute_task_id) {
        const task = await compute.taskById({ orgId, taskId: existing.compute_task_id });
        return publicJob(existing, task, null, { replayed: true });
      }
      const { job, task } = await enqueueFor(existing, workerInput(existing, manifest), options);
      return publicJob(job, task, null, { replayed: true });
    }
    const row = {
      org_id: orgId,
      project_id: manifest.project_id,
      kind,
      shot_id: manifest.shot_id || manifest.selection_id || null,
      take: manifest.take || null,
      engine: manifest.engine || (kind === 'facetrack' ? 'mediapipe' : kind === 'transcript' ? 'faster-whisper' : null),
      job_key: jobKey,
      manifest,
      manifest_sha256: manifestHash(manifest),
      retake_of: retakeOf,
      status: 'queued',
      max_attempts: boundedAttempts(options.maxAttempts),
      created_by: actor.user_id
    };
    const inserted = await store.insertJob(row);
    const job = inserted.job || await store.findJobByKey(orgId, jobKey);
    if (!job) throw fail('production job was not recorded', 503, 'PRODUCTION_RECORD_FAILED', { retryable: true });
    const queued = await enqueueFor(job, workerInput(job, manifest), options);
    return publicJob(queued.job, queued.task, null, { replayed: !inserted.created });
  }

  // What the worker receives: the job id, the normalized manifest and
  // its hash. Never a path on the worker, never a command.
  function workerInput(job, manifest) {
    return { protocol: 'mccluster-production/1', job_id: job.id, kind: job.kind, manifest, manifest_sha256: manifestHash(manifest) };
  }

  return {
    async projectGet({ orgId, projectId, actor }) {
      const role = await authorize(orgId, projectId, actor, ROLES_THAT_READ);
      const project = await loadProject(orgId, projectId);
      return {
        project: { id: project.id, title: project.title, status: project.status, storage: project.storage || null, settings: project.settings || {} },
        role,
        shots: project.shots || [],
        assets: (project.assets || []).map(publicAsset),
        consents: (project.consents || []).map((c) => ({ actor_id: c.actor_id, scope: c.scope, active: !c.revoked_at, granted_at: c.granted_at }))
      };
    },

    async assetLookup({ orgId, projectId, actor, kind = null, query = null, limit = 50 }) {
      await authorize(orgId, projectId, actor, ROLES_THAT_READ);
      const assets = await store.listAssets(orgId, projectId, { kind: kind ? text(kind, 40) : null, query: query ? text(query, 80).replace(/[^A-Za-z0-9 _.-]/g, '') : null, limit: Math.max(1, Math.min(200, Number(limit) || 50)) });
      return { project_id: projectId, assets: assets.map(publicAsset) };
    },

    async shotValidate({ orgId, actor, manifest: raw }) {
      const manifest = normalizeShotRender(raw);
      await authorize(orgId, manifest.project_id, actor, ROLES_THAT_READ);
      const project = await loadProject(orgId, manifest.project_id);
      const result = validateShotAgainstProject(manifest, project);
      return { ...result, manifest, manifest_sha256: manifestHash(manifest), job_key: renderJobKey(manifest) };
    },

    async renderSubmit({ orgId, actor, manifest: raw = null, retakeOf = null, changes = {}, maxAttempts, priority, source }) {
      requireActor(actor);
      let manifest;
      if (retakeOf) {
        const previous = await store.getJob(orgId, text(retakeOf, 64));
        if (!previous || previous.kind !== 'render') throw fail('retake_of names no render job', 404, 'RETAKE_UNKNOWN');
        await authorize(orgId, previous.project_id, actor, ROLES_THAT_SUBMIT);
        const takes = await store.listJobs(orgId, previous.project_id, { shotId: previous.shot_id, kind: 'render', limit: 200 });
        const latestTake = takes.reduce((max, j) => Math.max(max, Number(j.take || 0)), Number(previous.take || 1));
        manifest = planRetake({ ...previous, latest_take: latestTake }, changes);
      } else {
        manifest = normalizeShotRender(raw);
        await authorize(orgId, manifest.project_id, actor, ROLES_THAT_SUBMIT);
      }
      const project = await loadProject(orgId, manifest.project_id);
      const validation = validateShotAgainstProject(manifest, project);
      if (!validation.ok) throw fail(`shot ${manifest.shot_id} is not valid: ${validation.errors[0]}`, 422, 'PRODUCTION_SHOT_INVALID', { detail: validation });
      const job = await submitJob({ orgId, actor, kind: 'render', manifest, jobKey: renderJobKey(manifest), retakeOf: manifest.retake_of, options: { maxAttempts, priority, source } });
      return { job, warnings: validation.warnings };
    },

    async facetrackSubmit({ orgId, actor, manifest: raw, maxAttempts, priority, source }) {
      const manifest = normalizeFacetrack(raw);
      await authorize(orgId, manifest.project_id, actor, ROLES_THAT_SUBMIT);
      const project = await loadProject(orgId, manifest.project_id);
      const consent = (project.consents || []).find((c) => c.actor_id === manifest.actor_id && !c.revoked_at);
      if (!consent || !(consent.scope || []).includes('face_tracking')) throw fail(`actor ${manifest.actor_id} has not consented to face tracking`, 403, 'PRODUCTION_CONSENT_REQUIRED');
      const take = (project.assets || []).find((a) => a.path === manifest.take && a.kind === 'recording');
      if (!take) throw fail(`take ${manifest.take} is not a registered recording of this project`, 422, 'PRODUCTION_SHOT_INVALID');
      const key = `facetrack:${manifest.project_id}:${manifest.actor_id}:${manifestHash(manifest).slice(0, 24)}`;
      return { job: await submitJob({ orgId, actor, kind: 'facetrack', manifest, jobKey: key, options: { maxAttempts, priority, source } }) };
    },

    async transcriptSubmit({ orgId, actor, manifest: raw, maxAttempts, priority, source }) {
      const manifest = normalizeTranscript(raw);
      await authorize(orgId, manifest.project_id, actor, ROLES_THAT_SUBMIT);
      const project = await loadProject(orgId, manifest.project_id);
      const media = (project.assets || []).find((a) => a.path === manifest.media);
      if (!media) throw fail(`media ${manifest.media} is not a registered project asset`, 422, 'PRODUCTION_SHOT_INVALID');
      if (media.kind === 'recording' && manifest.actor_id) {
        const consent = (project.consents || []).find((c) => c.actor_id === manifest.actor_id && !c.revoked_at);
        if (!consent || !(consent.scope || []).some((s) => s === 'microphone' || s === 'transcript')) throw fail(`actor ${manifest.actor_id} has not consented to transcription`, 403, 'PRODUCTION_CONSENT_REQUIRED');
      }
      const key = `transcript:${manifest.project_id}:${manifestHash(manifest).slice(0, 24)}`;
      return { job: await submitJob({ orgId, actor, kind: 'transcript', manifest, jobKey: key, options: { maxAttempts, priority, source } }) };
    },

    async jobGet({ orgId, jobId, actor }) {
      const job = await store.getJob(orgId, text(jobId, 64));
      if (!job) throw fail('production job not found', 404, 'PRODUCTION_JOB_NOT_FOUND');
      await authorize(orgId, job.project_id, actor, ROLES_THAT_READ);
      const task = job.compute_task_id ? await compute.taskById({ orgId, taskId: job.compute_task_id }) : null;
      const lease = job.compute_task_id && store.leaseProgress ? await store.leaseProgress(job.compute_task_id).catch(() => null) : null;
      const status = productionStatus(task, job);
      if (status !== job.status) await store.updateJob(orgId, job.id, { status });
      const artifacts = await syncArtifacts(job, task);
      return { job: publicJob({ ...job, status }, task, lease), artifacts: artifacts.length ? artifacts.map(publicArtifact) : undefined };
    },

    async jobCancel({ orgId, jobId, actor, reason = 'canceled by the owner' }) {
      const job = await store.getJob(orgId, text(jobId, 64));
      if (!job) throw fail('production job not found', 404, 'PRODUCTION_JOB_NOT_FOUND');
      await authorize(orgId, job.project_id, actor, ROLES_THAT_SUBMIT);
      const task = job.compute_task_id ? await compute.taskById({ orgId, taskId: job.compute_task_id }) : null;
      if (task && ['done', 'failed', 'canceled'].includes(task.status)) {
        return { job: publicJob(job, task, null), canceled: false, reason: `job already ${productionStatus(task, job)}` };
      }
      const stamp = now().toISOString();
      if (task) {
        const canceled = await compute.cancelQueued({ orgId, taskId: task.id, reason: `production cancel: ${text(reason, 200)}` });
        if (canceled) {
          const updated = await store.updateJob(orgId, job.id, { status: 'canceled', cancel_requested_at: stamp });
          return { job: publicJob(updated, canceled, null), canceled: true, mode: 'queued' };
        }
        // A worker holds it: ask the gateway to tell the worker.
        await store.requestComputeCancel(orgId, task.id, text(reason, 200));
      }
      const updated = await store.updateJob(orgId, job.id, { status: 'cancel_requested', cancel_requested_at: stamp });
      const fresh = task ? await compute.taskById({ orgId, taskId: task.id }) : null;
      return { job: publicJob(updated, fresh, null), canceled: false, mode: 'running', cancel_requested: true };
    },

    async artifactGet({ orgId, actor, jobId = null, artifactId = null }) {
      if (!jobId && !artifactId) throw fail('job_id or artifact_id is required', 400, 'PRODUCTION_INVALID');
      let job = null;
      if (jobId) {
        job = await store.getJob(orgId, text(jobId, 64));
        if (!job) throw fail('production job not found', 404, 'PRODUCTION_JOB_NOT_FOUND');
        await authorize(orgId, job.project_id, actor, ROLES_THAT_READ);
        const task = job.compute_task_id ? await compute.taskById({ orgId, taskId: job.compute_task_id }) : null;
        await syncArtifacts(job, task);
      }
      const artifacts = await store.listArtifacts(orgId, { jobId: job?.id || null, artifactId: artifactId ? text(artifactId, 64) : null });
      if (!job && artifacts[0]) await authorize(orgId, artifacts[0].project_id, actor, ROLES_THAT_READ);
      if (!artifacts.length && artifactId) throw fail('artifact not found', 404, 'PRODUCTION_ARTIFACT_NOT_FOUND');
      return { artifacts: artifacts.map(publicArtifact) };
    }
  };
}

function publicAsset(a) {
  return { asset_id: a.asset_id, version: a.version, kind: a.kind, path: a.path, sha256: a.sha256 || null, bytes: a.bytes ?? null, approved: a.approved === true, editable: a.editable !== false, label: a.label || null };
}

function publicArtifact(a) {
  return { id: a.id, job_id: a.job_id, shot_id: a.shot_id, take: a.take, kind: a.kind, path: a.path, project_path: a.project_path || null, sha256: a.sha256 || null, bytes: a.bytes ?? null, node_id: a.node_id || null, storage: a.storage || 'node-local', simulated: a.simulated === true, created_at: a.created_at };
}

export { JOB_KINDS, ProductionContractError };
