// PII minimization shared by every source pipeline. Raw addresses never leave this module: callers get a keyed
// hash (HMAC-SHA256 with MCCLUSTER_PII_HASH_KEY) and, where useful, the domain. Free text is redacted and cut short.
import { createHmac } from 'node:crypto';

export const HASH_RE = /^[0-9a-f]{64}$/;

export function requireHashKey(key) {
  const k = String(key || '');
  if (k.length < 32) {
    throw Object.assign(new Error('MCCLUSTER_PII_HASH_KEY must be set to at least 32 characters'), { code: 'PII_KEY_MISSING' });
  }
  return k;
}

export function keyedHash(value, key) {
  return createHmac('sha256', requireHashKey(key)).update(String(value)).digest('hex');
}

// "Name <a.b+tag@Gmail.com>" -> "ab@gmail.com". Plus tags are dropped everywhere; dots only where Gmail ignores them.
export function normalizeEmail(raw) {
  const s = String(raw || '').trim();
  const angle = s.match(/<([^<>]+)>/);
  const addr = (angle ? angle[1] : s).trim().toLowerCase().replace(/^mailto:/, '');
  const m = addr.match(/^([^\s@]+)@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!m) return null;
  let [, local, domain] = m;
  local = local.split('+')[0];
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) return null;
  return `${local}@${domain}`;
}

export function emailDomain(normalized) {
  const at = String(normalized || '').lastIndexOf('@');
  return at > 0 ? normalized.slice(at + 1) : null;
}

// Split an address header on commas outside quotes and angle brackets.
export function parseAddressList(header) {
  const out = [];
  let cur = '';
  let quoted = false;
  let angle = 0;
  for (const ch of String(header || '')) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '<' && !quoted) angle += 1;
    else if (ch === '>' && !quoted) angle = Math.max(0, angle - 1);
    if ((ch === ',' || ch === ';') && !quoted && angle === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(normalizeEmail).filter(Boolean);
}

// Free text (subjects, event titles, metadata values): no addresses, links, phone numbers, codes or long digit runs.
export function redactText(value, max = 140) {
  if (value == null) return null;
  let s = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[link]')
    .replace(/\bwww\.\S+/gi, '[link]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/\b\d{4,}\b/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s;
}

export function uniq(values, cap) {
  return [...new Set(values.filter(Boolean))].slice(0, cap);
}
