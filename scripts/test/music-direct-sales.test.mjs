/* Direct sales of Matthew McCluster's own recordings (music_direct_*).

   The pure decision code the three functions share
   (supabase/functions/_shared/music-direct.ts) runs here under Node's
   TypeScript stripping, with the negatives that matter: another session,
   amount/currency swaps, a connected account, unpaid, replay, refunded,
   revoked, expired and over the download limit. The source contracts pin
   what the functions do with those answers. The database half is
   scripts/test-music-direct-sales-db.sh. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import {
  ALLOWED_ORIGINS, DIRECT_BUCKET, audioFormatOf, formatLabel, DIRECT_DEFAULTS, MUSIC_DIRECT_KIND, SITE, assetPathProblem, catalogKeyOf, corsHeaders,
  directFulfilmentRefusal, directUploadPath, downloadNameFor, downloadRefusal, offerKeyFor, offerSaleRefusal, priceProblem,
  tokenRevealAllowed
} from '../../supabase/functions/_shared/music-direct.ts';

const read = (p) => readFile(p, 'utf8');

const ORDER = {
  id: '50000000-0000-4000-8000-000000000001',
  offer_key: 'here--here',
  stripe_checkout_session_id: 'cs_live_direct1',
  amount_cents: 199,
  currency: 'usd',
  status: 'pending'
};
const SESSION = {
  id: 'cs_live_direct1',
  object: 'checkout.session',
  mode: 'payment',
  payment_status: 'paid',
  amount_total: 199,
  currency: 'usd',
  metadata: { kind: MUSIC_DIRECT_KIND, music_direct_order_id: ORDER.id, music_direct_offer_key: 'here--here' }
};
const PLATFORM = { id: 'evt_1' };

/* ---------------- fulfilment binding ---------------- */

test('the order\'s own paid platform session fulfils it', () => {
  assert.equal(directFulfilmentRefusal(SESSION, PLATFORM, ORDER), null);
  assert.equal(directFulfilmentRefusal(SESSION, PLATFORM, { ...ORDER, status: 'failed' }), null, 'a failed attempt may be retried in the same session');
});

test('a replay of an already-paid order under the same session is accepted (the database makes it a no-op)', () => {
  assert.equal(directFulfilmentRefusal(SESSION, PLATFORM, { ...ORDER, status: 'paid' }), null);
});

test('another session, even paid and pointing at this order, is refused', () => {
  assert.equal(directFulfilmentRefusal({ ...SESSION, id: 'cs_live_someone_else' }, PLATFORM, ORDER), 'session_mismatch');
  assert.equal(directFulfilmentRefusal(SESSION, PLATFORM, { ...ORDER, stripe_checkout_session_id: null }), 'session_mismatch');
});

test('amount and currency must be the order\'s', () => {
  assert.equal(directFulfilmentRefusal({ ...SESSION, amount_total: 50 }, PLATFORM, ORDER), 'amount_mismatch');
  assert.equal(directFulfilmentRefusal({ ...SESSION, amount_total: null }, PLATFORM, ORDER), 'amount_mismatch');
  assert.equal(directFulfilmentRefusal({ ...SESSION, currency: 'eur' }, PLATFORM, ORDER), 'currency_mismatch');
  assert.equal(directFulfilmentRefusal({ ...SESSION, currency: 'USD' }, PLATFORM, ORDER), null, 'case is not a difference');
});

test('a connected account\'s event never fulfils a platform sale', () => {
  assert.equal(directFulfilmentRefusal(SESSION, { id: 'evt_2', account: 'acct_attacker' }, ORDER), 'account_mismatch');
});

test('unpaid, non-payment and non-direct sessions are refused', () => {
  assert.equal(directFulfilmentRefusal({ ...SESSION, payment_status: 'unpaid' }, PLATFORM, ORDER), 'not_paid');
  assert.equal(directFulfilmentRefusal({ ...SESSION, mode: 'subscription' }, PLATFORM, ORDER), 'not_a_payment');
  assert.equal(directFulfilmentRefusal({ ...SESSION, metadata: { ...SESSION.metadata, kind: 'music_license_sale' } }, PLATFORM, ORDER), 'not_a_direct_sale');
  assert.equal(directFulfilmentRefusal({ ...SESSION, metadata: null }, PLATFORM, ORDER), 'not_a_direct_sale');
  assert.equal(directFulfilmentRefusal(null, PLATFORM, ORDER), 'not_a_direct_sale');
});

test('metadata is a pointer that must agree, never proof', () => {
  assert.equal(directFulfilmentRefusal({ ...SESSION, metadata: { ...SESSION.metadata, music_direct_order_id: '50000000-0000-4000-8000-0000000000ff' } }, PLATFORM, ORDER), 'order_mismatch');
  assert.equal(directFulfilmentRefusal({ ...SESSION, metadata: { ...SESSION.metadata, music_direct_offer_key: 'here--antisocial' } }, PLATFORM, ORDER), 'offer_mismatch');
  assert.equal(directFulfilmentRefusal(SESSION, PLATFORM, null), 'order_not_found');
});

test('refunded and canceled orders are not payable', () => {
  assert.equal(directFulfilmentRefusal(SESSION, PLATFORM, { ...ORDER, status: 'refunded' }), 'order_not_payable');
  assert.equal(directFulfilmentRefusal(SESSION, PLATFORM, { ...ORDER, status: 'canceled' }), 'order_not_payable');
});

/* ---------------- downloads ---------------- */

const NOW = new Date('2026-11-01T00:00:00Z');
const ENT = { revoked_at: null, download_count: 0, max_downloads: 5, expires_at: '2026-12-01T00:00:00Z' };

test('a live entitlement downloads; revoked, unpaid, expired and over-limit do not', () => {
  assert.equal(downloadRefusal(ENT, 'paid', NOW), null);
  assert.equal(downloadRefusal({ ...ENT, download_count: 4 }, 'paid', NOW), null, 'the last one');
  assert.equal(downloadRefusal({ ...ENT, download_count: 5 }, 'paid', NOW), 'download_limit');
  assert.equal(downloadRefusal({ ...ENT, revoked_at: '2026-10-31T00:00:00Z' }, 'paid', NOW), 'revoked');
  assert.equal(downloadRefusal(ENT, 'refunded', NOW), 'not_paid');
  assert.equal(downloadRefusal(ENT, 'pending', NOW), 'not_paid');
  assert.equal(downloadRefusal({ ...ENT, expires_at: '2026-10-31T23:59:59Z' }, 'paid', NOW), 'expired');
  assert.equal(downloadRefusal({ ...ENT, expires_at: null }, 'paid', NOW), 'expired');
  assert.equal(downloadRefusal(null, 'paid', NOW), 'not_found');
});

test('the checkout session reveals the token for 24 hours after payment, then never', () => {
  assert.equal(DIRECT_DEFAULTS.tokenRevealHours, 24);
  assert.equal(tokenRevealAllowed('2026-10-31T01:00:00Z', NOW), true);
  assert.equal(tokenRevealAllowed('2026-10-30T23:59:00Z', NOW), false);
  assert.equal(tokenRevealAllowed(null, NOW), false, 'an unpaid order reveals nothing');
});

test('defaults: 5 downloads, 30 days, 300-second signed links', () => {
  assert.deepEqual([DIRECT_DEFAULTS.maxDownloads, DIRECT_DEFAULTS.downloadWindowDays, DIRECT_DEFAULTS.signedUrlSeconds], [5, 30, 300]);
});

/* ---------------- offers, files, keys ---------------- */

test('offer keys and catalogue keys join the album page to the catalogue', () => {
  assert.equal(offerKeyFor('here:who-did-the-shoot'), 'here--who-did-the-shoot');
  assert.equal(offerKeyFor('nope'), null);
  assert.equal(catalogKeyOf('prim3', 'Got WiFi?'), 'prim3:got-wifi');
  assert.equal(catalogKeyOf('vaunt-ep', 'Vaunt (Acoustic)'), 'vaunt-ep:vaunt-acoustic');
  assert.equal(catalogKeyOf('equity-uprise', 'Environmental Injustice (Brave mix)'), 'equity-uprise:environmental-injustice-brave-mix');
});

test('every track in data/albums.json maps to a catalogue key of the shape the database keys', async () => {
  const albums = JSON.parse(await read('data/albums.json')).albums;
  const seed = await read('supabase/migrations/20261003233747_action_network_live_governance_v1.sql');
  for (const a of albums) for (const t of a.tracks) {
    const key = catalogKeyOf(a.slug, t.title);
    assert.match(key, /^[a-z0-9-]+:[a-z0-9-]+$/);
    assert.ok(seed.includes(`'${key}'`), `${key} is a public.music_catalog_objects row`);
  }
});

test('the browser joins with the same rule as the server', async () => {
  const src = await read('js/music-direct.js');
  const m = /function slug\(s\) \{ return ([^}]+) \}/.exec(src);
  assert.ok(m, 'js/music-direct.js has slug()');
  const slug = new Function('s', 'return ' + m[1].replace(/;\s*$/, ''));
  const catalogKey = (a, t) => slug(a) + ':' + slug(t);
  for (const [a, t] of [['prim3', 'Got WiFi?'], ['here', 'Who Did The Shoot'], ['whip-equipped', 'Dealer Plates (A-Side)']]) {
    assert.equal(catalogKey(a, t), catalogKeyOf(a, t));
  }
});

test('price, file and sale-window checks', () => {
  assert.equal(priceProblem(199), null);
  assert.ok(priceProblem(49));
  assert.ok(priceProblem(50001));
  assert.ok(priceProblem(1.5));
  assert.ok(priceProblem('199'));
  assert.equal(assetPathProblem(DIRECT_BUCKET, 'direct-sales/here/here/u-here.mp3'), null);
  assert.ok(assetPathProblem('creator-previews', 'direct-sales/here/here/u-here.mp3'), 'public bucket refused');
  assert.ok(assetPathProblem(DIRECT_BUCKET, 'niggy-nigg/niggy-nigg.mp3'), 'outside the prefix refused');
  assert.ok(assetPathProblem(DIRECT_BUCKET, 'direct-sales/../niggy-nigg/niggy-nigg.mp3'), 'traversal refused');
  assert.ok(assetPathProblem(DIRECT_BUCKET, 'direct-sales/here/here/u-here.exe'), 'not audio refused');
  const p = directUploadPath('here:here', 'My Master (final).WAV', '11111111-1111-4111-8111-111111111111');
  assert.equal(p, 'direct-sales/here/here/11111111-1111-4111-8111-111111111111-my-master-final-.wav');
  assert.equal(assetPathProblem(DIRECT_BUCKET, p), null, 'what the upload grants, the save accepts');
  assert.equal(directUploadPath('here:here', 'cover.png', 'x'), null);
  assert.equal(downloadNameFor('Got WiFi?', p), 'McCluster - Got WiFi.wav');
  const on = { offer_key: 'here--here', active: true, price_cents: 199, currency: 'usd' };
  assert.equal(offerSaleRefusal(on, NOW), null);
  assert.equal(offerSaleRefusal({ ...on, active: false }, NOW), 'offer_unavailable');
  assert.equal(offerSaleRefusal({ ...on, sale_starts_at: '2026-11-02T00:00:00Z' }, NOW), 'sale_not_started');
  assert.equal(offerSaleRefusal({ ...on, sale_ends_at: '2026-11-01T00:00:00Z' }, NOW), 'sale_ended');
  assert.equal(offerSaleRefusal(null, NOW), 'offer_unavailable');
});

test('CORS answers only Matthew\'s property', () => {
  assert.deepEqual(ALLOWED_ORIGINS, ['https://matthew.mccluster.org']);
  assert.equal(corsHeaders('https://matthew.mccluster.org')['Access-Control-Allow-Origin'], 'https://matthew.mccluster.org');
  assert.equal(corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], SITE);
  assert.equal(corsHeaders(null)['Access-Control-Allow-Origin'], SITE);
  assert.doesNotMatch(corsHeaders(null)['Access-Control-Allow-Headers'], /authorization/);
  assert.match(corsHeaders(null, true)['Access-Control-Allow-Headers'], /authorization/);
});

/* ---------------- what the functions do with those answers ---------------- */

test('music-direct-checkout: server price, platform account, stored session, purchase page returns', async () => {
  const src = await read('supabase/functions/music-direct-checkout/index.ts');
  assert.match(src, /const HOUSE = "https:\/\/matthew\.mccluster\.org";/);
  assert.equal(SITE, 'https://matthew.mccluster.org', 'HOUSE equals the shared SITE');
  assert.match(src, /success_url: `\$\{HOUSE\}\/purchase\.html\?session_id=\{CHECKOUT_SESSION_ID\}`/);
  assert.match(src, /cancel_url: `\$\{HOUSE\}\/purchase\.html\?canceled=1/);
  assert.doesNotMatch(src, /end-racism|campaign_key/, 'no campaign page, no campaign');
  assert.doesNotMatch(src, /stripeAccount|transfer_data|on_behalf_of/, 'platform account only');
  assert.match(src, /unit_amount: o\.price_cents/, 'price from the offer row');
  assert.doesNotMatch(src, /body\.(price|amount|currency|title)/, 'nothing priced from the request');
  assert.match(src, /stripe_checkout_session_id: session\.id/);
  assert.match(src, /sessions\.expire\(session\.id\)/, 'an unrecorded session is expired');
  assert.match(src, /corsHeaders\(req\.headers\.get\("origin"\)\)/);
  assert.doesNotMatch(src, /"Access-Control-Allow-Origin": "\*"/);
  await access('purchase.html');
});

test('music-direct-access: orders found by the stored session, fulfilled by the database, downloads counted there', async () => {
  const src = await read('supabase/functions/music-direct-access/index.ts');
  assert.match(src, /\.eq\("stripe_checkout_session_id", session\.id\)/, 'order by stored session id');
  assert.doesNotMatch(src, /metadata\?\.music_direct_order_id/, 'never by metadata');
  assert.match(src, /directFulfilmentRefusal\(session as any, \{ account: null \}, order as any\)/);
  assert.match(src, /admin\.rpc\("music_direct_fulfil"/);
  assert.match(src, /admin\.rpc\("music_direct_claim_download"/);
  assert.match(src, /tokenRevealAllowed\(/);
  assert.match(src, /createSignedUrl\(r\.path, DIRECT_DEFAULTS\.signedUrlSeconds/);
  /* the old contract signed for 900s straight from a session id; now a session id never signs */
  const claimFn = src.slice(src.indexOf('async function claim('), src.indexOf('async function tokenRow('));
  assert.doesNotMatch(claimFn, /createSignedUrl/);
  /* every operator action verifies the caller first */
  assert.match(src, /if \(action\.startsWith\("operator-"\)\) \{\s*await operatorFrom\(req\);/);
  assert.match(src, /isHouseOperator\(admin as any, data\.user\.id\)/);
  const house = await read('supabase/functions/_shared/house-ops.ts');
  assert.match(house, /p_capability: "ops\.use"/);
  assert.match(house, /eq\("slug", "mccluster"\)/);
  assert.match(src, /createSignedUploadUrl\(path, \{ upsert: false \}\)/, 'uploads never overwrite');
});

test('stripe-webhook: direct sales bound, platform only, refunds revoke', async () => {
  const src = await read('supabase/functions/stripe-webhook/index.ts');
  assert.match(src, /directFulfilmentRefusal\(session as any, event as any, order\)/);
  assert.match(src, /rpc\/music_direct_fulfil/);
  assert.equal((src.match(/if \(direct && effects && !\(await grantDirectOrder\(s, event, direct\)\)\) direct = null;/g) || []).length, 2, 'completed and async_payment_succeeded');
  assert.match(src, /if \(effects && !event\.account\) await revokeDirectByPaymentIntent\(/);
  assert.match(src, /music_direct_orders\?id=eq\.\$\{encodeURIComponent\(s\.metadata\.music_direct_order_id!\)\}&stripe_checkout_session_id=eq\.\$\{encodeURIComponent\(s\.id\)\}/, 'only the stored session expires an order');
  assert.match(src, /music_direct_orders\?stripe_payment_intent_id=eq\.\$\{encodeURIComponent\(paymentIntent\)\}&status=eq\.paid/);
});

test('config: both functions are public at the gateway and declared, with a recorded control', async () => {
  const toml = await read('supabase/config.toml');
  for (const fn of ['music-direct-checkout', 'music-direct-access']) {
    assert.match(toml, new RegExp(`\\[functions\\.${fn}\\]\\nverify_jwt = false\\n`), fn);
  }
  const posture = await read('docs/control-plane/SECURITY-POSTURE.md');
  assert.match(posture, /\| `music-direct-checkout` \|/);
  assert.match(posture, /\| `music-direct-access` \|/);
  const ci = await read('.github/workflows/music-platform-ci.yml');
  assert.match(ci, /deno check --node-modules-dir=auto supabase\/functions\/music-direct-checkout\/index\.ts/);
  assert.match(ci, /deno check --node-modules-dir=auto supabase\/functions\/music-direct-access\/index\.ts/);
});

test('pending SQL: guards, RLS and the functions the edge code calls', async () => {
  const sql = await read('supabase/pending/music_direct_sales_v1.sql');
  for (const name of ['music_direct_fulfil', 'music_direct_claim_download', 'music_direct_order_guard', 'music_direct_entitlement_guard', 'music_direct_order_revoke']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`), name);
  }
  assert.match(sql, /grant select \(offer_key, catalog_key, title, price_cents, currency, format, active, sale_starts_at, sale_ends_at\)\s+on table public\.music_direct_offers to anon, authenticated/);
  assert.match(sql, /add column if not exists format text generated always as \(lower\(substring\(asset_path from/);
  assert.doesNotMatch(sql.match(/grant select \([^)]*\)/)[0], /asset_|download_name/, 'never the file');
  assert.match(sql, /revoke all on table public\.music_direct_orders from public, anon, authenticated/);
  assert.match(sql, /revoke all on table public\.music_direct_entitlements from public, anon, authenticated/);
  assert.match(sql, /asset_bucket = 'mcc-gated-audio'/);
  const rollback = await read('supabase/pending/music_direct_sales_v1.rollback.sql');
  assert.match(rollback, /drop function if exists public\.music_direct_fulfil/);
  const order = await read('supabase/pending/PROMOTION-ORDER.md');
  assert.match(order, /music_direct_sales_v1\.sql/);
  const readme = await read('supabase/pending/README.md');
  assert.match(readme, /music_direct_sales_v1\.sql/);
});

test('buyer and owner pages load the scripts, Matthew-first', async () => {
  const album = await read('album.html');
  const cat = await read('catalogue.html');
  const control = await read('control.html');
  const ops = await read('js/control-room/music-ops.js');
  const purchase = await read('purchase.html');
  assert.match(album, /<script src="js\/music-direct\.js\?v=__STAMP__"><\/script>/);
  assert.match(cat, /<script src="js\/music-direct\.js\?v=__STAMP__"><\/script>/);
  assert.match(cat, /data-albslug='" \+ slug \+ "' data-title='/);
  /* the owner's panel lives in Control · Create · Music (music-admin.html forwards there) */
  assert.ok(control.indexOf('js/control-room/music-direct-sales.js') > 0 && control.indexOf('js/control-room/music-direct-sales.js') < control.indexOf('js/control-room/music-ops.js'), 'loaded before music-ops');
  assert.match(ops, /\["direct","Direct sales"\]/);
  assert.match(ops, /window\.CR\.musicDirect\.bind\(root\)/);
  assert.match(purchase, /<meta name="robots" content="noindex">/);
  assert.match(purchase, /Matthew McCluster/);
  assert.doesNotMatch(purchase, /Equity Uprise|McCluster Corp/, 'Matthew\'s property, not the company\'s');
  assert.doesNotMatch(purchase, /@media\s*\(max-width/, 'min-width queries only');
  assert.doesNotMatch(purchase, /user-scalable=no|maximum-scale/);
  const adminJs = await read('js/control-room/music-direct-sales.js');
  assert.doesNotMatch(adminJs, /rest\/v1\/music_direct|M\.supa\(|supa\("music_direct/, 'never a direct client write');
  assert.match(adminJs, /\/functions\/v1\/music-direct-access/);
});

test('the buyer is told the real format: the file is delivered unconverted', async () => {
  assert.equal(audioFormatOf('direct-sales/here/antisocial/u-master.wav'), 'wav');
  assert.equal(audioFormatOf('direct-sales/here/here/u.FLAC'), 'flac');
  assert.equal(audioFormatOf('direct-sales/here/here/u.m4a'), 'm4a');
  assert.equal(audioFormatOf('direct-sales/here/here/u.exe'), null);
  assert.equal(audioFormatOf(null), null);
  assert.deepEqual(['mp3', 'm4a', 'wav', 'flac', 'ogg', null].map(formatLabel), ['MP3', 'M4A', 'WAV', 'FLAC', 'Audio', 'Audio']);
  const checkout = await read('supabase/functions/music-direct-checkout/index.ts');
  assert.doesNotMatch(checkout, /MP3/, 'no blanket MP3 promise');
  assert.match(checkout, /name: `\$\{o\.title\} \(\$\{label\} download\)`/);
  assert.match(checkout, /format: audioFormatOf\(o\.asset_path\),/);
  const offersAction = checkout.slice(checkout.indexOf('if (action === "offers")'), checkout.indexOf('if (action !== "checkout")'));
  assert.doesNotMatch(offersAction.slice(offersAction.indexOf('.map(')), /asset_path:|asset_path,/, 'the public list names the format, never the path');
  const buy = await read('js/music-direct.js');
  assert.match(buy, /b\.textContent = "Buy " \+ fmt \+ " \\u2014 "/);
  assert.doesNotMatch(buy, /"Buy MP3/);
  const purchase = await read('js/music-purchase.js');
  assert.match(purchase, /"Download " \+ fmt/);
  const access = await read('supabase/functions/music-direct-access/index.ts');
  assert.match(access, /format: audioFormatOf\(d\.asset_path\)/);
  const desk = await read('js/control-room/music-direct-sales.js');
  assert.match(desk, /sold as " \+ e\(fmtOf\(file\)\) \+ ", unconverted\)/);
});
