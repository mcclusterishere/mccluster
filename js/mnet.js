/* MNET — consumer social surface for the canonical McCluster Network. */
(function () {
  "use strict";

  var APP = "mccluster-web";
  /* THE WORLD IS THE SOCIAL FEED (owner, 2026-10-20: "open missions belong in missions not inside the newsfeed"; "the
     transport and the missions feature will be taken off"). While hu-social-only is on <html> (mnet.html) the feed carries
     no mission card, list or rail, search finds no missions, and every way into Missions lands on the feed. */
  var MISSIONS_OFF = document.documentElement.classList.contains("hu-social-only");
  var state = {
    user: null,
    boot: null,
    feed: [],
    nextBefore: null,
    /* the World's news (GET /v1/world/news): the page read so far, and its cursor (undefined: not read yet; null: no more) */
    news: [],
    newsBefore: undefined,
    newsCommentsAvailable: false,
    newsCommentsCapabilityAsked: false,
    newsSeq: 0,
    loadingFeed: false,
    placeScope: { enabled:false, country:null, home:null, posts:[], news:[], lives:[], postBefore:null, newsBefore:null,
      loaded:false, error:'', seq:0, working:false },
    threadPost: null,
    currentView: "feed",
    mediaAssets: [],
    mediaCache: {},
    conversations: [],
    currentConversation: null,
    pollTimer: null,
    actionOffers: {},
    /* the globe in the World tab: which missions have a public pin, and
       the one the member picked on the Earth (it narrows the feed) */
    world: { pins: {}, focus: null, fromFeed: "", missions: {}, latest: null, stats: {}, query: "" },
    /* a signed-out visitor on the World screen: public feed, no actions */
    guest: false
  };
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function setStatus(node, text, kind) {
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", kind === "error");
    node.classList.toggle("is-ok", kind === "ok");
  }
  /* One telemetry seam for the whole Equity Uprise. Product writes remain
     authoritative in the database; these events describe the journey around
     them so Control can answer which surfaces actually move people to act. */
  function track(name, data) {
    try { if (window.MCC_TRACK) window.MCC_TRACK(name, Object.assign({ surface:"action_network" }, data || {})); } catch (e) {}
  }
  function initials(name) {
    var parts = String(name || "M").trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map(function (p) { return p.charAt(0); }).join("") || "M").toUpperCase();
  }
  function safeHttpUrl(value) {
    /* an empty value resolves against the origin to the site's home page,
       which every member without a photo then wore as a broken image */
    if (value == null || !String(value).trim()) return "";
    try {
      var u = new URL(String(value), location.origin);
      return /^(https?:)$/.test(u.protocol) ? u.href : "";
    } catch (e) { return ""; }
  }
  /* Line icons for the post actions, drawn in currentColor so the active
     state is a colour change, not a second asset. */
  var ICON = {
    fund: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6.5" width="19" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/></svg>',
    comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.8h11v16.4l-5.5-3.9-5.5 3.9z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9.5 7V4.8h5V7M7 7l.8 12.2h8.4L17 7"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5l6 6-6 6M20 11H9a5 5 0 0 0-5 5v2"/></svg>'
  };
  /* Every member gets a stable ring colour from their handle: abstract
     colour that tells people apart at a glance, never a mark. */
  function hueOf(text) {
    var h = 0, t = String(text || "");
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
    return h;
  }
  function timeAgo(iso) {
    var d = new Date(iso), ms = Date.now() - d.getTime();
    if (!Number.isFinite(ms)) return "";
    var sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return "now";
    var min = Math.floor(sec / 60); if (min < 60) return min + "m";
    var hr = Math.floor(min / 60); if (hr < 24) return hr + "h";
    var day = Math.floor(hr / 24); if (day < 7) return day + "d";
    return d.toLocaleDateString(undefined, { month:"short", day:"numeric", year:d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }
  function parse(res) {
    return res.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!res.ok) {
        var msg = data && (data.error || data.message || data.msg);
        throw Object.assign(new Error(msg || ("Request failed (" + res.status + ")")), { status:res.status, data:data });
      }
      return data;
    });
  }
  function api(path, init) {
    return window.MCC.api(path, init).then(parse);
  }
  function profile() { return state.boot && state.boot.profile || {}; }
  function identity() { return state.boot && state.boot.identity || {}; }

  function setAvatar(img, fallback, url, name) {
    var safe = safeHttpUrl(url);
    if (img) {
      if (safe) {
        img.src = safe;
        img.hidden = false;
        img.onerror = function () { img.hidden = true; };
      } else img.hidden = true;
    }
    if (fallback) fallback.textContent = initials(name);
  }

  function paintFrontPage(p, id, name) {
    var card = $("mnFrontPage"), frame = $("mnFrontPageFrame"), open = $("mnFrontPageOpen");
    if (!card || !frame || !open) return;
    var site = safeHttpUrl(p.front_page_url || p.website_url);
    if (!site) { card.hidden = true; frame.removeAttribute("src"); return; }
    card.hidden = false;
    $("mnFrontPageTitle").textContent = (p.display_name || name || id.mccluster_id || "Member") + " · front page";
    open.href = site;
    if (frame.getAttribute("src") !== site) frame.src = site;
  }

  /* THE NEWSROOM: only the house owner (mnet_is_admin, the database's own definition) is offered it; the Worker checks
     again on every post (platform-api.js), so this only decides what is shown. It belongs to the account signed in now:
     another account, or none, hides it and asks again. */
  var newsroomFor = null;
  function paintNewsroom() {
    var row = $("mnNewsroomRow");
    if (!row) return;
    var who = !state.guest && state.user && state.user.id || null;
    if (who === newsroomFor) return;
    newsroomFor = who;
    row.hidden = true;
    if ($("mnNewsroom")) $("mnNewsroom").checked = false;
    if (!who) return;
    sbRpc("mnet_is_admin").then(function (yes) { if (newsroomFor === who) row.hidden = yes !== true; }).catch(function () {});
  }
  function paintSelf() {
    paintNewsroom();
    var p = profile(), id = identity(), name = p.display_name || (state.user && (state.user.user_metadata && (state.user.user_metadata.name || state.user.user_metadata.full_name))) || state.user && state.user.email || "M";
    $("mnMe").hidden = false;
    setAvatar($("mnAvatar"), $("mnAvatarFallback"), p.avatar_url, name);
    $("mnComposerAvatar").textContent = initials(name);
    var avatar = safeHttpUrl(p.avatar_url);
    if (avatar) {
      $("mnComposerAvatar").style.backgroundImage = "url(" + JSON.stringify(avatar) + ")";
      $("mnComposerAvatar").style.backgroundSize = "cover";
      $("mnComposerAvatar").textContent = "";
    } else {
      $("mnComposerAvatar").style.backgroundImage = "";
    }
    /* the profile wears the same colour its ring does in the feed */
    var hue = hueOf(id.mccluster_id || name);
    $("mnProfileAvatar").style.setProperty("--hue", hue);
    $("mnProfileBanner").style.setProperty("--hue", hue);
    $("mnProfileName").textContent = p.display_name || name;
    $("mnProfileHandle").textContent = id.mccluster_id ? "@" + id.mccluster_id : "";
    /* the account menu says whose account it is */
    $("mnMenuName").textContent = p.display_name || name;
    $("mnMenuHandle").textContent = id.mccluster_id ? "@" + id.mccluster_id : "";
    $("mnMenuFace").textContent = avatar ? "" : initials(name);
    $("mnMenuFace").style.backgroundImage = avatar ? "url(" + JSON.stringify(avatar) + ")" : "";
    $("mnMenuFace").style.setProperty("--hue", hue);
    $("mnProfileHeadline").textContent = p.headline || "";
    $("mnProfileBio").textContent = p.bio || "";
    var banner = safeHttpUrl(p.banner_url);
    $("mnProfileBanner").style.backgroundImage = banner ? "url(" + JSON.stringify(banner) + ")" : "";
    $("mnProfileAvatar").textContent = initials(name);
    $("mnProfileAvatar").style.backgroundImage = avatar ? "url(" + JSON.stringify(avatar) + ")" : "";
    if (avatar) $("mnProfileAvatar").textContent = "";
    var site = $("mnProfileWebsite"), website = safeHttpUrl(p.website_url);
    paintFrontPage(p, id, name);
    if (website) {
      site.href = website;
      site.textContent = website.replace(/^https?:\/\//, "");
      site.hidden = false;
    } else site.hidden = true;
  }

  /* a creator's analytics door: shown only when this member has a music
     creator profile (their own row, read under its own RLS) */
  function paintCreatorDoor() {
    var door = $("mnProfileAnalytics"), id = identity();
    if (!door || !id.m_uid || state.creatorChecked) return;
    state.creatorChecked = true;
    sbRest("music_creator_profiles?m_uid=eq." + encodeURIComponent(id.m_uid) + "&select=handle&limit=1").then(function (rows) {
      state.creator = !!(rows && rows.length);
      door.hidden = !state.creator;
      /* a creator also gets the audience layer switch on the globe */
      tellWorld({ type: "hu:creator-mode", on: state.creator });
    }).catch(function () { state.creatorChecked = false; });
  }

  /* THE ONBOARDING, THREE PAGES (owner, 2026-10-15: "three pages that look
     all sexy … you put in this, that, that, boom, it all verifies").
     One form, three steps, each saved on its own: 1 the handle (checked
     live) and the name, the public profile; 2 the legal name and mailing
     address, private (fan_profiles, the contact step); 3 phone, email and
     password. Editing an existing profile is the same form on one page. */
  var onboard = { step: 1, editing: false, contact: null, handleTimer: 0, handleOk: "", dialAuto: "" };
  function fillProfileForm(editing) {
    var p = profile(), id = identity();
    onboard.editing = !!editing;
    $("mnHandle").value = id.mccluster_id || "";
    $("mnDisplay").value = p.display_name || (state.user && state.user.user_metadata && (state.user.user_metadata.name || state.user.user_metadata.full_name)) || "";
    $("mnHeadline").value = p.headline || "";
    $("mnBio").value = p.bio || "";
    $("mnAvatarUrl").value = p.avatar_url || "";
    $("mnWebsite").value = p.website_url || "";
    $("mnNewPassword").value = "";
    $("mnNewPassword2").value = "";
    $("mnEmailShow").value = state.user && state.user.email || "";
    setStatus($("mnPasswordChangeStatus"), "");
    setStatus($("mnProfileStatus"), "");
    paintHandleState(id.mccluster_id ? "ok" : "");
    $("mnProfileTitle").innerHTML = editing ? "Edit your profile<em>.</em>" : "Make it yours<em>.</em>";
    $("mnProfileLede").textContent = editing ? "Your public profile, and the password for your M Account." : "Your name. Your place in the movement.";
    $("mnProfileBack").hidden = !editing;
    $("mnPasswordChange").hidden = !editing;
    showStep(editing ? 0 : 1);
    prefillContact();
    /* locked details (the profile edit gate, js/profile-edit-gate.js) read as locked; the database refuses the write anyway */
    if (window.HU_EDIT_GATE) window.HU_EDIT_GATE.lockForm();
  }
  /* step 0 is the editing page: step 1's fields, the public details and the password, together */
  function showStep(n) {
    onboard.step = n;
    var editing = n === 0;
    $("mnStep1").hidden = !(editing || n === 1);
    $("mnStep2").hidden = n !== 2;
    $("mnStep3").hidden = !(editing || n === 3);
    $("mnStepEdit").hidden = !editing;
    $("mnStepsRow").hidden = editing;
    $("mnStepBack").hidden = editing || n <= 1;
    $("mnCtaLabel").textContent = editing ? "Save changes" : n === 3 ? "Enter the World" : "Save & continue";
    Array.prototype.forEach.call(document.querySelectorAll("#mnSteps li"), function (li) {
      var k = Number(li.getAttribute("data-step"));
      li.classList.toggle("is-done", !editing && k < n);
      li.classList.toggle("is-current", !editing && k === n);
    });
    $("mnStepsCount").textContent = n + " / 3";
    /* page 3: the country code from the country on page 2 (the edit page fills it once the stored row is read) */
    if (n === 3) fillDial();
    if (!editing) { try { window.scrollTo({ top: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, 0); } }
  }
  function prefillContact() {
    if (!window.MCC_FAN || typeof MCC_FAN.load !== "function") return;
    MCC_FAN.load().then(function (row) {
      onboard.contact = row || null;
      if (!row) { if (onboard.editing) fillDial(); return; }
      var put = function (id, v) { var el = $(id); if (el && !el.value) el.value = v || ""; };
      put("mnLegalName", row.legal_name); put("mnAddr1", row.address_line1); put("mnAddr2", row.address_line2);
      put("mnCity", row.city); put("mnRegion", row.region); put("mnPostal", row.postal_code);
      if (row.country) $("mnCountry").value = row.country;
      if (row.phone_e164 && !$("mnPhone").value) { var parts = splitE164(row.phone_e164); $("mnDial").value = parts[0]; $("mnPhone").value = parts[1]; onboard.dialAuto = ""; }
      else if (onboard.editing) fillDial();
    }).catch(function () {});
  }
  /* the handle, checked as it is typed: the pattern here, the name at the API (a person nobody can find is free) */
  var HANDLE_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/i;
  function paintHandleState(kind, text) {
    var st = $("mnHandleState"), hint = $("mnHandleHint"), field = $("mnHandle") && $("mnHandle").closest(".mn__field");
    if (!st) return;
    st.className = "mn__field-state" + (kind ? " is-" + kind : "");
    st.textContent = kind === "bad" ? "taken" : "";
    if (field) field.classList.toggle("is-bad", kind === "bad");
    if (hint) hint.textContent = text || "Your handle across Equity Uprise.";
  }
  function checkHandle() {
    var v = $("mnHandle").value.trim();
    onboard.handleOk = "";
    if (!v) { paintHandleState(""); return; }
    if (!HANDLE_RE.test(v)) { paintHandleState("bad", "3 to 32 characters: letters, numbers, dot, underscore and hyphen."); return; }
    if (identity().mccluster_id && v.toLowerCase() === String(identity().mccluster_id).toLowerCase()) { onboard.handleOk = v; paintHandleState("ok", "That is your handle."); return; }
    paintHandleState("busy", "Checking…");
    var mine = v;
    api("/v1/mnet/people/" + encodeURIComponent(v)).then(function () {
      if ($("mnHandle").value.trim() !== mine) return;
      paintHandleState("bad", "@" + mine + " is taken. Try another.");
    }).catch(function (e) {
      if ($("mnHandle").value.trim() !== mine) return;
      if (e && e.status === 404) { onboard.handleOk = mine; paintHandleState("ok", "@" + mine + " is yours."); }
      else paintHandleState("", "We could not check that yet; saving will.");
    });
  }
  /* PHONES FROM ANYWHERE (owner, 2026-10-15: "the phone saved as plus one only is bad"). The country code is
     its own cell, filled from the country given on page 2 and always editable; a number typed with its own
     "+" rules. Nothing is assumed: no code, no save. E.164 is the country code and the number, 8 to 15 digits,
     without the trunk 0 most countries drop (Italy keeps it). */
  var DIAL_CODES = { "united states": "1", "usa": "1", "us": "1", "united states of america": "1", "canada": "1", "puerto rico": "1", "jamaica": "1", "trinidad and tobago": "1", "bahamas": "1", "barbados": "1", "dominican republic": "1",
    "united kingdom": "44", "uk": "44", "england": "44", "scotland": "44", "wales": "44", "northern ireland": "44", "great britain": "44", "ireland": "353", "france": "33", "germany": "49", "spain": "34", "italy": "39", "portugal": "351",
    "netherlands": "31", "belgium": "32", "switzerland": "41", "austria": "43", "sweden": "46", "norway": "47", "denmark": "45", "finland": "358", "iceland": "354", "poland": "48", "czech republic": "420", "czechia": "420", "hungary": "36",
    "greece": "30", "turkey": "90", "ukraine": "380", "russia": "7", "romania": "40", "bulgaria": "359", "croatia": "385", "serbia": "381", "israel": "972", "united arab emirates": "971", "uae": "971", "saudi arabia": "966", "qatar": "974", "jordan": "962", "lebanon": "961",
    "egypt": "20", "morocco": "212", "algeria": "213", "tunisia": "216", "nigeria": "234", "ghana": "233", "kenya": "254", "ethiopia": "251", "tanzania": "255", "uganda": "256", "rwanda": "250", "south africa": "27", "senegal": "221", "cameroon": "237",
    "democratic republic of the congo": "243", "dr congo": "243", "congo": "242", "haiti": "509", "mexico": "52", "guatemala": "502", "honduras": "504", "el salvador": "503", "costa rica": "506", "panama": "507", "cuba": "53",
    "colombia": "57", "venezuela": "58", "ecuador": "593", "peru": "51", "bolivia": "591", "chile": "56", "argentina": "54", "uruguay": "598", "paraguay": "595", "brazil": "55",
    "india": "91", "pakistan": "92", "bangladesh": "880", "sri lanka": "94", "nepal": "977", "china": "86", "hong kong": "852", "taiwan": "886", "japan": "81", "south korea": "82", "korea": "82", "singapore": "65", "malaysia": "60", "indonesia": "62", "philippines": "63", "thailand": "66", "vietnam": "84",
    "australia": "61", "new zealand": "64",
    "britain": "44", "deutschland": "49", "espana": "34", "brasil": "55", "nederland": "31", "viet nam": "84", "korea republic of": "82", "republic of korea": "82",
    "afghanistan": "93", "iran": "98", "iraq": "964", "syria": "963", "kuwait": "965", "oman": "968", "bahrain": "973", "yemen": "967", "somalia": "252", "sudan": "249", "south sudan": "211",
    "zimbabwe": "263", "zambia": "260", "mozambique": "258", "angola": "244", "ivory coast": "225", "cote d ivoire": "225", "mali": "223", "burkina faso": "226", "niger": "227", "chad": "235", "libya": "218", "sierra leone": "232", "liberia": "231", "togo": "228", "benin": "229", "gambia": "220", "guinea": "224", "malawi": "265", "botswana": "267", "namibia": "264", "madagascar": "261", "mauritius": "230",
    "myanmar": "95", "cambodia": "855", "laos": "856", "mongolia": "976", "kazakhstan": "7", "uzbekistan": "998", "georgia": "995", "armenia": "374", "azerbaijan": "994", "belarus": "375", "lithuania": "370", "latvia": "371", "estonia": "372", "slovakia": "421", "slovenia": "386", "bosnia and herzegovina": "387", "albania": "355", "north macedonia": "389", "montenegro": "382", "kosovo": "383", "moldova": "373", "malta": "356", "cyprus": "357", "luxembourg": "352",
    "guyana": "592", "suriname": "597", "belize": "501", "nicaragua": "505", "fiji": "679", "papua new guinea": "675", "samoa": "685", "tonga": "676" };
  /* the code cell follows the country until the member types a code of their own (going back to change the country re-fills it) */
  function fillDial() {
    var d = $("mnDial"); if (!d) return;
    var cur = d.value.trim();
    if (!cur || cur === onboard.dialAuto) { onboard.dialAuto = dialFor($("mnCountry").value); d.value = onboard.dialAuto; }
  }
  function dialFor(country) {
    var k = String(country || "").toLowerCase();
    try { k = k.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    k = k.replace(/^the\s+/, "").replace(/[.,'()]/g, " ").replace(/\s+/g, " ").trim();
    return DIAL_CODES[k] ? "+" + DIAL_CODES[k] : "";
  }
  /* a stored E.164 number, back into its code and its number (the longest known code that starts it) */
  function splitE164(phone) {
    var digits = String(phone || "").replace(/[^0-9]/g, "");
    var codes = Object.keys(DIAL_CODES).map(function (k) { return DIAL_CODES[k]; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < codes.length; i++) if (digits.indexOf(codes[i]) === 0 && digits.length > codes[i].length) return ["+" + codes[i], digits.slice(codes[i].length)];
    return ["", digits ? "+" + digits : ""];
  }
  function normalizePhone(dial, raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    var digits = s.replace(/[^0-9]/g, "");
    if (/^\+/.test(s)) return digits.length >= 8 && digits.length <= 15 ? "+" + digits : null;
    var code = String(dial || "").replace(/[^0-9]/g, "");
    if (!/^[1-9][0-9]{0,2}$/.test(code)) return null;
    /* the number as people type it: the country code again without its + (dropped), the trunk digit most
       countries dial at home (0 almost everywhere, Italy keeps it; 1 in North America; 8 in Russia) */
    if (digits.indexOf(code) === 0 && digits.length - code.length >= 7) digits = digits.slice(code.length);
    else if (code === "1" && digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
    else if (code === "7" && digits.length === 11 && digits.charAt(0) === "8") digits = digits.slice(1);
    else if (code !== "39" && digits.length > 1 && digits.charAt(0) === "0") digits = digits.slice(1);
    var all = code + digits;
    return digits.length >= 4 && all.length >= 8 && all.length <= 15 ? "+" + all : null;
  }
  /* a hook for the browser test: the rule above, called with a country code and a number */
  window.__mnPhone = normalizePhone; window.__mnSplitPhone = splitE164;

  function showGate(which) {
    $("mnSignedOut").hidden = which !== "signedout";
    $("mnProfileGate").hidden = which !== "profile";
    $("mnApp").hidden = which !== "app";
    /* the bar's sign-in chip steps aside while a gate is up, as it does on the World */
    document.documentElement.classList.toggle("mn-gate-on", which !== "app");
    sizeWorld();
  }

  function providerLabel(key) {
    return { google:"Continue with Google", apple:"Continue with Apple", facebook:"Continue with Facebook", x:"Continue with X" }[key] || ("Continue with " + key);
  }
  function mountProviders() {
    if (!window.MCC || !MCC.providers) return;
    MCC.providers().then(function (live) {
      var host = $("mnProviderButtons"), any = false;
      host.innerHTML = "";
      ["google","apple","facebook","x"].forEach(function (key) {
        if (!live[key]) return;
        any = true;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "mn__provider";
        b.textContent = providerLabel(key);
        b.onclick = function () {
          b.disabled = true;
          var next=location.pathname+location.search+location.hash;
          MCC.signInWithProvider(key, location.origin + "/auth/?next=" + encodeURIComponent(next)).catch(function (e) {
            b.disabled = false;
            setStatus($("mnAuthStatus"), e.message, "error");
          });
        };
        host.appendChild(b);
      });
      $("mnProviders").hidden = !any;
    }).catch(function () {});
  }

  /* THE WORLD FOR GUESTS. One World shell for everyone (owner's role
     matrix): a signed-out visitor gets the same globe, strip and feed,
     reading public posts through /v1/mnet/public-feed. Every action that
     needs a member (like, comment, save, follow, post, join, other rooms)
     opens sign-in instead, and the server refuses it anyway. */
  function enterGuestWorld() {
    state.guest = true;
    paintNewsroom();
    document.documentElement.classList.add("mn-guest");
    $("mnGuestBar").hidden = false;
    var q = null; try { q = new URLSearchParams(location.search); } catch (_) {}
    if (q && q.get("signin") === "1") { openSignIn("signin"); return; }
    showGate("app");
    setView("feed");
    loadFeed(true);
  }
  /* THE WORLD FIRST (owner, 2026-10-15: "me as a signed in user … I see no
     globe"). A member whose profile, or whose private contact details, is
     not finished used to get the form instead of the World. Now the World
     is theirs like anyone's (public posts, every pin, every layer), the
     step waits in a card where the composer would be, and the actions that
     need it (post, join, connect, the member rooms) open it with the
     reason. The server refuses those actions anyway until it is done. */
  function needsStep() {
    var s = state.boot && state.boot.next_step;
    return s === "profile" || s === "contact" ? s : "";
  }
  function paintFinishCard() {
    var card = $("mnFinishCard"), step = needsStep(), stall = state.stall;
    if (!card) return;
    document.documentElement.classList.toggle("mn-stall-signin", stall === "signin");
    if ($("mnStallSignIn")) $("mnStallSignIn").hidden = stall !== "retry";
    if (stall) {
      card.hidden = false;
      if ($("mnComposer")) $("mnComposer").hidden = true;
      $("mnFinishTitle").textContent = stall === "signin" ? "Your sign-in ended." : "Your feed didn\u2019t load.";
      $("mnFinishWhy").textContent = stall === "signin"
        ? "Sign in again to post, join missions and connect. The Earth and the public posts are right here."
        : "The Earth and the public posts are live. Try again, or sign in again if it keeps happening.";
      $("mnFinishGo").textContent = stall === "signin" ? "Sign in again \u2192" : "Try again \u2192";
      return;
    }
    card.hidden = !step;
    if ($("mnComposer")) $("mnComposer").hidden = !!step;
    if (!step) return;
    var contact = step === "contact";
    $("mnFinishTitle").textContent = contact ? "Complete your details." : "Finish your profile.";
    $("mnFinishWhy").textContent = contact
      ? "Three quick pages: your name, where to reach you, and how you get back in. Your address is private, never on your profile."
      : "Pick a username so people can find and mention you. Then post, connect and join missions.";
    $("mnFinishGo").textContent = contact ? "Complete your details \u2192" : "Finish your profile \u2192";
  }
  function askToFinish(why) {
    /* while the member's own World has not loaded, what needs it waits on the card that says so */
    if (state.stall === "retry") {
      var card = $("mnFinishCard");
      if (card) { card.classList.remove("is-nudged"); void card.offsetWidth; card.classList.add("is-nudged"); try { card.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {} }
      setStatus($("mnFeedStatus"), "Your feed hasn\u2019t loaded yet. Try again above.", "error");
      return true;
    }
    var step = needsStep();
    if (!step) return false;
    track("finish_step_prompt", { step: step, reason: String(why || "act").slice(0, 24) });
    fillProfileForm(false);
    var back = $("mnProfileBack"); if (back) { back.hidden = false; back.textContent = "\u2190 Back to the World"; }
    setStatus($("mnProfileStatus"), { post: "Finish your profile to post.", mission: "Finish your profile to join a mission.", connect: "Finish your profile to connect with members.",
      profile: "Finish your profile to open it.", messages: "Finish your profile to message members.", groups: "Finish your profile to join groups.", discover: "Finish your profile to find people.",
      live: "Finish your profile to watch live rooms.", clips: "Finish your profile to clip songs." }[why] || (why === "act" ? "" : "Finish your profile to do that."));
    showGate("profile");
    window.scrollTo(0, 0);
    return true;
  }
  /* the sign-in panel, opened from the World: the reason and the way back
     sit at the top, so neither ends up under the keyboard or the bar */
  function openSignIn(mode, why) {
    setAuthMode(mode);
    showGate("signedout");
    $("mnGuestWhyRow").hidden = !state.guest;
    $("mnGuestWhy").textContent = why || "";
    window.scrollTo(0, 0);
    var email = $("mnEmail"); if (email) email.focus({ preventScroll: true });
  }
  function leaveGuestWorld() {
    if (!state.guest) return;
    state.guest = false;
    document.documentElement.classList.remove("mn-guest");
    $("mnGuestBar").hidden = true;
    state.feed = []; state.nextBefore = null;
  }
  function askToSignIn(why) {
    var line = { save:"Sign in to save posts.",
      mission:"Sign in to join this mission.", missions:"Sign in to see every mission and join one.", discover:"Sign in to find people.", media:"Sign in to see photos and video.", post:"Sign in to post.", people:"Sign in to search for people.",
      groups:"Sign in to find and join groups.", live:"Sign in to watch live rooms.", connect:"Sign in to connect with members.", clips:"Sign in to clip songs and get paid on real views.",
      layers:"Sign in to see satellites and space missions on the Earth.",
      rooms:"Sign in to join conversations anywhere in the world, raise your hand and speak.",
      regions:"Sign in to explore posts, news and conversations in other regions." }[why] || "Sign in to do that.";
    track("guest_sign_in_prompt", { reason: String(why || "act").slice(0, 24) });
    openSignIn("signin", line);
  }

  function bootstrap() {
    return api("/v1/mnet/bootstrap?app_key=" + encodeURIComponent(APP)).then(function (boot) {
      state.boot = boot;
      if (needsStep()) {
        /* the World first (needsStep, above): the public posts, every pin,
           and the step in a card where the composer would be. The private
           mailing address lives in fan_profiles, never network_profiles. */
        if (needsStep() === "profile") fillProfileForm(false);
        showGate("app");
        setView("feed");
        paintSelf();
        paintFinishCard();
        $("mnBell").hidden = false;
        requestAnimationFrame(function () { moveThumb(false); });
        return loadFeed(true);
      }
      paintFinishCard();
      showGate("app");
      setView("feed");
      paintSelf();
      paintCreatorDoor();
      $("mnBell").hidden = false;
      loadActionRecord();
      requestAnimationFrame(function () { moveThumb(false); });
      openDeepLinkedMission();
      openDeepLinkedGroup();
      try {
        var publicHandle = new URLSearchParams(location.search).get("profile");
        if(publicHandle && /^[a-z0-9][a-z0-9._-]{2,39}$/.test(publicHandle.toLowerCase()) && !state.guest)openPerson(publicHandle.toLowerCase());
      } catch (_) {}
      /* A deep link to a mission or a group wins over the first-run tour. */
      if (!/[?&](mission|group|view)=/.test(location.search) && window.MCC_TOUR && window.MCC_TOUR.autoStart) window.MCC_TOUR.autoStart(boot);
      if (window.MCC_LIVE) window.MCC_LIVE.start();
      return loadFeed(true).then(function () { loadNotificationsSilently(); refreshMessageBadge(); });
    });
  }

  /* Authentication and Mnet availability are different states. A network/API
     failure must never throw a signed-in member back at the login form. */
  /* A MEMBER WHOSE WORLD DID NOT LOAD STILL GETS THE WORLD (owner, 2026-10-15: "when I'm logged in as Benji Chase
     … not seeing the globe"). This used to show the app shell without ever opening the feed view: no Earth, and the
     message itself was inside the hidden view. Now the World opens either way. A session the API refuses outright
     (401) is let go: the member is a guest, with one card to sign in again. Anything else (the network, a server
     error, a session that could not be checked) keeps the session and shows the Earth and the public posts, with a
     card to try again or to sign in again. Posting, joining and the member rooms wait on the card. */
  function showSignedInLoadError(error) {
    try { console.warn("[mnet] signed-in bootstrap failed", error); } catch (e) {}
    if (error && error.status === 401) return letSessionGo();
    state.stall = "retry";
    showGate("app");
    setView("feed");
    paintFinishCard();
    setStatus($("mnFeedStatus"), "");
    return loadFeed(true).catch(function () {});
  }
  function letSessionGo() {
    var done = function () { state.stall = "signin"; enterGuestWorld(); paintFinishCard(); };
    return (window.MCC && MCC.signOut ? MCC.signOut().catch(function () {}) : Promise.resolve()).then(done, done);
  }
  function retryStall() {
    var go = $("mnFinishGo");
    if (go) go.disabled = true;
    state.stall = null;
    return bootstrap().catch(function (e) { return showSignedInLoadError(e); }).then(function () { if (go) go.disabled = false; });
  }

  /* THE PROFILE PICTURE.
     ------------------------------------------------------------------
     Post attachments already have an upload pipeline, and an avatar
     deliberately does not use it. That one stores into the PRIVATE
     mnet-media bucket and hands back a signed view URL, which expires —
     fine for a picture inside a post the reader is looking at now, useless
     for network_profiles.avatar_url, which is a plain address painted as a
     background-image on every row this person appears in, forever. So the
     avatar goes to mnet-avatars, which is public read and owner-write, and
     the address it returns keeps working.

     The first path segment is the uploader's own auth id because the
     storage policy checks exactly that: `(storage.foldername(name))[1] =
     auth.uid()::text`. Getting this wrong is a 403, not a silent
     mis-file. */
  var AVATAR_BUCKET = "mnet-avatars";
  var AVATAR_MAX = 5 * 1024 * 1024;

  function uploadAvatar(file) {
    var token = sessionToken();
    var uid = state.user && state.user.id;
    if (!token || !uid) return Promise.reject(new Error("Sign in before uploading a photo."));
    if (file.size > AVATAR_MAX) return Promise.reject(new Error("That image is over 5 MB. Try a smaller one."));
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type || "")) {
      return Promise.reject(new Error("Use a PNG, JPEG, WebP or GIF."));
    }
    /* A fresh name every time: same-name overwrites are what make a new
       photo show the old one until the cache gives up. */
    var ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    var path = uid + "/avatar-" + Date.now() + "." + ext;
    setStatus($("mnAvatarStatus"), "Uploading…");
    return fetch(SB_URL + "/storage/v1/object/" + AVATAR_BUCKET + "/" + path, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        authorization: "Bearer " + token,
        "content-type": file.type,
        "x-upsert": "true"
      },
      body: file
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(t || "Upload failed."); });
      var url = SB_URL + "/storage/v1/object/public/" + AVATAR_BUCKET + "/" + path;
      $("mnAvatarUrl").value = url;
      var prev = $("mnAvatarPreview");
      if (prev) { prev.src = url; prev.hidden = false; }
      setStatus($("mnAvatarStatus"), "Photo ready. Save the profile to keep it.", "ok");
      return url;
    }).catch(function (e) {
      setStatus($("mnAvatarStatus"), e.message || "Upload failed.", "error");
      throw e;
    });
  }

  function wireAvatarPicker() {
    var pick = $("mnAvatarPick"), input = $("mnAvatarFile");
    if (!pick || !input) return;
    pick.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      uploadAvatar(file).catch(function () {});
      input.value = "";
    });
  }

  function saveDemographics() {
    /* Demographic measurement ships only when its backend contract is live.
       Profile creation/editing must never depend on an optional pending migration. */
    var fields = Array.prototype.slice.call(document.querySelectorAll('input[name="mnRace"]'));
    var skipNode = $("mnRaceSkip");
    if (!fields.length && !skipNode) return Promise.resolve();
    return Promise.resolve();
  }

  function savePublicProfile() {
    return saveDemographics().then(function () { return api("/v1/mnet/profile?app_key=" + encodeURIComponent(APP), {
      method: "PATCH",
      body: {
        mccluster_id: $("mnHandle").value.trim(),
        display_name: $("mnDisplay").value.trim(),
        headline: $("mnHeadline").value.trim(),
        bio: $("mnBio").value.trim(),
        avatar_url: $("mnAvatarUrl").value.trim(),
        website_url: $("mnWebsite").value.trim()
      }
    }); }).then(function (boot) { state.boot = boot; paintSelf(); return boot; });
  }
  function saveContact() {
    var v = function (id) { return $(id).value.trim(); };
    var values = { legal_name: v("mnLegalName"), address_line1: v("mnAddr1"), address_line2: v("mnAddr2"), city: v("mnCity"), region: v("mnRegion"), postal_code: v("mnPostal"), country: v("mnCountry") };
    var missing = ["mnLegalName", "mnAddr1", "mnCity", "mnRegion", "mnPostal", "mnCountry"].filter(function (id) { return !v(id); });
    Array.prototype.forEach.call(document.querySelectorAll("#mnStep2 .mn__field"), function (f) { var i = f.querySelector("input"); f.classList.toggle("is-bad", !!(i && missing.indexOf(i.id) !== -1)); });
    if (missing.length) { $(missing[0]).focus(); return Promise.reject(new Error("Fill in your legal name and the whole address.")); }
    if (!window.MCC_FAN) return Promise.reject(new Error("Could not save your details right now."));
    if (onboard.contact) { values.marketing_consent = !!onboard.contact.marketing_consent; values.share_consent = !!onboard.contact.share_consent; if (onboard.contact.phone_e164) values.phone_e164 = onboard.contact.phone_e164; }
    return MCC_FAN.save(values).then(function (row) { onboard.contact = row || onboard.contact; return row; });
  }
  function saveReach() {
    var phone = normalizePhone($("mnDial").value, $("mnPhone").value), p1 = $("mnNewPassword").value, p2 = $("mnNewPassword2").value;
    if (phone === null) { var code = $("mnDial").value.replace(/[^0-9]/g, ""); $(code && code.length <= 3 && !/^\+/.test($("mnPhone").value.trim()) ? "mnPhone" : "mnDial").focus(); return Promise.reject(new Error("Add your country code (like +44) and then the number.")); }
    if (p1 || p2) {
      if (p1.length < 8) { $("mnNewPassword").focus(); return Promise.reject(new Error("Use at least 8 characters for the password.")); }
      if (p1 !== p2) { $("mnNewPassword2").focus(); return Promise.reject(new Error("Those passwords do not match.")); }
    }
    var steps = Promise.resolve();
    if (phone && window.MCC_FAN) steps = steps.then(function () {
      var values = { phone_e164: phone };
      if (onboard.contact) { values.marketing_consent = !!onboard.contact.marketing_consent; values.share_consent = !!onboard.contact.share_consent; }
      return MCC_FAN.save(values);
    });
    if (p1) steps = steps.then(function () { return MCC.updatePassword(p1); });
    return steps;
  }
  function enterTheWorld() {
    return api("/v1/mnet/bootstrap?app_key=" + encodeURIComponent(APP)).then(function (boot) {
      state.boot = boot;
      paintFinishCard();
      var back = $("mnProfileBack"); if (back) back.hidden = true;
      showGate("app");
      paintSelf();
      var missionDeepLink=!MISSIONS_OFF&&/[?&](mission=|view=missions(?:&|$))/.test(location.search);
      if(missionDeepLink){
        setView("missions");
        openDeepLinkedMission();
      }else{
        /* the World first: a finished profile lands back on the feed, not on a profile page */
        setView("feed");
      }
      track("onboarding_done", { step: String(boot && boot.next_step || "feed") });
      return loadFeed(true).then(function () {
        var first = $("mnFeed") && $("mnFeed").querySelector(".mn__post-card[data-post-id]");
        if (first) { first.classList.add("is-just-posted"); setTimeout(function () { first.classList.remove("is-just-posted"); }, 1600); }
      });
    });
  }
  function saveProfile(event) {
    event.preventDefault();
    var button = $("mnProfileSave"), step = onboard.step;
    button.disabled = true;
    setStatus($("mnProfileStatus"), "Saving…");
    var work;
    if (step === 0) {
      /* editing: the public profile, and the password if one was typed */
      var p1 = $("mnNewPassword").value, p2 = $("mnNewPassword2").value;
      work = savePublicProfile().then(function () {
        if (!p1 && !p2) return;
        if (p1.length < 8) throw new Error("Use at least 8 characters for the password.");
        if (p1 !== p2) throw new Error("Those passwords do not match.");
        return MCC.updatePassword(p1);
      }).then(function () { showGate("app"); setView("profile"); });
    } else if (step === 1) {
      var h = $("mnHandle").value.trim();
      if (!HANDLE_RE.test(h)) { work = Promise.reject(new Error("Use 3–32 letters, numbers, dots, underscores or hyphens for your username.")); $("mnHandle").focus(); }
      else if (!$("mnDisplay").value.trim()) { work = Promise.reject(new Error("Add a display name.")); $("mnDisplay").focus(); }
      else work = savePublicProfile().then(function () { track("onboarding_step", { step: "1" }); setStatus($("mnProfileStatus"), ""); showStep(2); });
    } else if (step === 2) {
      work = saveContact().then(function () { track("onboarding_step", { step: "2" }); setStatus($("mnProfileStatus"), ""); showStep(3); });
    } else {
      work = saveReach().then(function () { track("onboarding_step", { step: "3" }); setStatus($("mnProfileStatus"), ""); return enterTheWorld(); });
    }
    work.catch(function (e) {
      var m = e && e.message || "Could not save that.";
      if (/mccluster_id_taken/.test(m)) { m = "That username is already taken."; paintHandleState("bad", "@" + $("mnHandle").value.trim() + " is taken. Try another."); }
      if (/invalid_mccluster_id/.test(m)) m = "Use 3–32 letters, numbers, dots, underscores or hyphens.";
      if (/profile_field_locked/.test(m)) m = "That detail is locked. Ask for the change from your desk.";
      setStatus($("mnProfileStatus"), m, "error");
    }).finally(function () { button.disabled = false; });
  }

  function authorHtml(actor) {
    actor = actor || {};
    var name = actor.display_name || actor.mccluster_id || "Member";
    var handle = actor.mccluster_id ? "@" + actor.mccluster_id : "McCluster";
    var avatar = safeHttpUrl(actor.avatar_url);
    var av = avatar
      ? '<img src="' + esc(avatar) + '" alt="">'
      : esc(initials(name));
    var inner = '<div class="mn__author-avatar" style="--hue:' + hueOf(actor.mccluster_id || name) + '">' + av + '</div>' +
      '<div class="mn__author-meta"><span class="mn__author-name">' + esc(name) + '</span>' +
      '<div class="mn__author-sub">' + esc(handle) + '</div></div>';
    return actor.mccluster_id
      ? '<button class="mn__author-link" type="button" data-person="' + esc(actor.mccluster_id) + '">' + inner + '</button>'
      : inner;
  }

  function postMediaHtml(post) {
    var media = Array.isArray(post.media) ? post.media : [];
    if (!media.length) return "";
    /* a clip from the create editor: play only the stretch that was kept */
    var clip = post.metadata && post.metadata.clip, frag = "";
    if (clip && (clip.start_ms || clip.end_ms)) {
      frag = "#t=" + ((Number(clip.start_ms) || 0) / 1000).toFixed(2) + (clip.end_ms ? "," + (Number(clip.end_ms) / 1000).toFixed(2) : "");
    }
    return '<div class="mn__post-media' + (media.length > 1 ? ' is-grid' : '') + '" data-count="' + media.length + '">' +
      media.map(function (m) {
        var id = m && (m.asset_id || m.id);
        if (!id) return "";
        return '<div class="mn__post-media-item" data-mnet-media="' + esc(id) + '" data-media-type="' + esc(m.type || m.media_type || "file") + '"' +
          (m.poster_asset_id ? ' data-poster-asset="' + esc(m.poster_asset_id) + '"' : '') +
          (frag ? ' data-clip="' + esc(frag) + '"' : '') + (clip && clip.muted ? ' data-muted="1"' : '') + '>' +
          '<div class="mn__post-media-loading">Loading media…</div></div>';
      }).join("") + '</div>';
  }

  /* A SHARED TRACK IS PLAYABLE WHERE IT IS READ. The card links straight
     into the album room at that exact track (album.html?album=&t=), which is
     the deep link the listening room already uses, so a post is a door into
     the catalogue rather than a mention of it. */
  function trackCardHtml(item, post) {
    var t = (item && item.payload && item.payload.track) ||
            (post && post.metadata && post.metadata.track) || null;
    if (!t || !t.title) return "";
    var href = "album.html?album=" + encodeURIComponent(t.albumSlug || "here") +
               "&t=" + encodeURIComponent(t.title);
    return '<a class="mn__track" href="' + esc(href) + '">' +
      (t.art ? '<img class="mn__track-art" src="' + esc(t.art) + '" alt="" loading="lazy">' : '<span class="mn__track-art"></span>') +
      '<span class="mn__track-meta"><b>' + esc(t.title) + '</b>' +
        (t.album ? '<small>' + esc(t.album) + '</small>' : '') + '</span>' +
      '<span class="mn__track-play" aria-hidden="true">&#9654;</span>' +
      '<span class="sr-only">Play ' + esc(t.title) + '</span></a>';
  }

  function postCard(item, opts) {
    opts = opts || {};
    var post = item.post || item, actor = item.actor || post.actor || {};
    var saved = !!post.bookmarked_by_me;
    var id = post.id || item.post_id, mine = !!(identity().m_uid && post.author_m_uid === identity().m_uid);
    var pinned = !!(item && item.payload && item.payload.pinned);
    var onGlobe = !!(state.world.focus && postMissionId(item) === state.world.focus.mission_id);
    /* media first (owner's reference, 2026-10-19): a post with a picture or clip leads with it, the words beside; a post
       without one is the words alone. The same markup serves both; the layout is the card's class. */
    var media = postMediaHtml(post);
    return '<article class="mn__post-card' + (pinned ? ' is-pinned' : '') + (onGlobe ? ' is-on-globe' : '') + (media ? ' has-media' : '') + '" data-post-id="' + esc(id || "") + '">' +
      (pinned ? '<span class="mn__pin">Pinned</span>' : '') +
      (media ? '<div class="mn__post-thumb">' + media + '</div>' : '') +
      '<div class="mn__post-main">' +
      '<div class="mn__post-head">' + authorHtml(actor) +
        '<span class="mn__author-sub">' + esc(timeAgo(post.created_at || item.occurred_at)) + '</span></div>' +
      (post.body ? '<p class="mn__post-body">' + esc(post.body) + '</p>' : '') +
      actionOfferCardHtml(id) +
      actionCardHtml(id) +
      collaborationCardHtml(id) +
      trackCardHtml(item, post) +
      '</div>' +
      /* the country feed is public and carries no media ids: a guest is asked to sign in; a member loads the post itself */
      (post.media_locked ? (state.guest
        ? '<button class="mn__media-locked" type="button" data-guest-ask="media">Sign in to see ' + (post.media_locked > 1 ? 'these photos and videos' : 'this photo or video') + '</button>'
        : '<button class="mn__media-locked" type="button" data-unlock-media="' + esc(id) + '">Show ' + (post.media_locked > 1 ? 'these photos and videos' : 'this photo or video') + '</button>') : '') +
      (opts.actions === false ? '' :
        '<div class="mn__post-actions">' +
          /* A post keeps the familiar Comment, Share and Save actions; mission participation and funding still use their separate controlled routes. */
          '<button class="mn__action mn__action--comment" type="button" data-discussion-toggle aria-expanded="false" aria-label="Comment on post">' + ICON.comment + '<span class="mn__action-label">Comment</span></button>' +
          '<button class="mn__action mn__action--share" type="button" data-action="share" data-post="' + esc(id) + '" aria-label="Share post">' + ICON.share + '<span class="mn__action-label">Share</span></button>' +
          '<button class="mn__action mn__action--save' + (saved ? ' is-active' : '') + '" type="button" data-action="save" data-post="' + esc(id) + '" aria-pressed="' + saved + '" aria-label="Save for later">' +
            ICON.save + '</button>' +
          (mine ? '<button class="mn__action mn__danger" type="button" data-action="delete" data-post="' + esc(id) + '" aria-label="Delete">' + ICON.trash + '</button>' : '') +
        '</div>' + discussionHtml('post', id)) +
    '</article>';
  }

  /* THE EMBLEM OR FUND IT (owner, 2026-10-14). The join is the owner's
     Equity Uprise artwork, complete and scaled only, never redrawn, and
     never written out: the mark stands alone, with no caption or wordmark
     beside it, and its accessible name says what it does. Tapping it joins
     the mission's cohort and does it (the canonical join flow); Fund opens
     the campaign's governed support rail, and only says so when that
     campaign has money enabled (action_bounty_public). Never a payment
     endpoint of its own. */
  /* the owner's mark, white, on the World's dark glass (assets/img/equity-uprise-mark-white.png): the supplied artwork's own
     shape, its tile cut away ("keep the dark part") and the mark painted white at the owner's word (owner, 2026-10-15:
     "make the actual … sign white. Just paint it white for me") */
  var EUP_MARK = '<img class="mn__eup" src="assets/img/equity-uprise-mark-white.png" alt="" width="28" height="28">';
  function fundButtonHtml(c) {
    return '<button class="mn__fund" type="button" data-fund-mission="' + esc(c.mission_id) + '"' + (c.campaign_id ? ' data-campaign="' + esc(c.campaign_id) + '"' : '') + ' aria-label="Fund this mission">' + ICON.fund + '<span>Fund</span></button>';
  }
  /* the mission's public counts (action_mission_stats, anon-granted): how many joined, how many verified; never who */
  function missionStatsHtml(missionId) {
    var st = state.world.stats[missionId];
    if (!st) return "";
    var joined = Number(st.joined) || 0, verified = Number(st.verified) || 0;
    return '<p class="mn__actcard-stats">' + esc(joined + " joined") + ' \u00b7 ' + esc(verified + " verified") + '</p>';
  }
  function fundState(missionId, campaignId) {
    missions.support = missions.support || {};
    var withCampaign = campaignId ? Promise.resolve(campaignId) : fetchMission(missionId).then(function (m) { return m && m.campaign_id || ""; }).catch(function () { return ""; });
    return withCampaign.then(function (cid) {
      if (!cid) return { open: false, note: "" };
      if (missions.support[cid]) return missions.support[cid];
      return sbRpc("action_bounty_public", { p_campaign: cid }).then(function (d) {
        return (missions.support[cid] = { open: !!(d && d.support_open), note: String(d && d.support_note || "").slice(0, 240) });
      }).catch(function () { return { open: false, note: "" }; });
    });
  }
  function fundLineHtml(st) {
    return (st.open
      ? '<span>Funding is open through the campaign\u2019s governed support rail.</span><a class="mn__fund-go" href="give.html">Open the support rail \u2192</a>'
      : '<span>Funding isn\u2019t open for this mission yet. You can still join it and do it.</span>') +
      (st.note ? '<small>' + esc(st.note) + '</small>' : '');
  }
  function toggleFundLine(host, missionId, campaignId) {
    if (!host) return;
    var old = host.querySelector(".mn__fund-line"); if (old) { old.remove(); return; }
    var line = document.createElement("p"); line.className = "mn__fund-line"; line.setAttribute("role", "status"); line.textContent = "Checking funding\u2026";
    host.appendChild(line);
    track("fund_open", { mission: String(missionId || "").slice(0, 36) });
    fundState(missionId, campaignId).then(function (st) { if (line.isConnected) line.innerHTML = fundLineHtml(st); });
  }
  /* A CREATOR POST MAY CARRY A MISSION. Like verified-action cards, this
     is read from a server-vouched relation, never trusted from post metadata. */
  function actionOfferHref(c) {
    var q = new URLSearchParams();
    q.set("view", "missions");
    q.set("mission", c.mission_id);
    q.set("content", c.content_id);
    q.set("src", "network");
    if (c.campaign_id) q.set("campaign", c.campaign_id);
    return "/mnet.html?" + q.toString();
  }
  function actionOfferCardHtml(postId) {
    var c = postId && state.actionOffers && state.actionOffers[postId];
    if (!c) return "";
    return '<div class="mn__actcard mn__actcard--offer">' +
      '<p class="mn__actcard-eyebrow">Mission attached</p>' +
      '<p class="mn__actcard-title">' + esc(c.title) + '</p>' +
      (c.description ? '<p class="mn__actcard-foot">' + esc(c.description) + '</p>' : '') +
      '<div class="mn__actcard-row">' +
        (c.mission_open ? '<a class="mn__primary mn__primary--eup" href="' + esc(actionOfferHref(c)) + '" data-take-mission="' + esc(c.mission_id) + '" data-content="' + esc(c.content_id) + '" data-source="network" aria-label="Join this mission and do it">' + EUP_MARK + '</a>' : '<span class="mn__hint">Mission closed</span>') +
        fundButtonHtml(c) +
      '</div>' + missionStatsHtml(c.mission_id) + globeChipHtml(c.mission_id) + '</div>';
  }
  function loadActionOfferCards(items) {
    if (MISSIONS_OFF) return Promise.resolve(false);
    var ids = (items || []).map(function (it) {
      var p = it.post;
      return p && p.content_id ? p.id : null;
    }).filter(function (id) { return id && !(id in state.actionOffers); });
    if (!ids.length) return Promise.resolve(false);
    ids.forEach(function (id) { state.actionOffers[id] = null; });
    return sbRpc("action_offer_cards", { p_post_ids: ids.slice(0, 100) }).then(function (rows) {
      (rows || []).forEach(function (x) { state.actionOffers[x.post_id] = x; });
      return (rows || []).length > 0;
    }).catch(function () { return false; });
  }

  /* A VERIFIED ACTION ON THE FEED. Drawn only for posts the server vouches
     for (action_feed_cards): post metadata is member-writable, so a post that
     merely claims to be an action gets no card. */
  function actionCardHtml(postId) {
    var c = postId && state.actionCards && state.actionCards[postId];
    if (!c) return "";
    return '<div class="mn__actcard">' +
      '<p class="mn__actcard-eyebrow">Verified action</p>' +
      '<p class="mn__actcard-title">' + esc(c.title) + '</p>' +
      '<p class="mn__actcard-foot">Equity Uprise · Don\u2019t just watch. Act.</p>' +
      '<div class="mn__actcard-row">' +
        (c.mission_open ? '<a class="mn__primary mn__primary--eup" href="' + esc(missionHref(c.mission_id)) + '" data-take-mission="' + esc(c.mission_id) + '" aria-label="Join this mission and do it">' + EUP_MARK + '</a>' : '') +
        '<a class="mn__quiet" href="' + esc(receiptHref(c.assignment_id)) + '">Receipt</a>' +
        fundButtonHtml(c) +
      '</div>' + missionStatsHtml(c.mission_id) + globeChipHtml(c.mission_id) + '</div>';
  }
  /* MADE TOGETHER (owner, 2026-10-14: "a jointly credited project linked to
     both profiles"). A joint post carries metadata.collaboration, which a
     member could forge, so the card is drawn only for posts the server
     vouches for (action_collaboration_cards): both credits by name, the
     work, and whether the desk has verified the pair. */
  function collaborationCardHtml(postId) {
    var c = postId && state.collabCards && state.collabCards[postId];
    if (!c) return "";
    var credits = (c.credits || []).map(function (p) {
      return p.handle ? '<button type="button" class="mn__collab-credit" data-person="' + esc(p.handle) + '">' + esc(p.name || "Action Network member") + '</button>' : '<span class="mn__collab-credit">' + esc(p.name || "Action Network member") + '</span>';
    });
    return '<div class="mn__actcard mn__actcard--collab">' +
      '<p class="mn__actcard-eyebrow">' + (c.verified ? "Verified collaboration" : "Made together · in review") + '</p>' +
      '<p class="mn__actcard-title">' + esc(c.title) + '</p>' +
      '<p class="mn__collab-by">' + esc(c.kind || "work") + ' · by ' + credits.join(' <span aria-hidden="true">&amp;</span> ') + '</p>' +
      '<div class="mn__actcard-row">' +
        (c.link ? '<a class="mn__quiet" href="' + esc(c.link) + '" target="_blank" rel="noopener noreferrer">Open the work ↗</a>' : '') +
        (c.mission_open && !MISSIONS_OFF ? '<a class="mn__primary mn__primary--eup" href="' + esc(missionHref(c.mission_id)) + '" data-take-mission="' + esc(c.mission_id) + '" aria-label="Join this mission and do it">' + EUP_MARK + '</a>' : '') +
      '</div>' + (MISSIONS_OFF ? '' : missionStatsHtml(c.mission_id)) + '</div>';
  }
  function loadCollaborationCards(items) {
    var ids = (items || []).map(function (it) { var p = it.post; return p && p.metadata && p.metadata.collaboration ? p.id : null; })
      .filter(function (id) { return id && !(state.collabCards && id in state.collabCards); });
    if (!ids.length) return Promise.resolve(false);
    state.collabCards = state.collabCards || {};
    ids.forEach(function (id) { state.collabCards[id] = null; });
    return sbRpc("action_collaboration_cards", { p_post_ids: ids.slice(0, 100) }).then(function (rows) {
      (rows || []).forEach(function (c) { state.collabCards[c.post_id] = c; });
      return (rows || []).length > 0;
    }).catch(function () { return false; });
  }
  function loadActionCards(items) {
    if (MISSIONS_OFF) return Promise.resolve(false);
    var ids = (items || []).map(function (it) { var p = it.post; return p && p.post_type === "share" && p.metadata && p.metadata.action ? p.id : null; })
      .filter(function (id) { return id && !(state.actionCards && id in state.actionCards); });
    if (!ids.length) return Promise.resolve(false);
    state.actionCards = state.actionCards || {};
    ids.forEach(function (id) { state.actionCards[id] = null; });
    return sbRpc("action_feed_cards", { p_post_ids: ids.slice(0, 100) }).then(function (rows) {
      (rows || []).forEach(function (c) { state.actionCards[c.post_id] = c; });
      return (rows || []).length > 0;
    }).catch(function () { return false; });
  }

  /* A POST CAN POINT AT THE MAP. Only posts the server ties to a mission
     (action_feed_cards / action_offer_cards) carry one, and only missions
     an admin has pinned publicly have a place on the Earth. */
  function postMissionId(item) {
    var post = item && (item.post || item), id = post && (post.id || item.post_id);
    var c = id && ((state.actionCards && state.actionCards[id]) || state.actionOffers[id]);
    return c && c.mission_id || "";
  }
  /* Tapping a post (not one of its buttons or links) shows its mission on
     the Earth, only when the server ties the post to a pinned mission. */
  function bindPostTaps(root) {
    root.querySelectorAll("[data-post-id]").forEach(function (card) {
      card.addEventListener("click", function (e) {
        /* on the World a picture is a thumbnail; a tap opens them all across the card */
        if (e.target.closest && e.target.closest(".mn__post-media") && !e.target.closest("video,audio")) { card.classList.toggle("is-media-open"); return; }
        if (e.target.closest && e.target.closest("a,button,input,textarea,select,label,video,audio,form,.mn__comments")) return;
        var mid = postMissionId(findPost(card.getAttribute("data-post-id")));
        if (mid && state.world.pins[mid]) focusOnGlobe(mid);
      });
    });
  }
  /* what a post actually carries, for the feed tabs; no invented topics */
  /* THE FEED'S SCOPE (owner's reference, 2026-10-19). Local is the place the Earth is on (the country picked on the globe):
     stories that mention it. Member posts are not placed on the map, so Local shows the place's news and says so. News is the
     publishers only; Global is the one interleaved stream. Live and People are views, not scopes. */
  function localPlace() {
    var label = $("huRegionLabel") ? String($("huRegionLabel").textContent || "").trim() : "";
    return label && label !== "All regions" ? label : "";
  }
  /* A story's place reads "City, Area, Country" (GDELT's label). It is in the picked country when its tail names that
     country: the globe's name for it, or one of the names publishers use. A substring is not enough (Guinea is not
     Papua New Guinea; Niger is not Nigeria), so the match is the whole tail after a comma, or the whole label. */
  /* THE PLACE CARD (owner, 2026-10-21: "the card that shows up shouldn't be the full width of the top of the screen. It should
     only be in the middle ... how many users are from there ... how many news articles are from there right now ... how many
     posts from users are there"). The page draws it, so it sits below the page's bar and over its own buttons rather than
     under them; the buttons step down while it shows. A count the globe does not know yet is a dash, never a made-up zero. */
  function placeStats(s) {
    var n = function (v) { return typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v) : null; };
    return s && typeof s === "object" ? { news: n(s.news), posts: n(s.posts), members: n(s.members), states: s.states === true } : { news: null, posts: null, members: null, states: false };
  }
  function paintPlaceCard(c) {
    var card = $("mnPlaceCard");
    if (!card) return;
    if (!c) { card.hidden = true; card.innerHTML = ""; placeCardRoom(); return; }
    var s = c.stats || placeStats(null), st8 = c.state;
    var cell = function (v, label) { return '<span class="mn__place-stat"><b>' + (v === null ? "\u2014" : esc(v.toLocaleString("en-US"))) + '</b><small>' + esc(label) + '</small></span>'; };
    /* the second line is the country a state is in, or how to pick a state: the card stays two rows, so it covers little globe */
    var sub = st8 ? c.name : s.states ? "Double-tap a state to choose it" : "";
    card.innerHTML = '<div class="mn__place-head"><span class="mn__place-name"><b>' + esc(st8 ? st8.name : c.name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
      '<button type="button" class="mn__place-close" aria-label="' + esc(st8 ? "Show all of " + c.name : "Show every country") + '">\u00d7</button></div>' +
      '<div class="mn__place-stats">' + cell(s.news, "news \u00b7 24 h") + (st8 ? "" : cell(s.posts, "posts") + cell(s.members, "members")) + '</div>';
    card.querySelector(".mn__place-close").onclick = function () { tellWorld(st8 ? { type: "hu:country-back" } : { type: "hu:select-country", code: null }); };
    card.hidden = false;
    placeCardRoom();
  }
  /* below the page's bar; the globe's buttons (the corner stack and the Live badge, which step down together) and the headline
     step aside for it. The buttons are measured by their layout boxes, which their step leaves alone, so a repaint never reads
     its own push */
  function placeCardRoom() {
    var home = $("mnWorld"), card = $("mnPlaceCard"), head = home && home.querySelector(".wt-headline"), bar = document.querySelector(".mn__top");
    if (!home || !card) return;
    home.style.removeProperty("--mn-place-push"); home.classList.remove("has-place-card", "place-card-over-headline"); card.style.removeProperty("top");
    if (card.hidden) return;
    home.classList.add("has-place-card");
    var h = home.getBoundingClientRect(), b = bar && bar.getBoundingClientRect();
    if (b && b.height && b.bottom > h.top && b.top < h.top + 40) card.style.top = Math.ceil(b.bottom - h.top + 8) + "px";
    var box = function (el) { return el && !el.hidden && el.offsetWidth && el.offsetParent === card.offsetParent ? { left: el.offsetLeft, top: el.offsetTop, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight } : null; };
    var c = box(card), over = function (r) { return r && r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top; };
    var aside = [box($("mnWorldStack")), box($("mnWorldLive"))].filter(Boolean);
    if (c && aside.some(over)) home.style.setProperty("--mn-place-push", Math.ceil(c.bottom + 10 - Math.min.apply(null, aside.map(function (r) { return r.top; }))) + "px");
    var cr = card.getBoundingClientRect(), hr = head && head.getBoundingClientRect();
    if (hr && hr.width && hr.left < cr.right && hr.right > cr.left && hr.top < cr.bottom && hr.bottom > cr.top) home.classList.add("place-card-over-headline");
  }
  window.addEventListener("resize", function () { placeCardRoom(); });
  window.addEventListener("mcc:world-mode", function () { requestAnimationFrame(placeCardRoom); });
  /* the state the globe picked: its name, and its shape as polygons [outer ring, ...holes] of [lon, lat] (checked, never trusted) */
  function worldState(s) {
    if (!s || typeof s.name !== "string" || !s.name.trim() || !Array.isArray(s.polygons)) return null;
    var ok = function (ring) { return Array.isArray(ring) && ring.length >= 4 && ring.every(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); }); };
    var polygons = s.polygons.filter(function (poly) { return Array.isArray(poly) && poly.length && poly.every(ok); });
    return polygons.length ? { key: String(s.key || "").slice(0, 60), name: s.name.trim().slice(0, 80), type: typeof s.type === "string" ? s.type.slice(0, 40) : "", polygons: polygons } : null;
  }
  /* is a story placed inside the picked state? Only a story with a point can be; holes (an enclave) are not the state */
  function newsInState(n, s) {
    var x = n && n.lon, y = n && n.lat;
    if (typeof x !== "number" || typeof y !== "number") return false;
    var inRing = function (ring) {
      var inside = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    return s.polygons.some(function (poly) { return inRing(poly[0]) && !poly.slice(1).some(inRing); });
  }
  function placeInCountry(place, country) {
    var aliases = {
      "united states of america": ["united states", "usa", "u.s.", "us"], "united kingdom": ["uk", "britain", "great britain", "england", "scotland", "wales", "northern ireland"],
      "russia": ["russian federation"], "czechia": ["czech republic"], "myanmar": ["burma"], "c\u00f4te d'ivoire": ["ivory coast", "cote d'ivoire"],
      "eswatini": ["swaziland"], "turkey": ["t\u00fcrkiye", "turkiye"], "laos": ["lao people's democratic republic", "lao pdr"], "vietnam": ["viet nam"],
      "syria": ["syrian arab republic"], "iran": ["iran, islamic republic of"], "bolivia": ["bolivia, plurinational state of"], "venezuela": ["venezuela, bolivarian republic of"],
      "tanzania": ["united republic of tanzania"], "moldova": ["republic of moldova"], "brunei": ["brunei darussalam"], "timor-leste": ["east timor"],
      "bahamas": ["the bahamas", "bahamas, the"], "gambia": ["the gambia", "gambia, the"], "congo": ["republic of the congo", "congo, republic of the", "congo-brazzaville"],
      "dem. rep. congo": ["democratic republic of the congo", "congo, democratic republic of the", "dr congo", "congo-kinshasa"],
      "north korea": ["korea, north", "democratic people's republic of korea"], "south korea": ["korea, south", "republic of korea", "korea"],
      "netherlands": ["the netherlands"], "bosnia and herz.": ["bosnia and herzegovina"], "central african rep.": ["central african republic"],
      "dominican rep.": ["dominican republic"], "eq. guinea": ["equatorial guinea"], "falkland is.": ["falkland islands"], "s. sudan": ["south sudan"],
      "solomon is.": ["solomon islands"], "w. sahara": ["western sahara"], "n. cyprus": ["northern cyprus"], "north macedonia": ["macedonia"],
      "palestine": ["palestinian territory", "west bank", "gaza strip"], "taiwan": ["taiwan, province of china"]
    };
    if (!place || !country) return false;
    var tail = String(place).toLocaleLowerCase().trim(), name = String(country.name || country).toLocaleLowerCase().trim();
    if (!name) return false;
    return [name].concat(aliases[name] || []).some(function (n) { return tail === n || tail.slice(-n.length - 2) === ", " + n; });
  }
  /* The feature flag comes from the Worker. Country comes only from its
     coarse Cloudflare edge signal; choosing a different country on the
     globe overrides that default. Never auto-tag a member's posts. */
  function placeName(code) {
    try { return new Intl.DisplayNames([navigator.language || "en"],{type:"region"}).of(code) || code; }
    catch (e) { return code; }
  }
  function paintPlaceOptIn() {
    var widget = $("mnPostPlaceLabel"), check = $("mnPostPlaceOptIn"), country = state.world.country;
    if (!widget) return;
    var available = !!(state.placeScope.enabled && country && /^[A-Z]{2}$/.test(country.code||"") &&
      $("mnVisibility") && $("mnVisibility").value === "public");
    widget.hidden = !available;
    var target = widget.querySelector("span");
    if (target) target.textContent = available ? "Add this public post to " + (country.name || placeName(country.code)) + "'s local feed" : "";
    if (!available && check) check.checked = false;
  }
  function ensurePlaceOptIn() {
    if ($("mnPostPlaceLabel") || !$("mnComposer")) return;
    var actions = $("mnComposer").querySelector(".mn__composer-actions");
    if (!actions) return;
    var label = document.createElement("label"), check = document.createElement("input"), txt = document.createElement("span");
    label.id = "mnPostPlaceLabel"; label.className = "mn__place-optin"; label.hidden = true;
    check.id = "mnPostPlaceOptIn"; check.type = "checkbox";
    label.append(check,txt);
    actions.parentNode.insertBefore(label,actions);
    if ($("mnVisibility")) $("mnVisibility").addEventListener("change",paintPlaceOptIn);
    paintPlaceOptIn();
  }
  function loadPlaceStatus() {
    fetch("https://api.mccluster.org/v1/world/place-scope", { credentials:"omit", cache:"no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (status) {
        if (!status || status.enabled !== true) return;
        state.placeScope.enabled = true;
        /* the country Cloudflare read from this connection: a signed-out visitor's region (owner, 2026-10-20) */
        state.placeScope.home = typeof status.country === "string" && /^[A-Z]{2}$/.test(status.country) ? status.country : null;
        ensurePlaceOptIn();
        if (!state.world.country && typeof status.country === "string" && /^[A-Z]{2}$/.test(status.country)) {
          var name = placeName(status.country);
          state.world.country = { code:status.country, name:name };
          if ($("huRegionLabel")) $("huRegionLabel").textContent = name;
          setFeedScope("local"); // Country only; no GPS and no user-post location write.
        } else if (state.feedScope === "local") loadPlaceFeed(true);
        paintPlaceOptIn();
        loadLivePlaces();
        setInterval(function () { if (!document.hidden) loadLivePlaces(); }, 60000);
      }).catch(function () { /* remain on the working Global feed */ });
  }
  /* broadcasts their hosts placed in a country mark it on the globe (js/action-globe.js), beside the audio conversations */
  function loadLivePlaces() {
    fetch("https://api.mccluster.org/v1/world/live-places", { credentials:"omit", cache:"no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (out) {
        if (!out || !Array.isArray(out.places)) return;
        state.placeScope.livePlaces = out.places;
        tellWorld({ type: "hu:live-places", source: "video", places: out.places });
      }).catch(function () {});
  }
  var GUEST_REGION_ASK = "Sign in to read another country's feed.";
  function loadPlaceFeed(reset) {
    var p = state.placeScope, c = state.world.country;
    /* Clear prior country's contents synchronously; even a delayed old
       response cannot reveal one country's feed beneath another heading. */
    if (reset) {
      p.seq++; p.country=c && c.code || null;
      p.postBefore=null; p.newsBefore=null; p.posts=[]; p.news=[]; p.lives=[]; p.loaded=false; p.error="";
    }
    if (!p.enabled || !c || !/^[A-Z]{2}$/.test(c.code||"")) {
      if (state.feedScope === "local") renderFeed(false);
      return Promise.resolve();
    }
    if (!reset && !p.postBefore && !p.newsBefore) return Promise.resolve();
    var seq = ++p.seq, url="https://api.mccluster.org/v1/world/region-feed?country=" +
      encodeURIComponent(c.code) + "&limit=20";
    if (!reset && p.postBefore) url += "&post_before=" + encodeURIComponent(p.postBefore);
    else if (!reset) url += "&posts=0";
    if (!reset && p.newsBefore) url += "&news_before=" + encodeURIComponent(p.newsBefore);
    else if (!reset) url += "&news=0";
    /* a signed-out visitor reads their own region only; the Worker holds the same rule (world-region-feed.js) */
    if (state.guest && c.code !== p.home) {
      p.working=false; p.loaded=true; p.error=GUEST_REGION_ASK;
      if (state.feedScope === "local") renderFeed(false);
      return Promise.resolve();
    }
    p.working=true; p.error="";
    if (state.feedScope === "local") renderFeed(false);
    /* a member's session rides along, so the Worker can tell a member who may travel from a visitor who may not */
    var token = state.guest ? "" : sessionToken();
    return fetch(url,{credentials:"omit",cache:"no-store",headers:token ? { authorization:"Bearer " + token } : {}}).then(function (r) {
      if (r.status === 403) { var refused = new Error(GUEST_REGION_ASK); refused.signIn = true; throw refused; }
      if (!r.ok) throw new Error("The country's feed is not available yet.");
      return r.json();
    }).then(function (data) {
      if (seq !== p.seq || p.country !== c.code ||
          !data || data.ok !== true || data.country !== c.code || data.available !== true)
        return;
      p.posts = reset ? (data.posts||[]) : p.posts.concat(data.posts||[]);
      if (reset) p.lives = (data.lives||[]).filter(function (l) { return l && WORLD_ID.test(String(l.id||"")) && l.title; }).slice(0,6);
      var incoming = (data.news||[]).map(cleanNews).filter(Boolean);
      p.news = reset ? incoming : p.news.concat(incoming);
      p.postBefore = data.next_post_before || null;
      p.newsBefore = data.next_news_before || null;
      p.loaded=true; p.error="";
      if (state.feedScope === "local") renderFeed(false);
      paintMore();
    }).catch(function (error) {
      if (seq !== p.seq) return;
      p.error=error && error.signIn ? GUEST_REGION_ASK : "This country's feed is temporarily unavailable.";
      p.loaded=true;
      if (state.feedScope === "local") renderFeed(false);
    }).finally(function () { if (seq === p.seq) p.working=false; });
  }
  function paintFeedScope() {
    var scope = state.feedScope || "global";
    document.querySelectorAll("[data-feed-scope]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.feedScope === scope)); });
    var body = $("mnPostBody"), place = localPlace();
    if (body) body.placeholder = "Share a live moment from " + (place || "the world") + "\u2026";
    paintPlaceOptIn();
  }
  function setFeedScope(scope) {
    state.feedScope = ["local", "global", "news"].indexOf(scope) >= 0 ? scope : "global";
    paintFeedScope();
    if (state.feedScope === "local" && state.placeScope.enabled) loadPlaceFeed(true);
    else renderFeed(false);
    paintMore();
    track("feed_scope", { scope: state.feedScope });
  }
  function feedMatches(item, query) {
    /* a news card answers to its headline, its publisher and the place it mentions */
    if (item && item.news) return [item.title, item.domain, item.place].join(" ").toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) !== -1;
    var post = item && (item.post || item) || {}, actor = item.actor || post.actor || {};
    return [post.body, actor.display_name, actor.mccluster_id].join(" ").toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) !== -1;
  }
  function globeChipHtml(missionId) {
    if (!missionId || !state.world.pins[missionId]) return "";
    return '<button class="mn__globe-chip" type="button" data-globe-mission="' + esc(missionId) + '">Locate on globe</button>';
  }

  /* One comment system in the timeline: post replies use the existing
     authorized Mnet route, news replies use the reviewed news-discussion route.
     Nothing is copied from a publisher to create the discussion. */
  function discussionHtml(kind, id) {
    return '<section class="mn__comments" data-discussion-kind="' + esc(kind) +
      '" data-discussion-id="' + esc(id || '') + '" aria-label="Conversation" hidden>' +
      '<div class="mn__comments-list" role="list"></div>' +
      '<form class="mn__comment-form"><label class="sr-only">Write a comment</label>' +
      '<input class="mn__comment-input" type="text" maxlength="1000" autocomplete="off" placeholder="Add to the conversation..." aria-label="Write a comment">' +
      '<button type="submit">Reply</button></form>' +
      '<p class="mn__comment-status" role="status" aria-live="polite"></p></section>';
  }
  function discussionRoute(panel) {
    var type = panel.dataset.discussionKind, id = panel.dataset.discussionId;
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    return type === 'news' ? '/v1/world/news/' + encodeURIComponent(id) + '/comments'
      : type === 'post' ? '/v1/mnet/posts/' + encodeURIComponent(id) + '/replies' : null;
  }
  function paintDiscussion(panel, comments) {
    var list = panel.querySelector('.mn__comments-list');
    list.replaceChildren();
    if (!comments.length) {
      var empty = document.createElement('p');
      empty.className = 'mn__comments-empty';
      empty.textContent = 'Start the conversation.';
      list.appendChild(empty);
      return;
    }
    comments.forEach(function (comment) {
      var row = document.createElement('div');
      row.className = 'mn__comment';
      row.setAttribute('role','listitem');
      var by = document.createElement('strong');
      by.textContent = String(comment.actor?.display_name || comment.actor?.mccluster_id || 'Member').slice(0,100);
      var time = document.createElement('time');
      time.textContent = timeAgo(comment.created_at || '');
      var body = document.createElement('p');
      body.textContent = String(comment.body || '').slice(0,1000);
      row.append(by,time,body);
      list.appendChild(row);
    });
  }
  function loadDiscussion(panel) {
    var path = discussionRoute(panel);
    if (!path) return Promise.resolve();
    var status = panel.querySelector('.mn__comment-status');
    setStatus(status,'Loading comments…');
    var read = state.guest
      ? fetch('https://api.mccluster.org' + path, { credentials:'omit' }).then(parse)
      : api(path);
    return read.then(function (data) {
      if (!panel.isConnected || panel.hidden) return;
      paintDiscussion(panel, Array.isArray(data.comments) ? data.comments : []);
      panel.dataset.loaded='true';
      setStatus(status,'');
    }).catch(function (error) {
      if (!panel.isConnected || panel.hidden) return;
      setStatus(status,error.message || 'Comments are temporarily unavailable.','error');
    });
  }
  function bindDiscussions(root) {
    root.querySelectorAll('[data-discussion-toggle]').forEach(function (button) {
      button.onclick = function (e) {
        e.preventDefault();
        var card = button.closest('.mn__post-card'), panel = card?.querySelector('.mn__comments');
        if (!panel) return;
        if (state.guest && panel.dataset.discussionKind === 'post') { askToSignIn('comment'); return; }
        var open = panel.hidden;
        panel.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        if (open) {
          if (!panel.dataset.loaded) void loadDiscussion(panel);
          panel.querySelector('input')?.focus({preventScroll:true});
        }
      };
    });
    root.querySelectorAll('.mn__comment-form').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (state.guest) { askToSignIn('comment'); return; }
        if (askToFinish('post')) return;
        var panel = form.closest('.mn__comments'), route = panel && discussionRoute(panel);
        var input = form.querySelector('input'), body = input?.value.trim() || '';
        var status = panel?.querySelector('.mn__comment-status'), button = form.querySelector('button');
        if (!route || !body || [...body].length > 1000) { setStatus(status,'Write a comment under 1,000 characters.','error'); return; }
        button.disabled = true;
        setStatus(status,'Posting…');
        api(route,{method:'POST',body:{body}}).then(function () {
          input.value = '';
          return loadDiscussion(panel);
        }).then(function () { setStatus(status,'Comment posted.','ok'); }).catch(function (error) {
          setStatus(status,error.message || 'Comment could not be posted.','error');
        }).finally(function () { button.disabled=false; });
      });
    });
  }

  function bindFeedActions(root) {
    if (state.guest) {
      /* read-only: the same buttons, but each one is a door to sign in,
         and nothing is sent. Share works, because every guest post is public. */
      root.querySelectorAll("[data-take-mission],[data-action=save],[data-person],[data-guest-ask]").forEach(function (b) {
        b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); askToSignIn(b.getAttribute("data-action") || (b.hasAttribute("data-take-mission") ? "mission" : "act")); };
      });
      /* the support rail is public, so Fund answers a guest too */
      root.querySelectorAll("[data-fund-mission]").forEach(function (b) {
        b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); toggleFundLine(b.closest(".mn__actcard") || b.closest("[data-post-id]"), b.getAttribute("data-fund-mission"), b.getAttribute("data-campaign") || ""); };
      });
      root.querySelectorAll("[data-globe-mission]").forEach(function (b) {
        b.onclick = function () { focusOnGlobe(b.getAttribute("data-globe-mission")); };
      });
      root.querySelectorAll("[data-action=share]").forEach(function (b) { b.onclick = function () { sharePost(b); }; });
      bindPostTaps(root);
      return;
    }
    /* a Local post's media comes through the same authorized single-post read every post uses */
    root.querySelectorAll("[data-unlock-media]").forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-unlock-media"); b.disabled = true;
        api("/v1/mnet/posts/" + encodeURIComponent(id)).then(function (one) {
          if (!one || !one.post) throw new Error("This post is not available.");
          var list = state.placeScope.posts || [];
          for (var i = 0; i < list.length; i++) if ((list[i].post && list[i].post.id) === id || list[i].post_id === id)
            list[i] = { item_type:"post", post_id:one.post.id, occurred_at:list[i].occurred_at || one.post.created_at, post:one.post, actor:one.actor || list[i].actor };
          renderFeed(false);
        }).catch(function (e) { b.disabled = false; setStatus($("mnFeedStatus"), e.message || "Could not open that post.", "error"); });
      };
    });
    root.querySelectorAll("[data-take-mission]").forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        if (askToFinish("mission")) return;
        var content = a.getAttribute("data-content"), source = a.getAttribute("data-source"), missionId = a.getAttribute("data-take-mission");
        if (content && /^[0-9a-f-]{36}$/i.test(content)) {
          missions.content = content;
          missions.attributedMission = missionId;
          missions.source = source && /^[a-z0-9][a-z0-9._-]{0,31}$/i.test(source) ? source.toLowerCase() : "network";
        } else {
          missions.content = ""; missions.source = ""; missions.attributedMission = "";
        }
        setView("missions");
        openMission(missionId);
      };
    });
    root.querySelectorAll("[data-globe-mission]").forEach(function (b) {
      b.onclick = function () { focusOnGlobe(b.getAttribute("data-globe-mission")); };
    });
    root.querySelectorAll("[data-fund-mission]").forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); toggleFundLine(b.closest(".mn__actcard") || b.closest("[data-post-id]"), b.getAttribute("data-fund-mission"), b.getAttribute("data-campaign") || ""); };
    });
    root.querySelectorAll("[data-action=share]").forEach(function (b) {
      b.onclick = function () { sharePost(b); };
    });
    root.querySelectorAll("[data-action=save]").forEach(function (b) {
      b.onclick = function () { toggleBookmark(b.dataset.post, b); };
    });
    root.querySelectorAll("[data-action=delete]").forEach(function (b) {
      b.onclick = function () { deletePost(b.dataset.post, b); };
    });
    root.querySelectorAll("[data-person]").forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openPerson(b.dataset.person); };
    });
    bindPostTaps(root);
    resolvePostMedia(root);
  }

  function sharePost(b) {
    var item = findPost(b.dataset.post), post = item && (item.post || item);
    if (!post || post.visibility !== "public") {
      setStatus($("mnFeedStatus"), "Only public posts can be shared externally.", "error");
      return;
    }
    var url = new URL(location.href);
    url.searchParams.set("view", "feed");
    url.searchParams.set("post", b.dataset.post);
    var link = url.toString();
    if (navigator.share) {
      navigator.share({ title:"Equity Uprise", url:link }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () { b.textContent = "Copied"; }).catch(function () { window.prompt("Copy post link",link); });
    } else window.prompt("Copy post link",link);
  }

  function renderFeed(append) {
    state.shownNews = [];
    try { return paintFeed(append); }
    finally {
      var ids = state.shownNews.map(function (n) { return n.id; }).join("|");
      if (ids !== state.shownNewsKey) { state.shownNewsKey = ids; window.dispatchEvent(new CustomEvent("mcc:world-news-shown")); }
    }
  }
  function paintFeed(append) {
    var host = $("mnFeed");
    if (!append) host.innerHTML = "";
    paintMore();
    var focus = state.world.focus, query = state.world.query;
    var regionMode = state.feedScope === "local" && state.placeScope.enabled;
    var items = regionMode ? state.placeScope.posts : state.feed;
    /* World geography is a country-scoped server read when the feature is enabled. */
    var news = focus && focus.filter ? [] : state.news;
    if (regionMode && !(focus && focus.filter)) news = state.placeScope.news;
    paintNewsCredit(false);
    if (!items.length && !news.length) {
      if (regionMode) {
        host.innerHTML=placeLivesHtml() + '<div class="mn__empty">' + esc(
          state.placeScope.error || (!state.world.country ? "Tap a country on the globe." :
          !state.placeScope.loaded ? "Loading local posts and news…" :
          "No public post or news item is associated with this country yet.")) + '</div>';
        bindPlaceLives(host); paintMore(); return;
      }
      host.innerHTML = state.guest
        ? '<div class="mn__empty">No public posts yet. Sign in to see your network and post the first thing.</div>'
        : '<div class="mn__empty">Nothing on the feed yet. Take a mission below, or post the first thing.</div>';
      return;
    }
    if (focus && focus.filter) {
      items = items.filter(function (item) { return postMissionId(item) === focus.mission_id; });
      if (!items.length) {
        /* narrowed to nothing: say so, and one tap gives the whole feed back
           while the mission stays picked */
        host.innerHTML = '<div class="mn__empty">Nothing in your feed about this mission yet. Open it, do the work, and your proof can be the first post here.' +
          '<p class="mn__empty-row"><button class="mn__world-filter" type="button" data-world-unfilter>See every post</button></p></div>';
        host.querySelector("[data-world-unfilter]").onclick = function () { setWorldFocus(Object.assign({}, state.world.focus, { filter: false })); };
        return;
      }
    }
    if (query) {
      items = items.filter(function (item) { return feedMatches(item, query); });
      news = news.filter(function (n) { return feedMatches(n, query); });
    }
    var scope = state.feedScope || "global", place = scope === "local" ? localPlace() : "";
    if (scope === "news") items = [];
    if (scope === "local" && !regionMode) {
      items = [];
      var picked = state.world.country || { name: place };
      news = place ? news.filter(function (n) { return n.country_code && picked.code ? n.country_code === picked.code : placeInCountry(n.place, picked); }) : [];
    }
    /* a state picked on the globe: the stories placed inside it (member posts carry only their country, and stay) */
    var pickedState = scope === "local" && state.world.country && state.world.country.state;
    if (pickedState) news = news.filter(function (n) { return newsInState(n, pickedState); });
    if (!items.length && !news.length) {
      host.innerHTML = '<div class="mn__empty">' + esc(
        scope === "local" && !place ? "Tap a country on the globe to see the news that mentions it. Member posts are not placed on the map yet." :
        scope === "local" ? "No story mentions " + place + " yet." :
        scope === "news" ? "No world news is loaded yet." :
        query ? "Nothing in your feed matches \u201c" + query + "\u201d." : "Nothing on the feed yet.") + '</div>';
      return;
    }
    var seen = state.seen || (state.seen = {}), order = 0;
    state.shownNews = news.slice();
    host.innerHTML = (regionMode ? placeLivesHtml() : "") + interleaveFeed(items, news).map(function (item) {
      if (item.news) {
        var card = newsCard(item), nkey = "news:" + item.id;
        if (!seen[nkey]) {
          seen[nkey] = true;
          card = card.replace('<article class="mn__post-card', '<article style="--i:' + (order++ % 8) + '" class="mn__post-card is-new');
        }
        return card;
      }
      if (item.item_type === "activity") {
        var p = item.payload || {};
        return '<article class="mn__post-card"><div class="mn__post-head">' + authorHtml(item.actor) + '<span class="mn__author-sub">' + esc(timeAgo(item.occurred_at)) + '</span></div><p class="mn__post-body">' + esc(p.summary || p.text || "Activity on McCluster") + '</p></article>';
      }
      var html = postCard(item), key = (item.post && item.post.id) || item.post_id || "";
      /* only posts arriving for the first time rise in, a beat apart */
      if (key && !seen[key]) {
        seen[key] = true;
        html = html.replace('<article class="mn__post-card', '<article style="--i:' + (order++ % 8) + '" class="mn__post-card is-new');
      }
      return html;
    }).join("");
    /* the licence's credit rides with the news: shown whenever a news card is */
    paintNewsCredit(news.length > 0);
    bindFeedActions(host);
    bindNewsActions(host);
    bindDiscussions(host);
    bindPlaceLives(host);
  }
  /* LIVES OF THE PLACE (owner, 2026-10-19: "the news plus the posts and lives of that area"): broadcasts their host
     placed in this country lead its feed. Watching a broadcast is for members, as everywhere else on Live. */
  function placeLivesHtml() {
    var list = state.placeScope.lives || [], c = state.world.country;
    if (!list.length || !c) return "";
    var where = c.name || placeName(c.code);
    return '<section class="mn__place-lives" aria-label="Live in ' + esc(where) + '"><p class="mn__eyebrow">Live in ' + esc(where) + '</p>' +
      '<div class="mn__place-lives-row">' + list.map(function (l) {
        return '<button class="mn__place-live" type="button" data-place-live="' + esc(l.id) + '"><span class="mn__livehero-badge"><i aria-hidden="true"></i>Live</span>' +
          '<b>' + esc(l.title) + '</b><span>' + esc((l.host && l.host.display_name) || "Host") + ' · ' + esc(timeAgo(l.started_at)) + '</span></button>';
      }).join("") + '</div></section>';
  }
  function bindPlaceLives(host) {
    host.querySelectorAll("[data-place-live]").forEach(function (b) {
      b.onclick = function () {
        if (state.guest) { askToSignIn("live"); return; }
        if (!(window.MCC_LIVE && window.MCC_LIVE.openPlaced)) return;
        Promise.resolve(window.MCC_LIVE.openPlaced(b.getAttribute("data-place-live"))).then(function (how) {
          if (how === "open") return;
          /* never a tap that silently does nothing */
          var note = b.querySelector("[data-place-live-note]") || document.createElement("span");
          note.setAttribute("data-place-live-note", ""); note.className = "mn__place-live-note";
          note.textContent = how === "ended" ? "This broadcast has ended." : "This broadcast could not be opened. Try again.";
          if (!note.parentNode) b.appendChild(note);
          if (how === "ended") b.disabled = true;
        });
      };
    });
  }

  /* A THIN FEED STILL HAS SOMETHING TO DO. While the network is small, open
     missions sit under the feed so a new member always has a next move. */
  function paintFeedMissions() {
    var host = $("mnFeedMissions");
    if (!host) return;
    if (MISSIONS_OFF || state.feed.length >= 8) { host.hidden = true; return; }
    sbRest("action_missions?status=eq.open&select=id,title,description,domain&order=created_at.desc&limit=3").then(function (rows) {
      rows = rows || [];
      host.hidden = !rows.length;
      host.innerHTML = rows.length ? '<div class="mn__section-head"><div><p class="mn__eyebrow">Put it into action</p><h2>Open missions</h2></div><button class="mn__quiet" type="button" data-mn-goto="missions">All missions</button></div>' +
        rows.map(function (m) {
          return '<button class="mn__feedmission" type="button" data-take-mission="' + esc(m.id) + '"><span class="mn__eyebrow">' + esc(m.domain || "community") + '</span><b>' + esc(m.title) + '</b><span>' + esc(m.description || "") + '</span></button>';
        }).join("") : "";
      host.querySelectorAll("[data-take-mission]").forEach(function (b) { b.onclick = function () { missions.content="";missions.source="";missions.attributedMission="";setView("missions"); openMission(b.getAttribute("data-take-mission")); }; });
      var all = host.querySelector("[data-mn-goto]"); if (all) all.onclick = function () { setView("missions"); };
    }).catch(function () { host.hidden = true; });
  }

  function skeleton(n) {
    var one = '<div class="mn__skel" aria-hidden="true"><i class="mn__skel-av"></i><div><i></i><i></i><i class="is-short"></i></div></div>';
    return new Array(n + 1).join(one);
  }

  /* WORLD NEWS IN THE FEED (owner, 2026-10-15: "GDELT news as the feed … sprinkled into that. At a ratio to like
     one … from them. But like, we gotta ingest it so it's still from us."). The Worker ingests
     GDELT into the McCluster plane and serves it back (GET /v1/world/news); this page reads that, never GDELT. News is
     free for everyone, so the read is a bare public GET with no session, for a guest and a member alike, beside the
     posts' read. A news read that fails, or answers anything but a page of items, leaves the posts as they were. A
     story's place is where the article MENTIONS somewhere (GDELT's extraction), never where something happened. */
  var FEED_NEWS_PER_POST = 1, NEWS_API = "https://api.mccluster.org/v1/world/news", NEWS_WAIT = 4000;
  function cleanNews(n) {
    if (!n || typeof n !== "object" || !/^https?:\/\//i.test(String(n.url || ""))) return null;
    var id = String(n.id || "").slice(0, 64), title = String(n.title || "").replace(/\s+/g, " ").trim().slice(0, 300), url = safeHttpUrl(n.url);
    if (!id || !title || !url) return null;
    var lat = Number(n.lat), lon = Number(n.lon), located = typeof n.lat === "number" && typeof n.lon === "number" && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    var domain = String(n.domain || "").trim();
    if (!domain) try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch (e) {}
    /* the country GDELT files the story under, as ISO 3166-1 (the Worker maps GDELT's FIPS codes; the browser never sees FIPS) */
    var country = String(n.country || n.country_code || "").toUpperCase();
    return { news: true, id: id, title: title, url: url, domain: domain.slice(0, 120), seen_at: String(n.seen_at || ""), place: n.place ? String(n.place).slice(0, 120) : "", lat: located ? lat : null, lon: located ? lon : null, country_code: /^[A-Z]{2}$/.test(country) ? country : "" };
  }
  /* THE PINS ARE THE CARDS (owner, 2026-10-20: "not all pins are accurate to the map. I saw a post in Russia posted
     somewhere else on the map"). The globe's news pins are the stories the feed is showing right now (a country's
     stories when a country is picked, the search's when searching, none while a mission narrows the feed), never the
     whole stream behind them; js/world-news-globe.js sends them on every render. */
  window.MCC_WORLD_NEWS_ITEMS = function () { return (state.shownNews || []).slice(); };
  /* never rejects, nor throws (even building the address): { ok, items, next } for a page, { ok: false, status } for anything else */
  function fetchNews(before) {
    return Promise.resolve().then(function () {
      return fetch(NEWS_API + "?limit=20" + (before ? "&before=" + encodeURIComponent(before) : ""));
    }).then(function (r) {
      if (!r.ok) return { ok: false, status: r.status };
      return r.json().then(function (d) {
        if (!d || d.ok !== true || !Array.isArray(d.items) || d.unavailable) return { ok: false, status: 0 };
        return { ok: true, items: d.items.map(cleanNews).filter(Boolean), next: typeof d.next_before === "string" && d.next_before ? d.next_before : null };
      });
    }).catch(function () { return { ok: false, status: 0 }; });
  }
  /* Never show news comment inputs before the Worker confirms BOTH that the
     operator enabled the feature and the approved table is actually present.
     No bearer credentials leave the current origin with this public read. */
  function ensureNewsCommentsCapability() {
    if (state.newsCommentsCapabilityAsked || !state.news.length) return;
    state.newsCommentsCapabilityAsked = true;
    fetch('https://api.mccluster.org/v1/world/news/comments-capability',
      { credentials:'omit', cache:'no-store' })
      .then(function (res) { return res.ok ? res.json() : {available:false}; })
      .then(function (data) {
        if (data && data.available === true) {
          state.newsCommentsAvailable = true;
          if ($('mnFeed')) { renderFeed(false); openLinkedPost(); }
        }
      }).catch(function () { /* disabled or unreachable: no unusable UI */ });
  }
  function applyNews(res, before) {
    if (res && res.ok) {
      var list = before ? state.news.slice() : [], have = {};
      list.forEach(function (n) { have[n.id] = true; });
      res.items.forEach(function (n) { if (!have[n.id]) { have[n.id] = true; list.push(n); } });
      state.news = list;
      state.newsBefore = res.next;
      ensureNewsCommentsCapability();
      window.dispatchEvent(new CustomEvent('mcc:world-news-loaded'));
    } else if (before && res && res.status === 400) state.newsBefore = null;
    /* anything else keeps what was there: a first page that did not come is asked for again with the next Load more,
       and a later page that did not come is asked for again from the same cursor */
  }
  /* a pinned post first, then one member post to FEED_NEWS_PER_POST news items; when one runs out, the other carries on */
  function interleaveFeed(posts, news) {
    var out = [], rest = [], p = 0, n = 0, k;
    posts.forEach(function (item) { (item && item.payload && item.payload.pinned ? out : rest).push(item); });
    while (p < rest.length || n < news.length) {
      if (p < rest.length) out.push(rest[p++]);
      for (k = 0; k < FEED_NEWS_PER_POST && n < news.length; k++) out.push(news[n++]);
    }
    return out;
  }
  /* a news card wears the World's card, keyed data-news-id (data-post-id is a member's post): the publisher, when it was
     seen and the place it mentions, the headline in an in-app discovery reader, and the place on the Earth. No pictures and no
     publisher marks: the words only. */
  /* WHERE A STORY IS FROM (owner, 2026-10-20: "they need to say where they're from, like Nigeria"): the chip names the
     country of the place it mentions instead of saying "On the Earth"; a tap still turns the Earth there. */
  function newsCountry(n) {
    var code = String(n.country_code || "").toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) {
      try { var name = new Intl.DisplayNames([navigator.language || "en"], { type: "region" }).of(code); if (name && name !== code) return name; } catch (e) {}
    }
    /* GDELT's label: "City, Area, Country", with the gazetteer's own forms ("Bahamas, The", "Vietnam, Republic Of",
       "Serbia (General)", "Pacific Ocean, Oceans"); the chip names the country, not "The" */
    var parts = String(n.place || "").split(",").map(function (s) { return s.replace(/\s*\(general\)\s*$/i, "").trim(); }).filter(Boolean);
    var tail = parts.pop() || "";
    if (/^oceans?$/i.test(tail)) tail = parts[0] || "";
    else if (/^(the|republic of|islamic republic of|federal republic of|people's republic of|democratic republic of)$/i.test(tail) && parts.length) tail = parts.pop();
    return tail.slice(0, 60);
  }
  function newsCard(n) {
    var sep = '<span class="mn__news-sep" aria-hidden="true">\u00b7</span>', from = newsCountry(n);
    return '<article class="mn__post-card mn__news-card" data-news-id="' + esc(n.id) + '">' +
      '<p class="mn__news-meta"><span class="mn__news-avatar" aria-hidden="true" data-initials="' + esc(String(n.domain || "news").replace(/^www\./, "").slice(0, 2).toUpperCase()) + '"></span><span class="mn__news-domain">' + esc(n.domain) + '</span>' +
        (timeAgo(n.seen_at) ? sep + '<span class="mn__news-time">' + esc(timeAgo(n.seen_at)) + '</span>' : '') +
        (n.place ? sep + '<span class="mn__news-place">' + esc(n.place) + '</span>' : '') + '</p>' +
      '<button type="button" class="mn__news-title" data-news-open="' + esc(n.id) + '">' + esc(n.title) +
        '<span class="sr-only"> (open story)</span></button>' +
      (n.lat !== null && n.lon !== null
        ? '<button class="mn__globe-chip mn__news-chip" type="button" data-news-place data-lat="' + esc(n.lat) + '" data-lon="' + esc(n.lon) + '" data-label="' + esc(n.place) + '" aria-label="Show ' + esc(n.place || from || "the place this story mentions") + ' on the Earth">' + esc(from || "On the Earth") + '</button>'
        : '') +
      (state.newsCommentsAvailable
        ? '<div class="mn__post-actions"><button type="button" class="mn__action mn__action--comment" data-discussion-toggle aria-expanded="false" aria-label="Comment on news">' + ICON.comment + '<span class="mn__action-label">Comment</span></button></div>' + discussionHtml('news', n.id)
        : '') +
    '</article>';
  }
  function paintNewsCredit(on) { var c = $("mnNewsCredit"); if (c) c.hidden = !on; }
  /* Load more while either stream has another page (the news only counts while it is shown) */
  function paintMore() {
    var more = $("mnMore"), focus = state.world.focus;
    if (!more) return;
    if (state.feedScope === "local" && state.placeScope.enabled) {
      more.hidden = !(state.placeScope.postBefore || state.placeScope.newsBefore);
      return;
    }
    more.hidden = !(state.nextBefore || (state.newsBefore && !(focus && focus.filter)));
  }
  function bindNewsActions(root) {
    root.querySelectorAll("[data-news-open]").forEach(function (b) {
      b.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var id = b.getAttribute("data-news-open"),
          all = state.feedScope === "local" && state.placeScope.enabled ? state.placeScope.news : state.news,
          story = all.find(function (n) { return n.id === id; });
        if (!story) return;
        if (window.MCC_WORLD_NEWS_READER && window.MCC_WORLD_NEWS_READER.open) window.MCC_WORLD_NEWS_READER.open(story, b);
        else setStatus($("mnFeedStatus"), "The in-app news reader is temporarily unavailable.", "error");
      };
    });
    root.querySelectorAll("[data-news-place]").forEach(function (b) {
      b.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var lat = Number(b.getAttribute("data-lat")), lon = Number(b.getAttribute("data-lon")), label = String(b.getAttribute("data-label") || "").slice(0, 120);
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        /* the Earth turns to the story's place, so a mission on the strip would be the wrong one: let it go */
        if (state.world.focus) setWorldFocus(null);
        var caption = $("mnWorldCaption");
        if (caption) caption.textContent = label ? label + " \u00b7 mentioned in this story." : "A place this story mentions.";
        var card = b.closest("[data-news-id]");
        tellWorld({ type: "hu:focus-place", lat: lat, lon: lon, label: label, id: card ? card.getAttribute("data-news-id") : "" });
        track("world_news_place", {});
      };
    });
  }

  function loadFeed(reset) {
    if (state.loadingFeed) return Promise.resolve();
    state.loadingFeed = true;
    if (reset) {
      state.nextBefore = null;
      state.feed = [];
      setStatus($("mnFeedStatus"), "");
      if (!$("mnFeed").children.length) $("mnFeed").innerHTML = skeleton(3);
    }
    var publicRead = state.guest || !!needsStep() || !!state.stall;
    var path = (publicRead ? "/v1/mnet/public-feed?limit=20" : "/v1/mnet/feed?app_key=" + encodeURIComponent(APP) + "&limit=20");
    if (!reset && state.nextBefore) path += "&before=" + encodeURIComponent(state.nextBefore);
    /* Load more reads the posts only while they have another page */
    var read = !reset && !state.nextBefore ? Promise.resolve(null) : publicRead ? fetch("https://api.mccluster.org" + path).then(parse) : api(path);
    /* the news, beside it: the first page on a reset, else the next one, unless there is none */
    var newsFrom = reset ? undefined : state.newsBefore, wantNews = newsFrom !== null, seq = wantNews ? ++state.newsSeq : state.newsSeq, drawn = false;
    var news = !wantNews ? Promise.resolve() : fetchNews(newsFrom).then(function (res) {
      if (seq !== state.newsSeq) return;
      applyNews(res, newsFrom);
      /* it came after the posts were drawn: draw again */
      if (drawn && !state.loadingFeed) renderFeed(false);
    });
    /* the posts wait a moment for the news, so both arrive in one draw, but never on it */
    var settled = Promise.race([news, new Promise(function (r) { setTimeout(r, NEWS_WAIT); })]);
    return Promise.all([read, settled]).then(function (out) {
      var data = out[0], incoming = data && data.items || [];
      if (data) {
        state.feed = reset ? incoming : state.feed.concat(incoming);
        state.nextBefore = data.next_before || null;
      }
      drawn = true;
      renderFeed(false);
      openLinkedPost();
      Promise.all([loadActionCards(incoming), loadActionOfferCards(incoming), loadCollaborationCards(incoming)]).then(function (flags) {
        if (flags.some(Boolean)) { loadMissionStats(); renderFeed(false); }
      });
      if (reset && !state.guest) paintFeedMissions();
      paintMore();
      setStatus($("mnFeedStatus"), "");
    }).catch(function (e) {
      setStatus($("mnFeedStatus"), e.message || "Could not load the feed.", "error");
    }).finally(function () { state.loadingFeed = false; });
  }

  /* ?post= puts that post in view (a shared link, an alert). A post older than the first page is fetched on its own and
     shown first; arriving from a comment alert (?comments=1), its discussion is open already. */
  var linkedFetched = false, linkedOpened = false;
  function openLinkedPost() {
    var q, id, news;
    try { q = new URLSearchParams(location.search); news = !!q.get("news"); id = q.get(news ? "news" : "post"); } catch (_) { return; }
    if (!id || !/^[0-9a-f-]{36}$/i.test(id) || linkedOpened) return;
    var attr = news ? "data-news-id" : "data-post-id";
    function find() { return Array.prototype.find.call($("mnFeed").querySelectorAll("[" + attr + "]"), function (node) { return node.getAttribute(attr) === id; }); }
    var target = find();
    if (!target) {
      // a story is shown only while it is in the World's news window; a post can be fetched on its own
      if (news || state.guest || linkedFetched) return;
      linkedFetched = true;
      api("/v1/mnet/posts/" + encodeURIComponent(id)).then(function (one) {
        if (!one || !one.post || findPost(id)) return;
        state.feed = [{ item_type:"post", post_id:one.post.id, occurred_at:one.post.created_at, post:one.post, actor:one.actor }].concat(state.feed);
        renderFeed(false); openLinkedPost();
      }).catch(function () {});
      return;
    }
    target.scrollIntoView({ block:"center" }); target.setAttribute("tabindex", "-1"); target.focus({ preventScroll:true });
    var talk = q.get("comments") === "1" && target.querySelector("[data-discussion-toggle][aria-expanded=\"false\"]");
    // a story's reply box appears once the server confirms replies are on; this runs again when it does
    if (talk) { linkedOpened = true; talk.click(); track("alert_open", { type:news ? "news_comment" : "comment" }); }
  }

  /* THE CATALOGUE, LOADED ONCE. data/albums.json is the same file the
     listening room and the corner player read, so a track shared here is by
     construction a track that exists and plays. */
  function loadCatalogue() {
    if (state.catalogue) return Promise.resolve(state.catalogue);
    return fetch("data/albums.json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var out = [];
        ((d && d.albums) || []).forEach(function (a) {
          (a.tracks || []).forEach(function (t) {
            out.push({ title: t.title, album: a.name, albumSlug: a.slug, art: a.art });
          });
        });
        state.catalogue = out;
        return out;
      }).catch(function () { state.catalogue = []; return []; });
  }

  function wireTrackPicker() {
    var sel = $("mnTrackPick");
    if (!sel) return;
    loadCatalogue().then(function (tracks) {
      if (!tracks.length) { sel.hidden = true; return; }
      tracks.forEach(function (t, i) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = t.title + " · " + t.album;
        sel.appendChild(o);
      });
    });
  }

  function pickedTrack() {
    var sel = $("mnTrackPick");
    if (!sel || !sel.value || !state.catalogue) return null;
    return state.catalogue[Number(sel.value)] || null;
  }

  function createPost() {
    var body = $("mnPostBody").value.trim();
    var selectedTrack = pickedTrack();
    if (!body && !state.mediaAssets.length && !selectedTrack) { setStatus($("mnPostStatus"), "Write something, attach media, or pick a track first.", "error"); return; }
    var news = !!($("mnNewsroom") && $("mnNewsroom").checked && !$("mnNewsroomRow").hidden);
    if (news && $("mnVisibility").value !== "public") { setStatus($("mnPostStatus"), "A newsroom article is public. Choose Public to publish it.", "error"); return; }
    if (news && !body) { setStatus($("mnPostStatus"), "A newsroom article needs words. Write the headline on the first line.", "error"); return; }
    var button = $("mnPost");
    button.disabled = true;
    setStatus($("mnPostStatus"), "Posting…");
    var draft = { body:body, visibility:$("mnVisibility").value, track:selectedTrack,
             media_asset_ids:state.mediaAssets.map(function (x) { return x.id; }),
             poster_asset_ids:state.mediaAssets.map(function (x) { return x.poster_id || null; }),
             /* Opt-in, never inferred from visitor IP or automatic globe scope. */
             country_code:state.placeScope.enabled && $("mnPostPlaceOptIn") &&
               $("mnPostPlaceOptIn").checked && $("mnVisibility").value === "public" &&
               state.world.country ? state.world.country.code : undefined };
    if (news) draft.newsroom = true;
    api("/v1/mnet/posts?app_key=" + encodeURIComponent(APP), {
      method:"POST",
      body:draft
    }).then(function (out) {
      $("mnPostBody").value = "";
      if ($("mnTrackPick")) $("mnTrackPick").value = "";
      if ($("mnNewsroom")) $("mnNewsroom").checked = false;
      clearMediaQueue();
      if ($("mnPostPlaceOptIn")) $("mnPostPlaceOptIn").checked = false;
      if (state.placeScope.enabled && state.feedScope === "local") loadPlaceFeed(true);
      var id = out && out.post && out.post.id;
      if (news && id && /^[0-9a-f-]{36}$/i.test(id)) {
        /* the article's own address; the newsroom sends it on to the headline's slug */
        var st = $("mnPostStatus");
        st.textContent = "Posted, and in the newsroom: ";
        var link = document.createElement("a");
        link.href = "https://mccluster.org/news/" + id; link.target = "_blank"; link.rel = "noopener"; link.textContent = "read the article";
        st.appendChild(link); st.classList.remove("is-error"); st.classList.add("is-ok");
      } else setStatus($("mnPostStatus"), "Posted.", "ok");
      track("mnet_post_created", { has_media:state.mediaAssets.length > 0, has_track:!!selectedTrack, visibility:$("mnVisibility").value });
      /* a fresh post must be seen landing, so let go of any mission the
         feed was narrowed to on the globe */
      if (state.world.focus) { state.world.focus = null; paintWorldFocus(); tellWorld({ type: "hu:clear-selection" }); }
      /* the composer folds once the post is away, so the feed band is the feed again */
      var composerBox = $("mnComposer"), focused = document.activeElement;
      if (focused && composerBox && composerBox.contains(focused) && focused.blur) focused.blur();
      if (composerBox) composerBox.classList.remove("is-open");
      /* a post lands now, so a rewound feed comes back to Live to show it */
      return loadFeed(true);
    }).catch(function (e) {
      setStatus($("mnPostStatus"), e.message || "Could not post.", "error");
    }).finally(function () { button.disabled = false; });
  }

  // a post can be on the main feed or on a country's Local feed: share, save and mission taps look in both
  function findPost(postId) {
    var lists = [state.feed, state.placeScope.posts || []];
    for (var l=0; l<lists.length; l++) for (var i=0; i<lists[l].length; i++) {
      var item = lists[l][i];
      if ((item.post && item.post.id) === postId || item.post_id === postId) return item;
    }
    return null;
  }

  /* Likes and saves change the button they were tapped on, at once, and
     the server catches up behind it. Re-rendering the feed for every tap
     replayed every entrance and jumped the page; a failed call puts the
     button back. */
  function paintToggle(button, on, count) {
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    var c = button.querySelector(".mn__count");
    if (c && count != null) c.textContent = count ? String(count) : "";
    if (on) { button.classList.remove("is-pop"); void button.offsetWidth; button.classList.add("is-pop"); }
  }
  function renderNotifications(rows) {
    var host = $("mnNotifications");
    if (!rows.length) {
      host.innerHTML = '<div class="mn__empty">Nothing here yet.</div>';
      return;
    }
    host.innerHTML = rows.map(function (n) {
      var action="", meta=n&&n.metadata||{}, mission=String(meta.mission_id||"");
      if(n.type==="connection_request"&&meta.answered)return "";
      if(n.type==="action_proof_review"&&/^[0-9a-f-]{36}$/i.test(mission)){
        action='<a class="mn__notification-action" href="mnet.html?mission='+encodeURIComponent(mission)+'">'+
          (meta.decision==="rejected"?"Fix proof →":"View action →")+'</a>';
      }
      /* a connection request is answered here; an acceptance opens the person */
      if(n.type==="connection_request"&&/^[0-9a-f-]{36}$/i.test(String(meta.connection_id||""))){
        action='<span class="mn__notification-actions">'+
          '<button class="mn__notification-action" type="button" data-connection-answer="'+esc(meta.connection_id)+'" data-accept="1">Accept</button>'+
          '<button class="mn__notification-action mn__notification-action--quiet" type="button" data-connection-answer="'+esc(meta.connection_id)+'" data-accept="0">Decline</button>'+
          (meta.handle?'<button class="mn__notification-action mn__notification-action--quiet" type="button" data-person="'+esc(meta.handle)+'">View profile</button>':'')+'</span>';
      }
      if(n.type==="collaboration_published"&&/^[0-9a-f-]{36}$/i.test(String(meta.mission_id||""))){
        action='<a class="mn__notification-action" href="mnet.html?mission='+encodeURIComponent(meta.mission_id)+'">Confirm as my Level 3 →</a>';
      }
      /* a comment opens the post, or the story, with its discussion */
      if(n.type==="comment"&&/^[0-9a-f-]{36}$/i.test(String(meta.post_id||""))){
        action='<a class="mn__notification-action" href="mnet.html?view=feed&amp;post='+encodeURIComponent(meta.post_id)+'&amp;comments=1">See the comment →</a>';
      }
      if(n.type==="news_comment"&&/^[0-9a-f-]{36}$/i.test(String(meta.article_id||""))){
        action='<a class="mn__notification-action" href="mnet.html?view=feed&amp;news='+encodeURIComponent(meta.article_id)+'&amp;comments=1">See the reply →</a>';
      }
      if(n.type==="connection_accepted"&&meta.handle){
        action='<button class="mn__notification-action" type="button" data-person="'+esc(meta.handle)+'">View profile →</button>';
      }
      return '<article class="mn__notification"><strong>' + esc(n.body || n.type || "Notification") + '</strong><p>' + esc(timeAgo(n.created_at)) + '</p>'+action+'</article>';
    }).join("");
    host.querySelectorAll("[data-connection-answer]").forEach(function(b){
      b.addEventListener("click",function(){
        var id=b.getAttribute("data-connection-answer"), accept=b.getAttribute("data-accept")==="1", card=b.closest(".mn__notification");
        card.querySelectorAll("button").forEach(function(x){x.disabled=true;});
        sbRpc("answer_connection",{p_connection_id:id,p_accept:accept}).then(function(){
          card.querySelector("strong").textContent=accept?"Connected":"Declined";
          var acts=card.querySelector(".mn__notification-actions"); if(acts)acts.remove();
        }).catch(function(e){card.querySelectorAll("button").forEach(function(x){x.disabled=false;});setStatus($("mnNotificationStatus"),e.message||"That did not go through.","error");});
      });
    });
    host.querySelectorAll("[data-person]").forEach(function(b){b.addEventListener("click",function(){closeAlerts();openPerson(b.getAttribute("data-person"));});});
  }

  /* ALERTS ON THIS DEVICE (owner, 2026-10-20; workers/mccluster/src/web-push.js). Never asked for on its own: the
     browser's permission prompt appears only after the member taps Turn on. Hidden where the browser cannot take
     push (an iPhone needs the site added to the Home Screen first) or while the server has it off. */
  var push = { key:"", busy:false, mine:false };
  function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function pushKeyBytes(key) {
    var s = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((key.length + 3) % 4)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  /* "on" means this browser's subscription belongs to the member signed in now (a shared browser may still hold
     someone else's until they sign out), so the server is asked, not just the browser */
  function paintPush() {
    var box = $("mnPush"); if (!box || state.guest || !pushSupported()) return;
    navigator.serviceWorker.getRegistration().then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }).then(function (sub) {
      return api("/v1/mnet/push" + (sub ? "?endpoint=" + encodeURIComponent(sub.endpoint) : "")).then(function (cfg) {
        if (!cfg || !cfg.enabled || !cfg.key) { box.hidden = true; return; }
        push.key = cfg.key; push.mine = !!(sub && cfg.subscribed); box.hidden = false;
        var on = push.mine && Notification.permission === "granted", b = $("mnPushToggle");
        b.textContent = on ? "Turn off" : "Turn on"; b.setAttribute("aria-pressed", String(on));
        b.disabled = Notification.permission === "denied";
        if (Notification.permission === "denied") $("mnPushNote").textContent = "Alerts are blocked for this site in your browser settings.";
      });
    }).catch(function () { box.hidden = true; });
  }
  function togglePush() {
    if (push.busy || !push.key) return; push.busy = true;
    var b = $("mnPushToggle"); b.disabled = true;
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && push.mine) return api("/v1/mnet/push/subscriptions", { method:"DELETE", body:{ endpoint:sub.endpoint } }).then(function () { return sub.unsubscribe(); }).then(function () { track("push_off", {}); });
        // this browser already has a subscription from someone else: it becomes this member's
        if (sub) return api("/v1/mnet/push/subscriptions", { method:"POST", body:sub.toJSON() }).then(function () { track("push_on", {}); });
        return reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:pushKeyBytes(push.key) }).then(function (fresh) {
          return api("/v1/mnet/push/subscriptions", { method:"POST", body:fresh.toJSON() }).then(function () { track("push_on", {}); });
        });
      });
    }).catch(function (e) {
      setStatus($("mnNotificationStatus"), Notification.permission === "denied" ? "Alerts are blocked for this site in your browser settings." : (e.message || "Alerts could not be changed."), "error");
    }).finally(function () { push.busy = false; b.disabled = false; paintPush(); });
  }
  function loadNotificationsSilently() {
    return api("/v1/mnet/notifications").then(function (data) {
      var rows = data.notifications || [];
      var unread = rows.filter(function (n) { return !n.read_at; }).length;
      $("mnNotifBadge").hidden = !unread;
      $("mnNotifBadge").textContent = unread > 99 ? "99+" : unread;
      $("mnBell").setAttribute("aria-label", unread ? "Alerts, " + unread + " unread" : "Alerts");
      renderNotifications(rows);
      setStatus($("mnNotificationStatus"), "");
      return rows;
    }).catch(function () { return []; });
  }

  /* NOTIFICATIONS DROP DOWN FROM THE BELL (owner, 2026-10-20) */
  function openAlerts() {
    var pop = $("mnAlerts"); if (!pop) return;
    closeMenu();
    pop.hidden = false; $("mnBell").setAttribute("aria-expanded", "true");
    loadNotificationsSilently().then(markNotificationsRead); paintPush();
    track("mnet_alerts_open", {});
  }
  function closeAlerts() {
    var pop = $("mnAlerts"); if (!pop || pop.hidden) return;
    pop.hidden = true; $("mnBell").setAttribute("aria-expanded", "false");
  }
  function markNotificationsRead() {
    return api("/v1/mnet/notifications/read", { method:"POST", body:{} }).then(function () {
      $("mnNotifBadge").hidden = true;
      $("mnBell").setAttribute("aria-label", "Alerts");
    }).catch(function () {});
  }

  function sessionToken() {
    try { var s = MCC.session && MCC.session(); return s && s.access_token || ""; } catch (e) { return ""; }
  }
  function storagePath(path) {
    return String(path || "").split("/").map(encodeURIComponent).join("/");
  }
  function clearMediaQueue() {
    state.mediaAssets.forEach(function (x) { if (x.preview) try { URL.revokeObjectURL(x.preview); } catch (e) {} });
    state.mediaAssets = [];
    if ($("mnMediaQueue")) { $("mnMediaQueue").innerHTML = ""; $("mnMediaQueue").hidden = true; }
    if ($("mnMediaInput")) $("mnMediaInput").value = "";
    setStatus($("mnMediaStatus"), "");
  }
  function renderMediaQueue() {
    var host = $("mnMediaQueue");
    if (!host) return;
    host.hidden = !state.mediaAssets.length;
    host.innerHTML = state.mediaAssets.map(function (x, i) {
      var visual = x.media_type === "image" && x.preview ? '<img src="' + esc(x.preview) + '" alt="">' :
        x.media_type === "video" && x.preview ? '<video src="' + esc(x.preview) + '" muted playsinline></video>' :
        '<span>' + esc(x.name || x.media_type) + '</span>';
      return '<div class="mn__media-chip">' + visual + '<button type="button" data-remove-media="' + i + '" aria-label="Remove attachment">×</button></div>';
    }).join("");
    host.querySelectorAll("[data-remove-media]").forEach(function (b) {
      b.onclick = function () {
        var i = Number(b.dataset.removeMedia), item = state.mediaAssets[i];
        if (item && item.preview) try { URL.revokeObjectURL(item.preview); } catch (e) {}
        if(item){
          [item.id,item.poster_id].filter(Boolean).forEach(function(id){
            api("/v1/mnet/media/discard",{method:"POST",body:{asset_id:id}}).catch(function(){});
          });
        }
        state.mediaAssets.splice(i,1); renderMediaQueue();
      };
    });
  }
  function uploadOneMedia(file){
    var token=sessionToken();
    if(!token)return Promise.reject(new Error("Sign in before uploading media."));
    return api("/v1/mnet/media/upload-url",{method:"POST",body:{file_name:file.name||"upload",mime_type:file.type||"application/octet-stream",byte_size:file.size}})
      .then(function(grant){
        var path=grant&&grant.upload&&grant.upload.path,asset=grant&&grant.asset,uploadToken=grant&&grant.upload&&grant.upload.token;
        if(!path||!asset)throw new Error("The upload slot was not created.");
        var url=uploadToken
          ? SB_URL+"/storage/v1/object/upload/sign/mnet-media/"+storagePath(path)+"?token="+encodeURIComponent(uploadToken)
          : SB_URL+"/storage/v1/object/mnet-media/"+storagePath(path);
        return fetch(url,{method:uploadToken?"PUT":"POST",headers:{apikey:SB_KEY,authorization:"Bearer "+token,"content-type":file.type||"application/octet-stream","x-upsert":"false"},body:file})
          .then(function(res){
            if(!res.ok)return res.text().then(function(t){throw new Error("Upload rejected ("+res.status+"): "+(t||"no detail"));});
            return api("/v1/mnet/media/finalize",{method:"POST",body:{asset_id:asset.id}});
          })
          .then(function(fin){return (fin&&fin.asset)||asset;});
      });
  }
  function makeVideoPoster(file){
    if(!file||String(file.type||"").indexOf("video/")!==0)return Promise.resolve(null);
    return new Promise(function(resolve){
      var video=document.createElement("video"),src=URL.createObjectURL(file),done=false;
      function finish(value){if(done)return;done=true;try{URL.revokeObjectURL(src);}catch(_){} resolve(value||null);}
      video.muted=true;video.playsInline=true;video.preload="metadata";
      video.onloadedmetadata=function(){
        try{video.currentTime=Math.min(Math.max(0.12,(Number(video.duration)||1)*0.06),1.0);}catch(_){finish(null);}
      };
      video.onseeked=function(){
        try{
          var w=video.videoWidth||720,h=video.videoHeight||1280,max=720,scale=Math.min(1,max/Math.max(w,h));
          var canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
          var ctx=canvas.getContext("2d");if(!ctx){finish(null);return;}ctx.drawImage(video,0,0,canvas.width,canvas.height);
          canvas.toBlob(function(blob){
            if(!blob){finish(null);return;}
            finish(new File([blob],(file.name||"video").replace(/\.[^.]+$/,"")+"-poster.jpg",{type:"image/jpeg"}));
          },"image/jpeg",0.82);
        }catch(_){finish(null);}
      };
      video.onerror=function(){finish(null);};
      setTimeout(function(){finish(null);},4500);
      video.src=src;
    });
  }
  function uploadMediaWithPoster(file){
    return uploadOneMedia(file).then(function(asset){
      if(String(file.type||"").indexOf("video/")!==0)return {asset:asset,poster:null};
      return makeVideoPoster(file).then(function(posterFile){
        if(!posterFile)return {asset:asset,poster:null};
        return uploadOneMedia(posterFile).then(function(poster){return {asset:asset,poster:poster};})
          .catch(function(){return {asset:asset,poster:null};});
      });
    });
  }
  function uploadMediaFiles(files) {
    files=Array.prototype.slice.call(files||[]).slice(0,Math.max(0,4-state.mediaAssets.length));
    if(!files.length)return Promise.resolve();
    if(!sessionToken())return Promise.reject(new Error("Sign in before uploading media."));
    setStatus($("mnMediaStatus"),"Uploading "+files.length+(files.length===1?" file…":" files…"));
    var chain=Promise.resolve();
    files.forEach(function(file){
      chain=chain.then(function(){
        return uploadMediaWithPoster(file).then(function(out){
          var ready=out.asset;
          state.mediaAssets.push({
            id:ready.id,
            media_type:ready.media_type||(/video\//.test(file.type)?"video":/image\//.test(file.type)?"image":"file"),
            poster_id:out.poster&&out.poster.id||null,
            name:file.name,
            preview:URL.createObjectURL(file)
          });
          renderMediaQueue();
        });
      });
    });
    return chain.then(function(){setStatus($("mnMediaStatus"),state.mediaAssets.length+" attachment"+(state.mediaAssets.length===1?"":"s")+" ready.","ok");})
      .catch(function(e){setStatus($("mnMediaStatus"),e.message||"Upload failed.","error");throw e;});
  }
  function resolvePostMedia(root) {
    if(!root)return;
    root.querySelectorAll("[data-mnet-media]").forEach(function(node){
      var id=node.dataset.mnetMedia;
      if(!id||node.dataset.loaded==="1")return;
      node.dataset.loaded="1";
      function assetUrl(assetId){
        var cached=state.mediaCache[assetId];
        return cached?Promise.resolve(cached):api("/v1/mnet/media/"+encodeURIComponent(assetId)+"/url").then(function(x){state.mediaCache[assetId]=x;return x;});
      }
      assetUrl(id).then(function(data){
        var type=data.media_type||node.dataset.mediaType||"file",url=safeHttpUrl(data.url);
        if(!url)throw new Error("Media URL unavailable");
        if(type==="image")node.innerHTML='<img src="'+esc(url)+'" alt="'+esc(data.alt_text||"")+'" loading="lazy">';
        else if(type==="video"){
          var posterId=node.dataset.posterAsset;
          return (posterId?assetUrl(posterId).catch(function(){return null;}):Promise.resolve(null)).then(function(poster){
            var posterUrl=poster&&safeHttpUrl(poster.url);
            node.innerHTML='<video src="'+esc(url+(node.dataset.clip||""))+'"'+(posterUrl?' poster="'+esc(posterUrl)+'"':"")+' controls playsinline preload="metadata"'+(node.dataset.muted?" muted":"")+'></video>';
          });
        } else if(type==="audio")node.innerHTML='<audio src="'+esc(url)+'" controls preload="metadata"></audio>';
        else node.innerHTML='<a class="mn__profile-link" href="'+esc(url)+'" target="_blank" rel="noopener">Open attachment</a>';
      }).catch(function(){node.innerHTML='<div class="mn__post-media-loading">Media unavailable.</div>';});
    });
  }
  function toggleBookmark(postId, button) {
    var item=findPost(postId), post=item&&item.post, saved=!!(post&&post.bookmarked_by_me);
    if(post)post.bookmarked_by_me=!saved;
    paintToggle(button,!saved,null);
    button.disabled=true;
    api("/v1/mnet/posts/" + encodeURIComponent(postId) + "/bookmark", {method:saved?"DELETE":"POST",body:{}})
      .then(function(){ track(saved?"mnet_bookmark_removed":"mnet_bookmark_added",{post_id:postId}); })
      .catch(function (e) { if(post)post.bookmarked_by_me=saved; paintToggle(button,saved,null); setStatus($("mnFeedStatus"),e.message||"Could not save that post.","error"); })
      .finally(function () { button.disabled=false; });
  }
  function deletePost(postId, button) {
    if (!confirm("Delete this post?")) return;
    button.disabled=true;
    api("/v1/mnet/posts/" + encodeURIComponent(postId), {method:"DELETE",body:{}})
      .then(function () { state.feed=state.feed.filter(function (x) { return (x.post&&x.post.id)!==postId&&x.post_id!==postId; }); renderFeed(false); })
      .catch(function (e) { setStatus($("mnFeedStatus"),e.message||"Could not delete that post.","error"); })
      .finally(function () { button.disabled=false; });
  }

  function personRow(p) {
    var name=p.display_name||p.mccluster_id||"Member", handle=p.mccluster_id?"@"+p.mccluster_id:"";
    var av=safeHttpUrl(p.avatar_url),avatar=av?'<img src="'+esc(av)+'" alt="">':esc(initials(name));
    return '<article class="mn__person-row"><button type="button" data-person="'+esc(p.mccluster_id||"")+'" class="mn__author-avatar">'+avatar+'</button>' +
      '<button type="button" data-person="'+esc(p.mccluster_id||"")+'" class="mn__person-copy"><span class="mn__person-name">'+esc(name)+'</span><span class="mn__person-sub">'+esc(handle+(p.headline?" · "+p.headline:""))+'</span></button>' +
      '<button type="button" class="mn__follow'+(p.following?' is-active':'')+'" data-follow-person="'+esc(p.mccluster_id||"")+'" data-following="'+(p.following?"1":"0")+'">'+(p.following?"Following":"Follow")+'</button></article>';
  }
  function bindPeople(root) {
    root.querySelectorAll("[data-person]").forEach(function (b) { b.onclick=function () { if(b.dataset.person)openPerson(b.dataset.person); }; });
    root.querySelectorAll("[data-follow-person]").forEach(function (b) {
      b.onclick=function () {
        var following=b.dataset.following==="1"; b.disabled=true;
        api("/v1/mnet/people/"+encodeURIComponent(b.dataset.followPerson)+"/follow",{method:following?"DELETE":"POST",body:{}})
          .then(function () { b.dataset.following=following?"0":"1"; b.textContent=following?"Follow":"Following"; b.classList.toggle("is-active",!following); track(following?"mnet_unfollow":"mnet_follow",{handle:b.dataset.followPerson}); })
          .catch(function (e) { setStatus($("mnDiscoverStatus"),e.message||"Could not update follow.","error"); })
          .finally(function () { b.disabled=false; });
      };
    });
  }
  function blockedPersonRow(item) {
    var p=item.profile||{}, handle=p.mccluster_id||"", name=p.display_name||handle||"Member";
    var av=safeHttpUrl(p.avatar_url),avatar=av?'<img src="'+esc(av)+'" alt="">':esc(initials(name));
    return '<article class="mn__person-row"><div class="mn__author-avatar">'+avatar+'</div>' +
      '<div class="mn__person-copy"><span class="mn__person-name">'+esc(name)+'</span><span class="mn__person-sub">'+esc(handle?"@"+handle:"Blocked member")+'</span></div>' +
      '<button type="button" class="mn__follow is-active" data-unblock-person="'+esc(handle)+'">Unblock</button></article>';
  }
  function loadBlocked() {
    setStatus($("mnDiscoverStatus"),"Loading blocked people…");
    return api("/v1/mnet/blocks").then(function (data) {
      var rows=data.blocks||[];
      $("mnDiscoverResults").innerHTML=rows.length?rows.map(blockedPersonRow).join(""):'<div class="mn__empty">You have not blocked anyone.</div>';
      $("mnDiscoverResults").querySelectorAll("[data-unblock-person]").forEach(function (b) {
        b.onclick=function () {
          if(!b.dataset.unblockPerson)return;
          b.disabled=true;
          api("/v1/mnet/people/"+encodeURIComponent(b.dataset.unblockPerson)+"/block",{method:"DELETE",body:{}})
            .then(loadBlocked)
            .catch(function (e) { setStatus($("mnDiscoverStatus"),e.message||"Could not unblock that person.","error"); b.disabled=false; });
        };
      });
      setStatus($("mnDiscoverStatus"),rows.length?rows.length+" blocked":"");
    }).catch(function (e) { $("mnDiscoverResults").innerHTML=""; setStatus($("mnDiscoverStatus"),e.message||"Could not load blocked people.","error"); });
  }

  function loadDiscover() {
    var q=$("mnDiscoverQuery").value.trim().replace(/^@+/,""); setStatus($("mnDiscoverStatus"),"Searching…");
    return api("/v1/mnet/discover?q="+encodeURIComponent(q)+"&limit=50").then(function (data) {
      var rows=data.people||[]; $("mnDiscoverResults").innerHTML=rows.length?rows.map(personRow).join(""):'<div class="mn__empty">No people found.</div>';
      bindPeople($("mnDiscoverResults")); setStatus($("mnDiscoverStatus"),rows.length?rows.length+" people":"");
    }).catch(function (e) { $("mnDiscoverResults").innerHTML=""; setStatus($("mnDiscoverStatus"),e.message||"Could not search the network.","error"); });
  }
  /* CONNECT THROUGH THE PLATFORM (owner, 2026-10-14: Anti-Social, level 3).
     One row per pair in network_connections, written only by the server
     (request_connection, answer_connection, withdraw_connection). The button
     reads the pair's state: Connect → Requested (tap again to withdraw) →
     Connected (tap to end); when they asked first it reads Accept, with a
     Decline beside it. */
  function connectButtonHtml(c) {
    c=c||{status:"none"};
    if(c.status==="accepted")return '<button type="button" id="mnPersonConnect" data-connect="end" aria-label="Connected. Tap to end the connection">Connected ✓</button>';
    if(c.status==="pending"&&c.direction==="received")return '<button class="is-primary" type="button" id="mnPersonConnect" data-connect="accept">Accept connection</button><button type="button" id="mnPersonDecline" data-connect="decline">Decline</button>';
    if(c.status==="pending")return '<button type="button" id="mnPersonConnect" data-connect="withdraw" aria-label="Requested. Tap to withdraw">Requested…</button>';
    return '<button type="button" id="mnPersonConnect" data-connect="ask">Connect</button>';
  }
  function bindConnectButton(host, c, targetMuid, done) {
    c=c||{status:"none"};
    var ask=host.querySelector("#mnPersonConnect"), decline=host.querySelector("#mnPersonDecline");
    function run(p){ask.disabled=true;p.then(done).catch(function(e){ask.disabled=false;alert(e.message||"That did not go through.");});}
    if(ask)ask.onclick=function(){
      var what=ask.getAttribute("data-connect");
      if(state.guest){askToSignIn("connect");return;}
      if(what==="ask"){if(!targetMuid)return;run(sbRpc("request_connection",{p_target_m_uid:targetMuid}));}
      else if(what==="accept")run(sbRpc("answer_connection",{p_connection_id:c.id,p_accept:true}));
      else if(what==="withdraw"||what==="end"){if(what==="end"&&!confirm("End this connection?"))return;run(sbRpc("withdraw_connection",{p_connection_id:c.id}));}
    };
    if(decline)decline.onclick=function(){decline.disabled=true;sbRpc("answer_connection",{p_connection_id:c.id,p_accept:false}).then(done).catch(function(){decline.disabled=false;});};
  }

  function openPerson(handle) {
    if(!handle)return;
    try { history.replaceState(null,"","mnet.html?profile="+encodeURIComponent(handle)); } catch (_) {}
    var dlg=$("mnPersonDialog"); $("mnPersonBody").innerHTML='<div class="mn__empty">Loading profile…</div>'; dlg.showModal();
    Promise.all([
      api("/v1/mnet/people/"+encodeURIComponent(handle)),
      api("/v1/mnet/people/"+encodeURIComponent(handle)+"/posts?limit=20")
    ]).then(function (all) {
      var data=all[0], posts=all[1].posts||[], p=data.profile||{}, id=data.identity||{}, presentation=data.presentation||{}, name=p.display_name||id.display_name||id.mccluster_id||"Member";
      /* One shared center-tab perspective for every member, not only artists.
         The public record from the API supplies the canonical name and image. */
      try { window.dispatchEvent(new CustomEvent("mcc:perspective", { detail: {
        kind:"member", handle:String(id.mccluster_id||handle).toLowerCase(),
        name:name, avatar:safeHttpUrl(p.avatar_url)
      } })); } catch (_) {}
      var avatar=safeHttpUrl(p.avatar_url),banner=safeHttpUrl(p.banner_url),avatarHtml=avatar?'style="background-image:url('+JSON.stringify(avatar)+')"':"";
      var front=safeHttpUrl(presentation.front_page_url||p.website_url), frontHtml=front?'<div class="mn__frontpage mn__frontpage--person"><div class="mn__frontpage-head"><div><span>Front page</span><strong>'+esc(name)+' · public home</strong></div><a href="'+esc(front)+'" target="_blank" rel="noopener">Open site ↗</a></div><div class="mn__frontpage-stage"><iframe title="'+esc(name)+' front page" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" src="'+esc(front)+'"></iframe></div></div>':'';
      var perspectiveLink='<p class="mn__perspective-link"><a href="'+esc('https://matthew.mccluster.org/member-front.html?handle='+encodeURIComponent(String(id.mccluster_id||handle).toLowerCase()))+'">Open '+esc(name)+'\u2019s full front page in the center →</a></p>';
      $("mnPersonBody").innerHTML='<div class="mn__person-sheet">'+perspectiveLink+frontHtml+'<div class="mn__person-hero"'+(banner?' style="background-image:url('+JSON.stringify(banner)+')"':'')+'></div>' +
        '<div class="mn__person-main"><div class="mn__profile-avatar" '+avatarHtml+'>'+(avatar?"":esc(initials(name)))+'</div><h2>'+esc(name)+'</h2><p class="mn__handle">@'+esc(id.mccluster_id||"")+'</p>' +
        (p.headline?'<p class="mn__profile-headline">'+esc(p.headline)+'</p>':'')+(p.bio?'<p class="mn__profile-bio">'+esc(p.bio)+'</p>':'')+
        '<div class="mn__profile-counts"><span><strong>'+Number(data.counts&&data.counts.followers||0)+'</strong> followers</span><span><strong>'+Number(data.counts&&data.counts.following||0)+'</strong> following</span><span><strong>'+Number(data.counts&&data.counts.posts||0)+'</strong> posts</span></div>'+
        '<div class="mn__person-actions"><button class="is-primary" type="button" id="mnPersonFollow">'+(data.following?"Following":"Follow")+'</button>'+connectButtonHtml(data.connection)+'<button type="button" id="mnPersonMessage">Message</button><button type="button" id="mnPersonMute">'+(data.muted?"Unmute":"Mute")+'</button><button type="button" class="mn__danger" id="mnPersonBlock">Block</button><button type="button" id="mnPersonReport">Report</button></div>'+
        '<div class="mn__person-posts" id="mnPersonPosts">'+(posts.length?posts.map(function(x){return postCard(x);}).join(""):'<div class="mn__empty">No posts yet.</div>')+'</div></div></div>';
      bindFeedActions($("mnPersonPosts"));
      if(p.m_uid){
        sbRpc("antisocial_public_collaborations",{p_member_m_uid:p.m_uid}).then(function(credits){
          if(!credits||!credits.length||!$("mnPersonPosts"))return;
          var area=document.createElement("section");area.className="mn__panel";
          area.innerHTML='<p class="mn__eyebrow">Anti-Social · Make Something Together</p><h3>Verified collaborations</h3>'+
            credits.map(function(c){return '<p><a href="/mnet.html?post='+encodeURIComponent(c.post_id)+'">Original project ↗</a> · with '+esc(c.collaborator_name||"Action Network member")+'</p>';}).join("");
          $("mnPersonPosts").parentNode.insertBefore(area,$("mnPersonPosts"));
        }).catch(function(){});
      }
      $("mnPersonFollow").onclick=function(){var was=data.following;api("/v1/mnet/people/"+encodeURIComponent(handle)+"/follow",{method:was?"DELETE":"POST",body:{}}).then(function(){openPerson(handle);});};
      bindConnectButton($("mnPersonBody"), data.connection, p.m_uid||id.m_uid||data.m_uid, function(){openPerson(handle);});
      $("mnPersonMessage").onclick=function(){startConversation({mccluster_id:handle});};
      $("mnPersonMute").onclick=function(){api("/v1/mnet/people/"+encodeURIComponent(handle)+"/mute",{method:data.muted?"DELETE":"POST",body:{}}).then(function(){openPerson(handle);});};
      $("mnPersonBlock").onclick=function(){if(confirm("Block @"+handle+"? You will stop seeing each other on Equity Uprise."))api("/v1/mnet/people/"+encodeURIComponent(handle)+"/block",{method:"POST",body:{}}).then(function(){dlg.close();loadFeed(true);});};
      $("mnPersonReport").onclick=function(){var details=prompt("What should the moderators know?","");if(details===null)return;api("/v1/mnet/reports",{method:"POST",body:{target_type:"profile",target_id:data.profile&&data.profile.m_uid||id.mccluster_id,reason:"other",details:details}}).then(function(){alert("Report submitted.");});};
    }).catch(function (e) { $("mnPersonBody").innerHTML='<div class="mn__empty">'+esc(e.message||"Could not load profile.")+'</div>'; });
  }

  /* message requests waiting: the Messages badge in the account menu and
     the dot on the avatar, kept current from anywhere, not only Messages */
  function paintMessageBadge() {
    var requests=(state.conversations||[]).filter(function (x) { return x.my&&x.my.member_state==="requested"; }).length;
    $("mnMessageBadge").hidden=!requests; $("mnMessageBadge").textContent=requests||"";
    if($("mnMeDot"))$("mnMeDot").hidden=!requests;
  }
  function refreshMessageBadge() {
    return api("/v1/mnet/conversations").then(function (data) { state.conversations=data.conversations||[]; paintMessageBadge(); }).catch(function () {});
  }
  function loadConversations() {
    setStatus($("mnMessageStatus"),"Loading…");
    return api("/v1/mnet/conversations").then(function (data) {
      state.conversations=data.conversations||[];
      paintMessageBadge();
      $("mnConversations").innerHTML=state.conversations.length?state.conversations.map(function (x) {
        var other=(x.members||[]).find(function(m){return m.m_uid!==identity().m_uid;})||{},p=other.profile||{},name=p.display_name||p.mccluster_id||"Conversation",last=x.last_message;
        return '<article class="mn__conversation-row"><div class="mn__author-avatar">'+esc(initials(name))+'</div><button type="button" class="mn__conversation-copy" data-conversation="'+esc(x.conversation.id)+'"><span class="mn__conversation-name">'+esc(name)+'</span><span class="mn__conversation-sub">'+esc(x.my&&x.my.member_state==="requested"?"Message request":last&&last.body||"Start the conversation")+'</span></button><span class="mn__author-sub">'+esc(last?timeAgo(last.created_at):"")+'</span></article>';
      }).join(""):'<div class="mn__empty">No conversations yet. Open a person from Discover and tap Message.</div>';
      $("mnConversations").querySelectorAll("[data-conversation]").forEach(function(b){b.onclick=function(){openConversation(b.dataset.conversation);};});
      setStatus($("mnMessageStatus"),"");
      return state.conversations;
    }).catch(function (e) { setStatus($("mnMessageStatus"),e.message||"Could not load messages.","error"); return []; });
  }
  function startConversation(target) {
    return api("/v1/mnet/conversations",{method:"POST",body:target||{}}).then(function (x) {
      if($("mnPersonDialog").open)$("mnPersonDialog").close();
      setView("messages"); return loadConversations().then(function(){return openConversation(x.conversation_id);});
    }).catch(function (e) { setStatus($("mnMessageStatus"),e.message||"Could not start a conversation.","error"); });
  }
  /* Links in a message were printed as dead text. The body is escaped
     first and only then scanned, so nothing a sender types becomes markup:
     an https address becomes a link, and McCluster's own walkthrough
     address (the one in Matthew's welcome) becomes a button that starts
     the tour in place. */
  var TOUR_URL=/^https:\/\/(?:matthew\.)?mccluster\.org\/mnet\.html\?tour=1$/;
  function messageHtml(body) {
    return esc(body||"").replace(/https:\/\/[^\s<>"']+/g,function(url){
      var clean=url.replace(/[.,;:!?)]+$/,""), tail=url.slice(clean.length);
      var raw=clean.replace(/&amp;/g,"&");
      if (TOUR_URL.test(raw)) return '<a class="mn__tour-cta" href="mnet.html?tour=1" data-tour-start>Start the walkthrough</a>'+tail;
      return '<a class="mn__message-link" href="'+clean+'" target="_blank" rel="noopener noreferrer">'+clean+'</a>'+tail;
    });
  }
  function renderMessages(rows) {
    $("mnConversationMessages").innerHTML=rows.length?rows.map(function(m){
      var mine=m.sender_m_uid===identity().m_uid;
      return '<article class="mn__message'+(mine?' is-mine':'')+'"><p>'+messageHtml(m.body)+'</p><small>'+esc(mine?"You":m.sender&&m.sender.display_name||m.sender&&m.sender.mccluster_id||"Member")+' · '+esc(timeAgo(m.created_at))+'</small></article>';
    }).join(""):'<div class="mn__empty">No messages yet.</div>';
    $("mnConversationMessages").scrollTop=$("mnConversationMessages").scrollHeight;
  }
  function loadConversationMessages(id) {
    return api("/v1/mnet/conversations/"+encodeURIComponent(id)+"/messages?limit=100").then(function(data){renderMessages(data.messages||[]);return data.messages||[];});
  }
  function openConversation(id) {
    state.currentConversation=id;var dlg=$("mnConversationDialog");$("mnConversationMessages").innerHTML='<div class="mn__empty">Loading messages…</div>';dlg.showModal();
    return api("/v1/mnet/conversations/"+encodeURIComponent(id)).then(function(data){
      var other=(data.members||[]).find(function(m){return m.m_uid!==identity().m_uid;})||{},p=other.profile||{};
      $("mnConversationTitle").textContent=p.display_name||p.mccluster_id||"Messages";
      $("mnAcceptConversation").hidden=!(data.my&&data.my.member_state==="requested");
      $("mnMessageForm").hidden=!!(data.my&&data.my.member_state==="requested");
      setStatus($("mnConversationStatus"),data.my&&data.my.member_state==="requested"?"Accept this request to reply.":"");
      return loadConversationMessages(id);
    }).catch(function(e){setStatus($("mnConversationStatus"),e.message||"Could not open messages.","error");});
  }
  function sendMessage(event) {
    event.preventDefault();if(!state.currentConversation)return;var body=$("mnMessageBody").value.trim();if(!body)return;
    var b=$("mnMessageForm").querySelector("button");b.disabled=true;
    api("/v1/mnet/conversations/"+encodeURIComponent(state.currentConversation)+"/messages",{method:"POST",body:{body:body}})
      .then(function(){ $("mnMessageBody").value=""; track("mnet_message_sent",{conversation_id:state.currentConversation}); return loadConversationMessages(state.currentConversation).then(loadConversations); })
      .catch(function(e){setStatus($("mnConversationStatus"),e.message||"Could not send message.","error");})
      .finally(function(){b.disabled=false;});
  }

  /* THE ACCOUNT MENU. Whose account this is, View profile, Messages,
     Settings & account, Sign out, and nothing else (owner, 2026-10-14):
     every other room is reached where it belongs on the World. Escape and
     any tap outside close it, and focus goes back to the avatar. */
  function closeMenu(restore) {
    var menu = $("mnMenu"), me = $("mnMe");
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (me) { me.setAttribute("aria-expanded", "false"); if (restore) me.focus(); }
  }
  function wireMenu() {
    var menu = $("mnMenu"), me = $("mnMe");
    if (!menu || !me) return;
    me.onclick = function (e) {
      e.stopPropagation();
      if (!menu.hidden) { closeMenu(true); return; }
      showGate("app");
      menu.hidden = false;
      me.setAttribute("aria-expanded", "true");
      var first = menu.querySelector("button,a");
      if (first) first.focus();
    };
    document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target) && e.target !== me) closeMenu(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(true); });
    /* signing out ends the session here and on the server, then reopens the
       World as a guest, so nothing a member loaded stays on the page */
    $("mnSignOut").onclick = function () {
      var b = this; b.disabled = true; b.textContent = "Signing out\u2026";
      track("mnet_sign_out", {});
      /* the local session is gone at once; the server logout gets 1.5s, so a
         slow network never leaves the button hanging */
      Promise.race([
        Promise.resolve(window.MCC && MCC.signOut && MCC.signOut()).catch(function () {}),
        new Promise(function (r) { setTimeout(r, 1500); })
      ]).then(function () { location.replace("mnet.html"); });
    };
  }

  function setView(name) {
    /* notifications are the bell's drop down, never a page of their own (owner, 2026-10-20) */
    if (name === "notifications") { if (state.guest) { askToSignIn(name); return; } openAlerts(); return; }
    if (MISSIONS_OFF && name === "missions") name = "feed";
    if (state.guest && name !== "feed") { askToSignIn(name); return; }
    if (name !== "feed" && name !== "missions" && askToFinish(name)) return;
    state.currentView = name;
    track("mnet_view", { view:name });
    closeAlerts();
    ["live","clips","feed","missions","discover","groups","messages","profile"].forEach(function (view) {
      var ids={live:"mnLiveView",clips:"mnClipsView",feed:"mnFeedView",missions:"mnMissionsView",discover:"mnDiscoverView",groups:"mnGroupsView",messages:"mnMessagesView",profile:"mnProfileView"};
      var panel=$(ids[view]); if(panel)panel.hidden=view!==name;
      var tab=document.querySelector('[data-mn-view="' + view + '"]');
      if(tab)tab.classList.toggle("is-active",view===name);
    });
    moveThumb(true);
    if($("mnToWorld"))$("mnToWorld").hidden=name==="feed";
    closeMenu();
    if(name==="live"&&window.MCC_LIVE&&window.MCC_LIVE.refresh)window.MCC_LIVE.refresh();
    if(name==="clips"&&window.MCC_CLIPS)window.MCC_CLIPS.load();
    if(name==="missions")loadMissions();
    if(name==="discover")loadDiscover();
    if(name==="groups")loadGroups();
    if(name==="messages")loadConversations();
    if(name==="profile"){paintSelf();loadDeletion();paintCreatorDoor();}
    window.scrollTo({top:0,behavior:"smooth"});
    sizeWorld();
  }

  /* The tab indicator slides to the tab it belongs under, and the row
     scrolls that tab into view on a narrow phone. */
  function moveThumb(scroll) {
    var thumb = $("mnTabsThumb"), tab = document.querySelector(".mn__tabs .is-active");
    if (!thumb || !tab) return;
    thumb.style.width = tab.offsetWidth + "px";
    thumb.style.transform = "translateX(" + tab.offsetLeft + "px)";
    thumb.classList.add("is-on");
    if (scroll && tab.scrollIntoView) tab.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  function editProfile() {
    fillProfileForm(true);
    showGate("profile");
  }

  function changePassword() {
    var password = $("mnNewPassword").value;
    var confirm = $("mnNewPassword2").value;
    var button = $("mnPasswordChange");
    if (password.length < 8) {
      setStatus($("mnPasswordChangeStatus"), "Use at least 8 characters.", "error");
      return;
    }
    if (password !== confirm) {
      setStatus($("mnPasswordChangeStatus"), "Those passwords do not match.", "error");
      return;
    }
    button.disabled = true;
    button.textContent = "Changing…";
    setStatus($("mnPasswordChangeStatus"), "");
    MCC.updatePassword(password).then(function () {
      $("mnNewPassword").value = "";
      $("mnNewPassword2").value = "";
      setStatus($("mnPasswordChangeStatus"), "Password changed. Use the new password the next time you sign in.", "ok");
    }).catch(function (e) {
      setStatus($("mnPasswordChangeStatus"), e.message || "Could not change your password.", "error");
    }).finally(function () {
      button.disabled = false;
      button.textContent = "Change password";
    });
  }

  function setAuthMode(mode) {
    var create = mode === "create";
    $("mnCreateNameWrap").hidden = !create;
    $("mnConfirmWrap").hidden = !create;
    $("mnSignInTab").classList.toggle("is-active", !create);
    $("mnCreateTab").classList.toggle("is-active", create);
    $("mnSignInTab").setAttribute("aria-selected", create ? "false" : "true");
    $("mnCreateTab").setAttribute("aria-selected", create ? "true" : "false");
    $("mnPassword").setAttribute("autocomplete", create ? "new-password" : "current-password");
    $("mnAuthGo").textContent = create ? "Create account" : "Sign in";
    $("mnPasswordHint").hidden = !create;
    $("mnPasswordHint").textContent = "Use at least 8 characters.";
    $("mnForgot").hidden = create;
    $("mnResend").hidden = true;
    $("mnSignedOut").setAttribute("data-auth-mode", create ? "create" : "signin");
    setStatus($("mnAuthStatus"), "");
  }

  /* alerts, message requests and an open conversation stay current while the
     page is visible, for a member who just signed in or came back signed in */
  function startPoll() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(function () {
      if (document.visibilityState !== "visible" || !state.user) return;
      loadNotificationsSilently();
      state.pollTick = (state.pollTick || 0) + 1;
      /* message requests: live while Messages is open, once a minute otherwise */
      if (state.currentView === "messages") loadConversations(); else if (state.pollTick % 4 === 0) refreshMessageBadge();
      if (state.currentConversation && $("mnConversationDialog").open) loadConversationMessages(state.currentConversation);
    }, 15000);
  }
  function enterAfterAuth() {
    return MCC.user().then(function (user) {
      state.user = user;
      if (!user) throw new Error("Your session did not open.");
      leaveGuestWorld();
      state.stall = null;
      if (window.MCC_BAR && MCC_BAR.refreshAuth) MCC_BAR.refreshAuth();
      return MCC.autoTouch().catch(function () {}).then(function () {
        startPoll();
        return bootstrap().catch(function (error) {
          showSignedInLoadError(error);
          return null;
        });
      });
    });
  }

  function submitPasswordAuth() {
    var create = $("mnSignedOut").getAttribute("data-auth-mode") === "create";
    var email = $("mnEmail").value.trim(), password = $("mnPassword").value;
    var button = $("mnAuthGo");
    if (!email || !password) { setStatus($("mnAuthStatus"), "Enter your email and password.", "error"); return; }
    if (create && password.length < 8) { setStatus($("mnAuthStatus"), "Use at least 8 characters.", "error"); return; }
    if (create && password !== $("mnPassword2").value) { setStatus($("mnAuthStatus"), "Those passwords do not match.", "error"); return; }

    button.disabled = true;
    button.textContent = create ? "Creating…" : "Signing in…";
    setStatus($("mnAuthStatus"), "");

    var name = $("mnCreateName").value.trim() || email.split("@")[0];
    var action = create
      ? MCC.signUpWithPassword(email, password, { name:name, full_name:name })
      : MCC.signInWithPassword(email, password);

    Promise.resolve(action).then(function (result) {
      if (create && result && result.existing) {
        setAuthMode("signin");
        $("mnEmail").value = email;
        setStatus($("mnAuthStatus"), "An account already exists for that email. Sign in, or use Forgot password.", "error");
        return null;
      }
      if (create && result && result.confirm) {
        state.pendingVerificationEmail = email;
        setStatus($("mnAuthStatus"), "Check your email to verify your address. After verification, sign in with the password you just created.", "ok");
        $("mnResend").hidden = false;
        return null;
      }
      return enterAfterAuth();
    }).catch(function (e) {
      setStatus($("mnAuthStatus"), e.message || (create ? "Could not create that account." : "Could not sign in."), "error");
    }).finally(function () {
      button.disabled = false;
      button.textContent = create ? "Create account" : "Sign in";
    });
  }

  function boot() {
    mountProviders();
    setAuthMode("signin");
    $("mnSignInTab").onclick = function () { setAuthMode("signin"); };
    $("mnCreateTab").onclick = function () { setAuthMode("create"); };
    $("mnAuthGo").onclick = submitPasswordAuth;
    /* Hands off to forgot-password.html, which explains what the link will do
       and can resend. It no longer demands an email before it will help —
       being locked out is not a reason to be refused the way out. */
    $("mnForgot").onclick = function () {
      var email = $("mnEmail").value.trim();
      location.href = "forgot-password.html" + (email ? "?email=" + encodeURIComponent(email) : "");
    };
    $("mnResend").onclick = function () {
      var email = state.pendingVerificationEmail || $("mnEmail").value.trim(), button = $("mnResend");
      if (!email) return;
      button.disabled = true; button.textContent = "Sending…";
      MCC.resendSignupVerification(email).then(function () {
        setStatus($("mnAuthStatus"), "Verification email sent. Check your inbox and spam folder.", "ok");
        MCC.holdButton(button, 60, "Resend verification email");
      }).catch(function (e) {
        setStatus($("mnAuthStatus"), e.message || "Could not resend verification.", "error");
        if (e.mailQuota) MCC.holdButton(button, e.retryAfter, "Resend verification email");
        else { button.disabled = false; button.textContent = "Resend verification email"; }
      });
    };
    $("mnPassword").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && $("mnSignedOut").getAttribute("data-auth-mode") !== "create") submitPasswordAuth();
    });
    $("mnPassword2").addEventListener("keydown", function (e) { if (e.key === "Enter") submitPasswordAuth(); });
    $("mnProfileForm").addEventListener("submit", saveProfile);
    $("mnPasswordChange").onclick = changePassword;
    $("mnNewPassword2").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); changePassword(); }
    });
    wireAvatarPicker();
    wireTrackPicker();
    $("mnProfileBack").onclick = function () { showGate("app"); setView(needsStep() ? "feed" : "profile"); };
    $("mnFinishGo").onclick = function () {
      if (state.stall === "signin") { openSignIn("signin", "Your sign-in ended. Sign in again."); return; }
      if (state.stall === "retry") { retryStall(); return; }
      askToFinish("act");
    };
    $("mnStallSignIn").onclick = function () { letSessionGo().then(function () { openSignIn("signin", "Sign in again to load your feed."); }); };
    $("mnStepBack").onclick = function () { if (onboard.step > 1) { setStatus($("mnProfileStatus"), ""); showStep(onboard.step - 1); } };
    $("mnHandle").addEventListener("input", function () { clearTimeout(onboard.handleTimer); onboard.handleTimer = setTimeout(checkHandle, 420); });
    /* a field marked bad clears as soon as it is typed in, and so does the reason line */
    $("mnProfileForm").addEventListener("input", function (e) { var f = e.target && e.target.closest && e.target.closest(".mn__field"); if (f && e.target.id !== "mnHandle") f.classList.remove("is-bad"); if (e.target && e.target.id !== "mnHandle") setStatus($("mnProfileStatus"), ""); });
    $("mnPost").onclick = createPost;
    $("mnMediaInput").onchange = function () { uploadMediaFiles(this.files).catch(function () {}); };
    $("mnDiscoverGo").onclick = loadDiscover;
    $("mnShowBlocked").onclick = loadBlocked;
    $("mnDiscoverQuery").addEventListener("keydown", function (e) { if (e.key === "Enter") loadDiscover(); });
    $("mnRefreshMessages").onclick = loadConversations;
    $("mnPersonClose").onclick = function () { $("mnPersonDialog").close(); setView("feed"); };
    $("mnConversationClose").onclick = function () { $("mnConversationDialog").close(); state.currentConversation=null; };
    $("mnMessageForm").addEventListener("submit", sendMessage);
    $("mnAcceptConversation").onclick = function () {
      if (!state.currentConversation) return;
      api("/v1/mnet/conversations/" + encodeURIComponent(state.currentConversation) + "/accept", {method:"POST",body:{}})
        .then(function () { $("mnAcceptConversation").hidden=true; $("mnMessageForm").hidden=false; setStatus($("mnConversationStatus"),"Accepted.","ok"); return loadConversations(); })
        .catch(function (e) { setStatus($("mnConversationStatus"),e.message||"Could not accept request.","error"); });
    };
    $("mnMore").onclick = function () {
      if (state.feedScope === "local" && state.placeScope.enabled) loadPlaceFeed(false);
      else loadFeed(false);
    };
    $("mnRefreshNotifications").onclick = loadNotificationsSilently;
    $("mnPushToggle").onclick = togglePush;
    wireMenu();
    $("mnGuestSignIn").onclick = function () { openSignIn("signin"); };
    $("mnGuestJoin").onclick = function () { openSignIn("create"); };
    document.querySelectorAll("[data-guest-open]").forEach(function (b) { b.onclick = function () { openSignIn(b.getAttribute("data-guest-open")); }; });
    $("mnSignedOutBack").onclick = function () { showGate("app"); setView("feed"); if (!state.feed.length) loadFeed(true); };
    $("mnEditProfile").onclick = editProfile;
    document.querySelectorAll("[data-mn-view]").forEach(function (b) { b.onclick = function () { setView(b.dataset.mnView); }; });
    document.querySelectorAll("[data-feed-scope]").forEach(function (b) { b.onclick = function () { state.world.scopeFromTap = false; setFeedScope(b.dataset.feedScope); }; });
    paintFeedScope();
    loadPlaceStatus();
    $("mnBell").onclick = function () { if ($("mnAlerts").hidden) openAlerts(); else closeAlerts(); };
    /* a tap anywhere else, or Escape, closes the drop down; the page under it never moved */
    document.addEventListener("click", function (e) {
      var pop = $("mnAlerts");
      if (!pop || pop.hidden || pop.contains(e.target) || $("mnBell").contains(e.target)) return;
      closeAlerts();
    }, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("mnAlerts").hidden) { closeAlerts(); $("mnBell").focus(); } });
    /* a tap on the globe lands in its frame, never on this page: the page only sees its window lose focus to the frame */
    window.addEventListener("blur", function () { setTimeout(function () { var f = document.activeElement; if (f && f.tagName === "IFRAME") closeAlerts(); }, 0); });
    $("mnComposerLive").onclick = function () { if (window.MCC_LIVE && MCC_LIVE.studio) MCC_LIVE.studio(); };
    $("mnProfileBlocked").onclick = function () { setView("discover"); loadBlocked(); };
    window.addEventListener("resize", function () { moveThumb(false); });
    /* the header settles into a slimmer bar once the page moves */
    var top = document.querySelector(".mn__top");
    /* the header shrinks on scroll, with hysteresis: shrinking it shortens the page, which moves the scroll, which
       on a page only a little taller than the screen (the onboarding's last page on a phone) grew it back, and so on,
       a jitter at the bottom. Once shrunk it stays until the top; it shrinks only past 24px with room to scroll. */
    window.addEventListener("scroll", function () {
      if (!top) return;
      var y = window.scrollY, on = top.classList.contains("is-scrolled");
      top.classList.toggle("is-scrolled", on ? y > 0 : (y > 24 && document.documentElement.scrollHeight - window.innerHeight > 120));
    }, { passive: true });
    /* the composer is one line until it is used */
    var composer = $("mnComposer"), body = $("mnPostBody");
    if (composer && body) {
      body.addEventListener("focus", function () { composer.classList.add("is-open"); });
      composer.addEventListener("focusout", function () {
        setTimeout(function () {
          if (!composer.contains(document.activeElement) && !body.value.trim() && !state.mediaAssets.length && !$("mnTrackPick").value) composer.classList.remove("is-open");
        }, 150);
      });
    }

    /* NO SIGN-IN FLASH (owner, 2026-10-20: "before I hit the global screen, I see flashes of the sign-in screen"). The
       sign-in form ships hidden and opens only when something asks for it. A member's World shell is up at once while
       the stored session is checked over the network, instead of the form standing there for that wait. */
    var stored = MCC.session && MCC.session();
    if (stored && stored.access_token) showGate("app");
    MCC.user().then(function (user) {
      state.user = user;
      if (!user) {
        var existing = MCC.session && MCC.session();
        if (existing && existing.access_token) showSignedInLoadError(new Error("Could not verify the existing session."));
        else enterGuestWorld();
        return;
      }
      return MCC.autoTouch().catch(function () {}).then(function () {
        startPoll();
        return bootstrap().catch(function (error) {
          showSignedInLoadError(error);
          return null;
        });
      });
    }).catch(function (error) {
      var existing = MCC.session && MCC.session();
      if (existing && existing.access_token) showSignedInLoadError(error);
      else enterGuestWorld();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* ---------- THE HANDLE IS THE USERNAME, SO SAY SO WHILE THEY TYPE ----
     Every account already picks one here and the database has always made
     it unique. What it could not do was tell you BEFORE you submitted: you
     filled the whole form, pressed save, and got the name back as an error.
     mccluster_id_check answers while the field is still focused, and
     answers with the reason rather than a bare "unavailable".

     It is advisory on purpose. The unique index is what actually decides,
     because somebody can claim the name between this answer and the save. */
  (function handleAvailability() {
    var field = $("mnHandle");
    if (!field || !window.MCC_SUPA) return;

    var note = document.createElement("p");
    note.className = "mn__hint";
    note.id = "mnHandleState";
    note.setAttribute("role", "status");
    field.closest(".mn__handle-row").insertAdjacentElement("afterend", note);

    var timer = null, seq = 0;
    function say(text, kind) {
      note.textContent = text || "";
      note.style.color = kind === "bad" ? "#ff8e8e" : kind === "ok" ? "#9fdaa9" : "";
    }

    function ask() {
      var want = field.value.trim();
      if (!want) { say(""); return; }
      var mine = ++seq;
      say("Checking…");
      window.MCC_SUPA.token().then(function (t) {
        if (!t) return null;
        return fetch(window.MCC_SUPA.url + "/rest/v1/rpc/mccluster_id_check", {
          method: "POST",
          headers: { apikey: window.MCC_SUPA.key, authorization: "Bearer " + t,
                     "content-type": "application/json" },
          body: JSON.stringify({ p_id: want })
        }).then(function (r) { return r.ok ? r.json() : null; });
      }).then(function (out) {
        if (mine !== seq) return;              // a newer keystroke won
        if (!out) { say(""); return; }         // cannot check: the save still will
        say(out.ok ? "@" + want + " is free." : out.reason, out.ok ? "ok" : "bad");
      }).catch(function () { if (mine === seq) say(""); });
    }

    field.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(ask, 350);            // a keystroke is not a question
    });
    field.addEventListener("blur", function () { clearTimeout(timer); ask(); });
  })();


  /* ================= GROUPS =================
     Rooms inside the network, following two Mobbin references: Lex splits
     "Your groups" from "Explore" inside one screen rather than making them
     two places, and X's group detail leads with a cover, the name, one line
     of what the room is for, and then its feed.

     THE COVER IS GENERATED. Each group gets a gradient derived from its
     slug, so the rooms are distinguishable at a glance and stay the same
     colour between visits, without anybody having to make artwork for five
     rooms that may become fifty. It is abstract colour and never a mark.
     The pairs are picked, not computed from a hash into arbitrary hues, so
     every room lands somewhere that was chosen to sit on this surface. */
  var GROUP_SKINS = [
    ["#e5383b", "#7a1721"], ["#3f93d2", "#17324f"], ["#c98500", "#4a3105"],
    ["#199e70", "#0c3b2b"], ["#8b5cf6", "#2e1a52"], ["#d9a441", "#4b3512"],
    ["#d4448c", "#4d1435"], ["#2bb3a3", "#0b3a35"], ["#6d7ce6", "#22265c"],
    ["#e0692c", "#4a2009"], ["#5aa832", "#1b3610"], ["#b0568f", "#3a1a2f"]
  ];
  /* FNV-1a rather than the n*31 hash this first used. That one put
     the-listening-room, first-listens and behind-the-record on the same
     amber, because multiplying by 31 leaves short similar strings close
     together in the low bits, which is exactly where a modulo reads. */
  function skinSeed(slug) {
    var str = String(slug || ""), h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h;
  }
  /* The seed alone is not enough. Twelve skins and five rooms still put two
     of them on the same purple, and a cover exists to tell rooms apart, so
     "usually distinct" is the wrong guarantee. The seed picks a starting
     slot and a taken slot probes forward to the next free one, which is
     deterministic for a given list and distinct up to the palette size.
     Rooms only change colour if the list itself changes. */
  var skinOf = {};
  function assignSkins(list) {
    skinOf = {};
    var taken = {};
    list.slice().sort(function (a, b) {
      return String(a.slug).localeCompare(String(b.slug));   // order-independent
    }).forEach(function (g) {
      var i = skinSeed(g.slug) % GROUP_SKINS.length, n = 0;
      while (taken[i] && n < GROUP_SKINS.length) { i = (i + 1) % GROUP_SKINS.length; n++; }
      taken[i] = true;
      skinOf[g.slug] = i;
    });
  }
  function groupSkin(slug) {
    var i = skinOf[slug];
    if (i === undefined) i = skinSeed(slug) % GROUP_SKINS.length;
    var pair = GROUP_SKINS[i];
    return "linear-gradient(135deg," + pair[0] + " 0%," + pair[1] + " 100%)";
  }
  function people(n) {
    n = Number(n || 0);
    return n.toLocaleString() + " member" + (n === 1 ? "" : "s");
  }

  var groups = { all: [], seg: "yours", open: null, busy: false, target: null, q: "" };

  function groupCard(g) {
    return '<article class="mng__card" data-group="' + esc(g.slug) + '">' +
      '<div class="mng__cover" style="background:' + groupSkin(g.slug) + '">' +
        "<b>" + esc((g.name || "?").trim().charAt(0).toUpperCase()) + "</b></div>" +
      '<div class="mng__body">' +
        '<h3 class="mng__name">' + esc(g.name) + "</h3>" +
        '<p class="mng__purpose">' + esc(g.purpose || "") + "</p>" +
        '<div class="mng__foot">' +
          '<span class="mng__count">' + esc(people(g.member_count)) + "</span>" +
          '<button type="button" class="mng__join' + (g.joined ? " is-in" : "") +
            '" data-join="' + esc(g.slug) + '">' + (g.joined ? "Joined" : "Join") + "</button>" +
        "</div></div></article>";
  }

  function renderGroups() {
    var host = $("mngCards");
    if (!host) return;
    var mine = groups.all.filter(function (g) { return g.joined; });
    var list = groups.seg === "yours" ? mine : groups.all;
    /* "Groups about ..." from the World search narrows the list here */
    var q = groups.q, chip = $("mngQuery");
    if (q) list = list.filter(function (g) { return [g.name, g.purpose, g.slug].join(" ").toLocaleLowerCase().indexOf(q) !== -1; });
    if (chip) { chip.hidden = !q; $("mngQueryText").textContent = q ? "Groups about \u201c" + q + "\u201d" : ""; }

    if (!list.length && q) {
      host.innerHTML = '<p class="mng__empty"><b>No groups about \u201c' + esc(q) + '\u201d yet.</b>Clear the search to see them all.</p>';
      return;
    }
    if (!list.length) {
      host.innerHTML = '<p class="mng__empty">' + (groups.seg === "yours"
        ? "<b>You have not joined a room yet.</b>Explore is where they are. " +
          "Joining one puts its posts in front of you and yours in front of the people already there."
        : "<b>No rooms yet.</b>They arrive with the next release.") + "</p>";
      return;
    }
    host.innerHTML = '<div class="mng__grid">' + list.map(groupCard).join("") + "</div>";
    /* a ?group= link lands on its room: scrolled to, and marked */
    if (groups.target) {
      var card = host.querySelector('[data-group="' + groups.target + '"]');
      if (card) {
        card.classList.add("is-target");
        try { card.scrollIntoView({ block: "center" }); } catch (_) {}
        groups.target = null;
      }
    }
  }

  /* A shared group link (mnet.html?group=equity-uprise) opens Explore on
     that room, the way ?mission= opens a mission. Unknown slugs simply
     land on Explore. */
  function openDeepLinkedGroup() {
    if (/[?&]mission=/.test(location.search)) return;
    var slug = null, view = null;
    try { var u = new URLSearchParams(location.search); slug = u.get("group"); view = u.get("view"); } catch (_) {}
    /* ?view=missions opens a tab by name (the Action Record lives there) */
    if (!slug && view && /^(live|clips|feed|missions|discover|groups|messages|notifications|profile)$/.test(view)) { setView(view); return; }
    if (!slug || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(slug)) return;
    groups.target = slug;
    groups.q = "";
    groups.seg = "explore";
    Array.prototype.forEach.call(document.querySelectorAll("[data-mng-seg]"), function (x) {
      var on = x.getAttribute("data-mng-seg") === "explore";
      x.classList.toggle("is-on", on);
      x.setAttribute("aria-selected", on ? "true" : "false");
    });
    setView("groups");
  }

  function exploreGroups(q) {
    groups.q = String(q || "").trim().toLocaleLowerCase().slice(0, 80);
    groups.seg = "explore";
    Array.prototype.forEach.call(document.querySelectorAll("[data-mng-seg]"), function (x) {
      var on = x.getAttribute("data-mng-seg") === "explore";
      x.classList.toggle("is-on", on);
      x.setAttribute("aria-selected", on ? "true" : "false");
    });
    if ($("mnGroupsOne") && !$("mnGroupsOne").hidden) closeGroup();
    setView("groups");
  }
  function loadGroups() {
    var host = $("mngCards");
    if (!host) return Promise.resolve();
    if (!groups.all.length) host.innerHTML = '<p class="mng__empty">Loading rooms…</p>';
    return api("/v1/mnet/groups").then(function (out) {
      groups.all = (out && out.groups) || [];
      assignSkins(groups.all);
      renderGroups();
    }).catch(function (e) {
      host.innerHTML = '<p class="mng__empty"><b>The rooms did not load.</b>' +
        esc(e.message || "") + "</p>";
    });
  }

  /* Optimistic, then reconciled. A join that waits on a round trip before
     the button changes feels broken on a phone; a join that never reconciles
     lies when the request fails. */
  function toggleJoin(slug, button) {
    if (groups.busy) return;
    var g = groups.all.filter(function (x) { return x.slug === slug; })[0];
    if (!g) return;
    groups.busy = true;
    var was = !!g.joined;
    g.joined = !was;
    g.member_count = Math.max(0, Number(g.member_count || 0) + (was ? -1 : 1));
    if (button) {
      button.classList.toggle("is-in", g.joined);
      button.textContent = g.joined ? "Joined" : "Join";
      button.disabled = true;
    }
    return api("/v1/mnet/groups/" + encodeURIComponent(slug) + "/membership",
      { method: was ? "DELETE" : "POST" })
      .then(function (out) {
        g.joined = !!(out && out.joined);
      })
      .catch(function () {
        g.joined = was;                                  // put it back
        g.member_count = Math.max(0, Number(g.member_count || 0) + (was ? 1 : -1));
      })
      .then(function () {
        groups.busy = false;
        if (groups.open && groups.open.slug === slug) { groups.open.joined = g.joined; paintGroup(); }
        renderGroups();
      });
  }

  function paintGroup() {
    var g = groups.open;
    if (!g) return;
    $("mngHead").innerHTML =
      '<div class="mng__banner" style="background:' + groupSkin(g.slug) + '"></div>' +
      '<div class="mng__headin"><h2>' + esc(g.name) + "</h2>" +
        '<span class="mng__meta">' +
          esc(g.visibility === "open" ? "Open group" : g.visibility === "request" ? "Approval to join" : "Invitation only") +
          " · " + esc(people(g.member_count)) + "</span>" +
        "<p>" + esc(g.purpose || "") + "</p>" +
        '<button type="button" class="mng__join' + (g.joined ? " is-in" : "") +
          '" data-join="' + esc(g.slug) + '">' + (g.joined ? "Joined" : "Join this group") + "</button>" +
      "</div>";
    var org=groups.organization, campaigns=groups.campaigns||[];
    if(org){
      $("mngHead").insertAdjacentHTML("beforeend",
        '<div class="mng__org"><span>Organization</span><strong>'+esc(org.name)+'</strong>'+
        (org.verification_state==="verified"?'<b>Verified</b>':'')+'</div>');
    }
    if(campaigns.length){
      $("mngHead").insertAdjacentHTML("beforeend",
        '<div class="mng__campaigns">'+campaigns.map(function(c){
          return '<a class="mng__campaign" href="action/?c='+encodeURIComponent(c.slug)+'"><span>Campaign</span><strong>'+esc(c.title)+'</strong><em>Take action →</em></a>';
        }).join("")+'</div>');
    }
    $("mngComposer").hidden = !g.joined;
  }

  function openGroup(slug) {
    $("mnGroupsList").hidden = true;
    $("mnGroupsOne").hidden = false;
    $("mngFeed").innerHTML = '<p class="mng__empty">Loading…</p>';
    window.scrollTo({ top: 0, behavior: "smooth" });
    return api("/v1/mnet/groups/" + encodeURIComponent(slug)).then(function (out) {
      groups.open = out.group;
      groups.organization = out.organization || null;
      groups.campaigns = out.campaigns || [];
      if (skinOf[out.group.slug] === undefined) assignSkins(groups.all.concat([out.group]));
      paintGroup();
      var items = out.items || [];
      $("mngFeed").innerHTML = items.length
        ? items.map(function (it) { return postCard(it); }).join("")
        : '<p class="mng__empty"><b>Nothing here yet.</b>' +
          (out.group.joined ? "Be the first to say something."
                            : "Join to see what gets posted, and to post yourself.") + "</p>";
    }).catch(function (e) {
      $("mngFeed").innerHTML = '<p class="mng__empty"><b>That room did not open.</b>' +
        esc(e.message || "") + "</p>";
    });
  }

  function closeGroup() {
    groups.open = null;
    groups.organization = null;
    groups.campaigns = [];
    $("mnGroupsOne").hidden = true;
    $("mnGroupsList").hidden = false;
    renderGroups();
  }

  function postToGroup() {
    var g = groups.open, body = ($("mngPostBody").value || "").trim();
    if (!g || !body) return;
    var button = $("mngPost");
    button.disabled = true;
    setStatus($("mngPostStatus"), "Posting…");
    api("/v1/mnet/posts?app_key=" + encodeURIComponent(APP), {
      method: "POST",
      body: { body: body, group_id: g.id }
    }).then(function () {
      $("mngPostBody").value = "";
      setStatus($("mngPostStatus"), "");
      return openGroup(g.slug);
    }).catch(function (e) {
      setStatus($("mngPostStatus"), e.message || "Could not post.", "bad");
    }).then(function () { button.disabled = false; });
  }

  (function wireGroups() {
    var view = $("mnGroupsView");
    if (!view) return;
    view.addEventListener("click", function (e) {
      var seg = e.target.closest && e.target.closest("[data-mng-seg]");
      if (e.target.closest && e.target.closest("#mngQueryClear")) { groups.q = ""; renderGroups(); return; }
      if (seg) {
        groups.seg = seg.getAttribute("data-mng-seg");
        Array.prototype.forEach.call(view.querySelectorAll("[data-mng-seg]"), function (x) {
          x.classList.toggle("is-on", x === seg);
          x.setAttribute("aria-selected", x === seg ? "true" : "false");
        });
        renderGroups();
        return;
      }
      /* The join button sits inside the card, and the card opens the room.
         Checking join first is what stops a join from also navigating. */
      var join = e.target.closest && e.target.closest("[data-join]");
      if (join) { e.stopPropagation(); toggleJoin(join.getAttribute("data-join"), join); return; }
      if (e.target.closest && e.target.closest("#mngBack")) { closeGroup(); return; }
      var card = e.target.closest && e.target.closest("[data-group]");
      if (card) openGroup(card.getAttribute("data-group"));
    });
    var post = $("mngPost");
    if (post) post.addEventListener("click", postToGroup);
  })();


  /* ---------------- MISSIONS ----------------
     See → Understand → Choose → Act → Prove → Verify → Progress.
     Every write goes through a server function (join_action_mission,
     submit_action_proof, withdraw_action_mission): the server decides who
     you are, whether the mission is open, and what state your work is in.
     The page only reads. */
  var FELLOWSHIP_MIN_VERIFIED = 3; // owner-set threshold; see docs/ACTION-NETWORK-REWARD-SYSTEM.md
  var missions={all:[],current:null,assignment:null,record:null,fellowship:null,stats:{},deepLinked:false,campaign:"",content:"",source:"",attributedMission:"",liveSession:"",liveMission:"",returnHref:"",proofFile:null,proofPreview:""};
  var worldMissionDeck=null,worldMissionDeckLoaded=false,worldMissionDeckRequest=null;
  function sbRest(path,init){
    var token=sessionToken()||SB_KEY; init=init||{}; var headers=Object.assign({apikey:SB_KEY,authorization:"Bearer "+token,"content-type":"application/json"},init.headers||{});
    return fetch(SB_URL+"/rest/v1/"+path,Object.assign({},init,{headers:headers})).then(parse);
  }
  function sbRpc(name,args){return sbRest("rpc/"+name,{method:"POST",body:JSON.stringify(args||{})});}
  /* The few things the separate live module needs from this one. */
  window.MCC_MNET = {
    markTourSeen: function () { return sbRpc("mnet_mark_tour_seen", { p_app_key: APP }).catch(function () {}); },
    api: api, sbRest: sbRest, sbRpc: sbRpc, esc: esc, app: APP,
    /* the live studio (js/mnet-live.js) offers to place a broadcast in the country on the globe, when the country feed is on */
    placeForLive: function () { var c = state.world.country; return state.placeScope.enabled && c && /^[A-Z]{2}$/.test(c.code || "") ? { code: c.code, name: c.name || placeName(c.code) } : null; },
    /* the audio rooms (js/mnet-audio.js) send a signed-out visitor here to go past their own region */
    signIn: function (why) { askToSignIn(why); },
    identity: function () { return identity(); },
    /* the member desk (js/member-desk.js) reads the profile and opens the editor */
    profile: function () { return profile(); },
    editProfile: function () { return editProfile(); },
    refreshFeed: function () { return loadFeed(true); },
    setView: setView,
    openMissionFromLive: function (sessionId, missionId) {
      if(!/^[0-9a-f-]{36}$/i.test(String(sessionId||""))||!/^[0-9a-f-]{36}$/i.test(String(missionId||"")))return;
      missions.liveSession=String(sessionId);missions.liveMission=String(missionId);
      missions.content="";missions.source="";missions.attributedMission="";
      setView("missions");openMission(String(missionId));
    }
  };
  /* DELETING THE ACCOUNT. The request is recorded at once and the desk
     completes it within 30 days; until then the member can keep the account. */
  function paintDeletion(r){
    var pending=r&&r.status==="pending";
    $("mnDeleteGo").hidden=pending;$("mnDeleteCancel").hidden=!pending;
    if(pending)$("mnDeleteState").textContent="Your account is set to be deleted on "+new Date(r.due_by).toLocaleDateString(undefined,{month:"long",day:"numeric",year:"numeric"})+". Until then you can keep it.";
  }
  function loadDeletion(){if(!$("mnDelete"))return;sbRpc("my_account_deletion").then(paintDeletion).catch(function(){});}
  (function wireDeletion(){
    if(!$("mnDelete"))return;
    $("mnDeleteSure").onchange=function(){$("mnDeleteConfirm").disabled=!this.checked;};
    $("mnDeleteConfirm").onclick=function(){
      var b=this;b.disabled=true;setStatus($("mnDeleteStatus"),"Recording your request…");
      sbRpc("request_account_deletion",{p_reason:($("mnDeleteReason").value||"").trim()||null}).then(function(r){
        paintDeletion(r);setStatus($("mnDeleteStatus"),"Done. Signing you out.","ok");
        if(window.MCC_TRACK)window.MCC_TRACK("account_delete_request",{});
        setTimeout(function(){Promise.resolve(window.MCC&&MCC.signOut&&MCC.signOut()).then(function(){location.href="mnet.html";});},1600);
      }).catch(function(e){b.disabled=false;setStatus($("mnDeleteStatus"),e.message||"Could not record that. Email matthew@mccluster.org and it will be done by hand.","error");});
    };
    $("mnDeleteCancel").onclick=function(){
      sbRpc("cancel_account_deletion").then(function(){$("mnDeleteState").textContent="Your account is staying. Nothing will be deleted.";paintDeletion({});setStatus($("mnDeleteStatus"),"Kept.","ok");})
        .catch(function(e){setStatus($("mnDeleteStatus"),e.message||"Could not cancel.","error");});
    };
  })();

  function safeMissionReturn(value){
    if(!value)return "";
    try{
      var u=new URL(value,location.href);
      if(u.origin!==location.origin)return "";
      if(/\/mnet\.html$/i.test(u.pathname))return "";
      return u.pathname+u.search+u.hash;
    }catch(_){return "";}
  }
  function readMissionContext(){
    try{
      var q=new URLSearchParams(location.search);
      var c=q.get("campaign")||"", content=q.get("content")||"", source=q.get("src")||"", mission=q.get("mission")||"", live=q.get("live")||"";
      if(/^[a-z0-9][a-z0-9-]{0,79}$/i.test(c))missions.campaign=c;
      if(/^[0-9a-f-]{36}$/i.test(content))missions.content=content;
      if(missions.content&&/^[0-9a-f-]{36}$/i.test(mission))missions.attributedMission=mission;
      if(/^[0-9a-f-]{36}$/i.test(live)&&/^[0-9a-f-]{36}$/i.test(mission)){missions.liveSession=live;missions.liveMission=mission;missions.content="";missions.source="";missions.attributedMission="";}
      if(/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(source))missions.source=source.toLowerCase();
      missions.returnHref=safeMissionReturn(q.get("return"));
    }catch(_){}
  }
  readMissionContext();
  function missionHref(id){
    var q=new URLSearchParams();
    q.set("view","missions");
    q.set("mission",id);
    if(missions.campaign)q.set("campaign",missions.campaign);
    if(missions.content&&missions.attributedMission===id)q.set("content",missions.content);
    if(missions.source&&missions.attributedMission===id)q.set("src",missions.source);
    if(missions.liveSession&&missions.liveMission===id)q.set("live",missions.liveSession);
    if(missions.returnHref)q.set("return",missions.returnHref);
    return "/mnet.html?"+q.toString();
  }
  function receiptHref(assignmentId){return "/receipt.html?a="+encodeURIComponent(assignmentId);}
  function missionCard(m){
    var st=missions.stats[m.id]||{}, joined=Number(st.joined)||0, submitted=Number(st.submitted)||0, verified=Number(st.verified)||0;
    var activity=joined+" joined · "+verified+" completed"+(submitted?" · "+submitted+" awaiting review":"");
    var mine=missions.levelsByMission&&missions.levelsByMission[m.id];
    if(m.id===ANTISOCIAL_ID)activity="One mission, three levels"+(mine?" · you: "+mine.done+" / "+mine.total:"")+" · "+activity;
    /* where it started, what comes next, how far it reaches, its own call to action:
       action_mission_card_extras() (pending SQL); absent until applied, so nothing shows */
    var x=missions.extras&&missions.extras[m.id]||{};
    var extra=(x.origin_label?'<p class="mn__hint">'+esc(x.origin_label)+' · open to everyone</p>':"")+
      (x.country_count>1?'<p class="mn__hint">On the World in '+esc(x.country_count)+' countries</p>':"")+
      (x.next_mission_title?'<p class="mn__hint">Next in this arc: '+esc(x.next_mission_title)+'</p>':"")+
      (x.previous_mission_title?'<p class="mn__hint">Opens once your \u201c'+esc(x.previous_mission_title)+'\u201d is verified</p>':"");
    var cta=x.cta_key==="business_listing"?' <button class="mn__quiet" type="button" data-open-mission="'+esc(m.id)+'" data-focus="business">'+esc(x.cta_label||"Put your Black business on the map")+'</button>':"";
    return '<article class="mn__panel" data-mission="'+esc(m.id)+'"><p class="mn__eyebrow">'+esc(m.domain||"community")+' · difficulty '+esc(m.difficulty)+'</p><h3>'+esc(m.title)+'</h3><p>'+esc(m.description||"")+'</p><small>'+esc(m.base_points)+' base pts · '+esc((m.skills||[]).join(" · "))+'</small><p class="mn__hint">'+esc(activity)+'</p>'+extra+'<div><button class="mn__primary" type="button" data-open-mission="'+esc(m.id)+'">View mission</button>'+cta+'</div></article>';
  }
  /* Public display name; stable mission IDs and the published historical source remain unchanged. */
  function publicMission(m) {
    return m && m.title === "Write the Change" ? Object.assign({}, m, { title: "Write a Song" }) : m;
  }
  var MISSION_FIELDS="id,campaign_id,title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,capacity,status,starts_at,ends_at";
  var missionListVersion=0;
  function loadMissions(){
    var version=++missionListVersion;
    var host=$("mnMissionList"); if(!host)return Promise.resolve(); setStatus($("mnMissionStatus"),"Loading missions…");
    if(!state.guest&&state.user)loadActionRecord();
    if(worldMissionDeck)worldMissionDeck.loading();
    var campaignFilter=missions.campaign?"&campaign_id=eq."+encodeURIComponent(missions.campaign):"";
    return Promise.all([
      /* select=* carries kind, so clip campaigns can be left to the Clips tab */
      sbRest("action_missions?status=eq.open"+campaignFilter+"&select=*&order=created_at.desc"),
      sbRpc("action_mission_stats",{p_campaign:missions.campaign||null}).catch(function(){return [];}),
      sbRpc("action_mission_card_extras",{}).catch(function(){return [];})
    ]).then(function(out){
      if(version!==missionListVersion)return;
      missions.extras={};(Array.isArray(out[2])?out[2]:[]).forEach(function(x){if(x&&x.mission_id)missions.extras[x.mission_id]=x;});
      /* clip campaigns are paid work and live in the Clips tab */
      missions.all=(out[0]||[]).filter(function(m){return m.kind!=="clip";}).map(publicMission);missions.stats={};
      (out[1]||[]).forEach(function(st){if(st&&st.mission_id)missions.stats[st.mission_id]=st;});
      var helpGateway=(!missions.campaign||missions.campaign==="homelessness-action-001")
        ? '<article class="mn__panel"><p class="mn__eyebrow">Help · private resource navigation</p><h3>Find services for yourself or someone you know</h3><p>Official national and international resource directories. No account or public proof required.</p><a class="mn__primary" href="/help.html">Find help now ↗</a></article>' : "";
      host.innerHTML=helpGateway+(missions.all.length?missions.all.map(missionCard).join(""):(helpGateway?"":'<div class="mn__empty">No open missions right now.</div>'));
      if(worldMissionDeck)worldMissionDeck.update(missions.all);
      worldMissionDeckLoaded=true;
      paintActionRecord();
      setStatus($("mnMissionStatus"),"");
      return true;
    }).catch(function(e){if(version===missionListVersion){setStatus($("mnMissionStatus"),e.message||"Missions could not load.","error");if(worldMissionDeck)worldMissionDeck.fail(e.message||"Missions could not load.");}return false;});
  }

  /* THE ACTION RECORD: verified work, skills, cohorts, and what it unlocks.
     Points are feedback; access is the reward. */
  var STATUS_LABEL={in_progress:"In progress",joined:"In progress",submitted:"Waiting for review",verified:"Verified",rejected:"Not verified"};
  function loadActionRecord(){
    return Promise.all([
      sbRpc("action_record").catch(function(){return null;}),
      sbRpc("action_fellowship_status").catch(function(){return null;}),
      sbRpc("my_action_shares").catch(function(){return [];})
    ]).then(function(x){
      missions.record=x[0]||null;missions.fellowship=x[1]||null;
      missions.shared={};(x[2]||[]).forEach(function(s){missions.shared[s.assignment_id]=s.post_id;});
      paintActionRecord();
    });
  }
  function shareAction(b){
    var id=b.getAttribute("data-share-action");b.disabled=true;b.textContent="Sharing…";
    sbRpc("share_verified_action",{p_assignment_id:id}).then(function(){
      if(window.MCC_TRACK)window.MCC_TRACK("action_share",{});
      return loadActionRecord().then(function(){return loadFeed(true);});
    }).catch(function(e){b.disabled=false;b.textContent="Share to feed";setStatus($("mnMissionStatus"),e.message||"Could not share that.","error");});
  }
  /* THE FELLOWSHIP. Three verified actions open the application; the
     server counts them, so the form only appears when it will be accepted. */
  function fellowshipBlock(verified){
    var f=missions.fellowship||{}, need=Number(f.needed)||FELLOWSHIP_MIN_VERIFIED, app=f.application, left=f.eligible?0:Math.max(0,need-verified);
    if(app&&app.status==="accepted")return '<div class="mn__record-unlock is-open"><b>You are a Equity Uprise fellow.</b>'+(app.review_note?'<span class="mn__fellow-note">'+esc(app.review_note)+'</span>':"")+'</div>';
    if(app&&app.status==="submitted")return '<div class="mn__record-unlock is-open"><b>Your fellowship application is in review.</b> You will see the decision here.</div>';
    if(left>0)return '<p class="mn__record-unlock"><b>'+left+' more verified '+(left===1?"action":"actions")+'</b> until you can apply for the fellowship.</p>';
    var declined=app&&app.status==="declined";
    return '<div class="mn__record-unlock is-open"><b>You can apply for the fellowship.</b> Your verified record is enough to be considered.'+
      (declined&&app.review_note?'<span class="mn__fellow-note">Last time: '+esc(app.review_note)+'</span>':"")+
      '<button class="mn__primary mn__fellow-open" type="button" data-fellow-open>Apply for the fellowship</button>'+
      '<form class="mn__fellow-form" id="mnFellowForm" hidden>'+
        '<label class="mn__label" for="mnFellowWhy">Why do you want in?</label>'+
        '<textarea class="mn__input mn__textarea" id="mnFellowWhy" rows="4" maxlength="3000" placeholder="What you have been doing, and what you want to do next."></textarea>'+
        '<label class="mn__label" for="mnFellowProject">What would you build or lead? <span>optional</span></label>'+
        '<textarea class="mn__input mn__textarea" id="mnFellowProject" rows="3" maxlength="3000"></textarea>'+
        '<label class="mn__label" for="mnFellowHours">Hours a week you can give <span>optional</span></label>'+
        '<input class="mn__input" id="mnFellowHours" type="number" min="1" max="60" inputmode="numeric">'+
        '<button class="mn__primary" type="submit">Send my application</button>'+
        '<p class="mn__status" id="mnFellowStatus" role="status"></p>'+
      '</form></div>';
  }
  function submitFellowship(ev){
    ev.preventDefault();var b=ev.target.querySelector('button[type="submit"]');b.disabled=true;
    var hours=parseInt($("mnFellowHours").value,10);
    sbRpc("apply_for_fellowship",{p_why:($("mnFellowWhy").value||"").trim(),p_project:($("mnFellowProject").value||"").trim(),p_hours_per_week:isFinite(hours)?hours:null})
      .then(function(){if(window.MCC_TRACK)window.MCC_TRACK("fellowship_apply",{});return loadActionRecord();})
      .catch(function(e){setStatus($("mnFellowStatus"),e.message||"Your application could not be sent.","error");b.disabled=false;});
  }
  /* WHAT'S NEXT (owner, 2026-10-20: a finished mission should lead somewhere). Once something is verified, the record
     names one open mission the member has not taken: one sharing a skill or a field with what they finished, else the
     one most people have joined. Nothing shows when there is nothing new to take. */
  function nextMission(r){
    var taken={}, ref={};
    (r.missions||[]).forEach(function(m){taken[m.mission_id]=m;});
    var done=(r.missions||[]).filter(function(m){return m.status==="verified";});
    var open=(missions.all||[]).filter(function(m){return !taken[m.id];});
    if(!done.length||!open.length)return null;
    // the record carries each finished mission's skills and field, even once that mission has closed
    done.forEach(function(d){
      var m=d.skills||d.domain?d:(missions.all||[]).find(function(x){return x.id===d.mission_id;});
      if(m){(m.skills||[]).forEach(function(k){ref["s:"+k]=1;});if(m.domain)ref["d:"+m.domain]=1;}
    });
    function near(m){var n=m.domain&&ref["d:"+m.domain]?1:0;(m.skills||[]).forEach(function(k){if(ref["s:"+k])n+=2;});return n;}
    function joined(m){return Number((missions.stats[m.id]||{}).joined)||0;}
    return open.slice().sort(function(a,b){return near(b)-near(a)||joined(b)-joined(a);})[0];
  }
  function paintActionRecord(){
    var r=missions.record; if(!r)return;
    var verified=Number(r.verified_actions)||0, points=Number(r.points)||0, cohorts=r.cohorts||[];
    if($("mnActionScore"))$("mnActionScore").textContent=points.toLocaleString()+" pts";
    if($("mnVerifiedActions"))$("mnVerifiedActions").textContent=verified.toLocaleString();
    if($("mnCohortProgress"))$("mnCohortProgress").textContent=cohorts.length?(cohorts[0].goal_points?Math.min(100,Math.round(cohorts[0].points/cohorts[0].goal_points*100))+"%":cohorts[0].name):"-";
    var host=$("mnRecord"); if(!host)return;
    var fellowship=fellowshipBlock(verified);
    var skills=(r.skills||[]).map(function(k){var top=(r.skills[0]&&r.skills[0].xp)||1;return '<li><span>'+esc(k.skill)+'</span><i style="--pct:'+Math.max(4,Math.round(k.xp/top*100))+'%"></i><b>'+esc(k.verified_actions)+'</b></li>';}).join("");
    missions.levelsByMission={};
    var list=(r.missions||[]).map(function(m){
      /* a mission with levels reads its progress: n / 3 (owner, 2026-10-14: 1 / 3 → 2 / 3 → 3 / 3) */
      var done=(m.levels||[]).filter(function(x){return x.status==="verified";}).length, total=Number(m.level_count)||0;
      if(total)missions.levelsByMission[m.mission_id]={done:done,total:total,status:m.status};
      var label=total?(m.status==="verified"?total+" / "+total+" · Verified":done+" / "+total+(m.status==="submitted"||(m.levels||[]).some(function(x){return x.status==="pending";})?" · Awaiting review":" · In progress")):(STATUS_LABEL[m.status]||m.status);
      return '<li class="mn__record-item is-'+esc(m.status)+'"><button type="button" data-open-mission="'+esc(m.mission_id)+'"><b>'+esc(m.title)+'</b><span>'+esc(label)+(m.points?" · "+esc(m.points)+" pts":"")+'</span></button>'+
        (m.status==="verified"?'<a class="mn__record-receipt" href="'+esc(receiptHref(m.assignment_id))+'">Receipt</a>'+
          (missions.shared&&missions.shared[m.assignment_id]?'<span class="mn__record-shared">On the feed</span>':'<button class="mn__record-share" type="button" data-share-action="'+esc(m.assignment_id)+'">Share to feed</button>'):"")+
        (m.status==="rejected"&&m.review_note?'<small>'+esc(m.review_note)+'</small>':"")+'</li>';
    }).join("");
    host.hidden=false;
    var next=nextMission(r);
    host.innerHTML='<div class="mn__record-head"><div><p class="mn__eyebrow">Your Action Record</p><h2>'+verified+' verified '+(verified===1?"action":"actions")+'</h2></div><strong>'+points.toLocaleString()+' pts</strong></div>'+
      (next?'<div class="mn__record-next"><p class="mn__eyebrow">Next for you</p><b>'+esc(next.title)+'</b><button class="mn__primary" type="button" data-open-mission="'+esc(next.id)+'">View mission</button></div>':"")+
      fellowship+
      (skills?'<ul class="mn__record-skills">'+skills+'</ul>':"")+
      (cohorts.length?'<ul class="mn__record-cohorts">'+cohorts.map(function(c){return '<li><b>'+esc(c.name)+'</b><span>'+esc(c.members)+' members · '+esc(Number(c.points).toLocaleString())+(c.goal_points?" of "+esc(Number(c.goal_points).toLocaleString()):"")+' pts</span></li>';}).join("")+'</ul>':"")+
      (list?'<ul class="mn__record-list">'+list+'</ul>':'<p class="mn__record-empty">Take a mission below. When your proof is verified, it lands here.</p>');
  }

  function fetchMission(id){
    var hit=missions.all.find(function(x){return x.id===id;});
    if(hit)return Promise.resolve(hit);
    return sbRest("action_missions?id=eq."+encodeURIComponent(id)+"&select="+MISSION_FIELDS+"&limit=1").then(function(rows){return rows&&rows[0]?publicMission(rows[0]):null;});
  }
  function clearMissionCapture(){
    if(missions.proofPreview){try{URL.revokeObjectURL(missions.proofPreview);}catch(_){} missions.proofPreview="";}
    missions.proofFile=null;
    var host=$("mnMissionCapturePreview");if(host){host.hidden=true;host.innerHTML="";}
    if($("mnMissionCameraFile"))$("mnMissionCameraFile").value="";
    if($("mnMissionProofFile"))$("mnMissionProofFile").value="";
  }
  function paintMissionCapture(file){
    if(!file)return;
    clearMissionCapture();
    missions.proofFile=file;
    missions.proofPreview=URL.createObjectURL(file);
    var host=$("mnMissionCapturePreview");
    if(host){
      host.hidden=false;
      host.innerHTML=String(file.type||"").indexOf("video/")===0
        ? '<video src="'+esc(missions.proofPreview)+'" controls playsinline muted></video>'
        : '<img src="'+esc(missions.proofPreview)+'" alt="Mission proof preview">';
    }
    if($("mnMissionProofType"))$("mnMissionProofType").value=String(file.type||"").indexOf("video/")===0?"video":"photo";
    setStatus($("mnMissionDialogStatus"),"Captured. Review it, add any detail you want, then submit.","ok");
  }
  function closeMission(){
    missionOpenVersion++;
    var dlg=$("mnMissionDialog");if(dlg&&dlg.open)dlg.close();
    clearMissionCapture();
    if(missions.returnHref){location.assign(missions.returnHref);return;}
    try{history.replaceState(null,"","/mnet.html"+(missions.campaign?"?view=missions&campaign="+encodeURIComponent(missions.campaign):""));}catch(_){}
  }
  var missionOpenVersion=0;
  var ANTISOCIAL_ID="a17050c1-a551-4c5c-80c1-5a1750c1a001",antisocialLevel=1,antisocialVersion=0;
  var ANTISOCIAL_TITLES=["High Five","Five High Fives","Make Something Together"];
  function antisocialReset(){
    antisocialVersion++;
    if($("mnAntisocialLevels"))$("mnAntisocialLevels").hidden=true;
    if($("mnAntisocialForm"))$("mnAntisocialForm").hidden=true;
  }
  function antisocialConnections(){
    var select=$("mnAntisocialPartner");if(!select)return;
    /* the server lists my accepted connections with names and handles (my_connections) */
    sbRpc("my_connections",{}).then(function(rows){
      rows=rows||[];
      if(!rows.length){select.innerHTML='<option value="">No connections yet. Find a member and tap Connect.</option>';return;}
      select.innerHTML='<option value="">Select a collaborator</option>'+rows.map(function(r){return '<option value="'+esc(r.m_uid)+'">'+esc(r.display_name||"Action Network member")+(r.mccluster_id?" · @"+esc(r.mccluster_id):"")+'</option>';}).join("");
    }).catch(function(){select.innerHTML='<option value="">Connections unavailable</option>';});
  }
  function antisocialPaint(){
    var box=$("mnAntisocialLevels"),a=missions.assignment;
    if(!box||!missions.current||missions.current.id!==ANTISOCIAL_ID)return;
    box.hidden=false;$("mnMissionProof").hidden=true;
    if(!a){
      /* the three levels are the card, before anyone joins: 1 / 3 → 2 / 3 → 3 / 3 */
      $("mnAntisocialProgress").innerHTML=ANTISOCIAL_TITLES.map(function(t,i){return '<li class="mn__record-item is-'+(i?"locked":"ready")+'"><b>'+(i+1)+'/3 · '+esc(t)+'</b><span>'+(i?"Locked":"Ready")+'</span></li>';}).join("");
      $("mnAntisocialForm").hidden=true;setStatus($("mnAntisocialStatus"),"Join to start Level 1.");return;
    }
    var version=++antisocialVersion;
    return sbRest("action_antisocial_levels?assignment_id=eq."+encodeURIComponent(a.id)+"&select=level,status,review_note&order=level.asc")
      .then(function(rows){
        if(version!==antisocialVersion||!missions.assignment||missions.assignment.id!==a.id)return;
        var levels={};(rows||[]).forEach(function(x){levels[x.level]=x;});
        var next=1;while(next<=3&&levels[next]&&levels[next].status==="verified")next++;
        antisocialLevel=next;
        $("mnAntisocialProgress").innerHTML=ANTISOCIAL_TITLES.map(function(t,i){
          var n=i+1,x=levels[n],status=x?x.status:n===next?"ready":"locked";
          return '<li class="mn__record-item is-'+esc(status)+'"><b>'+n+'/3 · '+esc(t)+'</b><span>'+esc(status==="verified"?"Verified":status==="pending"?"Awaiting review":status==="rejected"?"Revise and resubmit":status==="ready"?"Ready":"Locked")+'</span>'+(x&&x.review_note?'<small>'+esc(x.review_note)+'</small>':"")+'</li>';
        }).join("");
        var pending=next<=3&&levels[next]&&levels[next].status==="pending";
        $("mnAntisocialForm").hidden=next>3||!!pending||a.status==="verified";
        if(next<=3){$("mnAntisocialNext").textContent="Level "+next+"/3 · "+ANTISOCIAL_TITLES[next-1];$("mnAntisocialCollab").hidden=next!==3;}
        if($("mnAntisocialGo"))$("mnAntisocialGo").textContent=next===3?"Publish together and submit Level 3":"Submit this level for review";
        if(next===3)antisocialWithMe(a);else if($("mnAntisocialWithMe")){$("mnAntisocialWithMe").hidden=true;$("mnAntisocialWithMe").innerHTML="";}
        setStatus($("mnAntisocialStatus"),next>3?"All three levels verified. Mission complete.":pending?"Awaiting review for Level "+next+".":next===3?"Make something with a connected member and publish it here. One post, credited to both.":"Complete the action. Record yourself, or only film others with permission.");
        if(next===3&&!pending)antisocialConnections();
      }).catch(function(e){if(version===antisocialVersion)setStatus($("mnAntisocialStatus"),e.message||"Could not load levels.","error");});
  }
  /* Owner, 2026-10-14: "Connect → Collaborate → Publish. Both creators are
     credited. The finished project counts toward the same mission." The
     server lists the projects a connection published with me
     (antisocial_collaborations_for_me); confirming one is my level 3,
     with the same post and reciprocal credit, so one desk review settles
     us both. */
  function antisocialWithMe(a){
    var host=$("mnAntisocialWithMe");if(!host)return;
    sbRpc("antisocial_collaborations_for_me",{}).then(function(rows){
      rows=rows||[];
      host.hidden=!rows.length;
      host.innerHTML=rows.length?'<p class="mn__eyebrow">Published with you</p>'+rows.map(function(r){
        var who=esc(r.initiator_name||"A member")+(r.initiator_handle?' · @'+esc(r.initiator_handle):'');
        var state=r.mine_status==="verified"?'<span class="mn__withme-state">Verified</span>':r.mine_status==="pending"?'<span class="mn__withme-state">Confirmed · awaiting review</span>':r.mine_status==="rejected"?'<span class="mn__withme-state">Not verified · confirm again</span>':'';
        return '<div class="mn__withme" data-post="'+esc(r.post_id)+'"><b>'+esc(r.title)+'</b><span>'+esc(r.kind)+' · with '+who+'</span>'+
          (r.link?'<a href="'+esc(r.link)+'" target="_blank" rel="noopener noreferrer">Open the work ↗</a>':'')+
          (r.mine_status&&r.mine_status!=="rejected"?state:'<button class="mn__primary" type="button" data-confirm-collab="'+esc(r.post_id)+'" data-with="'+esc(r.initiator_m_uid)+'" data-link="'+esc(r.link||"")+'">Confirm as my Level 3</button>')+'</div>';
      }).join(""):"";
      host.querySelectorAll("[data-confirm-collab]").forEach(function(b){
        b.addEventListener("click",function(){
          if(!missions.assignment||missions.assignment.id!==a.id)return;
          b.disabled=true;setStatus($("mnAntisocialStatus"),"Confirming…");
          sbRpc("submit_antisocial_level",{p_assignment_id:a.id,p_level:3,p_statement:"Made together.",p_proof_url:b.getAttribute("data-link")||null,p_post_id:b.getAttribute("data-confirm-collab"),p_collaborator_m_uid:b.getAttribute("data-with"),p_media_asset_id:null})
            .then(function(){antisocialPaint();loadActionRecord();})
            .catch(function(e){b.disabled=false;setStatus($("mnAntisocialStatus"),e.message||"That did not go through.","error");});
        });
      });
    }).catch(function(){host.hidden=true;});
  }
  function antisocialSubmit(ev){
    ev.preventDefault();var a=missions.assignment;if(!a||!missions.current||missions.current.id!==ANTISOCIAL_ID||antisocialLevel>3)return;
    var btn=ev.target.querySelector('button[type="submit"]');if(btn.disabled)return;btn.disabled=true;
    var level=antisocialLevel,statement=$("mnAntisocialStatement").value.trim(),url=$("mnAntisocialLink").value.trim()||null;
    var file=$("mnAntisocialVideo").files&&$("mnAntisocialVideo").files[0],partner=level===3?$("mnAntisocialPartner").value:null;
    var title=level===3?$("mnAntisocialTitle").value.trim():"",kind=level===3?$("mnAntisocialKind").value:"";
    if(level===3&&!partner){setStatus($("mnAntisocialStatus"),"Choose the connected member you made this with.","error");btn.disabled=false;return;}
    if(level===3&&!title){setStatus($("mnAntisocialStatus"),"Give the work a title.","error");btn.disabled=false;return;}
    if(level===3&&!url&&!file){setStatus($("mnAntisocialStatus"),"Add the work: upload it or link to where it lives.","error");btn.disabled=false;return;}
    setStatus($("mnAntisocialStatus"),file?"Uploading…":level===3?"Publishing…":"Submitting for review…");
    (file?uploadProofFile(file):Promise.resolve(null)).then(function(out){
      var asset=out&&out.asset?out.asset.id:null;
      /* level 3: the platform publishes one post credited to both and submits it as mine */
      if(level===3)return sbRpc("publish_antisocial_collaboration",{p_assignment_id:a.id,p_partner_m_uid:partner,p_title:title,p_kind:kind,p_link:url,p_media_asset_id:asset,p_statement:statement});
      return sbRpc("submit_antisocial_level",{p_assignment_id:a.id,p_level:level,p_statement:statement,p_proof_url:url,p_post_id:null,p_collaborator_m_uid:null,p_media_asset_id:asset});
    }).then(function(){if(missions.assignment&&missions.assignment.id===a.id){ev.target.reset();antisocialPaint();loadActionRecord();}})
      .catch(function(e){setStatus($("mnAntisocialStatus"),e.message||"Submission failed.","error");})
      .then(function(){btn.disabled=false;});
  }
  /* PUT YOUR BLACK BUSINESS ON THE MAP. A listing is its own review, separate from the
     mission's proof: submit_action_business_listing() only ever files it as 'submitted';
     the desk approves (review_action_business_listing), which makes the business profile
     and, once the desk places it, a coarse pin unless the business chose its exact address. */
  var BUSINESS_CONSENT_VERSION="2026-10-15";
  function businessListingForm(focus){
    var f=document.createElement("form");f.className="mn__business-listing";f.id="mnBusinessListing";
    f.innerHTML='<p class="mn__eyebrow">Put your Black business on the map</p>'+
      '<label class="mn__label" for="mnBizName">Business name</label><input class="mn__input" id="mnBizName" maxlength="120" required>'+
      '<label class="mn__label" for="mnBizArea">Town or city, state</label><input class="mn__input" id="mnBizArea" maxlength="120" placeholder="Hartford, CT" required>'+
      '<label class="mn__label" for="mnBizCountry">Country code</label><input class="mn__input" id="mnBizCountry" maxlength="2" value="US" autocapitalize="characters" required>'+
      '<label class="mn__label" for="mnBizUrl">Public link (site, Google or Yelp page)</label><input class="mn__input" id="mnBizUrl" type="url" maxlength="500" placeholder="https://…" required>'+
      '<label class="mn__check" for="mnBizExact"><input id="mnBizExact" type="checkbox"><span><b>Show the exact address</b>Off: the pin sits about 11 km from it, at town level.</span></label>'+
      '<input class="mn__input" id="mnBizStreet" maxlength="200" placeholder="Street address (only with an exact pin)" hidden>'+
      '<label class="mn__check" for="mnBizOwned"><input id="mnBizOwned" type="checkbox" required><span><b>This business is Black-owned</b>and I own it or may list it.</span></label>'+
      '<label class="mn__check" for="mnBizConsent"><input id="mnBizConsent" type="checkbox" required><span><b>Show it on the World</b>Its name, town and link, after review. You can withdraw it any time.</span></label>'+
      '<button class="mn__primary" type="submit">Send for review</button><p class="mn__status" id="mnBizStatus" role="status"></p>';
    var exact=f.querySelector("#mnBizExact"),street=f.querySelector("#mnBizStreet");
    exact.addEventListener("change",function(){street.hidden=!exact.checked;street.required=exact.checked;});
    f.addEventListener("submit",function(ev){
      ev.preventDefault();var st=f.querySelector("#mnBizStatus");
      if(!sessionToken()){setStatus(st,"Sign in to list your business.","error");return;}
      var btn=f.querySelector("button[type=submit]");btn.disabled=true;
      sbRpc("submit_action_business_listing",{
        p_business_name:f.querySelector("#mnBizName").value,p_area_label:f.querySelector("#mnBizArea").value,
        p_country_code:f.querySelector("#mnBizCountry").value.toUpperCase(),p_public_url:f.querySelector("#mnBizUrl").value,
        p_street_address:exact.checked?street.value:null,p_exact_location_opt_in:exact.checked,
        p_attest_black_owned:f.querySelector("#mnBizOwned").checked,p_attest_authorized:f.querySelector("#mnBizOwned").checked,
        p_consent_public_listing:f.querySelector("#mnBizConsent").checked,p_consent_version:BUSINESS_CONSENT_VERSION
      }).then(function(){f.reset();street.hidden=true;setStatus(st,"Sent. A reviewer checks it before it goes on the map.","ok");track("business_listing_submitted",{});})
        .catch(function(e){setStatus(st,e.message||"Could not send that.","error");})
        .then(function(){btn.disabled=false;});
    });
    if(focus)setTimeout(function(){var n=f.querySelector("#mnBizName");if(n){f.scrollIntoView({block:"start"});n.focus();}},60);
    return f;
  }
  function openMission(id){
    if(MISSIONS_OFF)return;
    var version=++missionOpenVersion;
    return fetchMission(id).then(function(m){
      if(version!==missionOpenVersion)return;
      if(!m){setStatus($("mnMissionStatus"),"That mission is not available any more.","error");return {opened:false,message:"That mission is not available any more."};}
      missions.current=m;missions.assignment=null;clearMissionCapture();antisocialReset();
      if($("mnMissionProofStatement"))$("mnMissionProofStatement").value="";
      if($("mnMissionProofUrl"))$("mnMissionProofUrl").value="";
      if($("mnMissionProofType"))$("mnMissionProofType").value="video";
      $("mnMissionTitle").textContent=m.title;
      $("mnMissionDetail").innerHTML='<p>'+esc(m.description||"")+'</p><p><strong>'+esc(m.base_points)+' base points</strong> · difficulty '+esc(m.difficulty)+'</p><p>'+esc((m.skills||[]).join(" · "))+'</p><p class="mn__fund-line" id="mnMissionFund" role="status">Checking funding\u2026</p>';
      if(m.id==="368fd75a-77d2-4de0-9722-17020674a914"){
        $("mnMissionDetail").innerHTML+='<p><a class="mn__primary" href="/mnet.html?view=missions#mnRecord">Policy team application → Action Record</a></p>';
      }
      if(m.id==="49d654e1-dfc8-42aa-a26e-22912ebf8dc6"||m.id==="ba66d4a3-cb62-4403-9b56-7ee00af059d8"||m.id==="d7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c"){
        var category=m.id==="49d654e1-dfc8-42aa-a26e-22912ebf8dc6"?"recycling":"black_business";
        var sources=document.createElement("section");sources.className="mn__resource-sources";sources.textContent="Loading official directories…";
        $("mnMissionDetail").appendChild(sources);
        sbRest("action_resource_sources?category=eq."+category+"&published=eq.true&select=name,directory_url&order=name.asc")
          .then(function(rows){if(version!==missionOpenVersion)return;
            sources.innerHTML='<p class="mn__eyebrow">Find a real place · official directories</p>'+
              (rows||[]).map(function(r){return '<p><a target="_blank" rel="noopener noreferrer" href="'+esc(r.directory_url)+'">'+esc(r.name)+' ↗</a></p>';}).join("")+
              '<p class="mn__hint">External directories only. In-app directions require licensed, verified individual places.</p>';
          }).catch(function(){sources.textContent="Directories unavailable. Try again later.";});
      }
      var mx=missions.extras&&missions.extras[m.id]||{};
      if(mx.cta_key==="business_listing")$("mnMissionDetail").appendChild(businessListingForm(missions.focus==="business"));
      missions.focus="";
      fundState(m.id,m.campaign_id||"").then(function(st){var line=$("mnMissionFund");if(line&&missions.current&&missions.current.id===m.id)line.innerHTML=fundLineHtml(st);});
      var open=m.status==="open";
      $("mnMissionJoin").hidden=!open;$("mnMissionProof").hidden=true;
      if(m.id===ANTISOCIAL_ID)antisocialPaint();
      if($("mnMissionShare"))$("mnMissionShare").checked=true;
      setStatus($("mnMissionDialogStatus"),open?"":"This mission is not taking new people.");
      if(!$("mnMissionDialog").open)$("mnMissionDialog").showModal();
      try{history.replaceState(null,"",missionHref(m.id));}catch(_){}
      if(!state.user||!state.user.id){setStatus($("mnMissionDialogStatus"),"Sign in to join this mission.");return {opened:true};}
      return sbRest("action_mission_assignments?mission_id=eq."+encodeURIComponent(m.id)+"&user_id=eq."+encodeURIComponent(state.user.id)+"&select=id,status&limit=1").then(function(rows){
        if(version!==missionOpenVersion||!missions.current||missions.current.id!==m.id)return;
        var a=rows&&rows[0];if(!a||a.status==="withdrawn")return {opened:true};
        missions.assignment=a;$("mnMissionJoin").hidden=true;
        if(m.id===ANTISOCIAL_ID){antisocialPaint();return {opened:true};}
        $("mnMissionProof").hidden=!(a.status==="joined"||a.status==="in_progress"||a.status==="submitted"||a.status==="rejected");
        var assignmentMessage=a.status==="submitted"
          ?"Proof submitted for review. You can replace it until it is reviewed."
          :a.status==="verified"
            ?"Verified action."
            :a.status==="rejected"
              ?"Proof was not verified. Fix the proof and submit it again. The reviewer note is in Your Action Record."
              :"Mission in progress.";
        setStatus($("mnMissionDialogStatus"),assignmentMessage,a.status==="rejected"?"error":"ok");
        return {opened:true};
      });
    }).catch(function(e){if(version===missionOpenVersion)setStatus($("mnMissionStatus"),e.message||"Mission could not load.","error");return {opened:false,message:e.message||"Mission could not load."};});
  }
  function joinMission(){
    var m=missions.current;if(!m)return Promise.resolve({accepted:false});var b=$("mnMissionJoin");
    if(b.disabled)return Promise.resolve({accepted:false});
    if(state.guest||!sessionToken()){
      if($("mnMissionDialog").open)$("mnMissionDialog").close();
      askToSignIn("mission");return Promise.resolve({accepted:false,message:"Sign in to continue with this mission."});
    }
    if(needsStep()||state.stall==="retry"){
      if($("mnMissionDialog").open)$("mnMissionDialog").close();
      if(askToFinish("mission"))return Promise.resolve({accepted:false,message:"Finish your profile to continue with this mission."});
    }
    b.disabled=true;
    var joinRequest = missions.liveSession&&missions.liveMission===m.id
      ? sbRpc("join_action_mission_live",{p_mission_id:m.id,p_live_session_id:missions.liveSession})
      : missions.content&&missions.attributedMission===m.id
        ? sbRpc("join_action_mission_attributed",{p_mission_id:m.id,p_content_id:missions.content,p_source:missions.source||"network"})
        : sbRpc("join_action_mission",{p_mission_id:m.id});
    return joinRequest
      .then(function(r){
        if(!r||!/^[0-9a-f-]{36}$/i.test(String(r.assignment_id||""))||["joined","in_progress","submitted","verified","rejected"].indexOf(r.status)<0){
          throw new Error(typeof (r&&r.message)==="string"?r.message:"This mission has not returned an active assignment. Try again or check its requirements.");
        }
        var result={accepted:true,message:"Accepted “"+m.title+"”. Continue in the mission window."};
        if(!missions.current||missions.current.id!==m.id)return result;
        missions.assignment={id:r.assignment_id,status:r.status};b.hidden=true;$("mnMissionProof").hidden=m.id===ANTISOCIAL_ID;
        if(m.id===ANTISOCIAL_ID)antisocialPaint();
        setStatus($("mnMissionDialogStatus"),m.id===ANTISOCIAL_ID?"Mission started. Begin Level 1: High Five. Record only with permission.":"Mission started. Describe what you're about to do, then open the camera.","ok");
        var focusTarget=m.id===ANTISOCIAL_ID?$("mnAntisocialStatement"):$("mnMissionProofStatement");
        if(focusTarget&&!focusTarget.closest("[hidden]"))focusTarget.focus();
        if(window.MCC_TRACK)window.MCC_TRACK("mission_join",{mission:m.id,content:missions.content||null,source:missions.source||null,live_session:missions.liveSession||null});
        loadMissions();
        return result;
      })
      .catch(function(e){if(missions.current&&missions.current.id===m.id)setStatus($("mnMissionDialogStatus"),e.message||"Could not start mission.","error");return {accepted:false,error:true,message:e.message||"Could not start mission."};})
      .then(function(result){b.disabled=false;return result;});
  }
  function uploadProofFile(file){
    return uploadMediaWithPoster(file);
  }
  function submitMissionProof(ev){
    ev.preventDefault();var a=missions.assignment;if(!a)return;var proofMissionId=missions.current&&missions.current.id;var b=ev.target.querySelector('button[type="submit"]');if(!b||b.disabled)return;b.disabled=true;
    var picker=$("mnMissionProofFile"),file=missions.proofFile||(picker&&picker.files&&picker.files[0]);
    var type=$("mnMissionProofType").value,link=($("mnMissionProofUrl").value||"").trim()||null,statement=($("mnMissionProofStatement").value||"").trim();
    setStatus($("mnMissionDialogStatus"),file?"Uploading your proof…":"Submitting…");
    (file?uploadProofFile(file):Promise.resolve(null)).then(function(out){
      var asset=out&&out.asset,poster=out&&out.poster;
      if(asset)type=String(file.type||"").indexOf("video/")===0?"video":"photo";
      var meta=asset?{asset_id:asset.id}:{};
      if(poster)meta.poster_asset_id=poster.id;
      return sbRpc("submit_action_proof",{p_assignment_id:a.id,p_proof_type:type,p_proof_url:link,p_statement:statement,p_metadata:meta});
    }).then(function(){
      var share=$("mnMissionShare"),body={p_assignment_id:a.id,p_share:!!(share&&share.checked)};
      return sbRpc("set_action_share_intent",body).catch(function(){return sbRpc("set_action_share_intent",body);})
        .then(function(){return true;},function(){return false;});
    }).then(function(choiceSaved){
      if(!missions.assignment||missions.assignment.id!==a.id||!missions.current||missions.current.id!==proofMissionId)return;
      missions.assignment.status="submitted";clearMissionCapture();
      if(choiceSaved)setStatus($("mnMissionDialogStatus"),"Proof submitted. Once verified, this action can appear on the feed with your proof.","ok");
      else setStatus($("mnMissionDialogStatus"),"Proof submitted, but your feed choice did not save. You can share it after verification.","error");
      if(window.MCC_TRACK)window.MCC_TRACK("mission_proof",{mission:proofMissionId,upload:!!file});
      loadMissions();
    }).catch(function(e){if(missions.assignment&&missions.assignment.id===a.id&&missions.current&&missions.current.id===proofMissionId)setStatus($("mnMissionDialogStatus"),e.message||"Proof could not be submitted.","error");})
      .then(function(){b.disabled=false;});
  }
  /* A shared mission link opens that mission, not the feed. */
  function openDeepLinkedMission(){
    if(MISSIONS_OFF||missions.deepLinked)return;
    var id=null; try{id=new URLSearchParams(location.search).get("mission");}catch(_){}
    if(!id||!/^[0-9a-f-]{36}$/i.test(id))return;
    missions.deepLinked=true; setView("missions"); openMission(id);
  }
  (function wireMissions(){
    var host=$("mnMissionList");if(!host)return;
    function onOpen(ev){var b=ev.target.closest&&ev.target.closest("[data-open-mission]");if(b){var id=b.getAttribute("data-open-mission");missions.focus=b.getAttribute("data-focus")||"";if(missions.attributedMission&&missions.attributedMission!==id){missions.content="";missions.source="";missions.attributedMission="";}if(missions.liveMission&&missions.liveMission!==id){missions.liveSession="";missions.liveMission="";}openMission(id);}}
    host.addEventListener("click",onOpen);
    if($("mnRecord")){
      $("mnRecord").addEventListener("click",function(ev){
        onOpen(ev);
        var sh=ev.target.closest&&ev.target.closest("[data-share-action]");
        if(sh){shareAction(sh);return;}
        var o=ev.target.closest&&ev.target.closest("[data-fellow-open]");
        if(o){o.hidden=true;$("mnFellowForm").hidden=false;$("mnFellowWhy").focus();}
      });
      $("mnRecord").addEventListener("submit",function(ev){if(ev.target&&ev.target.id==="mnFellowForm")submitFellowship(ev);});
    }
    $("mnRefreshMissions").addEventListener("click",loadMissions);
    $("mnMissionClose").addEventListener("click",closeMission);
    $("mnMissionJoin").addEventListener("click",function(){joinMission();});
    if($("mnAntisocialForm"))$("mnAntisocialForm").addEventListener("submit",antisocialSubmit);
    $("mnMissionProof").addEventListener("submit",submitMissionProof);
    if($("mnMissionCameraGo"))$("mnMissionCameraGo").addEventListener("click",function(){$("mnMissionCameraFile").click();});
    if($("mnMissionCameraFile"))$("mnMissionCameraFile").addEventListener("change",function(){paintMissionCapture(this.files&&this.files[0]);});
    if($("mnMissionProofFile"))$("mnMissionProofFile").addEventListener("change",function(){paintMissionCapture(this.files&&this.files[0]);});
  })();

  /* THE WORLD SCREEN. The globe frame (action-globe.html, network surface)
     and this page talk over same-origin postMessage. The frame sends which
     missions have public pins and which one was tapped; this page asks it
     to fly to a mission or to let go. Nothing private crosses: the frame
     only ever holds public, admin-approved mission pins.

     October 17: the globe stays visible. Mission context and the community
     share one independently scrolling panel, stacked on portrait screens and
     alongside the globe on wide/landscape screens. */
  var WORLD_ID = /^[0-9a-f-]{36}$/i;
  function worldFrame() { var f = $("mnWorldFrame"); return f && f.contentWindow; }
  function tellWorld(msg) { var w = worldFrame(); if (w) try { w.postMessage(msg, location.origin); } catch (_) {} }
  function pathLabel(path) { return String(path || "mission").replace(/_/g, " "); }
  /* THE SCREEN IS THE WHOLE SCREEN (owner, 2026-10-15: "it's blacked out instead of allowing the feed to go all the
     way down to the bottom … the bar should have shit behind it"). Nothing stops at the bar: the World fills the
     viewport and the feed (the onboarding too) runs under the floating bar, with --mn-bar-clear of bottom padding
     so the last thing can still scroll above it. The clearance comes from the bar's layout, not its rect, so an
     entrance animation (a transform) cannot skew it. */
  function barClearance() {
    var bar = document.querySelector(".appbar"), clear = 0;
    if (bar && bar.offsetHeight) {
      var cs = getComputedStyle(bar);
      if (cs.position === "fixed" && cs.display !== "none") clear = Math.ceil((parseFloat(cs.bottom) || 0) + bar.offsetHeight + 10);
    }
    // Music can retain this real World document inside its listening session.
    // Its verified frame bridge measures the parent transport; the local bar
    // is hidden then, so measuring only that bar would erase the safe area.
    var audioClear = parseFloat(document.documentElement.style.getPropertyValue("--mcc-world-audio-clear")) || 0;
    if (audioClear >= 50 && audioClear <= 280) clear = Math.max(clear, audioClear);
    document.documentElement.style.setProperty("--mn-bar-clear", clear + "px");
    return clear;
  }
  function sizeWorld() {
    var view = $("mnFeedView"), root = document.documentElement, app = $("mnApp");
    var clear = barClearance();
    if (!view) return;
    var on = state.currentView === "feed" && !view.hidden && !!app && !app.hidden;
    root.classList.toggle("mn-world-on", on);
    if (!on) { root.classList.remove("mn-world-fit", "mn-world-overlay", "mn-world-side"); view.style.removeProperty("--mn-world-h"); return; }
    // October 17: persistent globe and independently scrolling feed at every size.
    // CSS owns the responsive composition; never resize the page while a person reads.
    root.classList.remove("mn-world-fit", "mn-world-overlay", "mn-world-side");
    view.style.removeProperty("--mn-world-h");
  }
  /* the mission card's art is its kind, as an icon: missions carry no photo
     and the World never invents one */
  var PATH_ART = {
    create: '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/></svg>',
    amplify: '<svg viewBox="0 0 24 24"><path d="M4 10v4h4l6 4V6l-6 4z"/><path d="M17.5 9a4 4 0 0 1 0 6M19.8 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    show_up: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    mission: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>'
  };
  function prepareWorldMission(id){
    if(missions.attributedMission&&missions.attributedMission!==id){missions.content="";missions.source="";missions.attributedMission="";}
    if(missions.liveMission&&missions.liveMission!==id){missions.liveSession="";missions.liveMission="";}
    missions.focus="";
  }
  function openWorldMission(m){
    prepareWorldMission(m.id);focusOnGlobe(m.id);
    return openMission(m.id);
  }
  function acceptWorldMission(m){
    prepareWorldMission(m.id);
    /* Retain the selected mission through auth/onboarding. Returning opens
       its real workflow; it does not silently submit another acceptance. */
    try{history.replaceState(null,"",missionHref(m.id));}catch(_){}
    if(state.guest||!sessionToken()){
      askToSignIn("mission");return Promise.resolve({accepted:false,message:"Sign in to continue with “"+m.title+"”."});
    }
    if(askToFinish("mission"))return Promise.resolve({accepted:false,message:"Finish your profile to continue with “"+m.title+"”."});
    return openWorldMission(m).then(function(result){
      if(!result||!result.opened||!missions.current||missions.current.id!==m.id||!$("mnMissionDialog").open){
        return {accepted:false,error:!!(result&&result.message),message:result&&result.message||"Mission kept. You can accept it again when you’re ready."};
      }
      var a=missions.assignment;
      if(a&&["joined","in_progress","submitted","verified","rejected"].indexOf(a.status)>=0){
        return {accepted:true,message:"Your existing “"+m.title+"” mission is open."};
      }
      return joinMission();
    });
  }
  function ensureWorldMissionDeck(){
    if(worldMissionDeck)return worldMissionDeck;
    if(!window.MCC_MISSION_DECK||!$("huMissionList"))return null;
    worldMissionDeck=window.MCC_MISSION_DECK.mount($("huMissionList"),{
      onAccept:acceptWorldMission,onOpen:openWorldMission,
      onCompleted:function(host) {
        if (!window.DocketCohortShowcase || !window.DocketCohortShowcase.mountSeries) throw Error("Completed mission series is unavailable.");
        return window.DocketCohortShowcase.mountSeries(host);
      },
      onRefresh:function(){worldMissionDeckLoaded=false;return loadWorldMissionDeck();}
    });
    if(worldMissionDeckLoaded)worldMissionDeck.update(missions.all);
    return worldMissionDeck;
  }
  function loadWorldMissionDeck(){
    if(!ensureWorldMissionDeck())return Promise.resolve();
    if(worldMissionDeckRequest)return worldMissionDeckRequest;
    if(worldMissionDeckLoaded)return Promise.resolve();
    /* The mission catalogue works even if WebGL or public pins are unavailable. */
    worldMissionDeckRequest=loadMissions().then(function(){worldMissionDeckRequest=null;});
    return worldMissionDeckRequest;
  }
  window.addEventListener("mcc:world-mode",function(e){
    if(e.detail&&e.detail.mode==="missions"){
      loadWorldMissionDeck();
      /* The confirmed cohort capstone remains mapped independently of whether
         someone has opened the Completed tab yet. */
      if(window.DocketCohortShowcase&&window.DocketCohortShowcase.ensureMap)window.DocketCohortShowcase.ensureMap();
      if(new URLSearchParams(location.search).has("completed")){
        var completedTab=document.querySelector('.mn-swipe__filters [data-status="completed"]');
        if(completedTab&&completedTab.getAttribute("aria-selected")!=="true")completedTab.click();
      }
    }
  });
  function paintMissionPreview() {
    var host = $("huMissionList"); if (!host) return;
    if(ensureWorldMissionDeck()){loadWorldMissionDeck();return;}
    var list = Object.keys(state.world.missions).map(function (id) { return state.world.missions[id]; });
    host.innerHTML = list.length ? list.slice(0, 2).map(function (m) {
      return '<button type="button" class="hu-mission-row" data-hu-mission="' + esc(m.mission_id) + '">' +
        '<span class="hu-mission-symbol" aria-hidden="true">' + (PATH_ART[m.action_path] || PATH_ART.mission) + '</span>' +
        '<span><strong>' + esc(m.title) + '</strong><small>' + esc(m.region_label || 'Worldwide') + '</small><span class="hu-mission-link">View mission ↗</span></span></button>';
    }).join('') : '<p class="hu-muted">No published missions on the map yet.</p>';
    host.querySelectorAll('[data-hu-mission]').forEach(function (button) {
      button.onclick = function () {
        var m = state.world.missions[button.dataset.huMission];
        if (!m) return;
        setWorldFocus(Object.assign({}, m, { filter: false }));
        focusOnGlobe(m.mission_id);
        $("mnWorldFocus").scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
    });
  }
  function paintWorldFocus() {
    var f = state.world.focus, host = $("mnWorldFocus"), idle = $("mnWorldIdle");
    if (!host) return;
    host.hidden = !f;
    if (idle) idle.hidden = false;
    if (!f) return;
    var known = state.world.missions[f.mission_id] || {}, st = state.world.stats[f.mission_id];
    var path = String(f.action_path || known.action_path || "mission");
    $("mnWorldFocusArt").innerHTML = PATH_ART[path] || PATH_ART.mission;
    $("mnWorldFocusFlag").hidden = !f.latest;
    $("mnWorldFocusWhere").textContent = f.region_label || known.region_label || "World";
    $("mnWorldFocusKind").textContent = pathLabel(path);
    $("mnWorldFocusTitle").textContent = f.title || known.title || "Mission";
    $("mnWorldFocusDesc").textContent = f.description || known.description || "";
    var joined = st ? Number(st.joined) || 0 : 0, verified = st ? Number(st.verified) || 0 : 0;
    $("mnWorldFocusStats").innerHTML = st ? esc(joined + " joined") + '<span class="mn__stats-more"> · ' + esc(verified + " verified") + "</span>" : "";
    $("mnWorldFocusStats").hidden = !st;
    var filter = $("mnWorldFocusFilter");
    filter.setAttribute("aria-pressed", f.filter ? "true" : "false");
    $("mnWorldFocusFilterLong").textContent = f.filter ? "Showing posts about this" : "Only posts about this";
  }
  /* public per-mission counts (action_mission_stats is granted to anon):
     how many joined and how many were verified, never who */
  function loadMissionStats() {
    if (state.world.statsLoaded) return;
    state.world.statsLoaded = true;
    sbRpc("action_mission_stats", { p_campaign: null }).then(function (rows) {
      (rows || []).forEach(function (r) { if (r && r.mission_id) state.world.stats[r.mission_id] = r; });
      paintWorldFocus();
      if (!state.loadingFeed) renderFeed(false);
    }).catch(function () {});
  }
  function setWorldFocus(mission) {
    var stale = $("mnWorldFocus") && $("mnWorldFocus").querySelector(".mn__fund-line");
    if (stale && !(mission && state.world.focus && mission.mission_id === state.world.focus.mission_id)) stale.remove();
    state.world.focus = mission;
    paintWorldFocus();
    if (!state.loadingFeed) renderFeed(false);
    var feed = $("mnWorldFeed");
    if (mission && mission.filter && feed) feed.scrollTop = 0;
    track("world_focus", { mission: mission ? mission.mission_id : null, filter: !!(mission && mission.filter) });
  }
  /* from a post: show its mission on the Earth, but leave the feed alone,
     because the member is reading it */
  function focusOnGlobe(missionId) {
    if (!WORLD_ID.test(String(missionId || "")) || !state.world.pins[missionId]) return;
    state.world.fromFeed = missionId;
    tellWorld({ type: "hu:focus-mission", missionId: missionId });
  }
  /* SEARCH SUGGESTIONS. The World search is where people, groups and
     missions are found (owner, 2026-10-14), so typing offers: pinned
     missions and places (fly there), open missions without a pin, people
     and groups that match (members; a guest is asked to sign in), and the
     three full lists. Nothing is fetched until the field is used. */
  var suggest = { seq: 0, people: { q: "", rows: [] }, groupsAsked: false, missions: null, timer: 0 };
  function suggestRows() { return Array.prototype.slice.call($("mnSuggest").querySelectorAll("button")); }
  function hideSuggest() {
    var panel = $("mnSuggest");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    $("mnSearchInput").setAttribute("aria-expanded", "false");
    $("mnSearchInput").removeAttribute("aria-activedescendant");
  }
  function suggestRow(kind, id, label, sub) {
    return '<button type="button" role="option" id="mnSug' + (suggest.n++) + '" data-suggest="' + kind + '" data-id="' + esc(id) + '"><span>' + esc(label) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
  }
  function suggestHead(label) { return '<p class="mn__suggest-k">' + esc(label) + '</p>'; }
  /* an answer that arrives after the field was left never reopens the panel */
  function refreshSuggest() { var panel = $("mnSuggest"); if (panel && !panel.hidden) paintSuggest(); }
  function paintSuggest() {
    var panel = $("mnSuggest"), host = $("mnSuggestRows"), input = $("mnSearchInput");
    if (!panel || !host || state.currentView !== "feed") return;
    var raw = input.value.trim().slice(0, 80), q = raw.toLocaleLowerCase(), html = "";
    suggest.n = 0;
    if (q) {
      var hits = function (fields) { return fields.join(" ").toLocaleLowerCase().indexOf(q) !== -1; };
      var pinned = MISSIONS_OFF ? [] : Object.keys(state.world.missions).map(function (k) { return state.world.missions[k]; })
        .filter(function (m) { return hits([m.title, m.description, m.region_label, m.action_path]); }).slice(0, 4);
      if (pinned.length) html += suggestHead("On the globe") + pinned.map(function (m) { return suggestRow("globe", m.mission_id, m.title, m.region_label); }).join("");
      if (!state.guest) {
        if (!suggest.missions && MISSIONS_OFF) suggest.missions = [];
        if (!suggest.missions) {
          suggest.missions = [];
          sbRest("action_missions?status=eq.open&select=id,title,description,domain,kind&order=created_at.desc&limit=200").then(function (rows) {
            suggest.missions = (rows || []).filter(function (m) { return m && m.kind !== "clip"; });
            refreshSuggest();
          }).catch(function () {});
        }
        var open = suggest.missions.filter(function (m) { return !state.world.pins[m.id] && hits([m.title, m.description, m.domain]); }).slice(0, 3);
        if (open.length) html += suggestHead("Missions") + open.map(function (m) { return suggestRow("mission", m.id, m.title, m.domain || "Mission"); }).join("");
        var who = q.replace(/^@+/, "");
        if (who && suggest.people.q !== who) {
          var seq = ++suggest.seq;
          clearTimeout(suggest.timer);
          suggest.timer = setTimeout(function () {
            api("/v1/mnet/discover?q=" + encodeURIComponent(who) + "&limit=3").then(function (out) {
              if (seq !== suggest.seq) return;
              suggest.people = { q: who, rows: (out && out.people) || [] };
              refreshSuggest();
            }).catch(function () {});
          }, 300);
        }
        var people = suggest.people.q === who ? suggest.people.rows : [];
        html += suggestHead("People") + people.map(function (p) {
          return suggestRow("person", p.mccluster_id || "", p.display_name || p.mccluster_id || "Member", p.mccluster_id ? "@" + p.mccluster_id : "");
        }).join("") + suggestRow("people", raw, "Search people for \u201c" + raw + "\u201d", "");
        if (!suggest.groupsAsked && !groups.all.length) {
          suggest.groupsAsked = true;
          api("/v1/mnet/groups").then(function (out) {
            if (!groups.all.length) { groups.all = (out && out.groups) || []; assignSkins(groups.all); }
            refreshSuggest();
          }).catch(function () {});
        }
        var rooms = groups.all.filter(function (g) { return hits([g.name, g.purpose, g.slug]); }).slice(0, 3);
        html += suggestHead("Groups") + rooms.map(function (g) {
          return suggestRow("group", g.slug, g.name, (Number(g.member_count) || 0) + (Number(g.member_count) === 1 ? " member" : " members"));
        }).join("") + suggestRow("groups", raw, "Groups about \u201c" + raw + "\u201d", "");
      } else {
        html += suggestHead("People and groups") + suggestRow("people", raw, "People named \u201c" + raw + "\u201d", "Sign in to search") +
          suggestRow("groups", raw, "Groups about \u201c" + raw + "\u201d", "Sign in to search");
      }
    }
    host.innerHTML = html;
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-activedescendant");
  }
  function pickSuggest(row) {
    var kind = row.getAttribute("data-suggest"), id = row.getAttribute("data-id") || "";
    if (kind === "globe") { focusOnGlobe(id); return; }
    if (kind === "mission") { missions.content = ""; missions.source = ""; missions.attributedMission = ""; setView("missions"); openMission(id); return; }
    if (state.guest) { askToSignIn(kind === "groups" || kind === "group" ? "groups" : "people"); return; }
    if (kind === "person") { if (id) openPerson(id); return; }
    if (kind === "people") { $("mnDiscoverQuery").value = id.replace(/^@+/, ""); setView("discover"); return; }
    if (kind === "group") { setView("groups"); openGroup(id); return; }
    if (kind === "groups") exploreGroups(id);
  }
  /* THE CREATOR AUDIENCE LAYER (owner, 2026-10-14: "for creators, analytics
     becomes an optional layer on that same globe"). Only for a member with a
     music creator profile; the numbers are the Worker's own measurement of
     views of their creator page in the last 30 days, by country only, with
     countries under its threshold folded away. Placed by Natural Earth's
     public-domain label points. Nothing is drawn that was not measured. */
  var audience = { places: null, seq: 0 };
  function showAudience(on) {
    var caption = $("mnWorldCaption"), seq = ++audience.seq;
    if (!state.creator) return;
    if (!on) {
      tellWorld({ type: "hu:audience-points", points: [] });
      if (caption && state.world.caption) caption.textContent = state.world.caption;
      return;
    }
    if (state.world.focus && state.world.focus.latest) setWorldFocus(null);
    if (caption) caption.textContent = "Loading your audience\u2026";
    var places = audience.places ? Promise.resolve(audience.places) : fetch("data/geo/country-label-points.json").then(function (r) { return r.json(); }).then(function (j) { return (audience.places = j.points || {}); });
    Promise.all([api("/v1/analytics/my-creator"), places]).then(function (out) {
      /* switched off (or on again) while this was loading: drop it */
      if (seq !== audience.seq) return;
      var data = out[0] || {}, at = out[1] || {}, a = data.audience || { countries: [] }, total = 0;
      var points = (a.countries || []).map(function (c) {
        var p = at[String(c.country || "").toUpperCase()];
        if (!p) return null;
        total += Number(c.views) || 0;
        return { lon: p[0], lat: p[1], name: p[2], views: Number(c.views) || 0 };
      }).filter(Boolean);
      tellWorld({ type: "hu:audience-points", points: points });
      if (!caption) return;
      var more = (Number(a.elsewhere_views) || 0) + (Number(a.unknown_views) || 0);
      caption.textContent = points.length
        ? "Your audience, last 30 days: " + total.toLocaleString("en-US") + " views of your creator page from " + points.length + (points.length === 1 ? " country" : " countries") +
          (more ? ", and " + more.toLocaleString("en-US") + " from places with under " + (a.min_views || 5) + " views or unknown." : ".")
        : more ? "Your creator page has " + more.toLocaleString("en-US") + " recorded views in the last 30 days, none yet from a country with " + (a.min_views || 5) + " or more."
        : "No recorded views of your creator page in the last 30 days.";
    }).catch(function () { if (seq === audience.seq && caption) caption.textContent = "Your audience could not load right now."; });
  }
  /* the Clips door at the top of the feed: asked for once, and only real
     terms from the campaigns are shown; hidden while none are open */
  function paintClipDoor() {
    var door = $("mnClipDoor");
    /* no campaigns are promoted on the feed while the World is the social feed (owner, 2026-10-20) */
    if (!door || MISSIONS_OFF) return;
    if (!state.clipOpen) {
      state.clipOpen = [];
      sbRpc("clip_campaigns_open", { p_song: null }).then(function (rows) {
        state.clipOpen = Array.isArray(rows) ? rows : [];
        paintClipDoor();
      }).catch(function () {});
      return;
    }
    var list = state.clipOpen, cpm = list.map(function (c) { return Number(c.base_cpm_cents) || 0; }).filter(Boolean);
    door.hidden = !list.length;
    if (!list.length) return;
    var low = cpm.length ? Math.min.apply(Math, cpm) : 0;
    $("mnClipDoorLine").textContent = list.length + (list.length === 1 ? " campaign open" : " campaigns open") +
      (low ? " \u00b7 from $" + (low / 100).toFixed(2) + " per 1,000 views" : "") + ".";
  }
  (function wireWorld() {
    var frame = $("mnWorldFrame");
    if (!frame) return;
    /* the music player's "See this song's impact" lands here with ?song= */
    try {
      var song = new URLSearchParams(location.search).get("song");
      if (song && song.length <= 160) frame.src += "&song=" + encodeURIComponent(song);
    } catch (_) {}
    var searchToggle = $("huSearchToggle");
    function closeSearch() { document.documentElement.classList.remove('hu-search-open'); searchToggle.setAttribute('aria-expanded', 'false'); }
    if (searchToggle) searchToggle.onclick = function () {
      var on = document.documentElement.classList.toggle('hu-search-open');
      searchToggle.setAttribute('aria-expanded', String(on));
      if (on) $("mnSearchInput").focus();
    };
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (document.documentElement.classList.contains('hu-search-open')) { closeSearch(); searchToggle.focus(); }
      if ($("huWorldFilters").open) { $("huWorldFilters").open = false; $("huWorldFilters").querySelector('summary').focus(); }
    });
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#huWorldFilters')) $("huWorldFilters").open = false;
    });
    frame.addEventListener("load", function () { tellWorld({ type: "hu:hello" }); });
    window.addEventListener("message", function (ev) {
      if (ev.origin !== location.origin || ev.source !== frame.contentWindow) return;
      var d = ev.data || {}, caption = $("mnWorldCaption");
      if (d.type === "hu:globe-ready") {
        if (state.placeScope.livePlaces) tellWorld({ type: "hu:live-places", source: "video", places: state.placeScope.livePlaces });
        state.world.pins = {}; state.world.missions = {}; state.world.latest = null;
        (Array.isArray(d.missionIds) ? d.missionIds : []).forEach(function (id) { if (WORLD_ID.test(String(id))) state.world.pins[id] = true; });
        (Array.isArray(d.missions) ? d.missions : []).forEach(function (m) {
          if (!m || !WORLD_ID.test(String(m.mission_id || ""))) return;
          var clean = { mission_id: String(m.mission_id), title: String(m.title || ""), description: String(m.description || ""), region_label: String(m.region_label || ""), action_path: String(m.action_path || "") };
          state.world.missions[clean.mission_id] = clean;
          if (!state.world.latest) state.world.latest = clean;
        });
        /* Published missions lead the feed; selection stays with the visitor. */
        paintMissionPreview();
        if (d.dataUnavailable && !worldMissionDeck) $("huMissionList").innerHTML = '<p class="hu-muted">Mission pins could not load. Use the all-missions button to browse available work.</p>';
        /* a guest starts at Explore the world (owner's signed-out reference) */
        if ($("mnWorldChipCount")) $("mnWorldChipCount").textContent = Object.keys(state.world.missions).length || "";
        if ($("mnWorldTagCount")) $("mnWorldTagCount").textContent = String(Object.keys(state.world.pins).length);
        if (state.world.latest) loadMissionStats();
        if (state.creator) tellWorld({ type: "hu:creator-mode", on: true });
        var n = Object.keys(state.world.pins).length;
        state.world.caption = d.dataUnavailable ? "The map is up, but mission pins could not load. The feed below is live."
          : n ? n + (n === 1 ? " mission is" : " missions are") + " pinned on the Earth. Tap a marker or search to discover action around the world."
          : "No missions are pinned on the Earth yet. The feed below is live.";
        if (caption) caption.textContent = state.world.caption;
        /* repaint so posts can grow their "Locate on globe" door, unless
           the first page of the feed is still on its way */
        if (!state.loadingFeed) renderFeed(false);
      } else if (d.type === "hu:globe-unavailable") {
        if(ensureWorldMissionDeck())loadWorldMissionDeck();
        else $("huMissionList").innerHTML = '<p class="hu-muted">The map is unavailable. Use the all-missions button to browse available work.</p>';
        if (caption) caption.textContent = "The globe can\u2019t run on this device. Everything else works: the feed is below.";
      } else if (d.type === "hu:mission-selected" && d.mission && WORLD_ID.test(String(d.mission.mission_id || ""))) {
        var m = d.mission, id = String(m.mission_id), fromFeed = state.world.fromFeed === id;
        state.world.fromFeed = "";
        setWorldFocus({ mission_id: id, title: String(m.title || ""), description: String(m.description || ""), region_label: String(m.region_label || ""), action_path: String(m.action_path || ""), filter: !fromFeed });
      } else if (d.type === "hu:selection-cleared") {
        state.world.fromFeed = "";
        if (state.world.focus) setWorldFocus(null);
      } else if (d.type === "hu:country") {
        /* A SIGNED-OUT VISITOR STAYS IN THEIR REGION (owner, 2026-10-20: "if they're logged out and their IP address
           says somewhere, that's where they're gonna go … they can't region hop unless they're logged in"). Outside
           Travel, another country asks them to sign in and the globe goes back home; letting go also goes home. */
        var home = state.guest && state.placeScope.enabled ? state.placeScope.home : null,
            tapped = d.country && typeof d.country.code === "string" ? d.country.code.toUpperCase() : null;
        if (home && tapped !== home && !(window.MCC_WORLD_MODE && window.MCC_WORLD_MODE.get && window.MCC_WORLD_MODE.get() === "travel")) {
          if (tapped) askToSignIn("regions");
          tellWorld({ type: "hu:select-country", code: home });
          return;
        }
        /* A STATE (owner, 2026-10-21): a double tap inside the selected country picks a state; its name leads the label and
           Local keeps the stories placed inside its shape */
        var prevCountry = state.world.country, tappedState = worldState(d.country && d.country.state);
        $("huRegionLabel").textContent = d.country && typeof d.country.name === "string" ? (tappedState ? tappedState.name + ", " : "") + d.country.name.slice(0, 80) : "All regions";
        /* the country's identity rides with its name, so Local can match a story's country rather than a substring */
        state.world.country = d.country && typeof d.country.name === "string" ? { code: String(d.country.code || "").toUpperCase().slice(0, 2), name: d.country.name.slice(0, 80), state: tappedState } : null;
        var sameCountry = !!(prevCountry && state.world.country && prevCountry.code === state.world.country.code);
        if (state.world.country) state.world.country.stats = placeStats(d.country.stats);
        paintPlaceCard(state.world.country);
        if ($("mnPostPlaceOptIn")) $("mnPostPlaceOptIn").checked = false;
        paintFeedScope();
        /* CLICK THE PLANET, FILTER THE FEED (owner, 2026-10-19). A country tapped outside Travel narrows the one feed to
           that country with no extra press; letting the country go returns the feed to Global, unless the member chose
           Local themselves. In Travel a tap picks a destination and leaves the feed alone. */
        var travelTap = !!(window.MCC_WORLD_MODE && window.MCC_WORLD_MODE.get && window.MCC_WORLD_MODE.get() === "travel");
        if (state.world.country && !travelTap && state.feedScope !== "local") { state.world.scopeFromTap = true; setFeedScope("local"); }
        else if (!state.world.country && state.world.scopeFromTap) { state.world.scopeFromTap = false; setFeedScope("global"); }
        /* a state of the country already read narrows what is loaded; only another country reads again */
        else if (state.feedScope === "local" && state.placeScope.enabled && !(sameCountry && state.placeScope.country === state.world.country.code)) loadPlaceFeed(true);
        else if (state.feedScope === "local") renderFeed(false);
      } else if (d.type === "hu:place-stats") {
        /* the counts arrive after the tap: the card follows, for the place still picked */
        var pl = d.place, cur = state.world.country;
        if (pl && cur && pl.code === cur.code && (pl.state || null) === ((cur.state && cur.state.key) || null)) { cur.stats = placeStats(pl.stats); paintPlaceCard(cur); }
      } else if (d.type === "hu:audience") {
        showAudience(!!d.on);
      } else if (d.type === "hu:ask-sign-in") {
        /* a guest tapped a members-only layer: the reason, and the way back */
        askToSignIn(d.reason === "layers" ? "layers" : "act");
      } else if (d.type === "hu:layer" && typeof d.layer === "string") {
        paintLayerLine(d);
      } else if (d.type === "hu:status" && typeof d.text === "string") {
        if (caption) caption.textContent = d.text.slice(0, 200);
        if (state.world.focus && state.world.focus.latest) setWorldFocus(null);
      }
    });
    /* THE DATA LAYERS' LINE (owner, 2026-10-15). What the Earth shows besides
       missions, written over it from the globe's hu:layer messages, and the
       one lead that rides with Flights: "Fly Vaunt" (owner, 2026-10-15:
       "make it simple and shorter"), the owner's own referral link, as on
       the front page's VR wall. Counts come from the Worker's snapshot; nothing here
       is invented, and a layer that could not load says so. */
    var VAUNT_LEAD = "https://vauntapi.flyvaunt.com/referral/nuao1K";
    state.world.layers = {};
    function fmtCount(n) { n = Number(n) || 0; try { return n.toLocaleString("en-US"); } catch (e) { return String(n); } }
    function paintLayerLine(d) {
      var box = $("mnWorldLayers");
      if (!box) return;
      if (d.on) state.world.layers[d.layer] = d; else delete state.world.layers[d.layer];
      var rows = [], f = state.world.layers.flights, s = state.world.layers.satellites, l = state.world.layers.launches;
      if (f) rows.push(f.unavailable ? "<span>Flights are unavailable right now.</span>"
        : "<span>" + esc(fmtCount(f.count)) + " aircraft in the air right now" + (f.stale ? " (last snapshot)" : "") + ".</span> " +
          '<a class="mn__world-lead" href="' + VAUNT_LEAD + '" target="_blank" rel="noopener sponsored">Fly Vaunt \u2192</a>');
      if (s) rows.push("<span>" + (s.unavailable ? "Satellites are unavailable right now." : esc(fmtCount(s.count)) + " satellites · calculated positions.") + "</span>");
      if (l) {
        var nx = l.next && l.next[0];
        rows.push("<span>" + (l.unavailable ? "Launches are unavailable right now." : esc(fmtCount(l.count)) + " launches coming up" +
          (nx ? " \u00b7 next: " + esc(String(nx.name || "").split("|")[0].trim()) + (nx.net && !isNaN(new Date(nx.net)) ? " \u00b7 " + esc(new Date(nx.net).toLocaleDateString("en-US", { month: "short", day: "numeric" })) : "") + (nx.where ? " \u00b7 " + esc(nx.where) : "") : "") + ".") + "</span>");
      }
      /* CCTV: the frame already checked eligibility with the Worker; this only words the count */
      var ii = state.world.layers.intel;
      if (ii) rows.push("<span>Intel events: " + esc(fmtCount(ii.count)) + " located, " + esc(fmtCount(ii.unknown)) + " without a place, " + esc(fmtCount(ii.suppressed)) + " in cells under five." + (ii.attribution ? " Sources: " + esc(ii.attribution) + "." : "") + "</span>");
      if (state.world.layers.cctv) rows.push("<span>" + esc(fmtCount(state.world.layers.cctv.count)) + " public cameras. Tap one for its live snapshot.</span>");
      if (d.failed && !d.on) rows.push("<span>" + esc(d.layer.charAt(0).toUpperCase() + d.layer.slice(1)) + " could not load right now.</span>");
      box.innerHTML = rows.join("<br>");
      box.hidden = !rows.length;
      /* above the frame's toggles, which sit above its credit line */
      var credit = Number(d.creditHeight) || 26;
      box.style.bottom = (credit + 8 + 36 + 10) + "px";
      track("world_layer", { layer: String(d.layer).slice(0, 16), on: !!d.on, count: Number(d.count) || 0 });
    }
    /* the Explore chips: Missions steps through the pins, Regional impact
       shows or hides the counted regions, Near me asks the globe to locate */
    var chipAt = -1;
    Array.prototype.forEach.call(document.querySelectorAll("[data-world-chip]"), function (b) {
      b.addEventListener("click", function () {
        var kind = b.getAttribute("data-world-chip");
        if (kind === "missions") {
          var ids = Object.keys(state.world.missions);
          if (!ids.length) { var c = $("mnWorldCaption"); if (c) c.textContent = "No missions are pinned on the Earth yet."; return; }
          chipAt = (chipAt + 1) % ids.length;
          focusOnGlobe(ids[chipAt]);
        } else if (kind === "regional") {
          var on = b.getAttribute("aria-pressed") !== "true";
          b.setAttribute("aria-pressed", on ? "true" : "false");
          tellWorld({ type: "hu:regional", on: on });
        } else if (kind === "near") tellWorld({ type: "hu:near-me" });
      });
    });
    $("mnWorldFocusClear").addEventListener("click", function () {
      setWorldFocus(null);
      tellWorld({ type: "hu:clear-selection" });
    });
    $("mnWorldFocusFilter").addEventListener("click", function () {
      var f = state.world.focus;
      if (!f) return;
      setWorldFocus(Object.assign({}, f, { filter: !f.filter }));
    });
    $("mnWorldFocusLocate").addEventListener("click", function () {
      var f = state.world.focus;
      if (f) focusOnGlobe(f.mission_id);
    });
    $("mnWorldFocusFund").addEventListener("click", function () {
      var f = state.world.focus;
      if (f) toggleFundLine($("mnWorldFocus"), f.mission_id, "");
    });
    /* the Clips door at the top of the feed, painted once the open campaigns are known (no tab to find it under any more) */
    paintClipDoor();
    /* SEARCH: as you type, the feed narrows to posts that say it and the
       Earth to pins that match; Enter flies to the first matching mission,
       or, for a member, looks the words up among people. */
    var form = $("mnSearch"), input = $("mnSearchInput"), searchTimer = 0;
    if (form && input) {
      /* a phone's bar is short: one word there, the whole invitation from 600px */
      var wide = window.matchMedia ? window.matchMedia("(min-width: 600px)") : null;
      var placeholder = function () { input.placeholder = "Search the world"; };
      placeholder();
      if (wide && wide.addEventListener) wide.addEventListener("change", placeholder);
      input.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          state.world.query = input.value.trim().slice(0, 80);
          if (!state.loadingFeed) renderFeed(false);
          tellWorld({ type: "hu:search", q: state.world.query });
          if (document.activeElement === input) paintSuggest();
        }, 180);
      });
      input.addEventListener("focus", function () { paintSuggest(); });
      /* the panel keeps the field's focus, so a tap on a row never closes it
         first; leaving the field (or the frame taking the tap) closes it */
      $("mnSuggest").addEventListener("mousedown", function (e) { e.preventDefault(); });
      $("mnSuggest").addEventListener("click", function (e) {
        var row = e.target.closest && e.target.closest("button");
        if (!row) return;
        if (row.hasAttribute("data-suggest")) pickSuggest(row);
        hideSuggest();
      });
      form.addEventListener("focusout", function () {
        setTimeout(function () { if (!form.contains(document.activeElement)) hideSuggest(); }, 120);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        var rows = suggestRows();
        if (!rows.length || $("mnSuggest").hidden) return;
        e.preventDefault();
        var at = rows.indexOf($("mnSuggest").querySelector(".is-hl"));
        at = e.key === "ArrowDown" ? (at + 1) % rows.length : (at <= 0 ? rows.length - 1 : at - 1);
        rows.forEach(function (r, n) { r.classList.toggle("is-hl", n === at); });
        input.setAttribute("aria-activedescendant", rows[at].id);
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var hl = $("mnSuggest").hidden ? null : $("mnSuggest").querySelector(".is-hl");
        if (hl) { hl.click(); return; }
        hideSuggest();
        var q = input.value.trim().toLocaleLowerCase();
        if (!q) return;
        var hit = Object.keys(state.world.missions).map(function (k) { return state.world.missions[k]; }).find(function (m) {
          return [m.title, m.description, m.region_label, m.action_path].join(" ").toLocaleLowerCase().indexOf(q) !== -1;
        });
        if (hit) { focusOnGlobe(hit.mission_id); return; }
        if (state.guest) { askToSignIn("people"); return; }
        if ($("mnDiscoverQuery")) $("mnDiscoverQuery").value = input.value.trim();
        setView("discover");
      });
      input.addEventListener("keydown", function (e) { if (e.key === "Escape") { hideSuggest(); input.value = ""; input.dispatchEvent(new Event("input")); input.blur(); } });
    }
    $("mnWorldFocusJoin").addEventListener("click", function () {
      var f = state.world.focus;
      if (!f) return;
      /* the emblem as a guest: the reason is this mission, not the whole list */
      if (state.guest) { askToSignIn("mission"); return; }
      if (askToFinish("mission")) return;
      missions.content = ""; missions.source = ""; missions.attributedMission = "";
      setView("missions");
      openMission(f.mission_id);
    });
    var pending = 0;
    function resize() { if (pending) return; pending = requestAnimationFrame(function () { pending = 0; sizeWorld(); }); }
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    window.addEventListener("load", resize);
    window.addEventListener("mcc:auth-state", resize);
    /* the header animates its padding and the bar arrives on its own time, so the World is measured again whenever
       either changes size; a measurement taken mid-transition left the feed a few pixels short of the bottom */
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(resize), top = document.querySelector(".mn__top");
      if (top) ro.observe(top);
      var seen = document.querySelector(".appbar"); if (seen) ro.observe(seen);
      new MutationObserver(function () { var bar = document.querySelector(".appbar"); if (bar && bar !== seen) { seen = bar; ro.observe(bar); resize(); } }).observe(document.body, { childList: true });
    }
    if (top) top.addEventListener("transitionend", resize);
  })();

})();
