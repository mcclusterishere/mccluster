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
  cut('function loadCanonicalAuth()', '/* ---------- ONE M ACCOUNT, EVERY HOST'),          // and refreshAuthState, currentAuthState
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
  let serial = 0, moving = 0, elapsed = 0;       // elapsed: seconds the test has let pass, for the server and the device alike
  const serverNow = () => Math.floor(Date.now() / 1000) + elapsed;
  const counts = { refresh: 0, user: 0, status: 0, bootstrap: 0 };
  const shelf = new Map(), tabs = [], refreshTokens = new Map(), parked = new Map(), down = new Map();

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
    if (down.has(kind)) return reply({ code: down.get(kind).code, msg: 'Fixture failure' }, down.get(kind).status);
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
      Date: class extends real { static now() { return real.now() + (clockAhead + elapsed) * 1000; } },
      /* everything the cut functions close over in the bar, and the painting they call */
      AUTH_STATE: { signed_in: false, verified: false, user: null },
      SELF_PROFILE: null, PERSPECTIVE: null, selfProfileEpoch: 0, lastVerifiedSubject: '',
      adminEpoch: 0, authEpoch: 0, adminSession: null, adminFlight: null,
      ADMIN_KEY: 'mcc_appbar_admin', ADMIN_TTL: 60000, API_ORIGIN: API,
      wingOn: null, HOME_BAR: '', dock: { innerHTML: '' },
      paintAuthState(signedIn, user, verified) {
        context.AUTH_STATE = { signed_in: !!signedIn, verified: !!verified, user: user || null };
        paints.push({ signed_in: !!signedIn, verified: !!verified, user: user ? user.id : null });
        /* the bar has read the session and not yet asked: where a test slips a write in between the two */
        if (!verified && tab.beforeAsking) { const write = tab.beforeAsking; tab.beforeAsking = null; write(); }
      },
      paintAdmin(on) { adminPaints.push(!!on); },
      paintPerspective() {}, storePerspective() {}, readPerspective: () => null, cleanPerspective: (p) => p,
      arriveWithHandoff: () => Promise.resolve(false)
    });
    vm.runInContext(AUTH, context, { filename: 'js/mcc-auth.js' });
    tab.window = window; tab.MCC = window.MCC;
    tab.state = () => ({ signed_in: context.AUTH_STATE.signed_in, verified: context.AUTH_STATE.verified, user: context.AUTH_STATE.user ? context.AUTH_STATE.user.id : null });
    tab.ask = () => context.currentAuthState();          // what MCC_BAR.refreshAuth is
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
    /* a kind of request answers with a failure: unavailable unless told otherwise; fail(kind, false) mends it */
    fail(kind, how = { status: 503, code: 'unexpected_failure' }) { if (how) down.set(kind, how); else down.delete(kind); },
    /* time passes, with no request in the air */
    rest(secondsLater) { elapsed += secondsLater; },
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

/* ---------- the same rule where the bar meets a token it did not refresh itself ---------- */

for (const [who, owners, expected] of [['the owner', ['member-1'], true], ['a member', [], false]]) {
  test(`the owner check keeps its answer for ${who} when the token was refreshed for the same account meanwhile`, async () => {
    const device = profile({ clockAhead: HOUR, owners });
    device.seed('member-1');
    device.hold('status');
    const bar = device.open();
    await device.quiet();
    assert.deepEqual(bar.state(), signedIn('member-1'));
    assert.deepEqual(bar.adminPaints, [], 'the owner check is still in the air');
    await bar.MCC.refresh();                    // another request on the page refreshes the token, as each one does here
    device.release('status');
    await device.quiet();
    assert.deepEqual(bar.adminPaints, [expected], 'the answer is painted, so the navigation is released');
  });
}

for (const [what, next] of [['another account', (device) => device.issue('member-2')], ['no session', () => null]]) {
  test(`the owner check drops its answer when ${what} is stored by the time it lands`, async () => {
    const device = profile({ owners: ['owner-1'] });
    device.seed('owner-1');
    device.hold('status');
    const bar = device.open();
    await device.quiet();
    device.store(next(device));                 // no event: only the stored session says so
    device.release('status');
    await device.quiet();
    assert.equal(bar.adminPaints.includes(true), false, 'the owner bar is never painted for whoever is stored now');
  });
}

test('two tabs on a session that is stale on every call do not keep answering each other', async () => {
  const device = profile({ clockAhead: HOUR });
  device.seed('member-1');
  const first = device.open(), second = device.open();
  await device.quiet();
  assert.ok(device.counts.refresh <= 6, `three lookups a tab at most, ${device.counts.refresh} refresh requests`);
  assert.equal(device.counts.user, 2, 'one answer each');
  assert.deepEqual(first.state(), signedIn('member-1'));
  assert.deepEqual(second.state(), signedIn('member-1'));
});

test('a tab that loses the refresh to its neighbour twice still settles signed in', async () => {
  const device = profile({ clockAhead: HOUR });
  device.seed('member-1');
  device.hold('refresh');
  const first = device.open(), second = device.open();
  await device.quiet();                         // both lookups have a refresh in the air
  device.pass('refresh');                       // the first tab's lands and is stored; it signs in
  await device.quiet();
  assert.deepEqual(first.state(), signedIn('member-1'));
  const page = first.MCC.refresh();             // a request of that tab's page refreshes again, as each one does here
  device.pass('refresh');                       // the second tab's lands on a session it no longer matches: no answer, it asks again
  await device.quiet();
  device.pass('refresh');                       // the page's refresh lands and is stored
  await page;
  await device.quiet();
  device.pass('refresh');                       // so the second tab's refresh has lost again: no answer a second time
  await device.quiet();
  assert.deepEqual(second.paints.map((paint) => paint.verified), [false, false, false], 'three lookups begun, nothing painted as an answer yet');
  device.release('refresh');
  await device.quiet();
  assert.deepEqual(second.state(), signedIn('member-1'));
  assert.equal(device.counts.user, 2, 'one answer each');
});

test('a token another tab refreshed for the account already on the bar asks nothing here', async () => {
  const device = profile();
  device.seed('member-1');
  const first = device.open(), second = device.open();
  await device.quiet();
  const before = { ...device.counts }, paints = second.paints.length;
  await first.MCC.refresh();
  await device.quiet();
  assert.equal(device.counts.refresh, before.refresh + 1, 'the one refresh that tab asked for');
  assert.deepEqual({ ...device.counts, refresh: before.refresh }, before, 'no lookup, no owner check, no profile fetch in the other tab');
  assert.equal(second.paints.length, paints, 'and nothing repainted there');
  assert.deepEqual(second.state(), signedIn('member-1'));
});

test('another tab signing out, or in as someone else, still reaches this bar', async () => {
  const device = profile();
  device.seed('member-1');
  const first = device.open(), second = device.open();
  await device.quiet();
  await first.MCC.signInWithPassword('member-2@example.test', 'fixture-password');   // straight over member-1
  await device.quiet();
  assert.deepEqual(second.state(), signedIn('member-2'));
  await first.MCC.signOut();
  await device.quiet();
  assert.deepEqual(second.state(), SIGNED_OUT);
  await first.MCC.signInWithPassword('member-2@example.test', 'fixture-password');
  await device.quiet();
  assert.deepEqual(second.state(), signedIn('member-2'));
  assert.deepEqual(first.state(), signedIn('member-2'));
});

test('a bar that settled signed out asks again when another tab stores a session for that account', async () => {
  const device = profile();
  device.seed('member-1');
  device.fail('user');
  const second = device.open();
  await device.quiet();
  assert.deepEqual(second.state(), SIGNED_OUT, 'the lookup had no answer');
  device.fail('user', false);
  const first = device.open();
  await device.quiet();
  assert.deepEqual(first.state(), signedIn('member-1'));
  await first.MCC.refresh();
  await device.quiet();
  assert.deepEqual(second.state(), signedIn('member-1'));
});

test('a page asking the bar shares the lookup in the air and is not answered by a second one', async () => {
  const device = profile({ clockAhead: HOUR });
  device.seed('member-1');
  device.hold('user');
  const bar = device.open();
  await device.quiet();
  const asked = [bar.ask(), bar.ask()];
  device.release('user');
  for (const state of await Promise.all(asked)) assert.deepEqual({ signed_in: state.signed_in, verified: state.verified }, { signed_in: true, verified: true });
  await device.quiet();
  assert.deepEqual({ refresh: device.counts.refresh, user: device.counts.user }, { refresh: 1, user: 1 });
  await bar.ask();
  await device.quiet();
  assert.deepEqual({ refresh: device.counts.refresh, user: device.counts.user }, { refresh: 1, user: 1 }, 'a verified sign-in stands');
});

test('a page asking a bar that shows signed out is looked up again', async () => {
  const device = profile();
  device.seed('member-1');
  device.fail('user');
  const bar = device.open();
  await device.quiet();
  assert.deepEqual(bar.state(), SIGNED_OUT);
  device.fail('user', false);
  const state = await bar.ask();
  assert.deepEqual({ signed_in: state.signed_in, verified: state.verified }, { signed_in: true, verified: true });
  assert.deepEqual(bar.state(), signedIn('member-1'));
});

test('pages and other tabs go through the shared rule; a sign-in or sign-out in this tab always asks', () => {
  assert.match(BAR, /\n    refreshAuth: currentAuthState,\n/);
  assert.match(BAR, /window\.addEventListener\("storage", function \(e\) \{\n\s*if \(!e \|\| e\.key === "mccdb_session" \|\| e\.key === "mcc_sess_keep"\) currentAuthState\(\);/);
  assert.match(BAR, /window\.addEventListener\("mcc:auth-changed", refreshAuthState\);/);
});

/* ---------- a bar that has no answer tries again later, and an answer has to be about the account stored ---------- */

test('a bar that spent its lookups without an answer asks again once it has rested', async () => {
  const device = profile();
  device.seed('member-1');
  device.fail('user');
  const second = device.open();
  await device.quiet();
  const first = device.open();
  await device.quiet();
  for (let write = 0; write < 2; write++) { await first.MCC.refresh(); await device.quiet(); }   // each write: one more look, no answer
  assert.deepEqual(second.state(), SIGNED_OUT);
  device.fail('user', false);                   // the account service is back
  const spent = device.counts.user;
  await first.MCC.refresh();
  await device.quiet();
  assert.equal(device.counts.user, spent, 'the budget for this auth event is spent: no fourth lookup straight away');
  device.rest(31);
  await first.MCC.refresh();
  await device.quiet();
  assert.deepEqual(second.state(), signedIn('member-1'), 'half a minute on, the next write for that account is looked up');
});

test('a session the server rejects under the last lookup is a sign-out, and signing in again elsewhere still reaches the bar', async () => {
  const device = profile({ clockAhead: HOUR });
  device.seed('member-1');
  device.fail('user');
  device.hold('refresh');
  const bar = device.open();
  for (let lookup = 1; lookup < 3; lookup++) { await device.quiet(); device.pass('refresh'); }   // two lookups: refreshed, no answer
  await device.quiet();
  device.fail('refresh', { status: 400, code: 'refresh_token_already_used' });
  device.pass('refresh');                       // the third: the canonical client clears the rejected session, with no event here
  await device.quiet();
  assert.equal(device.stored(), null);
  assert.deepEqual(bar.state(), SIGNED_OUT);
  device.release('refresh'); device.fail('refresh', false); device.fail('user', false);
  const other = device.open();
  await device.quiet();
  await other.MCC.signInWithPassword('member-1@example.test', 'fixture-password');
  await device.quiet();
  assert.deepEqual(bar.state(), signedIn('member-1'));
});

test('an answer about another account is not painted, even when the first account is stored again', async () => {
  const device = profile();
  device.seed('member-1');
  device.hold('user');
  const bar = device.open();
  bar.beforeAsking = () => device.store(device.issue('member-2'));   // stored between the bar reading the session and the client reading it
  await device.quiet();                          // the client is asking about member-2
  device.store(device.issue('member-1'));        // and member-1 is stored again, with a new token
  device.release('user');
  await device.quiet();
  assert.equal(paintedAs(bar, 'member-2'), false, 'member-2 was never painted');
  assert.deepEqual(bar.state(), signedIn('member-1'));
});
