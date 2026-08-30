/* ============================================================
   MCC_NET: the owner's own records, over the same Supabase REST
   surface as everything else (MCC_SUPA from backend.js). RLS is
   the wall. The marketplace era (public provider directory,
   talent listings, booking inboxes, deal proposals) is retired;
   one seller remains, and this module carries only what the
   account page still reads: the signed-in user's deals.
   ============================================================ */
(function () {
  "use strict";

  var S = window.MCC_SUPA;
  if (!S) return;

  function authed(path, opts) {
    opts = opts || {};
    return S.token().then(function (t) {
      if (!t) throw new Error("signed out");
      var h = { apikey: S.key, Authorization: "Bearer " + t, "Content-Type": "application/json" };
      if (opts.prefer) h.Prefer = opts.prefer;
      return fetch(S.url + "/rest/v1/" + path, {
        method: opts.method || "GET", headers: h,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("net " + r.status);
      return r.status === 204 ? null : r.json().catch(function () { return null; });
    });
  }

  window.MCC_NET = {
    myListing: function () {
      return authed("providers?owner=eq." + S.uid() + "&select=*").then(function (rows) {
        return rows && rows[0] ? rows[0] : null;
      });
    },
    myDeals: function () {
      return window.MCC_NET.myListing().then(function (mine) {
        var slug = mine ? mine.slug : "___none___";
        return authed("deals?or=(from_owner.eq." + S.uid() + ",to_slug.eq." + encodeURIComponent(slug) + ")&order=updated_at.desc&select=*")
          .then(function (rows) { return { mine: mine, rows: rows || [] }; });
      });
    },
  };
})();
