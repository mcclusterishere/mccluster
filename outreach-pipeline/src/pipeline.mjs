/* The daily research run. Output is a REVIEW QUEUE, never a send:
   every letter that passes verification and every check lands as status 'pending_review'.
   This module does not import the send code, and the Core executor and the timer call only runDaily. */
import { FRAME_KEYS, nyDay } from './config.mjs';
import { CATEGORIES, discover } from './discovery.mjs';
import { findPublishedEmail, findWealthSignal, verifyRole } from './verify.mjs';
import { researchHooks } from './research.mjs';
import { composeLetter } from './compose.mjs';
import { fingerprint } from './similarity.mjs';
import { remainingCapacity } from './caps.mjs';
import { stripSignature } from './text-rules.mjs';

export const nameKey = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const OPEN_STATUSES = ['drafted', 'pending_review', 'approved'];

export async function buildHistory({ store, seed, signatureLines }) {
  const drafts = await store.listDrafts();
  const items = [...(seed?.items || []), ...drafts.map((d) => ({ id: d.id, to: d.to_email, label: d.recipient_name, subject: d.subject, body: d.body, embedding: d.embedding || null }))];
  return {
    items,
    fingerprints: items.map((i) => fingerprint(i, { signatureLines })),
    openings: items.map((i) => stripSignature(i.body, signatureLines).split(/\s+/).slice(0, 8).join(' ')),
    contactedEmails: new Set([...(seed?.contactedEmails || []), ...drafts.map((d) => String(d.to_email || '').toLowerCase())]),
    contactedNames: new Set([...(seed?.contactedNames || []), ...drafts.map((d) => String(d.recipient_name || '').toLowerCase())]),
    holdNames: new Set(seed?.holdNames || []),
  };
}

function pickFrame(eligible, remaining) {
  const open = eligible.filter((f) => remaining[f] > 0);
  if (!open.length) return null;
  return open.reduce((best, f) => (remaining[f] > remaining[best] ? f : best), open[0]);
}

export async function runDaily({ config, store, search, fetchPage, composer, embed = null, llm = null, seed = null, categories = CATEGORIES, now = new Date(), log = () => {} }) {
  const day = nyDay(now, config.timeZone);
  const runId = `outreach:${day}:${Date.now().toString(36)}`;
  const summary = { run_id: runId, day, discovered: 0, considered: 0, queued: { A: 0, B: 0, C: 0 }, rejected: {}, notes: [] };
  const bump = (reason) => { summary.rejected[reason] = (summary.rejected[reason] || 0) + 1; };

  if (!search?.configured) { summary.notes.push('no search provider configured (OUTREACH_SEARCH_PROVIDER); nothing discovered'); await store.recordRun(summary); return summary; }
  if (!composer) { summary.notes.push('no composer configured (OUTREACH_LLM_URL and OUTREACH_LLM_MODEL); research runs but no letters are written'); }

  const history = await buildHistory({ store, seed, signatureLines: config.signatureLines });
  const sendsToday = await store.listSends({ day });
  const open = await store.listDrafts({ status: OPEN_STATUSES });
  const cap = remainingCapacity({ sends: sendsToday, queued: open, config, day });
  const remaining = Object.fromEntries(FRAME_KEYS.map((f) => [f, Math.min(cap.remaining[f], config.draftsPerFrame)]));
  summary.capacity_at_start = { ...remaining };
  if (FRAME_KEYS.every((f) => remaining[f] === 0)) { summary.notes.push('review queue already full for today'); await store.recordRun(summary); return summary; }

  const exclude = (p) => {
    const n = p.name.toLowerCase();
    return history.contactedNames.has(n) || history.holdNames.has(n);
  };
  const { candidates, queriesRun } = await discover({ search, llm, categories, exclude, limit: config.maxCandidatesPerRun });
  summary.discovered = candidates.length;
  summary.queries = queriesRun.length;

  for (const person of candidates) {
    if (FRAME_KEYS.every((f) => remaining[f] === 0)) break;
    summary.considered += 1;
    const key = nameKey(person.name);
    const prior = await store.findCandidate({ nameKey: key });
    if (prior && prior.status !== 'discovered') { bump('already_in_pipeline'); continue; }
    const category = categories.find((c) => c.key === person.category) || categories[0];
    const base = { name: person.name, name_key: key, category: person.category, role: person.role, organization: person.organization, run_id: runId };

    const email = await findPublishedEmail({ person, search, fetchPage });
    if (!email) { bump('no_published_email'); await store.upsertCandidate({ ...base, status: 'rejected', rejection_reason: 'no_published_email' }); continue; }
    if (history.contactedEmails.has(email.email.toLowerCase())) { bump('already_contacted'); continue; }

    const wealth = await findWealthSignal({ person, search, fetchPage });
    const eligible = wealth ? category.frames : ['C'];
    const frame = pickFrame(eligible, remaining);
    if (!frame) { bump(wealth ? 'frames_full' : 'no_wealth_signal_and_frame_c_full'); continue; }
    const role = frame === 'C' ? await verifyRole({ person, fetchPage }) : null;
    if (frame === 'C' && !role && !wealth) { bump('role_not_sourced'); await store.upsertCandidate({ ...base, status: 'rejected', rejection_reason: 'role_not_sourced' }); continue; }

    const hooks = await researchHooks({ person, search, fetchPage });
    if (!hooks.length) { bump('no_recent_activity'); await store.upsertCandidate({ ...base, status: 'rejected', rejection_reason: 'no_2025_2026_activity' }); continue; }

    const candidate = await store.upsertCandidate({ ...base, email: email.email.toLowerCase(), frame, status: 'verified', wealth: wealth || null, email_source: email, role_source: role, hooks });
    await store.addSources([
      ...person.discoverySources.slice(0, 5).map((s) => ({ candidate_id: candidate.id, kind: 'discovery', url: s.url, title: s.title || null, excerpt: s.snippet || null, verified: false })),
      { candidate_id: candidate.id, kind: 'email', url: email.url, excerpt: email.excerpt, content_sha256: email.sha256, fetched_at: email.fetchedAt, verified: true },
      ...(wealth ? [{ candidate_id: candidate.id, kind: 'wealth', url: wealth.url, excerpt: wealth.excerpt, content_sha256: wealth.sha256, fetched_at: wealth.fetchedAt, verified: true, detail: { kind: wealth.kind, amount_usd: wealth.amountUsd } }] : []),
      ...(role ? [{ candidate_id: candidate.id, kind: 'role', url: role.url, excerpt: role.excerpt, content_sha256: role.sha256, fetched_at: role.fetchedAt, verified: true }] : []),
      ...hooks.map((h) => ({ candidate_id: candidate.id, kind: 'hook', url: h.url, title: h.title, excerpt: h.excerpt.slice(0, 1000), content_sha256: h.sha256, verified: true, detail: { year: h.year, published: h.published } })),
    ]);
    if (!composer) { bump('no_composer'); continue; }

    const result = await composeLetter({ person: { ...person, email: email.email }, frame, hooks, composer, historyFingerprints: history.fingerprints, avoidOpenings: history.openings, signatureLines: config.signatureLines, embed });
    if (!result.ok) { bump('failed_letter_checks'); await store.upsertCandidate({ ...base, status: 'rejected', rejection_reason: 'failed_letter_checks' }); log('letter_failed', { name: person.name, attempts: result.attempts }); continue; }

    const draft = await store.insertDraft({
      candidate_id: candidate.id, recipient_name: person.name, to_email: email.email.toLowerCase(), frame,
      subject: result.letter.subject, body: result.letter.body, status: 'pending_review', review_day: day, run_id: runId,
      from_email: config.sendFrom,
      guard_report: { similarity: result.check.similarity, grounding: result.check.grounding, attempts: result.attempts },
      sources: { email: email.url, wealth: wealth?.url || null, role: role?.url || null, hooks: hooks.map((h) => h.url) },
      embedding: result.embedding || null,
    });
    await store.upsertCandidate({ ...base, status: 'drafted' });
    history.fingerprints.push(fingerprint({ id: draft.id, label: person.name, subject: draft.subject, body: draft.body, embedding: result.embedding }, { signatureLines: config.signatureLines }));
    history.openings.push(stripSignature(draft.body, config.signatureLines).split(/\s+/).slice(0, 8).join(' '));
    history.contactedEmails.add(draft.to_email);
    remaining[frame] -= 1;
    summary.queued[frame] += 1;
  }
  summary.queued_total = FRAME_KEYS.reduce((n, f) => n + summary.queued[f], 0);
  await store.recordRun(summary);
  return summary;
}
