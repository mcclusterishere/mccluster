/* Structural/source validation is not semantic verification. A validated model
   draft still requires an attributable human support review before publication. */
export function validateNewsBrief(analysis, evidence, targetId) {
  const reject = (reason) => { throw Object.assign(new Error(`news_brief_invalid: ${reason}`), { retryable: false }); };
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) reject('object required');
  const keys = ['summary', 'findings', 'assumptions', 'next_actions', 'support'];
  if (Object.keys(analysis).some((k) => !keys.includes(k)) || keys.some((k) => !(k in analysis))) reject('unexpected or missing fields');
  if (!evidence || `${evidence.day}:${evidence.country}` !== String(targetId)) reject('edition mismatch');
  const since = Date.parse(evidence.window?.since), until = Date.parse(evidence.window?.until);
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since || typeof evidence.timezone !== 'string') reject('reporting window required');
  let localDay;
  try {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: evidence.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    localDay = (at) => { const p = Object.fromEntries(format.formatToParts(at).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
    if (localDay(since) !== evidence.day || localDay(until - 1) !== evidence.day || localDay(until) === evidence.day) reject('reporting window mismatch');
  } catch { reject('invalid editorial timezone/window'); }
  if (!Array.isArray(evidence.headlines) || !evidence.headlines.length || evidence.headlines.length > 80) reject('bounded evidence required');
  const sources = new Map();
  for (const h of evidence.headlines) {
    if (!Number.isInteger(h.n) || h.n < 1 || sources.has(h.n) || typeof h.title !== 'string' || !h.title.trim()) reject('invalid source ID');
    if (h.country !== evidence.country) reject('source country mismatch');
    const at = Date.parse(h.discovered_at);
    if (!Number.isFinite(at) || at < since || at >= until || localDay(at) !== evidence.day) reject('source outside reporting window');
    sources.set(h.n, h);
  }
  const cited = (text, required = true) => {
    const ids = [...text.matchAll(/\[(\d+)\]/g)].map((m) => +m[1]);
    if (required && !ids.length) reject('citation required');
    if (ids.some((n) => !sources.has(n))) reject('unresolved citation');
    return ids;
  };
  const string = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008]/.test(value);
  if (!string(analysis.summary, 1200)) reject('invalid summary');
  cited(analysis.summary);
  const limits = { findings: [1, 8], assumptions: [1, 4], next_actions: [0, 6] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const list = analysis[key];
    if (!Array.isArray(list) || list.length < min || list.length > max || list.some((s) => !string(s, 600))) reject(`invalid ${key}`);
    for (const text of list) {
      cited(text, key !== 'assumptions');
      if (key === 'next_actions' && (!/\b(may|could|might)\b/i.test(text) || /\b(you should|you must|recommend(?:ed)? to)\s+(buy|sell|hold)\b/i.test(text))) reject('implications must be conditional');
    }
  }
  if (!Array.isArray(analysis.support) || analysis.support.length > 32) reject('invalid support');
  const supported = new Set();
  for (const s of analysis.support) {
    if (!s || Object.keys(s).sort().join(',') !== 'excerpt,finding_index,source_n' || !Number.isInteger(s.finding_index) || s.finding_index < 0 || s.finding_index >= analysis.findings.length) reject('invalid support reference');
    const source = sources.get(s.source_n);
    if (!source || !cited(analysis.findings[s.finding_index]).includes(s.source_n) || !string(s.excerpt, 250) || !source.title.includes(s.excerpt)) reject('support excerpt must resolve to the cited headline');
    supported.add(s.finding_index);
  }
  if (supported.size !== analysis.findings.length) reject('each finding needs a source excerpt');
  return { schema: 'news-brief/2', schema_valid: true, citations_resolved: true,
    source_excerpts_resolved: true, support_status: 'requires_human_review', publication_authorized: false };
}
