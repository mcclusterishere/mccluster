import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mentorOutreachResearch, pipelineDir, JOB_TYPE } from '../src/executors/mentor-outreach-research.mjs';
import { outreachEnabled, nyDate } from '../src/seed-mentor-outreach.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PIPE = path.resolve(here, '..', '..', 'outreach-pipeline');
const imp = (f) => import(pathToFileURL(path.join(PIPE, f)).href);

test('the executor is off unless OUTREACH_PIPELINE_ENABLED=true', async () => {
  const out = await mentorOutreachResearch({ id: 'j1' }, { env: { OUTREACH_PIPELINE_DIR: PIPE } });
  assert.equal(out.skipped, true);
  assert.equal(outreachEnabled({}), false);
  assert.equal(outreachEnabled({ OUTREACH_PIPELINE_ENABLED: 'true' }), true);
});

test('the executor finds the pipeline beside core/ and fills the review queue only', async () => {
  assert.equal(pipelineDir({}), PIPE);
  const { loadConfig } = await imp('src/config.mjs');
  const { LocalStore } = await imp('src/store.mjs');
  const { createSearch } = await imp('src/search.mjs');
  const { createFetcher } = await imp('src/fetch-page.mjs');
  const { loadHistory } = await imp('src/history.mjs');
  const { fixtureComposer } = await imp('test/fixtures/fixture-composer.mjs');
  const env = { OUTREACH_PIPELINE_ENABLED: 'true', OUTREACH_SEARCH_PROVIDER: 'fixture' };
  const config = loadConfig(env);
  const store = new LocalStore(fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-core-')));
  const out = await mentorOutreachResearch({ id: 'j2', job_type: JOB_TYPE }, { env, deps: {
    store, search: createSearch(config, { fixturePath: path.join(PIPE, 'test/fixtures/search.json') }),
    fetchPage: createFetcher(config, { fixturePages: path.join(PIPE, 'test/fixtures/pages.json') }),
    composer: fixtureComposer, llm: null, embed: null, seed: loadHistory(path.join(PIPE, 'test/fixtures/history')), now: new Date('2026-11-25T14:00:00Z'),
  } });
  assert.equal(out.sent, 0);
  assert.equal(out.review_queue.status, 'pending_review');
  assert.equal(out.run.queued_total, 4);
  assert.match(out.summary, /nothing sent/);
  assert.equal((await store.listSends()).length, 0);
});

test('the seed keys one job per New York day', () => {
  assert.equal(nyDate(new Date('2026-11-26T04:30:00Z')), '2026-11-25');
  assert.equal(nyDate(new Date('2026-11-26T06:00:00Z')), '2026-11-26');
});
