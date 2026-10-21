import { hostHealth as collectHostHealth } from './host-health-collect.mjs';
import { rest } from '../supabase.mjs';
import { enrichHostHealth } from '../health-details.mjs';
import { finalizeRuntimeHealth } from '../health-verification.mjs';
export { haloSnapshotFreshness } from './host-health-collect.mjs';

export async function hostHealth(job = {}) {
  const snapshot = await collectHostHealth(job);
  return finalizeRuntimeHealth(await enrichHostHealth(snapshot, {rest, orgId: job.org_id || process.env.MCCLUSTER_ORG_ID || null}));
}
