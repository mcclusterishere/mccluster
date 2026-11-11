/* Native Control · Equity Uprise · Identity.

   The owner's review queue for the identity verification levels
   (docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md). Each submitted live
   video shows its age against the 24-hour target, the name the person typed,
   the challenge phrase they had to say, and for a full-access request the
   Persona ID result and their approved live introduction SIDE BY SIDE, so the
   owner compares the two people and the ID name by eye. No software compares
   faces. Videos play from short-lived signed URLs (five minutes) that only a
   reviewer can mint; opening a submission is written to the append-only
   review log. Approve, reject or ask for a retake: one server call,
   identity_review_decide(), which refuses anything out of order (a reject or
   retake needs a note; a full-access approval needs Persona "approved").

   Retention: "Delete due videos" removes every video past its delete date
   (N days after the decision, or now if the person asked) through the Storage
   API, then marks each one deleted. */
(function () {
  "use strict";
  window.CR = window.CR || {};
  var R = { supa: null, rerender: null, queue: null, busy: false, err: null, open: null, urls: {}, msg: "" };
  var LABEL = { v1_live_intro: "Live introduction", v2_halo_full: "Full Halo access", profile_edit: "Profile edit" };
  /* a "Profile edit" submission: its requested changes and its own decision call (js/control-room/profile-edit-review.js) */
  function PE() { return window.CR && window.CR.profileEditReview; }
  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function note(t, bad) { return '<div class="cro-note' + (bad ? " cro-note--bad" : "") + '">' + e(t) + "</div>"; }
  function redraw() { if (R.rerender) R.rerender(); }
  function age(h) { var C = window.MCC_IDENTITY_CAPTURE; return C ? C.ageLabel(h) : (Math.round(h) + " h"); }

  function storage(path, body, method) {
    var S = window.MCC_SUPA;
    if (!S) return Promise.reject(new Error("Session helper did not load (js/backend.js)."));
    return S.token().then(function (t) {
      return fetch(S.url + "/storage/v1/" + path, { method: method || "POST", cache: "no-store",
        headers: { apikey: S.key, authorization: "Bearer " + t, "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    }).then(function (r) { return r.json().catch(function () { return null; }).then(function (j) {
      if (!r.ok) throw new Error((j && (j.message || j.error)) || ("Storage " + r.status));
      return j;
    }); });
  }
  function signedUrl(bucket, path, seconds) {
    return storage("object/sign/" + encodeURI(bucket + "/" + path), { expiresIn: seconds || 300 }).then(function (j) {
      var rel = j && (j.signedURL || j.signedUrl);
      if (!rel) throw new Error("No signed URL returned.");
      return window.MCC_SUPA.url + "/storage/v1" + rel;
    });
  }

  function load() {
    R.busy = true; R.err = null; redraw();
    return R.supa("rpc/identity_review_queue", { method: "POST", body: {} })
      .then(function (q) { R.queue = q || { pending: [], recent: [] };
        if (PE() && (R.queue.pending || []).some(function (p) { return p.level === "profile_edit"; })) return PE().load(R.supa); })
      .catch(function (err) { R.queue = null; R.err = String(err && err.message || err); })
      .then(function () { R.busy = false; redraw(); });
  }

  function openItem(id) {
    R.open = R.open === id ? null : id;
    if (!R.open) { redraw(); return; }
    R.urls[id] = { loading: true }; redraw();
    R.supa("rpc/identity_review_open", { method: "POST", body: { p_submission_id: id } })
      .then(function (o) {
        var secs = Math.min(300, Number(o && o.signed_url_seconds) || 300);
        return Promise.all([
          o && o.object_path ? signedUrl(o.bucket, o.object_path, secs) : null,
          o && o.v1_object_path ? signedUrl(o.bucket, o.v1_object_path, secs) : null
        ]).then(function (u) { R.urls[id] = { main: u[0], v1: u[1], until: Date.now() + secs * 1000 }; });
      })
      .catch(function (err) { R.urls[id] = { error: String(err && err.message || err) }; })
      .then(redraw);
  }

  function videoCell(title, url, sub) {
    return '<figure style="margin:0;min-width:0"><figcaption class="cro-meta">' + e(title) + "</figcaption>" +
      (url ? '<video controls playsinline preload="metadata" src="' + e(url) + '" style="width:100%;max-height:52vh;background:#000;border-radius:10px"></video>' : note("No video (deleted or not available).")) +
      (sub || "") + "</figure>";
  }

  function personaLine(p) {
    if (p.level !== "v2_halo_full" && p.level !== "profile_edit") return "";
    var ok = p.persona_status === "approved";
    return '<p class="cro-meta">ID check (Persona): <span class="cro-pill">' + e(p.persona_status || "not started") + "</span>" +
      (p.persona_inquiry_id ? " · inquiry " + e(p.persona_inquiry_id) : "") +
      (p.persona_verified_name ? " · name on ID <b>" + e(p.persona_verified_name) + "</b>" + (p.persona_birth_year ? " (born " + e(p.persona_birth_year) + ")" : "") : (p.persona_inquiry_id ? " · name on ID: open the inquiry in the Persona dashboard" : "")) +
      " · stated name <b>" + e(p.stated_name) + "</b>" + (ok ? "" : " · <b>approval waits for Persona \"approved\"</b>") + "</p>";
  }

  function detail(p) {
    var u = R.urls[p.id] || {};
    if (u.loading) return note("Opening (logged)…");
    if (u.error) return note("Could not open the video: " + u.error, true);
    var expired = u.until && Date.now() > u.until;
    var main = videoCell(LABEL[p.level] + " · says “" + p.challenge_phrase + "”", expired ? null : u.main,
      '<p class="cro-meta">Typed name: <b>' + e(p.stated_name) + "</b>" + (p.access_request ? "<br>Access request: " + e(p.access_request) : "") + "</p>");
    var grid = p.level === "v2_halo_full"
      ? '<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:12px" class="idr-pair">' +
          videoCell("Approved live introduction" + (p.v1 ? " · said “" + p.v1.challenge_phrase + "”" : ""), expired ? null : u.v1,
            p.v1 ? '<p class="cro-meta">Name then: <b>' + e(p.v1.stated_name) + "</b></p>" : note("No approved introduction found.", true)) + main + "</div>"
      : main;
    if (p.level === "profile_edit" && PE()) grid += PE().changesHtml(p.id);
    return (expired ? note("The five-minute links expired. Close and open again.") : "") + grid + personaLine(p) +
      '<label>Note to the person (required to reject or ask for a retake)<textarea data-idr-note="' + e(p.id) + '" rows="3"></textarea></label>' +
      '<div class="cro-actions">' +
        '<button class="cr-btn cr-btn--primary" type="button" data-idr-decide="' + e(p.id) + '" data-level="' + e(p.level) + '" data-decision="approve"' + (p.is_mine ? " disabled" : "") + ">Approve</button>" +
        '<button class="cr-btn" type="button" data-idr-decide="' + e(p.id) + '" data-level="' + e(p.level) + '" data-decision="request_retake"' + (p.is_mine ? " disabled" : "") + ">Ask for a retake</button>" +
        '<button class="cr-btn" type="button" data-idr-decide="' + e(p.id) + '" data-level="' + e(p.level) + '" data-decision="reject"' + (p.is_mine ? " disabled" : "") + ">Reject</button>" +
      "</div>" + (p.is_mine ? note("This is your own submission; another reviewer must decide it.") : "");
  }

  function render() {
    if (R.queue === null && !R.busy && !R.err) load();
    if (R.err) return note(/identity_review_queue|does not exist|404|PGRST/i.test(R.err)
      ? "Identity review is not switched on yet: supabase/pending/20261015230000_identity_verification_levels_v1.sql has not been applied."
      : /not authorized/i.test(R.err) ? "Only the owner and the admins the owner names can review identity videos." : "The identity queue could not load: " + R.err, true);
    if (!R.queue) return note("Loading the identity queue…");
    var q = R.queue, pending = q.pending || [];
    var head = (R.msg ? note(R.msg) : "") +
      '<p class="cro-meta">' + pending.length + " waiting · target: decided within 24 hours · " + e(q.due_for_deletion || 0) + " video(s) past their delete date</p>" +
      '<div class="cro-actions"><button class="cr-btn" type="button" data-idr-reload>Refresh</button>' +
      (q.due_for_deletion ? '<button class="cr-btn" type="button" data-idr-purge>Delete due videos</button>' : "") + "</div>";
    var list = pending.length ? pending.map(function (p) {
      var open = R.open === p.id;
      return '<article class="cro-card" style="margin-bottom:12px"><div class="cro-item__head"><div><p class="cro-meta">' + e(LABEL[p.level] || p.level) +
        " · waiting " + e(age(p.age_hours)) + (p.overdue ? " · <b>over 24 h</b>" : "") + (p.previous_attempts ? " · attempt " + e(p.previous_attempts + 1) : "") +
        (p.location_region_key ? " · " + e(p.location_region_key) : "") + "</p><b>" + e(p.stated_name) + "</b></div>" +
        '<span class="cro-pill">' + (p.level === "v2_halo_full" || p.level === "profile_edit" ? "ID: " + e(p.persona_status || "none") : "submitted") + "</span></div>" +
        '<div class="cro-actions"><button class="cr-btn" type="button" data-idr-open="' + e(p.id) + '">' + (open ? "Close" : "Open and review") + "</button></div>" +
        (open ? detail(p) : "") + "</article>";
    }).join("") : note("No identity videos are waiting.");
    var recent = (q.recent || []).slice(0, 20).map(function (r) {
      return "<li>" + e(r.decided_at ? new Date(r.decided_at).toLocaleString() : "") + " · " + e(LABEL[r.level] || r.level) + " · " + e(r.stated_name) + " · " + e(r.status) +
        (r.decision_note ? " · " + e(r.decision_note) : "") + (r.video_deleted ? " · video deleted" : "") + "</li>";
    }).join("");
    return '<div class="cro-list">' + head + list + (recent ? "<h4>Recent decisions</h4><ul>" + recent + "</ul>" : "") + "</div>";
  }

  function purge() {
    if (!confirm("Delete every identity video that is past its delete date? This cannot be undone.")) return;
    R.supa("rpc/identity_videos_due_for_deletion", { method: "POST", body: {} }).then(function (due) {
      due = due || [];
      if (!due.length) return 0;
      var bucket = due[0].bucket;
      return storage("object/" + encodeURIComponent(bucket), { prefixes: due.map(function (d) { return d.object_path; }) }, "DELETE")
        .then(function () { return Promise.all(due.map(function (d) { return R.supa("rpc/identity_mark_video_deleted", { method: "POST", body: { p_submission_id: d.id } }); })); })
        .then(function () { return due.length; });
    }).then(function (n) { R.msg = n + " video(s) deleted."; return load(); })
      .catch(function (err) { alert(err.message || "Deletion failed."); });
  }

  function bind(root) {
    if (!root) return;
    root.querySelectorAll("[data-idr-open]").forEach(function (b) { b.onclick = function () { openItem(b.getAttribute("data-idr-open")); }; });
    root.querySelectorAll("[data-idr-reload]").forEach(function (b) { b.onclick = function () { R.msg = ""; load(); }; });
    root.querySelectorAll("[data-idr-purge]").forEach(function (b) { b.onclick = purge; });
    root.querySelectorAll("[data-idr-decide]").forEach(function (b) { b.onclick = function () {
      var id = b.getAttribute("data-idr-decide"), decision = b.getAttribute("data-decision");
      var el = root.querySelector('[data-idr-note="' + id + '"]'), text = el ? el.value.trim() : "";
      if (decision !== "approve" && !text) { alert("Add a note so the person knows what to do next."); return; }
      var label = decision === "approve" ? "Approve this person" : decision === "reject" ? "Reject this video" : "Ask for a retake";
      if (!confirm(label + "? They are notified" + (text ? " with your note" : "") + ".")) return;
      b.disabled = true;
      var call = b.getAttribute("data-level") === "profile_edit" && PE() ? PE().decideRpc : "rpc/identity_review_decide";
      R.supa(call, { method: "POST", body: { p_submission_id: id, p_decision: decision, p_note: text || null } })
        .then(function (r) { R.msg = "Decision saved: " + (r && r.status || decision) + "."; R.open = null; delete R.urls[id]; return load(); })
        .catch(function (err) { b.disabled = false; alert(err.message || "The decision did not save."); });
    }; });
  }

  /* phone first: one column; the V1/V2 pair sits side by side from tablet width up */
  (function style() {
    if (typeof document === "undefined" || document.getElementById("idrStyle")) return;
    var st = document.createElement("style"); st.id = "idrStyle";
    st.textContent = "@media (min-width:900px){.idr-pair{grid-template-columns:repeat(2,minmax(0,1fr))!important}}";
    (document.head || document.documentElement).appendChild(st);
  })();
  window.CR.identityReview = { init: function (opts) { R.supa = opts.supa; R.rerender = opts.render; }, render: render, bind: bind, load: load, state: R };
})();
