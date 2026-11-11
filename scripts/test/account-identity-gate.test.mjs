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
   between McCluster's sites. */
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
async function visit({ url, cookies, local, session, framed = false, cookieThrows = false, fetchImpl, MCC, pageNodes = [] } = {}) {
  if (!gateSource) {
    const src = await readFile(join(ROOT, 'js/live-content.js'), 'utf8');
    const end = src.indexOf('/* ============================================================\n   LIVE CONTENT');
    assert.ok(end > 0, 'the privacy block ends where live content begins');
    gateSource = src.slice(0, end);
  }
  const u = new URL(url);
  const html = u.pathname.split('/').pop() || 'index.html';
  const banner = /^(resume-it-support|press|newsroom|hire)\.html$/.test(html);
  const nodes = new Map(), timers = [], listeners = {}, fetches = [], appended = [];
  let reloads = 0, timerId = 0, focused = null;
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
  for (const id of pageNodes) nodes.set(id, element('div', id));
  const meta = banner ? Object.assign(element('meta'), { attrs: { name: 'mcc-privacy-notice', content: 'banner' } }) : null;
  const cookieApi = (cookies || jar()).forHost(u.hostname);
  const document = {
    readyState: 'complete', documentElement: docEl,
    head: { appendChild(n) { appended.push(n); return n; } },
    body: { appendChild(n) { appended.push(n); register(n); return n; } },
    createElement: (tag) => element(tag),
    getElementById: (id) => nodes.get(id) || null,
    querySelector: (sel) => (sel === 'meta[name="mcc-privacy-notice"]' ? meta : null),
    addEventListener() {}
  };
  Object.defineProperty(document, 'cookie', {
    get() { if (cookieThrows) throw new Error('SecurityError: sandboxed'); return cookieApi.get(); },
    set(v) { if (cookieThrows) throw new Error('SecurityError: sandboxed'); cookieApi.set(v); }
  });
  const window = {
    localStorage: local || storage(), sessionStorage: session || storage(),
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    MCC
  };
  window.top = framed ? {} : window;
  const location = { pathname: u.pathname, hostname: u.hostname, hash: u.hash, reload() { reloads++; } };
  const fetch = (href, init) => { fetches.push({ href, init }); return fetchImpl ? fetchImpl(href, init) : Promise.resolve({ ok: true }); };
  vm.runInNewContext(gateSource, {
    window, document, location, fetch, atob, JSON, Date, Promise, String, Number, Object, isNaN, Error,
    setTimeout: (fn, ms) => { timers.push({ id: ++timerId, fn, ms }); return timerId; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }
  });
  return {
    window, document, location, fetches,
    get reloads() { return reloads; },
    wall: () => docEl.getAttribute('data-privacy-gate') === 'pending' && !!nodes.get('mccPrivacyGate'),
    banner: () => !!nodes.get('mccPrivacyNotice') && !nodes.get('mccPrivacyNotice').removed,
    shown() { return this.wall() || this.banner(); },
    click: (id) => nodes.get(id).click(),
    key: (id, key) => { let prevented = false; for (const f of nodes.get(id).listeners.keydown || []) f({ type: 'keydown', key, preventDefault() { prevented = true; } }); return prevented; },
    node: (id) => nodes.get(id) || null,
    get focused() { return focused; },
    styleRemoved: () => appended.some((n) => n.id === 'mccPrivacyGateStyle' && n.removed),
    text: (id) => String(nodes.get(id)?.innerHTML || ''),
    dispatch: (t, detail) => { for (const f of (listeners[t] || []).splice(0)) f({ type: t, detail }); },
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

test('the notice: "Not now" on a banner is an answer, so no banner or wall comes back, and nothing counts as agreed', async () => {
  const cookies = jar();
  const resume = await visit({ url: 'https://matthew.mccluster.org/resume-it-support.html', cookies });
  assert.equal(resume.banner(), true);
  assert.equal(resume.wall(), false, 'a document page shows the banner, not the wall');
  resume.click('mccPrivacyNoticeLater');
  assert.equal(resume.banner(), false, 'dismissed');
  assert.equal(resume.window.MCC_PRIVACY.accepted(), false, 'seen is not agreed');
  assert.equal(resume.window.MCC_PRIVACY.seen(), true);
  assert.equal(resume.window.localStorage.getItem('mcc_privacy_ack'), null, 'no agreement is stored');
  assert.equal(JSON.parse(resume.window.localStorage.getItem('mcc_privacy_seen')).version, PRIVACY_VERSION);
  assert.equal(cookies.all.get('mcc_privacy_ack|.mccluster.org'), undefined);
  assert.equal(cookies.all.get('mcc_privacy_seen|.mccluster.org').value, PRIVACY_VERSION, 'seen is shared across McCluster hosts');
  for (const url of ['https://matthew.mccluster.org/press.html', 'https://matthew.mccluster.org/index.html', 'https://mccluster.org/mnet.html']) {
    const next = await visit({ url, cookies });
    assert.equal(next.shown(), false, url + ': not shown again');
    assert.equal(next.window.MCC_PRIVACY.accepted(), false, url + ': still not agreed');
  }
  /* agreeing later, at a feature's own point of use, is the stronger record and is never taken back by "Not now" */
  const later = await visit({ url: 'https://mccluster.org/mnet.html', cookies });
  await later.window.MCC_PRIVACY.acknowledge();
  later.window.MCC_PRIVACY.dismiss();
  assert.equal(later.window.MCC_PRIVACY.accepted(), true);
  assert.equal((await visit({ url: 'https://matthew.mccluster.org/listen.html', cookies })).window.MCC_PRIVACY.accepted(), true);
});

test('the notice: the entry dialog offers "Not now", which lets the visitor in as seen, never as agreed', async () => {
  const cookies = jar();
  const world = await visit({ url: 'https://mccluster.org/mnet.html', cookies });
  assert.equal(world.wall(), true);
  const gate = world.node('mccPrivacyGate');
  assert.equal(gate.getAttribute('role'), 'dialog');
  assert.equal(gate.getAttribute('aria-modal'), 'true');
  assert.equal(gate.getAttribute('aria-labelledby'), 'mccPrivacyGateTitle');
  assert.equal(gate.getAttribute('aria-describedby'), 'mccPrivacyGateBody');
  assert.match(world.text('mccPrivacyGate'), /<button type="button" class="mccpg__later" id="mccPrivacyLater">Not now<\/button>/);
  assert.equal(world.focused?.id, 'mccPrivacyAgree', 'focus starts inside the dialog');

  world.click('mccPrivacyLater');
  assert.equal(world.wall(), false, 'the dialog closes');
  assert.equal(world.document.documentElement.getAttribute('data-privacy-gate'), null, 'the page is uncovered');
  assert.equal(world.styleRemoved(), true, 'and the gate style that hid it is gone');
  assert.equal(world.reloads, 0, 'no reload: nothing that waits for agreement started');
  assert.equal(world.window.MCC_PRIVACY.accepted(), false, 'seen is not agreed');
  assert.equal(world.window.MCC_PRIVACY.seen(), true);
  assert.equal(world.window.localStorage.getItem('mcc_privacy_ack'), null);
  assert.equal(JSON.parse(world.window.localStorage.getItem('mcc_privacy_seen')).version, PRIVACY_VERSION);
  assert.equal(cookies.all.get('mcc_privacy_ack|.mccluster.org'), undefined, 'no agreement cookie');
  assert.equal(cookies.all.get('mcc_privacy_seen|.mccluster.org').value, PRIVACY_VERSION, 'seen is shared across McCluster hosts');
  assert.equal(world.fetches.length, 0, 'nothing is written anywhere else');
  for (const url of ['https://matthew.mccluster.org/mnet.html', 'https://mccluster.org/account.html', 'https://matthew.mccluster.org/press.html']) {
    const next = await visit({ url, cookies });
    assert.equal(next.shown(), false, url + ': an answered notice is not asked again for this version');
    assert.equal(next.window.MCC_PRIVACY.accepted(), false, url + ': still not agreed');
  }
});

test('the notice: Escape in the entry dialog is "Not now", and a pending agreement cannot be undone by it', async () => {
  const esc = await visit({ url: 'https://matthew.mccluster.org/mnet.html' });
  assert.equal(esc.key('mccPrivacyGate', 'Enter'), false, 'other keys pass through');
  assert.equal(esc.wall(), true);
  assert.equal(esc.key('mccPrivacyGate', 'Escape'), true, 'Escape is handled');
  assert.equal(esc.wall(), false);
  assert.equal(esc.window.MCC_PRIVACY.seen(), true);
  assert.equal(esc.window.MCC_PRIVACY.accepted(), false);

  const agreeing = await visit({ url: 'https://matthew.mccluster.org/mnet.html' });
  agreeing.click('mccPrivacyAgree');
  agreeing.click('mccPrivacyLater');
  agreeing.key('mccPrivacyGate', 'Escape');
  assert.equal(agreeing.node('mccPrivacyLater').disabled, true, 'both answers lock once one is chosen');
  assert.equal(agreeing.window.MCC_PRIVACY.accepted(), true);
  assert.equal(agreeing.window.localStorage.getItem('mcc_privacy_seen'), null, 'agreement is never downgraded to seen');
  await flush();
  assert.equal(agreeing.reloads, 1);
});

test('the notice: Escape inside the document-page bar is "Not now" too', async () => {
  const press = await visit({ url: 'https://matthew.mccluster.org/press.html' });
  press.key('mccPrivacyNotice', 'Escape');
  assert.equal(press.banner(), false);
  assert.equal(press.window.MCC_PRIVACY.accepted(), false);
});

test('the policy page is where "Not now" can still agree, as the policy promises', async () => {
  const ids = ['mccPrivacyAnswer', 'mccPrivacyAnswerStatus', 'mccPrivacyAnswerAgree'];
  const cookies = jar();
  const fresh = await visit({ url: 'https://matthew.mccluster.org/privacy.html', cookies, pageNodes: ids });
  assert.equal(fresh.shown(), false, 'never a notice over the policy');
  assert.equal(fresh.node('mccPrivacyAnswer').hidden, false, 'the control is shown');
  assert.match(fresh.node('mccPrivacyAnswerStatus').textContent, /not answered/);

  (await visit({ url: 'https://mccluster.org/mnet.html', cookies })).click('mccPrivacyLater');
  const policy = await visit({ url: 'https://matthew.mccluster.org/privacy.html', cookies, pageNodes: ids });
  assert.match(policy.node('mccPrivacyAnswerStatus').textContent, /Not now.*analytics are off/);
  assert.equal(policy.node('mccPrivacyAnswerAgree').hidden, false);
  policy.click('mccPrivacyAnswerAgree');
  assert.equal(policy.window.MCC_PRIVACY.accepted(), true);
  assert.equal(policy.node('mccPrivacyAnswerAgree').hidden, true);
  assert.match(policy.node('mccPrivacyAnswerStatus').textContent, /You agreed .*next page/);
  assert.equal(policy.focused?.id, 'mccPrivacyAnswerStatus', 'focus follows the hidden button to its result');
  assert.equal(cookies.all.get('mcc_privacy_ack|.mccluster.org').value, PRIVACY_VERSION);
  assert.equal((await visit({ url: 'https://mccluster.org/mnet.html', cookies })).window.MCC_PRIVACY.accepted(), true);
});

test('the notice: a banner counts as seen once it is shown, so ignoring it is enough; the wall still needs an answer', async () => {
  const cookies = jar();
  const press = await visit({ url: 'https://matthew.mccluster.org/press.html', cookies });
  assert.equal(press.banner(), true, 'the first document page shows the banner');
  assert.equal(press.window.MCC_PRIVACY.seen(), true, 'shown is seen, with no tap');
  assert.equal(press.window.MCC_PRIVACY.accepted(), false, 'and seen is not agreed');
  assert.equal(press.banner(), true, 'the bar stays on this page until it is answered');
  assert.equal(JSON.parse(press.window.localStorage.getItem('mcc_privacy_seen')).version, PRIVACY_VERSION);
  assert.equal(cookies.all.get('mcc_privacy_seen|.mccluster.org').value, PRIVACY_VERSION, 'shared with every McCluster host');
  assert.equal(cookies.all.get('mcc_privacy_ack|.mccluster.org'), undefined, 'no agreement is stored');
  for (const url of ['https://matthew.mccluster.org/newsroom.html', 'https://matthew.mccluster.org/listen.html', 'https://mccluster.org/', 'https://mccluster.org/mnet.html']) {
    const next = await visit({ url, cookies });
    assert.equal(next.shown(), false, url + ': an ignored banner does not come back, and no wall either');
    assert.equal(next.window.MCC_PRIVACY.accepted(), false, url + ': still not agreed');
  }
  /* the bar can still be agreed to on the page that shows it */
  press.click('mccPrivacyNoticeAgree');
  assert.equal(press.window.MCC_PRIVACY.accepted(), true);
  assert.equal(cookies.all.get('mcc_privacy_ack|.mccluster.org').value, PRIVACY_VERSION);

  const wallJar = jar();
  const unanswered = await visit({ url: 'https://mccluster.org/mnet.html', cookies: wallJar });
  assert.equal(unanswered.wall(), true);
  assert.equal(unanswered.window.MCC_PRIVACY.seen(), false, 'the wall covers the page, so showing it is not seen');
  assert.equal(wallJar.all.size, 0, 'and nothing is stored for it');
  assert.equal((await visit({ url: 'https://mccluster.org/account.html', cookies: wallJar })).wall(), true, 'an unanswered wall still asks on the next wall page');
});

test('the notice: "I agree" on a banner records agreement without reloading', async () => {
  const cookies = jar();
  const press = await visit({ url: 'https://matthew.mccluster.org/press.html', cookies });
  press.click('mccPrivacyNoticeAgree');
  assert.equal(press.banner(), false);
  assert.equal(press.reloads, 0);
  assert.equal(press.window.MCC_PRIVACY.accepted(), true);
  assert.equal(cookies.all.get('mcc_privacy_ack|.mccluster.org').value, PRIVACY_VERSION);
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

test('the notice: a cross-host sign-in handoff is finished before the notice looks', async () => {
  const pending = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token' });
  assert.equal(pending.shown(), false, 'nothing while the handoff runs');
  pending.dispatch('mcc:handoff', { ok: false });
  assert.equal(pending.wall(), true, 'a failed handoff: look again, and show it');

  const carried = await visit({ url: 'https://mccluster.org/mnet.html#view=feed&mcc_handoff=token' });
  carried.dispatch('mcc:handoff', { ok: true });
  assert.equal(carried.shown(), false, 'signed in: the reload is coming');
  carried.runTimers();
  assert.equal(carried.wall(), true, 'if the reload never comes, look again');

  const silent = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token' });
  silent.runTimers(9999);
  assert.equal(silent.shown(), false);
  silent.runTimers();
  assert.equal(silent.wall(), true, 'a page without the bar does not wait forever');

  const agreedMeanwhile = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token' });
  agreedMeanwhile.window.localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: PRIVACY_VERSION }));
  agreedMeanwhile.dispatch('mcc:handoff', { ok: false });
  assert.equal(agreedMeanwhile.shown(), false, 'the look after the handoff reads the records again');

  const holding = await visit({ url: 'https://mccluster.org/mnet.html#mcc_handoff=token', local: storage({ mccdb_session: JSON.stringify({ access_token: jwt({ user_metadata: {} }) }) }) });
  assert.equal(holding.wall(), true, 'a page that already holds a session is not handed off, so it does not wait');
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
