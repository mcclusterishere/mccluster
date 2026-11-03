/* Every 15 minutes: queue the PRIM3 news desk (executors/prim3-agent-news.mjs).
   Budget: PRIM3_NEWS_DESK_TICK_BUDGET stories per tick (default 64, ~6,100 a
   day, about half of this box's measured CPU inference time). An agent that
   still has queued work is skipped, so a saturated box never piles up jobs. */
import { rest, resolveHouseOrgId, enqueueJob, hasPendingJob } from './supabase.mjs';
import { PRIM3_AGENTS } from './prim3/agents.mjs';
import { fairShare } from './prim3/news-desk-plan.mjs';
import { BATCH } from './executors/prim3-agent-news.mjs';

const TICK_MS = 15 * 60_000;

async function main() {
  const orgId = await resolveHouseOrgId();
  const budget = Math.max(0, Math.min(400, Number(process.env.PRIM3_NEWS_DESK_TICK_BUDGET || 64)));
  const since = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
  const backlogs = {};
  const idle = [];
  for (const agent of PRIM3_AGENTS) {
    if (await hasPendingJob({ orgId, jobType: 'prim3_agent_news', targetId: agent.key })) continue;
    idle.push(agent);
    const { body: articles = [] } = await rest(`media_news_articles?location_country_fips=eq.${agent.fips}&published_at=gte.${since}&select=id&limit=400`);
    const { body: done = [] } = await rest(`prim3_agent_news_comments?agent_key=eq.${agent.key}&created_at=gte.${since}&select=article_id&limit=2000`);
    const doneIds = new Set(done.map(row => row.article_id));
    backlogs[agent.key] = articles.filter(row => !doneIds.has(row.id)).length;
  }
  const plan = fairShare(backlogs, budget);
  let queued = 0;
  for (const agent of idle) {
    // Every idle agent gets one job, even with nothing new, so its brief stays fresh.
    const jobs = Math.max(1, Math.ceil((plan[agent.key] || 0) / BATCH));
    for (let index = 0; index < jobs; index += 1) {
      const runAfter = new Date(Date.now() + Math.floor((TICK_MS * index) / jobs)).toISOString();
      const limit = Math.min(BATCH, Math.max(0, (plan[agent.key] || 0) - index * BATCH));
      await enqueueJob({ orgId, jobType: 'prim3_agent_news', targetType: 'prim3_agent', targetId: agent.key, priority: 5, maxAttempts: 2, runAfter, input: { limit, brief: index === 0, seeded_by: 'mccluster-core-prim3-news.timer' } });
      queued += 1;
    }
  }
  // Keep a week, like the news itself. Best effort: a failed prune never blocks seeding.
  await rest('rpc/prim3_agent_news_prune', { method: 'POST', body: '{}' }).catch(() => null);
  console.log(JSON.stringify({ event: 'prim3_news_desk_seeded', budget, agents_idle: idle.length, jobs: queued, plan }));
}
main().catch(error => { console.error(JSON.stringify({ event: 'prim3_news_desk_seed_failed', message: error.message })); process.exitCode = 1; });
