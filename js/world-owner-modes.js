/* TRAVEL FOR THE HOUSE OWNER (owner, 2026-10-20: "keep the social feed on and then develop those other projects in the
   back end. Probably keep all three on admin."). Missions came back for everyone on 2026-11-17 (AGENTS.md, "Public
   World"), so the switch now holds Travel alone: hu-travel-off on <html> (mnet.html) keeps Travel and the centre mode
   bar off the World for everyone but the house owner, whose World keeps Travel and News feed so Travel can be built and
   tried in place.

   Who the owner is stays the server's answer: js/tabbar.js asks GET /v1/status (requireHouseOwner in the Worker) and fires
   mcc:appbar-admin. The World has to choose before its scripts read the switch, so a yes is remembered here for that
   signed-in account (localStorage, keyed to the session's user id): the next World this browser opens for that account
   opens with Travel. The first yes on a browser opens the World again, once, with Travel. Signing out forgets it.
   What it opens is the page's own Travel screen; every read and write behind it is the server's to allow, as it was
   before it was switched off. Loaded in mnet.html's head, before js/mnet.js and js/travel/world-travel.mjs. */
(function (w, d) {
  "use strict";
  var KEY = "mcc_world_owner", SWITCH = "hu-travel-off", root = d.documentElement;
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
