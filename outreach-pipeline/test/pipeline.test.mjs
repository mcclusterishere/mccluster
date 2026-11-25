import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { runDaily } from '../src/pipeline.mjs';
import { loadConfig } from '../src/config.mjs';
import { dashViolations } from '../src/text-rules.mjs';

const NOW = new Date('2026-11-25T14:00:00Z');

test('daily run queues verified, unique letters for review and sends nothing', async () => {
  const t = setup();
  const s = await runDaily({ ...t, now: NOW });
  assert.deepEqual(s.queued, { A: 1, B: 1, C: 2 });
  assert.equal(s.rejected.no_published_email, 2, 'broker only and obfuscated addresses are dropped');
  const drafts = await t.store.listDrafts();
  assert.equal(drafts.length, 4);
  for (const d of drafts) {
    assert.equal(d.status, 'pending_review');
    assert.equal(d.from_email, 'mattmccluster@gmail.com');
    assert.deepEqual(dashViolations(d.body), []);
    assert.deepEqual(dashViolations(d.subject), []);
    assert.ok(d.sources.email.startsWith('https://'));
    assert.ok(d.sources.hooks.length >= 1);
    if (d.frame !== 'C') assert.ok(d.sources.wealth, `${d.recipient_name} needs a wealth source`);
  }
  assert.equal((await t.store.listSends()).length, 0);
  const byName = Object.fromEntries(drafts.map((d) => [d.recipient_name, d]));
  assert.equal(byName['Jordan Pike'].frame, 'C', 'a $500,000 exit is under the floor, so only the power frame');
  assert.equal(byName['Dana Whitfield'].guard_report.attempts.length, 2, 'the dashed first attempt was retried');
  assert.ok(!byName['Quinn Harrow'], 'hold list is respected');
  assert.ok(!byName['Avery Stone'], 'people already contacted are skipped');
});

test('a second run the same day adds nothing new and never repeats a person', async () => {
  const t = setup();
  await runDaily({ ...t, now: NOW });
  const again = await runDaily({ ...t, now: NOW });
  assert.equal(again.queued_total, 0);
  assert.equal((await t.store.listDrafts()).length, 4);
});

test('caps: env can lower them but never raise them past 150 a day and 50 a frame', async () => {
  assert.equal(loadConfig({ OUTREACH_DAILY_CAP: '999', OUTREACH_FRAME_CAP: '500' }).dailyCap, 150);
  assert.equal(loadConfig({ OUTREACH_FRAME_CAP: '500' }).frameCap, 50);
  const t = setup({ OUTREACH_FRAME_CAP: '1' });
  const s = await runDaily({ ...t, now: NOW });
  assert.deepEqual(s.queued, { A: 1, B: 1, C: 1 });
});

test('without a search provider or composer the run reports it and queues nothing', async () => {
  const t = setup({ OUTREACH_SEARCH_PROVIDER: 'none' });
  const { createSearch } = await import('../src/search.mjs');
  const s = await runDaily({ ...t, search: createSearch(t.config), now: NOW });
  assert.equal(s.discovered, 0);
  assert.match(s.notes[0], /no search provider/);
  const t2 = setup();
  const s2 = await runDaily({ ...t2, composer: null, now: NOW });
  assert.equal(s2.queued_total ?? 0, 0);
  assert.equal((await t2.store.listDrafts()).length, 0);
});
