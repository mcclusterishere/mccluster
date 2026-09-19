/* McCluster Analytics — embeddable first-party analytics SDK.
   Site-scoped IDs only. No cross-site fingerprinting. No input capture. */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) {
    var all = document.scripts;
    for (var i = all.length - 1; i >= 0; i--) {
      if (/\/(?:a\.js|mc-analytics\.js)(?:\?|$)/.test(all[i].src || "")) { script = all[i]; break; }
    }
  }
  var params = new URL((script && script.src) || location.href).searchParams;
  var siteKey = (script && script.dataset && script.dataset.site) || params.get("site") || "";
  var consentMode = ((script && script.dataset && script.dataset.consent) || params.get("consent") || "required").toLowerCase();
  var endpoint = (script && script.dataset && script.dataset.endpoint) || "https://api.mccluster.org/v1/collect";
  if (!/^mca_[a-f0-9]{32}$/i.test(siteKey)) return;

  var ROOT = "mca:" + siteKey + ":";
  var DEVICE_KEY = ROOT + "device";
  var SESSION_KEY = ROOT + "session";
  var CONSENT_KEY = ROOT + "consent";
  var queue = [];
  var timer = null;
  var started = false;
  var pendingPageview = true;

  function quiet() {
    return navigator.globalPrivacyControl === true ||
      navigator.doNotTrack === "1" || window.doNotTrack === "1";
  }
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    return Array.from(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
  }
  function storageGet(storage, key) { try { return storage.getItem(key); } catch (_) { return null; } }
  function storageSet(storage, key, value) { try { storage.setItem(key, value); } catch (_) {} }
  function storageDel(storage, key) { try { storage.removeItem(key); } catch (_) {} }

  function consentState() {
    if (quiet()) return "denied";
    if (consentMode === "granted") return "granted";
    if (consentMode === "cookieless") return "cookieless";
    return storageGet(localStorage, CONSENT_KEY) === "granted" ? "granted" : "required";
  }
  function canSend() {
    var c = consentState();
    return c === "granted" || c === "cookieless";
  }
  function deviceId() {
    if (consentState() !== "granted") return null;
    var id = storageGet(localStorage, DEVICE_KEY);
    if (!id) { id = uuid(); storageSet(localStorage, DEVICE_KEY, id); }
    return id;
  }
  function sessionId() {
    if (!canSend()) return null;
    var id = storageGet(sessionStorage, SESSION_KEY);
    if (!id) { id = uuid(); storageSet(sessionStorage, SESSION_KEY, id); }
    return id;
  }
  function network() {
    var out = { online: navigator.onLine !== false };
    try {
      var n = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!n) return out;
      if (n.type) out.type = n.type;
      if (n.effectiveType) out.effective = n.effectiveType;
      if (typeof n.downlink === "number") out.downlink_mbps = n.downlink;
      if (typeof n.rtt === "number") out.rtt_ms = n.rtt;
      if (typeof n.saveData === "boolean") out.save_data = n.saveData;
    } catch (_) {}
    return out;
  }
  function device() {
    var d = {
      screen: [screen.width, screen.height],
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio || 1,
      lang: navigator.language || "",
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ""),
      platform: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "",
      mobile: !!(navigator.userAgentData && navigator.userAgentData.mobile),
      touch: navigator.maxTouchPoints || 0,
      online: navigator.onLine !== false,
      network: network(),
      webgpu: !!navigator.gpu,
      wasm: typeof WebAssembly === "object",
      service_worker: "serviceWorker" in navigator
    };
    if (navigator.hardwareConcurrency) d.cpu = navigator.hardwareConcurrency;
    if (navigator.deviceMemory) d.mem = navigator.deviceMemory;
    return d;
  }
  function scrub(value, depth) {
    if (depth > 3) return null;
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return value.slice(0, 300);
    if (Array.isArray(value)) return value.slice(0, 20).map(function (v) { return scrub(v, depth + 1); });
    if (typeof value === "object") {
      var out = {};
      Object.keys(value).slice(0, 40).forEach(function (k) {
        if (/pass|pwd|token|secret|card|cvc|cvv|email|phone|address|message|body|content/i.test(k)) return;
        out[k.slice(0, 80)] = scrub(value[k], depth + 1);
      });
      return out;
    }
    return null;
  }
  function track(name, props) {
    if (!canSend() || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(String(name || ""))) return false;
    queue.push({
      name: String(name),
      path: location.pathname + location.search,
      referrer: document.referrer || "",
      props: scrub(props || {}, 0)
    });
    if (queue.length >= 20) flush(false);
    else if (!timer) timer = setTimeout(function () { flush(false); }, 2500);
    return true;
  }
  function payload(events) {
    return JSON.stringify({
      site_key: siteKey,
      consent_state: consentState(),
      host: location.hostname,
      device_id: deviceId(),
      session_id: sessionId(),
      device: device(),
      events: events
    });
  }
  function flush(teardown) {
    if (!queue.length || !canSend()) return;
    if (timer) { clearTimeout(timer); timer = null; }
    var events = queue.splice(0, 50);
    var body = payload(events);
    if (teardown && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }))) return;
      } catch (_) {}
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body,
      keepalive: !!teardown,
      mode: "cors",
      credentials: "omit"
    }).catch(function () {});
  }
  function pageview(reason) {
    pendingPageview = false;
    track("page_view", { reason: reason || "load", href: location.pathname + location.search });
  }
  function start() {
    if (started || !canSend()) return;
    started = true;
    if (pendingPageview) pageview("load");
  }
  function consent(granted) {
    if (granted) {
      storageSet(localStorage, CONSENT_KEY, "granted");
      start();
    } else {
      storageSet(localStorage, CONSENT_KEY, "denied");
      storageDel(localStorage, DEVICE_KEY);
      storageDel(sessionStorage, SESSION_KEY);
      queue.length = 0;
    }
    return consentState();
  }
  async function identify(externalId) {
    if (!canSend() || externalId == null || !crypto.subtle) return false;
    var bytes = new TextEncoder().encode(siteKey + ":" + String(externalId));
    var digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    var hex = Array.from(digest, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return track("identify", { user_ref_sha256: hex });
  }

  window.mcAnalytics = {
    site: siteKey,
    track: track,
    flush: flush,
    consent: consent,
    identify: identify,
    consentState: consentState,
    network: network
  };

  addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var u; try { u = new URL(a.href, location.href); } catch (_) { return; }
    track("link_click", { host: u.host, path: u.pathname, external: u.host !== location.host });
  }, { passive: true });
  addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || f.tagName !== "FORM") return;
    track("form_submit", { id: (f.id || "").slice(0, 80), method: (f.method || "get").toLowerCase() });
  }, true);
  addEventListener("error", function (e) {
    track("js_error", { file: String(e.filename || "").slice(-160), line: e.lineno || null, col: e.colno || null });
  });
  addEventListener("unhandledrejection", function () { track("js_rejection", {}); });
  addEventListener("pagehide", function () { track("page_leave", {}); flush(true); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush(true);
  });

  try {
    var nc = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (nc && nc.addEventListener) nc.addEventListener("change", function () { track("network_change", network()); });
  } catch (_) {}

  var push = history.pushState, replace = history.replaceState;
  function routeChanged() { setTimeout(function () { if (canSend()) pageview("route"); }, 0); }
  history.pushState = function () { var r = push.apply(this, arguments); routeChanged(); return r; };
  history.replaceState = function () { var r = replace.apply(this, arguments); routeChanged(); return r; };
  addEventListener("popstate", routeChanged);

  if (canSend()) start();
  dispatchEvent(new CustomEvent("mccluster:analytics-ready", { detail: { site: siteKey, consent: consentState() } }));
})();