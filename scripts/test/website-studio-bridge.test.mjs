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

test('a lost response is verified against the editor-head history: tiles_save at rev+1 with the sent document is committed; other rows are unknown', async () => {
  let state = v2(9, 4), rows = [];
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': () => state, 'GET /v2/projects/alpha/history': () => ({ status: 200, body: { ok: true, revision: state.body.editor_revision, history: rows } }), 'PUT /v2/projects/alpha/tiles': new TypeError('Failed to fetch') } });
  await s.start();
  const sent = structuredClone(DOC); sent.title = 'x'; s.byId.get('title').value = 'x'; s.byId.get('title').oninput();
  state = v2(10, 5, { draft: { document: sent } }); rows = [{ revision: 10, operation: 'tiles_save' }];
  await s.click('save');
  assert.match(s.status(), /Confirmed from the history: it was saved/);
  s.byId.get('title').value = 'y'; s.byId.get('title').oninput();
  state = v2(11, 6, { draft: { document: sent } }); rows = [{ revision: 11, operation: 'tiles_unpublish' }];
  await s.click('save');
  assert.match(s.status(), /Unknown whether it was saved/); assert.equal(s.calls.filter(c => c[0] === 'PUT').length, 2, 'no silent retry');
});

test('FINDING 2: a lost PUBLISH through the bridge is not reported published without a tiles_publish row and a published revision', async () => {
  let state = v2(9, 4);
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': () => state, 'GET /v2/projects/alpha/history': () => ({ status: 200, body: { ok: true, revision: 10, history: [{ revision: 10, operation: 'tiles_save' }] } }), 'POST /v2/projects/alpha/tiles/publish': new TypeError('Failed to fetch') } });
  await s.start(); state = v2(10, 4);
  await s.click('publish');
  assert.doesNotMatch(s.status(), /Published|Confirmed/); assert.match(s.status(), /Unknown whether it was published/); assert.equal(s.byId.get('published').children.length, 0);
});

test('FINDING 1: 403, generic 503, network and malformed bridge answers fail closed — no legacy PUT, edits kept, reason shown', async () => {
  for (const [label, res] of [['403', { status: 403, body: { error: 'forbidden' } }], ['503 generic', { status: 503, body: { error: 'Tile studio temporarily unavailable' } }], ['503 text-only', { status: 503, body: { error: 'Versioned editor is not enabled' } }], ['network', new TypeError('Failed to fetch')], ['malformed', { status: 200, body: { ok: true } }]]) {
    let legacy = 0;
    const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': res, 'PUT /v1/projects/alpha/tiles': () => { legacy++; return { status: 200, body: { revision: 5 } }; } } });
    await s.start();
    assert.match(s.status(), /could not be reached .* paused/, label);
    s.byId.get('title').value = 'typed'; s.byId.get('title').oninput();
    await s.click('save'); await s.click('publish');
    assert.equal(legacy, 0, label + ': no legacy write'); assert.equal(s.calls.filter(c => c[0] !== 'GET' && c[1].includes('/v2/')).length, 0, label + ': no v2 write either');
    assert.match(s.status(), /Not (saved|published): the versioned Tile bridge could not be reached/, label); assert.equal(s.manage().hidden, true, label);
  }
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

/* lost response, then the history confirms the operation: the consumer adopts the confirmed state, shows no
   malformed-response error, and issues NO second write; a genuinely unknown outcome adopts nothing */
for (const [label, path, op, after, button] of [
  ['unpublish', '/v2/projects/alpha/tiles/unpublish', 'tiles_unpublish', { published_revision: null }, 'Take the published website down'],
  ['withdraw', '/v2/projects/alpha/tiles/withdraw', 'tiles_withdraw', { published_revision: null, owner_withdrawn: true, removed: true }, 'Withdraw project'],
  ['switch-front', '/v2/projects/alpha/tiles/switch-front', 'tiles_switch_front', { presentation: 'front' }, 'Switch to the front-page presentation (unpublished)'] ]) {
  test('recovered success: lost ' + label + ' confirmed by history adopts state, no error, no second write', async () => {
    let state = v2(9, 4, { published_revision: 'rev-1' }), rows = [], posts = 0;
    const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': () => state, 'GET /v2/projects/alpha/history': () => ({ status: 200, body: { ok: true, revision: state.body.editor_revision, history: rows } }), ['POST ' + path]: () => { posts++; throw new TypeError('Failed to fetch'); } } });
    await s.start();
    const b = s.walk(s.manage()).find(n => n.tagName === 'button' && n.textContent === button); assert.ok(b, button);
    state = v2(10, 4, { published_revision: 'rev-1', ...after }); rows = [{ revision: 10, operation: op }];
    b.onclick(); await flush(); await flush();
    assert.equal(posts, 1, 'exactly one write attempt'); assert.doesNotMatch(s.status(), /not in the expected form|Not taken down|Not withdrawn|Not switched/);
    assert.match(s.status(), /Confirmed from the history/); 
    assert.equal(s.calls.filter(c => c[0] === 'POST').length, 1, 'no repair write');
  });
  test('unknown outcome: lost ' + label + ' with an unrelated history row adopts nothing and says unknown', async () => {
    let state = v2(9, 4, { published_revision: 'rev-1' }), rows = [];
    const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': () => state, 'GET /v2/projects/alpha/history': () => ({ status: 200, body: { ok: true, revision: state.body.editor_revision, history: rows } }), ['POST ' + path]: new TypeError('Failed to fetch') } });
    await s.start();
    const b = s.walk(s.manage()).find(n => n.tagName === 'button' && n.textContent === button);
    state = v2(10, 5, { published_revision: 'rev-1' }); rows = [{ revision: 10, operation: 'tiles_save' }];
    b.onclick(); await flush(); await flush();
    assert.match(s.status(), /Unknown whether it was/); assert.equal(s.calls.filter(c => c[0] === 'POST').length, 1);
  });
}

test('recovered success: a lost recover confirmed by history clears the withdrawn state without a second write', async () => {
  let state = v2(12, 4, { owner_withdrawn: true, removed: true, published_revision: null }), rows = [];
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': () => state, 'GET /v2/projects/alpha/history': () => ({ status: 200, body: { ok: true, revision: state.body.editor_revision, history: rows } }), 'POST /v2/projects/alpha/tiles/recover': new TypeError('Failed to fetch') } });
  await s.start();
  const b = s.walk(s.manage()).find(n => n.tagName === 'button' && /^Recover/.test(n.textContent)); assert.ok(b);
  state = v2(13, 4, { owner_withdrawn: false, removed: false, published_revision: null }); rows = [{ revision: 13, operation: 'tiles_recover' }];
  b.onclick(); await flush(); await flush();
  assert.match(s.status(), /Confirmed from the history|Recovered/); assert.doesNotMatch(s.status(), /not in the expected form/);
  assert.deepEqual(s.walk(s.manage()).filter(n => n.tagName === 'button').map(n => n.textContent)[0], 'Take the published website down', 'the manage panel reflects the recovered state');
  assert.equal(s.calls.filter(c => c[0] === 'POST').length, 1);
});

test('recovered success: conflict-keep whose resend is lost but confirmed by history adopts and does not resend again', async () => {
  let puts = 0, state = v2(12, 6), rows = [];
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': () => state, 'GET /v2/projects/alpha/history': () => ({ status: 200, body: { ok: true, revision: state.body.editor_revision, history: rows } }),
    'PUT /v2/projects/alpha/tiles': b => { puts++; if (puts === 1) return { status: 409, body: { error: 'editor_revision_conflict' } }; throw new TypeError('Failed to fetch'); } } });
  await s.start();
  s.byId.get('title').value = 'Mine'; s.byId.get('title').oninput(); await s.click('save');
  assert.ok(s.byId.get('keepMine'));
  const sent = structuredClone(DOC); sent.title = 'Mine';
  state = v2(13, 7, { draft: { document: sent } }); rows = [{ revision: 13, operation: 'tiles_save' }];
  await s.click('keepMine');
  assert.equal(puts, 2, 'the keep-mine resend happened once'); assert.match(s.status(), /Confirmed from the history: it was saved/); assert.doesNotMatch(s.status(), /not in the expected form/);
});

test('recovered success: a lost proposal Apply confirmed by history records the undo entry and does not report failure', async () => {
  let state = v2(9, 4), rows = [];
  const s = studio({ routes: { ...common, 'GET /v1/projects/alpha/tiles': v1(4), 'GET /v2/projects/alpha/tiles': () => state, 'GET /v2/projects/alpha/history': () => ({ status: 200, body: { ok: true, revision: state.body.editor_revision, history: rows } }), 'PUT /v2/projects/alpha/tiles': new TypeError('Failed to fetch') } });
  await s.start();
  const src = s.walk(s.assist()).find(n => n.tagName === 'select' && [...n.children].some(o => o.value === 'own')); src.value = 'own'; src.onchange();
  const inputs = s.walk(s.assist()); inputs.find(n => n.tagName === 'input').value = 'A clearer heading'; inputs.find(n => n.tagName === 'select').value = 'a';
  s.assist().children.find(n => n.tagName === 'form').onsubmit({ preventDefault() {} }); await flush(); await flush();
  const expected = structuredClone(DOC); expected.tiles[0].headline = 'A clearer heading';
  state = v2(10, 5, { draft: { document: expected } }); rows = [{ revision: 10, operation: 'tiles_save' }];
  s.walk(s.assist()).find(n => n.tagName === 'button' && /^Apply/.test(n.textContent)).onclick(); await flush(); await flush();
  assert.ok(s.walk(s.assist()).find(n => n.tagName === 'button' && /^Undo/.test(n.textContent)), 'undo entry exists after a recovered apply');
  assert.doesNotMatch(s.walk(s.assist()).find(n => n.getAttribute('role') === 'status').textContent, /not confirmed|failed/);
});
