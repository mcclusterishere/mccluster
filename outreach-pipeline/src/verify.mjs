/* Verification. Two hard gates:
   1. Email: must be PUBLISHED. We only accept an address whose exact string appears in content we fetched
      from a stored URL. Addresses are never guessed or built from a name pattern, and data broker or
      people search pages never count.
   2. Wealth (frames A and B only): a public signal of $1M or more, with the source URL, from a named kind
      of source (Forbes, Bloomberg, a reported exit, a disclosed pay or ownership filing). The fetched page
      must name the person and state the dollar figure. Frame C has no floor; its gate is a sourced role. */
import { EMAIL_RE } from './text-rules.mjs';
import { hostOf, registrable } from './fetch-page.mjs';
import { WEALTH_FLOOR_USD } from './config.mjs';

export const BROKER_HOSTS = ['rocketreach.co', 'zoominfo.com', 'contactout.com', 'apollo.io', 'signalhire.com', 'lusha.com', 'hunter.io',
  'clearbit.com', 'seamless.ai', 'leadiq.com', 'adapt.io', 'snov.io', 'voilanorbert.com', 'uplead.com', 'aeroleads.com', 'getemail.io',
  'spokeo.com', 'whitepages.com', 'beenverified.com', 'truepeoplesearch.com', 'fastpeoplesearch.com', 'radaris.com', 'peekyou.com',
  'crunchbase.com', 'pitchbook.com', 'cbinsights.com', 'theorg.com', 'datanyze.com', 'lead411.com', 'skrapp.io', 'emailsherlock.com'];
const GENERIC_LOCAL = /^(info|contact|hello|press|media|support|admin|team|office|jobs|careers|sales|privacy|legal|noreply|no-reply|webmaster|news|events|help|partners|invest|ir)$/i;

export const WEALTH_SOURCES = [
  { kind: 'forbes', hosts: ['forbes.com'] },
  { kind: 'bloomberg', hosts: ['bloomberg.com'] },
  { kind: 'disclosed_pay', hosts: ['sec.gov'] },
  { kind: 'reported_exit', hosts: ['reuters.com', 'wsj.com', 'nytimes.com', 'ft.com', 'cnbc.com', 'techcrunch.com', 'axios.com', 'fortune.com',
    'businessinsider.com', 'theinformation.com', 'apnews.com', 'bbc.com', 'theverge.com', 'wired.com', 'fastcompany.com', 'inc.com', 'geekwire.com',
    'venturebeat.com', 'washingtonpost.com', 'latimes.com', 'bostonglobe.com', 'prnewswire.com', 'businesswire.com', 'globenewswire.com'] },
];

const lastName = (name) => String(name).trim().split(/\s+/).slice(-1)[0];
const firstName = (name) => String(name).trim().split(/\s+/)[0];
const isBroker = (host) => BROKER_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));

/* All addresses on a page that plausibly belong to the person. */
export function emailsOnPage(page, name) {
  if (!page?.ok) return [];
  const host = hostOf(page.url);
  if (isBroker(host)) return [];
  const last = lastName(name).toLowerCase();
  const first = firstName(name).toLowerCase();
  if (!page.text.toLowerCase().includes(last)) return [];
  const found = new Set([...(page.raw.match(EMAIL_RE) || []), ...(page.text.match(EMAIL_RE) || [])].map((e) => e.replace(/\.$/, '')));
  const out = [];
  for (const email of found) {
    const [local, domain] = email.toLowerCase().split('@');
    if (!domain || GENERIC_LOCAL.test(local)) continue;
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(domain)) continue;
    const sameSite = registrable(domain) === registrable(host);
    const nameInLocal = local.includes(last) || local.includes(first) || local === first[0] + last || local === first + last[0];
    if (!sameSite && !nameInLocal) continue;
    /* literal rule: the exact address string must be on what we fetched */
    const literal = page.raw.includes(email) ? 'raw' : page.text.includes(email) ? 'decoded_text' : null;
    if (!literal) continue;
    const idx = page.text.indexOf(email);
    out.push({ email, url: page.url, literal, sameSite, nameInLocal, excerpt: page.text.slice(Math.max(0, idx - 120), idx + email.length + 60), sha256: page.sha256, fetchedAt: page.fetchedAt });
  }
  return out;
}

export async function findPublishedEmail({ person, search, fetchPage, knownUrls = [] }) {
  const urls = new Set(knownUrls);
  for (const q of [`"${person.name}" email`, `"${person.name}" contact`, `"${person.name}" ${person.organization || ''} "email me"`.trim()]) {
    for (const r of await search.search(q, { count: 10 })) if (r?.url && !isBroker(hostOf(r.url))) urls.add(r.url);
  }
  const hits = [];
  for (const url of [...urls].slice(0, 12)) hits.push(...emailsOnPage(await fetchPage(url), person.name));
  /* Prefer an address on the person's own site, then one with their name in it. */
  hits.sort((a, b) => (b.sameSite + b.nameInLocal) - (a.sameSite + a.nameInLocal));
  return hits[0] || null;
}

const MONEY_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(billion|million|bn|mm|b|m)?\b/gi;
export function parseUsd(match) {
  const [, num, unitRaw] = match;
  const n = Number(String(num).replace(/,/g, ''));
  const unit = String(unitRaw || '').toLowerCase();
  if (unit === 'billion' || unit === 'bn' || unit === 'b') return n * 1e9;
  if (unit === 'million' || unit === 'mm' || unit === 'm') return n * 1e6;
  return n;
}
export function wealthKind(url) {
  const host = hostOf(url);
  for (const s of WEALTH_SOURCES) if (s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return s.kind;
  return null;
}

/* A page counts when it is from a recognized source kind, names the person, and a dollar figure of at least
   $1M sits within 400 characters of their last name. */
export function wealthSignalOnPage(page, name) {
  if (!page?.ok) return null;
  const kind = wealthKind(page.url);
  if (!kind) return null;
  const text = page.text;
  const last = lastName(name);
  if (!text.includes(name) && !text.includes(last)) return null;
  let best = null;
  for (const m of text.matchAll(MONEY_RE)) {
    const usd = parseUsd(m);
    if (usd < WEALTH_FLOOR_USD) continue;
    const window = text.slice(Math.max(0, m.index - 400), m.index + 400);
    if (!window.includes(last)) continue;
    if (!best || usd > best.amountUsd) best = { kind, amountUsd: usd, url: page.url, excerpt: text.slice(Math.max(0, m.index - 160), m.index + 120), sha256: page.sha256, fetchedAt: page.fetchedAt };
  }
  return best;
}

export async function findWealthSignal({ person, search, fetchPage }) {
  const queries = [`"${person.name}" net worth Forbes`, `"${person.name}" Bloomberg billionaire OR stake`, `"${person.name}" acquired for million`,
    `"${person.name}" ${person.organization || ''} sold OR IPO OR acquisition`.trim(), `"${person.name}" compensation proxy statement sec.gov`];
  const urls = new Set();
  for (const q of queries) for (const r of await search.search(q, { count: 10 })) if (r?.url && wealthKind(r.url)) urls.add(r.url);
  let best = null;
  for (const url of [...urls].slice(0, 10)) {
    const s = wealthSignalOnPage(await fetchPage(url), person.name);
    if (s && (!best || s.amountUsd > best.amountUsd)) best = s;
  }
  return best;
}

/* Frame C still needs a sourced role: a fetched page that names the person with their role or organization. */
export async function verifyRole({ person, fetchPage }) {
  for (const src of person.discoverySources || []) {
    const page = await fetchPage(src.url);
    if (!page.ok) continue;
    const t = page.text;
    if (t.includes(person.name) && (!person.organization || t.includes(person.organization.split(/\s+/)[0]))) {
      return { url: page.url, excerpt: t.slice(Math.max(0, t.indexOf(person.name) - 80), t.indexOf(person.name) + 200), sha256: page.sha256, fetchedAt: page.fetchedAt };
    }
  }
  return null;
}
