/* Native Control · Human Uprise · Identity · Profile edits.

   The owner's half of the profile edit gate
   (docs/control-plane/MEMBER-DESK-AND-PROFILE-EDIT-GATE.md). A member asks
   to change a locked detail with a live video (and the Persona ID check);
   the request is a submission of type "Profile edit" in the same Identity
   queue (js/control-room/identity-review.js), with the same video player,
   age, 24-hour target and Persona line. This module adds what is particular
   to an edit: each requested change beside the current value, the reason
   given, and the decision call, profile_edit_review_decide(), which applies
   an approved change once (with an append-only audit row per field) and
   changes nothing on a reject or retake. */
(function () {
  "use strict";
  window.CR = window.CR || {};
  var P = { map: null, err: null };
  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function load(supa) {
    if (!supa) return Promise.resolve(null);
    return supa("rpc/profile_edit_review_queue", { method: "POST", body: {} })
      .then(function (m) { P.map = m || {}; P.err = null; return P.map; })
      .catch(function (err) { P.map = null; P.err = String(err && err.message || err); return null; });
  }

  function changesHtml(submissionId) {
    if (P.err) return '<div class="cro-note cro-note--bad">' + (/profile_edit_review_queue|does not exist|404|PGRST/i.test(P.err)
      ? "Profile edits are not switched on yet: supabase/pending/20261016010000_profile_edit_gate_v1.sql has not been applied."
      : "The requested changes could not load: " + e(P.err)) + "</div>";
    var r = P.map && P.map[submissionId];
    if (!r) return '<div class="cro-note">Loading the requested changes…</div>';
    var rows = (r.changes || []).map(function (c) {
      return "<tr><th scope=\"row\">" + e(c.label) + "</th><td>" + e(c.current == null || c.current === "" ? "(empty)" : c.current) + "</td><td><b>" + e(c.requested) + "</b></td></tr>";
    }).join("");
    return '<div class="cro-card" style="margin:10px 0;overflow-x:auto"><p class="cro-meta">Requested changes · applied only if you approve, once, with an audit record</p>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr><th scope="col" style="text-align:left">Detail</th><th scope="col" style="text-align:left">Now</th><th scope="col" style="text-align:left">Asks for</th></tr></thead><tbody>' + rows + "</tbody></table>" +
      '<p class="cro-meta">Reason: ' + e(r.reason) + "</p>" +
      (r.require_persona ? '<p class="cro-meta">Approval waits for the Persona ID check to be "approved".</p>' : "") + "</div>";
  }

  window.CR.profileEditReview = { load: load, changesHtml: changesHtml, decideRpc: "rpc/profile_edit_review_decide", state: P };
})();
