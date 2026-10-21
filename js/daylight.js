/* DAYLIGHT (owner, 2026-10-19): the dark World is the night look. By day the
   chrome inverts to pitch white and black. Which it is follows the real Sun:
   the device's location when that permission is already granted (never
   prompted for here), otherwise the time zone's longitude. Writes
   html[data-daylight="day|night"] and html[data-daylight-source].
   ?daylight=day|night|auto stores an override (tests and screenshots). */
(function (root) {
  "use strict";
  var RAD = Math.PI / 180;
  /* Solar elevation in degrees (NOAA low-precision algorithm, ±0.3°). */
  function solarElevation(date, lat, lon) {
    var t = (date instanceof Date ? date : new Date(date)).getTime();
    var n = t / 86400000 + 2440587.5 - 2451545.0;                     // days since J2000.0
    var L = (280.460 + 0.9856474 * n) % 360;                          // mean longitude
    var g = ((357.528 + 0.9856003 * n) % 360) * RAD;                  // mean anomaly
    var lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD; // ecliptic longitude
    var eps = (23.439 - 0.0000004 * n) * RAD;                         // obliquity
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    var gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24; // sidereal hours
    var lst = ((gmst + lon / 15) % 24 + 24) % 24;
    var ha = ((lst * 15 - ra / RAD + 540) % 360) - 180;              // hour angle, -180..180
    var el = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha * RAD));
    return el / RAD;
  }
  /* Day above the horizon, night below civil twilight, the previous answer in between. */
  function phase(elevation, previous) {
    if (elevation > 0) return "day";
    if (elevation < -6) return "night";
    return previous === "day" ? "day" : "night";
  }
  /* getTimezoneOffset() is minutes WEST of UTC (240 for UTC-4), so the zone's
     central meridian is about -offset/4 degrees. Within ±15° of the truth. */
  function estimateLongitude(tzOffsetMinutes) { return Math.max(-180, Math.min(180, -tzOffsetMinutes / 4)); }
  function resolve(date, lat, lon, previous) { return phase(solarElevation(date, lat, lon), previous); }
  /* The time zone's answer alone, as the World paints it for a visitor it knows nothing about. For pages that are not the
     World: js/tabbar.js colours the departure veil to the World it is opening, and js/world-audio-continuity.js colours
     the frame the World opens in, so neither shows night on the way into a day World (or the reverse). */
  function estimate(date) {
    var d = date instanceof Date ? date : new Date();
    return resolve(d, 35, estimateLongitude(d.getTimezoneOffset()), "");
  }
  var core = {solarElevation:solarElevation, phase:phase, estimateLongitude:estimateLongitude, resolve:resolve, estimate:estimate};
  if (typeof module !== "undefined" && module.exports) { module.exports = core; return; }
  root.MCC_DAYLIGHT_CORE = core;
  if (!root.document) return;
  var doc = root.document, html = doc.documentElement, KEY = "mcc_daylight", PLACE = "mcc_daylight_place", where = null;
  /* loaded by another page for the arithmetic only (data-daylight-core): that page's own look is never touched */
  if (doc.currentScript && doc.currentScript.hasAttribute("data-daylight-core")) return;
  /* THE LAST PLACE (owner, 2026-10-20: "I'll see like other screens flash up"). With location granted, every visit used to
     paint from the time zone and then correct itself from the device's answer half a second later, so near dusk and dawn a
     night World turned day (or day turned night) after it was already on screen. The last answer is kept on this device,
     coarse (a tenth of a degree, about 11 km: plenty for the Sun), and used before the first paint; the device's fresh
     answer still corrects it, with a fade. Never sent anywhere, and forgotten once location is no longer granted. */
  function remembered() {
    try {
      var p = JSON.parse(localStorage.getItem(PLACE) || "null");
      return p && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? {lat:Number(p.lat), lon:Number(p.lon), exact:true} : null;
    } catch (_) { return null; }
  }
  function remember(lat, lon) {
    try {
      if (lat === null) localStorage.removeItem(PLACE);
      else localStorage.setItem(PLACE, JSON.stringify({lat:Math.round(lat * 10) / 10, lon:Math.round(lon * 10) / 10}));
    } catch (_) {}
  }
  where = remembered();
  var shiftTimer = 0;
  function override() {
    try {
      var q = new URLSearchParams(location.search).get("daylight");
      if (q === "day" || q === "night" || q === "auto") localStorage.setItem(KEY, q);
      var v = localStorage.getItem(KEY);
      return v === "day" || v === "night" ? v : null;
    } catch (_) { return null; }
  }
  function apply() {
    var forced = override(), prev = html.dataset.daylight || "";
    var at = where || {lat:35, lon:estimateLongitude(new Date().getTimezoneOffset()), exact:false};
    var el = solarElevation(new Date(), at.lat, at.lon);
    var next = forced || phase(el, prev);
    html.dataset.daylightSource = forced ? "override" : at.exact ? "location" : "timezone";
    if (next !== prev) {
      /* a change while the page is on screen fades across (css/daylight.css); the first answer is simply the look */
      if (prev && doc.body) {
        html.classList.add("daylight-shift");
        clearTimeout(shiftTimer);
        shiftTimer = setTimeout(function () { html.classList.remove("daylight-shift"); }, 800);
      }
      html.dataset.daylight = next;
      root.dispatchEvent(new CustomEvent("mcc:daylight", {detail:{phase:next, elevation:el, exact:at.exact}}));
    }
  }
  function locate() {
    var nav = root.navigator;
    if (!nav || !nav.geolocation || !nav.permissions || !nav.permissions.query) return;
    nav.permissions.query({name:"geolocation"}).then(function (p) {
      if (p.state !== "granted") {
        if (where) { where = null; remember(null); apply(); }
        return;
      }
      nav.geolocation.getCurrentPosition(function (pos) {
        where = {lat:pos.coords.latitude, lon:pos.coords.longitude, exact:true}; remember(where.lat, where.lon); apply();
      }, function () {}, {maximumAge:3600000, timeout:8000});
    }).catch(function () {});
  }
  apply(); locate();
  setInterval(apply, 300000);
  doc.addEventListener("visibilitychange", function () { if (!doc.hidden) apply(); });
  root.MCC_DAYLIGHT = {refresh:apply, state:function () { return html.dataset.daylight; }};
})(typeof window !== "undefined" ? window : globalThis);
