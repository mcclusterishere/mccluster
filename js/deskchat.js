/* ============================================================
   THE DESK LOADER.

   This file used to be the desk itself. It is now a loader for
   deskchat-core.js, which is the desk, and the reason is worth writing
   down because the thing that stood here was doing real damage.

   WHAT WAS HERE. A runtime patch that found the fourth bottom tab in the
   DOM after load and rewrote its href, its label and its icon into the
   HITMAN shop — plus a second order-desk injected at the bottom of the
   home page, plus a MutationObserver to re-apply the tab rewrite whenever
   the bar redrew.

   WHY IT IS GONE. All three solved problems that are now solved in the
   markup, and solved them worse:

     THE TAB. index.html and 29 other pages write the fourth tab as the
     Hitman Halo store directly — the HM mark, the label, the href. A
     runtime rewrite of the same tab meant every page painted "Chat" with
     a chat bubble first and swapped it a frame later, and if the script
     was slow or blocked the tab simply stayed wrong. Worse, the patch
     matched on [data-appnav="sites"], which the correct markup still
     carries, and its setMark() looked for img.appbar__m — the mark in the
     markup is img.appbar__hm — so it found no image to update, found no
     <svg> to replace, and inserted a SECOND mark into the tab. Two logos,
     and an href pointing past the drop at #theRack.

     THE HOME DESK. The bottom of the home page is the Lock In room
     (js/lockroom.js): it asks what you need, branches on the answer, takes
     a budget, and falls back to a prefilled email if the wire is down. A
     second injected order-desk under it was two chat boxes on one page.

     THE OBSERVER. It existed only to re-apply the tab rewrite. With no
     rewrite there is nothing to re-apply.

   WHAT IS LEFT is the one thing this file is still needed for: pulling in
   the real desk. chat.html and any page carrying [data-desk-inline] mount
   the conversation from deskchat-core.js, and that has to load after its
   host element exists.
   ============================================================ */
(function () {
  "use strict";

  var self = document.currentScript;
  var src = self && self.src ? self.src : "";
  var ROOT = src ? src.replace(/js\/deskchat\.js.*$/, "") : "";

  /* the cache-busting stamp rides along, so the desk and its loader are
     never a deploy apart */
  var qs = src.indexOf("?") > -1 ? src.slice(src.indexOf("?")) : "";

  var core = document.createElement("script");
  core.src = ROOT + "js/deskchat-core.js" + qs;
  core.onerror = function () {
    if (window.console) console.error("[desk] deskchat-core.js failed to load");
  };
  (document.head || document.documentElement).appendChild(core);
})();
