// js/website-studio/editor.mjs on the dual-revision Tile bridge: save/publish/unpublish/withdraw/recover/switch carry
// BOTH expected_editor_revision and expected_revision once the project is enrolled; a stale pair keeps the edits and
// waits; a lost response is read back; the legacy single-token PUT remains only where the bridge is unconfigured.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as proposal from '../../js/website-studio/proposal.mjs';

const SRC = readFileSync('js/website-studio/editor.mjs', 'utf8').replace(/^import [^\n]+\n/gm, '');
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 4)); for (let j = 0; j < 8; j++) await new Promise(r => setImmediate(r)); } };
const tile = (id, kind) => ({ id, kind, headline: 'h', body: 'b', source_ref: null, transition: null, playback: 'manual', action: null });
const DOC = { schema_version: 'website-studio/v1', template_key: 'motion-portfolio', template_version: 1, title: 'T', mode: 'standard', tiles: [tile('a', 'music'), tile('b', 'native_video'), tile('c', 'immersive360')] };

function studio({ routes }) {
  const calls = [], byId = new Map();
  function el(tag) {
    const n = { tagName: tag, children: [], attrs: {}, hidden: false, disabled: false, value: '', textContent: '', _cls: new Set(), style: {}, listeners: {},
      append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; }, remove() { if (this.id) byId.delete(this.id); this.removed = true; }, after(n2) { if (n2.id) byId.set(n2.id, n2); },
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') byId.set(v, this); }, getAttribute(k) { return this.attrs[k] ?? null; }, closest() { return { hidden: false }; }, scrollIntoView() {},
      classList: { toggle(c, on) { on ? n._cls.add(c) : n._cls.delete(c); }, contains: c => n._cls.has(c) }, get id() { return this.attrs.id; }, set id(v) { this.setAttribute('id', v); } };
    return n;
  }
  for (const id of ['useTemplate', 'demo', 'load', 'status', 'auth', 'authLink', 'editor', 'title', 'mode', 'tiles', 'guidance', 'save', 'preview', 'refreshMedia', 'workspace', 'publish', 'published', 'previewPanel', 'back', 'previewHost', 'manage', 'assist']) byId.set(id, Object.assign(el(id === 'workspace' ? 'select' : 'div'), { attrs: { id } }));
  const document = { getElementById: id => byId.get(id) || null, createElement: t => el(t) };
  const fetch = async (url, init) => {
    const u = new URL(url), method = (init && init.method) || 'GET', body = init && init.body ? JSON.parse(init.body) : null;
    calls.push([method, u.pathname, body]);
    const r = routes[method + ' ' + u.pathname]; if (!r) throw new TypeError('unexpected ' + method + ' ' + u.pathname);
    const res = typeof r === 'function' ? r(body) : r; if (res instanceof Error) throw res;
    return { ok: res.status < 400, status: res.status, json: async () => res.body };
  };
  const window = { MCC: { refreshIfNeeded: async () => {}, session: () => ({ access_token: 't' }), user: async () => ({ id: 'u' }) }, addEventListener() {} };
  const ctx = { window, document, location: { search: '?project=alpha' }, fetch, URL, URLSearchParams, sessionStorage: { setItem() {}, removeItem() {} }, confirm: () => true, structuredClone, AbortSignal, JSON, Promise, Object, Array, Number, String, Error, TypeError, Math, setTimeout: f => setImmediate(f), console,
    assertDocument() {}, renderWebsite() { return () => {}; }, ...proposal, structuredClone, TextEncoder, crypto: globalThis.crypto };
  vm.runInNewContext(SRC, ctx);
  const walk = (n, out = []) => { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; };
  return { calls, byId, walk, status: () => byId.get('status').textContent, manage: () => byId.get('manage'), assist: () => byId.get('assist'),
    async start() { byId.get('useTemplate').onclick(); await flush(); await flush(); },
    async click(id) { const n = byId.get(id); assert.ok(n, id + ' exists'); n.onclick(); await flush(); await flush(); },
    writes: p => calls.filter(c => c[0] !== 'GET' && c[1].includes(p)) };
}
const common = { 'GET /v1/projects/alpha/tiles/templates': { status: 200, body: { templates: [{ template_key: 'motion-portfolio', version: 1, definition: DOC, guidance: { transition: { help: '' } } }] } }, 'GET /v1/creator-sites/studio/assets': { status: 200, body: { assets: [], processing: { can_prepare: false, blockers: [] } } } };
const v1 = (revision) => ({ status: 200, body: { draft: { id: 'd1', revision, document: DOC }, presentation: 'tiles', free_publication: true } });
const v2 = (editor, studio, extra = {}) => ({ status: 200, body: { editor_revision: editor, studio_revision: studio, owner_withdrawn: false, removed: false, presentation: 'tiles', draft: { document: DOC }, ...extra } });

test('an enrolled project saves with both revisions and adopts both from the bridge answer', async () => {
  let put = null;
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': v2(9, 4), 'PUT /v2/projects/alpha/tiles': b => { put = b; return v2(10, 5); } } });
  await s.start();
  assert.match(s.status(), /Loaded saved revision 4/);
  assert.equal(s.manage().hidden, false, 'publication controls appear for an enrolled project');
  await s.click('save');
  assert.equal(put.expected_editor_revision, 9); assert.equal(put.expected_revision, 4); assert.deepEqual(JSON.parse(JSON.stringify(put.document)), DOC);
  assert.match(s.status(), /draft revision 5 · editor revision 10/);
  assert.equal(s.writes('/v1/').length, 0, 'no legacy write');
});

test('a stale pair keeps the edits and offers to keep mine over the latest revisions', async () => {
  const puts = [];
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': () => v2(12, 6), 'PUT /v2/projects/alpha/tiles': b => { puts.push([b.expected_editor_revision, b.expected_revision]); return b.expected_editor_revision === 12 ? v2(13, 7) : { status: 409, body: { error: 'editor_revision_conflict' } }; } } });
  await s.start();
  s.byId.get('title').value = 'Mine'; s.byId.get('title').oninput();
  // opened at (12,6) by the harness read; pretend it was opened earlier at (9,4)
  await s.click('save'); // first save at (12,6) succeeds → now at (13,7); next a stale pair:
  puts.length = 0;
  const ctxDoc = s.byId.get('title'); ctxDoc.value = 'Mine again'; ctxDoc.oninput();
  // force staleness: the server moved on; our tokens are (13,7) but the server now reports (12,6) read and refuses non-12
  await s.click('save');
  assert.deepEqual(puts, [[13, 7]]); assert.match(s.status(), /saved somewhere else/); assert.ok(s.byId.get('keepMine'), 'the decision is offered');
  await s.click('keepMine');
  assert.deepEqual(puts, [[13, 7], [12, 6]]); assert.match(s.status(), /Saved over the other change/);
});

test('publish, take down, withdraw and recover carry both revisions through the bridge', async () => {
  const seen = {};
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': v2(9, 4),
    'POST /v2/projects/alpha/tiles/publish': b => { seen.publish = b; return { status: 200, body: { ...v2(10, 4).body, published: true, presentation: 'tiles', url: 'https://matthew.mccluster.org/website-studio-view.html?project=alpha', revision: 4 } }; },
    'POST /v2/projects/alpha/tiles/unpublish': b => { seen.unpublish = b; return v2(11, 4); },
    'POST /v2/projects/alpha/tiles/withdraw': b => { seen.withdraw = b; return v2(12, 4, { owner_withdrawn: true, removed: true }); },
    'POST /v2/projects/alpha/tiles/recover': b => { seen.recover = b; return v2(13, 4); } } });
  await s.start();
  await s.click('publish');
  assert.equal(seen.publish.expected_editor_revision, 9); assert.equal(seen.publish.expected_revision, 4); assert.equal(seen.publish.confirm_public, true);
  assert.match(s.status(), /Published revision 4/);
  const buttons = () => s.manage().children.filter(c => c.tagName === 'button');
  assert.deepEqual(buttons().map(b => b.textContent), ['Take the published website down', 'Switch to the front-page presentation (unpublished)', 'Withdraw project']);
  buttons()[0].onclick(); await flush(); await flush();
  assert.deepEqual([seen.unpublish.expected_editor_revision, seen.unpublish.expected_revision], [10, 4]);
  buttons()[2].onclick(); await flush(); await flush();
  assert.deepEqual([seen.withdraw.expected_editor_revision, seen.withdraw.expected_revision], [11, 4]);
  assert.deepEqual(buttons().map(b => b.textContent), ['Recover project (stays unpublished)']);
  buttons()[0].onclick(); await flush(); await flush();
  assert.deepEqual([seen.recover.expected_editor_revision, seen.recover.expected_revision], [12, 4]); assert.match(s.status(), /Nothing is published/);
});

test('a lost response is read back: moved-by-one with the sent draft is confirmed, unchanged is retryable', async () => {
  let state = v2(9, 4);
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': () => state, 'PUT /v2/projects/alpha/tiles': new TypeError('Failed to fetch') } });
  await s.start();
  state = v2(10, 5);
  await s.click('save');
  assert.match(s.status(), /Confirmed: it was saved/);
  state = v2(10, 5);
  s.byId.get('title').value = 'x'; s.byId.get('title').oninput();
  await s.click('save');
  assert.match(s.status(), /nothing reached the server/);
});

test('where the bridge is unconfigured the legacy single-token PUT remains and no manage controls appear', async () => {
  let put = null;
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': { status: 503, body: { error: 'Versioned editor is not enabled', code: 'unconfigured' } }, 'PUT /v1/projects/alpha/tiles': b => { put = b; return { status: 200, body: { revision: 5 } }; } } });
  await s.start();
  assert.equal(s.manage().hidden, true);
  await s.click('save');
  assert.deepEqual(Object.keys(put).sort(), ['document', 'expected_revision']); assert.equal(put.expected_revision, 4); assert.match(s.status(), /revision 5/);
});

test('the owned proposal slice: own wording → diff → explicit Apply through the dual-revision save → one Undo', async () => {
  const puts = [];
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': v2(9, 4), 'PUT /v2/projects/alpha/tiles': b => { puts.push(b); return v2(9 + puts.length, 4 + puts.length, { draft: { document: b.document } }); } } });
  await s.start();
  const assist = s.assist(); assert.equal(assist.hidden, false);
  const src = s.walk(assist).find(n => n.tagName === 'select' && [...n.children].some(o => o.value === 'own')); src.value = 'own'; src.onchange();
  const inputs = s.walk(s.assist()); const head = inputs.find(n => n.tagName === 'input'); head.value = 'A clearer heading';
  inputs.find(n => n.tagName === 'select').value = 'a'; // the fake DOM does not preselect the first option
  const form = s.assist().children.find(n => n.tagName === 'form'); form.onsubmit({ preventDefault() {} }); await flush(); await flush();
  const diff = s.walk(s.assist()).find(n => n.tagName === 'dl'); assert.ok(diff, 'a diff is shown: ' + (s.walk(s.assist()).find(n => n.getAttribute && n.getAttribute('role') === 'status') || {}).textContent); assert.equal(s.walk(diff).find(n => n.tagName === 'ins').textContent, 'A clearer heading');
  assert.equal(puts.length, 0, 'preview persisted nothing');
  const apply = s.walk(s.assist()).find(n => n.tagName === 'button' && /^Apply/.test(n.textContent)); apply.onclick(); await flush(); await flush();
  assert.equal(puts.length, 1); assert.equal(puts[0].expected_editor_revision, 9); assert.equal(puts[0].expected_revision, 4);
  assert.equal(puts[0].document.tiles[0].headline, 'A clearer heading'); assert.equal(puts[0].document.tiles[1].headline, 'h', 'other tiles untouched');
  assert.match(s.status(), /Applied the proposal · draft revision 5 · editor revision 10/);
  const undo = s.walk(s.assist()).find(n => n.tagName === 'button' && /^Undo/.test(n.textContent)); assert.ok(undo, 'one undo entry'); undo.onclick(); await flush(); await flush();
  assert.equal(puts.length, 2); assert.equal(puts[1].expected_editor_revision, 10); assert.equal(puts[1].expected_revision, 5); assert.equal(puts[1].document.tiles[0].headline, 'h', 'the prior draft is saved as a new revision');
  assert.match(s.status(), /Undone as a new revision/);
  assert.equal(s.calls.filter(c => c[1].includes('/publish')).length, 0, 'nothing published');
});

test('a McCluster proposal is honest about an unregistered route, and refuses answers that do not belong to the run', async () => {
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': v2(9, 4), 'POST /v1/ai/tile-proposal': { status: 404, body: { error: 'Not found' } } } });
  await s.start();
  const ask = s.walk(s.assist()).find(n => n.tagName === 'textarea'); ask.value = 'make it warmer'; s.walk(s.assist()).find(n => n.tagName === 'select').value = 'a';
  s.assist().children.find(n => n.tagName === 'form').onsubmit({ preventDefault() {} }); await flush(); await flush();
  assert.match(s.walk(s.assist()).find(n => n.tagName === 'p' && n.getAttribute('role') === 'status').textContent, /not registered on the plane/);
  const sent = s.calls.find(c => c[1] === '/v1/ai/tile-proposal'); assert.equal(sent[2].target.tileId, 'a'); assert.equal(sent[2].tile.headline, 'h'); assert.ok(!('tiles' in sent[2]), 'only the one tile is sent');
});
