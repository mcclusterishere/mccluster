/* ============================================================
   THE OFFICE STRIP — six owner rooms, one back office.
   Injected on every owner page so the desks stop feeling like five
   separate sites. Same origin, same login (the session token lives in
   this browser); this strip is only navigation, never a gate.

   IT ALSO CARRIES THE ONE GATE ANSWER. Five of these rooms used to
   decide who was the owner like this:

       if (MCC_SUPA.token() && MCC_SUPA.email() === "matthew@mccluster.org")

   Two defects in one line. MCC_SUPA.token() returns a PROMISE, which is
   always truthy, so the token half never tested anything — the gate was
   a bare string compare. And a string in the page is not the authority
   the data answers to: every read behind these rooms is governed by RLS,
   which asks eu_is_admin(). When the two disagreed the room opened onto
   data the database then refused, which is how a desk ends up showing
   zeros instead of leads.

   So there is one answer, asked of the database, shared by every room.
   ============================================================ */
(function (w) {
  "use strict";
  var cached = null;

  /* The same predicate the RLS policies use. Asked once per page load;
     the answer cannot drift from what the data will actually allow. */
  function isDesk() {
    if (cached) return cached;
    var S = w.MCC_SUPA;
    if (!S || !S.token) return Promise.resolve(false);
    cached = S.token().then(function (t) {
      if (!t) return false;
      return fetch(S.url + "/rest/v1/rpc/eu_is_admin", {
        method: "POST",
        headers: { apikey: S.key, authorization: "Bearer " + t, "content-type": "application/json" },
        body: "{}"
      }).then(function (r) { return r.ok ? r.json() : false; });
    }).then(function (v) { return v === true; })
      .catch(function () { return false; });
    return cached;
  }

  /* open(boot, shut) — run boot() for the desk, shut() for anyone else.
     Rooms call this instead of comparing an email, so adding a second
     operator is a database row rather than five file edits. */
  function open(boot, shut) {
    return isDesk().then(function (ok) {
      if (ok) return boot();
      return shut && shut();
    });
  }

  w.MCCOffice = { isDesk: isDesk, open: open };
})(window);

(function boot() {
  "use strict";
  var ROOMS = [
    ["admin.html", "Back Office"],
    ["crm.html",   "Front Desk"],
    ["desk.html",  "Outreach"],
    ["inbox.html", "Inbox"],
    ["vault.html", "Vault"],
    ["lanes.html", "Lanes"],
  ];
  var here = location.pathname.split("/").pop() || "";
  if (!ROOMS.some(function (r) { return r[0] === here; })) return;

  // loaded from <head>, so the body may not exist yet
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", boot);
    return;
  }

  var bar = document.createElement("nav");
  bar.setAttribute("aria-label", "The office");
  bar.style.cssText = "position:sticky;top:0;z-index:260;display:flex;gap:.25rem;" +
    "overflow-x:auto;padding:.5rem clamp(.8rem,3vw,1.4rem);background:rgba(10,8,7,.96);" +
    "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "border-bottom:1px solid rgba(244,239,230,.14)";
  bar.innerHTML = ROOMS.map(function (r) {
    var on = r[0] === here;
    return '<a href="' + r[0] + '" style="flex:0 0 auto;text-decoration:none;' +
      "font:800 .68rem 'Manrope',system-ui,sans-serif;letter-spacing:.08em;" +
      "text-transform:uppercase;border-radius:99px;padding:.45rem .85rem;" +
      (on ? "color:#fff;background:linear-gradient(165deg,#ff5a5c,#b3121b);"
          : "color:rgba(244,239,230,.75);box-shadow:inset 0 0 0 1px rgba(244,239,230,.18);") +
      '">' + r[1] + "</a>";
  }).join("");
  document.body.insertBefore(bar, document.body.firstChild);
})();
