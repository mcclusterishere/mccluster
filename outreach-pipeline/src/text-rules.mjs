/* Text rules every outgoing subject and body must pass.
   Dashes: Matthew's Gmail rule is no dashes used as punctuation. We are stricter than that on purpose:
   no em, en, figure, horizontal bar or minus characters at all, and no ASCII hyphen anywhere outside an
   email address or a URL (so no "one-third", no " - ", no "--", no bullet hyphens). */
const UNICODE_DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/u;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/giu;
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/gu;

export function dashViolations(text) {
  const s = String(text || '');
  const out = [];
  const uni = s.match(new RegExp(UNICODE_DASHES.source, 'gu'));
  if (uni) out.push({ kind: 'unicode_dash', count: uni.length, chars: [...new Set(uni)] });
  const stripped = s.replace(URL_RE, ' ').replace(EMAIL_RE, ' ');
  const hy = stripped.match(/-/gu);
  if (hy) out.push({ kind: 'hyphen', count: hy.length });
  return out;
}
export function hasNoDashes(text) { return dashViolations(text).length === 0; }

const FRAME_B_FORBIDDEN = [/\bstudent\b/i, /\bmccluster\b/i, /\bequity uprise\b/i, /\bmy (startup|company|platform|app)\b/i, /\bpitch\b/i, /\b(call|meeting|chat) (with|next)\b/i];

export function sentenceSplit(text) {
  return String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/u).map((x) => x.trim()).filter(Boolean);
}

/* Structural checks per frame. Returns a list of problems; empty means it passes. */
export function frameViolations(frame, { subject, body }) {
  const problems = [];
  const text = String(body || '');
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!String(subject || '').trim()) problems.push('missing subject');
  if (words < 40) problems.push(`body too short (${words} words)`);
  if (words > 260) problems.push(`body too long (${words} words)`);
  const questions = (text.match(/\?/g) || []).length;
  if (frame === 'A') {
    if (!/\b(student|studying|study)\b/i.test(text)) problems.push('frame A must say he is a student');
    if (questions + (text.match(/\b(would you|could I|if you had|a short conversation|a few minutes)\b/gi) || []).length === 0) problems.push('frame A needs an interview ask');
  } else if (frame === 'B') {
    const letter = stripSignature(text);
    for (const re of FRAME_B_FORBIDDEN) if (re.test(letter)) problems.push(`frame B must not pitch or self describe (${re.source})`);
    if (questions !== 1) problems.push(`frame B must ask exactly one question (found ${questions})`);
    const sentences = sentenceSplit(stripSignature(text)).length;
    if (sentences > 8) problems.push(`frame B must stay short (${sentences} sentences)`);
  } else if (frame === 'C') {
    if (questions === 0 && !/\b(intro|introduce|introduction|point me|connect me|help)\b/i.test(text)) problems.push('frame C needs one specific, small ask');
  } else {
    problems.push(`unknown frame ${frame}`);
  }
  for (const v of dashViolations(subject)) problems.push(`subject has ${v.kind}`);
  for (const v of dashViolations(body)) problems.push(`body has ${v.kind}`);
  return problems;
}

/* Remove greeting and signature lines so the similarity guard compares the letter, not the envelope. */
export function stripSignature(body, signatureLines = ['Matthew McCluster', 'Matthew', 'mattmccluster@gmail.com']) {
  const sig = new Set(signatureLines.map((s) => s.trim().toLowerCase().replace(/[.,]$/, '')));
  const lines = String(body || '').split(/\r?\n/);
  const kept = [];
  let first = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const norm = line.toLowerCase().replace(/[.,]$/, '');
    if (sig.has(norm)) continue;
    if (first && /,$/.test(line) && line.split(/\s+/).length <= 5) { first = false; continue; }
    first = false;
    kept.push(line);
  }
  return kept.join('\n');
}
