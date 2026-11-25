/* Every 15 minutes: queue the PRIM3 news desk (executors/prim3-agent-news.mjs).
   Budget: PRIM3_NEWS_DESK_TICK_BUDGET headlines per tick (default 128, spent in
   whole batches of 8, oldest-waiting country first: prim3/news-desk-plan.mjs).
   An agent that still has queued work is skipped, so a saturated box never
   piles up jobs. An agent with no batch this tick still gets a brief-only job
   when its brief is due. */
import { rest, resolveHouseOrgId, enqueueJob, hasPendingJob } from './supabase.mjs';
import { PRIM3_AGENTS } from './prim3/agents.mjs';
import { planBatches } from './prim3/news-desk-plan.mjs';
import { BATCH, BRIEF_EVERY_HOURS } from './executors/prim3-agent-news.mjs';

const TICK_MS = 15 * 60_000;

async function main() {
  const orgId = await resolveHouseOrgId();
  const budget = Math.max(0, Math.min(800, Number(process.env.PRIM3_NEWS_DESK_TICK_BUDGET || 128)));
  const now = Date.now();
  const since = encodeURIComponent(new Date(now - 86_400_000).toISOString());
  const agents = [];
  for (const agent of PRIM3_AGENTS) {
    if (await hasPendingJob({ orgId, jobType: 'prim3_agent_news', targetId: agent.key })) continue;
    const { body: articles = [] } = await rest(`media_news_articles?location_country_fips=eq.${agent.fips}&published_at=gte.${since}&select=id,published_at&order=published_at.desc&limit=400`);
    const { body: done = [] } = await rest(`prim3_agent_news_comments?agent_key=eq.${agent.key}&created_at=gte.${since}&select=article_id&limit=2000`);
    const { body: brief = [] } = await rest(`prim3_agent_news_briefs?agent_key=eq.${agent.key}&select=created_at&order=created_at.desc&limit=1`);
    const doneIds = new Set(done.map(row => row.article_id));
    const waiting = articles.filter(row => !doneIds.has(row.id));
    const oldest = waiting.length ? Date.parse(waiting[waiting.length - 1].published_at) : now;
    const briefDue = articles.length > 0 && (!brief.length || now - Date.parse(brief[0].created_at) >= BRIEF_EVERY_HOURS * 3_600_000);
    agents.push({ agent, key: agent.key, backlog: waiting.length, oldestWaitingMs: now - oldest, briefDue });
  }
  const plan = planBatches(agents, budget, BATCH);
  let queued = 0;
  const all = Object.values(plan).reduce((n, list) => n + list.length, 0);
  let slot = 0;
  for (const entry of agents) {
    const limits = plan[entry.key].length ? plan[entry.key] : (entry.briefDue ? [0] : []);
    for (let index = 0; index < limits.length; index += 1) {
      // Spread the batches across the tick so the owner's own work slots in between.
      const runAfter = new Date(now + Math.floor((TICK_MS * (limits[index] ? slot++ : 0)) / Math.max(1, all))).toISOString();
      await enqueueJob({ orgId, jobType: 'prim3_agent_news', targetType: 'prim3_agent', targetId: entry.key, priority: 5, maxAttempts: 2, runAfter, input: { limit: limits[index], brief: index === 0, seeded_by: 'mccluster-core-prim3-news.timer' } });
      queued += 1;
    }
  }
  // Keep a week, like the news itself. Best effort: a failed prune never blocks seeding.
  await rest('rpc/prim3_agent_news_prune', { method: 'POST', body: '{}' }).catch(() => null);
  console.log(JSON.stringify({ event: 'prim3_news_desk_seeded', budget, agents_idle: agents.length, jobs: queued, plan }));
}
main().catch(error => { console.error(JSON.stringify({ event: 'prim3_news_desk_seed_failed', message: error.message })); process.exitCode = 1; });
