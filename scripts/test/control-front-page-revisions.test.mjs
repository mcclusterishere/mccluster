// js/control-room/front-page.js under site_content_v2: save and reset carry the slot's revision, a stale write
// keeps the preview's changes and waits for a decision, a lost response is read back, and restore is a new live
// revision. Without the RPC installed the legacy RPCs remain, guarded by a readback, never blind.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const REVISIONS = readFileSync('js/editor-revisions.js', 'utf8');
const FRONT = readFileSync('js/control-room/front-page.js', 'utf8');
const flush = async () => { for (let i = 0; i < 16; i++) await new Promise(r => setImmediate(r)); };
const SHIPPED = { visible: true, start: 'cabin', song: 'antisocial', scenes: { doors: true, vaunt: true, night: true, world: true }, scroll: { duration: 0.85, touchLerp: 0.14 }, vr: { enabled: true, hold: true, yaw: 0, pitch: 0, band: [0.1, 0.2], spots: [] }, night: { arrive: 0.7 } };

function view({ rpcs, rows }) {
  const calls = [], listeners = {}, winListeners = {};
  function node(name) {
    const n = { name, _html: '', listeners: {}, hidden: false, disabled: false, attrs: {}, set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = String(v); },
      querySelectorAll(sel) { if (sel === 'button') return [...this._html.matchAll(/<button[^>]*data-cfp="([^"]+)"/g)].map(m => Object.assign(node('button'), { attrs: { 'data-cfp': m[1] } })); return []; },
      querySelector() { return null; }, closest() { return null; }, offsetHeight: 0, style: { setProperty() {}, removeProperty() {} }, parentNode: { clientWidth: 390, parentNode: null } };
    return n;
  }
  const frameWin = { postMessage(msg) { calls.push(['frame', msg.type]); if (msg.type === 'mcc:front-preview') setImmediate(() => { for (const f of winListeners.message || []) f({ origin: 'https://matthew.mccluster.org', source: frameWin, data: { type: 'mcc:front-applied', seq: msg.seq, commit: msg.commit, config: msg.config || SHIPPED } }); }); } };
  const form = node('form'), status = node('status'), actions = node('actions'), frame = { contentWindow: frameWin, parentNode: node('device') };
  frame.parentNode.parentNode = { clientWidth: 390, parentNode: null };
  const host = { querySelector(sel) { return sel === '[data-cfp-frame]' ? frame : sel === '[data-cfp-form]' ? form : sel === '[data-cfp-status]' ? status : sel === '[data-cfp-actions]' ? actions : sel === '.cfp-viewport' ? node('viewport') : null; }, querySelectorAll() { return []; } };
  const root = { querySelector(sel) { return sel === '[data-cfp-root]' ? host : null; } };
  const document = { querySelector(sel) { return sel === '[data-cfp-root]' ? { querySelector: host.querySelector } : null; } };
  const fetch = async (url, init) => {
    const u = new URL(url); calls.push(['fetch', u.pathname, init && init.body ? JSON.parse(init.body) : null]);
    if (u.pathname.startsWith('/rest/v1/rpc/')) { const fn = u.pathname.split('/').pop(), body = JSON.parse(init.body); const r = rpcs[fn] ? rpcs[fn](body) : { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } }; if (r instanceof Error) throw r; return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) }; }
    return { ok: true, status: 200, json: async () => rows() };
  };
  const window = { CR: {}, MCC_SUPA: { url: 'https://db.supabase.co', key: 'anon', token: async () => 'admin-token' }, addEventListener(t, f) { (winListeners[t] ||= []).push(f); }, matchMedia: () => ({ matches: false }), confirm: () => true, innerHeight: 800 };
  const ctx = { window, document, location: { origin: 'https://matthew.mccluster.org' }, fetch, JSON, Date, Promise, String, Number, Object, Array, Math, isFinite, isNaN, Error, Boolean, URL, encodeURIComponent, setTimeout: (f) => { setImmediate(() => {}); return 1; }, clearTimeout() {}, console, ResizeObserver: undefined };
  ctx.setTimeout = (f, ms) => { if (ms >= 4000) return 1; setImmediate(f); return 1; };
  vm.runInNewContext(REVISIONS + '\n' + FRONT, ctx);
  const FP = window.CR.frontPage, S = FP.state;
  FP.init({ request: () => {}, render: () => {} });
  FP.render(); FP.bind(root);
  for (const f of winListeners.message) f({ origin: 'https://matthew.mccluster.org', source: frameWin, data: { type: 'mcc:front-ready' } });
  return {
    S, calls, status,
    async open() { await flush(); await flush(); return S; },
    async press(name, where = actions, attrs = {}) { const b = Object.assign(node('button'), { attrs: { 'data-cfp': name, ...attrs } }); for (const f of where.listeners.click) f({ target: { closest: () => b } }); await flush(); await flush(); },
    rpc: fn => calls.filter(c => c[0] === 'fetch' && c[1] === '/rest/v1/rpc/' + fn).map(c => c[2])
  };
}
const head = (revision, value, extra = {}) => ({ status: 200, body: { ok: true, revision, protected: revision > 0, snapshot: value === null ? null : { page: 'index.html', slot: '@front', value: JSON.stringify(value), kind: 'text', updated_at: '2026-11-01T00:00:00Z' }, history: null, ...extra } });
const rowsOf = v => () => v === null ? [] : [{ value: JSON.stringify(v), updated_at: '2026-11-01T00:00:00Z' }];

test('opening reads the slot head: the live row, its revision, and a form seeded from the real page', async () => {
  const v = view({ rows: rowsOf(SHIPPED), rpcs: { site_content_v2: b => b.p_action === 'read' ? head(2, SHIPPED) : { status: 400, body: {} } } });
  const S = await v.open();
  assert.equal(S.v2.revision, 2); assert.equal(S.legacy, false); assert.ok(S.draft, 'seeded from the page');
  assert.match(v.status.innerHTML, /revision 2/);
  assert.deepEqual(v.rpc('site_content_v2').map(b => b.p_action), ['read']);
});

test('save carries p_expected and adopts the returned revision; reset too; legacy RPCs are never called', async () => {
  let rev = 2;
  const v = view({ rows: rowsOf(SHIPPED), rpcs: { site_content_v2: b => { if (b.p_action === 'read') return head(rev, SHIPPED); assert.equal(b.p_expected, rev); rev++; return head(rev, b.p_action === 'reset' ? null : JSON.parse(b.p_data.value)); } } });
  const S = await v.open();
  S.draft.song = 'here'; S.dirty = true;
  await v.press('save');
  const saves = v.rpc('site_content_v2').filter(b => b.p_action === 'save');
  assert.equal(saves.length, 1); assert.equal(saves[0].p_expected, 2); assert.equal(JSON.parse(saves[0].p_data.value).song, 'here'); assert.equal(saves[0].p_data.kind, 'text');
  assert.equal(S.v2.revision, 3); assert.equal(S.dirty, false); assert.match(v.status.innerHTML, /Saved as revision 3/);
  await v.press('reset');
  const resets = v.rpc('site_content_v2').filter(b => b.p_action === 'reset');
  assert.equal(resets.length, 1); assert.equal(resets[0].p_expected, 3); assert.equal(S.v2.revision, 4); assert.equal(S.saved, null);
  assert.equal(v.rpc('site_content_set').length + v.rpc('site_content_revert').length, 0);
});

test('a stale save keeps the preview changes and offers the decision; keeping mine resends on the latest revision', async () => {
  const attempts = [];
  const v = view({ rows: rowsOf(SHIPPED), rpcs: { site_content_v2: b => { if (b.p_action === 'read') return head(6, { ...SHIPPED, song: 'vaunt' }); attempts.push(b.p_expected); return b.p_expected === 6 ? head(7, JSON.parse(b.p_data.value)) : { status: 409, body: { code: 'PT409', message: 'editor_revision_conflict' } }; } } });
  const S = await v.open(); S.v2.revision = 4;
  S.draft.song = 'runway'; S.dirty = true;
  await v.press('save');
  assert.deepEqual(attempts, [4]); assert.ok(S.conflict); assert.equal(S.draft.song, 'runway'); assert.equal(S.dirty, true);
  assert.match(v.status.innerHTML, /now revision 6/);
  await v.press('conflict-keep', v.status);
  assert.deepEqual(attempts, [4, 6]); assert.equal(S.v2.revision, 7); assert.equal(S.conflict, null); assert.equal(S.saved.song, 'runway');
});

test('a lost response is read back before anything is retried', async () => {
  let readRev = 2, readVal = SHIPPED;
  const v = view({ rows: rowsOf(SHIPPED), rpcs: { site_content_v2: b => b.p_action === 'read' ? head(readRev, readVal) : new TypeError('Failed to fetch') } });
  const S = await v.open();
  S.draft.song = 'here'; S.dirty = true; readRev = 3; readVal = { ...S.draft };
  await v.press('save');
  assert.equal(S.v2.revision, 3); assert.equal(S.dirty, false); assert.match(v.status.innerHTML, /Confirmed: it was saved/);
  S.draft.song = 'vaunt'; S.dirty = true; readRev = 3;
  await v.press('save');
  assert.equal(S.dirty, true); assert.match(v.status.innerHTML, /nothing reached the server/);
});

test('history lists revisions; restore writes a chosen one live as a new revision and never rewrites history', async () => {
  let restored = null;
  const v = view({ rows: rowsOf(SHIPPED), rpcs: { site_content_v2: b => b.p_action === 'read' ? head(5, SHIPPED) : b.p_action === 'history' ? head(5, SHIPPED, { history: [{ revision: 5, operation: 'save', at: '2026-11-02T00:00:00Z', snapshot: { value: JSON.stringify(SHIPPED) } }, { revision: 3, operation: 'save', at: '2026-11-01T00:00:00Z', snapshot: { value: JSON.stringify({ ...SHIPPED, song: 'here' }) } }, { revision: 1, operation: 'reset', at: '2026-10-31T00:00:00Z', snapshot: null }] }) : (restored = b, head(6, { ...SHIPPED, song: 'here' })) } });
  const S = await v.open();
  await v.press('history');
  assert.match(v.status.innerHTML, /Revision 3/); assert.match(v.status.innerHTML, /reset to shipped/);
  await v.press('restore', v.status, { 'data-rev': '3' });
  assert.equal(restored.p_action, 'restore'); assert.equal(restored.p_expected, 5); assert.equal(restored.p_restore, 3); assert.equal(restored.p_data, null);
  assert.equal(S.v2.revision, 6); assert.equal(S.saved.song, 'here'); assert.match(v.status.innerHTML, /Restored revision 3 as revision 6/);
});

test('without the versioned RPC installed, the legacy RPC runs after a readback and never over a newer save', async () => {
  let at = '2026-11-01T00:00:00Z', sets = 0;
  const v = view({ rows: () => [{ value: JSON.stringify(SHIPPED), updated_at: at }], rpcs: { site_content_set: () => { sets++; return { status: 200, body: { updated_at: '2026-11-02T00:00:00Z' } }; } } });
  const S = await v.open();
  assert.equal(S.legacy, true); assert.equal(S.v2, null); assert.match(v.status.innerHTML, /not installed/);
  S.draft.song = 'here'; S.dirty = true;
  await v.press('save');
  assert.equal(sets, 1); assert.equal(S.savedAt, '2026-11-02T00:00:00Z');
  at = '2026-11-03T00:00:00Z'; S.draft.song = 'vaunt'; S.dirty = true;
  await v.press('save');
  assert.equal(sets, 1, 'the newer save was not overwritten'); assert.equal(S.draft.song, 'vaunt'); assert.match(v.status.innerHTML, /changed somewhere else/);
});
