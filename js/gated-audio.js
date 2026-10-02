/* ============================================================
   GATED AUDIO — a record you earn.

   THE ONLY HONEST WAY TO GATE A FILE ON A STATIC HOST.

   This site is GitHub Pages. Anything committed under assets/ is
   world-readable the moment it deploys, so the full master is NOT in
   this repository. It lives in a PRIVATE Supabase bucket. What ships
   publicly is a short preview cut, and that is supposed to be public.

   THE RULE (the owner's, enforced by the API Worker, not by this file)
     signed out           → the preview, and an invitation to an account
     signed in, locked    → the preview, and how many songs are left:
                            five DIFFERENT other songs heard all the way
                            through before the first play
     earned               → ONE play. The Worker spends it and signs one
                            short-lived URL for that play alone
     after a play         → locked again until one more full song
     storage/API down     → told exactly that

   A browser can no longer sign its own URL for the master (the bucket
   stopped being readable by every account), so nothing in this file is
   the lock. It only asks, and paints the answer. There is no download:
   a file to keep is not "one play".
   ============================================================ */
(function (root) {
  "use strict";

  var API = "https://api.mccluster.org";
  /* Progress changes as songs finish; a short memory saves repeat asks
     when a page paints the same row twice. */
  var STATE_MS = 20 * 1000;
  var cache = {};

  function sessionToken() {
    try {
      var s = root.MCC && root.MCC.session && root.MCC.session();
      return (s && s.access_token) || null;
    } catch (e) { return null; }
  }

  /* The server knows a gated record by the folder its master lives in. */
  function keyOf(gated) { return String((gated && gated.object) || "").split("/")[0]; }

  function ask(path, method) {
    var token = sessionToken();
    if (!token) return Promise.resolve({ status: 401, data: null });
    return fetch(API + path, {
      method: method || "GET",
      headers: { authorization: "Bearer " + token },
      cache: "no-store"
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) { return { status: r.status, data: d }; });
    }).catch(function () { return { status: 0, data: null }; });
  }

  function fromGate(gate) {
    if (!gate) return { state: "unavailable", reason: "no-gate" };
    return gate.allowed
      ? { state: "earned", gate: gate, operator: !!gate.operator }
      : { state: "locked", gate: gate };
  }

  /* Where does this listener stand? Resolves, never rejects: every caller
     is painting a row, and a thrown error would leave the row lying
     about which situation it is in. */
  function resolve(gated) {
    var key = keyOf(gated);
    if (!key) return Promise.resolve({ state: "unavailable", reason: "unconfigured" });
    if (!sessionToken()) return Promise.resolve({ state: "preview", reason: "account" });
    var hit = cache[key];
    if (hit && hit.inflight) return hit.inflight;
    if (hit && Date.now() - hit.at < STATE_MS) return Promise.resolve(hit.out);
    var p = ask("/v1/music/gates/" + encodeURIComponent(key)).then(function (r) {
      var out = r.status === 200 ? fromGate(r.data && r.data.gate)
        : r.status === 401 ? { state: "preview", reason: "account" }
        : { state: "unavailable", reason: r.status ? "http-" + r.status : "network" };
      cache[key] = { at: Date.now(), out: out };
      return out;
    });
    cache[key] = { inflight: p };
    return p;
  }

  /* Spend one earned play. Only ever called when the listener presses
     play on the record: the answer is a URL good for that one play. */
  function claim(gated) {
    var key = keyOf(gated);
    delete cache[key];
    if (!key) return Promise.resolve({ state: "unavailable", reason: "unconfigured" });
    return ask("/v1/music/gates/" + encodeURIComponent(key) + "/play", "POST").then(function (r) {
      if (r.status === 200 && r.data && r.data.url) return { state: "full", url: r.data.url, gate: r.data.gate };
      if (r.status === 403) return { state: "locked", gate: r.data && r.data.gate };
      if (r.status === 401) return { state: "preview", reason: "account" };
      if (r.status === 404) return { state: "unavailable", reason: "missing" };
      return { state: "unavailable", reason: r.status ? "http-" + r.status : "network" };
    });
  }

  /* One short line a row can show for where the listener stands. */
  function progress(out) {
    var g = out && out.gate;
    if (!out) return null;
    if (out.state === "earned") return out.operator ? { b: "PLAY", s: "owner" } : { b: "PLAY ONCE", s: "you earned it" };
    if (out.state !== "locked" || !g) return null;
    /* Album order: the record closes its album and plays only after the
       songs before it, in order, each heard through. */
    if (g.mode === "sequence") {
      var need = Number(g.need) || 0, got = Number(g.progress) || 0, titles = g.titles || [];
      if (need && got >= need) return { b: "PLAY IN ORDER", s: "start again from " + (titles[0] || "the first song") };
      return { b: got + "/" + need + " IN ORDER", s: "play " + (g.next_title || "the album from the top") + " next" };
    }
    var first = Number(g.need_first) || 5, done = Number(g.distinct_songs) || 0;
    if (done < first) {
      var left = first - done;
      return { b: done + "/" + first + " SONGS", s: "finish " + left + " more to unlock" };
    }
    return { b: "LOCKED", s: "finish " + (Number(g.need_each) || 1) + " more song to play it again" };
  }

  /* Sign-in, sign-out and a counted song all have to repaint every gated
     row, and none of them reloads the page. Callers register here. */
  var watchers = [];
  function onChange(fn) { if (typeof fn === "function") watchers.push(fn); }
  function forget() { cache = {}; watchers.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  root.MCC_GATED = {
    resolve: resolve,
    claim: claim,
    progress: progress,
    keyOf: keyOf,
    forget: forget,
    onChange: onChange,
    signedIn: function () { return !!sessionToken(); }
  };

  /* The session is in localStorage, so another tab signing in or out
     is a storage event here. */
  if (root.addEventListener) {
    root.addEventListener("storage", function (e) {
      if (e && e.key === "mccdb_session") forget();
    });
  }

  /* A song that counted moves the gate; repaint whoever is showing it. */
  function hookListens() {
    if (!root.MCC_LISTENS) return false;
    root.MCC_LISTENS.onFinish(function (d) { if (d && d.counted) forget(); });
    return true;
  }
  if (!hookListens() && root.addEventListener) root.addEventListener("mcc:listens-ready", hookListens, { once: true });

  /* This file is deferred, so a page that paints its shelf from a fetch
     can finish either before or after it. Whoever is late listens for
     this; nobody polls. */
  try {
    root.dispatchEvent(new CustomEvent("mcc:gated-ready"));
  } catch (e) { /* no CustomEvent: the ready check below still catches it */ }
})(window);
