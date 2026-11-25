/* Once a day WHEN ENABLED: queue one mentor_outreach_research job for today's New York date, unless one
   already exists for that date. Off twice over, like the weather seed: mccluster-core-mentor-outreach.timer
   is installed but not enabled by scripts/deploy-ovh-core.sh, and this queues nothing unless
   OUTREACH_PIPELINE_ENABLED=true is in /etc/mccluster/core.env. The job only fills a review queue. */
import { rest, resolveHouseOrgId, enqueueJob } from './supabase.mjs';
import { JOB_TYPE } from './executors/mentor-outreach-research.mjs';

export function outreachEnabled(env = process.env) {
  return String(env.OUTREACH_PIPELINE_ENABLED || '').trim().toLowerCase() === 'true';
}
export function nyDate(at = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

async function main() {
  if (!outreachEnabled()) {
    console.log(JSON.stringify({ event: 'mentor_outreach_seed_skipped', reason: 'OUTREACH_PIPELINE_ENABLED is not true' }));
    return;
  }
  const orgId = await resolveHouseOrgId();
  const day = nyDate();
  const target = `outreach:${day}`;
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, job_type: `eq.${JOB_TYPE}`, target_id: `eq.${target}`, select: 'id', limit: '1' });
  const { body: existing = [] } = await rest(`ops_agent_jobs?${params}`);
  if (existing.length) { console.log(JSON.stringify({ event: 'mentor_outreach_seeded', queued: false, reason: 'already queued today', day })); return; }
  await enqueueJob({ orgId, jobType: JOB_TYPE, targetType: 'outreach_day', targetId: target, priority: 30, maxAttempts: 1, input: { seeded_by: 'mccluster-core-mentor-outreach.timer', day } });
  console.log(JSON.stringify({ event: 'mentor_outreach_seeded', queued: true, day }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(JSON.stringify({ event: 'mentor_outreach_seed_failed', message: error.message })); process.exitCode = 1; });
}
