/* Audit A2/A5 (2026-11-09): the shared bar's cross-origin handoff arrival and
   its dynamic auth-script loader, executed from the exact source text. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.env.AUTH_TEST_SOURCE_ROOT || new URL('../../', import.meta.url).pathname;
const tabbar = readFileSync(join(ROOT, 'js/tabbar.js'), 'utf8');
const arrival = tabbar.slice(tabbar.indexOf('  function arriveWithHandoff()'), tabbar.indexOf("  /* ON THE WORLD", tabbar.indexOf('  function arriveWithHandoff()')));
const loader = tabbar.slice(tabbar.indexOf('  function loadCanonicalAuth()'), tabbar.indexOf('  function refreshAuthState()', tabbar.indexOf('  function loadCanonicalAuth()')));
const flush = () => new Promise(r => setImmediate(r));
const jsonReply = body => ({ ok: true, json: async () => body });
const verified = { access_token: 'fixture-old-handoff-account', refresh_token: 'fixture-old-refresh', expires_in: 3600 };

function arrivalContext({ hash = '#mcc_handoff=fixture-a', fetchImpl, stored = new Map() } = {}) {
  const events = []; let reloads = 0;
  const context = {
    location: { hash, pathname: '/index.html', search: '', reload() { reloads++; } }, history: { replaceState() {} },
    decodeURIComponent, JSON, Math, Date, Promise, Error, Object, Number, String, setTimeout, clearTimeout,
    readAuthSession: () => { try { return JSON.parse(stored.get('mccdb_session') || 'null'); } catch (e) { return null; } },
    localStorage: { getItem: k => stored.has(k) ? stored.get(k) : null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) },
    emit: (name, detail, cancelable) => { events.push({ name, detail }); return false; },
    API_ORIGIN: 'https://api.fixture.invalid', SB_URL: 'https://supabase.fixture.invalid', SB_KEY: 'public-fixture', fetch: fetchImpl
  };
  vm.createContext(context); vm.runInContext(arrival, context);
  return { context, stored, events, reloads: () => reloads };
}
function twoStepFetch() {
  let release, fetches = 0;
  const fetchImpl = async () => { fetches++; if (fetches === 1) return jsonReply({ token_hash: 'fixture-hash' }); return new Promise(resolve => { release = resolve; }); };
  return { fetchImpl, release: v => release(v), ready: async () => { while (!release) await flush(); }, fetches: () => fetches };
}

test('a late handoff verification cannot overwrite a newer account stored meanwhile', async () => {
  const net = twoStepFetch(); const h = arrivalContext({ fetchImpl: net.fetchImpl });
  const arriving = h.context.arriveWithHandoff(); await net.ready();
  const newer = JSON.stringify({ access_token: 'fixture-newer-account', refresh_token: 'fixture-newer-refresh' });
  h.stored.set('mccdb_session', newer); h.stored.set('mcc_sess_keep', newer);
  net.release(jsonReply(verified)); assert.equal(await arriving, false);
  assert.equal(JSON.parse(h.stored.get('mccdb_session')).access_token, 'fixture-newer-account');
  assert.equal(JSON.parse(h.stored.get('mcc_sess_keep')).access_token, 'fixture-newer-account');
  assert.equal(h.reloads(), 0);
  assert.equal(JSON.stringify(h.events.at(-1)), JSON.stringify({ name: 'mcc:handoff', detail: { ok: false, reason: 'account_changed' } }));
});
test('a sign-out of a replaceable stored session during the wait also refuses the commit', async () => {
  const expired = JSON.stringify({ access_token: 'fixture-expired', refresh_token: '', expires_at: 1 });
  const net = twoStepFetch(); const h = arrivalContext({ fetchImpl: net.fetchImpl, stored: new Map([['mccdb_session', expired], ['mcc_sess_keep', expired]]) });
  const arriving = h.context.arriveWithHandoff(); await net.ready();
  h.stored.delete('mccdb_session'); h.stored.delete('mcc_sess_keep');
  net.release(jsonReply(verified)); assert.equal(await arriving, false);
  assert.equal(h.stored.has('mccdb_session'), false);
});
test('an undisturbed handoff still commits both slots and reloads', async () => {
  const net = twoStepFetch(); const h = arrivalContext({ fetchImpl: net.fetchImpl });
  const arriving = h.context.arriveWithHandoff(); await net.ready(); net.release(jsonReply(verified));
  assert.equal(await arriving, true);
  assert.equal(JSON.parse(h.stored.get('mccdb_session')).access_token, 'fixture-old-handoff-account');
  assert.equal(JSON.parse(h.stored.get('mcc_sess_keep')).access_token, 'fixture-old-handoff-account');
  assert.equal(h.reloads(), 1);
});
test('a valid pre-existing destination account is never replaced and no request is sent', async () => {
  let fetches = 0; const valid = JSON.stringify({ access_token: 'fixture-valid', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  const h = arrivalContext({ fetchImpl: async () => { fetches++; return jsonReply({}); }, stored: new Map([['mccdb_session', valid]]) });
  assert.equal(await h.context.arriveWithHandoff(), false); assert.equal(fetches, 0);
  assert.equal(JSON.parse(h.stored.get('mccdb_session')).access_token, 'fixture-valid');
});
test('an expired stored session with no refresh token may be replaced by the handoff', async () => {
  const expired = JSON.stringify({ access_token: 'fixture-expired', refresh_token: '', expires_at: 1 });
  const net = twoStepFetch(); const h = arrivalContext({ fetchImpl: net.fetchImpl, stored: new Map([['mccdb_session', expired], ['mcc_sess_keep', expired]]) });
  const arriving = h.context.arriveWithHandoff(); await net.ready(); net.release(jsonReply(verified));
  assert.equal(await arriving, true); assert.equal(JSON.parse(h.stored.get('mccdb_session')).access_token, 'fixture-old-handoff-account');
});
test('storage failure on the second slot rolls the first back and reports a failed handoff', async () => {
  const net = twoStepFetch(); const h = arrivalContext({ fetchImpl: net.fetchImpl });
  const setItem = h.context.localStorage.setItem;
  h.context.localStorage.setItem = (k, v) => { if (k === 'mcc_sess_keep') throw new Error('quota'); return setItem(k, v); };
  const arriving = h.context.arriveWithHandoff(); await net.ready(); net.release(jsonReply(verified));
  assert.equal(await arriving, false); assert.equal(h.stored.has('mccdb_session'), false);
  assert.equal(JSON.stringify(h.events.at(-1)), JSON.stringify({ name: 'mcc:handoff', detail: { ok: false, reason: 'storage' } }));
});
test('a malformed percent-encoded fragment finishes the handoff lifecycle without throwing', async () => {
  const h = arrivalContext({ hash: '#mcc_handoff=%E0%A4%A', fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(await h.context.arriveWithHandoff(), false);
  assert.equal(JSON.stringify(h.events), JSON.stringify([{ name: 'mcc:handoff', detail: { ok: false, reason: 'malformed' } }]));
});
test('a stalled verification body read is bounded by the handoff deadline', async () => {
  const h = arrivalContext({ fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
  h.context.HANDOFF_DEADLINE_MS = 20;
  assert.equal(await h.context.arriveWithHandoff(), false);
  assert.equal(JSON.stringify(h.events.at(-1)), JSON.stringify({ name: 'mcc:handoff', detail: { ok: false, reason: 'timeout' } }));
});

function loaderContext(behaviour) {
  let script = null, appends = 0, removed = 0;
  const lc = { window: {}, Promise, Error, ROOT: 'https://fixture.invalid/', setTimeout, clearTimeout,
    document: { querySelector: () => script, createElement: () => ({ setAttribute() {}, parentNode: null }),
      head: { appendChild(s) { script = s; appends++; s.parentNode = { removeChild() { removed++; script = null; } }; queueMicrotask(() => behaviour(s, lc)); } } } };
  vm.createContext(lc); vm.runInContext(loader, lc);
  return { lc, appends: () => appends, removed: () => removed };
}
test('a failed auth script is removed and the next check appends a fresh one', async () => {
  let calls = 0;
  const h = loaderContext((s, lc) => { calls++; if (calls === 1) s.onerror(new Error('fixture network failure')); else { lc.window.MCC = { user() {} }; s.onload(); } });
  await assert.rejects(h.lc.loadCanonicalAuth(), /network failure/);
  assert.equal(h.removed(), 1);
  const retry = await Promise.race([h.lc.loadCanonicalAuth().then(() => 'loaded', () => 'rejected'), new Promise(r => setTimeout(() => r('still-pending'), 100))]);
  assert.equal(retry, 'loaded'); assert.equal(h.appends(), 2);
});
test('concurrent checks share one attempt and a loader deadline settles a silent script', async () => {
  const h = loaderContext(() => {}); h.lc.AUTH_LOADER_DEADLINE_MS = 20;
  const a = h.lc.loadCanonicalAuth(), b = h.lc.loadCanonicalAuth(); assert.equal(a, b);
  await assert.rejects(a, /timed out/); assert.equal(h.appends(), 1); assert.equal(h.removed(), 1);
});
test('a script that loads without exporting MCC is a failure, and attempts are bounded', async () => {
  const h = loaderContext(s => s.onload()); h.lc.AUTH_LOADER_MAX_ATTEMPTS = 2;
  await assert.rejects(h.lc.loadCanonicalAuth(), /no MCC/); await assert.rejects(h.lc.loadCanonicalAuth(), /no MCC/);
  await assert.rejects(h.lc.loadCanonicalAuth(), /gave up/); assert.equal(h.appends(), 2);
});
test('an already valid window.MCC short-circuits the loader', async () => {
  const h = loaderContext(() => { throw new Error('must not append'); }); h.lc.window.MCC = { user() {} };
  assert.equal(await h.lc.loadCanonicalAuth(), h.lc.window.MCC); assert.equal(h.appends(), 0);
});
