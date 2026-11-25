import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOwner, guardPage, storedToken, SESSION_KEY, API_ORIGIN, loadList } from '../../js/owner-only.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const turn = () => new Promise((resolve) => setImmediate(resolve));
function storage(token = 'owner-token') {
  let raw = token ? JSON.stringify({ access_token: token }) : null;
  return { getItem: () => raw, setToken: (value) => { raw = value ? JSON.stringify({ access_token: value }) : null; } };
}
function page() {
  const doc = new EventTarget(), win = new EventTarget();
  const stats = { mounted: 0, removed: 0, reloads: 0, opened: 0 };
  const msg = { innerHTML: '' };
  const gate = { dataset: { ownerTemplate: 'appTpl', ownerLoad: '' }, querySelector: () => msg,
    remove: () => { stats.removed++; } };
  doc.documentElement = { dataset: {}, style: { display: '' }, inert: false };
  doc.visibilityState = 'visible';
  doc.baseURI = 'https://example.test/prim3-transit.html';
  doc.getElementById = () => ({ content: { cloneNode: () => ({}) }, replaceWith: () => { stats.mounted++; } });
  win.location = { reload: () => { stats.reloads++; } };
  win.addEventListener('mcc:owner-open', () => { stats.opened++; });
  return { doc, win, gate, msg, stats };
}
function emit(target, type, props = {}) {
  const event = new Event(type);
  Object.assign(event, props);
  target.dispatchEvent(event);
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve('hung'), 150); })]); }
  finally { clearTimeout(timer); }
}

test('stored tokens fail closed on absent, malformed, empty or blocked storage', () => {
  for (const raw of [null, '{', '{}', '{"access_token":123}', '{"access_token":""}']) {
    assert.equal(storedToken({ getItem: () => raw }), null);
  }
  assert.equal(storedToken({ getItem: () => { throw new Error('blocked'); } }), null);
  assert.equal(storedToken(storage()), 'owner-token');
});

test('signed-out entry does not refresh or call the API', async () => {
  const result = await checkOwner({ storage: storage(null), auth: { refreshIfNeeded: () => { throw new Error('must not refresh'); } },
    fetchImpl: () => { assert.fail('must not call API'); } });
  assert.deepEqual(result, { owner: false, reason: 'signed-out' });
});

test('only the canonical status API answers ownership; no cache or redirects', async () => {
  const result = await checkOwner({ storage: storage(), auth: null, fetchImpl: async (url, init) => {
    assert.equal(url, API_ORIGIN + '/v1/status');
    assert.equal(init.headers.authorization, 'Bearer owner-token');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    return { ok: true, status: 200 };
  } });
  assert.deepEqual(result, { owner: true, reason: 'owner' });
});

for (const status of [401, 403, 429, 500]) test(`HTTP ${status} fails closed`, async () => {
  const result = await checkOwner({ storage: storage(), auth: null, fetchImpl: async () => ({ ok: false, status }) });
  assert.equal(result.owner, false);
  assert.equal(result.reason, [401, 403].includes(status) ? 'not-owner' : 'unavailable');
});

test('network rejection fails closed', async () => {
  const result = await checkOwner({ storage: storage(), auth: null, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(result, { owner: false, reason: 'unavailable' });
});

test('a canonical refresh uses the newly persisted token', async () => {
  const store = storage();
  const result = await checkOwner({ storage: store, auth: { refreshIfNeeded: async () => {
    store.setToken('refreshed-token'); return { access_token: 'refreshed-token' };
  } }, fetchImpl: async (_, init) => { assert.equal(init.headers.authorization, 'Bearer refreshed-token'); return { ok: true }; } });
  assert.equal(result.owner, true);
});

test('a null refresh cannot fall back to the old bearer', async () => {
  let calls = 0;
  const result = await checkOwner({ storage: storage(), auth: { refreshIfNeeded: async () => null },
    fetchImpl: async () => { calls++; return { ok: true }; } });
  assert.equal(result.owner, false); assert.equal(calls, 0);
});

test('a refresh rejection cannot fall back to the old bearer', async () => {
  let calls = 0;
  const result = await checkOwner({ storage: storage(), auth: { refreshIfNeeded: async () => { throw new Error('refresh failed'); } },
    fetchImpl: async () => { calls++; return { ok: true }; } });
  assert.equal(result.owner, false); assert.equal(calls, 0);
});

test('sign-out during refresh prevents the status request', async () => {
  const store = storage(), refresh = deferred(); let calls = 0;
  const pending = checkOwner({ storage: store, auth: { refreshIfNeeded: () => refresh.promise },
    fetchImpl: async () => { calls++; return { ok: true }; } });
  store.setToken(null); refresh.resolve({ access_token: 'owner-token' });
  assert.equal((await pending).owner, false); assert.equal(calls, 0);
});

for (const replacement of [null, 'other-account']) test(`an old 200 cannot authorize changed session ${replacement}`, async () => {
  const store = storage(), response = deferred();
  const pending = checkOwner({ storage: store, auth: null, fetchImpl: () => response.promise });
  await turn(); store.setToken(replacement); response.resolve({ ok: true });
  assert.equal((await pending).owner, false);
});

test('the deadline includes refresh and prevents a late API request', async () => {
  const refresh = deferred(); let calls = 0;
  const result = await bounded(checkOwner({ storage: storage(), timeoutMs: 10,
    auth: { refreshIfNeeded: () => refresh.promise }, fetchImpl: async () => { calls++; return { ok: true }; } }));
  refresh.resolve({ access_token: 'owner-token' }); await turn();
  assert.notEqual(result, 'hung'); assert.equal(result.owner, false); assert.equal(calls, 0);
});

test('the deadline settles even when the fetch adapter ignores AbortSignal', async () => {
  const result = await bounded(checkOwner({ storage: storage(), auth: null, timeoutMs: 10,
    fetchImpl: () => new Promise(() => {}) }));
  assert.notEqual(result, 'hung'); assert.equal(result.owner, false);
});

test('nested page scripts resolve against the page and preserve module type', () => {
  assert.deepEqual(loadList('one.js two.mjs?v=1', 'https://example.test/demos/game/index.html'), [
    { url: 'https://example.test/demos/game/one.js', module: false },
    { url: 'https://example.test/demos/game/two.mjs?v=1', module: true }
  ]);
});

test('a denied gate never mounts the app', async () => {
  const p = page();
  await guardPage(p.gate, { ...p, check: async () => ({ owner: false, reason: 'not-owner' }) });
  assert.equal(p.stats.mounted, 0); assert.equal(p.stats.opened, 0);
  assert.equal(p.doc.documentElement.dataset.ownerAccess, 'closed');
});

test('a current owner mounts once and emits one ready event', async () => {
  const p = page(); let checks = 0;
  await guardPage(p.gate, { ...p, check: async () => { checks++; return { owner: true }; } }); await turn();
  emit(p.doc, 'visibilitychange'); await turn();
  assert.equal(checks, 2); assert.equal(p.stats.mounted, 1); assert.equal(p.stats.opened, 1);
});

test('auth changes invalidate an in-flight success and start a fresh check', async () => {
  const p = page(), old = deferred(); let checks = 0;
  const first = guardPage(p.gate, { ...p, check: () => ++checks === 1 ? old.promise : Promise.resolve({ owner: false, reason: 'signed-out' }) });
  await turn(); emit(p.win, 'mcc:auth-changed'); await turn();
  old.resolve({ owner: true }); await first; await turn();
  assert.equal(checks, 2); assert.equal(p.stats.mounted, 0); assert.equal(p.stats.opened, 0);
  assert.equal(p.doc.documentElement.dataset.ownerAccess, 'closed');
});

test('an older denial cannot overwrite a newer owner decision', async () => {
  const p = page(), old = deferred(); let checks = 0;
  const first = guardPage(p.gate, { ...p, check: () => ++checks === 1 ? old.promise : Promise.resolve({ owner: true }) });
  await turn(); emit(p.win, 'mcc:auth-changed'); await turn();
  old.resolve({ owner: false }); await first; await turn();
  assert.equal(p.stats.mounted, 1); assert.equal(p.stats.reloads, 0);
  assert.equal(p.doc.documentElement.dataset.ownerAccess, 'open');
});

for (const trigger of ['auth', 'session', 'clear']) test(`${trigger} hides an already mounted app before reloading`, async () => {
  const p = page();
  await guardPage(p.gate, { ...p, check: async () => ({ owner: true }) }); await turn();
  if (trigger === 'auth') emit(p.win, 'mcc:auth-changed');
  else emit(p.win, 'storage', { key: trigger === 'clear' ? null : SESSION_KEY });
  assert.equal(p.doc.documentElement.style.display, 'none');
  assert.equal(p.doc.documentElement.inert, true);
  assert.equal(p.stats.reloads, 1);
  emit(p.win, 'mcc:auth-changed'); assert.equal(p.stats.reloads, 1);
});

test('unrelated storage writes do not close the app', async () => {
  const p = page(); await guardPage(p.gate, { ...p, check: async () => ({ owner: true }) });
  emit(p.win, 'storage', { key: 'theme' }); await turn();
  assert.equal(p.stats.reloads, 0); assert.equal(p.doc.documentElement.dataset.ownerAccess, 'open');
});

for (const mode of ['throw', 'reject']) test(`${mode} from the check fails closed and a later check can recover`, async () => {
  const p = page(); let checks = 0;
  await guardPage(p.gate, { ...p, check: () => {
    if (++checks > 1) return Promise.resolve({ owner: true });
    if (mode === 'throw') throw new Error('broken adapter');
    return Promise.reject(new Error('broken adapter'));
  } });
  assert.equal(p.doc.documentElement.dataset.ownerAccess, 'closed');
  emit(p.win, 'mcc:auth-changed'); await turn();
  assert.equal(p.stats.mounted, 1);
});

test('page-cache restoration rechecks before revealing previously opened content', async () => {
  const p = page(), restored = deferred(); let checks = 0;
  await guardPage(p.gate, { ...p, check: () => ++checks === 1 ? Promise.resolve({ owner: true }) : restored.promise });
  emit(p.win, 'pagehide', { persisted: true });
  assert.equal(p.doc.documentElement.style.display, 'none');
  emit(p.win, 'pageshow', { persisted: true }); await turn();
  assert.equal(checks, 2); assert.equal(p.doc.documentElement.style.display, 'none');
  restored.resolve({ owner: true }); await turn();
  assert.equal(p.doc.documentElement.style.display, ''); assert.equal(p.doc.documentElement.inert, false);
  assert.equal(p.stats.mounted, 1); assert.equal(p.stats.opened, 1);
});

test('revocation stops the remaining classic-script load chain and ready event', async () => {
  const p = page(), scripts = [];
  p.gate.dataset.ownerLoad = 'first.js second.js';
  p.doc.createElement = () => ({});
  p.doc.body = { appendChild: (script) => { scripts.push(script); } };
  await guardPage(p.gate, { ...p, check: async () => ({ owner: true }) }); await turn();
  assert.equal(scripts.length, 1);
  emit(p.win, 'mcc:auth-changed'); scripts[0].onload(); await turn();
  assert.equal(scripts.length, 1); assert.equal(p.stats.opened, 0); assert.equal(p.stats.reloads, 1);
});

test('a failed navigation leaves revoked content concealed', async () => {
  const p = page();
  await guardPage(p.gate, { ...p, check: async () => ({ owner: true }), reload: () => { throw new Error('navigation blocked'); } });
  emit(p.win, 'mcc:auth-changed');
  assert.equal(p.doc.documentElement.style.display, 'none'); assert.equal(p.doc.documentElement.inert, true);
});

test('a later membership denial revokes an open page', async () => {
  const p = page(); let checks = 0;
  await guardPage(p.gate, { ...p, check: async () => ({ owner: ++checks === 1, reason: 'not-owner' }) });
  emit(p.doc, 'visibilitychange'); await turn();
  assert.equal(p.stats.reloads, 1); assert.equal(p.doc.documentElement.style.display, 'none');
});

test('pagehide invalidates a pending check; restoration starts a new decision', async () => {
  const p = page(), old = deferred(); let checks = 0;
  const first = guardPage(p.gate, { ...p, check: () => ++checks === 1 ? old.promise : Promise.resolve({ owner: true }) });
  await turn(); emit(p.win, 'pagehide', { persisted: true }); old.resolve({ owner: true }); await first;
  assert.equal(p.stats.mounted, 0);
  emit(p.win, 'pageshow', { persisted: true }); await turn();
  assert.equal(checks, 2); assert.equal(p.stats.mounted, 1);
});
