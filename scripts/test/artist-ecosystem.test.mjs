import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(p, 'utf8');
const MIG = 'supabase/migrations/20260930120000_artist_ecosystems_commerce_v1.sql';

test('artist sales are direct charges on the artist account; McCluster takes only the application fee', async () => {
  const fn = await read('supabase/functions/artist-checkout/index.ts');
  assert.match(fn, /\{ stripeAccount: seller\.stripe_account_id/, 'charge must be created on the connected account');
  assert.match(fn, /application_fee_amount: order\.application_fee_cents/);
  assert.doesNotMatch(fn, /transfer_data|on_behalf_of|transfers\.create/, 'no destination charges or platform-held funds');
  assert.match(fn, /onboarding_status !== "ready"/, 'never sell before the artist account is ready');
});

test('price, credit and fee come from the database, never the client', async () => {
  const fn = await read('supabase/functions/artist-checkout/index.ts');
  assert.doesNotMatch(fn, /body\.(price|amount|fee)/);
  assert.match(fn, /admin\.rpc\("artist_open_order"/);
});

test('no investment mechanics exist in the commerce schema', async () => {
  const sql = (await read(MIG)).toLowerCase().replace(/^--.*$/gm, '');
  for (const word of ['buyback', 'share_price', 'dividend', 'resale', 'payout', 'transfer']) {
    assert.ok(!sql.includes(word), `schema must not contain "${word}"`);
  }
});

test('ledger writes are server-only', async () => {
  const sql = await read(MIG);
  assert.match(sql, /revoke insert, update, delete on public\.artist_ecosystems[\s\S]*from anon, authenticated;/);
  for (const fn of ['artist_open_order', 'artist_mark_order_paid', 'artist_mark_order_refunded', 'artist_cancel_order']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
  }
});

test('referral code is per-tab, not a tracking cookie, and the page discloses the charity boundary', async () => {
  const js = await read('js/artist-ecosystem.js');
  const html = await read('artist.html');
  assert.match(js, /sessionStorage\.setItem\(refKey/);
  assert.doesNotMatch(js, /document\.cookie/);
  assert.match(html, /receives only its platform fee/);
  assert.match(html, /not an investment/);
});

test('webhook settles artist orders and accepts the Connect endpoint secret', async () => {
  const wh = await read('supabase/functions/stripe-webhook/index.ts');
  assert.match(wh, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  assert.match(wh, /rpc\("artist_mark_order_paid"/);
  assert.match(wh, /rpc\("artist_mark_order_refunded"/);
  assert.match(wh, /rpc\("artist_cancel_order"/);
});
