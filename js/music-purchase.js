/* purchase.html: the page Stripe returns a direct-music buyer to.
   =====================================================================
   ?session_id=cs_...  Stripe's return. music-direct-access "claim" binds the
                       session to the order the server stored for it, fulfils
                       it once, and answers the entitlement token (for 24 hours
                       after payment). The address bar is then rewritten to
                       ?token=..., which is the link the buyer keeps; the
                       session id is not kept anywhere.
   ?token=<uuid>       the kept link: "status" shows what is left, "download"
                       counts one download and opens a short-lived signed URL.
   ?canceled=1         Checkout was left; nothing was charged.

   A download is an ATTEMPT the server remembers by key (attempt_key):
     - a deliberate click with nothing unresolved sends a fresh random key;
     - when the page cannot know how a request ended (no network, no answer
       in ASK_MS, a 5xx, a body that is not the function's JSON, a 4xx that
       does not carry one of the function's own refusal reasons) it keeps the
       key, says so, and the next click sends the SAME key: the server
       answers the same attempt and never takes a second slot for it;
     - a delivered URL or one of the function's refusals ends the key.
   The kept key lives per purchase token in sessionStorage (this tab's
   reloads) and in localStorage (a second tab on the same kept link finds it),
   and is never sent with another token. It is kept for as long as the server
   could still answer the attempt, counted from its LAST send.

   This page needs music-direct-access v42 or later: an older function ignores
   attempt_key and counts every request. Rolling the function back means
   republishing the earlier page script too.
   ===================================================================== */
(function (root) {
  "use strict";
  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var FN = SB + "/functions/v1/music-direct-access";
  var TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var SESSION_RE = /^cs_(?:test|live)_[A-Za-z0-9]+$/;
  var ATTEMPT_KEY_RE = /^[A-Za-z0-9._-]{8,80}$/;
  /* A download request is given up on after ASK_MS. An unresolved key is kept no longer than
     the server could still answer it, counted from the LAST send (that send may be the one
     that reached the server): the request is reserved within ASK_MS of leaving, its hold lasts
     120 seconds, and an issued attempt is replayed for 300 seconds from its issue
     (public.music_direct_reserve_download and _settle_download). This is an upper bound on
     purpose: a key kept too long costs nothing (the server answers "attempt_spent", which
     takes no slot), a key dropped too early can cost the buyer a second download.
     A slot held for an attempt whose signing failed frees itself within HOLD_MS. */
  var ASK_MS = 20000;
  var KEY_LIFE_MS = ASK_MS + 120000 + 300000;
  var HOLD_MS = ASK_MS + 120000;
  var ATTEMPT_STORE = "mcc_direct_attempt:";
  var DOUBT_STORE = "mcc_direct_doubt:";
  /* The function's own refusals on the download path (supabase/functions/_shared/music-direct.ts
     REFUSAL_HTTP, and "refused" for a reason it does not map). Any other 4xx came from somewhere else. */
  var FUNCTION_REFUSALS = ["not_found", "revoked", "not_paid", "expired", "download_limit", "asset_unresolved", "attempt_spent", "sign_retry", "refused"];
  var UNSURE = "The download did not come back, so it may or may not have been counted. ";
  var UNSURE_RETRY = UNSURE + "If you try again in the next few minutes, it will not use another download.";
  var STILL_FINISHING = "An earlier download attempt may still be finishing. Try again in two minutes; it will not cost you a download.";
  var $ = function (id) { return document.getElementById(id); };
  var token = null;
  var kept = null; /* this page's copy of the unresolved attempt: sessionStorage may refuse */

  function post(body) {
    return fetch(FN, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error(d.error || "The download service is unavailable right now."); e.status = r.status; throw e; }
          return d;
        });
      });
  }
  function lead(text) { $("ppLead").textContent = text; }
  function status(text, bad) { $("ppStatus").textContent = text || ""; if (bad) $("ppStatus").setAttribute("data-tone", "bad"); else $("ppStatus").removeAttribute("data-tone"); }
  function when(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); }
    catch (_) { return String(iso || ""); }
  }
  /* ---- the unresolved download attempt, per purchase token ---- */
  function newKey() {
    var c = root.crypto, b, k = "", i;
    try { if (c && typeof c.randomUUID === "function") k = String(c.randomUUID()); } catch (_) { k = ""; }
    if (ATTEMPT_KEY_RE.test(k)) return k;
    try {
      if (c && typeof c.getRandomValues === "function") {
        b = c.getRandomValues(new Uint8Array(16));
        for (k = "", i = 0; i < b.length; i++) k += (b[i] < 16 ? "0" : "") + b[i].toString(16);
        if (ATTEMPT_KEY_RE.test(k)) return k;
      }
    } catch (_) {}
    /* no secure randomness: no key at all, never a guessable one that could repeat an earlier attempt's */
    return null;
  }
  /* Storage that may refuse: sessionStorage is this tab's (it survives a reload), localStorage is
     shared by the tabs of this browser; either can throw, and the page keeps working from memory.
     Reads give both values, this tab's first, so a store that refused a write cannot hide the other. */
  function storeRead(name) {
    var out = [];
    try { out.push(root.sessionStorage.getItem(name)); } catch (_) {}
    try { out.push(root.localStorage.getItem(name)); } catch (_) {}
    return out;
  }
  function storeWrite(name, value) {
    try { root.localStorage.setItem(name, value); } catch (_) {}
    try { root.sessionStorage.setItem(name, value); } catch (_) {}
  }
  function storeRemove(name) {
    try { root.localStorage.removeItem(name); } catch (_) {}
    try { root.sessionStorage.removeItem(name); } catch (_) {}
  }
  /* The first usable copy: this page's own, then this tab's, then the one another tab left.
     A copy from the future (a clock set back) is not trusted. */
  function keptAttempt(t) {
    var id = String(t).toLowerCase(), now = Date.now();
    var seen = [kept].concat(storeRead(ATTEMPT_STORE + id).map(function (v) {
      try { return JSON.parse(v || "null"); } catch (_) { return null; }
    }));
    for (var i = 0; i < seen.length; i++) {
      var a = seen[i];
      if (a && typeof a === "object" && a.token === id && typeof a.key === "string" && ATTEMPT_KEY_RE.test(a.key)
          && typeof a.at === "number" && now - a.at < KEY_LIFE_MS && now >= a.at - 60000) return a;
    }
    return null;
  }
  /* stamped at every send: a resend may be the request that reached the server */
  function keepAttempt(t, key) {
    var id = String(t).toLowerCase();
    kept = { token: id, key: key, at: Date.now() };
    storeWrite(ATTEMPT_STORE + id, JSON.stringify(kept));
  }
  function endAttempt(t) {
    kept = null;
    storeRemove(ATTEMPT_STORE + String(t).toLowerCase());
  }
  /* A signing failure may leave the server holding a slot for a while (its release can fail too).
     Remembered so that a "used all of its downloads" right after it is not taken at its word. */
  function markDoubt(t) { storeWrite(DOUBT_STORE + String(t).toLowerCase(), String(Date.now())); }
  function doubtful(t) {
    var now = Date.now();
    return storeRead(DOUBT_STORE + String(t).toLowerCase()).some(function (v) {
      var at = Number(v);
      return v != null && Number.isFinite(at) && at > 0 && now - at < HOLD_MS && now >= at - 60000;
    });
  }
  /* What one download answer means for the attempt:
     { out: "url", d }              a signed URL came back: the attempt is over
     { out: "refused", status, d }  the function refused: the attempt is over
     { out: "unknown" }             nothing the page can trust: the attempt may or may not have counted */
  function sort(code, d, key, resent) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return { out: "unknown" };
    if (code >= 200 && code < 300) return d.ok === true && typeof d.url === "string" && d.url ? { out: "url", d: d } : { out: "unknown" };
    if (code >= 400 && code < 500) {
      /* Only the function's own refusals end the attempt. A 4xx from anything in between (a gateway's
         429 or 404, a 401, a 408) says nothing about whether the attempt counted. */
      var own = typeof d.reason === "string" ? FUNCTION_REFUSALS.indexOf(d.reason) >= 0
        : code === 400 && typeof d.error === "string";
      return own ? { out: "refused", status: code, d: d } : { out: "unknown" };
    }
    /* 503 sign_retry: signing failed and the hold was released, so that key is spent
       ("attempt_spent" if sent again). The exception is a key this page is RESENDING:
       its attempt may already be issued and counted, an issued attempt is never
       released, and the server echoes the key it would still replay. */
    if (code === 503 && d.reason === "sign_retry" && !(resent && key && d.attempt_key === key)) return { out: "refused", status: code, d: d };
    return { out: "unknown" };
  }
  /* One bounded download request. Resolves with sort()'s answer; never rejects, never hangs. */
  function ask(body, resent) {
    return new Promise(function (resolve) {
      var done = false, ctl = null, timer = null;
      var opt = { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify(body) };
      function end(v) { if (done) return; done = true; clearTimeout(timer); resolve(v); }
      try { ctl = new AbortController(); opt.signal = ctl.signal; } catch (_) { ctl = null; }
      timer = setTimeout(function () { end({ out: "unknown" }); try { if (ctl) ctl.abort(); } catch (_) {} }, ASK_MS);
      try {
        fetch(FN, opt).then(function (r) {
          return r.json().then(function (d) { end(sort(r.status, d, body.attempt_key, resent)); });
        }).catch(function () { end({ out: "unknown" }); });
      } catch (_) { end({ out: "unknown" }); }
    });
  }

  function keepLink(t) {
    var url = location.origin + location.pathname + "?token=" + encodeURIComponent(t);
    try { history.replaceState(null, "", "?token=" + encodeURIComponent(t)); } catch (_) {}
    try {
      var list = JSON.parse(localStorage.getItem("mcc_direct_purchases") || "[]");
      if (list.indexOf(t) < 0) { list.unshift(t); localStorage.setItem("mcc_direct_purchases", JSON.stringify(list.slice(0, 50))); }
    } catch (_) {}
    $("ppLink").value = url;
    $("ppLinkBox").hidden = false;
  }
  function show(d) {
    $("ppCard").hidden = false;
    var fmt = { mp3: "MP3", m4a: "M4A", wav: "WAV", flac: "FLAC" }[String(d.format || "").toLowerCase()];
    $("ppTitle").textContent = (d.title || "Your track") + (fmt ? " \u00b7 " + fmt : "");
    $("ppDownload").textContent = fmt ? "Download " + fmt : "Download";
    var parts = [];
    if (d.max_downloads != null) parts.push(d.downloads_left + " of " + d.max_downloads + " downloads left");
    if (d.expires_at) parts.push("available until " + when(d.expires_at));
    $("ppMeta").textContent = parts.join(" · ");
    var can = !!d.can_download && !!token;
    /* a download whose answer was lost can still be asked about after it took the last slot */
    var askable = !can && !!token && !!d.refusal && d.refusal.reason === "download_limit" && !!keptAttempt(token);
    $("ppDownload").disabled = !can && !askable;
    $("ppDownload").hidden = !token;
    if (d.refusal) status(askable ? UNSURE_RETRY : d.refusal.message, true);
  }

  function claim(sessionId, tries) {
    post({ action: "claim", session_id: sessionId }).then(function (d) {
      if (d.state === "processing") {
        if (tries < 15) { lead("Your payment is being confirmed…"); return setTimeout(function () { claim(sessionId, tries + 1); }, 2000); }
        lead("Your payment is still being confirmed. Reload this page in a minute.");
        return;
      }
      if (d.state === "revoked") { $("ppHead").textContent = "Purchase closed"; lead(d.message || "This purchase was refunded."); return; }
      $("ppHead").textContent = "Thank you";
      if (d.token_hidden) { lead(d.message); show(d); return; }
      token = d.token;
      keepLink(token);
      lead("Your purchase is complete. Download your track below.");
      show(d);
    }).catch(function (e) { lead(e.message); });
  }
  function load(t) {
    token = t;
    post({ action: "status", token: t }).then(function (d) {
      $("ppHead").textContent = d.state === "revoked" ? "Purchase closed" : "Your purchase";
      lead(d.state === "revoked" ? "This purchase was refunded or revoked." : "Download your track below.");
      $("ppLink").value = location.href; $("ppLinkBox").hidden = d.state === "revoked";
      show(d);
    }).catch(function (e) { lead(e.message); });
  }

  $("ppDownload").addEventListener("click", function () {
    if (!token) return;
    var b = $("ppDownload"), t = token;
    var a = keptAttempt(t), resent = !!a, key = a ? a.key : newKey();
    var body = { action: "download", token: t };
    /* kept BEFORE the request leaves, so a reload while it is in flight asks about the same attempt */
    if (key) { body.attempt_key = key; keepAttempt(t, key); }
    b.disabled = true; status("Preparing your download…");
    ask(body, resent).then(function (o) {
      var d = o.d;
      if (o.out === "unknown") {
        /* the key stays; the next click sends it again */
        status(key ? UNSURE_RETRY : UNSURE + "Reload this page to see what is left.", true);
        b.disabled = false;
        return;
      }
      endAttempt(t);
      if (o.out === "refused") {
        if (d.reason === "sign_retry") markDoubt(t);
        /* "used all of its downloads" right after a signing failure on this purchase may be a slot the
           server still holds for the failed attempt; it frees itself, so the button stays */
        if (d.reason === "download_limit" && doubtful(t)) {
          status(STILL_FINISHING, true);
          b.disabled = false;
          return;
        }
        status(d.error || "The download service is unavailable right now.", true);
        /* "attempt_spent" asks for a new attempt, so the button stays */
        b.disabled = o.status >= 400 && o.status < 500 && o.status !== 400 && d.reason !== "attempt_spent";
        return;
      }
      status(d.downloads_left + " download" + (d.downloads_left === 1 ? "" : "s") + " left.");
      b.disabled = d.downloads_left <= 0;
      try { if (root.MCC_TRACK) root.MCC_TRACK("direct_download", {}); } catch (_) {}
      root.location.assign(d.url);
    });
  });
  $("ppCopy").addEventListener("click", function () {
    var v = $("ppLink").value;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { status("Link copied."); }, function () {
      $("ppLink").select(); status("Select the link and copy it.");
    });
  });

  var q = new URLSearchParams(location.search);
  var t = q.get("token"), s = q.get("session_id");
  if (q.get("canceled")) { $("ppHead").textContent = "Checkout canceled"; lead("Nothing was charged. You can pick the track again whenever you like."); }
  else if (t && TOKEN_RE.test(t)) load(t);
  else if (s && SESSION_RE.test(s)) claim(s, 0);
  else lead("This page shows a purchase after checkout. Open the link from your purchase to download again.");
})(window);
