/* Text rules every subject and body must pass before it can be queued, exported or sent.
   Matthew's rule: no dashes as punctuation in any email subject or body. This is stricter on purpose:
   no em, en, figure, minus or other Unicode dash at all, and no ASCII hyphen outside an email address
   or a URL. Names that are normally hyphenated are written with a space in letters. */
const UNICODE_DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/gu;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/giu;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/gu;

export function dashViolations(text) {
  const s = String(text ?? '');
  const out = [];
  const uni = s.match(UNICODE_DASHES);
  if (uni) out.push({ kind: 'unicode_dash', count: uni.length });
  const hy = s.replace(URL_RE, ' ').replace(EMAIL_RE, ' ').match(/-/gu);
  if (hy) out.push({ kind: 'hyphen', count: hy.length });
  return out;
}

export function letterProblems({ subject, body }) {
  const problems = [];
  const words = String(body ?? '').split(/\s+/).filter(Boolean).length;
  if (!String(subject ?? '').trim()) problems.push('missing subject');
  if (String(subject ?? '').length > 90) problems.push('subject too long');
  if (words < 60) problems.push(`body too short (${words} words)`);
  if (words > 220) problems.push(`body too long (${words} words)`);
  if (!/https:\/\/\S+/.test(String(body ?? ''))) problems.push('body must link the demo');
  const questions = (String(body ?? '').match(/\?/g) || []).length;
  if (questions !== 1) problems.push(`body must ask exactly one question (found ${questions})`);
  for (const v of dashViolations(subject)) problems.push(`subject has ${v.kind}`);
  for (const v of dashViolations(body)) problems.push(`body has ${v.kind}`);
  return problems;
}
