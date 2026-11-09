/* CHEM 108 GUEST TRIAL: an account answer belongs to the session that asked for it.

   Deep audit 2026-11-09, finding W4 (PR #758): js/game-hub/chem108/trial.mjs asked MCC.user() once, latched
   `verified = true` on whatever came back and never looked again. A lookup that answered after sign-out, or after
   another account took the session, left "Welcome back / Play Chemistry" on an expired guest trial for as long as
   the tab lived. These cases hold the page to the corrected rule: an answer counts only for the account whose
   session asked and only while that session is stored; sign-out, another account, cleared storage, a hidden tab and
   a restored page all end it; a refreshed token for the same account is not a sign-out; and a failed lookup never
   costs a guest the preview they still have.

   The page mounts when its module is imported with a document present, so every case imports a fresh copy against a
   small DOM shim. Except for the audit's own reproduction, the account service is the real js/mcc-auth.js (run the
   way scripts/test/auth-network-recovery.test.mjs runs it) over a fetch the case answers by hand: MCC.user(),
   MCC.signOut(), sign-in and token refresh are the shipped code, and "late" means the HTTP reply had not been
   delivered yet. No network, no account, no production data; the browser run is scripts/e2e/game-hub-capsule.e2e.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { TRIAL_KEY, TRIAL_MS } from '../../js/game-hub/chem108/trial.mjs';

const PAGE_MODULE = new URL('../../js/game-hub/chem108/trial.mjs', import.meta.url).href;
const GAME_MODULE = new URL('../../js/game-hub/chem108/game.mjs', import.meta.url).href;
const AUTH_SOURCE = readFileSync(new URL('../../js/mcc-auth.js', import.meta.url), 'utf8');
const SESSION_KEY = 'mccdb_session', KEEP_KEY = 'mcc_sess_keep';
const HOUR = 60 * 60 * 1000;
const EXPIRED = TRIAL_MS + HOUR, ACTIVE = HOUR; // how long ago the guest pressed Start

/* Access tokens shaped like the real ones: three parts, the payload naming the account (sub). `turn` makes a
   refreshed token for the same account a different string. Built here, unsigned, never sent anywhere. */
const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = (subject, turn = 1) => [part({ alg: 'none', typ: 'JWT' }), part({ sub: subject, turn }), 'fixture'].join('.');
const A = tokenFor('member-a'), A_REFRESHED = tokenFor('member-a', 2), B = tokenFor('member-b');
const NAMES = new Map([[A, 'A'], [A_REFRESHED, 'A refreshed'], [B, 'B']]);

/* what the panel offers, read the way a visitor would */
const PROMPT = { heading: 'Continue with an M Account', start: null, account: true };
const WELCOME = { heading: 'Welcome back', start: 'Play Chemistry', account: false };
const PREVIEW = { heading: 'Your chemistry trial', start: 'Play Chemistry', account: false };
const FRESH = { heading: 'Seven days free', start: 'Start my free trial', account: false };
const MEMBER_ROUND = 'Signed-in account verified.', GUEST_ROUND = /^Guest trial: .+ remaining\.$/;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body == null ? '' : JSON.stringify(body)) });
const sessionFor = (token, expiresAt = Math.floor(Date.now() / 1000) + 3600) => ({ access_token: token, refresh_token: 'refresh-fixture', expires_at: expiresAt });
const trialStarted = (ago) => JSON.stringify({ version: 1, startedAt: Date.now() - ago, lastSeen: Date.now() - ago });

let pages = 0;
async function openPage({ token = null, expiresAt, trial = null, canonical = true, events = true } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        textContent: '', onclick: null, hidden: ['chemTrialStart', 'chemTrialAccount', 'chemTrialGame'].includes(id), // as chem108.html ships them
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
        querySelector: () => ({}), querySelectorAll: () => [] // enough for the real game module to mount and be destroyed
      });
    }
    return elements.get(id);
  };
  const values = new Map();
  const storage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); }
  };
  /* what canonical writeSession() leaves in storage, without its event */
  const store = (next) => {
    if (!next) { values.delete(SESSION_KEY); values.delete(KEEP_KEY); return; }
    const raw = JSON.stringify(typeof next === 'string' ? sessionFor(next) : next);
    values.set(SESSION_KEY, raw); values.set(KEEP_KEY, raw);
  };
  const stored = () => { try { return JSON.parse(values.get(SESSION_KEY) || 'null')?.access_token || null; } catch (e) { return null; } };

  const handlers = { window: new Map(), document: new Map() };
  const listen = (map) => (type, handler) => { map.set(type, [...(map.get(type) || []), handler]); };
  const fire = (map, type, event = {}) => { for (const handler of map.get(type) || []) handler(Object.assign({ type }, event)); };
  const timers = [];
  const doc = { visibilityState: 'visible', getElementById: element, querySelector: (selector) => (selector === '[data-chem108-trial]' ? element('panel') : null) };
  const win = {
    localStorage: storage, sessionStorage: storage,
    location: { origin: 'https://matthew.mccluster.org', hostname: 'matthew.mccluster.org', pathname: '/chem108.html', search: '', hash: '' },
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    dispatchEvent: (event) => { fire(handlers.window, event.type, event); return true; }
  };
  if (events) { win.addEventListener = listen(handlers.window); doc.addEventListener = listen(handlers.document); doc.removeEventListener = () => {}; }

  /* every request the account service makes, held until the case answers it */
  const requests = [];
  const hold = (fields) => {
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    const request = Object.assign({ promise, settled: false, resolve: (value) => { request.settled = true; resolve(value); return flush(); },
      reject: (error) => { request.settled = true; reject(error); return flush(); } }, fields);
    requests.push(request);
    return request;
  };
  if (canonical) {
    const fetchImpl = (url, init = {}) => {
      const request = hold({ url: String(url), method: init.method || 'GET', token: String((init.headers || {}).authorization || '').replace(/^Bearer /, '') || null });
      request.answer = (body, status) => request.resolve(response(body, status));
      request.offline = () => request.reject(new TypeError('Failed to fetch'));
      if (/\/auth\/v1\/logout$/.test(request.url)) request.answer(null, 204); // sign-out is local first; the server call just succeeds
      return request.promise;
    };
    vm.runInNewContext(AUTH_SOURCE, { window: win, fetch: fetchImpl, AbortController, URL, URLSearchParams, setTimeout, clearTimeout,
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } } });
  } else {
    /* the audit's shape: MCC.user() is a promise the case settles, nothing else exists */
    win.MCC = { user: () => { const request = hold({ url: 'MCC.user()', method: 'CALL', token: stored() }); request.answer = request.resolve; return request.promise; } };
  }

  if (trial != null) values.set(TRIAL_KEY, trialStarted(trial));
  if (token) store(sessionFor(token, expiresAt));
  const globals = { document: doc, window: win, localStorage: storage, cancelAnimationFrame: () => {} };
  const before = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  await import(PAGE_MODULE + '?page=' + (++pages));
  await flush();

  return {
    requests: () => requests,
    /* the page's questions to the account service, each with the token it was sent under */
    lookups: () => requests.filter((r) => (canonical ? r.method === 'GET' && /\/auth\/v1\/user$/.test(r.url) : true)),
    refreshes: () => requests.filter((r) => /grant_type=refresh_token/.test(r.url)),
    panel: () => ({ heading: element('chemTrialHeading').textContent, start: element('chemTrialStart').hidden ? null : element('chemTrialStart').textContent, account: !element('chemTrialAccount').hidden }),
    message: () => element('chemTrialMessage').textContent,
    roundOpen: () => !element('chemTrialGame').hidden && element('chem108Main').classList.contains('is-playing'),
    press: () => { element('chemTrialStart').onclick(); },
    tick: () => { for (const fn of timers) fn(); },
    setTrial: (ago) => { values.set(TRIAL_KEY, trialStarted(ago)); },
    /* this tab, through the shipped account code: storage first, then mcc:auth-changed */
    signOut: () => win.MCC.signOut(),
    signIn: async (next) => {
      const done = win.MCC.signInWithPassword('member@example.test', 'fixture-password');
      await flush(); // the account code sends its request a microtask after the call
      await requests.find((r) => !r.settled && /grant_type=password/.test(r.url)).answer(Object.assign(sessionFor(next), { user: { id: 'fixture' } }));
      await done;
    },
    /* another tab: storage changes, and this tab hears only the storage events */
    otherTab: (next) => { store(next); fire(handlers.window, 'storage', { key: SESSION_KEY }); fire(handlers.window, 'storage', { key: KEEP_KEY }); },
    otherTabClears: () => { values.clear(); fire(handlers.window, 'storage', { key: null }); },
    /* no event at all: another script, or the browser's own storage controls */
    silently: (next) => { store(next); },
    hide: () => { doc.visibilityState = 'hidden'; fire(handlers.document, 'visibilitychange'); },
    comeBack: () => { doc.visibilityState = 'visible'; fire(handlers.document, 'visibilitychange'); },
    freeze: () => { fire(handlers.window, 'pagehide', { persisted: true }); },
    restore: () => { fire(handlers.window, 'pageshow', { persisted: true }); },
    close: async () => {
      await import(GAME_MODULE); // a round still loading settles before the shim goes away
      for (let open = true; open;) { // and so does every request, including one a last step has only just caused
        await flush();
        open = false;
        for (const request of requests) if (!request.settled) { open = true; if (canonical) request.answer({ msg: 'case ended' }, 503); else request.answer(null); }
      }
      await flush();
      for (const [name, descriptor] of before) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    }
  };
}

/* one page per case, always taken down */
function page(name, options, body) {
  test(name, async () => {
    const p = await openPage(options);
    try { await body(p); } finally { await p.close(); }
  });
}
const tokens = (p) => p.lookups().map((lookup) => NAMES.get(lookup.token) || lookup.token);

/* ---------- the finding: a late or stale answer verifies nothing ---------- */

page('audit W4 reproduction: an account lookup that answers after the session is gone verifies nothing',
  { token: 'user-A-fixture', trial: EXPIRED, canonical: false, events: false }, async (p) => {
    assert.deepEqual(p.panel(), PROMPT, 'an expired trial waits for the account answer');
    p.silently(null);
    await p.lookups()[0].answer({ id: 'stale-user-A' });
    assert.deepEqual(p.panel(), PROMPT, 'the stale answer must not reopen an expired trial');
    p.tick();
    assert.deepEqual(p.panel(), PROMPT, 'and the timer must not either');
  });

page('sign-out while the account lookup is still out: the late answer is dropped',
  { token: A, trial: EXPIRED }, async (p) => {
    assert.deepEqual(tokens(p), ['A']);
    await p.signOut();
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), PROMPT, 'A signed out before the answer arrived');
    assert.equal(p.lookups().length, 1, 'a signed-out page has nobody to ask about');
    p.tick();
    assert.deepEqual(p.panel(), PROMPT, 'and the timer does not bring A back');
  });

page('signing out and back in as the same member: the answer asked before the sign-out is still late',
  { token: A, trial: EXPIRED }, async (p) => {
    const before = p.lookups()[0];
    await p.signOut();
    await p.signIn(A_REFRESHED);
    await before.answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), PROMPT, 'an answer from before the sign-out does not verify the new session');
    assert.deepEqual(tokens(p), ['A', 'A refreshed'], 'the new session gets a lookup of its own');
    await p.lookups()[1].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
  });

page('account switch in this tab: the first account\'s late answer cannot verify the second',
  { token: A, trial: EXPIRED }, async (p) => {
    const first = p.lookups()[0];
    await p.signIn(B);
    await first.answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), PROMPT, 'A\'s late answer must not verify B\'s session');
    assert.deepEqual(tokens(p), ['A', 'B'], 'B gets a lookup of its own');
    await p.lookups()[1].answer({ msg: 'invalid JWT' }, 401);
    assert.deepEqual(p.panel(), PROMPT, 'a session the server refuses stays unverified');
  });

page('account switch in another tab while verified: the page waits for the new account\'s own answer',
  { token: A, trial: EXPIRED }, async (p) => {
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
    p.otherTab(B);
    assert.deepEqual(p.panel(), PROMPT, 'A\'s verification must not carry over to B\'s session');
    await flush();
    assert.deepEqual(tokens(p), ['A', 'B']);
    await p.lookups()[1].answer({ id: 'member-b' });
    assert.deepEqual(p.panel(), WELCOME, 'B is verified by B\'s own answer');
  });

page('another account\'s session written with no event at all gets its own lookup; the old answer is not reused',
  { token: A, trial: EXPIRED }, async (p) => {
    p.silently(B);
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), PROMPT, 'an answer asked for A does not count for B');
    assert.deepEqual(tokens(p), ['A', 'B'], 'the session stored now is asked about');
    await p.lookups()[1].answer({ id: 'member-b' });
    assert.deepEqual(p.panel(), WELCOME);
  });

page('verified, then signed out in another tab: the storage event ends it',
  { token: A, trial: EXPIRED }, async (p) => {
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
    p.otherTab(null);
    assert.deepEqual(p.panel(), PROMPT, 'signed out elsewhere is signed out here');
    await flush();
    assert.equal(p.lookups().length, 1);
  });

page('verified, then storage cleared in another tab: a cleared browser is a new guest, not a member',
  { token: A, trial: EXPIRED }, async (p) => {
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
    p.otherTabClears();
    assert.deepEqual(p.panel(), FRESH, 'the account answer does not outlive the cleared session');
  });

page('verified, then the session is cleared with no event at all: the timer notices',
  { token: A, trial: EXPIRED }, async (p) => {
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
    p.silently(null);
    p.tick();
    assert.deepEqual(p.panel(), PROMPT, 'the next tick finds the session gone');
  });

page('verified, then the session disappears while the tab is hidden: the return to the tab notices',
  { token: A, trial: EXPIRED }, async (p) => {
    await p.lookups()[0].answer({ id: 'member-a' });
    p.hide();
    p.silently(null);
    assert.deepEqual(p.panel(), WELCOME, 'nothing has told the hidden page yet');
    p.comeBack();
    assert.deepEqual(p.panel(), PROMPT, 'coming back to the tab finds the session gone');
  });

page('restored from the back/forward cache after signing out elsewhere: the restored page is not verified',
  { token: A, trial: EXPIRED }, async (p) => {
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
    p.freeze();
    p.silently(null); // signed out on the page they went to; a frozen page hears no events
    p.restore();
    assert.deepEqual(p.panel(), PROMPT, 'the frozen page\'s verification does not survive the sign-out');
  });

page('restored from the back/forward cache: an answer asked before the freeze does not count, the restored page asks again',
  { token: A, trial: EXPIRED }, async (p) => {
    const before = p.lookups()[0];
    p.freeze();
    p.restore();
    await flush();
    assert.deepEqual(tokens(p), ['A', 'A'], 'a restored page asks for itself');
    await before.answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), PROMPT, 'the frozen page\'s answer is late');
    await p.lookups()[1].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
  });

page('a round only the account allowed closes at sign-out',
  { token: A, trial: EXPIRED }, async (p) => {
    await p.lookups()[0].answer({ id: 'member-a' });
    p.press();
    assert.ok(p.roundOpen());
    assert.equal(p.message(), MEMBER_ROUND);
    await p.signOut();
    assert.equal(p.roundOpen(), false, 'no account and no trial left: the round closes');
    assert.deepEqual(p.panel(), PROMPT);
  });

page('a round the trial still covers survives sign-out, stops claiming an account, and ends with the trial',
  { token: A, trial: ACTIVE }, async (p) => {
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
    p.press();
    assert.equal(p.message(), MEMBER_ROUND);
    const signedOut = p.signOut();
    assert.ok(p.roundOpen(), 'the guest preview still covers this round');
    assert.match(p.message(), GUEST_ROUND, 'but the page no longer claims an account');
    p.setTrial(EXPIRED);
    p.tick();
    assert.equal(p.roundOpen(), false, 'past day seven nothing verified is left to keep the round open');
    assert.deepEqual(p.panel(), PROMPT);
    await signedOut;
  });

page('tokens that name no account are only ever equal to themselves, and storage that keeps changing is not chased',
  { token: 'opaque-1', trial: EXPIRED }, async (p) => {
    p.silently('opaque-2');
    await p.lookups()[0].answer({ id: 'somebody' });
    assert.deepEqual(p.panel(), PROMPT, 'nothing says opaque-2 is the account that was asked about');
    assert.deepEqual(tokens(p), ['opaque-1', 'opaque-2'], 'so it gets one question of its own');
    p.silently('opaque-3');
    await p.lookups()[1].answer({ id: 'somebody' });
    assert.deepEqual(p.panel(), PROMPT);
    assert.equal(p.lookups().length, 2, 'a second silent change is not followed by a third request');
    p.hide(); p.comeBack();
    await flush();
    assert.deepEqual(tokens(p), ['opaque-1', 'opaque-2', 'opaque-3'], 'the next return to the tab asks about what is stored then');
    await p.lookups()[2].answer({ id: 'somebody' });
    assert.deepEqual(p.panel(), WELCOME);
    p.silently('opaque-4');
    p.tick();
    assert.deepEqual(p.panel(), PROMPT, 'and a verified opaque session does not carry over to another opaque token');
  });

/* ---------- what must keep working ---------- */

page('a member with an expired trial is verified by the answer for the stored session, and stays so while it is stored',
  { token: A, trial: EXPIRED }, async (p) => {
    assert.deepEqual(p.panel(), PROMPT, 'nothing is granted from the stored token alone');
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
    p.tick(); p.hide(); p.comeBack(); p.freeze(); p.restore();
    await flush();
    assert.deepEqual(p.panel(), WELCOME);
  });

page('canonical auth refreshing an expired token during the lookup: one question, and the member is verified',
  { token: A, expiresAt: 1, trial: EXPIRED }, async (p) => {
    assert.equal(p.refreshes().length, 1, 'MCC.user() refreshes the expired access token before it asks');
    await p.refreshes()[0].answer(sessionFor(A_REFRESHED));
    assert.deepEqual(tokens(p), ['A refreshed']);
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME, 'a token refresh is not a sign-out');
    await flush();
    assert.equal(p.lookups().length, 1, 'the same account\'s refreshed token needs no second question');
  });

page('a session the account code refreshes on every call (a device clock an hour fast) is still verified, without a request loop',
  { token: A, expiresAt: 1, trial: EXPIRED }, async (p) => {
    await p.refreshes()[0].answer(sessionFor(A_REFRESHED, 1)); // still "expired" by this device's clock
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
    p.tick(); p.hide(); p.comeBack();
    await flush();
    assert.deepEqual([p.refreshes().length, p.lookups().length], [1, 1], 'a verified member is not asked about again');
  });

page('the same account\'s token refreshed in another tab is not a sign-out: the round stays open',
  { token: A, trial: EXPIRED }, async (p) => {
    await p.lookups()[0].answer({ id: 'member-a' });
    p.press();
    assert.ok(p.roundOpen());
    p.otherTab(A_REFRESHED);
    p.tick();
    assert.ok(p.roundOpen(), 'a refresh elsewhere does not close the member\'s round');
    assert.equal(p.message(), MEMBER_ROUND);
    await flush();
    assert.equal(p.lookups().length, 1, 'and asks nothing new');
    await p.signOut();
    assert.equal(p.roundOpen(), false, 'sign-out still does');
    assert.deepEqual(p.panel(), PROMPT);
  });

page('network failure keeps the guest preview playable and grants nothing from the stored token',
  { token: A, trial: ACTIVE }, async (p) => {
    assert.deepEqual(p.panel(), PREVIEW);
    await p.lookups()[0].offline();
    assert.deepEqual(p.panel(), PREVIEW, 'a failed account check does not take the preview away');
    p.otherTab(B); // somebody signs in elsewhere while the service is still unreachable
    await flush();
    for (const lookup of p.lookups()) if (!lookup.settled) await lookup.offline();
    assert.deepEqual(p.panel(), PREVIEW);
    p.press();
    assert.ok(p.roundOpen());
    assert.match(p.message(), GUEST_ROUND, 'the round is the guest preview, not a verified account');
    p.setTrial(EXPIRED);
    p.tick();
    assert.equal(p.roundOpen(), false, 'a tab left open past day seven still closes the round');
    assert.deepEqual(p.panel(), PROMPT);
  });

page('a lookup that failed is asked again when the tab comes back, one request per account in flight',
  { token: A, trial: EXPIRED }, async (p) => {
    await p.lookups()[0].offline();
    assert.deepEqual(p.panel(), PROMPT);
    p.hide(); p.comeBack();
    await flush();
    p.hide(); p.comeBack();
    await flush();
    assert.equal(p.lookups().length, 2, 'the second return found the retry still out and did not stack another');
    await p.lookups()[1].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
  });

page('signing in from another tab verifies an expired guest without a reload',
  { trial: EXPIRED }, async (p) => {
    assert.deepEqual(p.panel(), PROMPT);
    assert.equal(p.lookups().length, 0);
    p.otherTab(A);
    await flush();
    assert.deepEqual(tokens(p), ['A'], 'the new session is asked about');
    await p.lookups()[0].answer({ id: 'member-a' });
    assert.deepEqual(p.panel(), WELCOME);
  });

page('a guest without a session never asks the account service',
  {}, async (p) => {
    assert.deepEqual(p.panel(), FRESH);
    p.tick(); p.hide(); p.comeBack(); p.freeze(); p.restore();
    await flush();
    assert.equal(p.requests().length, 0);
    assert.deepEqual(p.panel(), FRESH);
  });
