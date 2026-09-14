import { recentJobs } from './supabase.mjs';
import { SYSTEM_HEALTH_SCHEMA } from './system-health.mjs';

const orgId = String(process.env.MCCLUSTER_ORG_ID || '').trim();

async function main() {
  if (!orgId) throw new Error('MCCLUSTER_ORG_ID is required');
  const jobs = await recentJobs({ orgId, sinceHours: 168, limit: 100 });
  const latest = jobs.find((job) => job.job_type === 'host_health' && job.status === 'done' && job.output?.schema_version === SYSTEM_HEALTH_SCHEMA);
  if (!latest) {
    console.log(JSON.stringify({
      schema_version: SYSTEM_HEALTH_SCHEMA,
      overall: 'unknown',
      stale: true,
      error: 'no canonical system-health snapshot found; run npm run health:seed and let Core execute the host_health job'
    }, null, 2));
    process.exitCode = 2;
    return;
  }
  const checkedAt = latest.output?.checked_at || latest.updated_at;
  const ageMs = checkedAt && Number.isFinite(Date.parse(checkedAt)) ? Math.max(0, Date.now() - Date.parse(checkedAt)) : null;
  console.log(JSON.stringify({
    ...latest.output,
    snapshot: {
      job_id: latest.id,
      updated_at: latest.updated_at,
      age_ms: ageMs,
      stale: ageMs === null || ageMs > 10 * 60_000
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ schema_version: SYSTEM_HEALTH_SCHEMA, overall: 'unknown', error: error.message }));
  process.exitCode = 1;
});
