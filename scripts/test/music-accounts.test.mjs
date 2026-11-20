/* THE MODULE KNOWS WHO IS LISTENING (music slice M4, 2026-11-19).
   ============================================================
   Owner, 2026-11-19: "it's not aware of whether a person has an account or
   not." The accounts lane (C5) found why: the music scripts sent the access
   token as it sat in storage, so a member back after the token's hour was a
   guest to every music call while the bar said signed in; a sign-out in one
   tab was undone by another open music tab; and js/backend.js could not read
   some members' tokens at all.

   These run the real browser files in a Node vm, against a stubbed fetch and
   a localStorage shared the way one origin shares it between tabs. Nothing
   leaves the machine. The browser half (persona, race, expiry, cross-tab) is
   scripts/e2e/music-accounts.e2e.mjs.

   The accounts lane probes these come from: stale_token_vm.mjs (A: a listen
   with a stale token, B: base64url payloads), crosstab.cjs X5 (a sign-out
   undone by another tab), and the code reads behind ACC-2, ACC-6, ACC-8,
   ACC-9, ACC-12 and DEL-3 (docs/music/MUSIC-RELEASE-20261119.md, M4).
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);

const NOW = () => Math.floor(Date.now() / 1000);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload) => b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u(payload) + '.sig';

/* Invented fixtures, no real member data. */
const OWNER = '00000000-0000-4000-8000-0000000000a3';
const MEMBER = '00000000-0000-4000-8000-0000000000a1';
const tokenFor = (sub, exp, extra) => jwt(Object.assign({ aud: 'authenticated', sub, exp, role: 'authenticated', email: 'fixture-' + sub.slice(-2) }, extra || {}));

/* ONE ORIGIN, SEVERAL TABS. A browser keeps one storage area per origin and
   tells every OTHER tab about each change with a storage event. Here the
   event reaches the other tab at once, between two writes of the same call,
   which is exactly the window the accounts lane caught in Chromium (X5: the
   other tab read the session 4-5 ms after the first of the two removals). */
function origin() {
  const map = new Map();
  const tabs = new Set();
  function area(tab) {
    const change = (key, oldValue, newValue) => {
      for (const t of tabs) if (t !== tab) t.__storage({ key, oldValue, newValue });
    };
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { const old = map.has(k) ? map.get(k) : null; v = String(v); map.set(k, v); if (old !== v) change(k, old, v); },
      removeItem: (k) => { if (!map.has(k)) return; const old = map.get(k); map.delete(k); change(k, old, null); },
      clear: () => { for (const k of [...map.keys()]) area(tab).removeItem(k); },
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; }
    };
  }
  return { map, tabs, area };
}

function response(status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text || 'null'), text: async () => text, headers: { get: () => null } };
}
function bearer(init) {
  const h = (init && init.headers) || {};
  let v = '';
  if (typeof h.get === 'function') v = h.get('authorization') || '';
  else for (const k of Object.keys(h)) if (k.toLowerCase() === 'authorization') v = h[k];
  const m = /^bearer\s+(.+)$/i.exec(v || '');
  return m ? m[1] : '';
}

/* a page's timers (the ledger's 15-second beat, the auth client's 12-second bound) must not keep the test alive */
const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t; };
function tab(o, fetchImpl, path) {
  const listeners = {};
  const w = {
    fetch: fetchImpl, clearTimeout, clearInterval, Promise, JSON, Date, Math, URL, URLSearchParams,
    setTimeout: (f, ms, ...a) => unref(setTimeout(f, ms, ...a)),
    setInterval: (f, ms, ...a) => unref(setInterval(f, ms, ...a)),
    TextEncoder, TextDecoder, atob, btoa, Uint8Array, Object, Array, String, Number, Boolean, Error, encodeURIComponent, decodeURIComponent,
    escape, unescape, console, crypto: globalThis.crypto, AbortController,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { hostname: 'matthew.mccluster.org', origin: 'https://matthew.mccluster.org', pathname: path || '/album.html', search: '', hash: '', href: 'https://matthew.mccluster.org' + (path || '/album.html') },
    navigator: { language: 'en', onLine: true },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
    dispatchEvent(e) { (listeners[e.type] || []).slice().forEach((f) => f(e)); return true; },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class { constructor(type) { this.type = type; } },
    history: { replaceState() {} },
    __storage(e) { (listeners.storage || []).slice().forEach((f) => f(Object.assign({ type: 'storage' }, e))); }
  };
  w.window = w; w.self = w;
  w.localStorage = o.area(w);
  o.tabs.add(w);
  const ctx = vm.createContext(w);
  w.load = (file) => vm.runInContext(read(file), ctx, { filename: file });
  return w;
}
const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* the auth server and the API Worker, as production answers them: a refused
   token is a guest to the gate (GET answers 200 with the guest body) and a
   401 everywhere a session is required */
function plane(opts = {}) {
  const calls = [];
  const live = new Set(opts.live || []);           // access tokens the server accepts
  const owner = new Set(opts.owner || []);         // ... and of those, the house operator's
  const refresh = opts.refresh || {};              // refresh token -> next session
  const fetchImpl = async (url, init) => {
    url = String(url);
    const tok = bearer(init);
    const method = (init && init.method) || 'GET';
    calls.push({ url: url.replace(/^https:\/\/[^/]+/, ''), method, token: tok });
    if (/\/auth\/v1\/token\?grant_type=refresh_token/.test(url)) {
      const body = JSON.parse((init && init.body) || '{}');
      const next = refresh[body.refresh_token];
      if (!next) return response(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      delete refresh[body.refresh_token];
      live.add(next.access_token);
      if (next.owner) owner.add(next.access_token);
      return response(200, { access_token: next.access_token, refresh_token: next.refresh_token, expires_in: 3600, token_type: 'bearer' });
    }
    if (/\/auth\/v1\/logout/.test(url)) return response(204);
    if (/\/v1\/music\/listens$/.test(url)) return live.has(tok) ? response(200, { ok: true, listen_id: '20000000-0000-4000-8000-000000000001', counts: true }) : response(401, { error: 'Sign in to count your listens' });
    if (/\/v1\/music\/listens\/.+\/(beat|finish)$/.test(url)) return live.has(tok) ? response(200, { ok: true, counted: true }) : response(401, { error: 'Sign in to count your listens' });
    if (/\/v1\/music\/gates\/niggy-nigg\/play$/.test(url)) {
      if (!live.has(tok)) return response(401, { error: 'Sign in to count your listens' });
      return owner.has(tok) ? response(200, { ok: true, url: 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/x', gate: { allowed: true, operator: true } })
        : response(403, { error: 'Locked', locked: true, gate: { mode: 'rule', allowed: false, reason: 'gate_not_ready', missing: ['gate_not_ready'] } });
    }
    if (/\/v1\/music\/gates\/niggy-nigg$/.test(url)) {
      if (live.has(tok) && owner.has(tok)) return response(200, { ok: true, gate: { allowed: true, operator: true } });
      return response(200, { ok: true, gate: { mode: 'rule', rule: 'gated_track_niggy_nigg', track: 'niggy-nigg', allowed: false, claimed: false, preview_only: true, reason: 'gate_not_ready', missing: ['gate_not_ready'] } });
    }
    return response(404, {});
  };
  return { calls, live, owner, fetch: fetchImpl };
}
const stored = (access, refreshToken, expiresAt) => JSON.stringify({ access_token: access, refresh_token: refreshToken, expires_at: expiresAt, token_type: 'bearer' });

test('a listen started with an expired stored token is counted: the ledger asks for a fresh token first (stale_token_vm A, DEL-3)', async () => {
  const expired = tokenFor(MEMBER, NOW() - 7200);
  const fresh = tokenFor(MEMBER, NOW() + 3600);
  const p = plane({ refresh: { rt1: { access_token: fresh, refresh_token: 'rt2' } } });
  const o = origin();
  const s = stored(expired, 'rt1', NOW() - 7200);
  o.map.set('mccdb_session', s); o.map.set('mcc_sess_keep', s);
  const w = tab(o, p.fetch);
  w.load('js/mcc-auth.js');
  w.load('js/listen-ledger.js');
  const h = w.MCC_LISTENS.start('here', () => true);
  assert.ok(h, 'a stored session is a listener the ledger counts');
  const id = await h.id;
  assert.equal(id, '20000000-0000-4000-8000-000000000001', 'the listen is counted, not dropped');
  const starts = p.calls.filter((c) => /\/v1\/music\/listens$/.test(c.url));
  assert.equal(starts.length, 1, 'one start');
  assert.equal(starts[0].token, fresh, 'the start carried the renewed token, never the expired one');
  const refreshAt = p.calls.findIndex((c) => /grant_type=refresh_token/.test(c.url));
  assert.ok(refreshAt > -1 && refreshAt < p.calls.indexOf(starts[0]), 'the token was renewed right before the call');
  const finished = [];
  w.MCC_LISTENS.onFinish((d) => finished.push(d));
  const fin = await w.MCC_LISTENS.finish(h);
  assert.ok(fin && fin.counted, 'the finish is counted too');
  assert.equal(finished.length, 1, 'the gate hears the counted song');
});

test('a listen refused with 401 is asked again once, with a renewed token, and never a third time (ACC-2)', async () => {
  /* the device clock says the token is good; the server has already expired it */
  const refused = tokenFor(MEMBER, NOW() + 3000);
  const renewed = tokenFor(MEMBER, NOW() + 3600);
  const p = plane({ refresh: { rt1: { access_token: renewed, refresh_token: 'rt2' } } });
  const o = origin();
  const s = stored(refused, 'rt1', NOW() + 3000);
  o.map.set('mccdb_session', s); o.map.set('mcc_sess_keep', s);
  const w = tab(o, p.fetch);
  w.load('js/mcc-auth.js');
  w.load('js/listen-ledger.js');
  const id = await w.MCC_LISTENS.start('here', () => true).id;
  const starts = p.calls.filter((c) => /\/v1\/music\/listens$/.test(c.url));
  assert.deepEqual(starts.map((c) => c.token), [refused, renewed], 'the refused token, then the renewed one');
  assert.equal(id, '20000000-0000-4000-8000-000000000001', 'the retry is counted');

  /* a server that refuses the renewed token too: one retry, then the ledger gives up quietly */
  const q = plane({ refresh: { rt9: { access_token: tokenFor(MEMBER, NOW() + 3600), refresh_token: 'rt10' } } });
  const o2 = origin();
  const s2 = stored(tokenFor(MEMBER, NOW() + 3000), 'rt9', NOW() + 3000);
  o2.map.set('mccdb_session', s2); o2.map.set('mcc_sess_keep', s2);
  const w2 = tab(o2, async (url, init) => {
    const r = await q.fetch(url, init);
    return /\/v1\/music\/listens$/.test(String(url)) ? response(401, { error: 'Sign in to count your listens' }) : r;
  });
  w2.load('js/mcc-auth.js');
  w2.load('js/listen-ledger.js');
  const id2 = await w2.MCC_LISTENS.start('here', () => true).id;
  assert.equal(id2, null, 'not counted, and nothing thrown');
  assert.equal(q.calls.filter((c) => /\/v1\/music\/listens$/.test(c.url)).length, 2, 'exactly one retry');
});

test('the gated record asks with a fresh token: the owner back with an expired stored token is the owner (persona owner_expired, ACC-2)', async () => {
  const expired = tokenFor(OWNER, NOW() - 7200);
  const fresh = tokenFor(OWNER, NOW() + 3600);
  const p = plane({ refresh: { rt1: { access_token: fresh, refresh_token: 'rt2', owner: true } } });
  const o = origin();
  const s = stored(expired, 'rt1', NOW() - 7200);
  o.map.set('mccdb_session', s); o.map.set('mcc_sess_keep', s);
  const w = tab(o, p.fetch);
  w.load('js/mcc-auth.js');
  w.load('js/gated-audio.js');
  const out = await w.MCC_GATED.resolve({ object: 'niggy-nigg/niggy-nigg.mp3' });
  assert.equal(out.state, 'earned', 'the owner, not a locked member');
  assert.deepEqual(JSON.parse(JSON.stringify(w.MCC_GATED.progress(out))), { b: 'PLAY', s: 'owner' });
  const asks = p.calls.filter((c) => /\/v1\/music\/gates\/niggy-nigg$/.test(c.url));
  assert.equal(asks.length, 1);
  assert.equal(asks[0].token, fresh, 'the gate was asked with the renewed token');
});

test('the one play is asked again once after a 401, with a renewed token (ACC-2)', async () => {
  const refused = tokenFor(OWNER, NOW() + 3000);
  const renewed = tokenFor(OWNER, NOW() + 3600);
  const p = plane({ refresh: { rt1: { access_token: renewed, refresh_token: 'rt2', owner: true } } });
  const o = origin();
  const s = stored(refused, 'rt1', NOW() + 3000);
  o.map.set('mccdb_session', s); o.map.set('mcc_sess_keep', s);
  const w = tab(o, p.fetch);
  w.load('js/mcc-auth.js');
  w.load('js/gated-audio.js');
  const c = await w.MCC_GATED.claim({ object: 'niggy-nigg/niggy-nigg.mp3' });
  assert.equal(c.state, 'full', 'the owner gets the play');
  const plays = p.calls.filter((x) => /\/play$/.test(x.url));
  assert.deepEqual(plays.map((x) => x.token), [refused, renewed], 'refused once, then the renewed token');
});

test('js/backend.js reads every member\'s token: base64url payloads, UTF-8 names (stale_token_vm B, ACC-9)', () => {
  const names = ['Fixture Listener', 'José Ramírez', 'Chloé Martin', 'Dvořák A', '李小龙', 'Ana 🎵'];
  let tripped = 0;
  for (const name of names) {
    const now = 1795000000;
    /* every payload in the sample is made to carry a base64url-only character ('-' or '_'), so each name tests
       both readings at once: a picture address with a query (as profile pictures often have) and an e-mail claim a few
       letters longer shift the bytes until one lands on it. In plain base64 a payload of letters and digits alone
       never shows one; a name in UTF-8, or a '?', '>' or '~' on the right byte, does. */
    let payload, tok;
    for (let k = 0; k < 6; k++) {
      payload = { aud: 'authenticated', exp: now + 3600, iat: now, sub: '5c0f6f2e-1b2a-4c3d-8e9f-0a1b2c3d4e5f', email: 'fixture' + 'x'.repeat(k) + '-mail', user_metadata: { avatar_url: 'avatar.png?v=4', full_name: name, name, email_verified: true }, role: 'authenticated', session_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' };
      tok = jwt(payload);
      if (/[-_]/.test(tok.split('.')[1])) break;
    }
    if (/[-_]/.test(tok.split('.')[1])) tripped++;
    const o = origin();
    const s = JSON.stringify({ access_token: tok, refresh_token: 'rt', expires_at: NOW() + 3600 });
    o.map.set('mccdb_session', s); o.map.set('mcc_sess_keep', s);
    const w = tab(o, async () => response(404, {}));
    w.load('js/backend.js');
    assert.equal(w.MCC_SUPA.uid(), payload.sub, name + ': uid');
    assert.equal(w.MCC_SUPA.email(), payload.email, name + ': email');
    const user = w.MCC_AUTH.user();
    assert.equal(user && user.id, payload.sub, name + ': MCC_AUTH.user().id');
    assert.equal(user && user.name, name, name + ': the name reads as written (UTF-8)');
  }
  assert.equal(tripped, names.length, 'every payload in the sample really is base64url-only (' + tripped + ' of ' + names.length + ')');
});

test('a sign-out in one tab is not undone by another open music tab (crosstab X5, ACC-8)', async () => {
  const tokA = tokenFor(MEMBER, NOW() + 3600);
  const p = plane({ live: [tokA] });
  const o = origin();
  const s = stored(tokA, 'rt1', NOW() + 3600);
  o.map.set('mccdb_session', s); o.map.set('mcc_sess_keep', s);
  /* tab A: the album, which repaints its gated row on every storage change of the session */
  const a = tab(o, p.fetch, '/album.html');
  a.load('js/mcc-auth.js');
  a.load('js/gated-audio.js');
  a.MCC_GATED.onChange(() => { a.MCC_GATED.signedIn(); });
  /* and any other reader of the session in that tab */
  a.addEventListener('storage', () => { a.MCC.session(); });
  /* tab B: the account page, where the member signs out */
  const b = tab(o, p.fetch, '/account.html');
  b.load('js/mcc-auth.js');
  await b.MCC.signOut();
  await settle(20);
  assert.equal(o.map.get('mccdb_session') ?? null, null, 'no session left in storage');
  assert.equal(o.map.get('mcc_sess_keep') ?? null, null, 'no keep copy left in storage');
  assert.equal(a.MCC.session(), null, 'tab A reads signed out');
  assert.equal(b.MCC.session(), null, 'tab B reads signed out');
  assert.equal(a.MCC_GATED.signedIn(), false, 'the album knows the member left');
});

test('a sign-out through js/backend.js is not undone by the other client either (ACC-8)', async () => {
  const tokA = tokenFor(MEMBER, NOW() + 3600);
  const p = plane({ live: [tokA] });
  const o = origin();
  const s = stored(tokA, 'rt1', NOW() + 3600);
  o.map.set('mccdb_session', s); o.map.set('mcc_sess_keep', s);
  const a = tab(o, p.fetch, '/album.html');
  a.load('js/mcc-auth.js');
  a.addEventListener('storage', () => { a.MCC.session(); });
  const b = tab(o, p.fetch, '/account.html');
  b.load('js/backend.js');
  await b.MCC_AUTH.signOut();
  await settle(20);
  assert.equal(o.map.get('mccdb_session') ?? null, null, 'no session left in storage');
  assert.equal(o.map.get('mcc_sess_keep') ?? null, null, 'no keep copy left in storage');
  const mark = o.map.get('mcc_sess_out');
  assert.ok(mark, 'the sign-out left its mark');
  /* A page opened later, alone on the origin (no other tab to tidy up after it), finds a stray keep copy of the
     signed-out session: js/backend.js does not bring it back ... */
  const o2 = origin();
  o2.map.set('mcc_sess_out', mark); o2.map.set('mcc_sess_keep', s);
  const c = tab(o2, p.fetch, '/album.html');
  c.load('js/backend.js');
  assert.equal(o2.map.get('mccdb_session') ?? null, null, 'a stray keep copy of the signed-out session is not restored on load');
  assert.equal(c.MCC_SUPA.uid(), null);
  /* ... nor does js/mcc-auth.js, the other client of the same two keys */
  const o3 = origin();
  o3.map.set('mcc_sess_out', mark); o3.map.set('mcc_sess_keep', s);
  const d = tab(o3, p.fetch, '/listen.html');
  d.load('js/mcc-auth.js');
  assert.equal(d.MCC.session(), null, 'js/mcc-auth.js does not restore it either');
  assert.equal(o3.map.get('mccdb_session') ?? null, null, 'and writes nothing back');
});

test('a mark left by a sign-out names that session only: a later sign-in\'s keep copy still protects it', async () => {
  const before = tokenFor(MEMBER, NOW() + 3600);
  const after = tokenFor(MEMBER, NOW() + 3500);
  const p = plane({ live: [before, after] });
  const o = origin();
  const s1 = stored(before, 'rt-before', NOW() + 3600);
  o.map.set('mccdb_session', s1); o.map.set('mcc_sess_keep', s1);
  const a = tab(o, p.fetch, '/account.html');
  a.load('js/mcc-auth.js');
  await a.MCC.signOut();
  await settle(20);
  assert.ok(o.map.get('mcc_sess_out'), 'the sign-out left its mark');
  assert.doesNotMatch(String(o.map.get('mcc_sess_out')), /rt-before/, 'the mark is a hash, never the token');
  /* the member signs in again (a new session), and only its keep copy survives an accidental clear */
  const s2 = stored(after, 'rt-after', NOW() + 3500);
  o.map.set('mcc_sess_keep', s2);
  const b = tab(o, p.fetch, '/listen.html');
  b.load('js/mcc-auth.js');
  assert.equal(b.MCC.session() && b.MCC.session().access_token, after, 'the new session is restored from its keep copy');
  const c = tab(o, p.fetch, '/album.html');
  o.map.delete('mccdb_session');
  c.load('js/backend.js');
  assert.equal(c.MCC_SUPA.uid(), MEMBER, 'js/backend.js restores it too');
});

test('the keep copy still protects a live session from an accidental clear', () => {
  const tokA = tokenFor(MEMBER, NOW() + 3600);
  const o = origin();
  const s = stored(tokA, 'rt1', NOW() + 3600);
  o.map.set('mcc_sess_keep', s);
  const w = tab(o, async () => response(404, {}));
  w.load('js/mcc-auth.js');
  assert.equal(w.MCC.session() && w.MCC.session().access_token, tokA, 'restored from the keep copy');
  assert.equal(o.map.get('mccdb_session'), s);
});

test('a token is decided per call: a session renewed by another tab is used, not the one this tab read first', async () => {
  const first = tokenFor(MEMBER, NOW() + 3000);
  const second = tokenFor(MEMBER, NOW() + 3600);
  const p = plane({ live: [first, second] });
  const o = origin();
  o.map.set('mccdb_session', stored(first, 'rt1', NOW() + 3000)); o.map.set('mcc_sess_keep', stored(first, 'rt1', NOW() + 3000));
  const w = tab(o, p.fetch);
  w.load('js/mcc-auth.js');
  w.load('js/listen-ledger.js');
  await w.MCC_LISTENS.start('here', () => true).id;
  /* another tab renews the session */
  o.map.set('mccdb_session', stored(second, 'rt2', NOW() + 3600)); o.map.set('mcc_sess_keep', stored(second, 'rt2', NOW() + 3600));
  await w.MCC_LISTENS.start('here', () => true).id;
  const starts = p.calls.filter((c) => /\/v1\/music\/listens$/.test(c.url)).map((c) => c.token);
  assert.deepEqual(starts, [first, second]);
});

test('the album\'s comment box does not promise a sign-in that no longer exists (ACC-12)', () => {
  const src = read('js/comments.js');
  assert.doesNotMatch(src, /no password/i, 'passwordless sign-in was removed (js/mcc-auth.js signInWithEmail)');
  assert.doesNotMatch(src, /one tap/i);
  assert.match(src, /Sign in<\/a> to speak/);
});

test('offers by state: Become a creator only to signed-in members who are not creators (ACC-4)', () => {
  const OB = require(join(ROOT, 'js/creator-onboarding.js'));
  assert.equal(typeof OB.offerFor, 'function');
  const pick = (i) => { const o = OB.offerFor(i); return o.door + (o.review ? '+review' : ''); };
  assert.equal(pick({ signedIn: false }), 'signin', 'a guest is asked to sign in');
  assert.equal(pick({ signedIn: false, owner: true }), 'signin', 'no owner tools without a session');
  assert.equal(pick({ signedIn: true, creator: false }), 'become', 'a member who is not a creator');
  assert.equal(pick({ signedIn: true, creator: true }), 'studio', 'a creator opens Creator Studio');
  assert.equal(pick({ signedIn: true, creator: true, owner: true }), 'studio+review', 'the owner sees his tools');
  assert.equal(pick({ signedIn: true, creator: false, owner: true }), 'become+review');
  assert.equal(pick({ signedIn: true, creator: null }), 'studio', 'unknown: the neutral door, never a sign-up to a creator');
});

test('the Creator Website Studio keeps no session of its own (ACC-6)', () => {
  const js = read('js/mccluster-creator-account.js');
  const html = read('mccluster-creator-studio.html');
  assert.doesNotMatch(js, /persistSession\s*:\s*true/, 'no second persisted supabase-js session');
  assert.doesNotMatch(js, /autoRefreshToken\s*:\s*true/, 'never a second refresher of the shared refresh token');
  assert.doesNotMatch(js, /auth\.setSession|auth\.getSession|auth\.getUser|onAuthStateChange/, 'no supabase-js auth store at all');
  assert.match(js, /accessToken\s*:/, 'every call takes the site session\'s token');
  assert.match(js, /MCC\.freshToken|MCC\.authFetch/, 'through the shared auth');
  const auth = html.indexOf('js/mcc-auth.js');
  const mod = html.indexOf('js/mccluster-creator-account.js');
  assert.ok(auth > -1 && auth < mod, 'the shared auth loads before the studio module');
  assert.doesNotMatch(html, /id="serviceStatus"[^>]*>Sign in/, 'no sign-in prompt painted before anyone looked');
  assert.match(html, /id="accountSignIn"[^>]*hidden/, 'the sign-in link is shown only to guests');
});

test('Creator Studio never keeps its boot token: every call takes one from the shared auth (ACC-3)', () => {
  const js = read('js/music-creator-studio.js');
  assert.doesNotMatch(js, /session\.access_token/, 'no call sends the token read at boot');
  assert.match(js, /MCC\.authFetch/);
});

test('every music call takes its token from the shared auth (ACC-2, DEL-3)', () => {
  /* the behaviour is proven above (ledger, gate) and in the browser suite (engine, artist page); this keeps the
     four callers on the one path */
  for (const f of ['js/gated-audio.js', 'js/listen-ledger.js', 'js/music-engine.js', 'js/music-creator-profile.js']) {
    assert.match(read(f), /MCC\.authFetch/, f + ' asks the shared auth for each call');
  }
});
