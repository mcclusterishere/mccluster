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
import {
  DependencyMissing, assetsVerified, purchasedDownload, recordUpload, streamTarget
} from '../../supabase/functions/music-access/delivery.ts';

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
  assert.ok(upload.indexOf('recordUpload(db, bucket, path, who.user.id, who.mUid)') > 0, 'the grant is recorded to the caller');
  assert.ok(upload.indexOf('recordUpload(') < upload.indexOf('uploadGrant('), 'before the grant is handed out');
  assert.match(upload, /uploadGrant\(bucket, path, false\)/, 'a creator grant is never an upsert');
  const stream = access.slice(access.indexOf('action === "stream"'), access.indexOf('action === "download"'));
  assert.ok(stream.indexOf('streamTarget(db, track, !!owner)') > 0 && stream.indexOf('streamTarget(') < stream.indexOf('signDownload('),
    'stream signs only what streamTarget resolved');
  assert.match(stream, /signDownload\(target\.bucket, target\.path\)/);
  const download = access.slice(access.indexOf('action === "download"'), access.indexOf('action === "operator-dashboard"'));
  assert.ok(download.indexOf('purchasedDownload(db,') > 0 && download.indexOf('purchasedDownload(') < download.indexOf('signDownload('),
    'download signs only what purchasedDownload resolved');
  assert.doesNotMatch(download, /master_path/, 'a download never reads the live master path');
  const sql = await read(PENDING);
  assert.doesNotMatch(sql.slice(sql.indexOf('create or replace function public.music_asset_owned_by')).split('$$;')[0], /foldername|split_part/,
    'ownership is never read from the path');
  assert.match(sql, /raise exception 'creator_asset_not_owned' using detail = 'master_path'/);
  assert.match(sql, /raise exception 'release_asset_not_owned'/);
});

/* ---------------- (a)+(e) fail closed, with a stubbed client ---------------- */

const MISSING_FN = { code: 'PGRST202', message: 'Could not find the function' };
const MISSING_TABLE = { code: 'PGRST205', message: 'Could not find the table' };
function stubDb({ rpc = {}, insertError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      const r = rpc[fn];
      if (!r) return { data: null, error: MISSING_FN };
      return typeof r === 'function' ? r(args) : r;
    },
    from: (table) => ({ insert: async (row) => { calls.push(['insert', table, row]); return { error: insertError }; } })
  };
}
const TRACK = { id: '20000000-0000-4000-8000-0000000000a3', status: 'published', master_bucket: 'creator-masters', master_path: 'u/live.wav' };
const PURCHASE = {
  entitlement_id: '50000000-0000-4000-8000-0000000000e1', download_count: 2, revoked: false, order_status: 'paid',
  asset_version_id: '60000000-0000-4000-8000-0000000000e1', bucket_id: 'creator-masters', object_name: 'u/purchased.wav',
  intact: true, track_status: 'pending_review'
};
const Q = { trackId: TRACK.id, offerId: '30000000-0000-4000-8000-0000000000a3', userId: 'u1', email: 'Buyer@Test' };

test('missing RPC: ownership verification fails closed (never "verified")', async () => {
  await assert.rejects(assetsVerified(stubDb(), TRACK.id), (e) => e instanceof DependencyMissing && e.dependency === 'music_track_assets_verified');
  await assert.rejects(assetsVerified(stubDb({ rpc: { music_track_assets_verified: { data: null, error: { code: '42883' } } } }), TRACK.id), DependencyMissing);
  await assert.rejects(assetsVerified(stubDb({ rpc: { music_track_assets_verified: { data: null, error: { code: 'XX000' } } } }), TRACK.id), /could_not_verify_assets/);
  assert.equal(await assetsVerified(stubDb({ rpc: { music_track_assets_verified: { data: false, error: null } } }), TRACK.id), false);
  assert.equal(await assetsVerified(stubDb({ rpc: { music_track_assets_verified: { data: true, error: null } } }), TRACK.id), true);
});

test('missing table: an upload grant is refused, not issued unrecorded', async () => {
  await assert.rejects(recordUpload(stubDb({ insertError: MISSING_TABLE }), 'creator-masters', 'u/x.wav', 'u', 'm'), DependencyMissing);
  await assert.rejects(recordUpload(stubDb({ insertError: { code: '23505' } }), 'creator-masters', 'u/x.wav', 'u', 'm'), /could_not_record_upload/);
  await recordUpload(stubDb(), 'creator-masters', 'u/x.wav', 'u', 'm');
});

test('missing RPC: purchaser download and listener stream fail closed', async () => {
  await assert.rejects(purchasedDownload(stubDb(), Q), (e) => e instanceof DependencyMissing && e.dependency === 'music_purchase_delivery');
  await assert.rejects(streamTarget(stubDb(), TRACK, false), (e) => e instanceof DependencyMissing && e.dependency === 'music_track_delivery');
  /* the delivery RPC present but the ownership RPC missing still refuses */
  const halfApplied = stubDb({ rpc: { music_track_delivery: { data: [{ track_status: 'published', asset_version_id: 'v', bucket_id: 'creator-masters', object_name: 'u/p.wav', intact: true }], error: null } } });
  await assert.rejects(streamTarget(halfApplied, TRACK, false), DependencyMissing);
  await assert.rejects(streamTarget(stubDb(), { ...TRACK, status: 'draft' }, true), DependencyMissing);
  const access = await read('supabase/functions/music-access/index.ts');
  assert.match(access, /if \(error instanceof DependencyMissing\) \{[\s\S]{0,200}console\.error\([\s\S]{0,200}503\)/, 'music-access answers 503 and logs');
  assert.doesNotMatch(access, /notApplied\(error\)\) return true/, 'no fail-open fallback is left');
  const delivery = await read('supabase/functions/music-access/delivery.ts');
  assert.doesNotMatch(delivery, /notApplied\([^)]*\)\)\s*return/, 'no notApplied() branch returns instead of refusing');
});

test('replacement after purchase: the download is the purchased pinned version, never the live master', async () => {
  const db = stubDb({ rpc: { music_purchase_delivery: { data: [PURCHASE], error: null } } });
  const got = await purchasedDownload(db, Q);
  assert.deepEqual(got, { ok: true, bucket: 'creator-masters', path: 'u/purchased.wav', entitlementId: PURCHASE.entitlement_id, downloadCount: 2 });
  assert.notEqual(got.path, TRACK.master_path);
  assert.deepEqual(db.calls[0], ['music_purchase_delivery', { p_track: Q.trackId, p_offer: Q.offerId, p_user: 'u1', p_email: 'buyer@test' }]);
  /* a takedown does not matter (owner policy); a revocation, a refund, an unpinned or changed object does */
  assert.equal((await purchasedDownload(stubDb({ rpc: { music_purchase_delivery: { data: [{ ...PURCHASE, track_status: 'archived' }], error: null } } }), Q)).ok, true);
  const refusals = [
    [[], 402], [[{ ...PURCHASE, revoked: true }], 403], [[{ ...PURCHASE, order_status: 'refunded' }], 403],
    [[{ ...PURCHASE, asset_version_id: null, object_name: null }], 409], [[{ ...PURCHASE, intact: false }], 409],
    [[{ ...PURCHASE, bucket_id: 'mcc-gated-audio' }], 409]
  ];
  for (const [data, status] of refusals) {
    const r = await purchasedDownload(stubDb({ rpc: { music_purchase_delivery: { data, error: null } } }), Q);
    assert.equal(r.ok, false); assert.equal(r.status, status, JSON.stringify(data));
  }
});

test('a listener streams the pinned reviewed master; an owner previews only an owned draft', async () => {
  const ok = { music_track_assets_verified: { data: true, error: null } };
  const pinned = { data: [{ track_status: 'published', asset_version_id: 'v1', bucket_id: 'creator-masters', object_name: 'u/pinned.wav', intact: true }], error: null };
  assert.deepEqual(await streamTarget(stubDb({ rpc: { ...ok, music_track_delivery: pinned } }), TRACK, false), { ok: true, bucket: 'creator-masters', path: 'u/pinned.wav' });
  const changed = { data: [{ ...pinned.data[0], intact: false }], error: null };
  assert.equal((await streamTarget(stubDb({ rpc: { ...ok, music_track_delivery: changed } }), TRACK, false)).status, 409);
  const unpublished = { data: [{ track_status: 'pending_review', asset_version_id: null, bucket_id: null, object_name: null, intact: false }], error: null };
  assert.equal((await streamTarget(stubDb({ rpc: { ...ok, music_track_delivery: unpublished } }), TRACK, false)).status, 404);
  assert.deepEqual(await streamTarget(stubDb({ rpc: ok }), { ...TRACK, status: 'draft' }, true), { ok: true, bucket: 'creator-masters', path: 'u/live.wav' });
  assert.equal((await streamTarget(stubDb({ rpc: { music_track_assets_verified: { data: false, error: null } } }), { ...TRACK, status: 'draft' }, true)).status, 409);
});

test('approval pins the exact object; storage refuses changing it for every role', async () => {
  const sql = await read(PENDING);
  assert.match(sql, /new\.approved_master_version_id := case when coalesce\(new\.master_path, ''\) <> ''\s+then public\.music_pin_master\(new\.id, new\.master_path, 'review_approval'\) end;/);
  assert.match(sql, /'object_id', o\.id,\s+'version', o\.version, 'etag', o\.metadata->>'eTag', 'size', o\.metadata->>'size'/);
  assert.match(sql, /create trigger music_storage_object_guard_upd before update on storage\.objects/);
  assert.match(sql, /create trigger music_storage_object_guard_del before delete on storage\.objects/);
  assert.match(sql, /new\.asset_version_id := o\.asset_version_id;/, 'the entitlement inherits the order\'s version');
  const rollback = await read('supabase/pending/music_release_payment_integrity_v1.rollback.sql');
  for (const name of ['music_storage_object_guard_upd', 'music_asset_versions', 'approved_master_version_id', 'music_purchase_delivery']) {
    assert.match(rollback, new RegExp(name), `rollback removes ${name}`);
  }
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
  assert.match(sql, /new\.reviewed_snapshot := public\.music_track_reviewed_snapshot\(new\);/);
  assert.match(sql, /new\.reviewed_digest := public\.music_review_digest\(new\.reviewed_snapshot\);/);
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
