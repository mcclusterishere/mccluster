// McCluster entity resolution: deterministic match keys, fuzzy scoring and
// confidence bands for ontology objects that describe the same real person or
// organization. Pure functions only: no network, no clock, no randomness, so the
// same objects always produce the same candidates, scores and request hashes.
//
// What this module never does: merge, rewrite or delete a record. It proposes a
// reversible "same as" link between two objects; the database decides whether
// that link is written straight away (high confidence, strong key) or held for
// the owner in Control (mid confidence). Contract: docs/control-plane/ENTITY-RESOLUTION.md
import { createHash } from 'node:crypto';

export const MATCHER_VERSION = 'entity-match:v1';

// The database enforces the same floor (supabase/pending/*_ai_context_entity_resolution_v1.sql):
// a caller may raise these, never lower them.
export const THRESHOLDS = Object.freeze({
  auto: 0.95,   // at or above, with a strong exact key: linked automatically (reversible)
  review: 0.75, // at or above (and below auto, or auto without a strong key): owner review queue
});
export const STRONG_KEYS = Object.freeze(['email', 'phone', 'domain']);

// Object families. Two objects are compared only inside one family, so a lead
// can match a client (a converted lead is the commonest duplicate) but a person
// never matches a company. 'organization' is deliberately absent: in the
// ontology that type is a McCluster tenant, not a contact record.
export const FAMILIES = Object.freeze({
  person: Object.freeze(['person', 'contact', 'client', 'lead', 'customer', 'prospect', 'artist', 'creator', 'member', 'attendee', 'subscriber', 'photographer', 'talent', 'buyer', 'fan']),
  company: Object.freeze(['company', 'business', 'venue', 'vendor', 'partner', 'sponsor', 'account', 'brand', 'school', 'church', 'nonprofit', 'label', 'employer', 'customer_org']),
});
export const DEFAULT_TYPE_KEYS = Object.freeze([...FAMILIES.person, ...FAMILIES.company]);

export function familyOf(typeKey) {
  for (const [family, types] of Object.entries(FAMILIES)) if (types.includes(typeKey)) return family;
  return null;
}

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'optonline.net', 'cox.net', 'charter.net', 'yandex.com',
]);
// Shared inboxes identify an organization, not a person.
const ROLE_LOCAL = /^(info|contact|hello|hi|admin|office|team|support|sales|booking|bookings|events|press|media|marketing|billing|accounts|noreply|no-reply|mail|enquiries|inquiries|help|general)$/;
const HONORIFIC = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'rev', 'pastor', 'sir', 'dame']);
const NAME_SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq']);
const ORG_SUFFIX = new Set(['inc', 'incorporated', 'llc', 'l.l.c', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'lp', 'llp', 'pllc', 'group', 'the', 'and']);

function fold(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function normalizeEmail(value) {
  const raw = fold(value).replace(/^mailto:/, '');
  const m = raw.match(/^([^\s@<>()]+)@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!m) return null;
  let [, local, domain] = m;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  local = local.split('+')[0];
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) return null;
  return `${local}@${domain}`;
}

export function isRoleEmail(email) {
  const local = String(email || '').split('@')[0];
  return ROLE_LOCAL.test(local);
}

// Digits only; a 10-digit North American number gains its country code so
// "(203) 555-0147" and "+1 203.555.0147" are the same key. Too-short numbers
// (extensions, shortcodes) are not keys at all.
export function normalizePhone(value) {
  const raw = String(value ?? '').split(/\s*(?:x|ext\.?|extension|#)\s*\d+$/i)[0];
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) digits = `1${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  if (/^(\d)\1+$/.test(digits.slice(1))) return null; // 555-555-5555 style junk
  return `+${digits}`;
}

export function normalizeDomain(value) {
  let raw = fold(value);
  if (!raw) return null;
  if (raw.includes('@') && !raw.includes('/')) raw = raw.split('@').pop();
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:]/)[0].replace(/^www\d?\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(raw)) return null;
  if (FREE_MAIL.has(raw)) return null;
  return raw;
}

function tokens(value) {
  return fold(value).replace(/&/g, ' and ').replace(/[^a-z0-9\s'-]/g, ' ').replace(/['-]/g, '').split(/\s+/).filter(Boolean);
}

export function normalizePersonName(value) {
  const parts = tokens(value).filter((t) => !HONORIFIC.has(t) && !NAME_SUFFIX.has(t));
  return parts.length ? parts.join(' ') : null;
}

export function normalizeOrgName(value) {
  const parts = tokens(String(value ?? '').replace(/\bl\.l\.c\.?/gi, 'llc')).filter((t) => !ORG_SUFFIX.has(t));
  return parts.length ? parts.join(' ') : null;
}

// Jaro-Winkler similarity on normalized strings, 0..1.
export function jaroWinkler(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j += 1) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = true; bm[j] = true; matches += 1; break;
    }
  }
  if (!matches) return 0;
  let t = 0; let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!am[i]) continue;
    while (!bm[k]) k += 1;
    if (a[i] !== b[k]) t += 1;
    k += 1;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

// Token-order-insensitive name similarity: "McCluster, Matthew" ~ "Matthew McCluster".
export function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const sa = a.split(' ').sort().join(' ');
  const sb = b.split(' ').sort().join(' ');
  return Math.max(jaroWinkler(a, b), jaroWinkler(sa, sb));
}

function list(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(list);
  if (typeof value === 'object') return list(value.value ?? value.address ?? value.email ?? value.number ?? value.phone ?? null);
  return String(value).split(/[;,]\s*/).filter(Boolean);
}

function pick(props, keys) {
  const out = [];
  for (const key of keys) out.push(...list(props?.[key]));
  return out;
}

// Pull comparable identity fields out of one ontology object. Property names
// differ by source (CRM leads, Stripe customers, Gmail contacts, calendar
// attendees), so this reads the common spellings and nested contact blocks.
export function extractIdentity(object) {
  const props = object?.properties && typeof object.properties === 'object' ? object.properties : {};
  const contact = props.contact && typeof props.contact === 'object' ? props.contact : {};
  const family = familyOf(object?.type_key);
  const emails = [...new Set([
    ...pick(props, ['email', 'emails', 'email_address', 'contact_email', 'primary_email', 'work_email', 'billing_email']),
    ...pick(contact, ['email', 'emails']),
  ].map(normalizeEmail).filter(Boolean))].sort();
  const phones = [...new Set([
    ...pick(props, ['phone', 'phones', 'phone_number', 'mobile', 'cell', 'contact_phone', 'work_phone']),
    ...pick(contact, ['phone', 'phones', 'mobile']),
  ].map(normalizePhone).filter(Boolean))].sort();
  const websiteDomains = pick(props, ['domain', 'website', 'url', 'site', 'homepage', 'company_domain', 'company_website']).map(normalizeDomain).filter(Boolean);
  const emailDomains = emails.map((e) => normalizeDomain(e.split('@')[1])).filter(Boolean);
  const domains = [...new Set(family === 'company' ? [...websiteDomains, ...emailDomains] : websiteDomains)].sort();
  let name = null;
  let org = null;
  if (family === 'company') {
    name = normalizeOrgName(pick(props, ['name', 'company', 'company_name', 'business_name', 'legal_name', 'org_name'])[0] || object?.display_name);
  } else {
    const first = pick(props, ['first_name', 'given_name'])[0];
    const last = pick(props, ['last_name', 'family_name', 'surname'])[0];
    name = normalizePersonName(pick(props, ['full_name', 'name', 'contact_name'])[0] || (first || last ? `${first || ''} ${last || ''}` : '') || object?.display_name);
    org = normalizeOrgName(pick(props, ['company', 'company_name', 'organization', 'org', 'org_name', 'business', 'business_name', 'employer'])[0]);
  }
  return {
    id: object?.id,
    type_key: object?.type_key,
    family,
    emails,
    personal_emails: emails.filter((e) => !isRoleEmail(e)),
    role_emails: emails.filter(isRoleEmail),
    phones,
    domains,
    name,
    org,
  };
}

// Deterministic match keys. Exact keys (email, phone, domain, name+org) are the
// evidence; the two block keys only decide which pairs get a fuzzy comparison.
export function matchKeys(identity) {
  const keys = [];
  const fam = identity.family;
  for (const e of identity.personal_emails) keys.push(`${fam}|email|${e}`);
  for (const e of identity.role_emails) keys.push(`${fam}|role_email|${e}`);
  for (const p of identity.phones) keys.push(`${fam}|phone|${p}`);
  for (const d of identity.domains) keys.push(`${fam}|domain|${d}`);
  if (identity.name && identity.org) keys.push(`${fam}|name_org|${identity.name}|${identity.org}`);
  if (identity.name) {
    keys.push(`${fam}|name|${identity.name}`);
    const parts = identity.name.split(' ');
    if (fam === 'person' && parts.length >= 2) {
      const sorted = [...parts].sort();
      keys.push(`${fam}|block|${parts[parts.length - 1]}|${parts[0][0]}`);
      keys.push(`${fam}|block|${sorted[sorted.length - 1]}|${sorted[0][0]}`);
    }
    if (fam === 'company') keys.push(`${fam}|block|${identity.name.replace(/\s/g, '').slice(0, 6)}`);
  }
  return [...new Set(keys)];
}

// Two person names that share a surname but carry incompatible first names
// ("Jordan Lee" / "Morgan Lee") are a conflict, however similar the strings look.
// Compatible: equal, an initial, a prefix ("Alex"/"Alexandra", "Matt"/"Matthew") or a near spelling ("Jon"/"John").
export function personNameConflict(a, b) {
  if (!a || !b) return false;
  const ta = a.split(' ');
  const tb = b.split(' ');
  const shared = ta.filter((t) => tb.includes(t));
  if (!shared.length) return nameSimilarity(a, b) < 0.7;
  const ra = ta.filter((t) => !shared.includes(t));
  const rb = tb.filter((t) => !shared.includes(t));
  if (!ra.length || !rb.length) return false;
  const [x, y] = [ra[0], rb[0]];
  if (x === y || x[0] === y && y.length === 1 || y[0] === x && x.length === 1) return false;
  if (x.startsWith(y) || y.startsWith(x)) return false;
  return jaroWinkler(x, y) < 0.88;
}

const hashValue = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const overlap = (a, b) => a.filter((x) => b.includes(x));
const round3 = (x) => Math.round(x * 1000) / 1000;

// Score one pair. Returns null when the pair is not comparable. Evidence never
// carries raw emails or phone numbers: only the key kind and a short hash, so
// the audit trail does not become a second copy of anyone's contact details.
export function scorePair(a, b, { ignore = new Set() } = {}) {
  if (!a?.family || a.family !== b?.family || a.id === b.id) return null;
  const keep = (kind) => (value) => !ignore.has(`${a.family}|${kind}|${value}`);
  const evidence = [];
  const weights = [];
  const add = (kind, weight, detail = {}) => { evidence.push({ kind, weight, ...detail }); weights.push(weight); };

  // A key value shared by an oversized block is a placeholder, not evidence.
  const emails = overlap(a.personal_emails, b.personal_emails).filter(keep('email'));
  const roleEmails = overlap(a.role_emails, b.role_emails).filter(keep('role_email'));
  const phones = overlap(a.phones, b.phones).filter(keep('phone'));
  const domains = overlap(a.domains, b.domains).filter(keep('domain'));
  const nameSim = a.name && b.name ? round3(nameSimilarity(a.name, b.name)) : null;
  const nameConflict = nameSim !== null && (a.family === 'person' ? personNameConflict(a.name, b.name) : nameSim < 0.7);

  if (a.family === 'person') {
    if (emails.length) add('email', 0.97, { hash: hashValue(emails[0]) });
    if (roleEmails.length) add('role_email', 0.5, { hash: hashValue(roleEmails[0]) });
    if (phones.length) add('phone', 0.92, { hash: hashValue(phones[0]) });
    if (domains.length) add('domain_shared', 0.3, { hash: hashValue(domains[0]) });
    if (a.name && b.name && a.org && b.org && a.name === b.name && a.org === b.org) add('name_org', 0.85);
    else if (nameSim === 1) add('name_exact', 0.5);
    else if (nameSim >= 0.92 && !nameConflict) add('name_fuzzy', 0.4, { similarity: nameSim });
    if (!nameConflict && nameSim !== null && nameSim < 1 && nameSim >= 0.88 && a.org && b.org && nameSimilarity(a.org, b.org) >= 0.92) add('name_org_fuzzy', 0.45, { similarity: nameSim });
  } else {
    if (domains.length) add('domain', 0.9, { hash: hashValue(domains[0]) });
    if (phones.length) add('phone', 0.85, { hash: hashValue(phones[0]) });
    if (emails.length || roleEmails.length) add('email', 0.8, { hash: hashValue((emails[0] || roleEmails[0])) });
    if (nameSim === 1) add('name_exact', 0.8);
    else if (nameSim >= 0.92) add('name_fuzzy', 0.5, { similarity: nameSim });
  }
  if (!weights.length) return null;

  let score = 1 - weights.reduce((p, w) => p * (1 - w), 1);
  const penalties = [];
  // Same phone or inbox, clearly different names: a household, a front desk, a
  // shared booking line. Possibly a duplicate, never an automatic one.
  if (nameConflict) { score *= 0.85; penalties.push({ kind: 'name_conflict', factor: 0.85, similarity: nameSim }); }
  if (a.family === 'person' && a.personal_emails.length && b.personal_emails.length && !emails.length) {
    score *= 0.9; penalties.push({ kind: 'email_conflict', factor: 0.9 });
  }
  if (a.family === 'company' && a.domains.length && b.domains.length && !domains.length) {
    score *= 0.85; penalties.push({ kind: 'domain_conflict', factor: 0.85 });
  }
  score = round3(score);
  const strong = evidence.some((e) => STRONG_KEYS.includes(e.kind));
  return { score, strong, evidence: evidence.map((e) => ({ ...e })), penalties, name_similarity: nameSim };
}

export function bandFor(scored, thresholds = THRESHOLDS) {
  const auto = Math.max(THRESHOLDS.auto, Number(thresholds?.auto ?? THRESHOLDS.auto));
  const review = Math.max(THRESHOLDS.review, Number(thresholds?.review ?? THRESHOLDS.review));
  if (!scored) return 'none';
  if (scored.score >= auto && scored.strong) return 'auto';
  if (scored.score >= review) return 'review';
  return 'none';
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function requestHash({ orgId, leftId, rightId, score, evidence, matcherVersion = MATCHER_VERSION }) {
  return createHash('sha256')
    .update(stableJson({ org_id: orgId, left: leftId, right: rightId, score, evidence: (evidence || []).map((e) => e.kind).sort(), matcher: matcherVersion }))
    .digest('hex');
}

// Find candidate pairs across a set of objects. Blocks bigger than maxBlock are
// skipped (and reported): a key shared by hundreds of records is a placeholder
// ("n/a", a venue's front desk), not identity.
export function findCandidates(objects, { orgId, thresholds = THRESHOLDS, maxBlock = 50, maxPairs = 20000 } = {}) {
  const identities = new Map();
  for (const o of objects || []) {
    if (!o?.id || !familyOf(o.type_key)) continue;
    identities.set(o.id, extractIdentity(o));
  }
  const blocks = new Map();
  for (const identity of identities.values()) {
    for (const key of matchKeys(identity)) {
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key).push(identity.id);
    }
  }
  const pairs = new Set();
  const oversized = [];
  const ignore = new Set();
  for (const [key, ids] of [...blocks.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (ids.length < 2) continue;
    if (ids.length > maxBlock) { oversized.push({ key_kind: key.split('|')[1], size: ids.length }); ignore.add(key); continue; }
    const sorted = [...ids].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (pairs.size >= maxPairs) break;
        pairs.add(`${sorted[i]}|${sorted[j]}`);
      }
    }
  }
  const candidates = [];
  let below = 0;
  for (const pair of [...pairs].sort()) {
    const [leftId, rightId] = pair.split('|');
    const left = identities.get(leftId);
    const right = identities.get(rightId);
    const scored = scorePair(left, right, { ignore });
    const band = bandFor(scored, thresholds);
    if (band === 'none') { if (scored) below += 1; continue; }
    candidates.push({
      left_object_id: leftId,
      right_object_id: rightId,
      left_type: left.type_key,
      right_type: right.type_key,
      family: left.family,
      score: scored.score,
      band,
      strong_key: scored.strong,
      evidence: { keys: scored.evidence, penalties: scored.penalties, name_similarity: scored.name_similarity },
      matcher_version: MATCHER_VERSION,
      request_hash: requestHash({ orgId, leftId, rightId, score: scored.score, evidence: scored.evidence }),
    });
  }
  return {
    objects_scanned: identities.size,
    pairs_compared: pairs.size,
    below_threshold: below,
    oversized_blocks: oversized,
    pair_cap_reached: pairs.size >= maxPairs,
    candidates,
  };
}
