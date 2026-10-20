import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localAnalysis } from '../src/executors/local-analysis.mjs';
import { validateNewsBrief } from '../src/news-brief-validation.mjs';

const evidence = { country: 'US', day: '2026-10-20', timezone: 'America/New_York',
  window: { since: '2026-10-20T04:00:00Z', until: '2026-10-21T04:00:00Z' },
  headlines: [{ n: 1, country: 'US', title: 'Harbor ferry resumes service after repairs', discovered_at: '2026-10-20T08:00:00Z' }] };
const analysis = { summary: 'Reports describe ferry service resuming [1].', findings: ['Harbor ferry service resumed [1].'],
  assumptions: ['Passenger counts and service reliability are unknown.'], next_actions: ['Travel could resume on the ferry [1].'],
  support: [{ finding_index: 0, source_n: 1, excerpt: 'ferry resumes service' }] };
const job = { id: 'synthetic', priority: 95, target_type: 'news_brief', target_id: '2026-10-20:US', input: { kind: 'news_brief', task: 'Draft from evidence.', evidence } };

test('news draft execution validates sources but never claims semantic or publication approval', async () => {
  let request;
  const out = await localAnalysis(job, { chat: async (r) => { request = r; return { model: 'fixture-only', message: { content: JSON.stringify(analysis) } }; } });
  assert.equal(request.json, true);
  assert.equal(request.priority, 95);
  assert.equal(out.editorial_status, 'needs_review');
  assert.equal(out.validation.support_status, 'requires_human_review');
  assert.equal(out.validation.publication_authorized, false);
});

test('plain text, fenced JSON and unsupported schema fail instead of free-text success', async () => {
  for (const content of ['A made-up market claim.', '```json\n{}\n```', JSON.stringify({ summary: 'Hello [1]' })]) {
    await assert.rejects(localAnalysis(job, { chat: async () => ({ message: { content } }) }), /news_brief_invalid/);
  }
});

test('bad citation, invented source excerpt and uncited factual finding are rejected', () => {
  for (const patch of [
    { summary: 'Unsupported claim [99].' },
    { findings: ['A factual claim without citation.'] },
    { support: [{ finding_index: 0, source_n: 1, excerpt: 'Stock prices tripled' }] },
    { support: [] },
    { next_actions: ['You should buy ferry shares [1].'] },
    { extra: 'unexpected authority' },
  ]) assert.throws(() => validateNewsBrief({ ...analysis, ...patch }, evidence, job.target_id), /news_brief_invalid/);
});

test('wrong country, wrong day and a future source cannot enter an edition', () => {
  assert.throws(() => validateNewsBrief(analysis, evidence, '2026-10-20:GB'), /edition mismatch/);
  for (const headline of [ { ...evidence.headlines[0], country: 'GB' }, { ...evidence.headlines[0], discovered_at: '2026-10-21T04:00:00Z' } ]) {
    assert.throws(() => validateNewsBrief(analysis, { ...evidence, headlines: [headline] }, job.target_id), /source (country|outside)/);
  }
  for (const patch of [{ window: null }, { timezone: 'bad/zone' }, { window: { since: 'invalid', until: evidence.window.until } }, { window: { since: '2026-10-19T04:00:00Z', until: evidence.window.until } }]) {
    assert.throws(() => validateNewsBrief(analysis, { ...evidence, ...patch }, job.target_id), /news_brief_invalid/);
  }
});

test('legacy non-news analysis keeps its existing free-text contract', async () => {
  const out = await localAnalysis({ target_type: 'ordinary', input: { task: 'Summarize' } }, { chat: async () => ({ message: { content: 'A note.' } }) });
  assert.deepEqual(out.analysis, { summary: 'A note.' });
  assert.equal(out.validation, undefined);
});
