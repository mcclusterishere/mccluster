import { createHash } from 'node:crypto';
import { buildPortfolioPlan } from '../initiative-os.mjs';
import { enqueueJob, markSignal, recentJobs, recentObjectives, recentSignals } from '../supabase.mjs';

function bounded(value, max) { return String(value ?? '').trim().slice(0, max); }
function positiveInt(value, fallback, max) { const parsed = Number.parseInt(value, 10); if (!Number.isFinite(parsed)) return fallback; return Math.min(max, Math.max(0, parsed)); }
function deterministicUuid(seed) {
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 32).split('');
  hex[12] = '5'; hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}

export async function portfolioPlan(job) {
  if (!job.org_id) throw new Error('portfolio_plan requires org_id');
  const objectiveLimit = positiveInt(job.input?.objective_limit, 100, 100);
  const recentJobLimit = positiveInt(job.input?.recent_job_limit, 75, 100);
  const signalLimit = positiveInt(job.input?.signal_limit, 100, 200);
  const synthesisCount = positiveInt(job.input?.synthesis_count, 5, 10);
  const reflectionCount = positiveInt(job.input?.reflection_count, 3, 3);
  const sinceHours = positiveInt(job.input?.since_hours, 24, 168) || 24;
  const portfolio = bounded(job.input?.portfolio || job.target_id || 'McCluster', 500) || 'McCluster';

  const [objectives, jobs, signals] = await Promise.all([
    recentObjectives({ orgId: job.org_id, limit: objectiveLimit || 100 }),
    recentJobs({ orgId: job.org_id, sinceHours, limit: recentJobLimit || 75 }),
    recentSignals({ orgId: job.org_id, statuses: ['new', 'queued'], sinceHours: Math.max(sinceHours, 168), limit: signalLimit || 100 }),
  ]);

  const plan = buildPortfolioPlan({ objectives, recentJobs: jobs, signals, maxInitiatives: positiveInt(job.input?.max_initiatives, 20, 50) || 20 });

  const queuedSyntheses = [];
  for (const signal of plan.world_state.synthesis_candidates.slice(0, synthesisCount)) {
    const synthesisJobId = deterministicUuid(`signal-synthesis:${job.org_id}:${signal.id}:${signal.fingerprint}`);
    const created = await enqueueJob({
      jobId: synthesisJobId,
      orgId: job.org_id,
      jobType: 'objective_synthesis',
      targetType: 'signal',
      targetId: String(signal.id),
      priority: Math.min(100, Math.max(10, Number(signal.severity || 40))),
      input: {
        source: {
          kind: 'signal',
          signal_id: String(signal.id),
          fingerprint: signal.fingerprint,
          provider: signal.source,
        },
        schedule_reflection: true,
        portfolio_plan_parent_job_id: job.id,
      },
      maxAttempts: 3,
    });
    await markSignal({ orgId: job.org_id, signalId: signal.id, status: 'queued' });
    queuedSyntheses.push({ id: created.id, signal_id: String(signal.id), source: signal.source, severity: signal.severity });
  }

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
      input: { objective: task, max_next_jobs: 2, since_hours: sinceHours, portfolio_plan_parent_job_id: job.id, portfolio, project: initiative.project, initiative: initiative.initiative, department: initiative.department },
    });
    queuedReflections.push({ id: created.id, target_id: created.target_id, priority: created.priority, project: initiative.project, initiative: initiative.initiative, department: initiative.department });
  }

  return {
    executor: 'portfolio_plan:v2', portfolio,
    summary: `Ranked ${plan.initiative_count} active initiatives, queued ${queuedSyntheses.length} signal syntheses, and queued ${queuedReflections.length} bounded reflections.`,
    plan, queued_syntheses: queuedSyntheses, queued_reflections: queuedReflections,
    safety: { direct_consequential_actions: false, direct_code_changes: false, direct_communications: false, direct_spending: false, child_jobs: 'objective_synthesis and objective_reflection only' },
  };
}
