/* THE FASHION BUREAU OF INVESTIGATION.

   The board is public: anybody can look, and a shared case link opens that
   case. Voting, filing and reporting need an M Account. Every case is
   reviewed by the owner before it reaches the board (the Desk tab, which
   only the owner sees), and the server holds every rule this page shows:
   no faces unless you turned yourself in, a city at most, votes that fit
   the case. Votes earn nothing. */
(function () {
  "use strict";
  var API = "https://api.mccluster.org";
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var $ = function (id) { return document.getElementById(id); };
  var S = { tab: "most_wanted", session: null, desk: false, cases: [], loading: false };

  var BLURB = {
    most_wanted: "Fashion crimes, judged by the people. Guilty or acquitted?",
    sighting: "Fakes spotted in the wild. The shoe is on trial, not the person wearing it.",
    legit_check: "Members put their own pairs up for a legit check. Legit or cap?",
    mine: "Cases you've filed, and where they are.",
    desk: "Waiting for your review. Nothing here is public until you approve it."
  };
  var VERDICT = {
    cap: "CAP", legit: "LEGIT", guilty: "GUILTY", acquitted: "ACQUITTED",
    hung_jury: "HUNG JURY", under_investigation: "UNDER INVESTIGATION"
  };

  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function session() {
    if (!window.MCC || !MCC.refreshIfNeeded) return Promise.resolve(null);
    return MCC.refreshIfNeeded().catch(function () { return null; });
  }
  function api(path, opts) {
    opts = opts || {};
    return session().then(function (s) {
      S.session = s;
      var headers = { "content-type": "application/json" };
      if (s && s.access_token) headers.authorization = "Bearer " + s.access_token;
      else if (opts.auth) throw Object.assign(new Error("Sign in to do that."), { status: 401 });
      return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = {}; try { d = t ? JSON.parse(t) : {}; } catch (x) { d = {}; }
        if (!r.ok) throw Object.assign(new Error(d.error || ("Request failed (" + r.status + ")")), { status: r.status });
        return d;
      });
    });
  }

  /* ---------- the board ---------- */
  function votesFor(c) {
    var pair = c.kind === "most_wanted" ? [["guilty", "Guilty"], ["acquitted", "Acquitted"]] : [["legit", "Legit"], ["cap", "Cap"]];
    return pair.map(function (p) {
      var on = c.my_vote === p[0];
      return '<button class="fbi__vote fbi__vote--' + p[0] + (on ? " is-on" : "") + '" type="button" data-vote="' + p[0] + '" data-case="' + e(c.id) + '" aria-pressed="' + on + '">' +
        e(p[1]) + ' <b>' + e(c.tally[p[0]] || 0) + "</b></button>";
    }).join("");
  }
  function card(c, mode) {
    var photo = c.photos && c.photos[0] ? '<img src="' + e(c.photos[0]) + '" alt="' + e(c.title) + '" loading="lazy">' : '<div class="fbi__nophoto">No photo</div>';
    var more = c.photos && c.photos.length > 1 ? '<span class="fbi__count">+' + (c.photos.length - 1) + "</span>" : "";
    var stamp = mode === "board" && c.verdict ? '<span class="fbi__stamp fbi__stamp--' + e(c.verdict) + '">' + e(VERDICT[c.verdict] || "") + "</span>" : "";
    var head = c.kind === "most_wanted" ? '<p class="fbi__wanted">' + (c.self_surrender ? "Turned themselves in" : "Wanted") + "</p>" : "";
    var meta = [c.charge ? "Charge: " + e(c.charge) : "", c.item ? e(c.item) : "", c.city ? e(c.city) : ""].filter(Boolean).join(" · ");
    var foot = "";
    if (mode === "board") {
      foot = '<div class="fbi__votes">' + votesFor(c) + '</div><div class="fbi__actions"><button type="button" class="fbi__link" data-share="' + e(c.id) + '">Share</button><button type="button" class="fbi__link" data-report="' + e(c.id) + '">Report</button></div>';
    } else if (mode === "mine") {
      var st = { pending: "Under review", public: "On the board", removed: "Removed" }[c.status] || c.status;
      foot = '<p class="fbi__state fbi__state--' + e(c.status) + '">' + e(st) + (c.removal_reason ? " · " + e(c.removal_reason) : "") + "</p>";
    } else if (mode === "desk") {
      var reps = c.reports && c.reports.length ? '<p class="fbi__hint">Reported: ' + c.reports.map(e).join(" · ") + "</p>" : "";
      foot = reps + '<p class="fbi__hint">' + (c.self_surrender ? "Self-surrender: the person in the photo is the reporter." : "Attested: no faces, no names.") + '</p><div class="fbi__actions"><button type="button" class="fbi__btn fbi__btn--hot" data-review="public" data-case="' + e(c.id) + '">Approve</button><button type="button" class="fbi__btn" data-review="removed" data-case="' + e(c.id) + '">Remove</button></div>';
    }
    return '<article class="fbi__case" id="case-' + e(c.id) + '"><div class="fbi__photo">' + photo + more + stamp + "</div>" +
      '<div class="fbi__body">' + head + "<h3>" + e(c.title) + "</h3>" + (meta ? '<p class="fbi__meta">' + meta + "</p>" : "") +
      (c.details ? '<p class="fbi__details">' + e(c.details) + "</p>" : "") + foot + "</div></article>";
  }
  function render(list, mode, empty) {
    $("fbiBoard").innerHTML = list.length ? list.map(function (c) { return card(c, mode); }).join("") : '<p class="fbi__empty">' + empty + "</p>";
  }
  function load() {
    var tab = S.tab;
    $("fbiBlurb").textContent = BLURB[tab] || "";
    $("fbiBoard").innerHTML = '<p class="fbi__empty">Pulling the files…</p>';
    var req = tab === "mine" ? api("/v1/fbi/mine", { auth: true })
      : tab === "desk" ? api("/v1/fbi/desk", { auth: true })
      : api("/v1/fbi/board?kind=" + tab);
    req.then(function (d) {
      if (tab !== S.tab) return;
      S.cases = d.cases || [];
      if (tab === "mine") render(S.cases, "mine", "You haven't filed a case yet.");
      else if (tab === "desk") render(S.cases, "desk", "Nothing waiting. The streets are quiet.");
      else render(S.cases, "board", tab === "most_wanted" ? "No fugitives yet. Report the first fashion crime." : tab === "sighting" ? "No sightings yet. Seen a fake? Report it." : "No legit checks yet. Put your pair up first.");
      openShared();
    }).catch(function (x) {
      if (x.status === 401) { $("fbiBoard").innerHTML = '<p class="fbi__empty">Sign in to see your cases. <a href="account.html">Sign in</a></p>'; return; }
      $("fbiBoard").innerHTML = '<p class="fbi__empty">' + e(x.message) + "</p>";
    });
  }
  function setTab(tab) {
    S.tab = tab;
    document.querySelectorAll("[data-tab]").forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("is-on", on); b.setAttribute("aria-selected", String(on));
    });
    load();
  }

  /* A shared link (fbi.html#case=<id>) opens on that case, whatever board
     it is on. */
  var shared = (/#case=([0-9a-f-]{36})/i.exec(location.hash) || [])[1] || null;
  function openShared() {
    if (!shared) return;
    var el = $("case-" + shared);
    if (el) { el.classList.add("is-shared"); el.scrollIntoView({ block: "center" }); shared = null; return; }
    var id = shared; shared = null;
    api("/v1/fbi/cases/" + id).then(function (d) {
      if (!d.case) return;
      if (d.case.kind !== S.tab) { shared = id; setTab(d.case.kind); }
    }).catch(function () { /* the case was removed or never public */ });
  }

  function needSignIn(x) {
    if (x && x.status === 401) { if (confirm("Sign in to your M Account to do that?")) location.href = "account.html"; return true; }
    return false;
  }

  /* ---------- votes, reports, shares, the desk ---------- */
  $("fbiBoard").addEventListener("click", function (ev) {
    var b = ev.target.closest("button");
    if (!b) return;
    var id = b.getAttribute("data-case");
    if (b.hasAttribute("data-vote")) {
      b.disabled = true;
      api("/v1/fbi/cases/" + id + "/vote", { method: "POST", auth: true, body: { vote: b.getAttribute("data-vote") } }).then(function (d) {
        var i = S.cases.findIndex(function (c) { return c.id === id; });
        if (i >= 0 && d.case) { S.cases[i] = d.case; var node = $("case-" + id); if (node) node.outerHTML = card(d.case, "board"); }
      }).catch(function (x) { b.disabled = false; if (!needSignIn(x)) alert(x.message); });
    } else if (b.hasAttribute("data-report")) {
      var why = prompt("What's wrong with this case? (a face, a name, someone could be found, something else)");
      if (why === null) return;
      api("/v1/fbi/cases/" + b.getAttribute("data-report") + "/report", { method: "POST", auth: true, body: { reason: why } })
        .then(function () { b.textContent = "Reported"; b.disabled = true; })
        .catch(function (x) { if (!needSignIn(x)) alert(x.message); });
    } else if (b.hasAttribute("data-share")) {
      var url = location.origin + location.pathname + "#case=" + b.getAttribute("data-share");
      var c = S.cases.find(function (x) { return x.id === b.getAttribute("data-share"); }) || {};
      var text = c.kind === "most_wanted" ? "Guilty or acquitted? The FBI needs your verdict." : "Legit or cap? The FBI needs your verdict.";
      if (navigator.share) navigator.share({ title: c.title || "FBI case file", text: text, url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { b.textContent = "Link copied"; });
    } else if (b.hasAttribute("data-review")) {
      var decision = b.getAttribute("data-review"), reason = null;
      if (decision === "removed") { reason = prompt("Why is it coming down? (the reporter sees this)"); if (reason === null) return; }
      b.disabled = true;
      api("/v1/fbi/cases/" + id + "/review", { method: "POST", auth: true, body: { decision: decision, reason: reason } })
        .then(function () { var n = $("case-" + id); if (n) n.remove(); })
        .catch(function (x) { b.disabled = false; alert(x.message); });
    }
  });
  document.querySelectorAll("[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
  });

  /* ---------- filing a case ---------- */
  var sheet = $("fbiSheet");
  function kind() { var k = document.querySelector('input[name="kind"]:checked'); return k ? k.value : ""; }
  function syncForm() {
    var k = kind(), wanted = k === "most_wanted", surrender = wanted && $("fbiSurrender").checked;
    $("fbiChargeWrap").hidden = !wanted;
    $("fbiChargeOtherWrap").hidden = !wanted || $("fbiCharge").value !== "";
    $("fbiSurrenderWrap").hidden = !wanted;
    $("fbiNoFacesWrap").hidden = surrender;
    $("fbiPhotoNote").textContent = surrender ? "It's you, so your face can be in it." : "Show the shoes or the fit. Crop out faces.";
    $("fbiTitle").placeholder = k === "legit_check" ? "Are my Off-White 1s legit?" : wanted ? "Socks with slides at the cookout" : "Fake Travis lows on the 2 train";
  }
  function openSheet(k) {
    session().then(function (s) {
      if (!s) { if (confirm("Sign in to your M Account to open a case?")) location.href = "account.html"; return; }
      var radio = document.querySelector('input[name="kind"][value="' + k + '"]');
      if (radio) radio.checked = true;
      $("fbiFormStatus").textContent = "";
      syncForm();
      if (sheet.showModal) sheet.showModal(); else sheet.setAttribute("open", "");
    });
  }
  document.querySelectorAll("[data-file]").forEach(function (b) {
    b.addEventListener("click", function () { openSheet(b.getAttribute("data-file")); });
  });
  $("fbiClose").addEventListener("click", function () { sheet.close(); });
  document.querySelectorAll('input[name="kind"]').forEach(function (r) { r.addEventListener("change", syncForm); });
  $("fbiCharge").addEventListener("change", syncForm);
  $("fbiSurrender").addEventListener("change", syncForm);

  /* Photos go to the member's own private media through the same signed
     upload the Action Network uses; the Bureau shows them on signed links. */
  function uploadPhoto(file, token) {
    return api("/v1/mnet/media/upload-url", { method: "POST", auth: true, body: { file_name: file.name, mime_type: file.type, byte_size: file.size } }).then(function (grant) {
      var path = grant && grant.upload && grant.upload.path, asset = grant && grant.asset, t = grant && grant.upload && grant.upload.token;
      if (!path || !asset || !t) throw new Error("The upload slot was not created.");
      var url = SB_URL + "/storage/v1/object/upload/sign/mnet-media/" + path.split("/").map(encodeURIComponent).join("/") + "?token=" + encodeURIComponent(t);
      return fetch(url, { method: "PUT", headers: { apikey: SB_KEY, authorization: "Bearer " + token, "content-type": file.type, "x-upsert": "false" }, body: file }).then(function (r) {
        if (!r.ok) throw new Error("A photo upload failed (" + r.status + ").");
        return api("/v1/mnet/media/finalize", { method: "POST", auth: true, body: { asset_id: asset.id } });
      }).then(function () { return asset.id; });
    });
  }

  $("fbiForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var k = kind(), files = Array.prototype.slice.call($("fbiPhotos").files || [], 0, 4), status = $("fbiFormStatus"), btn = $("fbiSubmit");
    var surrender = k === "most_wanted" && $("fbiSurrender").checked;
    if (!k) { status.textContent = "Pick a case type."; return; }
    if (!files.length) { status.textContent = "Add at least one photo."; return; }
    if ($("fbiTitle").value.trim().length < 3) { status.textContent = "Give the case a title."; return; }
    if (!surrender && !$("fbiNoFaces").checked) { status.textContent = "Confirm there are no faces or names in the photos."; return; }
    btn.disabled = true; status.textContent = "Uploading the evidence…";
    session().then(function (s) {
      if (!s) throw Object.assign(new Error("Sign in first."), { status: 401 });
      return files.reduce(function (p, f) { return p.then(function (ids) { return uploadPhoto(f, s.access_token).then(function (id) { return ids.concat(id); }); }); }, Promise.resolve([]));
    }).then(function (ids) {
      status.textContent = "Filing the case…";
      var charge = k === "most_wanted" ? ($("fbiCharge").value || $("fbiChargeOther").value) : "";
      return api("/v1/fbi/cases", { method: "POST", auth: true, body: {
        kind: k, title: $("fbiTitle").value, item: $("fbiItem").value, city: $("fbiCity").value, details: $("fbiDetails").value,
        charge: charge, media_asset_ids: ids, self_surrender: surrender, no_faces_attested: $("fbiNoFaces").checked
      } });
    }).then(function () {
      $("fbiForm").reset();
      sheet.close();
      setTab("mine");
    }).catch(function (x) {
      if (!needSignIn(x)) status.textContent = x.message;
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- start ---------- */
  api("/v1/fbi/desk").then(function () { S.desk = true; $("fbiDeskTab").hidden = false; }).catch(function () { /* not the owner */ });
  setTab("most_wanted");
})();
