import { addSignal, resolveHouseOrgId } from './supabase.mjs';
import { readDigestJobs, summarizeDigest } from './digest-report.mjs';
import { sendSms } from './notifier.mjs';

const ORG_ID = process.env.MCCLUSTER_ORG_ID || '';
const HOURS = Number(process.env.MCCLUSTER_DIGEST_HOURS || 24);

export async function buildDigest({ orgId = ORG_ID, hours = HOURS, now = new Date(), read, resolveOrg = resolveHouseOrgId } = {}) {
  const resolvedOrgId = orgId || await resolveOrg();
  const { jobs, coverage } = await readDigestJobs({ orgId: resolvedOrgId, hours, now, read });
  return { ...summarizeDigest(jobs, coverage), org_id: resolvedOrgId };
}

async function main() {
  const digest = await buildDigest();

  /* RECORD FIRST, THEN TRY TO DELIVER.
     Delivery is the part that is allowed to be missing — Twilio is not
     configured here, so sendSms() returns twilio_not_configured and always
     will until somebody sets it up. The REPORT is not allowed to be missing.
     Writing it before the send means a morning with no text still leaves a
     morning with a report, which is the whole point of thinking overnight. */
  const orgId = digest.org_id;
  let recorded = false;
  if (orgId) {
    try {
      await addSignal({
        orgId,
        kind: 'core_morning_digest',
        body: digest.body,
        severity: digest.counts.failed || digest.facts.repo_health.tests_failed || digest.facts.health.failing_observations || !digest.coverage.complete ? 'warn' : 'info',
        metadata: { counts: digest.counts, jobs: digest.jobs, window_hours: HOURS, outcomes: digest.outcomes, facts: digest.facts, coverage: digest.coverage, details: digest.details },
      });
      recorded = true;
    } catch (error) {
      console.error(JSON.stringify({ event: 'core_digest_record_failed', message: error.message }));
    }
  }

  const sms = await sendSms(digest.body.slice(0, 1450));
  console.log(JSON.stringify({ event: 'core_digest', ...digest, recorded, org_id: orgId || null, sms }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'core_digest_failed', message: error.message }));
    process.exitCode = 1;
  });
}
