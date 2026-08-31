/* HITMAN bottom-tab bridge.
   tabbar.js still builds the fourth column with the legacy internal key
   "sites". This bridge changes the actual rendered bottom tab itself:
   HITMAN is the public tab, and a normal tap goes straight to the clothing
   rack. The original desk chat is preserved in deskchat-core.js for pages
   that explicitly use chat; it no longer owns this bottom-nav position. */
(function () {
  "use strict";

  var self = document.currentScript;
  var src = self && self.src ? self.src : "";
  var ROOT = src ? src.replace(/js\/deskchat\.js.*$/, "") : "";
  var SHOP = ROOT + "prayer-closet.html#theRack";
  var MARK = ROOT + "assets/img/hm-mark-96.png";

  window.MCC_HITMAN_SHOP = SHOP;

  function setLabel(a) {
    var span = a.querySelector("span");
    if (span) {
      span.textContent = "HITMAN";
      return;
    }
    a.appendChild(document.createElement("span")).textContent = "HITMAN";
  }

  function setMark(a) {
    var img = a.querySelector("img.appbar__m");
    if (!img) {
      img = document.createElement("img");
      img.className = "appbar__m";
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      var old = a.querySelector("svg");
      if (old) old.parentNode.replaceChild(img, old);
      else a.insertBefore(img, a.firstChild);
    }
    img.src = MARK;
  }

  function makeHitman(a) {
    if (!a) return;
    a.href = SHOP;
    a.setAttribute("data-appnav", "hitman");
    a.setAttribute("data-hitman-tab", "1");
    a.setAttribute("aria-label", "HITMAN clothing shop");
    setLabel(a);
    setMark(a);

    var page = location.pathname.split("/").pop();
    if (page === "prayer-closet.html") a.classList.add("is-here");
  }

  function patch() {
    /* Catch the legacy fourth tab on first paint, and the HITMAN version on
       subsequent bar restores/mutations. */
    var tabs = document.querySelectorAll('.appbar [data-appnav="sites"], .appbar [data-hitman-tab="1"]');
    for (var i = 0; i < tabs.length; i++) makeHitman(tabs[i]);

    /* If the old Sites/Chat wing is ever painted by a stale cached copy of
       tabbar.js, turn that visible slot into the same shop door instead of
       letting Chat reappear in the bottom navigation. */
    var slots = document.querySelectorAll(".appbar a[data-dock]");
    for (var j = 0; j < slots.length; j++) {
      var dock = slots[j].getAttribute("data-dock") || "";
      var href = slots[j].getAttribute("href") || "";
      if (/sites\.html(?:$|[#?])/.test(dock) || /sites\.html(?:$|[#?])/.test(href)) {
        slots[j].setAttribute("data-dock", SHOP);
        slots[j].href = SHOP;
        slots[j].setAttribute("data-hitman-tab", "1");
        setLabel(slots[j]);
        setMark(slots[j]);
      }
    }
  }

  function bootPatch() {
    patch();
    var bar = document.querySelector(".appbar");
    if (bar && window.MutationObserver) {
      new MutationObserver(patch).observe(bar, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootPatch);
  else bootPatch();

  /* Keep the desk implementation available to explicit chat surfaces. */
  var core = document.createElement("script");
  core.src = ROOT + "js/deskchat-core.js" + (src.indexOf("?") > -1 ? src.slice(src.indexOf("?")) : "");
  core.onload = patch;
  core.onerror = function () { console.error("[HITMAN] desk chat core failed to load"); };
  (document.head || document.documentElement).appendChild(core);
})();