/* ============================================================
   Offline production runner (no network, no Supabase).

   Runs the same chain the backend does: the production service
   validates and authorizes the shot, queues it with the same job key
   and idempotency key, a local worker claims it, and the production
   executor runs the engine adapters. The job record is kept in
   <project root>/jobs/local-ledger.json so a retake, a replay and a
   status read work across runs. It never writes Supabase; when the
   node is online the same manifests go through core.production.*.

   usage:
     node core/src/production/local-run.mjs <executor-config.json> \
       --project <project.json> --manifest <shot.json> [--engine unreal|blender]
     node core/src/production/local-run.mjs <executor-config.json> \
       --project <project.json> --retake <job id> [--note "..."]
     node core/src/production/local-run.mjs <executor-config.json> \
       --project <project.json> --status <job id>

   project.json is the project record as core.production.project.get
   returns it (assets with sha256, consents, shots, members). The
   owner running this is the actor.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createProductionService } from './service.mjs';
import { memoryProductionStore } from './store.mjs';
import { createProductionExecutor, loadExecutorConfig } from './executor.mjs';

const LOCAL_OWNER = '00000000-0000-4000-8000-00000000000f';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else out._.push(a);
  }
  return out;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));

// A local queue with the compute RPC semantics (idempotency key, bounded
// attempts, atomic cancel of a queued task), persisted in the ledger.
function ledgerCompute(ledger) {
  return {
    async enqueue({ orgId, capability, input, priority, maxAttempts, idempotencyKey, metadata }) {
      const known = idempotencyKey && ledger.keys[idempotencyKey];
      if (known) {
        const task = ledger.tasks[known];
        if (JSON.stringify(task.input) !== JSON.stringify(input)) throw Object.assign(new Error('Idempotency-Key was already used for a different compute task request'), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
        return { task: structuredClone(task), replayed: true };
      }
      const at = new Date().toISOString();
      const task = { id: crypto.randomUUID(), org_id: orgId, capability, implementation: null, input, priority, status: 'queued', attempts: 0, max_attempts: Math.max(1, Math.min(100, maxAttempts || 1)), locked_by_node_id: null, output: null, last_error: null, metadata, created_at: at, updated_at: at };
      ledger.tasks[task.id] = task;
      if (idempotencyKey) ledger.keys[idempotencyKey] = task.id;
      return { task: structuredClone(task), replayed: false };
    },
    async taskById({ orgId, taskId }) { const t = ledger.tasks[taskId]; return t && t.org_id === orgId ? structuredClone(t) : null; },
    async cancelQueued({ orgId, taskId, reason }) {
      const t = ledger.tasks[taskId];
      if (!t || t.org_id !== orgId || t.status !== 'queued') return null;
      Object.assign(t, { status: 'canceled', last_error: reason, updated_at: new Date().toISOString() });
      return structuredClone(t);
    }
  };
}

export async function runLocal({ configPath, projectPath, manifestPath, engine, retake, note, status, log = (line) => console.error(line) }) {
  const config = loadExecutorConfig(readJson(configPath));
  const project = readJson(projectPath);
  const root = config.projects[project.id];
  if (!root) throw new Error(`project ${project.id} is not in the executor config`);
  const ledgerFile = path.join(root, 'jobs', 'local-ledger.json');
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  const ledger = fs.existsSync(ledgerFile) ? readJson(ledgerFile) : { schema: 'mccluster-production-local-ledger/1', tasks: {}, keys: {}, jobs: [], artifacts: [] };
  const save = () => { fs.writeFileSync(`${ledgerFile}.tmp`, JSON.stringify(ledger, null, 1)); fs.renameSync(`${ledgerFile}.tmp`, ledgerFile); };

  const store = memoryProductionStore({ projects: [project], orgOwners: [{ org_id: project.org_id, profile_id: LOCAL_OWNER }] });
  for (const job of ledger.jobs) store._jobs.set(job.id, job);
  store._artifacts.push(...ledger.artifacts);
  const compute = ledgerCompute(ledger);
  const svc = createProductionService({ store, compute });
  const actor = { user_id: LOCAL_OWNER, kind: 'owner', source: 'local-run' };
  const orgId = project.org_id;
  const persist = () => { ledger.jobs = [...store._jobs.values()]; ledger.artifacts = [...store._artifacts]; save(); };

  if (status) { const out = await svc.jobGet({ orgId, actor, jobId: status }); persist(); return out; }

  let submitted;
  if (retake) submitted = await svc.renderSubmit({ orgId, actor, retakeOf: retake, changes: note ? { note } : {}, source: 'local-run' });
  else {
    const manifest = readJson(manifestPath);
    if (engine) manifest.engine = engine;
    submitted = await svc.renderSubmit({ orgId, actor, manifest, source: 'local-run' });
  }
  persist();
  const jobId = submitted.job.id;
  log(JSON.stringify({ event: 'production_job_submitted', job_id: jobId, take: submitted.job.take, replayed: Boolean(submitted.job.replayed) }));
  const task = ledger.tasks[submitted.job.compute_task_id || store._jobs.get(jobId)?.compute_task_id];
  if (task && task.status === 'queued') {
    const capability = task.capability;
    if (!config.capabilities.includes(capability)) throw new Error(`this node does not run ${capability}; enable it in the executor config`);
    const executor = createProductionExecutor(config);
    while (task.status === 'queued') {
      Object.assign(task, { status: 'running', attempts: task.attempts + 1, locked_by_node_id: `local:${config.nodeLabel}`, updated_at: new Date().toISOString() });
      save();
      try {
        const output = await executor.execute({ capability, input: task.input });
        Object.assign(task, { status: 'done', output, updated_at: new Date().toISOString() });
      } catch (error) {
        task.last_error = String(error.message).slice(0, 4000);
        task.status = error.retryable && task.attempts < task.max_attempts ? 'queued' : 'failed';
        task.locked_by_node_id = task.status === 'queued' ? null : task.locked_by_node_id;
        log(JSON.stringify({ event: 'production_attempt_failed', job_id: jobId, attempt: task.attempts, code: error.code || null, error: task.last_error, retry: task.status === 'queued' }));
      }
      save();
    }
  }
  const out = await svc.jobGet({ orgId, actor, jobId });
  persist();
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args._[0] || process.env.MCCLUSTER_PRODUCTION_CONFIG;
  if (!configPath || !args.project || !(args.manifest || args.retake || args.status)) {
    console.error('usage: node local-run.mjs <executor-config.json> --project <project.json> (--manifest <shot.json> [--engine unreal|blender] | --retake <job id> [--note text] | --status <job id>)');
    process.exit(2);
  }
  runLocal({ configPath, projectPath: args.project, manifestPath: args.manifest, engine: args.engine, retake: args.retake, note: args.note, status: args.status })
    .then((out) => { console.log(JSON.stringify(out, null, 1)); process.exit(out.job?.status === 'succeeded' ? 0 : 1); })
    .catch((error) => { console.error(JSON.stringify({ error: error.message, code: error.code || null })); process.exit(2); });
}
