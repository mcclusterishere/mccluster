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
    return {
      ok: missing.length === 0, creator: false, created: false, linked: false, profile: null,
      missing: missing, problems: problems,
      prefill: { handle: problems.handle ? null : (handle || null), artist_name: name || null,
        handle_suggestion: missing.indexOf("handle") >= 0 ? (suggestHandle(name || pp.mccluster_id) || null) : null,
        has_bio: bio !== "", has_website: web !== "" },
      insert: missing.length ? null : { handle: handle, artist_name: name, bio: bio, website_url: web, terms_version: TERMS_VERSION },
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

  return {
    HANDLE: HANDLE, FIELDS: FIELDS, TERMS_VERSION: TERMS_VERSION, EDIT_URL: EDIT_URL,
    normalizeHandle: normalizeHandle, validHandle: validHandle, suggestHandle: suggestHandle,
    view: view, wantsEdit: wantsEdit, askFor: askFor, ready: ready,
    fallbackState: fallbackState, rpcMissing: rpcMissing, handleHelp: handleHelp
  };
});
