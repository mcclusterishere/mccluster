/* ============================================================
   Analytics: the one wrapper every page calls.
   Two optional destinations, both dormant until configured:

   1. ANALYTICS_ID: Google Analytics 4 Measurement ID
      (GA4 Admin → Data Streams, looks like "G-XXXXXXXXXX").
   2. TRACK_ENDPOINT: the future first-party collector on the
      McCluster Control Room backend (an HTTPS URL that accepts
      a JSON POST). Events go over as anonymous, consented,
      aggregate signals. No identifiers, no profiles.

   While both are empty, MCC_TRACK is a silent no-op: no
   tracking, no external requests. No secrets belong in this
   file. Endpoints only, keys live server-side.
   ============================================================ */

window.ANALYTICS_ID = "G-38KDY01Z2V";
window.TRACK_ENDPOINT = "";

/* Ad platforms, dormant until the IDs are pasted in.
   META_PIXEL_ID: Meta Events Manager → your pixel → the 15-16 digit ID.
   GADS_ID / GADS_LABEL: Google Ads → Tools → Conversions → your
   "Booked call" action → tag setup ("AW-XXXXXXXXX" + label).
   The win we count: a booked call. MCC_CONVERT fires it everywhere. */
window.ADS = {
  META_PIXEL_ID: "",
  GADS_ID: "",
  GADS_LABEL: "",
};

/* Lead intake: the Apps Script web app URL (ends in /exec) that appends
   rows to the leads Sheet. While empty, every lead button keeps its plain
   mailto behavior; paste the URL and the on-page form takes over. */
window.INTAKE_ENDPOINT = "https://script.google.com/macros/s/AKfycby9Z086Bx-lEfTr6NnOyx3kTzdPpnEshJS7HX-XbmaEPQ2xhMe6mk2GAUzLIheAIR7bBA/exec";

/* PWA: register the service worker so the site is installable and loads
   instant/offline after the first visit. Registered from here because this
   file loads on every page, giving the worker site-wide scope. */
if ("serviceWorker" in navigator) {
  var swRoot = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/analytics\.js.*$/, "") : "";
  })();
  window.addEventListener("load", function () {
    navigator.serviceWorker.register(swRoot + "sw.js").catch(function () {});
  });
}

window.MCC_TRACK = (function () {
  var gaId = window.ANALYTICS_ID;
  var endpoint = window.TRACK_ENDPOINT;

  /* ---- the first-party mirror: the platform's own eyes ----
     Google keeps its copy behind Google's login; this copy lands in
     the platform's own database (docs/analytics-schema.sql) and
     Mission Control reads it live. Write-only from here; the anon
     key can insert an event, never read one back. Self-contained
     constants because this file loads before backend.js. */
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  /* acquisition, first-party: where every soul CAME from. Referrer +
     UTM tags bank once (first touch), ride every event as props.acq,
     and fire one 'acquired' event: the numbers Google used to keep
     behind its own login now live in the platform's own table. */
  var ACQ = null;
  try {
    ACQ = JSON.parse(localStorage.getItem("mcc_acq") || "null");
    if (!ACQ) {
      var qq = new URLSearchParams(location.search);
      var refHost = "";
      try { refHost = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e3) {}
      if (refHost === location.hostname) refHost = "";
      ACQ = {
        src: qq.get("utm_source") || refHost || "direct",
        med: qq.get("utm_medium") || (refHost ? "referral" : "none"),
        cmp: qq.get("utm_campaign") || "",
        plug: qq.get("ref") || "",
        at: new Date().toISOString().slice(0, 10),
      };
      localStorage.setItem("mcc_acq", JSON.stringify(ACQ));
      setTimeout(function () { if (window.MCC_TRACK) window.MCC_TRACK("acquired", { src: ACQ.src, med: ACQ.med, cmp: ACQ.cmp, plug: ACQ.plug }); }, 500);
    }
  } catch (e4) { ACQ = null; }
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  function mirror(name, params) {
    try {
      params = params || {};
      if (ACQ && !params.acq) params.acq = ACQ.src + "/" + ACQ.med + (ACQ.cmp ? "/" + ACQ.cmp : "");
      var uid = null;
      try {
        var s = JSON.parse(localStorage.getItem("mccdb_session") || "null");
        if (s && s.access_token) uid = JSON.parse(atob(s.access_token.split(".")[1])).sub || null;
      } catch (e2) {}
      fetch(SB_URL + "/rest/v1/events", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", apikey: SB_KEY, Prefer: "return=minimal" },
        body: JSON.stringify({ name: name, path: location.pathname.split("/").pop() || "index.html", props: params || {}, uid: uid }),
      }).catch(function () {});
    } catch (e) {}
  }

  var gtag = null;
  if (gaId) {
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + gaId;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    gtag = function () { window.dataLayer.push(arguments); };
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", gaId, { anonymize_ip: true });
  }

  /* ---- ad pixels: load only when an ID is configured ---- */
  var ads = window.ADS || {};
  if (ads.META_PIXEL_ID) {
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", ads.META_PIXEL_ID);
    window.fbq("track", "PageView");
  }
  if (ads.GADS_ID && gtag) gtag("config", ads.GADS_ID);

  /* The one win that counts: a booked call. Fires GA4 + Google Ads + Meta. */
  window.MCC_CONVERT = function (label) {
    if (gtag) {
      gtag("event", "book_call", { label: label || "" });
      if (ads.GADS_ID && ads.GADS_LABEL) gtag("event", "conversion", { send_to: ads.GADS_ID + "/" + ads.GADS_LABEL });
    }
    if (window.fbq) window.fbq("track", "Schedule", { content_name: label || "book_call" });
  };

  return function (name, params) {
    params = params || {};
    if (gtag) gtag("event", name, params);
    mirror(name, params);
    // any booking CTA anywhere on the site counts as the conversion
    if (name === "cta_click" && /book-call|offer-claim/.test(params.label || "")) window.MCC_CONVERT(params.label);
    if (endpoint) {
      // fire-and-forget; sendBeacon survives page exits
      var payload = JSON.stringify({ event: name, params: params, path: location.pathname, ts: Date.now() });
      if (navigator.sendBeacon) navigator.sendBeacon(endpoint, payload);
      else fetch(endpoint, { method: "POST", body: payload, keepalive: true }).catch(function () {});
    }
  };
})();

/* ============================================================
   MCC_MODEL: the algorithm that follows the user.
   Every signal on the site already flows through MCC_TRACK, so
   the model wraps it once and learns from everything: plays,
   quiz answers, VR drags, CTA taps, deals, packets. It lives
   entirely in THIS browser (localStorage, same rule as the
   persona engine). The site adapts on-device, nothing about
   the person leaves their phone.

   The model keeps a decaying interest score across six domains
   and answers two questions for any surface that asks:
     MCC_MODEL.profile() → { top, ranked, stage, visits }
     MCC_MODEL.suggest() → { label, sub, href, why } next-best-action
   ============================================================ */
window.MCC_MODEL = (function () {
  "use strict";
  var KEY = "mcc_model_v1";
  var HALF_LIFE_DAYS = 14; // interests cool off; the model stays current

  /* what an event means: first match wins, weight = how loud the signal is */
  var MAP = [
    [/offer|claim|tier|quote|lead|wantsite|book.?call|billing/i, "client", 3],
    [/collab|deal|packet|talent|onboard|provider|listing|mstock/i, "artist", 3],
    [/member|donat|tithe|residual|uprise|fellowship|support/i, "org", 3],
    [/docket|psmf|civic|marker|duality|persona|quiz/i, "civic", 2],
    [/vr|gyro|360|motion|beacon|land|slow|install|getapp/i, "experience", 2],
    [/song|play|\bnp\b|nowplaying|audio|catalogue|sound|lyric|subscribe|app_/i, "music", 1],
  ];
  /* conversions: once someone walks through a door, stop selling them that door */
  var GOALS = [
    [/book_call|offer-claim|lead_submit/i, "client"],
    [/collab_signed|talent_listing_saved/i, "artist"],
    [/support-|member_saved|sound_beacon_tap/i, "org"],
    [/install_done/i, "experience"],
  ];
  var PAGES = { // where a domain's next step lives
    music: ["app.html", "Back to the music", "Your rotation is waiting in the app"],
    experience: ["vr-vaunt.html", "Step back inside the jet", "The 360 cabin, pins and all"],
    client: ["hire.html", "Back to the studio", "The weekly system \u00b7 come see me"],
    artist: ["market.html", "Open the Market", "Deals, splits, bookings \u2014 one engine"],
    civic: ["docket-516.html", "Back to the record", "The public record, explained"],
    org: ["market.html#providers", "Join the organization", "Boards \u00b7 programs \u00b7 the donor circle"],
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
  }
  var S = load() || {};
  S.doms = S.doms || {}; S.goals = S.goals || {}; S.shows = S.shows || {}; S.taps = S.taps || {};
  S.events = S.events || 0; S.heat = S.heat || 0; S.visits = S.visits || 0;
  S.last = S.last || 0; S.day = S.day || "";
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  /* time decay: every new day cools interest, heat, and banner fatigue */
  (function tick() {
    var today = new Date().toISOString().slice(0, 10);
    if (S.day !== today) {
      var days = S.last ? Math.min(60, (Date.now() - S.last) / 864e5) : 0;
      var k = Math.pow(0.5, days / HALF_LIFE_DAYS);
      Object.keys(S.doms).forEach(function (d) { S.doms[d] = +(S.doms[d] * k).toFixed(3); });
      S.heat = +(S.heat * k).toFixed(3);
      Object.keys(S.shows).forEach(function (d) { S.shows[d] = +(S.shows[d] * Math.pow(0.5, days / 7)).toFixed(2); });
      // the streak: consecutive days are habit, and habit is a signal
      var y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      S.streak = S.day === y ? (S.streak || 0) + 1 : 1;
      S.day = today; S.visits++;
      save();
    }
  })();

  function observe(name, params) {
    // the page name rides along, so "dwell on song-vaunt.html" reads as music
    var line = name + " " + JSON.stringify(params || {}) + " " + location.pathname;
    // attention is a signal, not just action: long dwell and deep scroll
    // carry their own weight, scaled so a parked tab can't farm points
    var w = 0;
    for (var i = 0; i < MAP.length; i++) {
      if (MAP[i][0].test(line)) {
        var d = MAP[i][1];
        w = MAP[i][2];
        if (name === "dwell") {
          w = Math.min(3, (params && params.s || 0) / 45);
          if (params && params.depth >= 75) w += 1; // they read to Our Street
        }
        S.doms[d] = +((S.doms[d] || 0) + w).toFixed(3);
        break;
      }
    }
    for (var g = 0; g < GOALS.length; g++) {
      if (GOALS[g][0].test(line)) S.goals[GOALS[g][1]] = Date.now();
    }
    if (name === "foryou_tap" && params && params.dom) {
      S.taps[params.dom] = (S.taps[params.dom] || 0) + 1; // the card earned its spot
    }
    S.events++; S.heat = +(S.heat + 1).toFixed(3); S.last = Date.now();
    save();
  }

  /* the archetype layer: the six domains wear names pulled from the
     catalogue's own bars. Stages read as water: how deep you're standing. */
  var ARCH = {
    music: "Scroll Slow",      // the listener who actually slowed down
    experience: "Wide Awake",  // came to see it with their own eyes
    client: "All In",          // ready to put a number on the table
    artist: "Own It",          // splits, masters, the offer
    civic: "The Pillar",       // holds the block up
    org: "The Pillar",         // holds the structure up
  };
  var DEPTH = { "new": "surface", warming: "wading", locked: "deep end" };

  function profile() {
    var ranked = Object.keys(S.doms).map(function (d) { return [d, S.doms[d]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    var stage = S.heat < 6 ? "new" : S.heat < 25 ? "warming" : "locked";
    var top = ranked.length ? ranked[0][0] : null;
    return {
      top: top,
      ranked: ranked,
      // the stage runs on RECENT heat, not lifetime totals. A hot June
      // doesn't make a cold October visitor "locked"
      stage: stage,
      archetype: top ? ARCH[top] || null : null,
      depth: DEPTH[stage],
      visits: S.visits, events: S.events, heat: S.heat,
      streak: S.streak || 1,
      goals: S.goals,
    };
  }

  function freshGoal(dom) {
    return S.goals[dom] && Date.now() - S.goals[dom] < 14 * 864e5;
  }
  function fatigued(dom) {
    // shown five times, never tapped: the card is wallpaper, so rotate it out
    return (S.shows[dom] || 0) >= 5 && !(S.taps[dom] || 0);
  }

  function suggest() {
    var p = profile();
    var here = location.pathname.split("/").pop() || "index.html";
    if (!p.top || p.stage === "new") {
      // cold start: if the persona engine already knows a side, lean on it
      var side = null;
      try { side = window.MCC_PERSONA && window.MCC_PERSONA.balance().side; } catch (e) {}
      var dom0 = side === "present" ? "civic" : "music";
      var g0 = PAGES[dom0];
      if (g0[0] === here) { dom0 = dom0 === "music" ? "experience" : "music"; g0 = PAGES[dom0]; }
      return { label: g0[1], sub: g0[2], href: g0[0], dom: dom0, why: dom0 + ":new" };
    }
    for (var i = 0; i < p.ranked.length; i++) {
      var dom = p.ranked[i][0];
      if (!PAGES[dom]) continue;
      if (PAGES[dom][0] === here) continue;   // never the room they stand in
      if (freshGoal(dom)) continue;           // never resell a fresh conversion
      if (fatigued(dom)) continue;            // never repeat what gets ignored
      var g = PAGES[dom];
      return { label: g[1], sub: g[2], href: g[0], dom: dom, why: dom + ":" + p.stage };
    }
    return { label: "Start with the sound", sub: "The catalogue \u00b7 every record on the page", href: "app.html", dom: "music", why: "fallback" };
  }

  /* a surface that rendered the suggestion reports it: fatigue is learned,
     not guessed: five silent impressions and that domain rotates out */
  function shown(dom) {
    if (!dom) return;
    S.shows[dom] = +((S.shows[dom] || 0) + 1).toFixed(2);
    save();
  }

  /* the money framing: same deal, two doors. Mission-leaning people
     (org/civic) hear the tithe first; builders hear the equity first.
     Once chosen, the door holds for a week, so the story stays coherent. */
  function pitch() {
    if (S.pitch && Date.now() - S.pitch.at < 7 * 864e5) return S.pitch.door;
    var p = profile();
    var door = p.top === "org" || p.top === "civic" ? "tithe" : "equity";
    S.pitch = { door: door, at: Date.now() };
    save();
    return door;
  }

  /* the voice: WHICH psychology closes this person. Clients answer to
     scarcity, mission people to belonging-in-the-cause, artists to proof,
     listeners to belonging. Surfaces ask persuade() before writing copy. */
  function persuade() {
    var p = profile();
    if (p.top === "client") return "scarcity";
    if (p.top === "org" || p.top === "civic") return "mission";
    if (p.top === "artist") return "proof";
    return "belonging";
  }

  /* the attention sense: when the tab closes or hides, the time spent and
     the depth reached are reported once; sendBeacon survives the exit */
  (function attention() {
    var t0 = Date.now(), depth = 0, sent = false;
    window.addEventListener("scroll", function () {
      var h = document.documentElement.scrollHeight - innerHeight;
      if (h > 0) depth = Math.max(depth, Math.round(scrollY / h * 100));
    }, { passive: true });
    function flush() {
      if (sent) return;
      var secs = Math.round((Date.now() - t0) / 1000);
      if (secs < 5) return; // a bounce teaches nothing
      sent = true;
      window.MCC_TRACK("dwell", { page: location.pathname.split("/").pop() || "index.html", s: secs, depth: depth });
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });
  })();

  /* the wrap: everything MCC_TRACK hears, the model learns */
  var orig = window.MCC_TRACK;
  window.MCC_TRACK = function (name, params) {
    try { observe(name, params); } catch (e) {}
    return orig(name, params);
  };

  return { profile: profile, suggest: suggest, shown: shown, pitch: pitch, persuade: persuade, observe: observe,
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} } };
})();
