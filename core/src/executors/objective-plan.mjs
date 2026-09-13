import { createHash } from 'node:crypto';
import { checkpointJobInput, enqueueJob, recentJobs, recentObjectives } from '../supabase.mjs';
import { allowedPlanJobTypes, normalizeObjectivePlan } from '../plan-policy.mjs';
import { extractJsonObject } from '../reflection-policy.mjs';

const OLLAMA = String(process.env.MCCLUSTER_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';

function bounded(value, max) {
  return String(value ?? '').slice(0, max);
}

function deterministicUuid(seed) {
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function stepJobId(plannerJobId, stepKey) {
  return deterministicUuid(`mccluster-objective-plan:${plannerJobId}:${stepKey}`);
}

function validCheckpoint(value) {
  return value && typeof value === 'object'
    && value.plan && typeof value.plan === 'object'
    && Array.isArray(value.plan.steps)
    && typeof value.plan_id === 'string';
}

export async function objectivePlan(job) {
  if (!job.org_id) throw new Error('objective_plan requires org_id');

  const objective = bounded(job.input?.objective || job.input?.task || '', 12_000).trim();
  if (!objective) throw new Error('objective_plan requires input.objective or input.task');

  const maxSteps = Math.min(12, Math.max(1, Number(job.input?.max_steps || 8)));
  const sinceHours = Math.min(168, Math.max(1, Number(job.input?.since_hours || 48)));
  const existingCheckpoint = job.input?.objective_plan_checkpoint;

  let plan;
  let modelUsage = null;
  let sourceCounts = null;
  const planId = job.id;

  if (validCheckpoint(existingCheckpoint)) {
    plan = normalizeObjectivePlan(existingCheckpoint.plan, { maxSteps });
  } else {
    const [objectives, jobs] = await Promise.all([
      recentObjectives({ orgId: job.org_id, limit: 30 }),
      recentJobs({ orgId: job.org_id, sinceHours, limit: 50 }),
    ]);

    const system = [
      'You are the McCluster Core dependency-aware objective planner.',
      'Build a small directed acyclic graph of safe unattended work using only supplied evidence.',
      `Allowed executable step types: ${allowedPlanJobTypes().join(', ')}.`,
      'Do not propose code_patch, deploy, merge, communications, spending, legal actions, auth changes, destructive data changes, or production mutations.',
      'Steps must be topologically ordered. A step may depend only on keys from earlier steps.',
      'Use dependencies when later analysis genuinely requires evidence produced by an earlier step. Independent work should remain parallel.',
      'Return JSON only with keys summary, rationale, steps.',
      'Each step must contain key, job_type, task, depends_on, target_type, target_id, priority, and optional evidence.',
    ].join(' ');

    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ objective, max_steps: maxSteps, canonical_objectives: objectives, recent_jobs: jobs }) },
        ],
        options: {
          temperature: 0,
          num_ctx: Number(process.env.MCCLUSTER_OLLAMA_CONTEXT || 16384),
        },
      }),
      signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_TIMEOUT_MS || 10 * 60_000)),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `Ollama returned ${response.status}`);
    const text = String(data?.message?.content || '').trim();
    if (!text) throw new Error('Ollama returned an empty objective plan');

    const parsed = extractJsonObject(text);
    plan = normalizeObjectivePlan(parsed || { summary: text, steps: [] }, { maxSteps });
    modelUsage = {
      prompt_eval_count: data?.prompt_eval_count ?? null,
      eval_count: data?.eval_count ?? null,
      total_duration_ns: data?.total_duration ?? null,
    };
    sourceCounts = { objectives: objectives.length, recent_jobs: jobs.length };

    const checkpoint = {
      schema_version: '1',
      plan_id: planId,
      objective,
      plan,
      source_counts: sourceCounts,
      usage: modelUsage,
    };
    await checkpointJobInput(job, {
      ...(job.input && typeof job.input === 'object' ? job.input : {}),
      objective_plan_checkpoint: checkpoint,
    });
  }

  const jobIdsByKey = new Map(plan.steps.map((step) => [step.key, stepJobId(job.id, step.key)]));
  const queued = [];

  for (const step of plan.steps) {
    const dependsOnJobIds = step.depends_on.map((key) => jobIdsByKey.get(key)).filter(Boolean);
    const created = await enqueueJob({
      jobId: jobIdsByKey.get(step.key),
      orgId: job.org_id,
      jobType: step.job_type,
      targetType: step.target_type,
      targetId: step.target_id,
      priority: step.priority,
      input: {
        ...step.input,
        objective,
        plan: {
          plan_id: planId,
          planner_job_id: job.id,
          step_key: step.key,
          depends_on_step_keys: step.depends_on,
          depends_on_job_ids: dependsOnJobIds,
        },
      },
    });
    queued.push({
      key: step.key,
      id: created.id,
      job_type: created.job_type,
      depends_on: step.depends_on,
      depends_on_job_ids: dependsOnJobIds,
    });
  }

  const checkpointMeta = validCheckpoint(existingCheckpoint) ? existingCheckpoint : null;
  return {
    executor: 'objective_plan:v2',
    model: MODEL,
    plan_id: planId,
    objective,
    summary: plan.summary,
    rationale: plan.rationale,
    queued_steps: queued,
    dropped_step_count: plan.dropped_step_count,
    source_counts: sourceCounts || checkpointMeta?.source_counts || null,
    usage: modelUsage || checkpointMeta?.usage || null,
    retry_safe: true,
  };
}
