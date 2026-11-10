import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function checker() {
  const src = await readFile(join(ROOT, 'js/name-integrity.js'), 'utf8');
  const window = {};
  vm.runInNewContext(src, { window, Set, String, RegExp });
  return window.MCC_NAME_INTEGRITY;
}

test('name integrity accepts ordinary international name shapes', async () => {
  const c = await checker();
  for (const pair of [
    ['Matthew', 'McCluster'],
    ['Anne-Marie', "O'Neill"],
    ['José', 'García'],
    ['Jean', 'de la Cruz']
  ]) assert.equal(c.validate(pair[0], pair[1]).ok, true, pair.join(' '));
});

test('name integrity rejects obvious garbage without pretending to verify identity', async () => {
  const c = await checker();
  for (const pair of [
    ['dog', 'chicken feet'],
    ['test', 'user'],
    ['asdf', 'qwerty'],
    ['John123', 'Smith'],
    ['aaaaaa', 'bbbbbb']
  ]) assert.equal(c.validate(pair[0], pair[1]).ok, false, pair.join(' '));
});

test('account intake source names the screen as plausibility screening, not ID verification', async () => {
  const src = await readFile(join(ROOT, 'js/name-integrity.js'), 'utf8');
  assert.match(src, /NOT government-ID\s*verification/i);
});


/* ONE SIGN-UP (owner, 2026-10-20: "that 3-panel profile sign up thing … should be the new sign up thing"). The
   account page's own long create form is gone: Create account hands off to the World's sign-up (an email and a
   password, then the three pages). Its rules are kept there, asked once: a plausible legal first and last name, the
   whole mailing address, and the privacy acknowledgement recorded with the account. */
test('account creation requires legal first and last name, mailing address and privacy acknowledgement', async () => {
  const html = await readFile(join(ROOT, 'account.html'), 'utf8');
  const mnet = await readFile(join(ROOT, 'mnet.html'), 'utf8');
  const js = await readFile(join(ROOT, 'js/mnet.js'), 'utf8');
  for (const id of ['acCreateFirst','acCreateLast','acCreateAddr1','acCreateCity','acCreateRegion','acCreatePostal','acCreateCountry','acCreatePrivacy','acCreatePass']) {
    assert.doesNotMatch(html, new RegExp('id="' + id + '"'), id + ' belongs to the one sign-up, not a second form');
  }
  assert.match(html, /<a class="ac__btn" id="acCreateGo" href="mnet\.html\?join=1">Create account<\/a>/, 'Create account is the one sign-up');
  assert.match(html, /el\("acCreateGo"\)\.href = "mnet\.html\?join=1" \+ \(NEXT \? "&next=" \+ encodeURIComponent\(NEXT\) : ""\)/, 'and it carries where the person started');
  /* the rules, on the pages that ask for them */
  assert.match(mnet, /<script src="js\/name-integrity\.js\?v=__STAMP__"><\/script>/);
  assert.match(js, /named = MCC_NAME_INTEGRITY\.validate\(parts\.shift\(\) \|\| "", parts\.join\(" "\)\)/, 'page 2 screens the legal name');
  assert.match(js, /var missing = \["mnLegalName", "mnAddr1", "mnCity", "mnRegion", "mnPostal", "mnCountry"\]/, 'page 2 requires the whole address');
  assert.match(js, /Fill in your legal name and the whole address\./);
  /* the agreement is asked once: agreed on the way in reads a line; only seen ticks one box. Seen is never recorded as agreed. */
  assert.match(js, /var ack = create && privacyAgreed\(\) \? \{ privacy_policy_version: MCC_PRIVACY\.version, privacy_acknowledged_at: new Date\(\)\.toISOString\(\) \} : \{\};/, 'the agreement is recorded with the account');
  assert.match(js, /if \(create && !privacyAgreed\(\)\) \{\n\s*if \(!\$\("mnCreateAgreeBox"\)\.checked\) \{ authFail\("Tick the box to agree to the Privacy Policy\.", "mnCreateAgreeBox", "privacy_unchecked"\); return; \}\n\s*try \{ MCC_PRIVACY\.acknowledge\(\); \} catch \(e\) \{\}/, 'no agreement, no account');
  assert.match(js, /return !!\(window\.MCC_PRIVACY && MCC_PRIVACY\.accepted && MCC_PRIVACY\.accepted\(\)\);/, 'agreed, never merely seen');
  assert.match(mnet, /<p class="mn__hint" id="mnCreatePrivacy" hidden>Creating an account means you agree to the <a href="privacy\.html">Privacy Policy<\/a>\.<\/p>/);
  assert.match(mnet, /<label class="mn__check" id="mnCreateAgree" hidden><input type="checkbox" id="mnCreateAgreeBox"><span>I agree to the <a href="privacy\.html">Privacy Policy<\/a>\.<\/span><\/label>/);
  assert.match(await readFile(join(ROOT, 'js/live-content.js'), 'utf8'), /var VERSION = "2026-10-19"/, 'the version the person agreed to on the way in');
});

test('site entry gate is versioned and analytics stays off before acknowledgement', async () => {
  const live = await readFile(join(ROOT, 'js/live-content.js'), 'utf8');
  const analytics = await readFile(join(ROOT, 'js/analytics.js'), 'utf8');
  assert.match(live, /var VERSION = "2026-10-19"/);
  assert.match(live, /I agree &amp; continue/);
  assert.match(live, /page === "privacy\.html"/, 'the policy itself must remain readable');
  assert.match(live, /'<small>Privacy notice version ' \+ VERSION \+ '<\/small>'/, 'the wall names the one version constant, never a second copy');
  assert.match(analytics, /if \(mccPrivacyAcknowledged\(\) && !mccControlPreview\(\)\) \{/, 'agreed, and not the owner\'s Control Room preview');
  assert.match(analytics, /window\.MCC_PRIVACY\.accepted\(\)/, 'analytics asks the notice when the page loads it');
  assert.match(analytics, /window\.MCC_TRACK = function \(\) \{ return false; \}/);
});

/* ---------- THE NOTICE, ONCE: a browser without a DOM ----------
   The privacy block of js/live-content.js runs here against a cookie jar
   that keeps Domain= the way a browser does, per-origin storage, timers that
   run only when the test says so, and just enough document to see what the
   notice mounted. One jar across several "hosts" is one visitor moving
   between McCluster's sites.
   A listener stays until it is removed, the way a browser keeps it, unless it
   was added { once: true }; dispatch(type, detail, more) hands the listeners
   one event object (more: persisted, defaultPrevented, key). loading: true is
   the script running in the head, before the body exists; ready() is
   DOMContentLoaded. */
const PRIVACY_VERSION = '2026-10-19';
function jar() {
  const all = new Map();
  return {
    all,
    forHost(host) {
      return {
        get() {
          return [...all.values()].filter((c) => c.hostOnly ? c.domain === host : host === c.domain || host.endsWith('.' + c.domain)).map((c) => c.name + '=' + c.value).join('; ');
        },
        set(text) {
          const [pair, ...attrs] = String(text).split(';').map((s) => s.trim());
          const eq = pair.indexOf('=');
          const name = pair.slice(0, eq), value = pair.slice(eq + 1);
          const a = Object.fromEntries(attrs.map((s) => { const i = s.indexOf('='); return i < 0 ? [s.toLowerCase(), true] : [s.slice(0, i).toLowerCase(), s.slice(i + 1)]; }));
          const domain = a.domain ? String(a.domain).replace(/^\./, '').toLowerCase() : host;
          if (a.domain && !(host === domain || host.endsWith('.' + domain))) return; // a browser refuses a foreign Domain
          const key = name + '|' + (a.domain ? '.' : '') + domain;
          if (a['max-age'] !== undefined && Number(a['max-age']) <= 0) { all.delete(key); return; }
          all.set(key, { name, value, domain, hostOnly: !a.domain, attrs: a, text });
        }
      };
    }
  };
}
function storage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, map: m };
}
function jwt(payload) {
  return 'h.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.s';
}
let gateSource;
async function visit({ url, cookies, local, session, framed = false, cookieThrows = false, fetchImpl, MCC, pageNodes = [], referrer = '', historyLength = 1, loading = false } = {}) {
  if (!gateSource) {
    const src = await readFile(join(ROOT, 'js/live-content.js'), 'utf8');
    const end = src.indexOf('/* ============================================================\n   LIVE CONTENT');
    assert.ok(end > 0, 'the privacy block ends where live content begins');
    gateSource = src.slice(0, end);
  }
  const u = new URL(url);
  const html = u.pathname.split('/').pop() || 'index.html';
  const banner = /^(resume-it-support|press|newsroom|hire)\.html$/.test(html);
  const nodes = new Map(), timers = [], listeners = {}, docListeners = {}, fetches = [], appended = [];
  let reloads = 0, backs = 0, replaced = [], timerId = 0, focused = null, lifted = 0;
  const register = (node) => {
    if (node.id) nodes.set(node.id, node);
    for (const m of String(node.innerHTML || '').matchAll(/id="([^"]+)"/g)) nodes.set(m[1], element('button', m[1], node));
  };
  function element(tag, id = '', parent = null) {
    const node = {
      tagName: tag.toUpperCase(), id, attrs: {}, listeners: {}, hidden: false, disabled: false, removed: false, parent, innerHTML: '', textContent: '',
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
      click() { for (const f of this.listeners.click || []) f({ type: 'click' }); },
      focus() { focused = this; }, appendChild(c) { return c; },
      remove() { this.removed = true; for (const [k, v] of nodes) if (v === this || v.parent === this) nodes.delete(k); }
    };
    return node;
  }
  const docEl = element('html');
  const dropAttribute = docEl.removeAttribute;
  docEl.removeAttribute = function (k) { if (k === 'data-privacy-gate') lifted++; dropAttribute.call(this, k); };
  for (const id of pageNodes) nodes.set(id, element('div', id));
  const meta = banner ? Object.assign(element('meta'), { attrs: { name: 'mcc-privacy-notice', content: 'banner' } }) : null;
  const cookieApi = (cookies || jar()).forHost(u.hostname);
  const body = { appendChild(n) { appended.push(n); register(n); return n; } };
  const document = {
    readyState: loading ? 'loading' : 'complete', referrer, documentElement: docEl, visibilityState: 'visible',
    head: { appendChild(n) { appended.push(n); return n; } },
    body: loading ? null : body,
    createElement: (tag) => element(tag),
    getElementById: (id) => nodes.get(id) || null,
    querySelector: (sel) => (sel === 'meta[name="mcc-privacy-notice"]' ? meta : null),
    addEventListener(t, f) { (docListeners[t] ||= []).push(f); }
  };
  Object.defineProperty(document, 'cookie', {
    get() { if (cookieThrows) throw new Error('SecurityError: sandboxed'); return cookieApi.get(); },
    set(v) { if (cookieThrows) throw new Error('SecurityError: sandboxed'); cookieApi.set(v); }
  });
  const window = {
    localStorage: local || storage(), sessionStorage: session || storage(),
    addEventListener(t, f, o) { (listeners[t] ||= []).push({ f, once: !!(o && o.once) }); },
    history: { length: historyLength, back() { backs++; } },
    MCC
  };
  window.top = framed ? {} : window;
  const location = { pathname: u.pathname, hostname: u.hostname, href: u.href, hash: u.hash, reload() { reloads++; }, replace(to) { replaced.push(to); } };
  const fetch = (href, init) => { fetches.push({ href, init }); return fetchImpl ? fetchImpl(href, init) : Promise.resolve({ ok: true }); };
  vm.runInNewContext(gateSource, {
    window, document, location, fetch, atob, URL, JSON, Date, Promise, String, Number, Object, isNaN, Error,
    setTimeout: (fn, ms) => { timers.push({ id: ++timerId, fn, ms }); return timerId; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }
  });
  return {
    window, document, location, fetches,
    get reloads() { return reloads; }, get backs() { return backs; }, get replaced() { return replaced; },
    /* how many times the wall was taken down where it stood */
    get lifted() { return lifted; },
    wall: () => docEl.getAttribute('data-privacy-gate') === 'pending' && !!nodes.get('mccPrivacyGate'),
    banner: () => !!nodes.get('mccPrivacyNotice') && !nodes.get('mccPrivacyNotice').removed,
    shown() { return this.wall() || this.banner(); },
    /* the page under the wall can be neither seen nor touched: the attribute every consumer reads (js/main.js), and the rule that hides the rest of the body */
    concealed: () => docEl.getAttribute('data-privacy-gate') === 'pending' &&
      appended.some((n) => n.id === 'mccPrivacyGateStyle' && !n.removed && String(n.textContent).includes('html[data-privacy-gate="pending"] body>*:not(#mccPrivacyGate){visibility:hidden!important;pointer-events:none!important}')),
    /* the question is on the screen and BOTH answers can be used */
    asked() {
      const agree = nodes.get('mccPrivacyAgree'), back = nodes.get('mccPrivacyBack'), actions = nodes.get('mccPrivacyGateActions'), words = nodes.get('mccPrivacyGateBody');
      return this.wall() && !!agree && !!back && !agree.disabled && !back.disabled && !agree.hidden && !back.hidden && !(actions && actions.hidden) && !(words && words.hidden);
    },
    click: (id) => nodes.get(id).click(),
    key: (id, key) => { let prevented = false; for (const f of nodes.get(id).listeners.keydown || []) f({ type: 'keydown', key, preventDefault() { prevented = true; } }); return prevented; },
    node: (id) => nodes.get(id) || null,
    get focused() { return focused; },
    styleRemoved: () => appended.some((n) => n.id === 'mccPrivacyGateStyle' && n.removed),
    text: (id) => String(nodes.get(id)?.innerHTML || ''),
    dispatch: (t, detail, more = {}) => {
      const e = { type: t, detail, defaultPrevented: false, ...more }, all = listeners[t] || [];
      listeners[t] = all.filter((l) => !l.once);
      for (const l of all) l.f(e);
      return e;
    },
    /* the tab is looked at again, or put away: document.visibilityState and its event */
    visibility: (state) => { document.visibilityState = state; for (const f of docListeners.visibilitychange || []) f({ type: 'visibilitychange' }); },
    ready: () => { document.body = body; document.readyState = 'interactive'; for (const f of (docListeners.DOMContentLoaded || []).splice(0)) f({ type: 'DOMContentLoaded' }); },
    runTimers: (ms = Infinity) => { for (const t of timers.splice(0)) { if (t.ms <= ms) t.fn(); else timers.push(t); } }
  };
}
const flush = () => new Promise((r) => setImmediate(r));

test('the notice: a first visit sees it once, and "I agree" keeps one record every McCluster host reads', async () => {
  const cookies = jar();
  const house = await visit({ url: 'https://matthew.mccluster.org/mnet.html', cookies });
  assert.equal(house.wall(), true, 'a first visit sees the notice');
  assert.match(house.text('mccPrivacyGate'), new RegExp('Privacy notice version ' + PRIVACY_VERSION));
  assert.equal(house.window.MCC_PRIVACY.accepted(), false);
  assert.equal(house.window.MCC_PRIVACY.seen(), false);
  house.click('mccPrivacyAgree');
  await flush();
  assert.equal(house.reloads, 1, 'the wall reloads into the agreed page');
  assert.equal(JSON.parse(house.window.localStorage.getItem('mcc_privacy_ack')).version, PRIVACY_VERSION);
  assert.equal(JSON.parse(house.window.sessionStorage.getItem('mcc_privacy_ack')).version, PRIVACY_VERSION);
  const c = cookies.all.get('mcc_privacy_ack|.mccluster.org');
  assert.ok(c, 'the agreement is a cookie for Domain=mccluster.org');
  assert.equal(c.value, PRIVACY_VERSION, 'the agreed cookie keeps the exact value analytics matches');
  assert.equal(c.attrs.path, '/');
  assert.equal(c.attrs['max-age'], '34560000');
  assert.equal(c.attrs.samesite, 'Lax');
  assert.equal(c.attrs.secure, true);
  assert.equal(house.fetches.length, 0, 'a guest has no account record to write');

  /* the same visitor on the company host, the Globe and the World Music opens: new origin, empty storage */
  for (const url of ['https://mccluster.org/', 'https://mccluster.org/mnet.html?view=feed', 'https://www.mccluster.org/account.html', 'https://matthew.mccluster.org/press.html']) {
    const next = await visit({ url, cookies });
    assert.equal(next.shown(), false, url + ': never shown again');
    assert.equal(next.window.MCC_PRIVACY.accepted(), true, url + ': agreement carries');
    assert.equal(JSON.parse(next.window.localStorage.getItem('mcc_privacy_ack')).version, PRIVACY_VERSION, url + ': the browser copy is filled in');
  }
});

test('unagreed document pages show the same blocking wall, not a dismissible banner', async()=>{
  const cookies = jar();
  const resume = await visit({url:'https://matthew.mccluster.org/resume-it-support.html',cookies});
  assert.equal(resume.wall(),true);
  assert.equal(resume.banner(),false);
  assert.match(resume.text('mccPrivacyGate'),/>Go back<\/button>/);
  assert.equal(resume.window.MCC_PRIVACY.accepted(),false);
  assert.equal(resume.window.MCC_PRIVACY.seen(),false);
  assert.equal(cookies.all.size,0,'merely showing the dialog does not record agreement or seen');
  const next=await visit({url:'https://mccluster.org/mnet.html',cookies});
  assert.equal(next.wall(),true,'unanswered notice is shown again on the next host');
});

test('Go back uses browser history without unlocking the page or recording an answer',async()=>{
  const cookies=jar();
  const v=await visit({url:'https://mccluster.org/mnet.html',cookies,historyLength:3});
  assert.equal(v.wall(),true);
  v.click('mccPrivacyBack');
  assert.equal(v.backs,1);
  assert.equal(v.replaced.length,0);
  assert.equal(v.wall(),true,'gate stays in place until the browser actually navigates');
  assert.equal(v.reloads,0);
  assert.equal(v.window.MCC_PRIVACY.accepted(),false);
  assert.equal(v.window.localStorage.getItem('mcc_privacy_ack'),null);
  assert.equal(v.window.localStorage.getItem('mcc_privacy_seen'),null);
  assert.equal(cookies.all.size,0);
  assert.equal((await visit({url:'https://matthew.mccluster.org/press.html',cookies})).wall(),true);
});

test('Go back with no history returns to a valid referrer, or leaves to a blank page',async()=>{
  const previous='https://example.org/original-article';
  const referred=await visit({url:'https://mccluster.org/mnet.html',referrer:previous,historyLength:1});
  referred.click('mccPrivacyBack');
  assert.deepEqual(referred.replaced,[previous]);
  assert.equal(referred.window.MCC_PRIVACY.accepted(),false);
  const direct=await visit({url:'https://mccluster.org/mnet.html',historyLength:1});
  direct.click('mccPrivacyBack');
  assert.deepEqual(direct.replaced,['about:blank']);
  assert.equal(direct.window.MCC_PRIVACY.accepted(),false);
});

test('Escape acts as Go back instead of hiding the dialog, and cannot cancel pending agreement',async()=>{
  const esc=await visit({url:'https://mccluster.org/mnet.html',historyLength:2});
  assert.equal(esc.key('mccPrivacyGate','Enter'),false);
  assert.equal(esc.key('mccPrivacyGate','Escape'),true);
  assert.equal(esc.backs,1);
  assert.equal(esc.wall(),true);
  assert.equal(esc.window.MCC_PRIVACY.accepted(),false);
  const agreeing=await visit({url:'https://mccluster.org/mnet.html',historyLength:2});
  agreeing.click('mccPrivacyAgree');
  agreeing.click('mccPrivacyBack');
  agreeing.key('mccPrivacyGate','Escape');
  assert.equal(agreeing.node('mccPrivacyBack').disabled,true);
  assert.equal(agreeing.backs,0);
  assert.equal(agreeing.window.MCC_PRIVACY.accepted(),true);
  await flush();
  assert.equal(agreeing.reloads,1);
});

/* A3 (deep audit, 2026-11-09): "Privacy Go back leaves preserved document gate inert". Go back switched the wall's
   answers off for good and trusted the browser to throw the document away. A browser that keeps it (the back/forward
   cache: Go back, then the browser's Forward), a step back that stays in the same document, or a history with nothing
   behind this entry left the visitor behind a wall with nothing to press. Leaving is a transition now: it ends in the
   page being gone, or in the same two answers working again. Nothing here lets anyone in without agreeing. */
test('A3: a page the browser kept and shows again after Go back asks again, and both answers work', async () => {
  const cookies = jar();
  const v = await visit({ url: 'https://mccluster.org/mnet.html', cookies, historyLength: 3 });
  assert.equal(v.asked(), true);
  v.click('mccPrivacyBack');
  assert.equal(v.backs, 1);
  assert.equal(v.node('mccPrivacyBack').disabled, true, 'one tap is one step back: the answers are set aside while the browser leaves');
  v.click('mccPrivacyBack');
  v.click('mccPrivacyAgree');
  await flush();
  assert.equal(v.backs, 1, 'a second tap does not walk back two pages');
  assert.equal(v.reloads, 0, 'and a tap on Agree while the page is leaving is not an agreement');
  assert.equal(v.window.MCC_PRIVACY.accepted(), false);
  /* the document goes into the back/forward cache; the visitor comes Forward to it, and its timers run again */
  v.dispatch('pagehide', undefined, { persisted: true });
  v.dispatch('pageshow', undefined, { persisted: true });
  v.runTimers();
  assert.equal(v.concealed(), true, 'still unanswered, so the page is still behind the wall');
  assert.equal(v.asked(), true, 'and both answers work again');
  assert.equal(v.focused?.id, 'mccPrivacyBack', 'focus is on the answer they used, never moved onto Agree');
  assert.equal(v.window.MCC_PRIVACY.accepted(), false, 'coming back is not an answer');
  assert.equal(cookies.all.size, 0);
  assert.equal(v.window.localStorage.getItem('mcc_privacy_ack'), null);
  /* Go back works again, by history again; so does Escape. A browser that shows the kept document again without
     saying so is still recognised: the page was hidden for a navigation, and here it is shown */
  v.click('mccPrivacyBack');
  assert.equal(v.backs, 2);
  assert.equal(v.node('mccPrivacyBack').disabled && v.node('mccPrivacyAgree').disabled, true, 'while it leaves, both answers are set aside, and visibly: nothing looks pressable that is not');
  v.dispatch('pagehide', undefined, { persisted: true });
  v.dispatch('pageshow', undefined, { persisted: false });
  assert.equal(v.asked(), true);
  assert.equal(v.key('mccPrivacyGate', 'Escape'), true);
  assert.equal(v.backs, 3);
  assert.deepEqual(v.replaced, [], 'history kept working, so nothing was replaced');
  /* the event alone is enough too (no pagehide was seen), and agreeing works on the restored page */
  v.dispatch('pageshow', undefined, { persisted: true });
  assert.equal(v.asked(), true);
  v.click('mccPrivacyAgree');
  await flush();
  assert.equal(v.reloads, 1);
  assert.equal(v.window.MCC_PRIVACY.accepted(), true);
  assert.equal(v.node('mccPrivacyBack').disabled, true, 'agreed: nothing is left to answer while the page reloads');
});

test('A3: Go back that does not leave the document gives the answers back, and the next Go back leaves another way', async () => {
  /* entries exist, but none behind this one (the visitor came BACK to the entry page): history.back() goes nowhere */
  const v = await visit({ url: 'https://mccluster.org/mnet.html', historyLength: 2 });
  v.click('mccPrivacyBack');
  assert.equal(v.backs, 1);
  v.runTimers(1499);
  assert.equal(v.asked(), false, 'the browser gets a moment to leave');
  assert.equal(v.wall(), true);
  v.runTimers(1500);
  assert.equal(v.asked(), true, 'still here: both answers work again');
  assert.equal(v.concealed(), true, 'and the page is still behind the wall');
  assert.equal(v.focused?.id, 'mccPrivacyBack');
  assert.equal(v.window.MCC_PRIVACY.accepted(), false);
  v.click('mccPrivacyBack');
  assert.equal(v.backs, 1, 'history was tried and did not leave, so it is not asked again');
  assert.deepEqual(v.replaced, ['about:blank'], 'nowhere to return to: out to a blank page, never into the site');
  assert.equal(v.window.MCC_PRIVACY.accepted(), false);
  /* the same, for a visitor who came from somewhere */
  const from = 'https://example.org/original-article';
  const referred = await visit({ url: 'https://mccluster.org/mnet.html', referrer: from, historyLength: 2 });
  referred.click('mccPrivacyBack');
  referred.runTimers(1500);
  referred.click('mccPrivacyBack');
  assert.deepEqual(referred.replaced, [from]);
  /* a step back that stays in this document (the page had pushed an entry of its own) */
  const same = await visit({ url: 'https://mccluster.org/mnet.html', historyLength: 3 });
  same.click('mccPrivacyBack');
  same.dispatch('popstate');
  assert.equal(same.asked(), true, 'the step stayed here: the answers work at once');
  same.runTimers();
  same.click('mccPrivacyBack');
  assert.equal(same.backs, 2, 'and the next Go back asks history again: the page before may be next');
  same.dispatch('hashchange');
  assert.equal(same.asked(), true);
  assert.deepEqual(same.replaced, []);
  /* a history step the visitor did not ask for changes nothing */
  const idle = await visit({ url: 'https://mccluster.org/mnet.html', historyLength: 3 });
  idle.dispatch('popstate');
  idle.dispatch('pageshow', undefined, { persisted: false });
  assert.equal(idle.asked(), true);
  assert.equal(idle.backs, 0);
  /* the pageshow every page fires as it finishes loading is not a return: it does not cut the browser's moment short */
  const loading = await visit({ url: 'https://mccluster.org/mnet.html', historyLength: 3 });
  loading.click('mccPrivacyBack');
  loading.dispatch('pageshow', undefined, { persisted: false });
  assert.equal(loading.asked(), false);
  assert.equal(loading.wall(), true);
  /* slow to leave: the answers came back first, then the page did go, and the visitor came Forward to it. History
     worked after all, so the next Go back uses it */
  const slow = await visit({ url: 'https://mccluster.org/mnet.html', historyLength: 3 });
  slow.click('mccPrivacyBack');
  slow.runTimers(1500);
  assert.equal(slow.asked(), true);
  slow.dispatch('pagehide', undefined, { persisted: true });
  slow.dispatch('pageshow', undefined, { persisted: true });
  slow.click('mccPrivacyBack');
  assert.equal(slow.backs, 2, 'the page was left and shown again: history is good');
  assert.deepEqual(slow.replaced, []);
  /* agreeing after a Go back that went nowhere is an ordinary agreement */
  v.runTimers();
  const again = await visit({ url: 'https://mccluster.org/mnet.html', historyLength: 2 });
  again.click('mccPrivacyBack');
  again.runTimers(1500);
  again.click('mccPrivacyAgree');
  await flush();
  assert.equal(again.reloads, 1);
  assert.equal(again.window.MCC_PRIVACY.accepted(), true);
});

test('A3: a wall still up after the visitor agreed somewhere else comes down once, in place, and only for agreement', async () => {
  const ids = ['mccPrivacyAnswer', 'mccPrivacyAnswerStatus', 'mccPrivacyAnswerAgree', 'mccPrivacyAnswerBack'];
  const open = (v, why) => {
    assert.equal(v.shown(), false, why + ': the wall is gone');
    assert.equal(v.document.documentElement.getAttribute('data-privacy-gate'), null, why + ': the page under it can be seen and used');
    assert.equal(v.styleRemoved(), true, why + ': nothing is left hiding the page');
    assert.equal(v.window.MCC_PRIVACY.accepted(), true, why);
    assert.equal(v.reloads, 0, why + ': in place, nothing reloads');
    assert.equal(v.lifted, 1, why + ': once');
  };
  /* reviewed the policy, agreed there, pressed the browser's Back: the entry page is shown again as it was left */
  let cookies = jar();
  const entry = await visit({ url: 'https://mccluster.org/mnet.html', cookies, historyLength: 2 });
  assert.equal(entry.asked(), true);
  (await visit({ url: 'https://mccluster.org/privacy.html', cookies, pageNodes: ids })).click('mccPrivacyAnswerAgree');
  entry.dispatch('pagehide', undefined, { persisted: true });
  entry.dispatch('pageshow', undefined, { persisted: true });
  open(entry, 'agreed on the policy page, then Back');
  assert.equal(JSON.parse(entry.window.localStorage.getItem('mcc_privacy_ack')).version, PRIVACY_VERSION, 'this origin keeps its own copy');
  /* once: nothing later puts it back or takes it down twice */
  entry.dispatch('pageshow', undefined, { persisted: true });
  entry.visibility('visible');
  entry.dispatch('focus');
  entry.runTimers();
  open(entry, 'afterwards');
  assert.equal(entry.fetches.length, 0);

  /* Go back was pressed first, the visitor agreed on the page they went back to, then came Forward */
  cookies = jar();
  const left = await visit({ url: 'https://mccluster.org/mnet.html', cookies, historyLength: 3 });
  left.click('mccPrivacyBack');
  left.dispatch('pagehide', undefined, { persisted: true });
  (await visit({ url: 'https://matthew.mccluster.org/privacy.html', cookies, pageNodes: ids })).click('mccPrivacyAnswerAgree');
  left.dispatch('pageshow', undefined, { persisted: true });
  open(left, 'agreed on the page they went back to, then Forward');
  const rested = left.focused;
  left.runTimers();
  left.dispatch('popstate');
  left.dispatch('hashchange');
  assert.equal(left.focused, rested, 'and nothing reaches for a dialog that is gone');
  open(left, 'afterwards');

  /* another tab of the same site agrees: this tab hears the browser's own storage event */
  const local = storage();
  const tab = await visit({ url: 'https://matthew.mccluster.org/press.html', local });
  tab.dispatch('storage', undefined, { key: 'mcc_other' });
  assert.equal(tab.asked(), true, 'an unrelated change is not an answer');
  (await visit({ url: 'https://matthew.mccluster.org/privacy.html', local, pageNodes: ids })).click('mccPrivacyAnswerAgree');
  tab.dispatch('storage', undefined, { key: 'mcc_privacy_ack' });
  open(tab, 'agreed in another tab of this site');

  /* another McCluster host agrees in another tab: the shared cookie is read when this tab is looked at again */
  cookies = jar();
  const world = await visit({ url: 'https://mccluster.org/mnet.html', cookies });
  world.visibility('hidden');
  (await visit({ url: 'https://matthew.mccluster.org/privacy.html', cookies, pageNodes: ids })).click('mccPrivacyAnswerAgree');
  world.visibility('hidden');
  assert.equal(world.wall(), true, 'a tab nobody is looking at is left alone');
  world.visibility('visible');
  open(world, 'agreed on another McCluster host, then back to this tab');
  cookies = jar();
  const windowed = await visit({ url: 'https://www.mccluster.org/account.html', cookies });
  (await visit({ url: 'https://mccluster.org/privacy.html', cookies, pageNodes: ids })).click('mccPrivacyAnswerAgree');
  windowed.dispatch('focus');
  open(windowed, 'agreed in another window, then this one is focused');

  /* a member signs in in another tab, and their own account record already answers */
  const shared = storage();
  const member = await visit({ url: 'https://mccluster.org/mnet.html', local: shared });
  shared.setItem('mccdb_session', JSON.stringify({ access_token: jwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600, user_metadata: { privacy_policy_version: PRIVACY_VERSION, privacy_acknowledged_at: '2026-10-19T12:00:00Z' } }), refresh_token: 'r' }));
  member.dispatch('storage', undefined, { key: 'mccdb_session' });
  open(member, "the member's own record, signed in from another tab");
  assert.equal(member.fetches.length, 0, 'an existing record is not written again');

  /* and coming back WITHOUT having agreed anywhere changes nothing: every way back still meets the question */
  cookies = jar();
  const still = await visit({ url: 'https://mccluster.org/mnet.html', cookies, historyLength: 2, local: storage({ mcc_privacy_seen: JSON.stringify({ version: PRIVACY_VERSION, seen_at: '2026-10-28T00:00:00Z' }) }) });
  cookies.forHost('mccluster.org').set('mcc_privacy_seen=' + PRIVACY_VERSION + '; Domain=mccluster.org; Path=/');
  still.dispatch('pagehide', undefined, { persisted: true });
  still.dispatch('pageshow', undefined, { persisted: true });
  still.visibility('hidden');
  still.visibility('visible');
  still.dispatch('focus');
  still.dispatch('storage', undefined, { key: 'mcc_privacy_ack' });
  still.dispatch('storage', undefined, { key: null });
  still.dispatch('popstate');
  still.runTimers();
  assert.equal(still.concealed(), true, 'no agreement anywhere: the page stays behind the wall');
  assert.equal(still.asked(), true, 'with both answers working');
  assert.equal(still.window.MCC_PRIVACY.accepted(), false);
  assert.equal(still.window.localStorage.getItem('mcc_privacy_ack'), null, 'and looking again records nothing');
  assert.equal(still.reloads, 0);
  assert.equal(still.lifted, 0);

  /* an agreement given HERE is on its way to a reload: looking again does not take the wall down under it first */
  let written;
  const held = new Promise((r) => { written = r; });
  const agreeing = await visit({ url: 'https://matthew.mccluster.org/mnet.html', local: storage({ mccdb_session: JSON.stringify({ access_token: jwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600, user_metadata: {} }), refresh_token: 'r' }) }), fetchImpl: () => held.then(() => ({ ok: true })) });
  agreeing.click('mccPrivacyAgree');
  await flush();
  agreeing.dispatch('focus');
  agreeing.visibility('visible');
  agreeing.dispatch('pagehide', undefined, { persisted: true });
  agreeing.dispatch('pageshow', undefined, { persisted: true });
  assert.equal(agreeing.wall(), true, 'the wall stays until the page reloads with the agreement in place');
  assert.equal(agreeing.lifted, 0);
  assert.equal(agreeing.asked(), false, 'and nothing is left to answer meanwhile');
  written();
  await flush(); await flush();
  assert.equal(agreeing.reloads, 1);
});

test('the readable policy offers Agree and Go back, with no Not now entry path',async()=>{
  const ids=['mccPrivacyAnswer','mccPrivacyAnswerStatus','mccPrivacyAnswerAgree','mccPrivacyAnswerBack'];
  const cookies=jar();
  const policy=await visit({url:'https://matthew.mccluster.org/privacy.html',cookies,pageNodes:ids,historyLength:2});
  assert.equal(policy.shown(),false,'policy remains readable');
  assert.equal(policy.node('mccPrivacyAnswer').hidden,false);
  assert.match(policy.node('mccPrivacyAnswerStatus').textContent,/not agreed/);
  policy.click('mccPrivacyAnswerBack');
  assert.equal(policy.backs,1);
  assert.equal(policy.window.MCC_PRIVACY.accepted(),false);
  const other=await visit({url:'https://mccluster.org/privacy.html',cookies,pageNodes:ids});
  other.click('mccPrivacyAnswerAgree');
  assert.equal(other.window.MCC_PRIVACY.accepted(),true);
  assert.equal(other.node('mccPrivacyAnswerAgree').hidden,true);
  assert.match(other.node('mccPrivacyAnswerStatus').textContent,/You agreed/);
  assert.equal(other.focused?.id,'mccPrivacyAnswerStatus');
  assert.equal((await visit({url:'https://matthew.mccluster.org/mnet.html',cookies})).shown(),false);
});

test('legacy seen or Not now data is not an agreement and never bypasses entry',async()=>{
  const cookies=jar();
  cookies.forHost('mccluster.org').set('mcc_privacy_seen='+PRIVACY_VERSION+'; Domain=mccluster.org; Path=/');
  const old=await visit({url:'https://mccluster.org/mnet.html',cookies,local:storage({
    mcc_privacy_seen:JSON.stringify({version:PRIVACY_VERSION,seen_at:'2026-10-28T00:00:00Z'})
  })});
  assert.equal(old.wall(),true);
  assert.equal(old.window.MCC_PRIVACY.accepted(),false);
  assert.equal(old.window.MCC_PRIVACY.seen(),false);
  assert.equal(old.window.localStorage.getItem('mcc_privacy_ack'),null);
  old.click('mccPrivacyAgree');await flush();
  assert.equal(old.window.MCC_PRIVACY.accepted(),true);
});

test('the notice: the shared cookie is only for mccluster.org hosts; everywhere else it is host-only', async () => {
  for (const [host, shared] of [['matthew.mccluster.org', true], ['mccluster.org', true], ['www.mccluster.org', true], ['localhost', false], ['humanuprise.com', false], ['evilmccluster.org', false], ['mccluster.org.example.com', false]]) {
    const cookies = jar();
    const v = await visit({ url: 'https://' + host + '/mnet.html', cookies });
    v.click('mccPrivacyAgree');
    const c = [...cookies.all.values()].find((x) => x.name === 'mcc_privacy_ack');
    assert.ok(c, host + ': cookie written');
    assert.equal(c.hostOnly, !shared, host + (shared ? ': Domain=mccluster.org' : ': host-only'));
    if (shared) assert.equal(c.domain, 'mccluster.org');
  }
});

test('the notice: earlier records still count, and the shared cookie is written from them', async () => {
  const seeded = await visit({ url: 'https://matthew.mccluster.org/mnet.html', local: storage({ mcc_privacy_ack: JSON.stringify({ version: PRIVACY_VERSION, accepted_at: '2026-10-19T10:00:00.000Z' }) }) });
  assert.equal(seeded.shown(), false, 'the localStorage record the browser suites seed still counts');
  const cookies = jar();
  cookies.forHost('matthew.mccluster.org').set('mcc_privacy_ack=' + PRIVACY_VERSION + '; Max-Age=31536000; Path=/; SameSite=Lax; Secure');
  const legacy = await visit({ url: 'https://matthew.mccluster.org/mnet.html', cookies });
  assert.equal(legacy.shown(), false, 'the old host-only cookie still counts');
  assert.ok(cookies.all.get('mcc_privacy_ack|.mccluster.org'), 'and is copied to the shared cookie');
  assert.equal((await visit({ url: 'https://mccluster.org/mnet.html', cookies })).shown(), false, 'so the company host knows it too');
  const old = await visit({ url: 'https://matthew.mccluster.org/mnet.html', local: storage({ mcc_privacy_ack: JSON.stringify({ version: '2026-01-01' }) }) });
  assert.equal(old.wall(), true, 'an older version is a new notice');
  const oldCookie = jar();
  oldCookie.forHost('mccluster.org').set('mcc_privacy_seen=2026-01-01; Domain=mccluster.org; Path=/');
  assert.equal((await visit({ url: 'https://mccluster.org/mnet.html', cookies: oldCookie })).wall(), true);
});

test('the notice: never inside a frame, never over the policy, and blocked cookies do not throw', async () => {
  const framed = await visit({ url: 'https://mccluster.org/mnet.html?mcc_audio=1', framed: true });
  assert.equal(framed.shown(), false, 'the page that holds the frame owns the notice');
  assert.equal(framed.document.documentElement.getAttribute('data-privacy-gate'), null);
  assert.equal(framed.window.MCC_PRIVACY.accepted(), false, 'and the frame still records nothing');
  assert.equal((await visit({ url: 'https://matthew.mccluster.org/privacy.html' })).shown(), false);
  const sandboxed = await visit({ url: 'https://matthew.mccluster.org/mnet.html', cookieThrows: true });
  assert.equal(sandboxed.wall(), true, 'no record: the notice still shows');
  sandboxed.click('mccPrivacyAgree');
  assert.equal(sandboxed.window.MCC_PRIVACY.accepted(), true, 'browser storage keeps the answer when cookies are blocked');
});

test("the notice: a signed-in member's own account record is agreement, and agreeing while signed in writes it", async () => {
  const now = Math.floor(Date.now() / 1000) + 3600;
  const signedIn = (meta) => storage({ mccdb_session: JSON.stringify({ access_token: jwt({ sub: 'u1', exp: now, user_metadata: meta }), refresh_token: 'r' }) });
  const cookies = jar();
  const member = await visit({ url: 'https://mccluster.org/mnet.html', cookies, local: signedIn({ privacy_policy_version: PRIVACY_VERSION, privacy_acknowledged_at: '2026-10-19T12:00:00Z' }) });
  assert.equal(member.shown(), false, 'the record answers on any host');
  assert.equal(member.window.MCC_PRIVACY.accepted(), true);
  assert.equal(JSON.parse(member.window.localStorage.getItem('mcc_privacy_ack')).accepted_at, '2026-10-19T12:00:00Z', 'the browser copy keeps the record time');
  assert.ok(cookies.all.get('mcc_privacy_ack|.mccluster.org'), 'and the shared cookie is written for the next host');
  assert.equal(member.fetches.length, 0, 'an existing record is not written again');
  /* the main session cleared by accident, its kept copy still there (js/backend.js and js/mcc-auth.js restore it later) */
  const kept = storage({ mcc_sess_keep: JSON.stringify({ access_token: jwt({ sub: 'u1', exp: now, user_metadata: { privacy_policy_version: PRIVACY_VERSION, privacy_acknowledged_at: '2026-10-19T12:00:00Z' } }), refresh_token: 'r' }) });
  const restored = await visit({ url: 'https://mccluster.org/mnet.html', local: kept });
  assert.equal(restored.shown(), false, 'the kept copy of the session answers too');

  for (const meta of [{}, { privacy_policy_version: '2026-01-01', privacy_acknowledged_at: '2026-01-01T00:00:00Z' }, { privacy_policy_version: PRIVACY_VERSION, privacy_acknowledged_at: 'not a date' }]) {
    const stale = await visit({ url: 'https://matthew.mccluster.org/mnet.html', local: signedIn(meta) });
    assert.equal(stale.wall(), true, JSON.stringify(meta) + ': no current record, so the notice shows');
  }
  let release;
  const held = new Promise((r) => { release = r; });
  const agree = await visit({ url: 'https://matthew.mccluster.org/mnet.html', local: signedIn({}), fetchImpl: () => held.then(() => ({ ok: true })) });
  agree.click('mccPrivacyAgree');
  await flush();
  assert.equal(agree.fetches.length, 1);
  const [{ href, init }] = agree.fetches;
  assert.equal(href, 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/auth/v1/user');
  assert.equal(init.method, 'PUT');
  assert.equal(init.keepalive, true, 'the write outlives the reload');
  assert.equal(init.headers.apikey, 'sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4');
  assert.match(init.headers.authorization, /^Bearer h\./);
  const body = JSON.parse(init.body).data;
  assert.equal(body.privacy_policy_version, PRIVACY_VERSION);
  assert.ok(!Number.isNaN(Date.parse(body.privacy_acknowledged_at)));
  assert.equal(agree.reloads, 0, 'the reload waits a moment for the record');
  release();
  await flush(); await flush();
  assert.equal(agree.reloads, 1);
  const slow = await visit({ url: 'https://matthew.mccluster.org/mnet.html', local: signedIn({}), fetchImpl: () => new Promise(() => {}) });
  slow.click('mccPrivacyAgree');
  await flush();
  slow.runTimers(1500);
  assert.equal(slow.reloads, 1, 'but never longer than a moment');
});

/* A4 (deep audit, 2026-11-09): "Strict privacy entry remains exposed while handoff waits". This test used to expect
   NOTHING on the screen while the handoff ran (pending.shown() === false, three times): the whole page, open to someone
   who had not agreed, for up to ten seconds, on a fragment anyone can write. What it was protecting is kept and named:
   the QUESTION is not asked until the handoff is finished, because the arriving member may already have answered. What
   it allowed is closed: the page is behind the wall from the first instant. */
test('the notice: a cross-host sign-in handoff is finished before the notice looks', async () => {
  const pending = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token' });
  assert.equal(pending.concealed(), true, 'behind the wall while the handoff runs');
  assert.equal(pending.asked(), false, 'and the question is not asked yet');
  pending.dispatch('mcc:handoff', { ok: false });
  assert.equal(pending.wall(), true, 'a failed handoff: look again, and show it');
  assert.equal(pending.asked(), true, 'with both answers working');

  const carried = await visit({ url: 'https://mccluster.org/mnet.html#view=feed&mcc_handoff=token' });
  carried.dispatch('mcc:handoff', { ok: true });
  assert.equal(carried.concealed(), true, 'signed in: still behind the wall');
  assert.equal(carried.asked(), false, 'signed in: the reload is coming');
  carried.runTimers();
  assert.equal(carried.wall(), true, 'if the reload never comes, look again');
  assert.equal(carried.asked(), true);

  const silent = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token' });
  silent.runTimers(9999);
  assert.equal(silent.concealed(), true, 'behind the wall until the wait is over');
  assert.equal(silent.asked(), false);
  silent.runTimers();
  assert.equal(silent.wall(), true, 'a page without the bar does not wait forever');
  assert.equal(silent.asked(), true);

  const agreedMeanwhile = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token' });
  agreedMeanwhile.window.localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: PRIVACY_VERSION }));
  agreedMeanwhile.dispatch('mcc:handoff', { ok: false });
  assert.equal(agreedMeanwhile.shown(), false, 'the look after the handoff reads the records again');
  assert.equal(agreedMeanwhile.document.documentElement.getAttribute('data-privacy-gate'), null, 'agreed: the page is let through');

  const holding = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token', local: storage({ mccdb_session: JSON.stringify({ access_token: jwt({ user_metadata: {} }) }) }) });
  assert.equal(holding.wall(), true, 'a page that already holds a session is not handed off, so it does not wait');
  assert.equal(holding.asked(), true);
});

test('A4: while a carried sign-in is finished, the page is concealed and there is nothing to answer or enter', async () => {
  const cookies = jar();
  const v = await visit({ url: 'https://mccluster.org/mnet.html?view=feed#mcc_handoff=token', cookies, historyLength: 3 });
  assert.equal(v.concealed(), true, 'concealed in the same breath the script runs');
  assert.equal(v.wall(), true);
  assert.equal(v.node('mccPrivacyGateWait').hidden, false, 'one line says what is being waited for');
  assert.match(v.text('mccPrivacyGate'), /id="mccPrivacyGateWait" role="status"[^>]*>Checking your sign-in\. One moment\.</);
  assert.equal(v.node('mccPrivacyGateBody').hidden, true, 'the question is not on the screen');
  assert.equal(v.node('mccPrivacyGateActions').hidden, true, 'and neither are its answers: nothing to press that does nothing');
  assert.equal(v.node('mccPrivacyGate').getAttribute('aria-describedby'), 'mccPrivacyGateWait', 'a screen reader hears the wait, not a question that is not there');
  assert.equal(v.focused?.id, 'mccPrivacyGateTitle', 'focus is in the dialog, not on a hidden answer');
  /* an answer that is not offered cannot be given: not by a script, not by the keyboard */
  v.click('mccPrivacyAgree');
  v.click('mccPrivacyBack');
  v.key('mccPrivacyGate', 'Escape');
  await flush();
  assert.equal(v.reloads, 0);
  assert.equal(v.backs, 0);
  assert.deepEqual(v.replaced, []);
  assert.equal(v.window.MCC_PRIVACY.accepted(), false, 'waiting is not agreeing: analytics stay off');
  assert.equal(v.window.localStorage.getItem('mcc_privacy_ack'), null);
  assert.equal(cookies.all.size, 0);
  assert.equal(v.fetches.length, 0);
  /* looking at the tab again, or a restored page, does not cut the wait short or let anyone through */
  v.visibility('visible');
  v.dispatch('focus');
  v.dispatch('pagehide', undefined, { persisted: true });
  v.dispatch('pageshow', undefined, { persisted: true });
  v.dispatch('popstate');
  assert.equal(v.concealed(), true);
  assert.equal(v.asked(), false);
  assert.equal(v.focused?.id, 'mccPrivacyGateTitle', 'and focus is not moved onto an answer that is not offered');
  /* refused: the question, with both answers working */
  v.dispatch('mcc:handoff', { ok: false });
  assert.equal(v.concealed(), true, 'a refused handoff never opens the page');
  assert.equal(v.asked(), true);
  assert.equal(v.node('mccPrivacyGateWait').hidden, true);
  assert.equal(v.node('mccPrivacyGate').getAttribute('aria-describedby'), 'mccPrivacyGateBody');
  assert.equal(v.focused?.id, 'mccPrivacyAgree', 'focus starts on the agree button, the way it always has');
  v.click('mccPrivacyBack');
  assert.equal(v.backs, 1, 'Go back leaves');

  /* the script runs in the head, before there is a body to put a dialog in: the page is concealed already */
  const head = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token', loading: true });
  assert.equal(head.concealed(), true, 'concealed before the first element of the body is parsed');
  assert.equal(head.node('mccPrivacyGate'), null);
  head.ready();
  assert.equal(head.wall(), true);
  assert.equal(head.asked(), false);
  assert.equal(head.node('mccPrivacyGateActions').hidden, true);
  /* refused before the body arrived: the dialog is mounted asking */
  const early = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token', loading: true });
  early.dispatch('mcc:handoff', { ok: false });
  assert.equal(early.concealed(), true);
  early.ready();
  assert.equal(early.asked(), true);

  /* a fragment that carries no sign-in does not wait at all */
  for (const hash of ['', '#view=feed', '#mcc_handoff=', '#x=mcc_handoff=token']) {
    const plain = await visit({ url: 'https://mccluster.org/mnet.html' + hash });
    assert.equal(plain.asked(), true, JSON.stringify(hash) + ': asked at once');
  }
});

test("A4: the arriving member's own record enters without the question, once; with no record the question is asked", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const land = (store, meta) => store.setItem('mccdb_session', JSON.stringify({ access_token: jwt({ sub: 'u1', exp, user_metadata: meta }), refresh_token: 'r' }));
  const agreed = { privacy_policy_version: PRIVACY_VERSION, privacy_acknowledged_at: '2026-10-19T12:00:00Z' };

  /* THE WORLD TAKES THE SESSION WHERE IT STANDS (js/mnet.js cancels mcc:handoff; js/tabbar.js then reloads nothing) */
  let cookies = jar(), local = storage();
  const world = await visit({ url: 'https://humanuprise.com/mnet.html#mcc_handoff=token', cookies, local });
  land(local, agreed);
  world.dispatch('mcc:handoff', { ok: true }, { defaultPrevented: true });
  assert.equal(world.concealed(), true, 'not before every listener of the event has run');
  world.runTimers(0);
  assert.equal(world.shown(), false, "the member's own record answers: in, and never asked");
  assert.equal(world.document.documentElement.getAttribute('data-privacy-gate'), null);
  assert.equal(world.styleRemoved(), true);
  assert.equal(world.reloads, 0, 'no second paint: nothing reloads');
  assert.equal(world.window.MCC_PRIVACY.accepted(), true);
  assert.equal(JSON.parse(local.getItem('mcc_privacy_ack')).accepted_at, '2026-10-19T12:00:00Z', 'the browser copy keeps the record time');
  assert.ok([...cookies.all.values()].some((c) => c.name === 'mcc_privacy_ack'), 'and the cookie is written for the next page');
  assert.equal(world.fetches.length, 0, 'an existing record is not written again');
  world.runTimers();
  world.dispatch('pageshow', undefined, { persisted: true });
  assert.equal(world.shown(), false, 'once: the timers that were waiting do nothing more');
  assert.equal(world.reloads, 0);
  assert.equal(world.lifted, 1);

  /* the same member with no record of this version: signed in, and asked */
  local = storage();
  const unanswered = await visit({ url: 'https://humanuprise.com/mnet.html#mcc_handoff=token', local });
  land(local, { privacy_policy_version: '2026-01-01', privacy_acknowledged_at: '2026-01-01T00:00:00Z' });
  unanswered.dispatch('mcc:handoff', { ok: true }, { defaultPrevented: true });
  unanswered.runTimers(0);
  assert.equal(unanswered.concealed(), true, 'signed in is not agreed: still behind the wall');
  assert.equal(unanswered.asked(), true, 'asked as soon as the sign-in landed, not four seconds later');
  unanswered.click('mccPrivacyAgree');
  await flush(); await flush();
  assert.equal(unanswered.fetches.length, 1, "agreeing writes the member's own record");
  assert.equal(JSON.parse(unanswered.fetches[0].init.body).data.privacy_policy_version, PRIVACY_VERSION);
  assert.equal(unanswered.reloads, 1);

  /* EVERY OTHER PAGE RELOADS SIGNED IN: it stays behind the wall, unasked, until it does */
  local = storage();
  const reloading = await visit({ url: 'https://humanuprise.com/account.html#mcc_handoff=token', local });
  land(local, agreed);
  reloading.dispatch('mcc:handoff', { ok: true });
  reloading.runTimers(0);
  assert.equal(reloading.concealed(), true, 'the reload is coming: no flash of the page before it');
  assert.equal(reloading.asked(), false);
  reloading.runTimers(3999);
  assert.equal(reloading.concealed(), true);
  reloading.runTimers();
  assert.equal(reloading.shown(), false, 'the reload never came: the record is read here, and it answers');
  assert.equal(reloading.reloads, 0);
});

test('A4: the wait always ends, in agreement or in answers that work', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const agreed = { privacy_policy_version: PRIVACY_VERSION, privacy_acknowledged_at: '2026-10-19T12:00:00Z' };
  /* nobody answers (a page without the bar, an API that never replies): ten seconds, then the question */
  const silent = await visit({ url: 'https://mccluster.org/merch.html#mcc_handoff=token', historyLength: 2 });
  silent.runTimers(9999);
  assert.equal(silent.concealed(), true, 'behind the wall for the whole wait');
  assert.equal(silent.asked(), false, 'and unasked until it is over');
  silent.runTimers(10000);
  assert.equal(silent.concealed(), true, 'a timeout never opens the page');
  assert.equal(silent.asked(), true, 'it ends in both answers, working');
  assert.equal(silent.focused?.id, 'mccPrivacyAgree');
  /* the handoff lands after all, and the member's own record answers: the wall comes down */
  const local = storage();
  const late = await visit({ url: 'https://humanuprise.com/mnet.html#mcc_handoff=token', local });
  late.runTimers(10000);
  assert.equal(late.asked(), true);
  local.setItem('mccdb_session', JSON.stringify({ access_token: jwt({ sub: 'u1', exp, user_metadata: agreed }), refresh_token: 'r' }));
  late.dispatch('mcc:handoff', { ok: true }, { defaultPrevented: true });
  late.runTimers(0);
  assert.equal(late.shown(), false, 'a late sign-in whose record answers still enters');
  assert.equal(late.reloads, 0);
  /* the handoff lands late and refused: the question simply stays */
  const refused = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token' });
  refused.runTimers(10000);
  refused.dispatch('mcc:handoff', { ok: false });
  refused.runTimers();
  assert.equal(refused.asked(), true);
  assert.equal(refused.concealed(), true);
  /* after the timeout the answers are ordinary answers */
  silent.click('mccPrivacyBack');
  assert.equal(silent.backs, 1);
  const agreeing = await visit({ url: 'https://mccluster.org/merch.html#mcc_handoff=token' });
  agreeing.runTimers(10000);
  agreeing.click('mccPrivacyAgree');
  await flush();
  assert.equal(agreeing.reloads, 1);
  assert.equal(agreeing.window.MCC_PRIVACY.accepted(), true);
  /* agreed before the body arrived (the cookie from another host, read on the way): no dialog is ever mounted */
  const cookies = jar();
  const head = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token', cookies, loading: true });
  assert.equal(head.concealed(), true);
  cookies.forHost('matthew.mccluster.org').set('mcc_privacy_ack=' + PRIVACY_VERSION + '; Domain=mccluster.org; Path=/; Max-Age=34560000; SameSite=Lax; Secure');
  head.dispatch('mcc:handoff', { ok: false });
  head.ready();
  assert.equal(head.shown(), false);
  assert.equal(head.node('mccPrivacyGate'), null);
  assert.equal(head.document.documentElement.getAttribute('data-privacy-gate'), null);
});

test('analytics asks the notice when it is on the page, and its own fallback reads the shared cookie safely', async () => {
  const src = await readFile(join(ROOT, 'js/analytics.js'), 'utf8');
  const head = src.slice(0, src.indexOf('if (mccPrivacyAcknowledged() && !mccControlPreview()) {'));
  assert.ok(head.length > 0, 'the gate is where the test reads it');
  /* the owner's look at the front page inside Control → Front page records nothing (js/control-room/front-page.js) */
  const preview = (parentPath, sameOrigin = true) => {
    const self = { location: { origin: 'https://matthew.mccluster.org' } };
    self.parent = parentPath === null ? self : { location: sameOrigin ? { origin: 'https://matthew.mccluster.org', pathname: parentPath } : { get origin() { throw new Error('SecurityError'); } } };
    return vm.runInNewContext(head + '\nmccControlPreview()', { window: self, location: self.location, document: {}, JSON, String });
  };
  assert.equal(preview('/control.html'), true, 'framed by the Control Room on this origin: not a visit');
  assert.equal(preview(null), false, 'the page on its own is a visit');
  assert.equal(preview('/sites.html'), false, 'framed by another page of the house: still a visit');
  assert.equal(preview('/control.html', false), false, 'framed by another origin: a visit, and no throw');
  const run = ({ privacy, cookie, cookieThrows, local } = {}) => {
    const document = {};
    Object.defineProperty(document, 'cookie', { get() { if (cookieThrows) throw new Error('SecurityError'); return cookie || ''; } });
    const ctx = { window: { MCC_PRIVACY: privacy }, document, localStorage: local || storage(), sessionStorage: storage(), JSON, String };
    return vm.runInNewContext(head + '\nmccPrivacyAcknowledged()', ctx);
  };
  assert.equal(run({ privacy: { accepted: () => true } }), true);
  assert.equal(run({ privacy: { accepted: () => false }, cookie: 'mcc_privacy_ack=' + PRIVACY_VERSION }), false, 'the notice decides when it is present');
  assert.equal(run({ cookie: 'a=1; mcc_privacy_ack=' + PRIVACY_VERSION }), true, 'fallback: the shared cookie');
  assert.equal(run({ cookie: 'mcc_privacy_seen=' + PRIVACY_VERSION }), false, 'fallback: seen is not agreed');
  assert.equal(run({ cookieThrows: true }), false, 'fallback: a sandboxed frame does not throw');
  assert.equal(run({ cookieThrows: true, local: storage({ mcc_privacy_ack: JSON.stringify({ version: PRIVACY_VERSION }) }) }), true);
});

test('precise location remains a separate browser permission instead of being hidden in the gate', async () => {
  const html = await readFile(join(ROOT, 'account.html'), 'utf8');
  const live = await readFile(join(ROOT, 'js/live-content.js'), 'utf8');
  assert.match(html, /id="fnLocation"/);
  assert.match(html, /MCC_LOCATION\.request\(\)/);
  assert.match(live, /not blanket consent/i);
  assert.match(live, /Precise location[^<]*protected device permissions/i);
});

test('privacy notice names unavailable hardware identifiers and the monthly swag purpose', async () => {
  const html = await readFile(join(ROOT, 'privacy.html'), 'utf8');
  assert.match(html, /No IMEI, hardware serial number or MAC address/i);
  assert.match(html, /Monthly McCluster swag eligibility and fulfillment/i);
  assert.match(html, /no purchase or payment is required/i);
});
