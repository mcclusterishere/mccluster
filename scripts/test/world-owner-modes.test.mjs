/* ALL THREE FOR THE HOUSE OWNER (owner, 2026-10-20: "Probably keep all three on admin"): js/world-owner-modes.js in a sandbox.
   node --test scripts/test/world-owner-modes.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
const source = readFileSync(new URL('js/world-owner-modes.js', ROOT), 'utf8');
const token = (sub) => 'h.' + Buffer.from(JSON.stringify({ sub, exp: 2e9 })).toString('base64url') + '.s';
function page({ session = null, memo = null, social = true, opened = null } = {}) {
  const local = new Map(), sess = new Map(), listeners = {}, classes = new Set(social ? ['hu-editorial', 'hu-social-only'] : ['hu-editorial']), attrs = new Map();
  if (session) local.set('mccdb_session', JSON.stringify({ access_token: token(session) }));
  if (memo) local.set('mcc_world_owner', JSON.stringify({ sub: memo, at: '2026-10-20T00:00:00Z' }));
  if (opened) sess.set('mcc_world_owner:opened', opened);
  const store = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) });
  const link = { href: 'action-globe.html?explore=1&missions=0', getAttribute() { return this.href; }, setAttribute(_, v) { this.href = v; } };
  let reloads = 0;
  const doc = {
    documentElement: { classList: { contains: (c) => classes.has(c), remove: (c) => classes.delete(c) }, setAttribute: (k, v) => attrs.set(k, v), hasAttribute: (k) => attrs.has(k) },
    addEventListener: (type, fn) => { (listeners['doc:' + type] ||= []).push(fn); },
    querySelector: (sel) => (sel === '.mn__world-expand' ? link : null),
  };
  const win = {
    localStorage: store(local), sessionStorage: store(sess), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, location: { reload: () => { reloads++; } },
  };
  vm.runInNewContext(source, { window: win, document: doc, JSON, String });
  const fire = (type, detail) => (listeners[type] || []).forEach((fn) => fn({ detail }));
  return { win, classes, attrs, local, link, fire, reloads: () => reloads, ready: () => (listeners['doc:DOMContentLoaded'] || []).forEach((fn) => fn()) };
}

test('everyone but the remembered owner gets the social feed', () => {
  for (const p of [page(), page({ session: 'member-1' }), page({ session: 'member-1', memo: 'owner-9' })]) {
    assert.ok(p.classes.has('hu-social-only'));
    assert.equal(p.win.MCC_WORLD_OWNER, false);
  }
});

test('the remembered owner, signed in as that account, gets all three before the page reads the switch', () => {
  const p = page({ session: 'owner-9', memo: 'owner-9' });
  assert.ok(!p.classes.has('hu-social-only'));
  assert.ok(p.attrs.has('data-world-owner'));
  assert.equal(p.win.MCC_WORLD_OWNER, true);
  p.ready();
  assert.equal(p.link.href, 'action-globe.html?explore=1', 'the expanded globe keeps its missions');
});

test('the server\'s first yes is remembered and opens the World again once; a no, or no account, changes nothing', () => {
  const p = page({ session: 'owner-9' });
  p.fire('mcc:appbar-admin', { admin: false });
  assert.equal(p.reloads(), 0); assert.equal(p.local.get('mcc_world_owner'), undefined);
  p.fire('mcc:appbar-admin', { admin: true });
  assert.equal(JSON.parse(p.local.get('mcc_world_owner')).sub, 'owner-9');
  assert.equal(p.reloads(), 1);
  p.fire('mcc:appbar-admin', { admin: true });
  assert.equal(p.reloads(), 1, 'already remembered: no second opening');
  const blocked = page({ session: 'owner-9', opened: 'owner-9' });
  blocked.fire('mcc:appbar-admin', { admin: true });
  assert.equal(blocked.reloads(), 0, 'never twice in one tab');
  const guest = page();
  guest.fire('mcc:appbar-admin', { admin: true });
  assert.equal(guest.reloads(), 0);
});

test('signing out forgets the owner', () => {
  const p = page({ memo: 'owner-9' });
  assert.ok(p.classes.has('hu-social-only'));
  assert.equal(p.local.get('mcc_world_owner'), undefined);
});

test('it loads in the head, before the scripts that read the switch; the globe and Travel follow it', () => {
  const html = readFileSync(new URL('mnet.html', ROOT), 'utf8');
  const at = (s) => html.indexOf(s);
  assert.ok(at('js/world-owner-modes.js') > 0 && at('js/world-owner-modes.js') < at('</head>'));
  assert.ok(at('js/world-owner-modes.js') < at('js/mnet.js?') && at('js/world-owner-modes.js') < at('js/travel/world-travel.mjs'));
  const globe = readFileSync(new URL('js/action-globe.js', ROOT), 'utf8');
  assert.match(globe, /const NO_MISSIONS=new URLSearchParams\(location\.search\)\.get\('missions'\)==='0'&&!\(\(\)=>\{try\{return !!parentFrame&&!parentFrame\.document\.documentElement\.classList\.contains\('hu-social-only'\)\}catch\(e\)\{return false\}\}\)\(\);/);
  const travel = readFileSync(new URL('js/travel/world-travel.mjs', ROOT), 'utf8');
  assert.match(travel, /hasAttribute\('data-world-owner'\) \? 'posts' : MODES\[0\]/);
});
