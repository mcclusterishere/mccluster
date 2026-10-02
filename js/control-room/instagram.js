/* Control · Create · Instagram.

   Posts Reels to Instagram through Meta's official API (the Worker's social
   publisher), never by driving a phone: the API is what Instagram's terms
   allow, and it carries 100 posts a day.

   Anything Claude or another agent prepares arrives here as a draft and
   waits for the owner. Nothing an agent writes reaches Instagram without an
   Approve tap on this screen. */
(function () {
  "use strict";
  window.CR = window.CR || {};
  var S = {
    request: null, render: null, org: null,
    loaded: false, loading: false, error: null,
    account: null, check: null, jobs: [],
    file: null, caption: "", when: "", feed: true,
    busy: null, progress: 0, note: null
  };
  var STATE = {
    draft: "Waiting for you", queued: "Queued", processing: "Instagram is processing",
    published: "Posted", failed: "Failed", cancelled: "Cancelled"
  };

  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function orgId() { var o = S.org && S.org(); return o && o.id; }
  function when(iso) { if (!iso) return ""; var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

  function load() {
    var org = orgId();
    if (S.loading) return;
    if (!org) { S.error = new Error("Your workspace has not loaded yet."); S.render(); return; }
    S.loading = true; S.error = null; S.render();
    S.request("/v1/social/accounts?org_id=" + encodeURIComponent(org)).then(function (r) {
      S.account = (r.accounts || []).filter(function (a) { return a.platform === "instagram"; })[0] || null;
      return Promise.all([
        S.account ? S.request("/v1/social/accounts/" + S.account.id + "/check?org_id=" + encodeURIComponent(org)) : null,
        S.request("/v1/social/publish?org_id=" + encodeURIComponent(org))
      ]);
    }).then(function (out) {
      S.check = out[0]; S.jobs = (out[1] && out[1].jobs) || []; S.loaded = true;
    }).catch(function (x) { S.error = x; }).then(function () { S.loading = false; S.render(); });
  }

  function statusCard() {
    if (!S.loaded) return '<section class="cro-card"><h2>Instagram</h2><p>' + (S.loading ? "Checking the connection…" : "") + '</p></section>';
    if (!S.account) return '<section class="cro-card"><h2>Instagram</h2><div class="cro-note cro-note--bad">No Instagram account is registered for this workspace.</div></section>';
    var c = S.check || {};
    if (c.connected) {
      var quota = c.quota_total != null ? " · " + e(c.quota_used || 0) + " of " + e(c.quota_total) + " posts used today" : "";
      return '<section class="cro-card"><h2>Instagram <span class="cro-pill">connected</span></h2><p>@' + e(c.username || S.account.handle) +
        (c.followers != null ? " · " + e(c.followers) + " followers" : "") + quota + '</p></section>';
    }
    var fix = c.reason === "no_key"
      ? "The Worker has no Instagram access token yet. In Cloudflare, open the <b>mccluster</b> Worker → Settings → Variables and Secrets, and add the secret <b>SOCIAL_IG_MCCLUSTERISHERE_ACCESS_TOKEN</b> with a long-lived token for @" + e(S.account.handle || "mcclusterishere") + " that has the instagram_content_publish permission."
      : "Meta refused the stored token: " + e(c.message || "unknown error") + ". Make a new long-lived token and replace the Worker secret.";
    return '<section class="cro-card"><h2>Instagram <span class="cro-pill">not connected</span></h2><div class="cro-note cro-note--bad">' + fix +
      '</div><p>Posts can still be drafted and queued. They go out as soon as the connection works.</p></section>';
  }

  function composeCard() {
    var busy = !!S.busy, can = S.account && S.file && !busy;
    var label = S.busy === "upload" ? "Uploading " + S.progress + "%…" : S.busy === "save" ? "Saving…" : null;
    return '<section class="cro-card"><h2>New Reel</h2>' +
      '<label class="cro-field"><span>Video (MP4 or MOV, up to 500 MB)</span><input class="cr-input" id="igFile" type="file" accept="video/mp4,video/quicktime"' + (busy ? " disabled" : "") + '></label>' +
      (S.file ? '<p class="cro-meta">' + e(S.file.name) + " · " + e(Math.round(S.file.size / 1048576 * 10) / 10) + " MB</p>" : "") +
      '<label class="cro-field"><span>Caption <small id="igCount">' + S.caption.length + ' / 2,200</small></span><textarea class="cr-textarea" id="igCaption" rows="5" maxlength="2200" placeholder="Caption, hashtags…">' + e(S.caption) + "</textarea></label>" +
      '<label class="cro-field"><span>Post at (optional; leave empty to post now)</span><input class="cr-input" id="igWhen" type="datetime-local" value="' + e(S.when) + '"></label>' +
      '<label class="cro-check"><input type="checkbox" id="igFeed"' + (S.feed ? " checked" : "") + "> Also show on the profile grid</label>" +
      '<div class="cro-actions" style="margin-top:10px">' +
        '<button class="cr-btn cr-btn--primary" type="button" data-ig-post' + (can ? "" : " disabled") + ">" + (label || (S.when ? "Schedule" : "Post")) + "</button>" +
        '<button class="cr-btn" type="button" data-ig-draft' + (can ? "" : " disabled") + ">Save as draft</button>" +
      "</div>" + (S.note ? '<div class="cro-note" style="margin-top:8px">' + e(S.note) + "</div>" : "") + "</section>";
  }

  function jobRow(j) {
    var p = j.payload || {}, by = p.drafted_by ? " · drafted by " + e(p.drafted_by) : "";
    var actions = j.state === "draft"
      ? '<button class="cr-btn cr-btn--primary" type="button" data-ig-approve="' + e(j.id) + '">Approve and post</button><button class="cr-btn" type="button" data-ig-cancel="' + e(j.id) + '">Discard</button>'
      : j.state === "queued" ? '<button class="cr-btn" type="button" data-ig-cancel="' + e(j.id) + '">Cancel</button>' : "";
    var err = j.last_error ? '<div class="cro-note' + (j.state === "failed" ? " cro-note--bad" : "") + '">' + (j.last_error === "credential_secret_not_configured" ? "Waiting for the Instagram connection." : e(j.last_error)) + "</div>" : "";
    return '<div class="cro-row"><div class="cro-row__top"><b>' + e((p.caption || "No caption").slice(0, 90)) + '</b><span class="cro-pill">' + e(STATE[j.state] || j.state) + "</span></div>" +
      '<div class="cro-meta">' + e(when(j.scheduled_at)) + by + "</div>" + err + (actions ? '<div class="cro-actions">' + actions + "</div>" : "") + "</div>";
  }

  function render() {
    if (!S.loaded && !S.loading && !S.error) setTimeout(load, 0);
    var drafts = S.jobs.filter(function (j) { return j.state === "draft"; });
    var rest = S.jobs.filter(function (j) { return j.state !== "draft"; });
    return '<div class="cro-grid cro-grid--2">' + statusCard() + composeCard() + "</div>" +
      (drafts.length ? '<section class="cro-card" style="margin-top:10px"><h2>Waiting for your approval</h2><p>Drafts from Claude or anyone else. Nothing here posts until you approve it.</p>' + drafts.map(jobRow).join("") + "</section>" : "") +
      '<section class="cro-card" style="margin-top:10px"><h2>Posts</h2>' + (rest.length ? rest.map(jobRow).join("") : '<div class="cro-note">Nothing posted from Control yet.</div>') +
      '<div class="cro-actions" style="margin-top:8px"><button class="cr-btn" type="button" data-ig-refresh>Refresh</button></div></section>' +
      (S.error ? '<div class="cro-note cro-note--bad" style="margin-top:10px">' + e(S.error.message || S.error) + "</div>" : "");
  }

  /* The file goes straight to private storage on a signed link, with
     progress, so a large video never passes through the Worker. */
  function upload(file) {
    return S.request("/v1/social/uploads", { method: "POST", body: { org_id: orgId(), mime_type: file.type, byte_size: file.size } }).then(function (u) {
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open("PUT", u.upload_url);
        x.setRequestHeader("content-type", file.type);
        x.upload.onprogress = function (ev) { if (ev.lengthComputable) { S.progress = Math.round(ev.loaded / ev.total * 100); S.render(); } };
        x.onload = function () { x.status >= 200 && x.status < 300 ? resolve(u.storage_path) : reject(new Error("Upload failed (" + x.status + ")")); };
        x.onerror = function () { reject(new Error("Upload failed. Check the connection and try again.")); };
        x.send(file);
      });
    });
  }

  function submit(draft) {
    if (!S.file || !S.account || S.busy) return;
    S.busy = "upload"; S.progress = 0; S.note = null; S.error = null; S.render();
    upload(S.file).then(function (path) {
      S.busy = "save"; S.render();
      var body = { org_id: orgId(), account_id: S.account.id, storage_path: path, caption: S.caption.trim(), publish_mode: "reel", share_to_feed: S.feed, draft: draft };
      if (S.when) body.scheduled_at = new Date(S.when).toISOString();
      return S.request("/v1/social/publish", { method: "POST", body: body });
    }).then(function () {
      S.note = draft ? "Saved as a draft." : S.when ? "Scheduled." : "Queued. It goes out within about five minutes.";
      S.file = null; S.caption = ""; S.when = "";
      S.loaded = false; S.busy = null; load();
    }).catch(function (x) { S.busy = null; S.error = x; S.render(); });
  }

  function move(id, to) {
    S.request("/v1/social/publish/" + id + "/" + to, { method: "POST", body: { org_id: orgId() } })
      .then(function () { S.loaded = false; load(); })
      .catch(function (x) { S.error = x; S.render(); });
  }

  function bind(root) {
    if (!root) return;
    var f = root.querySelector("#igFile"), c = root.querySelector("#igCaption"), w = root.querySelector("#igWhen"), fd = root.querySelector("#igFeed");
    if (f) f.onchange = function () { S.file = f.files && f.files[0] || null; S.note = null; S.render(); };
    if (c) c.oninput = function () { S.caption = c.value; var n = root.querySelector("#igCount"); if (n) n.textContent = c.value.length + " / 2,200"; };
    if (w) w.onchange = function () { S.when = w.value; S.render(); };
    if (fd) fd.onchange = function () { S.feed = fd.checked; };
    var p = root.querySelector("[data-ig-post]"); if (p) p.onclick = function () { submit(false); };
    var d = root.querySelector("[data-ig-draft]"); if (d) d.onclick = function () { submit(true); };
    var r = root.querySelector("[data-ig-refresh]"); if (r) r.onclick = function () { S.loaded = false; load(); };
    root.querySelectorAll("[data-ig-approve]").forEach(function (b) { b.onclick = function () { b.disabled = true; move(b.getAttribute("data-ig-approve"), "approve"); }; });
    root.querySelectorAll("[data-ig-cancel]").forEach(function (b) { b.onclick = function () { b.disabled = true; move(b.getAttribute("data-ig-cancel"), "cancel"); }; });
  }

  window.CR.instagram = {
    init: function (o) { S.request = o.request; S.render = o.render; S.org = o.org; },
    render: render, bind: bind, load: load, state: S
  };
})();
