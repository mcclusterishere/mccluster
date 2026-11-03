/* One tick's news-desk plan: whole batches, oldest-waiting country first.

   Each inference reads a fixed prompt prefix, so a batch of 8 headlines costs
   little more than a batch of 2. The tick budget is therefore spent in whole
   batches: agents are ordered by how long their oldest unanswered headline has
   waited (ties: bigger backlog first) and served one batch each in that order,
   wrapping around while batches remain. Every country with news is reached
   within ceil(24 / batches) ticks; busy countries take the extra laps.

   agents: [{ key, backlog, oldestWaitingMs }] -> { [key]: [limit, limit, ...] } */
export function planBatches(agents, budgetStories, batch) {
  const size = Math.max(1, Math.trunc(batch) || 1);
  let batches = Math.max(0, Math.floor((Math.trunc(Number(budgetStories)) || 0) / size));
  const queue = agents
    .map(a => ({ key: a.key, left: Math.max(0, Math.trunc(Number(a.backlog)) || 0), wait: Number(a.oldestWaitingMs) || 0 }))
    .filter(a => a.left > 0)
    .sort((a, b) => b.wait - a.wait || b.left - a.left || (a.key < b.key ? -1 : 1));
  const plan = Object.fromEntries(agents.map(a => [a.key, []]));
  while (batches > 0 && queue.some(a => a.left > 0)) {
    for (const a of queue) {
      if (batches <= 0) break;
      if (a.left <= 0) continue;
      const take = Math.min(size, a.left);
      plan[a.key].push(take); a.left -= take; batches -= 1;
    }
  }
  return plan;
}
