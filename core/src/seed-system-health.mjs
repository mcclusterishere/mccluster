import { enqueueJob, hasPendingJob } from './supabase.mjs';

const orgId = String(process.env.MCCLUSTER_ORG_ID || '').trim();
const targetId = String(process.env.MCCLUSTER_HEALTH_TARGET_ID || 'ovh-mccluster-core').trim() || 'ovh-mccluster-core';

function log(event, detail = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...detail }));
}

async function main() {
  if (!orgId) throw new Error('MCCLUSTER_ORG_ID is required');

  if (await hasPendingJob({ orgId, jobType: 'host_health', targetId })) {
    log('system_health_seed_skipped', { reason: 'already_pending', target_id: targetId });
    return;
  }

  const job = await enqueueJob({
    orgId,
    jobType: 'host_health',
    targetType: 'host',
    targetId,
    priority: Number(process.env.MCCLUSTER_HEALTH_PRIORITY || 95),
    maxAttempts: 2,
    input: {
      requested_by: 'mccluster-core-system-health.timer',
      requested_at: new Date().toISOString(),
    },
  });

  log('system_health_seeded', { job_id: job.id, target_id: targetId });
}

main().catch((error) => {
  log('system_health_seed_failed', { message: error.message });
  process.exitCode = 1;
});
