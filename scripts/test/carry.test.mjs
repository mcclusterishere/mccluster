/* THE CARRY (SPEC-PLATFORM 2.6 and 2.7): a sign-in moves from Matthew's host to the platform by postMessage between two
   exact origins, never in a URL, and never with the refresh token.

     node --test scripts/test/carry.test.mjs

   carry.html (the tenant's carry page, served on both hosts) and js/carry.js (the platform's side) run here as written,
   each in its own sandbox with its own origin, joined by a message bus that behaves as a browser's postMessage does: a
   message reaches a window only when the target origin is that window's own origin exactly (or "*"), and the receiver
   sees the sender's real origin and window. This holds:
   - inert in P0: the record's stage keeps the carry off; js/carry.js frames nothing and carry.html answers nothing,
     whoever asks; no page loads js/carry.js yet;
   - exact origins both ways: carry.html answers only its parent, only when the message comes from the platform's exact
     origin; js/carry.js accepts only its own frame, only from the tenant's exact origin and only for its request id;
   - one answer per request id: the first valid request is the only one ever answered;
   - the access token alone crosses: no message ever carries a refresh token, and the platform stores the session
     Supabase gives it for its own origin (POST /v1/auth/handoff, then verify), never the tenant's;
   - nothing is posted to another origin, and no postMessage names "*";
   - the device id only with the privacy agreement on both sides; the pocket, mute and theme only where unset; kept songs
     by path, re-kept on a tap; the clear line for 30 days when nothing could be carried. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT, shippedSite, stageSite, equityupriseSite } from './support/mcc-site.mjs';
import { hostLiterals, codeOf } from '../../tools/build-site-hosts.mjs';
import { publishedFilter } from '../e2e/platform-hosts.e2e.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const P0 = shippedSite();
const P1 = stageSite('P1');
const PLATFORM = P1.platform.origin;
const PROFILE = P1.profile.origin;
const plain = (v) => JSON.parse(JSON.stringify(v));
const flush = async (n = 20) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

function storage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, map: m };
}
function timers() {
  const list = [];
  return {
    list,
    setTimeout: (fn, ms) => { list.push({ fn, ms }); return list.length; },
    clearTimeout: (id) => { if (list[id - 1]) list[id - 1].fn = null; },
    fire(ms = Infinity) { for (const t of list.splice(0)) if (t.fn && t.ms <= ms) t.fn(); else if (t.fn) list.push(t); }
  };
}
function events() {
  const by = {};
  return {
    addEventListener: (t, f) => { (by[t] ||= []).push(f); },
    removeEventListener: (t, f) => { by[t] = (by[t] || []).filter((x) => x !== f); },
    dispatch: (t, e) => { for (const f of [...(by[t] || [])]) f(e); },
    count: (t) => (by[t] || []).length
  };
}

/* ---------- the tenant's carry page (carry.html), alone ---------- */

function carryPageScript() {
  const html = read('carry.html');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1, 'carry.html carries one inline script');
  return inline[0];
}

/* the frame as the platform's page frames it: its parent is a window of `parentOrigin` */
function frame({ site = P1, framed = true, session = { access_token: 'profile-access', refresh_token: 'profile-refresh', expires_at: 4102444800 },
  local = {}, cookie = '', vault = [], origin = PROFILE, parent = null } = {}) {
  const posted = [];
  const ev = events();
  const t = timers();
  parent = parent || { postMessage: (msg, target) => posted.push({ msg: JSON.parse(JSON.stringify(msg)), target }) };
  const window = Object.assign(ev, {
    MCC_SITE: site, localStorage: storage(local),
    location: { origin, hostname: new URL(origin).hostname, href: origin + '/carry.html' },
    MCC: { refreshIfNeeded: () => Promise.resolve(session) },
    caches: { open: (name) => Promise.resolve({ keys: () => Promise.resolve(name === 'mcc-vault-v1' ? vault.map((url) => ({ url })) : []) }) }
  });
  window.parent = framed ? parent : window;
  window.top = framed ? parent : window;
  const document = { cookie, createElement: () => ({}), head: { appendChild() {} } };
  vm.runInNewContext(carryPageScript(), { window, document, JSON, Promise, URL, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  const ask = (data, { from = PLATFORM, source = parent } = {}) => ev.dispatch('message', { data, origin: from, source });
  return { window, parent, posted, ask, timers: t, ev };
}
const request = (id = 'req-0123456789abcdef') => ({ type: 'mcc:carry-request', v: 1, id });

test('carry.html is inert in P0: the platform itself asks, and nothing answers', async () => {
  assert.equal(P0.switches.carry, false, 'the record keeps the carry off in P0');
  let refreshed = 0;
  const f = frame({ site: P0 });
  f.window.MCC.refreshIfNeeded = () => { refreshed += 1; return Promise.resolve(null); };
  f.ask(request());
  await flush();
  assert.deepEqual(f.posted, []);
  assert.equal(refreshed, 0, 'no session is read');
});

test('carry.html answers its parent only, only for the platform\'s exact origin', async () => {
  for (const from of ['https://evil.example', 'https://www.mccluster.org', 'http://mccluster.org', 'https://mccluster.org.evil.example',
    'https://evilmccluster.org', 'https://mccluster.org:8443', 'https://MCCLUSTER.ORG', 'null', '', PROFILE, 'https://humanuprise.com']) {
    const f = frame();
    f.ask(request(), { from });
    await flush();
    assert.deepEqual(f.posted, [], `a request from ${JSON.stringify(from)} is not answered`);
  }
  const other = frame();
  other.ask(request(), { source: { postMessage() {} } });
  await flush();
  assert.deepEqual(other.posted, [], 'a window that is not the parent is not answered, even from the platform\'s origin');
  const top = frame({ framed: false });
  top.ask(request(), { source: top.window });
  await flush();
  assert.deepEqual(top.posted, [], 'opened on its own, the page answers nothing');
});

test('carry.html answers one request, once, to the platform\'s exact origin, with the access token alone', async () => {
  const f = frame();
  f.ask(request('first-request-abcdef012345'));
  f.ask(request('first-request-abcdef012345'));
  f.ask(request('second-request-abcdef01234'));
  await flush();
  assert.equal(f.posted.length, 1, 'the first request is the only one answered');
  const [{ msg, target }] = f.posted;
  assert.equal(target, PLATFORM, 'posted to the platform\'s exact origin');
  assert.notEqual(target, '*');
  assert.equal(msg.type, 'mcc:carry-answer');
  assert.equal(msg.v, 1);
  assert.equal(msg.id, 'first-request-abcdef012345');
  assert.equal(msg.access_token, 'profile-access');
  const text = JSON.stringify(f.posted);
  assert.ok(!/refresh/i.test(text), 'no refresh token, by name or value');
  assert.ok(!text.includes('profile-refresh'));
  for (const bad of [{ type: 'mcc:carry-request', v: 2, id: 'req-0123456789abcdef' }, { type: 'other', v: 1, id: 'req-0123456789abcdef' },
    { type: 'mcc:carry-request', v: 1, id: 'short' }, { type: 'mcc:carry-request', v: 1, id: '<script>alert(1)</script>xxxx' }, null, 'mcc:carry-request']) {
    const g = frame();
    g.ask(bad);
    await flush();
    assert.deepEqual(g.posted, [], `malformed request ${JSON.stringify(bad)} is ignored`);
  }
  const out = frame({ session: null });
  out.ask(request());
  await flush();
  assert.equal(out.posted[0].msg.access_token, null, 'signed out here: no token, still one answer');
  const failing = frame();
  failing.window.MCC.refreshIfNeeded = () => Promise.reject(new Error('offline'));
  failing.ask(request());
  await flush();
  assert.equal(failing.posted[0].msg.access_token, null, 'a refresh that fails carries nothing');
});

test('carry.html carries the device id only with the privacy agreement, and kept songs by path on its own origin', async () => {
  const local = { mcc_device: 'device-123', 'mcc-pocket': '{"t":83}', mcc_music_mute: '1', mcc_theme: 'dark' };
  const vault = [`${PROFILE}/assets/audio/here.mp3`, `${PROFILE}/assets/audio/dealer-plates-b.m4a?v=2`, 'https://cdn.example/elsewhere.mp3'];
  const without = frame({ local, vault });
  without.ask(request());
  await flush();
  const c = without.posted[0].msg.carry;
  assert.equal(c.device, null, 'no agreement: the device id stays here');
  assert.equal(c.pocket, '{"t":83}');
  assert.equal(c.mute, '1');
  assert.equal(c.theme, 'dark');
  assert.deepEqual(c.kept, ['/assets/audio/here.mp3', '/assets/audio/dealer-plates-b.m4a?v=2'], 'only this origin\'s kept songs, by path');
  const agreed = frame({ local, vault, cookie: 'x=1; mcc_privacy_ack=2026-10-19' });
  agreed.ask(request());
  await flush();
  assert.equal(agreed.posted[0].msg.carry.device, 'device-123');
  /* agreed means agreed to the current notice, by the site's own rule (js/live-content.js cookieHas): any other value
     of the shared cookie (an old notice, another app's, empty, a near miss) carries no device id */
  for (const cookie of ['mcc_privacy_ack=1999-01-01', 'mcc_privacy_ack=declined-by-other-app', 'mcc_privacy_ack=', 'mcc_privacy_ack=2026-10-19x',
    'mcc_privacy_ack=x2026-10-19', 'xmcc_privacy_ack=2026-10-19', 'mcc_privacy_seen=2026-10-19', 'a=1; mcc_privacy_ack=2026-10-18']) {
    const stale = frame({ local, vault, cookie });
    stale.ask(request());
    await flush();
    assert.equal(stale.posted[0].msg.carry.device, null, `cookie ${JSON.stringify(cookie)} is not the current agreement: the device id stays here`);
    assert.equal(stale.posted[0].msg.carry.pocket, '{"t":83}', 'the rest of the carry is unaffected');
  }
  for (const cookie of ['mcc_privacy_ack=2026-10-19', 'a=1;mcc_privacy_ack=2026-10-19; b=2', ' mcc_privacy_ack=2026-10-19 ']) {
    const current = frame({ local, vault, cookie });
    current.ask(request());
    await flush();
    assert.equal(current.posted[0].msg.carry.device, 'device-123', `cookie ${JSON.stringify(cookie)} is the current agreement`);
  }
  /* the notice's version is the one the notice itself carries */
  const notice = read('js/live-content.js').match(/var VERSION = "([^"]+)";/)[1];
  assert.equal(carryPageScript().match(/var PRIVACY_VERSION = "([^"]+)";/)[1], notice, 'carry.html checks the notice version js/live-content.js owns');
});

/* ---------- the platform's side (js/carry.js), alone and with the frame ---------- */

function platformPage({ site = P1, origin = PLATFORM, local = {}, framed = false, accepted = true, answerWith = null, fetchImpl = null, cachesImpl = null } = {}) {
  const ev = events();
  const t = timers();
  const frames = [], posts = [], fetches = [], dispatched = [];
  const window = Object.assign(ev, {
    MCC_SITE: site, localStorage: storage(local), sessionStorage: storage(),
    location: { origin, hostname: new URL(origin).hostname, href: origin + '/listen.html' },
    MCC_PRIVACY: { accepted: () => accepted },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i += 1) a[i] = (i * 37 + 11) % 256; return a; } },
    caches: cachesImpl
  });
  window.top = framed ? {} : window;
  window.dispatchEvent = (e) => { dispatched.push({ type: e.type, detail: e.detail }); return true; };
  const document = {
    readyState: 'complete', documentElement: { appendChild: (n) => n },
    body: {
      appendChild(node) {
        frames.push(node);
        node.contentWindow = { postMessage: (msg, target) => posts.push({ msg: JSON.parse(JSON.stringify(msg)), target, to: node }) };
        if (answerWith) answerWith(node, { window, ev, posts });
        return node;
      }
    },
    createElement: (tag) => {
      const attrs = {}, on = events();
      return { tagName: tag.toUpperCase(), attrs, style: {}, setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null),
        addEventListener: on.addEventListener, fireLoad: () => on.dispatch('load', {}), removed: false, remove() { this.removed = true; } };
    }
  };
  const fetch = (url, init = {}) => { fetches.push({ url: String(url), init }); return (fetchImpl || (() => Promise.reject(new Error('no network'))))(String(url), init); };
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  vm.runInNewContext(read('js/carry.js'), { window, document, fetch, CustomEvent, JSON, Promise, URL, Date, Math, Error, Uint8Array, String, Number, Object, Array,
    setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  return { window, frames, posts, fetches, dispatched, timers: t, carry: window.MCC_CARRY, ev };
}
/* Supabase's answers for the platform's own session */
const exchange = (calls = []) => (url, init) => {
  calls.push({ url, init });
  if (url === 'https://api.mccluster.org/v1/auth/handoff') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ token_hash: 'one-time-hash' }) });
  }
  if (/\/auth\/v1\/verify$/.test(url)) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'platform-access', refresh_token: 'platform-refresh', expires_in: 3600, expires_at: 4102444800 }) });
  }
  return Promise.reject(new Error(`unexpected ${url}`));
};
const answerFrom = (node, posts, ev, { origin = PROFILE, source = node.contentWindow, id = null, access_token = 'profile-access', carry = {} } = {}) => {
  const req = posts.find((p) => p.to === node);
  ev.dispatch('message', { origin, source, data: { type: 'mcc:carry-answer', v: 1, id: id || req.msg.id, access_token, carry: { device: null, pocket: null, mute: null, theme: null, kept: [], ...carry } } });
};

test('js/carry.js is inert in P0 and loaded by no page', async () => {
  const p = platformPage({ site: P0 });
  assert.deepEqual(plain(await p.carry.started), { result: 'off' });
  assert.deepEqual(p.frames, [], 'no frame');
  assert.deepEqual(p.posts, [], 'nothing posted');
  assert.equal(p.window.localStorage.getItem('mcc_carry_v1'), null, 'no mark');
  const published = publishedFilter(ROOT);
  const loaders = [];
  (function walk(dir) {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (!published(rel)) continue;
      if (e.isDirectory()) walk(rel);
      else if (/\.(html|m?js)$/.test(e.name) && rel !== 'js/carry.js' && /js\/carry\.js/.test(codeOf(read(rel), rel))) loaders.push(rel);
    }
  })('');
  assert.deepEqual(loaders, [], 'no published page or script loads js/carry.js in P0');
  assert.deepEqual(hostLiterals(read('js/carry.js'), 'js/carry.js'), [], 'js/carry.js names no site host');
  assert.deepEqual(hostLiterals(read('carry.html'), 'carry.html'), [], 'carry.html names no site host');
});

test('js/carry.js stays out of the way: not the platform, framed, signed in, or asked before', async () => {
  assert.equal((await platformPage({ origin: PROFILE }).carry.started).result, 'not_platform');
  assert.equal((await platformPage({ framed: true }).carry.started).result, 'framed');
  const signedIn = { mccdb_session: JSON.stringify({ access_token: 'here', refresh_token: 'r', expires_at: 4102444800 }) };
  assert.equal((await platformPage({ local: signedIn }).carry.started).result, 'signed_in');
  const marked = { mcc_carry_v1: JSON.stringify({ v: 1, result: 'none', at: new Date().toISOString() }) };
  const again = platformPage({ local: marked });
  assert.equal((await again.carry.started).result, 'done_before');
  assert.deepEqual(again.frames, []);
});

test('js/carry.js asks the tenant\'s carry page once, at its exact origin, and accepts only its frame\'s answer to its own id', async () => {
  const calls = [];
  const p = platformPage({ fetchImpl: exchange(calls) });
  assert.equal(p.frames.length, 1, 'one hidden frame');
  const node = p.frames[0];
  assert.equal(node.attrs.src, `${PROFILE}/carry.html`, 'the tenant\'s carry page from the table');
  assert.equal(node.attrs.sandbox, 'allow-scripts allow-same-origin');
  assert.equal(node.attrs['aria-hidden'], 'true');
  node.fireLoad();
  assert.equal(p.posts.length, 1, 'one request');
  assert.equal(p.posts[0].target, PROFILE, 'posted to the tenant\'s exact origin');
  assert.equal(p.posts[0].msg.type, 'mcc:carry-request');
  assert.match(p.posts[0].msg.id, /^[A-Za-z0-9_-]{16,64}$/);
  /* answers that are not its frame's, to its request, are ignored */
  answerFrom(node, p.posts, p.ev, { origin: 'https://evil.example' });
  answerFrom(node, p.posts, p.ev, { origin: PLATFORM });
  answerFrom(node, p.posts, p.ev, { source: {} });
  answerFrom(node, p.posts, p.ev, { id: 'another-request-0123456789' });
  await flush();
  assert.deepEqual(calls, [], 'nothing exchanged for a stray answer');
  answerFrom(node, p.posts, p.ev);
  answerFrom(node, p.posts, p.ev, { access_token: 'second-answer' });
  const result = await p.carry.started;
  assert.equal(result.result, 'carried');
  assert.equal(calls.length, 2, 'one exchange: the hand-off, then the verify');
  assert.equal(calls[0].url, 'https://api.mccluster.org/v1/auth/handoff');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer profile-access', 'the access token as a bearer header, never in a URL');
  assert.ok(!calls.some((c) => c.url.includes('profile-access')), 'no token in any URL');
  assert.deepEqual(JSON.parse(calls[1].init.body), { type: 'magiclink', token_hash: 'one-time-hash' });
  const stored = JSON.parse(p.window.localStorage.getItem('mccdb_session'));
  assert.equal(stored.access_token, 'platform-access', 'the platform\'s own session');
  assert.equal(stored.refresh_token, 'platform-refresh', 'with the refresh token Supabase gave this origin');
  assert.equal(p.window.localStorage.getItem('mcc_sess_keep'), p.window.localStorage.getItem('mccdb_session'), 'both slots, written together');
  assert.equal(JSON.parse(p.window.localStorage.getItem('mcc_carry_v1')).result, 'carried', 'the mark records the result');
  assert.ok(node.removed, 'the frame goes');
  assert.ok(p.dispatched.some((e) => e.type === 'mcc:auth-changed' && e.detail.signed_in === true && e.detail.carried === true));
  for (const post of p.posts) assert.equal(post.target, PROFILE, 'every post names the tenant\'s exact origin');
});

test('js/carry.js: nothing to carry, a silent frame, or a refused token leave a mark and the clear line, for 30 days', async () => {
  const none = platformPage();
  none.frames[0].fireLoad();
  answerFrom(none.frames[0], none.posts, none.ev, { access_token: null });
  assert.equal((await none.carry.started).result, 'none');
  assert.equal(none.carry.line(), `McCluster now lives at ${P1.platform.host}. If you were signed in before, you still are; if not, sign in once here.`);
  const silent = platformPage();
  silent.frames[0].fireLoad();
  silent.timers.fire(4000);
  assert.equal((await silent.carry.started).result, 'timeout');
  assert.ok(silent.frames[0].removed);
  assert.notEqual(silent.carry.line(), '');
  const refused = platformPage({ fetchImpl: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }) });
  refused.frames[0].fireLoad();
  answerFrom(refused.frames[0], refused.posts, refused.ev);
  assert.equal((await refused.carry.started).result, 'refused');
  assert.equal(refused.window.localStorage.getItem('mccdb_session'), null, 'no session written');
  const old = platformPage({ local: { mcc_carry_v1: JSON.stringify({ v: 1, result: 'none', at: new Date(Date.now() - 31 * 864e5).toISOString() }) } });
  assert.equal(old.carry.line(), '', 'after 30 days the line is gone');
  const carried = platformPage({ local: { mcc_carry_v1: JSON.stringify({ v: 1, result: 'carried', at: new Date().toISOString() }) } });
  assert.equal(carried.carry.line(), '', 'nothing to say once carried');
  const f = equityupriseSite('P1');
  assert.equal(f.switches.carry, true);
});

test('js/carry.js adopts the device id only with the platform\'s own agreement, and pocket, mute and theme only where unset', async () => {
  const carry = { device: 'device-123', pocket: '{"t":83}', mute: '1', theme: 'dark', kept: ['/assets/audio/here.mp3'] };
  const agreed = platformPage({ fetchImpl: exchange() });
  agreed.frames[0].fireLoad();
  answerFrom(agreed.frames[0], agreed.posts, agreed.ev, { carry });
  await agreed.carry.started;
  const L = agreed.window.localStorage;
  assert.equal(L.getItem('mcc_device'), 'device-123');
  assert.equal(L.getItem('mcc-pocket'), '{"t":83}');
  assert.equal(L.getItem('mcc_music_mute'), '1');
  assert.equal(L.getItem('mcc_theme'), 'dark');
  assert.equal(agreed.carry.keptLine(), 'You kept 1 song at the old address. Keep it here too?');
  const own = { mcc_device: 'mine', 'mcc-pocket': '{"t":5}', mcc_music_mute: '0', mcc_theme: 'light' };
  const kept = platformPage({ local: own, accepted: true, fetchImpl: exchange() });
  kept.frames[0].fireLoad();
  answerFrom(kept.frames[0], kept.posts, kept.ev, { carry });
  await kept.carry.started;
  for (const [k, v] of Object.entries(own)) assert.equal(kept.window.localStorage.getItem(k), v, `${k} already set here stays`);
  const unagreed = platformPage({ accepted: false, fetchImpl: exchange() });
  unagreed.frames[0].fireLoad();
  answerFrom(unagreed.frames[0], unagreed.posts, unagreed.ev, { carry });
  await unagreed.carry.started;
  assert.equal(unagreed.window.localStorage.getItem('mcc_device'), null, 'no agreement on the platform: no device id');
});

test('js/carry.js re-keeps the songs kept at the old address on a tap, from this origin, by the same paths', async () => {
  const put = [];
  const cachesImpl = { open: (name) => Promise.resolve({ put: (url, res) => { put.push({ name, url, body: res.body }); return Promise.resolve(); }, match: () => Promise.resolve(undefined) }) };
  const fetched = [];
  const p = platformPage({ cachesImpl, fetchImpl: (url, init) => {
    if (url.startsWith(PLATFORM + '/assets/')) { fetched.push(url); return Promise.resolve({ ok: true, body: 'audio:' + url }); }
    return exchange()(url, init);
  } });
  p.frames[0].fireLoad();
  answerFrom(p.frames[0], p.posts, p.ev, { carry: { kept: ['/assets/audio/here.mp3', '/assets/audio/far.m4a', 'https://evil.example/x.mp3', '//evil.example/y.mp3', '/../etc/passwd'] } });
  await p.carry.started;
  assert.equal(p.carry.keptLine(), 'You kept 2 songs at the old address. Keep them here too?', 'only this site\'s own paths are offered');
  const out = await p.carry.keepHere();
  assert.deepEqual(plain(out), { kept: 2, missed: 0 });
  assert.deepEqual(fetched, [`${PLATFORM}/assets/audio/here.mp3`, `${PLATFORM}/assets/audio/far.m4a`], 'fetched from this origin');
  assert.deepEqual(put.map((x) => [x.name, x.url]), [['mcc-vault-v1', `${PLATFORM}/assets/audio/here.mp3`], ['mcc-vault-v1', `${PLATFORM}/assets/audio/far.m4a`]]);
  assert.equal(p.carry.keptLine(), '', 'asked once');
});

test('the two sides together: a member signed in on Matthew\'s host arrives signed in on the platform, and nothing else moves', async () => {
  const calls = [], wire = [];
  const p = platformPage({ fetchImpl: exchange(calls), answerWith: (node, { ev: platformEvents }) => {
    /* the frame's parent is the platform's window; the platform reaches the frame through node.contentWindow; each side
       sees the other's real origin and window, and a message for any other origin is dropped, as in a browser */
    const parent = { postMessage: (msg, target) => {
      wire.push({ from: PROFILE, target, msg: JSON.parse(JSON.stringify(msg)) });
      if (target === PLATFORM || target === '*') platformEvents.dispatch('message', { origin: PROFILE, source: node.contentWindow, data: JSON.parse(JSON.stringify(msg)) });
    } };
    const f = frame({ parent, cookie: 'mcc_privacy_ack=2026-10-19', local: { mcc_device: 'device-123' } });
    node.contentWindow = { postMessage: (msg, target) => {
      wire.push({ from: PLATFORM, target, msg: JSON.parse(JSON.stringify(msg)) });
      if (target === PROFILE || target === '*') f.ev.dispatch('message', { origin: PLATFORM, source: parent, data: JSON.parse(JSON.stringify(msg)) });
    } };
  } });
  p.frames[0].fireLoad();
  const result = await p.carry.started;
  assert.equal(result.result, 'carried');
  assert.deepEqual(wire.map((w) => [w.from, w.target, w.msg.type]), [[PLATFORM, PROFILE, 'mcc:carry-request'], [PROFILE, PLATFORM, 'mcc:carry-answer']], 'one request, one answer, each to the other\'s exact origin');
  assert.ok(!JSON.stringify(wire).includes('refresh'), 'no refresh token on the wire');
  assert.equal(JSON.parse(p.window.localStorage.getItem('mccdb_session')).access_token, 'platform-access', 'the platform\'s own session');
  assert.equal(p.window.localStorage.getItem('mcc_device'), 'device-123', 'one listener stays one device once both sides agreed');
  assert.equal(calls.length, 2);
});
