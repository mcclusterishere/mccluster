import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, HARD_MAX_PER_RUN } from '../src/config.mjs';
import { buildLetters, writeSendList, sendRun, SAFEGUARDS } from '../src/pipeline.mjs';
import { Ledger } from '../src/ledger.mjs';
import { dashViolations } from '../src/text-rules.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'demo-outreach-'));
const cfgWith = (env = {}) => loadConfig({ DEMO_OUTREACH_STATE_DIR: tmp(), ...env });

/* Many fake candidates so the cap is actually exercised. */
function bigCandidates(n) {
  const dir = tmp();
  const file = path.join(dir, 'c.json');
  const candidates = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `Person ${i}`, salutation: `Dr. Person${i}`, email: `p${i}@example.edu`, email_verified: true,
    email_source_url: `https://example.edu/p${i}`, subject_topic: `Topic ${i}`, list: 'send',
    hook: `Your book number ${i} follows how county records classified families over three generations in one state.`,
  }));
  fs.writeFileSync(file, JSON.stringify({ candidates }));
  return file;
}

test('defaults to draft mode with send disabled', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.mode, 'draft');
  assert.equal(cfg.sendEnabled, false);
  assert.equal(cfg.maxPerRun, 5);
});

test('per run cap cannot be raised above 5', () => {
  assert.equal(loadConfig({ DEMO_OUTREACH_MAX_PER_RUN: '50' }).maxPerRun, HARD_MAX_PER_RUN);
  assert.equal(loadConfig({ DEMO_OUTREACH_MAX_PER_RUN: '2' }).maxPerRun, 2);
  assert.equal(loadConfig({ DEMO_OUTREACH_MAX_PER_RUN: 'x' }).maxPerRun, 5);
});

test('every real letter passes the no dash rule and links the target, for every target', () => {
  for (const target of ['mccluster', 'ftp', 'apex']) {
    const cfg = cfgWith({ DEMO_OUTREACH_TARGET: target });
    const { ready, skipped } = buildLetters(cfg);
    assert.ok(ready.length >= 10, `${target}: ${ready.length} ready`);
    for (const s of skipped) assert.ok(!/fails checks/.test(s.reason), `${target}: ${s.id} ${s.reason}`);
    for (const d of ready) {
      assert.deepEqual(dashViolations(d.subject), [], d.id);
      assert.deepEqual(dashViolations(d.body), [], d.id);
      assert.ok(d.source_url.startsWith('https://'));
    }
  }
});

test('hold and unverified candidates never reach the send list', () => {
  const cfg = cfgWith();
  const out = path.join(tmp(), 'sendlist.json');
  const doc = writeSendList(cfg, buildLetters(cfg), out);
  const data = JSON.parse(fs.readFileSync(cfg.candidatesFile, 'utf8')).candidates;
  const holds = new Set(data.filter((c) => c.list !== 'send' || !c.email_verified).map((c) => c.email).filter(Boolean));
  for (const r of doc.recipients) assert.ok(!holds.has(r.email), r.email);
  assert.equal(doc.status, 'awaiting_matthew_approval');
  assert.deepEqual(doc.safeguards, SAFEGUARDS);
});

test('send refuses in draft mode, when disabled, without confirm, or without a transport', async () => {
  const t = async () => ({ messageId: 'x' });
  await assert.rejects(sendRun(cfgWith(), { transport: t, confirm: true }), /draft mode/);
  await assert.rejects(sendRun(cfgWith({ DEMO_OUTREACH_MODE: 'send' }), { transport: t, confirm: true }), /send disabled/);
  const on = { DEMO_OUTREACH_MODE: 'send', DEMO_OUTREACH_SEND_ENABLED: 'true' };
  await assert.rejects(sendRun(cfgWith(on), { transport: t }), /--confirm/);
  await assert.rejects(sendRun(cfgWith(on), { confirm: true }), /transport/);
});

test('send mode: max 5 per run, one initial letter each, no follow ups, every send logged', async () => {
  const cfg = cfgWith({ DEMO_OUTREACH_MODE: 'send', DEMO_OUTREACH_SEND_ENABLED: 'true', DEMO_OUTREACH_CANDIDATES: bigCandidates(12) });
  const sent = [];
  const transport = async (m) => { sent.push(m.to); return { messageId: `m${sent.length}` }; };
  const r1 = await sendRun(cfg, { transport, confirm: true });
  assert.equal(sent.length, 5);
  assert.equal(r1.deferred.length, 7);
  const r2 = await sendRun(cfg, { transport, confirm: true });
  const r3 = await sendRun(cfg, { transport, confirm: true });
  assert.equal(sent.length, 12);
  assert.equal(new Set(sent).size, 12, 'nobody gets a second letter');
  const r4 = await sendRun(cfg, { transport, confirm: true });
  assert.equal(r4.results.length, 0, 'no follow ups once everyone is contacted');
  const log = new Ledger(cfg.stateDir).entries();
  assert.equal(log.filter((e) => e.type === 'send_attempt').length, 12);
  assert.equal(log.filter((e) => e.type === 'sent').length, 12);
  assert.ok(log.filter((e) => e.type === 'sent').every((e) => e.kind === 'initial'));
});

test('replied, opted out and already contacted people are skipped; failed sends are not retried', async () => {
  const cfg = cfgWith({ DEMO_OUTREACH_MODE: 'send', DEMO_OUTREACH_SEND_ENABLED: 'true', DEMO_OUTREACH_CANDIDATES: bigCandidates(5) });
  const ledger = new Ledger(cfg.stateDir);
  ledger.recordReply('p0@example.edu', { text: 'Thanks, happy to talk' });
  ledger.recordReply('P1@example.edu', { text: 'Please remove me from your list' });
  ledger.optOut('p2@example.edu');
  ledger.markContacted('p3@example.edu');
  assert.equal(ledger.blockReason('p1@example.edu'), 'opted_out');
  const sent = [];
  let fail = true;
  const transport = async (m) => { if (fail) { fail = false; throw new Error('smtp down'); } sent.push(m.to); return {}; };
  const r = await sendRun(cfg, { transport, confirm: true, ledger });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].sent, false);
  await sendRun(cfg, { transport, confirm: true, ledger });
  assert.equal(sent.length, 0, 'p4 failed once and is never retried automatically');
  assert.ok(ledger.entries().some((e) => e.type === 'send_failed'));
});

test('nothing in this package imports a mail or network client', () => {
  const files = [...fs.readdirSync(path.join(PKG, 'src')).map((f) => path.join(PKG, 'src', f)), path.join(PKG, 'bin', 'demo-outreach.mjs')];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/nodemailer|googleapis|smtp|node:https?['"]|\bfetch\(/i.test(s.replace(/smtp down/g, '')), f);
  }
});
