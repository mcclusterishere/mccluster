import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

/* ONE PLAYER ACROSS MUSIC PAGES (music slice M5; docs/music/MUSIC-RELEASE-20261119.md, "M5").

   Matthew, 2026-11-19: the music stops when he leaves the page it plays on. The first music page a tab opens now
   stays the one document that plays (the retained document), and the other music pages open over it as views,
   each in a fresh same-origin frame (js/music-shell.js). These are the contracts that keep that honest, in Node:
   the route table and its one switch, the history it writes, the live head it mirrors and gives back byte for
   byte, which frame it adopts, what js/shell-boot.js does with a document it did not expect, the engine's view
   mode (no Audio, no player, no Now Playing; a tap reaches the retained engine in the same call), the pocket and
   the World staying out of views, analytics keeping each page's own identity, script navigations to another
   origin going through the view, and the concealment allow-list against every fixed transport and status element
   of the stage pages. The browser proof is scripts/e2e/music-shell.e2e.mjs. What an iPhone does is Inferred. */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const HOUSE = 'https://matthew.mccluster.org';

/* ---------- a small stand-in browser ---------- */
function area() {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
/* an element that answers anything a script asks of it, and remembers what it was given */
function anything(name = 'el') {
  const store = { tagName: 'DIV', children: [], style: {}, dataset: {}, hidden: false };
  const classes = new Set();
  const attrs = new Map();
  const target = function () { return anything(name + '()'); };
  return new Proxy(target, {
    get(t, k) {
      if (k === 'classList') return { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; if (v) classes.add(c); else classes.delete(c); return v; }, contains: (c) => classes.has(c) };
      if (k === 'getAttribute') return (a) => (attrs.has(a) ? attrs.get(a) : null);
      if (k === 'setAttribute') return (a, v) => attrs.set(a, String(v));
      if (k === 'hasAttribute') return (a) => attrs.has(a);
      if (k === 'removeAttribute') return (a) => attrs.delete(a);
      if (k === 'querySelector') return () => anything(name + '.q');
      if (k === 'closest') return () => null;
      if (k === 'querySelectorAll' || k === 'getElementsByTagName') return () => [];
      if (k === 'appendChild' || k === 'insertBefore' || k === 'append') return (c) => { store.children.push(c); return c; };
      if (k === Symbol.toPrimitive) return () => '';
      if (k in store) return store[k];
      if (k === 'then') return undefined;
      return anything(name + '.' + String(k));
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return anything(name + '()'); }
  });
}
function browserWindow({ path = '/listen.html', search = '', marker = null, top = true, parent = null, frameElement = null, extra = {} } = {}) {
  const listeners = {}, docListeners = {}, appended = [];
  const html = { attrs: new Map(marker ? [['data-music-view', marker]] : []), classes: new Set(), style: { setProperty() {} },
    getAttribute(a) { return this.attrs.has(a) ? this.attrs.get(a) : null; }, hasAttribute(a) { return this.attrs.has(a); },
    setAttribute(a, v) { this.attrs.set(a, String(v)); }, removeAttribute(a) { this.attrs.delete(a); } };
  html.classList = { add: (...c) => c.forEach((x) => html.classes.add(x)), remove: (...c) => c.forEach((x) => html.classes.delete(x)), toggle: (c, on) => { if (on === undefined ? !html.classes.has(c) : on) html.classes.add(c); else html.classes.delete(c); }, contains: (c) => html.classes.has(c) };
  const head = { appended: [], appendChild(n) { this.appended.push(n); return n; }, querySelectorAll: () => [], querySelector: () => null, insertBefore(n) { this.appended.push(n); return n; } };
  const body = { appendChild(n) { appended.push(n); return n; }, insertBefore(n) { appended.push(n); return n; }, querySelector: () => null, querySelectorAll: () => [], classList: anything().classList, children: [], hasAttribute: () => false, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, dataset: {}, style: {} };
  const href = HOUSE + path + search;
  const document = { documentElement: html, head, body, readyState: 'complete', referrer: '', title: 'A page', cookie: '', visibilityState: 'visible', currentScript: null,
    addEventListener: (t, f, o) => { (docListeners[t] = docListeners[t] || []).push(f); }, removeEventListener() {},
    createElement: () => anything('created'), createComment: () => anything('comment'), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const win = {
    document, localStorage: area(), sessionStorage: area(), URL, URLSearchParams, Intl, Uint8Array, JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set, WeakMap, WeakSet, Symbol, console,
    navigator: { onLine: true, language: 'en-US', platform: 'test', userAgent: 'test', vendor: '', maxTouchPoints: 0 },
    screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 1, scrollY: 0,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    location: { pathname: path, search, hash: '', hostname: 'matthew.mccluster.org', origin: HOUSE, href, protocol: 'https:', replace() {}, assign() {} },
    history: { state: null, length: 1, scrollRestoration: 'auto', pushState() {}, replaceState() {}, back() {} },
    crypto: { randomUUID, getRandomValues: (a) => a }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, getComputedStyle: () => ({}),
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function (type) { this.type = type; },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {}, dispatchEvent: (e) => { (listeners[e.type] || []).forEach((f) => f(e)); return true; },
    __listeners: listeners, __docListeners: docListeners, __appended: appended,
    ...extra
  };
  win.window = win; win.self = win;
  win.top = top ? win : (parent || win); win.parent = top ? win : (parent || win);
  win.frameElement = frameElement;
  return win;
}
function run(file, win, code) {
  const ctx = vm.createContext(win);
  vm.runInContext(code || read(file), ctx, { filename: file });
  return ctx;
}
function shell(opts = {}) {
  const win = browserWindow({ path: '/listen.html', marker: 'listen', ...opts });
  run('js/music-shell.js', win);
  assert.ok(win.MCC_MUSIC_SHELL && win.MCC_MUSIC_SHELL.core, 'js/music-shell.js exposes MCC_MUSIC_SHELL with its core');
  return win.MCC_MUSIC_SHELL;
}

/* ---------- the route table ---------- */
/* Release 2 ships M5 contained (SPEC-ENGINE 4.10; engine stage 0): the album is never the retained document and never a
   view, so no view ever opens over its deck and two players never share the bar. Stage 2's own table (the album as the
   retained document, Listen and the artist pages over it) changed on purpose to the contained one below; stage 1 of the
   engine turns the album back on as a page of the one engine. */
test('the route table: stage 1 (Listen and the artist pages), the album contained (a page load from every music page), stage 3 (sign-in over Listen and the artist pages)', () => {
  const { core } = shell();
  const R = core.ROUTES;
  const listenTop = { kind: 'listen', url: '/listen.html' }, artistTop = { kind: 'artist', url: '/music-creator.html?handle=probe-artist' };
  const d = (href, from, top, shown) => core.decide(href, from, top, R, HOUSE + (shown || top.url));
  /* stage 1 */
  assert.equal(d('music-creator.html?handle=probe-artist', 'top', listenTop).action, 'view', 'Listen -> an artist page opens as a view');
  assert.equal(d('listen.html', 'artist', listenTop, '/music-creator.html?handle=probe-artist').action, 'reveal', 'an artist view -> Listen reveals the retained Listen');
  assert.equal(d('listen.html', 'top', artistTop).action, 'view', 'an artist page -> Listen opens Listen as a view');
  assert.equal(d('music-creator.html?handle=probe-artist', 'listen', artistTop, '/listen.html').action, 'reveal', 'back to the retained artist page is a reveal');
  assert.equal(d('music-creator.html?handle=second-artist', 'listen', artistTop, '/listen.html').action, 'view', 'another artist from a Listen view is a view');
  assert.equal(d('music-creator.html?handle=probe-artist#album=alb_abc123', 'top', listenTop).action, 'view', 'a deep link into an artist page opens as a view');
  assert.equal(d('listen.html', 'top', listenTop).action, 'scroll', 'the page shown now: back to its top');
  assert.equal(d('#apRates', 'artist', listenTop, '/music-creator.html?handle=probe-artist').action, 'native', 'a link within the page shown is the page\'s own');
  assert.equal(d('music-creator.html?handle=x', 'top', listenTop).action, 'load', 'an invalid handle is not a supported view');
  assert.equal(d('album.html?album=here&t=Lightroom', 'top', listenTop).action, 'load', 'the album from an engine page stays a page load (the named gap)');
  assert.equal(d('album.html?album=here', 'artist', listenTop, '/music-creator.html?handle=probe-artist').action, 'load');
  assert.equal(d('catalogue.html', 'top', listenTop).action, 'load', 'catalogue is a later route');
  assert.equal(d('index.html', 'artist', listenTop, '/music-creator.html?handle=probe-artist').action, 'load', 'the front page is never a view (hard rule 3)');
  assert.equal(d('creator.html', 'listen', artistTop, '/listen.html').action, 'load', 'Creator Studio is a later route');
  assert.equal(d('https://example.invalid/x', 'artist', listenTop, '/music-creator.html?handle=probe-artist').action, 'load', 'another origin is a page load of the top');
  assert.equal(d('mailto:?subject=Music', 'artist', listenTop, '/music-creator.html?handle=probe-artist').action, 'native', 'not a web address: the page\'s own');
  assert.equal(d('https://mccluster.org/?view=feed', 'artist', listenTop, '/music-creator.html?handle=probe-artist').action, 'world', 'the World keeps the Music-to-World path');
  assert.equal(d('mnet.html?join=1', 'listen', artistTop, '/listen.html').action, 'world', 'the house\'s World page too');
  /* the album, contained (was stage 2: the album retained, Listen and the artist pages as views over it) */
  assert.deepEqual({ ...R.album }, { top: false, view: false }, 'ROUTES.album: never retained, never a view (SPEC-ENGINE 4.10)');
  assert.equal(core.retains('album', R), false, 'the album is never the retained document');
  for (const [href, from, top, shown] of [
    ['album.html?album=here', 'top', listenTop],
    ['album.html?album=here&t=Lightroom', 'top', listenTop],
    ['album.html?album=here&t=Lightroom', 'listen', artistTop, '/listen.html'],
    ['album.html?album=prim3', 'top', artistTop],
    ['album.html?album=here&playlist=late', 'artist', listenTop, '/music-creator.html?handle=probe-artist']
  ]) assert.equal(d(href, from, top, shown).action, 'load', `${href} from ${from === 'top' ? top.kind + ' at the top' : 'a ' + from + ' view'}: a page load (no album view, no reveal of an album)`);
  /* stage 3: the account page as a sign-in view over Listen and the artist pages (the album's sign-in is a page load) */
  const acc = d('account.html', 'top', listenTop);
  assert.equal(acc.action, 'view', 'account.html opens as a sign-in view');
  assert.equal(new URL(acc.url, HOUSE).searchParams.get('next'), '/listen.html', 'a sign-in link without next comes back to the music page shown (the default for Matthew to confirm)');
  assert.equal(new URL(d('account.html', 'top', artistTop).url, HOUSE).searchParams.get('next'), '/music-creator.html?handle=probe-artist', 'from an artist page too');
  assert.equal(new URL(d('account.html?next=%2Fcreator.html', 'listen', artistTop, '/listen.html').url, HOUSE).searchParams.get('next'), '/creator.html', 'a next already there is kept');
  assert.equal(new URL(d('account.html?stay=1', 'top', listenTop).url, HOUSE).searchParams.get('next'), null, 'settings (stay=1) are not sent anywhere after');
  assert.equal(d('mnet.html?join=1&next=%2Flisten.html', 'account', listenTop, '/account.html?next=%2Flisten.html').action, 'load', 'Create account leaves by a page load of the top');
  assert.equal(d('forgot-password.html', 'account', listenTop, '/account.html').action, 'load', 'Forgot password too');
  assert.equal(d('/listen.html', 'account', listenTop, '/account.html').action, 'reveal', 'the sign-in\'s way back reveals Listen');
  assert.equal(d('/album.html?album=here', 'account', listenTop, '/account.html').action, 'load', 'a sign-in that goes on to the album is a page load of the top (the album is not retained)');
});

test('one switch: with every route off nothing opens as a view and nothing is retained (the behaviour at dc0185aa)', () => {
  const { core } = shell();
  const off = {}; for (const k of Object.keys(core.ROUTES)) off[k] = { top: false, view: false };
  const top = { kind: 'listen', url: '/listen.html' };
  for (const href of ['music-creator.html?handle=probe-artist', 'listen.html?x=1', 'album.html?album=here', 'account.html'])
    assert.notEqual(core.decide(href, 'top', top, off, HOUSE + '/listen.html').action, 'view', href);
  assert.equal(core.retains('listen', off), false);
  assert.equal(core.retains('listen', core.ROUTES), true);
  assert.equal(core.retains('artist', core.ROUTES), true);
  /* Release 2 ships M5 contained (SPEC-ENGINE 4.10): changed on purpose from true (stage 2 retained the album) */
  assert.equal(core.retains('album', core.ROUTES), false, 'the album is never the retained document in Release 2');
  assert.equal(core.retains('account', core.ROUTES), false, 'the account page is never the retained document');
  assert.equal(core.ROUTES.album.view, false, 'the album as a view waits for stage 1 of the engine');
});

/* ---------- the album, contained (SPEC-ENGINE 4.10) ---------- */
test('the album contained: on album.html the shell retains nothing, takes no link and no bar tap, and writes no history', () => {
  const writes = [];
  const win = browserWindow({ path: '/album.html', search: '?album=here', marker: 'album' });
  win.history.pushState = (s, t, u) => writes.push(['push', u]);
  win.history.replaceState = (s, t, u) => writes.push(['replace', u]);
  win.history.state = { mccMusicView: { href: HOUSE + '/listen.html', from: '', scroll: 0 } };   /* even an entry that names a view */
  run('js/music-shell.js', win);
  const S = win.MCC_MUSIC_SHELL;
  assert.ok(S && S.core, 'the shell still loads on the album (its marker stays for stage 1)');
  assert.equal(S.active(), false, 'but the album is not the retained document');
  assert.equal((win.__docListeners.click || []).length, 0, 'no link of the album page is taken: every one is the page\'s own, as at Release 1');
  assert.equal((win.__listeners.popstate || []).length + (win.__listeners.pageshow || []).length, 0, 'Back and Forward are the browser\'s');
  for (const href of ['listen.html', 'music-creator.html?handle=probe-artist', 'account.html', 'account.html?next=%2Falbum.html%3Falbum%3Dhere'])
    assert.equal(S.navigate(href), false, `the bar's tap to ${href} is the bar's own page load, never a view over the album`);
  assert.equal(S.view(), null, 'no view');
  assert.equal(S.owner(), '', 'no second player beside the deck (no guest engine, no owner flag)');
  assert.equal(win.document.documentElement.getAttribute('data-music-owner'), null);
  assert.equal(win.MCC_MUSIC_GUEST, undefined, 'the engine is never loaded beside the deck');
  assert.deepEqual(writes, [], 'no history entry is written or rewritten (no album view entry, no retained-page entry)');
  assert.equal(win.document.head.appended.length + win.__appended.length, 0, 'nothing added to the page: no view layer, no shell style');
});

/* ---------- a card's play button inside its link (SPEC-ENGINE 10, row A0.4) ---------- */
/* Listen's cards wrap their play button in the card's link: a song card in its album's link (js/listen.js card(), shown
   while the song rails are on), a creator's card in the artist page's link (js/music-community.js). The top handler and
   the view agent asked a.closest("[data-music-play]"), which walks UP from the link and never finds the button inside
   it, so a tap on the button was routed as a tap on the link: in a view the agent took it first (window, capture) and
   the song never played; the view moved on, closed or the top loaded the album. Both now ask the click's own target.
   A small element tree: closest() walks up from the element itself, as the DOM's does. */
function cardTree(href, playAttrs) {
  const el = (tag, attrs = {}, parent = null) => ({ tagName: tag.toUpperCase(), attrs: new Map(Object.entries(attrs)), parentNode: parent, target: '',
    getAttribute(a) { return this.attrs.has(a) ? this.attrs.get(a) : null; }, hasAttribute(a) { return this.attrs.has(a); },
    matches(sel) {
      if (sel === 'a[href]') return this.tagName === 'A' && this.attrs.has('href');
      const at = /^\[([a-z-]+)\]$/.exec(sel);
      if (at) return this.attrs.has(at[1]);
      const cls = /^\.([a-z-]+)$/.exec(sel);
      if (cls) return String(this.attrs.get('class') || '').split(/\s+/).includes(cls[1]);
      return false;
    },
    closest(sel) { for (let n = this; n; n = n.parentNode) if (n.matches(sel)) return n; return null; } });
  const main = el('main');
  const a = el('a', { href, class: 'feat__card' }, main);
  a.href = new URL(href, HOUSE + '/').href;   /* the browser's own resolution of a link's address */
  const play = el('span', { class: 'feat__play', role: 'button', 'data-music-play': '', ...playAttrs }, a);
  const icon = el('svg', {}, play);
  const title = el('b', {}, a);
  return { a, play, icon, title };
}
function tap(target) {
  return { target, button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, prevented: 0, stopped: 0,
    preventDefault() { this.defaultPrevented = true; this.prevented++; }, stopPropagation() { this.stopped++; } };
}
const OBSERVER = { MutationObserver: class { observe() {} disconnect() {} } };
test('A0.4: the top handler leaves a tap on a card\'s play button inside its link to the player: no view opens, no history is written', () => {
  const writes = [];
  const top = browserWindow({ path: '/listen.html', marker: 'listen', extra: OBSERVER });
  top.history.pushState = (s, t, u) => writes.push(['push', u]);
  top.history.replaceState = (s, t, u) => writes.push(['replace', u]);
  run('js/music-shell.js', top);
  const onTop = (top.__docListeners.click || [])[0];
  assert.ok(onTop, 'the retained Listen listens for its links');
  /* Listen's creator card: a link to the artist's page (a view route) with its play button inside */
  const card = cardTree('music-creator.html?handle=probe-artist', { 'data-creator-track': 'c1' });
  for (const [what, target] of [['the play button', card.play], ['the icon inside it', card.icon]]) {
    const e = tap(target);
    onTop(e);
    assert.equal(e.prevented + e.stopped, 0, `a tap on ${what} is the player's (js/music-engine.js plays it), never the link's`);
  }
  /* and a song card in its album's link (a page-load route): the same */
  const song = cardTree('album.html?album=here&t=Runway%20Walk', { 'data-album': 'here', 'data-track': 'Runway Walk' });
  const s = tap(song.play);
  onTop(s);
  assert.equal(s.prevented + s.stopped, 0, 'a song card\'s play button is the player\'s too');
  assert.deepEqual(writes, [], 'no history entry written');
  assert.equal(top.__appended.length, 0, 'no view opened');
  assert.equal(top.location.href, HOUSE + '/listen.html', 'and no page load');
  /* the guard is real: the card itself, away from its play button, still opens the artist's page as a view */
  const e = tap(card.title);
  onTop(e);
  assert.equal(e.prevented, 1, 'a tap on the card\'s title is the link\'s');
  assert.ok(writes.some(([k, u]) => k === 'push' && /\/music-creator\.html\?handle=probe-artist$/.test(u)), 'and opens the artist page as a view');
  assert.equal(top.__appended.length, 1, 'one view layer');
});
test('A0.4: the view agent leaves a tap on a card\'s play button inside its link to the player: the view stays, nothing is revealed, opened or loaded', () => {
  /* an artist page retained; Listen opened over it as a view and painted */
  const writes = [];
  const top = browserWindow({ path: '/music-creator.html', search: '?handle=probe-artist', marker: 'artist', extra: OBSERVER });
  top.history.pushState = (s, t, u) => writes.push(['push', u]);
  top.history.replaceState = (s, t, u) => writes.push(['replace', u]);
  run('js/music-shell.js', top);
  const S = top.MCC_MUSIC_SHELL;
  assert.equal(S.navigate('listen.html'), true, 'the artist page opens Listen as a view');
  const layer = top.__appended[0];
  const frame = layer.children.find((c) => typeof c.src === 'string' && /\/listen\.html$/.test(c.src));
  assert.ok(frame, 'the view\'s frame');
  const view = browserWindow({ path: '/listen.html', marker: 'listen', top: false, parent: top, frameElement: frame,
    extra: { requestAnimationFrame: (fn) => { fn(); return 1; } } });
  const api = S.adopt(view);
  assert.ok(api && api.kind === 'listen', 'the shell adopts its own frame at the address it asked for');
  assert.equal(S.view(), HOUSE + '/listen.html', 'and the view has painted: it is shown');
  const agent = (view.__listeners.click || [])[0];
  assert.ok(agent, 'the view agent listens for the view\'s links');
  const before = { writes: writes.length, href: top.location.href, state: layer.getAttribute('data-view-state'), frames: layer.children.length };
  const cards = [
    ['the retained artist\'s creator card (a reveal of the artist page)', cardTree('music-creator.html?handle=probe-artist', { 'data-creator-track': 'c1' })],
    ['another artist\'s creator card (a view of that page)', cardTree('music-creator.html?handle=second-artist', { 'data-creator-track': 'c2' })],
    ['a song card in its album\'s link (a page load of the top)', cardTree('album.html?album=here&t=Runway%20Walk', { 'data-album': 'here', 'data-track': 'Runway Walk' })]
  ];
  for (const [what, card] of cards) for (const target of [card.play, card.icon]) {
    const e = tap(target);
    agent(e);
    assert.equal(e.prevented + e.stopped, 0, `${what}: the tap goes on to the view's player (js/music-engine.js view mode), not to the link`);
    assert.equal(S.view(), HOUSE + '/listen.html', `${what}: the Listen view stays`);
    assert.deepEqual({ writes: writes.length, href: top.location.href, state: layer.getAttribute('data-view-state'), frames: layer.children.length }, before,
      `${what}: no history written, no page load, no view opened or closed`);
  }
  /* the guard is real: the song card itself, away from its play button, is still routed (the album: a page load of the top) */
  const e = tap(cards[2][1].title);
  agent(e);
  assert.equal(e.prevented, 1, 'a tap on the card\'s title is the link\'s');
  assert.equal(top.location.href, HOUSE + '/album.html?album=here&t=Runway%20Walk', 'and the album is a page load of the top');
});

/* ---------- history ---------- */
test('history: only the retained document writes entries, and Back and Forward show or reveal without reloading it', () => {
  const { core } = shell();
  const st = core.viewState(HOUSE + '/music-creator.html?handle=probe-artist', HOUSE + '/listen.html', 0);
  assert.deepEqual(Object.keys(st), ['mccMusicView']);
  assert.equal(st.mccMusicView.from, HOUSE + '/listen.html', 'the page it was opened from rides with the entry (its referrer after Back and Forward)');
  const shown = HOUSE + '/music-creator.html?handle=probe-artist';
  assert.equal(core.popAction(st, null), 'show', 'Forward onto a view entry builds that view');
  assert.equal(core.popAction(st, shown), 'stay', 'the view already shown stays (the World closing onto it)');
  assert.equal(core.popAction(Object.assign({ mccWorldAudio: { href: 'https://mccluster.org/' } }, st), shown), 'stay', 'the World over a view: its entry keeps the view');
  assert.equal(core.popAction(core.viewState(HOUSE + '/music-creator.html?handle=second-artist', shown, 0), shown), 'show', 'another view entry replaces the view shown');
  assert.equal(core.popAction({ mccMusicShell: { top: true, scroll: 120 } }, shown), 'reveal', 'the retained page\'s entry reveals it');
  assert.equal(core.popAction(null, shown), 'reveal');
  assert.equal(core.popAction(null, null), 'stay', 'nothing shown, nothing to do');
});

/* ---------- the live head ---------- */
/* a small DOM for a document head: elements with ordered attributes and text, comments, and the selectors the shell uses */
function headDoc(nodes) {
  const VOID = new Set(['META', 'LINK', 'BASE']);
  const doc = {};
  const el = (tag, attrs = {}, text = '') => {
    const n = { nodeType: 1, tagName: tag.toUpperCase(), attrs: new Map(Object.entries(attrs)), text, parentNode: null,
      getAttribute(a) { return this.attrs.has(a) ? this.attrs.get(a) : null; }, setAttribute(a, v) { this.attrs.set(a, String(v)); },
      get textContent() { return this.text; }, set textContent(v) { this.text = String(v); } };
    return n;
  };
  const head = { nodeType: 1, tagName: 'HEAD', childNodes: [],
    appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; },
    insertBefore(n, ref) { if (n.parentNode) n.parentNode.removeChild(n); const i = this.childNodes.indexOf(ref); if (i < 0) throw new Error('reference is not a child'); n.parentNode = this; this.childNodes.splice(i, 0, n); return n; },
    removeChild(n) { const i = this.childNodes.indexOf(n); if (i < 0) throw new Error('not a child'); this.childNodes.splice(i, 1); n.parentNode = null; return n; },
    querySelectorAll(sel) { return this.childNodes.filter((n) => n.nodeType === 1 && matches(n, sel)); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; } };
  function matches(n, sel) {
    return sel.split(',').some((one) => {
      const m = /^([a-z]+)?(?:\[([a-z:-]+)(\^?=)"([^"]*)"\])?$/.exec(one.trim());
      if (!m) throw new Error('selector the small DOM does not know: ' + one);
      if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
      if (!m[2]) return true;
      const v = n.getAttribute(m[2]);
      return v !== null && (m[3] === '=' ? v === m[4] : v.startsWith(m[4]));
    });
  }
  doc.head = head;
  doc.createElement = (tag) => el(tag);
  doc.createComment = (data) => ({ nodeType: 8, data: String(data), parentNode: null });
  doc.querySelector = (sel) => head.querySelector(sel);
  Object.defineProperty(doc, 'title', { get() { const t = head.querySelector('title'); return t ? t.textContent : ''; } });
  doc.serialize = () => head.childNodes.map((n) => n.nodeType === 8 ? `<!--${n.data}-->`
    : `<${n.tagName.toLowerCase()}${[...n.attrs].map(([a, v]) => ` ${a}="${v}"`).join('')}>` + (VOID.has(n.tagName) ? '' : `${n.text}</${n.tagName.toLowerCase()}>`)).join('\n');
  for (const [tag, attrs, text] of nodes) head.appendChild(el(tag, attrs, text));
  return doc;
}
const LISTEN_HEAD = [
  ['meta', { charset: 'utf-8' }],
  ['meta', { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
  ['title', {}, 'Listen · Matthew McCluster'],
  ['meta', { name: 'description', content: 'Every song, one place.' }],
  ['link', { rel: 'canonical', href: HOUSE + '/listen.html' }],
  ['meta', { property: 'og:title', content: 'Listen · Matthew McCluster' }],
  ['meta', { property: 'og:url', content: HOUSE + '/listen.html' }],
  ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ['link', { rel: 'stylesheet', href: 'css/listen.css' }],
  ['script', { type: 'application/ld+json' }, '{"@context":"https://schema.org","@type":"MusicPlaylist","@id":"' + HOUSE + '/listen.html#playlist"}'],
  ['script', { type: 'application/ld+json' }, '{"@context":"https://schema.org","@type":"WebPage","@id":"' + HOUSE + '/listen.html#page"}'],
  ['script', { src: 'js/tabbar.js' }, '']
];
test('the live head follows the view shown, holds the retained page\'s JSON-LD, og: and twitter: aside, and gives every node back byte for byte', () => {
  const { core } = shell();
  const top = headDoc(LISTEN_HEAD);
  const before = top.serialize(), nodes = [...top.head.childNodes];
  const artist = headDoc([['title', {}, 'Probe Artist · Music · Matthew McCluster'], ['meta', { name: 'description', content: 'Probe Artist on McCluster.' }]]);
  const hold = core.holdHead(top, () => true);
  hold.mirror(artist);
  const live = (sel) => top.head.querySelectorAll(sel);
  assert.equal(top.title, 'Probe Artist · Music · Matthew McCluster', 'the title is the artist page\'s');
  assert.equal(live('title').length, 1, 'one title');
  assert.equal(live('meta[name="description"]').length, 1);
  assert.equal(live('meta[name="description"]')[0].getAttribute('content'), 'Probe Artist on McCluster.', 'its description');
  assert.equal(live('link[rel="canonical"]').length, 0, 'no canonical: the artist page has none, so Listen\'s is not shown under its address');
  assert.equal(live('script[type="application/ld+json"]').length + live('meta[property^="og:"]').length + live('meta[name^="twitter:"]').length, 0,
    'Listen\'s JSON-LD, og: and twitter: are held aside (an artist page never shares as Listen)');
  for (const kept of [nodes[0], nodes[1], nodes[8], nodes[11]]) assert.ok(top.head.childNodes.includes(kept), 'what is not identity stays where it is');
  const listen = headDoc([['title', {}, 'Listen again'], ['link', { rel: 'canonical', href: HOUSE + '/listen.html' }]]);
  hold.mirror(listen);
  assert.equal(live('link[rel="canonical"]').length, 1);
  assert.equal(live('link[rel="canonical"]')[0].getAttribute('href'), HOUSE + '/listen.html', 'a view with a canonical has it mirrored');
  assert.equal(live('meta[name="description"]').length, 0, 'and a view without a description shows none');
  hold.restore();
  assert.equal(top.serialize(), before, 'on reveal the head is byte for byte what it was');
  assert.deepEqual(top.head.childNodes, nodes, 'and holds the very same nodes, in the same places');
});
test('the live head: a title the retained page writes while covered is kept for its reveal; one the World writes is not', () => {
  const { core } = shell();
  const artistTop = [['title', {}, 'Music · Matthew McCluster'], ['meta', { name: 'description', content: 'An artist on McCluster.' }],
    ['script', { type: 'application/ld+json' }, '{"@type":"MusicGroup"}']];
  const view = headDoc([['title', {}, 'Listen · Matthew McCluster']]);
  /* the artist page's profile arrives late and names the page while Listen shows over it */
  const late = headDoc(artistTop), lateBefore = late.serialize();
  const a = core.holdHead(late, () => true);
  a.mirror(view);
  late.head.querySelector('title').textContent = 'Probe Artist · Music · Matthew McCluster';
  a.mirror(view);
  assert.equal(late.title, 'Listen · Matthew McCluster', 'the view\'s title stays on screen');
  a.restore();
  assert.equal(late.title, 'Probe Artist · Music · Matthew McCluster', 'the retained page\'s own late title comes back with it');
  assert.equal(late.serialize(), lateBefore.replace('Music · Matthew McCluster</title>', 'Probe Artist · Music · Matthew McCluster</title>'), 'and nothing else changed');
  /* the World open over the view writes its own title: not the retained page's */
  const w = headDoc(artistTop), wBefore = w.serialize();
  const b = core.holdHead(w, () => false);
  b.mirror(view);
  w.head.querySelector('title').textContent = 'World · its own title';
  b.restore();
  assert.equal(w.serialize(), wBefore, 'the World\'s title never becomes the retained page\'s');
});

/* ---------- which frame may become a view ---------- */
test('adopt: only the shell\'s own pending frame at the address it expects, or a reload of the view it shows', () => {
  const { core } = shell();
  const pf = {}, cf = {}, other = {};
  const pending = { frame: pf, href: HOUSE + '/music-creator.html?handle=probe-artist' };
  const current = { frame: cf, href: HOUSE + '/account.html?next=%2Falbum.html' };
  assert.equal(core.acceptable(pending, current, pf, HOUSE + '/music-creator.html?handle=probe-artist#album=alb_abc123'), 'pending');
  assert.equal(core.acceptable(pending, current, pf, HOUSE + '/index.html'), null, 'an unexpected address in the pending frame is refused');
  assert.equal(core.acceptable(pending, current, other, HOUSE + '/music-creator.html?handle=probe-artist'), null, 'any other frame is refused');
  assert.equal(core.acceptable(pending, current, cf, HOUSE + '/account.html?next=%2Falbum.html'), 'reload', 'the account view reloading itself (sign-out) is the same view');
  assert.equal(core.acceptable(pending, current, cf, HOUSE + '/album.html?album=here'), null, 'the account view navigating on is not adopted (it is routed)');
  assert.equal(core.acceptable(null, null, pf, HOUSE + '/listen.html'), null);
});

/* ---------- js/shell-boot.js in a frame ---------- */
test('js/shell-boot.js adopts the shell\'s own frame, stops any other document there, and leaves the top and every other frame alone', () => {
  const boot = read('js/shell-boot.js');
  const make = ({ marker, owns = true, api = { kind: 'artist' }, crossOrigin = false }) => {
    const calls = { adopt: 0, unexpected: 0 };
    const frameEl = {};
    const parent = browserWindow({ path: '/listen.html', marker: 'listen' });
    parent.MCC_MUSIC_SHELL = { owns: (el) => owns && el === frameEl, adopt: () => { calls.adopt++; return api; }, unexpected: () => { calls.unexpected++; } };
    let stopped = 0;
    const win = browserWindow({ path: '/music-creator.html', search: '?handle=probe-artist', marker, top: false, parent, frameElement: frameEl, extra: { stop: () => { stopped++; } } });
    if (crossOrigin) Object.defineProperty(win, 'parent', { get() { return new Proxy({}, { get() { throw new Error('cross-origin'); } }); } });
    run('js/shell-boot.js', win, boot);
    return { win, calls, stopped: () => stopped };
  };
  const adopted = make({ marker: 'artist' });
  assert.equal(adopted.calls.adopt, 1, 'a music page in the shell\'s frame asks to be adopted');
  assert.ok(adopted.win.MCC_MUSIC_VIEW && adopted.win.MCC_MUSIC_VIEW.kind === 'artist', 'and holds the view API before any other script runs');
  assert.ok(adopted.win.document.documentElement.classes.has('mcc-music-view'), 'html.mcc-music-view hides its own bar and chip before first paint');
  assert.equal(adopted.stopped(), 0);
  const stray = make({ marker: null });
  assert.equal(stray.stopped(), 1, 'a document without the marker (index.html, the offline fallback) is stopped before its body');
  assert.equal(stray.calls.unexpected, 1, 'and handed to the shell to route');
  assert.equal(stray.win.MCC_MUSIC_VIEW, undefined);
  const refused = make({ marker: 'album', api: null });
  assert.equal(refused.stopped(), 1, 'a music page the shell did not expect there is stopped too');
  assert.equal(refused.calls.unexpected, 1);
  const elsewhere = make({ marker: 'artist', owns: false });
  assert.equal(elsewhere.stopped() + elsewhere.calls.adopt + elsewhere.calls.unexpected, 0, 'a frame that is not the shell\'s is left exactly as today');
  const foreign = make({ marker: 'artist', crossOrigin: true });
  assert.equal(foreign.stopped(), 0, 'a frame inside another origin is left alone');
  const top = browserWindow({ path: '/listen.html', marker: 'listen' });
  top.stop = () => { throw new Error('the top is never stopped'); };
  run('js/shell-boot.js', top, boot);
  assert.equal(top.MCC_MUSIC_VIEW, undefined, 'the top document is never a view');
});

/* ---------- the engine in a view ---------- */
test('js/music-engine.js in a view: no Audio, no player, no Now Playing, and a tap reaches the retained engine in the same call', () => {
  const calls = [];
  const retained = { play: (...a) => { calls.push(['play', ...a]); return Promise.resolve({ state: 'full' }); }, playCreator: (...a) => { calls.push(['playCreator', ...a]); return Promise.resolve({}); },
    registerCreatorTrack: (t) => calls.push(['register', t.id]), pause: () => calls.push(['pause']), current: () => null, playing: () => false, access: () => '', delivery: () => ({}) };
  let audios = 0, binds = 0;
  const win = browserWindow({ path: '/listen.html', marker: 'listen', top: false, extra: {
    Audio: function () { audios++; return anything('audio'); },
    MCC_NOW_PLAYING: { bind: () => { binds++; return { update() {} }; }, claim() {}, airplay() {} },
    MCC_MUSIC_VIEW: { kind: 'listen', page: { path: 'listen.html', handle: '' }, engine: () => retained, on() { return () => {}; }, top() { return {}; } } } });
  run('js/music-engine.js', win);
  assert.equal(audios, 0, 'no Audio is made in a view');
  assert.equal(binds, 0, 'a view never binds Now Playing');
  assert.equal(win.__appended.length, 0, 'no mini player or Now sheet in a view');
  assert.ok(win.MCC_MUSIC && win.MCC_MUSIC.audio === undefined, 'the facade owns no element');
  win.MCC_MUSIC.registerCreatorTrack({ id: 'c1', title: 'x' });
  assert.deepEqual(calls.pop(), ['register', 'c1'], 'a page\'s creator tracks register with the one queue');
  const click = (win.__docListeners.click || [])[0];
  assert.ok(click, 'the view listens for its own play buttons');
  const button = { getAttribute: (a) => ({ 'data-album': 'here', 'data-track': 'Who Did The Shoot' })[a] || null };
  let prevented = false;
  click({ target: { closest: (s) => (/data-music-play/.test(s) ? button : null) }, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(calls.length, 1, 'the tap reached the retained engine synchronously, inside the tap');
  assert.deepEqual(calls[0].slice(0, 3), ['play', 'here', 'Who Did The Shoot']);
  assert.deepEqual(calls[0][4], { path: 'listen.html', handle: '' }, 'with the page it was chosen on');
  assert.ok(prevented);
});

test('js/music-engine.js in the retained document still makes its one Audio and binds Now Playing (unchanged outside a view)', () => {
  let audios = 0, binds = 0;
  const win = browserWindow({ path: '/listen.html', marker: 'listen', extra: {
    Audio: function () { audios++; return anything('audio'); },
    MCC_NOW_PLAYING: { bind: () => { binds++; return { update() {} }; }, claim() {}, airplay() {} } } });
  run('js/music-engine.js', win);
  assert.equal(audios, 1);
  assert.equal(binds, 1);
});

/* ---------- the pocket and the World stay out of views ---------- */
test('js/pip.js never mounts a pocket in a view (a second player), and still does on an ordinary page', async () => {
  const pocketRecord = JSON.stringify({ src: 'assets/audio/who-did-the-shoot.mp3', title: 'Who Did The Shoot', t: 12, playing: true, at: Date.now() });
  const mk = (view) => {
    const win = browserWindow({ path: '/account.html', marker: 'account', top: !view, extra: view ? { MCC_MUSIC_VIEW: { kind: 'account' } } : {} });
    win.localStorage.setItem('mcc-pocket', pocketRecord);
    win.document.getElementById = () => anything('byId');
    win.document.querySelector = () => anything('q');
    win.MCC_NOW_PLAYING = { claim() {}, bind: () => ({ update() {}, clear() {} }), airplay() {} };
    win.Audio = function () { return anything('audio'); };
    /* the pocket asks the catalogue whether the record may ride before it mounts (music quick wins, review QW-R3) */
    win.fetch = () => Promise.resolve({ ok: true, json: async () => ({ albums: [] }) });
    try { run('js/pip.js', win); } catch (e) { /* the stand-in DOM is thin: a mount that got going is what counts */ }
    return win;
  };
  const inView = mk(true), page = mk(false);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.equal(inView.__appended.length, 0, 'no pocket in the account view');
  assert.ok(page.__appended.length >= 1, 'the pocket still mounts on an ordinary page (the guard is real)');
});

test('js/world-audio-continuity.js does nothing in a view: no theme, no watchers, no greeting to the retained document', () => {
  let posted = 0;
  const parent = browserWindow({ path: '/listen.html', marker: 'listen' });
  parent.postMessage = () => { posted++; };
  const win = browserWindow({ path: '/music-creator.html', search: '?handle=probe-artist', marker: 'artist', top: false, parent, extra: { MCC_MUSIC_VIEW: { kind: 'artist' }, Audio: function () { return anything('audio'); }, MCC_MUSIC: { audio: anything('a'), current: () => null }, fetch: () => new Promise(() => {}) } });
  win.document.referrer = HOUSE + '/listen.html';
  run('js/world-audio-continuity.js', win);
  assert.equal(win.MCC_WORLD_AUDIO, undefined, 'no World helper in a view');
  assert.equal(posted, 0, 'no hello to the parent, which would take the view for the World frame');
  assert.equal(Object.keys(win.__docListeners).length + Object.keys(win.__listeners).length, 0, 'no listener of any kind');
});

/* ---------- analytics ---------- */
function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `could not find ${from} ... ${to}`);
  return src.slice(a, b);
}
function sender({ path = '/listen.html', search = '', view = null, referrer = '' } = {}) {
  const src = read('js/analytics.js');
  const code = slice(src, 'var MCC_PRIVACY_REQUIRED_VERSION', '/* EVENT_OUTBOX_FACTORY_END */') +
    slice(src, 'window.MCC_TRACK = (function () {', '\n/* ============================================================\n   MCC_MODEL');
  const win = browserWindow({ path, search, top: !view, extra: view ? { MCC_MUSIC_VIEW: view } : {} });
  win.document.referrer = referrer;
  win.localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: '2026-11-23T00:00:00Z' }));
  win.localStorage.setItem('mcc_acq', JSON.stringify({ src: 'direct', med: 'none', cmp: '', plug: '', at: '2026-11-23' }));
  const sent = [];
  win.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, clone: () => ({ json: async () => ({ ok: true }) }) }; };
  run('js/analytics.js', win, code);
  return { win, sent, track: (n, p) => win.MCC_TRACK(n, p),
    async flush() { win.document.visibilityState = 'hidden'; (win.__docListeners.visibilitychange || []).forEach((f) => f()); await new Promise((r) => setImmediate(r)); },
    events: () => sent.flatMap((s) => s.events) };
}
test('analytics: the retained page keeps its own path and creator_handle after the address changes to a view\'s', async () => {
  const s = sender({ path: '/listen.html' });
  s.win.location.pathname = '/music-creator.html'; s.win.location.search = '?handle=probe-artist';   /* the shell's pushState */
  s.track('music_complete', { track: 'Who Did The Shoot' });
  await s.flush();
  const e = s.events().find((x) => x.name === 'music_complete');
  assert.equal(e.path, 'listen.html', 'a song of the retained Listen page is filed under Listen');
  assert.equal(e.props.creator_handle, undefined, 'and never takes the artist view\'s creator_handle');
  const a = sender({ path: '/music-creator.html', search: '?handle=probe-artist' });
  a.win.location.pathname = '/listen.html'; a.win.location.search = '';
  a.track('dwell', { s: 10 });
  await a.flush();
  assert.equal(a.events()[0].path, 'music-creator.html');
  assert.equal(a.events()[0].props.creator_handle, 'probe-artist', 'the retained artist page keeps its own handle under a Listen view');
});
test('js/music-engine.js names the page a song was chosen on in its events, and only for a song chosen in a view', () => {
  const sent = [];
  const win = browserWindow({ path: '/listen.html', marker: 'listen', extra: {
    Audio: function () { return anything('audio'); },
    MCC_NOW_PLAYING: { bind: () => ({ update() {} }), claim() {}, airplay() {} },
    MCC_TRACK: (name, props) => { sent.push({ name, props }); },
    fetch: () => Promise.reject(new Error('no network in this test')) } });
  win.document.getElementById = () => anything('el');
  run('js/music-engine.js', win);
  const M = win.MCC_MUSIC;
  M.registerCreatorTrack({ id: 'probe-1', title: 'Probe Single', artist: 'Probe Artist' });
  M.registerCreatorTrack({ id: 'probe-2', title: 'Probe Two', artist: 'Probe Artist' });
  const quiet = (p) => { if (p && p.catch) p.catch(() => {}); };
  quiet(M.playCreator('probe-1', false, { path: 'music-creator.html', handle: 'probe-artist' }));
  M.openNow();
  const inView = sent.filter((e) => e.name === 'music_now_open').pop();
  assert.ok(inView, 'the engine reports the Now sheet opening');
  assert.deepEqual(JSON.parse(JSON.stringify(inView.props.mcc_chosen_on)), { path: 'music-creator.html', handle: 'probe-artist' },
    'a song chosen in an artist view is filed on that artist page (js/analytics.js reads mcc_chosen_on and sends it in no event)');
  quiet(M.playCreator('probe-2'));
  M.openNow();
  const here = sent.filter((e) => e.name === 'music_now_open').pop();
  assert.notEqual(here, inView);
  assert.equal(here.props.mcc_chosen_on, undefined, 'a song chosen on the retained page itself carries no chosen-on page');
});
test('analytics: a song carries the page it was chosen on; a view names the page it was opened from', async () => {
  const s = sender({ path: '/listen.html' });
  s.track('music_play', { source: 'creator_discovery', mcc_chosen_on: { path: 'music-creator.html', handle: 'probe-artist' } });
  s.track('music_play', { source: 'discovery', mcc_chosen_on: { path: 'listen.html', handle: '' } });
  await s.flush();
  const [creator, listen] = s.events();
  assert.equal(creator.path, 'music-creator.html');
  assert.equal(creator.props.creator_handle, 'probe-artist', 'a release chosen in an artist view is filed as on the artist page');
  assert.equal(creator.props.mcc_chosen_on, undefined, 'the context itself is not sent');
  assert.equal(listen.path, 'listen.html');
  assert.equal(listen.props.creator_handle, undefined);
  const v = sender({ path: '/music-creator.html', search: '?handle=probe-artist', referrer: HOUSE + '/music-creator.html?handle=probe-artist', view: { kind: 'artist', referrer: HOUSE + '/listen.html' } });
  v.track('page_view', { title: 'Probe Artist · McCluster Music' });
  await v.flush();
  assert.equal(v.events()[0].referrer, HOUSE + '/listen.html', 'a view rebuilt by Back or Forward names the page it was opened from, not its own address');
});

/* ---------- script navigations to another origin ---------- */
test('every script navigation in the stage pages is classified, and one to another origin goes through the view', () => {
  /* the stage pages' own scripts: a navigation the shell cannot see after the fact (another origin) must ask the
     view first; a same-origin one is caught and routed by js/shell-boot.js. A new one fails until it is classified. */
  const KNOWN = {
    'js/music-creator-profile.js': ['location.href = "mailto:', 'location.href = "account.html?next=', 'location.href = out.data.url'],
    'js/listen.js': ['location.href = first.getAttribute("href")'],
    'js/creator-onboarding.js': ['location.assign(h)', 'location.assign(there)', 'location.assign(dest)'],
    'account.html': ['location.replace("control.html#home")', 'location.replace(finish)', 'location.replace(unfinished ? finish : (next || "mnet.html"))', 'location.href = "forgot-password.html"', 'location.replace("mnet.html")', 'location.reload()', 'signInWithProvider(']
  };
  const nav = /\b(?:location\.(?:href\s*=(?!=)|assign\(|replace\(|reload\()|window\.open\(|signInWithProvider\()/g;
  for (const [file, known] of Object.entries(KNOWN)) {
    const src = read(file);
    const found = [...src.matchAll(nav)].map((m) => src.slice(m.index, src.indexOf('\n', m.index)).trim());
    for (const line of found) {
      const hit = known.some((k) => line.startsWith(k));
      assert.ok(hit, `${file}: a script navigation this guard has not classified: ${line.slice(0, 120)}`);
    }
  }
  assert.match(read('js/music-creator-profile.js'), /MCC_MUSIC_VIEW[\s\S]{0,160}navigate\(\s*out\.data\.url\s*\)/, 'the licence checkout leaves through the view API in a view');
  assert.match(read('account.html'), /MCC_MUSIC_VIEW[\s\S]{0,200}signInWithProvider/, 'a provider starts in the top window in a view');
});

/* ---------- concealment ---------- */
test('the concealment allow-list keeps every fixed transport, chrome and status element of the stage pages on screen', () => {
  const { core } = shell();
  const ALLOW = core.ALLOW;
  const allowed = (sel) => ALLOW.some((a) => a === sel);
  /* body-level elements the stage pages and their scripts put on screen, and what each is */
  const KEEP = ['.appbar', '.mcc-auth-nav', '#mccProfileMenu', '#mccDestinations', '.cmdk-owner-nav', '.cmdk', '.mhd', '.pt-veil', '.dk-peek',
    '#musicMini', '#musicNow', '#deckbar', '#now', '#seekStatus', '.ltoast', '.intu', '#mccWorldAudioShell', '#mccWorldAudioControls', '#mccPrivacyNotice', '#mccMusicView', '#mccHold'];
  for (const sel of KEEP) assert.ok(allowed(sel), `${sel} must stay on screen over a view`);
  /* every element the stage pages' scripts append to the body is classified: kept above, or page content */
  /* page content (concealed with the page): the room's canvas and its premiere, the label's sheet, the masthead's page
     action, the licence desk, the CRM form, the pocket (never on a music page), and a sign-in link's error banner on arrival */
  const CONTENT = { 'js/chamber.js': 2, 'js/label.js': 1, 'js/masthead.js': 1, 'js/licensedesk.js': 1, 'js/crm.js': 1, 'js/pip.js': 1, 'js/backend.js': 1 };
  const KEPT = { 'js/tabbar.js': 5, 'js/music-engine.js': 2, 'js/world-audio-continuity.js': 2, 'js/site-navigation.js': 2, 'js/label.js': 1, 'js/masthead.js': 1, 'js/intuition.js': 1, 'js/control-palette.js': 2, 'js/gated-audio.js': 1 };
  const pages = ['listen.html', 'music-creator.html', 'album.html'];
  const scripts = new Set(['js/tabbar.js', 'js/music-engine.js', 'js/world-audio-continuity.js', 'js/site-navigation.js', 'js/live-content.js']);
  for (const p of pages) for (const m of read(p).matchAll(/<script\b[^>]*\bsrc="(js\/[^"?]+)/g)) scripts.add(m[1]);
  for (const s of scripts) {
    let n = 0;
    try { n = (read(s).match(/\b(?:document|doc)\.body\.appendChild\(/g) || []).length; } catch { continue; }
    const known = (CONTENT[s] || 0) + (KEPT[s] || 0);
    assert.equal(n, known, `${s} appends ${n} element(s) to the body; classify each as kept over a view or as page content`);
  }
  /* the stage pages' own body-level markup with a role of status or a fixed transport */
  for (const p of pages) {
    const body = read(p).split(/<body[^>]*>/)[1] || '';
    for (const m of body.matchAll(/<(?:div|nav|aside|section)\b[^>]*\b(?:id="(deckbar|now|seekStatus)"|class="(appbar)")/g)) {
      const sel = m[1] ? '#' + m[1] : '.' + m[2];
      assert.ok(allowed(sel), `${p}: ${sel} must stay on screen over a view`);
    }
  }
});

/* ---------- the stage pages ---------- */
test('each stage page carries its view marker on <html> only, with js/shell-boot.js still first in its head', () => {
  for (const [page, kind] of [['listen.html', 'listen'], ['music-creator.html', 'artist'], ['album.html', 'album'], ['account.html', 'account']]) {
    const src = read(page);
    const html = /<html\b[^>]*>/.exec(src)[0];
    assert.match(html, new RegExp(`\\bdata-music-view="${kind}"`), `${page} names its kind on <html>`);
    assert.equal((src.match(/data-music-view=/g) || []).length, 1, `${page}: the marker is on <html> and nowhere else`);
    assert.match(src, /<head><script src="js\/shell-boot\.js\?v=__STAMP__"><\/script>/, `${page}: js/shell-boot.js is the first thing in its head`);
  }
  assert.doesNotMatch(read('index.html'), /data-music-view/, 'the front page is never a view (hard rule 3)');
});

/* ---------- ENGINE STAGE 0, THE REVIEW'S FINDINGS (2026-11-24) ---------- */
/* What the stage 0 review found in M5's history, views and sign-in, held here in Node; the browser half is in
   scripts/e2e/music-shell.e2e.mjs (the scenarios named after the same findings). Three small stand-ins: a session
   history (entries with their address and state, Back and Forward that move the address and fire popstate, every
   page load asked for recorded and never made), a clock moved by hand, and a view's window. */
function session(win, entries, at) {
  const h = { entries: entries.map((e) => ({ url: new URL(e.url, HOUSE).href, state: e.state ?? null })), at, loads: [], reloads: 0 };
  const loc = { protocol: 'https:', hostname: 'matthew.mccluster.org', origin: HOUSE, now: '' };
  Object.defineProperties(loc, {
    href: { get() { return loc.now; }, set(v) { h.loads.push(['push', new URL(v, loc.now).href]); }, enumerable: true },
    pathname: { get() { return new URL(loc.now).pathname; }, enumerable: true },
    search: { get() { return new URL(loc.now).search; }, enumerable: true },
    hash: { get() { return new URL(loc.now).hash; }, enumerable: true }
  });
  loc.replace = (v) => { h.loads.push(['replace', new URL(v, loc.now).href]); };
  loc.assign = (v) => { h.loads.push(['push', new URL(v, loc.now).href]); };
  loc.reload = () => { h.reloads++; };
  win.location = loc;
  const copy = (s) => (s == null ? null : JSON.parse(JSON.stringify(s)));
  const sync = () => { loc.now = h.entries[h.at].url; win.history.state = copy(h.entries[h.at].state); };
  const to = (u) => new URL(u == null || u === '' ? loc.now : u, loc.now).href;
  win.history.pushState = (s, t, u) => { h.entries.splice(h.at + 1); h.entries.push({ url: to(u), state: copy(s) }); h.at++; sync(); };
  win.history.replaceState = (s, t, u) => { h.entries[h.at] = { url: to(u), state: copy(s) }; sync(); };
  Object.defineProperty(win.history, 'length', { get: () => h.entries.length, configurable: true });
  h.go = (d) => { h.at += d; sync(); (win.__listeners.popstate || []).forEach((f) => f({ state: win.history.state })); };
  h.back = () => h.go(-1);
  h.forward = () => h.go(1);
  h.here = () => loc.now.replace(HOUSE, '');
  /* a navigation inside the view's frame that adds an entry of its own (the joint session history: the top keeps its
     address and state, the entry is the frame's) */
  h.frameEntry = () => { h.entries.splice(h.at + 1); h.entries.push({ ...h.entries[h.at], state: copy(h.entries[h.at].state) }); h.at++; };
  sync();
  return h;
}
function clock(win) {
  let now = 0, seq = 0;
  const due = [];
  win.setTimeout = (fn, ms) => { const id = ++seq; due.push({ id, fn, at: now + (Number(ms) || 0) }); return id; };
  win.clearTimeout = (id) => { const i = due.findIndex((t) => t.id === id); if (i >= 0) due.splice(i, 1); };
  return {
    advance(ms) {
      const end = now + ms;
      for (;;) {
        due.sort((a, b) => a.at - b.at || a.id - b.id);
        if (!due.length || due[0].at > end) break;
        const t = due.shift(); now = t.at; t.fn();
      }
      now = end;
    }
  };
}
/* a retained page with its session history and clock; frames() lists every view frame the shell has made */
function retained({ path, search = '', marker, entries, at, extra = {} }) {
  const win = browserWindow({ path, search, marker, extra: { ...OBSERVER, scrollTo: (x, y) => { win.__scrolled = y; }, ...extra } });
  const t = clock(win);
  const h = session(win, entries || [{ url: path + search, state: null }], at == null ? (entries ? entries.length - 1 : 0) : at);
  run('js/music-shell.js', win);
  const frames = () => (win.__appended[0] ? win.__appended[0].children.filter((c) => typeof c.src === 'string') : []);
  return { win, S: win.MCC_MUSIC_SHELL, t, h, frames };
}
/* the view document in a frame the shell made, adopted and painted (its own window: scroll, history, listeners) */
function adoptIn(top, frame, path, search, marker) {
  const view = browserWindow({ path, search, marker, top: false, parent: top, frameElement: frame,
    extra: { requestAnimationFrame: (fn) => { fn(); return 1; }, scrollTo: (x, y) => { view.__scrolledTo = y; view.scrollY = y; } } });
  const api = top.MCC_MUSIC_SHELL.adopt(view);
  return { view, api };
}
const ART = HOUSE + '/music-creator.html?handle=probe-artist', LISTEN = HOUSE + '/listen.html';

/* JRN-1 (blocker): the entries one retained document pushed share its document state. A reload at a view's address, or
   a return to it from a page out of music, makes a new retained document that inherits them, so Back to the first
   document's own entry is a pop inside the new one. That entry names no view, nothing is shown, and the shell stayed:
   the artist page on screen at Listen's address, its head and its bar. Release 1 showed Listen there. */
test('JRN-1: Back onto an entry another document wrote shows the page at that address (a view), never the retained page under it', () => {
  /* Listen, then an artist card (a view), then a reload there: the artist page is the retained document */
  const r = retained({ path: '/music-creator.html', search: '?handle=probe-artist', marker: 'artist', entries: [
    { url: '/listen.html', state: { mccMusicShell: { top: true, scroll: 268 } } },
    { url: '/music-creator.html?handle=probe-artist', state: { mccMusicView: { href: ART, from: LISTEN, scroll: 0 } } }] });
  assert.ok(r.S.active(), 'the artist page is the retained document');
  assert.ok(r.h.entries[1].state.mccMusicShell && !r.h.entries[1].state.mccMusicView, 'its own entry names no view any more (as before)');
  r.h.back();
  assert.equal(r.h.here(), '/listen.html');
  assert.deepEqual(r.frames().map((f) => f.src), [LISTEN], 'Back to Listen\'s address shows Listen: a view of it over the artist page');
  assert.equal(r.h.entries.length, 2, 'Back writes no entry of its own');
  assert.deepEqual(r.h.entries[0].state, { mccMusicView: { href: LISTEN, from: ART, scroll: 268 } },
    'the entry now names the view it shows, from the page shown before, at Listen\'s own scroll');
  assert.equal(r.h.reloads + r.h.loads.length, 0, 'and no page load');
  const listen = adoptIn(r.win, r.frames()[0], '/listen.html', '', 'listen');
  assert.ok(listen.api, 'the view at that address is adopted');
  assert.equal(r.S.view(), LISTEN, 'Listen is shown');
  assert.equal(listen.api.referrer, ART, 'its referrer is the page shown before the Back');
  /* Forward: the artist page's own entry reveals it */
  r.h.forward();
  assert.equal(r.S.view(), null, 'Forward to the artist page\'s own entry reveals it');
  /* and Back again: the entry now names Listen's view, which is built again */
  r.h.back();
  assert.equal(r.frames().filter((f) => f.src === LISTEN).length, 2, 'Back again builds Listen\'s view from its entry');
});
test('JRN-1: an entry another document wrote at an address this document cannot show is a page load of that address', () => {
  /* a stand-in for an entry no music view can show (a page out of music): the browser would have loaded it */
  const r = retained({ path: '/listen.html', marker: 'listen', entries: [
    { url: '/creator.html', state: { mccMusicShell: { top: true, scroll: 0 } } },
    { url: '/listen.html', state: null }] });
  r.h.back();
  assert.equal(r.h.reloads, 1, 'the page at that address is loaded (location.reload())');
  assert.equal(r.frames().length, 0, 'never a view of it');
});
test('JRN-1: an entry naming a view of the retained page itself reveals the retained page (never the page in a frame over itself)', () => {
  /* written by an artist page that showed Listen as a view; Listen, reloaded later, is the retained document now */
  const r = retained({ path: '/listen.html', marker: 'listen', entries: [
    { url: '/listen.html', state: { mccMusicView: { href: LISTEN, from: ART, scroll: 0 } } },
    { url: '/music-creator.html?handle=probe-artist', state: { mccMusicShell: { top: true, scroll: 0 } } },
    { url: '/listen.html', state: null }] });
  r.h.back();
  assert.deepEqual(r.frames().map((f) => f.src), [ART], 'Back to the artist page\'s address shows it as a view over Listen');
  adoptIn(r.win, r.frames()[0], '/music-creator.html', '?handle=probe-artist', 'artist');
  assert.equal(r.S.view(), ART);
  r.h.back();
  assert.equal(r.frames().filter((f) => f.src === LISTEN).length, 0, 'no Listen view over the retained Listen');
  assert.equal(r.S.view(), null, 'the retained Listen is revealed');
});

/* JRN-2 (blocker): music-creator.html loads neither js/listen-ledger.js nor js/pip.js, and the engine counts and banks
   through the retained window's MCC_LISTENS and MCC_POCKET, so a catalogue song chosen in Listen over an artist page was
   never counted and never banked. SPEC-M5 3.3: the shell loads both into an artist-page retained document. */
test('JRN-2: the first Listen view over an artist page loads the listen ledger and the pocket into it, once, after its own load', () => {
  const r = retained({ path: '/music-creator.html', search: '?handle=probe-artist', marker: 'artist' });
  const scripts = () => r.win.document.head.appended.filter((n) => /(^|\/)js\//.test(String(n.src || ''))).map((n) => String(n.src).replace(/^.*?(?=js\/)/, ''));
  assert.equal(r.S.navigate('listen.html'), true, 'the artist page opens Listen as a view');
  r.t.advance(0);
  assert.deepEqual(scripts(), ['js/listen-ledger.js?v=__STAMP__', 'js/pip.js?v=__STAMP__'], 'the ledger, then the pocket, the same files Listen loads');
  r.S.navigate('music-creator.html?handle=probe-artist');   /* back to the artist page (a reveal) */
  r.S.navigate('listen.html'); r.t.advance(0);
  assert.equal(scripts().length, 2, 'once per document');
  /* only a Listen view needs them: an artist view over an artist page plays the artists\' own releases */
  const a = retained({ path: '/music-creator.html', search: '?handle=probe-artist', marker: 'artist' });
  a.S.navigate('music-creator.html?handle=second-artist'); a.t.advance(0);
  assert.equal(a.win.document.head.appended.filter((n) => /listen-ledger|pip\.js/.test(String(n.src || ''))).length, 0, 'not for an artist view');
  /* Listen carries both itself */
  const l = retained({ path: '/listen.html', marker: 'listen' });
  l.S.navigate('music-creator.html?handle=probe-artist'); l.t.advance(0);
  assert.equal(l.win.document.head.appended.filter((n) => /listen-ledger|pip\.js/.test(String(n.src || ''))).length, 0, 'never on Listen');
  /* still loading: they wait for the page's own DOMContentLoaded work (the engine's restore() runs there, so the
     pocket arriving holds nothing the artist page did not hold before) */
  const early = retained({ path: '/music-creator.html', search: '?handle=probe-artist', marker: 'artist' });
  early.win.document.readyState = 'loading';
  early.S.navigate('listen.html'); early.t.advance(10);
  assert.equal(early.win.document.head.appended.filter((n) => /listen-ledger|pip\.js/.test(String(n.src || ''))).length, 0, 'not before the page has loaded');
  early.win.document.readyState = 'interactive';
  (early.win.__docListeners.DOMContentLoaded || []).forEach((f) => f());
  early.t.advance(0);
  assert.equal(early.win.document.head.appended.filter((n) => /listen-ledger|pip\.js/.test(String(n.src || ''))).length, 2, 'then both');
});

/* JRN-4 (major): the chip stays on screen over the account view; a second tap made an account view whose next was the
   account page itself, which account.html refuses, so the password sign-in went on to the World as a page load */
test('JRN-4: the Sign in chip tapped again over the sign-in view keeps that view; its way back stays the page under it', () => {
  const { core } = shell();
  const top = { kind: 'listen', url: '/listen.html' };
  const over = core.decide('account.html', 'top', top, core.ROUTES, HOUSE + '/account.html?next=%2Flisten.html');
  assert.equal(over.action, 'scroll', 'the sign-in view is the page shown: it goes to its top, no second account view');
  assert.equal(new URL(over.url).searchParams.get('next'), '/listen.html', 'and never names the account page as the way back');
  const settings = core.decide('account.html', 'top', top, core.ROUTES, HOUSE + '/account.html?stay=1');
  assert.equal(settings.action, 'view');
  assert.equal(new URL(settings.url).searchParams.get('next'), '/listen.html', 'over the settings view, the way back is the retained page');
  /* the chip itself, on the retained Listen with the sign-in view shown */
  const r = retained({ path: '/listen.html', marker: 'listen' });
  r.S.navigate('account.html');
  assert.equal(r.h.here(), '/account.html?next=%2Flisten.html');
  adoptIn(r.win, r.frames()[0], '/account.html', '?next=%2Flisten.html', 'account');
  const chip = { href: HOUSE + '/account.html', target: '', hasAttribute: () => false, closest(sel) { return sel === 'a[href]' ? this : null; } };
  const e = tap(chip);
  (r.win.__docListeners.click || [])[0](e);
  assert.equal(e.prevented, 1, 'the shell takes the tap');
  assert.equal(r.h.entries.length, 2, 'no entry written');
  assert.equal(r.frames().length, 1, 'no second account view');
  assert.equal(r.h.here(), '/account.html?next=%2Flisten.html', 'the address keeps the way back to Listen');
});

/* MSL-1 (major): a second open before the first view painted (a double tap; another link while one is opening) pushed a
   second entry and made a second frame (a second page_view) */
test('MSL-1: a view asked for again while it opens is the same view: one frame, one entry, one Back to Listen', () => {
  const r = retained({ path: '/listen.html', marker: 'listen' });
  r.S.navigate('music-creator.html?handle=probe-artist');
  r.S.navigate('music-creator.html?handle=probe-artist');   /* a double tap, 60 ms later */
  assert.equal(r.frames().length, 1, 'one frame (one document, one page_view)');
  assert.deepEqual(r.h.entries.map((e) => e.url.replace(HOUSE, '')), ['/listen.html', '/music-creator.html?handle=probe-artist'], 'one entry for it');
  assert.deepEqual(r.h.entries[0].state, { mccMusicShell: { top: true, scroll: 0 } }, 'Listen\'s entry keeps its own scroll');
  r.h.back();
  assert.equal(r.h.here(), '/listen.html', 'one Back is Listen');
});
test('MSL-1: another view asked for while one still opens takes its entry: Back is the page the person saw, never the one they skipped', () => {
  const r = retained({ path: '/listen.html', marker: 'listen' });
  r.S.navigate('music-creator.html?handle=probe-artist');
  r.S.navigate('music-creator.html?handle=second-artist');
  assert.deepEqual(r.h.entries.map((e) => e.url.replace(HOUSE, '')), ['/listen.html', '/music-creator.html?handle=second-artist'],
    'the second artist\'s entry replaced the first\'s, which never showed');
  assert.equal(r.h.entries[1].state.mccMusicView.from, LISTEN, 'its referrer is the page shown, Listen');
  assert.deepEqual(r.h.entries[0].state, { mccMusicShell: { top: true, scroll: 0 } }, 'Listen\'s entry untouched by the second open');
  adoptIn(r.win, r.frames()[1], '/music-creator.html', '?handle=second-artist', 'artist');
  r.h.back();
  assert.equal(r.h.here(), '/listen.html');
  assert.equal(r.S.view(), null, 'one Back reveals Listen');
});

/* JRN-5 (minor): a view's scroll reached its entry only when another entry was written, so a view left by Back came back
   at the top on Forward */
test('JRN-5: a view\'s scroll is kept on its own entry as it changes, so Forward after Back finds it; and the retained page\'s too', () => {
  const r = retained({ path: '/listen.html', marker: 'listen' });
  r.S.navigate('music-creator.html?handle=probe-artist');
  const a = adoptIn(r.win, r.frames()[0], '/music-creator.html', '?handle=probe-artist', 'artist');
  a.view.scrollY = 305;
  (a.view.__listeners.scroll || []).forEach((f) => f({}));
  r.t.advance(1000);
  assert.equal(r.h.entries[1].state.mccMusicView.scroll, 305, 'the view\'s entry holds where it was scrolled to');
  r.h.back();
  assert.equal(r.S.view(), null, 'Back reveals Listen');
  r.win.scrollY = 480;
  (r.win.__listeners.scroll || []).forEach((f) => f({}));
  r.t.advance(1000);
  assert.equal(r.h.entries[0].state.mccMusicShell.scroll, 480, 'Listen\'s entry holds its scroll too, once a view has been shown over it');
  r.h.forward();
  const again = adoptIn(r.win, r.frames()[1], '/music-creator.html', '?handle=probe-artist', 'artist');
  assert.equal(again.view.__scrolledTo, 305, 'Forward builds the view again at its scroll');
  r.h.back();
  assert.equal(r.win.__scrolled, 480, 'and Back reveals Listen at its own');
});

/* JRN-6 (minor): a script navigation inside a view (Listen's search Enter: location.href in the frame) adds the frame's
   own entry before the shell stops it; routed as a page load of the top it pushed one more, so one Back did nothing */
test('JRN-6: a script navigation in a view that added the frame\'s own entry, routed to a page load of the top, replaces that entry', () => {
  const r = retained({ path: '/music-creator.html', search: '?handle=probe-artist', marker: 'artist' });
  r.S.navigate('listen.html'); r.t.advance(0);
  const l = adoptIn(r.win, r.frames()[0], '/listen.html', '', 'listen');
  assert.ok(l.api);
  r.h.frameEntry();   /* the frame's location.href = album.html?... */
  const stray = browserWindow({ path: '/album.html', search: '?album=here&t=Lightroom', top: false, parent: r.win, frameElement: r.frames()[0] });
  r.S.unexpected(stray);
  r.t.advance(0);
  assert.deepEqual(r.h.loads, [['replace', HOUSE + '/album.html?album=here&t=Lightroom']], 'the album loads in the frame entry\'s place: one navigation, one entry');
  /* a frame that replaced its own entry (account.html's way on, location.replace) adds none: the top's load is pushed, as before */
  const p = retained({ path: '/listen.html', marker: 'listen' });
  p.S.navigate('music-creator.html?handle=probe-artist');
  adoptIn(p.win, p.frames()[0], '/music-creator.html', '?handle=probe-artist', 'artist');
  const out = browserWindow({ path: '/index.html', top: false, parent: p.win, frameElement: p.frames()[0] });
  p.S.unexpected(out);
  p.t.advance(0);
  assert.deepEqual(p.h.loads, [['push', HOUSE + '/index.html']], 'a navigation that added no entry is pushed (Back is the page the person was on)');
});
