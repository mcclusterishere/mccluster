import { enqueueJob, hasPendingJob } from './supabase.mjs';

const orgId = String(process.env.MCCLUSTER_ORG_ID || '').trim();
const targetId = String(process.env.MCCLUSTER_PORTFOLIO_TARGET_ID || 'McCluster').trim() || 'McCluster';

function log(event, detail = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...detail }));
}

async function main() {
  if (!orgId) throw new Error('MCCLUSTER_ORG_ID is required');

  const alreadyPending = await hasPendingJob({
    orgId,
    jobType: 'portfolio_plan',
    targetId,
  });

  if (alreadyPending) {
    log('portfolio_plan_seed_skipped', { reason: 'already_pending', target_id: targetId });
    return;
  }

  const job = await enqueueJob({
    orgId,
    jobType: 'portfolio_plan',
    targetType: 'portfolio',
    targetId,
    priority: Number(process.env.MCCLUSTER_PORTFOLIO_PLAN_PRIORITY || 30),
    maxAttempts: 2,
    input: {
      portfolio: targetId,
      since_hours: Number(process.env.MCCLUSTER_PORTFOLIO_LOOKBACK_HOURS || 24),
      objective_limit: Number(process.env.MCCLUSTER_PORTFOLIO_OBJECTIVE_LIMIT || 100),
      recent_job_limit: Number(process.env.MCCLUSTER_PORTFOLIO_RECENT_JOB_LIMIT || 75),
      max_initiatives: Number(process.env.MCCLUSTER_PORTFOLIO_MAX_INITIATIVES || 20),
      reflection_count: Number(process.env.MCCLUSTER_PORTFOLIO_REFLECTION_COUNT || 3),
      seeded_by: 'mccluster-core-portfolio-plan.timer',
    },
  });

  log('portfolio_plan_seeded', { job_id: job.id, target_id: targetId });
}

main().catch((error) => {
  log('portfolio_plan_seed_failed', { message: error.message });
  process.exitCode = 1;
});
