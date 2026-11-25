import { runEntityMatchScan } from '../entity-resolution/scan.mjs';

// Scheduled or queued duplicate-record scan. Runs in the name of the owner who
// queued it (the database re-checks that they are an owner of the house).
export async function entityMatchScan(job, { rpc } = {}) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const result = await runEntityMatchScan({
    orgId: job?.org_id,
    actorUserId: input.actor_user_id,
    args: { type_keys: input.type_keys, max_objects: input.max_objects, auto_threshold: input.auto_threshold, review_threshold: input.review_threshold },
    trigger: input.trigger === 'routine' ? 'routine' : 'job',
    ...(rpc ? { rpc } : {}),
  });
  return {
    executor: 'entity_match_scan:v1',
    summary: `Entity resolution scanned ${result.objects_scanned} objects: ${result.auto_linked} linked automatically, ${result.queued_for_review} sent for owner review`,
    ...result,
  };
}
