/* Shared operator authorization helper.
   Control Room is the only admin shell. Retired owner pages may still call
   MCCOffice while their compatibility redirect resolves, but this file no
   longer renders navigation. Authorization is the database's eu_is_admin()
   predicate, not an email literal in browser code.
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
