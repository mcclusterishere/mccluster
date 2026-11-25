import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, FIXTURES } from './helpers.mjs';
import { runDaily } from '../src/pipeline.mjs';
import { approveDraft, rejectDraft, editDraft } from '../src/review.mjs';
import { sendApprovedDraft, recordSend } from '../src/send.mjs';
import { recordReply, frameStats } from '../src/tracking.mjs';
import { seedStoreFromHistory } from '../src/seed-store.mjs';
import { parseCsv } from '../src/history.mjs';

const NOW = new Date('2026-11-25T14:00:00Z');
const here = path.dirname(fileURLToPath(import.meta.url));
const fakeTransport = () => { const sent = []; return { sent, async send(m) { sent.push(m); return { messageId: `m${sent.length}`, threadId: `t${sent.length}` }; } }; };

async function queued() { const t = setup(); await runDaily({ ...t, now: NOW }); return { ...t, drafts: await t.store.listDrafts() }; }

test('approval needs a named reviewer and re-runs the checks', async () => {
  const t = await queued();
  await assert.rejects(approveDraft(t.store, t.drafts[0].id, {}), /reviewer/);
  const ok = await approveDraft(t.store, t.drafts[0].id, { by: 'matthew', seed: t.seed });
  assert.equal(ok.status, 'approved');
  await assert.rejects(editDraft(t.store, t.drafts[1].id, { body: `${t.drafts[1].body}\nOne more line \u2014 with a dash.`, seed: t.seed }), /fails checks/);
  await assert.rejects(editDraft(t.store, t.drafts[1].id, { body: t.drafts[0].body, seed: t.seed }), /fails checks/);
  const rej = await rejectDraft(t.store, t.drafts[2].id, { by: 'matthew', reason: 'not now' });
  assert.equal(rej.status, 'rejected');
});

test('the gated send refuses unless every gate holds', async () => {
  const t = await queued();
  const transport = fakeTransport();
  const id = t.drafts[0].id;
  const base = { store: t.store, draftId: id, transport, config: t.config, now: NOW };
  await assert.rejects(sendApprovedDraft({ ...base, approved: true, confirmedBy: 'matthew', env: { OUTREACH_SEND_ENABLED: 'true' } }), /not approved/);
  await approveDraft(t.store, id, { by: 'matthew', seed: t.seed });
  await assert.rejects(sendApprovedDraft({ ...base, confirmedBy: 'matthew', env: { OUTREACH_SEND_ENABLED: 'true' } }), /approved: true/);
  await assert.rejects(sendApprovedDraft({ ...base, approved: true, env: { OUTREACH_SEND_ENABLED: 'true' } }), /confirmedBy/);
  await assert.rejects(sendApprovedDraft({ ...base, approved: true, confirmedBy: 'matthew', env: {} }), /OUTREACH_SEND_ENABLED/);
  assert.equal(transport.sent.length, 0);
  const s = await sendApprovedDraft({ ...base, approved: true, confirmedBy: 'matthew', env: { OUTREACH_SEND_ENABLED: 'true' } });
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].from, 'mattmccluster@gmail.com');
  assert.equal(s.sent_day, '2026-11-25');
  assert.equal((await t.store.getDraft(id)).status, 'sent');
  await assert.rejects(sendApprovedDraft({ ...base, approved: true, confirmedBy: 'matthew', env: { OUTREACH_SEND_ENABLED: 'true' } }), /not approved/);
});

test('sends are capped at 50 per frame and 150 a day on the New York calendar day', async () => {
  const t = setup();
  const day = '2026-11-25';
  for (let i = 0; i < 50; i += 1) await t.store.insertSend({ draft_id: `a${i}`, to_email: `a${i}@x.example`, frame: 'A', sent_day: day, sent_at: NOW.toISOString() });
  const draftA = await t.store.insertDraft({ to_email: 'new@x.example', frame: 'A', subject: 's', body: 'b', status: 'approved', approved_by: 'matthew', approved_at: NOW.toISOString() });
  await assert.rejects(recordSend({ store: t.store, draft: draftA, sentAt: NOW, config: t.config }), /frame A cap/);
  for (let i = 0; i < 50; i += 1) await t.store.insertSend({ draft_id: `b${i}`, to_email: `b${i}@x.example`, frame: 'B', sent_day: day });
  for (let i = 0; i < 50; i += 1) await t.store.insertSend({ draft_id: `c${i}`, to_email: `c${i}@x.example`, frame: 'C', sent_day: day });
  const draftC = await t.store.insertDraft({ to_email: 'c@x.example', frame: 'C', subject: 's', body: 'b', status: 'approved', approved_by: 'matthew', approved_at: NOW.toISOString() });
  await assert.rejects(recordSend({ store: t.store, draft: draftC, sentAt: NOW, config: t.config }), /daily cap/);
  /* 04:30 UTC on the 26th is still the 25th in New York, so it counts against the same day */
  await assert.rejects(recordSend({ store: t.store, draft: draftC, sentAt: new Date('2026-11-26T04:30:00Z'), config: t.config }), /daily cap/);
  const next = await recordSend({ store: t.store, draft: draftC, sentAt: new Date('2026-11-26T06:00:00Z'), config: t.config });
  assert.equal(next.sent_day, '2026-11-26');
});

test('replies are tracked per frame with reply rates, including the seeded batch', async () => {
  const t = setup();
  const logRows = parseCsv(fs.readFileSync(path.join(FIXTURES, 'history', 'split-test-log.csv'), 'utf8'));
  const seeded = await seedStoreFromHistory({ store: t.store, history: t.seed, logRows, config: t.config });
  assert.deepEqual(seeded, { drafts: 1, sends: 1, replies: 1 });
  assert.deepEqual(await seedStoreFromHistory({ store: t.store, history: t.seed, logRows, config: t.config }), { drafts: 0, sends: 0, replies: 0 });
  await runDaily({ ...t, now: NOW });
  const b = (await t.store.listDrafts({ status: 'pending_review' })).find((d) => d.frame === 'B');
  await approveDraft(t.store, b.id, { by: 'matthew', seed: t.seed });
  await recordSend({ store: t.store, draft: await t.store.getDraft(b.id), messageId: 'gm1', sentAt: NOW, config: t.config });
  const r = await recordReply({ store: t.store, fromEmail: b.to_email.toUpperCase(), receivedAt: NOW, messageId: 'reply1' });
  assert.equal(r.frame, 'B');
  assert.equal((await recordReply({ store: t.store, fromEmail: b.to_email, receivedAt: NOW, messageId: 'reply1' })).duplicate, true);
  assert.equal((await recordReply({ store: t.store, fromEmail: 'stranger@x.example', receivedAt: NOW })).matched, false);
  const stats = frameStats({ sends: await t.store.listSends(), replies: await t.store.listReplies() });
  assert.deepEqual(stats.map((s) => [s.frame, s.sent, s.replied, s.reply_rate]), [['A', 1, 1, 1], ['B', 1, 1, 1], ['C', 0, 0, null]]);
});

test('the scheduled path cannot reach the send code', () => {
  const importsOf = (file) => [...fs.readFileSync(file, 'utf8').matchAll(/(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of importsOf(file)) if (spec.startsWith('.')) walk(path.resolve(path.dirname(file), spec));
  };
  const src = path.join(here, '..', 'src');
  walk(path.join(src, 'pipeline.mjs'));
  const executor = path.join(here, '..', '..', 'core', 'src', 'executors', 'mentor-outreach-research.mjs');
  if (fs.existsSync(executor)) walk(executor);
  assert.ok(![...seen].some((f) => f.endsWith('send.mjs')), [...seen].join('\n'));
  for (const f of seen) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/, f);
});
