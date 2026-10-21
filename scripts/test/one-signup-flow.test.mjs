/* ONE SIGN-UP (owner, 2026-10-20: "once you make a profile as an MNet user or whatever, you should be able to sign up
   to anything else without having to enter any additional information unless your profile's not filled out. There's
   also like this profile, make it yours, 3-panel profile sign up thing. That should be the new sign up thing.")

   Every Join and Create account is the World's form (an email and a password, or Google), then the three pages, then
   back to where the person started (?next, this origin only). A returning member still lands on the World; an
   unfinished profile opens at its first unfinished page. Nothing the profile has is asked again: page 2 is filled
   from the contact row and the sign-up's own metadata, page 3 asks for a password only when there is none, the
   artist doors are one tap for a finished profile, the seat applications and the inline forms come pre-filled.
   These run the real functions (lifted out of the page scripts) against stubs; the browser walk is
   scripts/e2e/human-uprise-door.e2e.mjs and scripts/e2e/creator-onboarding.e2e.mjs. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/* a function out of a page script, by its own source text */
function lift(src, name) {
  const start = src.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name + ' not found');
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}

/* js/mcc-auth.js, loaded as a page on Matthew's origin */
function mccOn(href) {
  const u = new URL(href);
  const win = { location: { href: u.href, origin: u.origin }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  vm.runInNewContext(read('js/mcc-auth.js'), { window: win, URL, URLSearchParams, Promise, JSON, Date, Math, String, Number, Array, Object, RegExp, encodeURIComponent, setTimeout, clearTimeout });
  return win.MCC;
}

test('?next is this origin only: //evil, https://evil, javascript: and friends are refused', () => {
  const MCC = mccOn('https://matthew.mccluster.org/account.html?next=x');
  assert.equal(MCC.safeNext('creator.html'), '/creator.html');
  assert.equal(MCC.safeNext('/album.html?from=i-am-here#track-3'), '/album.html?from=i-am-here#track-3');
  assert.equal(MCC.safeNext('mnet.html?finish=1&next=creator.html'), '/mnet.html?finish=1&next=creator.html');
  for (const bad of ['//evil.example/x', 'https://evil.example/', 'http://evil.example', 'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi',
    '/\\evil.example', '\\\\evil.example', 'https://matthew.mccluster.org.evil.example/', '/x\u0000y', '  //evil.example', '', null, undefined]) {
    assert.equal(MCC.safeNext(bad), '', 'refused: ' + JSON.stringify(bad));
  }
  assert.equal(MCC.safeNext('https://matthew.mccluster.org/creator.html'), '', 'a full URL carries a scheme: refused, even on this origin');
});

test('account.html honours ?next: signing in goes back there, Create account carries it into the one sign-up', () => {
  const html = read('account.html');
  assert.match(html, /var safe = window\.MCC && MCC\.safeNext \? MCC\.safeNext\(raw\) : "";\n\s*return safe && !\/\(\^\|\\\/\)account\\\.html\$\/\.test\(safe\.split\(\/\[\?#\]\/\)\[0\]\) \? safe : "";/, 'through MCC.safeNext, never this page');
  assert.match(html, /if \(NEXT && !\/\(\?:\\\?\|&\)stay=1\(\?:&\|\$\)\/\.test\(location\.search\)\) \{ goOn\(NEXT\); return; \}/, 'a signed-in person sent here goes on');
  /* goOn: unfinished goes through the pages and comes back; finished goes straight back */
  const js = html.slice(html.indexOf('    function goOn(next) {'), html.indexOf('    function paint() {'));
  const run = (boot) => new Promise((done) => {
    const replaced = [];
    const location = { replace: (u) => { replaced.push(u); done(replaced); } };
    const MCC = { api: () => Promise.resolve({ ok: !!boot, json: () => Promise.resolve(boot) }) };
    new Function('window', 'MCC', 'location', js + '; goOn("/creator.html");')({ MCC }, MCC, location);
  });
  return Promise.all([
    run({ next_step: 'contact', identity: { mccluster_id: 'new.member' }, profile: { display_name: 'New Member' } }).then((r) => assert.deepEqual(r, ['mnet.html?finish=1&next=%2Fcreator.html'])),
    run({ next_step: 'feed', identity: { mccluster_id: 'done.member' }, profile: { display_name: 'Done Member' } }).then((r) => assert.deepEqual(r, ['/creator.html'])),
    run(null).then((r) => assert.deepEqual(r, ['mnet.html?finish=1&next=%2Fcreator.html'], 'no answer: the World decides on arrival'))
  ]);
});

test('the World reads ?next through the same rule and opens the pages only for the flow', () => {
  const js = read('js/mnet.js');
  assert.match(js, /var next = window\.MCC && MCC\.safeNext \? MCC\.safeNext\(get\("next"\)\) : "";/);
  assert.match(js, /if \(next && next\.split\(\/\[\?#\]\/\)\[0\] === location\.pathname\) next = "";/, 'never back to this page');
  assert.match(js, /if \(FLOW\.next\) \{ location\.replace\(FLOW\.next\); return; \}/, 'a finished profile sent here goes straight back');
  assert.match(js, /if \(FLOW\.next\) \{ track\("onboarding_done", \{ step: "next" \}\); location\.assign\(FLOW\.next\); return Promise\.resolve\(\); \}/, 'the last page goes back to where the person started');
  assert.match(js, /if \(create\) \{ track\("signup_succeeded", \{ flow: "password", verification: "immediate" \}\); FLOW\.on = true; \}/, 'a new account goes straight into the pages');
  assert.match(js, /rememberJoin\(email\);\n\s*setStatus\(\$\("mnAuthStatus"\), "Check your email/, 'an emailed confirmation keeps the flow, bound to the account, for the first sign-in after it');
  assert.match(js, /if \(FLOW\.join\) \{ openSignIn\("create"\); return; \}/, '?join=1 opens Create account');
});

/* the World's pending sign-up and its bootstrap, run against a stub page: one browser, two accounts */
function pendingWorld() {
  const js = read('js/mnet.js');
  const region = js.slice(js.indexOf('  var PENDING_JOIN = '), js.indexOf('  function $(id) {'));
  const store = new Map();
  const ctx = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
    crypto: globalThis.crypto, TextEncoder, Uint8Array, JSON, Date, Promise, String, Array, Object, encodeURIComponent,
    MCC: { safeNext: (v) => (typeof v === 'string' && /^\/[^/\\]/.test(v) ? v : '') },
    APP: 'mccluster-web', state: { user: null, boot: null }, FLOW: null, opened: 0, world: 0,
    api: () => Promise.resolve({ next_step: 'contact', identity: { mccluster_id: null }, profile: null }),
    openPages() { ctx.opened++; }, loadFeed() { ctx.world++; return Promise.resolve(); },
    fillProfileForm() {}, showGate() {}, setView() {}, paintSelf() {}, paintFinishCard() {}, moveThumb() {}, requestAnimationFrame() {},
    $: () => ({ hidden: true })
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext([region, lift(js, 'needsStep'), lift(js, 'adoptPendingJoin'), lift(js, 'bootstrap')].join('\n'), ctx);
  const load = (user, flow) => {   // a fresh page load, signed in as user
    ctx.FLOW = { next: '', from: '', join: false, finish: false, on: false, ...flow };
    ctx.state = { user, boot: null };
    ctx.opened = 0; ctx.world = 0;
  };
  return { ctx, store, load, KEY: 'mcc.join.pending' };
}

test('a pending sign-up carries on only for the account that made it; another account on the device discards it unused', async () => {
  const { ctx, store, load, KEY } = pendingWorld();
  /* Ana creates an account from the album; it waits on her emailed confirmation */
  load(null, { next: '/album.html?from=i-am-here', from: 'i-am-here', join: true, on: true });
  await ctx.rememberJoin('  Ana@Example.com ');
  const raw = store.get(KEY);
  assert.ok(raw, 'the flow is kept on the device');
  assert.doesNotMatch(raw, /ana|example/i, 'never the address itself');

  /* Ben signs in on the same browser, with an unfinished profile: the World with its card, not Ana's destination */
  load({ id: 'b', email: 'ben@example.com' });
  await ctx.bootstrap();
  assert.equal(ctx.opened, 0, 'Ben is not sent into the pages by Ana\'s sign-up');
  assert.equal(ctx.world, 1, 'Ben gets the World, with the step in its card');
  assert.deepEqual([ctx.FLOW.on, ctx.FLOW.next, ctx.FLOW.from], [false, '', ''], 'nor her destination, nor her from');
  assert.equal(store.has(KEY), false, 'the record is discarded, unused');
  assert.match(JSON.parse(raw).who, /^[0-9a-f]{64}$/, 'a SHA-256 of the email');

  /* Ana, after her confirmation: the pages at once, then back to the album, with its from */
  load(null, { next: '/album.html?from=i-am-here', from: 'i-am-here', join: true, on: true });
  await ctx.rememberJoin('ana@example.com');
  load({ id: 'a', email: 'ANA@example.com' });
  await ctx.bootstrap();
  assert.equal(ctx.opened, 1, 'Ana carries on into the pages');
  assert.deepEqual([ctx.FLOW.on, ctx.FLOW.next, ctx.FLOW.from], [true, '/album.html?from=i-am-here', 'i-am-here']);

  /* a record bound to nobody is nobody's */
  store.set(KEY, JSON.stringify({ next: '/creator.html', from: 'i-am-here', at: Date.now() }));
  load({ id: 'a', email: 'ana@example.com' });
  await ctx.bootstrap();
  assert.equal(ctx.opened, 0, 'an unbound record is never adopted');
  assert.equal(store.has(KEY), false);

  /* no digest to bind it with (no WebCrypto): nothing is kept, and the World's card carries on instead */
  ctx.crypto = undefined;
  load(null, { next: '/creator.html', on: true });
  await ctx.rememberJoin('ana@example.com');
  assert.equal(store.has(KEY), false);
});

test('the pages open at the first unfinished one: page 2 when the handle and name are set and the contact step is open', () => {
  const js = read('js/mnet.js');
  const make = (boot) => new Function('state', [lift(js, 'profile'), lift(js, 'identity'), lift(js, 'needsStep'), lift(js, 'firstUnfinished'), 'return firstUnfinished;'].join('\n'))({ boot });
  assert.equal(make({ next_step: 'contact', identity: { mccluster_id: 'ana.sings' }, profile: { display_name: 'Ana Rivers' } })(), 2);
  assert.equal(make({ next_step: 'contact', identity: { mccluster_id: null }, profile: null })(), 1, 'a brand new account starts at the profile');
  assert.equal(make({ next_step: 'contact', identity: { mccluster_id: 'ana.sings' }, profile: { display_name: ' ' } })(), 1, 'no name yet: page 1');
  assert.equal(make({ next_step: 'profile', identity: { mccluster_id: 'ana.sings' }, profile: null })(), 1);
  assert.match(js, /showStep\(editing \? 0 : firstUnfinished\(\)\);/, 'never always step 1');
});

test('page 2 is filled from the contact row first, then the sign-up\'s own address (shipping_*), never over what was typed', async () => {
  const js = read('js/mnet.js');
  const fields = {};
  const $ = (id) => (fields[id] = fields[id] || { value: id === 'mnCountry' ? 'United States' : '' });
  const run = (user, row) => {
    for (const k of Object.keys(fields)) delete fields[k];
    const onboard = { step: 2, editing: false };
    const MCC_FAN = { load: () => Promise.resolve(row) };
    const prefill = new Function('state', '$', 'onboard', 'window', 'MCC_FAN', 'splitE164', 'fillDial',
      [lift(js, 'contactFromSignup'), lift(js, 'prefillContact'), 'return prefillContact;'].join('\n'))({ user }, $, onboard, { MCC_FAN }, MCC_FAN, (p) => ['+1', p.slice(2)], () => {});
    prefill();
    return new Promise((r) => setTimeout(r, 0));
  };
  const meta = { first_name: 'Benjamin', last_name: 'Chase', shipping_address_line1: '1 Main Street', shipping_address_line2: 'Apt 2', shipping_city: 'Bridgeport', shipping_region: 'CT', shipping_postal_code: '06604', shipping_country: 'United States' };
  await run({ user_metadata: meta }, null);
  assert.deepEqual(['mnLegalName', 'mnAddr1', 'mnAddr2', 'mnCity', 'mnRegion', 'mnPostal', 'mnCountry'].map((id) => $(id).value),
    ['Benjamin Chase', '1 Main Street', 'Apt 2', 'Bridgeport', 'CT', '06604', 'United States'], 'the old account form\'s address is not asked again');
  await run({ user_metadata: meta }, { legal_name: 'Ben Chase', address_line1: '9 Elm Road', city: 'Hartford', region: 'CT', postal_code: '06103', country: 'United States' });
  assert.equal($('mnLegalName').value, 'Ben Chase', 'the stored row wins');
  assert.equal($('mnAddr1').value, '9 Elm Road');
  assert.equal($('mnAddr2').value, 'Apt 2', 'what the row lacks, the sign-up fills');
});

test('page 3 asks for a password only when the account has none', () => {
  const MCC = mccOn('https://matthew.mccluster.org/mnet.html');
  assert.equal(MCC.hasPassword({ identities: [{ provider: 'email' }] }), true, 'made with a password: not asked again');
  assert.equal(MCC.hasPassword({ identities: [{ provider: 'google' }] }), false, 'made with Google: offered');
  const js = read('js/mnet.js');
  assert.match(js, /var asked = editing \|\| !hasPassword\(\);\n\s*\$\("mnProfileSecurity"\)\.hidden = !asked;/);
  assert.match(js, /return !!\(state\.user && window\.MCC && MCC\.hasPassword && MCC\.hasPassword\(state\.user\)\);/);
});

test('a complete member becomes a creator in one tap: nothing asked, the picture copied, Creator Studio next', async () => {
  const OB = require('../../js/creator-onboarding.js');
  const calls = [];
  const UID = '00000000-0000-4000-8000-0000000000a1', MUID = '10000000-0000-4000-8000-0000000000a1';
  let creator = null;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ u, m, body });
    const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (u.endsWith('/v1/mnet/bootstrap?app_key=mccluster-web')) return json({ next_step: 'feed', identity: { mccluster_id: 'ana.sings' }, profile: { display_name: 'Ana Rivers' } });
    if (u.includes('/rpc/music_')) return json({ code: 'PGRST202', message: 'not found' }, 404);   // the SQL is still pending
    if (u.includes('/music_creator_profiles?m_uid=')) return json(creator ? [creator] : []);
    if (u.includes('/music_creator_profiles') && m === 'POST') { creator = { ...body, status: 'active' }; return new Response('', { status: 201 }); }
    if (u.includes('/network_profiles?')) return json([{ display_name: 'Ana Rivers', bio: 'Songs from the river.', website_url: 'https://ana.example', avatar_url: 'https://cdn.example/ana.jpg' }]);
    if (u.includes('/platform_profiles?')) return json([{ mccluster_id: 'Ana.Sings', display_name: 'Ana' }]);
    if (u.includes('/identity_presentations')) return m === 'GET' ? json([{ music_enabled: !!creator }]) : new Response('', { status: 201 });
    return json([]);
  };
  const went = [];
  const a = { textContent: 'Become a creator', attrs: { href: 'creator.html' }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const w = { location: { origin: 'https://matthew.mccluster.org', href: 'https://matthew.mccluster.org/listen.html', assign: (u) => went.push(u) },
    MCC: { refreshIfNeeded: async () => ({ access_token: 'h.' + Buffer.from(JSON.stringify({ sub: UID })).toString('base64url') + '.s' }), mUid: async () => MUID } };
  await OB.openDoor(w, a);
  const insert = calls.find((c) => c.m === 'POST' && c.u.endsWith('/rest/v1/music_creator_profiles'));
  assert.ok(insert, 'the creator profile is written');
  assert.equal(insert.body.avatar_url, 'https://cdn.example/ana.jpg', 'the profile picture is the artist picture');
  assert.deepEqual([insert.body.handle, insert.body.artist_name, insert.body.bio, insert.body.website_url], ['ana.sings', 'Ana Rivers', 'Songs from the river.', 'https://ana.example'], 'everything from the profile, nothing typed');
  assert.ok(calls.some((c) => c.m === 'POST' && c.u.includes('/identity_presentations')), 'the presentation is linked');
  assert.deepEqual(went, ['creator.html'], 'and the member lands in Creator Studio');
});

test('an unfinished profile goes through the three pages, then back to Creator Studio for the one tap', async () => {
  const OB = require('../../js/creator-onboarding.js');
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if ((init.method || 'GET') !== 'GET') writes.push(u);
    if (u.includes('/v1/mnet/bootstrap')) return new Response(JSON.stringify({ next_step: 'contact', identity: { mccluster_id: null }, profile: null }), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const went = [];
  const a = { textContent: 'Become a creator', getAttribute: (k) => (k === 'href' ? 'creator.html' : null), setAttribute() {}, removeAttribute() {} };
  const w = { location: { origin: 'https://matthew.mccluster.org', href: 'https://matthew.mccluster.org/listen.html', assign: (u) => went.push(u) },
    MCC: { refreshIfNeeded: async () => ({ access_token: 'x.e30.y' }), mUid: async () => 'm' } };
  await OB.openDoor(w, a);
  assert.deepEqual(went, ['mnet.html?finish=1&next=creator.html']);
  assert.equal(writes.length, 0, 'nothing is written before the profile is done');
  /* signed out: an ordinary link to Creator Studio, whose sign-up comes back there */
  went.length = 0;
  await OB.openDoor({ ...w, MCC: { refreshIfNeeded: async () => null, mUid: async () => null } }, a);
  assert.deepEqual(went, ['creator.html']);
  assert.equal(OB.profileUnfinished({ next_step: 'feed', identity: { mccluster_id: 'a.b' }, profile: { display_name: 'A' } }), false);
  assert.equal(OB.profileUnfinished({ next_step: 'contact', identity: { mccluster_id: 'a.b' }, profile: { display_name: 'A' } }), true);
});

test('every artist door is the one tap, with the terms beside it', () => {
  const listen = read('listen.html'), artist = read('music-creator.html'), desk = read('js/member-desk.js'), world = read('mnet.html');
  assert.match(listen, /<a href="creator\.html" data-creator-door>Become a creator<\/a>\s*<small class="music-launch__terms">One tap with your profile\. Tapping accepts the <a href="music-creator-terms\.html">Creator Terms<\/a>\./);
  assert.match(artist, /<a href="creator\.html" data-creator-door>Make your own artist page<\/a> <span class="ap-foot__terms">\(one tap with your profile; accepts the Creator terms\)<\/span>/);
  assert.match(desk, /<a class="hu-desk__btn" href="creator\.html" data-creator-door>Become a creator<\/a>/);
  assert.match(desk, /the tap accepts the <a href="music-creator-terms\.html">Creator Terms<\/a>/);
  for (const [name, page] of [['listen.html', listen], ['music-creator.html', artist], ['mnet.html', world]]) {
    const auth = page.indexOf('<script src="js/mcc-auth.js'), door = page.indexOf('<script src="js/creator-onboarding.js');
    assert.ok(auth >= 0 && door > auth, name + ' loads the door after the session client');
  }
});

test('the seat applications are filled from the profile: only the role\'s own details are typed', () => {
  const page = read('action-network-clippers.html');
  for (const seat of ['artist', 'producer', 'audio-engineer', 'videographer', 'video-editor']) {
    assert.match(read('action-network-' + seat + '.html'), /href="action-network-clippers\.html\?seat=[a-z-]+#apply"/, seat + ' names its seat');
  }
  assert.match(page, /<script src="js\/mcc-auth\.js"><\/script>/);
  assert.match(page, /M\.api\('\/v1\/mnet\/bootstrap\?app_key=mccluster-web'\)/, 'the member\'s own profile');
  assert.match(page, /put\('email',s\.user&&s\.user\.email\)/);
  assert.match(page, /put\('name',p\.display_name\)/);
  assert.match(page, /var put=function\(id,v\)\{var el=\$\(id\);if\(el&&!el\.value\.trim\(\)&&v\)el\.value=String\(v\)\};/, 'nothing typed is replaced');
});

test('the seat application\'s required handle is the website, else the profile\'s @handle: nothing to retype', async () => {
  const page = read('action-network-clippers.html');
  const open = '<script src="js/mcc-auth.js"></script><script>';
  const src = page.slice(page.indexOf(open) + open.length, page.indexOf('</script>', page.indexOf(open) + open.length));
  const run = async (profile, typed = {}) => {
    const els = {}, el = (id) => (els[id] = els[id] || { id, value: typed[id] || '', hidden: true, textContent: '', on: {}, addEventListener(t, f) { this.on[t] = f; } });
    const location = { search: '?seat=beat-producer', href: '' };
    const boot = { next_step: 'feed', identity: { mccluster_id: 'ana.sings' }, profile };
    const MCC = { session: () => ({ access_token: 't', user: { email: 'ana@example.com' } }), api: () => Promise.resolve({ ok: true, json: () => Promise.resolve(boot) }) };
    vm.runInNewContext(src, { window: { MCC }, document: { getElementById: el }, location, URLSearchParams, String, encodeURIComponent });
    await new Promise((r) => setTimeout(r, 0));
    for (const [id, v] of [['name', 'Ana Rivers'], ['platform', 'TikTok'], ['details', 'Short-form edits.']]) if (!el(id).value) el(id).value = v;
    el('applyform').on.submit({ preventDefault() {} });
    return { handle: el('handle').value, mail: decodeURIComponent(location.href) };
  };
  const plain = await run({ display_name: 'Ana Rivers' });
  assert.equal(plain.handle, '@ana.sings', 'no website: the McCluster handle fills the required field');
  assert.match(plain.mail, /\nHandle: @ana\.sings\n/);
  assert.equal((await run({ display_name: 'Ana Rivers', website_url: 'https://ana.example' })).handle, 'https://ana.example', 'the portfolio is their website');
  assert.equal((await run({ display_name: 'Ana Rivers', website_url: 'http://ana.example' })).handle, '@ana.sings', 'not an https website: the handle');
  assert.equal((await run({ display_name: 'Ana Rivers' }, { handle: '@ana_clips' })).handle, '@ana_clips', 'nothing typed is replaced');
});

test('the inline forms do not ask a signed-in member for what the account has', async () => {
  const onboard = read('js/onboard.js');
  assert.match(onboard, /answered: function \(\) \{ return !!\(MEMBER && MEMBER\.name\); \},/, 'the name is not asked');
  assert.match(onboard, /answered: function \(\) \{ return !!\(MEMBER && MEMBER\.email && MEMBER\.phone\); \},/, 'nor the email and phone');
  assert.match(onboard, /answered: function \(\) \{ return !!MEMBER; \},/, 'nor the account');
  assert.match(onboard, /function answerLines\(\) \{\n\s*var w = brief\(\), out = \[\];/, 'the answers still reach the desk');
  assert.match(read('onboard.html'), /<script src="js\/fan-intake\.js\?v=__STAMP__"><\/script>\n\s*<script src="js\/onboard\.js/);
  /* the print shop's shipping lines */
  const counter = read('js/counter.js');
  const box = { fields: { addr: { value: '' }, city: { value: '' } }, querySelector(sel) { return this.fields[/name="(\w+)"/.exec(sel)[1]]; } };
  const fill = new Function('buyer', 'window', 'localStorage', lift(counter, 'fillShipping') + '; return fillShipping;')(
    () => ({ id: 'u' }), { MCC_FAN: { load: () => Promise.resolve({ address_line1: '1 Main Street', address_line2: 'Apt 2', city: 'Bridgeport', region: 'CT', postal_code: '06604' }) } },
    { getItem: () => null });
  fill(box);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(box.fields.addr.value, '1 Main Street, Apt 2');
  assert.equal(box.fields.city.value, 'Bridgeport, CT 06604');
  assert.match(read('gallery.html'), /<script src="js\/fan-intake\.js\?v=__STAMP__"><\/script>\n\s*<script src="js\/counter\.js/);
  /* the campaign page already hides its account fields from a signed-in member */
  assert.match(read('js/action.js'), /\$\("anAuth"\)\.hidden = signedIn\(\);/);
});
