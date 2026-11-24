/* THE CARRY (SPEC-PLATFORM 2.6 and 2.7): a sign-in moves from Matthew's host to the platform by postMessage between two
   exact origins, never in a URL, and never with the refresh token.

     node --test scripts/test/carry.test.mjs

   carry.html (the tenant's carry page, served on both hosts) and js/carry.js (the platform's side) run here as written,
   each in its own sandbox with its own origin, joined by a message bus that behaves as a browser's postMessage does: a
   message reaches a window only when the target origin is that window's own origin exactly (or "*"), and the receiver
   sees the sender's real origin and window. This holds:
   - inert with P0's table: the carry is off; js/carry.js frames nothing and carry.html answers nothing, whoever asks;
     from P1 (the table that ships) js/tabbar.js loads js/carry.js, on a platform page with no usable session, and no
     other page or script does;
   - exact origins both ways: carry.html answers only its parent, only when the message comes from the platform's exact
     origin; js/carry.js accepts only its own frame, only from the tenant's exact origin and only for its request id;
   - one answer per request id: the first valid request is the only one ever answered;
   - the access token alone crosses: no message ever carries a refresh token, and the platform stores the session
     Supabase gives it for its own origin (POST /v1/auth/handoff, then verify), never the tenant's;
   - nothing is posted to another origin, and no postMessage names "*";
   - the device id only with the privacy agreement on both sides; the pocket, mute and theme only where unset; kept songs
     by path, counted as songs (not every file the album kept beside them), offered once on a top-level platform page in
     the bar's own peek card and re-kept on a tap (review VP1-1); the clear line for 30 days when nothing could be
     carried, said on the sign-in page and on the account chip, where a phone sees it under the chip until it is closed
     (review VP1-2);
   - a frame whose parent is the platform's own origin asks nothing (its parent does); the World framed over Music on
     Matthew's host, whose parent is another origin, asks for itself. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT, shippedSite, stageSite, equityupriseSite } from './support/mcc-site.mjs';
import { hostLiterals, codeOf } from '../../tools/build-site-hosts.mjs';
import { publishedFilter } from '../e2e/platform-hosts.e2e.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const P0 = stageSite('P0');
const P1 = stageSite('P1');
const SHIPPED = shippedSite();
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

/* framed: false (a top page), true (a frame whose parent is this same origin) or 'other' (a frame whose parent is another
   origin, whose location throws as a browser's does); nodes: elements the page holds, by id */
function platformPage({ site = P1, origin = PLATFORM, local = {}, framed = false, accepted = true, answerWith = null, fetchImpl = null, cachesImpl = null, nodes = {}, win = {} } = {}) {
  const ev = events();
  const t = timers();
  const frames = [], posts = [], fetches = [], dispatched = [], body = [];
  const window = Object.assign(ev, {
    MCC_SITE: site, localStorage: storage(local), sessionStorage: storage(),
    location: { origin, hostname: new URL(origin).hostname, href: origin + '/listen.html' },
    MCC_PRIVACY: { accepted: () => accepted },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i += 1) a[i] = (i * 37 + 11) % 256; return a; } },
    caches: cachesImpl
  });
  window.top = framed ? {} : window;
  window.parent = framed === 'other' ? { get location() { throw new Error('SecurityError: cross-origin'); } } : framed ? { location: { origin } } : window;
  window.dispatchEvent = (e) => { dispatched.push({ type: e.type, detail: e.detail }); return true; };
  Object.assign(window, win);
  /* the body holds the frame the carry asks (an iframe: it answers through answerWith) and, since the review round of
     2026-11-24, what the carry draws on the page (the offer of kept songs, review VP1-1); getElementById finds both the
     page's own nodes and what was drawn */
  const bodyNode = {
    children: body,
    appendChild(node) {
      if (node.tagName !== 'IFRAME') { node.parentNode = bodyNode; body.push(node); return node; }
      frames.push(node);
      node.contentWindow = { postMessage: (msg, target) => posts.push({ msg: JSON.parse(JSON.stringify(msg)), target, to: node }) };
      if (answerWith) answerWith(node, { window, ev, posts });
      return node;
    }
  };
  const document = {
    readyState: 'complete', documentElement: { appendChild: (n) => n },
    getElementById: (id) => {
      const find = (n) => (n && n.id === id && !n.removed ? n : ((n && n.children) || []).map(find).find(Boolean));
      return nodes[id] || Object.values(nodes).map(find).find(Boolean) || body.map(find).find(Boolean) || null;
    },
    body: bodyNode,
    createElement: (tag) => {
      const attrs = {}, on = events();
      return { tagName: tag.toUpperCase(), attrs, style: {}, children: [], parentNode: null, hidden: false, textContent: '', className: '', id: '',
        setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null), removeAttribute(k) { delete attrs[k]; },
        appendChild(n) { n.parentNode = this; this.children.push(n); return n; },
        addEventListener: on.addEventListener, fire: (type, e = {}) => on.dispatch(type, e), fireLoad: () => on.dispatch('load', {}),
        focus() { this.focused = true; }, removed: false,
        remove() { this.removed = true; const up = this.parentNode; if (up && up.children) { const i = up.children.indexOf(this); if (i !== -1) up.children.splice(i, 1); } } };
    }
  };
  const fetch = (url, init = {}) => { fetches.push({ url: String(url), init }); return (fetchImpl || (() => Promise.reject(new Error('no network'))))(String(url), init); };
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  vm.runInNewContext(read('js/carry.js'), { window, document, fetch, CustomEvent, JSON, Promise, URL, Date, Math, Error, Uint8Array, String, Number, Object, Array,
    setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  return { window, frames, posts, fetches, dispatched, body, timers: t, carry: window.MCC_CARRY, ev };
}
/* the first node under `node` (itself included) that `pred` accepts */
/* a Cache Storage with nothing in it, that keeps what it is given */
const emptyVault = () => ({ open: () => Promise.resolve({ match: () => Promise.resolve(undefined), put: () => Promise.resolve() }) });
function findNode(node, pred) {
  if (!node) return null;
  if (pred(node)) return node;
  for (const c of node.children || []) { const hit = findNode(c, pred); if (hit) return hit; }
  return null;
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

test('js/carry.js is inert with P0\'s table, and from P1 the bar alone loads it', async () => {
  assert.equal(SHIPPED.stage, 'P1');
  assert.equal(SHIPPED.switches.carry, true, 'the table that ships has the carry on');
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
  assert.deepEqual(loaders, ['js/tabbar.js'], 'one script loads js/carry.js: the bar');
  const bar = read('js/tabbar.js');
  /* changed on purpose (review VP1-1): the bar also loads js/carry.js where an offer of kept songs is waiting, a member
     the carry already signed in among them (keptWaiting(); scripts/test/site-hosts-engine.test.mjs runs both) */
  assert.match(bar, /function startCarry\(\) \{\n    if \(!carryWanted\(\) && !keptWaiting\(\)\) return;/, 'and only where carryWanted() or keptWaiting() says (scripts/test/site-hosts-engine.test.mjs)');
  assert.deepEqual(hostLiterals(read('js/carry.js'), 'js/carry.js'), [], 'js/carry.js names no site host');
  assert.deepEqual(hostLiterals(read('carry.html'), 'carry.html'), [], 'carry.html names no site host');
});

test('js/carry.js stays out of the way: not the platform, framed, signed in, or asked before', async () => {
  assert.equal((await platformPage({ origin: PROFILE }).carry.started).result, 'not_platform');
  assert.equal((await platformPage({ framed: true }).carry.started).result, 'framed', 'the globe inside the World: the World asks');
  const overMusic = platformPage({ framed: 'other' });
  assert.equal(overMusic.frames.length, 1, 'the World framed over Music on Matthew\'s host asks for itself');
  assert.equal(overMusic.frames[0].attrs.src, `${PROFILE}/carry.html`);
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

/* an element of the page, as much of one as the line needs */
function fakeNode(id) {
  return { id, children: [], attrs: {}, parentNode: null,
    get firstChild() { return this.children[0] || null; },
    insertBefore(n, ref) { n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i === -1) this.children.push(n); else this.children.splice(i, 0, n); return n; },
    appendChild(n) { n.parentNode = this; this.children.push(n); return n; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; } };
}

test('js/carry.js says the clear line on the sign-in page and on the account chip, and says it no more once signed in', async () => {
  const pane = fakeNode('acSignInPane');
  pane.appendChild(fakeNode('acInEmail'));
  const nav = fakeNode('mccAuthNav');
  const chip = nav.appendChild(fakeNode('mccAuthChip'));
  const page = platformPage({ nodes: { acSignInPane: pane, mccAuthNav: nav } });
  page.frames[0].fireLoad();
  answerFrom(page.frames[0], page.posts, page.ev, { access_token: null });
  assert.equal((await page.carry.started).result, 'none');
  await flush();
  const text = page.carry.line();
  assert.ok(text.startsWith(`McCluster now lives at ${P1.platform.host}.`));
  const shown = pane.children[0];
  assert.equal(shown.id, 'mccCarryLine', 'first in the sign-in pane');
  assert.equal(shown.textContent, text);
  assert.equal(shown.className, 'ac__sub', 'in the page\'s own text style: nothing restyled');
  assert.equal(chip.getAttribute('title'), text, 'the chip says it');
  /* CHANGED ON PURPOSE (review VP1-2): the description was a hidden span beside the chip, so a phone, which never shows
     a title, saw the line nowhere but the sign-in page. The chip is described by the line itself (the note's text, not
     its close); on the sign-in page, which says it in its pane, the note under the chip stays hidden (said once on a
     screen), and elsewhere it shows (the next test) */
  const note = nav.children.find((n) => n.id === 'mccCarryNote');
  const said = findNode(note, (n) => n.id === chip.getAttribute('aria-describedby'));
  assert.ok(said && said.textContent === text, 'the chip describes itself with the line to a screen reader');
  assert.equal(note.hidden, true, 'on the sign-in page the pane says it: the note under the chip waits hidden');
  page.carry.paint();
  assert.equal(pane.children.filter((n) => n.id === 'mccCarryLine').length, 1, 'said once, however often the bar repaints');
  assert.equal(nav.children.filter((n) => n.id === 'mccCarryNote').length, 1, 'one note, however often the bar repaints');
  page.window.localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'here', refresh_token: 'r', expires_at: 4102444800 }));
  page.carry.paint();
  assert.equal(chip.getAttribute('title'), null, 'signed in: the chip says nothing more');
  assert.equal(chip.getAttribute('aria-describedby'), null);
  assert.ok(shown.removed && note.removed, 'and the sign-in page neither');
});

test('js/carry.js shows the clear line under the account chip where the page has no sign-in pane: a phone sees it, and its close keeps it closed (SPEC-PLATFORM 2.6.5, review VP1-2)', async () => {
  const nav = fakeNode('mccAuthNav');
  const chip = nav.appendChild(fakeNode('mccAuthChip'));
  const page = platformPage({ nodes: { mccAuthNav: nav } });
  page.frames[0].fireLoad();
  answerFrom(page.frames[0], page.posts, page.ev, { access_token: null });
  assert.equal((await page.carry.started).result, 'none');
  await flush();
  const text = page.carry.line();
  const note = nav.children.find((n) => n.id === 'mccCarryNote');
  assert.ok(note, 'a note beside the chip, inside the chip\'s own Account landmark');
  assert.equal(note.hidden, false, 'shown: a title is never seen on a touch screen');
  assert.equal(note.className, 'mcc-carry-note');
  const said = findNode(note, (n) => n.id === 'mccCarryNoteText');
  assert.equal(said && said.textContent, text, 'the one line, word for word');
  assert.equal(chip.getAttribute('aria-describedby'), 'mccCarryNoteText', 'the chip is described by the line, not by its close');
  assert.equal(chip.getAttribute('title'), text);
  const close = findNode(note, (n) => n.tagName === 'BUTTON');
  assert.ok(close && close.getAttribute('type') === 'button' && /close/i.test(close.getAttribute('aria-label') || ''), 'a button that says what it does');
  close.fire('click', {});
  assert.equal(note.hidden, true, 'closed');
  assert.ok(page.window.localStorage.getItem('mcc_carry_note_closed_v1'), 'and remembered on this device');
  page.carry.paint();
  assert.equal(note.hidden, true, 'a repaint keeps it closed');
  assert.equal(chip.getAttribute('title'), text, 'the chip still carries the line, as its title and description, for the rest of the 30 days');
  /* a later page, the close remembered: the note waits hidden, the chip still says it */
  const nav2 = fakeNode('mccAuthNav');
  const chip2 = nav2.appendChild(fakeNode('mccAuthChip'));
  const mark = JSON.stringify({ v: 1, result: 'none', at: new Date().toISOString() });
  const later = platformPage({ local: { mcc_carry_v1: mark, mcc_carry_note_closed_v1: new Date().toISOString() }, nodes: { mccAuthNav: nav2 } });
  assert.equal((await later.carry.started).result, 'done_before');
  await flush();
  assert.equal(nav2.children.find((n) => n.id === 'mccCarryNote').hidden, true, 'closed before: not shown again');
  assert.equal(chip2.getAttribute('title'), text);
  /* where the chip itself is not shown (the World hides it for its own sign-in), neither is the note */
  const nav3 = fakeNode('mccAuthNav');
  const chip3 = nav3.appendChild(fakeNode('mccAuthChip'));
  chip3.getClientRects = () => [];
  const world = platformPage({ local: { mcc_carry_v1: mark }, nodes: { mccAuthNav: nav3 } });
  await world.carry.started;
  await flush();
  assert.equal(nav3.children.find((n) => n.id === 'mccCarryNote').hidden, true, 'no note without its chip');
  /* on the World (its root and mnet.html) the door is its sign-in: the note waits for another page, the chip keeps the
     line as its title */
  for (const path of ['/', '/mnet.html']) {
    const navW = fakeNode('mccAuthNav');
    const chipW = navW.appendChild(fakeNode('mccAuthChip'));
    const onWorld = platformPage({ local: { mcc_carry_v1: mark }, nodes: { mccAuthNav: navW },
      win: { location: { origin: PLATFORM, hostname: new URL(PLATFORM).hostname, href: PLATFORM + path, pathname: path } } });
    await onWorld.carry.started;
    await flush();
    assert.equal(navW.children.find((n) => n.id === 'mccCarryNote').hidden, true, `${path}: no note on the World`);
    assert.equal(chipW.getAttribute('title'), text, `${path}: the chip still carries the line`);
  }
  /* nothing is said once signed in, and after 30 days */
  const old = platformPage({ local: { mcc_carry_v1: JSON.stringify({ v: 1, result: 'none', at: new Date(Date.now() - 31 * 864e5).toISOString() }) }, nodes: { mccAuthNav: (() => { const n = fakeNode('mccAuthNav'); n.appendChild(fakeNode('mccAuthChip')); return n; })() } });
  await old.carry.started;
  await flush();
  assert.equal(old.carry.line(), '');
});

test('js/carry.js adopts the device id only with the platform\'s own agreement, and pocket, mute and theme only where unset', async () => {
  const carry = { device: 'device-123', pocket: '{"t":83}', mute: '1', theme: 'dark', kept: ['/assets/audio/here.mp3'] };
  /* the platform page has a Cache Storage, as every https page does: since review VP1-1 a browser without one is offered
     nothing and keeps nothing waiting (js/carry.js offer()), so the page this test reads the kept line on has one
     (setup changed on purpose; every assertion is as it was) */
  const agreed = platformPage({ fetchImpl: exchange(), cachesImpl: emptyVault() });
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
  /* extended on purpose (review VP1-1): the result also counts the songs among the files kept, for the offer's line
     that says what happened */
  assert.deepEqual(plain(out), { kept: 2, missed: 0, songs: 2 });
  assert.deepEqual(fetched, [`${PLATFORM}/assets/audio/here.mp3`, `${PLATFORM}/assets/audio/far.m4a`], 'fetched from this origin');
  assert.deepEqual(put.map((x) => [x.name, x.url]), [['mcc-vault-v1', `${PLATFORM}/assets/audio/here.mp3`], ['mcc-vault-v1', `${PLATFORM}/assets/audio/far.m4a`]]);
  assert.equal(p.carry.keptLine(), '', 'asked once');
});

test('js/carry.js counts the songs kept at the old address, not every file the album kept beside them (SPEC-PLATFORM 2.7, review VP1-1)', async () => {
  /* the album's vault (js/label.js, "Keep the masters") holds each song's audio and, beside it, its lyrics, poster and
     cover; carry.html hands over every kept path. "You kept 12 songs" counts the songs */
  const p = platformPage({ fetchImpl: exchange(), cachesImpl: emptyVault() });
  p.frames[0].fireLoad();
  answerFrom(p.frames[0], p.posts, p.ev, { carry: { kept: ['/assets/audio/iot.mp3', '/assets/audio/got-wifi.mp3', '/assets/audio/dealer-plates-b.m4a?v=2',
    '/data/lyrics/iot.json', '/assets/frames/prim3_0001.jpg', '/assets/img/albums/prim3.webp'] } });
  await p.carry.started;
  assert.equal(p.carry.keptLine(), 'You kept 3 songs at the old address. Keep them here too?', 'three songs; their lyrics, poster and cover ride along uncounted');
});

test('js/carry.js offers the kept songs once on a top-level platform page, in the bar\'s own card; a tap keeps them here, Not now lets them be (SPEC-PLATFORM 2.7, review VP1-1)', async () => {
  const usable = { mccdb_session: JSON.stringify({ access_token: 'here', refresh_token: 'r', expires_at: 4102444800 }) };
  /* the bar's account chip in its Account landmark: the offer is made on a page that shows it */
  const withChip = () => { const nav = fakeNode('mccAuthNav'); nav.appendChild(fakeNode('mccAuthChip')); return { mccAuthNav: nav }; };
  const KEPT = ['/assets/audio/iot.mp3', '/assets/audio/got-wifi.mp3', '/data/lyrics/iot.json'];
  const vault = () => {
    const put = [];
    return { put, impl: { open: (name) => Promise.resolve({ put: (url, res) => { put.push([name, url]); return Promise.resolve(); }, match: () => Promise.resolve(undefined) }) } };
  };
  const fetchHere = (url) => (url.startsWith(PLATFORM + '/') ? Promise.resolve({ ok: true, body: url }) : Promise.reject(new Error('unexpected ' + url)));
  /* a member the carry signed in on an earlier page: no frame, only the offer */
  const v = vault();
  const p = platformPage({ local: { ...usable, mcc_carry_kept_v1: JSON.stringify(KEPT) }, cachesImpl: v.impl, fetchImpl: fetchHere, nodes: withChip() });
  assert.equal((await p.carry.started).result, 'signed_in');
  await flush();
  assert.deepEqual(p.frames, [], 'nothing asked: the songs were carried before');
  const card = p.body.find((n) => n.id === 'mccKeptOffer');
  assert.ok(card && !card.removed, 'the offer is on the page');
  assert.equal(card.className, 'dk-peek', 'in the bar\'s own peek card, no new look');
  const line = findNode(card, (n) => n.getAttribute && n.getAttribute('role') === 'status');
  assert.equal(line && line.textContent, 'You kept 2 songs at the old address. Keep them here too?', 'the one line, said as it changes');
  const go = findNode(card, (n) => n.className === 'dk-peek__go'), not = findNode(card, (n) => n.className === 'dk-peek__alt');
  assert.ok(go && not && go.getAttribute('type') === 'button' && not.getAttribute('type') === 'button');
  assert.equal(go.textContent, 'Keep them here');
  assert.equal(not.textContent, 'Not now');
  p.carry.paint();
  await flush();
  assert.equal(p.body.filter((n) => n.id === 'mccKeptOffer' && !n.removed).length, 1, 'said once, however often the bar repaints');
  assert.deepEqual(v.put, [], 'nothing kept before the tap');
  go.fire('click', {});
  await flush(60);
  assert.deepEqual(v.put.map((x) => x[1]).sort(), KEPT.map((k) => PLATFORM + k).sort(), 'the same files, at the same paths, fetched and kept from this origin');
  assert.ok(v.put.every((x) => x[0] === 'mcc-vault-v1'), 'into this origin\'s vault, which its service worker plays offline');
  assert.equal(line.textContent, 'Kept 2 songs here too.', 'it says what happened');
  assert.equal(not.textContent, 'Done');
  assert.equal(p.window.localStorage.getItem('mcc_carry_kept_v1'), null, 'asked once');
  not.fire('click', {});
  assert.ok(card.removed, 'Done closes the card');
  /* a song that does not come: said as it is */
  const w = vault();
  const part = platformPage({ local: { ...usable, mcc_carry_kept_v1: JSON.stringify(KEPT) }, cachesImpl: w.impl, nodes: withChip(),
    fetchImpl: (url) => (/got-wifi/.test(url) ? Promise.resolve({ ok: false, status: 503 }) : fetchHere(url)) });
  await part.carry.started;
  await flush();
  findNode(part.body.find((n) => n.id === 'mccKeptOffer'), (n) => n.className === 'dk-peek__go').fire('click', {});
  await flush(60);
  assert.equal(findNode(part.body.find((n) => n.id === 'mccKeptOffer'), (n) => n.getAttribute && n.getAttribute('role') === 'status').textContent,
    'Kept 1 of 2 songs here; the rest did not download.');
  /* Not now: the offer goes, and is not made again */
  const x = vault();
  const later = platformPage({ local: { ...usable, mcc_carry_kept_v1: JSON.stringify(KEPT) }, cachesImpl: x.impl, fetchImpl: fetchHere, nodes: withChip() });
  await later.carry.started;
  await flush();
  const card2 = later.body.find((n) => n.id === 'mccKeptOffer');
  findNode(card2, (n) => n.className === 'dk-peek__alt').fire('click', {});
  assert.ok(card2.removed, 'Not now closes it');
  assert.equal(later.window.localStorage.getItem('mcc_carry_kept_v1'), null, 'and the offer is not made again');
  assert.deepEqual(x.put, [], 'nothing fetched');
  /* never in a frame (the World framed over Music on his host): the top page says it */
  const framed = platformPage({ framed: 'other', local: { ...usable, mcc_carry_kept_v1: JSON.stringify(KEPT) }, cachesImpl: vault().impl, fetchImpl: fetchHere, nodes: withChip() });
  await framed.carry.started;
  await flush();
  assert.equal(framed.body.filter((n) => n.id === 'mccKeptOffer').length, 0, 'no offer inside a frame');
  assert.notEqual(framed.window.localStorage.getItem('mcc_carry_kept_v1'), null, 'it waits for a top page');
  /* nothing that is a song, or no vault in this browser: no offer, and nothing left waiting */
  for (const [label, kept, cachesImpl] of [['no song among the kept files', ['/data/lyrics/iot.json', '/assets/frames/prim3_0001.jpg'], vault().impl], ['no Cache Storage', KEPT, null]]) {
    const q = platformPage({ local: { ...usable, mcc_carry_kept_v1: JSON.stringify(kept) }, cachesImpl, fetchImpl: fetchHere, nodes: withChip() });
    await q.carry.started;
    await flush();
    assert.equal(q.body.filter((n) => n.id === 'mccKeptOffer').length, 0, `${label}: no offer`);
    assert.equal(q.window.localStorage.getItem('mcc_carry_kept_v1'), null, `${label}: nothing left waiting`);
  }
  /* a page that does not show the chip (the World's own sign-in covers it), or has no bar's card to draw it in (no
     css/style.css): no offer there, and it waits for the next page */
  const hiddenChip = withChip();
  hiddenChip.mccAuthNav.children[0].getClientRects = () => [];
  const under = platformPage({ local: { ...usable, mcc_carry_kept_v1: JSON.stringify(KEPT) }, cachesImpl: vault().impl, fetchImpl: fetchHere, nodes: hiddenChip });
  await under.carry.started;
  await flush();
  assert.equal(under.body.filter((n) => n.id === 'mccKeptOffer' && !n.removed).length, 0, 'no offer where the chip is not shown');
  assert.notEqual(under.window.localStorage.getItem('mcc_carry_kept_v1'), null, 'it waits for a page that shows it');
  const plainPage = platformPage({ local: { ...usable, mcc_carry_kept_v1: JSON.stringify(KEPT) }, cachesImpl: vault().impl, fetchImpl: fetchHere, nodes: withChip(),
    win: { getComputedStyle: () => ({ position: 'static' }) } });
  await plainPage.carry.started;
  await flush();
  assert.equal(plainPage.body.filter((n) => n.id === 'mccKeptOffer' && !n.removed).length, 0, 'no offer on a page without the bar\'s card');
  assert.notEqual(plainPage.window.localStorage.getItem('mcc_carry_kept_v1'), null, 'it waits for the next page');
  const styledPage = platformPage({ local: { ...usable, mcc_carry_kept_v1: JSON.stringify(KEPT) }, cachesImpl: vault().impl, fetchImpl: fetchHere, nodes: withChip(),
    win: { getComputedStyle: () => ({ position: 'fixed' }) } });
  await styledPage.carry.started;
  await flush();
  assert.equal(styledPage.body.filter((n) => n.id === 'mccKeptOffer' && !n.removed).length, 1, 'and is made where the bar\'s card is');
  /* the World (its root and mnet.html): its door is over everything, so the offer waits for another page */
  for (const path of ['/', '/mnet.html']) {
    const world = platformPage({ local: { ...usable, mcc_carry_kept_v1: JSON.stringify(KEPT) }, cachesImpl: vault().impl, fetchImpl: fetchHere, nodes: withChip(),
      win: { location: { origin: PLATFORM, hostname: new URL(PLATFORM).hostname, href: PLATFORM + path, pathname: path } } });
    await world.carry.started;
    await flush();
    assert.equal(world.body.filter((n) => n.id === 'mccKeptOffer').length, 0, `${path}: no offer on the World`);
    assert.notEqual(world.window.localStorage.getItem('mcc_carry_kept_v1'), null, `${path}: it waits for another page`);
  }
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
