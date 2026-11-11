// purchase.html's script (js/music-purchase.js) run without a browser: the real file in
// a fresh vm context with a fake document, location, storage, timers and clock. The
// caller supplies fetch, so the same page code can be driven against scripted answers
// (music-purchase-retry.test.mjs) or against the real Edge handler on a real database
// (music-direct-buyer-recovery.integration.mjs). Nothing here reaches a network.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SOURCE = await readFile(new URL('../../../js/music-purchase.js', import.meta.url), 'utf8');
export const PURCHASE_FUNCTION_URL = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/music-direct-access';
const IDS = ['ppHead', 'ppLead', 'ppCard', 'ppTitle', 'ppMeta', 'ppDownload', 'ppStatus', 'ppLinkBox', 'ppLink', 'ppCopy', 'ppNote'];

/** A Storage that works; pass { broken: true } for one whose every call throws (private mode, blocked cookies). */
export function memoryStorage({ broken = false } = {}) {
  const map = new Map();
  const guard = (fn) => (...a) => { if (broken) throw new Error('SecurityError: storage is not available'); return fn(...a); };
  return {
    map,
    getItem: guard((k) => (map.has(String(k)) ? map.get(String(k)) : null)),
    setItem: guard((k, v) => { map.set(String(k), String(v)); }),
    removeItem: guard((k) => { map.delete(String(k)); })
  };
}

/**
 * Load the page. `search` is the query string ("?token=…"), `fetch` answers every request,
 * `sessionStorage` is shared between two loads to model a reload in the same tab, `crypto`
 * is what window.crypto is, `clock` is { now } in milliseconds (advance it to age a key).
 */
export async function loadPurchasePage({ search = '', fetch, sessionStorage = memoryStorage(), localStorage = memoryStorage(), crypto = globalThis.crypto, clock = { now: Date.UTC(2026, 10, 9, 12) }, track = null, abortController = AbortController } = {}) {
  const elements = Object.fromEntries(IDS.map((id) => [id, {
    id, textContent: '', value: '', hidden: id === 'ppCard' || id === 'ppLinkBox', disabled: false, attributes: {}, listeners: {},
    setAttribute(k, v) { this.attributes[k] = String(v); }, removeAttribute(k) { delete this.attributes[k]; }, getAttribute(k) { return this.attributes[k] ?? null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, select() {}
  }]));
  const timers = [];
  let timerId = 0;
  const assigned = [];
  const location = {
    origin: 'https://matthew.mccluster.org', pathname: '/purchase.html', search,
    get href() { return this.origin + this.pathname + this.search; },
    assign(url) { assigned.push(String(url)); }
  };
  class PageDate extends Date { static now() { return clock.now; } }
  const sandbox = {
    document: { getElementById: (id) => { if (!elements[id]) throw new Error(`purchase.html has no #${id}`); return elements[id]; } },
    location,
    history: { replaceState(_s, _t, url) { location.search = String(url); } },
    navigator: {},
    URLSearchParams, Date: PageDate, AbortController: abortController, crypto, sessionStorage, localStorage,
    fetch: (...a) => fetch(...a),
    setTimeout: (fn, ms) => { timers.push({ id: ++timerId, fn, ms: Number(ms) || 0 }); return timerId; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }
  };
  if (track) sandbox.MCC_TRACK = track;
  /* 'denied': reading window.sessionStorage itself throws, as browsers do when storage is blocked */
  if (sessionStorage === 'denied') Object.defineProperty(sandbox, 'sessionStorage', { get() { throw new Error('SecurityError: storage is not available'); } });
  sandbox.window = sandbox;
  vm.runInNewContext(SOURCE, sandbox, { filename: 'js/music-purchase.js' });
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((ok) => setImmediate(ok)); };
  await settle();
  return {
    el: elements, assigned, location, sessionStorage, timers, clock,
    settle,
    /** click a control and let every promise it started run */
    async click(id = 'ppDownload') {
      if (elements[id].disabled) throw new Error(`#${id} is disabled`);
      for (const fn of elements[id].listeners.click || []) fn({ type: 'click' });
      await settle();
    },
    /** run the timers waiting at least `ms` (the request bound), as the browser would once that time passed */
    async elapse(ms) {
      clock.now += ms;
      for (const t of timers.filter((x) => x.ms <= ms)) { const i = timers.indexOf(t); if (i >= 0) { timers.splice(i, 1); t.fn(); } }
      await settle();
    }
  };
}

/** A fetch Response stand-in: JSON by default, `raw` for a body that is not JSON. */
export function answer(status, body, { raw = null } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => (raw === null ? JSON.parse(JSON.stringify(body)) : JSON.parse(raw)) };
}
