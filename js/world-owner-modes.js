/* ALL THREE FOR THE HOUSE OWNER (owner, 2026-10-20: "keep the social feed on and then develop those other projects in the
   back end. Probably keep all three on admin."). Everyone else's World is the social feed (hu-social-only on <html>,
   mnet.html). The house owner's World keeps Travel, Missions and Feed, so they can be built and tried in place.

   Who the owner is stays the server's answer: js/tabbar.js asks GET /v1/status (requireHouseOwner in the Worker) and fires
   mcc:appbar-admin. The World has to choose before its scripts read the switch, so a yes is remembered here for that
   signed-in account (localStorage, keyed to the session's user id): the next World this browser opens for that account
   opens with all three. The first yes on a browser opens the World again, once, with all three. Signing out forgets it.
   What it opens are the page's own Travel and Missions screens; every read and write behind them is the server's to allow,
   as it was before they were switched off. Loaded in mnet.html's head, before js/mnet.js and js/travel/world-travel.mjs. */
(function (w, d) {
  "use strict";
  var KEY = "mcc_world_owner", SWITCH = "hu-social-only", root = d.documentElement;
  function account() {
    try {
      var s = JSON.parse(w.localStorage.getItem("mccdb_session") || "null"), t = s && s.access_token;
      if (!t) return "";
      var raw = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (raw.length % 4) raw += "=";
      return String(JSON.parse(w.atob(raw)).sub || "");
    } catch (e) { return ""; }
  }
  function remembered() {
    try { var m = JSON.parse(w.localStorage.getItem(KEY) || "null"); return m && typeof m.sub === "string" ? m.sub : ""; } catch (e) { return ""; }
  }
  function remember(who) {
    try { if (who) w.localStorage.setItem(KEY, JSON.stringify({ sub: who, at: new Date().toISOString() })); else w.localStorage.removeItem(KEY); } catch (e) {}
  }
  var who = account();
  if (!who && remembered()) remember("");
  var owner = !!who && remembered() === who;
  if (owner && root.classList.contains(SWITCH)) {
    root.classList.remove(SWITCH);
    root.setAttribute("data-world-owner", "");
    /* the expanded globe from here shows the missions too */
    d.addEventListener("DOMContentLoaded", function () {
      var a = d.querySelector(".mn__world-expand");
      if (a) a.setAttribute("href", String(a.getAttribute("href") || "").replace(/&missions=0(?=&|$)/, ""));
    });
  }
  w.addEventListener("mcc:appbar-admin", function (e) {
    var now = account();
    if (!(e && e.detail && e.detail.admin === true) || !now || remembered() === now) return;
    remember(now);
    if (!root.classList.contains(SWITCH)) return;
    /* once per tab: if the page cannot keep the answer, it must not open again and again */
    try { if (w.sessionStorage.getItem(KEY + ":opened") === now) return; w.sessionStorage.setItem(KEY + ":opened", now); } catch (_) { return; }
    w.location.reload();
  });
  w.MCC_WORLD_OWNER = owner;
})(window, document);
