/* OWNER ONLY. The building's screens, the learning sandbox and the PRIM3 tie-ins are the house owner's for now
   (owner, 2026-11-03: the games and the whole learning management system stay on the owner's private account).

   Same contract as the platform's owner gate (js/owner-only.mjs on the games branch): who the owner is stays the
   server's answer. GET https://api.mccluster.org/v1/status with the signed-in session's bearer token; a 2xx is the
   owner, anything else (no session, 401/403, timeout, API unreachable) is not. Nothing is cached; every entry and
   every return to a visible tab asks again. When js/owner-only.mjs reaches main this module can delegate to it.

   Page shape:
     <section class="owner-gate" data-owner-gate data-owner-template="appTpl"> … <p data-owner-msg>…</p></section>
     <template id="appTpl"> the app's markup </template>
   The template stays inert (nothing fetched, nothing run) until the server says yes. */

export const API_ORIGIN = "https://api.mccluster.org";
export const SESSION_KEY = "mccdb_session";

export function storedToken(storage) {
  try {
    const s = JSON.parse((storage || globalThis.localStorage).getItem(SESSION_KEY) || "null");
    return s && typeof s.access_token === "string" && s.access_token ? s.access_token : null;
  } catch (e) { return null; }
}

export async function checkOwner({ fetchImpl = globalThis.fetch, storage, timeoutMs = 5000, auth = globalThis.MCC } = {}) {
  let token = storedToken(storage);
  if (!token) return { owner: false, reason: "signed-out" };
  if (auth && typeof auth.refreshIfNeeded === "function") {
    try { const s = await auth.refreshIfNeeded(); if (s && s.access_token) token = s.access_token; } catch (e) { /* keep stored */ }
  }
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(API_ORIGIN + "/v1/status", { headers: { authorization: "Bearer " + token }, cache: "no-store", signal: ctl ? ctl.signal : undefined });
    return r && r.ok ? { owner: true, reason: "owner" } : { owner: false, reason: r && (r.status === 401 || r.status === 403) ? "not-owner" : "unavailable" };
  } catch (e) { return { owner: false, reason: "unavailable" }; } finally { if (timer) clearTimeout(timer); }
}

const TEXT = {
  checking: "Checking access with the server…",
  "signed-out": "Sign in with the house owner’s account to open this.",
  "not-owner": "This is the house owner’s.",
  unavailable: "The owner check could not reach the server. Try again shortly.",
};

/* resolves once the owner is confirmed; the gate panel stays (with its reason) otherwise */
export function whenOwner({ doc = globalThis.document, win = globalThis, check = checkOwner } = {}) {
  const gate = doc.querySelector("section[data-owner-gate]");
  return new Promise((resolve) => {
    if (!gate) { resolve(); return; }
    const msg = gate.querySelector("[data-owner-msg]") || gate;
    let open = false, busy = null;
    doc.documentElement.dataset.ownerAccess = "checking";
    msg.textContent = TEXT.checking;
    const show = (reason) => {
      msg.textContent = TEXT[reason] || TEXT["not-owner"];
      if (reason === "signed-out") {
        const a = doc.createElement("a");
        a.href = new URL("/account.html", win.location.href).href;
        a.textContent = "Sign in";
        msg.append(" ", a);
      }
    };
    function unlock() {
      open = true;
      doc.documentElement.dataset.ownerAccess = "open";
      const tpl = gate.dataset.ownerTemplate ? doc.getElementById(gate.dataset.ownerTemplate) : null;
      if (tpl && tpl.content) tpl.replaceWith(tpl.content.cloneNode(true));
      gate.remove();
      resolve();
    }
    function verify() {
      if (busy) return busy;
      busy = Promise.resolve(check()).then((r) => {
        busy = null;
        if (r && r.owner) { if (!open) unlock(); }
        else if (open) win.location.reload();
        else { doc.documentElement.dataset.ownerAccess = "closed"; show(r && r.reason); }
      });
      return busy;
    }
    win.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") verify(); });
    win.addEventListener("storage", (e) => { if (e.key === SESSION_KEY) verify(); });
    win.addEventListener("mcc:auth-changed", () => verify());
    verify();
  });
}
