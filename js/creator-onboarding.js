/* Creator onboarding, one click (owner, 2026-10-15: "a click of a button,
   because we already have all the user data; only ask for data they missed
   … I should never see it again unless I'm editing profile data").

   The decision is server truth, never localStorage: the onboarding shows
   only while the member has no music_creator_profiles row. The server
   answers through public.music_creator_state() and the one button calls
   public.music_become_creator() (supabase/pending/music_creator_one_click_v1.sql).
   Until that SQL is applied in production the RPCs answer 404, and
   Creator Studio builds the same answer from the member's own rows
   (fallbackState below), so the page behaves the same either way.

   Pure functions only: Creator Studio (js/music-creator-studio.js) and the
   Node tests (scripts/test/creator-onboarding.test.mjs) share them. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MCC_CREATOR_ONBOARD = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var HANDLE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
  var FIELDS = ["artist_name", "handle"];
  var TERMS_VERSION = "music-creator-v1";
  /* Where "Edit profile" goes. The edit gate (live video + identity check,
     owner review) is built separately and sits in front of this address. */
  var EDIT_URL = "creator.html?edit=profile";

  function clean(v, max) {
    return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function normalizeHandle(v) { return String(v == null ? "" : v).trim().replace(/^@+/, "").toLowerCase(); }
  function validHandle(v) { return HANDLE.test(normalizeHandle(v)); }
  /* A handle to offer, from a name: "Hitman Benji" -> "hitman-benji". */
  function suggestHandle(name) {
    var s = String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 34).replace(/[-._]+$/, "");
    return HANDLE.test(s) ? s : "";
  }

  /* What to show. Exactly one of:
     "signin"  no session, or a session with no M person
     "onboard" signed in, not a creator: the one-click card
     "studio"  a creator: the studio, no onboarding, ever
     "edit"    a creator who asked to edit their profile (?edit=profile) */
  function view(input) {
    var i = input || {};
    var s = i.state || null;
    if (!i.signedIn || !s || s.error === "not_signed_in") return "signin";
    if (s.creator === true) return i.editing ? "edit" : "studio";
    return "onboard";
  }
  function wantsEdit(search) {
    try { return new URLSearchParams(String(search || "")).get("edit") === "profile"; } catch (_) { return false; }
  }

  /* The fields to ask for inline: only the missing ones, in a fixed order. */
  function askFor(state) {
    var m = state && Array.isArray(state.missing) ? state.missing : [];
    return FIELDS.filter(function (f) { return m.indexOf(f) >= 0; });
  }
  /* Ready for the one click: nothing missing, no problem with the handle. */
  function ready(state) {
    return !!state && state.creator !== true && askFor(state).length === 0 && !(state.problems && state.problems.handle);
  }

  /* The server's answer, built in the browser from the member's own rows,
     for as long as the RPC is not deployed. Same shape, same rules, except
     that "taken" is only learned when the insert is refused (409). */
  function fallbackState(rows) {
    var r = rows || {};
    var creator = r.creator || null;
    if (creator) {
      return {
        ok: true, creator: true, created: false, linked: !!r.linked,
        profile: { handle: creator.handle, artist_name: creator.artist_name, status: creator.status || "active",
          verification_state: creator.verification_state || "unverified",
          avatar_url: creator.avatar_url || "", banner_url: creator.banner_url || "" },
        missing: [], problems: {}, terms_version: TERMS_VERSION, source: "fallback"
      };
    }
    var np = r.network || {};
    var pp = r.platform || {};
    var input = r.input || {};
    var name = clean(input.artist_name, 160) || clean(np.display_name, 160) || clean(pp.display_name, 160);
    var problems = {};
    var handle = "";
    if (clean(input.handle, 80)) {
      handle = normalizeHandle(input.handle);
      if (!HANDLE.test(handle)) problems.handle = "invalid";
    } else {
      handle = normalizeHandle(pp.mccluster_id);
      if (!HANDLE.test(handle)) handle = "";
    }
    if (r.takenHandle && handle === normalizeHandle(r.takenHandle)) problems.handle = "taken";
    var missing = [];
    if (!name) missing.push("artist_name");
    if (!handle || problems.handle) missing.push("handle");
    var bio = String(np.bio || "").slice(0, 2000);
    var web = /^https:\/\/\S+$/i.test(String(np.website_url || "")) && String(np.website_url).length <= 500 ? String(np.website_url) : "";
    /* the member's picture comes along too (owner, 2026-10-20: never re-enter what the profile has); https only */
    var avatar = /^https:\/\/\S+$/i.test(String(np.avatar_url || "")) && String(np.avatar_url).length <= 2000 ? String(np.avatar_url) : "";
    return {
      ok: missing.length === 0, creator: false, created: false, linked: false, profile: null,
      missing: missing, problems: problems,
      prefill: { handle: problems.handle ? null : (handle || null), artist_name: name || null,
        handle_suggestion: missing.indexOf("handle") >= 0 ? (suggestHandle(name || pp.mccluster_id) || null) : null,
        has_bio: bio !== "", has_website: web !== "", avatar_url: avatar || null },
      insert: missing.length ? null : { handle: handle, artist_name: name, bio: bio, website_url: web, avatar_url: avatar, terms_version: TERMS_VERSION },
      terms_version: TERMS_VERSION, source: "fallback"
    };
  }

  /* PostgREST says a function is not there (not yet applied): 404 / PGRST202. */
  function rpcMissing(status, body) {
    return status === 404 || (body && (body.code === "PGRST202" || body.code === "42883"));
  }

  function handleHelp(state) {
    var p = state && state.problems && state.problems.handle;
    var sug = state && state.prefill && state.prefill.handle_suggestion;
    if (p === "taken") return "That handle is taken." + (sug ? " @" + sug + " is free." : "");
    if (p === "invalid") return "3–40 letters, numbers, dots, dashes or underscores.";
    return "Your page lives at this name.";
  }

  /* IS THE PROFILE DONE? (owner, 2026-10-20: "you should be able to sign up to anything else without having to enter
     any additional information unless your profile's not filled out"). The World's bootstrap is the judge: a profile
     is done with a username, a name and the contact step behind it. Not done means the three pages first
     (FINISH_URL: the World opens them at the first unfinished one and comes back here), never a form of our own. */
  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var API = "https://api.mccluster.org";
  var FINISH_URL = "mnet.html?finish=1&next=" + encodeURIComponent("creator.html");
  function profileUnfinished(boot) {
    if (!boot) return false;
    return boot.next_step === "profile" || boot.next_step === "contact" ||
      !(boot.identity && boot.identity.mccluster_id) || !(boot.profile && String(boot.profile.display_name || "").trim());
  }
  /* true: done; false: not done; null: the bootstrap could not answer (the card then asks only what is missing) */
  function profileDone(o) {
    var f = o.fetch || fetch;
    return f(API + "/v1/mnet/bootstrap?app_key=mccluster-web", { headers: { authorization: "Bearer " + o.token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (boot) { return boot ? !profileUnfinished(boot) : null; })
      .catch(function () { return null; });
  }

  /* THE TWO CALLS, for Creator Studio and for every "Become a creator" door on the site: the server functions in
     supabase/pending/music_creator_one_click_v1.sql, and while those are not applied (404) the same answer built
     from the member's own rows (fallbackState) with the same two writes. o: { token, mUid, userId, fetch }. */
  function client(o) {
    var f = o.fetch || fetch;
    var enc = encodeURIComponent;
    var headers = function (extra) {
      var h = { apikey: KEY, authorization: "Bearer " + o.token, "content-type": "application/json" };
      for (var k in extra || {}) h[k] = extra[k];
      return h;
    };
    var parse = function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
        return { res: res, data: data };
      });
    };
    function rpc(name, body) {
      return f(SB + "/rest/v1/rpc/" + name, { method: "POST", headers: headers(), body: JSON.stringify(body || {}) }).then(parse).then(function (out) {
        if (rpcMissing(out.res.status, out.data)) return { missingRpc: true };
        if (!out.res.ok) throw new Error((out.data && (out.data.message || out.data.error)) || ("Request failed " + out.res.status));
        return { data: out.data };
      });
    }
    function rest(path, init) {
      init = init || {};
      return f(SB + "/rest/v1/" + path, { method: init.method || "GET", headers: headers(init.headers), body: init.body }).then(parse).then(function (out) {
        if (!out.res.ok) throw new Error((out.data && (out.data.message || out.data.error || out.data.hint)) || ("Request failed " + out.res.status));
        return out.data;
      });
    }
    function one(path) { return rest(path).then(function (r) { return Array.isArray(r) ? r[0] || null : null; }).catch(function () { return null; }); }
    function ownRows(extra) {
      return Promise.all([
        one("music_creator_profiles?m_uid=eq." + enc(o.mUid) + "&select=handle,artist_name,status,verification_state,avatar_url,banner_url&limit=1"),
        one("network_profiles?m_uid=eq." + enc(o.mUid) + "&select=display_name,bio,website_url,avatar_url&limit=1"),
        o.userId ? one("platform_profiles?user_id=eq." + enc(o.userId) + "&select=mccluster_id,display_name&limit=1") : null,
        one("identity_presentations?m_uid=eq." + enc(o.mUid) + "&select=music_enabled&limit=1")
      ]).then(function (r) {
        var rows = { creator: r[0], network: r[1], platform: r[2], linked: !!(r[3] && r[3].music_enabled) };
        for (var k in extra || {}) rows[k] = extra[k];
        return rows;
      });
    }
    function state() {
      return rpc("music_creator_state").then(function (out) { return out.missingRpc ? ownRows().then(fallbackState) : out.data; });
    }
    function become(input) {
      input = input || {};
      return rpc("music_become_creator", {
        p_handle: input.handle || null, p_artist_name: input.artist_name || null, p_accept_terms: true
      }).then(function (out) {
        if (!out.missingRpc) return out.data;
        /* fallback: the same rules in the browser, then the same two writes */
        return ownRows({ input: input }).then(function (rows) {
          var plan = fallbackState(rows);
          if (plan.creator || !plan.insert) return plan;
          var row = { m_uid: o.mUid, terms_accepted_at: new Date().toISOString() };
          for (var k in plan.insert) row[k] = plan.insert[k];
          return rest("music_creator_profiles", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }).then(function () {
            /* the presentation link is repaired by the server function once deployed */
            return rest("identity_presentations?on_conflict=m_uid", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
              body: JSON.stringify({ m_uid: o.mUid, music_enabled: true }) }).catch(function () {}).then(function () {
              return ownRows().then(function (r) { var after = fallbackState(r); after.created = after.creator; return after; });
            });
          }, function (err) {
            if (/duplicate|unique|409/i.test(String(err.message))) return ownRows({ input: input, takenHandle: plan.insert.handle }).then(fallbackState);
            throw err;
          });
        });
      });
    }
    return { rpc: rpc, rest: rest, state: state, become: become };
  }

  /* THE DOOR (owner, 2026-10-20: "I don't like how the artist section is like, once you make a profile … you should
     be able to sign up to anything else without having to enter any additional information"). Any link written
     <a href="creator.html" data-creator-door> is the one tap: the page beside it says the tap accepts the Creator
     Terms. Signed out, it is an ordinary link to Creator Studio (whose sign-up comes back there); a profile that is
     not done goes through the three pages first and comes back to the one tap; a done profile becomes a creator
     here, with nothing asked (name, handle, bio, website and picture from the profile), and lands in Creator Studio;
     a creator, or a handle another creator holds, lands in Creator Studio, which says what is left. */
  function subOf(token) {
    try {
      var b = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b.length % 4) b += "=";
      return JSON.parse(atob(b)).sub || "";
    } catch (_) { return ""; }
  }
  function openDoor(w, a) {
    var M = w.MCC, href = a.getAttribute("href") || "creator.html", label = a.textContent;
    var go = function (to) {
      var dest = to || href, nav = w.MCC_BAR && w.MCC_BAR.navigation, house = "";
      try { house = nav && nav.house ? new URL(nav.house, w.location.href).origin : ""; } catch (_) {}
      /* on the World's own host, Creator Studio and the pages live on Matthew's site: the bar carries the sign-in there */
      if (house && house !== w.location.origin && nav.handoff) {
        var there = new URL(dest, house + "/").href;
        return nav.handoff(there).then(function (h) { w.location.assign(h); }, function () { w.location.assign(there); });
      }
      w.location.assign(dest);
    };
    a.setAttribute("aria-busy", "true");
    return M.refreshIfNeeded().then(function (s) {
      if (!s || !s.access_token) return go();
      a.textContent = "Making your page…";
      return Promise.all([M.mUid(), profileDone({ token: s.access_token })]).then(function (r) {
        if (!r[0]) return go();
        if (r[1] === false) return go(FINISH_URL);
        var c = client({ token: s.access_token, mUid: r[0], userId: (s.user && s.user.id) || subOf(s.access_token) });
        return c.state().then(function (st) {
          if (!st || st.creator === true || !ready(st)) return go();
          return c.become({}).then(function (after) {
            try { if (w.MCC_TRACK) w.MCC_TRACK("creator_onboarded", { created: !!(after && after.created), via: "door" }); } catch (_) {}
            go();
          });
        });
      });
    }).catch(function () { go(); }).then(function () {
      /* a page restored from the back-forward cache shows the door as it was */
      a.removeAttribute("aria-busy"); a.textContent = label;
    });
  }
  function bindDoors(w) {
    if (!w || !w.document || w.__mccCreatorDoors) return;
    w.__mccCreatorDoors = true;
    w.document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[data-creator-door]");
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!w.MCC || !w.MCC.refreshIfNeeded || !w.MCC.mUid) return;
      e.preventDefault();
      if (a.getAttribute("aria-busy") === "true") return;
      openDoor(w, a);
    });
  }
  if (typeof window !== "undefined" && window.document) bindDoors(window);

  return {
    HANDLE: HANDLE, FIELDS: FIELDS, TERMS_VERSION: TERMS_VERSION, EDIT_URL: EDIT_URL, FINISH_URL: FINISH_URL,
    normalizeHandle: normalizeHandle, validHandle: validHandle, suggestHandle: suggestHandle,
    view: view, wantsEdit: wantsEdit, askFor: askFor, ready: ready,
    fallbackState: fallbackState, rpcMissing: rpcMissing, handleHelp: handleHelp,
    profileUnfinished: profileUnfinished, profileDone: profileDone, client: client, openDoor: openDoor
  };
});
