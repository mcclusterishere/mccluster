/* Music release and payment integrity: the four owner findings.

   (a) asset ownership comes from a server-held record, not a storage path;
   (b) a reviewed release cannot change under its review;
   (c) the platform commission is the server's;
   (d) payment fulfilment is bound to its order, account, session, amount and
       currency, once.

   The pure decision code the edge functions run is imported here under
   Node's TypeScript stripping; the database half is exercised by
   scripts/test-music-release-integrity-db.sh
   (supabase/tests/music_release_payment_integrity.behaviour.sql), which CI
   runs in a disposable Postgres (.github/workflows/music-release-integrity-db.yml). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkoutBindingFailure } from '../../supabase/functions/_shared/checkout-binding.ts';
import { MUSIC_PLATFORM_FEE_BPS, musicPlatformFee } from '../../supabase/functions/_shared/music-commission.ts';
import { musicFulfilmentRefusal } from '../../supabase/functions/stripe-webhook/music.ts';

const read = (p) => readFile(p, 'utf8');
const PENDING = 'supabase/pending/music_release_payment_integrity_v1.sql';

const ORDER = {
  id: '40000000-0000-4000-8000-0000000000a1',
  offer_id: '30000000-0000-4000-8000-0000000000a1',
  track_id: '20000000-0000-4000-8000-0000000000a1',
  stripe_checkout_session_id: 'cs_live_order1',
  amount_cents: 1000,
  currency: 'usd',
  status: 'pending'
};
const SESSION = {
  id: 'cs_live_order1',
  object: 'checkout.session',
  mode: 'payment',
  payment_status: 'paid',
  amount_total: 1000,
  currency: 'usd',
  metadata: {
    kind: 'music_license_sale',
    music_order_id: ORDER.id,
    music_offer_id: ORDER.offer_id,
    music_track_id: ORDER.track_id
  }
};
const PLATFORM_EVENT = { id: 'evt_1' };

/* ---------------- (d) fulfilment binding ---------------- */

test('a paid platform session that is the order\'s own fulfils it', () => {
  assert.equal(musicFulfilmentRefusal(SESSION, PLATFORM_EVENT, ORDER), null);
  assert.equal(musicFulfilmentRefusal(SESSION, { account: null }, ORDER), null);
  assert.equal(musicFulfilmentRefusal(SESSION, PLATFORM_EVENT, { ...ORDER, status: 'failed' }), null, 'a retried payment after a failed attempt');
});

test('every mismatch between the session and the order is refused', () => {
  const cases = [
    ['a connected account\'s session naming our order', SESSION, { account: 'acct_attacker' }, ORDER, 'account_mismatch'],
    ['another session (a cheaper one) naming our order', { ...SESSION, id: 'cs_live_other' }, PLATFORM_EVENT, ORDER, 'session_mismatch'],
    ['an order with no stored session', SESSION, PLATFORM_EVENT, { ...ORDER, stripe_checkout_session_id: null }, 'session_mismatch'],
    ['an amount below the order', { ...SESSION, amount_total: 1 }, PLATFORM_EVENT, ORDER, 'amount_mismatch'],
    ['a missing amount', { ...SESSION, amount_total: null }, PLATFORM_EVENT, ORDER, 'amount_mismatch'],
    ['another currency', { ...SESSION, currency: 'jpy' }, PLATFORM_EVENT, ORDER, 'currency_mismatch'],
    ['an unpaid session', { ...SESSION, payment_status: 'unpaid' }, PLATFORM_EVENT, ORDER, 'not_paid'],
    ['a subscription session', { ...SESSION, mode: 'subscription' }, PLATFORM_EVENT, ORDER, 'not_a_payment'],
    ['metadata for another order', { ...SESSION, metadata: { ...SESSION.metadata, music_order_id: 'x' } }, PLATFORM_EVENT, ORDER, 'order_mismatch'],
    ['metadata for another offer', { ...SESSION, metadata: { ...SESSION.metadata, music_offer_id: 'x' } }, PLATFORM_EVENT, ORDER, 'offer_mismatch'],
    ['metadata for another track', { ...SESSION, metadata: { ...SESSION.metadata, music_track_id: 'x' } }, PLATFORM_EVENT, ORDER, 'track_mismatch'],
    ['a canceled order', SESSION, PLATFORM_EVENT, { ...ORDER, status: 'canceled' }, 'order_not_payable'],
    ['a refunded order', SESSION, PLATFORM_EVENT, { ...ORDER, status: 'refunded' }, 'order_not_payable'],
    ['no order', SESSION, PLATFORM_EVENT, null, 'order_not_found']
  ];
  for (const [what, session, event, order, reason] of cases) {
    assert.equal(musicFulfilmentRefusal(session, event, order), reason, what);
  }
});

test('a replayed delivery for an already-paid order is not a second fulfilment', async () => {
  /* the decision allows re-ensuring the entitlement for the SAME session... */
  assert.equal(musicFulfilmentRefusal(SESSION, PLATFORM_EVENT, { ...ORDER, status: 'paid' }), null);
  /* ...and the webhook makes that idempotent: a conditional move to paid and one entitlement per order */
  const hook = await read('supabase/functions/stripe-webhook/index.ts');
  const grant = hook.slice(hook.indexOf('async function grantMusicOrder'), hook.indexOf('async function revokeMusicByPaymentIntent'));
  assert.match(grant, /musicFulfilmentRefusal\(session as any, event as any, order\)/, 'the order is checked before anything is written');
  assert.ok(grant.indexOf('musicFulfilmentRefusal') < grant.indexOf('method: "PATCH"'), 'refusal precedes the paid write');
  assert.match(grant, /&stripe_checkout_session_id=eq\.\$\{encodeURIComponent\(String\(session\.id\)\)\}/, 'the paid write is scoped to the stored session');
  assert.match(grant, /&status=in\.\(\$\{MUSIC_PAYABLE\.join\(","\)\}\)/, 'and to a payable order');
  assert.match(grant, /music_entitlements\?on_conflict=order_id/, 'one entitlement per order');
  assert.match(grant, /resolution=ignore-duplicates/);
  assert.doesNotMatch(grant, /session\.metadata\?\.customer_user_id/, 'who gets the licence comes from the order, not metadata');
  assert.match(hook, /const verified = await verifiedEvent\(raw, sig\);\s+if \(!verified\) return new Response\("bad signature", \{ status: 400 \}\);/,
    'the signature is verified first');
});

test('expired and failed events cannot touch another session\'s or a settled order', async () => {
  const hook = await read('supabase/functions/stripe-webhook/index.ts');
  assert.match(hook, /&stripe_checkout_session_id=eq\.\$\{encodeURIComponent\(s\.id\)\}&status=in\.\(pending,failed\)/);
  assert.match(hook, /music_order_id\)\}&status=eq\.pending`/);
  assert.match(hook, /if \(effects && !event\.account\) await revokeMusicByPaymentIntent/);
});

test('the shared binding also guards the shake shop and Level 3 downloads', async () => {
  const expected = { sessionId: 'cs_1', amountCents: 900, currency: 'usd', account: 'acct_seller' };
  const paid = { id: 'cs_1', object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 900, currency: 'usd' };
  assert.equal(checkoutBindingFailure(paid, expected, 'acct_seller'), null);
  assert.equal(checkoutBindingFailure(paid, expected, 'acct_other'), 'account_mismatch');
  assert.equal(checkoutBindingFailure(paid, expected, null), 'account_mismatch');
  assert.equal(checkoutBindingFailure({ ...paid, amount_total: 899 }, expected, 'acct_seller'), 'amount_mismatch');
  assert.equal(checkoutBindingFailure({ ...paid, currency: 'eur' }, expected, 'acct_seller'), 'currency_mismatch');
  assert.equal(checkoutBindingFailure(paid, { ...expected, currency: '' }, 'acct_seller'), 'currency_mismatch');
  assert.equal(checkoutBindingFailure(null, expected, 'acct_seller'), 'no_session');
  const shake = await read('supabase/functions/shake-order/index.ts');
  assert.match(shake, /checkoutBindingFailure\(session as any, \{\s+sessionId: order\.payment_ref, amountCents: Number\(order\.total_cents\)/);
  assert.match(shake, /status=eq\.pending_payment&payment_ref=eq\./);
  const l3 = await read('supabase/functions/l3-download/index.ts');
  assert.match(l3, /checkoutBindingFailure\(session,\{sessionId:order\.stripe_checkout_session_id,amountCents:Number\(order\.amount_cents\)/);
});

/* ---------------- (c) commission ---------------- */

test('the commission is one server constant, the same in the function and the database', async () => {
  assert.equal(MUSIC_PLATFORM_FEE_BPS, 1500);
  assert.deepEqual(musicPlatformFee(1000), { platformFeeCents: 150, creatorNetCents: 850 });
  assert.deepEqual(musicPlatformFee(333), { platformFeeCents: 50, creatorNetCents: 283 });
  assert.throws(() => musicPlatformFee(0), /invalid_price/);
  assert.throws(() => musicPlatformFee(10.5), /invalid_price/);
  const sql = await read(PENDING);
  const m = sql.match(/create or replace function public\.music_platform_fee_bps\(\)\s+returns integer[^$]*\$\$ select (\d+) \$\$/);
  assert.ok(m, 'the database states its fee');
  assert.equal(Number(m[1]), MUSIC_PLATFORM_FEE_BPS, 'function and database agree');
});

test('checkout ignores any fee but the server\'s', async () => {
  const checkout = await read('supabase/functions/music-checkout/index.ts');
  assert.match(checkout, /from "\.\.\/_shared\/music-commission\.ts"/);
  assert.match(checkout, /musicPlatformFee\(offer\.price_cents\)/);
  assert.doesNotMatch(checkout, /platform_fee_bps/, 'the offer row\'s (creator-writable) fee is not read');
  assert.doesNotMatch(checkout, /body\.(platform_fee|fee|commission|application_fee|amount|price|currency)/, 'nothing about money is read from the request');
  const sql = await read(PENDING);
  assert.match(sql, /new\.platform_fee_bps := case when tg_op = 'UPDATE' then old\.platform_fee_bps else public\.music_platform_fee_bps\(\) end;/);
  assert.match(sql, /round\(new\.amount_cents \* public\.music_platform_fee_bps\(\) \/ 10000\.0\)::integer/);
});

/* ---------------- (a) ownership ---------------- */

test('music-access records who it grants an upload to and verifies ownership before signing a master', async () => {
  const access = await read('supabase/functions/music-access/index.ts');
  const upload = access.slice(access.indexOf('action === "creator-upload-url"'), access.indexOf('action === "stream"'));
  assert.ok(upload.indexOf('recordUpload(bucket, path, who.user.id, who.mUid)') > 0, 'the grant is recorded to the caller');
  assert.ok(upload.indexOf('recordUpload(') < upload.indexOf('uploadGrant('), 'before the grant is handed out');
  for (const action of ['stream', 'download']) {
    const start = access.indexOf(`action === "${action}"`);
    const body = access.slice(start, access.indexOf('if (action ===', start + 10));
    assert.ok(body.indexOf('assetsVerified(track.id)') > 0, `${action} verifies the assets`);
    assert.ok(body.indexOf('assetsVerified(track.id)') < body.indexOf('signDownload('), `${action} verifies before signing`);
    assert.match(body, /track\.master_bucket !== "creator-masters"/, `${action} signs only the creator masters bucket`);
  }
  const sql = await read(PENDING);
  assert.doesNotMatch(sql.slice(sql.indexOf('create or replace function public.music_asset_owned_by')).split('$$;')[0], /foldername|split_part/,
    'ownership is never read from the path');
  assert.match(sql, /raise exception 'creator_asset_not_owned' using detail = 'master_path'/);
  assert.match(sql, /raise exception 'release_asset_not_owned'/);
});

/* ---------------- (b) review ---------------- */

test('a review decision is about the version the operator saw, and a reviewed release cannot change under it', async () => {
  const access = await read('supabase/functions/music-access/index.ts');
  assert.match(access, /expected_updated_at required/);
  assert.match(access, /query = query\.eq\("updated_at", expected\)/);
  assert.match(access, /the release changed since you loaded it/);
  const admin = await read('js/music-admin.js');
  assert.match(admin, /expected_updated_at:b\.getAttribute\("data-version"\)/);
  assert.match(admin, /data-version="'\+esc\(t\.updated_at\|\|""\)/);
  const sql = await read(PENDING);
  assert.match(sql, /if tg_op = 'UPDATE' and old\.status in \('approved','published'\)\s+and public\.music_track_content\(new\) is distinct from public\.music_track_content\(old\) then\s+new\.status := 'pending_review';/);
  assert.match(sql, /new\.reviewed_snapshot := public\.music_track_content\(new\);/);
  assert.match(sql, /create trigger music_track_offers_follow_status_trg after update on public\.creator_tracks/);
});

test('the pending migration is documented, tested in CI and has a rollback', async () => {
  const promotion = await read('supabase/pending/PROMOTION-ORDER.md');
  assert.match(promotion, /music_release_payment_integrity_v1\.sql/);
  const readme = await read('supabase/pending/README.md');
  assert.match(readme, /music_release_payment_integrity_v1\.sql/);
  await read('supabase/pending/music_release_payment_integrity_v1.rollback.sql');
  const ci = await read('.github/workflows/music-release-integrity-db.yml');
  assert.match(ci, /bash scripts\/test-music-release-integrity-db\.sh/);
  assert.match(ci, /node --test scripts\/test\/music-payment-integrity\.test\.mjs/);
  assert.doesNotMatch(ci, /git push/);
});
