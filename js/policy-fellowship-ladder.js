/* POLICY FELLOWSHIP LADDER: the rules, in one place the browser and the
   tests share. The server is the authority (supabase/pending/
   policy_fellowship_ladder_v1.sql); this file mirrors it so the page can
   explain the next step and the tests can prove the two agree.

   - The ladder: starter missions (help a person, write a song, attend a
     rally) -> the Policy Fellowship cohort for your state -> policy teams.
     A starter kind counts only when a mission mapped to it has a VERIFIED
     assignment (its proof was reviewed and approved). The rule is data
     (action_ladder_rules), not code: which kinds, how many, and whether a
     creator account excludes a member (default: it does not).
   - The memo: draft -> submitted -> in_review -> approved | declined |
     changes_requested | owner_edited, and back to submitted. Every
     submission and every owner edit is an immutable version; an owner edit
     needs a note to the fellow and keeps a line diff against its parent.

   Docs: docs/control-plane/POLICY-FELLOWSHIP-LADDER.md */
(function (root) {
  "use strict";

  var STATUSES = ["draft", "submitted", "in_review", "approved", "declined", "changes_requested", "owner_edited", "withdrawn"];
  var TERMINAL = ["approved", "declined", "withdrawn"];
  /* Fellow may edit the working draft in these states. */
  var EDITABLE = ["draft", "changes_requested", "owner_edited"];

  /* [from, action, actor, to]. Kept byte-for-byte in step with the SQL
     function action_policy_memo_next_status(); a test compares them. */
  var TRANSITIONS = [
    ["draft", "submit", "fellow", "submitted"],
    ["changes_requested", "resubmit", "fellow", "submitted"],
    ["owner_edited", "resubmit", "fellow", "submitted"],
    ["draft", "withdraw", "fellow", "withdrawn"],
    ["submitted", "withdraw", "fellow", "withdrawn"],
    ["changes_requested", "withdraw", "fellow", "withdrawn"],
    ["owner_edited", "withdraw", "fellow", "withdrawn"],
    ["submitted", "start_review", "owner", "in_review"],
    ["in_review", "approve", "owner", "approved"],
    ["owner_edited", "approve", "owner", "approved"],
    ["in_review", "decline", "owner", "declined"],
    ["in_review", "request_changes", "owner", "changes_requested"],
    ["in_review", "owner_edit", "owner", "owner_edited"],
    ["owner_edited", "owner_edit", "owner", "owner_edited"]
  ];
  /* Owner actions that must carry a note to the fellow. */
  var NOTE_REQUIRED = ["decline", "request_changes", "owner_edit"];

  function nextStatus(from, action, actor) {
    for (var i = 0; i < TRANSITIONS.length; i++) {
      var t = TRANSITIONS[i];
      if (t[0] === from && t[1] === action && t[2] === actor) return t[3];
    }
    return null;
  }

  /* Validate a review/submit request the way the server will. Returns
     {ok:true,to} or {ok:false,error}. */
  function checkAction(req) {
    var from = req && req.from, action = req && req.action, actor = req && req.actor;
    var to = nextStatus(from, action, actor);
    if (!to) return { ok: false, error: "illegal transition: " + action + " from " + from + " by " + actor };
    var note = String(req.note == null ? "" : req.note).trim();
    if (NOTE_REQUIRED.indexOf(action) >= 0 && note.length < 3) return { ok: false, error: action + " needs a note to the fellow" };
    if (action === "owner_edit") {
      var body = String(req.body == null ? "" : req.body);
      if (!body.trim()) return { ok: false, error: "owner_edit needs the edited text" };
      if (body === String(req.currentBody == null ? "" : req.currentBody)) return { ok: false, error: "owner_edit must change the text" };
    }
    if ((action === "submit" || action === "resubmit") && !String(req.body == null ? "" : req.body).trim()) {
      return { ok: false, error: "write the memo before submitting it" };
    }
    return { ok: true, to: to };
  }

  /* rule = {required_kinds:[...], min_kinds:null|n, creator_exclusive:bool}
     completed = array of kinds with a verified assignment. */
  function evaluateLadder(rule, completed, opts) {
    var required = (rule && rule.required_kinds) || [];
    var have = {};
    (completed || []).forEach(function (k) { have[k] = true; });
    var done = required.filter(function (k) { return have[k]; });
    var remaining = required.filter(function (k) { return !have[k]; });
    var need = rule && rule.min_kinds != null ? Math.min(Number(rule.min_kinds), required.length) : required.length;
    var blocked = null;
    if (rule && rule.creator_exclusive && opts && opts.isCreator) blocked = "creator_exclusive";
    if (!required.length) blocked = blocked || "no_rule";
    return {
      done: done, remaining: remaining, needed: need, completed: done.length,
      eligible: !blocked && done.length >= need, blocked_reason: blocked
    };
  }

  /* The next step a signed-in member sees. Mirrors policy_ladder_status(). */
  function nextStep(s) {
    if (!s || !s.signed_in) return "sign_in";
    if (s.policy_seats && s.policy_seats.length) return "write_memo";
    if (!s.eligible) return "complete_starter_missions";
    var app = s.fellowship_application && s.fellowship_application.status;
    if (app === "accepted") return "await_policy_cohort_seat";
    if (app === "submitted") return "await_fellowship_review";
    return "apply_for_fellowship";
  }

  /* Line diff (LCS), same walk and tie-break as
     action_policy_memo_line_diff() in SQL. ops: "=", "-", "+". */
  function lineDiff(oldText, newText) {
    var a = String(oldText == null ? "" : oldText).split("\n");
    var b = String(newText == null ? "" : newText).split("\n");
    var n = a.length, m = b.length;
    if ((n + 1) * (m + 1) > 1000000) return { format: "summary", too_large: true, old_lines: n, new_lines: m };
    var W = m + 1, L = new Int32Array((n + 1) * (m + 1));
    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        L[i * W + j] = a[i] === b[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
      }
    }
    var ops = [], added = 0, removed = 0, x = 0, y = 0;
    while (x < n && y < m) {
      if (a[x] === b[y]) { ops.push({ op: "=", t: a[x] }); x++; y++; }
      else if (L[(x + 1) * W + y] >= L[x * W + y + 1]) { ops.push({ op: "-", t: a[x] }); removed++; x++; }
      else { ops.push({ op: "+", t: b[y] }); added++; y++; }
    }
    while (x < n) { ops.push({ op: "-", t: a[x] }); removed++; x++; }
    while (y < m) { ops.push({ op: "+", t: b[y] }); added++; y++; }
    return { format: "lines", added: added, removed: removed, ops: ops };
  }

  var api = {
    STATUSES: STATUSES, TERMINAL: TERMINAL, EDITABLE: EDITABLE, TRANSITIONS: TRANSITIONS,
    NOTE_REQUIRED: NOTE_REQUIRED, nextStatus: nextStatus, checkAction: checkAction,
    evaluateLadder: evaluateLadder, nextStep: nextStep, lineDiff: lineDiff
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MCC_POLICY_LADDER = api;
})(typeof window !== "undefined" ? window : globalThis);
