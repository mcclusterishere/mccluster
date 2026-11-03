/* Every 15 minutes: queue one world_news_pairing job (executors/world-news-pairing.mjs)
   unless one is already queued or running, so a busy box never piles them up.
   The job finds its own cursor (the last finished job's output). Priority 4
   sits just below the PRIM3 news desk (5). */
import { rest, resolveHouseOrgId, enqueueJob, hasPendingJob } from './supabase.mjs';
import { JOB_TYPE } from './executors/world-news-pairing.mjs';

async function main() {
  const orgId = await resolveHouseOrgId();
  let queued = false;
  if (!(await hasPendingJob({ orgId, jobType: JOB_TYPE }))) {
    await enqueueJob({ orgId, jobType: JOB_TYPE, targetType: 'world', targetId: 'news-pairs', priority: 4, maxAttempts: 2, input: { seeded_by: 'mccluster-core-world-news-pairing.timer' } });
    queued = true;
  }
  // Keep a week, like the news itself. Best effort: a failed prune never blocks seeding.
  await rest('rpc/world_news_pairs_prune', { method: 'POST', body: '{}' }).catch(() => null);
  console.log(JSON.stringify({ event: 'world_news_pairing_seeded', queued }));
}
main().catch((error) => { console.error(JSON.stringify({ event: 'world_news_pairing_seed_failed', message: error.message })); process.exitCode = 1; });
