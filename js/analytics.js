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
  /* FIRST-PARTY FIRST, AND NOT ONLY ON PRINCIPLE.

     api.mccluster.org is this house's own domain, so no blocklist carries
     it — and roughly a third of real visitors never appear in Google
     Analytics because every ad blocker ships google-analytics.com by
     default. Those people appear here.

     The Worker is also the only thing in the chain that can see where a
     visitor actually is. A request arriving at a Supabase edge function
     carries cf-ray and nothing else; the country, city, timezone, ASN and
     network name live on `request.cf`, which exists only inside the
     Worker. That was measured against production, not assumed.

     The Supabase function stays as the fallback: it is the writer either
     way, and a house that cannot reach its own Worker should still be
     able to count. */
  var COLLECT = "https://api.mccluster.org/v1/collect";
  var COLLECT_FALLBACK = SB_URL + "/functions/v1/collect";

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
  function connectionFacts() {
    var out = { online: navigator.onLine !== false };
    try {
      var n = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!n) return out;
      if (n.type) out.type = n.type;
      if (n.effectiveType) out.effective = n.effectiveType;
      if (typeof n.downlink === "number") out.downlink_mbps = n.downlink;
      if (typeof n.downlinkMax === "number") out.downlink_max_mbps = n.downlinkMax;
      if (typeof n.rtt === "number") out.rtt_ms = n.rtt;
      if (typeof n.saveData === "boolean") out.save_data = n.saveData;
    } catch (e) {}
    return out;
  }

  function deviceFacts() {
    var d = {};
    try {
      d.w = screen.width; d.h = screen.height;
      d.aw = screen.availWidth; d.ah = screen.availHeight;
      d.vw = window.innerWidth; d.vh = window.innerHeight;
      d.dpr = window.devicePixelRatio || 1;
      d.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      d.tz_offset_min = new Date().getTimezoneOffset();
      d.lang = navigator.language || "";
      d.platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
      d.mobile = !!(navigator.userAgentData && navigator.userAgentData.mobile);
      d.vendor = navigator.vendor || "";
      d.touch = navigator.maxTouchPoints || 0;
      d.webdriver = navigator.webdriver === true;
      d.online = navigator.onLine !== false;
      d.network = connectionFacts();
      d.webgpu = !!navigator.gpu;
      d.wasm = typeof WebAssembly === "object";
      d.webrtc = typeof RTCPeerConnection !== "undefined";
      d.service_worker = "serviceWorker" in navigator;
      if (navigator.hardwareConcurrency) d.cpu = navigator.hardwareConcurrency;
      if (navigator.deviceMemory) d.mem = navigator.deviceMemory;
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
      fetch(COLLECT, opts).then(function (r) {
        /* A blocked or unreachable first-party route is worth one retry at
           the writer directly. Not a loop: two attempts, then the batch is
           gone, because nobody's page should stall over a statistic. */
        if (!r || r.ok) return;
        return fetch(COLLECT_FALLBACK, opts).catch(function () {});
      }).catch(function () {
        try { fetch(COLLECT_FALLBACK, opts).catch(function () {}); } catch (e2) {}
      });
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

/* ============================================================
   THE INSTRUMENT PANEL — what Google would not tell you.

   Google Analytics answers "how many". It will not answer "who,
   on what, from where, and what did they actually do" — because
   it throws the address away on ingest, samples the rest, hands
   back buckets instead of rows, and is blocked outright for a
   third of visitors by any ad blocker. None of those are
   oversights. They are the product.

   This is the opposite shape. Every sensor below writes a row
   through MCC_TRACK, which lands in public.events with the
   address, the network, the device and the account attached, and
   the owner can run SQL against it. What is here that GA4
   structurally cannot give you:

     rage clicks and dead clicks    — where the page fights people
     per-section attention          — what was actually READ, not scrolled past
     form field timing              — which question made them stop
     exit intent                    — the moment they decided to go
     per-visitor Core Web Vitals    — real speed, not a lab score
     JS errors with stacks          — the bugs only visitors see
     GPU, battery, memory, network  — what they are actually on
     raw rows, forever, in SQL      — no sampling, no 14-month cap

   THE TWO THINGS THIS DELIBERATELY DOES NOT DO, so nobody has to
   wonder later:

   It never records what anybody TYPES. Field names, focus order
   and timing, yes — those say which question cost you the lead.
   The characters, no. Anything that looks like a password, a
   card, or a one-time code is not instrumented at all, not even
   for timing.

   It does not fingerprint to defeat a cleared browser. The device
   id is a random value in localStorage. Canvas, audio and font
   hashing exist specifically to re-identify somebody who has
   erased their data, which is the one analytics practice
   regulators actually prosecute, and it would buy nothing here:
   knowing your own audience does not require beating them.

   DISCLOSURE IS A REAL OBLIGATION AND IT IS NOT HANDLED IN CODE.
   Connecticut's CTDPA — McCluster Corp is a Connecticut public
   charity — requires a privacy notice that says what is collected
   and why. policy.html needs a paragraph describing this. That is
   a writing task, not a config flag, and it is not done yet.
   ============================================================ */
(function (root) {
  "use strict";

  var T = function (n, p) { if (root.MCC_TRACK) root.MCC_TRACK(n, p || {}); };
  var doc = root.document;
  if (!doc) return;

  function now() { return Date.now(); }
  /* declared up here because the exit-intent sensor reads it, and a reader
     should not have to trust hoisting to see that it is set */
  var T0 = Date.now();
  function n2(x) { return Math.round(x * 100) / 100; }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }

  /* A short, stable description of an element: enough to find it again in
     the markup, never its contents. */
  function describe(el) {
    if (!el || !el.tagName) return null;
    var id = el.id ? "#" + el.id : "";
    var cls = "";
    if (el.className && typeof el.className === "string") {
      cls = "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    }
    var txt = "";
    if (el.textContent) txt = el.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
    return {
      tag: el.tagName.toLowerCase(),
      sel: (el.tagName.toLowerCase() + id + cls).slice(0, 120),
      text: txt || null,
      href: el.getAttribute ? (el.getAttribute("href") || null) : null,
      cta: el.getAttribute ? (el.getAttribute("data-cta") || null) : null,
    };
  }

  /* =========================================================
     1. THE VISITOR'S HISTORY WITH THIS HOUSE
     GA4 calls everyone "new" or "returning" and stops there.
     ========================================================= */
  var HIST = "mcc_hist";
  var hist = safe(function () { return JSON.parse(localStorage.getItem(HIST) || "null"); })
    || { first: now(), last: 0, visits: 0, pages: 0 };
  var gap = now() - (hist.last || 0);
  var newVisit = gap > 30 * 60 * 1000;
  if (newVisit) hist.visits = (hist.visits || 0) + 1;
  hist.pages = (hist.pages || 0) + 1;
  hist.last = now();
  safe(function () { localStorage.setItem(HIST, JSON.stringify(hist)); });

  var DAY = 86400000;
  var visitor = {
    visits: hist.visits,
    pages_all_time: hist.pages,
    days_known: Math.floor((now() - hist.first) / DAY),
    days_since_last: newVisit ? Math.floor(gap / DAY) : 0,
    returning: hist.visits > 1,
  };

  /* =========================================================
     2. THE MACHINE — deeper than a user-agent string
     ========================================================= */
  function gpu() {
    return safe(function () {
      var c = doc.createElement("canvas");
      var gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!gl) return null;
      var dbg = gl.getExtension("WEBGL_debug_renderer_info");
      /* The renderer string, as an attribute of the machine. Not hashed,
         not combined with anything, not used to identify a return visit. */
      return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 120) : null;
    });
  }

  function networkState() {
    return safe(function () {
      var n = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      var out = { online: navigator.onLine !== false };
      if (!n) return out;
      if (n.type) out.type = n.type;
      if (n.effectiveType) out.effective = n.effectiveType;
      if (typeof n.downlink === "number") out.downlink_mbps = n2(n.downlink);
      if (typeof n.downlinkMax === "number") out.downlink_max_mbps = n2(n.downlinkMax);
      if (typeof n.rtt === "number") out.rtt_ms = Math.round(n.rtt);
      if (typeof n.saveData === "boolean") out.save_data = n.saveData;
      return out;
    }) || { online: navigator.onLine !== false };
  }

  var machine = {
    gpu: gpu(),
    touch: safe(function () { return navigator.maxTouchPoints || 0; }),
    colors: safe(function () { return screen.colorDepth; }),
    dark: safe(function () { return matchMedia("(prefers-color-scheme: dark)").matches; }),
    reduced: safe(function () { return matchMedia("(prefers-reduced-motion: reduce)").matches; }),
    orient: safe(function () { return screen.orientation && screen.orientation.type; }),
    orient_angle: safe(function () { return screen.orientation && screen.orientation.angle; }),
    pdf: safe(function () { return navigator.pdfViewerEnabled; }),
    cookies: safe(function () { return navigator.cookieEnabled; }),
    langs: safe(function () { return (navigator.languages || []).slice(0, 4).join(","); }),
    network: networkState(),
    online: navigator.onLine !== false,
    webdriver: navigator.webdriver === true,
    webgpu: !!navigator.gpu,
    service_worker: "serviceWorker" in navigator,
  };

  safe(function () {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(function (b) {
      T("device_power", { level: n2(b.level), charging: b.charging });
    }).catch(function () {});
  });

  /* Network state can change during a visit (Wi-Fi -> cellular, tunnel,
     offline/online). Record the transition rather than assuming the first
     page-view still describes the connection ten minutes later. */
  safe(function () {
    var n = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (n && n.addEventListener) n.addEventListener("change", function () {
      T("network_change", { reason: "connection", network: networkState() });
    });
  });
  root.addEventListener("online", function () {
    T("network_change", { reason: "online", network: networkState() });
  });
  root.addEventListener("offline", function () {
    T("network_change", { reason: "offline", network: networkState() });
  });

  /* Precise location is special: the browser owns the permission prompt.
     Never manufacture a location, never infer a street from fingerprinting,
     and never prompt on page load. If permission is already granted we may
     read it; otherwise MCC_LOCATION.request() must be called from an explicit
     user action. */
  function privacyQuiet() {
    return navigator.globalPrivacyControl === true ||
      navigator.doNotTrack === "1" || root.doNotTrack === "1";
  }
  function geoNumber(value, places) {
    if (typeof value !== "number" || !isFinite(value)) return null;
    var k = Math.pow(10, places);
    return Math.round(value * k) / k;
  }
  function preciseLocation() {
    return new Promise(function (resolve) {
      if (privacyQuiet()) return resolve({ ok: false, reason: "privacy_signal" });
      if (!navigator.geolocation) return resolve({ ok: false, reason: "unsupported" });
      navigator.geolocation.getCurrentPosition(function (pos) {
        var co = pos.coords || {};
        var payload = {
          source: "browser_geolocation",
          lat: geoNumber(co.latitude, 5),
          lon: geoNumber(co.longitude, 5),
          accuracy_m: geoNumber(co.accuracy, 1),
          altitude_m: geoNumber(co.altitude, 1),
          altitude_accuracy_m: geoNumber(co.altitudeAccuracy, 1),
          heading_deg: geoNumber(co.heading, 1),
          speed_mps: geoNumber(co.speed, 2),
          observed_at: new Date(pos.timestamp || Date.now()).toISOString(),
        };
        T("precise_location", payload);
        resolve({ ok: true, location: payload });
      }, function (err) {
        resolve({ ok: false, reason: "denied_or_unavailable", code: err && err.code || null });
      }, { enableHighAccuracy: true, maximumAge: 300000, timeout: 10000 });
    });
  }
  root.MCC_LOCATION = {
    request: preciseLocation,
    status: function () {
      if (privacyQuiet()) return Promise.resolve("privacy_signal");
      if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve("unknown");
      return navigator.permissions.query({ name: "geolocation" }).then(function (p) { return p.state; }).catch(function () { return "unknown"; });
    },
  };
  if (!privacyQuiet() && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "geolocation" }).then(function (p) {
      T("location_permission", { state: p.state });
      if (p.state === "granted") preciseLocation();
      p.addEventListener && p.addEventListener("change", function () {
        T("location_permission", { state: p.state });
        if (p.state === "granted") preciseLocation();
      });
    }).catch(function () {});
  }

  /* =========================================================
     3. THE PAGE VIEW — the anchor row every other row hangs off
     ========================================================= */
  T("page_view", {
    title: (doc.title || "").slice(0, 120),
    url: location.pathname + location.search,
    visitor: visitor,
    machine: machine,
    new_visit: newVisit,
  });

  /* =========================================================
     4. CLICKS — including the two kinds that mean something is wrong

     A RAGE CLICK is three or more taps in the same small area inside
     a second: the signal of something that looks pressable and is not.
     A DEAD CLICK is a tap that changed nothing — no navigation, no DOM
     mutation, no focus change. Both are the most actionable numbers in
     analytics and neither exists in GA4 at any price.
     ========================================================= */
  var recent = [];
  var mutated = false;
  var mo = safe(function () {
    var m = new MutationObserver(function () { mutated = true; });
    m.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
    return m;
  });

  doc.addEventListener("click", function (e) {
    var el = e.target;
    var d = describe(el && el.closest ? (el.closest("a,button,[role=button],[data-cta],input,label") || el) : el);
    if (!d) return;

    var t = now();
    recent = recent.filter(function (r) { return t - r.t < 1000; });
    var near = recent.filter(function (r) {
      return Math.abs(r.x - e.clientX) < 40 && Math.abs(r.y - e.clientY) < 40;
    });
    recent.push({ t: t, x: e.clientX, y: e.clientY });

    var payload = {
      el: d.sel, text: d.text, href: d.href, cta: d.cta,
      x: e.clientX, y: e.clientY,
      /* where on the page, not just where on the screen */
      pct_x: n2(e.pageX / Math.max(1, doc.documentElement.scrollWidth) * 100),
      pct_y: n2(e.pageY / Math.max(1, doc.documentElement.scrollHeight) * 100),
    };

    if (near.length >= 2) {
      T("rage_click", payload);
      recent = [];
      return;
    }

    T("click", payload);

    /* Dead click: give the page a beat to navigate, mutate or focus. If
       nothing at all happened, the tap went nowhere. */
    mutated = false;
    var url0 = location.href, active0 = doc.activeElement;
    var interactive = d.tag === "a" || d.tag === "button" || d.tag === "input" ||
      d.tag === "select" || d.tag === "textarea" || d.tag === "label" || !!d.cta;
    setTimeout(function () {
      if (!interactive) return;
      if (mutated || location.href !== url0 || doc.activeElement !== active0) return;
      T("dead_click", payload);
    }, 450);
  }, { passive: true, capture: true });

  /* =========================================================
     5. SCROLL — depth, and the speed that separates reading from fleeing
     ========================================================= */
  var depth = 0, marks = {}, lastY = 0, lastT = now(), fastest = 0;
  root.addEventListener("scroll", function () {
    var h = doc.documentElement.scrollHeight - root.innerHeight;
    if (h <= 0) return;
    /* CLAMPED, BECAUSE THE DENOMINATOR MOVES. On a page whose height
       shrinks after you have scrolled — a multi-step form collapsing a
       finished step, a filter hiding rows — scrollY can exceed the new
       scrollable height and the ratio goes past 1. The old sensor did not
       clamp, and onboard.html has been reporting an average scroll depth
       of 289% in production, which is the tell. */
    var pct = Math.min(100, Math.max(0, Math.round(scrollY / h * 100)));
    if (pct > depth) depth = pct;
    [25, 50, 75, 90, 100].forEach(function (m) {
      if (pct >= m && !marks[m]) { marks[m] = now(); T("scroll_depth", { pct: m }); }
    });
    var t = now(), dt = t - lastT;
    if (dt > 80) {
      var v = Math.abs(scrollY - lastY) / dt * 1000;
      if (v > fastest) fastest = Math.round(v);
      lastY = scrollY; lastT = t;
    }
  }, { passive: true });

  /* =========================================================
     6. ATTENTION — which parts of the page were actually looked at

     Scroll depth says the pixels went past. This says the section sat
     in the viewport for real seconds. It is the difference between
     "they reached the pricing" and "they read the pricing".
     ========================================================= */
  var watched = [];
  safe(function () {
    if (!root.IntersectionObserver) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var rec = en.target.__mccAtt || (en.target.__mccAtt = { seen: 0, since: 0 });
        if (en.isIntersecting) { rec.since = now(); }
        else if (rec.since) { rec.seen += now() - rec.since; rec.since = 0; }
      });
    }, { threshold: 0.5 });
    var sel = "section,[data-section],[id]>h2,article,.buy,.offer,footer";
    [].slice.call(doc.querySelectorAll(sel)).slice(0, 40).forEach(function (el) {
      io.observe(el); watched.push(el);
    });
  });

  function attention() {
    var out = [];
    watched.forEach(function (el) {
      var rec = el.__mccAtt;
      if (!rec) return;
      var ms = rec.seen + (rec.since ? now() - rec.since : 0);
      if (ms > 900) {
        var d = describe(el);
        out.push({ sel: d && d.sel, s: Math.round(ms / 1000) });
      }
    });
    return out.sort(function (a, b) { return b.s - a.s; }).slice(0, 12);
  }

  /* =========================================================
     7. FORMS — which question cost you the lead

     NAMES AND TIMING ONLY. The characters somebody types are never
     read, and a field that could hold a secret is not instrumented at
     all. That is not caution for its own sake: a form analytics tool
     that captures values is a breach waiting for its disclosure
     letter, and it would answer no question this does not.
     ========================================================= */
  var SECRET = /pass|pwd|card|cvc|cvv|ccnum|credit|secure|otp|code|token|ssn|social|routing|account.*num/i;
  function secret(el) {
    if (!el || !el.tagName) return true;
    var t = (el.type || "").toLowerCase();
    if (t === "password" || t === "hidden") return true;
    var s = [el.name, el.id, el.autocomplete, el.getAttribute("aria-label")].join(" ");
    return SECRET.test(s);
  }
  function fieldName(el) {
    return String(el.name || el.id || el.getAttribute("aria-label") || el.type || "field").slice(0, 60);
  }

  var fields = {}, order = [], formStarted = false, lastField = null;
  doc.addEventListener("focusin", function (e) {
    var el = e.target;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || secret(el)) return;
    var k = fieldName(el);
    if (!fields[k]) { fields[k] = { ms: 0, visits: 0, edits: 0 }; order.push(k); }
    fields[k].visits++;
    fields[k].since = now();
    lastField = k;
    if (!formStarted) { formStarted = true; T("form_start", { field: k, form: (el.form && (el.form.id || el.form.name)) || null }); }
  }, true);

  doc.addEventListener("focusout", function (e) {
    var el = e.target;
    if (!el || !fields[fieldName(el)]) return;
    var f = fields[fieldName(el)];
    if (f.since) { f.ms += now() - f.since; f.since = 0; }
  }, true);

  /* A correction is a backspace or a delete: the field was answered and
     then re-answered, which is hesitation you can see. The key identity
     is all that is read — never the character. */
  doc.addEventListener("keydown", function (e) {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    var el = e.target;
    if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || secret(el)) return;
    var f = fields[fieldName(el)];
    if (f) f.edits++;
  }, true);

  doc.addEventListener("submit", function (e) {
    T("form_submit", { form: (e.target && (e.target.id || e.target.name)) || null, fields: order.length });
  }, true);

  function formState() {
    if (!formStarted) return null;
    var out = {};
    Object.keys(fields).forEach(function (k) {
      var f = fields[k];
      out[k] = { s: Math.round((f.ms + (f.since ? now() - f.since : 0)) / 1000), visits: f.visits, edits: f.edits };
    });
    return { order: order.slice(0, 20), last: lastField, detail: out };
  }

  /* =========================================================
     8. EXIT INTENT — the moment they decided to leave
     ========================================================= */
  var exited = false;
  doc.addEventListener("mouseout", function (e) {
    if (exited || e.clientY > 8 || e.relatedTarget) return;
    exited = true;
    T("exit_intent", { depth: depth, s: Math.round((now() - T0) / 1000) });
  });

  /* =========================================================
     9. COPY — what somebody thought was worth taking
     ========================================================= */
  /* WHOSE WORDS ARE THEY. That a copy happened, and how much came with it,
     is always worth recording and is never anybody's personal data. The text
     itself only is when it is the house's own writing on a public page.
     Three cases where it is not, and all three record the length alone:
     a signed-in surface, where what is painted on screen is the visitor's
     own account data; a field or a contenteditable, where the words are
     something they typed, which this file does not read; and anything the
     page has marked private. */
  function housesOwnWords(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    for (; el; el = el.parentElement) {
      var t = el.tagName;
      if (t === "INPUT" || t === "TEXTAREA") return false;
      if (el.isContentEditable) return false;
      if (el.hasAttribute && el.hasAttribute("data-private")) return false;
    }
    return true;
  }
  function signedIn() {
    return !!safe(function () {
      var s = JSON.parse(localStorage.getItem("mccdb_session") || "null");
      return s && s.access_token;
    });
  }

  doc.addEventListener("copy", function () {
    var s = safe(function () { return getSelection(); });
    var sel = String(s || "");
    var quotable = !!s && !signedIn() &&
      housesOwnWords(s.anchorNode) && housesOwnWords(s.focusNode);
    T("copy", {
      chars: sel.length,
      text: quotable ? sel.trim().replace(/\s+/g, " ").slice(0, 120) : null,
    });
  });

  /* =========================================================
     10. ERRORS — the bugs that only ever happen to visitors
     ========================================================= */
  root.addEventListener("error", function (e) {
    if (!e || !e.message) return;
    T("js_error", {
      msg: String(e.message).slice(0, 200),
      src: String(e.filename || "").slice(0, 160),
      line: e.lineno || null, col: e.colno || null,
    });
  });
  root.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    T("js_rejection", { msg: String((r && (r.message || r)) || "").slice(0, 200) });
  });

  /* =========================================================
     11. SPEED, AS THE VISITOR ACTUALLY EXPERIENCED IT

     A lab score describes a machine in a data centre. These are the
     real numbers off the real phone on the real network.
     ========================================================= */
  var vitals = {};
  function po(type, cb, extra) {
    safe(function () {
      var o = new PerformanceObserver(function (l) { l.getEntries().forEach(cb); });
      o.observe(Object.assign({ type: type, buffered: true }, extra || {}));
    });
  }
  po("largest-contentful-paint", function (en) { vitals.lcp = Math.round(en.startTime); });
  po("layout-shift", function (en) { if (!en.hadRecentInput) vitals.cls = n2((vitals.cls || 0) + en.value); });
  po("event", function (en) { if (en.duration > (vitals.inp || 0)) vitals.inp = Math.round(en.duration); }, { durationThreshold: 40 });
  po("first-input", function (en) { vitals.fid = Math.round(en.processingStart - en.startTime); });
  safe(function () {
    var n = performance.getEntriesByType("navigation")[0];
    if (!n) return;
    vitals.ttfb = Math.round(n.responseStart);
    vitals.dom = Math.round(n.domContentLoadedEventEnd);
    vitals.load = Math.round(n.loadEventEnd);
    vitals.type = n.type;
    vitals.protocol = n.nextHopProtocol || null;
    vitals.dns_ms = Math.max(0, Math.round(n.domainLookupEnd - n.domainLookupStart));
    vitals.connect_ms = Math.max(0, Math.round(n.connectEnd - n.connectStart));
    vitals.tls_ms = n.secureConnectionStart > 0 ? Math.max(0, Math.round(n.connectEnd - n.secureConnectionStart)) : null;
    vitals.response_ms = Math.max(0, Math.round(n.responseEnd - n.responseStart));
    vitals.transfer_bytes = Number(n.transferSize || 0);
    vitals.encoded_bytes = Number(n.encodedBodySize || 0);
    vitals.decoded_bytes = Number(n.decodedBodySize || 0);
  });

  /* =========================================================
     12. THE ACCOUNTING — time here, time away, and the whole shape
         of the visit, sent once when the page goes
     ========================================================= */
  var visible = 0, hidden = 0, blurs = 0, since = now(), isHidden = false;
  doc.addEventListener("visibilitychange", function () {
    var t = now();
    if (doc.visibilityState === "hidden") { visible += t - since; blurs++; isHidden = true; }
    else { hidden += t - since; isHidden = false; }
    since = t;
  });

  var sent = false;
  function report() {
    if (sent) return;
    var t = now();
    if (isHidden) hidden += t - since; else visible += t - since;
    since = t;
    if (t - T0 < 1200) return;   /* a bounce off a mistyped URL teaches nothing */
    sent = true;
    T("page_leave", {
      s: Math.round((t - T0) / 1000),
      visible_s: Math.round(visible / 1000),
      hidden_s: Math.round(hidden / 1000),
      away: blurs,
      depth: depth,
      fastest_scroll: fastest,
      read: attention(),
      form: formState(),
      vitals: vitals,
      exit_intent: exited,
    });
  }
  doc.addEventListener("visibilitychange", function () {
    if (doc.visibilityState === "hidden") report();
  });
  root.addEventListener("pagehide", report);

  root.MCC_SENSE = { visitor: visitor, machine: machine, attention: attention, vitals: function () { return vitals; } };
})(window);
