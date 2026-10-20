import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = name => readFile(join(root, name), 'utf8');

/* ---------- travel-desk.html: the owner key never follows a link-chosen API ---------- */

async function deskApi(search, origin = 'https://matthew.mccluster.org') {
  const html = await read('travel-desk.html');
  const fn = /function trustedApi\(raw\) \{[\s\S]*?\n  \}\n/.exec(html);
  assert.ok(fn, 'travel desk validates ?api= through trustedApi');
  assert.match(html, /var API = trustedApi\(new URLSearchParams\(location\.search\)\.get\("api"\)\);/);
  assert.doesNotMatch(html, /get\("api"\) \|\| ""/, 'no raw ?api= passthrough');
  const location = { origin, search };
  return vm.runInNewContext(fn[0] + '; trustedApi(new URLSearchParams(location.search).get("api"))', { URL, URLSearchParams, location });
}

test('travel desk ignores a cross-origin ?api= and keeps the worker on this origin', async () => {
  for (const evil of ['https://evil.test', '//evil.test', 'https://evil.test/api', 'http://matthew.mccluster.org',
    'https://matthew.mccluster.org.evil.test', 'javascript:alert(1)', '/\\evil.test', 'https://localhost:8787',
    'http://user:pw@localhost:8787']) {
    assert.equal(await deskApi('?api=' + encodeURIComponent(evil)), '', evil);
  }
  assert.equal(await deskApi(''), '');
  assert.equal(await deskApi('?api=' + encodeURIComponent('https://matthew.mccluster.org/preview/')), '/preview');
  assert.equal(await deskApi('?api=' + encodeURIComponent('/preview')), '/preview');
  assert.equal(await deskApi('?api=' + encodeURIComponent('http://localhost:8787')), 'http://localhost:8787');
  assert.equal(await deskApi('?api=' + encodeURIComponent('http://127.0.0.1:8787/')), 'http://127.0.0.1:8787');
});

/* ---------- js/backend.js: a fragment token cannot fixate or replace a session ---------- */

const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = sub => `${b64url({ alg: 'HS256' })}.${b64url({ sub, exp: Math.floor(Date.now() / 1000) + 3600, email: sub + '@example.test' })}.sig`;

async function landBackend({ hash, existing = null, userId = null }) {
  const src = await read('js/backend.js');
  const store = new Map();
  if (existing) {
    store.set('mccdb_session', JSON.stringify(existing));
    store.set('mcc_sess_keep', JSON.stringify(existing));
  }
  const replaced = [], fetches = [], events = [];
  const location = { hash, search: '?x=1', pathname: '/account.html' };
  const window = {
    dispatchEvent: e => events.push(e.type),
    MCC: null
  };
  const ctx = {
    window, location, console,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    history: { replaceState: (_s, _t, url) => { replaced.push(url); location.hash = ''; } },
    fetch: (url, opts) => {
      fetches.push({ url, opts });
      const ok = userId !== null;
      return Promise.resolve({ ok, json: () => Promise.resolve(ok ? { id: userId } : { msg: 'bad jwt' }) });
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    document: { body: null },
    setTimeout: () => 0,
    Promise, JSON, Date, Object, Error, String, Boolean, Math, encodeURIComponent, decodeURIComponent
  };
  vm.runInNewContext(src, ctx);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const saved = store.has('mccdb_session') ? JSON.parse(store.get('mccdb_session')) : null;
  return { saved, replaced, fetches, events, window };
}

test('a signed-out member landing from a Supabase email link is signed in after GoTrue confirms the token', async () => {
  const tok = jwt('user-a');
  const r = await landBackend({ hash: `#access_token=${tok}&refresh_token=rt-a&type=signup`, userId: 'user-a' });
  assert.deepEqual(r.replaced, ['/account.html?x=1'], 'fragment is stripped');
  assert.equal(r.fetches.length, 1);
  assert.match(r.fetches[0].url, /\/auth\/v1\/user$/);
  assert.equal(r.fetches[0].opts.headers.Authorization, 'Bearer ' + tok);
  assert.equal(r.saved.access_token, tok);
  assert.equal(r.saved.refresh_token, 'rt-a');
  assert.ok(r.events.includes('mcc:auth-changed'));
});

test('a fragment token without a Supabase email-flow type is dropped and never saved', async () => {
  const r = await landBackend({ hash: `#access_token=${jwt('attacker')}&refresh_token=x`, userId: 'attacker' });
  assert.equal(r.replaced.length, 1, 'fragment is still stripped');
  assert.equal(r.fetches.length, 0);
  assert.equal(r.saved, null);
});

test('a fragment token GoTrue rejects (or that names another user) is never saved', async () => {
  let r = await landBackend({ hash: `#access_token=${jwt('user-a')}&type=magiclink`, userId: null });
  assert.equal(r.saved, null);
  r = await landBackend({ hash: `#access_token=${jwt('user-a')}&type=magiclink`, userId: 'someone-else' });
  assert.equal(r.saved, null);
});

test('a fragment for a different user never replaces the member already signed in', async () => {
  const mine = { access_token: jwt('victim'), refresh_token: 'rt-victim' };
  const r = await landBackend({ hash: `#access_token=${jwt('attacker')}&refresh_token=rt-x&type=magiclink`, existing: mine, userId: 'attacker' });
  assert.equal(r.replaced.length, 1, 'fragment is stripped');
  assert.equal(r.fetches.length, 0, 'the foreign token is not even sent');
  assert.deepEqual(r.saved, mine);
});

test('the same member refreshing through their own recovery link keeps working', async () => {
  const mine = { access_token: jwt('user-a'), refresh_token: 'old' };
  const fresh = jwt('user-a') + 'x';
  const r = await landBackend({ hash: `#access_token=${fresh}&refresh_token=new&type=recovery`, existing: mine, userId: 'user-a' });
  assert.equal(r.saved.access_token, fresh);
  assert.equal(r.saved.refresh_token, 'new');
});

/* ---------- oauth/consent: no HTML from the client, no framing, pinned SDK ---------- */

test('OAuth consent renders scopes as text, busts frames and pins supabase-js exactly', async () => {
  const html = await read('oauth/consent/index.html');
  assert.doesNotMatch(html, /\$\('#scopes'\)\.innerHTML/);
  assert.match(html, /label\.textContent=/);
  assert.match(html, /supabase-js@\d+\.\d+\.\d+'/, 'exact version, not a floating major');
  assert.doesNotMatch(html, /supabase-js@2'/);
  const style = /<style id="antiClickjack">html\{display:none!important\}<\/style>/.exec(html);
  assert.ok(style, 'page is hidden until proven top-level');
  const bust = /<style id="antiClickjack">[\s\S]*?<\/style>\s*<script>([\s\S]*?)<\/script>/.exec(html)[1];
  // framed: stays hidden and tries to break out
  const top = { location: null }, self = { location: 'https://matthew.mccluster.org/oauth/consent/?authorization_id=1' };
  let removed = false;
  const document = { getElementById: () => ({ parentNode: { removeChild: () => { removed = true; } } }) };
  vm.runInNewContext(bust, { self, top, document });
  assert.equal(removed, false);
  assert.equal(top.location, self.location);
  // top-level: revealed
  const solo = {};
  vm.runInNewContext(bust, { self: solo, top: solo, document });
  assert.equal(removed, true);
});

/* ---------- js/world-audio-continuity.js: typing never starts music; h1 keeps its name ---------- */

test('Enter/Space or a tap in an editable field never starts the theme', async () => {
  const src = await read('js/world-audio-continuity.js');
  const fn = /function editableTarget\(t\) \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(fn, 'world audio filters editable targets');
  assert.match(src, /addEventListener\("keydown", function \(e\) \{ if \(e\.isTrusted && \(e\.key === "Enter" \|\| e\.key === " "\) && !editableTarget\(e\.target\)/);
  assert.match(src, /addEventListener\("pointerdown", function \(e\) \{\s*if \(!e\.isTrusted \|\| editableTarget\(e\.target\)/);
  const editableTarget = vm.runInNewContext('(' + fn[0].replace(/^function editableTarget/, 'function') + ')');
  const el = ({ tag, type = '', editable = false, inside = null }) => ({
    nodeType: 1, isContentEditable: editable, type,
    closest(sel) {
      const parts = sel.split(',').map(s => s.trim());
      for (let n = this; n; n = n.parent) {
        if (parts.includes(n.tag) || (n.ce && parts.some(p => p.startsWith('[contenteditable]')))) return n;
      }
      return null;
    },
    tag, parent: inside, ce: false
  });
  assert.equal(editableTarget(el({ tag: 'input', type: 'text' })), true, '#wtTo destination field');
  assert.equal(editableTarget(el({ tag: 'input', type: 'search' })), true);
  assert.equal(editableTarget(el({ tag: 'textarea' })), true);
  assert.equal(editableTarget(el({ tag: 'select' })), true);
  assert.equal(editableTarget(el({ tag: 'span', editable: true })), true);
  const box = el({ tag: 'div' }); box.ce = true;
  assert.equal(editableTarget(el({ tag: 'b', inside: box })), true, 'inside a contenteditable');
  assert.equal(editableTarget({ nodeType: 3, parentElement: el({ tag: 'textarea' }) }), true, 'text node in a field');
  assert.equal(editableTarget(el({ tag: 'button' })), false, 'buttons still count as a gesture');
  assert.equal(editableTarget(el({ tag: 'input', type: 'checkbox' })), false);
  assert.equal(editableTarget(el({ tag: 'div' })), false);
  assert.equal(editableTarget(null), false);
});

test('lyrics decorate the World headline without replacing its heading text for assistive tech', async () => {
  const src = await read('js/world-audio-continuity.js');
  assert.match(src, /lyric\.className = "wt-headline__lyric"; lyric\.setAttribute\("aria-hidden", "true"\);/);
  assert.match(src, /base\.className = "wt-headline__base"; base\.textContent = headlineBase;/);
  assert.doesNotMatch(src, /var want = st\.line \|\| headlineBase;/);
});

/* ---------- js/travel/world-travel.mjs: a failed reroute keeps the driver navigating ---------- */

test('a failed off-route recalculation keeps the current route and navigation', async () => {
  const src = await read('js/travel/world-travel.mjs');
  const c = /\} catch \(error\) \{\n    if \(controller\.signal\.aborted[^\n]*\n([\s\S]*?)\n    stopNavigation\('', \{ resetProgress:true \}\); route = null; routeState = 'error';/.exec(src);
  assert.ok(c, 'requestRoute handles reroute failures before the initial-failure path');
  assert.match(c[1], /if \(reroute && route && navigating\) \{/);
  assert.match(c[1], /routeState = 'ready';/);
  assert.match(c[1], /lastRerouteAt = Date\.now\(\);/, 'a later off-route fix can retry once throttling allows');
  assert.match(c[1], /navigationNotice = /);
  assert.match(c[1], /renderDirections\(\); return;/);
  assert.doesNotMatch(c[1], /stopNavigation|route = null|hu:route/);
});

test('navigation holds a screen wake lock, feature-detected and released on stop', async () => {
  const src = await read('js/travel/world-travel.mjs');
  assert.match(src, /typeof navigator\.wakeLock\?\.request !== 'function'/);
  assert.match(src, /navigator\.wakeLock\.request\('screen'\)/);
  assert.match(src, /function stopNavigation\([^)]*\) \{\n  navigationSequence\+\+; releaseWakeLock\(\);/);
  assert.match(src, /root\.classList\.add\('wt-navigating'\); void acquireWakeLock\(\);/);
  assert.match(src, /else \{ renderRide\(\); if \(navigating\) void acquireWakeLock\(\); \}/);
});
