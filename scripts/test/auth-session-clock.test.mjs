/* ONE CLOCK for "is this session fresh?" in the modules that read the stored session beside the canonical client:
   js/backend.js (token(), the data layer's own refresh) and js/guest-world.js (the globe embed's fallback when the bar
   has no answer). The canonical client's own cases are in auth-network-recovery.test.mjs and the bar's in
   tabbar-auth-refresh.test.mjs. Each module runs whole in vm, in one tab sharing one localStorage, on a device whose
   clock is `ahead` seconds off the auth server's (negative: behind). Every response is a fixture: no account, no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const HOUR = 3600;
const claims = (token) => { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url')); } catch { return {}; } };
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body });
const turn = () => new Promise((resolve) => setImmediate(resolve));

/* The auth server issues one-hour tokens on its own clock. later(s) moves both clocks on together.
   seed(issue): what an earlier visit stored. */
function tab(ahead, { modules = ['js/backend.js'], seed } = {}) {
  let elapsed = 0, serial = 0;
  const serverNow = () => Math.floor(Date.now() / 1000) + elapsed;
  const counts = { refresh: 0 };
  const issue = () => {
    const iat = serverNow(), n = ++serial;
    return {
      access_token: 'fixture.' + Buffer.from(JSON.stringify({ sub: 'fixture-member', email: 'fixture@example.test', iat, exp: iat + HOUR, n })).toString('base64url') + '.fixture',
      refresh_token: 'fixture-refresh-' + n, token_type: 'bearer', expires_in: HOUR, expires_at: iat + HOUR, user: { id: 'fixture-member' }
    };
  };
  const shelf = new Map();
  const localStorage = { getItem: (key) => (shelf.has(key) ? shelf.get(key) : null), setItem: (key, value) => { shelf.set(key, String(value)); }, removeItem: (key) => { shelf.delete(key); } };
  if (seed) { const raw = JSON.stringify(seed(issue)); shelf.set('mccdb_session', raw); shelf.set('mcc_sess_keep', raw); }
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'refresh_token') counts.refresh++;
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
    fetch, atob, btoa, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, console,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Date: class extends real { static now() { return real.now() + (ahead + elapsed) * 1000; } }
  });
  for (const path of modules) vm.runInContext(read(path), context, { filename: path });
  return {
    window, counts, serverNow, deviceNow: () => serverNow() + ahead, later: (seconds) => { elapsed += seconds; },
    stored: () => JSON.parse(shelf.get('mccdb_session') || 'null'),
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
