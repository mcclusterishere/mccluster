/* Control · System · E=Up › Environmental events (js/control-room/eup-environment.js, created by js/control-room/eup.js): the
   owner's view over the /v1/eup/environment routes (workers/mccluster/src/eup/environment/owner.js), on a synthetic DOM with
   fixture answers that follow the Worker's documented shapes. It is a fixture, not the Worker and not the SQL: the routes over
   the real SQL are scripts/test/eup-environment-owner.integration.mjs, and the real page is
   scripts/e2e/control-eup-environment.e2e.mjs.
   Proves: the sixth local tab reads health (on the slow requester), review and the preview; off, outage, no data and
   reporting are words per source; the store not applied is said and offers no command; every command needs a reason, carries
   the revision that was read and a fresh key, and reads back; an unknown outcome is never resent by itself and is settled by
   its key in the decision log or by a same-key resend; a 409 says it changed elsewhere; a 403 conceals the workspace; text
   from the store is escaped. */
import test from 'node:test';
import assert from 'node:assert/strict';

class El extends EventTarget {
  constructor(tag, attrs, text) { super(); this.tag = tag || 'div'; this.attrs = attrs || {}; this.text = text || ''; this.kids = []; this.dataset = {}; this.isConnected = true; this.value = this.attrs.value || ''; this.checked = Object.hasOwn(this.attrs, 'checked'); this._html = ''; }
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
    const attrs = {}; for (const a of m[2].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : a[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const close = html.indexOf('</' + m[1] + '>', re.lastIndex);
    const inner = close > 0 ? html.slice(re.lastIndex, close) : '';
    out.push(new El(m[1], attrs, inner.replace(/<[^>]+>/g, ' ')));
  }
  return out;
}
globalThis.window = new EventTarget();
window.crypto = globalThis.crypto; window.CR = {};
globalThis.document = { activeElement: null };
const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i += 1) await flush(); };
/* as control.html loads them: the tab's own script before eup.js */
await import('../../js/control-room/eup-environment.js');
await import('../../js/control-room/eup.js');
const E = window.CR.eup, H = E.helpers, V = window.CR.eupEnvironment.helpers;

const P = '/v1/eup/environment';
const NOW = '2026-11-19T12:00:00.000Z';
const http = (status, reason, message) => Object.assign(new Error(message || reason || 'HTTP ' + status), { status, detail: reason ? { ok: false, reason } : null });
const NOT_APPLIED = { status: 'not_applied', reason: 'store_not_applied', parts: [1, 2, 3, 4, 5].map((i) => `supabase/pending/20261119100000_eup_environment_events_v1_0${i}.sql`) };
const PROVIDERS = ['usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops'];
const surface = (id, provider, state, items, reason = null) => ({ id, provider, kind: id.split(':')[0], label: id, items, state, reason, sources: [{ id: provider, label: provider.toUpperCase(), status: state === 'outage' ? 'unavailable' : state === 'off' ? 'unavailable' : 'available', reason: state === 'off' ? 'not_configured' : reason, fetched_at: NOW, last_success_at: NOW }] });
const NOW_STATES = { usgs: ['reporting', 12], nws: ['no_data', 0], nhc: ['no_data', 0], eonet: ['outage', null, 'timeout'], firms: ['off', 0, 'not_configured'], wfigs: ['no_data', 0], coops: ['reporting', 18] };
function healthOf({ store = NOT_APPLIED, module = { status: 'read', installed: false, state: null, revision: null, gate: 'off', reason: null }, usgsStore = null } = {}) {
  return { ok: true, schema: 'mccluster.environment-owner-health/v1', checked_at: NOW, module, store, log: [],
    sources: PROVIDERS.map((p) => {
      const [state, items, reason = null] = NOW_STATES[p];
      const pub = module.gate === 'off' ? { state: 'off', reason: module.installed ? 'module_disabled' : 'module_not_installed' } : { state, reason };
      return { provider: p, label: 'Label of ' + p, public: pub, provider_now: { state, reason, surfaces: [surface('feed:' + p, p, state, items, reason)] }, store: p === 'usgs' ? usgsStore : (store.status === 'applied' ? { state: 'not_configured', configured: false, revision: 0 } : null) };
    }) };
}
const USGS_RULE = { min_magnitude: 4.5, include_automatic: true, significance_above: 600, pager_alert: true, tsunami: true };
const usgsStore = (extra = {}) => ({ state: 'never_run', configured: true, supported: true, ingest: 'active', publication: 'shown', rule: USGS_RULE, default_rule: USGS_RULE, revision: 1, updated_at: NOW, last_run: null, last_success_at: null, events: {}, ...extra });
const summary = (extra = {}) => ({ id: 'usgs:us7000own1', state: 'published', revision: 2, provider: 'usgs', provider_event_id: 'us7000own1', observed_at: NOW, magnitude: 5.6, magnitude_type: 'mww', place: '40 km E of Example', review_status: 'reviewed', qualifies: true, ...extra });
function reviewOf({ decisions = [], held = [], usgs = usgsStore() } = {}) {
  return { ok: true, schema: 'mccluster.environment-owner-review/v1', store: { status: 'applied' }, module: { installed: false },
    providers: [{ provider: 'usgs', label: 'USGS earthquakes', ...usgs }], review: { candidates: [summary({ id: 'usgs:us7000own2', state: 'candidate', revision: 1, magnitude: 3.1, qualifies: false })], held, retracted: [], withdrawn: [], merged: [], corrected: [summary()], coverage: [] }, decisions };
}
const eventOf = (extra = {}) => ({ ok: true, store: { status: 'applied' }, event: { summary: summary(extra), public: { state: 'published', revision: 2 },
  revisions: [{ revision: 2, cause: 'source_revised', changes: { magnitude: { from: 5.2, to: 5.6 } }, recorded_at: NOW }, { revision: 1, cause: 'source_first_seen', changes: {}, recorded_at: NOW }],
  aliases: [], coverage: [], decisions: [] } });
const previewOf = (events = []) => ({ ok: true, schema: 'mccluster.environment-owner-preview/v1', owner_preview: true, module: { gate: 'off', installed: false }, store: { status: 'applied' }, events, next_cursor: null, sources: [] });
const receiptOf = (command, result, changed = true) => ({ ok: true, receipt: { schema: 'mccluster.environment-decision/v1', command, target_kind: 'event', target: 'usgs:us7000own1', changed, prior: {}, result, recorded_at: NOW } });

function fakeRequest(routes, log = []) {
  return (path, opts) => {
    log.push({ path, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    const key = ((opts && opts.method) || 'GET') + ' ' + path.split('?')[0];
    const r = routes[key] !== undefined ? routes[key] : routes[path];
    const out = typeof r === 'function' ? r(path, opts) : r;
    if (out instanceof Error) return Promise.reject(out);
    if (out && typeof out.then === 'function') return out;
    if (out !== undefined) return Promise.resolve(out);
    if (path === '/v1/eup/overview' || path === '/v1/eup/modules') return Promise.reject(http(503, 'not_implemented'));
    return Promise.reject(http(404, 'not_found'));
  };
}
async function open(routes, log = []) {
  H.resetModel(); H.model().section = 'environment';
  const root = new El('div'); root.innerHTML = E.render(); E.bind(root, { request: fakeRequest(routes, log), slowDeadlineMs: 2000 });
  await settle();
  const pane = () => root.querySelector('[data-eup-pane]');
  return { root, pane, log, status: () => root.querySelector('[data-eup-status]'), q: (sel) => pane().querySelector(sel), all: (sel) => pane().querySelectorAll(sel), view: async (id) => { pane().querySelector('[data-eup-env-tab="' + id + '"]').click(); await settle(); } };
}
const type = (m, slot, text) => { const i = m.q('[data-eup-env-reason="' + slot + '"]'); i.value = text; i.oninput(); };
const posts = (log) => log.filter((x) => x.method === 'POST');

test('the sixth local tab reads source health, the review queue and the preview; the store not applied is said and offers no command', async () => {
  const m = await open({ ['GET ' + P + '/health']: healthOf(), ['GET ' + P + '/review']: { ok: true, store: NOT_APPLIED, providers: [], review: null, decisions: [] }, ['GET ' + P + '/preview']: { ok: true, store: NOT_APPLIED, module: { gate: 'off', installed: false }, events: [] } });
  assert.deepEqual(H.SECTIONS.map((s) => s.id).slice(-1), ['environment']);
  assert.deepEqual(m.log.map((x) => x.path).filter((p) => p.startsWith(P)).sort(), [P + '/health', P + '/preview', P + '/review']);
  assert.equal(m.q('[data-eup-env-module]').attrs['data-eup-env-module'], 'off');
  assert.match(m.q('[data-eup-env-module]').text, /not installed\. The public routes answer 404 module_disabled: off\./);
  assert.equal(m.q('[data-eup-env-store]').attrs['data-eup-env-store'], 'not_applied');
  assert.match(m.q('[data-eup-env-store]').text, /not applied\. Its five pending parts/);
  /* per source, in words: the public state and the provider state are two facts */
  assert.deepEqual(m.all('[data-eup-env-public]').map((x) => x.attrs['data-eup-env-public']), PROVIDERS.map((p) => p + ':off'));
  assert.deepEqual(m.all('[data-eup-env-now]').map((x) => x.attrs['data-eup-env-now']), PROVIDERS.map((p) => p + ':' + NOW_STATES[p][0]));
  assert.match(m.q('[data-eup-env-public-line="usgs"]').text, /Off: the environment module is not installed/);
  assert.match(m.pane().textContent, /Outage: the provider did not answer in time\./, 'EONET down is an outage of the provider');
  assert.match(m.pane().textContent, /No data: it answered with nothing\./);
  assert.equal(m.all('[data-eup-env-setrule]').length, 0, 'no command while the store is not applied');
  for (const id of ['review', 'preview', 'decisions']) {
    await m.view(id);
    assert.match(m.pane().textContent, /not applied/, id);
    assert.equal(m.all('[data-eup-env-event-command]').length + m.all('[data-eup-env-open]').length, 0, id);
  }
  assert.equal(posts(m.log).length, 0, 'opening the tab changes nothing');
});

test('the module unreadable is an outage, not off; the module enabled shows each provider\'s own state to the public', async () => {
  const down = await open({ ['GET ' + P + '/health']: healthOf({ module: { status: 'unreadable', installed: null, state: null, revision: null, gate: 'outage', reason: 'storage_unavailable' } }), ['GET ' + P + '/review']: { ok: true, store: NOT_APPLIED, review: null, decisions: [], providers: [] }, ['GET ' + P + '/preview']: previewOf() });
  assert.match(down.q('[data-eup-env-module]').text, /its policy cannot be read \(storage_unavailable\)\. The public routes answer 503: an outage, not off\./);
  const on = await open({ ['GET ' + P + '/health']: healthOf({ module: { status: 'read', installed: true, state: 'enabled', revision: 3, gate: 'on', reason: null }, store: { status: 'applied' }, usgsStore: usgsStore() }), ['GET ' + P + '/review']: reviewOf(), ['GET ' + P + '/preview']: previewOf() });
  assert.deepEqual(on.all('[data-eup-env-public]').map((x) => x.attrs['data-eup-env-public']), PROVIDERS.map((p) => p + ':' + NOW_STATES[p][0]));
  assert.match(on.q('[data-eup-env-public-line="usgs"]').text, /Reporting: 12 items\./);
  assert.match(on.q('[data-eup-env-public-line="firms"]').text, /Off: this provider is not configured here \(FIRMS needs the Worker secret FIRMS_MAP_KEY\)\./);
  assert.match(on.q('[data-eup-env-store-line="usgs"]').text, /rule rev 1 set; no ingest run recorded yet/);
});

test('the USGS rule: a reason first, then the default rule with the revision that was read and a fresh key, read back', async () => {
  let health = healthOf({ store: { status: 'applied' }, usgsStore: usgsStore({ configured: false, state: 'not_configured', revision: 0, rule: null, ingest: null, publication: null }) });
  let review = reviewOf({ usgs: usgsStore({ configured: false, state: 'not_configured', revision: 0, rule: null }) });
  const routes = { ['GET ' + P + '/health']: () => health, ['GET ' + P + '/review']: () => review, ['GET ' + P + '/preview']: previewOf(),
    ['POST ' + P + '/commands']: () => { health = healthOf({ store: { status: 'applied' }, usgsStore: usgsStore() }); review = reviewOf(); return { ok: true, receipt: { schema: 'mccluster.environment-decision/v1', command: 'set_rule', target_kind: 'provider', target: 'usgs', changed: true, prior: {}, result: { revision: 1 }, recorded_at: NOW } }; } };
  const m = await open(routes);
  assert.equal(m.all('[data-eup-env-provider-command]').length, 0, 'no switch before a rule exists');
  m.q('[data-eup-env-setrule="default"]').click(); await settle();
  assert.equal(posts(m.log).length, 0, 'nothing is sent without a reason');
  assert.equal(m.q('[data-eup-env-outcome="provider:usgs|error"]') !== null, true);
  assert.equal(document.activeElement && document.activeElement.attrs['data-eup-env-reason'], 'provider:usgs', 'focus returns to the reason');
  type(m, 'provider:usgs', '  set the default rule  ');
  m.q('[data-eup-env-setrule="default"]').click(); await settle();
  const [post] = posts(m.log);
  assert.equal(post.path, P + '/commands');
  assert.deepEqual(Object.keys(post.body).sort(), ['command', 'expected_revision', 'idempotency_key', 'payload', 'reason', 'target']);
  assert.deepEqual([post.body.command, post.body.target, post.body.expected_revision, post.body.reason], ['set_rule', 'usgs', 0, 'set the default rule']);
  assert.deepEqual(post.body.payload, {}); assert.match(post.body.idempotency_key, /^[0-9a-f-]{36}$/);
  assert.ok(m.q('[data-eup-env-outcome="provider:usgs|done"]'));
  assert.ok(m.log.filter((x) => x.path === P + '/health').length >= 2, 'a provider command reads the health back');
  assert.deepEqual(m.all('[data-eup-env-provider-command]').map((b) => b.attrs['data-eup-env-provider-command']), ['pause_provider', 'hide_provider']);
  /* a custom rule: the form is checked before anything is sent */
  m.q('[data-eup-env-rule="min_magnitude"]').value = '11'; m.q('[data-eup-env-rule="min_magnitude"]').oninput();
  type(m, 'provider:usgs', 'a stricter rule');
  m.q('[data-eup-env-setrule="rule"]').click(); await settle();
  assert.equal(posts(m.log).length, 1, 'an out-of-range magnitude is refused before sending');
  m.q('[data-eup-env-rule="min_magnitude"]').value = '5'; m.q('[data-eup-env-rule="min_magnitude"]').oninput();
  m.q('[data-eup-env-rule="significance_above"]').value = ''; m.q('[data-eup-env-rule="significance_above"]').oninput();
  m.q('[data-eup-env-rule="include_automatic"]').checked = false; m.q('[data-eup-env-rule="include_automatic"]').onchange();
  type(m, 'provider:usgs', 'a stricter rule');
  m.q('[data-eup-env-setrule="rule"]').click(); await settle();
  assert.deepEqual(posts(m.log)[1].body.payload, { rule: { min_magnitude: 5, include_automatic: false, significance_above: null, pager_alert: true, tsunami: true } });
  assert.equal(posts(m.log)[1].body.expected_revision, 1, 'the revision read back after the first command');
});

test('review: open an event, hold it with its revision, restore an older revision as a new one (rollback)', async () => {
  let ev = eventOf();
  const routes = { ['GET ' + P + '/health']: healthOf({ store: { status: 'applied' }, usgsStore: usgsStore() }), ['GET ' + P + '/review']: reviewOf(), ['GET ' + P + '/preview']: previewOf(),
    ['GET ' + P + '/events/usgs%3Aus7000own1']: () => ev,
    ['POST ' + P + '/commands']: (path, opts) => {
      if (opts.body.command === 'hold') { ev = eventOf({ state: 'held' }); return receiptOf('hold', { state: 'held', revision: 2 }); }
      ev = eventOf({ state: 'held', revision: 3 }); return receiptOf('rollback', { state: 'held', revision: 3 });
    } };
  const m = await open(routes);
  await m.view('review');
  assert.match(m.pane().textContent, /Candidates \(stored, not public\)/); assert.match(m.pane().textContent, /does not qualify under the current rule/);
  m.q('[data-eup-env-open="usgs:us7000own1"]').click(); await settle();
  assert.equal(m.q('[data-eup-env-event]').attrs['data-eup-env-event-state'], 'published:2');
  assert.equal(document.activeElement && document.activeElement.attrs['data-eup-env-event'], 'usgs:us7000own1', 'focus moves to the opened event');
  assert.deepEqual(m.all('[data-eup-env-event-command]').map((b) => b.attrs['data-eup-env-event-command']), ['hold', 'retract']);
  assert.deepEqual(m.all('[data-eup-env-rollback]').map((b) => b.attrs['data-eup-env-rollback']), ['1'], 'only an older revision can be restored');
  type(m, 'event:usgs:us7000own1', 'hold for review');
  m.q('[data-eup-env-event-command="hold"]').click(); await settle();
  assert.deepEqual(posts(m.log)[0].body, { ...posts(m.log)[0].body, command: 'hold', target: 'usgs:us7000own1', expected_revision: 2, reason: 'hold for review' });
  assert.equal(posts(m.log)[0].body.payload, undefined);
  assert.equal(m.q('[data-eup-env-event]').attrs['data-eup-env-event-state'], 'held:2', 'read back');
  assert.deepEqual(m.all('[data-eup-env-event-command]').map((b) => b.attrs['data-eup-env-event-command']), ['release', 'retract']);
  type(m, 'event:usgs:us7000own1', 'the correction was wrong');
  m.q('[data-eup-env-rollback="1"]').click(); await settle();
  const rb = posts(m.log)[1].body;
  assert.deepEqual([rb.command, rb.expected_revision, rb.payload], ['rollback', 2, { to_revision: 1 }]);
  assert.notEqual(rb.idempotency_key, posts(m.log)[0].body.idempotency_key);
  assert.match(m.q('[data-eup-env-outcome="event:usgs:us7000own1|done"]').text, /recorded · state held · rev 3/);
});

test('an unknown outcome is never resent by itself: its key found in the decision log settles it; absent, the same key and body are offered', async () => {
  for (const found of [true, false]) {
    let review = reviewOf();
    const routes = { ['GET ' + P + '/health']: healthOf({ store: { status: 'applied' }, usgsStore: usgsStore() }), ['GET ' + P + '/review']: () => review, ['GET ' + P + '/preview']: previewOf(),
      ['GET ' + P + '/events/usgs%3Aus7000own1']: eventOf(),
      ['POST ' + P + '/commands']: (path, opts) => {
        if (found) review = reviewOf({ decisions: [{ seq: 7, command: 'retract', target_kind: 'event', target_id: 'usgs:us7000own1', expected_revision: 2, reason: 'x', idempotency_key: opts.body.idempotency_key, receipt: { changed: true }, created_at: NOW }] });
        return Promise.reject(http(503, 'storage_unavailable'));
      } };
    const m = await open(routes);
    await m.view('review');
    m.q('[data-eup-env-open="usgs:us7000own1"]').click(); await settle();
    type(m, 'event:usgs:us7000own1', 'withdraw it');
    m.q('[data-eup-env-event-command="retract"]').click(); await settle();
    assert.equal(posts(m.log).length, 1, 'not resent');
    if (found) {
      assert.match(m.q('[data-eup-env-outcome="event:usgs:us7000own1|done"]').text, /was recorded: its key is in the decision log \(decision 7, changed\)\. It was not resent\./);
      assert.equal(m.all('[data-eup-env-resend]').length, 0);
    } else {
      assert.match(m.q('[data-eup-env-outcome="event:usgs:us7000own1|unknown"]').text, /Its key is not in the decision log/);
      m.q('[data-eup-env-resend="event:usgs:us7000own1"]').click(); await settle();
      const [a, b] = posts(m.log);
      assert.deepEqual(b.body, a.body, 'the same key and the same body');
    }
  }
});

test('a moved revision is a conflict that changed nothing and reads again; a 403 conceals the whole workspace', async () => {
  const routes = { ['GET ' + P + '/health']: healthOf({ store: { status: 'applied' }, usgsStore: usgsStore() }), ['GET ' + P + '/review']: reviewOf(), ['GET ' + P + '/preview']: previewOf(),
    ['GET ' + P + '/events/usgs%3Aus7000own1']: eventOf(), ['POST ' + P + '/commands']: () => Promise.reject(http(409, 'revision_conflict')) };
  const m = await open(routes);
  await m.view('review');
  m.q('[data-eup-env-open="usgs:us7000own1"]').click(); await settle();
  const reads = m.log.length;
  type(m, 'event:usgs:us7000own1', 'hold it');
  m.q('[data-eup-env-event-command="hold"]').click(); await settle();
  assert.match(m.q('[data-eup-env-outcome="event:usgs:us7000own1|conflict"]').text, /changed elsewhere since it was read\. This command changed nothing/);
  assert.ok(m.log.length > reads + 1, 'read again');
  assert.equal(m.all('[data-eup-env-resend]').length, 0);
  const denied = await open({ ['GET ' + P + '/health']: http(403, 'owner_required'), ['GET ' + P + '/review']: http(403, 'owner_required'), ['GET ' + P + '/preview']: http(403, 'owner_required') });
  assert.equal(denied.q('[data-eup-env]'), null, 'nothing of the tab is drawn');
  assert.match(denied.pane().textContent, /House owner access required/);
});

test('the preview says what it is and lists the public projection; store text is escaped everywhere', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const events = [{ id: 'usgs:us7000own1', revision: 3, state: 'published', magnitude: 5.2, place: evil, observed_at: NOW, review_status: 'reviewed', correction: { revision: 3, cause: 'owner_rollback', changes: { magnitude: { from: 5.6, to: 5.2 } } }, news_coverage: [] },
    { id: 'usgs:us7000gone', revision: 2, state: 'withdrawn_by_source', magnitude: 4.9, place: 'Gone', observed_at: NOW, withdrawn_at: NOW }];
  const m = await open({ ['GET ' + P + '/health']: healthOf({ store: { status: 'applied' }, usgsStore: usgsStore() }), ['GET ' + P + '/review']: reviewOf({ held: [summary({ id: 'usgs:us7000own9', state: 'held', place: evil })] }), ['GET ' + P + '/preview']: previewOf(events) });
  await m.view('preview');
  assert.match(m.pane().textContent, /Owner preview \(decision D11, adopted pending Matthew's confirmation/);
  assert.match(m.q('[data-eup-env-preview-public]').text, /The public now: off \(404\)\./);
  assert.deepEqual(m.all('[data-eup-env-preview-item]').map((x) => x.attrs['data-eup-env-preview-item']), ['usgs:us7000own1:3:published', 'usgs:us7000gone:2:withdrawn_by_source']);
  assert.match(m.pane().textContent, /corrected: magnitude/); assert.match(m.pane().textContent, /withdrawn by USGS/);
  assert.ok(!m.pane().innerHTML.includes('<img src=x'), 'escaped in the preview');
  await m.view('review');
  assert.ok(!m.pane().innerHTML.includes('<img src=x'), 'escaped in the queue');
  assert.ok(m.pane().innerHTML.includes('&lt;img src=x'));
});

test('helpers: words per state, failures, the rule form, and which commands a state offers', () => {
  assert.match(V.publicLine({ state: 'off', reason: 'module_disabled' }), /installed but disabled/);
  assert.match(V.publicLine({ state: 'outage', reason: 'module_policy_unreadable' }), /503 module_policy_unavailable/);
  assert.match(V.publicLine({ state: 'outage', reason: 'stale' }), /copy kept from its last good answer/);
  assert.equal(V.publicLine({ state: 'no_data' }), 'No data: the provider answered and reported nothing.');
  assert.equal(V.publicLine({ state: 'reporting' }, 1), 'Reporting: 1 item.');
  assert.match(V.publicLine(null), /Unknown/);
  assert.deepEqual(V.eventActions('published'), ['hold', 'retract']); assert.deepEqual(V.eventActions('held'), ['release', 'retract']);
  assert.deepEqual(V.eventActions('retracted'), ['restore']); assert.deepEqual(V.eventActions('withdrawn_by_source'), []); assert.deepEqual(V.eventActions('merged'), []);
  const ev = eventOf().event;
  assert.deepEqual(V.rollbackTargets(ev), [1]);
  assert.deepEqual(V.rollbackTargets({ ...ev, summary: { ...ev.summary, state: 'withdrawn_by_source' } }), []);
  assert.deepEqual(V.rollbackTargets({ ...ev, revisions: [{ revision: 1, cause: 'source_deleted' }] }), []);
  assert.deepEqual(V.coverageActions({ state: 'proposed', event_revision: 2 }, 2), ['attach_coverage', 'reject_coverage']);
  assert.deepEqual(V.coverageActions({ state: 'proposed', event_revision: 1 }, 2), ['reject_coverage']);
  assert.deepEqual(V.coverageActions({ state: 'attached', event_revision: 2 }, 2), ['retract_coverage']);
  assert.deepEqual(V.coverageActions({ state: 'rejected' }, 2), []);
  const f = (status, reason) => V.failureOf(http(status, reason));
  assert.deepEqual([f(409, 'revision_conflict').kind, f(409, 'revision_conflict').settled], ['conflict', true]);
  assert.deepEqual([f(503, 'store_busy').kind, f(503, 'store_busy').again], ['busy', true]);
  assert.deepEqual([f(503, 'store_not_applied').settled, f(503, 'store_not_applied').kind], [true, 'not_configured']);
  assert.equal(f(409, 'invalid_transition').kind, 'conflict');
  assert.deepEqual([f(422, 'provider_not_supported').settled, f(404, 'not_found').settled], [true, true]);
  assert.deepEqual([f(503, 'storage_unavailable').kind, f(503, 'storage_unavailable').settled], ['unknown', false]);
  assert.deepEqual([V.failureOf({ timeout: true, deadline: 15000 }).kind, V.failureOf(new Error('x')).kind], ['unknown', 'unknown']);
  assert.deepEqual(V.ruleFrom({ min_magnitude: '4.5', include_automatic: true, significance_above: '600', pager_alert: true, tsunami: false }).rule, { min_magnitude: 4.5, include_automatic: true, significance_above: 600, pager_alert: true, tsunami: false });
  assert.ok(V.ruleFrom({ min_magnitude: '' }).problem); assert.ok(V.ruleFrom({ min_magnitude: '4', significance_above: '6.5' }).problem); assert.ok(V.ruleFrom({ min_magnitude: '4', significance_above: '10001' }).problem);
  assert.equal(V.ruleFrom({ min_magnitude: '0', significance_above: '' }).rule.significance_above, null);
  assert.match(V.reasonProblem(''), /required/); assert.match(V.reasonProblem('x'.repeat(501)), /longer than 500/); assert.match(V.reasonProblem('a\nb'), /single line/); assert.equal(V.reasonProblem('ok'), null);
  assert.match(V.ruleLine(USGS_RULE), /^M4\.5\+ \(automatic events included\), or significance above 600, or a PAGER alert, or a tsunami flag$/);
  assert.deepEqual(V.VIEWS.map((v) => v.id), ['sources', 'review', 'preview', 'decisions']);
});
