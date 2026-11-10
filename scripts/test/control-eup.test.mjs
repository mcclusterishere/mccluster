/* Control · System · E=Up (js/control-room/eup.js): the state machine over the
   owner-only /v1/eup contract. Synthetic DOM and fixture responses only: owner,
   401, 403, 503 not_implemented / not_configured, a timed-out write (unknown
   outcome, never resent) and an account change mid-load (late answer discarded).
   The module-policy cases at the end drive the Overview › Modules controls
   against an in-memory stand-in for /v1/eup/modules that follows the Worker's
   documented answers (workers/mccluster/src/eup/modules.js); it is a fixture,
   not the Worker and not the SQL.
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

/* ---------- module policy (Overview › Modules card) ---------- */
const OWNER = '11111111-1111-4111-8111-111111111111', OTHER_OWNER = '11111111-1111-4111-8111-999999999999';
const UNITS = ['environment', 'league', 'intake'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_POLICY = { installed: null, state: 'unknown', revision: null, updated_at: null };
const OVERVIEW_P = { ok: true, modules: [
  { id: 'league', label: 'Environmental Justice League', state: 'draft', policy_module: 'league', policy: UNKNOWN_POLICY },
  { id: 'civic', label: 'Civic League', state: 'planned', policy_module: 'intake', policy: UNKNOWN_POLICY },
  { id: 'consumer_environment', label: 'Consumer environment globe', state: 'held', policy_module: 'environment', policy: UNKNOWN_POLICY },
  { id: 'arcade', label: 'City Arcade cloud', state: 'dormant', policy_module: null, policy: null }
], module_policy: { status: 'available', reason: null }, geography: { selected: null }, campaigns: { drafts: 0, released: 0 }, queues: { applications: 0, proofs: 0, reviews: 0 }, freshness: [], blockers: [] };
/* An in-memory stand-in for the three module routes. `start` seeds installed units; `hooks.post(unit, verb, body,
   apply)` may answer a POST itself (return a promise) or return undefined to let the stand-in apply it. */
function policyWorker({ start = {}, overview = OVERVIEW_P, hooks = {} } = {}) {
  const log = [], s = { rows: {}, commands: [], seq: 0, actor: OWNER, readError: null, overview, hooks };
  for (const [id, v] of Object.entries(start)) s.rows[id] = { state: v.state, revision: v.revision, updated_at: '2026-11-09T10:00:00Z', updated_by: OWNER };
  const read = () => ({ ok: true, installationId: 'mccluster', modules: UNITS.map((id) => {
    const r = s.rows[id];
    if (!r) return { moduleId: id, installed: false, state: null, revision: null, updated_at: null, updated_by: null, last_command: null };
    const c = s.commands.find((x) => x.module_id === id) || null;
    return { moduleId: id, installed: true, state: r.state, revision: r.revision, updated_at: r.updated_at, updated_by: r.updated_by, last_command: c && { seq: c.seq, command: c.command, requested_state: c.requested_state, expected_revision: c.expected_revision, reason: c.reason, actor: c.actor, idempotency_key: c.idempotency_key, receipt: c.receipt, created_at: c.created_at } };
  }), commands: s.commands.map((c) => ({ ...c })) });
  const apply = (id, verb, body) => {
    const digest = JSON.stringify([id, verb, body.state ?? null, body.expected_revision ?? null, body.reason]);
    const prior = s.commands.find((c) => c.idempotency_key === body.idempotency_key);
    if (prior) { if (prior.digest !== digest || prior.actor !== s.actor) throw http(409, 'idempotency_conflict'); return { ok: true, receipt: prior.receipt }; }
    const row = s.rows[id]; let receipt;
    const at = new Date(Date.UTC(2026, 10, 9, 12, 0, s.seq)).toISOString();
    if (verb === 'install') {
      if (row) throw http(409, 'module_already_installed');
      s.rows[id] = { state: 'disabled', revision: 0, updated_at: at, updated_by: s.actor };
      receipt = { policy: { schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: id, state: 'disabled', revision: 0 }, changed: true, prior: null, recorded_at: at };
    } else {
      if (!row) throw http(404, 'module_not_installed');
      if (row.revision !== body.expected_revision) throw http(409, 'revision_conflict');
      if (row.state === 'enabled' && body.state === 'disabled') throw http(409, 'drain_required');
      const priorState = { state: row.state, revision: row.revision }, changed = row.state !== body.state;
      if (changed) { row.state = body.state; row.revision += 1; row.updated_at = at; row.updated_by = s.actor; }
      receipt = { policy: { schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: id, state: row.state, revision: row.revision }, changed, prior: priorState, recorded_at: at };
    }
    s.seq += 1;
    s.commands.unshift({ seq: s.seq, module_id: id, command: verb === 'install' ? 'install' : 'set_state', requested_state: verb === 'install' ? 'disabled' : body.state, expected_revision: verb === 'install' ? null : body.expected_revision, reason: body.reason, actor: s.actor, prior_state: null, prior_revision: null, idempotency_key: body.idempotency_key, receipt, created_at: at, digest });
    return { ok: true, receipt };
  };
  const base = fakeRequest({}, []);
  const request = (path, opts) => {
    const method = opts && opts.method || 'GET';
    log.push({ path, method, body: opts && opts.body === undefined ? undefined : JSON.parse(JSON.stringify(opts.body)), signal: opts && opts.signal });
    if (path === '/v1/eup/overview') return s.overview instanceof Error ? Promise.reject(s.overview) : Promise.resolve(s.overview);
    if (path === '/v1/eup/modules' && method === 'GET') { if (s.hooks.read) { const r = s.hooks.read(read); if (r !== undefined) return r; } return s.readError ? Promise.reject(s.readError) : Promise.resolve(read()); }
    const m = /^\/v1\/eup\/modules\/([a-z]+)\/(install|state)$/.exec(path);
    if (m && method === 'POST') {
      if (s.hooks.post) { const r = s.hooks.post(m[1], m[2], opts.body, apply); if (r !== undefined) return r; }
      try { return Promise.resolve(apply(m[1], m[2], opts.body)); } catch (e) { return Promise.reject(e); }
    }
    return base(path, opts);
  };
  return { request, log, s, apply, read, posts: () => log.filter((l) => l.method === 'POST'), reads: () => log.filter((l) => l.method === 'GET' && l.path === '/v1/eup/modules').length };
}
const unit = (m, id) => m.pane().querySelector('[data-eup-policy="' + id + '"]');
const unitState = (m, id) => { const u = unit(m, id); return u ? u.attrs['data-eup-policy-state'].split(':')[1] : null; };
const commandsOf = (m, id) => m.pane().querySelectorAll('[data-eup-policy-command]').map((b) => b.attrs['data-eup-policy-command']).filter((v) => v.startsWith(id + ':')).map((v) => v.split(':')[1]);
const outcomes = (m) => m.pane().querySelectorAll('[data-eup-policy-outcome]').map((n) => n.attrs['data-eup-policy-outcome']);
const outcomeText = (m, id) => { const n = m.pane().querySelectorAll('[data-eup-policy-outcome]').find((x) => x.attrs['data-eup-policy-outcome'].startsWith(id + ':')); return n ? n.textContent : ''; };
const resendFor = (m, id) => m.pane().querySelector('[data-eup-policy-resend="' + id + '"]');
async function send(m, id, verb, reason) {
  const input = m.pane().querySelector('[data-eup-policy-reason="' + id + '"]');
  if (reason !== undefined) { input.value = reason; if (input.oninput) input.oninput(); }
  m.pane().querySelector('[data-eup-policy-command="' + id + ':' + verb + '"]').click();
  await settleAll();
}
async function opened(options) { const w = policyWorker(options); const m = mount({ deadlineMs: options && options.deadlineMs, request: w.request }); await settleAll(); return { w, m }; }

test('policy helpers: a state is read strictly, each state offers only its commands, a reason is checked before sending', () => {
  assert.deepEqual(H.POLICY_UNITS.map((u) => u.id), UNITS, 'the three units, in the order the Worker answers them');
  assert.equal(H.policyStateOf({ installed: false, state: null, revision: null }), 'not_installed');
  for (const st of ['enabled', 'draining', 'disabled']) assert.equal(H.policyStateOf({ installed: true, state: st, revision: 3 }), st);
  assert.equal(H.policyStateOf({ installed: true, state: 'enabled', revision: 0 }), 'enabled', 'revision 0 is a revision');
  for (const bad of [null, undefined, 'enabled', {}, { installed: true, state: 'enabled' }, { installed: true, state: 'enabled', revision: '3' }, { installed: true, state: 'enabled', revision: -1 }, { installed: true, state: 'enabled', revision: 1.5 }, { installed: true, state: 'on', revision: 1 }, { installed: null, state: 'unknown', revision: null }, { installed: 'true', state: 'enabled', revision: 1 }, { state: 'enabled', revision: 1 }])
    assert.equal(H.policyStateOf(bad), 'unknown', 'never read as enabled: ' + JSON.stringify(bad));
  const verbs = (st) => H.policyActions(st).map((a) => a.verb + '/' + a.label);
  assert.deepEqual(verbs('not_installed'), ['install/Install']);
  assert.deepEqual(verbs('disabled'), ['enabled/Enable'], 'disabled offers Enable only: never disabled → draining');
  assert.deepEqual(verbs('enabled'), ['draining/Drain'], 'enabled offers Drain only: never enabled → disabled');
  assert.deepEqual(verbs('draining'), ['disabled/Disable', 'enabled/Re-enable']);
  assert.deepEqual(verbs('unknown'), []); assert.deepEqual(verbs('constructor'), []); assert.deepEqual(verbs(undefined), []);
  H.policyActions('disabled').push({ verb: 'draining' }); assert.equal(H.policyActions('disabled').length, 1, 'a caller cannot widen the table');
  assert.equal(H.reasonProblem('because'), null); assert.equal(H.reasonProblem('  padded  '), null);
  assert.equal(H.reasonProblem('x'.repeat(500)), null); assert.match(H.reasonProblem('x'.repeat(501)), /longer than 500/);
  assert.equal(H.reasonProblem('😀'.repeat(500)), null, 'counted in code points, as the Worker counts');
  assert.match(H.reasonProblem('😀'.repeat(501)), /longer than 500/);
  for (const empty of ['', '   ', null, undefined, 7]) assert.match(H.reasonProblem(empty), /reason is required/);
  for (const ctl of ['two\nlines', 'a\ttab', 'bell\u0007', 'del\u007f', 'cr\rlf']) assert.match(H.reasonProblem(ctl), /single line/);
  assert.equal(H.reasonProblem('\n trimmed first \n'), null, 'surrounding whitespace is trimmed before the check, as the Worker trims');
});

test('policy helpers: only a refusal the Worker documents is "nothing changed"; a timeout and any other 503 are unknown', () => {
  const f = (e) => { const r = H.policyFailure(e); return [r.kind, r.settled, r.again]; };
  assert.deepEqual(f({ timeout: true, deadline: 15000 }), ['unknown', false, false]);
  assert.match(H.policyFailure({ timeout: true, deadline: 9000 }).text, /^timed out after 9s\. The outcome is unknown and it was not resent\.$/);
  assert.match(H.policyFailure({ timeout: true }).text, /timed out after 15s/);
  assert.deepEqual(f(Object.assign(new Error('aborted'), { name: 'AbortError' })), ['unknown', false, false]);
  assert.deepEqual(f(http(409, 'revision_conflict')), ['conflict', true, false]);
  assert.match(H.policyFailure(http(409, 'revision_conflict')).text, /changed elsewhere/);
  assert.deepEqual(f(http(503, 'drain_busy')), ['busy', true, true]);
  assert.match(H.policyFailure(http(503, 'drain_busy')).text, /writes are still in flight; nothing changed/);
  assert.deepEqual(f(http(409, 'drain_required')), ['error', true, false]);
  assert.deepEqual(f(http(409, 'idempotency_conflict')), ['error', true, false]);
  assert.match(H.policyFailure(http(409, 'idempotency_conflict')).text, /another owner/);
  assert.deepEqual(f(http(409, 'module_already_installed')), ['conflict', true, false]);
  assert.deepEqual(f(http(404, 'module_not_installed')), ['conflict', true, false]);
  assert.deepEqual(f(http(422, 'reason_required')), ['error', true, false]);
  for (const status of [400, 404, 405, 409, 413, 415, 422]) { assert.deepEqual(f(http(status, 'whatever')), ['error', true, false], 'refusal ' + status); assert.match(H.policyFailure(http(status, 'whatever')).text, new RegExp('refused \\(HTTP ' + status + ' whatever\\)\\. Nothing changed\\.')); }
  assert.match(H.policyFailure(http(400)).text, /refused \(HTTP 400\)\. Nothing changed\./);
  for (const reason of ['storage_unavailable', 'schema_not_applied', 'not_implemented', 'not_configured', 'module_busy', '']) {
    const r = H.policyFailure(http(503, reason));
    assert.deepEqual([r.kind, r.settled, r.again], ['unknown', false, false], '503 ' + reason + ' is an unknown outcome');
    assert.match(r.text, /The outcome is unknown and it was not resent\.$/); assert.doesNotMatch(r.text, /Nothing changed/i);
  }
  assert.match(H.policyFailure(http(503, 'storage_unavailable')).text, /^answered HTTP 503 storage_unavailable\. /);
  for (const status of [408, 429, 499, 500, 502, 504]) assert.deepEqual(f(http(status, 'x')), ['unknown', false, false], 'status ' + status + ' is not a documented refusal');
  assert.deepEqual(f(new Error('unreadable receipt')), ['unknown', false, false]);
  assert.match(H.policyFailure(new Error('x')).text, /^no readable answer\. The outcome is unknown/);
  assert.deepEqual(f(undefined), ['unknown', false, false]);
  assert.deepEqual(f({ status: 409, detail: { reason: 7 } }), ['error', true, false], 'a reason that is not text is not read');
  assert.equal(H.policyFailure({ status: 409, detail: { reason: 7 } }).text, 'refused (HTTP 409). Nothing changed.');
  assert.deepEqual(f(http(409, 'drain_busy')), ['error', true, false], 'drain_busy is read only on a 503');
  assert.deepEqual(f(http(500, 'drain_busy')), ['unknown', false, false]);
});

test('policy: nothing installed → each unit offers Install only; posture and policy are two chips; the environment line says what enabling does', async () => {
  const { w, m } = await opened();
  assert.deepEqual(UNITS.map((id) => unitState(m, id)), ['not_installed', 'not_installed', 'not_installed']);
  for (const id of UNITS) assert.deepEqual(commandsOf(m, id), ['install']);
  assert.equal(m.pane().querySelectorAll('[data-eup-policy-reason]').length, 3, 'one reason field per unit');
  assert.equal(m.pane().querySelectorAll('[data-eup-policy-rev]').length, 0, 'no revision is shown for a unit that has no row');
  assert.equal(m.pane().querySelectorAll('[data-eup-policy-resend]').length, 0);
  const league = m.pane().querySelector('[data-eup-module="league"]').textContent;
  assert.match(league, /release: draft/); assert.match(league, /policy: not installed/); assert.match(league, /unit league/);
  assert.match(m.pane().querySelector('[data-eup-module="civic"]').textContent, /unit intake/);
  assert.match(m.pane().querySelector('[data-eup-module="arcade"]').textContent, /no policy unit/);
  assert.doesNotMatch(m.pane().querySelector('[data-eup-module="arcade"]').textContent, /policy:/);
  assert.equal(m.pane().querySelectorAll('[data-eup-posture]').length, 4); assert.equal(m.pane().querySelectorAll('[data-eup-posture="held"]').length, 1);
  const effect = m.pane().querySelectorAll('[data-eup-policy-effect]');
  assert.deepEqual(effect.map((e) => e.attrs['data-eup-policy-effect']), ['environment']);
  assert.equal(effect[0].textContent, 'The consumer E=Up tab answers nothing until this unit is installed and enabled.');
  assert.match(unit(m, 'intake').textContent, /Governs: Civic League/); assert.match(unit(m, 'environment').textContent, /Governs: Consumer environment globe/);
  assert.match(unit(m, 'league').textContent, /No command recorded for this unit/);
  assert.equal(w.posts().length, 0, 'opening the tab sends no command'); assert.equal(w.reads(), 1);
  const input = m.pane().querySelector('[data-eup-policy-reason="league"]');
  assert.equal(input.tag, 'input'); assert.equal(input.attrs.type, 'text', 'a single-line input: the Worker refuses newlines'); assert.equal(input.attrs.maxlength, '500');
  assert.equal(m.pane().querySelectorAll('[for]').filter((l) => l.attrs.for === input.attrs.id).length, 1, 'the reason field has a label');
});

test('policy: a command needs a reason; install → enable → drain → disable carries the revision just read and a fresh key each time, and is read back', async () => {
  const { w, m } = await opened();
  await send(m, 'environment', 'install', '   ');
  assert.equal(w.posts().length, 0, 'no reason, nothing sent');
  assert.deepEqual(outcomes(m), ['environment:error']); assert.match(outcomeText(m, 'environment'), /reason is required/); assert.match(m.status().textContent, /nothing was sent/);
  assert.equal(document.activeElement.attrs['data-eup-policy-reason'], 'environment', 'focus goes to the reason field');
  await send(m, 'environment', 'install', 'two\nlines');
  assert.equal(w.posts().length, 0, 'a control character is refused before sending'); assert.match(outcomeText(m, 'environment'), /single line/);

  const before = w.reads();
  await send(m, 'environment', 'install', '  first install for the tester phase  ');
  assert.equal(w.posts().length, 1);
  assert.equal(w.posts()[0].path, '/v1/eup/modules/environment/install');
  assert.deepEqual(Object.keys(w.posts()[0].body).sort(), ['idempotency_key', 'reason'], 'install sends a key and a reason, nothing else (no actor, no revision)');
  assert.match(w.posts()[0].body.idempotency_key, UUID); assert.equal(w.posts()[0].body.reason, 'first install for the tester phase', 'trimmed');
  assert.equal(w.reads(), before + 1, 'one read-back after the command');
  assert.equal(unitState(m, 'environment'), 'disabled'); assert.deepEqual(commandsOf(m, 'environment'), ['enabled'], 'disabled → Enable only');
  assert.ok(m.pane().querySelector('[data-eup-policy-rev="environment:0"]'), 'rev 0 after install');
  assert.deepEqual(outcomes(m), ['environment:done']); assert.match(outcomeText(m, 'environment'), /^Install Environment: recorded · state disabled · rev 0/);
  assert.match(unit(m, 'environment').textContent, /Last command: install \(created disabled\) · reason: first install for the tester phase · /);
  assert.equal(m.pane().querySelector('[data-eup-policy-reason="environment"]').value, '', 'the reason is cleared once the command is recorded');
  assert.match(m.pane().querySelector('[data-eup-module="consumer_environment"]').textContent, /policy: disabled/, 'the module row follows the owner read');
  assert.deepEqual(commandsOf(m, 'league'), ['install'], 'the other units are untouched');

  await send(m, 'environment', 'enabled', 'open the tab to testers');
  assert.equal(w.posts()[1].path, '/v1/eup/modules/environment/state');
  assert.deepEqual(Object.keys(w.posts()[1].body).sort(), ['expected_revision', 'idempotency_key', 'reason', 'state']);
  assert.equal(w.posts()[1].body.state, 'enabled'); assert.equal(w.posts()[1].body.expected_revision, 0);
  assert.equal(unitState(m, 'environment'), 'enabled'); assert.deepEqual(commandsOf(m, 'environment'), ['draining'], 'enabled → Drain only');
  assert.ok(m.pane().querySelector('[data-eup-policy-rev="environment:1"]'));
  assert.equal(m.pane().querySelectorAll('[data-eup-policy-meaning]').length, 0, 'an enabled unit carries no stopped-state line');

  await send(m, 'environment', 'draining', 'stop new writes before maintenance');
  assert.equal(w.posts()[2].body.state, 'draining'); assert.equal(w.posts()[2].body.expected_revision, 1);
  assert.equal(unitState(m, 'environment'), 'draining'); assert.deepEqual(commandsOf(m, 'environment'), ['disabled', 'enabled'], 'draining → Disable and Re-enable');
  assert.deepEqual(m.pane().querySelectorAll('[data-eup-policy-meaning]').map((d) => d.attrs['data-eup-policy-meaning'] + ' ' + d.textContent), ['environment:draining Draining: the consumer E=Up tab still answers reads and refuses every write. This page is not told how much work is still in flight; disable when it is done, or re-enable.']);
  assert.match(unit(m, 'environment').textContent, /Last command: draining · reason: stop new writes before maintenance/);

  await send(m, 'environment', 'disabled', 'maintenance window');
  assert.equal(w.posts()[3].body.state, 'disabled'); assert.equal(w.posts()[3].body.expected_revision, 2);
  assert.equal(unitState(m, 'environment'), 'disabled'); assert.ok(m.pane().querySelector('[data-eup-policy-rev="environment:3"]'));
  assert.deepEqual(m.pane().querySelectorAll('[data-eup-policy-meaning]').map((d) => d.attrs['data-eup-policy-meaning'] + ' ' + d.textContent), ['environment:disabled Disabled: that includes a participant&#39;s own saved records.'], 'disabled is explained in words');
  assert.match(outcomeText(m, 'environment'), /^Disable Environment: recorded · state disabled · rev 3/);
  const keys = w.posts().map((p) => p.body.idempotency_key);
  assert.equal(new Set(keys).size, 4, 'a fresh key on every command'); keys.forEach((k) => assert.match(k, UUID));
  assert.equal(w.reads(), before + 4, 'exactly one read-back per command');
  assert.ok(w.posts().every((p) => p.signal), 'every command carries an AbortSignal');
  assert.equal(w.log.filter((l) => l.path === '/v1/eup/overview').length, 1, 'a command does not reload the overview');
});

test('policy: draining → Re-enable sends state enabled with the draining revision; a same-state answer is reported as no change', async () => {
  const { w, m } = await opened({ start: { league: { state: 'draining', revision: 6 }, intake: { state: 'enabled', revision: 2 } } });
  assert.deepEqual(commandsOf(m, 'league'), ['disabled', 'enabled']); assert.deepEqual(commandsOf(m, 'intake'), ['draining']); assert.deepEqual(commandsOf(m, 'environment'), ['install']);
  const open = 'new work is refused. Reads still answer, and so do actions that only stop work or remove exposure (withdraw, revoke, pause).';
  assert.deepEqual(m.pane().querySelectorAll('[data-eup-policy-meaning]').map((d) => d.attrs['data-eup-policy-meaning'] + ' ' + d.textContent), ['league:draining Draining: ' + open + ' This page is not told how much work is still in flight; disable when it is done, or re-enable.']);
  assert.match(unit(m, 'league').textContent, /Last command: not returned/);
  await send(m, 'league', 'enabled', 'the import finished early');
  assert.deepEqual(w.posts()[0].body, { idempotency_key: w.posts()[0].body.idempotency_key, expected_revision: 6, state: 'enabled', reason: 'the import finished early' });
  assert.match(outcomeText(m, 'league'), /^Enable League: recorded · state enabled · rev 7/);
  w.s.hooks.post = (id, verb, body, apply) => { w.s.rows.intake.state = 'draining'; w.s.rows.intake.revision = 2; return undefined; };
  await send(m, 'intake', 'draining', 'drain intake');
  assert.match(outcomeText(m, 'intake'), /the state was already draining, the revision did not move/);
  assert.match(unit(m, 'intake').textContent, /Last command: draining · no state change · reason: drain intake/);
  w.s.hooks.post = undefined;
  await send(m, 'intake', 'disabled', 'stop intake');
  assert.ok(m.pane().querySelectorAll('[data-eup-policy-meaning]').some((d) => d.attrs['data-eup-policy-meaning'] === 'intake:disabled' && d.textContent === 'Disabled: ' + open), 'a disabled League or intake unit says what still answers');
});

test('policy: a timed-out command is an unknown outcome, is not resent, is read back, and the same key is offered again only when the log does not hold it', async () => {
  let hang = true;
  const { w, m } = await opened({ deadlineMs: 30, start: { league: { state: 'disabled', revision: 4 } }, hooks: { post: () => hang ? new Promise(() => {}) : undefined } });
  const input = m.pane().querySelector('[data-eup-policy-reason="league"]'); input.value = 'open the League to testers'; input.oninput();
  m.pane().querySelector('[data-eup-policy-command="league:enabled"]').click(); await flush();
  assert.deepEqual(outcomes(m), ['league:pending']);
  assert.equal(m.pane().querySelector('[data-eup-policy-command="league:enabled"]').attrs['aria-disabled'], 'true', 'the waiting unit\'s button is marked');
  assert.equal(m.pane().querySelector('[data-eup-policy-command="intake:install"]').attrs['aria-disabled'], undefined, 'only that unit waits');
  m.pane().querySelector('[data-eup-policy-command="league:enabled"]').click(); await flush();
  assert.equal(w.posts().length, 1, 'a second press while waiting sends nothing');
  const reads = w.reads();
  await wait(80); await settleAll();
  assert.equal(w.posts().length, 1, 'no automatic replay');
  assert.equal(w.reads(), reads + 1, 'a read-back follows the unknown outcome');
  assert.deepEqual(outcomes(m), ['league:unknown']);
  assert.match(outcomeText(m, 'league'), /Enable League: the outcome is unknown and it was not resent\. Its key is not in the command log/);
  assert.match(m.status().textContent, /outcome is unknown/);
  assert.equal(unitState(m, 'league'), 'disabled', 'the state shown is what was read, not what was asked');
  assert.ok(resendFor(m, 'league'), 'the same command is offered again'); assert.equal(resendFor(m, 'intake'), null);
  assert.match(unit(m, 'league').textContent, /Only the account that sent it can; another owner is refused/);
  assert.equal(m.pane().querySelector('[data-eup-policy-reason="league"]').value, 'open the League to testers', 'the reason is kept while the outcome is unknown');
  hang = false;
  resendFor(m, 'league').click(); await settleAll();
  assert.equal(w.posts().length, 2);
  assert.deepEqual(w.posts()[1].body, w.posts()[0].body, 'the resend is the same body: same key, same expected revision, same reason');
  assert.equal(w.posts()[1].path, w.posts()[0].path);
  assert.deepEqual(outcomes(m), ['league:done']); assert.equal(unitState(m, 'league'), 'enabled'); assert.equal(resendFor(m, 'league'), null);
  assert.equal(w.s.commands.length, 1, 'recorded once');
});

test('policy: a timed-out command that was in fact recorded is found by its key in the read-back and is not offered again', async () => {
  const { w, m } = await opened({ deadlineMs: 30, start: { league: { state: 'disabled', revision: 4 } }, hooks: { post: (id, verb, body, apply) => { apply(id, verb, body); return new Promise(() => {}); } } });
  await send(m, 'league', 'enabled', 'open the League to testers');
  await wait(80); await settleAll();
  assert.equal(w.posts().length, 1);
  assert.deepEqual(outcomes(m), ['league:done']);
  assert.match(outcomeText(m, 'league'), /Enable League was recorded: its key is in the command log read .* \(state enabled, rev 5\)\. It was not resent\./);
  assert.equal(resendFor(m, 'league'), null, 'nothing to send again'); assert.equal(unitState(m, 'league'), 'enabled'); assert.deepEqual(commandsOf(m, 'league'), ['draining']);
});

test('policy: a 503 other than drain_busy is an unknown outcome with the same read-back and same-key resend; another owner\'s resend is a conflict and says so', async () => {
  let fail = true;
  const { w, m } = await opened({ start: { intake: { state: 'enabled', revision: 1 } }, hooks: { post: () => fail ? Promise.reject(http(503, 'storage_unavailable', 'Module policy storage unavailable')) : undefined } });
  w.apply('league', 'install', { idempotency_key: 'an-earlier-command-of-another-unit', reason: 'earlier' });
  let giveRead = null; w.s.hooks.read = (read) => new Promise((r) => { giveRead = () => r(read()); });
  const reads = w.reads();
  await send(m, 'intake', 'draining', 'pause imports');
  assert.equal(w.posts().length, 1, 'not resent'); assert.equal(w.reads(), reads + 1);
  assert.deepEqual(outcomes(m), ['intake:unknown']); assert.match(outcomeText(m, 'intake'), /^Drain Intake: answered HTTP 503 storage_unavailable\. The outcome is unknown and it was not resent\. Reading module policy back…$/);
  assert.equal(resendFor(m, 'intake'), null, 'nothing is offered until the read-back has looked for the key');
  w.s.hooks.read = undefined; giveRead(); await settleAll();
  assert.deepEqual(outcomes(m), ['intake:unknown']); assert.ok(resendFor(m, 'intake'), 'the log holds another command but not this key: the same key is offered');
  assert.equal(unitState(m, 'league'), 'disabled');
  assert.match(outcomeText(m, 'intake'), /Drain Intake: the outcome is unknown and it was not resent/);
  /* the stored key now arrives from a different owner: the Worker answers 409 idempotency_conflict */
  fail = false; w.s.commands.unshift({ seq: 99, module_id: 'intake', command: 'set_state', requested_state: 'draining', expected_revision: 1, reason: 'pause imports', actor: OTHER_OWNER, idempotency_key: 'someone-elses-key', receipt: null, created_at: '2026-11-09T12:00:00Z', digest: 'x' });
  w.s.commands[0].idempotency_key = w.posts()[0].body.idempotency_key; w.s.commands[0].actor = OTHER_OWNER;
  resendFor(m, 'intake').click(); await settleAll();
  assert.equal(w.posts().length, 2); assert.equal(w.posts()[1].body.idempotency_key, w.posts()[0].body.idempotency_key);
  assert.deepEqual(outcomes(m), ['intake:error']);
  assert.match(outcomeText(m, 'intake'), /^Drain Intake: this key was already used for a different command, or by another owner; only the account that first sent a command can send it again\. Nothing was changed by this request\./);
  assert.equal(resendFor(m, 'intake'), null, 'a refused key is not offered again');
});

test('policy: an unknown outcome whose read-back fails offers no resend and no command until a read succeeds', async () => {
  const { w, m } = await opened({ start: { intake: { state: 'enabled', revision: 1 } }, hooks: { post: () => Promise.reject(http(503, 'storage_unavailable')) } });
  w.s.readError = http(503, 'storage_unavailable');
  await send(m, 'intake', 'draining', 'pause imports');
  assert.equal(unit(m, 'intake'), null, 'a failed read drops the remembered state: no unit, no command');
  assert.equal(m.pane().querySelectorAll('[data-eup-policy-command]').length, 0); assert.equal(m.pane().querySelectorAll('[data-eup-policy-resend]').length, 0);
  assert.match(m.pane().textContent, /State is unknown and no command is offered/);
  assert.deepEqual(outcomes(m), ['intake:unknown'], 'what is known about the command is still said');
  assert.match(outcomeText(m, 'intake'), /^Drain Intake: the outcome is unknown and it was not resent\. The read-back failed; read module policy again before deciding\.$/);
  assert.equal(H.model().outcomes['policy:intake'].resend, false);
  assert.equal(w.posts().length, 1);
  w.s.readError = null; w.s.hooks.post = undefined;
  m.pane().querySelector('[data-eup-policy-reload]').click(); await settleAll();
  assert.deepEqual(outcomes(m), ['intake:unknown']); assert.ok(resendFor(m, 'intake'), 'once a read succeeds and the key is absent, the same key is offered');
  assert.match(m.status().textContent, /Its key is not in the command log/);
  resendFor(m, 'intake').click(); await settleAll();
  assert.equal(w.posts()[1].body.idempotency_key, w.posts()[0].body.idempotency_key); assert.equal(unitState(m, 'intake'), 'draining');
});

test('policy: 409 revision_conflict changes nothing, says it changed elsewhere and reloads the state to decide again', async () => {
  const { w, m } = await opened({ start: { league: { state: 'disabled', revision: 4 } } });
  /* another owner enables and drains the League after this page read revision 4 */
  w.s.rows.league = { state: 'draining', revision: 6, updated_at: '2026-11-09T11:00:00Z', updated_by: OTHER_OWNER };
  const reads = w.reads();
  await send(m, 'league', 'enabled', 'open the League');
  assert.equal(w.posts()[0].body.expected_revision, 4, 'the revision that was read is what is sent');
  assert.equal(w.reads(), reads + 1, 'reloaded');
  assert.deepEqual(outcomes(m), ['league:conflict']);
  assert.match(outcomeText(m, 'league'), /^Enable League: the module policy changed elsewhere since it was read\. This command changed nothing/);
  assert.equal(unitState(m, 'league'), 'draining'); assert.ok(m.pane().querySelector('[data-eup-policy-rev="league:6"]'));
  assert.deepEqual(commandsOf(m, 'league'), ['disabled', 'enabled'], 'the buttons follow the reloaded state');
  assert.equal(resendFor(m, 'league'), null, 'a conflicted command is not offered again'); assert.equal(w.posts().length, 1);
  await send(m, 'league', 'disabled', 'decided again');
  assert.equal(w.posts()[1].body.expected_revision, 6); assert.notEqual(w.posts()[1].body.idempotency_key, w.posts()[0].body.idempotency_key);
});

test('policy: 503 drain_busy means writes are still in flight and nothing changed; the same key can be sent again', async () => {
  let busy = true;
  const { w, m } = await opened({ start: { league: { state: 'enabled', revision: 2 } }, hooks: { post: () => busy ? Promise.reject(http(503, 'drain_busy')) : undefined } });
  await send(m, 'league', 'draining', 'drain before the release');
  assert.deepEqual(outcomes(m), ['league:busy']);
  assert.match(outcomeText(m, 'league'), /^Drain League: writes are still in flight; nothing changed\. The same command can be sent again\.$/);
  assert.doesNotMatch(outcomeText(m, 'league'), /unknown/);
  assert.equal(unitState(m, 'league'), 'enabled'); assert.ok(resendFor(m, 'league')); assert.equal(w.posts().length, 1, 'not resent by itself');
  busy = false; resendFor(m, 'league').click(); await settleAll();
  assert.deepEqual(w.posts()[1].body, w.posts()[0].body); assert.equal(unitState(m, 'league'), 'draining'); assert.deepEqual(outcomes(m), ['league:done']);
});

test('policy: documented refusals are settled and are not offered again; an unreadable 200 is unknown', async () => {
  let answer = () => Promise.reject(http(409, 'drain_required'));
  const { w, m } = await opened({ start: { league: { state: 'draining', revision: 2 } }, hooks: { post: () => answer() } });
  await send(m, 'league', 'disabled', 'r1');
  assert.deepEqual(outcomes(m), ['league:error']); assert.match(outcomeText(m, 'league'), /^Disable League: an enabled module must be drained before it is disabled\. Nothing changed\.$/); assert.equal(resendFor(m, 'league'), null);
  answer = () => Promise.reject(http(404, 'module_not_installed'));
  await send(m, 'league', 'disabled', 'r2');
  assert.deepEqual(outcomes(m), ['league:conflict']); assert.equal(resendFor(m, 'league'), null);
  answer = () => Promise.resolve({ ok: true, receipt: { policy: { state: 'disabled' } } });
  await send(m, 'league', 'disabled', 'r3');
  assert.deepEqual(outcomes(m), ['league:unknown'], 'a 200 without a readable receipt is not a success'); assert.ok(resendFor(m, 'league'));
  answer = () => Promise.resolve({ ok: false, reason: 'drain_busy', error: 'busy' });
  resendFor(m, 'league').click(); await settleAll();
  assert.deepEqual(outcomes(m), ['league:busy'], 'an ok:false body is read by its reason');
  answer = () => Promise.resolve({ ok: true });
  await send(m, 'league', 'disabled', 'r4');
  assert.deepEqual(outcomes(m), ['league:unknown']);
  answer = () => Promise.resolve({ receipt: { policy: { state: 'disabled', revision: 3 } } });
  await send(m, 'league', 'disabled', 'r5');
  assert.deepEqual(outcomes(m), ['league:unknown'], 'a receipt without ok:true is not a success');
  answer = () => Promise.resolve({ ok: true, receipt: { policy: { state: 'disabled', revision: '3' } } });
  await send(m, 'league', 'disabled', 'r6');
  assert.deepEqual(outcomes(m), ['league:unknown'], 'a receipt whose revision is not a number is not a success');
  assert.equal(w.s.commands.length, 0);
});

test('policy: a 403 on a command or on the policy read conceals the whole workspace', async () => {
  const a = await opened({ start: { league: { state: 'disabled', revision: 0 } }, hooks: { post: () => Promise.reject(http(403, 'owner_required', 'House owner required')) } });
  const reads = a.w.reads();
  await send(a.m, 'league', 'enabled', 'open');
  assert.deepEqual(notes(a.m.pane()), ['denied']); assert.equal(a.m.pane().querySelectorAll('[data-eup-policy]').length, 0);
  assert.deepEqual(H.model().data, {}); assert.deepEqual(H.model().outcomes, {}); assert.equal(H.model().policy.control, null);
  assert.equal(a.w.reads(), reads, 'no read-back after the owner was lost');
  assert.match(a.m.status().textContent, /House owner access required/);
  const b = await opened({ start: { league: { state: 'enabled', revision: 3 } }, hooks: { read: () => Promise.reject(http(403, 'owner_required')) } });
  assert.deepEqual(notes(b.m.pane()), ['denied']); assert.doesNotMatch(b.m.pane().textContent, /Environmental Justice League/);
  assert.deepEqual(H.model().data, {});
  const c = await opened({ hooks: { read: () => Promise.reject(http(401)) } });
  assert.deepEqual(notes(c.m.pane()), ['signed_out']); assert.deepEqual(H.model().data, {});
  const d = await opened({ overview: http(401) });
  assert.deepEqual(notes(d.m.pane()), ['signed_out']); assert.equal(d.w.reads(), 0, 'a signed-out overview is not followed by a policy read');
  const e = await opened({ overview: http(403) });
  assert.deepEqual(notes(e.m.pane()), ['denied']); assert.equal(e.w.reads(), 0, 'nor is a denied one');
});

test('policy: an account change discards a late command answer and a late policy read', async () => {
  let release;
  const { w, m } = await opened({ start: { league: { state: 'disabled', revision: 0 } }, hooks: { post: (id, verb, body, apply) => new Promise((r) => { release = () => r(apply(id, verb, body)); }) } });
  const input = m.pane().querySelector('[data-eup-policy-reason="league"]'); input.value = 'open'; input.oninput();
  m.pane().querySelector('[data-eup-policy-command="league:enabled"]').click(); await flush();
  assert.deepEqual(outcomes(m), ['league:pending']);
  const reads = w.reads();
  window.dispatchEvent(new Event('mcc:auth-changed'));
  release(); await settleAll();
  assert.deepEqual(notes(m.pane()), ['signed_out']); assert.equal(m.pane().querySelectorAll('[data-eup-policy]').length, 0);
  assert.deepEqual(H.model().outcomes, {}, 'the late answer wrote no outcome'); assert.equal(H.model().policy.control, null); assert.deepEqual(H.model().policy.reasons, {});
  assert.equal(w.reads(), reads, 'and no read-back was made for the old account');
  assert.equal(w.log.at(-1).signal.aborted, true, 'the in-flight command was aborted');

  let give;
  const late = await opened({ hooks: { read: (read) => new Promise((r) => { give = () => r(read()); }) } });
  window.dispatchEvent(new Event('mcc:auth-changed'));
  give(); await settleAll();
  assert.deepEqual(notes(late.m.pane()), ['signed_out']); assert.equal(H.model().policy.control, null);
});

test('policy: a failed or unreadable policy read shows unknown, offers no command, and never falls back to remembered or overview state', async () => {
  const enabledOverview = { ...OVERVIEW_P, modules: OVERVIEW_P.modules.map((x) => x.policy_module ? { ...x, policy: { installed: true, state: 'enabled', revision: 9, updated_at: '2026-11-09T10:00:00Z' } } : x) };
  const a = await opened({ overview: enabledOverview, start: { league: { state: 'enabled', revision: 9 } } });
  assert.match(a.m.pane().querySelector('[data-eup-module="league"]').textContent, /policy: enabled/);
  a.w.s.readError = http(503, 'storage_unavailable');
  a.m.pane().querySelector('[data-eup-policy-reload]').click(); await settleAll();
  assert.equal(a.m.pane().querySelectorAll('[data-eup-policy-command]').length, 0, 'no command without a read');
  assert.equal(a.m.pane().querySelectorAll('[data-eup-policy-chip="enabled"]').length, 0, 'nothing is reported enabled from memory or from the overview');
  assert.equal(a.m.pane().querySelectorAll('[data-eup-policy-chip="unknown"]').length, 3, 'each governed module row reads unknown');
  assert.match(a.m.pane().textContent, /Module policy: Unavailable \(503 storage_unavailable\)/); assert.match(a.m.status().textContent, /State is unknown and no command is offered/);
  a.w.s.readError = null;
  a.m.pane().querySelector('[data-eup-policy-reload]').click(); await settleAll();
  assert.equal(unitState(a.m, 'league'), 'enabled'); assert.match(a.m.status().textContent, /Module policy read .* No changes were made\./);

  const b = await opened({ hooks: { read: () => Promise.reject(http(503, 'schema_not_applied')) } });
  assert.match(b.m.pane().textContent, /Module policy schema is not applied\. No module is installed and none is reported enabled/);
  assert.equal(b.m.pane().querySelectorAll('[data-eup-policy-command]').length, 0);
  assert.ok(notes(b.m.pane()).includes('not_configured'));

  const b2 = await opened({ hooks: { read: () => Promise.resolve({ ok: false, reason: 'schema_not_applied', error: 'Module policy schema is not applied' }) } });
  assert.match(b2.m.pane().textContent, /Module policy schema is not applied\. No module is installed/, 'an ok:false body is read by its reason');

  for (const bad of [(r) => ({ ...r, modules: r.modules.slice(0, 2) }), (r) => ({ ...r, modules: r.modules.concat(r.modules[0]) }), (r) => ({ ...r, ok: undefined }), (r) => ({ ...r, modules: null }), () => null]) {
    const c = await opened({ start: { league: { state: 'enabled', revision: 1 } }, hooks: { read: (read) => Promise.resolve(bad(read())) } });
    assert.equal(c.m.pane().querySelectorAll('[data-eup-policy-command]').length, 0, 'an answer without exactly the three units is not used');
    assert.match(c.m.pane().textContent, /The module policy answer was not readable/);
  }
  const d = await opened({ hooks: { read: (read) => Promise.resolve({ ...read(), modules: read().modules.map((x) => x.moduleId === 'intake' ? { ...x, installed: true, state: 'enabled' } : x) }) } });
  assert.equal(unitState(d.m, 'intake'), 'unknown'); assert.deepEqual(commandsOf(d.m, 'intake'), [], 'an installed row without a revision offers nothing');
  assert.deepEqual(commandsOf(d.m, 'league'), ['install'], 'the readable units keep their commands');
  assert.match(unit(d.m, 'intake').textContent, /could not be read; no command is offered/);
});

test('policy: while the owner read is on its way the module rows show the overview\'s own policy read, and offer nothing', async () => {
  let give;
  const overview = { ...OVERVIEW_P, modules: OVERVIEW_P.modules.map((x) => x.id === 'league' ? { ...x, policy: { installed: true, state: 'draining', revision: 5, updated_at: '2026-11-09T10:00:00Z' } } : x.id === 'civic' ? { ...x, policy: { installed: false, state: null, revision: null, updated_at: null } } : x) };
  const { m } = await opened({ overview, start: { league: { state: 'enabled', revision: 6 } }, hooks: { read: (read) => new Promise((r) => { give = () => r(read()); }) } });
  assert.match(m.pane().querySelector('[data-eup-module="league"]').textContent, /policy: draining\s+rev 5 · unit league/);
  assert.match(m.pane().querySelector('[data-eup-module="civic"]').textContent, /policy: not installed\s+unit intake/);
  assert.match(m.pane().querySelector('[data-eup-module="consumer_environment"]').textContent, /policy: unknown/);
  assert.equal(m.pane().querySelectorAll('[data-eup-policy-command]').length, 0); assert.match(m.pane().textContent, /Reading module policy…/);
  assert.equal(m.pane().querySelector('[data-eup-policy-reload]').attrs['aria-disabled'], 'true');
  give(); await settleAll();
  assert.match(m.pane().querySelector('[data-eup-module="league"]').textContent, /policy: enabled\s+rev 6 · unit league/, 'the owner read replaces it');
  assert.deepEqual(commandsOf(m, 'league'), ['draining']);
});

test('policy: when the overview cannot be read the controls still appear if the policy was read; if neither was, one line says so', async () => {
  const a = await opened({ overview: http(503, 'storage_unavailable'), start: { league: { state: 'enabled', revision: 2 } } });
  assert.deepEqual(notes(a.m.pane()), ['unavailable']);
  assert.match(a.m.pane().textContent, /The overview was not read, so release posture is not shown/);
  assert.deepEqual(commandsOf(a.m, 'league'), ['draining']); assert.equal(a.m.pane().querySelectorAll('[data-eup-posture]').length, 0);
  await send(a.m, 'league', 'draining', 'drain during the incident');
  assert.equal(unitState(a.m, 'league'), 'draining', 'a drain does not depend on the overview read');
  const b = await opened({ overview: http(503, 'storage_unavailable'), hooks: { read: () => Promise.reject(http(503, 'storage_unavailable')) } });
  assert.deepEqual(notes(b.m.pane()), ['unavailable']);
  assert.equal(b.m.pane().querySelectorAll('[data-eup-policy-command]').length, 0);
  assert.match(b.m.pane().querySelector('[data-eup-policy-unread]').textContent, /Module policy: Unavailable \(503 storage_unavailable\).* Select Overview again to read both again\./);
  const c = await opened({ overview: { ok: true, modules: 'nope' } });
  assert.deepEqual(commandsOf(c.m, 'league'), ['install'], 'an overview without module rows still gets the controls');
  const d = await opened({ overview: { modules: [] } });
  assert.deepEqual(notes(d.m.pane()).slice(0, 1), ['error']); assert.deepEqual(commandsOf(d.m, 'league'), ['install']);
});

test('policy: a reason being typed survives a redraw, per unit; only the newest policy read is committed', async () => {
  const gives = [];
  const { w, m } = await opened({ start: { league: { state: 'disabled', revision: 1 } } });
  const input = m.pane().querySelector('[data-eup-policy-reason="league"]'); input.value = 'half typed'; input.oninput();
  w.s.hooks.read = (read) => new Promise((r) => { const snapshot = read(); gives.push(() => r(snapshot)); });
  m.pane().querySelector('[data-eup-policy-reload]').click(); await flush();
  m.pane().querySelector('[data-eup-policy-reload]').click(); await flush();
  assert.equal(gives.length, 1, 'a reload already in flight is not doubled by its own button');
  assert.equal(m.pane().querySelector('[data-eup-policy-reason="league"]').value, 'half typed', 'the redraw kept what was typed');
  assert.equal(m.pane().querySelector('[data-eup-policy-reason="intake"]').value, '', 'and only for that unit');
  assert.equal(m.pane().querySelector('[data-eup-policy-command="league:enabled"]').attrs['aria-disabled'], 'true');
  m.pane().querySelector('[data-eup-policy-command="league:enabled"]').click(); await flush();
  assert.equal(w.posts().length, 0, 'no command is sent while the policy is being read');
  /* the state moves, then a second read starts (the Overview tab is chosen again) and answers FIRST */
  w.s.rows.league.state = 'enabled'; w.s.rows.league.revision = 2;
  m.tab('overview').click(); await settleAll();
  assert.equal(gives.length, 2, 'a second policy read is in flight');
  gives[1](); await settleAll();
  assert.equal(unitState(m, 'league'), 'enabled'); assert.ok(m.pane().querySelector('[data-eup-policy-rev="league:2"]'));
  gives[0](); await settleAll();
  assert.equal(unitState(m, 'league'), 'enabled', 'the older answer, arriving last, does not replace the newer one');
  assert.ok(m.pane().querySelector('[data-eup-policy-rev="league:2"]')); assert.deepEqual(commandsOf(m, 'league'), ['draining']);
  assert.equal(H.model().policy.loading, false);
  assert.equal(m.pane().querySelector('[data-eup-policy-reason="league"]').value, 'half typed', 'still there after both reads');
});

test('policy: a button from an earlier draw cannot send a command its unit no longer offers, and focus stays in the unit when its button changes', async () => {
  let fail = false, giveRead = null;
  const { w, m } = await opened({ start: { league: { state: 'disabled', revision: 0 } }, hooks: { post: () => fail ? Promise.reject(http(503, 'storage_unavailable')) : undefined } });
  const staleEnable = m.pane().querySelector('[data-eup-policy-command="league:enabled"]');
  staleEnable.focus();
  await send(m, 'league', 'enabled', 'open');
  assert.equal(unitState(m, 'league'), 'enabled');
  assert.equal(document.activeElement.attrs['data-eup-policy'], 'league', 'Enable became Drain: focus moved to the unit, not to nothing');
  m.pane().querySelector('[data-eup-policy-reason="league"]').value = 'again';
  staleEnable.click(); await settleAll();
  assert.equal(w.posts().length, 1, 'Enable is not a command of an enabled unit, whatever was clicked');
  /* a resend button kept from an earlier draw sends nothing once its offer is gone */
  fail = true;
  await send(m, 'league', 'draining', 'drain');
  const staleResend = resendFor(m, 'league'); assert.ok(staleResend);
  w.s.hooks.read = (read) => new Promise((r) => { giveRead = () => r(read()); });
  staleResend.click(); await settleAll();
  assert.equal(w.posts().length, 3, 'the offered resend was sent once'); assert.equal(resendFor(m, 'league'), null, 'and is not offered while its read-back is on its way');
  staleResend.click(); await settleAll();
  assert.equal(w.posts().length, 3, 'a second press of the old button sends nothing');
  giveRead(); await settleAll();
  assert.ok(resendFor(m, 'league'));
  /* the offer ends with a settled refusal: the stored command stays in memory but cannot be sent again */
  w.s.hooks.read = undefined; w.s.hooks.post = () => Promise.reject(http(409, 'revision_conflict'));
  const lastOffer = resendFor(m, 'league'); lastOffer.click(); await settleAll();
  assert.equal(w.posts().length, 4); assert.deepEqual(outcomes(m), ['league:conflict']); assert.equal(resendFor(m, 'league'), null);
  assert.equal(H.model().policy.loading, false);
  lastOffer.click(); await settleAll();
  assert.equal(w.posts().length, 4, 'a withdrawn offer sends nothing');
});

test('policy: a policy read that answers after the workspace left the page commits nothing', async () => {
  let give;
  const { m } = await opened({ start: { league: { state: 'enabled', revision: 2 } }, hooks: { read: (read) => new Promise((r) => { give = () => r(read()); }) } });
  m.host.isConnected = false;
  give(); await settleAll();
  assert.equal(H.model().policy.control, null); assert.equal(m.pane().querySelectorAll('[data-eup-policy]').length, 0);
});
