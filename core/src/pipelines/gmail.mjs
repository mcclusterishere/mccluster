// Gmail -> ai_context.source_messages. Reads message METADATA only (format=metadata, scope gmail.metadata):
// Gmail never sends a body to this code. Output carries ids, time, labels, direction, keyed counterparty hashes,
// counterparty domains and, only when asked, a redacted subject.
import { googleGet } from './google-oauth.mjs';
import { compact, assertAllowed } from './allow-list.mjs';
import { keyedHash, normalizeEmail, parseAddressList, emailDomain, redactText, uniq } from './pii.mjs';

const SKIP_LABELS = new Set(['SPAM', 'TRASH', 'DRAFT']);
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

function header(msg, name) {
  const h = (msg?.payload?.headers || []).find((x) => String(x.name).toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function countAttachments(part) {
  if (!part) return 0;
  let n = part.filename ? 1 : 0;
  for (const p of part.parts || []) n += countAttachments(p);
  return n;
}

// Accepts the Gmail API message resource (format=metadata) or a connector envelope
// ({ id, threadId, from, to, cc, subject, date, labelIds }). Returns null for spam, trash and drafts.
export function normalizeGmailMessage(msg, { hashKey, selfAddresses = [], includeSubject = false } = {}) {
  if (!msg?.id) return null;
  const labels = (msg.labelIds || []).map(String);
  if (labels.some((l) => SKIP_LABELS.has(l))) return null;
  const self = new Set(selfAddresses.map(normalizeEmail).filter(Boolean));
  const from = parseAddressList(msg.payload ? header(msg, 'From') : msg.from);
  const to = parseAddressList(msg.payload ? header(msg, 'To') : msg.to);
  const cc = parseAddressList(msg.payload ? header(msg, 'Cc') : msg.cc);
  const subject = msg.payload ? header(msg, 'Subject') : msg.subject;
  const ms = Number(msg.internalDate) || Date.parse(msg.date || (msg.payload ? header(msg, 'Date') : ''));
  if (!Number.isFinite(ms)) return null;

  const fromSelf = from.some((a) => self.has(a));
  const recipients = [...to, ...cc];
  const others = (fromSelf ? recipients : [...from, ...recipients]).filter((a) => !self.has(a));
  const direction = fromSelf ? (others.length ? 'out' : 'self') : 'in';
  const parties = uniq(others, 50);

  return assertAllowed('google.gmail', compact({
    external_id: String(msg.id),
    thread_id: msg.threadId ? String(msg.threadId) : null,
    occurred_at: new Date(ms).toISOString(),
    direction,
    labels: uniq(labels, 40),
    counterparty_hashes: parties.map((a) => keyedHash(a, hashKey)),
    counterparty_domains: uniq(parties.map(emailDomain), 50),
    subject_redacted: includeSubject ? redactText(subject, 140) : null,
    attachment_count: Math.min(500, countAttachments(msg.payload)),
  }));
}

// Newest-first listing that stops at the stored high-water mark. A long backlog is walked over several runs:
// the cursor keeps the page token and the high-water mark until the walk reaches the previous mark.
export async function pullGmail({ token, cursor = {}, now = Date.now(), backfillDays = 30, maxPages = 10, pageSize = 100, fetchImpl = fetch }) {
  const afterMs = Number(cursor.after_ms) || now - backfillDays * 86_400_000;
  let pageToken = cursor.page_token || null;
  let highWater = Number(cursor.high_water_ms) || 0;
  const messages = [];
  let reached = false;
  let pages = 0;
  while (pages < maxPages) {
    const qs = new URLSearchParams({ maxResults: String(pageSize), includeSpamTrash: 'false' });
    if (pageToken) qs.set('pageToken', pageToken);
    const list = await googleGet(`${API}/messages?${qs}`, token, fetchImpl);
    pages += 1;
    for (const { id } of list.messages || []) {
      const mq = new URLSearchParams({ format: 'metadata' });
      for (const h of ['From', 'To', 'Cc', 'Subject', 'Date']) mq.append('metadataHeaders', h);
      const msg = await googleGet(`${API}/messages/${encodeURIComponent(id)}?${mq}`, token, fetchImpl);
      const at = Number(msg.internalDate) || 0;
      if (at <= afterMs) { reached = true; break; }
      highWater = Math.max(highWater, at);
      messages.push(msg);
    }
    pageToken = list.nextPageToken || null;
    if (reached || !pageToken) { reached = true; break; }
  }
  const next = reached
    ? { after_ms: Math.max(afterMs, highWater) }
    : { after_ms: afterMs, page_token: pageToken, high_water_ms: highWater };
  return { items: messages, cursor: next, complete: reached };
}
