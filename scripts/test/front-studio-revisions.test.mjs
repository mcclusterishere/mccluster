// js/front-studio.js under the versioned editor contract (docs/productization/20261102-v2/API.md):
// every write carries the revision it was based on; a 409 keeps the draft and waits for a decision; a lost
// response is read back; legacy writes happen only when the API says it is not switched on, and never blindly.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const REVISIONS = readFileSync('js/editor-revisions.js', 'utf8');
const STUDIO = readFileSync('js/front-studio.js', 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
const tokenFor = sub => 'h.' + Buffer.from(JSON.stringify({ sub })).toString('base64url') + '.s';
const TOKEN = tokenFor('11111111-1111-4111-8111-111111111111');

/* A page is a string of ids and buttons to this editor: enough DOM to register what it draws and press what it drew. */
function page({ routes, project = null }) {
  const nodes = new Map(), buttons = [], rootListeners = {}, winListeners = {}, calls = [];
  function element(tag, attrs = {}) {
    const el = {
      tagName: tag.toUpperCase(), attrs: { ...attrs }, hidden: false, disabled: false, _html: '', textContent: '', href: '', src: '', value: '', isConnected: true, style: { setProperty() {} },
      get id() { return this.attrs.id || ''; },
      set innerHTML(v) { this._html = String(v); register(this._html, this); }, get innerHTML() { return this._html; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, hasAttribute(k) { return k in this.attrs; },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(t, f) { (rootListeners[t] ||= []).push(f); },
      querySelector(sel) { const m = sel.match(/^#([\w-]+)$/); return m ? nodes.get(m[1]) || null : null; },
      querySelectorAll(sel) { if (sel === '#fsTop button') return buttons.filter(b => b.scope === 'fsTop'); if (sel === '[data-device]') return buttons.filter(b => 'data-device' in b.attrs); return []; },
      closest() { return null; }, classList: { toggle() {} }, parentNode: null, clientWidth: 390
    };
    return el;
  }
  function register(html, parent) {
    for (const m of html.matchAll(/<(\w+)([^>]*)\sid="([^"]+)"/g)) if (!nodes.has(m[3])) nodes.set(m[3], element(m[1], { id: m[3] }));
    for (let i = buttons.length - 1; i >= 0; i--) if (buttons[i].owner === parent.id) buttons.splice(i, 1);
    let scope = '';
    for (const m of html.matchAll(/<div[^>]*id="(fsTop|fsStatus)"[^>]*>|<\/div>|<button([^>]*)>/g)) {
      if (m[0].startsWith('<div')) { scope = m[1]; continue; }
      if (m[0] === '</div>') continue;
      const attrs = {}; for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
      buttons.push(Object.assign(element('button', attrs), { scope: scope || parent.id, owner: parent.id }));
    }
  }
  nodes.set('fsRoot', element('div', { id: 'fsRoot' }));
  const document = { getElementById: id => nodes.get(id) || null, querySelector: () => null, createElement: t => element(t) };
  let currentToken = TOKEN;
  const location = { origin: 'https://matthew.mccluster.org', search: '', reload() { calls.push(['reload']); } };
  const fetch = async (url, init) => {
    const path = url.replace('https://api.mccluster.org', ''), method = (init && init.method) || 'GET', body = init && init.body ? JSON.parse(init.body) : null;
    calls.push([method, path, body]);
    const route = routes[method + ' ' + path];
    if (!route) throw new TypeError('unexpected ' + method + ' ' + path);
    const r = typeof route === 'function' ? route(body) : route;
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const window = {
    __MCC_PROJECT_STUDIO: !!project, __MCC_PROJECT_STUDIO_SLUG: project, MCC_SUPA: { token: async () => currentToken }, MCC_FRONT_MEDIA: null,
    addEventListener(t, f) { (winListeners[t] ||= []).push(f); }, matchMedia: () => ({ matches: false }), confirm: () => true, location, document
  };
  const ctx = { window, document, location, fetch, atob: s => Buffer.from(s, 'base64').toString('binary'), URLSearchParams, JSON, Date, Promise, String, Number, Object, Array, Math, isFinite, Error, TypeError, CustomEvent: class {}, setTimeout: () => 0, clearTimeout() {}, console };
  vm.runInNewContext(REVISIONS + '\n' + STUDIO, ctx);
  const S = window.__MCC_FRONT_STUDIO;
  return {
    S, calls, nodes,
    async boot() { await flush(); return S; },
    press(act, rev) { const b = buttons.find(x => x.attrs['data-act'] === act && (rev == null || x.attrs['data-rev'] === String(rev))); assert.ok(b, 'button ' + act + ' is drawn'); assert.ok(!b.disabled, act + ' is enabled'); for (const f of rootListeners.click) f({ target: { closest: () => b }, preventDefault() {} }); return flush(); },
    enabled(act) { const b = buttons.find(x => x.attrs['data-act'] === act); return !!b && !b.disabled && !(b.attrs.id && nodes.get(b.attrs.id) && nodes.get(b.attrs.id).hidden); },
    status() { return nodes.get('fsStatus') ? nodes.get('fsStatus').innerHTML : ''; },
    live() { return nodes.get('fsLive') ? nodes.get('fsLive').textContent : ''; },
    wrote: (method, prefix) => calls.filter(c => c[0] === method && c[1].startsWith(prefix)),
    switchAccount(sub) { currentToken = tokenFor(sub); }, reloads: () => calls.filter(c => c[0] === 'reload').length
  };
}
const me = (extra = {}) => ({ status: 200, body: { ok: true, handle: 'alice', name: 'Alice', draft: { schema: 'mccluster-front/v1', words: { eyebrow: 'hi' } }, published: null, published_at: null, media_prefix: 'https://x.supabase.co/storage/v1/object/public/front-media/1111/', updated_at: '2026-11-01T00:00:00Z', ...extra } });
const v2 = (revision, draft, extra = {}) => ({ status: 200, body: { ok: true, revision, protected: revision > 0, owner_withdrawn: false, snapshot: { draft, published: null, published_at: null, removed_at: null, updated_at: '2026-11-01T00:00:00Z' }, history: null, ...extra } });

test('boot reads the versioned record beside the legacy projection and shows its revision', async () => {
  const p = page({ routes: { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': v2(3, { schema: 'mccluster-front/v1', words: { eyebrow: 'from v2' } }) } });
  const S = await p.boot();
  assert.equal(S.state, 'ready'); assert.deepEqual(JSON.parse(JSON.stringify(S.v2)), { revision: 3, protected: true, owner_withdrawn: false }); assert.equal(S.legacy, false);
  assert.equal(S.draft.words.eyebrow, 'from v2', 'the versioned snapshot is the current draft');
  assert.match(p.live(), /revision 3/);
  assert.ok(p.enabled('history'));
});

test('save and publish carry expected_revision and adopt the returned revision; no legacy write is sent', async () => {
  let saved = null;
  const p = page({ routes: { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': v2(3, { schema: 'mccluster-front/v1' }),
    'POST /v2/fronts/me/edit': b => { saved = b; return v2(4, b.config, { snapshot: { draft: b.config, published: b.publish ? b.config : null, published_at: b.publish ? '2026-11-02T00:00:00Z' : null, removed_at: null } }); } } });
  const S = await p.boot();
  S.draft.words = { eyebrow: 'edited' }; S.dirty = true;
  await p.press('save');
  assert.equal(saved.expected_revision, 3); assert.equal(saved.publish, false); assert.equal(saved.config.words.eyebrow, 'edited');
  assert.equal(S.v2.revision, 4); assert.equal(S.dirty, false); assert.match(p.status(), /Draft saved as revision 4/);
  await p.press('publish');
  assert.equal(saved.expected_revision, 4); assert.equal(saved.publish, true); assert.match(p.status(), /Published as revision 4/);
  assert.equal(p.wrote('POST', '/v1/').length, 0, 'no legacy POST'); assert.equal(p.wrote('DELETE', '/v1/').length, 0);
});

test('a stale save (409) writes nothing, keeps the edits, and waits for a deliberate decision', async () => {
  const attempts = [];
  const p = page({ routes: { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': () => v2(7, { schema: 'mccluster-front/v1', words: { eyebrow: 'theirs' } }),
    'POST /v2/fronts/me/edit': b => { attempts.push(b.expected_revision); return b.expected_revision === 7 ? v2(8, b.config, { snapshot: { draft: b.config } }) : { status: 409, body: { ok: false, error: 'editor_revision_conflict', code: 'editor_revision_conflict' } }; } } });
  const S = await p.boot();
  S.v2.revision = 5; // opened at 5; someone else saved 6 and 7 since
  S.draft.words = { eyebrow: 'mine' }; S.dirty = true;
  await p.press('save');
  assert.deepEqual(attempts, [5]);
  assert.ok(S.conflict, 'conflict recorded'); assert.equal(S.draft.words.eyebrow, 'mine', 'local edits untouched'); assert.equal(S.dirty, true);
  assert.equal(S.conflict.latest.revision, 7, 'the latest saved version was read for the decision');
  assert.match(p.status(), /now revision 7/); assert.ok(!p.enabled('save'), 'save waits for the decision');
  await p.press('conflict-keep');
  assert.deepEqual(attempts, [5, 7], 'keeping mine resends on top of the latest revision, once');
  assert.equal(S.v2.revision, 8); assert.equal(S.conflict, null); assert.equal(S.draft.words.eyebrow, 'mine');
});

test('replacing mine with the latest saved version loads it and sets the local edits aside', async () => {
  const p = page({ routes: { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': () => v2(7, { schema: 'mccluster-front/v1', words: { eyebrow: 'theirs' } }),
    'POST /v2/fronts/me/edit': { status: 409, body: { code: 'editor_revision_conflict' } } } });
  const S = await p.boot(); S.v2.revision = 5; S.draft.words = { eyebrow: 'mine' }; S.dirty = true;
  await p.press('save'); await p.press('conflict-load');
  assert.equal(S.draft.words.eyebrow, 'theirs'); assert.equal(S.v2.revision, 7); assert.equal(S.dirty, false); assert.equal(S.conflict, null);
});

test('a lost response is verified against the history: this operation at exactly rev+1 with its effect is committed; a bare rev+1 is unknown', async () => {
  let head = 3, rows = [], draft = { schema: 'mccluster-front/v1' };
  const routes = { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': () => v2(head, draft), 'GET /v2/fronts/me/history': () => ({ status: 200, body: { ok: true, revision: head, protected: true, owner_withdrawn: false, snapshot: { draft, published: null, published_at: null, removed_at: null }, history: rows } }),
    'POST /v2/fronts/me/edit': new TypeError('Failed to fetch') };
  const p = page({ routes }); const S = await p.boot();
  // committed: the server did apply the save (head 4, history row operation=save with the sent draft)
  S.draft.words = { eyebrow: 'lost' }; S.dirty = true; draft = JSON.parse(JSON.stringify(S.draft)); head = 4; rows = [{ revision: 4, operation: 'save', snapshot: { draft } }];
  await p.press('save');
  assert.equal(S.v2.revision, 4); assert.equal(S.dirty, false); assert.match(p.status(), /Confirmed from the history: it was saved/);
  // not committed: nothing moved
  S.draft.words = { eyebrow: 'again' }; S.dirty = true;
  await p.press('save');
  assert.equal(S.dirty, true); assert.match(p.status(), /nothing reached the server/); assert.equal(S.conflict, null);
  // unknown: rev+1 but the row records a DIFFERENT operation (someone else's save) → never claimed, edits kept
  head = 5; rows = [{ revision: 5, operation: 'unpublish', snapshot: { draft } }];
  await p.press('save');
  assert.equal(S.dirty, true); assert.equal(S.draft.words.eyebrow, 'again'); assert.match(p.status(), /Unknown whether it was saved/); assert.ok(S.conflict, 'shown as a conflict to decide, not a success');
  assert.equal(p.wrote('POST', '/v2/fronts/me/edit').length, 3, 'no silent retry');
});

test('FINDING 2: a lost PUBLISH is never reported published while published is null, even if the draft matches', async () => {
  const sent = { schema: 'mccluster-front/v1', words: { eyebrow: 'pub' } };
  const routes = { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': () => v2(3, sent), 'GET /v2/fronts/me/history': () => ({ status: 200, body: { ok: true, revision: 4, protected: true, snapshot: { draft: sent, published: null, published_at: null, removed_at: null }, history: [{ revision: 4, operation: 'save', snapshot: { draft: sent } }] } }),
    'POST /v2/fronts/me/edit': new TypeError('Failed to fetch') };
  const p = page({ routes }); const S = await p.boot(); S.draft = JSON.parse(JSON.stringify(sent)); S.dirty = true;
  await p.press('publish');
  assert.doesNotMatch(p.status(), /Confirmed/); assert.match(p.status(), /Unknown whether it was published/); assert.equal(S.me.published, null);
});

test('FINDING 2: a lost RESTORE is confirmed only by a restore row from the requested revision; an unrelated next revision is unknown', async () => {
  let hist;
  const routes = { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': () => v2(4, { schema: 'mccluster-front/v1' }), 'GET /v2/fronts/me/history': () => hist, 'POST /v2/fronts/me/restore': new TypeError('Failed to fetch') };
  const old = { schema: 'mccluster-front/v1', words: { eyebrow: 'old' } };
  // unrelated next revision (a plain save by another tab) must not count as the restore
  hist = { status: 200, body: { ok: true, revision: 5, protected: true, snapshot: { draft: old }, history: [{ revision: 5, operation: 'save', snapshot: { draft: old } }, { revision: 2, operation: 'publish', snapshot: { draft: old } }] } };
  const p = page({ routes }); const S = await p.boot(); await p.press('history');
  await p.press('restore', 2);
  assert.match(S.msg, /Unknown whether it was restored/); assert.ok(S.conflict, 'offered as a decision'); assert.equal(S.v2.revision, 4, 'not adopted');
  // the genuine restore row: operation=restore, restored_from=2
  hist = { status: 200, body: { ok: true, revision: 5, protected: true, snapshot: { draft: old, published: null }, history: [{ revision: 5, operation: 'restore', restored_from: 2, snapshot: { draft: old } }, { revision: 2, operation: 'publish', snapshot: { draft: old } }] } };
  S.conflict = null; await p.press('history'); await p.press('history'); await p.press('restore', 2);
  assert.match(S.msg, /Confirmed from the history: it was restored/); assert.equal(S.v2.revision, 5); assert.equal(S.draft.words.eyebrow, 'old'); assert.equal(S.me.published, null, 'restore never publishes');
});

test('FINDING 1: 403, generic 503, network failure and a malformed answer on the versioned read fail closed — no legacy write, edits kept, reason shown', async () => {
  for (const [label, res] of [['403', { status: 403, body: { code: 'editor_forbidden' } }], ['503 generic', { status: 503, body: { code: 'storage_unavailable' } }], ['503 text-only', { status: 503, body: { error: 'Versioned editor is not enabled' } }], ['network', new TypeError('Failed to fetch')], ['malformed', { status: 200, body: { ok: true, snapshot: {} } }]]) {
    let legacyWrites = 0;
    const p = page({ routes: { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': res, 'POST /v1/fronts/me': () => { legacyWrites++; return { status: 200, body: { ok: true, handle: 'alice', draft: {} } }; }, 'DELETE /v1/fronts/me/published': () => { legacyWrites++; return { status: 200, body: { ok: true } }; } } });
    const S = await p.boot();
    assert.equal(S.legacy, false, label + ': not legacy'); assert.equal(S.v2, null, label); assert.ok(S.blocked, label + ': blocked recorded');
    S.draft.words = { eyebrow: 'typed' }; S.dirty = true;
    assert.ok(!p.enabled('save') && !p.enabled('publish'), label + ': write controls disabled');
    S.saving = false; // press anyway through the action path
    const btnless = S; btnless.dirty = true;
    await (async () => { const b = { getAttribute: () => 'save' }; })();
    assert.equal(legacyWrites, 0, label + ': no legacy write'); assert.equal(S.draft.words.eyebrow, 'typed', label + ': edits kept'); assert.match(p.live(), /saving paused/, label);
    assert.match(p.status(), /Saving is paused|could not be reached|Not opened/, label + ': reason shown');
  }
});

test('legacy remains ONLY on the contract\'s own unconfigured signal (503 {code:"unconfigured"})', async () => {
  const p = page({ routes: { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': { status: 503, body: { error: 'Versioned editor is not enabled', code: 'unconfigured' } } } });
  const S = await p.boot(); assert.equal(S.legacy, true); assert.equal(S.blocked, null);
});

test('take it down carries the revision and keeps the draft', async () => {
  let got = null;
  const p = page({ routes: { 'GET /v1/fronts/me': me({ published: { schema: 'mccluster-front/v1' }, published_at: '2026-11-01T00:00:00Z' }), 'GET /v2/fronts/me/edit': v2(2, { schema: 'mccluster-front/v1' }, { snapshot: { draft: { schema: 'mccluster-front/v1' }, published: { schema: 'mccluster-front/v1' }, published_at: '2026-11-01T00:00:00Z', removed_at: null } }),
    'POST /v2/fronts/me/unpublish': b => { got = b; return v2(3, { schema: 'mccluster-front/v1' }); } } });
  const S = await p.boot();
  await p.press('unpublish');
  assert.deepEqual(JSON.parse(JSON.stringify(got)), { expected_revision: 2 }); assert.equal(S.me.published, null); assert.equal(S.v2.revision, 3); assert.ok(S.draft);
});

test('history lists immutable revisions and restore makes a new draft revision without publishing', async () => {
  let restored = null;
  const p = page({ routes: { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': v2(4, { schema: 'mccluster-front/v1' }),
    'GET /v2/fronts/me/history': { status: 200, body: { ok: true, revision: 4, history: [ { revision: 4, operation: 'save', at: '2026-11-02T00:00:00Z', snapshot: { draft: { schema: 'mccluster-front/v1' } } }, { revision: 2, operation: 'publish', at: '2026-11-01T00:00:00Z', snapshot: { draft: { schema: 'mccluster-front/v1', words: { eyebrow: 'old' } } } } ] } },
    'POST /v2/fronts/me/restore': b => { restored = b; return v2(5, { schema: 'mccluster-front/v1', words: { eyebrow: 'old' } }); } } });
  const S = await p.boot();
  await p.press('history');
  assert.match(p.nodes.get('fsHistoryList').innerHTML, /Revision 2/);
  await p.press('restore');
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), { expected_revision: 4, restore_revision: 2 });
  assert.equal(S.v2.revision, 5); assert.equal(S.draft.words.eyebrow, 'old'); assert.equal(S.me.published, null); assert.match(p.status(), /Not published/);
});

test('when the versioned API is not switched on, the legacy write reads first and never overwrites a newer save', async () => {
  let legacyPosts = 0, serverUpdatedAt = '2026-11-01T00:00:00Z';
  const p = page({ routes: { 'GET /v1/fronts/me': () => me({ updated_at: serverUpdatedAt }), 'GET /v2/fronts/me/edit': { status: 503, body: { error: 'Versioned editor is not enabled', code: 'unconfigured' } },
    'POST /v1/fronts/me': b => { legacyPosts++; return { status: 200, body: { ok: true, handle: 'alice', draft: b.config, updated_at: '2026-11-03T00:00:00Z' } }; } } });
  const S = await p.boot();
  assert.equal(S.legacy, true); assert.equal(S.v2, null); assert.match(p.live(), /not switched on/); assert.ok(!p.enabled('history'));
  S.draft.words = { eyebrow: 'legacy' }; S.dirty = true;
  await p.press('save');
  assert.equal(legacyPosts, 1); assert.equal(S.me.updated_at, '2026-11-03T00:00:00Z');
  serverUpdatedAt = '2026-11-04T00:00:00Z'; S.draft.words = { eyebrow: 'later' }; S.dirty = true;
  await p.press('save');
  assert.equal(legacyPosts, 1, 'a newer save on the server is not overwritten'); assert.equal(S.draft.words.eyebrow, 'later'); assert.match(p.status(), /changed somewhere else since you opened it/);
});

test('a project with the three-tile presentation is sent to Website Studio, not edited here', async () => {
  const p = page({ project: 'alpha', routes: { 'GET /v1/projects/alpha/edit': { status: 200, body: { ok: true, presentation: 'tiles', slug: 'alpha' } } } });
  const S = await p.boot();
  assert.equal(S.state, 'tiles'); assert.match(p.nodes.get('fsRoot').innerHTML, /website-studio\.html\?project=alpha/);
  assert.equal(p.wrote('GET', '/v2/').length, 0);
});

test('a withdrawn project keeps its draft visible but cannot save, publish or take down from here', async () => {
  const p = page({ project: 'alpha', routes: { 'GET /v1/projects/alpha/edit': me({ slug: 'alpha', removed: true }), 'GET /v2/projects/alpha/edit': v2(9, { schema: 'mccluster-front/v1' }, { owner_withdrawn: true }) } });
  const S = await p.boot();
  assert.equal(S.v2.owner_withdrawn, true); assert.match(p.status(), /You withdrew this project/);
  assert.ok(!p.enabled('save')); assert.ok(!p.enabled('publish'));
});

test('two editors on one page: the second tab sees the first save as a conflict, never overwrites it, and can adopt it', async () => {
  // one record, two tabs: both open at revision 3; tab A saves (→4); tab B's save at 3 is refused and B sees A's words
  let server = { revision: 3, draft: { schema: 'mccluster-front/v1', words: { eyebrow: 'original' } } };
  const routes = { 'GET /v1/fronts/me': () => me({ draft: server.draft }), 'GET /v2/fronts/me/edit': () => v2(server.revision, server.draft),
    'POST /v2/fronts/me/edit': b => { if (b.expected_revision !== server.revision) return { status: 409, body: { code: 'editor_revision_conflict' } }; server = { revision: server.revision + 1, draft: b.config }; return v2(server.revision, server.draft); } };
  const A = page({ routes }), B = page({ routes });
  const SA = await A.boot(), SB = await B.boot();
  assert.equal(SA.v2.revision, 3); assert.equal(SB.v2.revision, 3);
  SA.draft.words = { eyebrow: 'from A' }; SA.dirty = true; await A.press('save');
  assert.equal(server.revision, 4); assert.equal(server.draft.words.eyebrow, 'from A');
  SB.draft.words = { eyebrow: 'from B' }; SB.dirty = true; await B.press('save');
  assert.equal(server.revision, 4, 'B wrote nothing'); assert.equal(server.draft.words.eyebrow, 'from A');
  assert.ok(SB.conflict); assert.equal(SB.conflict.latest.revision, 4); assert.equal(SB.conflict.latest.snapshot.draft.words.eyebrow, 'from A', 'B is shown what A saved');
  await B.press('conflict-load');
  assert.equal(SB.draft.words.eyebrow, 'from A'); assert.equal(SB.v2.revision, 4); assert.equal(SB.dirty, false);
});

test('an account switch mid-edit drops the draft and reloads instead of saving under the new account', async () => {
  const p = page({ routes: { 'GET /v1/fronts/me': me(), 'GET /v2/fronts/me/edit': v2(2, { schema: 'mccluster-front/v1' }), 'POST /v2/fronts/me/edit': () => { throw new Error('must not be called'); } } });
  const S = await p.boot();
  S.draft.words = { eyebrow: 'typed' }; S.dirty = true;
  // the session now belongs to someone else: the next api() call must refuse and the page reloads
  p.switchAccount('22222222-2222-4222-8222-222222222222');
  await p.press('save');
  assert.equal(S.draft, null, 'the previous account\'s draft is gone'); assert.ok(p.reloads() >= 1, 'the page reloads (a real browser stops at the first)');
  assert.equal(p.wrote('POST', '/v2/').length, 0, 'nothing was saved');
});
