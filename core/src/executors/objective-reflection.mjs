import { enqueueJob, recentJobs, recentObjectives } from '../supabase.mjs';
import { allowedReflectionJobTypes, extractJsonObject, normalizeReflectionPlan } from '../reflection-policy.mjs';

const OLLAMA = String(process.env.MCCLUSTER_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';

function bounded(value, max) {
  return String(value ?? '').slice(0, max);
}

export async function objectiveReflection(job) {
  if (!job.org_id) throw new Error('objective_reflection requires org_id');

  const objective = bounded(
    job.input?.objective || job.input?.task || 'Advance active McCluster objectives safely using existing evidence.',
    12_000,
  ).trim();
  const sinceHours = Math.min(72, Math.max(1, Number(job.input?.since_hours || 18)));
  const maxJobs = Math.min(3, Math.max(0, Number(job.input?.max_next_jobs ?? 2)));

  const [objectives, jobs] = await Promise.all([
    recentObjectives({ orgId: job.org_id, limit: 25 }),
    recentJobs({ orgId: job.org_id, sinceHours, limit: 35 }),
  ]);

  const system = [
    'You are the McCluster Core objective reflection engine.',
    'Use only the supplied canonical objective records and recent job history.',
    'Do not claim access to web, email, files, live infrastructure, or external systems unless that evidence is explicitly present.',
    'Your purpose is to select small, useful, reversible next steps that can run unattended.',
    `You may propose only these job types: ${allowedReflectionJobTypes().join(', ')}.`,
    'Use objective_plan only when the objective genuinely benefits from a small dependency-aware multi-step plan; otherwise prefer a direct safe job.',
    'An objective_plan is still bounded: its child steps are restricted to local_analysis and repo_health and prerequisite outputs are passed forward as evidence.',
    'Never propose code_patch, deploy, merge, communications, spending, legal actions, auth changes, destructive data changes, or production mutations.',
    'Prefer resolving blockers and gathering evidence before creating more work.',
    'Return JSON only with keys summary, rationale, next_jobs.',
    'Each next_jobs item must contain job_type, task, target_type, target_id, priority, and optional evidence.',
  ].join(' ');

  const user = JSON.stringify({
    objective,
    max_next_jobs: maxJobs,
    canonical_objectives: objectives,
    recent_jobs: jobs,
  });

  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: {
        temperature: 0.1,
        num_ctx: Number(process.env.MCCLUSTER_OLLAMA_CONTEXT || 16384),
      },
    }),
    signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_TIMEOUT_MS || 10 * 60_000)),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Ollama returned ${response.status}`);
  const text = String(data?.message?.content || '').trim();
  if (!text) throw new Error('Ollama returned an empty reflection');

  const parsed = extractJsonObject(text);
  const plan = normalizeReflectionPlan(parsed || { summary: text, next_jobs: [] }, { maxJobs });
  const queued = [];

  for (const next of plan.next_jobs) {
    const created = await enqueueJob({
      orgId: job.org_id,
      jobType: next.job_type,
      targetType: next.target_type,
      targetId: next.target_id,
      priority: next.priority,
      input: {
        ...next.input,
        reflection_parent_job_id: job.id,
        reflection_objective: objective,
      },
    });
    queued.push({
      id: created.id,
      job_type: created.job_type,
      target_type: created.target_type,
      target_id: created.target_id,
      priority: created.priority,
    });
  }

  return {
    executor: 'objective_reflection:v2',
    model: MODEL,
    evidence_scope: 'canonical_objectives_and_recent_jobs',
    objective,
    summary: plan.summary,
    rationale: plan.rationale,
    queued_jobs: queued,
    dropped_job_count: plan.dropped_job_count,
    source_counts: {
      objectives: objectives.length,
      recent_jobs: jobs.length,
    },
    usage: {
      prompt_eval_count: data?.prompt_eval_count ?? null,
      eval_count: data?.eval_count ?? null,
      total_duration_ns: data?.total_duration ?? null,
    },
  };
}
