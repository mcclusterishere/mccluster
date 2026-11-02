// js/customer-site.js: every control on the dashboard persists to its canonical authority and is confirmed by the
// server's own projection; refusals roll the control back and say why; signed-out / foreign / unconfigured states
// are distinct and never present a dead switch as working.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('js/customer-site.js', 'utf8');
const flush = async () => { for (let i = 0; i < 14; i++) await new Promise(r => setImmediate(r)); };
const MODULES = (world, discovery) => ({ ok: true, source: { kind: 'front', key: 'me' }, modules: [
  { key: 'site', name: 'Website', required: true, configurable: false, enabled: true, description: 'Your website.' },
  { key: 'world', name: 'World feed', required: false, configurable: true, enabled: world, description: 'World tab.' },
  { key: 'world_discovery', name: 'World discovery', required: false, configurable: true, enabled: discovery, description: 'Directory.' },
  { key: 'hosting', name: 'Custom hosting', required: false, configurable: false, enabled: false, description: 'Optional paid hosting.' } ], global_membership_unchanged: true });

function dashboard(routes) {
  const calls = [], listeners = {};
  function el(tag) { const n = { tagName: tag, children: [], textContent: '', className: '', attrs: {}, type: '', checked: false, disabled: false, value: '', listeners: {}, appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } }; return n; }
  const root = el('div');
  const document = { getElementById: id => id === 'siteStatus' ? root : null, createElement: t => el(t), createTextNode: t => ({ textContent: t }) };
  const fetch = async (url, init) => { const u = new URL(url), method = (init && init.method) || 'GET', body = init && init.body ? JSON.parse(init.body) : null; calls.push([method, u.pathname + u.search, body]); const r = routes[method + ' ' + u.pathname]; if (!r) return { ok: false, status: 503, json: async () => ({ code: 'unconfigured' }) }; const res = typeof r === 'function' ? r(body) : r; return { ok: res.status < 400, status: res.status, json: async () => res.body }; };
  const session = { access_token: 'tok' };
  const window = { MCC: { refreshIfNeeded: async () => session, session: () => session }, MCC_PLATFORM_ACCESS: null, addEventListener(t, f) { (listeners[t] ||= []).push(f); } };
  vm.runInNewContext(SRC, { window, document, location: { search: '' }, fetch, URL, URLSearchParams, JSON, Promise, Object, Array, Number, String, Error, Date, encodeURIComponent, setTimeout: () => 0, clearTimeout() {}, AbortController, console });
  const walk = (n, out = []) => { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; };
  const text = n => [n.textContent, ...(n.children || []).map(text)].join(' ');
  return { root, calls, walk, text: () => text(root), async ready() { await flush(); await flush(); }, moduleSwitch(key) { const card = walk(root).find(n => n.tagName === 'section' && n.children[0] && n.children[0].textContent === 'Website modules'); return walk(card).filter(n => n.tagName === 'input' && n.type === 'checkbox'); } };
}
const base = { 'GET /v1/fronts/me': { status: 200, body: { ok: true, handle: 'alice', draft: {}, published: null } }, 'GET /v1/creator-billing/entitlement': { status: 200, body: { paid: false, workspaces: [] } }, 'GET /v1/customer-site/storage': { status: 200, body: { ok: true, used_bytes: 0, reserved_bytes: 0, quota_bytes: 50000000 } }, 'GET /v1/customer-site/address': { status: 200, body: { ok: true, address: null } } };

test('a module switch is confirmed only by the server projection after the write; the note names the new state', async () => {
  let world = false;
  const d = dashboard({ ...base, 'GET /v1/customer-site/modules': () => ({ status: 200, body: MODULES(world, false) }), 'POST /v1/customer-site/modules': b => { world = b.enabled; return { status: 200, body: MODULES(world, false) }; } });
  await d.ready();
  const [w] = d.moduleSwitch(); assert.ok(w, 'the world switch is drawn'); assert.equal(w.checked, false);
  w.checked = true; for (const f of w.listeners.change) f(); await flush(); await flush();
  const post = d.calls.find(c => c[0] === 'POST'); assert.deepEqual(post[2], { module: 'world', enabled: true });
  assert.equal(w.checked, true); assert.match(d.text(), /World tab is on for this website/);
});

test('a refused write rolls the switch back and says why, by status', async () => {
  for (const [status, expect] of [[401, /session expired/], [404, /no longer in your account/], [503, /unavailable right now/], [400, /could not be saved/]]) {
    const d = dashboard({ ...base, 'GET /v1/customer-site/modules': { status: 200, body: MODULES(false, false) }, 'POST /v1/customer-site/modules': { status, body: { error: 'x' } } });
    await d.ready(); const [w] = d.moduleSwitch(); w.checked = true; for (const f of w.listeners.change) f(); await flush(); await flush();
    assert.equal(w.checked, false, 'rolled back on ' + status); assert.match(d.text(), expect);
  }
});

test('a write the server answers without confirming the new state is treated as unconfirmed', async () => {
  const d = dashboard({ ...base, 'GET /v1/customer-site/modules': { status: 200, body: MODULES(false, false) }, 'POST /v1/customer-site/modules': { status: 200, body: MODULES(false, false) } });
  await d.ready(); const [w] = d.moduleSwitch(); w.checked = true; for (const f of w.listeners.change) f(); await flush(); await flush();
  assert.equal(w.checked, false); assert.match(d.text(), /did not confirm the change/);
});

test('unconfigured, signed-out and foreign-website module states are distinct and show no switch', async () => {
  for (const [res, expect] of [[{ status: 503, body: { code: 'unconfigured' } }, /not switched on for this site yet/], [{ status: 401, body: {} }, /Sign in again to see/], [{ status: 404, body: { code: 'not_found' } }, /not in your account/], [{ status: 500, body: {} }, /could not be read right now/]]) {
    const d = dashboard({ ...base, 'GET /v1/customer-site/modules': res });
    await d.ready(); assert.equal(d.moduleSwitch().length, 0); assert.match(d.text(), expect);
  }
});
