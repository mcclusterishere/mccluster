/* Audit A1 (2026-11-09): default Control's load() is fenced by one authority
   generation (principal + selected workspace); account loss conceals private
   state synchronously and a late private read cannot repopulate it. The exact
   source block is executed with synthetic reads. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.env.AUTH_TEST_SOURCE_ROOT || new URL('../../', import.meta.url).pathname;
const control = readFileSync(join(ROOT, 'js/control-room-v2.js'), 'utf8');
const start = control.indexOf('  /* CONTROL AUTHORITY GENERATION');
const block = control.slice(start >= 0 ? start : control.indexOf('  function load(force)'), control.indexOf('  function boot()', control.indexOf('  function load(force)')));
const flush = () => new Promise(r => setImmediate(r));
const jwt = sub => 'h.' + Buffer.from(JSON.stringify({ sub })).toString('base64url') + '.s';

function harness({ principal = 'owner-a' } = {}) {
  const storage = new Map(); const listeners = new Map();
  if (principal) storage.set('mccdb_session', JSON.stringify({ access_token: jwt(principal), refresh_token: 'r' }));
  let localToken = principal ? jwt(principal) : null, releaseStatus = null, rendered = 0, aborted = 0;
  const st = { loading: false, selectedAiThreadId: null, aiChatDraft: 'unsent words', health: null };
  const dataOf = x => x?.data || null, rowsOf = x => Array.isArray(dataOf(x)) ? dataOf(x) : [];
  const nodes = { crPaletteResults: { innerHTML: 'old-results' }, crInspectorBody: { innerHTML: 'old-inspector' }, crPalette: { classList: { remove() {} }, setAttribute() {} }, crApp: { hidden: false }, cpGate: { hidden: true } };
  const c = {
    state: st, Promise, Date, Error, Object, String, Number, Array, JSON, Buffer, encodeURIComponent, decodeURIComponent, atob: s => Buffer.from(s, 'base64').toString('binary'),
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { aborted++; this.signal.aborted = true; } },
    API: 'https://fixture.invalid', LEAD_PAGE: 100, render() { rendered++; }, token: async () => localToken,
    window: { localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null }, addEventListener: (k, fn) => listeners.set(k, fn) },
    location: { search: '' }, URLSearchParams,
    $: id => nodes[id] || null,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    src: async p => { try { return { ok: true, data: await p }; } catch (e) { return { ok: false, message: e.message }; } },
    loadPublicRecord: async () => ({ ok: true, data: {} }),
    discoverWorkspace: async () => ({ org: { id: 'owner-org' }, membership: { role: 'owner' }, source: { ok: true } }),
    request: async path => path === '/v1/status' ? new Promise(resolve => { releaseStatus = resolve; }) : path.startsWith('/v1/comms/threads') ? { threads: [{ id: 'private-conversation', body: 'synthetic-private-content' }] } : {},
    coreMcp: async () => ({}), callCoreTool: async () => ({}), supa: async () => [], leadQueryPath: () => '', loadCreative: async () => ({}), badResult: () => ({ ok: false }), dataOf, rowsOf,
    pickRows: (source, key) => dataOf(source)?.[key] || [], renderWorkspaceSwitcher() {}, loadRecentErrors() {}, okResult: data => ({ ok: true, data }), aiThreadById: () => null,
    preferredOrgId: () => storage.get('mcc.control.org') || null
  };
  vm.createContext(c); vm.runInContext(block, c);
  c.bindAuthorityLifecycle();
  return {
    c, st, storage, nodes, listeners, rendered: () => rendered, aborted: () => aborted,
    setToken(v) { localToken = v; if (v) storage.set('mccdb_session', JSON.stringify({ access_token: v, refresh_token: 'r' })); else storage.delete('mccdb_session'); },
    /* Returns the load promise wrapped, so awaiting startLoad does not adopt (and wait for) the load itself. */
    async startLoad() { const p = c.load(); while (!releaseStatus) await flush(); return { loading: p }; },
    releaseStatus: v => releaseStatus(v)
  };
}
const statusBody = { operator: { email: 'synthetic-owner@example.invalid' } };

test('a pending private load is discarded after the token is removed mid-flight', async () => {
  const h = harness(); const { loading } = await h.startLoad();
  h.setToken(null); h.listeners.get('mcc:auth-changed')({ detail: { signed_in: false } });
  h.releaseStatus(statusBody); await loading;
  assert.equal(h.st.threads.length, 0); assert.equal(h.st.workspace, null); assert.equal(h.st.org, null);
  assert.equal(h.nodes.crApp.hidden, true); assert.equal(h.nodes.cpGate.hidden, false);
  assert.equal(h.st.aiChatDraft, 'unsent words');
});
test('a pending private load is discarded when another account replaces the session', async () => {
  const h = harness(); const { loading } = await h.startLoad();
  h.setToken(jwt('member-b')); h.listeners.get('storage')({ key: 'mccdb_session' });
  assert.equal(h.st.threads.length, 0); assert.equal(h.nodes.crPaletteResults.innerHTML, ''); assert.equal(h.nodes.crInspectorBody.innerHTML, '');
  h.releaseStatus(statusBody); await loading;
  assert.equal(h.st.threads.length, 0); assert.equal(h.st.workspace, null); assert.match(h.st.error, /changed/);
});
test('account change conceals private state synchronously and aborts pending reads', async () => {
  const h = harness(); await h.startLoad();
  h.st.threads = [{ id: 'private-conversation' }]; h.st.jobs = [{ id: 'job' }]; h.st.leads = [{ id: 'lead' }]; h.st.inspector = { title: 'x' }; h.st.workspace = { role: 'owner' };
  const changed = h.c.reconcileAuthority({ signed_in: false }); h.setToken(null);
  assert.equal(changed, true); assert.equal(h.st.threads.length, 0); assert.equal(h.st.jobs.length, 0); assert.equal(h.st.leads.length, 0);
  assert.equal(h.st.inspector, null); assert.equal(h.st.workspace, null); assert.equal(h.aborted(), 1);
});
test('a same-account token refresh keeps the generation and commits the load', async () => {
  const h = harness(); const { loading } = await h.startLoad();
  const before = h.c.authority.gen; h.setToken(jwt('owner-a') + 'x'); h.listeners.get('mcc:auth-changed')({ detail: { signed_in: true } });
  assert.equal(h.c.authority.gen, before);
  h.releaseStatus(statusBody); await loading;
  assert.equal(h.st.threads[0].id, 'private-conversation'); assert.equal(h.st.workspace.role, 'owner'); assert.equal(h.st.aiChatDraft, 'unsent words');
});
test('a selected-workspace change while a read is pending discards the result', async () => {
  const h = harness(); const { loading } = await h.startLoad();
  h.storage.set('mcc.control.org', 'other-tenant');
  h.releaseStatus(statusBody); await loading;
  assert.equal(h.st.threads.length, 0); assert.equal(h.st.org, null); assert.match(h.st.error, /workspace changed/);
});
test('an undisturbed load commits the private results', async () => {
  const h = harness(); const { loading } = await h.startLoad(); h.releaseStatus(statusBody); await loading;
  assert.equal(h.st.threads[0].id, 'private-conversation'); assert.equal(h.st.workspace.role, 'owner'); assert.equal(h.st.loading, false);
});
