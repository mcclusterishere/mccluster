/* ============================================================
   SIGNALS: the front of the house, listening.

   No popups, no "how did you hear about us", no chat bubble that
   pretends to be a person. The site simply notices what a visitor
   actually did, and when they eventually leave a name, all of it
   joins up on the desk.

   What it records: which walls they opened, which prints they
   priced, whether they read the rate page, whether they came back.
   What it does NOT record: keystrokes, mouse paths, form contents,
   or anything typed but not submitted. A signal is an action a
   person chose to take on a public page, the same thing a shop
   owner sees standing behind the counter.

   The visitor id is a random string in this browser. It is not tied
   to a person until that person hands over their own name.
   ============================================================ */
(function () {
  "use strict";
  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var VID = "mcc_vid", SEEN = "mcc_seen_days";

  function vid() {
    try {
      var v = localStorage.getItem(VID);
      if (!v) {
        v = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        localStorage.setItem(VID, v);
      }
      return v;
    } catch (e) { return "v-nostore"; }
  }

  /* Anything that would be a wasted round trip gets dropped here rather
     than on the server: the same signal twice in one session tells the
     desk nothing it did not already know. */
  var sent = {};
  function log(kind, detail, weight) {
    var k = kind + "|" + (detail || "");
    if (sent[k]) return;
    sent[k] = 1;
    try {
      fetch(SB + "/rest/v1/crm_signals", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", apikey: KEY,
                   Authorization: "Bearer " + KEY, Prefer: "return=minimal" },
        body: JSON.stringify({ visitor: vid(), kind: kind,
                               detail: (detail || "").slice(0, 180), weight: weight || 1 }),
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---- the return visit is the strongest cheap signal there is ---- */
  try {
    var today = new Date().toISOString().slice(0, 10);
    var days = JSON.parse(localStorage.getItem(SEEN) || "[]");
    if (days.indexOf(today) === -1) {
      days.push(today);
      localStorage.setItem(SEEN, JSON.stringify(days.slice(-30)));
      if (days.length === 2) log("return_visit", "second day", 4);
      else if (days.length >= 3) log("return_visit", days.length + " days", 6);
    }
  } catch (e) {}

  /* ---- the pages that mean money ---- */
  var page = location.pathname.split("/").pop() || "index.html";
  if (page === "hire.html") log("rate_view", "hire", 5);
  if (page === "prints.html") log("print_open", "shop", 3);
  if (page.indexOf("walls/") === 0 || /^walls\.html$/.test(page)) log("wall_view", page, 2);

  /* a wall page open in the gallery is a hash route, so watch it */
  function hashWall() {
    var id = (location.hash || "").replace(/^#\//, "");
    if (id) log("wall_view", id, 2);
  }
  if (page === "gallery.html") { hashWall(); window.addEventListener("hashchange", hashWall); }

  /* ---- deep read: they got to the bottom and stayed ---- */
  var deep = false, start = Date.now();
  window.addEventListener("scroll", function () {
    if (deep) return;
    var h = document.documentElement;
    if ((h.scrollTop + h.clientHeight) / h.scrollHeight > 0.85 && Date.now() - start > 20000) {
      deep = true;
      log("deep_read", page, 3);
    }
  }, { passive: true });

  /* ---- a film played all the way in is intent, not a scroll ---- */
  document.addEventListener("play", function (e) {
    if (e.target && e.target.tagName === "VIDEO") log("film_play", page, 2);
  }, true);

  /* The bridge: when the lead sheet posts a name, the desk can tie
     every signal above to that person. crm.js calls this. */
  window.MCC_SIGNALS = {
    id: vid,
    log: log,
    /* everything this browser has done, for the lead note */
    summary: function () {
      var out = [];
      Object.keys(sent).forEach(function (k) { out.push(k.replace("|", ":")); });
      return out.join(", ");
    },
  };
})();
