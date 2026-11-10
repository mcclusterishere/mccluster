/* A whole-page harness for default Control (js/control-room-v2.js).

   The real file runs, with the real nav, format and sources modules, inside a
   vm context behind a small fake DOM built from control.html's own element
   ids. Nothing is extracted, so init(), request(), supa(), load(), every
   per-view loader and render() run exactly as shipped.

   Every network read is answered from per-principal fixtures chosen by the
   bearer token's subject, the way the real API scopes a read to its caller.
   Each principal's private strings carry its marker (AVOCADO for account A,
   BLUEBIRD for account B), so a test can say which account's data reached
   which part of the page. A read can be held and released later, as a slow
   network would, and it then answers for the account that sent it.

   "Another tab" is what the browser delivers here: storage changes plus a
   `storage` event (never fired in the tab that wrote). A page reload is
   recorded, not performed; a test simulates it by opening a new page on the
   same storage.

   AUTH_TEST_SOURCE_ROOT=<checkout> points it at another copy of the sources,
   so the same tests can run against an older control-room-v2.js. Nothing
   leaves the process. */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = process.env.AUTH_TEST_SOURCE_ROOT || new URL('../../../', import.meta.url).pathname;
const read = path => readFileSync(join(ROOT, path), 'utf8');

export const PRINCIPALS = {
  'owner-a': { marker: 'AVOCADO', org: 'org-avocado', email: 'a@fixture.invalid' },
  'member-b': { marker: 'BLUEBIRD', org: 'org-bluebird', email: 'b@fixture.invalid' }
};
export const MARKERS = { A: 'AVOCADO', B: 'BLUEBIRD' };
const exp = () => Math.floor(Date.now() / 1000) + 3600;
/* A token's payload is all a fixture needs; `extra` makes a refreshed token for
   the same subject a different string. */
export const jwt = (sub, extra = '') => 'h.' + Buffer.from(JSON.stringify({ sub, exp: exp(), email: (PRINCIPALS[sub] || {}).email, r: extra })).toString('base64url') + '.s';
export const session = (sub, extra = '') => JSON.stringify({ access_token: jwt(sub, extra), refresh_token: 'refresh-' + sub, expires_at: exp() });
export const subjectOf = token => { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()).sub || null; } catch { return null; } };

export const flush = async (turns = 8) => { for (let i = 0; i < turns; i++) await new Promise(r => setImmediate(r)); };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const escHtml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const stripHtml = v => String(v).replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

class ClassList {
  constructor() { this.names = new Set(); }
  add(...n) { n.forEach(x => this.names.add(x)); }
  remove(...n) { n.forEach(x => this.names.delete(x)); }
  toggle(n, force) { const on = force === undefined ? !this.names.has(n) : !!force; if (on) this.names.add(n); else this.names.delete(n); return on; }
  contains(n) { return this.names.has(n); }
}
/* The elements rendered into a container, parsed from its markup once per
   version of that markup, so listeners bound after a render stay on the same
   objects until the next render replaces them (as innerHTML does). */
const parsed = new WeakMap();
const decode = v => String(v).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function children(host) {
  const known = parsed.get(host);
  if (known && known.html === host._html) return known.nodes;
  const nodes = [];
  for (const m of host._html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const el = new El('', m[1]);
    for (const a of m[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      el.attrs.set(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
    }
    if (el.attrs.has('id')) el.id = el.attrs.get('id');
    el.disabled = el.attrs.has('disabled');
    nodes.push(el);
  }
  parsed.set(host, { html: host._html, nodes });
  return nodes;
}
/* Enough of querySelectorAll for this file: comma lists of tag?[attr] or tag?[attr="v"]. */
function matcher(selector) {
  const parts = String(selector).split(',').map(s => s.trim()).map(s => {
    const m = s.match(/^([a-zA-Z0-9]*)((?:\[[^\]]+\])*)$/);
    if (!m) return () => false;
    const tests = [...m[2].matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)].map(t => el => el.attrs.has(t[1]) && (t[2] === undefined || el.attrs.get(t[1]) === t[2]));
    return el => (!m[1] || el.tagName === m[1].toUpperCase()) && tests.every(t => t(el));
  });
  return el => parts.some(p => p(el));
}
class El {
  constructor(id, tag = 'div') {
    this.id = id; this.tagName = tag.toUpperCase(); this._html = ''; this.hidden = false; this.value = ''; this.checked = false; this.disabled = false;
    this.attrs = new Map(); this.classList = new ClassList(); this.style = {}; this.dataset = {}; this.listeners = new Map();
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); }
  get textContent() { return stripHtml(this._html); }
  set textContent(v) { this._html = escHtml(v == null ? '' : v); }
  get innerText() { return this.hidden ? '' : this.textContent; }
  get className() { return [...this.classList.names].join(' '); }
  set className(v) { this.classList.names = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get childElementCount() { return this._html ? 1 : 0; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener() {}
  dispatch(type, init = {}) { for (const fn of this.listeners.get(type) || []) fn({ type, target: this, preventDefault() {}, stopPropagation() {}, ...init }); }
  click() { this.dispatch('click', { button: 0 }); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) { const test = matcher(sel); return children(this).filter(test); }
  closest() { return null; }
  contains() { return false; }
  focus() {} blur() {} select() {} setSelectionRange() {} scrollIntoView() {} appendChild(c) { return c; } removeChild() {} replaceChildren() { this._html = ''; }
}

/* control.html's own element ids, with their initial `hidden`. */
function staticElements() {
  const html = read('control.html');
  const out = new Map();
  for (const m of html.matchAll(/<([a-zA-Z0-9]+)\b([^>]*)>/g)) {
    const id = (m[2].match(/\sid="([^"]+)"/) || [])[1];
    if (!id) continue;
    const el = new El(id, m[1]);
    el.hidden = /\shidden(?=[\s>=]|$)/.test(m[2]);
    out.set(id, el);
  }
  return out;
}

/* Per-principal fixtures: the private payload each account would get back. */
function answer(sub, method, url, body) {
  const P = PRINCIPALS[sub]; if (!P) return { status: 401, body: { error: 'unauthorized' } };
  const M = P.marker, now = new Date().toISOString(), u = new URL(url), p = u.pathname;
  if (u.hostname === 'api.mccluster.org') {
    if (p === '/v1/workspaces/me') return { body: { ok: true, profile: { id: sub }, default_org_id: P.org, workspaces: [{ org_id: P.org, slug: 'ws-' + M.toLowerCase(), kind: 'studio', role: 'owner', enabled: true, name: M + ' workspace' }] } };
    if (p === '/v1/status') return { body: { ok: true, operator: { email: M + '-operator@fixture.invalid' }, database: { reachable: true } } };
    if (p === '/v1/core') return { body: { ok: true, signed_dispatch: true } };
    if (p === '/v1/core/mcp') {
      const rpc = body || {}; let result = {};
      if (rpc.method === 'tools/list') result = { tools: [{ name: 'ai.chat' }, { name: 'core.resume' }, { name: 'core.ai.turn.submit' }, { name: 'core.ai.turn.get' }] };
      else if (rpc.params && rpc.params.name === 'core.resume') result = { content: [{ text: JSON.stringify({ pending_approvals: [{ id: 'ap-' + M, capability: M + ' approval', resource: M + ' resource' }] }) }] };
      return { body: { jsonrpc: '2.0', id: rpc.id, result } };
    }
    if (p === '/v1/apps') return { body: { apps: [{ name: M + ' app', app_key: 'app-' + M.toLowerCase() }] } };
    if (p === '/v1/ai/status') return { body: { ok: true } };
    if (p === '/v1/ai/system-health') return { body: { ok: true, overall: 'healthy', checked_at: now } };
    if (p === '/v1/ai/decisions') return { body: { decisions: [{ id: 'd-' + M, title: M + ' decision', status: 'proposed', risk_class: 'high', created_at: now }] } };
    if (p === '/v1/comms/threads') return { body: { threads: [{ id: 'thread-shared', mode: 'human', channel: 'email', updated_at: now, last_inbound_at: now, comms_contacts: { display_name: M + ' contact', address: M.toLowerCase() + '@example.invalid' } }] } };
    const transcript = p.match(/^\/v1\/comms\/threads\/([^/]+)\/messages$/);
    if (transcript) return { body: { thread: { id: decodeURIComponent(transcript[1]), mode: 'human' }, messages: [{ id: 'msg-' + M, body: M + ' message body', direction: 'inbound', status: 'received', created_at: now }], has_more: false } };
    if (p === '/v1/audit/recent') return { body: { events: [{ id: 'au-' + M, event: M + ' audit', at: now }] } };
    if (p === '/v1/observability/events') return { body: { events: [{ id: 'ev-' + M, event_name: M + ' event', event_kind: 'domain', level: u.searchParams.get('level') || 'info', occurred_at: now, source: 'worker', outcome: 'ok', trace_id: 'trace-' + M.toLowerCase() }], has_more: false } };
    if (p === '/v1/social/accounts') return { body: { accounts: [{ id: 'sa-' + M, platform: 'instagram', handle: M + ' handle', display_name: M + ' handle', status: 'connected' }] } };
    if (p === '/v1/compute/balance') return { body: { currency: 'usd' } };
    if (p === '/v1/platform/catalog') return { body: { products: [{ id: 'prod-' + M, name: M + ' product' }] } };
    if (p === '/v1/developer/consumers') return { body: { consumers: [{ id: 'con-' + M, name: M + ' consumer', status: 'active' }] } };
    if (p === '/v1/media/usage') return { body: { totals: {}, rows: [] } };
    if (p === '/v1/media/budget') return { body: { budget: {} } };
    return { body: { ok: true } };
  }
  const table = p.replace(/^\/rest\/v1\//, '');
  const rows = {
    leads: [{ id: 'lead-' + M, name: M + ' lead', email: M.toLowerCase() + '-lead@example.invalid', status: 'new', at: now }],
    ops_agent_jobs: [{ id: 'job-' + M, job_type: M + '-job', status: 'running', created_at: now }],
    ops_ai_threads: [{ id: 'ai-' + M, org_id: P.org, title: M + ' chat', last_message_at: now }],
    ops_ai_messages: [{ id: 'aim-' + M, thread_id: 'ai-' + M, role: 'assistant', content: M + ' ai reply', created_at: now }],
    media_assets: [{ id: 'asset-' + M, name: M + ' asset', created_at: now }],
    social_campaigns: [{ id: 'cmp-' + M, name: M + ' campaign', status: 'active', created_at: now }],
    music_orders: [{ id: 'mo-' + M, amount_cents: 1000, currency: 'usd', status: 'pending', customer_email: M + '-buyer@fixture.invalid', metadata: { track_title: M + ' track' }, created_at: now }]
  }[table] || [];
  return { body: rows, headers: { 'content-range': '0-' + Math.max(0, rows.length - 1) + '/' + rows.length } };
}

function response({ status = 200, body = null, headers = {} }) {
  const text = body == null ? '' : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: k => headers[String(k).toLowerCase()] ?? null }, text: async () => text, json: async () => JSON.parse(text || 'null') };
}
const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

/* Opens control.html#<hash> for whoever the shared storage holds. `storage`
   (a Map) is shared between pages to simulate a reload or a second tab. */
export async function openControl({ hash = '#home:today', storage = new Map(), search = '', hold = null, sessionStore = new Map() } = {}) {
  const elements = staticElements();
  const dynamic = new Map();
  const listeners = new Map();
  const fetchLog = [];
  const holds = [];
  /* A hold installed before the page boots catches the default load itself. */
  if (hold) holds.push({ match: hold, open: true, pending: [], release() { this.open = false; this.pending.splice(0).forEach(fn => fn()); } });
  let reloads = 0, tokenMode = 'normal';
  const errors = [];

  const win = {};
  const local = {
    getItem: k => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: k => { storage.delete(k); },
    clear: () => storage.clear(),
    key: i => [...storage.keys()][i] ?? null,
    get length() { return storage.size; }
  };
  const sessionStorage = { getItem: k => sessionStore.has(k) ? sessionStore.get(k) : null, setItem: (k, v) => sessionStore.set(k, String(v)), removeItem: k => sessionStore.delete(k) };
  const location = {
    hash, search, pathname: '/control.html', origin: 'https://matthew.mccluster.org',
    get href() { return this.origin + this.pathname + this.search + this.hash; },
    set href(v) { location.assigned = v; },
    reload() { reloads += 1; },
    assign(v) { location.assigned = v; },
    replace(v) { location.assigned = v; }
  };
  const history = { replaceState(_s, _t, url) { if (typeof url === 'string' && url.startsWith('#')) location.hash = url; } };

  /* An id rendered into a container is found the way the browser finds it;
     a re-render of the container makes a new element, as innerHTML does. */
  function byId(id) {
    if (elements.has(id)) return elements.get(id);
    for (const host of elements.values()) {
      if (!host._html || host._html.indexOf('id="' + id + '"') < 0) continue;
      const known = dynamic.get(id);
      if (known && known.host === host && known.html === host._html) return known.el;
      const tag = (host._html.match(new RegExp('<([a-zA-Z0-9]+)[^>]*\\sid="' + id + '"')) || [])[1] || 'div';
      const el = new El(id, tag);
      dynamic.set(id, { host, html: host._html, el });
      return el;
    }
    return null;
  }
  const body = new El('body', 'body');
  const document = {
    readyState: 'complete', body, documentElement: new El('html', 'html'),
    getElementById: byId,
    querySelectorAll: sel => [...elements.values()].flatMap(host => host.querySelectorAll(sel)),
    querySelector: sel => document.querySelectorAll(sel)[0] || null,
    createElement: tag => new El('', tag),
    addEventListener: (type, fn) => { (listeners.get('document:' + type) || listeners.set('document:' + type, []).get('document:' + type)).push(fn); },
    removeEventListener() {}
  };

  const token = () => {
    const raw = storage.get('mccdb_session');
    if (!raw) return Promise.resolve(null);
    if (tokenMode === 'refresh-fails') { storage.delete('mccdb_session'); return Promise.resolve(null); }
    try { return Promise.resolve(JSON.parse(raw).access_token || null); } catch { return Promise.resolve(null); }
  };
  function emit(type, detail) { for (const fn of listeners.get(type) || []) fn(detail); }

  function fakeFetch(input, init = {}) {
    const url = String(input);
    const absolute = /^https?:/.test(url) ? url : location.origin + '/' + url.replace(/^\//, '');
    const headers = init.headers || {};
    const bearer = String(headers.authorization || headers.Authorization || '').replace(/^Bearer\s+/i, '');
    const sub = bearer ? subjectOf(bearer) : null;
    let rpc = null; try { rpc = init.body ? JSON.parse(init.body) : null; } catch { rpc = null; }
    const entry = { url: absolute, path: new URL(absolute).pathname, sub, method: init.method || 'GET', signal: init.signal || null, rpc, at: fetchLog.length };
    fetchLog.push(entry);
    const signal = init.signal;
    if (signal && signal.aborted) return Promise.reject(abortError());
    const settle = () => {
      const u = new URL(absolute);
      if (u.origin === location.origin) return response({ body: {} });
      if (u.pathname === '/health') return response({ body: { ok: true } });
      if (!sub) return response({ status: 401, body: { error: 'unauthorized' } });
      return response(answer(sub, entry.method, absolute, rpc));
    };
    const hold = holds.find(h => h.open && h.match(entry));
    return new Promise((resolve, reject) => {
      if (signal) signal.addEventListener('abort', () => { entry.aborted = true; reject(abortError()); }, { once: true });
      if (hold) { hold.pending.push(() => resolve(settle())); entry.held = true; return; }
      setImmediate(() => resolve(settle()));
    });
  }

  Object.assign(win, {
    window: win, self: win, document, localStorage: local, sessionStorage, location, history,
    navigator: { language: 'en-US' }, console: { log() {}, warn() {}, info() {}, error: (...a) => errors.push(a.join(' ')) },
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
    Promise, JSON, Math, Date, Object, Array, String, Number, Boolean, Error, TypeError, RegExp, Map, Set, WeakMap, Symbol, Intl, URL, URLSearchParams,
    AbortController, AbortSignal, Uint8Array, encodeURIComponent, decodeURIComponent, isNaN, isFinite, parseInt, parseFloat,
    atob: s => Buffer.from(String(s), 'base64').toString('binary'), btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    crypto: { randomUUID: () => globalThis.crypto.randomUUID(), getRandomValues: a => globalThis.crypto.getRandomValues(a) },
    fetch: fakeFetch,
    scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (type, fn) => { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
    removeEventListener() {},
    dispatchEvent: ev => { emit(ev.type, ev); return true; },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init ? init.detail : undefined; } },
    Event: class { constructor(type) { this.type = type; } },
    CR: {},
    MCC_SUPA: { url: 'https://zmnhbrjyhxzhkxmhkexs.supabase.co', key: 'sb_publishable_fixture', token },
    MCC_AUTH: {
      signOut() { storage.delete('mccdb_session'); storage.delete('mcc_sess_keep'); emit('mcc:auth-changed', { type: 'mcc:auth-changed', detail: { signed_in: false } }); return Promise.resolve(); },
      signInPassword(email) {
        const sub = Object.keys(PRINCIPALS).find(k => PRINCIPALS[k].email === email);
        if (!sub) return Promise.reject(new Error('fixture: unknown account'));
        storage.set('mccdb_session', session(sub)); storage.set('mcc_sess_keep', storage.get('mccdb_session'));
        emit('mcc:auth-changed', { type: 'mcc:auth-changed', detail: { signed_in: true } });
        return Promise.resolve(true);
      }
    }
  });
  vm.createContext(win);
  const run = (path, source) => vm.runInContext(source ?? read(path), win, { filename: join(ROOT, path) });
  run('js/control-room/nav.js');
  run('js/control-room/format.js');
  run('js/control-room/sources.js');
  win.CR.media = {
    init() {}, renderPanel: () => '', state: { catalog: {} }, loadCatalog: () => Promise.resolve(),
    trackedJobs: () => [], generatedAssets: () => [], handleAction: () => false, bind() {}
  };
  /* A stand-in for a real Control module: work-tools.js is handed exactly
     this surface ({ request, supa, render, refresh, getState }) at init. */
  const moduleApi = {};
  win.CR.workTools = { init(api) { Object.assign(moduleApi, api); }, render: () => '', bind() {} };
  run('js/control-room-v2.js');

  const page = {
    win, storage, sessionStore, fetchLog, errors, holds,
    el: byId,
    /* What a module holds: Control's request/supa, and its state (getState). */
    module: moduleApi,
    state() { return moduleApi.getState ? moduleApi.getState() : {}; },
    get reloads() { return reloads; },
    setTokenMode(mode) { tokenMode = mode; },
    /* Everything this page holds in its DOM: every element's markup and
       every form value, hidden or not. */
    dom() {
      const parts = [];
      for (const el of elements.values()) parts.push(el._html, el.value || '');
      /* A rendered field counts while it is attached: a re-render of its
         container replaced it, as innerHTML does in a browser. */
      for (const { host, html, el } of dynamic.values()) if (host._html === html) parts.push(el.value || '');
      return parts.join('\n');
    },
    /* What a viewer can see: the gate or the app, never both. */
    visible() {
      const gate = elements.get('cpGate'), app = elements.get('crApp');
      const parts = [];
      if (!gate.hidden) parts.push(elements.get('cpNote').textContent);
      if (!app.hidden) for (const id of ['crSurface', 'crSections', 'crTopTitle', 'crInspectorBody', 'crOrgSelect']) parts.push(elements.get(id).textContent);
      return parts.join('\n');
    },
    gateShown() { return !elements.get('cpGate').hidden && elements.get('crApp').hidden; },
    appShown() { return !elements.get('crApp').hidden && elements.get('cpGate').hidden; },
    note() { return elements.get('cpNote').textContent; },
    surface() { return elements.get('crSurface').innerHTML; },
    async go(route) { location.hash = route; emit('hashchange', { type: 'hashchange' }); await flush(); },
    /* Another tab changed the session (or cleared storage). */
    async otherTab(change) {
      const before = new Map(storage);
      change(storage);
      const keys = new Set([...before.keys(), ...storage.keys()]);
      const changed = [...keys].filter(k => before.get(k) !== storage.get(k));
      if (!storage.size && before.size) emit('storage', { type: 'storage', key: null });
      else for (const key of changed) emit('storage', { type: 'storage', key, oldValue: before.get(key) ?? null, newValue: storage.get(key) ?? null });
      await flush();
    },
    fire(type, detail) { emit(type, { type, detail }); },
    pageshow(persisted) { emit('pageshow', { type: 'pageshow', persisted }); },
    async signInHere(email) { byId('cpEmail').value = email; byId('cpPass').value = 'fixture-password'; byId('cpIn').click(); await flush(); },
    /* Clicks a rendered control by its data-action (and data-id), through the
       listener bindActions attached to it. */
    async click(action, id) {
      const hit = document.querySelectorAll('[data-action="' + action + '"]').find(el => id === undefined || el.getAttribute('data-id') === id);
      if (!hit) throw new Error('fixture: no rendered control for ' + action + (id ? ' ' + id : ''));
      hit.click(); await flush();
    },
    /* Types into a rendered field the way the input event reaches the page. */
    type(id, text) { const el = byId(id); if (!el) throw new Error('fixture: no field ' + id); el.value = text; el.dispatch('input'); },
    /* Holds matching reads until released; they then answer for the account that sent them. */
    hold(match) { const h = { match, open: true, pending: [], release() { h.open = false; h.pending.splice(0).forEach(fn => fn()); } }; holds.push(h); return h; },
    async settle() { await flush(12); await sleep(5); await flush(12); },
    reads(sub) { return fetchLog.filter(e => e.sub === sub); }
  };
  await page.settle();
  return page;
}

/* Waits until the default load has committed (the surface shows the account's workspace data). */
export async function ready(page, marker, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (page.dom().includes(marker)) return true; await sleep(5); }
  return false;
}
