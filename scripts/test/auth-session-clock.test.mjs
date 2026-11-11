/* ONE CLOCK for "is this session fresh?" in the modules that read the stored session beside the canonical client:
   js/backend.js (token(), the data layer's own refresh) and js/guest-world.js (the globe embed's fallback when the bar
   has no answer). The canonical client's own cases are in auth-network-recovery.test.mjs and the bar's in
   tabbar-auth-refresh.test.mjs. Each module runs whole in vm, in one tab sharing one localStorage, on a device whose
   clock is `ahead` seconds off the auth server's (negative: behind). Every response is a fixture: no account, no network.
   The second half holds js/backend.js refresh() to the canonical client's answer rules: which answers end a session,
   which keep it, and what happens to an answer about a session that is no longer the one stored. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const HOUR = 3600;
const claims = (token) => { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url')); } catch { return {}; } };
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body });
const turn = () => new Promise((resolve) => setImmediate(resolve));
const MEMBER = { sub: 'fixture-member', email: 'fixture@example.test' };

/* The auth server issues one-hour tokens on its own clock. later(s) moves both clocks on together.
   seed(issue): what an earlier visit stored. answer(issue): the auth server's answer to a refresh, when it is not
   simply a new session (answerWith swaps it later; null restores that). fast: timers run in at most 10ms, so a
   12-second bound passes at once. */
function tab(ahead, { modules = ['js/backend.js'], seed, answer = null, fast = false } = {}) {
  let elapsed = 0, serial = 0;
  const serverNow = () => Math.floor(Date.now() / 1000) + elapsed;
  const counts = { refresh: 0, writes: 0 };
  const issue = (who = MEMBER) => {
    const iat = serverNow(), n = ++serial;
    return {
      access_token: 'fixture.' + Buffer.from(JSON.stringify({ sub: who.sub, email: who.email, iat, exp: iat + HOUR, n })).toString('base64url') + '.fixture',
      refresh_token: 'fixture-refresh-' + n, token_type: 'bearer', expires_in: HOUR, expires_at: iat + HOUR, user: { id: who.sub }
    };
  };
  const shelf = new Map();
  const localStorage = { getItem: (key) => (shelf.has(key) ? shelf.get(key) : null), setItem: (key, value) => { if (key === 'mccdb_session') counts.writes++; shelf.set(key, String(value)); }, removeItem: (key) => { shelf.delete(key); } };
  /* both shelves, as a sign-in or a refresh writes them (an earlier visit, another tab, the page's other client) */
  const store = (session) => { const raw = JSON.stringify(session); shelf.set('mccdb_session', raw); shelf.set('mcc_sess_keep', raw); };
  if (seed) store(seed(issue));
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'refresh_token') { counts.refresh++; if (answer) return answer(issue); }
      return reply(issue());
    }
    const bearer = String((init.headers || {}).authorization || '').replace(/^Bearer /, '');
    if (u.pathname === '/auth/v1/user') return claims(bearer).exp > serverNow() ? reply({ id: 'fixture-member' }) : reply({ code: 'bad_jwt', msg: 'JWT expired' }, 401);
    throw new TypeError('fixture has no route for ' + url);
  };
  /* the globe embed's panel, as js/guest-world.js finds it on a public landing page */
  const entry = { textContent: '', href: '' }, frame = { src: '', getAttribute: (name) => (name === 'data-src' ? 'world.html' : null) };
  const panel = { hidden: false, hasAttribute: () => false, querySelector: (selector) => (selector === '[data-world-entry]' ? entry : selector === 'iframe[data-src]' ? frame : null) };
  const listeners = new Map();
  const window = {
    localStorage, sessionStorage: localStorage, crypto: globalThis.crypto,
    location: { origin: 'https://matthew.mccluster.org', hostname: 'matthew.mccluster.org', pathname: '/index.html', search: '', hash: '' },
    addEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).concat(listener)); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return true; }
  };
  const real = Date;
  const context = vm.createContext({
    window, localStorage, location: window.location, history: { replaceState() {} },
    document: { readyState: 'complete', getElementById: (id) => (id === 'guestWorld' ? panel : null), addEventListener() {} },
    fetch, atob, btoa, URL, URLSearchParams, AbortController, clearTimeout, console,
    setTimeout: fast ? (fn, ms) => setTimeout(fn, Math.min(ms, 10)) : setTimeout,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Date: class extends real { static now() { return real.now() + (ahead + elapsed) * 1000; } }
  });
  for (const path of modules) vm.runInContext(read(path), context, { filename: path });
  return {
    window, counts, serverNow, deviceNow: () => serverNow() + ahead, later: (seconds) => { elapsed += seconds; },
    issue, store, answerWith: (next) => { answer = next; },
    stored: () => JSON.parse(shelf.get('mccdb_session') || 'null'),
    keep: () => JSON.parse(shelf.get('mcc_sess_keep') || 'null'),
    globe: () => entry.textContent === 'Enter the World →' ? 'signed in' : entry.textContent ? 'guest' : 'unpainted'
  };
}

test('backend.js on a clock an hour ahead keeps the token it stored for its hour: one refresh a lifetime, not one a call', async () => {
  const t = tab(HOUR);
  await t.window.MCC_AUTH.signInPassword('fixture@example.test', 'fixture-password');
  const first = t.stored().access_token;
  for (let call = 0; call < 10; call++) assert.equal(await t.window.MCC_SUPA.token(), first);
  assert.equal(t.counts.refresh, 0, 'no call refreshed a token with most of its hour left');
  t.later(HOUR - 59);                                // 59 seconds left on both clocks: inside the one-minute margin
  for (let call = 0; call < 10; call++) await t.window.MCC_SUPA.token();
  assert.equal(t.counts.refresh, 1, 'one refresh, before the server expired it');
  assert.notEqual(t.stored().access_token, first);
});

test('backend.js on a clock an hour behind refreshes a token the server has expired before handing it out', async () => {
  const t = tab(-HOUR);
  await t.window.MCC_AUTH.signInPassword('fixture@example.test', 'fixture-password');
  t.later(HOUR + 5);                                 // expired at the server five seconds ago; by its exp claim this clock has an hour to go
  const token = await t.window.MCC_SUPA.token();
  assert.ok(claims(token).exp > t.serverNow(), 'the token handed out is one the server accepts');
  assert.equal(t.counts.refresh, 1);
});

test('backend.js still reads the exp claim of a session stored without an expiry, and stores one when it refreshes', async () => {
  const honest = tab(0, { seed: (issue) => { const s = issue(); return { access_token: s.access_token, refresh_token: s.refresh_token }; } });
  await honest.window.MCC_SUPA.token();
  assert.equal(honest.counts.refresh, 0, 'an hour left by its exp claim, on a clock that agrees');
  const ahead = tab(HOUR, { seed: (issue) => { const s = issue(); return { access_token: s.access_token, refresh_token: s.refresh_token }; } });
  for (let call = 0; call < 5; call++) await ahead.window.MCC_SUPA.token();
  assert.equal(ahead.counts.refresh, 1, 'looks spent on this clock, so it is refreshed once and then kept by its stored expiry');
  assert.ok(Math.abs(ahead.stored().expires_at - (ahead.deviceNow() + HOUR)) <= 2, 'stored with its expiry on this device\'s clock');
});

test('a session the canonical client stored on a clock an hour ahead is fresh to backend.js and to the globe embed', async () => {
  const t = tab(HOUR, { modules: ['js/mcc-auth.js', 'js/backend.js', 'js/guest-world.js'] });
  await turn();
  assert.equal(t.globe(), 'guest', 'nobody signed in yet');
  await t.window.MCC.signInWithPassword('fixture@example.test', 'fixture-password');   // announces mcc:auth-changed
  await turn();
  assert.equal(t.globe(), 'signed in', 'the embed\'s own check (no bar on this page) counts the session as live');
  const token = t.stored().access_token;
  for (let call = 0; call < 5; call++) assert.equal(await t.window.MCC_SUPA.token(), token);
  assert.equal(t.counts.refresh, 0, 'neither client refreshes it');
});

test('the globe embed counts a session past its stored expiry as gone, whatever its exp claim says on this clock', async () => {
  const t = tab(-HOUR, { modules: ['js/mcc-auth.js', 'js/guest-world.js'] });
  await t.window.MCC.signInWithPassword('fixture@example.test', 'fixture-password');
  await turn();
  assert.equal(t.globe(), 'signed in');
  t.later(HOUR + 5);                                 // the server expired the token five seconds ago; its exp claim, read on this clock, has an hour to go
  t.window.dispatchEvent({ type: 'mcc:auth-changed' });
  await turn();
  assert.equal(t.globe(), 'guest', 'past its stored expiry on this device\'s clock');
});

/* ---------- ONLY A NO ENDS A SESSION, AND ONLY THE SESSION IT ANSWERS (js/backend.js refresh()) ----------
   The data layer refreshes for itself on pages that never load the canonical client, so it keeps that client's rules
   (js/mcc-auth.js MCC.refresh()): a 4xx naming one of REJECTED clears both shelves; a 429, a 5xx, an answer without both
   tokens, no connection or no answer in time keeps them. Calls in the air at once share one request, and an answer about
   a session that is no longer the one stored writes and clears nothing. Each member here signed in an hour and a half
   ago, so the stored token is spent on both clocks and the next call refreshes. */
const REJECTED = ['refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'session_not_found', 'user_banned', 'user_not_found'];
const ANOTHER = { sub: 'another-member', email: 'another@example.test' };
const spent = (options) => { const t = tab(0, { seed: (issue) => issue(), ...options }); t.later(HOUR + HOUR / 2); return t; };
const shelves = (t) => [t.stored(), t.keep()];
/* The auth server's two error shapes: its default, and the one a client sending X-Supabase-Api-Version gets. */
const refused = (status, code) => reply({ code: status, error_code: code, msg: 'Invalid Refresh Token' }, status);
const refusedVersioned = (status, code) => reply({ code, message: 'Invalid Refresh Token' }, status);
/* a gateway in front of the auth server, down: its page is not JSON */
const page = (status) => ({ ok: false, status, headers: { get: () => null }, text: async () => '<html>upstream unavailable</html>', json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
const UNAVAILABLE = {
  429: () => reply({ code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, 429),
  500: () => reply({ code: 500, error_code: 'unexpected_failure', msg: 'Unexpected failure, please check server logs for more information' }, 500),
  503: () => page(503)
};
/* an answer the test hands over when it chooses */
const held = () => { let give; const answer = new Promise((resolve) => { give = resolve; }); return { answer: () => answer, give }; };

for (const status of [429, 500, 503]) test(`backend.js keeps the session through a refresh answered ${status}, and the next call asks again`, async () => {
  const t = spent({ answer: UNAVAILABLE[status] });
  const before = t.stored();
  assert.equal(await t.window.MCC_SUPA.token(), before.access_token, 'the stored token, as offline: the database still checks it');
  assert.deepEqual(shelves(t), [before, before], 'both shelves untouched');
  assert.equal(t.window.MCC_DB.user().id, MEMBER.sub, 'still the member to every other call on the page');
  t.answerWith(null);                                // the auth server is answering again
  const next = await t.window.MCC_SUPA.token();
  assert.equal(t.counts.refresh, 2, 'the next call asked again');
  assert.notEqual(next, before.access_token);
  assert.equal(next, t.stored().access_token, 'and stored the new session');
});

for (const code of REJECTED) test(`backend.js clears both shelves when the auth server rejects the session: ${code}`, async () => {
  for (const answer of [() => refused(400, code), () => refusedVersioned(400, code)]) {
    const t = spent({ answer });
    assert.equal(await t.window.MCC_SUPA.token(), null);
    assert.deepEqual(shelves(t), [null, null], 'gone from both, so no module restores a session the server has ended');
    assert.equal(t.window.MCC_DB.user(), null);
  }
});

test('backend.js ends a session on exactly the answers the canonical client does', async () => {
  const cases = [
    ...REJECTED.map((code) => [`400 ${code}`, () => refused(400, code), 'cleared']),
    ['401 session_not_found', () => refusedVersioned(401, 'session_not_found'), 'cleared'],
    ['403 user_banned', () => refusedVersioned(403, 'user_banned'), 'cleared'],
    ['404 user_not_found', () => refused(404, 'user_not_found'), 'cleared'],
    ['429', UNAVAILABLE[429], 'kept'],
    ['500', UNAVAILABLE[500], 'kept'],
    ['503, not JSON', UNAVAILABLE[503], 'kept'],
    ['500 naming a rejection code', () => refused(500, 'session_not_found'), 'kept'],
    ['400 validation_failed', () => refused(400, 'validation_failed'), 'kept'],
    ['401 with no code', () => reply({ message: 'Invalid API key' }, 401), 'kept'],
    ['200 without a refresh token', (issue) => { const partial = issue(); delete partial.refresh_token; return reply(partial); }, 'kept'],
    ['no connection', () => { throw new TypeError('Failed to fetch'); }, 'kept']
  ];
  const outcome = (t, before) => {
    const [stored, keep] = shelves(t);
    if (!stored && !keep) return 'cleared';
    return stored?.refresh_token === before.refresh_token && keep?.refresh_token === before.refresh_token ? 'kept' : 'changed';
  };
  for (const [name, answer, expected] of cases) {
    const data = spent({ answer }), canonical = spent({ modules: ['js/mcc-auth.js'], answer });
    const before = [data.stored(), canonical.stored()];
    await data.window.MCC_SUPA.token();
    await canonical.window.MCC.refresh().catch(() => {});
    assert.deepEqual([outcome(data, before[0]), outcome(canonical, before[1])], [expected, expected], name);
  }
});

test('backend.js keeps the session when the auth server cannot be reached or does not answer in time, and a stalled request does not hold the next call', { timeout: 5000 }, async () => {
  const offline = spent({ answer: () => { throw new TypeError('Failed to fetch'); } }), was = offline.stored();
  assert.equal(await offline.window.MCC_SUPA.token(), was.access_token);
  assert.deepEqual(shelves(offline), [was, was]);
  const stalled = spent({ answer: () => new Promise(() => {}), fast: true }), before = stalled.stored();
  assert.equal(await stalled.window.MCC_SUPA.token(), before.access_token, 'settled at the 12-second bound with the stored token');
  assert.deepEqual(shelves(stalled), [before, before]);
  stalled.answerWith(null);
  const next = await stalled.window.MCC_SUPA.token();
  assert.equal(stalled.counts.refresh, 2, 'the next call asked again instead of joining the stalled request');
  assert.notEqual(next, before.access_token);
  assert.equal(next, stalled.stored().access_token);
});

test('backend.js calls that need a refresh at once share one request and store its answer once', async () => {
  const wait = held(), t = spent({ answer: wait.answer });
  const calls = Array.from({ length: 5 }, () => t.window.MCC_SUPA.token());
  await turn();
  assert.equal(t.counts.refresh, 1, 'one request for five calls: the refresh token is spent once, not raced through its own rotation');
  wait.give(reply(t.issue()));
  const tokens = await Promise.all(calls);
  assert.equal(new Set(tokens).size, 1);
  assert.equal(tokens[0], t.stored().access_token);
  assert.equal(t.counts.writes, 1, 'stored once');
});

test('a backend.js refresh that lands after a sign-out does not sign the member back in', async () => {
  const wait = held(), t = spent({ answer: wait.answer });
  const call = t.window.MCC_SUPA.token();
  await turn();
  await t.window.MCC_AUTH.signOut();
  wait.give(reply(t.issue()));
  assert.equal(await call, null);
  assert.deepEqual(shelves(t), [null, null]);
});

for (const [late, answer] of [['new session', (t) => reply(t.issue())], ['rejection', () => refused(400, 'refresh_token_not_found')], ['503', () => page(503)]]) test(`a late backend.js ${late} about an account no longer stored neither overwrites nor clears the account that is`, async () => {
  const wait = held(), t = spent({ answer: wait.answer });
  const call = t.window.MCC_SUPA.token();
  await turn();
  const other = t.issue(ANOTHER);
  t.store(other);                                    // another account signed in: with the page's other client, or in another tab
  wait.give(answer(t));
  assert.equal(await call, null, 'a call begun for the first account is not handed the second account\'s token');
  assert.deepEqual(shelves(t), [other, other]);
});

test('a late backend.js answer for a token the same member refreshed elsewhere hands out that token and writes nothing', async () => {
  for (const answer of [(t) => reply(t.issue()), () => refused(400, 'refresh_token_already_used'), () => page(503)]) {
    const wait = held(), t = spent({ answer: wait.answer });
    const call = t.window.MCC_SUPA.token();
    await turn();
    const elsewhere = t.issue();
    t.store(elsewhere);                              // the page's other client, or another tab, refreshed first
    wait.give(answer(t));
    assert.equal(await call, elsewhere.access_token);
    assert.deepEqual(shelves(t), [elsewhere, elsewhere]);
    assert.equal(t.counts.writes, 0, 'the late answer wrote nothing');
  }
});
