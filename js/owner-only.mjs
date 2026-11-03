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
   tab, the session expired), the page reloads and shows the gate again, so nothing stays on screen. */

export const API_ORIGIN = 'https://api.mccluster.org';
export const SESSION_KEY = 'mccdb_session';
const HOUSE = new URL('../', import.meta.url);

export function storedToken(storage) {
  try {
    const s = JSON.parse((storage || globalThis.localStorage).getItem(SESSION_KEY) || 'null');
    return s && typeof s.access_token === 'string' && s.access_token ? s.access_token : null;
  } catch (e) { return null; }
}

/* resolves { owner: boolean, reason } and never throws */
export async function checkOwner({ fetchImpl = globalThis.fetch, storage, timeoutMs = 5000, auth = globalThis.MCC } = {}) {
  let token = storedToken(storage);
  if (!token) return { owner: false, reason: 'signed-out' };
  // the canonical auth helper refreshes an expired session when the page has it (js/mcc-auth.js, loaded by the bar)
  if (auth && typeof auth.refreshIfNeeded === 'function') {
    try { const s = await auth.refreshIfNeeded(); if (s && s.access_token) token = s.access_token; } catch (e) { /* keep the stored token */ }
  }
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(API_ORIGIN + '/v1/status', { headers: { authorization: 'Bearer ' + token }, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    return r && r.ok ? { owner: true, reason: 'owner' } : { owner: false, reason: r && (r.status === 401 || r.status === 403) ? 'not-owner' : 'unavailable' };
  } catch (e) {
    return { owner: false, reason: 'unavailable' };
  } finally { if (timer) clearTimeout(timer); }
}

export const GATE_TEXT = Object.freeze({
  'checking': 'Checking access with the server…',
  'signed-out': 'Sign in with the house owner’s account to open this.',
  'not-owner': 'This is the house owner’s.',
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

/* run one gated page; resolves to the first answer. Exposed for tests; the page itself is wired at the bottom. */
export function guardPage(gate, { doc = globalThis.document, win = globalThis, check = checkOwner, reload = () => win.location.reload() } = {}) {
  const msg = gate.querySelector('[data-owner-msg]') || gate;
  let open = false, checking = null;
  doc.documentElement.dataset.ownerAccess = 'checking';
  msg.innerHTML = gateMessage('checking');

  async function unlock() {
    open = true;
    doc.documentElement.dataset.ownerAccess = 'open';
    const tpl = gate.dataset.ownerTemplate ? doc.getElementById(gate.dataset.ownerTemplate) : null;
    if (tpl && tpl.content) tpl.replaceWith(tpl.content.cloneNode(true));
    gate.remove();
    try {
      for (const item of loadList(gate.dataset.ownerLoad, doc.baseURI)) {
        if (item.module) await import(item.url); else await classic(doc, item.url);
      }
      win.dispatchEvent(new CustomEvent('mcc:owner-open'));
    } catch (e) { console.error(e); }
  }
  function verify() {
    if (checking) return checking;
    checking = Promise.resolve(check()).then((r) => {
      checking = null;
      if (r && r.owner) { if (!open) unlock(); }
      else if (open) reload();
      else { doc.documentElement.dataset.ownerAccess = 'closed'; msg.innerHTML = gateMessage(r && r.reason); }
      return r;
    });
    return checking;
  }
  win.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') verify(); });
  win.addEventListener('storage', (e) => { if (e.key === SESSION_KEY) verify(); });
  win.addEventListener('mcc:auth-changed', () => verify());
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
