/* ============================================================
   GATED AUDIO — a record you earn.

   THE ONLY HONEST WAY TO GATE A FILE ON A STATIC HOST.

   This site is GitHub Pages. Anything committed under assets/ is
   world-readable the moment it deploys, so the full master is NOT in
   this repository. It lives in a PRIVATE Supabase bucket. What ships
   publicly is a short preview cut, and that is supposed to be public.

   THE RULE (the owner's, 2026-10-15; enforced by the database and the
   API Worker, not by this file; the numbers are the action_unlock_rules
   row the Worker names)
     signed out           → the preview, and what the full track takes
     signed in, locked    → the preview, and exactly what is missing:
                            verified missions x/3 and/or identity
                            verification, each with a link
     entitled             → three admin-verified missions AND a verified
                            identity: each play asks the Worker, which
                            hands back a short-lived token for that play
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

  /* A signed-out GET is allowed: the gate answers what the full track
     takes before anyone has an account. A play always needs a session.
     The token is the shared auth's, renewed for this call when it is near
     its end, and asked again once after a 401 (js/mcc-auth.js authFetch):
     the stored one, an hour old, made the owner a guest (music slice M4). */
  function ask(path, method) {
    var token = sessionToken();
    if (!token && method === "POST") return Promise.resolve({ status: 401, data: null });
    var init = { method: method || "GET", cache: "no-store" };
    var call = root.MCC && root.MCC.authFetch
      ? root.MCC.authFetch(API + path, init)
      : fetch(API + path, Object.assign(init, { headers: token ? { authorization: "Bearer " + token } : {} }));
    return call.then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) { return { status: r.status, data: d }; });
    }).catch(function () { return { status: 0, data: null }; });
  }

  function fromGate(gate) {
    if (!gate) return { state: "unavailable", reason: "no-gate" };
    return gate.allowed
      ? { state: "earned", gate: gate, operator: !!gate.operator }
      : { state: "locked", gate: gate };
  }

  /* THE GATE IS NOT READY (music slice M3; music map 02, DEL-2). While the rule's SQL is not in
     production the Worker answers gate_not_ready: nobody's missions or identity can open the full
     song yet, signed in or not. The row painted "0/3 MISSIONS + identity verification" from this
     file's own defaults, numbers no server sent. Now every listener is told the same true thing:
     the full song opens later. */
  function notReady(gate) {
    return !!gate && (gate.reason === "gate_not_ready" ||
      (Array.isArray(gate.missing) && gate.missing.indexOf("gate_not_ready") > -1));
  }
  function later(out) { return !!(out && notReady(out.gate)); }
  /* a count the server sent, or nothing: never the page's own 0/3 */
  function count(n) { return typeof n === "number" && isFinite(n) ? n : (typeof n === "string" && /^\d+$/.test(n) ? Number(n) : null); }

  /* Where does this listener stand? Resolves, never rejects: every caller
     is painting a row, and a thrown error would leave the row lying
     about which situation it is in. */
  function resolve(gated) {
    var key = keyOf(gated);
    if (!key) return Promise.resolve({ state: "unavailable", reason: "unconfigured" });
    var hit = cache[key];
    if (hit && hit.inflight) return hit.inflight;
    if (hit && Date.now() - hit.at < STATE_MS) return Promise.resolve(hit.out);
    var p = ask("/v1/music/gates/" + encodeURIComponent(key)).then(function (r) {
      /* signed in is decided when the answer is back: a session the server ended on the way is a guest's answer */
      var signedIn = !!sessionToken();
      var gate = r.data && r.data.gate;
      var out = r.status === 200
          ? (notReady(gate) ? { state: "locked", reason: "later", gate: gate }
            : signedIn ? fromGate(gate) : { state: "preview", reason: "account", gate: gate })
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
      /* the play's lifetime comes with its URL (the Worker's expires_in: 300 s for a listener's one play,
         600 s for the house's own), so the player knows when it has lapsed (music slice M3) */
      if (r.status === 200 && r.data && r.data.url) {
        var life = Number(r.data.expires_in);
        return { state: "full", url: r.data.url, gate: r.data.gate, expires_in: life > 0 ? life : null };
      }
      if (r.status === 403) return { state: "locked", gate: r.data && r.data.gate };
      if (r.status === 401) return { state: "preview", reason: "account" };
      if (r.status === 404) return { state: "unavailable", reason: "missing" };
      /* no answer, or a server error: the play may or may not have been spent. The page says so and
         never claims again by itself (music slice M3) */
      return { state: "unavailable", reason: r.status ? "http-" + r.status : "network", uncertain: !r.status || r.status >= 500 };
    });
  }

  /* One short line a row can show for where the listener stands. */
  function progress(out) {
    var g = out && out.gate;
    if (!out) return null;
    if (out.state === "earned") {
      if (out.operator) return { b: "PLAY", s: "owner" };
      return g && g.mode === "rule" ? { b: "PLAY", s: "full track" } : { b: "PLAY ONCE", s: "you earned it" };
    }
    if (notReady(g)) return { b: "FULL SONG", s: "opens later" };
    if (out.state !== "locked" || !g) return null;
    /* Three admin-verified missions and a verified identity, as the server counted them. */
    if (g.mode === "rule") {
      var m = g.missions || {}, have = count(m.have), needM = count(m.need);
      if (have === null || !needM) return { b: "LOCKED", s: "not available yet" };
      if (have < needM) return { b: have + "/" + needM + " MISSIONS", s: g.identity_verified ? "verified missions unlock it" : "+ identity verification" };
      if (!g.identity_verified) return { b: "VERIFY ID", s: have + "/" + needM + " missions done" };
      return { b: "LOCKED", s: "not available yet" };
    }
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

  /* The whole sentence and the links, for a toast or a panel. Only names
     what is actually missing, from the server's own answer. */
  function explain(out) {
    var g = out && out.gate;
    if (notReady(g)) return { text: "The full song opens later.", links: [] };
    if (!g || g.mode !== "rule") return null;
    var m = g.missions || {}, have = count(m.have), need = count(m.need);
    var links = g.links || {}, missing = g.missing || [], parts = [], go = [];
    /* signing in (or making the account) comes back to this record (account.html honours ?next) */
    var here = window.location && window.location.pathname ? window.location.pathname + (window.location.search || "") : "";
    if (missing.indexOf("sign_in") > -1) go.push({ key: "sign_in", label: "Sign in", href: "account.html" + (here && !/(^|\/)account\.html$/.test(here) ? "?next=" + encodeURIComponent(here) : "") });
    if (have !== null && need && have < need) {
      parts.push(need + " verified missions (you have " + have + ")");
      if (links.missions) go.push({ key: "missions", label: "Missions (" + have + "/" + need + ")", href: links.missions });
    } else if ((have === null || !need) && missing.indexOf("missions") > -1) {
      parts.push("verified missions");
      if (links.missions) go.push({ key: "missions", label: "Missions", href: links.missions });
    }
    if (!g.identity_verified) {
      parts.push("a verified identity");
      if (links.identity) go.push({ key: "identity", label: "Verify your identity", href: links.identity });
    }
    if (g.allowed) return { text: "", links: [] };
    var text = parts.length ? "The full track needs " + parts.join(" and ") + "." : "The full track is not available yet.";
    if (missing.indexOf("sign_in") > -1) text += " Sign in first.";
    return { text: text, links: go };
  }

  /* Sign-in, sign-out and a counted song all have to repaint every gated
     row, and none of them reloads the page. Callers register here. */
  var watchers = [];
  function onChange(fn) { if (typeof fn === "function") watchers.push(fn); }
  function forget() { cache = {}; watchers.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  /* THE CLOSING SONG IS HELD (owner, 2026-11-23: "We keep the song up, but it won't play... it'll tell you why it
     won't play when you try to click play"; docs/music/MUSIC-RELEASE-20261119.md, "Quick wins"). A song marked
     "hold" in data/albums.json stays listed and plays for the house owner alone: his gate answers operator, and his
     play is the one he already had. For anyone else the answer is no; a guest is told so without a request, a member
     after the gate's own read (never a claim). The gate's rule SQL is untouched: the full gate it waits for (a
     finished profile and a short questionnaire) is not built yet, and nothing here collects anything. */
  function holdDecision(gated) {
    if (!sessionToken()) return Promise.resolve({ play: false, signedIn: false });
    return resolve(gated).then(function (out) {
      return { play: !!(out && out.state === "earned" && out.operator), signedIn: !!sessionToken() };
    }, function () { return { play: false, signedIn: !!sessionToken() }; });
  }
  /* what the pop-up says, by account state, in plain words */
  function holdCopy(signedIn, back) {
    var title = "Why this song won't play";
    if (!signedIn) return {
      title: title,
      text: "This song plays only for members who sign in, complete their full profile and answer a short questionnaire. The questionnaire opens soon.",
      action: { label: "Sign in", href: "account.html?next=" + encodeURIComponent(back || "/listen.html") }
    };
    return {
      title: title,
      text: "This song plays only for members who complete their full profile and answer a short questionnaire. Complete your full profile now; the questionnaire opens soon.",
      action: { label: "Complete your profile", href: "mnet.html?view=profile" }
    };
  }
  /* the one pop-up: a real dialog (Escape and Close dismiss it), its way forward focused first */
  function holdNotice(o) {
    var doc = root.document;
    if (!doc || !doc.body || !doc.createElement) return null;
    var back = "/listen.html";
    try { back = root.location.pathname + root.location.search; } catch (e) {}
    var copy = holdCopy(!!(o && o.signedIn), back);
    var d = doc.getElementById("mccHold");
    if (!d) {
      d = doc.createElement("dialog");
      d.id = "mccHold";
      d.className = "mcc-hold";
      d.setAttribute("aria-labelledby", "mccHoldTitle");
      d.setAttribute("aria-describedby", "mccHoldText");
      d.innerHTML = '<h2 id="mccHoldTitle"></h2><p id="mccHoldText"></p>' +
        '<div class="mcc-hold__acts"><a class="mcc-hold__go" href="account.html"></a>' +
        '<button type="button" class="mcc-hold__close">Close</button></div>';
      d.querySelector(".mcc-hold__close").addEventListener("click", function () { closeHold(d); });
      d.addEventListener("click", function (e) { if (e.target === d) closeHold(d); });   // a tap outside it
      doc.body.appendChild(d);
    }
    d.querySelector("h2").textContent = copy.title;
    d.querySelector("p").textContent = copy.text;
    var go = d.querySelector(".mcc-hold__go");
    go.textContent = copy.action.label;
    go.setAttribute("href", copy.action.href);
    try { if (!d.open) { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); } }
    catch (e) { d.setAttribute("open", ""); }
    try { go.focus(); } catch (e) {}
    return d;
  }
  function closeHold(d) {
    try { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); } catch (e) { d.removeAttribute("open"); }
  }

  root.MCC_GATED = {
    resolve: resolve,
    claim: claim,
    progress: progress,
    explain: explain,
    later: later,
    keyOf: keyOf,
    forget: forget,
    onChange: onChange,
    holdDecision: holdDecision,
    holdCopy: holdCopy,
    holdNotice: holdNotice,
    signedIn: function () { return !!sessionToken(); }
  };

  /* A sign-in or sign-out, here or in another tab, repaints every gated
     row; a renewed token for the same account does not (js/mcc-auth.js
     onAccountChange). Without the shared auth, the storage event. */
  if (root.MCC && root.MCC.onAccountChange) {
    root.MCC.onAccountChange(forget);
  } else if (root.addEventListener) {
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
