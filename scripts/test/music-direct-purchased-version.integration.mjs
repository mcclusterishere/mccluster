/* What a purchase is CALLED must be what it delivers (COM-1 follow-up).

   A purchase pins one music_direct_asset_versions row (title, file, download name).
   The owner then edits the offer: a new title AND a new file in another format. The
   old purchase must still be named, on claim, status and download, after the version
   it pinned; only a purchase made after the edit reads as the new one.

   The REAL music-direct-access handler on the REAL applied SQL (PGlite), with the real
   purchase page script for what the buyer finally sees. Stripe and Storage signing are
   stand-ins (support/music-direct-database.mjs).

   Usage (from the repository root):
     PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test/music-direct-purchased-version.integration.mjs */
import assert from 'node:assert/strict';
import { createMusicDirectDatabase, fetchThrough } from './support/music-direct-database.mjs';
import { loadPurchasePage } from './support/music-purchase-page.mjs';

const database = await createMusicDirectDatabase();
let passes = 0;
const pass = (name) => { passes++; console.log('PASS: ' + name); };
const OLD = { title: 'Antisocial', path: 'direct-sales/here/antisocial/v1-antisocial.wav', name: 'McCluster - Antisocial.wav', format: 'wav' };
const NEW = { title: 'Antisocial (2027 Remaster)', path: 'direct-sales/here/antisocial/v2-antisocial-remaster.flac', name: 'McCluster - Antisocial (2027 Remaster).flac', format: 'flac' };
const named = (data, want, source = 'purchase') => {
  assert.equal(data.title, want.title);
  assert.equal(data.format, want.format);
  assert.equal(data.title_source, source);
};
const claimed = async (sessionId) => { const r = await database.call({ action: 'claim', session_id: sessionId }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
const status = async (token) => { const r = await database.call({ action: 'status', token }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

try {
  console.log((await database.sql('select version()'))[0].version.split(',')[0]);
  await database.saveOffer({ catalogKey: 'here:antisocial', title: OLD.title, assetPath: OLD.path });
  const before = await database.buy('here--antisocial');
  const first = await claimed(before.sessionId);
  named(first, OLD);
  const token = first.token;

  /* the owner retitles the offer and replaces the file with another format */
  await database.saveOffer({ catalogKey: 'here:antisocial', title: NEW.title, assetPath: NEW.path });
  const [offer] = await database.sql(`select title, format, download_name from public.music_direct_offers where offer_key = 'here--antisocial'`);
  assert.deepEqual(offer, { title: NEW.title, format: NEW.format, download_name: NEW.name }, 'the live offer now reads as the new file');

  {
    const again = await claimed(before.sessionId);
    named(again, OLD);
    assert.equal(again.token, token);
    assert.equal(again.can_download, true);
    pass('claim after the offer was edited: the title and format of the purchased version');
  }
  {
    const s = await status(token);
    named(s, OLD);
    assert.equal(s.state, 'paid');
    assert.equal(s.downloads_left, 5);
    pass('status after the offer was edited: the title and format of the purchased version');
  }
  {
    const d = await database.call({ action: 'download', token, attempt_key: 'purchased-version-1' });
    assert.equal(d.status, 200);
    assert.equal(d.data.title, OLD.title);
    assert.equal(d.data.format, OLD.format);
    const signed = database.signer.calls.at(-1);
    assert.deepEqual({ path: signed.path, download: signed.download }, { path: OLD.path, download: OLD.name }, 'the purchased bytes, under the purchased name');
    assert.ok(signed.download.endsWith('.' + d.data.format) && signed.path.endsWith('.' + d.data.format), 'answer, file name and bytes agree');
    assert.ok(d.data.url.includes(OLD.path) && !d.data.url.includes('remaster'));
    pass('download after the offer was edited: the purchased file, its name and its format');
  }
  {
    /* what the buyer sees on the kept link */
    const net = fetchThrough(database);
    const page = await loadPurchasePage({ search: '?token=' + token, fetch: net.fetch });
    assert.equal(page.el.ppTitle.textContent, 'Antisocial · WAV');
    assert.equal(page.el.ppDownload.textContent, 'Download WAV');
    await page.click();
    assert.equal(page.assigned.length, 1);
    assert.ok(page.assigned[0].includes(OLD.path));
    assert.match(decodeURIComponent(page.assigned[0]), /download=McCluster - Antisocial\.wav$/);
    pass('the purchase page names the old purchase as what it downloads');
  }
  {
    const after = await database.buy('here--antisocial');
    const c = await claimed(after.sessionId);
    named(c, NEW);
    named(await status(c.token), NEW);
    const d = await database.call({ action: 'download', token: c.token, attempt_key: 'purchased-version-2' });
    assert.equal(d.data.title, NEW.title);
    assert.equal(d.data.format, NEW.format);
    const signed = database.signer.calls.at(-1);
    assert.deepEqual({ path: signed.path, download: signed.download }, { path: NEW.path, download: NEW.name });
    /* and the first purchase did not move */
    named(await status(token), OLD);
    pass('a purchase made after the edit reads and delivers the new version; the earlier one is unchanged');
  }
  {
    /* past the 24-hour reveal the session id still describes the purchase, by its pin */
    await database.asOwner(async (sql) => {
      await sql('alter table public.music_direct_orders disable trigger music_direct_order_guard_trg');
      await sql(`update public.music_direct_orders set paid_at = now() - interval '25 hours' where id = $1`, [before.orderId]);
      await sql('alter table public.music_direct_orders enable trigger music_direct_order_guard_trg');
    });
    const late = await claimed(before.sessionId);
    assert.equal(late.token_hidden, true);
    assert.equal(late.token, undefined);
    named(late, OLD);
    pass('claim past the token reveal window: still the purchased version');
  }
  {
    /* a refunded purchase is closed, and is still called what was bought */
    const gone = await database.buy('here--antisocial');
    const c = await claimed(gone.sessionId);
    await database.saveOffer({ catalogKey: 'here:antisocial', title: 'Antisocial (Live)', assetPath: 'direct-sales/here/antisocial/v3-antisocial-live.mp3' });
    await database.sql(`update public.music_direct_orders set status = 'refunded' where id = $1`, [gone.orderId]);
    const s = await status(c.token);
    assert.equal(s.state, 'revoked');
    assert.equal(s.can_download, false);
    named(s, NEW);
    const again = await database.call({ action: 'claim', session_id: gone.sessionId });
    assert.equal(again.data.state, 'revoked');
    pass('a refunded purchase keeps the name of what was bought');
  }
  {
    /* a file name that does not agree with the pinned bytes is never handed to the buyer */
    await database.sql(`insert into public.music_direct_offers(offer_key, catalog_key, title, price_cents, asset_bucket, asset_path, download_name, active)
      values ('here--lightroom', 'here:lightroom', 'Lightroom', 299, 'mcc-gated-audio', 'direct-sales/here/lightroom/master.wav', 'Lightroom (album cut).mp3', true)`);
    const odd = await database.buy('here--lightroom');
    const c = await claimed(odd.sessionId);
    named(c, { title: 'Lightroom', format: 'wav' });
    const d = await database.call({ action: 'download', token: c.token });
    assert.equal(d.data.format, 'wav');
    let signed = database.signer.calls.at(-1);
    assert.equal(signed.path, 'direct-sales/here/lightroom/master.wav');
    assert.equal(signed.download, 'McCluster - Lightroom.wav', 'a .mp3 name is not put on WAV bytes');
    /* a name the owner chose that does agree is kept as it is */
    await database.sql(`update public.music_direct_offers set download_name = 'Lightroom (album cut).wav' where offer_key = 'here--lightroom'`);
    const kept = await claimed((await database.buy('here--lightroom')).sessionId);
    await database.call({ action: 'download', token: kept.token });
    signed = database.signer.calls.at(-1);
    assert.equal(signed.download, 'Lightroom (album cut).wav');
    pass('the download name always agrees with the delivered bytes');
  }
  {
    /* a purchase with NO pinned version (a legacy order the owner has not resolved): the only fallback, and it says so */
    const legacy = await database.buy('here--antisocial');
    const c = await claimed(legacy.sessionId);
    await database.asOwner(async (sql) => {
      for (const t of ['music_direct_orders', 'music_direct_entitlements']) await sql(`alter table public.${t} disable trigger user`);
      await sql('update public.music_direct_entitlements set asset_version_id = null where order_id = $1', [legacy.orderId]);
      await sql('update public.music_direct_orders set asset_version_id = null where id = $1', [legacy.orderId]);
      for (const t of ['music_direct_orders', 'music_direct_entitlements']) await sql(`alter table public.${t} enable trigger user`);
    });
    const [live] = await database.sql(`select title, format from public.music_direct_offers where offer_key = 'here--antisocial'`);
    const s = await status(c.token);
    named(s, live, 'offer');
    assert.equal(s.can_download, false);
    assert.equal(s.refusal.reason, 'asset_unresolved');
    named(await claimed(legacy.sessionId), live, 'offer');
    const signedBefore = database.signer.calls.length;
    const d = await database.call({ action: 'download', token: c.token });
    assert.equal(d.status, 409);
    assert.equal(d.data.reason, 'asset_unresolved');
    assert.equal(database.signer.calls.length, signedBefore, 'nothing is signed for an unpinned purchase');
    /* the page does not promise a format for it */
    const page = await loadPurchasePage({ search: '?token=' + c.token, fetch: fetchThrough(database).fetch });
    assert.equal(page.el.ppTitle.textContent, live.title);
    assert.equal(page.el.ppDownload.textContent, 'Download');
    assert.equal(page.el.ppDownload.disabled, true);
    assert.match(page.el.ppMeta.textContent, /^shown as listed today/);
    pass('an unpinned purchase falls back to the live offer and says title_source "offer"; it downloads nothing');
  }

  assert.equal(database.logged.filter((l) => l[0] === 'music direct access').length, 0, JSON.stringify(database.logged));
  console.log(`PASS: ${passes} purchased-version scenarios (real handler, real SQL)`);
} finally {
  await database.close();
}
