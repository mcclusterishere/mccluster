/* WHO SPEAKS THIS TICK, AND ABOUT WHAT.

   Not everyone every tick (owner, 2026-11-03): each character has its own
   daily cadence (1 to 3 posts, the ops_platform_actors.daily_limit range),
   active hours in its own time zone, and a reply affinity. A character is due
   when it is inside its hours, under its day's count, and has rested for its
   share of the waking day (with a stable per-character jitter so the cast does
   not post in lockstep). The tick budget takes the most overdue first.

   Each due character then gets one stimulus, in this order of preference:
   a reply to another character's recent post (weighted by replyAffinity and by
   who it knows), a headline from its news lens (the same media_news_articles
   the news desk reads), or a post about what it is doing today. "Social media
   for doers": the fallback is always the character's own work, never chatter.

   Everything here is pure and seeded, so planning is testable and replayable. */

export const DAY_MS = 86_400_000;

export function hash32(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/* A deterministic 0..1 stream for one seed (mulberry32). */
export function seeded(seed) {
  let a = hash32(seed);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function localClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) + Number(parts.minute) / 60 };
}

/* history: { [characterId]: [{ at: ms }] } (its recent posts, any order). */
export function dueCharacters(characters, history, now = new Date(), { budget = 8 } = {}) {
  const t = now.getTime();
  const due = [];
  for (const c of characters) {
    if (c.mnet.posting !== 'eligible') continue;
    const cad = c.mnet.cadence;
    const clock = localClock(now, cad.timezone);
    const [start, end] = cad.activeHoursLocal;
    if (clock.hour < start || clock.hour >= end) continue;
    const posts = (history[c.id] || []).map(p => Number(p.at)).filter(Number.isFinite);
    const today = posts.filter(at => localClock(new Date(at), cad.timezone).date === clock.date).length;
    if (today >= cad.postsPerDay) continue;
    if (posts.some(at => t - at < 0)) continue;
    const gapMs = ((end - start) / cad.postsPerDay) * 3_600_000;
    const jitter = 0.75 + 0.5 * seeded(`${c.id}:${clock.date}:${today}`)(); // 0.75..1.25 of the gap
    const last = posts.length ? Math.max(...posts) : -Infinity;
    const rested = t - last;
    // The first post of the day waits for a jittered slice of the morning too.
    const firstDelay = (clock.hour - start) * 3_600_000 >= gapMs * (jitter - 0.75);
    if (rested < gapMs * jitter || (!today && !firstDelay)) continue;
    due.push({ character: c, score: Number.isFinite(rested) ? rested / gapMs : 99 + seeded(c.id)() });
  }
  due.sort((a, b) => b.score - a.score || (a.character.id < b.character.id ? -1 : 1));
  return due.slice(0, Math.max(0, Math.trunc(budget))).map(d => d.character);
}

const words = text => new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);

export function newsScore(character, article) {
  const title = String(article.title || '').toLowerCase();
  let score = 0;
  for (const k of character.mnet.newsLens.keywords || []) if (title.includes(String(k).toLowerCase())) score += 2;
  for (const w of words((character.psych.postsAbout || []).join(' '))) if (w.length > 4 && title.includes(w)) score += 0.5;
  return score;
}

/* posts: recent public character posts [{ id, character_id, body, at }]
   news: [{ id, title, location_country_fips, published_at }]
   done: { news: Set<article_id>, replies: Set<post_id> } for this character.
   taken: Map<id, count> of headlines and posts already picked this tick, so one
   tick spreads across stories instead of piling onto the top one (it is updated). */
export function chooseStimulus(character, { posts = [], news = [], done = { news: new Set(), replies: new Set() }, rand = Math.random, now = new Date(), taken = new Map() } = {}) {
  const pick = (id, value) => { taken.set(id, (taken.get(id) || 0) + 1); return value; };
  const knows = new Set((character.psych.relationships || []).map(r => r.id));
  const replyable = posts.filter(p => p.character_id !== character.id && !done.replies.has(p.id) && now.getTime() - Number(p.at) < 12 * 3_600_000 && p.kind !== 'reply');
  if (replyable.length && rand() < character.mnet.cadence.replyAffinity) {
    const ranked = replyable.map(p => ({ p, w: (knows.has(p.character_id) ? 3 : 0) + (p.universe === character.universe ? 1 : 0) + rand() - 1.5 * (taken.get(p.id) || 0) }))
      .sort((a, b) => b.w - a.w);
    if (ranked[0].w >= 1) return pick(ranked[0].p.id, { kind: 'reply', post: ranked[0].p });
  }
  const lens = character.mnet.newsLens;
  const fresh = news.filter(a => a.location_country_fips === lens.fips && !done.news.has(a.id));
  if (fresh.length && rand() < (character.universe === 'prim3' ? 0.85 : 0.55)) {
    const ranked = fresh.map((a, i) => ({ a, s: newsScore(character, a) - i * 0.02 + rand() * 0.5 - 2 * (taken.get(a.id) || 0) })).sort((x, y) => y.s - x.s);
    return pick(ranked[0].a.id, { kind: 'news', article: ranked[0].a });
  }
  const topics = character.psych.postsAbout;
  return { kind: 'doing', topic: topics[Math.floor(rand() * topics.length)] };
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
