/* ============================================================
   FAN INTAKE — what a listener tells us after they make an account.

   WHAT THIS IS NOT: a permission system. public.fan_profiles has no role,
   no org and no membership column, so nothing filled in here can make
   anybody an admin, an owner, or a member of anything. Access on this
   platform is org_members.role and eu_profiles.role; this file touches
   neither. That is deliberate — the intake form is the most exposed
   surface on the site, so it writes to the table with nothing worth
   stealing.

   WHAT THE BROWSER MAY CLAIM: name, address, phone, birth year, and two
   yes/no answers. Everything that MEANS something — that a phone was
   verified, that an email was verified, which tier the account is, when
   consent was given and against which wording — is written by a database
   trigger, not by this file. Send a forged phone_verified_at from here
   and the database throws it away. That is checked in the migration and
   was tested against a real signed-in user before it shipped.

   CONSENT IS UNBUNDLED. Neither checkbox gates the music. A listener who
   ticks nothing still gets the full record and every download format.
   Anything else would be conditioning the service on consent, which is
   the part the state privacy laws actually prohibit, and it would also
   be a bad trade to offer someone who just wanted a song.
   ============================================================ */
(function (root) {
  "use strict";

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  /* Only these reach the database. The list is short on purpose: a column
     not named here cannot be written from a browser even if the markup
     grows a field for it later. */
  var WRITABLE = [
    "legal_name", "display_name",
    "address_line1", "address_line2", "city", "region", "postal_code", "country",
    "phone_e164", "birth_year",
    "marketing_consent", "share_consent", "source"
  ];

  /* The session is read straight out of localStorage rather than through a
     library, because this site carries TWO auth clients — js/backend.js on
     account.html and js/mcc-auth.js on the PRIM3 pages — and they expose
     different APIs. They do agree on where the session lives (both write
     mccdb_session, and js/gated-audio.js already reads it), so the storage
     key is the one thing that is true on every page. */
  var SESSION = "mccdb_session";

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION) || "null"); }
    catch (e) { return null; }
  }

  function token() {
    var s = session();
    return (s && s.access_token) || null;
  }

  /* The user id comes out of the token's own sub claim. Asking the network
     for it would mean this form could not paint until a round trip landed,
     and the id is sitting right there, signed. */
  function uidFromToken(t) {
    try {
      var body = t.split(".")[1];
      if (!body) return null;
      var pad = body.replace(/-/g, "+").replace(/_/g, "/");
      while (pad.length % 4) pad += "=";
      var claims = JSON.parse(atob(pad));
      return claims && claims.sub ? String(claims.sub) : null;
    } catch (e) { return null; }
  }

  function api(path, init) {
    init = init || {};
    var t = token();
    if (!t) return Promise.reject(Object.assign(new Error("Sign in first"), { status: 401 }));
    return fetch(SB + "/rest/v1/" + path, {
      method: init.method || "GET",
      headers: {
        apikey: KEY,
        authorization: "Bearer " + t,
        "content-type": "application/json",
        prefer: init.prefer || "return=representation"
      },
      body: init.body ? JSON.stringify(init.body) : undefined
    }).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        if (!r.ok) {
          var msg = (data && (data.message || data.hint)) || ("Request failed (" + r.status + ")");
          throw Object.assign(new Error(msg), { status: r.status });
        }
        return data;
      });
    });
  }

  function mine() {
    var s = session();
    var uid = (s && s.user && s.user.id) || (s && s.access_token && uidFromToken(s.access_token));
    return Promise.resolve(uid || null);
  }

  function load() {
    return mine().then(function (uid) {
      if (!uid) throw Object.assign(new Error("Sign in first"), { status: 401 });
      return api("fan_profiles?user_id=eq." + encodeURIComponent(uid) + "&select=*&limit=1")
        .then(function (rows) { return (rows && rows[0]) || null; });
    });
  }

  /* Upsert. on_conflict keeps a second visit from erroring on the primary
     key, and the trigger re-derives every protected column either way. */
  function save(values) {
    return mine().then(function (uid) {
      if (!uid) throw Object.assign(new Error("Sign in first"), { status: 401 });
      var row = { user_id: uid };
      WRITABLE.forEach(function (k) {
        if (values[k] !== undefined && values[k] !== null && values[k] !== "") row[k] = values[k];
      });
      /* The checkboxes are always sent, because absent must mean "no" and
         not "leave whatever was there" — withdrawing consent has to work. */
      row.marketing_consent = !!values.marketing_consent;
      row.share_consent = !!values.share_consent;
      return api("fan_profiles?on_conflict=user_id", {
        method: "POST",
        body: [row],
        prefer: "resolution=merge-duplicates,return=representation"
      }).then(function (rows) { return (rows && rows[0]) || null; });
    });
  }

  /* Phone verification runs on Supabase's own OTP, so "verified" means a
     code came back rather than a checkbox. It is OFF in this project right
     now (auth settings report phone:false), and the honest thing is to say
     so rather than show a button that silently does nothing. */
  function phoneEnabled() {
    return fetch(SB + "/auth/v1/settings", { headers: { apikey: KEY } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { return !!(s && s.external && s.external.phone); })
      .catch(function () { return false; });
  }

  function sendPhoneCode(phone) {
    return fetch(SB + "/auth/v1/otp", {
      method: "POST",
      headers: { apikey: KEY, "content-type": "application/json" },
      body: JSON.stringify({ phone: phone, create_user: false })
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) {
        throw new Error(t && t.length < 200 ? t : "Could not send the code");
      });
      return true;
    });
  }

  function adult(birthYear) {
    var y = Number(birthYear);
    if (!y) return false;
    return (new Date().getFullYear() - y) >= 18;
  }

  root.MCC_FAN = {
    load: load,
    save: save,
    adult: adult,
    phoneEnabled: phoneEnabled,
    sendPhoneCode: sendPhoneCode,
    WRITABLE: WRITABLE
  };
})(window);
