/* Environmental Justice League member page: js/eup-league-member.js and js/eup-league-capture.js, in Node.

     node --test scripts/test/eup-league-member-ui.test.mjs

   A small DOM (enough for the module's own markup), a manual clock, a scripted fetch and fake media devices; nothing
   here is a browser, a Worker or a database. The answers follow the member contract (league-contract.js); the browser
   proof against the real Worker router over the real pending SQL is scripts/e2e/eup-league-member.e2e.mjs.
   Covered: the page itself; the copies of the contract the page carries (media table, sniffer, limits); every request
   the module sends is a member route of the contract with a valid document; hidden on 401 and 404; the identity
   guard; the epoch (auth change, storage change, back-forward cache) clearing the DOM, aborting requests and stopping
   the recorder; a timed-out write reading its receipt and never resending on its own; requirements_changed asking to
   accept again; autosave debounce and compare-and-swap conflict; capture never asking for a device before Record,
   denied permission, retake and cancel releasing everything, no MediaRecorder; escaping; copy that sells nothing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../../workers/mccluster/src/eup/league-contract.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

/* ------------------------------------------------------------------ a small DOM */
const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'source', 'hr']);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const encode = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let doc = null;
class Text { constructor(t) { this.nodeType = 3; this.data = t; this.parent = null; } get textContent() { return this.data; } }
class El {
  constructor(tag, attrs = {}) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = []; this.parent = null; this.listeners = {};
    this.value = Object.hasOwn(this.attrs, 'value') ? this.attrs.value : ''; this.checked = Object.hasOwn(this.attrs, 'checked'); this.open = Object.hasOwn(this.attrs, 'open');
    this.files = null; this.srcObject = null; this.played = 0;
  }
  get type() { return (this.attrs.type || (this.tagName === 'TEXTAREA' ? 'textarea' : this.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase(); }
  get disabled() { return Object.hasOwn(this.attrs, 'disabled'); }
  get hidden() { return Object.hasOwn(this.attrs, 'hidden'); }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get src() { return this.attrs.src || ''; }
  set src(v) { this.attrs.src = String(v); }
  get id() { return this.attrs.id || ''; }
  get ownerDocument() { return doc; }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === doc.body; }
  get dataset() { const out = {}; for (const [k, v] of Object.entries(this.attrs)) if (k.startsWith('data-')) out[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; return out; }
  get classList() { const el = this; return { add(c) { const set = new Set((el.attrs.class || '').split(/\s+/).filter(Boolean)); set.add(c); el.attrs.class = [...set].join(' '); }, contains(c) { return (el.attrs.class || '').split(/\s+/).includes(c); } }; }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return Object.hasOwn(this.attrs, k); }
  set innerHTML(html) { this.children.forEach((c) => { c.parent = null; }); this.children = []; parseInto(this, String(html)); }
  get innerHTML() { return this.children.map(serialize).join(''); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(t) { this.children.forEach((c) => { c.parent = null; }); this.children = [new Text(String(t))]; this.children[0].parent = this; }
  get innerText() { return this.textContent; }
  append(child) { child.parent = this; this.children.push(child); }
  *descendants() { for (const c of this.children) if (c.nodeType === 1) { yield c; yield* c.descendants(); } }
  querySelectorAll(sel) { const m = compile(sel); return [...this.descendants()].filter(m); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { const m = compile(sel); for (let n = this; n && n.nodeType === 1; n = n.parent) if (m(n)) return n; return null; }
  contains(n) { for (; n; n = n.parent) if (n === this) return true; return false; }
  focus() { doc.activeElement = this; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  showModal() { this.open = true; } close() { this.open = false; }
  pause() {} load() {} play() { this.played += 1; return Promise.resolve(); }
  setSelectionRange() {}
}
function serialize(n) {
  if (n.nodeType === 3) return encode(n.data);
  const attrs = Object.entries(n.attrs).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${encode(v)}"`)).join('');
  const tag = n.tagName.toLowerCase();
  return VOID.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>${n.children.map(serialize).join('')}</${tag}>`;
}
function parseInto(root, html) {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>|([^<]+)/g;
  const stack = [root];
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) { const tag = m[1].toUpperCase(); for (let i = stack.length - 1; i > 0; i -= 1) if (stack[i].tagName === tag) { stack.length = i; break; } continue; }
    if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      const el = new El(m[2], attrs);
      top.append(el);
      if (!VOID.has(m[2].toLowerCase())) stack.push(el);
      continue;
    }
    if (m[4] !== undefined) {
      const t = new Text(decode(m[4]));
      top.append(t);
      if (top.tagName === 'TEXTAREA') top.value = t.data;
    }
  }
}
/* selectors: tag, [a], [a="v"], [a^="v"] and combinations; comma lists */
function compile(sel) {
  const alternatives = sel.split(',').map((s) => s.trim()).map((part) => {
    const tag = (/^[a-zA-Z][a-zA-Z0-9-]*/.exec(part) || [null])[0];
    const conds = [...part.matchAll(/\[([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:(\^?=)"([^"]*)")?\]/g)].map((x) => ({ name: x[1], op: x[2], value: x[3] }));
    return (el) => (!tag || el.tagName === tag.toUpperCase()) && conds.every((c) => Object.hasOwn(el.attrs, c.name) && (!c.op || (c.op === '=' ? el.attrs[c.name] === c.value : el.attrs[c.name].startsWith(c.value))));
  });
  return (el) => alternatives.some((f) => f(el));
}
/* a bubbling event from an element up to the document body */
function fire(el, type, extra = {}) {
  let stopped = false;
  const event = { type, target: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; }, ...extra };
  for (let n = el; n && !stopped; n = n.parent) for (const fn of (n.listeners && n.listeners[type]) || []) fn(event);
  return event;
}

/* ------------------------------------------------------------------ window, storage, clock */
class Store {
  constructor() { this.map = new Map(); this.writes = []; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.writes.push(k); this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}
const winListeners = {};
globalThis.window = {
  addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
  removeEventListener(type, fn) { winListeners[type] = (winListeners[type] || []).filter((f) => f !== fn); },
  dispatchEvent(e) { for (const fn of winListeners[e.type] || []) fn(e); return true; },
  localStorage: new Store(), sessionStorage: new Store(), atob: globalThis.atob, crypto: globalThis.crypto,
  location: { pathname: '/action/league.html', search: '' },
  setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval
};
function freshDocument() {
  doc = { activeElement: null, title: '', readyState: 'complete', visibilityState: 'visible', listeners: {},
    body: new El('body'),
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); },
    querySelectorAll() { return []; }, getElementById(id) { return [...this.body.descendants()].find((e) => e.attrs.id === id) || null; } };
  window.document = doc;
  return doc;
}
freshDocument();
const consoleWrites = [];
for (const k of ['log', 'info', 'warn', 'error', 'debug']) { const orig = console[k]; console[k] = (...args) => { consoleWrites.push(args.map(String).join(' ')); orig.apply(console, args); }; }
/* EUL_CAPTURE_JS / EUL_MEMBER_JS point the suite at another copy of a module (a deliberately broken one, to show the
   tests catch the break); unset, the shipped files are tested. */
await import(process.env.EUL_CAPTURE_JS ? new URL(`file://${process.env.EUL_CAPTURE_JS}`).href : '../../js/eup-league-capture.js');
await import(process.env.EUL_MEMBER_JS ? new URL(`file://${process.env.EUL_MEMBER_JS}`).href : '../../js/eup-league-member.js');
const L = window.MCC_LEAGUE_MEMBER, CAP = window.MCC_LEAGUE_CAPTURE, H = L.helpers;

function clock(start = Date.UTC(2026, 10, 10, 12, 0, 0)) {
  let t = start, seq = 0;
  const timers = new Map();
  const api = {
    now: () => t,
    setTimeout: (fn, ms) => { seq += 1; timers.set(seq, { at: t + Math.max(0, ms || 0), fn }); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => { seq += 1; const id = seq; const tick = () => { timers.set(id, { at: t + ms, fn: () => { fn(); tick(); } }); }; tick(); return id; },
    clearInterval: (id) => { timers.delete(id); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); t = due[1].at; due[1].fn();
        await settle();
      }
      t = end; await settle();
    },
    pending: () => timers.size
  };
  return api;
}
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };

/* ------------------------------------------------------------------ accounts, tokens, answers */
const TESTER = '44444444-4444-4444-8444-444444444444';
const TESTER_B = '55555555-5555-4555-8555-555555555555';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFor = (sub) => `h.${b64u({ sub, exp: 4102444800, role: 'authenticated' })}.sig-${sub.slice(0, 4)}`;
const IDS = { campaign: '0b000000-0000-4000-8000-000000000001', mission: '0b000000-0000-4000-8000-000000000002', application: '0b000000-0000-4000-8000-000000000003',
  assignment: '0b000000-0000-4000-8000-000000000004', upload: '0b000000-0000-4000-8000-000000000005', proof: '0b000000-0000-4000-8000-000000000006', consent: '0b000000-0000-4000-8000-000000000007' };
const SHA = 'a'.repeat(64);
const AT = '2026-11-10T12:00:00Z';
const notice = (id) => ({ revision: `unit-${id}-1`, text: `TEST FIXTURE ${id} notice for the member UI unit test.\nSecond line.` });
const POLICY = { revision: 1, entitlement: 'none_required', media: { enabled: true, kinds: ['audio', 'video'], audio_max_bytes: 4096, video_max_bytes: 8192, max_duration_seconds: 120 },
  retention: { completed_days: 30, withdrawn_days: 7 }, notices: { participation: notice('participation'), private_review: notice('private-review'), publication: notice('publication') } };
function card(over = {}) {
  return { id: IDS.mission, campaign_id: IDS.campaign, slug: 'write-a-song', title: 'Write a song for a healthier world', template: 'write-a-song', state: 'released', open: true,
    requirements_revision: 1, requirements: 'Test fixture requirements.\nSecond line.', acceptance: 'Test fixture acceptance.', proof_modes: ['audio', 'video', 'lyrics'], rubric: {}, capacity: null, seats_taken: 0, ...over };
}
function assignment(over = {}) {
  return { id: IDS.assignment, tenant: null, created_at: AT, updated_at: AT, application_id: IDS.application, mission_id: IDS.mission, participant: TESTER, status: 'accepted', revision: 2,
    offered_requirements_revision: 1, accepted_requirements_revision: 1, accepted_notice_revision: POLICY.notices.participation.revision, accepted_at: AT, completed_at: null, withdrawn_at: null,
    mission: card(), draft: null, uploads: [], proof: null, credit: null, ...over };
}
function me(over = {}) {
  return { actor: TESTER, policy: POLICY, catalogue: [{ id: IDS.campaign, slug: 'unit-campaign', title: 'Test fixture campaign', purpose: 'Test fixture purpose.', state: 'released', audience: 'invited', missions: [card()] }],
    applications: [], assignments: [], published: [], ...over };
}
const sealed = (over = {}) => ({ id: IDS.upload, assignment_id: IDS.assignment, kind: 'audio', mime: 'audio/webm', ext: 'webm', declared_bytes: 640, max_bytes: 4096, duration_seconds: 3, state: 'sealed',
  scan_state: 'not_scanned', expires_at: AT, bytes: 640, sha256: SHA, rejected_reason: null, created_at: AT, sealed_at: AT, discarded_at: null, purged_at: null, ...over });

/* A scripted fetch: handlers by "METHOD /path" (path after the member prefix, '' for the read) or a function. Each call is
   kept with its init. A handler returns { status, body }, a Promise of one, 'hang' (never answers until aborted) or
   'network' (fails like a lost connection). */
function server(handlers = {}) {
  const calls = [];
  const fetch = (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.startsWith(C.PREFIX.member) ? u.pathname.slice(C.PREFIX.member.length).replace(/^\//, '') : u.pathname;
    const call = { url, method: init.method || 'GET', path, init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const h = handlers[`${call.method} ${path}`] ?? handlers[`${call.method} *`] ?? handlers['*'];
    let out = typeof h === 'function' ? h(call) : h;
    if (out === undefined) out = { status: 404, body: { ok: false, error: 'Not available', reason: 'not_available' } };
    return Promise.resolve(out).then((o) => {
      if (o === 'hang') return new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
      if (o === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      const text = typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
      return { ok: o.status >= 200 && o.status < 300, status: o.status, text: () => Promise.resolve(text) };
    });
  };
  return { fetch, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}
const ok = (body) => ({ status: 200, body: { ok: true, ...body } });
const refuse = (status, reason) => ({ status, body: { ok: false, error: 'refused', reason } });

/* fake devices: streams with tracks that remember being stopped, a recorder that answers like a browser's */
function devices({ deny = false, recorder = true } = {}) {
  const streams = [], urls = { created: [], revoked: [] };
  let gum = 0;
  class Track { constructor(kind) { this.kind = kind; this.readyState = 'live'; } stop() { this.readyState = 'ended'; } }
  class Stream { constructor(c) { this.tracks = [new Track('audio'), ...(c.video ? [new Track('video')] : [])]; streams.push(this); } getTracks() { return this.tracks; } }
  class Recorder {
    constructor(stream, o) { this.stream = stream; this.mimeType = o.mimeType; this.state = 'inactive'; }
    static isTypeSupported(t) { return /^(audio\/webm|video\/webm)/.test(t); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])]) }); this.onstop?.(); }
  }
  const navigator = { mediaDevices: { getUserMedia: (c) => { gum += 1; return deny ? Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) : Promise.resolve(new Stream(c)); } } };
  const URLs = { createObjectURL: () => { const u = `blob:unit/${urls.created.length + 1}`; urls.created.push(u); return u; }, revokeObjectURL: (u) => { urls.revoked.push(u); } };
  return { env: { navigator, ...(recorder ? { MediaRecorder: Recorder } : { MediaRecorder: undefined }), URL: URLs, Blob }, streams, urls, gum: () => gum };
}

/* mount the module on a fresh container, signed in as `as` (null: no session); earlier mounts are destroyed first */
const mounted = [];
function setup({ as = TESTER, handlers = {}, capture = devices(), deadlineMs = 15000, token, currentIdentity } = {}) {
  while (mounted.length) mounted.pop().destroy();
  freshDocument();
  const c = clock();
  const container = new El('main', { id: 'eulMount' });
  doc.body.append(container);
  const srv = server(handlers);
  const session = { who: as };
  const ctl = L.mount(container, {
    fetch: srv.fetch, api: 'https://api.mccluster.org', deadlineMs,
    token: token || (() => Promise.resolve(session.who ? tokenFor(session.who) : null)),
    currentIdentity: currentIdentity || (() => session.who),
    setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, now: c.now,
    captureEnv: { ...capture.env, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, setInterval: c.setInterval, clearInterval: c.clearInterval, now: c.now },
    window
  });
  mounted.push(ctl);
  const mainEl = container.querySelector('[data-eul-main]');
  return { ctl, container, main: mainEl, text: () => mainEl.textContent, srv, clock: c, session, capture, doc };
}
const el = (s, sel) => s.container.querySelector(sel);
const click = (s, focusKey) => { const b = el(s, `[data-eul-focus="${focusKey}"]`); assert.ok(b, `no control ${focusKey}`); return fire(b, 'click'); };

/* ================================================================== the page */
test('the page is neutral, noindex and linked from nowhere; it loads only what the member page needs', () => {
  const html = read('action/league.html');
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.doesNotMatch(html, /<link rel="canonical"/, 'no canonical on a page search engines are told to skip');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.doesNotMatch(html, /user-scalable|maximum-scale/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'one h1');
  assert.match(html, /<title>Equity Uprise<\/title>/, 'the static title names no program');
  const visible = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(visible, /Environmental Justice League|Write a song|mission|campaign/i, 'nothing in the static page names the program, a campaign or a mission');
  for (const src of ['/js/backend.js', '/js/eup-league-capture.js', '/js/eup-league-member.js', '/css/eup-league-member.css', '/js/live-content.js']) assert.ok(html.includes(`${src}?v=__STAMP__`), src);
  assert.ok(html.indexOf('src="/js/eup-league-capture.js') < html.indexOf('src="/js/eup-league-member.js'), 'capture loads before the member module');
  assert.ok(html.indexOf('src="/js/backend.js') < html.indexOf('src="/js/eup-league-member.js'), 'the session layer loads before the member module');
  assert.doesNotMatch(html, /tabbar\.js|analytics\.js|world-audio/, 'no bar, no analytics, no soundtrack continuity on a page that records');
  assert.match(html, /<main class="eul" id="eulMount" data-eup-league-member>/);
  assert.doesNotMatch(html.slice(html.indexOf('<body')), /<img|<svg/, 'text headings only: no image or drawn mark in the page body');
  /* linked from no navigation: no published page links to it */
  const pages = [];
  const walk = (d) => { for (const f of readdirSync(join(ROOT, d))) { const rel = d ? `${d}/${f}` : f; if (['node_modules', '.git', '_unfinished', 'docs', 'scripts', 'workers', 'supabase'].includes(f)) continue; const st = statSync(join(ROOT, rel)); if (st.isDirectory()) walk(rel); else if (f.endsWith('.html') && rel !== 'action/league.html') pages.push(rel); } };
  walk('');
  const linking = pages.filter((p) => /(^|[^a-z0-9-])league\.html/.test(read(p)));
  assert.deepEqual(linking, [], 'no page links to the member page');
  const sitemap = read('sitemap.xml');
  assert.doesNotMatch(sitemap, /league\.html/);
});

test('the copies the page carries equal the frozen contract: media table, ceiling, sniffer, limits, prefix, key pattern', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CAP.MEDIA_TYPES)), JSON.parse(JSON.stringify(C.MEDIA.types)));
  assert.equal(CAP.HARD_MAX_BYTES, C.MEDIA.hard_max_bytes);
  for (const v of C.MAGIC_VECTORS) assert.equal(CAP.sniffFamily(C.bytesFromHex(v.hex)), v.family, v.name);
  for (const kind of ['audio', 'video']) for (const t of CAP.RECORDER_TYPES[kind]) { const row = C.mediaType(C.bareMime(t)); assert.ok(row && row.kind === kind, t); }
  assert.equal(H.PREFIX, C.PREFIX.member);
  assert.equal(H.KEY_PATTERN.source, C.PATTERNS.idempotency_key.source);
  assert.deepEqual([H.MAX.title, H.MAX.lyrics, H.MAX.statement, H.MAX.credit_name, H.MAX.credit_role, H.MAX.derivative, H.MAX.credits, H.MAX.media, H.MAX.consent_days],
    [C.LIMITS.text.title, C.LIMITS.text.lyrics, C.LIMITS.text.statement, C.LIMITS.text.credit_name, C.LIMITS.text.credit_role, C.LIMITS.text.derivative_permissions, C.LIMITS.count.credits, C.LIMITS.count.proof_media, C.LIMITS.consent_max_days]);
  assert.deepEqual(H.RIGHTS.map((r) => r.id).concat('derivative_permissions').sort(), Object.keys(C.DOCUMENTS.proof_submit.fields.rights.fields).filter((k) => k !== 'version').sort());
  for (const reason of Object.keys(H.REASONS)) assert.ok(Object.hasOwn(C.HTTP_REASONS, reason) || Object.values(C.ERRORS).some((e) => e.code === reason || e.member_code === reason) || reason.startsWith('module_'), `${reason} is a reason the Worker answers`);
  assert.ok(H.newKey().match(C.PATTERNS.idempotency_key));
});

test('a file is refused before anything is sent unless its type, kind, size and first bytes agree', async () => {
  const rules = { kinds: ['audio'], caps: { audio: 4096, video: 8192 } };
  const webm = new Uint8Array(64); webm.set(C.bytesFromHex(C.MAGIC_VECTORS.find((v) => v.name === 'webm').hex));
  assert.deepEqual(await CAP.inspectFile(new File([webm], 'a.webm', { type: 'audio/webm' }), rules), { ok: true, mime: 'audio/webm', kind: 'audio', bytes: 64, family: 'ebml' });
  assert.match((await CAP.inspectFile(new File(['<html>'], 'a.html', { type: 'text/html' }), rules)).reason, /type is not accepted/);
  assert.match((await CAP.inspectFile(new File([webm], 'a.webm', { type: 'video/webm' }), rules)).reason, /does not take video/);
  assert.match((await CAP.inspectFile(new File([new Uint8Array(5000)], 'a.webm', { type: 'audio/webm' }), rules)).reason, /limit for audio/);
  assert.match((await CAP.inspectFile(new File(['not webm at all'], 'a.webm', { type: 'audio/webm' }), rules)).reason, /contents are not audio\/webm/);
  assert.match((await CAP.inspectFile(new File([], 'a.webm', { type: 'audio/webm' }), rules)).reason, /empty/);
  const wav = C.bytesFromHex(C.MAGIC_VECTORS.find((v) => v.name === 'wav').hex);
  assert.equal((await CAP.inspectFile(new File([wav], 'a.wav', { type: 'audio/x-wav' }), rules)).mime, 'audio/wav', 'a browser alias maps to the table name');
});

/* ================================================================== visibility */
test('signed out: only the neutral state, a sign-in link, and no request at all', async () => {
  const s = setup({ as: null });
  await settle();
  assert.equal(s.srv.calls.length, 0);
  assert.match(s.text(), /Not available/);
  assert.match(s.main.innerHTML, /href="\/account\.html\?next=%2Faction%2Fleague\.html"/);
  assert.doesNotMatch(s.text(), /Environmental Justice League|Write a song|campaign/i);
  assert.equal(s.doc.title, 'Equity Uprise');
});

test('401 and 404 render nothing but the neutral state; a malformed ok answer is not shown either', async () => {
  for (const [answer, kind] of [[refuse(401, 'authentication_required'), 'signed_out'], [refuse(404, 'not_available'), 'not_available'], [ok({ league: { actor: TESTER } }), 'unreadable'], [{ status: 200, body: { league: me() } }, 'unreadable']]) {
    const s = setup({ handlers: { 'GET ': answer } });
    await settle();
    assert.equal(el(s, '[data-eul-unavailable]')?.getAttribute('data-eul-unavailable'), kind, JSON.stringify(answer).slice(0, 80));
    assert.doesNotMatch(s.text(), /Environmental Justice League|Write a song|Test fixture campaign/);
    assert.equal(s.doc.title, 'Equity Uprise');
  }
});

test('an answer for another account than the session is never rendered', async () => {
  const s = setup({ handlers: { 'GET ': ok({ league: me({ actor: TESTER_B }) }) } });
  await settle();
  assert.equal(el(s, '[data-eul-unavailable]')?.getAttribute('data-eul-unavailable'), 'unreadable');
  assert.doesNotMatch(s.text(), /Test fixture campaign/);
});

test('ok: the League renders, every read is a request, and requests carry the transport rules', async () => {
  const s = setup({ handlers: { 'GET ': ok({ league: me() }) } });
  await settle();
  assert.match(s.text(), /Environmental Justice League/);
  assert.match(s.text(), /Write a song for a healthier world/);
  assert.equal(s.doc.title, 'Environmental Justice League · Equity Uprise');
  click(s, 'reload'); await settle();
  assert.equal(s.srv.calls.filter((c) => c.path === '').length, 2, 'the read is asked again, never cached');
  const init = s.srv.calls[0].init;
  assert.deepEqual([init.credentials, init.cache, init.redirect, init.headers.authorization], ['omit', 'no-store', 'error', `Bearer ${tokenFor(TESTER)}`]);
});

/* ================================================================== the identity guard */
test('a command without a captured identity throws before anything is sent', () => {
  const calls = [];
  const send = H.makeTransport({ api: 'https://api.mccluster.org', fetch: (...a) => { calls.push(a); return new Promise(() => {}); }, token: () => Promise.resolve(tokenFor(TESTER)), currentIdentity: () => TESTER,
    epoch: () => 0, deadline: () => 1000, setTimeout, clearTimeout });
  assert.throws(() => send({ method: 'POST', path: `${C.PREFIX.member}/assignments/${IDS.assignment}/withdraw`, body: { idempotency_key: 'k-12345678' }, epoch: 0 }), /identity captured when it was confirmed/);
  assert.throws(() => send({ method: 'POST', path: '/x', body: {}, identity: 'not-a-uuid', epoch: 0 }), /identity/);
  assert.equal(calls.length, 0);
});

test('the session changes while the token is being acquired: nothing is sent and the page is cleared', async () => {
  /* confirm sees the tester; by the time the token is in hand the browser holds another account's session (a sign-in in
     another tab landing in between) */
  const state = { who: TESTER, race: false };
  const s = setup({
    handlers: { 'GET ': (c) => (c.init.headers.authorization === `Bearer ${tokenFor(TESTER)}` ? ok({ league: me({ assignments: [assignment({ status: 'offered', accepted_requirements_revision: null })] }) }) : refuse(404, 'not_available')) },
    token: () => { if (state.race) state.who = TESTER_B; return Promise.resolve(tokenFor(state.who)); },
    currentIdentity: () => state.who
  });
  await settle();
  assert.ok(el(s, `[data-eul-focus="accept:${IDS.assignment}"]`));
  state.race = true;
  const epoch = s.ctl.epoch();
  click(s, `accept:${IDS.assignment}`);
  await settle();
  await s.clock.advance(1);
  assert.equal(s.srv.posts().length, 0, 'no command left the page');
  assert.ok(s.ctl.epoch() > epoch, 'the page was invalidated');
  assert.doesNotMatch(s.text(), /Write a song/);
  assert.equal(el(s, '[data-eul-unavailable]')?.getAttribute('data-eul-unavailable'), 'not_available', 'it now shows what the other account may see');
});

test('a session that changed before confirm: the confirm check sends nothing and clears the page', async () => {
  const s = setup({ handlers: { 'GET ': ok({ league: me({ assignments: [assignment()] }) }) } });
  await settle();
  s.session.who = TESTER_B; // the stored session changed with no event
  const epoch = s.ctl.epoch();
  click(s, `assign-withdraw:${IDS.assignment}`);
  /* caught in the same task as the tap: no key minted, nothing shown as sending, the page already cleared */
  assert.ok(s.ctl.epoch() > epoch, 'invalidated synchronously at confirm');
  assert.doesNotMatch(s.text(), /sending|Write a song/);
  await settle();
  assert.equal(s.srv.posts().length, 0);
  assert.doesNotMatch(s.text(), /Write a song/);
});

/* ================================================================== the epoch */
test('an account change clears the private DOM, aborts requests, stops the recorder and revokes URLs, and sends nothing after', async () => {
  const cap = devices();
  const s = setup({ capture: cap, handlers: { 'GET ': ok({ league: me({ assignments: [assignment({ draft: { assignment_id: IDS.assignment, revision: 1, updated_at: AT, document: { title: 'T', lyrics: 'Private unit lyric' } } })] }) }), [`POST assignments/${IDS.assignment}/draft`]: 'hang' } });
  await settle();
  assert.match(s.main.innerHTML, /Private unit lyric/);
  s.ctl.act('record', { assignment: IDS.assignment, kind: 'audio' });
  await settle();
  assert.equal(cap.streams.length, 1);
  s.ctl.bind('lyrics', { assignment: IDS.assignment }, { value: 'Private unit lyric, edited' });
  await s.clock.advance(H.AUTOSAVE_MS);
  const pending = s.srv.posts().find((c) => c.path.endsWith('/draft'));
  assert.ok(pending, 'the autosave is in flight');
  assert.equal(s.ctl.inflight(), 1);
  s.session.who = TESTER_B;
  s.srv.calls.length = 0;
  window.dispatchEvent({ type: 'mcc:auth-changed' });
  assert.doesNotMatch(s.main.innerHTML, /Private unit lyric|Write a song/, 'cleared in the same task');
  assert.equal(pending.init.signal.aborted, true, 'the in-flight request was aborted');
  assert.ok(cap.streams.every((x) => x.tracks.every((t) => t.readyState === 'ended')), 'every track stopped');
  await s.clock.advance(1);
  assert.deepEqual(s.srv.calls.map((c) => [c.method, c.path, c.init.headers.authorization]), [['GET', '', `Bearer ${tokenFor(TESTER_B)}`]], 'only the new account\'s read, nothing for the old work');
});

test('a stored session for another account clears the page; the same account with a refreshed token does not; a restored page does', async () => {
  const s = setup({ handlers: { 'GET ': ok({ league: me({ assignments: [assignment()] }) }) } });
  await settle();
  const e0 = s.ctl.epoch();
  window.dispatchEvent({ type: 'storage', key: 'mccdb_session' }); // same account: a refreshed token
  assert.equal(s.ctl.epoch(), e0);
  window.dispatchEvent({ type: 'storage', key: 'unrelated' });
  assert.equal(s.ctl.epoch(), e0);
  s.session.who = TESTER_B;
  window.dispatchEvent({ type: 'storage', key: 'mccdb_session' });
  assert.ok(s.ctl.epoch() > e0);
  assert.doesNotMatch(s.main.innerHTML, /Write a song/);
  s.session.who = TESTER;
  await settle();
  const e1 = s.ctl.epoch();
  window.dispatchEvent({ type: 'pageshow', persisted: false });
  assert.equal(s.ctl.epoch(), e1);
  window.dispatchEvent({ type: 'pageshow', persisted: true });
  assert.ok(s.ctl.epoch() > e1);
  s.ctl.destroy();
});

/* ================================================================== unknown outcomes */
test('a write that times out shows outcome unknown, reads its receipt, and is never resent on its own', async () => {
  let receipt = refuse(404, 'not_available');
  const s = setup({ deadlineMs: 5000, handlers: { 'GET ': ok({ league: me({ assignments: [assignment({ status: 'offered', accepted_requirements_revision: null })] }) }), [`POST assignments/${IDS.assignment}/accept`]: 'hang', 'GET *': () => receipt } });
  await settle();
  click(s, `accept:${IDS.assignment}`);
  await settle();
  assert.match(s.text(), /Accepting the requirements: sending/);
  await s.clock.advance(5000);
  const sent = s.srv.posts();
  assert.equal(sent.length, 1);
  const k = sent[0].body.idempotency_key;
  const receiptRead = s.srv.calls.find((c) => c.path === `receipts/assignments.accept/${k}`);
  assert.ok(receiptRead, 'the receipt of that key was read');
  assert.match(s.text(), /Outcome unknown: Accepting the requirements: not recorded as of .* \(its key is not on record\)\. Nothing was resent\./);
  await s.clock.advance(60000);
  assert.equal(s.srv.posts().length, 1, 'nothing was resent while time passed');
  /* the explicit resend carries the same key and body */
  s.srv.calls.length = 0;
  receipt = ok({ receipt: { surface: 'member', operation: 'assignments.accept', idempotency_key: k, result: {}, created_at: AT } });
  click(s, `resend:accept:${IDS.assignment}`);
  await s.clock.advance(5000);
  const again = s.srv.posts();
  assert.equal(again.length, 1);
  assert.deepEqual(again[0].body, sent[0].body, 'the same key and the same body, by an explicit tap');
  assert.match(s.text(), /it was recorded \(its key was found/);
});

test('a lost connection after the commit: unknown, then the receipt says recorded, and it was not resent', async () => {
  const s = setup({ handlers: { 'GET ': ok({ league: me({ assignments: [assignment({ status: 'offered', accepted_requirements_revision: null })] }) }), [`POST assignments/${IDS.assignment}/accept`]: 'network',
    'GET *': (c) => ok({ receipt: { surface: 'member', operation: 'assignments.accept', idempotency_key: c.path.split('/').pop(), result: {}, created_at: AT } }) } });
  await settle();
  click(s, `accept:${IDS.assignment}`);
  await settle();
  assert.equal(s.srv.posts().length, 1);
  assert.match(s.text(), /it was recorded \(its key was found .*\)\. It was not resent\./);
});

test('refusals are settled and said in words: entitlement never mentions paying; draining keeps reduce-only actions', async () => {
  const s = setup({ handlers: { 'GET ': ok({ league: me({ assignments: [assignment({ status: 'offered', accepted_requirements_revision: null })] }) }), [`POST assignments/${IDS.assignment}/accept`]: refuse(403, 'entitlement_required') } });
  await settle();
  click(s, `accept:${IDS.assignment}`); await settle();
  assert.match(s.text(), /Taking part is not open yet under the League.s current settings\. Nothing was changed\./);
  assert.doesNotMatch(s.text(), /pay|purchase|buy|upgrade|subscri|price/i);
  const t = setup({ handlers: { 'GET ': ok({ league: me({ assignments: [assignment({ status: 'offered', accepted_requirements_revision: null })] }) }), [`POST assignments/${IDS.assignment}/accept`]: refuse(503, 'module_draining') } });
  await settle();
  click(t, `accept:${IDS.assignment}`); await settle();
  assert.match(t.text(), /New work is stopped while the League is draining\. Your records, withdrawals and revocations stay open\./);
  assert.equal(el(t, `[data-eul-focus="assign-withdraw:${IDS.assignment}"]`)?.getAttribute('aria-disabled'), null, 'withdrawal stays open');
});

/* ================================================================== requirements changed, autosave */
test('requirements_changed (EU013) on a save asks to accept the current requirements again and keeps the text', async () => {
  let state = 'accepted';
  const offered = () => assignment(state === 'accepted' ? {} : { status: 'offered', accepted_requirements_revision: 1, offered_requirements_revision: 2, mission: card({ requirements_revision: 2, requirements: 'Test fixture requirements, version 2.' }) });
  const s = setup({ handlers: { 'GET ': () => ok({ league: me({ assignments: [offered()] }) }), [`POST assignments/${IDS.assignment}/draft`]: () => { state = 'offered'; return refuse(409, 'requirements_changed'); } } });
  await settle();
  s.ctl.bind('lyrics', { assignment: IDS.assignment }, { value: 'Unit lyric typed before the change' });
  await s.clock.advance(H.AUTOSAVE_MS);
  assert.match(s.text(), /The requirements changed after you accepted them \(you accepted version 1; the current version is 2\)/);
  assert.ok(el(s, `[data-eul-focus="accept:${IDS.assignment}"]`), 'the accept prompt is offered');
  assert.match(s.text(), /Accept the current requirements/);
  assert.equal(s.ctl.model().work[IDS.assignment].doc.lyrics, 'Unit lyric typed before the change', 'the text is kept');
  assert.equal(s.ctl.model().work[IDS.assignment].status, 'blocked');
});

test('autosave is debounced, compares and swaps the draft revision, and a conflict keeps the text and asks', async () => {
  let rev = 3;
  const draft = { assignment_id: IDS.assignment, revision: 3, updated_at: AT, document: { title: 'T', lyrics: 'Saved line' } };
  const s = setup({ handlers: { 'GET ': () => ok({ league: me({ assignments: [assignment({ draft: { ...draft, revision: rev } })] }) }),
    [`POST assignments/${IDS.assignment}/draft`]: (c) => (c.body.expected_revision === rev ? (rev += 1, ok({ draft: { assignment_id: IDS.assignment, revision: rev, updated_at: AT } })) : refuse(409, 'revision_conflict')) } });
  await settle();
  for (const v of ['a', 'ab', 'abc']) { s.ctl.bind('lyrics', { assignment: IDS.assignment }, { value: v }); await s.clock.advance(400); }
  assert.equal(s.srv.posts().length, 0, 'no save while typing');
  await s.clock.advance(H.AUTOSAVE_MS);
  const saves = s.srv.posts();
  assert.equal(saves.length, 1, 'one save after the pause');
  assert.equal(saves[0].body.expected_revision, 3);
  assert.equal(saves[0].body.draft.lyrics, 'abc');
  assert.match(el(s, `[data-eul-save="${IDS.assignment}"]`).textContent, /^Saved\./);
  rev = 9; // another device saved meanwhile
  s.ctl.bind('lyrics', { assignment: IDS.assignment }, { value: 'abcd' });
  await s.clock.advance(H.AUTOSAVE_MS);
  assert.equal(s.ctl.model().work[IDS.assignment].status, 'conflict');
  assert.match(s.text(), /Not saved: this draft changed on another device or tab\. Your text here is kept and was not saved\. Choose which version to keep\./);
  assert.ok(el(s, `[data-eul-focus="draft-load:${IDS.assignment}"]`) && el(s, `[data-eul-focus="draft-overwrite:${IDS.assignment}"]`));
  const before = s.srv.posts().length;
  s.ctl.bind('lyrics', { assignment: IDS.assignment }, { value: 'abcde' });
  await s.clock.advance(H.AUTOSAVE_MS * 3);
  assert.equal(s.srv.posts().length, before, 'autosave waits while the conflict is open');
  click(s, `draft-overwrite:${IDS.assignment}`);
  await s.clock.advance(10);
  const last = s.srv.posts().at(-1);
  assert.deepEqual([last.body.expected_revision, last.body.draft.lyrics], [9, 'abcde'], 'keeping my version saves it over the revision read just now');
});

test('a draft save with no answer: unknown, receipt read, autosave waits for the person', async () => {
  const s = setup({ deadlineMs: 3000, handlers: { 'GET ': ok({ league: me({ assignments: [assignment()] }) }), [`POST assignments/${IDS.assignment}/draft`]: 'hang' } });
  await settle();
  s.ctl.bind('lyrics', { assignment: IDS.assignment }, { value: 'Unit lyric' });
  await s.clock.advance(H.AUTOSAVE_MS + 3000);
  assert.ok(s.srv.calls.some((c) => c.path.startsWith('receipts/drafts.save/')));
  assert.equal(s.ctl.model().work[IDS.assignment].status, 'unknown');
  assert.match(s.text(), /It was not saved as of .* \(its key is not on record\)\. Nothing was resent; autosave waits for you\./);
  s.ctl.bind('lyrics', { assignment: IDS.assignment }, { value: 'Unit lyric, more' });
  await s.clock.advance(H.AUTOSAVE_MS * 4);
  assert.equal(s.srv.posts().length, 1, 'no automatic resend and no new save until the person decides');
});

/* ================================================================== capture */
test('no device is asked for on mount or render; only the Record handler asks', async () => {
  const cap = devices();
  const s = setup({ capture: cap, handlers: { 'GET ': ok({ league: me({ assignments: [assignment()] }) }) } });
  await settle();
  click(s, 'reload'); await settle();
  s.ctl.bind('title', { assignment: IDS.assignment }, { value: 'x' });
  s.ctl.act('path', { assignment: IDS.assignment, path: 'statement' }); await settle();
  s.ctl.act('path', { assignment: IDS.assignment, path: 'media' }); await settle();
  assert.equal(cap.gum(), 0);
  assert.ok(el(s, `[data-eul-focus="record:audio:${IDS.assignment}"]`) && el(s, `[data-eul-focus="record:video:${IDS.assignment}"]`));
  click(s, `record:audio:${IDS.assignment}`);
  await settle();
  assert.equal(cap.gum(), 1);
  assert.ok(el(s, '[data-eul-recording]'));
});

test('permission denied: said in words, and the file upload and the written statement stay open (focus goes to the upload)', async () => {
  const cap = devices({ deny: true });
  const s = setup({ capture: cap, handlers: { 'GET ': ok({ league: me({ assignments: [assignment()] }) }) } });
  await settle();
  click(s, `record:video:${IDS.assignment}`);
  await settle();
  assert.match(s.text(), /Camera or microphone permission was not given, so nothing was recorded\. You can upload a file instead, or write a statement\./);
  const file = el(s, `[data-eul-focus="file:${IDS.assignment}"]`), statement = el(s, `[data-eul-focus="path:statement:${IDS.assignment}"]`);
  assert.ok(file && !file.disabled, 'the upload is open');
  assert.ok(statement && statement.getAttribute('aria-disabled') === null, 'the statement path is open');
  assert.equal(s.doc.activeElement, file, 'focus goes to the upload');
});

test('retake and cancel release every track and revoke every object URL', async () => {
  const cap = devices();
  const s = setup({ capture: cap, handlers: { 'GET ': ok({ league: me({ assignments: [assignment()] }) }) } });
  await settle();
  click(s, `record:audio:${IDS.assignment}`); await settle();
  await s.clock.advance(2000);
  click(s, `stop:${IDS.assignment}`); await settle();
  assert.ok(el(s, '[data-eul-preview]'));
  assert.equal(el(s, '[data-eul-preview-player]').src, 'blob:unit/1', 'the preview plays the local take');
  assert.doesNotMatch(s.main.innerHTML.replace(/ src="blob:unit\/\d+"/g, ''), /blob:unit/, 'the object URL is set as a property, not written into the markup');
  click(s, `retake:${IDS.assignment}`); await settle();
  assert.equal(cap.gum(), 2);
  assert.ok(cap.streams[0].tracks.every((t) => t.readyState === 'ended'));
  assert.deepEqual(cap.urls.revoked, ['blob:unit/1']);
  await s.clock.advance(1500);
  click(s, `stop:${IDS.assignment}`); await settle();
  click(s, `cancel-take:${IDS.assignment}`); await settle();
  assert.ok(cap.streams.every((x) => x.tracks.every((t) => t.readyState === 'ended')));
  assert.deepEqual(cap.urls.revoked.sort(), cap.urls.created.sort());
  assert.equal(el(s, '[data-eul-preview]'), null);
});

test('no MediaRecorder: no Record buttons, the file upload and the statement only, and it says why', async () => {
  const cap = devices({ recorder: false });
  const s = setup({ capture: cap, handlers: { 'GET ': ok({ league: me({ assignments: [assignment()] }) }) } });
  await settle();
  assert.equal(el(s, `[data-eul-focus="record:audio:${IDS.assignment}"]`), null);
  assert.equal(el(s, `[data-eul-focus="record:video:${IDS.assignment}"]`), null);
  assert.ok(el(s, `[data-eul-focus="file:${IDS.assignment}"]`));
  assert.ok(el(s, `[data-eul-focus="path:statement:${IDS.assignment}"]`));
  assert.match(s.text(), /Recording is not available in this browser\. Upload a file, or write a statement instead\./);
  assert.equal(cap.gum(), 0);
});

/* ================================================================== conformance: every request is a contract route */
function checkRequest(call) {
  const rest = call.path;
  const hit = C.matchRoute('member', call.method, rest);
  assert.ok(hit, `${call.method} ${rest} is a member route`);
  const { route } = hit;
  if (call.method === 'GET') return route;
  const body = call.body;
  assert.equal(C.refusedMemberField(body), null, `${route.action}: no account-naming field`);
  if (route.idempotency_key) assert.match(body.idempotency_key, C.PATTERNS.idempotency_key, `${route.action}: key`);
  if (route.expected_revision) assert.ok(Number.isSafeInteger(body.expected_revision) && body.expected_revision >= route.revision_min, `${route.action}: expected revision`);
  const spec = route.rpc === 'member' ? C.MEMBER_ACTIONS[route.action] : null;
  if (spec && spec.document) {
    const document = route.wrapper ? { ...(body[route.wrapper] || {}) } : {};
    for (const f of route.fields) if (body[f] !== undefined) document[f] = body[f];
    Object.assign(document, route.fixed);
    assert.equal(C.checkDocument(C.DOCUMENTS[spec.document], document), null, `${route.action}: ${JSON.stringify(document).slice(0, 200)}`);
  }
  return route;
}
test('every request the module sends is a member route of the contract, with a valid document, a key and a revision where required', async () => {
  const upload = sealed();
  const proof = { id: IDS.proof, assignment_id: IDS.assignment, revision: 1, state: 'accepted', reviewed_revision: 1, asset_revision: SHA, moderation_state: 'clear', publication_state: 'private',
    document: {}, media: [], reviews: [], consents: [{ id: IDS.consent, proof_id: IDS.proof, proof_revision: 1, asset_revision: SHA, purpose: 'publish_proof', audience: 'released_audience', notice_revision: 'unit-publication-1', state: 'open', granted_at: AT, expires_at: '2026-12-01T23:59:59Z', revoked_at: null, superseded_at: null }],
    publication: null, appeals: [], created_at: AT, updated_at: AT };
  const working = assignment({ uploads: [upload], draft: { assignment_id: IDS.assignment, revision: 2, updated_at: AT, document: { title: 'Unit song', lyrics: 'Line one\nLine two', credits: [{ name: 'Unit Writer', role: 'lyrics' }], media: [IDS.upload],
    rights: { version: 'music-rights-v1', owns_master: true, controls_composition: true, samples_cleared: true, collaborators_cleared: true, parody_or_derivative: false, derivative_permissions: '' } } } });
  const second = { ...working, id: '0b000000-0000-4000-8000-000000000010', mission: card(), status: 'completed', proof, uploads: [], draft: null };
  const declined = { id: '0b000000-0000-4000-8000-000000000011', mission_id: '0b000000-0000-4000-8000-000000000012', requirements_revision: 1, status: 'declined', revision: 3, accommodation_requested: false, recorded: false, created_at: AT, updated_at: AT,
    mission: card({ id: '0b000000-0000-4000-8000-000000000012' }), document: { statement: 'x' }, accommodation: null, decisions: [{ decision: 'declined', reason: 'Test fixture reason.', rubric: [], decided_at: AT }], appeals: [] };
  const league = me({ assignments: [working, second], applications: [declined] });
  const echo = { 'GET ': ok({ league }), 'POST *': (c) => ok({ application: { revision: 1, status: 'draft' }, draft: { revision: 3 }, upload: { ...upload, state: 'staged' }, grant: null, proof: {}, consent: {}, assignment: {}, appeal: {} }), 'GET *': ok({ media: {}, url: 'https://storage.invalid/x', expires_in: 300 }) };
  const s = setup({ handlers: echo });
  await settle();
  s.ctl.act('apply-open', { mission: IDS.mission });
  s.ctl.bind('sheet-statement', {}, { value: 'Unit statement' });
  s.ctl.bind('sheet-acc', {}, { type: 'checkbox', checked: true });
  s.ctl.bind('sheet-acc-text', {}, { value: 'Unit accommodation request' });
  s.ctl.act('sheet-save'); await settle();
  s.ctl.act('sheet-submit'); await settle();
  s.ctl.bind('lyrics', { assignment: IDS.assignment }, { value: 'Line one\nLine two\nLine three' }); await s.clock.advance(H.AUTOSAVE_MS);
  s.ctl.act('submit-proof', { assignment: IDS.assignment }); await settle();
  s.ctl.act('path', { assignment: IDS.assignment, path: 'statement' });
  s.ctl.bind('statement', { assignment: IDS.assignment }, { value: 'Unit statement: I cannot record.' }); await s.clock.advance(H.AUTOSAVE_MS);
  s.ctl.act('play', { upload: IDS.upload }); await settle();
  s.ctl.act('discard', { upload: IDS.upload, assignment: IDS.assignment }); await settle();
  s.ctl.act('assign-withdraw', { assignment: IDS.assignment }); await settle();
  s.ctl.act('app-withdraw', { application: declined.id }); await settle();
  s.ctl.bind('appeal', { subjectId: declined.id }, { value: 'Unit appeal statement.' });
  s.ctl.act('appeal-open', { subject: 'application', subjectId: declined.id }); await settle();
  s.ctl.bind('consent-date', { proof: IDS.proof }, { type: 'date', value: '2026-12-01' });
  s.ctl.act('consent-revoke', { consent: IDS.consent, proof: IDS.proof }); await settle();
  const actions = new Set(s.srv.calls.map(checkRequest).map((r) => r.action));
  for (const a of ['me.get', 'applications.save', 'drafts.save', 'proofs.submit', 'uploads.get', 'uploads.discard', 'assignments.withdraw', 'applications.withdraw', 'appeals.open', 'consents.revoke']) assert.ok(actions.has(a), `${a} was exercised`);
  const proofCall = s.srv.posts().find((c) => c.path.endsWith('/proof'));
  assert.deepEqual(proofCall.body.proof.media, [{ upload_id: IDS.upload, sha256: SHA }], 'the proof names the sealed take by the fingerprint the person was shown');
  assert.equal(proofCall.body.proof.review_notice_revision, POLICY.notices.private_review.revision);
  const statementDraft = s.srv.posts().filter((c) => c.path.endsWith('/draft')).at(-1);
  assert.deepEqual(statementDraft.body.draft.accommodation, { statement: 'Unit statement: I cannot record.' });
  /* consent grant and accept, built from their own fixtures */
  const g = setup({ handlers: { 'GET ': ok({ league: me({ assignments: [{ ...second, proof: { ...proof, consents: [] } }, assignment({ id: '0b000000-0000-4000-8000-000000000013', status: 'offered', accepted_requirements_revision: null })] }) }), 'POST *': ok({}) } });
  await settle();
  g.ctl.bind('consent-date', { proof: IDS.proof }, { type: 'date', value: new Date(g.clock.now() + 30 * 86400000).toISOString().slice(0, 10) });
  g.ctl.act('consent-grant', { assignment: second.id, proof: IDS.proof }); await settle();
  g.ctl.act('accept', { assignment: '0b000000-0000-4000-8000-000000000013' }); await settle();
  const more = new Set(g.srv.calls.map(checkRequest).map((r) => r.action));
  assert.ok(more.has('consents.grant') && more.has('assignments.accept'));
  const consent = g.srv.posts().find((c) => c.path.endsWith('/consent')).body.consent;
  assert.match(consent.expires_at, /T23:59:59Z$/);
  assert.equal(consent.notice_revision, POLICY.notices.publication.revision);
});

test('the consent window is tomorrow to 365 days ahead (inside the 366 the contract allows), end of day UTC', () => {
  const now = Date.UTC(2026, 10, 10, 15, 30);
  assert.deepEqual(H.consentWindow(now), { min: '2026-11-11', max: '2027-11-10' });
  assert.equal(H.consentExpiry('2026-11-10', now), null);
  assert.equal(H.consentExpiry('2026-11-11', now), '2026-11-11T23:59:59Z');
  assert.equal(H.consentExpiry('2027-11-11', now), null);
  assert.ok(Date.parse(H.consentExpiry('2027-11-10', now)) <= now + C.LIMITS.consent_max_days * 86400000);
});

/* ================================================================== text, readiness, escaping, storage, console */
test('server text is escaped; nothing a member wrote becomes markup', async () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const s = setup({ handlers: { 'GET ': ok({ league: me({ catalogue: [{ ...me().catalogue[0], title: hostile, missions: [card({ title: hostile, requirements: hostile })] }],
    assignments: [assignment({ draft: { assignment_id: IDS.assignment, revision: 1, updated_at: AT, document: { title: hostile, lyrics: hostile } } })] }) }) } });
  await settle();
  assert.equal(s.main.querySelectorAll('img').length, 0);
  assert.ok(s.text().includes(hostile), 'shown as text');
});

test('an unconfigured League offers no new work and nothing to buy; withdrawals stay open', async () => {
  const s = setup({ handlers: { 'GET ': ok({ league: me({ policy: null, assignments: [assignment({ status: 'offered', accepted_requirements_revision: null })] }) }) } });
  await settle();
  assert.match(s.text(), /The League is not set up for taking part yet\. Your own records stay readable here\./);
  assert.equal(el(s, `[data-eul-focus="apply:${IDS.mission}"]`).getAttribute('aria-disabled'), 'true');
  assert.equal(el(s, `[data-eul-focus="accept:${IDS.assignment}"]`).getAttribute('aria-disabled'), 'true');
  assert.equal(el(s, `[data-eul-focus="assign-withdraw:${IDS.assignment}"]`).getAttribute('aria-disabled'), null);
  /* a refused button is reachable, its reason is text beside it, and pressing it says why and sends nothing */
  const accept = el(s, `[data-eul-focus="accept:${IDS.assignment}"]`);
  const reason = s.container.querySelector(`[id="${accept.getAttribute('aria-describedby')}"]`);
  assert.ok(reason && /not set up/.test(reason.textContent));
  fire(accept, 'click');
  assert.match(el(s, '[data-eul-announce]').textContent, /not set up/);
  assert.equal(s.srv.posts().length, 0);
  const entitlement = setup({ handlers: { 'GET ': ok({ league: me({ policy: { ...POLICY, entitlement: 'not_decided' } }) }) } });
  await settle();
  assert.match(entitlement.text(), /Taking part is not open yet under the League.s current settings\./);
  assert.doesNotMatch(entitlement.text(), /pay|purchase|buy|upgrade|subscri|price|plan\b/i);
});

test('the scripts never write League data or links to browser storage or the console', async () => {
  window.localStorage.writes.length = 0; window.sessionStorage.writes.length = 0;
  const before = consoleWrites.length;
  const s = setup({ handlers: { 'GET ': ok({ league: me({ assignments: [assignment({ uploads: [sealed()] })] }) }), 'GET *': ok({ media: {}, url: 'https://storage.invalid/object/sign/x?token=unit-secret', expires_in: 300 }), 'POST *': ok({ draft: { revision: 1 } }) } });
  await settle();
  s.ctl.act('play', { upload: IDS.upload }); await settle();
  s.ctl.bind('lyrics', { assignment: IDS.assignment }, { value: 'Private' }); await s.clock.advance(H.AUTOSAVE_MS);
  assert.equal(el(s, `[data-eul-player="${IDS.upload}"]`).src, 'https://storage.invalid/object/sign/x?token=unit-secret', 'the signed link lives in the media element only');
  assert.doesNotMatch(s.text(), /token=|object\/sign/);
  assert.deepEqual([window.localStorage.writes, window.sessionStorage.writes], [[], []]);
  assert.equal(consoleWrites.length, before);
  await s.clock.advance(300000);
  assert.equal(el(s, `[data-eul-player="${IDS.upload}"]`).getAttribute('src'), null, 'dropped at its expiry');
  for (const f of ['js/eup-league-member.js', 'js/eup-league-capture.js']) assert.doesNotMatch(read(f), /console\s*\.\s*(log|info|warn|error|debug|trace)\s*\(|localStorage\.setItem|sessionStorage\.setItem/, f);
});

test('copy sells nothing, names no mark, and keeps the two entities apart', () => {
  for (const f of ['js/eup-league-member.js', 'js/eup-league-capture.js', 'action/league.html', 'css/eup-league-member.css']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(src, /\b(buy|purchase|upgrade|pricing|subscribe|subscription|checkout|payment|payout|points)\b/i, f);
    assert.doesNotMatch(src, /E=Up|Human Uprise|Matthew/, f);
  }
});

test('the stylesheet is phone first: min-width queries only, minmax(0, 1fr) tracks, 16px form text, 44px targets', () => {
  const css = read('css/eup-league-member.css');
  assert.doesNotMatch(css, /@media[^{]*max-width/);
  for (const [, value] of css.matchAll(/grid-template-columns\s*:\s*([^;}]*)/g)) assert.doesNotMatch(value.replace(/minmax\([^()]*(\([^()]*\)[^()]*)*\)/g, ''), /\b1fr\b/, value);
  assert.match(css, /font: 600 max\(16px, 1rem\)/);
  assert.match(css, /font: 400 max\(16px, 1rem\)\/1\.5/);
  assert.match(css, /min-height: 44px; min-width: 44px/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*eul-pulse/);
});
