// The REAL music-direct-access handler on a REAL local PostgreSQL (PGlite): the production
// shape of the music_direct_* tables, both applied migrations, the API roles, and the
// function's own source (support/music-direct-access-handler.mjs) with this file's
// stand-ins for Stripe and Storage signing. Every database call the handler makes runs as
// service_role against the applied SQL. Isolated: never connects to Supabase, Stripe or
// Storage, and makes no network request.
//
//   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test/<script>.mjs
import { readFile } from 'node:fs/promises';
import { OPERATOR_TOKEN, loadAccessHandler, paidSession } from './music-direct-access-handler.mjs';

const ROOT = new URL('../../../', import.meta.url);
const read = (p) => readFile(new URL(p, ROOT), 'utf8');
const IDENT = /^[a-z_][a-z0-9_]*$/;
const TABLES = new Set(['music_direct_offers', 'music_direct_orders', 'music_direct_entitlements', 'music_direct_asset_versions', 'music_direct_asset_review', 'music_catalog_objects']);

export async function createMusicDirectDatabase() {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  const replay = await read('supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql');
  const tables = replay.slice(replay.search(/^-- -+ music direct sales$/m), replay.search(/^-- -+ the ISRC registry$/m));
  if (!tables.includes('create table public.music_direct_entitlements')) throw new Error('could not lift the music_direct tables from the replay migration');
  /* PGlite ships no pgcrypto; nothing here uses it (gen_random_uuid() is core) */
  await db.exec((await read('supabase/tests/supabase_api_roles.stub.sql')).replace('create extension if not exists pgcrypto;', ''));
  await db.exec(await read('supabase/tests/music_direct_sales.stub.sql'));
  await db.exec(tables);
  await db.exec(await read('supabase/migrations/20261031180839_music_direct_sales_v1.sql'));
  /* the applied file opens with LOCK TABLE, so it runs in a transaction, as it was applied */
  await db.exec('begin;\n' + await read('supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql') + '\ncommit;');
  await db.exec('set role service_role');

  const plain = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
  const sql = async (text, params = []) => (await db.query(text, params)).rows.map(plain);
  /** fixtures only: what no API role can do (ageing a row, disabling a guard) */
  const asOwner = async (fn) => { await db.exec('reset role'); try { return await fn(sql); } finally { await db.exec('set role service_role'); } };

  /* ---- the slice of supabase-js the function uses, answered by SQL as service_role ---- */
  const columns = (list) => { if (list === '*') return '*'; for (const c of list.split(',')) if (!IDENT.test(c)) throw new Error('unsupported select: ' + list); return list; };
  const from = (table) => {
    if (!TABLES.has(table)) throw new Error('unexpected table: ' + table);
    const q = { op: 'select', cols: '*', where: [], limit: null, row: null, conflict: null };
    const run = async () => {
      const where = q.where.map(([c], i) => `${c} = $${i + 1}`).join(' and ');
      const args = q.where.map(([, v]) => v);
      if (q.op === 'select') return sql(`select ${q.cols} from public.${table}${where ? ' where ' + where : ''}${q.limit ? ' limit ' + q.limit : ''}`, args);
      const keys = Object.keys(q.row);
      for (const k of keys) if (!IDENT.test(k)) throw new Error('unsupported column: ' + k);
      const values = keys.map((k) => q.row[k]);
      if (q.op === 'update') return sql(`update public.${table} set ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} where ${q.where.map(([c], i) => `${c} = $${keys.length + i + 1}`).join(' and ')} returning ${q.cols}`, [...values, ...args]);
      return sql(`insert into public.${table}(${keys.join(', ')}) values (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) on conflict (${q.conflict}) do update set ${keys.map((k) => `${k} = excluded.${k}`).join(', ')} returning ${q.cols}`, values);
    };
    const settle = (pick) => run().then((rows) => ({ data: pick(rows), error: null }), (e) => ({ data: null, error: { message: e.message, code: e.code || null } }));
    const b = {
      select(list = '*') { q.cols = columns(list); return b; },
      update(row) { q.op = 'update'; q.row = row; return b; },
      upsert(row, { onConflict } = {}) { if (!IDENT.test(onConflict || '')) throw new Error('upsert needs onConflict'); q.op = 'upsert'; q.row = row; q.conflict = onConflict; return b; },
      eq(col, value) { if (!IDENT.test(col)) throw new Error('unsupported filter: ' + col); q.where.push([col, value]); return b; },
      limit(n) { q.limit = Number(n); return b; },
      maybeSingle() { return settle((rows) => rows[0] ?? null); },
      single() { return settle((rows) => { if (rows.length !== 1) throw new Error('single() got ' + rows.length + ' rows'); return rows[0]; }); },
      then(ok, bad) { return settle((rows) => rows).then(ok, bad); }
    };
    return b;
  };
  const rpcLog = [];
  const rpc = async (name, args = {}) => {
    if (!IDENT.test(name)) throw new Error('unexpected rpc: ' + name);
    const keys = Object.keys(args);
    try {
      const rows = await sql(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as result`, keys.map((k) => args[k]));
      rpcLog.push({ name, args, result: rows[0].result });
      return { data: rows[0].result, error: null };
    } catch (e) {
      rpcLog.push({ name, args, error: e.message });
      return { data: null, error: { message: e.message, code: e.code || null } };
    }
  };

  /* ---- Storage signing: every call recorded; failures on request ---- */
  const signer = {
    calls: [],
    /** the next n signings answer a Storage error (what the SDK returns, not a throw) */
    failNext: 0,
    /** the next n signings throw (the function dies between reserve and settle) */
    throwNext: 0,
    /** objects the operator's save may put on sale */
    objects: new Set()
  };
  const storage = {
    from: (bucket) => ({
      createSignedUrl: async (path, seconds, options) => {
        const call = { bucket, path, seconds, download: options?.download ?? null };
        signer.calls.push(call);
        if (signer.throwNext > 0) { signer.throwNext--; call.outcome = 'threw'; throw new Error('synthetic storage outage'); }
        if (signer.failNext > 0) { signer.failNext--; call.outcome = 'error'; return { data: null, error: { message: 'synthetic signing failure' } }; }
        call.outcome = 'signed';
        call.url = `https://storage.invalid/object/sign/${bucket}/${path}?token=synthetic-${signer.calls.length}&download=${encodeURIComponent(call.download ?? '')}`;
        return { data: { signedUrl: call.url }, error: null };
      },
      list: async (dir, { search } = {}) => ({ data: signer.objects.has(`${dir}/${search}`) ? [{ name: search }] : [], error: null })
    })
  };
  const admin = { from, rpc, storage, auth: { getUser: async (token) => (token === OPERATOR_TOKEN ? { data: { user: { id: '11111111-1111-4111-8111-111111111111' } }, error: null } : { data: { user: null }, error: { message: 'invalid token' } }) } };

  /* ---- Stripe: only the sessions this test paid for exist; then the function's own source ---- */
  const sessions = new Map();
  const { handler, call, logged } = await loadAccessHandler({ admin, sessions });

  /** The owner puts a recording on sale, or edits it, through the function's own operator-direct-save. */
  const saveOffer = async ({ catalogKey, title, assetPath, priceCents = 199, maxDownloads = 5 }) => {
    signer.objects.add(assetPath);
    const r = await call({ action: 'operator-direct-save', catalog_key: catalogKey, title, price_cents: priceCents, asset_path: assetPath, active: true, max_downloads: maxDownloads }, { operator: true });
    if (r.status !== 200) throw new Error('offer save refused: ' + JSON.stringify(r.data));
    return r.data.offer;
  };
  /** What music-direct-checkout records before Stripe is paid, then the paid session Stripe would return. */
  let n = 0;
  const buy = async (offerKey, { email = 'buyer@example.invalid' } = {}) => {
    const [offer] = await sql('select offer_key, price_cents, currency from public.music_direct_offers where offer_key = $1', [offerKey]);
    const sessionId = 'cs_test_local' + String(++n).padStart(4, '0');
    const [order] = await sql(`insert into public.music_direct_orders(offer_key, stripe_checkout_session_id, amount_cents, currency, status) values ($1, $2, $3, $4, 'pending') returning id`, [offerKey, sessionId, offer.price_cents, offer.currency]);
    sessions.set(sessionId, paidSession({ sessionId, orderId: order.id, offerKey, amountCents: offer.price_cents, currency: offer.currency, email }));
    return { sessionId, orderId: order.id };
  };
  const entitlement = async (token) => (await sql('select id, order_id, download_count, max_downloads, asset_version_id, revoked_at from public.music_direct_entitlements where token = $1', [token]))[0];
  const attempts = (token) => sql(`select a.id, a.attempt_key, a.state from public.music_direct_download_attempts a join public.music_direct_entitlements e on e.id = a.entitlement_id where e.token = $1 order by a.reserved_at, a.id`, [token]);

  return { db, sql, asOwner, call, handler, saveOffer, buy, entitlement, attempts, signer, sessions, rpcLog, logged, close: () => db.close() };
}

/**
 * fetch for support/music-purchase-page.mjs that reaches the handler above. `drop(body)`
 * may return true to lose the ANSWER: the function runs to the end (whatever it counted
 * stays counted) and the page gets a network error instead of the response.
 */
export function fetchThrough(database, { drop = () => false } = {}) {
  const seen = [];
  const fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const response = await database.handler(new Request('https://local.invalid/functions/v1/music-direct-access', { method: 'POST', headers: options.headers, body: options.body }));
    const entry = { body, status: response.status, data: await response.clone().json(), dropped: false };
    seen.push(entry);
    if (drop(body, entry)) { entry.dropped = true; throw new TypeError('Failed to fetch'); }
    return response;
  };
  return { fetch, seen, downloads: () => seen.filter((s) => s.body.action === 'download') };
}
