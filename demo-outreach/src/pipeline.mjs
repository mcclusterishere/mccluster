/* Draft run: build every eligible letter into the review queue. Send list: the same letters, export only.
   Send run: gated, capped at 5, one initial letter per person, no follow ups, logs every send. */
import fs from 'node:fs';
import path from 'node:path';
import { composeLetter, resolveTarget } from './compose.mjs';
import { letterProblems } from './text-rules.mjs';
import { Ledger } from './ledger.mjs';
import { HARD_MAX_PER_RUN } from './config.mjs';

export const SAFEGUARDS = {
  max_sends_per_run: HARD_MAX_PER_RUN,
  initial_email_only: true,
  automated_follow_ups: false,
  skip_if_already_contacted: true,
  skip_if_replied: true,
  honor_opt_out: true,
  log_every_send: 'state/send-log.jsonl (send_attempt before, sent or send_failed after)',
  verified_public_email_only: true,
  no_dash_punctuation: true,
  default_mode: 'draft',
};

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function buildLetters(cfg, { ledger = new Ledger(cfg.stateDir) } = {}) {
  const { candidates } = readJson(cfg.candidatesFile);
  const target = resolveTarget(readJson(cfg.targetsFile), cfg.target);
  const ready = [];
  const skipped = [];
  for (const c of candidates) {
    if (c.list !== 'send') { skipped.push({ id: c.id, reason: `hold: ${c.hold_reason || 'not on send list'}` }); continue; }
    if (!c.email || c.email_verified !== true || !c.email_source_url) { skipped.push({ id: c.id, reason: 'email not verified' }); continue; }
    const blocked = ledger.blockReason(c.email);
    if (blocked) { skipped.push({ id: c.id, reason: blocked }); continue; }
    const letter = composeLetter(c, target, cfg);
    if (letter.problems.length) { skipped.push({ id: c.id, reason: `fails checks: ${letter.problems.join('; ')}` }); continue; }
    ready.push({ id: c.id, name: c.name, email: c.email, source_url: c.email_source_url, fit: c.fit, work_url: c.work_url, target: target.key, subject: letter.subject, body: letter.body, status: 'pending_review' });
  }
  return { target, ready, skipped };
}

export function writeQueue(cfg, result) {
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  const file = path.join(cfg.stateDir, 'review-queue.json');
  fs.writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), mode: 'draft', target: result.target.key, safeguards: SAFEGUARDS, drafts: result.ready, skipped: result.skipped }, null, 2));
  return file;
}

export function writeSendList(cfg, result, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const doc = {
    generated_at: new Date().toISOString(),
    status: 'awaiting_matthew_approval',
    target: { key: result.target.key, url: result.target.url },
    from: { name: cfg.fromName, email: cfg.fromEmail },
    safeguards: SAFEGUARDS,
    count: result.ready.length,
    recipients: result.ready.map(({ name, email, source_url, subject, body, id }) => ({ id, name, email, source_url, subject, body })),
  };
  fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

/* transport: async ({ to, subject, body, fromName, fromEmail }) => ({ messageId }). There is no transport in this repo. */
export async function sendRun(cfg, { transport, confirm = false, ledger = new Ledger(cfg.stateDir) } = {}) {
  if (cfg.mode !== 'send') throw new Error('draft mode: set DEMO_OUTREACH_MODE=send to send');
  if (!cfg.sendEnabled) throw new Error('send disabled: DEMO_OUTREACH_SEND_ENABLED is not true');
  if (!confirm) throw new Error('send needs --confirm');
  if (typeof transport !== 'function') throw new Error('send needs an explicit transport');
  const { ready, skipped } = buildLetters(cfg, { ledger });
  const cap = Math.min(cfg.maxPerRun, HARD_MAX_PER_RUN);
  const batch = ready.slice(0, cap);
  const results = [];
  for (const d of batch) {
    if (ledger.blockReason(d.email)) { results.push({ id: d.id, skipped: ledger.blockReason(d.email) }); continue; }
    if (letterProblems(d).length) { results.push({ id: d.id, skipped: 'fails checks' }); continue; }
    ledger.append({ type: 'send_attempt', email: d.email, id: d.id, subject: d.subject });
    try {
      const r = await transport({ to: d.email, subject: d.subject, body: d.body, fromName: cfg.fromName, fromEmail: cfg.fromEmail });
      ledger.append({ type: 'sent', email: d.email, id: d.id, subject: d.subject, messageId: r?.messageId ?? null, kind: 'initial' });
      results.push({ id: d.id, sent: true, messageId: r?.messageId ?? null });
    } catch (err) {
      ledger.append({ type: 'send_failed', email: d.email, id: d.id, error: String(err?.message || err) });
      results.push({ id: d.id, sent: false, error: String(err?.message || err) });
    }
  }
  return { cap, results, deferred: ready.slice(cap).map((d) => d.id), skipped };
}
