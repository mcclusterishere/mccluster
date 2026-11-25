// One pipeline pass: read the stored cursor, pull from the source (or load a synthetic fixture), minimize,
// write in batches of 500. The cursor rides only on the final batch, so a crash mid-way repeats the pass
// (idempotent) instead of skipping records.
import { readFile } from 'node:fs/promises';
import { CONNECTOR_FOR_SOURCE } from './allow-list.mjs';
import { normalizeGmailMessage, pullGmail } from './gmail.mjs';
import { normalizeCalendarEvent, pullCalendar } from './calendar.mjs';
import { normalizeStripeObject, pullStripe, assertReadOnlyKey } from './stripe.mjs';
import { googleAccessToken } from './google-oauth.mjs';
import { requireHashKey } from './pii.mjs';

export const BATCH = 500;
const ACCOUNT_RE = /^[a-z][a-z0-9_.:-]{1,63}$/;

function list(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

export function sourceConfig(source, env = process.env) {
  const hashKey = env.MCCLUSTER_PII_HASH_KEY;
  if (source === 'gmail') {
    return {
      hashKey,
      account: env.GMAIL_INGEST_ACCOUNT_KEY || 'gmail.primary',
      selfAddresses: list(env.GMAIL_INGEST_SELF_ADDRESSES),
      includeSubject: env.GMAIL_INGEST_INCLUDE_SUBJECT === '1',
      backfillDays: Number(env.GMAIL_INGEST_BACKFILL_DAYS || 30),
      oauth: { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, refreshToken: env.GMAIL_INGEST_REFRESH_TOKEN },
    };
  }
  if (source === 'calendar') {
    return {
      hashKey,
      account: env.CALENDAR_INGEST_ACCOUNT_KEY || 'calendar.primary',
      calendarId: env.CALENDAR_INGEST_CALENDAR_ID || 'primary',
      includeTitle: env.CALENDAR_INGEST_INCLUDE_TITLE !== '0',
      backfillDays: Number(env.CALENDAR_INGEST_BACKFILL_DAYS || 180),
      oauth: { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, refreshToken: env.CALENDAR_INGEST_REFRESH_TOKEN },
    };
  }
  if (source === 'stripe') {
    return {
      hashKey,
      account: env.STRIPE_INGEST_ACCOUNT_KEY || 'stripe.live',
      apiKey: env.STRIPE_INGEST_KEY,
      allowSecretKey: env.STRIPE_INGEST_ALLOW_SECRET_KEY === '1',
      metadataAllow: list(env.STRIPE_INGEST_METADATA_KEYS),
      backfillDays: Number(env.STRIPE_INGEST_BACKFILL_DAYS || 365),
    };
  }
  throw new Error(`unknown source ${source}; use gmail, calendar or stripe`);
}

export function normalizeFor(source, item, cfg) {
  if (source === 'gmail') return normalizeGmailMessage(item, cfg);
  if (source === 'calendar') return normalizeCalendarEvent(item, cfg);
  return normalizeStripeObject(item, cfg.metadataAllow?.length ? cfg : { hashKey: cfg.hashKey });
}

async function pull(source, cfg, cursor, { fetchImpl, now }) {
  if (source === 'stripe') {
    const apiKey = assertReadOnlyKey(cfg.apiKey, { allowSecretKey: cfg.allowSecretKey });
    return pullStripe({ apiKey, cursor, now, backfillDays: cfg.backfillDays, fetchImpl });
  }
  const token = await googleAccessToken({ ...cfg.oauth, fetchImpl });
  if (source === 'gmail') return pullGmail({ token, cursor, now, backfillDays: cfg.backfillDays, fetchImpl });
  return pullCalendar({ token, calendarId: cfg.calendarId, cursor, now, backfillDays: cfg.backfillDays, fetchImpl });
}

export async function runSourcePipeline({ source, sink, env = process.env, fixture = null, mode = 'incremental', fetchImpl = fetch, now = Date.now() }) {
  const connector = CONNECTOR_FOR_SOURCE[source];
  if (!connector) throw new Error(`unknown source ${source}; use gmail, calendar or stripe`);
  const cfg = sourceConfig(source, env);
  requireHashKey(cfg.hashKey);
  if (!ACCOUNT_RE.test(cfg.account)) throw new Error('account key must be a short lowercase key such as gmail.primary, never an address');

  const before = await sink.cursor(connector, cfg.account);
  let pulled;
  if (fixture) {
    const data = JSON.parse(await readFile(fixture, 'utf8'));
    pulled = { items: data.items || [], cursor: data.cursor || null, complete: true };
  } else {
    pulled = await pull(source, cfg, before, { fetchImpl, now });
  }

  const records = [];
  let skipped = 0;
  for (const item of pulled.items) {
    const rec = normalizeFor(source, item, cfg);
    if (rec) records.push(rec); else skipped += 1;
  }

  const totals = { seen: 0, inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
  const runIds = [];
  const batches = Math.max(1, Math.ceil(records.length / BATCH));
  for (let i = 0; i < batches; i += 1) {
    const chunk = records.slice(i * BATCH, (i + 1) * BATCH);
    const last = i === batches - 1;
    const res = await sink.ingest(connector, cfg.account, chunk, last ? pulled.cursor : null, mode);
    for (const k of Object.keys(totals)) totals[k] += Number(res?.[k] || 0);
    if (res?.run_id) runIds.push(res.run_id);
  }
  // Counts and ids only: never record contents.
  return { source, connector, account_key: cfg.account, sink: sink.kind, pulled: pulled.items.length, skipped,
    complete: pulled.complete, ...totals, run_ids: runIds };
}
