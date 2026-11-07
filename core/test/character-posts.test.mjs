import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCast, characterById, postingRoster } from '../src/characters/cast.mjs';
import { checkPost, copiesFrom } from '../src/characters/post-safety.mjs';
import { dueCharacters, chooseStimulus, localClock, seeded } from '../src/characters/posting-plan.mjs';
import { characterPost, runCharacterBatch, postingMode, POST_SCHEMA, POST_SYSTEM, BATCH } from '../src/executors/character-post.mjs';
import { DESK_MODEL } from '../src/executors/prim3-agent-news.mjs';
import { buildCompletionEvidence } from '../src/completion-evidence.mjs';
import { dryRun, readHistory, replayChat } from '../src/character-posts-dry-run.mjs';

const cast = loadCast();
const roster = postingRoster(cast);
const ET_AFTERNOON = new Date('2026-11-03T20:00:00Z'); // 15:00 in Bridgeport

test('safety: satire and profanity pass; slurs, threats, links, human claims, real advice and minors do not', () => {
  assert.equal(checkPost('Made a new blend today. If you hate it, I make you another. That is the guarantee, damn it.').ok, true);
  assert.equal(checkPost('We guarantee you will like it, or else fuck you. Lin delivered it perfectly again.').ok, true);
  const bad = {
    slur: 'Those people are all f4ggots and everyone knows it.',
    threat: 'Say that again and I will find you at the counter.',
    link_or_mention: 'Check this out www.example.com right now please.',
    claims_to_be_human: 'Honestly? I am a real person, not some bot, I promise.',
    real_advice: 'You should buy this coin now before the candle moves.',
    model_talk: 'As an AI I cannot really drink tea, but the blend sounds nice.',
    mentions_minor: 'Saw Imani at the debate table again this afternoon.',
  };
  for (const [reason, text] of Object.entries(bad)) assert.equal(checkPost(text).reason ?? checkPost(text, { minors: ['Imani'] }).reason, reason, text);
  assert.equal(checkPost('Saw Imani at the debate table again this afternoon.', { minors: ['Imani'] }).reason, 'mentions_minor');
  assert.equal(checkPost('The 529 Boyz rolled through again.').reason, 'mentions_minor');
  assert.equal(checkPost('Take 200 mg and call me in the morning, folks.').reason, 'real_advice');
  assert.equal(checkPost('One. Two. Three. Four. Five sentences is too many.').reason, 'too_many_sentences');
  assert.equal(checkPost('x'.repeat(500)).reason, 'too_long');
  assert.equal(checkPost('ok').reason, 'too_short');
  assert.equal(checkPost('"Made a new blend today, and it is good."').body, 'Made a new blend today, and it is good.');
  assert.equal(checkPost('Filed under "reported, not repaired."').body, 'Filed under "reported, not repaired."', 'inner quotes survive');
});

test('cadence: not everyone every tick; hours, daily caps and the budget hold', () => {
  const night = dueCharacters(roster, {}, new Date('2026-11-03T07:30:00Z'), { budget: 200 }); // 02:30 in Bridgeport
  assert.ok(night.every(c => c.universe === 'prim3'), 'city characters sleep at night; agents keep their own clocks');
  const day = dueCharacters(roster, {}, ET_AFTERNOON, { budget: 200 });
  assert.ok(day.length > 20 && day.length < roster.length, 'a fresh afternoon still is not everyone at once');
  assert.equal(dueCharacters(roster, {}, ET_AFTERNOON, { budget: 8 }).length, 8);
  const mara = characterById('mara-costa');
  const capped = { 'mara-costa': [1, 2].map(h => ({ at: ET_AFTERNOON.getTime() - h * 3_600_000 })) };
  assert.equal(mara.mnet.cadence.postsPerDay, 2);
  assert.ok(!dueCharacters([mara], capped, ET_AFTERNOON).length, 'two posts today is her cap');
  assert.ok(!dueCharacters([mara], { 'mara-costa': [{ at: ET_AFTERNOON.getTime() - 20 * 60_000 }] }, ET_AFTERNOON).length, 'rests between posts');
  assert.ok(dueCharacters([mara], { 'mara-costa': [{ at: ET_AFTERNOON.getTime() - 9 * 3_600_000 }] }, ET_AFTERNOON).length, 'due again after her share of the day');
  assert.ok(!dueCharacters([characterById('majid')], {}, ET_AFTERNOON).length, 'held characters never post');
  assert.equal(localClock(ET_AFTERNOON, 'America/New_York').hour, 15);
});

test('stimulus: replies to people it knows, its own country\'s news, otherwise its own work', () => {
  const eli = characterById('eli-mensah');
  const posts = [
    { id: 'p1', character_id: 'mara-costa', body: 'New blend today.', at: ET_AFTERNOON.getTime() - 3_600_000, kind: 'doing', universe: 'mccluster-city' },
    { id: 'p2', character_id: 'eli-mensah', body: 'My own post.', at: ET_AFTERNOON.getTime() - 3_600_000, kind: 'doing', universe: 'mccluster-city' },
  ];
  const reply = chooseStimulus(eli, { posts, now: ET_AFTERNOON, rand: () => 0 });
  assert.equal(reply.kind, 'reply'); assert.equal(reply.post.id, 'p1');
  assert.notEqual(chooseStimulus(eli, { posts: [posts[1]], now: ET_AFTERNOON, rand: () => 0 }).kind, 'reply', 'never replies to itself');
  const done = { news: new Set(), replies: new Set(['p1']) };
  assert.notEqual(chooseStimulus(eli, { posts, done, now: ET_AFTERNOON, rand: () => 0 }).kind, 'reply', 'one reply per post');

  const aya = characterById('prim3-aya-shinoda');
  const news = [
    { id: 'us1', title: 'City council approves new rail line downtown', location_country_fips: 'US' },
    { id: 'ja1', title: 'Tokyo rail operator tests a new robot inspection system', location_country_fips: 'JA' },
  ];
  const n = chooseStimulus(aya, { news, now: ET_AFTERNOON, rand: () => 0.1 });
  assert.equal(n.kind, 'news'); assert.equal(n.article.id, 'ja1', 'agents read their own country (GDELT FIPS JA)');
  const doing = chooseStimulus(aya, { now: ET_AFTERNOON, rand: seeded('x') });
  assert.equal(doing.kind, 'doing'); assert.ok(aya.psych.postsAbout.includes(doing.topic));
});

test('the flag is off by default and an off job is a bounded no-op', async () => {
  assert.equal(postingMode({}), 'off');
  assert.equal(postingMode({ MCCLUSTER_CHARACTER_POSTS: 'LIVE' }), 'live');
  assert.equal(postingMode({ MCCLUSTER_CHARACTER_POSTS: 'yes' }), 'off');
  const job = { id: 'j0', org_id: 'house', job_type: 'character_post', target_id: 'mnet-cast', input: { characters: ['mara-costa'] } };
  const out = await characterPost(job, { mode: 'off', query: async () => { throw new Error('no db in off mode'); }, chat: async () => { throw new Error('no model in off mode'); } });
  assert.equal(out.reason, 'flag_off'); assert.equal(out.published, 0);
  assert.doesNotThrow(() => buildCompletionEvidence(job, out));
});

function liveFixture(reply) {
  const calls = [], rpc = [], inferences = [];
  return {
    calls, rpc, inferences, mode: 'live', resolveOrg: async () => 'house', now: ET_AFTERNOON,
    query: async (url, init) => {
      calls.push(url);
      if (url.startsWith('ops_character_publications?')) return { body: [] };
      if (url.startsWith('network_posts?')) return { body: [{ id: 'post-mara', body: 'New blend today, hate it and I make another.', created_at: '2026-11-03T19:00:00Z', metadata: { actor_kind: 'character', character_id: 'mara-costa', kind: 'doing' } }] };
      if (url.startsWith('media_news_articles?')) return { body: [{ id: 'art-1', title: 'Small businesses brace for higher shipping prices this winter', canonical_url: 'https://news.example/a/1', published_at: '2026-11-03T18:00:00Z', location_country_fips: 'US' }] };
      if (url === 'rpc/ops_character_publish_post') { const b = JSON.parse(init.body); rpc.push(b); return { body: { published: true, publication_id: `pub-${rpc.length}`, post_id: b.p_kind === 'reply' ? null : `post-${rpc.length}`, comment_id: b.p_kind === 'reply' ? `c-${rpc.length}` : null } }; }
      throw new Error(url);
    },
    chat: async input => {
      inferences.push(input);
      const n = JSON.parse(input.messages[1].content).tasks.length;
      return { model: DESK_MODEL, usage: { eval_count: 200 }, message: { content: reply ? reply(n) : JSON.stringify({ posts: Array.from({ length: n }, (_, i) => ({ n: i + 1, text: `Counted the tins and the shipping notes again today, number ${i + 1}. Prices are going up, so we order smarter.` })) }) } };
    },
  };
}

test('live: one schema-constrained inference per batch, written through the service-role RPC', async () => {
  const job = { id: 'job-1', org_id: 'house', job_type: 'character_post', target_id: 'mnet-cast', input: { characters: ['eli-mensah', 'nadia-vale', 'prim3-hana-lee', 'gordon-pfeiffer'] } };
  const deps = liveFixture();
  const out = await characterPost(job, deps);
  assert.equal(deps.inferences.length, 1);
  const call = deps.inferences[0];
  assert.equal(call.schema, POST_SCHEMA); assert.equal(call.model, DESK_MODEL); assert.equal(call.priority, -45); assert.equal(call.think, false);
  assert.equal(call.messages[0].content, POST_SYSTEM);
  for (const c of cast.characters) if (c.id !== 'mccluster') assert.equal(POST_SYSTEM.includes(c.name), false, 'the system prompt is a shared, cacheable prefix'); // "McCluster" names the story worlds
  const tasks = JSON.parse(call.messages[1].content).tasks;
  assert.equal(tasks.length, 4); assert.ok(tasks.every(t => t.character.temperament && t.task.kind));
  assert.equal(out.published, 4); assert.equal(deps.rpc.length, 4);
  for (const b of deps.rpc) {
    assert.equal(b.p_org_id, 'house'); assert.equal(b.p_job_id, 'job-1'); assert.match(b.p_actor_key, /^chr\./);
    if (b.p_kind === 'news') assert.ok(b.p_article_id && !b.p_reply_to_post_id);
    if (b.p_kind === 'reply') assert.ok(b.p_reply_to_post_id === 'post-mara' && !b.p_article_id);
    if (b.p_kind === 'doing') assert.ok(!b.p_article_id && !b.p_reply_to_post_id);
  }
  assert.ok(deps.calls.some(u => u.startsWith('media_news_articles?location_country_fips=eq.KS')), 'Hana Lee reads South Korea');
  assert.doesNotThrow(() => buildCompletionEvidence(job, out));
  assert.equal(BATCH, 4);
});

test('live: unsafe output is withheld, never edited; authority checks hold', async () => {
  const job = { id: 'job-2', org_id: 'house', job_type: 'character_post', target_id: 'mnet-cast', input: { characters: ['mike-hawk', 'ada-reyes'] } };
  const deps = liveFixture(() => JSON.stringify({ posts: [{ n: 1, text: 'Vote for me at www.mikehawk.example today, folks!' }, { n: 2, text: 'Completed requests this week: one streetlight, one curb. Pending: one candidate.' }] }));
  const out = await characterPost(job, deps);
  assert.equal(out.published, 1);
  assert.deepEqual(out.withheld, [{ character_id: 'mike-hawk', reason: 'link_or_mention' }]);
  assert.doesNotThrow(() => buildCompletionEvidence(job, out));
  await assert.rejects(characterPost({ ...job, input: { characters: ['majid'] } }, liveFixture()), /not eligible/);
  await assert.rejects(characterPost({ ...job, input: { characters: ['imani-abernathy'] } }, liveFixture()), /not eligible/);
  await assert.rejects(characterPost({ ...job, org_id: 'other' }, liveFixture()), /outside Core authority/);
  await assert.rejects(characterPost({ ...job, input: { characters: ['a', 'b', 'c', 'd', 'e'] } }, liveFixture()), /1 to 4/);
});

test('dry run writes in-voice posts to a local file and respects cadence across ticks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnet-cast-'));
  try {
    const out = join(dir, 'posts.jsonl');
    const chat = async input => {
      const tasks = JSON.parse(input.messages[1].content).tasks;
      return { model: 'replay', usage: {}, message: { content: JSON.stringify({ posts: tasks.map((t, i) => ({ n: i + 1, text: `${t.task.kind === 'news' ? 'Read the headline twice' : 'Working on it'} today, and the shop is busy. More tomorrow.` })) }) } };
    };
    const news = [{ id: 'n1', title: 'Local small businesses report a strong holiday season', canonical_url: 'https://news.example/1', published_at: '2026-11-03T18:00:00Z', location_country_fips: 'US' }];
    const first = await dryRun({ out, news, chat, now: ET_AFTERNOON, budget: 8 });
    assert.equal(first.length, 8);
    assert.ok(first.every(r => r.dry_run === true && r.actor_key.startsWith('chr.') && r.text));
    const again = await dryRun({ out, news, chat, now: ET_AFTERNOON, budget: 8 });
    assert.ok(again.every(r => !first.some(f => f.character_id === r.character_id)), 'the same characters do not post again in the same minute');
    const { history } = readHistory(out);
    assert.equal(Object.keys(history).length, first.length + again.length);
    assert.equal(readFileSync(out, 'utf8').trim().split('\n').length, first.length + again.length);
    const replay = replayChat([JSON.stringify({ posts: [{ n: 1, text: 'Replayed post about the counter today.' }] })]);
    const { results } = await runCharacterBatch([{ character: characterById('mara-costa'), stimulus: { kind: 'doing', topic: 'tea' } }], { chat: replay });
    assert.equal(results[0].ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a post that parrots its voice sample or the headline is withheld (seen on the box, 2026-11-03)', async () => {
  const mike = characterById('mike-hawk');
  assert.equal(copiesFrom('Hospital emergency rooms report longest wait times in a decade. Stood up for the block.', ['Hospital emergency rooms report longest wait times in a decade']), true);
  assert.equal(copiesFrom('ER waits are the worst in ten years and nurses deserve better.', ['Hospital emergency rooms report longest wait times in a decade', mike.psych.voiceSample]), false);
  const chat = async () => ({ model: 'm', message: { content: JSON.stringify({ posts: [
    { n: 1, text: 'Hospital emergency rooms report longest wait times in a decade. Stood up for the block today. Long and hard.' },
    { n: 2, text: 'ER waits are the longest in ten years. People are hurting in plastic chairs, and nurses need a raise.' },
  ] }) } });
  const { results } = await runCharacterBatch([
    { character: mike, stimulus: { kind: 'news', article: { id: 'a', title: 'Hospital emergency rooms report longest wait times in a decade' } } },
    { character: mike, stimulus: { kind: 'news', article: { id: 'b', title: 'Hospital emergency rooms report longest wait times in a decade' } } },
  ], { chat });
  assert.equal(results[0].reason, 'copied_source');
  assert.equal(results[1].ok, true);
  assert.match(POST_SYSTEM, /never copy or reuse its phrases/);
});
