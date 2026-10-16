/* THE MEMBER DESK, over the World globe (mnet.html).

   Owner, 2026-10-15: "The policy link that separates everything, that's not
   even an experience. I wanted it layered on top of this (the globe
   experience), allowing the user to have a DESK, which would be kind of like
   their analytics. A user, business user, creator user."

   A Desk tab joins the bottom app bar on the World (the bar never leaves:
   the desk opens ABOVE it, as a bottom sheet on a phone and a side panel
   from 64rem). What is inside follows what the member can do (rules:
   js/member-desk-core.js):
     everyone signed in  profile summary (and the profile edit gate:
                         js/profile-edit-gate.js), missions in progress and
                         verified (action_record), alerts (the bell's own feed)
     creator             their own audience: the same Worker measurement as
                         the creator analytics (/v1/analytics/my-creator:
                         aggregate, countries under five views folded away,
                         no listener identities, no IPs)
     business            their workspace (/v1/creator-billing/entitlement)
                         and the analytics sites they own (their RLS)
     fellow              the policy memo desk (js/policy-fellowship-desk.js),
                         moved here from action-policy.html
     everyone            the public policy registry (js/action-policy.js)
   Every number comes from an existing endpoint under its existing
   permissions; nothing is computed or invented here.

   ?desk=1 or ?desk=<section> opens it (action-policy.html sends inbound
   links to ?desk=policy). Closing it takes the parameter off the address. */
(function () {
  "use strict";
  var C = window.MCC_DESK_CORE;
  if (!C || window.HU_DESK) return;
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var $ = function (id) { return document.getElementById(id); };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function token() {
    try { if (window.MCC && MCC.refreshIfNeeded) return MCC.refreshIfNeeded().then(function (s) { return s && s.access_token || null; }).catch(function () { return null; }); } catch (e) { /* fall through */ }
    return Promise.resolve(null);
  }
  /* The policy modules expect the session helper js/backend.js provides on
     other pages; on the World the session is mcc-auth.js's, so the desk
     hands them the same shape over it. */
  if (!window.MCC_SUPA) window.MCC_SUPA = {
    url: SB_URL, key: SB_KEY,
    token: function () { return token().then(function (t) { if (!t) throw new Error("signed out"); return t; }); },
    uid: function () { try { var s = MCC.session && MCC.session(); var p = s && s.access_token && JSON.parse(atob(s.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p && p.sub || null; } catch (e) { return null; } },
    email: function () { return null; }
  };
  function rest(path, init) {
    return token().then(function (t) {
      init = init || {};
      return fetch(SB_URL + "/rest/v1/" + path, { method: init.method || "GET", headers: { apikey: SB_KEY, authorization: "Bearer " + (t || SB_KEY), "content-type": "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined });
    }).then(function (r) { return r.text().then(function (txt) { var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; } if (!r.ok) { var err = new Error((j && (j.message || j.hint)) || ("Request failed (" + r.status + ")")); err.status = r.status; err.code = j && j.code; throw err; } return j; }); });
  }
  function rpc(name, args) { return rest("rpc/" + name, { method: "POST", body: args || {} }); }
  function api(path) {
    return token().then(function (t) {
      if (!t) throw Object.assign(new Error("Not signed in"), { status: 401 });
      return fetch("https://api.mccluster.org" + path, { headers: { authorization: "Bearer " + t } });
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || ("HTTP " + r.status)), { status: r.status }); return j; }); });
  }
  function missing(err) { return err && (err.status === 404 || /PGRST20[12]|does not exist|Could not find/i.test(String(err.message || "") + String(err.code || ""))); }
  function mnet() { return window.MCC_MNET || null; }
  function identity() { var m = mnet(); try { return m && m.identity ? m.identity() || {} : {}; } catch (e) { return {}; } }
  function profile() { var m = mnet(); try { return m && m.profile ? m.profile() || {} : {}; } catch (e) { return {}; } }

  var S = { open: false, section: null, caps: null, data: {}, loading: false, policyLoaded: false, seq: 0 };

  /* ---------- the Desk tab on the bar ---------- */
  var DESK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5h18"/><path d="M5 9.5V19M19 9.5V19"/><path d="M8.5 9.5V6.8a1.3 1.3 0 0 1 1.3-1.3h4.4a1.3 1.3 0 0 1 1.3 1.3v2.7"/><path d="M5 14h6"/></svg>';
  function ensureTab() {
    var dock = document.querySelector(".appbar");
    if (!dock) return null;
    var tab = dock.querySelector("[data-hu-desk]");
    if (!tab) {
      tab = document.createElement("button");
      tab.type = "button";
      tab.className = "appbar__tab appbar__desk";
      tab.setAttribute("data-hu-desk", "");
      tab.setAttribute("aria-controls", "huDesk");
      tab.innerHTML = DESK_SVG + "<span>Desk</span>";
      var world = dock.querySelector('[data-appnav="world"]');
      if (world && world.nextSibling) dock.insertBefore(tab, world.nextSibling); else dock.appendChild(tab);
    }
    tab.setAttribute("aria-expanded", S.open ? "true" : "false");
    tab.setAttribute("aria-label", S.open ? "Close your desk" : "Open your desk");
    tab.classList.toggle("is-active", S.open);
    return tab;
  }
  /* the bar redraws itself (a held tab opens a wing, then folds back from a
     snapshot), so the tab is put back whenever it goes missing */
  function watchBar() {
    var dock = document.querySelector(".appbar");
    if (!dock || typeof MutationObserver !== "function") return;
    new MutationObserver(function () { if (!dock.querySelector("[data-hu-desk]") && !dock.classList.contains("appbar--morph")) ensureTab(); })
      .observe(dock, { childList: true });
  }

  /* ---------- the sheet ---------- */
  function ensureSheet() {
    var el = $("huDesk");
    if (el) return el;
    el = document.createElement("aside");
    el.id = "huDesk";
    el.className = "hu-desk";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-labelledby", "huDeskTitle");
    el.hidden = true;
    el.innerHTML =
      '<div class="hu-desk__grip" aria-hidden="true"></div>' +
      '<header class="hu-desk__head"><div><p class="hu-desk__k">Get Your Hu Up!</p><h2 id="huDeskTitle">Your desk</h2></div>' +
      '<button type="button" class="hu-desk__close" data-hu-desk-close aria-label="Close your desk">✕</button></header>' +
      '<nav class="hu-desk__tabs" id="huDeskTabs" aria-label="Desk sections"></nav>' +
      '<div class="hu-desk__body" id="huDeskBody"></div>';
    document.body.appendChild(el);
    return el;
  }

  function signedIn() {
    try { var s = window.MCC && MCC.session && MCC.session(); return !!(s && s.access_token); } catch (e) { return false; }
  }

  /* what the member can do, from the services that already know */
  function loadCaps() {
    var seq = ++S.seq;
    if (!signedIn()) { S.caps = C.capabilities({ signedIn: false }); return Promise.resolve(S.caps); }
    return waitForIdentity(3000).then(function (id) {
    if (seq !== S.seq) return S.caps;
    var creator = id.m_uid ? rest("music_creator_profiles?m_uid=eq." + encodeURIComponent(id.m_uid) + "&select=handle,artist_name&limit=1").catch(function () { return []; }) : Promise.resolve([]);
    var ent = api("/v1/creator-billing/entitlement").catch(function () { return null; });
    var sites = rest("analytics_sites?select=id,name,status&order=created_at.desc&limit=20").catch(function () { return []; });
    var ladder = rpc("policy_ladder_status").catch(function (e) { return missing(e) ? { closed: true } : null; });
    return Promise.all([creator, ent, sites, ladder]).then(function (o) {
      if (seq !== S.seq) return S.caps;
      S.data.creatorRow = (o[0] || [])[0] || null;
      S.data.entitlement = o[1];
      S.data.sites = o[2] || [];
      S.data.ladder = o[3];
      S.caps = C.capabilities({ signedIn: true, creator: !!S.data.creatorRow, entitlement: o[1], sites: S.data.sites.length, ladder: o[3] || {} });
      return S.caps;
    });
    });
  }
  /* a desk opened from a link can beat the World's own boot; give it a moment to know who you are */
  function waitForIdentity(ms) {
    var until = Date.now() + ms;
    return new Promise(function (done) {
      (function tick() { var id = identity(); if (id.m_uid || Date.now() > until) done(id); else setTimeout(tick, 150); })();
    });
  }

  function paintTabs() {
    var list = C.sections(S.caps || {});
    if (list.indexOf(S.section) < 0) S.section = list[0];
    $("huDeskTabs").innerHTML = list.map(function (k) {
      var label = k === "policy" && S.caps && S.caps.fellow ? "Policy memos" : C.SECTIONS[k].label;
      return '<button type="button" class="hu-desk__tab' + (k === S.section ? " is-on" : "") + '" data-hu-desk-section="' + k + '" aria-pressed="' + (k === S.section) + '">' + esc(label) + "</button>";
    }).join("");
  }

  function note(t, bad) { return '<p class="hu-desk__note' + (bad ? " is-bad" : "") + '" role="' + (bad ? "alert" : "status") + '">' + esc(t) + "</p>"; }
  function stat(n, label) { return '<div class="hu-desk__stat"><strong>' + esc(n) + "</strong><span>" + esc(label) + "</span></div>"; }

  /* ---------- sections ---------- */
  var PAINT = {
    welcome: function (body) {
      body.innerHTML = '<section class="hu-desk__card"><h3>Your desk</h3><p>Your profile, your missions, your alerts, and your own numbers if you create or run a business. Policy work lives here too.</p>' +
        '<button type="button" class="hu-desk__btn hu-desk__btn--primary" data-hu-desk-signin>Sign in</button></section>';
    },
    profile: function (body) {
      var id = identity(), p = profile();
      var name = p.display_name || id.mccluster_id || "Your profile";
      body.innerHTML = '<section class="hu-desk__card hu-desk__who"><span class="hu-desk__face" aria-hidden="true">' + esc(String(name).trim().charAt(0).toUpperCase() || "M") + "</span>" +
        "<div><h3>" + esc(name) + "</h3>" + (id.mccluster_id ? '<p class="hu-desk__meta">@' + esc(id.mccluster_id) + "</p>" : "") +
        (p.headline ? "<p>" + esc(p.headline) + "</p>" : "") + "</div>" +
        '<div class="hu-desk__row"><button type="button" class="hu-desk__btn" data-hu-desk-view="profile">View profile</button>' +
        '<button type="button" class="hu-desk__btn" data-hu-desk-edit>Edit profile</button></div></section>' +
        '<section class="hu-desk__card" id="huDeskEditGate" aria-live="polite"><h3>Locked details</h3>' + note("Loading…") + "</section>";
      if (window.HU_EDIT_GATE) window.HU_EDIT_GATE.mount($("huDeskEditGate"));
      else $("huDeskEditGate").innerHTML = "<h3>Locked details</h3>" + note("The profile edit module did not load.", true);
    },
    missions: function (body) {
      body.innerHTML = note("Loading your missions…");
      (S.data.record ? Promise.resolve(S.data.record) : rpc("action_record").then(function (r) { S.data.record = r || {}; return S.data.record; }))
        .then(function (r) {
          var b = C.missionBuckets(r);
          var row = function (m) { return '<li><a href="mnet.html?mission=' + encodeURIComponent(m.mission_id) + '">' + esc(m.title) + "</a> <small>" + esc(String(m.status).replace(/_/g, " ")) + "</small></li>"; };
          body.innerHTML = '<section class="hu-desk__card"><div class="hu-desk__stats">' + stat(b.inProgress.length, "In progress") + stat(b.verified.length, "Verified") + stat(Number(r.points) || 0, "Points") + "</div>" +
            "<p class=\"hu-desk__meta\">A mission counts as verified only when an admin approves its proof.</p></section>" +
            '<section class="hu-desk__card"><h3>In progress</h3>' + (b.inProgress.length ? '<ul class="hu-desk__list">' + b.inProgress.map(row).join("") + "</ul>" : "<p>Nothing in progress. Pick a pin on the globe.</p>") + "</section>" +
            '<section class="hu-desk__card"><h3>Verified</h3>' + (b.verified.length ? '<ul class="hu-desk__list">' + b.verified.map(row).join("") + "</ul>" : "<p>None verified yet.</p>") + "</section>";
        }).catch(function () { body.innerHTML = note("Your missions could not load right now.", true); });
    },
    notifications: function (body) {
      body.innerHTML = note("Loading your alerts…");
      api("/v1/mnet/notifications").then(function (j) {
        var list = (j && j.notifications) || [];
        body.innerHTML = '<section class="hu-desk__card"><h3>Alerts</h3>' + (list.length ? '<ul class="hu-desk__list">' + list.slice(0, 12).map(function (n) {
          return "<li" + (n.read_at ? "" : ' class="is-unread"') + ">" + esc(n.body || n.type) + ' <small>' + esc(n.created_at ? new Date(n.created_at).toLocaleString() : "") + "</small></li>";
        }).join("") + "</ul>" : "<p>No alerts.</p>") + '<button type="button" class="hu-desk__btn" data-hu-desk-bell>Open all alerts</button></section>';
      }).catch(function () { body.innerHTML = note("Your alerts could not load right now.", true); });
    },
    creator: function (body) {
      body.innerHTML = note("Loading your audience…");
      api("/v1/analytics/my-creator").then(function (d) {
        if (!d || d.creator === false) { body.innerHTML = note("Create your artist profile to see your audience."); return; }
        var t = d.tracks || [], pt = d.page_traffic || {}, a = d.audience || {};
        var sum = function (k) { return t.reduce(function (n, x) { return n + (Number(x[k]) || 0); }, 0); };
        var countries = (a.countries || []).slice(0, 8);
        var more = (Number(a.elsewhere_views) || 0) + (Number(a.unknown_views) || 0);
        body.innerHTML = '<section class="hu-desk__card"><h3>Your audience' + (S.data.creatorRow && S.data.creatorRow.artist_name ? " · " + esc(S.data.creatorRow.artist_name) : "") + '</h3><p class="hu-desk__meta">Last 30 days · recorded first-party activity</p>' +
          '<div class="hu-desk__stats">' + stat(Number(pt.views) || 0, "Page views") + stat(Number(pt.approximate_sessions) || 0, "Approx. visits") + stat(t.length, "Tracks") +
          stat(sum("plays"), "Observed plays") + stat(sum("completions"), "Completions") + stat(sum("shares"), "Shares") + "</div></section>" +
          '<section class="hu-desk__card"><h3>Where, by country</h3>' + (countries.length ? '<ul class="hu-desk__list">' + countries.map(function (c) { return "<li>" + esc(c.country) + " <small>" + esc(c.views) + " views</small></li>"; }).join("") + "</ul>" : "<p>No country has " + esc(a.min_views || 5) + " or more views yet.</p>") +
          (more ? '<p class="hu-desk__meta">' + esc(more) + " more from countries under " + esc(a.min_views || 5) + " views, or unknown.</p>" : "") +
          '<p class="hu-desk__meta">Country only, and only where at least ' + esc(a.min_views || 5) + " views were recorded. Never a listener's identity or address. The audience switch on the globe draws the same numbers.</p></section>" +
          '<p class="hu-desk__meta">' + esc(d.disclaimer || "Only recorded events are counted.") + "</p>";
      }).catch(function () { body.innerHTML = note("Your audience could not load right now.", true); });
    },
    business: function (body) {
      var e = S.data.entitlement, sites = S.data.sites || [];
      var ws = e && e.paid ? (e.workspaces || []).map(function (w) { return "<li>Workspace active" + (w.current_period_end ? " until " + esc(new Date(w.current_period_end).toLocaleDateString()) : "") + (w.cancel_at_period_end ? " · ends then" : "") + "</li>"; }).join("") : "";
      body.innerHTML = '<section class="hu-desk__card"><h3>Your business</h3>' + (ws ? '<ul class="hu-desk__list">' + ws + "</ul>" : "<p>No active business workspace.</p>") + "</section>" +
        '<section class="hu-desk__card"><h3>Your sites</h3>' + (sites.length ? '<ul class="hu-desk__list">' + sites.map(function (s) { return "<li>" + esc(s.name) + " <small>" + esc(s.status) + "</small></li>"; }).join("") + "</ul>" : "<p>No analytics sites yet.</p>") +
        '<a class="hu-desk__btn" href="analytics.html">Open site analytics</a></section>';
    },
    policy: function (body) {
      var mode = C.policyMode(S.caps || {});
      if (!$("huDeskPolicy")) {
        var holder = document.createElement("div");
        holder.id = "huDeskPolicy";
        holder.className = "hu-desk__policy";
        holder.innerHTML = '<section id="ladder" class="hu-desk__card" aria-live="polite" hidden></section>' +
          '<section class="hu-desk__card"><h3>Public policy</h3><div class="hu-desk__row hu-desk__filters"><label>Region <select id="region"><option value="">All U.S. jurisdictions</option></select></label>' +
          '<label>Status <select id="status"><option value="">All statuses</option><option value="introduced">Introduced</option><option value="in_committee">In committee</option><option value="passed">Passed</option><option value="enacted">Enacted</option></select></label></div>' +
          '<h4>Legislation</h4><div id="bills" aria-live="polite">Loading legislation…</div><h4>Verified officials</h4><div id="officials">Loading…</div>' +
          '<h4>Funded memo research</h4><div id="bounties">Loading…</div><p class="hu-desk__meta">Verify every bill against its official record. Research bounties are not endorsements.</p></section>';
        S.policyHolder = holder;
      }
      body.innerHTML = "";
      body.appendChild(S.policyHolder);
      S.policyHolder.setAttribute("data-mode", mode);
      loadPolicy();
    }
  };

  /* the policy modules run once, inside the desk (they find #ladder, #bills… by id) */
  function script(src) {
    return new Promise(function (ok, bad) { var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error("could not load " + src)); }; document.body.appendChild(s); });
  }
  function loadPolicy() {
    if (S.policyLoaded) return;
    S.policyLoaded = true;
    var want = new URLSearchParams(location.search);
    ["region", "status"].forEach(function (k) {
      var v = want.get(k), sel = $(k);
      if (!v || !sel) return;
      var pick = function () { if (sel.querySelector('option[value="' + v.replace(/"/g, "") + '"]') && sel.value !== v) { sel.value = v; sel.dispatchEvent(new Event("change")); return true; } return false; };
      if (!pick() && typeof MutationObserver === "function") { var mo = new MutationObserver(function () { if (pick()) mo.disconnect(); }); mo.observe(sel, { childList: true }); }
    });
    var chain = window.MCC_POLICY_LADDER ? Promise.resolve() : script("js/policy-fellowship-ladder.js");
    chain.then(function () { return script("js/policy-fellowship-desk.js"); })
      .then(function () { return script("js/action-policy.js"); })
      .catch(function () { var b = $("bills"); if (b) b.textContent = "Policy could not load right now."; });
  }

  function stopCapture() { try { if (window.HU_EDIT_GATE && HU_EDIT_GATE.stop) HU_EDIT_GATE.stop(); } catch (e) { /* nothing recording */ } }
  function paintBody() {
    var body = $("huDeskBody");
    stopCapture();
    if (S.policyHolder && S.policyHolder.parentNode === body) body.removeChild(S.policyHolder);
    (PAINT[S.section] || PAINT.welcome)(body);
    body.scrollTop = 0;
  }

  function open(section) {
    var el = ensureSheet();
    S.open = true;
    if (section && C.SECTIONS[section]) S.section = section;
    el.hidden = false;
    document.documentElement.classList.add("hu-desk-on");
    ensureTab();
    $("huDeskBody").innerHTML = note("Opening your desk…");
    paintTabs();
    loadCaps().then(function () { if (!S.open) return; paintTabs(); paintBody(); });
    setParam(S.section || "1");
    try { if (window.MCC_TRACK) window.MCC_TRACK("desk_open", { section: S.section || "" }); } catch (e) { /* analytics never breaks the desk */ }
  }
  function close() {
    var el = $("huDesk");
    S.open = false;
    stopCapture();
    if (el) el.hidden = true;
    document.documentElement.classList.remove("hu-desk-on");
    ensureTab();
    setParam(null);
    var tab = document.querySelector("[data-hu-desk]");
    if (tab) try { tab.focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
  }
  function setParam(v) {
    try {
      var u = new URL(location.href);
      if (v) u.searchParams.set("desk", v); else u.searchParams.delete("desk");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    } catch (e) { /* the address is a courtesy */ }
  }

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var tab = t.closest("[data-hu-desk]");
    if (tab) { e.preventDefault(); if (S.open) close(); else open(); return; }
    var opener = t.closest("[data-hu-desk-open]");
    if (opener) { e.preventDefault(); open(opener.getAttribute("data-hu-desk-open") || null); return; }
    if (!S.open || !t.closest("#huDesk")) return;
    if (t.closest("[data-hu-desk-close]")) { close(); return; }
    var sec = t.closest("[data-hu-desk-section]");
    if (sec) { S.section = sec.getAttribute("data-hu-desk-section"); setParam(S.section); paintTabs(); paintBody(); return; }
    if (t.closest("[data-hu-desk-signin]")) { var g = $("mnGuestSignIn"); close(); if (g) g.click(); else location.href = "login.html"; return; }
    var view = t.closest("[data-hu-desk-view]");
    if (view && mnet() && mnet().setView) { close(); mnet().setView(view.getAttribute("data-hu-desk-view")); return; }
    if (t.closest("[data-hu-desk-edit]")) { var m = mnet(); close(); if (m && m.editProfile) m.editProfile(); return; }
    if (t.closest("[data-hu-desk-bell]")) { var bell = $("mnBell"); close(); if (bell) bell.click(); return; }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && S.open) close(); });
  window.addEventListener("mcc:auth-changed", function () { S.caps = null; S.data = {}; S.policyLoaded = false; S.policyHolder = null; var p = $("huDeskPolicy"); if (p && p.parentNode) p.parentNode.removeChild(p); if (S.open) open(S.section); });

  function boot() {
    ensureTab();
    watchBar();
    var want = C.deskParam(location.search);
    if (want) open(want === "open" ? null : want);
  }
  window.HU_DESK = { open: open, close: close, isOpen: function () { return S.open; }, state: S };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
