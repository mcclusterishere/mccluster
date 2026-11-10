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
  directFulfilmentRefusal, directUploadPath, downloadNameFor, downloadRefusal, offerKeyFor, offerSaleRefusal, priceProblem, ATTEMPT_KEY_RE, REFUSAL_HTTP,
  tokenRevealAllowed
} from '../../supabase/functions/_shared/music-direct.ts';

import { loadAccessHandler, paidSession } from './support/music-direct-access-handler.mjs';
import { loadPurchasePage, answer } from './support/music-purchase-page.mjs';

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
  assert.equal(downloadRefusal({ ...ENT, asset_version_id: null }, 'paid', NOW), 'asset_unresolved', 'an unpinned legacy purchase is refused, never given today\'s file');
  assert.equal(downloadRefusal({ ...ENT, asset_version_id: '10000000-0000-4000-8000-000000000001' }, 'paid', NOW), null);
  assert.equal(REFUSAL_HTTP.asset_unresolved.status, 409);
  assert.equal(REFUSAL_HTTP.sign_retry.status, 503);
  assert.ok(ATTEMPT_KEY_RE.test('retry-key-00000001') && !ATTEMPT_KEY_RE.test('short') && !ATTEMPT_KEY_RE.test('a'.repeat(81)));
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
  /* the original seed, plus the pending seeds for the Whip Equipped and PRIM3 tracks added 2026-10-31 */
  const seed = await read('supabase/migrations/20261003233747_action_network_live_governance_v1.sql')
    + await read('supabase/pending/20261031180100_whip_equipped_catalog_objects.sql')
    + await read('supabase/pending/20261031190000_prim3_catalog_objects.sql');
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
  /* COM-2: a download is reserved, signed, then settled; the one-step claim (count before sign) is never called here */
  assert.doesNotMatch(src, /music_direct_claim_download/, 'the handler never counts before it signs');
  assert.match(src, /admin\.rpc\("music_direct_reserve_download", \{ p_token: token, p_attempt_key: attemptKey \}\)/);
  assert.match(src, /ATTEMPT_KEY_RE\.test\(attemptKey\)/);
  const download = src.slice(src.indexOf('music_direct_reserve_download'), src.indexOf('if (action === "operator-status")'));
  assert.ok(download.indexOf('createSignedUrl(') < download.indexOf('p_outcome: "issued"'), 'issued only after a signed url exists');
  assert.match(download, /if \(signError \|\| !signed\?\.signedUrl\) \{\s*const \{ data: released, error: releaseError \} = await admin\.rpc\("music_direct_settle_download", \{ p_attempt: r\.attempt_id, p_outcome: "released" \}\)/, 'a signing failure releases the slot');
  assert.match(download, /reason: "sign_retry"/);
  assert.match(download, /downloads_left: st\.downloads_left/, 'what is left comes from settlement, not the reservation');
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

test('music-direct-access: claim and status name the purchase by its pinned version, never the live offer', async () => {
  const src = await read('supabase/functions/music-direct-access/index.ts');
  assert.doesNotMatch(src, /offerTitle\(/, 'no helper that names a purchase from the offer alone');
  const named = src.slice(src.indexOf('async function purchasedTitle('), src.indexOf('function describe('));
  const pinned = named.indexOf('admin.from("music_direct_asset_versions").select("title,asset_path").eq("id", ent.asset_version_id)');
  const offer = named.indexOf('admin.from("music_direct_offers")');
  assert.ok(pinned > 0 && offer > pinned, 'the pinned version is read first; the offer only after it');
  assert.match(named, /if \(ent\?\.asset_version_id\) \{/);
  assert.match(named, /if \(v\) return \{ title: \(v as any\)\.title, format: audioFormatOf\(\(v as any\)\.asset_path\), title_source: "purchase" \};/);
  assert.match(named, /return \{ title: d\.title, format: audioFormatOf\(d\.asset_path\), title_source: "offer" \};/, 'the fallback says it is the offer');
  assert.equal((src.match(/music_direct_offers"\)\.select\("title/g) || []).length, 1, 'one place reads a title from the offer: that fallback');
  /* both answers go through it, with the entitlement */
  const claimFn = src.slice(src.indexOf('async function claim('), src.indexOf('async function tokenRow('));
  assert.match(claimFn, /describe\(ent, \(fresh as any\)\?\.status, await purchasedTitle\(ent, o\.offer_key\)\)/);
  assert.match(src, /describe\(ent, orderStatus, await purchasedTitle\(ent, ent\.offer_key\)\)/);
  assert.match(src, /title_source: shown\.title_source,/);
  assert.match(src, /const ENT_COLUMNS = "[^"]*asset_version_id"/, 'the entitlement row carries its pin');
  /* the download: the pinned title, the pinned file's format, and a file name of the same type as the bytes */
  const download = src.slice(src.indexOf('music_direct_reserve_download'), src.indexOf('if (action === "operator-status")'));
  assert.match(download, /const fileName = audioFormatOf\(r\.download_name\) === audioFormatOf\(r\.path\) \? r\.download_name : downloadNameFor\(r\.title, r\.path\);/);
  assert.match(download, /createSignedUrl\(r\.path, DIRECT_DEFAULTS\.signedUrlSeconds, \{ download: fileName \}\)/);
  assert.match(download, /title: r\.title, format: audioFormatOf\(r\.path\), url: signed\.signedUrl/);
  /* and the version row does record both, immutably */
  const sql = await read('supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql');
  assert.match(sql, /download_name text not null,\s+title text not null,\s+format text generated always as \(lower\(substring\(asset_path from/);
  assert.match(sql, /if tg_op = 'UPDATE' then raise exception 'music_direct_asset_version_immutable'; end if;/);
  assert.match(sql, /'title', v\.title, 'bucket', v\.asset_bucket, 'path', v\.asset_path, 'download_name', v\.download_name/);
});

/* The function's own source over in-memory rows (the applied SQL half runs in
   music-direct-purchased-version.integration.mjs): an offer edited AFTER the purchase,
   title and format both changed. */
async function editedOfferFixture() {
  const OLD = { id: '10000000-0000-4000-8000-000000000001', offer_key: 'here--antisocial', asset_bucket: DIRECT_BUCKET, asset_path: 'direct-sales/here/antisocial/v1-antisocial.wav', download_name: 'McCluster - Antisocial.wav', title: 'Antisocial' };
  const NEW = { id: '10000000-0000-4000-8000-000000000002', offer_key: 'here--antisocial', asset_bucket: DIRECT_BUCKET, asset_path: 'direct-sales/here/antisocial/v2-remaster.flac', download_name: 'McCluster - Antisocial (2027 Remaster).flac', title: 'Antisocial (2027 Remaster)' };
  const order = (n, version) => ({ id: `50000000-0000-4000-8000-00000000000${n}`, offer_key: 'here--antisocial', stripe_checkout_session_id: 'cs_test_edit' + n, amount_cents: 199, currency: 'usd', status: 'paid', paid_at: new Date().toISOString(), asset_version_id: version });
  const ent = (n, version) => ({ id: `60000000-0000-4000-8000-00000000000${n}`, order_id: `50000000-0000-4000-8000-00000000000${n}`, offer_key: 'here--antisocial', token: `70000000-0000-4000-8000-00000000000${n}`, download_count: 0, max_downloads: 5, expires_at: '2999-01-01T00:00:00Z', revoked_at: null, asset_version_id: version });
  const tables = {
    music_direct_offers: [{ offer_key: 'here--antisocial', catalog_key: 'here:antisocial', title: NEW.title, asset_path: NEW.asset_path, download_name: NEW.download_name, current_version_id: NEW.id }],
    music_direct_asset_versions: [OLD, NEW],
    /* 1 bought before the edit, 2 after it, 3 a legacy purchase with no pin */
    music_direct_orders: [order(1, OLD.id), order(2, NEW.id), order(3, null)],
    music_direct_entitlements: [ent(1, OLD.id), ent(2, NEW.id), ent(3, null)]
  };
  const signed = [];
  const from = (table) => {
    const filters = [];
    const rows = () => tables[table].filter((r) => filters.every(([c, v]) => r[c] === v));
    const b = { select: () => b, limit: () => b, eq: (c, v) => { filters.push([c, v]); return b; }, maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }) };
    return b;
  };
  const rpc = async (name, args) => {
    if (name === 'music_direct_fulfil') return { data: { ok: true, newly_paid: false }, error: null };
    if (name === 'music_direct_settle_download') return { data: { ok: true, state: args.p_outcome, downloads_left: 4 }, error: null };
    /* what public.music_direct_reserve_download answers: the entitlement's pinned version row */
    const e = tables.music_direct_entitlements.find((x) => x.token === args.p_token);
    const v = tables.music_direct_asset_versions.find((x) => x.id === e.asset_version_id);
    if (!v) return { data: { ok: false, reason: 'asset_unresolved' }, error: null };
    return { data: { ok: true, attempt_id: 'a', state: 'reserved', replay: false, title: v.title, bucket: v.asset_bucket, path: v.asset_path, download_name: v.download_name, expires_at: e.expires_at }, error: null };
  };
  const storage = { from: (bucket) => ({ createSignedUrl: async (path, _seconds, options) => { signed.push({ bucket, path, download: options.download }); return { data: { signedUrl: 'https://storage.invalid/' + path }, error: null }; } }) };
  const sessions = new Map(tables.music_direct_orders.map((o) => [o.stripe_checkout_session_id, paidSession({ sessionId: o.stripe_checkout_session_id, orderId: o.id, offerKey: o.offer_key, amountCents: 199 })]));
  const { call, logged } = await loadAccessHandler({ admin: { from, rpc, storage }, sessions });
  return { OLD, NEW, tables, signed, call, logged };
}

test('an offer edited after the purchase: claim, status and download still name the purchased title and format', async () => {
  const { OLD, NEW, tables, signed, call, logged } = await editedOfferFixture();
  const token = (n) => tables.music_direct_entitlements[n - 1].token;
  for (const [n, want] of [[1, OLD], [2, NEW]]) {
    const format = audioFormatOf(want.asset_path);
    const claim = await call({ action: 'claim', session_id: 'cs_test_edit' + n });
    assert.equal(claim.status, 200);
    assert.deepEqual([claim.data.title, claim.data.format, claim.data.title_source, claim.data.token], [want.title, format, 'purchase', token(n)], 'claim ' + n);
    const status = await call({ action: 'status', token: token(n) });
    assert.deepEqual([status.data.title, status.data.format, status.data.title_source, status.data.can_download], [want.title, format, 'purchase', true], 'status ' + n);
    const download = await call({ action: 'download', token: token(n) });
    assert.deepEqual([download.status, download.data.title, download.data.format], [200, want.title, format], 'download ' + n);
    assert.deepEqual(signed.at(-1), { bucket: DIRECT_BUCKET, path: want.asset_path, download: want.download_name }, 'the pinned bytes under the pinned name');
  }
  assert.notEqual(OLD.title, NEW.title);
  assert.deepEqual([audioFormatOf(OLD.asset_path), audioFormatOf(NEW.asset_path)], ['wav', 'flac'], 'title and format both changed');
  assert.deepEqual(logged, []);
});

test('only a purchase with no pinned version is named after the live offer, and the answer says so', async () => {
  const { NEW, tables, signed, call } = await editedOfferFixture();
  const token = tables.music_direct_entitlements[2].token;
  for (const r of [await call({ action: 'claim', session_id: 'cs_test_edit3' }), await call({ action: 'status', token })]) {
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.title, r.data.format, r.data.title_source], [NEW.title, 'flac', 'offer']);
    assert.equal(r.data.can_download, false);
    assert.equal(r.data.refusal.reason, 'asset_unresolved');
  }
  const download = await call({ action: 'download', token });
  assert.deepEqual([download.status, download.data.reason], [409, 'asset_unresolved']);
  assert.deepEqual(signed, [], 'nothing is signed for it');
  /* an offer that is gone altogether still answers, as before */
  tables.music_direct_offers.length = 0;
  const bare = await call({ action: 'status', token });
  assert.deepEqual([bare.data.title, bare.data.format, bare.data.title_source], ['Your track', null, 'offer']);
});

test('the purchase page promises a format only for a pinned purchase', async () => {
  const view = { ok: true, state: 'paid', title: 'Antisocial', format: 'wav', downloads_used: 0, downloads_left: 5, max_downloads: 5, expires_at: '2026-12-09T00:00:00Z', can_download: true, refusal: null };
  const page = (v) => loadPurchasePage({ search: '?token=6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b', fetch: async () => answer(200, v) });
  for (const pinned of [{ ...view, title_source: 'purchase' }, view /* v42 sends no title_source */]) {
    const p = await page(pinned);
    assert.equal(p.el.ppTitle.textContent, 'Antisocial \u00b7 WAV');
    assert.equal(p.el.ppDownload.textContent, 'Download WAV');
    assert.match(p.el.ppMeta.textContent, /^5 of 5 downloads left/);
    assert.equal(p.el.ppDownload.disabled, false);
  }
  /* no pinned file: the title is today's listing, said as such, with no format on the title or the button */
  const unresolved = await page({ ...view, title: 'Antisocial (2027 Remaster)', format: 'flac', title_source: 'offer', can_download: false,
    refusal: { reason: 'asset_unresolved', message: REFUSAL_HTTP.asset_unresolved.message } });
  assert.equal(unresolved.el.ppTitle.textContent, 'Antisocial (2027 Remaster)');
  assert.equal(unresolved.el.ppDownload.textContent, 'Download');
  assert.match(unresolved.el.ppMeta.textContent, /^shown as listed today \u00b7 5 of 5 downloads left/);
  assert.equal(unresolved.el.ppDownload.disabled, true);
  assert.equal(unresolved.el.ppStatus.textContent, REFUSAL_HTTP.asset_unresolved.message);
});

test('the download file name is the type of the bytes delivered', async () => {
  const { OLD, tables, signed, call } = await editedOfferFixture();
  const token = tables.music_direct_entitlements[0].token;
  /* a pinned row whose name says another type (a row written by hand, not by operator-direct-save) */
  OLD.download_name = 'Antisocial (album cut).mp3';
  let r = await call({ action: 'download', token });
  assert.equal(r.data.format, 'wav');
  assert.deepEqual(signed.at(-1), { bucket: DIRECT_BUCKET, path: OLD.asset_path, download: downloadNameFor(OLD.title, OLD.asset_path) });
  assert.equal(signed.at(-1).download, 'McCluster - Antisocial.wav');
  /* a chosen name of the right type is kept */
  OLD.download_name = 'Antisocial (album cut).WAV';
  r = await call({ action: 'download', token });
  assert.equal(signed.at(-1).download, 'Antisocial (album cut).WAV');
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

test('applied SQL: guards, RLS and the functions the edge code calls', async () => {
  const sql = await read('supabase/migrations/20261031180839_music_direct_sales_v1.sql');
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
  assert.match(access, /format: audioFormatOf\(\(v as any\)\.asset_path\)/, 'a purchase is labelled with the format of its pinned file');
  const desk = await read('js/control-room/music-direct-sales.js');
  assert.match(desk, /sold as " \+ e\(fmtOf\(file\)\) \+ ", unconverted\)/);
});

