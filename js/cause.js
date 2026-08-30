/* ============================================================
   THE LICENSE CLOCK: the mission fund's on/off switch.

   McCluster Corp holds a Connecticut charitable registration that
   runs through September 30, 2026, end of day Eastern. While the
   clock is live, every money point on the site speaks as the
   mission fund: contributions toward the album programs. The
   moment it lapses, the whole house flips itself back to plain
   live sales rails: no deploy, no touch, nothing to remember on
   the day. A lapsed license must never keep soliciting.

   Renewed the registration? Move EXPIRES and the fund reopens.

   House language rule rides here too: support / contribution
   wording only, with no tax language anywhere on the site.
   ============================================================ */
(function () {
  "use strict";

  var ROOT = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/cause\.js.*$/, "") : "";
  })();

  /* Sept 30, 2026, midnight Eastern (EDT = UTC-4) */
  var EXPIRES = Date.parse("2026-10-01T04:00:00Z");

  var CAUSE = null, READY = null;

  function active() { return Date.now() < EXPIRES; }

  function daysLeft() {
    return Math.max(0, Math.ceil((EXPIRES - Date.now()) / 86400000));
  }

  function load() {
    if (READY) return READY;
    READY = fetch(ROOT + "data/cause.json", { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .then(function (j) { CAUSE = j; return j; })
      .catch(function () { return null; });
    return READY;
  }

  window.MCC_CAUSE = {
    EXPIRES: EXPIRES,
    active: active,
    daysLeft: daysLeft,
    load: load,
    data: function () { return CAUSE; },
  };
})();
