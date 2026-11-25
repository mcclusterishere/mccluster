/* Human review. Nothing leaves pending_review without a named person approving it.
   Approval and edits re-run the dash, frame and similarity checks against everything else. */
import { frameViolations } from './text-rules.mjs';
import { fingerprint, guard } from './similarity.mjs';

async function recheck(store, draft, { seed, signatureLines }) {
  const others = (await store.listDrafts()).filter((d) => d.id !== draft.id).map((d) => ({ id: d.id, label: d.recipient_name, subject: d.subject, body: d.body }));
  const items = [...(seed?.items || []).filter((i) => String(i.to || '').toLowerCase() !== String(draft.to_email).toLowerCase() || i.subject !== draft.subject), ...others];
  const sim = guard(draft, items.map((i) => fingerprint(i, { signatureLines })), { signatureLines });
  const problems = [...frameViolations(draft.frame, draft), ...sim.violations.flatMap((v) => v.reasons.map((r) => `too close to ${v.against} (${r.rule})`))];
  return { ok: problems.length === 0, problems, similarity: { worst: sim.worst, checkedAgainst: sim.checkedAgainst } };
}

export async function approveDraft(store, id, { by, note = null, seed = null, signatureLines } = {}) {
  if (!String(by || '').trim()) throw new Error('approval needs the reviewer name (--by)');
  const draft = await store.getDraft(id);
  if (!draft) throw new Error(`no draft ${id}`);
  if (draft.status !== 'pending_review') throw new Error(`draft ${draft.id} is ${draft.status}, only pending_review can be approved`);
  const check = await recheck(store, draft, { seed, signatureLines });
  if (!check.ok) throw new Error(`draft ${draft.id} fails checks: ${check.problems.join('; ')}`);
  return store.updateDraft(draft.id, { status: 'approved', approved_by: String(by).trim(), approved_at: new Date().toISOString(), review_note: note });
}

export async function rejectDraft(store, id, { by, reason = null } = {}) {
  const draft = await store.getDraft(id);
  if (!draft) throw new Error(`no draft ${id}`);
  if (!['pending_review', 'approved', 'drafted'].includes(draft.status)) throw new Error(`draft ${draft.id} is ${draft.status}`);
  return store.updateDraft(draft.id, { status: 'rejected', review_note: reason, approved_by: null, approved_at: null, reviewed_by: by || null });
}

/* An edit goes back to pending_review; it has to pass the same checks as a generated letter. */
export async function editDraft(store, id, { subject, body, seed = null, signatureLines } = {}) {
  const draft = await store.getDraft(id);
  if (!draft) throw new Error(`no draft ${id}`);
  if (['sent', 'seeded'].includes(draft.status)) throw new Error(`draft ${draft.id} is ${draft.status} and cannot change`);
  const next = { ...draft, subject: subject ?? draft.subject, body: body ?? draft.body };
  const check = await recheck(store, next, { seed, signatureLines });
  if (!check.ok) throw new Error(`edit fails checks: ${check.problems.join('; ')}`);
  return store.updateDraft(draft.id, { subject: next.subject, body: next.body, status: 'pending_review', approved_by: null, approved_at: null });
}

/* Plain text view for pasting into chat: one block per letter with its sources. */
export function reviewMarkdown(drafts) {
  return drafts.map((d, i) => [
    `### ${i + 1}. ${d.recipient_name}  |  Frame ${d.frame}  |  ${String(d.id).slice(0, 8)}`,
    `To: ${d.to_email}`,
    `Subject: ${d.subject}`,
    '',
    d.body,
    '',
    `Email published at: ${d.sources?.email || 'n/a'}`,
    d.sources?.wealth ? `Wealth signal: ${d.sources.wealth}` : 'Wealth signal: none (Frame C)',
    `Recent activity: ${(d.sources?.hooks || []).join(' , ')}`,
    `Closest earlier letter: ${d.guard_report?.similarity?.worst?.against || 'n/a'} (3 word Jaccard ${d.guard_report?.similarity?.worst?.jaccard ?? 'n/a'})`,
  ].join('\n')).join('\n\n');
}
