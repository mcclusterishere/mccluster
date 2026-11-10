/* Audit A1 (2026-11-09): default Control's load() is fenced by one authority
   generation (principal + selected workspace); account loss conceals private
   state synchronously and a late private read cannot repopulate it. The exact
   source block is executed with synthetic reads.

   The whole page (every per-view loader, request()/supa(), init() and the
   reload) is exercised by control-room-authority.test.mjs.

   AUTH_TEST_SOURCE_ROOT=<checkout> runs these against another copy of the
   file. The harness tolerates an older file that lacks the lifecycle
   functions, so its cases fail on their assertions, not on setup. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.env.AUTH_TEST_SOURCE_ROOT || new URL('../../', import.meta.url).pathname;
const control = readFileSync(join(ROOT, 'js/control-room-v2.js'), 'utf8');
const start = control.indexOf('  /* CONTROL AUTHORITY GENERATION');
const block = control.slice(start >= 0 ? start : control.indexOf('  function load(force)'), control.indexOf('  function boot()', control.indexOf('  function load(force)')));
/* The page's own initial `state` literal, so the harness starts where the page does. */
const literalAt = control.indexOf('  var state = {');
const freshState = () => literalAt >= 0
  ? vm.runInNewContext('(' + control.slice(control.indexOf('{', literalAt), control.indexOf('\n  };', literalAt) + 4) + ')')
  : { loading: false, selectedAiThreadId: null, aiChatDraft: '', health: null, threads: [] };
const flush = () => new Promise(r => setImmediate(r));
const jwt = sub => 'h.' + Buffer.from(JSON.stringify({ sub })).toString('base64url') + '.s';

function harness({ principal = 'owner-a' } = {}) {
  const storage = new Map(); const listeners = new Map();
  if (principal) storage.set('mccdb_session', JSON.stringify({ access_token: jwt(principal), refresh_token: 'r' }));
  let localToken = principal ? jwt(principal) : null, releaseStatus = null, rendered = 0, aborted = 0;
  const st = Object.assign(freshState(), { aiChatDraft: 'unsent words' });
  const dataOf = x => x?.data || null, rowsOf = x => Array.isArray(dataOf(x)) ? dataOf(x) : [];
  const nodes = { crPaletteResults: { innerHTML: 'old-results' }, crInspectorBody: { innerHTML: 'old-inspector' }, crPalette: { classList: { remove() {} }, setAttribute() {} }, crApp: { hidden: false }, cpGate: { hidden: true } };
  const c = {
    state: st, Promise, Date, Error, Object, String, Number, Array, JSON, Buffer, encodeURIComponent, decodeURIComponent, atob: s => Buffer.from(s, 'base64').toString('binary'),
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { aborted++; this.signal.aborted = true; } },
    API: 'https://fixture.invalid', LEAD_PAGE: 100, render() { rendered++; }, token: async () => localToken,
    window: { localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null }, addEventListener: (k, fn) => listeners.set(k, fn) },
    location: { search: '', reload() {} }, URLSearchParams, setTimeout, clearTimeout,
    $: id => nodes[id] || null,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    src: async p => { try { return { ok: true, data: await p }; } catch (e) { return { ok: false, message: e.message }; } },
    loadPublicRecord: async () => ({ ok: true, data: {} }),
    discoverWorkspace: async () => ({ org: { id: 'owner-org' }, membership: { role: 'owner' }, source: { ok: true } }),
    request: async path => path === '/v1/status' ? new Promise(resolve => { releaseStatus = resolve; }) : path.startsWith('/v1/comms/threads') ? { threads: [{ id: 'private-conversation', body: 'synthetic-private-content' }] } : {},
    coreMcp: async () => ({}), callCoreTool: async () => ({}), supa: async () => [], leadQueryPath: () => '', loadCreative: async () => ({}), badResult: () => ({ ok: false }), dataOf, rowsOf,
    pickRows: (source, key) => dataOf(source)?.[key] || [], renderWorkspaceSwitcher() {}, loadRecentErrors() {}, okResult: data => ({ ok: true, data }), aiThreadById: () => null,
    preferredOrgId: () => storage.get('mcc.control.org') || null,
    /* The shell helpers the block calls; the page defines them outside it. */
    STATE_TEMPLATE: JSON.stringify(freshState()), leadSearchTimer: null, transcriptInflight: {},
    stopAiVoiceListening() {}, stopAiVoiceSpeech() {}, closeInspector() {}, closeMore() {}, note() {}
  };
  vm.createContext(c); vm.runInContext(block, c);
  if (typeof c.bindAuthorityLifecycle === 'function') c.bindAuthorityLifecycle();
  return {
    c, st, storage, nodes, listeners, rendered: () => rendered, aborted: () => aborted,
    /* A lifecycle event, delivered only if the file under test listens for it. */
    fire(type, event) { const fn = listeners.get(type); if (fn) fn(event); },
    setToken(v) { localToken = v; if (v) storage.set('mccdb_session', JSON.stringify({ access_token: v, refresh_token: 'r' })); else storage.delete('mccdb_session'); },
    /* Returns the load promise wrapped, so awaiting startLoad does not adopt (and wait for) the load itself. */
    async startLoad() { const p = c.load(); while (!releaseStatus) await flush(); return { loading: p }; },
    releaseStatus: v => releaseStatus(v)
  };
}
const statusBody = { operator: { email: 'synthetic-owner@example.invalid' } };

test('a pending private load is discarded after the token is removed mid-flight', async () => {
  const h = harness(); const { loading } = await h.startLoad();
  h.setToken(null); h.fire('mcc:auth-changed', { detail: { signed_in: false } });
  h.releaseStatus(statusBody); await loading;
  assert.equal(h.st.threads.length, 0); assert.equal(h.st.workspace, null); assert.equal(h.st.org, null);
  assert.equal(h.nodes.crApp.hidden, true); assert.equal(h.nodes.cpGate.hidden, false);
  /* Corrected 2026-11-10 (A1 close-out): this asserted that the unsent draft
     survived sign-out, which is how A's words reached the next account's
     composer. A draft belongs to the account that typed it. */
  assert.equal(h.st.aiChatDraft, '');
});
test('a pending private load is discarded when another account replaces the session', async () => {
  const h = harness(); const { loading } = await h.startLoad();
  h.setToken(jwt('member-b')); h.fire('storage', { key: 'mccdb_session' });
  assert.equal(h.st.threads.length, 0); assert.equal(h.nodes.crPaletteResults.innerHTML, ''); assert.equal(h.nodes.crInspectorBody.innerHTML, '');
  h.releaseStatus(statusBody); await loading;
  assert.equal(h.st.threads.length, 0); assert.equal(h.st.workspace, null); assert.match(h.st.error, /changed/);
});
test('account change conceals private state synchronously and aborts pending reads', async () => {
  const h = harness(); await h.startLoad();
  h.st.threads = [{ id: 'private-conversation' }]; h.st.jobs = [{ id: 'job' }]; h.st.leads = [{ id: 'lead' }]; h.st.inspector = { title: 'x' }; h.st.workspace = { role: 'owner' };
  const changed = typeof h.c.reconcileAuthority === 'function' ? h.c.reconcileAuthority({ signed_in: false }) : false; h.setToken(null);
  assert.equal(changed, true); assert.equal(h.st.threads.length, 0); assert.equal(h.st.jobs.length, 0); assert.equal(h.st.leads.length, 0);
  assert.equal(h.st.inspector, null); assert.equal(h.st.workspace, null); assert.equal(h.aborted(), 1);
});
test('a same-account token refresh keeps the generation and commits the load', async () => {
  const h = harness(); const { loading } = await h.startLoad();
  const before = h.c.authority?.gen; h.setToken(jwt('owner-a') + 'x'); h.fire('mcc:auth-changed', { detail: { signed_in: true } });
  assert.equal(h.c.authority?.gen, before);
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
/* Close-out 2026-11-10: the discard of a stale load was generation-agnostic,
   so a load of the old account that settled late wiped what had been
   committed since and aborted the newer load's reads. */
test('a stale load settling after the account changed touches nothing a newer generation owns', async () => {
  const h = harness(); const { loading } = await h.startLoad();
  h.setToken(null); h.fire('mcc:auth-changed', { detail: { signed_in: false } });
  /* What a newer load of the new generation has done by now: started (its
     own controller and sequence number) and committed its rows. */
  const newer = new h.c.AbortController();
  Object.assign(h.st, { threads: [{ id: 'newer-thread' }], org: { id: 'newer-org' }, loading: true, error: null });
  if (h.c.authority) { h.c.authority.abort = newer; h.c.authority.seq = (h.c.authority.seq || 0) + 1; }
  const abortsBefore = h.aborted();
  h.releaseStatus(statusBody); await loading;
  assert.deepEqual(h.st.threads, [{ id: 'newer-thread' }]); assert.deepEqual(h.st.org, { id: 'newer-org' });
  assert.equal(h.st.loading, true, 'the newer load is still the one loading'); assert.equal(h.st.error, null);
  assert.equal(h.aborted(), abortsBefore, "the stale load aborted nobody else's reads"); assert.equal(newer.signal.aborted, false);
});
/* Close-out 2026-11-10: discoverWorkspace() wrote state.workspaces before the
   commit boundary, so a discarded load could still leave its account's
   workspace list behind. It answers; load() commits. */
test('discovering the workspace writes nothing to state before the commit boundary', () => {
  const at = control.indexOf('  function discoverWorkspace(');
  assert.ok(at >= 0, 'discoverWorkspace is defined');
  const body = control.slice(at, control.indexOf('\n  }\n', at));
  assert.doesNotMatch(body, /\bstate\.[A-Za-z_$][\w$]*\s*=[^=]/, 'discoverWorkspace assigns to state');
  assert.match(block, /state\.workspaces = \(a\.workspace && a\.workspace\.workspaces\) \|\| \[\];/, 'load() commits the list at its boundary');
});
