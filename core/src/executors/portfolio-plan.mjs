import { buildPortfolioPlan } from '../initiative-os.mjs';
import { enqueueJob, recentJobs, recentObjectives } from '../supabase.mjs';

function bounded(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, parsed));
}

export async function portfolioPlan(job) {
  if (!job.org_id) throw new Error('portfolio_plan requires org_id');

  const objectiveLimit = positiveInt(job.input?.objective_limit, 100, 100);
  const recentJobLimit = positiveInt(job.input?.recent_job_limit, 75, 100);
  const reflectionCount = positiveInt(job.input?.reflection_count, 3, 3);
  const sinceHours = positiveInt(job.input?.since_hours, 24, 168) || 24;
  const portfolio = bounded(job.input?.portfolio || job.target_id || 'McCluster', 500) || 'McCluster';

  const [objectives, jobs] = await Promise.all([
    recentObjectives({ orgId: job.org_id, limit: objectiveLimit || 100 }),
    recentJobs({ orgId: job.org_id, sinceHours, limit: recentJobLimit || 75 }),
  ]);

  const plan = buildPortfolioPlan({
    objectives,
    recentJobs: jobs,
    maxInitiatives: positiveInt(job.input?.max_initiatives, 20, 50) || 20,
  });

  const queuedReflections = [];
  for (const initiative of plan.top_initiatives.slice(0, reflectionCount)) {
    const task = [
      `Advance the ${initiative.initiative} initiative inside ${initiative.project}.`,
      `This was selected by Initiative OS with score ${initiative.score}.`,
      initiative.blocked ? 'Prioritize identifying and resolving the blocker using reversible evidence-gathering work.' : 'Identify the highest-value reversible next step that can run unattended.',
      `Canonical objective ids: ${initiative.objective_ids.join(', ') || 'none'}.`,
    ].join(' ');

    const created = await enqueueJob({
      orgId: job.org_id,
      jobType: 'objective_reflection',
      targetType: 'initiative',
      targetId: `${initiative.project}:${initiative.initiative}`.slice(0, 500),
      priority: Math.min(100, Math.max(0, Math.round(initiative.score))),
      input: {
        objective: task,
        max_next_jobs: 2,
        since_hours: sinceHours,
        portfolio_plan_parent_job_id: job.id,
        portfolio,
        project: initiative.project,
        initiative: initiative.initiative,
        department: initiative.department,
      },
    });

    queuedReflections.push({
      id: created.id,
      target_id: created.target_id,
      priority: created.priority,
      project: initiative.project,
      initiative: initiative.initiative,
      department: initiative.department,
    });
  }

  return {
    executor: 'portfolio_plan:v1',
    portfolio,
    summary: `Ranked ${plan.initiative_count} active initiatives and queued ${queuedReflections.length} bounded reflections.`,
    plan,
    queued_reflections: queuedReflections,
    safety: {
      direct_consequential_actions: false,
      direct_code_changes: false,
      direct_communications: false,
      direct_spending: false,
      child_jobs: 'objective_reflection only',
    },
  };
}
