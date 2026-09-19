/* ============================================================
   THE HOUSE'S OWN EYES.

   This used to be a Google Analytics loader with a first-party copy
   bolted to the side. Google is gone. Not disabled behind an empty
   constant — removed, along with the Meta pixel and the Google Ads
   conversion tag, none of which ever had an ID pasted into them.

   What replaced it is not a thinner version of the same thing. It is
   the collector itself: supabase/functions/collect, on the platform's
   own infrastructure, writing to public.events, readable by the owner
   without logging into anybody's dashboard or accepting anybody's terms.

   WHY THE SERVER IS THE WRITER NOW. This file used to POST straight to
   /rest/v1/events. That works for a name and a path, and it cannot
   work for the thing the owner actually asked for: a page cannot see
   its own IP address. There is no API for it. Every client-side trick
   for getting one is a request to a third party, which is the exact
   dependency being removed. The address exists on the request, at the
   edge, and nowhere else — so the collector has to be a server, and
   once it is, the address, the user agent and the country stop being
   claims and become observations.

   The old direct insert was also wrapped in a .catch that discarded
   the failure, against a table that had no migration behind it. A
   collector that silently drops everything is indistinguishable from
   one that works. The collector answers now, and the answer is real.

   WHAT LEAVES THIS BROWSER. An event name, the path, the small bag of
   properties the calling page chose, a device id, a session id, and
   what the browser can honestly say about itself: screen, timezone,
   platform, language. MCC_MODEL below still runs entirely on-device
   and still sends nothing.
   ============================================================ */

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
  /* Self-contained constants: this file loads before backend.js. */
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var COLLECT = SB_URL + "/functions/v1/collect";

  function store(read) {
    try { return read(); } catch (e) { return null; }
  }

  function uuid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      var b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      var h = [].map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
    } catch (e) {
      return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
  }

  /* ---- the device ----
     A random id kept in localStorage. Deliberately NOT a fingerprint
     computed from canvas, fonts or audio: those are built to survive a
     person clearing their data, which makes them a tracking measure
     rather than a counting one. This one distinguishes browsers, and
     clearing the store genuinely clears it. */
  var DEVICE_KEY = "mcc_device";
  var deviceId = store(function () { return localStorage.getItem(DEVICE_KEY); });
  if (!deviceId) {
    deviceId = uuid();
    store(function () { localStorage.setItem(DEVICE_KEY, deviceId); return 1; });
  }

  /* ---- the visit ----
     One session is one sitting. Half an hour of nothing ends it, which
     is the same rule every analytics product uses and the reason a
     return the next morning reads as a return rather than a long tail
     on yesterday. */
  var SESSION_KEY = "mcc_session";
  var SESSION_GAP_MS = 30 * 60 * 1000;
  function sessionId() {
    var now = Date.now();
    var s = store(function () { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); });
    if (!s || !s.id || now - (s.at || 0) > SESSION_GAP_MS) s = { id: uuid(), at: now };
    else s.at = now;
    store(function () { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); return 1; });
    return s.id;
  }

  /* ---- what the browser can honestly say about itself ---- */
  function deviceFacts() {
    var d = {};
    try {
      d.w = screen.width; d.h = screen.height;
      d.vw = window.innerWidth; d.vh = window.innerHeight;
      d.dpr = window.devicePixelRatio || 1;
      d.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      d.lang = navigator.language || "";
      d.platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
      d.mobile = !!(navigator.userAgentData && navigator.userAgentData.mobile);
      if (navigator.hardwareConcurrency) d.cpu = navigator.hardwareConcurrency;
      if (navigator.deviceMemory) d.mem = navigator.deviceMemory;
      if (navigator.connection && navigator.connection.effectiveType) d.net = navigator.connection.effectiveType;
      /* Standalone means installed to a home screen, which is a different
         kind of visitor and worth being able to count separately. */
      d.standalone = !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches) ||
        !!window.navigator.standalone;
    } catch (e) {}
    return d;
  }

  /* ---- acquisition, first-party: where every soul CAME from ----
     Referrer and UTM tags bank once, on the first page of the first
     visit, ride every later event as props.acq, and fire one 'acquired'
     event. The numbers Google used to keep behind its own login now
     live in the house's own table. */
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
      setTimeout(function () {
        if (window.MCC_TRACK) window.MCC_TRACK("acquired", { src: ACQ.src, med: ACQ.med, cmp: ACQ.cmp, plug: ACQ.plug });
      }, 500);
    }
  } catch (e4) { ACQ = null; }

  /* The session token, when there is one, so the collector can attribute
     the event to an account. It is VERIFIED there, never believed — this
     is the token itself, not a uid this file decoded and asserted. */
  function bearer() {
    var s = store(function () { return JSON.parse(localStorage.getItem("mccdb_session") || "null"); });
    return s && s.access_token ? "Bearer " + s.access_token : null;
  }

  /* ---- the queue ----
     One request per event is a request per click, which on a slow phone
     is measurably worse than the thing being measured. Events gather and
     go in batches: when enough pile up, a couple of seconds after the
     first one, and unconditionally the moment the page is hidden. */
  var BATCH = 12;
  var LINGER_MS = 2500;
  var queue = [];
  var timer = null;

  function send(batch, keepalive) {
    if (!batch.length) return;
    var headers = { "Content-Type": "application/json", apikey: SB_KEY };
    var auth = bearer();
    if (auth) headers.Authorization = auth;
    var opts = {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        device_id: deviceId,
        session_id: sessionId(),
        device: deviceFacts(),
        events: batch,
      }),
    };
    /* keepalive hands the request to the browser to finish after this
       page is gone. It is the difference between recording the last
       thing somebody did and recording everything except that. */
    if (keepalive) opts.keepalive = true;
    try {
      fetch(COLLECT, opts).catch(function () {});
    } catch (e) { /* a statistic is never worth an exception in a page */ }
  }

  function flush(keepalive) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var batch = queue;
    queue = [];
    send(batch, keepalive);
  }

  /* HIDDEN IS THE ONLY RELIABLE GOODBYE ON A PHONE. pagehide covers an
     in-browser navigation and little else; switching apps only hides the
     page, and the tab may never get another instruction. Same lesson the
     player learned the hard way in js/pip.js. */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", function () { flush(true); });

  function queueEvent(name, params) {
    queue.push({
      name: String(name || "").slice(0, 120),
      path: location.pathname.split("/").pop() || "index.html",
      props: params || {},
      referrer: document.referrer || null,
    });
    if (queue.length >= BATCH) flush(false);
    else if (!timer) timer = setTimeout(function () { flush(false); }, LINGER_MS);
  }

  /* The one win that counts: a booked call. First-party, like everything
     else here — there is no ad platform left to tell. */
  window.MCC_CONVERT = function (label) {
    queueEvent("conversion", { goal: "book_call", label: label || "" });
    flush(false);
  };

  return function (name, params) {
    params = params || {};
    if (ACQ && !params.acq) params.acq = ACQ.src + "/" + ACQ.med + (ACQ.cmp ? "/" + ACQ.cmp : "");
    queueEvent(name, params);
    // any booking CTA anywhere on the site counts as the conversion
    if (name === "cta_click" && /book-call|offer-claim/.test(params.label || "")) window.MCC_CONVERT(params.label);
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
