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

/* The old multi-room navigation strip was intentionally retired.
   MCCOffice remains only as the shared eu_is_admin authorization helper. */
