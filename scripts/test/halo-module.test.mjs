/* Control · Hitman's Halo module card and Control entry (js/control-room/halo-module.js), and the same card inside
   Control → System → E=Up → Overview → Modules (js/control-room/eup.js).

   Synthetic DOM and synthetic answers only: nothing here reads a provider, the Worker or production. What is held:
     - the card and its door are drawn for the owner in every state: policy unregistered / not installed / disabled /
       enabled / draining / unreadable, and backend answered / missing keys / unavailable / not deployed / timed out;
     - "installed" and "enabled" are never shown as ready or open, and the unenforced policy is said in words;
     - the four deep links are the existing full-screen Halo routes: no second globe, no other origin, no token;
     - a 403 (member) or 401 (guest, signed out) leaves no card, no feed list and no module state behind;
     - the E=Up Overview draws the card even when the overview, the policy read and the Halo read all fail.
   The browser proof at 390px is scripts/e2e/halo-module.e2e.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/* the flat DOM of scripts/test/control-eup.test.mjs: innerHTML parsed into attribute-bearing elements */
class El extends EventTarget {
  constructor(tag, attrs, text) { super(); this.tag = tag || 'div'; this.attrs = attrs || {}; this.text = text || ''; this.kids = []; this.dataset = {}; this.isConnected = true; this.value = this.attrs.value || ''; this._html = ''; }
  set innerHTML(s) { this._html = String(s); this.kids = parse(this._html); this.kids.forEach((k) => { k.owner = this.kids; }); }
  get innerHTML() { return this._html; }
  get textContent() { return this.kids.length ? this._html.replace(/<[^>]+>/g, ' ') : this.text; }
  set textContent(v) { this.text = String(v); this._html = ''; this.kids = []; }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  querySelectorAll(sel) { const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel); if (!m) return []; const pool = this.kids.length ? this.kids : (this.owner || []); return pool.filter((k) => k !== this && Object.hasOwn(k.attrs, m[1]) && (m[2] === undefined || k.attrs[m[1]] === m[2])); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  focus() { document.activeElement = this; }
  click() { if (this.onclick) return this.onclick(); }
}
function parse(html) {
  const out = []; const re = /<([a-z][a-z0-9]*)\b([^>]*)>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = {}; for (const a of m[2].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : a[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const close = html.indexOf('</' + m[1] + '>', re.lastIndex);
    out.push(new El(m[1], attrs, (close > 0 ? html.slice(re.lastIndex, close) : '').replace(/<[^>]+>/g, ' ')));
  }
  return out;
}
globalThis.window = new EventTarget();
window.crypto = globalThis.crypto; window.CR = {};
globalThis.document = { activeElement: null };
const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i += 1) await flush(); };
await import('../../js/control-room/halo-module.js');
await import('../../js/control-room/eup-league.js');
await import('../../js/control-room/eup.js');
const M = window.CR.haloModule, MH = M.helpers, E = window.CR.eup, EH = E.helpers;

const http = (status, reason) => Object.assign(new Error(reason || 'HTTP ' + status), { status, detail: reason ? { ok: false, reason } : null });
const ROUTES = ['action-globe.html?explore=1&halo=1', 'action-globe.html?explore=1&halo=missions', 'action-globe.html?explore=1&halo=people', 'action-globe.html?explore=1&halo=intel'];
const feed = (id, configured, extra = {}) => ({ id, label: id, group: 'g', route: '/v1/world/layers/' + id, credit: null, requires: [], configured, needs_map: false, ...extra });
/* SYNTHETIC answer in the shape of GET /v1/eup/halo (workers/mccluster/src/eup/halo.js); not a production reading */
const haloAnswer = (policy, feeds) => ({
  ok: true, scope: 'house_owner', generated_at: '2026-11-23T12:00:00.000Z',
  module: { id: 'halo', label: 'Hitman’s Halo', route: ROUTES[0], views: [] },
  access: { audience: 'house_owner', decided_by: 'release_guard' },
  policy, enforcement: { policy_enforced: false },
  feeds: feeds || [feed('quakes', true), feed('fires', false, { label: 'Thermal hotspots', requires: ['FIRMS_MAP_KEY'] }), feed('flights', null, { needs_map: true })]
});
const POLICIES = {
  unregistered: { status: 'unregistered', registered: false, installed: false, state: null, revision: null },
  not_installed: { status: 'available', registered: true, installed: false, state: null, revision: null },
  disabled: { status: 'available', registered: true, installed: true, state: 'disabled', revision: 0 },
  enabled: { status: 'available', registered: true, installed: true, state: 'enabled', revision: 1 },
  draining: { status: 'available', registered: true, installed: true, state: 'draining', revision: 2 },
  unknown: { status: 'unavailable', registered: null, installed: null, state: null, revision: null }
};
const doors = (html) => [...html.matchAll(/<a class="cr-btn[^"]*" href="([^"]+)" data-halo-open="([a-z]+)"/g)].map((m) => [m[2], m[1].replace(/&amp;/g, '&')]);

test('policy state is read strictly: anything unreadable is unknown, never enabled', () => {
  for (const [name, row] of Object.entries(POLICIES)) assert.equal(MH.policyState(row), name, name);
  assert.equal(MH.policyState(null), 'unknown'); assert.equal(MH.policyState({}), 'unknown');
  assert.equal(MH.policyState({ installed: true, state: 'on', revision: 1 }), 'unknown');
  assert.equal(MH.policyState({ installed: true, state: 'enabled', revision: '1' }), 'unknown');
  assert.equal(MH.policyState({ installed: true, state: 'enabled' }), 'unknown');
  assert.equal(MH.policyState({ status: 'schema_not_applied', installed: true, state: 'enabled', revision: 1 }), 'unknown', 'a failed read outranks whatever rode along');
  assert.equal(MH.policyState({ moduleId: 'halo', registered: false, installed: false }), 'unregistered', 'a /v1/eup/modules row');
});

test('the card is discoverable in every policy state, and no state is presented as ready or open', () => {
  for (const [name, row] of Object.entries(POLICIES)) {
    const html = M.card({ policyRow: row, backend: { data: haloAnswer(row) } });
    assert.match(html, /<h3>Hitman’s Halo<\/h3>/, name); assert.match(html, /data-halo-audience>owner only</, name);
    assert.match(html, new RegExp('data-halo-policy="' + name + '"'), name);
    assert.deepEqual(doors(html), [['world', ROUTES[0]], ['missions', ROUTES[1]], ['people', ROUTES[2]], ['intel', ROUTES[3]]], name + ': the four existing deep links');
    assert.doesNotMatch(html, /\bready\b(?! check)|\bactive\b|\blive\b|is open\b/i, name + ': no readiness claim');
    assert.doesNotMatch(html, /https?:\/\/|token|bearer|iframe/i, name + ': no other origin, no session handoff');
  }
  const text = (name) => M.card({ policyRow: POLICIES[name], backend: { data: haloAnswer(POLICIES[name]) } }).replace(/<[^>]+>/g, ' ');
  assert.match(text('unregistered'), /not in the store yet/); assert.match(text('unregistered'), /supabase\/pending\/eup_module_policy_halo_v1\.sql is staged and not applied/);
  assert.match(text('not_installed'), /Registered, not installed/);
  assert.match(text('disabled'), /Installed and disabled, rev 0/);
  assert.match(text('enabled'), /Installed and enabled, rev 1\. Enabled is the recorded policy, not a readiness check/);
  for (const name of ['not_installed', 'disabled', 'enabled', 'draining']) assert.match(text(name), /No Halo route reads this unit yet, so it does not open or close Halo/, name);
  assert.match(text('unknown'), /could not be read\. Nothing is assumed/);
  assert.match(text('enabled'), /Decided by the release guard on every Halo route[^.]*, not by this card/);
});

test('backend states are said separately: answered, missing keys, unavailable, not deployed, timed out, unreadable', () => {
  const ok = MH.backendView({ data: haloAnswer(POLICIES.disabled, [feed('quakes', true), feed('tides', true)]) });
  assert.equal(ok.kind, 'answered'); assert.match(ok.text, /2 declared feeds: 2 configured, 0 missing a key or binding\./); assert.match(ok.text, /Configured is not a count/);
  const partial = MH.backendView({ data: haloAnswer(POLICIES.disabled) });
  assert.equal(partial.kind, 'partial'); assert.match(partial.text, /3 declared feeds: 1 configured, 1 missing a key or binding, 1 not checked here\./); assert.match(partial.text, /Missing: Thermal hotspots \(FIRMS_MAP_KEY\)/);
  assert.equal(MH.backendView({ error: http(503, 'unavailable') }).kind, 'unavailable');
  assert.equal(MH.backendView({ error: http(404, 'unknown_section') }).kind, 'not_deployed');
  assert.match(MH.backendView({ error: http(404, 'unknown_section') }).text, /does not serve the Halo module section yet/);
  assert.equal(MH.backendView({ error: Object.assign(new Error('deadline'), { timeout: true, deadline: 15000 }) }).kind, 'unavailable');
  assert.equal(MH.backendView({ error: Object.assign(new Error('x'), { malformed: true }) }).kind, 'unavailable');
  assert.equal(MH.backendView({ loading: true }).kind, 'loading'); assert.equal(MH.backendView({}).kind, 'unknown');
  for (const b of [{ error: http(503) }, { error: http(404) }, { loading: true }, {}]) {
    const html = M.card({ policyRow: null, backend: b });
    assert.equal(doors(html).length, 4, 'the door does not depend on the backend answering');
    assert.match(html, /data-halo-policy="unknown"/, 'no policy is invented while the backend is silent');
  }
  assert.equal(MH.readable(haloAnswer(POLICIES.enabled)), true);
  for (const bad of [null, {}, { ok: true }, { ...haloAnswer(POLICIES.enabled), ok: false }, { ...haloAnswer(POLICIES.enabled), module: { id: 'other' } }, { ...haloAnswer(POLICIES.enabled), feeds: null }]) assert.equal(MH.readable(bad), false);
});

function mountModule(request) {
  const root = new El('div'); root.innerHTML = M.render();
  const done = M.bind(root, { request, deadlineMs: 40 });
  return { root, done, body: () => root.querySelector('[data-halo-body]'), status: () => root.querySelector('[data-halo-status]') };
}

test('Control entry: the owner sees the card, its door and the declared feeds; one GET and no command', async () => {
  const log = [];
  const m = mountModule((path, opts) => { log.push([path, opts && opts.method]); return Promise.resolve(haloAnswer(POLICIES.unregistered)); });
  await m.done; await settle();
  assert.deepEqual(log, [['/v1/eup/halo', undefined]]);
  const b = m.body();
  assert.equal(b.querySelectorAll('[data-halo-module]').length, 1); assert.equal(b.querySelector('[data-halo-module]').attrs['data-halo-policy'], 'unregistered');
  assert.deepEqual(b.querySelectorAll('[data-halo-open]').map((a) => a.attrs.href), ROUTES);
  assert.deepEqual(b.querySelectorAll('[data-halo-feed]').map((f) => [f.attrs['data-halo-feed'], f.attrs['data-halo-feed-configured']]), [['quakes', 'true'], ['fires', 'false'], ['flights', 'null']]);
  assert.match(b.textContent, /This is configuration, not data/);
  assert.equal(b.querySelector('[data-halo-policy-link]').attrs.href, 'control.html#system:eup');
  assert.match(m.status().textContent, /No changes were made/);
});

test('permissions: a member (403) and a guest (401) get a refusal and nothing else, even after a good read', async () => {
  for (const [err, kind] of [[http(403, 'owner_required'), 'denied'], [http(401, 'authentication_required'), 'signed_out'], [Object.assign(new Error('signed out'), { status: 401 }), 'signed_out']]) {
    let n = 0;
    const m = mountModule(() => { n += 1; return n === 1 ? Promise.resolve(haloAnswer(POLICIES.enabled)) : Promise.reject(err); });
    await m.done; await settle();
    assert.equal(m.body().querySelectorAll('[data-halo-feed]').length, 3, 'the owner read drew the feeds');
    m.body().querySelector('[data-halo-reload]').click(); await settle();
    const b = m.body();
    assert.deepEqual(b.querySelectorAll('[data-halo-note]').map((x) => x.attrs['data-halo-note']), [kind]);
    for (const sel of ['[data-halo-module]', '[data-halo-feed]', '[data-halo-open]', '[data-halo-policy-chip]', '[data-halo-reload]']) assert.equal(b.querySelectorAll(sel).length, 0, kind + ' ' + sel);
    assert.equal(MH.model().data, null, 'what was read is dropped');
    assert.doesNotMatch(b.textContent, /FIRMS_MAP_KEY|enabled|quakes/);
  }
});

test('backend unavailable, not deployed or silent: the card and door stay, state reads unknown, nothing stale is shown as current', async () => {
  for (const [reply, kind] of [[() => Promise.reject(http(503, 'unavailable')), 'unavailable'], [() => Promise.reject(http(404, 'unknown_section')), 'not_deployed'], [() => new Promise(() => {}), 'unavailable'], [() => Promise.resolve({ ok: true }), 'unavailable']]) {
    let n = 0;
    const m = mountModule(() => { n += 1; return n === 1 ? Promise.resolve(haloAnswer(POLICIES.enabled)) : reply(); });
    await m.done; await settle();
    m.body().querySelector('[data-halo-reload]').click(); await new Promise((r) => setTimeout(r, 70)); await settle();
    const card = m.body().querySelector('[data-halo-module]');
    assert.ok(card, kind); assert.equal(card.attrs['data-halo-backend'], kind); assert.equal(card.attrs['data-halo-policy'], 'unknown', 'the earlier "enabled" is not kept as current');
    assert.equal(m.body().querySelectorAll('[data-halo-open]').length, 4); assert.equal(m.body().querySelectorAll('[data-halo-feed]').length, 0);
    assert.ok(m.body().querySelector('[data-halo-reload]'), 'the owner can ask again');
  }
});

test('an account change clears the Control entry at once', async () => {
  const m = mountModule(() => Promise.resolve(haloAnswer(POLICIES.enabled)));
  await m.done; await settle();
  assert.ok(m.body().querySelector('[data-halo-module]'));
  window.dispatchEvent(new Event('mcc:auth-changed'));
  assert.equal(m.body().querySelectorAll('[data-halo-module]').length, 0); assert.equal(MH.model().data, null);
  assert.deepEqual(m.body().querySelectorAll('[data-halo-note]').map((x) => x.attrs['data-halo-note']), ['signed_out']);
});

/* ----- the same card under Control → System → E=Up → Overview → Modules ----- */
const OVERVIEW = { ok: true, modules: [{ id: 'halo', label: 'Hitman’s Halo', state: 'owner_only', policy_module: 'halo', policy: { registered: false, installed: false, state: null, revision: null }, detail: '' }], geography: { selected: null }, campaigns: {}, queues: {}, freshness: [], blockers: [] };
const blank = (moduleId, extra = {}) => ({ moduleId, installed: false, state: null, revision: null, updated_at: null, updated_by: null, last_command: null, ...extra });
const control = (halo) => ({ ok: true, installationId: 'mccluster', commands: [], modules: [blank('environment'), blank('league'), blank('intake'), ...(halo ? [halo] : [])] });
function mountEup(answers) {
  EH.resetModel(); EH.model().section = 'overview';
  const log = [];
  const request = (path, opts) => { log.push(path); const a = answers[path]; if (typeof a === 'function') return a(); return a instanceof Error ? Promise.reject(a) : a ? Promise.resolve(a) : Promise.reject(http(503, 'not_implemented')); };
  const root = new El('div'); root.innerHTML = E.render(); E.bind(root, { request });
  return { log, pane: () => root.querySelector('[data-eup-pane]') };
}

test('Admin Modules: the Hitman’s Halo card sits in the Overview with the state of each read', async () => {
  const m = mountEup({ '/v1/eup/overview': OVERVIEW, '/v1/eup/modules': control(blank('halo', { registered: false, pending_sql: 'supabase/pending/eup_module_policy_halo_v1.sql' })), '/v1/eup/halo': haloAnswer(POLICIES.unregistered) });
  await settle();
  assert.deepEqual(m.log, ['/v1/eup/overview', '/v1/eup/modules', '/v1/eup/halo']);
  const card = m.pane().querySelector('[data-halo-module]');
  assert.ok(card, 'an explicit card, not only a list row'); assert.equal(card.attrs['data-halo-policy'], 'unregistered'); assert.equal(card.attrs['data-halo-backend'], 'partial');
  assert.deepEqual(m.pane().querySelectorAll('[data-halo-open]').map((a) => a.attrs.href), ROUTES);
  assert.equal(m.pane().querySelector('[data-halo-module-link]').attrs.href, 'control.html#system:halo');
  assert.equal(m.pane().querySelector('[data-eup-module="halo"]').attrs['data-eup-module'], 'halo', 'and the module list names it');
  assert.equal(m.pane().querySelector('[data-eup-policy="halo"]').attrs['data-eup-policy-state'], 'halo:unregistered');
  assert.equal(m.pane().querySelectorAll('[data-eup-policy-command]').filter((b) => b.attrs['data-eup-policy-command'].startsWith('halo:')).length, 0, 'no fake Install for a unit the store does not know');
  /* once the store answers for the unit, the authorized action is the real one */
  const n = mountEup({ '/v1/eup/overview': OVERVIEW, '/v1/eup/modules': control(blank('halo', { registered: true })), '/v1/eup/halo': haloAnswer(POLICIES.not_installed) });
  await settle();
  assert.equal(n.pane().querySelector('[data-halo-module]').attrs['data-halo-policy'], 'not_installed');
  assert.deepEqual(n.pane().querySelectorAll('[data-eup-policy-command]').map((b) => b.attrs['data-eup-policy-command']).filter((c) => c.startsWith('halo:')), ['halo:install']);
  const d = mountEup({ '/v1/eup/overview': OVERVIEW, '/v1/eup/modules': control(blank('halo', { registered: true, installed: true, state: 'disabled', revision: 0 })), '/v1/eup/halo': haloAnswer(POLICIES.disabled) });
  await settle();
  assert.equal(d.pane().querySelector('[data-halo-module]').attrs['data-halo-policy'], 'disabled');
  assert.equal(d.pane().querySelectorAll('[data-halo-open]').length, 4, 'a disabled unit does not hide the card or pretend the door is shut');
  assert.match(d.pane().querySelector('[data-eup-policy-meaning]').textContent, /Disabled: recorded only\. No Halo route reads this unit yet/);
});

test('Admin Modules: the card survives a failed overview, a failed policy read, an old Worker and a silent Halo backend', async () => {
  /* everything fails with 503 */
  const a = mountEup({}); await settle();
  let card = a.pane().querySelector('[data-halo-module]');
  assert.ok(card); assert.equal(card.attrs['data-halo-policy'], 'unknown'); assert.equal(card.attrs['data-halo-backend'], 'unavailable');
  assert.equal(a.pane().querySelectorAll('[data-halo-open]').length, 4);
  assert.equal(a.pane().querySelectorAll('[data-eup-policy-command]').length, 0);
  /* an older Worker: three units, no /v1/eup/halo section (404). The three units still work; Halo says why it cannot */
  const b = mountEup({ '/v1/eup/overview': OVERVIEW, '/v1/eup/modules': control(null), '/v1/eup/halo': http(404, 'unknown_section') }); await settle();
  card = b.pane().querySelector('[data-halo-module]');
  assert.equal(card.attrs['data-halo-policy'], 'unregistered'); assert.equal(card.attrs['data-halo-backend'], 'not_deployed');
  assert.equal(b.pane().querySelectorAll('[data-eup-policy-command]').length, 3, 'Install is still offered for the three applied units');
  /* policy read failed, Halo backend answered: the card takes the policy from the Halo read rather than guessing */
  const c = mountEup({ '/v1/eup/overview': OVERVIEW, '/v1/eup/modules': http(503, 'storage_unavailable'), '/v1/eup/halo': haloAnswer(POLICIES.enabled) }); await settle();
  assert.equal(c.pane().querySelector('[data-halo-module]').attrs['data-halo-policy'], 'enabled');
  assert.match(c.pane().querySelector('[data-halo-policy-line]').textContent, /not a readiness check/);
});

test('Admin Modules: a member or a guest never sees the card', async () => {
  for (const [answers, note] of [
    [{ '/v1/eup/overview': http(403, 'owner_required') }, 'denied'],
    [{ '/v1/eup/overview': OVERVIEW, '/v1/eup/modules': control(null), '/v1/eup/halo': http(403, 'owner_required') }, 'denied'],
    [{ '/v1/eup/overview': http(401, 'authentication_required') }, 'signed_out'],
    [{ '/v1/eup/overview': OVERVIEW, '/v1/eup/modules': control(null), '/v1/eup/halo': http(401, 'authentication_required') }, 'signed_out']
  ]) {
    const m = mountEup(answers); await settle();
    assert.deepEqual(m.pane().querySelectorAll('[data-eup-note]').map((n) => n.attrs['data-eup-note']), [note]);
    for (const sel of ['[data-halo-module]', '[data-halo-open]', '[data-eup-policy]', '[data-eup-module]']) assert.equal(m.pane().querySelectorAll(sel).length, 0, note + ' ' + sel);
  }
});

test('wiring: control.html loads the module before eup.js; the public Globe and World pages do not load it', async () => {
  const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');
  const [control, globe, world, mod, core] = await Promise.all([read('control.html'), read('action-globe.html'), read('mnet.html'), read('js/control-room/halo-module.js'), read('js/control-room/workspace-core.js')]);
  const at = control.indexOf('js/control-room/halo-module.js');
  assert.ok(at > 0 && at < control.indexOf('js/control-room/eup.js') && at < control.indexOf('js/control-room-v2.js'));
  assert.ok(control.indexOf('js/control-room/workspace-core.js') < at, 'the one HALO_PAGE constant is defined first');
  for (const [name, page] of [['action-globe.html', globe], ['mnet.html', world]]) assert.doesNotMatch(page, /halo-module\.js|\/v1\/eup\/halo/, name);
  assert.match(core, /const HALO_PAGE = 'action-globe\.html\?explore=1&halo=1';/);
  assert.equal(MH.HALO_PAGE, 'action-globe.html?explore=1&halo=1');
  assert.doesNotMatch(mod, /localStorage|sessionStorage|document\.cookie|createElement\('iframe'\)|postMessage/, 'no stored state, no frame, no cross-site handoff');
  assert.doesNotMatch(mod, /method: 'POST'|method: "POST"/, 'the module page sends no command');
});
