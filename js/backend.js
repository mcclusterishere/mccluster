/* ============================================================
   MCC_DB: the platform's data access layer.
   Every feature (player resume, likes, recents, later playlists
   and entitlements) talks to THIS interface, never to storage
   directly. Two drivers behind the same calls:

   1. Local driver: anonymous visitors. Everything lives in this
      browser; the app works fully offline, no account needed.
   2. Supabase driver (armed): signed-in listeners get accounts
      with cross-device sync against the schema in
      docs/platform-schema.sql. Implemented straight over the
      GoTrue + PostgREST HTTP APIs, no vendored library.

   The anon key below is public by design; Row Level Security in
   the database is the wall. No secrets belong in this file.
   ============================================================ */
(function () {
  "use strict";

  var URL_ = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  var NS = "mccdb_";
  function jget(k, fb) { try { var v = JSON.parse(localStorage.getItem(NS + k)); return v == null ? fb : v; } catch (e) { return fb; } }
  function jset(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} }
  function jdel(k) { try { localStorage.removeItem(NS + k); } catch (e) {} }

  /* ---------- local driver (anonymous / offline) ---------- */
  var local = {
    kind: "local",
    ready: Promise.resolve(),
    user: function () { return null; },
    progress: function (itemId, positionS) {
      var p = jget("plays", {});
      if (positionS === undefined) return Promise.resolve(p[itemId] || null);
      p[itemId] = { position_s: positionS, updated_at: Date.now() };
      jset("plays", p);
      return Promise.resolve(p[itemId]);
    },
    recents: function (limit) {
      var p = jget("plays", {});
      return Promise.resolve(Object.keys(p)
        .sort(function (a, b) { return p[b].updated_at - p[a].updated_at; })
        .slice(0, limit || 10)
        .map(function (id) { return { item_id: id, position_s: p[id].position_s }; }));
    },
    like: function (itemId, on) {
      var l = jget("likes", {});
      if (on === undefined) return Promise.resolve(!!l[itemId]);
      if (on) l[itemId] = Date.now(); else delete l[itemId];
      jset("likes", l);
      return Promise.resolve(!!l[itemId]);
    },
    likes: function () { return Promise.resolve(Object.keys(jget("likes", {}))); },
    entitlements: function () { return Promise.resolve([]); },
    signIn: function (email) { return sb.signIn(email); }, // sign-in always goes to the cloud
    signOut: function () { return Promise.resolve(); },
  };

  /* ---------- session plumbing ---------- */
  /* THE KEEP: the session mirrors to a second shelf, and the mirror
     restores it if the main copy is ever cleared by accident, so the
     same device stays the same member, same numbers. A real sign-out
     clears both shelves on purpose. */
  function saveSession(s) {
    jset("session", s);
    try { localStorage.setItem("mcc_sess_keep", JSON.stringify(s)); } catch (e) {}
  }
  (function restoreKeep() {
    try {
      if (!localStorage.getItem("mccdb_session")) {
        var kept = localStorage.getItem("mcc_sess_keep");
        if (kept) localStorage.setItem("mccdb_session", kept);
      } else {
        localStorage.setItem("mcc_sess_keep", localStorage.getItem("mccdb_session"));
      }
    } catch (e) {}
  })();
  function session() { return jget("session", null); }
  function jwtExp(tok) { try { return JSON.parse(atob(tok.split(".")[1])).exp * 1000; } catch (e) { return 0; } }

  // magic-link landing: tokens arrive in the URL hash. If Supabase bounced the
  // link (expired, wrong Site URL, redirect not allow-listed), the REASON lands
  // in the URL too; surface it instead of failing silently, so a broken link
  // says what's wrong instead of looking like nothing happened.
  (function catchMagicLink() {
    var raw = location.hash.slice(1) + "&" + location.search.slice(1);
    if (raw.indexOf("access_token=") === -1 && raw.indexOf("error") === -1) return;
    var q = {};
    raw.split("&").forEach(function (kv) {
      if (!kv) return;
      var p = kv.split("="); q[p[0]] = decodeURIComponent((p[1] || "").replace(/\+/g, " "));
    });
    if (q.access_token) {
      saveSession({ access_token: q.access_token, refresh_token: q.refresh_token || "" });
      history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    var msg = q.error_description || q.error_code || q.error;
    if (!msg) return;
    try { console.warn("[sign-in] magic link did not complete:", q); } catch (e) {}
    (function banner() {
      if (!document.body) { setTimeout(banner, 50); return; }
      var bar = document.createElement("div");
      bar.setAttribute("role", "alert");
      bar.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99999;background:#7c0c15;color:#fff;" +
        "font:600 13px/1.45 system-ui,sans-serif;padding:.7rem 2.4rem .7rem 1rem;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.4)";
      bar.textContent = "Sign-in link didn't land: " + msg + ". Request a fresh link and try again.";
      var x = document.createElement("button");
      x.type = "button"; x.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="vertical-align:-2px;display:inline-block"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      x.style.cssText = "position:absolute;right:.6rem;top:50%;transform:translateY(-50%);background:none;border:0;color:#fff;font-size:1.05rem;cursor:pointer";
      x.onclick = function () { if (bar.parentNode) bar.parentNode.removeChild(bar); };
      bar.appendChild(x);
      document.body.appendChild(bar);
    })();
    history.replaceState(null, "", location.pathname);
  })();

  function refresh() {
    var s = session();
    if (!s || !s.refresh_token) return Promise.resolve(null);
    return fetch(URL_ + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.access_token) { saveSession({ access_token: j.access_token, refresh_token: j.refresh_token }); return session(); }
      jdel("session"); return null;
    }).catch(function () { return s; }); // offline: keep the session, RLS still guards
  }

  function token() {
    var s = session();
    if (!s) return Promise.resolve(null);
    if (jwtExp(s.access_token) - Date.now() < 60000) return refresh().then(function (s2) { return s2 && s2.access_token; });
    return Promise.resolve(s.access_token);
  }

  function api(path, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (!t) throw new Error("signed out");
      var h = { apikey: KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" };
      if (opts.prefer) h.Prefer = opts.prefer;
      return fetch(URL_ + "/rest/v1/" + path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined });
    }).then(function (r) {
      if (!r.ok) throw new Error("api " + r.status);
      return r.status === 204 ? null : r.json().catch(function () { return null; });
    });
  }

  function uid() {
    var s = session();
    if (!s) return null;
    try { return JSON.parse(atob(s.access_token.split(".")[1])).sub; } catch (e) { return null; }
  }
  function email() {
    var s = session();
    if (!s) return null;
    try { return JSON.parse(atob(s.access_token.split(".")[1])).email; } catch (e) { return null; }
  }
  /* the profile the account carries: name, phone, whatever signup filed */
  function meta() {
    var s = session();
    if (!s) return {};
    try { return JSON.parse(atob(s.access_token.split(".")[1])).user_metadata || {}; } catch (e) { return {}; }
  }

  /* ---------- supabase driver (signed in) ---------- */
  var sb = {
    kind: "supabase",
    ready: Promise.resolve(),
    user: function () {
      if (!session()) return null;
      var m = meta();
      return { id: uid(), email: email(), name: m.name || "", phone: m.phone || "" };
    },

    progress: function (itemId, positionS) {
      if (positionS === undefined) {
        return api("plays?item_id=eq." + encodeURIComponent(itemId) + "&select=position_s")
          .then(function (rows) { return rows && rows[0] ? { position_s: +rows[0].position_s } : null; })
          .catch(function () { return local.progress(itemId); });
      }
      local.progress(itemId, positionS); // always mirror locally for offline
      return api("plays", {
        method: "POST", prefer: "resolution=merge-duplicates",
        body: { user_id: uid(), item_id: itemId, position_s: positionS, updated_at: new Date().toISOString() },
      }).catch(function () {});
    },
    recents: function (limit) {
      return api("plays?select=item_id,position_s&order=updated_at.desc&limit=" + (limit || 10))
        .then(function (rows) { return rows || []; })
        .catch(function () { return local.recents(limit); });
    },
    like: function (itemId, on) {
      if (on === undefined) {
        return api("likes?item_id=eq." + encodeURIComponent(itemId) + "&select=item_id")
          .then(function (rows) { return !!(rows && rows.length); })
          .catch(function () { return local.like(itemId); });
      }
      local.like(itemId, on);
      if (on) return api("likes", { method: "POST", prefer: "resolution=merge-duplicates", body: { user_id: uid(), item_id: itemId } }).then(function () { return true; }).catch(function () { return true; });
      return api("likes?item_id=eq." + encodeURIComponent(itemId), { method: "DELETE" }).then(function () { return false; }).catch(function () { return false; });
    },
    likes: function () {
      return api("likes?select=item_id").then(function (rows) {
        return (rows || []).map(function (r) { return r.item_id; });
      }).catch(function () { return local.likes(); });
    },
    entitlements: function () {
      return api("entitlements?select=sku,expires_at").then(function (rows) { return rows || []; }).catch(function () { return []; });
    },
    signIn: function (emailAddr) {
      return fetch(URL_ + "/auth/v1/otp", {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddr, create_user: true, options: { email_redirect_to: location.origin + location.pathname } }),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.msg || j.error_description || "sign-in failed"); });
        return true;
      });
    },
    signOut: function () {
      jdel("session");
      try { localStorage.removeItem("mcc_sess_keep"); } catch (e) {}
      return Promise.resolve();
    },
    /* the admin door: email + password, no inbox in the loop.
       Create the user once in Supabase → Authentication → Users →
       Add user (auto-confirm on), then this signs in directly. */
    signInPassword: function (emailAddr, pass) {
      return fetch(URL_ + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddr, password: pass }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !j.access_token) {
            throw new Error(j.msg || j.error_description || j.error || "That key doesn't turn this lock.");
          }
          saveSession({ access_token: j.access_token, refresh_token: j.refresh_token || "" });
          window.MCC_DB = sb;
          return true;
        });
      });
    },
    /* set a password: a real cross-device account. Supabase → Auth →
       Providers → Email: if "Confirm email" is ON, this returns no
       session until they confirm; turn it OFF for instant password
       accounts. Returns { session:true } when signed in, else { confirm:true }.
       `data` rides into user_metadata; the store profile keeps the
       buyer's name and phone there, on the account, not the device. */
    signUpPassword: function (emailAddr, pass, data) {
      return fetch(URL_ + "/auth/v1/signup", {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddr, password: pass, data: data || {} }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.msg || j.error_description || j.error || "sign-up failed");
          if (j.access_token) {
            saveSession({ access_token: j.access_token, refresh_token: j.refresh_token || "" });
            window.MCC_DB = sb;
            return { session: true };
          }
          return { session: false, confirm: true };
        });
      });
    },
    /* instant start: a real cloud account with no email at all.
       Requires Anonymous sign-ins ON (Supabase → Auth → Sign In / Providers).
       The visitor gets a true auth.uid(), profiles and listings save under
       it, and a magic link can claim the account with an email later. */
    signInAnon: function () {
      return fetch(URL_ + "/auth/v1/signup", {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !j.access_token) {
            throw new Error(j.msg || j.error_description || j.error || "Instant start is switched off. Enable Anonymous sign-ins in Supabase.");
          }
          saveSession({ access_token: j.access_token, refresh_token: j.refresh_token || "" });
          window.MCC_DB = sb;
          return true;
        });
      });
    },
  };

  window.MCC_DB = session() ? sb : local;
  window.MCC_AUTH = { signIn: sb.signIn, signInAnon: sb.signInAnon, signInPassword: sb.signInPassword, signUpPassword: sb.signUpPassword, signOut: sb.signOut, user: sb.user };
  // the low-level surface for other modules (network layer, talent app):
  // same public anon key, same RLS wall, never a secret
  window.MCC_SUPA = { url: URL_, key: KEY, token: token, uid: uid, email: email };
})();

/* THE CARD STAYS DEALT: the E⤴ Card lives on the ACCOUNT, not the
   device. Any page, any browser: if this device lost the card (new
   phone, cleared storage) but the member is signed in, pull it back
   from the imprint once per session, so nothing ever nags a member
   who already played RISE. */
(function () {
  try {
    if (localStorage.getItem("mcc_rise")) return;
    if (!(window.MCC_AUTH && window.MCC_AUTH.user && window.MCC_AUTH.user())) return;
    if (sessionStorage.getItem("mcc_rise_pulled")) return;
    sessionStorage.setItem("mcc_rise_pulled", "1");
    window.MCC_SUPA.token().then(function (t) {
      if (!t) return null;
      return fetch(window.MCC_SUPA.url + "/rest/v1/rpc/my_imprint", { method: "POST",
        headers: { "Content-Type": "application/json", apikey: window.MCC_SUPA.key, Authorization: "Bearer " + t },
        body: "{}" });
    }).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (imp) {
      if (imp && imp.paths && imp.paths.length) {
        localStorage.setItem("mcc_rise", JSON.stringify({ entry: "imprint", arch: imp.paths, v: {}, at: new Date().toISOString() }));
      }
    }).catch(function () {});
  } catch (e) {}
})();
