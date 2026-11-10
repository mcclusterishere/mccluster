/* The bar's account lookup against the real canonical auth client, in Node.
   js/mcc-auth.js runs whole, the way auth-network-recovery.test.mjs runs it. The bar is a DOM script, so its
   account-state functions are cut out of js/tabbar.js by name (the way owner-world-navigation.test.mjs cuts
   adminBar) and run beside it with only the painting stubbed. Every response is a fixture: no account, no network. */
import { test as runnerTest } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const AUTH = read('js/mcc-auth.js');
const BAR = read('js/tabbar.js');
function cut(from, to) {
  const start = BAR.indexOf(from), end = BAR.indexOf(to, start + 1);
  assert.ok(start !== -1 && end > start, `js/tabbar.js still has "${from}" before "${to}"`);
  return BAR.slice(start, end);
}
const BAR_ACCOUNT_STATE = '"use strict";\n' + [
  cut('function currentSubject()', 'function readPerspective()'),
  cut('function resolveOwnPerspective(', 'function authDisplay('),            // and readAuthSession, jwtPayload
  cut('function readAdminMemo(', 'window.addEventListener("hashchange", markAdminHere);'), // and checkAdmin
  cut('function loadCanonicalAuth()', '/* ---------- ONE M ACCOUNT, EVERY HOST'),          // and refreshAuthState
  cut('arriveWithHandoff().then(', 'var ICONS = {')                           // the boot lookup and both listeners
].join('\n');

const SUPABASE = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co', API = 'https://api.mccluster.org';
const HOUR = 3600;
const encode = (claims) => Buffer.from(JSON.stringify(claims)).toString('base64url');
const subjectOf = (token) => { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url')).sub || ''; } catch { return ''; } };
const turn = () => new Promise((resolve) => setImmediate(resolve));
/* A lookup that never lands leaves nothing for Node to wait on, and the runner would cancel every case after it.
   This deadline keeps the loop alive so that case fails by itself, with the reason. */
const test = (name, run) => runnerTest(name, async () => {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('still waiting after 5 seconds: something the bar asked for never landed')), 5000); });
  try { await Promise.race([run(), deadline]); } finally { clearTimeout(timer); }
});
/* the clients' own deadlines (12 seconds a request, 5 for the owner check) must not keep the runner waiting */
const quietTimeout = (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; };

/* One browser profile: a shelf of localStorage every tab shares, and the fixture servers behind them.
   clockAhead is how far this device's clock runs ahead of the server's, in seconds. An hour ahead with
   one-hour tokens is the session that is stale on every call: each new token already looks expired. */
function profile({ clockAhead = 0, owners = [], refreshLimit = 40 } = {}) {
  const serverNow = () => Math.floor(Date.now() / 1000);
  const counts = { refresh: 0, user: 0, status: 0, bootstrap: 0 };
  const shelf = new Map(), tabs = [], refreshTokens = new Map(), parked = new Map(), down = new Set();
  let serial = 0, moving = 0;

  function issue(sub, issuedAt = serverNow()) {
    const n = ++serial, refresh_token = 'fixture-refresh-' + n;
    refreshTokens.set(refresh_token, sub);
    return {
      access_token: 'fixture.' + encode({ sub, email: sub + '@example.test', exp: issuedAt + HOUR, n }) + '.fixture',
      refresh_token, token_type: 'bearer', expires_in: HOUR, expires_at: issuedAt + HOUR,
      user: { id: sub, email: sub + '@example.test' }
    };
  }
  /* writes a session straight onto the shelf: what an earlier visit left, or a write no event announces */
  function store(session) {
    const raw = session ? JSON.stringify(session) : null;
    for (const key of ['mccdb_session', 'mcc_sess_keep']) { if (raw) shelf.set(key, raw); else shelf.delete(key); }
    return session;
  }
  const stored = () => JSON.parse(shelf.get('mccdb_session') || 'null');
  const reply = (body, status = 200) => ({
    ok: status < 400, status, headers: { get: () => null },
    text: async () => JSON.stringify(body), json: async () => body
  });

  function answer(kind, url, init) {
    const bearer = (/^Bearer (.+)$/.exec((init.headers && init.headers.authorization) || '') || [])[1] || '';
    const sub = subjectOf(bearer);
    if (down.has(kind)) return reply({ code: 'unexpected_failure', msg: 'Unavailable' }, 503);
    if (kind === 'refresh') {
      if (counts.refresh > refreshLimit) return reply({ code: 'over_request_rate_limit', msg: 'Too many requests' }, 429);
      const owner = refreshTokens.get(JSON.parse(init.body || '{}').refresh_token);
      return owner ? reply(issue(owner)) : reply({ code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400);
    }
    if (kind === 'password') return reply(issue(JSON.parse(init.body || '{}').email.split('@')[0]));
    if (!sub) return reply({ code: 'bad_jwt', msg: 'Invalid token' }, 401);
    if (kind === 'user') return reply({ id: sub, email: sub + '@example.test' });
    if (kind === 'status') return owners.includes(sub) ? reply({ ok: true }) : reply({ error: 'forbidden' }, 403);
    return reply({ identity: { mccluster_id: sub }, profile: { display_name: sub } });
  }
  function request(url, init = {}) {
    const u = new URL(url), grant = u.searchParams.get('grant_type');
    const kind = u.origin === SUPABASE && u.pathname === '/auth/v1/token' && grant === 'refresh_token' ? 'refresh'
      : u.origin === SUPABASE && u.pathname === '/auth/v1/token' && grant === 'password' ? 'password'
      : u.origin === SUPABASE && u.pathname === '/auth/v1/user' ? 'user'
      : u.origin === API && u.pathname === '/v1/status' ? 'status'
      : u.origin === API && u.pathname === '/v1/mnet/bootstrap' ? 'bootstrap' : null;
    if (!kind) return Promise.reject(new TypeError('fixture has no route for ' + url));
    if (kind in counts) counts[kind]++;
    moving++;
    return turn().then(() => {
      const queue = parked.get(kind);
      if (!queue) return null;
      moving--;                       // a held request is not progress: quiet() must not wait for it
      return new Promise((release) => queue.push(release)).then(() => { moving++; });
    }).then(() => answer(kind, url, init)).finally(() => { moving--; });
  }
  /* another tab hears a write a moment later, never the tab that made it */
  function announce(from, key, oldValue, newValue) {
    for (const tab of tabs) {
      if (tab === from) continue;
      moving++;
      setImmediate(() => { moving--; tab.window.dispatchEvent({ type: 'storage', key, oldValue, newValue }); });
    }
  }

  function open() {
    const listeners = new Map(), own = new Map(), paints = [], adminPaints = [];
    const tab = { paints, adminPaints };
    const local = {
      getItem: (key) => (shelf.has(key) ? shelf.get(key) : null),
      setItem(key, value) {
        value = String(value);
        const old = local.getItem(key);
        if (old === value) return;
        shelf.set(key, value); announce(tab, key, old, value);
      },
      removeItem(key) {
        if (!shelf.has(key)) return;
        const old = shelf.get(key);
        shelf.delete(key); announce(tab, key, old, null);
      }
    };
    const session = { getItem: (key) => (own.has(key) ? own.get(key) : null), setItem: (key, value) => { own.set(key, String(value)); }, removeItem: (key) => { own.delete(key); } };
    const window = {
      localStorage: local, sessionStorage: session,
      location: { origin: 'https://matthew.mccluster.org', hostname: 'matthew.mccluster.org', pathname: '/privacy.html', search: '', hash: '' },
      addEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).concat(listener)); },
      dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return true; }
    };
    const real = Date;
    const context = vm.createContext({
      window, localStorage: local, sessionStorage: session, fetch: request,
      AbortController, URL, URLSearchParams, setTimeout: quietTimeout, clearTimeout, atob, btoa,
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
      Date: class extends real { static now() { return real.now() + clockAhead * 1000; } },
      /* everything the cut functions close over in the bar, and the painting they call */
      AUTH_STATE: { signed_in: false, verified: false, user: null },
      SELF_PROFILE: null, PERSPECTIVE: null, selfProfileEpoch: 0, lastVerifiedSubject: '',
      adminEpoch: 0, authEpoch: 0, adminSession: null, adminFlight: null,
      ADMIN_KEY: 'mcc_appbar_admin', ADMIN_TTL: 60000, API_ORIGIN: API,
      wingOn: null, HOME_BAR: '', dock: { innerHTML: '' },
      paintAuthState(signedIn, user, verified) {
        context.AUTH_STATE = { signed_in: !!signedIn, verified: !!verified, user: user || null };
        paints.push({ signed_in: !!signedIn, verified: !!verified, user: user ? user.id : null });
      },
      paintAdmin(on) { adminPaints.push(!!on); },
      paintPerspective() {}, storePerspective() {}, readPerspective: () => null, cleanPerspective: (p) => p,
      arriveWithHandoff: () => Promise.resolve(false)
    });
    vm.runInContext(AUTH, context, { filename: 'js/mcc-auth.js' });
    tab.window = window; tab.MCC = window.MCC;
    tab.state = () => ({ signed_in: context.AUTH_STATE.signed_in, verified: context.AUTH_STATE.verified, user: context.AUTH_STATE.user ? context.AUTH_STATE.user.id : null });
    tabs.push(tab);
    vm.runInContext(BAR_ACCOUNT_STATE, context, { filename: 'js/tabbar.js' });   // boots: the first lookup is now in the air
    return tab;
  }

  return {
    counts, issue, store, stored, open,
    /* what an earlier visit left: a session issued `age` seconds ago by the server's clock */
    seed: (sub, age = 0) => store(issue(sub, serverNow() - age)),
    /* hold every request of a kind in the air; pass() lands the oldest, release() lands all and stops holding */
    hold(kind) { parked.set(kind, []); },
    pass(kind) { const release = (parked.get(kind) || []).shift(); assert.ok(release, 'a ' + kind + ' request is in the air'); release(); },
    release(kind) { const queue = parked.get(kind) || []; parked.delete(kind); queue.forEach((release) => release()); },
    fail(kind, on = true) { if (on) down.add(kind); else down.delete(kind); },
    /* resolves when nothing is moving any more: no request in flight, no storage event undelivered */
    async quiet() { for (let still = 0; still < 6;) { await turn(); still = moving ? 0 : still + 1; } }
  };
}
const SIGNED_OUT = { signed_in: false, verified: true, user: null };
const signedIn = (user) => ({ signed_in: true, verified: true, user });
const paintedAs = (tab, user) => tab.paints.some((paint) => paint.user === user);

test('a session that is stale on every call is looked up once and painted signed in', async () => {
  const device = profile({ clockAhead: HOUR });
  device.seed('member-1');
  const bar = device.open();
  await device.quiet();
  assert.deepEqual(device.counts, { refresh: 1, user: 1, status: 1, bootstrap: 1 }, 'one refresh, one account lookup, then the owner check and the member\'s own profile with that token');
  assert.deepEqual(bar.state(), signedIn('member-1'));
  assert.equal(subjectOf(device.stored().access_token), 'member-1', 'the refreshed session is the one kept');
});

test('an expired session on an honest clock is one refresh and one lookup', async () => {
  const device = profile();
  device.seed('member-1', 2 * HOUR);
  const bar = device.open();
  await device.quiet();
  assert.deepEqual({ refresh: device.counts.refresh, user: device.counts.user }, { refresh: 1, user: 1 });
  assert.deepEqual(bar.state(), signedIn('member-1'));
});

test('a fresh session is one lookup and no refresh', async () => {
  const device = profile();
  device.seed('member-1');
  const bar = device.open();
  await device.quiet();
  assert.deepEqual({ refresh: device.counts.refresh, user: device.counts.user }, { refresh: 0, user: 1 });
  assert.deepEqual(bar.state(), signedIn('member-1'));
});

test('with no answer and a token that keeps moving the bar spends its three lookups and settles signed out', async () => {
  const device = profile({ clockAhead: HOUR });
  device.seed('member-1');
  device.fail('user');
  const bar = device.open();
  await device.quiet();
  assert.deepEqual({ refresh: device.counts.refresh, user: device.counts.user }, { refresh: 3, user: 3 });
  assert.deepEqual(bar.state(), SIGNED_OUT);
  assert.equal(subjectOf(device.stored().access_token), 'member-1', 'a failed lookup never discards the session');
});

test('an account switched during the lookup is verified itself, never painted from the old answer', async () => {
  const device = profile();
  device.seed('member-1');
  device.hold('user');
  const bar = device.open();
  await device.quiet();
  device.store(device.issue('member-2'));      // no event: only the stored token says so
  device.release('user');
  await device.quiet();
  assert.deepEqual(bar.state(), signedIn('member-2'));
  assert.equal(paintedAs(bar, 'member-1'), false, 'the first account was never painted');
  assert.equal(device.counts.user, 2);
});

test('a sign-out during the lookup is painted signed out', async () => {
  const device = profile();
  device.seed('member-1');
  device.hold('user');
  const bar = device.open();
  await device.quiet();
  device.store(null);
  device.release('user');
  await device.quiet();
  assert.deepEqual(bar.state(), SIGNED_OUT);
  assert.equal(paintedAs(bar, 'member-1'), false);
  assert.equal(device.counts.user, 1, 'no session, nothing more to ask');
});

test('an account that changes under every lookup is not painted from any answer, and the bar stops at three', async () => {
  const device = profile();
  device.seed('member-1');
  device.hold('user');
  const bar = device.open();
  await device.quiet();
  for (const next of ['member-2', 'member-3', 'member-4']) {
    device.store(device.issue(next));
    device.pass('user');                        // the answer about the account before lands on this one's session
    await device.quiet();
  }
  assert.deepEqual(bar.state(), SIGNED_OUT);
  assert.equal(bar.paints.some((paint) => paint.signed_in && paint.verified), false, 'nobody was painted verified');
  assert.equal(device.counts.user, 3, 'three lookups for one auth event, then it stops');
});

test('after an account switch during the lookup the bar still has lookups left for the new account', async () => {
  const device = profile({ clockAhead: HOUR });
  device.seed('member-1');
  device.hold('user');
  const bar = device.open();
  await device.quiet();
  device.store(device.issue('member-2'));
  device.release('user');
  await device.quiet();
  assert.deepEqual(bar.state(), signedIn('member-2'));
  assert.equal(paintedAs(bar, 'member-1'), false);
});
