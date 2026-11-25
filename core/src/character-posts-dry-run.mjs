/* DRY RUN: the whole character-posting loop, writing to a local file instead of MNET.

   Same cast, planner, prompt, model call and validator as the live executor;
   no database writes, no jobs. History (cadence and who already replied to
   what) comes from the output file itself, so repeated runs behave like
   repeated ticks.

     node src/character-posts-dry-run.mjs --news news.json [--out file.jsonl]
       [--ticks 3] [--tick-minutes 20] [--budget 8] [--now ISO]
       [--replay responses.json]    # canned model responses, for tests and demos
       [--news supabase]            # read recent headlines (read-only GET)

   --news file: a JSON array of { id, title, canonical_url, published_at,
   location_country_fips }. Without --replay it calls the box's local model
   through the loopback adapter, exactly like the live executor. */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCast, postingRoster, minorNames } from './characters/cast.mjs';
import { dueCharacters, chooseStimulus, chunk, seeded } from './characters/posting-plan.mjs';
import { runCharacterBatch, BATCH } from './executors/character-post.mjs';
import { isNewsCandidate } from './executors/actor-news-comment.mjs';

export function readHistory(file) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const history = {}, posts = [], done = {};
  for (const row of lines) {
    (history[row.character_id] ||= []).push({ at: Date.parse(row.at) });
    const d = (done[row.character_id] ||= { news: new Set(), replies: new Set() });
    if (row.article_id) d.news.add(row.article_id);
    if (row.reply_to_id) d.replies.add(row.reply_to_id);
    if (row.kind !== 'reply') posts.push({ id: row.id, body: row.text, at: Date.parse(row.at), character_id: row.character_id, kind: row.kind, universe: row.universe });
  }
  return { history, posts, done };
}

export function replayChat(responses) {
  let i = 0;
  return async () => {
    const content = responses[i++];
    if (content === undefined) throw new Error('replay: out of canned responses');
    return { model: 'replay', message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, usage: {} };
  };
}

/* One or more ticks. Returns the rows written. */
export async function dryRun({ out, news = [], ticks = 1, tickMinutes = 20, budget = 8, now = new Date(), chat, cast = loadCast(), log = () => {} }) {
  mkdirSync(dirname(out), { recursive: true });
  const roster = postingRoster(cast);
  const minors = minorNames();
  const written = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const at = new Date(now.getTime() + tick * tickMinutes * 60_000);
    const { history, posts, done } = readHistory(out);
    const due = dueCharacters(roster, history, at, { budget });
    const taken = new Map();
    for (const group of chunk(due, BATCH)) {
      const entries = group.map(c => ({ character: c, stimulus: chooseStimulus(c, { posts, news, done: done[c.id] || { news: new Set(), replies: new Set() }, now: at, taken, rand: seeded(`${at.toISOString()}:${c.id}`) }) }));
      const { results, run } = await runCharacterBatch(entries, { chat, cast, minors, metadata: { dry_run: true } });
      log({ event: 'batch', at: at.toISOString(), characters: group.map(c => c.id), wall_ms: run.wall_ms, usage: run.usage, kept: results.filter(r => r.ok).length });
      for (const r of results) {
        if (!r.ok) { log({ event: 'withheld', character_id: r.character.id, reason: r.reason }); continue; }
        const row = {
          dry_run: true, id: `dry-${at.getTime()}-${r.character.id}`, at: at.toISOString(), character_id: r.character.id, actor_key: r.character.mnet.actorKey,
          name: r.character.name, universe: r.character.universe, kind: r.stimulus.kind, text: r.text,
          ...(r.stimulus.kind === 'news' ? { article_id: r.stimulus.article.id, headline: r.stimulus.article.title } : {}),
          ...(r.stimulus.kind === 'reply' ? { reply_to_id: r.stimulus.post.id, reply_to_character: r.stimulus.post.character_id } : {}),
          ...(r.stimulus.kind === 'doing' ? { topic: r.stimulus.topic } : {}),
        };
        appendFileSync(out, JSON.stringify(row) + '\n');
        written.push(row);
      }
    }
  }
  return written;
}

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; }

async function main() {
  const out = arg('out', process.env.MCCLUSTER_CHARACTER_POSTS_DRY_RUN_FILE || '/var/lib/mccluster-core/character-posts.dry-run.jsonl');
  const newsArg = arg('news', null);
  let news = [];
  if (newsArg === 'supabase') {
    const { rest } = await import('./supabase.mjs');
    const since = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
    const fips = [...new Set(postingRoster().map(c => c.mnet.newsLens.fips))];
    for (const f of fips) { const { body = [] } = await rest(`media_news_articles?location_country_fips=eq.${f}&published_at=gte.${since}&select=id,title,canonical_url,published_at,location_country_fips&order=published_at.desc&limit=40`); news.push(...body); }
  } else if (newsArg) news = JSON.parse(readFileSync(newsArg, 'utf8'));
  news = news.filter(isNewsCandidate);
  const replay = arg('replay', null);
  let chat;
  if (replay) chat = replayChat(JSON.parse(readFileSync(replay, 'utf8')).responses);
  else chat = (await import('./compute/local-ai-client.mjs')).localAiChat;
  const rows = await dryRun({
    out, news, chat, ticks: Number(arg('ticks', 1)), tickMinutes: Number(arg('tick-minutes', 20)), budget: Number(arg('budget', 8)),
    now: arg('now', null) ? new Date(arg('now')) : new Date(), log: line => console.log(JSON.stringify(line)),
  });
  console.log(JSON.stringify({ event: 'dry_run_done', out, written: rows.length }));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(JSON.stringify({ event: 'dry_run_failed', message: error.message })); process.exitCode = 1; });
