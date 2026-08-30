/* THE CIRCADIAN — the house turns with the visitor's own clock.

   Daylight hours (7:00–18:59 on the phone's clock) get the gallery
   coat; evening and night get the cinema. No buttons, no questions:
   the site simply already matches the hour the visitor lives in,
   and re-checks itself each minute and every time the tab wakes,
   so a phone left open crosses dusk with the room.

   A stored choice (mcc_theme = "light" | "dark") still outranks the
   clock — the owner's tools may set one — and MCC_THEME keeps the
   old contract for every caller: get/set/flip work, dual is true,
   auto() hands the wheel back to the clock. */
(function () {
  "use strict";
  var KEY = "mcc_theme";
  /* cinema pages pin themselves: <html data-theme-lock="dark">. A film
     room in daylight is still a film room. */
  var LOCK = document.documentElement.getAttribute("data-theme-lock");
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function clockSays() {
    var h = new Date().getHours();
    return h >= 7 && h < 19 ? "light" : "dark";
  }
  function apply() {
    document.documentElement.setAttribute("data-theme", LOCK || stored() || clockSays());
  }
  apply();
  setInterval(function () { if (!stored()) apply(); }, 60000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !stored()) apply();
  });
  window.MCC_THEME = {
    dual: true,
    get: function () { return document.documentElement.getAttribute("data-theme") || "dark"; },
    set: function (t) {
      try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) {}
      apply();
    },
    flip: function () { this.set(this.get() === "dark" ? "light" : "dark"); },
    auto: function () { this.set(null); },
  };
})();

/* THE KEEPER boards on every page the theme rides. The worker lives at
   the house root, so resolve it off this script's own address or a page
   in walls/, tracks/, or closet/ asks for a phantom sibling (404) */
if ("serviceWorker" in navigator) {
  var swRoot = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/theme\.js.*$/, "") : "";
  })();
  addEventListener("load", function () {
    navigator.serviceWorker.register(swRoot + "sw.js").catch(function () {});
  });
}

/* THE HITMAN DOOR — RETIRED 2026-08-17.

   This block used to reach into the bar after boot and rewrite the fifth
   tab: whatever a page had written there, it became HITMAN and pointed at
   hitman-facility.html. The owner has now put the shake run in that
   column, so the override is gone rather than left fighting js/tabbar.js
   over the same tab.

   HITMAN did not lose its door. This override was the ONLY route into
   hitman-facility.html anywhere in the house, so removing it silently
   would have orphaned the page — it is now a room in the map drawer
   (js/masthead.js, "The house"), reachable from every page that carries
   the bar, and the smoke suite checks that it is still linked.

   Nothing rewrites a tab from here any more. What a page ships in its bar
   is what the bar shows. */
