import { createHash } from 'node:crypto';

export const JOB_TYPE = 'student_opportunity_snapshot';
export const TARGET_ID = 'doe-undergraduate-paid';
export const SCHEMA = 'mccluster-student-opportunities/v1';
export const EXECUTOR = 'student_opportunity_snapshot:v1';
const ORIGIN = 'https://science.osti.gov';
const AGENT = 'McClusterOpportunityWatch';
const LIMIT = 512_000;
export const SOURCES = Object.freeze([
  Object.freeze({ id: 'suli', title: 'Science Undergraduate Laboratory Internships', audience: 'Undergraduates or recent graduates; read the official enrollment and credit rules.', path: '/wdts/suli', eligibility: '/wdts/suli/Eligibility' }),
  Object.freeze({ id: 'cci', title: 'Community College Internships', audience: 'Enrollment at a community college or accredited two-year college is required.', path: '/wdts/cci', eligibility: '/wdts/cci/Eligibility' }),
]);

function fail(code) { throw Object.assign(new Error(code), { code }); }

// Exact paths only. No links, redirects, caller-supplied endpoints or session credentials.
async function read(fetchImpl, path, signal, type) {
  const timeout = AbortSignal.timeout(8_000);
  const response = await fetchImpl(ORIGIN + path, {
    redirect: 'manual', credentials: 'omit', headers: { 'user-agent': AGENT, accept: type },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (response.status !== 200 || response.redirected) fail('source_http');
  if (!(response.headers.get('content-type') || '').toLowerCase().startsWith(type)) fail('source_media_type');
  if (Number(response.headers.get('content-length')) > LIMIT) fail('source_size');
  const stream = response.body?.getReader();
  if (!stream) fail('source_empty');
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMIT) fail('source_size');
      chunks.push(value);
    }
  } catch (error) {
    stream.cancel().catch(() => {});
    throw error;
  } finally { stream.releaseLock(); }
  if (!bytes) fail('source_empty');
  return Buffer.concat(chunks).toString('utf8');
}

// Conservative robots gate. Exact host audit plus runtime recheck; unsupported
// policy (including crawl-delay) is not assumed to allow anything.
export function robotsAllows(policy, path) {
  const groups = [];
  let group = null;
  for (const raw of policy.split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    const match = /^(user-agent|allow|disallow|crawl-delay|request-rate):\s*(.*?)\s*$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase(), value = match[2];
    if (field === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if (group) group.rules.push({ field, value });
  }
  const exact = groups.filter((g) => g.agents.includes(AGENT.toLowerCase()));
  const rules = (exact.length ? exact : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  if (!rules.length || rules.some(({ field, value }) => /crawl-delay|request-rate/.test(field) || /[*$%]/.test(value))) return false;
  const applicable = rules.filter(({ value }) => value && path.startsWith(value));
  applicable.sort((a, b) => b.value.length - a.value.length || Number(b.field === 'allow') - Number(a.field === 'allow'));
  return applicable[0]?.field !== 'disallow';
}

function normalize(html) {
  return html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/\s+/g, ' ');
}
const MONTH = /January|February|March|April|May|June|July|August|September|October|November|December/;
const easternOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' });
function deadline(dateText, hour, minute, part) {
  const day = new Date(`${dateText} 12:00 UTC`);
  if (!Number.isFinite(day.getTime()) || +dateText.match(/\d{1,2}(?=,)/)?.[0] !== day.getUTCDate()) return null;
  const clockHour = Number(hour), clockMinute = Number(minute);
  if (clockHour < 1 || clockHour > 12 || clockMinute > 59) return null;
  const offset = easternOffset.formatToParts(day).find((p) => p.type === 'timeZoneName')?.value?.slice(3);
  if (!/^[-+]\d\d:\d\d$/.test(offset || '')) return null;
  const hh = String(clockHour % 12 + (part.toLowerCase() === 'pm' ? 12 : 0)).padStart(2, '0');
  return new Date(`${day.toISOString().slice(0, 10)}T${hh}:${minute}:00${offset}`).toISOString();
}

export function parseAnnouncement(source, html, now) {
  const text = normalize(html);
  if (!new RegExp(`\\b${source.id} is a paid internship opportunity\\b`, 'i').test(text)) fail('paid_status_unconfirmed');
  const opening = new RegExp(`\\(${source.id}\\) Program is now (open|closed) for(?: for)? applications for the (Spring|Summer|Fall|Winter) (20\\d{2}) Term\\.`, 'gi');
  const due = new RegExp(`^ Applications are due (${MONTH.source}) (\\d{1,2}), (20\\d{2}) at (\\d{1,2}):(\\d{2}) ?(am|pm) ET\\b`, 'i');
  const lifecycle = new Map();
  let total = 0;
  for (const match of text.matchAll(opening)) {
    if (++total > 12) fail('source_format');
    const term = `${match[2][0].toUpperCase()}${match[2].slice(1).toLowerCase()} ${match[3]}`;
    const key = `${source.id}:${term.toLowerCase().replace(' ', '-')}`;
    if (match[1].toLowerCase() === 'closed') { lifecycle.set(key, null); continue; }
    const next = text.slice(match.index + match[0].length, match.index + match[0].length + 130);
    const time = next.match(due);
    if (!time) fail('deadline_unconfirmed');
    const dueAt = deadline(`${time[1]} ${time[2]}, ${time[3]}`, time[4], time[5], time[6]);
    if (!dueAt) fail('deadline_unconfirmed');
    const remaining = Date.parse(dueAt) - now.getTime();
    if (remaining <= 0 || remaining > 366 * 86400_000) continue;
    const existing = lifecycle.get(key);
    if (existing === null || (existing && existing.deadline_at !== dueAt)) fail('announcement_conflict');
    lifecycle.set(key, { id: key, title: source.title, term, deadline_at: dueAt, paid: true,
      source: ORIGIN + source.path, eligibility: ORIGIN + source.eligibility, audience: source.audience,
      next_step: 'Check the official eligibility rules and application details before applying.' });
  }
  if (!total) fail('announcement_unconfirmed');
  return [...lifecycle.values()].filter(Boolean);
}

export async function observeOpportunities({ fetchImpl = fetch, now = new Date(), prior = {}, signal } = {}) {
  const known = new Map(Object.entries(prior || {}).filter(([id, hash]) =>
    /^(cci|suli):(fall|spring|summer|winter)-20\d\d$/.test(id) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)
  ).slice(-32));
  const observations = [], opportunities = [];
  let policy;
  try { policy = await read(fetchImpl, '/robots.txt', signal, 'text/plain'); }
  catch { if (signal?.aborted) throw signal.reason; }
  for (const source of SOURCES) {
    try {
      if (!policy || !robotsAllows(policy, source.path)) fail('robots_not_cleared');
      const html = await read(fetchImpl, source.path, signal, 'text/html');
      const items = parseAnnouncement(source, html, now);
      for (const item of items) {
        const hash = createHash('sha256').update(JSON.stringify(item)).digest('hex');
        const previous = known.get(item.id);
        known.delete(item.id); known.set(item.id, hash);
        opportunities.push({ ...item, change: !previous ? 'new' : previous === hash ? 'unchanged' : 'updated' });
      }
      observations.push({ id: source.id, source: ORIGIN + source.path, state: 'observed', open: items.length });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const reason = ['robots_not_cleared', 'source_http', 'source_media_type', 'source_size', 'source_empty', 'paid_status_unconfirmed', 'deadline_unconfirmed', 'announcement_unconfirmed', 'source_format', 'announcement_conflict'].includes(error?.code) ? error.code : 'source_unavailable';
      observations.push({ id: source.id, source: ORIGIN + source.path, state: 'unavailable', reason });
    }
  }
  const observed = observations.filter((row) => row.state === 'observed').length;
  return { executor: EXECUTOR, schema: SCHEMA, checked_at: now.toISOString(), state: observed === SOURCES.length ? 'observed' : observed ? 'partial' : 'unavailable',
    observations, opportunities, known: Object.fromEntries([...known].slice(-32)) };
}
