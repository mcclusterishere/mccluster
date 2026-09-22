/* ============================================================
   McCLUSTER INSIGHT — the tracker that ships with a site we built.

   A client drops one line into their page:

     <script defer src="https://matthew.mccluster.org/insight.js"
             data-site="mca_xxxxxxxx"></script>

   and their traffic lands in the same first-party collector the house
   runs on itself. No Google, no third-party network, no data broker,
   and no file on their server whose source they cannot read.

   WHY THIS IS NOT A PIXEL, technically rather than morally. A pixel
   works by being the SAME third party across a thousand unrelated
   sites, reading a cookie it set on somebody else's domain. Every
   browser that matters now blocks exactly that — Safari and Firefox
   outright, Chrome by policy — so a pixel built today collects less
   every quarter and calls it a strategy.

   HOW THE ECOSYSTEM LINK ACTUALLY WORKS, and it is not a trick:
   storage is per-origin, so this script CANNOT read an M Account
   session from a client's domain. Nothing here can. The link comes
   from the client site using M Account sign-in — the same
   sso_client_registry the rest of the ecosystem uses. When a visitor
   signs in through McCluster, the identity is ours on both sides and
   the join is exact rather than guessed from an IP and a user agent.
   Sites without SSO are counted on their own and nowhere else.

   That is the durable version. It survives every browser privacy
   change that is coming, because it never depended on a cookie.

   THE SITE DECIDES, NOT THIS FILE. consent_mode lives on the
   analytics_sites row and the collector enforces it server-side:
     cookieless  no identifier at all, nothing stored, counts only
     required    nothing persistent until the page reports consent
   A client can tighten this from the embed. They can never loosen it
   by editing the tag, because the server checks again.
   ============================================================ */
(function (w, d) {
  "use strict";

  var TAG = d.currentScript;
  var SITE = TAG && TAG.getAttribute("data-site");
  if (!SITE) return;                       // no key, no collection

  var COLLECT = (TAG.getAttribute("data-collector") || "https://api.mccluster.org") + "/v1/collect";
  var MODE = (TAG.getAttribute("data-consent") || "").toLowerCase();

  /* Global Privacy Control and Do Not Track, honoured before a single
     byte leaves. The collector honours them again server-side — two
     checks, because this one is editable by anyone viewing source. */
  function optedOut() {
    try {
      if (w.navigator && w.navigator.globalPrivacyControl === true) return true;
      var dnt = w.navigator.doNotTrack || w.doNotTrack || w.navigator.msDoNotTrack;
      return dnt === "1" || dnt === "yes";
    } catch (e) { return false; }
  }
  if (optedOut()) return;

  var KEY = "mcc_insight_did";
  var SESSION_KEY = "mcc_insight_sid";

  /* First-party and per-origin. On a client's domain this is THEIR
     storage, readable by no other site — which is the whole difference
     between this and the thing it replaces. */
  function id(store, key) {
    if (MODE === "cookieless") return null;
    try {
      var v = store.getItem(key);
      if (!v) {
        v = (w.crypto && w.crypto.randomUUID) ? w.crypto.randomUUID()
          : String(Date.now()) + Math.random().toString(16).slice(2);
        store.setItem(key, v);
      }
      return v;
    } catch (e) { return null; }   // private window: count it, never fail
  }

  var started = Date.now();
  var sent = 0;

  function send(name, props) {
    if (sent > 200) return;            // a runaway page cannot flood the collector
    sent++;
    var payload = {
      site_key: SITE,
      name: name,
      props: props || {},
      url: location.href.slice(0, 1000),
      ref: d.referrer ? d.referrer.slice(0, 1000) : "",
      path: location.pathname,
      title: (d.title || "").slice(0, 300),
      screen: (w.screen ? w.screen.width + "x" + w.screen.height : ""),
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ""),
      lang: w.navigator.language || "",
      device_id: id(localStorage, KEY),
      session_id: id(sessionStorage, SESSION_KEY),
      at: new Date().toISOString()
    };
    /* No credential is ever put in this body. An earlier draft read the
       visitor's access token out of storage and posted it here; that is
       a credential crossing an origin for no gain, and on a client's
       domain it would always have been null anyway. Identity arrives
       through SSO on the request, not smuggled in a payload. */
    var body = JSON.stringify(payload);
    try {
      /* sendBeacon survives the page closing, which is the only way
         page_leave and its dwell time ever arrive at all. */
      if (navigator.sendBeacon && navigator.sendBeacon(COLLECT, new Blob([body], { type: "application/json" }))) return;
    } catch (e) {}
    try {
      fetch(COLLECT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body,
        keepalive: true,
        /* Sends the M Account session ONLY when the browser already has
           one for our origin, handled by the browser as a credential
           rather than copied into the body by this script. */
        credentials: "include"
      });
    } catch (e) {}
  }

  send("page_view", {});

  /* Depth, clamped. An infinite-scroll page reported 289% before the
     house's own tracker grew this same clamp. */
  var deepest = 0;
  w.addEventListener("scroll", function () {
    var h = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight) - w.innerHeight;
    var pct = h > 0 ? Math.min(100, Math.round((w.scrollY / h) * 100)) : 100;
    if (pct > deepest) deepest = pct;
  }, { passive: true });

  d.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a,button");
    if (!a) return;
    send("click", {
      tag: a.tagName.toLowerCase(),
      text: (a.textContent || "").trim().slice(0, 80),
      href: a.getAttribute("href") || ""
    });
  }, true);

  var left = false;
  function leaving() {
    if (left) return;                  // pagehide and visibilitychange both fire
    left = true;
    send("page_leave", { depth: deepest, seconds: Math.round((Date.now() - started) / 1000) });
  }
  w.addEventListener("pagehide", leaving);
  d.addEventListener("visibilitychange", function () { if (d.visibilityState === "hidden") leaving(); });

  /* The client's own code names its own conversions:
       MCCInsight.track("quote_requested", { value: 1200 }) */
  w.MCCInsight = { track: send, site: SITE };
})(window, document);
