/* Codex audit 2026-11-02 (C): a second M Account on a shared device inherited the
   first account's local course passes. The local cache now records its owner. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load() {
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const window = {};
  const ctx = { window, localStorage, sessionStorage: localStorage, document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] }, location: { reload() {} }, setTimeout, console };
  vm.runInNewContext(readFileSync(new URL('../../js/prim3-sync.js', import.meta.url), 'utf8'), ctx);
  return { api: window.PRIM3_SYNC_TEST, store };
}

test('a different account on the same device starts from a clean local cache', () => {
  const { api } = load();
  api.writeState({ read: ['M01'], passed: ['M01'], scores: { M01: 90 } });
  assert.equal(api.claimCacheFor('user-a'), false, 'the first account adopts what was studied before sign-in');
  assert.equal(JSON.stringify(api.localState().passed), '["M01"]');
  assert.equal(api.claimCacheFor('user-a'), false);
  assert.equal(api.claimCacheFor('user-b'), true, 'B does not inherit A');
  assert.equal(JSON.stringify(api.localState()), '{"read":[],"passed":[],"scores":{}}');
  assert.equal(api.claimCacheFor(null), false);
});
