import { addSignal, houseOrgId, recentJobs } from './supabase.mjs';
import { sendSms } from './notifier.mjs';

const ORG_ID = process.env.MCCLUSTER_ORG_ID || '';
const HOURS = Number(process.env.MCCLUSTER_DIGEST_HOURS || 12);

function short(value, max = 220) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function describe(job) {
  const target = [job.target_type, job.target_id].filter(Boolean).join(':');
  if (job.status === 'done') {
    const summary = job.output?.summary || job.output?.analysis?.summary || job.output?.repo || 'completed';
    return `✓ ${job.job_type}${target ? ` (${target})` : ''}: ${short(summary, 180)}`;
  }
  if (job.status === 'failed') return `✗ ${job.job_type}${target ? ` (${target})` : ''}: ${short(job.last_error, 180)}`;
  if (job.status === 'running') return `→ ${job.job_type}${target ? ` (${target})` : ''} is still running`;
  return `· ${job.job_type}${target ? ` (${target})` : ''} ${job.status}`;
}

export async function buildDigest() {
  const jobs = await recentJobs({ orgId: ORG_ID || undefined, sinceHours: HOURS, limit: 40 });
  const counts = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  const headline = `McCluster Core ${HOURS}h: ${counts.done || 0} done, ${counts.failed || 0} failed, ${counts.running || 0} running, ${counts.queued || 0} queued.`;
  const interesting = jobs.filter((job) => ['done', 'failed', 'running'].includes(job.status)).slice(0, 6);
  const body = [headline, ...interesting.map(describe)].join('\n').slice(0, 1450);
  return { body, counts, jobs: jobs.length };
}

async function main() {
  const digest = await buildDigest();

  /* RECORD FIRST, THEN TRY TO DELIVER.
     Delivery is the part that is allowed to be missing — Twilio is not
     configured here, so sendSms() returns twilio_not_configured and always
     will until somebody sets it up. The REPORT is not allowed to be missing.
     Writing it before the send means a morning with no text still leaves a
     morning with a report, which is the whole point of thinking overnight. */
  const orgId = ORG_ID || (await houseOrgId());
  let recorded = false;
  if (orgId) {
    try {
      await addSignal({
        orgId,
        kind: 'core_morning_digest',
        body: digest.body,
        severity: digest.counts.failed ? 'warn' : 'info',
        metadata: { counts: digest.counts, jobs: digest.jobs, window_hours: HOURS },
      });
      recorded = true;
    } catch (error) {
      console.error(JSON.stringify({ event: 'core_digest_record_failed', message: error.message }));
    }
  }

  const sms = await sendSms(digest.body);
  console.log(JSON.stringify({ event: 'core_digest', ...digest, recorded, org_id: orgId || null, sms }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'core_digest_failed', message: error.message }));
    process.exitCode = 1;
  });
}
