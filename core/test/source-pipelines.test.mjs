// Source pipelines (Gmail, Google Calendar, Stripe -> ai_context). Synthetic fixtures only; no network.
// The PGlite case runs the real pending SQL when PGLITE_MODULE points at @electric-sql/pglite (skipped otherwise).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ALLOWED_KEYS } from '../src/pipelines/allow-list.mjs';
import { keyedHash, normalizeEmail, redactText, parseAddressList } from '../src/pipelines/pii.mjs';
import { normalizeGmailMessage, pullGmail } from '../src/pipelines/gmail.mjs';
import { normalizeCalendarEvent, pullCalendar } from '../src/pipelines/calendar.mjs';
import { normalizeStripeObject, pullStripe, assertReadOnlyKey } from '../src/pipelines/stripe.mjs';
import { runSourcePipeline } from '../src/pipelines/run.mjs';
import { createMemorySink, createSupabaseSink } from '../src/pipelines/sink.mjs';

const KEY = 'test-only-pii-hash-key-0123456789abcdef';
const SELF = ['owner.test@example.com'];
const fx = (n) => fileURLToPath(new URL(`./fixtures/source-pipelines/${n}.json`, import.meta.url));
const load = async (n) => JSON.parse(await readFile(fx(n), 'utf8'));
const sqlUrl = new URL('../../supabase/pending/20261125012000_ai_context_source_pipelines_v1.sql', import.meta.url);
const ENV = {
  MCCLUSTER_PII_HASH_KEY: KEY, GMAIL_INGEST_SELF_ADDRESSES: SELF.join(','),
};
const FORBIDDEN = [/SYNTHETIC (SNIPPET|DESCRIPTION|NOTE)/, /4242/, /555-?0142/, /948211/, /Example Plaza/, /Jordan Example/, /@example\.org/i, /meet\.example/];

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('JS allow-list matches ai_context.source_allowed_keys in the pending SQL', async () => {
  const sql = await readFile(sqlUrl, 'utf8');
  for (const [connector, keys] of Object.entries(ALLOWED_KEYS)) {
    const m = sql.match(new RegExp(`when '${connector.replace('.', '\\.')}' then array\\[([^\\]]+)\\]`));
    assert.ok(m, `SQL allow-list for ${connector}`);
    const sqlKeys = m[1].replace(/\s+/g, '').split(',').map((s) => s.replace(/'/g, ''));
    assert.deepEqual(sqlKeys, [...keys], connector);
  }
});

test('pending SQL stays owner-only, house-only, service-role-only', async () => {
  const sql = await readFile(sqlUrl, 'utf8');
  assert.match(sql, /perform ai_context\.workstream_require_house\(p_org\)/);
  assert.match(sql, /m\.role = 'owner'/);
  assert.match(sql, /revoke all on ai_context\.source_messages, ai_context\.source_calendar_events, ai_context\.source_payments\s+from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant [^;]+ to (anon|authenticated)/i);
  assert.match(sql, /PENDING ONLY/);
});

test('emails normalize and hash with a key; free text loses addresses, phones, links and codes', () => {
  assert.equal(normalizeEmail('"A B" <A.B+tag@GoogleMail.com>'), 'ab@gmail.com');
  assert.equal(normalizeEmail('x.y+z@Example.org'), 'x.y@example.org');
  assert.equal(normalizeEmail('not an address'), null);
  assert.deepEqual(parseAddressList('"Last, First" <a@example.org>, b@example.net'), ['a@example.org', 'b@example.net']);
  assert.match(keyedHash('a@example.org', KEY), /^[0-9a-f]{64}$/);
  assert.notEqual(keyedHash('a@example.org', KEY), keyedHash('a@example.org', `${KEY}x`));
  assert.throws(() => keyedHash('a', 'short'), /MCCLUSTER_PII_HASH_KEY/);
  const r = redactText('Call 203-555-0142 or mail a@example.org, code 948211, see https://x.example/y');
  assert.equal(r, 'Call [phone] or mail [email], code [number], see [link]');
  assert.equal(redactText('x'.repeat(300), 20).length, 20);
});

test('Gmail: metadata only, direction, spam skipped, counterparties hashed, subject off by default', async () => {
  const { items } = await load('gmail');
  const out = items.map((m) => normalizeGmailMessage(m, { hashKey: KEY, selfAddresses: SELF }));
  assert.equal(out[2], null, 'spam skipped');
  assert.equal(out[0].direction, 'in');
  assert.equal(out[1].direction, 'out');
  assert.equal(out[3].direction, 'self');
  assert.equal(out[0].subject_redacted, undefined, 'subject omitted unless asked');
  assert.deepEqual(out[0].counterparty_domains, ['example.org']);
  assert.equal(out[0].counterparty_hashes[0], keyedHash('jordan.example@example.org', KEY), 'plus tag and case folded before hashing');
  assert.equal(out[1].counterparty_hashes.length, 2, 'self excluded from recipients');
  assert.equal(out[1].attachment_count, 1);
  assert.deepEqual(out[3].counterparty_hashes, []);
  const withSubject = normalizeGmailMessage(items[0], { hashKey: KEY, selfAddresses: SELF, includeSubject: true });
  assert.equal(withSubject.subject_redacted, 'Photos for the Dec 5 gala, call me at [phone], code [number]');
  for (const rec of out.filter(Boolean)) for (const re of FORBIDDEN) assert.doesNotMatch(JSON.stringify(rec), re);
  // connector envelope shape works too
  const env = normalizeGmailMessage({ id: 'abc123', threadId: 'abc123', from: 'Owner <owner.test@example.com>', to: 'x@example.net',
    date: '2026-11-24T10:00:00Z', labelIds: ['SENT'] }, { hashKey: KEY, selfAddresses: SELF });
  assert.equal(env.direction, 'out');
  assert.equal(env.occurred_at, '2026-11-24T10:00:00.000Z');
});

test('Calendar: no description, location text or raw attendees; all-day and cancelled handled', async () => {
  const { items } = await load('calendar');
  const [a, b, c] = items.map((e) => normalizeCalendarEvent(e, { hashKey: KEY }));
  assert.equal(a.title_redacted, 'Gala coverage for [email] ([phone])');
  assert.equal(a.has_location, true);
  assert.equal(a.has_conference, true);
  assert.equal(a.organizer_self, true);
  assert.equal(a.attendee_count, 3);
  assert.deepEqual(a.attendee_hashes, [keyedHash('jordan.example@example.org', KEY), keyedHash('planner@venue.example.net', KEY)]);
  assert.equal(a.starts_at, '2026-12-05T23:00:00.000Z');
  assert.equal(b.status, 'cancelled');
  assert.equal(b.starts_at, undefined);
  assert.equal(c.all_day, true);
  for (const rec of [a, b, c]) for (const re of FORBIDDEN) assert.doesNotMatch(JSON.stringify(rec), re);
});

test('Stripe: no card, name, phone, address or description; metadata allow-listed; same person links across sources', async () => {
  const { items } = await load('stripe');
  const out = items.map((o) => normalizeStripeObject(o, { hashKey: KEY }));
  const [ch, re, inv, cus, po] = out;
  assert.equal(po, null, 'payouts are out of scope');
  assert.equal(ch.amount_minor, 20000);
  assert.equal(ch.amount_refunded_minor, 5000);
  assert.equal(ch.currency, 'usd');
  assert.equal(ch.related_id, 'pi_3SyntheticIntent01');
  assert.deepEqual(ch.metadata, { offer: 'starter' });
  assert.equal(re.related_id, 'ch_3SyntheticCharge01');
  assert.deepEqual(inv.metadata, { package: 'full coverage' });
  assert.equal(cus.status, 'active');
  const h = keyedHash('jordan.example@example.org', KEY);
  assert.equal(ch.email_hash, h);
  assert.equal(inv.email_hash, h);
  assert.equal(cus.email_hash, h);
  const gmail = normalizeGmailMessage((await load('gmail')).items[0], { hashKey: KEY, selfAddresses: SELF });
  assert.equal(gmail.counterparty_hashes[0], h, 'one keyed hash joins the email sender to the Stripe customer');
  for (const rec of out.filter(Boolean)) for (const r of FORBIDDEN) assert.doesNotMatch(JSON.stringify(rec), r);
});

test('Stripe key must be restricted read-only', () => {
  assert.equal(assertReadOnlyKey('rk_test_abc'), 'rk_test_abc');
  assert.throws(() => assertReadOnlyKey('sk_live_abc'), /restricted read-only/);
  assert.throws(() => assertReadOnlyKey(''), /STRIPE_INGEST_KEY/);
  assert.equal(assertReadOnlyKey('sk_test_abc', { allowSecretKey: true }), 'sk_test_abc');
});

test('pullGmail pages newest first, stops at the cursor, and resumes a long backlog by page token', async () => {
  const msgs = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, internalDate: String(1000 - i * 100) }));
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith('/messages')) {
      assert.equal(u.searchParams.get('q'), null, 'no q: works with the gmail.metadata scope');
      const page = Number(u.searchParams.get('pageToken') || 0);
      return json({ messages: msgs.slice(page * 2, page * 2 + 2).map(({ id }) => ({ id })), nextPageToken: page < 2 ? String(page + 1) : undefined });
    }
    assert.equal(u.searchParams.get('format'), 'metadata', 'never format=full');
    return json(msgs.find((m) => u.pathname.endsWith(`/${m.id}`)));
  };
  const a = await pullGmail({ token: 't', cursor: { after_ms: 650 }, fetchImpl });
  assert.deepEqual(a.items.map((m) => m.id), ['m0', 'm1', 'm2', 'm3']);
  assert.deepEqual(a.cursor, { after_ms: 1000 });
  const b = await pullGmail({ token: 't', cursor: { after_ms: 1 }, maxPages: 1, fetchImpl });
  assert.equal(b.complete, false);
  assert.deepEqual(b.cursor, { after_ms: 1, page_token: '1', high_water_ms: 1000 });
  const c = await pullGmail({ token: 't', cursor: b.cursor, fetchImpl });
  assert.deepEqual(c.items.map((m) => m.id), ['m2', 'm3', 'm4', 'm5']);
  assert.deepEqual(c.cursor, { after_ms: 1000 });
});

test('pullCalendar uses the sync token, restarts on 410, keeps the cursor on an unfinished walk', async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    const u = new URL(url);
    n += 1;
    assert.match(u.searchParams.get('fields'), /^items\(id,status,summary/);
    if (u.searchParams.get('syncToken') === 'old') return json({ error: { status: 'GONE' } }, 410);
    assert.ok(u.searchParams.get('timeMin'), 'restart is bounded');
    return json({ items: [{ id: 'e1', status: 'confirmed' }], nextSyncToken: 'new' });
  };
  const out = await pullCalendar({ token: 't', cursor: { sync_token: 'old' }, fetchImpl });
  assert.equal(n, 2);
  assert.deepEqual(out.cursor, { sync_token: 'new' });
  const unfinished = await pullCalendar({ token: 't', cursor: { sync_token: 'keep' }, maxPages: 1,
    fetchImpl: async () => json({ items: [], nextPageToken: 'p2' }) });
  assert.deepEqual(unfinished.cursor, { sync_token: 'keep' });
});

test('pullStripe pages per type, advances each high-water mark, and holds a capped type', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.authorization, 'Bearer rk_test_x');
    const u = new URL(url);
    const type = u.pathname.split('/').pop();
    if (type === 'charges') {
      return u.searchParams.get('starting_after')
        ? json({ data: [{ id: 'ch_2', object: 'charge', created: 150 }], has_more: false })
        : json({ data: [{ id: 'ch_1', object: 'charge', created: 200 }], has_more: true });
    }
    if (type === 'invoices') return json({ data: [{ id: 'in_1', object: 'invoice', created: 300 }], has_more: true });
    return json({ data: [], has_more: false });
  };
  const out = await pullStripe({ apiKey: 'rk_test_x', cursor: { charge: 100, invoice: 100 }, types: ['charge', 'invoice', 'refund'], maxPages: 1, fetchImpl });
  assert.equal(out.cursor.charge, 100, 'capped type keeps its mark');
  assert.equal(out.cursor.invoice, 100);
  assert.equal(out.complete, false);
  const full = await pullStripe({ apiKey: 'rk_test_x', cursor: { charge: 100 }, types: ['charge'], fetchImpl });
  assert.equal(full.cursor.charge, 200);
  assert.deepEqual(full.items.map((o) => o.id), ['ch_1', 'ch_2']);
});

test('dry run: every fixture lands once, a replay changes nothing, nothing sensitive is stored', async () => {
  const sink = createMemorySink();
  for (const source of ['gmail', 'calendar', 'stripe']) {
    const first = await runSourcePipeline({ source, sink, env: ENV, fixture: fx(source) });
    assert.equal(first.rejected, 0, source);
    assert.ok(first.inserted > 0, source);
    const again = await runSourcePipeline({ source, sink, env: ENV, fixture: fx(source) });
    assert.equal(again.inserted + again.updated, 0, `${source} replay is a no-op`);
    assert.equal(again.unchanged, first.inserted);
  }
  assert.equal(sink.rows.size, 3 + 3 + 4);
  const stored = JSON.stringify([...sink.rows.values()]);
  for (const re of FORBIDDEN) assert.doesNotMatch(stored, re);
  assert.deepEqual(await sink.cursor('google.calendar', 'calendar.primary'), { sync_token: 'synthetic-sync-token-1' });
});

test('runner refuses to run without a hash key or with an address as the account key', async () => {
  await assert.rejects(runSourcePipeline({ source: 'gmail', sink: createMemorySink(), env: {}, fixture: fx('gmail') }), /MCCLUSTER_PII_HASH_KEY/);
  await assert.rejects(runSourcePipeline({ source: 'gmail', sink: createMemorySink(), env: { ...ENV, GMAIL_INGEST_ACCOUNT_KEY: 'me@example.org' }, fixture: fx('gmail') }), /never an address/);
  await assert.rejects(runSourcePipeline({ source: 'stripe', sink: createMemorySink(), env: { ...ENV, STRIPE_INGEST_KEY: 'sk_live_x' } }), /restricted read-only/);
  await assert.rejects(runSourcePipeline({ source: 'gmail', sink: createMemorySink(), env: ENV }), /Google OAuth/);
});

test('Supabase sink calls only the owner-gated RPCs', async () => {
  const calls = [];
  const rest = async (path, init) => { calls.push([path, JSON.parse(init.body)]); return { body: path.endsWith('cursor') ? { cursor: { after_ms: 5 } } : { inserted: 1 } }; };
  assert.throws(() => createSupabaseSink({ orgId: 'o', rest }), /MCCLUSTER_OWNER_PROFILE_ID/);
  const sink = createSupabaseSink({ orgId: 'org', actorId: 'owner', rest });
  assert.deepEqual(await sink.cursor('google.gmail', 'gmail.primary'), { after_ms: 5 });
  await sink.ingest('google.gmail', 'gmail.primary', [{ external_id: 'x' }], null, 'incremental');
  assert.deepEqual(calls.map(([p]) => p), ['rpc/ops_ai_source_cursor', 'rpc/ops_ai_source_ingest']);
  assert.equal(calls[1][1].p_actor, 'owner');
  assert.equal(calls[1][1].p_cursor_after, null);
});

test('end to end against the real pending SQL in PGlite', { skip: !process.env.PGLITE_MODULE && 'set PGLITE_MODULE to run' }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const sql = (p) => readFile(new URL(`../../supabase/${p}`, import.meta.url), 'utf8');
  await db.exec(await sql('tests/ai_context_source_pipelines.stub.sql'));
  await db.exec(await sql('pending/20261125012000_ai_context_source_pipelines_v1.sql'));
  const org = '00000000-0000-4000-8000-000000000001';
  const owner = '00000000-0000-4000-8000-0000000000aa';
  const call = async (fn, args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args)).rows[0].r;
  const sink = {
    kind: 'pglite',
    cursor: async (c, a) => (await call('ops_ai_source_cursor', [org, owner, c, a])).cursor,
    ingest: (c, a, records, cur, mode) => call('ops_ai_source_ingest', [org, owner, c, a, JSON.stringify(records), cur ? JSON.stringify(cur) : null, mode]),
  };
  for (const source of ['gmail', 'calendar', 'stripe']) {
    const first = await runSourcePipeline({ source, sink, env: ENV, fixture: fx(source), mode: 'initial' });
    assert.equal(first.rejected, 0, `${source}: ${JSON.stringify(first)}`);
    const again = await runSourcePipeline({ source, sink, env: ENV, fixture: fx(source) });
    assert.equal(again.inserted + again.updated, 0, `${source} replay`);
  }
  const counts = (await db.query(`select (select count(*) from ai_context.source_messages)::int m, (select count(*) from ai_context.source_calendar_events)::int c,
    (select count(*) from ai_context.source_payments)::int p, (select count(*) from public.ops_ingest_runs)::int runs,
    (select count(*) from public.ops_ingest_records)::int recs`)).rows[0];
  assert.deepEqual(counts, { m: 3, c: 3, p: 4, runs: 6, recs: 10 });
  const dump = JSON.stringify((await db.query(`select payload from public.ops_ingest_records`)).rows);
  for (const re of FORBIDDEN) assert.doesNotMatch(dump, re);
  const linked = (await db.query(`select count(*)::int n from ai_context.source_payments p join ai_context.source_messages m on p.email_hash = any (m.counterparty_hashes)`)).rows[0].n;
  assert.ok(linked >= 2, 'payments join to messages on the keyed hash');
  await db.close();
});
