// js/site-editor.js: each slot edit is saved with the revision it was read at (site_content_v2); a slot that changed
// under the hand typing in it is never overwritten; legacy RPCs remain only where the versioned RPC is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const REVISIONS = readFileSync('js/editor-revisions.js', 'utf8');
const EDITOR = readFileSync('js/site-editor.js', 'utf8');
// the editor's beginEdit is captured through a one-line hook so a slot edit can be driven without a DOM click
const EDITOR_WITH_HOOK = EDITOR.replace('function beginEdit(node) {', 'w.__begin = beginEdit; function beginEdit(node) {');
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
const TOKEN = 'h.' + Buffer.from(JSON.stringify({ email: 'matthew@mccluster.org' })).toString('base64url') + '.s';


test('a tagged slot is saved with the revision read when editing began, through site_content_v2', async () => {
  const saves = [];
  const p = pageWithHook({ rows: () => [], rpcs: { site_content_v2: b => { if (b.p_action === 'read') return { status: 200, body: { ok: true, revision: 4, snapshot: { value: 'Old words' } } }; saves.push(b); return { status: 200, body: { ok: true, revision: 5, snapshot: { value: b.p_data.value } } }; } } });
  await p.edit('New words');
  assert.equal(saves.length, 1); assert.equal(saves[0].p_expected, 4); assert.equal(saves[0].p_data.value, 'New words'); assert.equal(saves[0].p_data.original, 'Old words'); assert.equal(saves[0].p_data.fragile, false);
  assert.equal(p.say(), 'saved · rev 5');
  assert.equal(p.calls.filter(c => c[0].endsWith('site_content_set')).length, 0);
});

test('a slot that changed since it was opened is not overwritten; the typed words stay on screen', async () => {
  const p = pageWithHook({ rows: () => [], rpcs: { site_content_v2: b => b.p_action === 'read' ? { status: 200, body: { ok: true, revision: 4, snapshot: { value: 'Old words' } } } : { status: 409, body: { code: 'PT409', message: 'editor_revision_conflict' } } } });
  const node = await p.edit('Mine');
  assert.equal(node.textContent, 'Mine'); assert.match(p.say(), /changed elsewhere/);
});

test('without the versioned RPC, the legacy RPC runs only after the slot is read back unchanged', async () => {
  let at = '2026-11-01T00:00:00Z', sets = 0;
  const p = pageWithHook({ rows: () => [{ updated_at: at }], rpcs: { site_content_set: () => { sets++; return { status: 200, body: {} }; } } });
  await p.edit('New words');
  assert.equal(sets, 1); assert.equal(p.say(), 'saved');
  const later = pageWithHook({ rows: () => [{ updated_at: at }], rpcs: { site_content_set: () => { sets++; return { status: 200, body: {} }; } } });
  await later.edit('Later words', 'Old words', 'tagged', () => { at = '2026-11-02T00:00:00Z'; }); // changes between the read at edit start and the readback before the write
  assert.equal(sets, 1, 'no second legacy write over the changed slot'); assert.match(later.say(), /changed elsewhere/);
});

function pageWithHook(opts) {
  const ctxHolder = {};
  const nodes = new Map(), calls = [];
  function el(tag) {
    return { tagName: tag, attrs: {}, listeners: {}, hidden: false, textContent: '', _html: '', contentEditable: 'false', children: [], isConnected: true,
      set innerHTML(v) { this._html = v; for (const m of v.matchAll(/id="([^"]+)"/g)) nodes.set(m[1], Object.assign(el('button'), { attrs: { id: m[1] } })); }, get innerHTML() { return this._html; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); },
      focus() {}, closest() { return null; }, classList: { toggle() {} } };
  }
  const document = { createElement: t => el(t), body: { appendChild(n) { return n; } }, head: { appendChild(n) { if (n.tagName === 'script') setImmediate(() => { vm.runInContext(REVISIONS, ctxHolder.ctx); n.onload(); }); return n; } },
    getElementById: id => nodes.get(id) || null, querySelectorAll: () => [], addEventListener() {}, documentElement: { classList: { toggle() {} } }, currentScript: { src: 'https://matthew.mccluster.org/js/site-editor.js?v=123' } };
  const fetch = async (url, init) => {
    const u = new URL(url); const body = init && init.body ? JSON.parse(init.body) : null; calls.push([u.pathname, body]);
    if (u.pathname.startsWith('/rest/v1/rpc/')) { const fn = u.pathname.split('/').pop(); const r = opts.rpcs[fn] ? opts.rpcs[fn](body) : { status: 404, body: { code: 'PGRST202' } }; return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) }; }
    return { ok: true, status: 200, json: async () => opts.rows() };
  };
  const window = { localStorage: { getItem: () => JSON.stringify({ access_token: TOKEN }) }, MCC_SLOT_PATH: () => 'auto-slot' };
  const ctx = vm.createContext({ window, document, localStorage: window.localStorage, location: { pathname: '/hire.html' }, fetch, atob: s => Buffer.from(s, 'base64').toString('binary'), JSON, Date, Promise, String, Number, Object, Array, Error, URL, encodeURIComponent, setTimeout: () => 0, clearTimeout() {}, console });
  ctxHolder.ctx = ctx;
  vm.runInContext(EDITOR_WITH_HOOK, ctx);
  return { calls, say: () => nodes.get('mccEditSay').textContent,
    async edit(text, before = 'Old words', slot = 'tagged', between = () => {}) {
      const node = Object.assign(el('P'), { textContent: before, attrs: slot ? { 'data-edit': slot } : {} });
      window.__begin(node); await flush(); await flush();
      between();
      node.textContent = text; for (const f of node.listeners.blur) f(); await flush(); await flush();
      return node;
    } };
}
