import { rest, resolveHouseOrgId } from '../supabase.mjs';
import { JOB_TYPE, TARGET_ID, observeOpportunities } from '../student-opportunities.mjs';

export function opportunityEnabled(env = process.env) {
  return env.MCCLUSTER_STUDENT_OPPORTUNITY_DISCOVERY === 'true';
}

export async function studentOpportunitySnapshot(job, lease = {}, {
  env = process.env, house = resolveHouseOrgId, query = rest, fetchImpl = fetch, now = new Date(),
} = {}) {
  if (!opportunityEnabled(env)) throw new Error('opportunity_discovery_disabled');
  if (job?.job_type !== JOB_TYPE || job.target_id !== TARGET_ID || job.target_type !== 'public_opportunity_feed') {
    throw new Error('opportunity_discovery_target_invalid');
  }
  const orgId = await house();
  if (job.org_id !== orgId) throw new Error('opportunity_discovery_outside_house');
  const filter = new URLSearchParams({ org_id: `eq.${orgId}`, job_type: `eq.${JOB_TYPE}`, target_id: `eq.${TARGET_ID}`,
    status: 'eq.done', order: 'updated_at.desc', select: 'output', limit: '1' });
  const { body } = await query(`ops_agent_jobs?${filter}`, { signal: lease.signal });
  const prior = Array.isArray(body) ? body[0]?.output?.known : null;
  return observeOpportunities({ fetchImpl, now, prior, signal: lease.signal });
}
