/* Every 10 minutes WHEN ENABLED: queue one weather_region_snapshot job for the
   Connecticut pilot (executors/weather-region-snapshot.mjs), unless one is
   already queued or running.

   Off by default, twice over: mccluster-core-weather.timer is installed but not
   enabled by scripts/deploy-ovh-core.sh, and this seed queues nothing unless
   WEATHER_INGEST_ENABLED=true is in /etc/mccluster/core.env.

   Retention: the snapshot lives in the job output, so finished snapshot jobs
   older than WEATHER_SNAPSHOT_KEEP_HOURS (default 48, minimum 6) are removed
   here, this job type only. Best effort: a failed prune never blocks seeding. */
import { rest, resolveHouseOrgId, enqueueJob, hasPendingJob } from './supabase.mjs';
import { JOB_TYPE } from './executors/weather-region-snapshot.mjs';
import { REGION_ID } from './weather/region.mjs';

export function ingestEnabled(env = process.env) {
  return String(env.WEATHER_INGEST_ENABLED || '').trim().toLowerCase() === 'true';
}
export function keepHours(env = process.env) {
  const n = Math.trunc(Number(env.WEATHER_SNAPSHOT_KEEP_HOURS || 48));
  return Number.isFinite(n) ? Math.max(6, Math.min(24 * 30, n)) : 48;
}

async function main() {
  if (!ingestEnabled()) {
    console.log(JSON.stringify({ event: 'weather_snapshot_seed_skipped', reason: 'WEATHER_INGEST_ENABLED is not true' }));
    return;
  }
  const orgId = await resolveHouseOrgId();
  let queued = false;
  if (!(await hasPendingJob({ orgId, jobType: JOB_TYPE, targetId: REGION_ID }))) {
    await enqueueJob({ orgId, jobType: JOB_TYPE, targetType: 'weather_region', targetId: REGION_ID, priority: 6, maxAttempts: 1, input: { seeded_by: 'mccluster-core-weather.timer' } });
    queued = true;
  }
  const cutoff = new Date(Date.now() - keepHours() * 3_600_000).toISOString();
  await rest(`ops_agent_jobs?org_id=eq.${orgId}&job_type=eq.${JOB_TYPE}&status=eq.done&updated_at=lt.${encodeURIComponent(cutoff)}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } }).catch(() => null);
  console.log(JSON.stringify({ event: 'weather_snapshot_seeded', queued }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(JSON.stringify({ event: 'weather_snapshot_seed_failed', message: error.message })); process.exitCode = 1; });
}
