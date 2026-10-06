/* Action Network · Clips: paid music clipping for members.

   Discover a song's campaign → claim it → take the approved files and your
   tracking link → post a Reel → paste its link → the server reads the post
   from Instagram, checks it is yours and follows the rules, and pays on the
   views Instagram reports, never on a screenshot or a number you type.
   Earnings hold until the creator's keep-live and hold periods pass and the
   creator approves the clip, then become payable, then paid.

   Every write is a database function that checks the caller (clip_*), or a
   Worker route that reads the platform (/v1/clips/*). This file only shows
   what they return. */
(function () {
  "use strict";
  var K = { all: [], work: null, platforms: [], song: "", busy: false, msg: "", bad: false, assets: {}, open: null };
  function M() { return window.MCC_MNET; }
  function $(id) { return document.getElementById(id); }
  function esc(v) { return M() ? M().esc(v) : String(v == null ? "" : v); }
  function usd(c) { return "$" + (Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function n(v) { return Number(v || 0).toLocaleString("en-US"); }
  function day(t) { return t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; }
  function track(name, props) { if (window.MCC_TRACK) window.MCC_TRACK(name, props || {}); }
  function enabled(p) { var x = K.platforms.find(function (q) { return q.platform === p; }); return !!(x && x.enabled); }
  function label(p) { var x = K.platforms.find(function (q) { return q.platform === p; }); return x ? x.label : p; }
  function claimOf(id) { return K.work && (K.work.claims || []).find(function (c) { return c.mission_id === id; }) || null; }
  function trackingLink(url, code, platform) {
    if (!url || !code) return "";
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "utm_source=clip&utm_medium=" + encodeURIComponent(platform || "instagram") + "&utm_campaign=" + encodeURIComponent(code);
  }
  var STATUS = { submitted: "Checking on the platform", tracking: "Verified · counting views", held: "Under review", rejected: "Not accepted", removed: "Taken down", closed: "Finished" };

  try { K.song = new URLSearchParams(location.search).get("song") || ""; } catch (_) {}

  function load() {
    var root = $("mnClipsRoot"); if (!root || !M()) return Promise.resolve();
    return Promise.all([
      M().sbRpc("clip_campaigns_open", { p_song: K.song || null }),
      M().sbRpc("clip_my_work").catch(function () { return null; }),
      M().api("/v1/clips/platforms").catch(function () { return { platforms: [] }; })
    ]).then(function (out) {
      K.all = out[0] || []; K.work = out[1]; K.platforms = (out[2] && out[2].platforms) || [];
      render();
    }).catch(function (e) {
      root.innerHTML = '<div class="mn__empty">' + esc(/clip_campaigns_open|PGRST202/.test(e.message || "") ?
        "Clipping is not open yet." : (e.message || "Clipping could not load.")) + '</div>';
    });
  }

  function earnings() {
    var t = K.work && K.work.totals; if (!t) return "";
    return '<div class="mn__panel"><p class="mn__eyebrow">Your clipping pay</p>' +
      '<div class="mn__clipstats"><div><b>' + usd(t.held_cents) + '</b><small>held</small></div><div><b>' + usd(t.payable_cents) + '</b><small>payable</small></div><div><b>' + usd(t.paid_cents) + '</b><small>paid</small></div></div>' +
      ((K.work.payouts || []).length ? '<p class="mn__hint">Last payout ' + usd(K.work.payouts[0].amount_cents) + ' on ' + esc(day(K.work.payouts[0].recorded_at)) + '.</p>' : "") +
      '<p class="mn__hint">Held pay becomes payable once the clip has stayed up, the hold period has passed and the artist has approved it.</p></div>';
  }

  function accounts() {
    var list = (K.work && K.work.accounts) || [];
    var rows = list.map(function (a) {
      return '<li><b>' + esc(label(a.platform)) + ' @' + esc(a.handle) + '</b> · ' + (a.verified ? "verified" :
        'not verified yet. Put <code>' + esc(a.code) + '</code> in your bio, then <button class="mn__quiet" type="button" data-clip-verify="' + esc(a.account_id) + '">check now</button>') + '</li>';
    }).join("");
    var opts = K.platforms.map(function (p) { return '<option value="' + esc(p.platform) + '"' + (p.enabled ? "" : " disabled") + '>' + esc(p.label + (p.enabled ? "" : " (not yet)")) + '</option>'; }).join("");
    return '<div class="mn__panel"><p class="mn__eyebrow">Accounts you clip from</p>' + (rows ? '<ul class="mn__cliplist">' + rows + '</ul>' : '<p class="mn__hint">Add the account you post from. Pay only counts posts on accounts you have verified.</p>') +
      '<div class="mn__cliprow"><select class="mn__input" id="mnClipPlatform" aria-label="Platform">' + opts + '</select>' +
      '<input class="mn__input" id="mnClipHandle" placeholder="@yourhandle" autocomplete="off" aria-label="Handle">' +
      '<button class="mn__primary" type="button" data-clip-add-account>Add</button></div>' +
      '<p class="mn__hint">YouTube and TikTok are not connected yet, so clips there cannot be verified or paid.</p></div>';
  }

  function campaignCard(c) {
    var claim = claimOf(c.mission_id);
    var song = c.song ? esc(c.song.title) + ' · ' + esc(c.song.artist) : (c.track ? esc(c.track.title) : "");
    var terms = usd(c.base_cpm_cents) + ' per 1,000 verified views after ' + n(c.min_views) + ' views' +
      (c.per_clip_cap_cents ? ' · up to ' + usd(c.per_clip_cap_cents) + ' a clip' : "") +
      (c.per_clipper_cap_cents ? ' · up to ' + usd(c.per_clipper_cap_cents) + ' a clipper' : "") +
      (c.bonus_account_cents ? ' · ' + usd(c.bonus_account_cents) + ' per new fan account' : "") +
      (c.bonus_listen_cents ? ' · ' + usd(c.bonus_listen_cents) + ' per full listen' : "");
    var plats = (c.platforms || []).map(label).join(", ");
    var body = '<article class="mn__panel mn__clipcard"><p class="mn__eyebrow">Clip &amp; get paid' + (c.creator ? ' · ' + esc(c.creator.artist_name) : "") + '</p>' +
      '<h3>' + esc(c.title) + '</h3><p class="mn__clipsong">' + song + '</p><p><b>' + terms + '</b></p>' +
      '<p class="mn__hint">' + esc(plats) + ' · ' + usd(c.budget_left_cents) + ' left · ' + n(c.clippers) + ' clippers' + (c.ends_at ? ' · post by ' + esc(day(c.ends_at)) : "") + '</p>' +
      (c.rules ? '<p>' + esc(c.rules) + '</p>' : "") +
      ((c.required_tags || []).length ? '<p class="mn__hint">Your caption must include: ' + esc(c.required_tags.join(" ")) + '</p>' : "") +
      '<p class="mn__hint">Clips must stay up ' + n(c.keep_live_days) + ' days. Pay holds ' + n(c.hold_days) + ' days' + (c.approval_mode === "creator" ? " and the artist approves each clip" : "") + '.</p>';
    if (!claim) return body + '<button class="mn__primary" type="button" data-clip-claim="' + esc(c.mission_id) + '">Claim this campaign</button></article>';
    var link = trackingLink(claim.link || (c.song && c.song.url), claim.ref_code, (c.platforms || [])[0]);
    var assets = K.assets[c.mission_id];
    var files = assets ? (assets.assets || []).map(function (a) {
      return a.url ? '<li><a href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer" download>' + esc(a.label) + '</a></li>' :
        '<li>' + esc(a.label) + (a.start_ms != null ? ' · ' + Math.round(a.start_ms / 1000) + '–' + Math.round(a.end_ms / 1000) + 's' : "") + '</li>';
    }).join("") : "";
    var moments = (c.moments || []).map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>'; }).join("");
    var plat = (c.platforms || []).filter(enabled).map(function (p) { return '<option value="' + esc(p) + '">' + esc(label(p)) + '</option>'; }).join("");
    return body + '<div class="mn__clipclaimed"><p><b>Your link</b> for your bio or comments, so fans you bring are counted:</p>' +
      '<input class="mn__input" readonly value="' + esc(link) + '" aria-label="Your tracking link" onclick="this.select()">' +
      (assets ? '<ul class="mn__cliplist">' + (files || '<li>No files for this campaign.</li>') + '</ul><p class="mn__hint">These links expire in 15 minutes.</p>' :
        '<button class="mn__quiet" type="button" data-clip-assets="' + esc(c.mission_id) + '">Get the approved files</button>') +
      '<div class="mn__cliprow"><select class="mn__input" id="mnClipSubPlat-' + esc(c.mission_id) + '" aria-label="Platform">' + plat + '</select>' +
      '<input class="mn__input" id="mnClipUrl-' + esc(c.mission_id) + '" type="url" inputmode="url" placeholder="https://www.instagram.com/reel/…" aria-label="Link to your posted clip">' +
      (moments ? '<select class="mn__input" id="mnClipMoment-' + esc(c.mission_id) + '" aria-label="Song moment"><option value="">Which part of the song?</option>' + moments + '</select>' : "") +
      '<button class="mn__primary" type="button" data-clip-submit="' + esc(c.mission_id) + '">Submit clip</button></div></div></article>';
  }

  function myClips() {
    var claims = (K.work && K.work.claims) || [];
    if (!claims.length) return "";
    return '<div class="mn__panel"><p class="mn__eyebrow">Your clips</p>' + claims.map(function (c) {
      var subs = (c.submissions || []).map(function (s) {
        var why = s.rejection_reason || s.waiting_reason || s.hold_reason || "";
        return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(label(s.platform)) + ' clip</a> · ' + esc(STATUS[s.status] || s.status) +
          (s.status === "tracking" || s.status === "closed" || s.status === "held" ? ' · ' + n(s.verified_views) + ' views · ' + usd(s.earned_view_cents) : "") +
          (s.review_state === "pending" && s.status === "tracking" ? ' · waiting for the artist' : "") + (why ? '<br><small>' + esc(why) + '</small>' : "") + '</li>';
      }).join("");
      var e = c.earnings || {};
      return '<h4>' + esc(c.title) + '</h4><p class="mn__hint">' + usd(e.held_cents) + ' held · ' + usd(e.payable_cents) + ' payable · ' + usd(e.paid_cents) + ' paid</p>' +
        (subs ? '<ul class="mn__cliplist">' + subs + '</ul>' : '<p class="mn__hint">No clips submitted yet.</p>');
    }).join("") + '</div>';
  }

  function render() {
    var root = $("mnClipsRoot"); if (!root) return;
    var head = '<div class="mn__section-head"><div><p class="mn__eyebrow">Music · paid clipping</p><h2 id="mnClipsTitle">Clip songs. Get paid on real views.</h2></div></div>' +
      '<p class="mn__lede">Claim a campaign, post a Reel with the song, paste its link. We read the views from Instagram itself, so screenshots never count.</p>' +
      (K.msg ? '<p class="mn__hint' + (K.bad ? ' mn__danger' : '') + '" role="status">' + esc(K.msg) + '</p>' : "") +
      (K.song ? '<p class="mn__hint">Showing campaigns for one song. <button class="mn__quiet" type="button" data-clip-all>See all</button></p>' : "");
    var cards = K.all.length ? K.all.map(campaignCard).join("") : '<div class="mn__empty">No clipping campaigns are open right now.</div>';
    root.innerHTML = head + earnings() + cards + myClips() + accounts();
  }

  function act(btn, fn, ok) {
    if (K.busy) return; K.busy = true; K.msg = ""; K.bad = false; if (btn) btn.disabled = true;
    Promise.resolve().then(fn).then(function (r) { K.msg = typeof ok === "function" ? ok(r) : ok; return load(); })
      .catch(function (e) { K.msg = e.message || "That did not work."; K.bad = true; render(); })
      .then(function () { K.busy = false; });
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-clip-claim],[data-clip-submit],[data-clip-assets],[data-clip-add-account],[data-clip-verify],[data-clip-all]") : null;
    if (!t || !$("mnClipsRoot") || !$("mnClipsRoot").contains(t)) return;
    var id;
    if ((id = t.getAttribute("data-clip-claim"))) {
      act(t, function () { return M().sbRpc("clip_campaign_claim", { p_mission: id }); }, "Claimed. Grab the files and your link below.");
      track("clip_claim", { mission_id: id });
    } else if ((id = t.getAttribute("data-clip-assets"))) {
      act(t, function () { return M().api("/v1/clips/campaigns/" + encodeURIComponent(id) + "/assets").then(function (r) { K.assets[id] = r; }); }, "");
    } else if ((id = t.getAttribute("data-clip-submit"))) {
      var url = ($("mnClipUrl-" + id) || {}).value || "", plat = ($("mnClipSubPlat-" + id) || {}).value || "instagram", mom = ($("mnClipMoment-" + id) || {}).value || null;
      if (!/^https:\/\//i.test(url.trim())) { K.msg = "Paste the https link to your posted clip."; K.bad = true; render(); return; }
      act(t, function () { return M().sbRpc("clip_submit", { p_mission: id, p_platform: plat, p_url: url.trim(), p_moment: mom }); },
        "Submitted. We will read it from the platform within a few minutes.");
      track("clip_submit", { mission_id: id, platform: plat });
    } else if (t.hasAttribute("data-clip-add-account")) {
      var p = ($("mnClipPlatform") || {}).value || "instagram", h = ($("mnClipHandle") || {}).value || "";
      act(t, function () { return M().sbRpc("clip_account_register", { p_platform: p, p_handle: h }); },
        function (r) { return r && r.code ? "Put " + r.code + " in your bio, then tap check now." : "Added."; });
    } else if ((id = t.getAttribute("data-clip-verify"))) {
      act(t, function () { return M().api("/v1/clips/accounts/" + encodeURIComponent(id) + "/verify", { method: "POST", body: {} }); },
        function (r) { return r && r.verified ? "Verified." : (r && r.reason) || "Not verified yet."; });
    } else if (t.hasAttribute("data-clip-all")) {
      K.song = ""; load();
    }
  });

  window.MCC_CLIPS = { load: load, state: K };
})();
