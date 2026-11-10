/* Buyer recovery, end to end without a browser or a network:

     the REAL purchase page script (js/music-purchase.js, in a vm)
       -> the REAL music-direct-access handler (its own source, types stripped)
         -> the REAL applied SQL on a local PostgreSQL (PGlite), as service_role.

   Only Stripe and Storage signing are stand-ins (support/music-direct-database.mjs).
   "Lost" means the function ran to the end and the answer never reached the page,
   which is the case the retry key exists for.

   Usage (from the repository root):
     PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test/music-direct-buyer-recovery.integration.mjs */
import assert from 'node:assert/strict';
import { ATTEMPT_KEY_RE, REFUSAL_HTTP } from '../../supabase/functions/_shared/music-direct.ts';
import { createMusicDirectDatabase, fetchThrough } from './support/music-direct-database.mjs';
import { loadPurchasePage, memoryStorage } from './support/music-purchase-page.mjs';

const database = await createMusicDirectDatabase();
let passes = 0;
const pass = (name) => { passes++; console.log('PASS: ' + name); };
const V1 = 'direct-sales/here/antisocial/v1-antisocial.wav';
const UNSURE = /may or may not have been counted.*will not use another download/;

try {
  console.log((await database.sql('select version()'))[0].version.split(',')[0]);
  await database.saveOffer({ catalogKey: 'here:antisocial', title: 'Antisocial', assetPath: V1, maxDownloads: 5 });

  /** A paid purchase, claimed by the page itself after Stripe's return. */
  async function purchase({ drop, offerKey = 'here--antisocial' } = {}) {
    const { sessionId, orderId } = await database.buy(offerKey);
    const net = fetchThrough(database, { drop });
    const storage = memoryStorage();
    const page = await loadPurchasePage({ search: '?session_id=' + sessionId, fetch: net.fetch, sessionStorage: storage });
    const token = new URLSearchParams(page.location.search).get('token');
    assert.match(token || '', /^[0-9a-f-]{36}$/, 'the page claimed the purchase and kept its token');
    assert.equal(page.el.ppDownload.disabled, false);
    const reload = (extra = {}) => loadPurchasePage({ search: '?token=' + token, fetch: net.fetch, sessionStorage: storage, clock: page.clock, ...extra });
    return { page, net, storage, token, orderId, reload, count: async () => (await database.entitlement(token)).download_count };
  }
  /** lose the answer to the nth download request (1-based), and only that one */
  const loseDownload = (...nth) => { let i = 0; return (body) => body.action === 'download' && nth.includes(++i); };

  /* ------------------------------------------------------------------ the recovery */
  {
    const p = await purchase({ drop: loseDownload(1) });
    await p.page.click();
    assert.match(p.page.el.ppStatus.textContent, UNSURE);
    assert.equal(p.page.el.ppDownload.disabled, false);
    assert.deepEqual(p.page.assigned, [], 'the buyer got nothing');
    assert.equal(await p.count(), 1, 'but the server counted it');
    const [first] = p.net.downloads();
    assert.equal(first.status, 200);
    assert.match(first.body.attempt_key, ATTEMPT_KEY_RE);
    assert.deepEqual((await database.attempts(p.token)).map((a) => [a.attempt_key, a.state]), [[first.body.attempt_key, 'issued']]);

    await p.page.click();
    const [, second] = p.net.downloads();
    assert.equal(second.body.attempt_key, first.body.attempt_key, 'the page resent the same key');
    assert.equal(second.status, 200);
    assert.equal(second.data.replay, true);
    assert.equal(second.data.downloads_left, 4);
    assert.equal(await p.count(), 1, 'one slot for one delivered file');
    assert.equal((await database.attempts(p.token)).length, 1, 'the same attempt, not a second one');
    assert.equal(p.page.assigned.length, 1);
    assert.ok(p.page.assigned[0].includes('/' + V1 + '?'), 'the delivered URL is the purchased file');
    assert.equal(p.page.el.ppStatus.textContent, '4 downloads left.');
    assert.equal(p.storage.map.size, 0, 'nothing unresolved is kept');
    pass('lost answer, retry with the same key: one slot consumed, the file delivered');

    await p.page.click();
    const [, , third] = p.net.downloads();
    assert.notEqual(third.body.attempt_key, first.body.attempt_key);
    assert.equal(third.data.replay, false);
    assert.equal(await p.count(), 2);
    assert.equal((await database.attempts(p.token)).length, 2);
    pass('the next deliberate download is a new attempt with a new key and its own slot');
  }

  /* ------------------------------------------------------------------ the contrast: no key */
  {
    const p = await purchase();
    const lost = await database.call({ action: 'download', token: p.token });
    assert.equal(lost.status, 200, 'the function issued a URL the buyer never received');
    const again = await database.call({ action: 'download', token: p.token });
    assert.equal(again.status, 200);
    assert.equal(again.data.replay, false);
    assert.equal(again.data.attempt_key, null);
    assert.equal(await p.count(), 2, 'without a key the retry is a second download');
    assert.deepEqual((await database.attempts(p.token)).map((a) => [a.attempt_key, a.state]), [[null, 'issued'], [null, 'issued']]);
    pass('contrast: the same loss without attempt_key costs two slots for one file');
  }

  /* ------------------------------------------------------------------ reload of the kept link */
  {
    const p = await purchase({ drop: loseDownload(1) });
    await p.page.click();
    const reloaded = await p.reload();
    assert.match(reloaded.el.ppMeta.textContent, /^4 of 5 downloads left/, 'the reload shows what the server counted');
    await reloaded.click();
    const [first, second] = p.net.downloads();
    assert.equal(second.body.attempt_key, first.body.attempt_key);
    assert.equal(second.data.replay, true);
    assert.equal(await p.count(), 1);
    assert.equal(reloaded.assigned.length, 1);
    pass('the kept key survives a reload of the kept link: same attempt, one slot');
  }

  /* ------------------------------------------------------------------ the last slot */
  {
    await database.saveOffer({ catalogKey: 'here:lightroom', title: 'Lightroom', assetPath: 'direct-sales/here/lightroom/v1-lightroom.mp3', maxDownloads: 1 });
    const p = await purchase({ drop: loseDownload(1), offerKey: 'here--lightroom' });
    await p.page.click();
    assert.equal(await p.count(), 1);
    const reloaded = await p.reload();
    const status = p.net.seen.at(-1);
    assert.equal(status.data.can_download, false);
    assert.equal(status.data.refusal.reason, 'download_limit', 'the server says the purchase is used up');
    assert.equal(reloaded.el.ppDownload.disabled, false, 'the unresolved attempt is still askable');
    assert.match(reloaded.el.ppStatus.textContent, UNSURE);
    await reloaded.click();
    const last = p.net.downloads().at(-1);
    assert.equal(last.status, 200, 'a known key is answered before the limit is checked');
    assert.equal(last.data.replay, true);
    assert.equal(last.data.downloads_left, 0);
    assert.equal(await p.count(), 1);
    assert.equal(reloaded.assigned.length, 1);
    assert.equal(reloaded.el.ppDownload.disabled, true, 'and then the purchase is closed');
    /* a different key cannot get past the limit */
    const fresh = await database.call({ action: 'download', token: p.token, attempt_key: 'another-key-0001' });
    assert.equal(fresh.status, 429);
    assert.equal(fresh.data.reason, 'download_limit');
    pass('a lost answer on the LAST download is recovered after a reload, and only by its own key');
  }

  /* ------------------------------------------------------------------ signing failures */
  {
    const p = await purchase();
    database.signer.failNext = 1;
    await p.page.click();
    const [first] = p.net.downloads();
    assert.equal(first.status, 503);
    assert.equal(first.data.reason, 'sign_retry');
    assert.equal(first.data.attempt_key, first.body.attempt_key, 'v42 echoes the key');
    assert.equal(p.page.el.ppStatus.textContent, REFUSAL_HTTP.sign_retry.message);
    assert.equal(p.page.el.ppDownload.disabled, false);
    assert.equal(await p.count(), 0, 'nothing was used');
    assert.deepEqual((await database.attempts(p.token)).map((a) => a.state), ['released']);
    /* what the SQL does with that echoed key: it is spent */
    const spent = await database.call({ action: 'download', token: p.token, attempt_key: first.body.attempt_key });
    assert.equal(spent.status, 409);
    assert.equal(spent.data.reason, 'attempt_spent');
    assert.equal(p.storage.map.size, 0, 'so the page did not keep it');
    await p.page.click();
    const second = p.net.downloads().at(-1);
    assert.notEqual(second.body.attempt_key, first.body.attempt_key);
    assert.equal(second.status, 200);
    assert.equal(await p.count(), 1);
    assert.equal(p.page.assigned.length, 1);
    pass('signing failure on a first send: slot released, the key is spent, the page starts a new attempt');
  }
  {
    const p = await purchase({ drop: loseDownload(1) });
    await p.page.click();
    assert.equal(await p.count(), 1);
    database.signer.failNext = 1;
    await p.page.click();
    const [first, second] = p.net.downloads();
    assert.equal(second.body.attempt_key, first.body.attempt_key);
    assert.equal(second.status, 503);
    assert.equal(second.data.attempt_key, first.body.attempt_key);
    assert.deepEqual((await database.attempts(p.token)).map((a) => a.state), ['issued'], 'an issued attempt is never released');
    assert.equal(await p.count(), 1, 'so "nothing was used" would be untrue here');
    assert.match(p.page.el.ppStatus.textContent, UNSURE);
    assert.doesNotMatch(p.page.el.ppStatus.textContent, /Nothing was used/);
    await p.page.click();
    const third = p.net.downloads().at(-1);
    assert.equal(third.body.attempt_key, first.body.attempt_key, 'the page kept the key the server still honours');
    assert.equal(third.status, 200);
    assert.equal(third.data.replay, true);
    assert.equal(await p.count(), 1);
    assert.equal(p.page.assigned.length, 1);
    pass('lost answer, then a signing failure on the retry: the key is kept, the third try delivers, one slot');
  }

  /* ------------------------------------------------------------------ the function dies between reserve and settle */
  {
    const p = await purchase();
    database.signer.throwNext = 1;
    await p.page.click();
    const [first] = p.net.downloads();
    assert.equal(first.status, 500);
    assert.deepEqual((await database.attempts(p.token)).map((a) => a.state), ['reserved'], 'a hold is left behind');
    assert.equal(await p.count(), 0);
    assert.match(p.page.el.ppStatus.textContent, UNSURE);
    await p.page.click();
    const second = p.net.downloads().at(-1);
    assert.equal(second.body.attempt_key, first.body.attempt_key);
    assert.equal(second.status, 200);
    assert.equal(second.data.replay, true, 'the held attempt, not a second hold');
    assert.deepEqual((await database.attempts(p.token)).map((a) => a.state), ['issued']);
    assert.equal(await p.count(), 1);
    pass('a 500 after the hold was taken: the same key finishes the same attempt');
  }
  {
    const p = await purchase();
    database.signer.throwNext = 1;
    await p.page.click();
    await database.asOwner((sql) => sql(`update public.music_direct_download_attempts set reservation_expires_at = now() - interval '1 second' where attempt_key = $1`, [p.net.downloads()[0].body.attempt_key]));
    await p.page.click();
    const second = p.net.downloads().at(-1);
    assert.equal(second.status, 409);
    assert.equal(second.data.reason, 'attempt_spent');
    assert.equal(p.page.el.ppStatus.textContent, REFUSAL_HTTP.attempt_spent.message);
    assert.equal(p.page.el.ppDownload.disabled, false, 'the server asked for a new attempt, so the button stays');
    assert.equal(await p.count(), 0);
    await p.page.click();
    const third = p.net.downloads().at(-1);
    assert.notEqual(third.body.attempt_key, second.body.attempt_key);
    assert.equal(third.status, 200);
    assert.equal(await p.count(), 1);
    pass('a hold that lapsed: attempt_spent ends the key, the next click is a new attempt');
  }

  /* ------------------------------------------------------------------ the limits of recovery */
  {
    const p = await purchase({ drop: loseDownload(1) });
    await p.page.click();
    await database.asOwner((sql) => sql(`update public.music_direct_download_attempts set issued_at = now() - interval '301 seconds' where attempt_key = $1`, [p.net.downloads()[0].body.attempt_key]));
    await p.page.click();
    const second = p.net.downloads().at(-1);
    assert.equal(second.body.attempt_key, p.net.downloads()[0].body.attempt_key);
    assert.equal(second.status, 409);
    assert.equal(second.data.reason, 'attempt_spent');
    assert.equal(p.page.el.ppDownload.disabled, false);
    assert.equal(p.storage.map.size, 0);
    await p.page.click();
    assert.equal(await p.count(), 2, 'past the 300 s replay window the lost download stays counted and a new one is a new slot');
    assert.equal(p.page.assigned.length, 1);
    pass('past the replay window the server refuses the key; the page says so and starts over (the counted slot is not recovered)');
  }
  {
    const p = await purchase({ drop: loseDownload(1) });
    await p.page.click();
    await database.sql(`update public.music_direct_orders set status = 'refunded' where id = $1`, [p.orderId]);
    await p.page.click();
    const second = p.net.downloads().at(-1);
    assert.equal(second.status, 403);
    assert.equal(second.data.reason, 'revoked');
    assert.equal(second.data.url, undefined);
    assert.equal(p.page.el.ppStatus.textContent, REFUSAL_HTTP.revoked.message);
    assert.equal(p.page.el.ppDownload.disabled, true);
    assert.equal(p.storage.map.size, 0, 'a refusal ends the key');
    assert.deepEqual(p.page.assigned, []);
    pass('a refund while the outcome was unknown: the kept key delivers nothing');
  }

  /* ------------------------------------------------------------------ a key belongs to one purchase */
  {
    const a = await purchase({ drop: loseDownload(1) });
    await a.page.click();
    const keyA = a.net.downloads()[0].body.attempt_key;
    const b = await purchase();
    /* the other purchase opened in the same tab: same sessionStorage */
    const other = await loadPurchasePage({ search: '?token=' + b.token, fetch: b.net.fetch, sessionStorage: a.storage, clock: a.page.clock });
    await other.click();
    const sent = b.net.downloads().at(-1);
    assert.notEqual(sent.body.attempt_key, keyA);
    assert.equal(sent.data.replay, false);
    assert.equal(await b.count(), 1);
    assert.equal(await a.count(), 1);
    /* and the server scopes a key to its entitlement: A's key on B is simply a new attempt of B's */
    const crossed = await database.call({ action: 'download', token: b.token, attempt_key: keyA });
    assert.equal(crossed.data.replay, false);
    assert.equal(await b.count(), 2);
    assert.equal(await a.count(), 1);
    pass('a kept key is never sent for another purchase, and would not replay there if it were');
  }

  /* the only 500s are the two storage outages induced above */
  assert.equal(database.logged.filter((l) => l[0] === 'music direct access').length, 2, JSON.stringify(database.logged));
  console.log(`PASS: ${passes} buyer-recovery scenarios (real page script, real handler, real SQL)`);
} finally {
  await database.close();
}
