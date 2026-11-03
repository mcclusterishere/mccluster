/* Fair share of one tick's news-desk budget across the 24 agents.
   Water-filling: small feeds are covered completely; whatever they do not use
   goes to the busiest countries (the United Kingdom and India carry ~2,500 and
   ~1,800 stories a day against ~30 in Ethiopia). Returns stories per agent. */
export function fairShare(backlogs, budget) {
  const entries = Object.entries(backlogs).map(([key, value]) => [key, Math.max(0, Math.trunc(Number(value) || 0))]).sort((a, b) => a[1] - b[1]);
  const out = Object.fromEntries(entries.map(([key]) => [key, 0]));
  let left = Math.max(0, Math.trunc(Number(budget) || 0));
  let remaining = entries.length;
  for (const [key, need] of entries) {
    const share = Math.floor(left / remaining);
    const give = Math.min(need, share);
    out[key] = give; left -= give; remaining -= 1;
  }
  // Integer remainders go to the largest backlogs still unmet.
  for (const [key, need] of [...entries].reverse()) { if (left <= 0) break; const extra = Math.min(left, need - out[key]); out[key] += extra; left -= extra; }
  return out;
}
