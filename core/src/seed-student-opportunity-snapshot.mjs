import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { enqueueJob, hasPendingJob, resolveHouseOrgId } from './supabase.mjs';
import { JOB_TYPE, TARGET_ID } from './student-opportunities.mjs';
import { opportunityEnabled } from './executors/student-opportunity-snapshot.mjs';

// Org, job type, and UTC day define the one allowed job ID. This is not a secret.
export function dailyJobId(orgId, utcDay) {
  const hash = createHash('sha256').update(`${orgId}/${JOB_TYPE}/${utcDay}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function seedStudentOpportunitySnapshot({ env = process.env, now = new Date(), house = resolveHouseOrgId,
  pending = hasPendingJob, queue = enqueueJob } = {}) {
  if (!opportunityEnabled(env)) return { state: 'disabled' };
  const orgId = await house();
  if (await pending({ orgId, jobType: JOB_TYPE, targetId: TARGET_ID })) return { state: 'already_pending' };
  const date = now.toISOString();
  const job = await queue({ jobId: dailyJobId(orgId, date.slice(0, 10)), orgId, jobType: JOB_TYPE, targetType: 'public_opportunity_feed',
    targetId: TARGET_ID, priority: 5, maxAttempts: 1, runAfter: date, input: { origin: 'owner_enabled_timer', utc_day: date.slice(0, 10) } });
  return { state: 'recorded', job_id: job.id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedStudentOpportunitySnapshot().then((result) => console.log(JSON.stringify({ event: 'student_opportunity_seed', ...result })))
    .catch(() => { console.error(JSON.stringify({ event: 'student_opportunity_seed_failed' })); process.exitCode = 1; });
}
