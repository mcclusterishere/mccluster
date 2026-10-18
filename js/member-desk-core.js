/* THE MEMBER DESK: the rules, kept free of the DOM so node --test can check
   them (scripts/test/member-desk.test.mjs).
   docs/control-plane/MEMBER-DESK-AND-PROFILE-EDIT-GATE.md

   The desk is a layer over the World globe, opened from the bottom app bar,
   never a page of its own (owner, 2026-10-15: "The policy link that
   separates everything, that's not even an experience. I wanted it layered
   on top of this"). What it shows follows what the member can do:
   everyone signed in gets their profile, their missions and their alerts; a
   creator also gets their own audience numbers; a business their workspace
   and sites; a fellow the policy memo desk, which used to live on its own
   page (action-policy.html now opens this desk instead).

   The profile edit gate's member-side rules live here too: which fields are
   locked, whether a change request is valid, and what state a request is
   in. The server decides all of it again (supabase/pending/
   20261016010000_profile_edit_gate_v1.sql); this only keeps the screen
   honest. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MCC_DESK_CORE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SECTIONS = {
    welcome: { label: "Your desk" },
    profile: { label: "Profile" },
    missions: { label: "Missions" },
    notifications: { label: "Alerts" },
    creator: { label: "Audience" },
    business: { label: "Business" },
    policy: { label: "Policy" }
  };

  /* What this member can do, from what the existing services already say:
     signed in (a session), creator (a music creator profile row, read under
     its own RLS), business (an active creator/business workspace from
     /v1/creator-billing/entitlement, or an analytics site they own), fellow
     (a seat in a Policy Fellowship cohort, or an accepted fellowship
     application, from policy_ladder_status). Nothing is inferred. */
  function capabilities(input) {
    var i = input || {};
    var ladder = i.ladder || {};
    var seats = Array.isArray(ladder.policy_seats) ? ladder.policy_seats : [];
    var app = ladder.fellowship_application || null;
    var signedIn = !!i.signedIn;
    return {
      signedIn: signedIn,
      creator: signedIn && !!i.creator,
      business: signedIn && (!!(i.entitlement && i.entitlement.paid) || (Number(i.sites) || 0) > 0),
      fellow: signedIn && (seats.length > 0 || !!(app && app.status === "accepted"))
    };
  }

  /* The desk's sections, in order. Breakpoints never change this list: the
     phone sees everything the desktop sees. */
  function sections(caps) {
    var c = caps || {};
    if (!c.signedIn) return [];
    var out = ["profile"];
    if (c.fellow) out.push("policy");
    out.push("missions", "notifications");
    if (c.creator) out.push("creator");
    if (c.business) out.push("business");
    if (!c.fellow) out.push("policy");
    return out;
  }

  /* The World desk is a member surface. The public registry's data contract
     is unchanged, but guests do not enter a policy workspace here. */
  function policyMode(caps) {
    var c = caps || {};
    if (!c.signedIn) return null;
    if (c.fellow) return "memo_desk";
    return "ladder";
  }

  /* ?desk=1 opens the desk on its first section; ?desk=<section> on that one */
  function deskParam(search) {
    var q;
    try { q = new URLSearchParams(String(search || "").replace(/^\?/, "")); } catch (e) { return null; }
    if (!q.has("desk")) return null;
    var v = String(q.get("desk") || "").toLowerCase();
    if (SECTIONS[v] && v !== "welcome") return v;
    return "open";
  }

  function deskUrl(section, base) {
    var b = base == null ? "mnet.html" : base;
    return b + "?view=feed&desk=" + encodeURIComponent(section && SECTIONS[section] ? section : "1");
  }

  /* action-policy.html is no longer an experience of its own. Every inbound
     link (QR codes, old posts, the Equity Uprise page) lands on the World
     with the desk open on Policy; its two filters ride along. */
  function policyRedirect(search, hash) {
    var target = deskUrl("policy");
    try {
      var q = new URLSearchParams(String(search || "").replace(/^\?/, ""));
      ["region", "status"].forEach(function (k) {
        var v = q.get(k);
        if (v && /^[A-Za-z0-9_-]{1,60}$/.test(v)) target += "&" + k + "=" + encodeURIComponent(v);
      });
    } catch (e) { /* keep the plain target */ }
    var h = String(hash || "");
    return target + (/^#[A-Za-z0-9_-]{1,40}$/.test(h) ? h : "");
  }

  /* missions from action_record(): in progress (joined, in_progress,
     submitted) and verified (an admin approved the proof) */
  function missionBuckets(record) {
    var list = (record && Array.isArray(record.missions)) ? record.missions : [];
    var inProgress = [], verified = [], other = [];
    list.forEach(function (m) {
      if (m.status === "verified") verified.push(m);
      else if (m.status === "joined" || m.status === "in_progress" || m.status === "submitted") inProgress.push(m);
      else other.push(m);
    });
    return { inProgress: inProgress, verified: verified, other: other };
  }

  /* ---------- the profile edit gate ---------- */

  /* the World's profile form: which input shows which protected field */
  var FORM_FIELDS = { handle: "mnHandle", display_name: "mnDisplay", legal_name: "mnLegalName", region: "mnRegion", country: "mnCountry" };

  function lockedFields(status) {
    var f = (status && Array.isArray(status.fields)) ? status.fields : [];
    return f.filter(function (x) { return x && x.locked; });
  }

  /* closed: the migration is not applied; signed_out; consent_pending: no
     approved consent text yet (nothing can be recorded); ready: may ask;
     awaiting_video: a code was issued and the video is not sent;
     waiting_persona: sent, the ID check is not approved yet; in_review: sent
     and with the owner; applied; rejected; retake; withdrawn; expired. */
  function gateState(status) {
    if (!status || status.closed) return "closed";
    if (!status.signed_in) return "signed_out";
    var l = status.latest, consent = !!status.consent;
    var startable = consent ? "ready" : "consent_pending";
    if (!l) return startable;
    switch (l.status) {
      case "awaiting_capture": return consent ? "awaiting_video" : "consent_pending";
      case "submitted": return status.require_persona !== false && l.persona_status !== "approved" ? "waiting_persona" : "in_review";
      case "approved": return l.applied_at ? "applied" : "in_review";
      case "rejected": return "rejected";
      case "retake_requested": return "retake";
      case "withdrawn": return "withdrawn";
      case "expired": return "expired";
      default: return startable;
    }
  }

  function canStart(state) {
    return ["ready", "awaiting_video", "applied", "rejected", "retake", "withdrawn", "expired"].indexOf(state) >= 0;
  }

  /* Mirrors profile_edit_start(): at least one locked, requestable field;
     each value non-empty, short enough, in its format, and different. */
  function validateChanges(changes, status) {
    var fields = lockedFields(status), byKey = {};
    fields.forEach(function (f) { byKey[f.key] = f; });
    var keys = Object.keys(changes || {});
    var clean = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = String(changes[k] == null ? "" : changes[k]).trim();
      if (!v) continue;
      var f = byKey[k];
      if (!f) return { ok: false, error: "That detail is not locked; change it directly." };
      if (f.requestable === false) return { ok: false, error: f.label + " changes only through its own setup." };
      if (v.length > (Number(f.max_length) || 160)) return { ok: false, error: f.label + " is too long." };
      if (f.pattern) { var re; try { re = new RegExp(f.pattern); } catch (e) { re = null; } if (re && !re.test(v)) return { ok: false, error: f.label + " is not in the allowed format." }; }
      if (f.value != null && String(f.value) === v) return { ok: false, error: f.label + " already has that value." };
      clean[k] = v;
    }
    if (!Object.keys(clean).length) return { ok: false, error: "Type the new value for at least one detail." };
    return { ok: true, changes: clean };
  }

  /* What the person says on camera. */
  function editScript(name, phrase, labels, reason) {
    var n = String(name || "").trim().replace(/\s+/g, " ");
    var what = (labels && labels.length) ? labels.join(", ") : "[the details]";
    return ["My name is " + (n.length >= 2 && n.indexOf(" ") > 0 ? n : "[your first and last name]") + ".",
      "My code is: " + phrase + ".",
      "I am asking to change my " + what + ".",
      "Here is why: " + (String(reason || "").trim() || "[your reason]") + "."];
  }

  return { SECTIONS: SECTIONS, FORM_FIELDS: FORM_FIELDS, capabilities: capabilities, sections: sections, policyMode: policyMode,
    deskParam: deskParam, deskUrl: deskUrl, policyRedirect: policyRedirect, missionBuckets: missionBuckets,
    lockedFields: lockedFields, gateState: gateState, canStart: canStart, validateChanges: validateChanges, editScript: editScript };
});
