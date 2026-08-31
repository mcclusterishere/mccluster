/* HITMAN HALO shop bridge.
   The shared tab bar still calls this column "sites" internally because
   that key is woven through the five-wing navigation. Publicly, however,
   this door is HITMAN HALO and it goes straight to the clothing rack.

   Keep the original desk chat alive in deskchat-core.js so explicit chat
   surfaces elsewhere on the site continue to work. */
(function () {
  "use strict";

  var self = document.currentScript;
  var src = self && self.src ? self.src : "";
  var ROOT = src ? src.replace(/js\/deskchat\.js.*$/, "") : "";
  var SHOP = ROOT + "prayer-closet.html#theRack";
  var MARK = ROOT + "assets/img/hm-mark-96.png";
  var HOLD_MS = 430;
  var downAt = 0;
  var downShop = false;

  window.MCC_HITMAN_SHOP = SHOP;

  function setLabel(a, text) {
    var span = a.querySelector("span");
    if (span) {
      if (span.textContent !== text) span.textContent = text;
      return;
    }
    var nodes = a.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3 && nodes[i].nodeValue.trim()) {
        if (nodes[i].nodeValue.trim() !== text) nodes[i].nodeValue = text;
        return;
      }
    }
    a.appendChild(document.createTextNode(text));
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
    if (img.getAttribute("src") !== MARK) img.setAttribute("src", MARK);
  }

  function markShop(a, label) {
    if (!a) return;
    if (a.getAttribute("href") !== SHOP) a.setAttribute("href", SHOP);
    a.setAttribute("aria-label", "Hitman Halo shop");
    a.setAttribute("data-hitman-shop", "1");
    setLabel(a, label || "Hitman");
    setMark(a);
  }

  function patch() {
    var tabs = document.querySelectorAll('.appbar [data-appnav="sites"]');
    for (var i = 0; i < tabs.length; i++) markShop(tabs[i], "Hitman");

    /* When the sites wing is held open, its legacy first slot used to say
       Chat. Do not let that old label flash back into the live navigation. */
    var slots = document.querySelectorAll(".appbar a[data-dock]");
    for (var j = 0; j < slots.length; j++) {
      var dock = slots[j].getAttribute("data-dock") || "";
      var href = slots[j].getAttribute("href") || "";
      if (/sites\.html(?:$|[#?])/.test(dock) || /sites\.html(?:$|[#?])/.test(href)) {
        markShop(slots[j], "Hitman");
        slots[j].setAttribute("data-dock", SHOP);
      }
    }
  }

  function isShopAnchor(a) {
    return !!(a && (a.getAttribute("data-hitman-shop") === "1" ||
      a.getAttribute("data-appnav") === "sites" ||
      a.getAttribute("data-dock") === SHOP));
  }

  /* tabbar.js deliberately intercepts its own links and, for the old sites
     key, opens chat. Capture a normal tap first so HITMAN actually shops.
     A held press is left alone so the wing gesture still works. */
  document.addEventListener("pointerdown", function (e) {
    var a = e.target.closest && e.target.closest("a");
    downShop = isShopAnchor(a);
    downAt = downShop ? Date.now() : 0;
  }, true);

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a");
    if (!isShopAnchor(a)) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (downShop && downAt && Date.now() - downAt >= HOLD_MS) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.assign(SHOP);
  }, true);

  function bootPatch() {
    patch();
    var bar = document.querySelector(".appbar");
    if (bar && window.MutationObserver) {
      new MutationObserver(function () { patch(); }).observe(bar, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootPatch);
  else bootPatch();

  /* Preserve the desk for places that explicitly ask for it. It is no
     longer the fourth-tab destination. */
  var core = document.createElement("script");
  core.src = ROOT + "js/deskchat-core.js" + (src.indexOf("?") > -1 ? src.slice(src.indexOf("?")) : "");
  core.onload = patch;
  core.onerror = function () { console.error("[Hitman Halo] desk chat core failed to load"); };
  (document.head || document.documentElement).appendChild(core);
})();