/* Every 20 minutes: queue the MNET character cast (executors/character-post.mjs).

   Off unless MCCLUSTER_CHARACTER_POSTS=live (and the pending migration
   supabase/pending/mnet_character_cast_v1.sql is applied, with the owner's OK).
   Budget: MCCLUSTER_CHARACTER_POSTS_TICK_BUDGET characters per tick (default 8,
   i.e. 2 batches of 4, one inference each), most overdue first
   (characters/posting-plan.mjs). Nothing is queued while an earlier
   character_post job is still queued or running, so a busy box never piles up. */
import { rest, resolveHouseOrgId, enqueueJob, hasPendingJob } from './supabase.mjs';
import { loadCast, postingRoster } from './characters/cast.mjs';
import { dueCharacters, chunk } from './characters/posting-plan.mjs';
import { BATCH, JOB_TYPE, postingMode } from './executors/character-post.mjs';

const TICK_MS = 20 * 60_000;

async function main() {
  const mode = postingMode();
  if (mode !== 'live') { console.log(JSON.stringify({ event: 'character_posts_seed_skipped', mode, note: mode === 'dry-run' ? 'run src/character-posts-dry-run.mjs' : 'flag off' })); return; }
  const orgId = await resolveHouseOrgId();
  if (await hasPendingJob({ orgId, jobType: JOB_TYPE })) { console.log(JSON.stringify({ event: 'character_posts_seed_busy' })); return; }
  const budget = Math.max(0, Math.min(40, Number(process.env.MCCLUSTER_CHARACTER_POSTS_TICK_BUDGET || 8)));
  const now = new Date();
  const since = encodeURIComponent(new Date(now.getTime() - 2 * 86_400_000).toISOString());
  const { body: rows = [] } = await rest(`ops_character_publications?created_at=gte.${since}&select=character_id,created_at&limit=5000`);
  const history = {};
  for (const row of rows) (history[row.character_id] ||= []).push({ at: Date.parse(row.created_at) });
  const due = dueCharacters(postingRoster(loadCast()), history, now, { budget });
  const batches = chunk(due.map(c => c.id), BATCH);
  for (let i = 0; i < batches.length; i += 1) {
    const runAfter = new Date(now.getTime() + Math.floor((TICK_MS * i) / Math.max(1, batches.length))).toISOString();
    await enqueueJob({ orgId, jobType: JOB_TYPE, targetType: 'mnet_cast', targetId: 'mnet-cast', priority: 4, maxAttempts: 2, runAfter, input: { characters: batches[i], seeded_by: 'mccluster-core-character-posts.timer' } });
  }
  console.log(JSON.stringify({ event: 'character_posts_seeded', budget, due: due.length, jobs: batches.length }));
}
main().catch(error => { console.error(JSON.stringify({ event: 'character_posts_seed_failed', message: error.message })); process.exitCode = 1; });
