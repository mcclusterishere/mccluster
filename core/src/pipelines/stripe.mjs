// Stripe -> ai_context.source_payments. Read-only: charges, refunds, invoices and customers through a
// restricted key (rk_...). Card details, names, addresses and descriptions are dropped; emails become keyed hashes.
import { compact, assertAllowed } from './allow-list.mjs';
import { keyedHash, normalizeEmail, redactText } from './pii.mjs';

export const STRIPE_TYPES = Object.freeze({ charge: 'charges', refund: 'refunds', invoice: 'invoices', customer: 'customers' });
export const DEFAULT_METADATA_ALLOW = Object.freeze(['offer', 'product', 'package', 'order_id', 'event_type', 'source', 'tier']);

function emailHash(raw, hashKey) {
  const e = normalizeEmail(raw);
  return e ? keyedHash(e, hashKey) : null;
}

function idOrNull(v, re) {
  const id = typeof v === 'string' ? v : v?.id;
  return id && re.test(id) ? id : null;
}

function pickMetadata(meta, allow) {
  const out = {};
  for (const k of allow) {
    if (meta && typeof meta[k] === 'string' && meta[k]) out[k] = redactText(meta[k], 100);
  }
  return out;
}

export function normalizeStripeObject(obj, { hashKey, metadataAllow = DEFAULT_METADATA_ALLOW } = {}) {
  if (!obj?.id || !obj.object) return null;
  const base = {
    external_id: obj.id,
    occurred_at: new Date(Number(obj.created) * 1000).toISOString(),
    livemode: Boolean(obj.livemode),
    currency: obj.currency ? String(obj.currency).toLowerCase() : null,
    metadata: pickMetadata(obj.metadata, metadataAllow),
  };
  let rec;
  switch (obj.object) {
    case 'charge':
      rec = { ...base, object_type: 'charge', status: obj.status, amount_minor: obj.amount, amount_refunded_minor: obj.amount_refunded ?? 0,
        customer_id: idOrNull(obj.customer, /^cus_/), related_id: idOrNull(obj.payment_intent, /^pi_/) || idOrNull(obj.invoice, /^in_/),
        email_hash: emailHash(obj.billing_details?.email || obj.receipt_email, hashKey) };
      break;
    case 'refund':
      rec = { ...base, object_type: 'refund', status: obj.status, amount_minor: obj.amount, related_id: idOrNull(obj.charge, /^(ch|py)_/) };
      break;
    case 'invoice':
      rec = { ...base, object_type: 'invoice', status: obj.status, amount_minor: obj.amount_paid ?? obj.total ?? null,
        customer_id: idOrNull(obj.customer, /^cus_/), related_id: idOrNull(obj.subscription, /^sub_/),
        email_hash: emailHash(obj.customer_email, hashKey) };
      break;
    case 'customer':
      rec = { ...base, object_type: 'customer', currency: null, status: obj.deleted ? 'deleted' : 'active', email_hash: emailHash(obj.email, hashKey) };
      break;
    default:
      return null;
  }
  return assertAllowed('stripe.api', compact(rec));
}

export function assertReadOnlyKey(key, { allowSecretKey = false } = {}) {
  const k = String(key || '');
  if (!k) throw Object.assign(new Error('STRIPE_INGEST_KEY is not set'), { code: 'STRIPE_KEY_MISSING' });
  if (k.startsWith('rk_')) return k;
  if (k.startsWith('sk_') && allowSecretKey) return k;
  throw Object.assign(new Error('Stripe ingestion needs a restricted read-only key (rk_...); a full secret key is refused'), { code: 'STRIPE_KEY_NOT_RESTRICTED' });
}

// Newest first from each type's high-water mark (created >= mark: the overlap is deduplicated by content hash).
// A type that hits the page cap keeps its old mark and is repeated next run.
export async function pullStripe({ apiKey, cursor = {}, types = Object.keys(STRIPE_TYPES), now = Date.now(), backfillDays = 365, maxPages = 20, fetchImpl = fetch }) {
  const items = [];
  const next = { ...cursor };
  let complete = true;
  for (const type of types) {
    const path = STRIPE_TYPES[type];
    if (!path) throw new Error(`unknown Stripe type ${type}`);
    const since = Number(cursor[type]) || Math.floor((now - backfillDays * 86_400_000) / 1000);
    let startingAfter = null;
    let high = since;
    let done = false;
    for (let pages = 0; pages < maxPages; pages += 1) {
      const qs = new URLSearchParams({ limit: '100', 'created[gte]': String(since) });
      if (startingAfter) qs.set('starting_after', startingAfter);
      const res = await fetchImpl(`https://api.stripe.com/v1/${path}?${qs}`, { headers: { authorization: `Bearer ${apiKey}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(`Stripe ${path} ${res.status}${body?.error?.type ? ` ${body.error.type}` : ''}`), { status: res.status });
      for (const o of body.data || []) { items.push(o); high = Math.max(high, Number(o.created) || 0); }
      startingAfter = body.data?.length ? body.data[body.data.length - 1].id : null;
      if (!body.has_more || !startingAfter) { done = true; break; }
    }
    if (done) next[type] = high; else complete = false;
  }
  return { items, cursor: next, complete };
}
