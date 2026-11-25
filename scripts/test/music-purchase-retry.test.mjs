/* purchase.html: the buyer's download retry key (COM-2 follow-up).

   The real js/music-purchase.js runs in a vm against a fake document, fetch,
   sessionStorage, timers and clock (support/music-purchase-page.mjs). What it
   must do is fixed by the applied SQL, which the last tests pin:

     key the server has never seen          a new attempt (one slot once issued)
     reserved and still held (120 s)        the same attempt again
     issued, inside 300 s                   the same attempt again, nothing counted
     issued, past 300 s                     409 attempt_spent
     released (signing failed) or lapsed    409 attempt_spent
     revoked, refunded, expired, unresolved refused before the key is looked at

   So: a fresh key for every deliberate download, the SAME key while the outcome
   is unknown, and no key once a URL or a refusal came back. The database half,
   with the real handler, is music-direct-buyer-recovery.integration.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ATTEMPT_KEY_RE, REFUSAL_HTTP, DIRECT_DEFAULTS } from '../../supabase/functions/_shared/music-direct.ts';
import { loadPurchasePage, memoryStorage, answer, PURCHASE_FUNCTION_URL } from './support/music-purchase-page.mjs';

const TOKEN = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const STORE = (t) => 'mcc_direct_attempt:' + t;
const VIEW = { ok: true, state: 'paid', title: 'Antisocial', format: 'wav', downloads_used: 1, downloads_left: 4, max_downloads: 5, expires_at: '2026-12-09T00:00:00Z', can_download: true, refusal: null };
const URL_OK = (left = 3) => answer(200, { ok: true, title: 'Antisocial', format: 'wav', url: 'https://storage.invalid/signed/antisocial.wav', expires_in: 300, downloads_left: left, attempt_key: 'echo', replay: false });
const LOST = () => Promise.reject(new TypeError('Failed to fetch'));
const refusal = (reason, extra = {}) => answer(REFUSAL_HTTP[reason].status, { error: REFUSAL_HTTP[reason].message, reason, ...extra });

/** A scripted function: `downloads` answers the download requests in order; status and claim answer `view`. */
function scripted(downloads, { view = VIEW } = {}) {
  const sent = [];
  const queue = [...downloads];
  const fetch = (url, opt) => {
    assert.equal(url, PURCHASE_FUNCTION_URL, 'only the access function is called');
    const body = JSON.parse(opt.body);
    if (body.action === 'status') return Promise.resolve(answer(200, view));
    if (body.action === 'claim') return Promise.resolve(answer(200, { ...view, token: TOKEN }));
    sent.push({ body, signal: opt.signal });
    const next = queue.shift();
    if (!next) throw new Error('the page sent a download the test did not expect');
    return typeof next === 'function' ? next(body, opt) : Promise.resolve(next);
  };
  return { fetch, sent, keys: () => sent.map((s) => s.body.attempt_key) };
}
const open = (server, extra = {}) => loadPurchasePage({ search: '?token=' + TOKEN, fetch: server.fetch, ...extra });
const unsure = (page) => {
  assert.match(page.el.ppStatus.textContent, /may or may not have been counted/, 'the buyer is told the outcome is not known');
  assert.match(page.el.ppStatus.textContent, /will not use another download/, 'and that trying again is safe');
  assert.equal(page.el.ppStatus.getAttribute('data-tone'), 'bad');
  assert.equal(page.el.ppDownload.disabled, false, 'an unknown outcome never leaves the button disabled');
};

test('every deliberate download sends a fresh key, and a delivered URL ends it', async () => {
  const server = scripted([URL_OK(3), URL_OK(2)]);
  const page = await open(server);
  assert.equal(page.el.ppDownload.disabled, false);
  await page.click();
  assert.deepEqual(page.assigned, ['https://storage.invalid/signed/antisocial.wav']);
  assert.equal(page.el.ppStatus.textContent, '3 downloads left.');
  assert.equal(page.sessionStorage.map.has(STORE(TOKEN)), false, 'nothing unresolved is kept after a delivery');
  await page.click();
  const [first, second] = server.keys();
  assert.match(first, ATTEMPT_KEY_RE);
  assert.match(second, ATTEMPT_KEY_RE);
  assert.notEqual(first, second, 'a new deliberate download is a new attempt');
  assert.deepEqual(Object.keys(server.sent[0].body).sort(), ['action', 'attempt_key', 'token']);
  assert.equal(server.sent[0].body.token, TOKEN);
  assert.equal(page.assigned.length, 2);
});

test('a lost response keeps the key: the next click sends the SAME key, and delivery ends it', async () => {
  const server = scripted([LOST, URL_OK(3), URL_OK(2)]);
  const page = await open(server);
  await page.click();
  unsure(page);
  assert.deepEqual(page.assigned, [], 'nothing is opened on an unknown outcome');
  const kept = JSON.parse(page.sessionStorage.map.get(STORE(TOKEN)));
  assert.equal(kept.key, server.keys()[0]);
  assert.equal(kept.token, TOKEN);
  await page.click();
  assert.equal(server.keys()[1], server.keys()[0], 'the retry is the same attempt');
  assert.equal(page.assigned.length, 1);
  assert.equal(page.sessionStorage.map.has(STORE(TOKEN)), false);
  await page.click();
  assert.notEqual(server.keys()[2], server.keys()[0], 'after delivery the next click is a new download');
});

test('the key is stored before the request leaves, so a reload while it is in flight asks about the same attempt', async () => {
  const storage = memoryStorage();
  let seen = null;
  const server = scripted([(body) => { seen = JSON.parse(storage.map.get(STORE(TOKEN))).key === body.attempt_key; return new Promise(() => {}); }, URL_OK()]);
  const page = await open(server, { sessionStorage: storage });
  await page.click();
  assert.equal(seen, true);
  assert.equal(page.el.ppDownload.disabled, true, 'still waiting');
  const reloaded = await open(server, { sessionStorage: storage, clock: page.clock });
  await reloaded.click();
  assert.equal(server.keys()[1], server.keys()[0]);
  assert.equal(reloaded.assigned.length, 1);
});

test('no answer inside the bound is an unknown outcome: the request is aborted, the button returns, the key stays', async () => {
  let late;
  const server = scripted([(_b, opt) => new Promise((ok) => { late = ok; assert.ok(opt.signal, 'the request carries an abort signal'); }), URL_OK()]);
  const page = await open(server);
  await page.click();
  assert.equal(page.el.ppDownload.disabled, true);
  await page.elapse(19999);
  assert.equal(page.el.ppDownload.disabled, true, 'not before the bound');
  assert.equal(page.el.ppStatus.textContent, 'Preparing your download…');
  await page.elapse(20000);
  unsure(page);
  assert.equal(server.sent[0].signal.aborted, true, 'the abandoned request is aborted');
  /* an answer that arrives after the page gave up opens nothing and changes nothing */
  late(URL_OK());
  await page.settle();
  assert.deepEqual(page.assigned, []);
  unsure(page);
  await page.click();
  assert.equal(server.keys()[1], server.keys()[0], 'same key after a timeout');
  assert.equal(page.assigned.length, 1);
});

test('without AbortController the bound still holds', async () => {
  const server = scripted([() => new Promise(() => {}), URL_OK()]);
  const page = await open(server, { abortController: null });
  await page.click();
  assert.equal(server.sent[0].signal, undefined, 'no signal to give');
  await page.elapse(20000);
  unsure(page);
  await page.click();
  assert.equal(server.keys()[1], server.keys()[0]);
});

test('a 5xx that is not a refusal, and any body the page cannot read, keep the key', async () => {
  const cases = {
    '500 from the handler': answer(500, { error: 'download service unavailable' }),
    '502 with an HTML body': answer(502, null, { raw: '<html>Bad gateway</html>' }),
    '503 without a reason': answer(503, { error: 'Service Unavailable' }),
    '504 empty': answer(504, null, { raw: '' }),
    '200 that is not JSON': answer(200, null, { raw: 'ok' }),
    '200 without a URL': answer(200, { ok: true, downloads_left: 3 }),
    '200 with a null body': answer(200, null),
    '403 from something that is not the function': answer(403, null, { raw: '<html>Forbidden</html>' }),
    /* a 4xx is the function's only when it carries one of the function's reasons: anything in between can answer 4xx */
    '429 from a gateway': answer(429, { message: 'Too many requests' }),
    '404 from a gateway': answer(404, { message: 'Requested function was not found' }),
    '401 from a gateway': answer(401, { msg: 'Invalid JWT' }),
    '408 empty object': answer(408, {}),
    '403 with an error but no reason': answer(403, { error: 'Forbidden' }),
    '429 with a reason the function never sends': answer(429, { error: 'slow down', reason: 'rate_limited' }),
    '409 with a reason that is not a string': answer(409, { error: 'conflict', reason: 7 }),
    '404 with a null body': answer(404, null),
    '429 with a string body': answer(429, 'rate limited'),
    '409 with an array body': answer(409, ['attempt_spent']),
    'json() that rejects': { ok: true, status: 200, json: () => Promise.reject(new Error('stream cut')) },
    'fetch that throws': () => { throw new Error('blocked'); }
  };
  for (const [name, first] of Object.entries(cases)) {
    const server = scripted([first, URL_OK()]);
    const page = await open(server);
    await page.click();
    unsure(page);
    assert.deepEqual(page.assigned, [], name);
    await page.click();
    assert.equal(server.keys()[1], server.keys()[0], name + ': same key');
    assert.equal(page.assigned.length, 1, name);
    /* the same answer to a resend keeps the key too */
    const again = scripted([LOST, first, URL_OK()]);
    const resending = await open(again);
    await resending.click();
    await resending.click();
    unsure(resending);
    await resending.click();
    assert.deepEqual(again.keys(), [again.keys()[0], again.keys()[0], again.keys()[0]], name + ' on a resend: same key');
    assert.equal(resending.assigned.length, 1, name + ' on a resend');
  }
});

test('503 sign_retry: a first send drops the key (the released attempt is spent); a resend keeps it only while the server echoes it', async () => {
  /* first send: the hold this request made was released, so the key can only answer attempt_spent */
  let server = scripted([(b) => Promise.resolve(refusal('sign_retry', { attempt_key: b.attempt_key })), URL_OK()]);
  let page = await open(server);
  await page.click();
  assert.equal(page.el.ppStatus.textContent, REFUSAL_HTTP.sign_retry.message, 'the server\'s own words: nothing was used');
  assert.equal(page.el.ppDownload.disabled, false);
  assert.equal(page.sessionStorage.map.has(STORE(TOKEN)), false);
  await page.click();
  assert.notEqual(server.keys()[1], server.keys()[0], 'a new key after a first-send sign_retry');
  assert.equal(page.assigned.length, 1);

  /* resend: the attempt may already be issued and counted; an issued attempt is never released and replays */
  server = scripted([LOST, (b) => Promise.resolve(refusal('sign_retry', { attempt_key: b.attempt_key })), URL_OK()]);
  page = await open(server);
  await page.click();
  await page.click();
  unsure(page);
  assert.doesNotMatch(page.el.ppStatus.textContent, /Nothing was used/, 'the page does not repeat a claim it cannot know');
  await page.click();
  assert.deepEqual(server.keys(), [server.keys()[0], server.keys()[0], server.keys()[0]], 'same key after sign_retry on a resend');
  assert.equal(page.assigned.length, 1);

  /* resend, but settlement refused: the handler answers attempt_key null, the key is over */
  server = scripted([LOST, refusal('sign_retry', { attempt_key: null }), URL_OK()]);
  page = await open(server);
  await page.click();
  await page.click();
  assert.equal(page.el.ppStatus.textContent, REFUSAL_HTTP.sign_retry.message);
  assert.equal(page.el.ppDownload.disabled, false);
  await page.click();
  assert.notEqual(server.keys()[2], server.keys()[0]);
});

test('every final refusal ends the key, on a first send and on a resend', async () => {
  const finals = [
    ['not_found', true], ['revoked', true], ['not_paid', true], ['expired', true], ['download_limit', true], ['asset_unresolved', true],
    ['attempt_spent', false]
  ];
  for (const [reason, closes] of finals) {
    for (const resend of [false, true]) {
      const storage = memoryStorage();
      const server = scripted([...(resend ? [LOST] : []), refusal(reason, { attempt_key: null }), URL_OK()]);
      const page = await open(server, { sessionStorage: storage });
      if (resend) await page.click();
      await page.click();
      const name = `${reason}${resend ? ' on a resend' : ''}`;
      assert.equal(page.el.ppStatus.textContent, REFUSAL_HTTP[reason].message, name);
      assert.equal(storage.map.has(STORE(TOKEN)), false, name + ': key dropped');
      assert.equal(page.el.ppDownload.disabled, closes, name + ': button');
      /* the next deliberate download (after a reload where the button was closed) uses a new key */
      const next = closes ? await open(server, { sessionStorage: storage, clock: page.clock }) : page;
      await next.click();
      const keys = server.keys();
      assert.notEqual(keys.at(-1), keys[0], name + ': new key');
      assert.match(keys.at(-1), ATTEMPT_KEY_RE);
    }
  }
  /* 400 has no reason: a malformed link or key was never an attempt */
  const server = scripted([LOST, answer(400, { error: 'invalid attempt key' }), URL_OK()]);
  const page = await open(server);
  await page.click();
  await page.click();
  assert.equal(page.el.ppStatus.textContent, 'invalid attempt key');
  assert.equal(page.el.ppDownload.disabled, false);
  await page.click();
  assert.notEqual(server.keys()[2], server.keys()[0]);
});

test('the unresolved key survives a reload for as long as the server could still answer it, and no longer', async () => {
  const storage = memoryStorage();
  const server = scripted([LOST, LOST, URL_OK(), URL_OK()]);
  const first = await open(server, { sessionStorage: storage });
  await first.click();
  const key = server.keys()[0];
  /* request bound + the 120 s hold + the 300 s replay window, from the last send */
  const life = 20000 + 120000 + 300000;
  const clock = { now: first.clock.now + life - 1 };
  const reloaded = await open(server, { sessionStorage: storage, clock });
  await reloaded.click();
  assert.equal(server.keys()[1], key, 'still the same attempt just inside the window');
  /* that resend restarted the clock: it may have been the one the server issued */
  clock.now += life - 1;
  const again = await open(server, { sessionStorage: storage, clock });
  await again.click();
  assert.equal(server.keys()[2], key);
  assert.equal(again.assigned.length, 1);

  const stale = scripted([LOST, URL_OK()]);
  const storage2 = memoryStorage();
  const a = await open(stale, { sessionStorage: storage2 });
  await a.click();
  const b = await open(stale, { sessionStorage: storage2, clock: { now: a.clock.now + life } });
  await b.click();
  assert.notEqual(stale.keys()[1], stale.keys()[0], 'past the window the click is a new download');
});

test('the page\'s window is the server\'s: a 120 s hold nobody overrides and a 300 s replay', async () => {
  const sql = await readFile('supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql', 'utf8');
  assert.match(sql, /music_direct_reserve_download\(p_token uuid, p_attempt_key text default null, p_hold_seconds integer default 120\)/);
  assert.equal((sql.match(/interval '300 seconds'/g) || []).length, 2, 'reserve and settle agree on the replay window');
  const handler = await readFile('supabase/functions/music-direct-access/index.ts', 'utf8');
  assert.doesNotMatch(handler, /p_hold_seconds/, 'the handler uses the default hold');
  assert.equal(DIRECT_DEFAULTS.signedUrlSeconds, 300);
  const page = await readFile('js/music-purchase.js', 'utf8');
  assert.match(page, /var ASK_MS = 20000;\n\s*var KEY_LIFE_MS = ASK_MS \+ 120000 \+ 300000;/);
  assert.match(page, new RegExp('var ATTEMPT_KEY_RE = ' + ATTEMPT_KEY_RE.source.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&').replace(/^/, '\\/') + '\\/;'), 'the same shape the server accepts');
  assert.doesNotMatch(page, /Math\.random/, 'never Math.random');
  /* the attempt is written to this tab's store and the shared one, never anywhere else */
  assert.match(page, /storeWrite\(ATTEMPT_STORE \+ id, JSON\.stringify\(kept\)\);/);
  assert.doesNotMatch(page, /document\.cookie|indexedDB/);
  /* the page ends an attempt only on the function's own refusals: every reason the function can answer, and its fallback */
  const listed = JSON.parse(page.match(/var FUNCTION_REFUSALS = (\[[^\]]*\]);/)[1]);
  assert.deepEqual([...listed].sort(), [...Object.keys(REFUSAL_HTTP), 'refused'].sort(), 'the page knows exactly the function\'s reasons');
  assert.match(handler, /return json\(\{ error: h\.message, reason: r\?\.reason \|\| "refused" \}, h\.status\);/);
  /* the hold the "still finishing" answer waits out */
  assert.match(page, /var HOLD_MS = ASK_MS \+ 120000;/);
  /* what the page was told to expect from the SQL */
  assert.match(sql, /if \(a\.state = 'issued' and a\.issued_at > now\(\) - interval '300 seconds'\)\s+or \(a\.state = 'reserved' and a\.reservation_expires_at > now\(\)\) then/);
  assert.match(sql, /return jsonb_build_object\('ok', false, 'reason', 'attempt_spent', 'attempt_id', a\.id, 'state', a\.state\);/);
  /* refusals are decided before the key is looked at */
  assert.ok(sql.indexOf("v_refusal := public.music_direct_delivery_refusal(e);") < sql.indexOf("where entitlement_id = e.id and attempt_key = p_attempt_key"));
  /* the two sign_retry answers the page tells apart */
  assert.match(handler, /return json\(\{ error: h\.message, reason: "sign_retry", attempt_key: attemptKey \}, h\.status\);/);
  assert.match(handler, /return json\(\{ error: h\.message, reason, attempt_key: null \}, h\.status\);/);
});

test('a key never crosses purchases', async () => {
  const storage = memoryStorage();
  const server = scripted([LOST, URL_OK(), URL_OK(), URL_OK()]);
  const a = await open(server, { sessionStorage: storage });
  await a.click();
  const keyA = server.keys()[0];
  /* the same tab opens another purchase's kept link */
  const b = await loadPurchasePage({ search: '?token=' + OTHER, fetch: server.fetch, sessionStorage: storage, clock: a.clock });
  await b.click();
  assert.equal(server.sent[1].body.token, OTHER);
  assert.notEqual(server.keys()[1], keyA, 'the other purchase gets its own key');
  assert.equal(JSON.parse(storage.map.get(STORE(TOKEN))).key, keyA, 'and the first purchase still holds its unresolved key');
  /* a stored entry that names another purchase is not used, whatever slot it sits in */
  storage.map.set(STORE(OTHER), storage.map.get(STORE(TOKEN)));
  const c = await loadPurchasePage({ search: '?token=' + OTHER, fetch: server.fetch, sessionStorage: storage, clock: a.clock });
  await c.click();
  assert.notEqual(server.keys()[2], keyA);
  /* back on the first purchase: its own key, and case does not make it another purchase */
  const d = await loadPurchasePage({ search: '?token=' + TOKEN.toUpperCase(), fetch: server.fetch, sessionStorage: storage, clock: a.clock });
  await d.click();
  assert.equal(server.keys()[3], keyA);
});

test('keys: randomUUID when there is one, getRandomValues otherwise, and never a made-up one', async () => {
  let server = scripted([URL_OK()]);
  let page = await open(server, { crypto: { randomUUID: () => '3b241101-e2bb-4255-8caf-4136c566a962' } });
  await page.click();
  assert.equal(server.keys()[0], '3b241101-e2bb-4255-8caf-4136c566a962');

  const fill = (bytes) => { for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 5) & 255; return bytes; };
  for (const crypto of [{ getRandomValues: fill }, { randomUUID: () => { throw new Error('insecure context'); }, getRandomValues: fill }, { randomUUID: () => 'no', getRandomValues: fill }]) {
    server = scripted([URL_OK()]);
    page = await open(server, { crypto });
    await page.click();
    assert.match(server.keys()[0], /^[0-9a-f]{32}$/, '16 random bytes as hex');
    assert.match(server.keys()[0], ATTEMPT_KEY_RE);
    assert.equal(server.keys()[0], '052a4f7499bee3082d52779cc1e60b30');
  }
  /* real randomness gives different keys */
  server = scripted([URL_OK(), URL_OK()]);
  page = await open(server, { crypto: { getRandomValues: (b) => globalThis.crypto.getRandomValues(b) } });
  await page.click(); await page.click();
  assert.notEqual(server.keys()[0], server.keys()[1]);

  /* no secure randomness at all: no key, the download still works, and the page promises nothing it cannot keep */
  for (const crypto of [null, {}, { getRandomValues: () => { throw new Error('no'); } }]) {
    server = scripted([LOST, URL_OK()]);
    page = await open(server, { crypto });
    await page.click();
    assert.deepEqual(Object.keys(server.sent[0].body).sort(), ['action', 'token']);
    assert.match(page.el.ppStatus.textContent, /may or may not have been counted/);
    assert.doesNotMatch(page.el.ppStatus.textContent, /will not use another download/);
    assert.equal(page.el.ppDownload.disabled, false);
    await page.click();
    assert.equal(page.assigned.length, 1);
  }
});

test('storage that throws, or holds rubbish, does not break the page', async () => {
  /* every sessionStorage and localStorage call throws: the page still keeps the key for this page view */
  let server = scripted([LOST, URL_OK(), URL_OK()]);
  let page = await open(server, { sessionStorage: memoryStorage({ broken: true }), localStorage: memoryStorage({ broken: true }) });
  assert.equal(page.el.ppCard.hidden, false);
  await page.click();
  unsure(page);
  await page.click();
  assert.equal(server.keys()[1], server.keys()[0], 'same key from the page\'s own copy');
  assert.equal(page.assigned.length, 1);
  await page.click();
  assert.notEqual(server.keys()[2], server.keys()[0]);

  /* reading window.sessionStorage itself throws */
  server = scripted([LOST, URL_OK()]);
  page = await open(server, { sessionStorage: 'denied' });
  await page.click();
  unsure(page);
  await page.click();
  assert.equal(server.keys()[1], server.keys()[0]);

  /* rubbish under the key is ignored, not sent */
  for (const junk of ['{', 'null', '7', '"text"', '[]', JSON.stringify({ token: TOKEN, key: 'bad key!', at: Date.UTC(2026, 10, 9, 12) }),
    JSON.stringify({ token: TOKEN, key: 'x'.repeat(81), at: Date.UTC(2026, 10, 9, 12) }), JSON.stringify({ token: TOKEN, key: 'valid-key-0001' }),
    JSON.stringify({ token: TOKEN, key: 'valid-key-0001', at: 'yesterday' }), JSON.stringify({ key: 'valid-key-0001', at: Date.UTC(2026, 10, 9, 12) })]) {
    const storage = memoryStorage();
    storage.map.set(STORE(TOKEN), junk);
    server = scripted([URL_OK()]);
    page = await open(server, { sessionStorage: storage });
    await page.click();
    assert.match(server.keys()[0], ATTEMPT_KEY_RE, junk);
    assert.notEqual(server.keys()[0], 'valid-key-0001', junk);
    assert.equal(page.assigned.length, 1, junk);
  }
});

test('a lost answer on the last download can still be asked about after a reload', async () => {
  const lastOne = { ...VIEW, downloads_used: 4, downloads_left: 1 };
  const spent = { ...VIEW, downloads_used: 5, downloads_left: 0, can_download: false, refusal: { reason: 'download_limit', message: REFUSAL_HTTP.download_limit.message } };
  const storage = memoryStorage();
  /* one download left; the click's answer is lost; the server counted it */
  const lost = scripted([LOST], { view: lastOne });
  const clicking = await open(lost, { sessionStorage: storage });
  await clicking.click();
  /* the reload now reads "used all of its downloads", but the kept attempt is still askable */
  const replay = scripted([URL_OK(0)], { view: spent });
  const reloaded = await open(replay, { sessionStorage: storage, clock: clicking.clock });
  unsure(reloaded);
  await reloaded.click();
  assert.equal(replay.keys()[0], lost.keys()[0], 'the same attempt, so the server replays it instead of refusing the limit');
  assert.equal(reloaded.assigned.length, 1);
  assert.equal(reloaded.el.ppDownload.disabled, true, 'nothing left after the recovered download');
  /* with nothing unresolved, an exhausted purchase stays closed and says why */
  const closed = await open(scripted([], { view: spent }));
  assert.equal(closed.el.ppDownload.disabled, true);
  assert.equal(closed.el.ppStatus.textContent, REFUSAL_HTTP.download_limit.message);
  /* a kept key does not reopen a purchase the server refuses before it looks at the key */
  for (const reason of ['revoked', 'expired', 'not_paid', 'asset_unresolved']) {
    const view = { ...VIEW, can_download: false, refusal: { reason, message: REFUSAL_HTTP[reason].message } };
    const kept = memoryStorage();
    const first = await open(scripted([LOST]), { sessionStorage: kept });
    await first.click();
    const after = await open(scripted([], { view }), { sessionStorage: kept, clock: first.clock });
    assert.equal(after.el.ppDownload.disabled, true, reason);
    assert.equal(after.el.ppStatus.textContent, REFUSAL_HTTP[reason].message, reason);
  }
  /* and once the key is too old to be answered, the exhausted purchase is closed again */
  const late = await open(scripted([], { view: spent }), { sessionStorage: storage2(lost.keys()[0]), clock: { now: clicking.clock.now + 20000 + 120000 + 300000 } });
  assert.equal(late.el.ppDownload.disabled, true);
  function storage2(key) { const m = memoryStorage(); m.map.set(STORE(TOKEN), JSON.stringify({ token: TOKEN, key, at: clicking.clock.now })); return m; }
});

test('a second tab on the same kept link finds the unresolved key; a delivery in either tab ends the shared copy', async () => {
  const shared = memoryStorage();
  const server = scripted([LOST, URL_OK(3), URL_OK(2), URL_OK(1)]);
  const tabA = await open(server, { localStorage: shared });
  await tabA.click();
  const key = server.keys()[0];
  /* a new tab: its own empty sessionStorage, the browser's shared localStorage */
  const tabB = await open(server, { localStorage: shared, clock: tabA.clock });
  await tabB.click();
  assert.equal(server.keys()[1], key, 'the second tab asks about the same attempt instead of taking a second slot');
  assert.equal(tabB.assigned.length, 1);
  assert.equal(shared.map.has(STORE(TOKEN)), false, 'the delivery ended the shared copy');
  /* a third tab now starts a new download */
  const tabC = await open(server, { localStorage: shared, clock: tabA.clock });
  await tabC.click();
  assert.notEqual(server.keys()[2], key);
  /* the first tab still has its own copy: resending it is answered by the server (a replay or attempt_spent), never a new slot */
  await tabA.click();
  assert.equal(server.keys()[3], key);
});

test('a store that refused a write cannot hide the other one', async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const life = 20000 + 120000 + 300000;
  const entry = (key, at) => JSON.stringify({ token: TOKEN, key, at });
  /* this tab's copy is fresh, the shared store kept an older attempt it could not overwrite */
  let session = memoryStorage(), local = memoryStorage();
  session.map.set(STORE(TOKEN), entry('fresh-key-0001', now - 1000));
  local.map.set(STORE(TOKEN), entry('stale-key-0001', now - life));
  let server = scripted([URL_OK()]);
  let page = await open(server, { sessionStorage: session, localStorage: local, clock: { now } });
  await page.click();
  assert.equal(server.keys()[0], 'fresh-key-0001');
  /* this tab's copy is rubbish, the shared one is usable */
  session = memoryStorage(); local = memoryStorage();
  session.map.set(STORE(TOKEN), '{');
  local.map.set(STORE(TOKEN), entry('shared-key-001', now - 1000));
  server = scripted([URL_OK()]);
  page = await open(server, { sessionStorage: session, localStorage: local, clock: { now } });
  await page.click();
  assert.equal(server.keys()[0], 'shared-key-001');
  assert.equal(session.map.has(STORE(TOKEN)), false);
  assert.equal(local.map.has(STORE(TOKEN)), false, 'a delivery clears both');
  /* a copy stamped in the future (the clock was set back) is not trusted */
  local = memoryStorage();
  local.map.set(STORE(TOKEN), entry('future-key-01', now + 61000));
  server = scripted([URL_OK()]);
  page = await open(server, { localStorage: local, clock: { now } });
  await page.click();
  assert.notEqual(server.keys()[0], 'future-key-01');
});

test('"used all of its downloads" just after a signing failure is a held slot that frees itself, not the end', async () => {
  const storage = memoryStorage();
  const server = scripted([
    (b) => Promise.resolve(refusal('sign_retry', { attempt_key: b.attempt_key })),
    refusal('download_limit'),
    refusal('download_limit'),
    refusal('download_limit')
  ]);
  const page = await open(server, { sessionStorage: storage });
  await page.click();
  assert.equal(page.el.ppStatus.textContent, REFUSAL_HTTP.sign_retry.message);
  /* the release of the failed attempt's hold can fail too: the next new attempt may meet the held last slot */
  await page.click();
  assert.match(page.el.ppStatus.textContent, /may still be finishing/);
  assert.match(page.el.ppStatus.textContent, /will not cost you a download/);
  assert.equal(page.el.ppDownload.disabled, false, 'the button stays: the hold frees itself');
  assert.notEqual(server.keys()[1], server.keys()[0], 'that was a new attempt');
  /* a reload in the hold window remembers the failure */
  const reloaded = await open(server, { sessionStorage: storage, clock: page.clock });
  await reloaded.click();
  assert.match(reloaded.el.ppStatus.textContent, /may still be finishing/);
  /* once the hold has certainly lapsed, the limit is real */
  page.clock.now += 20000 + 120000;
  await reloaded.click();
  assert.equal(reloaded.el.ppStatus.textContent, REFUSAL_HTTP.download_limit.message);
  assert.equal(reloaded.el.ppDownload.disabled, true);
  /* without a signing failure the limit is taken at its word (as in the final-refusal test) */
  const plain = await open(scripted([refusal('download_limit')]));
  await plain.click();
  assert.equal(plain.el.ppStatus.textContent, REFUSAL_HTTP.download_limit.message);
  assert.equal(plain.el.ppDownload.disabled, true);
});

test('nothing else about the page changed: claim, tracking and what a delivery shows', async () => {
  const tracked = [];
  const server = scripted([URL_OK(1), URL_OK(0)]);
  const page = await loadPurchasePage({ search: '?session_id=cs_test_fixture123', fetch: server.fetch, track: (name) => { tracked.push(name); throw new Error('analytics is down'); } });
  assert.equal(page.location.search, '?token=' + TOKEN, 'the address keeps the token, not the session');
  assert.equal(page.el.ppTitle.textContent, 'Antisocial \u00b7 WAV');
  assert.equal(page.el.ppDownload.textContent, 'Download WAV');
  await page.click();
  assert.deepEqual(tracked, ['direct_download']);
  assert.equal(page.assigned.length, 1, 'a tracking failure does not cost the buyer the file');
  assert.equal(page.el.ppStatus.textContent, '1 download left.');
  assert.equal(page.el.ppDownload.disabled, false);
  await page.click();
  assert.equal(page.el.ppStatus.textContent, '0 downloads left.');
  assert.equal(page.el.ppDownload.disabled, true);
  assert.equal(server.sent[0].body.token, TOKEN);
});
