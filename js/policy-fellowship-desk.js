/* YOUR POLICY LADDER, inside the member desk over the World globe (js/member-desk.js; it was the Policy room, action-policy.html, which now opens the desk).

   The member's side of the Policy Fellowship ladder
   (docs/control-plane/POLICY-FELLOWSHIP-LADDER.md): any three verified
   missions (the starter missions are suggestions) and the next step; with a seat in a state Policy Fellowship
   cohort, the memo desk (write, save, submit up the line, read the desk's
   notes and edits, keep research leads with their provenance).

   Every write is a server function that decides who you are and what state
   the memo is in (supabase/pending/policy_fellowship_ladder_v1.sql). Until
   that migration is applied the section says the ladder is not open yet.
   Research items are leads, never verified evidence; nothing here fetches
   or scrapes a search engine. */
(function () {
  "use strict";
  var host = document.getElementById("ladder");
  if (!host) return;
  var SUPA = window.MCC_SUPA, L = window.MCC_POLICY_LADDER;
  if (!SUPA || !L) return;
  var S = { status: null, memos: [], open: null, hist: {}, msg: "", busy: false };
  var NEXT = {
    sign_in: "Sign in to start the ladder.",
    complete_starter_missions: "Complete any three missions. Each one counts when an admin reviews and verifies its proof. Here are three to start with.",
    apply_for_fellowship: "You have three verified missions. Apply for the fellowship from your Action Record.",
    await_fellowship_review: "Your fellowship application is in review.",
    await_policy_cohort_seat: "You are a fellow. The desk gives seats in your state's Policy Fellowship cohort.",
    write_memo: "You have a seat. Write a memo for your state and send it up the line.",
    ladder_closed: "The policy ladder is not open right now."
  };
  var KINDS = [["news", "News"], ["scholarly", "Scholarly"], ["public_data", "Public data"], ["legislation", "Legislation"], ["manual_citation", "Citation I typed in"]];
  var PROVIDERS = [["manual", "Typed by me (e.g. found on Google Scholar)"], ["openalex", "OpenAlex"], ["crossref", "Crossref"], ["semantic_scholar", "Semantic Scholar"], ["core", "CORE"], ["arxiv", "arXiv"], ["pubmed", "PubMed"], ["gdelt", "GDELT"], ["openstates", "Open States"], ["legiscan", "LegiScan"], ["congress_gov", "Congress.gov"], ["official", "Official government site"]];

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function opts(list, sel) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sel ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join(""); }
  function req(path, body) {
    return SUPA.token().catch(function () { return null; }).then(function (t) {
      return fetch(SUPA.url + "/rest/v1/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { apikey: SUPA.key, authorization: "Bearer " + (t || SUPA.key), "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    }).then(function (r) {
      return r.text().then(function (txt) {
        var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
        if (!r.ok) { var err = new Error((j && (j.message || j.hint)) || ("Request failed (" + r.status + ")")); err.status = r.status; err.code = j && j.code; throw err; }
        return j;
      });
    });
  }
  function rpc(name, args) { return req("rpc/" + name, args || {}); }
  function missing(err) { return err && (err.status === 404 || /PGRST20[12]|does not exist|Could not find/i.test(err.message || "") || /PGRST20[12]/.test(err.code || "")); }

  function load() {
    return rpc("policy_ladder_status").then(function (s) {
      S.status = s;
      if (s && s.policy_seats && s.policy_seats.length) {
        return req("action_policy_memos?select=id,status,draft_title,region_key,cohort_id,updated_at&order=updated_at.desc&limit=50").then(function (rows) { S.memos = rows || []; });
      }
    }).catch(function (err) {
      S.status = missing(err) ? { closed: true } : { error: err.message || String(err) };
    }).then(paint);
  }
  function loadHist(id) {
    return rpc("policy_memo_history", { p_memo_id: id }).then(function (h) { S.hist[id] = h; })
      .catch(function (err) { S.hist[id] = { error: err.message || String(err) }; }).then(paint);
  }

  function steps(s) {
    return '<ol class="ladder-steps">' + (s.steps || []).map(function (k) {
      var ms = (k.missions || []).map(function (m) {
        return '<li><a href="mnet.html?mission=' + encodeURIComponent(m.id) + '">' + esc(m.title) + "</a>" + (m.my_status ? " <small>(" + esc(m.my_status) + ")</small>" : "") + "</li>";
      }).join("");
      return '<li class="card"><div class="tag">' + (k.done ? "Done" : "Suggested mission") + "</div><h3>" + esc(k.label) + "</h3>" +
        (k.description ? "<p>" + esc(k.description) + "</p>" : "") +
        (ms ? "<ul>" + ms + "</ul>" : "<p><small>No open mission for this step yet.</small></p>") + "</li>";
    }).join("") + "</ol>";
  }
  function diff(d) {
    if (!d) return "";
    if (d.too_large) return "<p><small>Too large to show line by line.</small></p>";
    return '<p><small>+' + esc(d.added) + " / −" + esc(d.removed) + ' lines</small></p><div class="ladder-diff">' + (d.ops || []).map(function (o) {
      return '<div class="d' + (o.op === "+" ? "a" : o.op === "-" ? "r" : "") + '">' + esc((o.op === "=" ? "  " : o.op + " ") + o.t) + "</div>";
    }).join("") + "</div>";
  }
  function memoView(m) {
    var h = S.hist[m.id];
    if (h === undefined) { loadHist(m.id); return "<p>Loading…</p>"; }
    if (!h || h.error) return "<p>That memo could not be read: " + esc(h && h.error) + "</p>";
    var memo = h.memo || m, editable = L.EDITABLE.indexOf(memo.status) >= 0, closed = L.TERMINAL.indexOf(memo.status) >= 0;
    var deskNotes = (h.reviews || []).filter(function (r) { return r.actor_role === "owner" && r.note; }).map(function (r) {
      return "<li><b>" + esc(r.action.replace(/_/g, " ")) + "</b> · " + esc(new Date(r.created_at).toLocaleString()) + "<br>" + esc(r.note) + "</li>";
    }).join("");
    var ownerEdits = (h.versions || []).filter(function (v) { return v.author_role === "owner"; }).map(function (v) {
      return "<details><summary>The desk's edit, version " + esc(v.version_no) + "</summary>" + diff(v.diff_from_parent) + "</details>";
    }).join("");
    var research = (h.research || []).map(function (x) {
      var t = /^https:\/\//i.test(x.url || "") ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title) + "</a>" : esc(x.title);
      return "<li>" + t + " <small>· " + esc(x.provider) + (x.publisher ? " · " + esc(x.publisher) : "") + " · unverified lead</small>" +
        (closed ? "" : ' <button type="button" data-rm="' + esc(x.id) + '">Remove</button>') + "</li>";
    }).join("");
    var canSubmit = L.nextStatus(memo.status, memo.status === "draft" ? "submit" : "resubmit", "fellow");
    var canWithdraw = L.nextStatus(memo.status, "withdraw", "fellow");
    return (deskNotes ? "<h4>Notes from the desk</h4><ul>" + deskNotes + "</ul>" : "") + ownerEdits +
      (editable ? '<label>Title<input id="lmTitle" maxlength="200" value="' + esc(memo.draft_title) + '"></label>' +
        '<label>Memo<textarea id="lmBody" rows="14" maxlength="60000" placeholder="To: the official. Problem. Evidence. Recommendation. What it costs.">' + esc(memo.draft_body) + "</textarea></label>" +
        '<div class="toolbar"><button type="button" data-save="' + esc(m.id) + '">Save draft</button>' +
        (canSubmit ? '<button type="button" data-submit="' + esc(m.id) + '">' + (memo.status === "draft" ? "Send up the line" : "Send again") + "</button>" : "") +
        (canWithdraw ? '<button type="button" data-withdraw="' + esc(m.id) + '">Withdraw</button>' : "") + "</div>"
        : "<p><small>This memo is " + esc(memo.status.replace(/_/g, " ")) + "." + (canWithdraw ? "" : " It cannot be edited now.") + "</small></p>" +
          (canWithdraw ? '<div class="toolbar"><button type="button" data-withdraw="' + esc(m.id) + '">Withdraw</button></div>' : "")) +
      "<h4>Research</h4><p><small>Collect what you found, with where it came from. A search result is a lead, not verified evidence. Nothing here searches Google Scholar for you; type a Scholar citation in by hand.</small></p>" +
      (research ? "<ul>" + research + "</ul>" : "<p><small>No research yet.</small></p>") +
      (closed ? "" : '<div class="ladder-form"><label>Kind<select id="lrKind">' + opts(KINDS, "news") + '</select></label><label>Source<select id="lrProvider">' + opts(PROVIDERS, "manual") + "</select></label>" +
        '<label>Title or citation<input id="lrTitle" maxlength="500"></label><label>Link (https)<input id="lrUrl" type="url" inputmode="url" maxlength="2000"></label>' +
        '<label>Publisher<input id="lrPublisher" maxlength="300"></label><label>Why it matters<textarea id="lrNote" rows="2" maxlength="2000"></textarea></label>' +
        '<button type="button" data-addres="' + esc(m.id) + '">Add to research</button></div>');
  }
  function memoDesk(s) {
    var seats = s.policy_seats || [];
    var list = S.memos.map(function (m) {
      var open = S.open === m.id;
      return '<article class="card"><div class="tag">' + esc(m.status.replace(/_/g, " ")) + (m.region_key ? " · " + esc(m.region_key) : "") + "</div><h3>" + esc(m.draft_title) + "</h3>" +
        '<button type="button" data-open="' + esc(m.id) + '">' + (open ? "Close" : "Open") + "</button>" + (open ? memoView(m) : "") + "</article>";
    }).join("");
    return "<h3>Your memos</h3>" + (list || "<p>No memos yet.</p>") +
      '<div class="ladder-form"><label>Cohort<select id="lnCohort">' + seats.map(function (c) { return '<option value="' + esc(c.cohort_id) + '">' + esc(c.name) + "</option>"; }).join("") + "</select></label>" +
      '<label>Memo title<input id="lnTitle" maxlength="200" placeholder="What you are asking for, and of whom"></label><button type="button" data-new>Start a memo</button></div>';
  }
  function paint() {
    var s = S.status, html = "";
    if (!s) html = "<p>Loading your ladder…</p>";
    else if (s.closed) html = "<p>The policy ladder is not open yet.</p>";
    else if (s.error) html = "<p>Your ladder could not load: " + esc(s.error) + "</p>";
    else {
      var step = s.next_step || L.nextStep(s);
      html = '<p class="ladder-next"><b>Next:</b> ' + esc(NEXT[step] || step) + (step === "sign_in" ? ' <a href="login.html">Sign in</a>' : "") +
        (step === "apply_for_fellowship" ? ' <a href="mnet.html">Open your Action Record</a>' : "") + "</p>" +
        (s.signed_in ? "<p><small>" + esc(s.completed) + " of " + esc(s.needed) + " missions verified.</small></p>" : "") +
        steps(s) + (step === "write_memo" ? memoDesk(s) : "");
    }
    host.innerHTML = "<h2>Your policy ladder</h2>" + (S.msg ? '<p role="status">' + esc(S.msg) + "</p>" : "") + html;
    host.hidden = false;
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ""; }
  function act(btn, work, done) {
    if (S.busy) return; S.busy = true; if (btn) btn.disabled = true; S.msg = "";
    work().then(function () { S.msg = done || ""; }).catch(function (err) { S.msg = err.message || "That did not save."; })
      .then(function () { S.busy = false; if (S.open) delete S.hist[S.open]; return load(); });
  }
  host.addEventListener("click", function (ev) {
    var b = ev.target.closest("button"); if (!b) return;
    var id;
    if ((id = b.getAttribute("data-open"))) { S.open = S.open === id ? null : id; delete S.hist[id]; paint(); return; }
    if (b.hasAttribute("data-new")) {
      var title = val("lnTitle").trim(); if (title.length < 3) { S.msg = "Give the memo a title."; paint(); return; }
      act(b, function () { return rpc("create_policy_memo", { p_cohort_id: val("lnCohort"), p_title: title }).then(function (r) { S.open = r && r.memo_id; }); }, "Memo started.");
      return;
    }
    if ((id = b.getAttribute("data-save"))) { act(b, function () { return rpc("save_policy_memo_draft", { p_memo_id: id, p_title: val("lmTitle").trim(), p_body: val("lmBody") }); }, "Draft saved."); return; }
    if ((id = b.getAttribute("data-submit"))) {
      var body = val("lmBody");
      if (!body.trim()) { S.msg = "Write the memo before sending it."; paint(); return; }
      if (!confirm("Send this memo up the line? The desk reviews it; you can't edit it while it is in review.")) return;
      act(b, function () { return rpc("save_policy_memo_draft", { p_memo_id: id, p_title: val("lmTitle").trim(), p_body: body }).then(function () { return rpc("submit_policy_memo", { p_memo_id: id }); }); }, "Sent up the line.");
      return;
    }
    if ((id = b.getAttribute("data-withdraw"))) { if (!confirm("Withdraw this memo? This cannot be undone.")) return; act(b, function () { return rpc("withdraw_policy_memo", { p_memo_id: id }); }, "Memo withdrawn."); return; }
    if ((id = b.getAttribute("data-rm"))) { act(b, function () { return rpc("remove_policy_memo_research_item", { p_item_id: id }); }, "Removed."); return; }
    if ((id = b.getAttribute("data-addres"))) {
      var url = val("lrUrl").trim(), provider = val("lrProvider");
      if (!val("lrTitle").trim()) { S.msg = "Add a title or the citation."; paint(); return; }
      if (url && !/^https:\/\//i.test(url)) { S.msg = "Links must start with https://"; paint(); return; }
      if (provider !== "manual" && !url) { S.msg = "A source other than 'typed by me' needs its link."; paint(); return; }
      act(b, function () {
        return rpc("add_policy_memo_research_item", { p_memo_id: id, p_kind: val("lrKind"), p_provider: provider, p_title: val("lrTitle").trim(), p_url: url || null, p_publisher: val("lrPublisher").trim() || null, p_note: val("lrNote").trim() || null });
      }, "Added as an unverified lead.");
    }
  });
  load();
})();
