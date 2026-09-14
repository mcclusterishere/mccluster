import { buildPortfolioPlan } from '../initiative-os.mjs';
import { signalToPortfolioRecord } from '../signal-portfolio.mjs';
import { enqueueJob, recentJobs, recentObjectives, recentSignals } from '../supabase.mjs';

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
  const signalLimit = positiveInt(job.input?.signal_limit, 100, 200);
  const recentJobLimit = positiveInt(job.input?.recent_job_limit, 75, 100);
  const reflectionCount = positiveInt(job.input?.reflection_count, 3, 3);
  const sinceHours = positiveInt(job.input?.since_hours, 24, 168) || 24;
  const signalSinceHours = positiveInt(job.input?.signal_since_hours, 168, 24 * 90) || 168;
  const portfolio = bounded(job.input?.portfolio || job.target_id || 'McCluster', 500) || 'McCluster';

  const [objectives, signals, jobs] = await Promise.all([
    recentObjectives({ orgId: job.org_id, limit: objectiveLimit || 100 }),
    recentSignals({ orgId: job.org_id, sinceHours: signalSinceHours, limit: signalLimit || 100 }),
    recentJobs({ orgId: job.org_id, sinceHours, limit: recentJobLimit || 75 }),
  ]);

  const signalRecords = signals.map(signalToPortfolioRecord);
  const plan = buildPortfolioPlan({
    objectives: [...objectives, ...signalRecords],
    recentJobs: jobs,
    maxInitiatives: positiveInt(job.input?.max_initiatives, 30, 50) || 30,
  });
  plan.canonical_objective_count = objectives.length;
  plan.signal_count = signals.length;
  plan.source_counts = {
    ops_objectives: objectives.length,
    ops_signals: signals.length,
    recent_jobs: jobs.length,
  };

  const queuedReflections = [];
  for (const initiative of plan.top_initiatives.slice(0, reflectionCount)) {
    const task = [
      `Advance the ${initiative.initiative} initiative inside ${initiative.project}.`,
      `This was selected by Initiative OS with score ${initiative.score}.`,
      initiative.blocked ? 'Prioritize identifying and resolving the blocker using reversible evidence-gathering work.' : 'Identify the highest-value reversible next step that can run unattended.',
      `Canonical objective/signal ids: ${initiative.objective_ids.join(', ') || 'none'}.`,
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
        source_ids: initiative.objective_ids,
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
    executor: 'portfolio_plan:v2',
    portfolio,
    summary: `Ranked ${plan.initiative_count} initiatives from ${objectives.length} objectives and ${signals.length} signals; queued ${queuedReflections.length} bounded reflections.`,
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
