import { enqueueJob, hasPendingJob } from './supabase.mjs';

const orgId = String(process.env.MCCLUSTER_ORG_ID || '').trim();
const targetId = String(process.env.MCCLUSTER_REFLECTION_TARGET_ID || 'McCluster').trim() || 'McCluster';

function log(event, detail = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...detail }));
}

async function main() {
  if (!orgId) throw new Error('MCCLUSTER_ORG_ID is required');

  const alreadyPending = await hasPendingJob({
    orgId,
    jobType: 'objective_reflection',
    targetId,
  });

  if (alreadyPending) {
    log('objective_reflection_seed_skipped', { reason: 'already_pending', target_id: targetId });
    return;
  }

  const job = await enqueueJob({
    orgId,
    jobType: 'objective_reflection',
    targetType: 'portfolio',
    targetId,
    priority: Number(process.env.MCCLUSTER_REFLECTION_PRIORITY || 20),
    maxAttempts: 2,
    input: {
      objective: process.env.MCCLUSTER_REFLECTION_OBJECTIVE || 'Review active McCluster objectives and recent Core execution. Queue the smallest safe unattended tasks that reduce blockers or improve evidence before the morning digest.',
      since_hours: Number(process.env.MCCLUSTER_REFLECTION_LOOKBACK_HOURS || 18),
      max_next_jobs: Number(process.env.MCCLUSTER_REFLECTION_MAX_NEXT_JOBS || 2),
      seeded_by: 'mccluster-core-reflection.timer',
    },
  });

  log('objective_reflection_seeded', { job_id: job.id, target_id: targetId });
}

main().catch((error) => {
  log('objective_reflection_seed_failed', { message: error.message });
  process.exitCode = 1;
});
