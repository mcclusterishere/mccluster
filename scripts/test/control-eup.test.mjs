/* Control · System · E=Up (js/control-room/eup.js): the state machine over the
   owner-only /v1/eup contract. Synthetic DOM and fixture responses only: owner,
   401, 403, 503 not_implemented / not_configured, a timed-out write (unknown
   outcome, never resent) and an account change mid-load (late answer discarded).
   The browser proof is scripts/e2e/control-eup.e2e.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';

/* a flat DOM: innerHTML is parsed into attribute-bearing elements, enough for
   querySelector('[data-x]') / ('[data-x="v"]') and textContent */
class El extends EventTarget {
  constructor(tag, attrs, text) { super(); this.tag = tag || 'div'; this.attrs = attrs || {}; this.text = text || ''; this.kids = []; this.dataset = {}; this.isConnected = true; this.disabled = Object.hasOwn(this.attrs, 'disabled'); this.value = this.attrs.value || ''; this._html = ''; }
  set innerHTML(s) { this._html = String(s); this.kids = parse(this._html); this.kids.forEach((k) => { k.owner = this.kids; }); }
  get innerHTML() { return this._html; }
  get textContent() { return this.kids.length ? this._html.replace(/<[^>]+>/g, ' ') : this.text; }
  set textContent(v) { this.text = String(v); this._html = ''; this.kids = []; }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  /* an element that never received innerHTML of its own searches the list it was parsed into (the flat DOM) */
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
    const inner = close > 0 ? html.slice(re.lastIndex, close) : '';
    out.push(new El(m[1], attrs, inner.replace(/<[^>]+>/g, ' ')));
  }
  return out;
}
globalThis.window = new EventTarget();
window.crypto = globalThis.crypto; window.CR = {};
globalThis.document = { activeElement: null };
const flush = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settleAll = async () => { for (let i = 0; i < 8; i += 1) await flush(); };
await import('../../js/control-room/eup.js');
const E = window.CR.eup, H = E.helpers;

const PROV = { source_id: 'ct-sots', source_record_id: 'r1', url: 'https://portal.ct.gov/x', observed_at: '2026-11-01T00:00:00Z', fetched_at: '2026-11-09T12:00:00Z', upstream_updated_at: '2026-11-02T00:00:00Z', parser_version: 'v1', review_state: 'reviewed', coverage: 'partial' };
const FIX = {
  '/v1/eup/overview': { ok: true, modules: [{ id: 'league', label: 'Environmental Justice League', state: 'draft', detail: 'campaign drafts only' }, { id: 'civic', label: 'Civic League', state: 'planned' }], geography: { selected: null }, campaigns: { drafts: 1, released: 0 }, queues: { applications: 0, proofs: 0, reviews: 0 }, freshness: [{ source: 'ct-sots', status: 'stale', fetched_at: '2026-11-09T12:00:00Z', upstream_updated_at: null }], blockers: [{ id: 'B1', text: 'Pending SQL unapplied', gate: 'owner apply' }] },
  '/v1/eup/sources': { ok: true, sources: [{ id: 'sec', label: 'SEC companyfacts', provider: 'sec.gov', configured: false, access: 'not_reviewed', availability: 'unavailable', last_attempt_at: null, last_success_at: null, records: null, unresolved: null, next_run_at: null, quota_reset_at: null, url: 'https://www.sec.gov/', rights: 'public domain' }] },
  '/v1/eup/sources/review': { ok: true, items: [] },
  '/v1/eup/civic/jurisdictions?parent=none': { ok: true, jurisdictions: [{ id: 'us-ct', name: 'Connecticut', kind: 'state', provenance: PROV }] },
  '/v1/eup/civic/jurisdictions?parent=us-ct': { ok: true, jurisdictions: [] },
  '/v1/eup/civic/offices?jurisdiction=us-ct': { ok: true, offices: [{ id: 'gov', title: 'Governor', vacant: false, provenance: PROV }] },
  '/v1/eup/civic/bills?jurisdiction=us-ct': { ok: true, bills: [] },
  '/v1/eup/civic/elections?jurisdiction=us-ct': { ok: true, elections: [] },
  '/v1/eup/companies/search?q=acme': { ok: true, results: [{ id: 'cik-1', name: 'Acme', identifiers: [{ scheme: 'CIK', value: '1' }] }] },
  '/v1/eup/companies/cik-1': { ok: true, entity: { id: 'cik-1', name: 'Acme' }, identifiers: [{ scheme: 'CIK', value: '1' }], locations: [{ kind: 'headquarters', geocode: null, provenance: PROV }], facts: [], awards: [], quote: { value: 12, currency: 'USD', licensed: false } }
};
function fakeRequest(overrides = {}, log = []) {
  return (path, opts) => {
    log.push({ path, method: opts && opts.method || 'GET', body: opts && opts.body, signal: opts && opts.signal });
    const o = overrides[path] || overrides['*'];
    if (typeof o === 'function') return o(path, opts);
    if (o instanceof Error) return Promise.reject(o);
    if (o) return Promise.resolve(o);
    return Promise.resolve(FIX[path] || { ok: false, reason: 'not_implemented', error: 'E=Up ' + path + ' is not implemented yet' });
  };
}
const http = (status, reason, message) => Object.assign(new Error(message || reason || 'HTTP ' + status), { status, detail: reason ? { ok: false, reason } : null });
function mount(opts) {
  H.resetModel(); H.model().section = 'overview'; H.model().geo = { country: null, state: null };
  const root = new El('div'); root.innerHTML = E.render(); E.bind(root, opts);
  return { root, host: root.querySelector('[data-eup]'), pane: () => root.querySelector('[data-eup-pane]'), status: () => root.querySelector('[data-eup-status]'), tab: (id) => root.querySelector('[data-eup-tabs]').querySelector('[data-eup-tab="' + id + '"]') };
}
const notes = (pane) => pane.querySelectorAll('[data-eup-note]').map((n) => n.attrs['data-eup-note']);

test('helpers: freshness is what the contract says, provenance never invents, reasons are specific', () => {
  assert.equal(H.freshnessLabel({ status: 'stale' }), 'stale');
  assert.equal(H.freshnessLabel({ status: 'ok' }), 'current');
  assert.equal(H.freshnessLabel({}), 'unknown');
  assert.equal(H.provenanceLine(null), 'Provenance not supplied.');
  const line = H.provenanceLine(PROV);
  assert.match(line, /Source ct-sots · record r1/); assert.match(line, /review reviewed/); assert.match(line, /coverage partial/); assert.match(line, /upstream updated/);
  assert.equal(H.provenanceLine({ source_id: 's' }).includes('observed not recorded'), true);
  assert.equal(H.reasonFor(http(403)).kind, 'denied');
  assert.equal(H.reasonFor(http(401)).kind, 'signed_out');
  assert.equal(H.reasonFor(http(503, 'not_implemented')).kind, 'not_implemented');
  assert.equal(H.reasonFor(http(503, 'not_configured')).kind, 'not_configured');
  assert.equal(H.reasonFor(http(503)).kind, 'unavailable');
  assert.equal(H.reasonFor({ timeout: true, deadline: 15000 }).kind, 'timeout');
  assert.equal(H.reasonFor(new Error('signed out')).kind, 'signed_out');
  assert.equal(H.reasonFor(null), null);
});

test('owner: overview renders modules, counts, freshness and blockers; unknown stays unknown', async () => {
  const log = [];
  const m = mount({ request: fakeRequest({ '/v1/eup/overview': { ...FIX['/v1/eup/overview'], queues: { applications: null } } }, log) });
  await flush(); await flush();
  const text = m.pane().textContent;
  assert.match(text, /Environmental Justice League/); assert.match(text, /Pending SQL unapplied/); assert.match(text, /gate: owner apply/);
  assert.match(text, /Applications: unknown/, 'a null count reads unknown, not 0');
  assert.ok(m.pane().querySelector('[data-eup-fresh="stale"]'));
  assert.ok(log[0].signal, 'every request carries an AbortSignal');
  assert.match(m.status().textContent, /No changes were made/);
});

test('403 conceals the workspace: denied note, no data, nothing else fetched after', async () => {
  const log = [];
  const m = mount({ request: fakeRequest({ '*': http(403, null, 'McCluster house owner access required') }, log) });
  await flush(); await flush();
  assert.deepEqual(notes(m.pane()), ['denied']);
  assert.match(m.pane().textContent, /admin-only/);
  const before = log.length;
  m.tab('sources').click(); await flush(); await flush();
  assert.deepEqual(notes(m.pane()), ['denied']); assert.equal(log.length, before, 'a denied workspace stops reading');
  assert.deepEqual(H.model().data, {});
});

test('503 not_implemented and not_configured are said plainly, never an empty success', async () => {
  const m = mount({ request: fakeRequest({ '/v1/eup/overview': http(503, 'not_implemented', 'E=Up overview is not implemented yet') }) });
  await flush(); await flush();
  assert.deepEqual(notes(m.pane()), ['not_implemented']); assert.match(m.pane().textContent, /Not implemented yet/);
  m.tab('league').click(); await flush(); await flush();
  assert.deepEqual(notes(m.pane()), ['not_implemented', 'not_implemented', 'not_implemented'], 'each League block says so');
  const n = mount({ request: fakeRequest({ '/v1/eup/overview': { ok: false, reason: 'not_configured', error: 'no policy' } }) });
  await flush(); await flush();
  assert.deepEqual(notes(n.pane()), ['not_configured']);
});

test('401 reads as signed out and clears the pane', async () => {
  const m = mount({ request: fakeRequest({ '*': http(401) }) });
  await flush(); await flush();
  assert.deepEqual(notes(m.pane()), ['signed_out']);
});

test('sources: refresh posts an idempotency key; a timed-out write is an unknown outcome and is not resent', async () => {
  const log = [];
  let hang = false;
  const command = () => hang ? new Promise(() => {}) : Promise.resolve({ ok: true, state: 'queued' });
  const m = mount({ deadlineMs: 30, request: fakeRequest({ '/v1/eup/sources/sec/refresh': command, '/v1/eup/sources/sec/pause': command }, log) });
  await flush(); await flush();
  m.tab('sources').click(); await flush(); await flush();
  assert.match(m.pane().textContent, /SEC companyfacts/); assert.match(m.pane().textContent, /not configured/); assert.match(m.pane().textContent, /access not_reviewed/);
  m.pane().querySelector('[data-eup-source-action="refresh"]').click(); await settleAll();
  const post = log.filter((l) => l.method === 'POST');
  assert.equal(post.length, 1); assert.match(post[0].body.idempotency_key, /^[0-9a-f-]{36}$/);
  assert.ok(notes(m.pane()).includes('done'));
  hang = true;
  m.pane().querySelector('[data-eup-source-action="pause"]').click(); await flush();
  assert.ok(notes(m.pane()).includes('pending'));
  assert.equal(m.pane().querySelector('[data-eup-source-action="pause"]').attrs.disabled !== undefined, true, 'only that connector\'s buttons wait');
  await wait(80); await settleAll();
  assert.ok(notes(m.pane()).includes('unknown'), 'timeout → unknown outcome');
  assert.match(m.pane().textContent, /was not resent/);
  assert.equal(log.filter((l) => l.method === 'POST').length, 2, 'no automatic replay');
  assert.ok(log.some((l) => l.path === '/v1/eup/sources' ), 'a read-back follows');
});

test('an account change mid-load discards the late answer and conceals private state', async () => {
  let release;
  const m = mount({ request: fakeRequest({ '/v1/eup/overview': () => new Promise((r) => { release = r; }) }) });
  await flush();
  window.dispatchEvent(new Event('mcc:auth-changed'));
  release(FIX['/v1/eup/overview']); await flush(); await flush();
  assert.deepEqual(notes(m.pane()), ['signed_out']);
  assert.doesNotMatch(m.pane().textContent, /Pending SQL unapplied/);
  assert.deepEqual(H.model().data, {});
});

test('civic: breadcrumb follows selection; choosing a jurisdiction loads offices, bills and elections; empties are not coverage', async () => {
  const log = [];
  const m = mount({ request: fakeRequest({}, log) });
  await flush(); await flush();
  m.tab('civic').click(); await flush(); await flush();
  assert.match(m.pane().textContent, /Connecticut/);
  assert.equal(m.pane().querySelector('[data-eup-crumb-level="Country"]').textContent.trim().endsWith('—'), true);
  m.pane().querySelector('[data-eup-jurisdiction="us-ct"]').click(); await flush(); await flush();
  assert.match(m.pane().textContent, /Governor/); assert.match(m.pane().textContent, /coverage may be absent, not zero/);
  assert.ok(log.some((l) => l.path === '/v1/eup/civic/bills?jurisdiction=us-ct'));
  assert.match(m.pane().querySelector('[data-eup-crumb-level="County / municipality"]').textContent, /Connecticut/);
});

test('companies: no fetch until a search; an unlicensed quote is never shown', async () => {
  const log = [];
  const m = mount({ request: fakeRequest({}, log) });
  await flush(); await flush();
  m.tab('companies').click(); await flush();
  assert.equal(log.filter((l) => l.path.startsWith('/v1/eup/companies')).length, 0);
  const q = m.pane().querySelector('[data-eup-company-q]'); q.value = 'acme';
  m.pane().querySelector('[data-eup-company-search]').click(); await flush(); await flush();
  m.pane().querySelector('[data-eup-company="cik-1"]').click(); await flush(); await flush();
  const text = m.pane().textContent;
  assert.match(text, /headquarters\s+· no coordinates/); assert.equal(m.pane().querySelector('[data-eup-quote]'), null); assert.match(text, /No licensed quote/);
});

test('keyboard: arrow keys move between the five local tabs and keep the globe host', async () => {
  const m = mount({ request: fakeRequest({}) });
  await flush();
  const globe = m.root.querySelector('[data-eup-globe]');
  m.tab('overview').onkeydown({ key: 'ArrowRight', preventDefault() {} }); await flush();
  assert.equal(m.tab('league').attrs['aria-selected'], 'true');
  m.tab('league').onkeydown({ key: 'End', preventDefault() {} }); await flush();
  assert.equal(m.tab('sources').attrs['aria-selected'], 'true');
  assert.equal(m.root.querySelector('[data-eup-globe]'), globe, 'tab switches redraw only the pane');
  assert.deepEqual(H.SECTIONS.map((s) => s.id), ['overview', 'league', 'civic', 'companies', 'sources']);
});
