/* OWNER ONLY: the games and the PRIM3 learning management system are the house owner's (owner, 2026-11-03: "For the
   game, keep it on my private account. Like all the games, the whole learning management system is going to be on my
   private account ... it should be private to the admin").

   Who the owner is stays the server's answer, never this browser's: GET https://api.mccluster.org/v1/status with the
   signed-in session's token (requireHouseOwner in Worker mccluster), the same check js/tabbar.js and
   js/owner-control-redirect.js make. A 2xx is the owner; anything else (no session, 401, 403, a timeout, the API
   unreachable) is not. Nothing is cached: every page entry and every return to a visible tab asks again.

   A gated page carries nothing but the gate panel and this module:

     <section class="owner-gate" data-owner-gate data-owner-template="appTpl"
              data-owner-load="js/a.js js/b.mjs"> ... <p data-owner-msg>Checking access with the server…</p></section>
     <template id="appTpl"> the page's own markup </template>
     <script type="module" src="js/owner-only.mjs"></script>

   Until the server says yes, the template stays inert (its images, scripts and styles are not fetched) and none of
   the listed scripts load. On yes: the gate goes, the template's markup takes its place, and the scripts load in the
   order listed (a classic script for .js, an ES module for .mjs). If a later check says no (signed out in another
   tab, the session expired), the document is concealed before reload. A restored page rechecks before revealing
   its app. A session change invalidates old checks and stops the remaining script-load sequence. */

export const API_ORIGIN = 'https://api.mccluster.org';
export const SESSION_KEY = 'mccdb_session';
const HOUSE = new URL('../', import.meta.url);

export function storedToken(storage) {
  try {
    const s = JSON.parse((storage || globalThis.localStorage).getItem(SESSION_KEY) || 'null');
    return s && typeof s.access_token === 'string' && s.access_token ? s.access_token : null;
  } catch (e) { return null; }
}

/* The deadline covers refresh as well as fetch. An answer belongs only to the token actually checked.
   This browser gate is presentation, not authorization: every private API still enforces requireHouseOwner. */
export async function checkOwner({ fetchImpl = globalThis.fetch, storage, timeoutMs = 5000, auth = globalThis.MCC } = {}) {
  let token = storedToken(storage);
  if (!token) return { owner: false, reason: 'signed-out' };
  const unavailable = { owner: false, reason: 'unavailable' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 30000) : 5000;
  let expired = false, timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => { expired = true; if (ctl) ctl.abort(); resolve(unavailable); }, budget);
  });
  const sessionChanged = () => ({ owner: false, reason: storedToken(storage) ? 'session-changed' : 'signed-out' });
  const operation = (async () => {
    // The canonical helper persists its refreshed token. Never fall back to a rejected/cleared session.
    if (auth && typeof auth.refreshIfNeeded === 'function') {
      const s = await auth.refreshIfNeeded();
      if (!s || typeof s.access_token !== 'string' || !s.access_token) return { owner: false, reason: 'signed-out' };
      token = s.access_token;
    }
    if (expired) return unavailable;
    if (storedToken(storage) !== token) return sessionChanged();
    const r = await fetchImpl(API_ORIGIN + '/v1/status', {
      headers: { authorization: 'Bearer ' + token }, cache: 'no-store', redirect: 'error',
      signal: ctl ? ctl.signal : undefined
    });
    if (expired) return unavailable;
    if (storedToken(storage) !== token) return sessionChanged();
    return r && r.ok ? { owner: true, reason: 'owner' }
      : { owner: false, reason: r && (r.status === 401 || r.status === 403) ? 'not-owner' : 'unavailable' };
  })().catch(() => unavailable);
  try { return await Promise.race([operation, deadline]); }
  finally { expired = true; clearTimeout(timer); if (ctl) ctl.abort(); }
}

export const GATE_TEXT = Object.freeze({
  'checking': 'Checking access with the server…',
  'signed-out': 'Sign in with the house owner’s account to open this.',
  'not-owner': 'This is the house owner’s.',
  'session-changed': 'Your session changed. Reload to check the current account.',
  'unavailable': 'The owner check could not reach the server. Try again shortly.'
});

/* the gate message as safe markup; the sign-in link resolves against the house so it works from any folder depth */
export function gateMessage(reason) {
  const text = GATE_TEXT[reason] || GATE_TEXT['not-owner'];
  return reason === 'signed-out' ? `${text} <a href="${new URL('account.html', HOUSE).href}">Sign in</a>` : text;
}

/* the list in data-owner-load, resolved against the page */
export function loadList(attr, base) {
  return String(attr || '').split(/\s+/).filter(Boolean).map((src) => {
    const url = new URL(src, base).href;
    return { url, module: /\.mjs$/i.test(new URL(url).pathname) };
  });
}

function classic(doc, url) {
  return new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = url; s.async = false;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load ' + url));
    doc.body.appendChild(s);
  });
}

/* A check is single-flight only within one session generation. Auth/storage changes must never reuse an
   older account's pending response. Revocation conceals the document synchronously, before reload starts. */
export function guardPage(gate, { doc = globalThis.document, win = globalThis, check = checkOwner, reload = () => win.location.reload() } = {}) {
  const msg = gate.querySelector('[data-owner-msg]') || gate;
  const root = doc.documentElement;
  let open = false, ready = false, checking = null, generation = 0, revoked = false;
  let suspended = false, reloadOnRestore = false, concealed = null;
  root.dataset.ownerAccess = 'checking';
  msg.innerHTML = gateMessage('checking');

  function conceal() {
    if (!concealed) concealed = { display: root.style.display, inert: root.inert };
    root.style.display = 'none';
    root.inert = true;
  }
  function reveal() {
    if (!concealed || revoked) return;
    root.style.display = concealed.display;
    root.inert = concealed.inert;
    concealed = null;
  }
  function revoke() {
    if (revoked) return;
    revoked = true; generation++; checking = null;
    root.dataset.ownerAccess = 'closed';
    conceal();
    // A navigation failure must not put the previously authorized app back on screen.
    try { reload(); } catch (e) { /* remain concealed */ }
  }
  async function unlock(ticket) {
    open = true;
    root.dataset.ownerAccess = 'open';
    const tpl = gate.dataset.ownerTemplate ? doc.getElementById(gate.dataset.ownerTemplate) : null;
    if (tpl && tpl.content) tpl.replaceWith(tpl.content.cloneNode(true));
    gate.remove();
    try {
      for (const item of loadList(gate.dataset.ownerLoad, doc.baseURI)) {
        if (revoked || suspended || ticket !== generation) return;
        if (item.module) await import(item.url); else await classic(doc, item.url);
      }
      if (revoked || suspended || ticket !== generation) return;
      ready = true;
      win.dispatchEvent(new CustomEvent('mcc:owner-open'));
    } catch (e) {
      if (!revoked && ticket === generation) root.dataset.ownerAccess = 'error';
      console.error(e);
    }
  }
  function verify() {
    if (revoked || suspended) return Promise.resolve({ owner: false, reason: 'session-changed' });
    if (checking) return checking;
    const ticket = generation;
    const request = Promise.resolve().then(() => check()).catch(() => ({ owner: false, reason: 'unavailable' })).then((r) => {
      if (checking === request) checking = null;
      if (revoked || suspended || ticket !== generation) return { owner: false, reason: 'session-changed' };
      if (r && r.owner === true) {
        reveal();
        if (!open) void unlock(ticket);
      } else if (open) revoke();
      else { reveal(); root.dataset.ownerAccess = 'closed'; msg.innerHTML = gateMessage(r && r.reason); }
      return r;
    });
    checking = request;
    return request;
  }
  function authChanged() {
    generation++; checking = null;
    if (open) revoke();
    else if (!revoked && !suspended) void verify();
  }
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') void verify(); });
  win.addEventListener('storage', (e) => { if (e.key === SESSION_KEY || e.key === null) authChanged(); });
  win.addEventListener('mcc:auth-changed', authChanged);
  win.addEventListener('pagehide', () => {
    suspended = true; generation++; checking = null;
    if (open) { conceal(); reloadOnRestore = !ready; }
  });
  win.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    suspended = false;
    if (reloadOnRestore) revoke(); else void verify();
  });
  return verify();
}

/* one gate per page, even if this module is reached twice under different URLs (a ?v= stamp and a plain import) */
const page = globalThis.document && !globalThis.__mccOwnerGate && globalThis.document.querySelector('section[data-owner-gate]');
if (page) {
  globalThis.__mccOwnerGate = true;
  const g = globalThis.document.createElement('style');
  /* a plain default the page's own styles override (zero specificity) */
  g.textContent = ':where(.owner-gate){display:grid;gap:8px;justify-items:start;box-sizing:border-box;width:min(460px,calc(100% - 32px));margin:12vh auto 0;padding:18px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#11161b;color:#e7ecef;font:500 15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}'
    + ':where(.owner-gate) h1{margin:0;font-size:24px;letter-spacing:.14em;text-transform:uppercase}'
    + ':where(.owner-gate) p{margin:0;color:#a9b4bb}:where(.owner-gate) a{color:inherit}'
    + ':where(.owner-gate__mark){display:block;height:44px;width:auto}';
  globalThis.document.head.appendChild(g);
  guardPage(page);
}
