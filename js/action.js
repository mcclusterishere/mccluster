/* ============================================================
   UPRISE ACTION NETWORK — the campaign page (/action/?c=<slug>).

   Attention in, organized people out. Someone taps the link under a
   Reel (/action/?c=cobalt&src=ig&reel=0047), reads what is true and
   where it comes from, says what they can bring, and becomes a
   numbered participant with a link of their own to recruit with.

   A campaign is a row, not a page: this file renders whichever row
   public.action_campaign_public(slug) returns, so the owner launches
   the next campaign from McCluster Control without a deploy.

   Nothing here is invented. Every number is a live count from the
   database; the page never seeds, rounds up or estimates. Money is not
   on the page at all unless the owner has switched it on for the
   campaign (the RPC then returns a `money` block), because no page may
   ask for money while the house cannot lawfully solicit.

   Attribution: src/med/reel/cmp (or utm_source/utm_medium/
   utm_content/utm_campaign) from the link, remembered per campaign so
   a sign-up round trip does not lose it; ?ref=CODE is the recruiter.
   Publisher-generated Action links also carry content=<UUID> plus the
   exact mission=<UUID>. That pair is preserved through auth and passed
   to join_action_mission_attributed so verified work can be traced back
   to the content item that caused it. Every visit also fires
   MCC_TRACK('action_view'), which is what Control's funnel counts per Reel.
   ============================================================ */
(function (root, doc) {
  "use strict";

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var PENDING = "mcc_action_pending";
  var PENDING_DAYS = 7;
  var q = new URLSearchParams(root.location.search);
  var SLUG = (q.get("c") || q.get("campaign") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 41);
  var UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  var ATTRIBUTION_CONTENT_ID = UUID_RE.test(String(q.get("content") || "")) ? String(q.get("content")).toLowerCase() : "";
  var ATTRIBUTION_MISSION_ID = UUID_RE.test(String(q.get("mission") || "")) ? String(q.get("mission")).toLowerCase() : "";

  var HAVE = [
    ["give", "I have $5"],
    ["time", "I have time"],
    ["skills", "I have skills"],
    ["reach", "I have reach"],
    ["resources", "I have resources"],
    ["learn", "I want to learn"]
  ];
  var SKILLS = [
    ["research", "Research"],
    ["engineering", "Engineering / Technology"],
    ["media", "Media"],
    ["organizing", "Organizing"],
    ["education", "Education"],
    ["design", "Design"],
    ["legal_policy", "Legal / Policy"],
    ["fundraising", "Fundraising"],
    ["field", "Field work"],
    ["unsure", "I don’t know yet"]
  ];
  var LANES = [
    ["research", "Research with us", "Supply chains, sources, partners", "Counted. You’re on this campaign’s research roster."],
    ["organize", "Organize locally", "Your campus, church, block or city", "Counted. You’re on this campaign’s local organizers list."],
    ["volunteer", "Volunteer a skill", "Put what you do to work", "Counted. Your skills are on file with this campaign."],
    ["resources", "Offer resources", "Space, equipment, introductions", "Counted. You’re listed as offering resources."],
    ["learn", "Learn the issue", "Start with the sources", "Counted. Start with the sources below."],
    ["give_intent", "Give $5", "Every dollar is published", ""]
  ];
  var PLACES = { ig: "Instagram", instagram: "Instagram", tt: "TikTok", tiktok: "TikTok", yt: "YouTube",
    youtube: "YouTube", fb: "Facebook", facebook: "Facebook", x: "X", twitter: "X", threads: "Threads",
    sms: "a text", email: "email", qr: "a QR code", direct: "Direct" };

  var C = null;        /* the campaign, as action_campaign_public returns it */
  var ME = null;       /* this person's participant row, or null */
  var BOUNTIES = null; /* public bounty board; never contains recipient or claimant identity */
  var MISSIONS = [];   /* real public missions for this campaign */
  var SELECTED_ACTION = null;
  var missionBusy = false;
  var picked = { have: {}, skills: {} };
  /* ?have=time,reach arrives from the Heal the 3rd World gateway, where
     the visitor already said what they have */
  String(q.get("have") || "").toLowerCase().split(",").forEach(function (k) {
    if (HAVE.some(function (h) { return h[0] === k; })) picked.have[k] = true;
  });
  var mode = "new";
  var busy = false;

  function $(id) { return doc.getElementById(id); }
  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
  function money(cents, exact) {
    var v = Number(cents || 0) / 100;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: exact && v % 1 ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 });
  }
  function read(k) { try { return JSON.parse(root.localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function write(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function drop(k) { try { root.localStorage.removeItem(k); } catch (e) {} }
  function track(name, props) { try { if (root.MCC_TRACK) root.MCC_TRACK(name, props || {}); } catch (e) {} }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : null; }

  /* ---------- attribution ---------- */
  function plain(v) {
    v = String(v || "").toLowerCase().slice(0, 40);
    return /^[a-z0-9][a-z0-9._-]*$/.test(v) ? v : "";
  }
  var URL_ORIGIN = (function () {
    var o = {};
    var pairs = [["src", "utm_source"], ["med", "utm_medium"], ["reel", "utm_content"], ["cmp", "utm_campaign"]];
    pairs.forEach(function (p) {
      var v = plain(q.get(p[0]) || q.get(p[1]));
      if (v) o[p[0]] = v;
    });
    return o;
  })();
  function originKey() { return "mcc_action_origin:" + SLUG; }
  function refKey() { return "mcc_action_ref:" + SLUG; }
  if (SLUG) {
    /* the link that brought them this time wins: that is the Reel that
       converted them, even if an older one brought them first */
    if (Object.keys(URL_ORIGIN).length) write(originKey(), URL_ORIGIN);
    var urlRef = String(q.get("ref") || "").toUpperCase();
    if (/^[A-Z0-9]{4,12}$/.test(urlRef)) write(refKey(), urlRef);
  }
  function origin() {
    var saved = read(originKey());
    if (saved && typeof saved === "object" && Object.keys(saved).length) return saved;
    var acq = read("mcc_acq") || {};
    var o = {};
    if (plain(acq.src)) o.src = plain(acq.src);
    if (plain(acq.med)) o.med = plain(acq.med);
    if (plain(acq.cmp)) o.cmp = plain(acq.cmp);
    return o;
  }
  function referral() { var r = read(refKey()); return typeof r === "string" ? r : null; }
  function place(src) { return PLACES[src] || src; }
  function fromLabel(o) {
    o = o || {};
    var parts = [];
    if (o.reel) parts.push("Reel " + o.reel);
    if (o.src && o.src !== "direct") parts.push(place(o.src));
    return parts.join(" · ") || "Direct";
  }

  /* ---------- the database ---------- */
  function signedIn() {
    try { var s = root.MCC && root.MCC.session(); return !!(s && s.access_token); } catch (e) { return false; }
  }
  function rpc(fn, args, asUser) {
    var who = asUser && root.MCC ? root.MCC.refreshIfNeeded() : Promise.resolve(null);
    return who.then(function (s) {
      if (asUser && !(s && s.access_token)) throw Object.assign(new Error("Sign in first."), { status: 401 });
      var headers = { apikey: KEY, "content-type": "application/json" };
      if (s && s.access_token) headers.authorization = "Bearer " + s.access_token;
      return fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST", headers: headers, body: JSON.stringify(args || {}) });
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) { d = null; }
        if (!r.ok) throw Object.assign(new Error((d && d.message) || "The network did not answer."), { status: r.status });
        return d;
      });
    });
  }

  function rest(path) {
    return fetch(SB + "/rest/v1/" + path, { headers: { apikey: KEY } }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) { d = null; }
        if (!r.ok) throw Object.assign(new Error((d && d.message) || "The network did not answer."), { status: r.status });
        return d;
      });
    });
  }

  /* ---------- messages ---------- */
  function say(id, text, bad) {
    var n = $(id);
    if (!n) return;
    n.textContent = text || "";
    n.classList.toggle("is-bad", !!bad);
  }

  /* ---------- chips ---------- */
  function chips(box, list, bag) {
    box.textContent = "";
    list.forEach(function (c) {
      var b = el("button", "an-chip", c[1]);
      b.type = "button";
      b.setAttribute("data-key", c[0]);
      b.setAttribute("aria-pressed", bag[c[0]] ? "true" : "false");
      b.addEventListener("click", function () {
        bag[c[0]] = !bag[c[0]];
        if (!bag[c[0]]) delete bag[c[0]];
        b.setAttribute("aria-pressed", bag[c[0]] ? "true" : "false");
      });
      box.appendChild(b);
    });
  }
  function haveList() {
    return HAVE.filter(function (h) { return h[0] !== "give" || (C && C.money); });
  }

  /* ---------- the campaign ---------- */
  function phaseTitle(key) {
    var p = (C && C.phases || []).filter(function (x) { return x && x.key === key; })[0];
    return p ? p.title : (key || "");
  }

  function paintHeadline(text) {
    var h = $("anHeadline");
    h.textContent = "";
    String(text || "").split(". ").forEach(function (part, i, all) {
      if (i) h.appendChild(doc.createElement("br"));
      h.appendChild(doc.createTextNode(part + (i < all.length - 1 ? "." : "")));
    });
  }

  function paintCampaign() {
    doc.title = (C.headline || C.title) + " · " + C.title;
    $("anKicker").textContent = C.kicker || "Uprise Action Network";
    paintHeadline(C.headline || "You saw it. Now do something.");
    $("anTitle").textContent = C.title || "";
    $("anBody").textContent = C.body || "";
    $("anCrumb").textContent = C.title || "Campaign";
    doc.body.classList.add("an-action-first");
    if ($("anActionCampaign")) $("anActionCampaign").textContent = C.title || "Uprise Action Network";
    if ($("anActionHead")) $("anActionHead").textContent = "Pick an action.";
    if ($("anActionSub")) $("anActionSub").textContent = "Tap one. The system takes you straight to the mission.";
    if (URL_ORIGIN.reel || URL_ORIGIN.src) {
      $("anFrom").textContent = "You came from " + fromLabel(URL_ORIGIN);
      $("anFrom").hidden = false;
    }

    var people = Number(C.people || 0), goal = Number(C.people_goal || 0);
    $("anPeople").textContent = fmt(people);
    $("anPeopleLabel").textContent = people === 1 ? "person in the network" : "people in the network";
    var bar = $("anPeopleBar");
    if (goal) {
      bar.hidden = false;
      bar.setAttribute("aria-valuemax", String(goal));
      bar.setAttribute("aria-valuenow", String(people));
      bar.firstElementChild.style.width = Math.min(100, people / goal * 100) + "%";
      $("anPeopleGoal").textContent = (people ? "Goal: " + fmt(goal) + " people · " + fmt(Math.max(0, goal - people)) + " to go"
        : "Goal: " + fmt(goal) + " people. Be the first.") +
        (C.actions ? " · " + fmt(C.actions) + (C.actions === 1 ? " action" : " actions") + " taken" : "");
    } else {
      bar.hidden = true;
      $("anPeopleGoal").textContent = C.actions ? fmt(C.actions) + " actions taken" : "";
    }

    var m = C.money;
    $("anMoney").hidden = !m;
    if (m) {
      var raised = Number(m.raised_cents || 0), mgoal = Number(m.goal_cents || 0);
      $("anRaised").textContent = money(raised);
      var mbar = $("anMoneyBar");
      mbar.hidden = !mgoal;
      if (mgoal) {
        mbar.setAttribute("aria-valuemax", String(mgoal));
        mbar.setAttribute("aria-valuenow", String(raised));
        mbar.firstElementChild.style.width = Math.min(100, raised / mgoal * 100) + "%";
        $("anMoneyGoal").textContent = "of " + money(mgoal) + ". Counted from published receipts only.";
      }
    }

    var ol = $("anPhases");
    ol.textContent = "";
    var phases = Array.isArray(C.phases) ? C.phases : [];
    var nowAt = -1;
    phases.forEach(function (p, i) { if (p && p.key === C.current_phase) nowAt = i; });
    phases.forEach(function (p, i) {
      var li = el("li");
      if (i === nowAt) li.className = "is-now";
      else if (nowAt > -1 && i < nowAt) li.className = "is-done";
      li.appendChild(el("span", "n", String(i + 1).padStart(2, "0")));
      var txt = el("div");
      txt.appendChild(el("b", null, (p && p.title) || ""));
      if (p && p.detail) txt.appendChild(el("small", null, p.detail));
      li.appendChild(txt);
      ol.appendChild(li);
    });

    var facts = $("anFacts");
    facts.textContent = "";
    (Array.isArray(C.facts) ? C.facts : []).forEach(function (f) {
      if (!f || !f.text) return;
      var li = el("li");
      li.appendChild(el("p", null, f.text));
      var u = safeUrl(f.url);
      if (u) {
        var a = el("a", null, f.source || "Source");
        a.href = u; a.target = "_blank"; a.rel = "noopener";
        li.appendChild(a);
      } else if (f.source) {
        li.appendChild(el("span", "an-src", f.source));
      }
      facts.appendChild(li);
    });

    var src = $("anSources");
    src.textContent = "";
    (Array.isArray(C.sources) ? C.sources : []).forEach(function (s) {
      var u = s && safeUrl(s.url);
      if (!u) return;
      var li = el("li");
      if (s.publisher) li.appendChild(el("small", null, s.publisher));
      var a = el("a", null, s.label || u);
      a.href = u; a.target = "_blank"; a.rel = "noopener";
      li.appendChild(a);
      src.appendChild(li);
    });

    $("anAllocation").textContent = C.allocation_note || "";
    var led = $("anLedger");
    led.textContent = "";
    var rows = Array.isArray(C.ledger) ? C.ledger : [];
    if (!rows.length) {
      var none = el("li");
      none.appendChild(el("span", "empty", "Nothing received or spent yet. The first entry will appear here the day it happens."));
      led.appendChild(none);
    }
    var KIND = { received: "Received", committed: "Committed", disbursed: "Disbursed", expense: "Expense" };
    rows.forEach(function (r) {
      var li = el("li");
      li.appendChild(el("b", null, (KIND[r.kind] || r.kind) + (r.counterparty ? " · " + r.counterparty : "")));
      li.appendChild(el("span", "amt", money(r.amount_cents, true)));
      var meta = el("small", null, (r.occurred_on || "") + (r.purpose ? " · " + r.purpose : ""));
      var u = safeUrl(r.evidence_url);
      if (u) {
        meta.appendChild(doc.createTextNode(" · "));
        var a = el("a", null, "evidence");
        a.href = u; a.target = "_blank"; a.rel = "noopener";
        meta.appendChild(a);
      }
      li.appendChild(meta);
      led.appendChild(li);
    });

    chips($("anHave"), haveList(), picked.have);
    chips($("anSkills"), SKILLS, picked.skills);
    $("anIntake").hidden = true;
    $("anCampaign").hidden = false;
    paintJoin();
  }

  function missionHubHref(){
    if(!C)return "/mnet.html?view=missions";
    var ret=root.location.pathname+root.location.search+root.location.hash;
    return "/mnet.html?view=missions&campaign="+encodeURIComponent(C.id)+"&return="+encodeURIComponent(ret);
  }

  function missionHref(id) {
    if (!id) return missionHubHref();
    var ret = root.location.pathname + root.location.search + root.location.hash;
    return "/mnet.html?view=missions&mission=" + encodeURIComponent(id) +
      "&campaign=" + encodeURIComponent(C && C.id || "") +
      "&return=" + encodeURIComponent(ret);
  }

  function jump(id) {
    var n = $(id);
    if (n) n.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function missionRow(id) {
    return MISSIONS.filter(function (m) { return m && m.id === id; })[0] || null;
  }

  function loadMissions() {
    if (!C) return Promise.resolve([]);
    var path = "action_missions?campaign_id=eq." + encodeURIComponent(C.id) +
      "&status=in.(open,paused)&select=id,campaign_id,title,description,domain,difficulty,base_points,proof_required,status,skills&order=created_at.asc&limit=50";
    return rest(path).then(function (rows) {
      MISSIONS = Array.isArray(rows) ? rows : [];
      var requested = String(q.get("mission") || "");
      if (!SELECTED_ACTION && /^[0-9a-f-]{36}$/i.test(requested)) {
        var m = missionRow(requested);
        if (m) SELECTED_ACTION = {
          key: "mission-" + m.id, kind: "mission", mission_id: m.id,
          label: m.title, note: m.description, status: m.status
        };
      }
      paintIntake();
      paintJoin();
      return MISSIONS;
    }).catch(function () {
      MISSIONS = [];
      paintIntake();
      paintJoin();
      return [];
    });
  }

  function intakeChoices() {
    if (!C) return [];
    var chapter = C.chapter && typeof C.chapter === "object" ? C.chapter : {};
    var custom = Array.isArray(chapter.intake_choices) ? chapter.intake_choices.filter(function (x) { return x && x.label; }) : [];
    if (custom.length) {
      return custom.map(function (x, i) {
        var out = Object.assign({}, x);
        out.key = out.key || (out.kind || "action") + "-" + i;
        if (out.mission_id) {
          var m = missionRow(out.mission_id);
          if (m) {
            out.status = m.status;
            if (!out.note) out.note = m.description;
          }
        }
        return out;
      });
    }
    return MISSIONS.map(function (m) {
      return {
        key: "mission-" + m.id,
        kind: "mission",
        mission_id: m.id,
        label: m.title,
        note: m.description,
        status: m.status,
        domain: m.domain
      };
    });
  }

  function attributedContentForMission(id) {
    id = String(id || "").toLowerCase();
    return ATTRIBUTION_CONTENT_ID && ATTRIBUTION_MISSION_ID === id ? ATTRIBUTION_CONTENT_ID : "";
  }

  function joinSelectedMission(id) {
    var o = origin();
    var contentId = attributedContentForMission(id);
    var actionable = SELECTED_ACTION && (SELECTED_ACTION.key || SELECTED_ACTION.kind) || "";
    return rpc("join_action_mission_origin", {
      p_mission_id: id,
      p_content_id: contentId || null,
      p_source: o.src || null,
      p_reel: o.reel || null,
      p_actionable: actionable || null
    }, true);
  }

  function rememberSelection(x) {
    SELECTED_ACTION = x || null;
    if (!x) return;
    var u = new URL(root.location.href);
    u.searchParams.set("action", x.key || x.kind || "action");
    if (x.mission_id) u.searchParams.set("mission", x.mission_id);
    try { root.history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {}
    track("actionable_selected", {
      campaign: SLUG,
      actionable: x.key || "",
      kind: x.kind || "",
      mission: x.mission_id || "",
      src: (origin().src || ""),
      reel: (origin().reel || "")
    });
  }

  function takeSelectedMission() {
    if (!SELECTED_ACTION || SELECTED_ACTION.kind !== "mission" || !SELECTED_ACTION.mission_id || missionBusy) return Promise.resolve();
    var m = missionRow(SELECTED_ACTION.mission_id);
    if (m && m.status !== "open") {
      say("anActionStatus", "That mission is not open right now.", true);
      return Promise.resolve();
    }
    missionBusy = true;
    say("anActionStatus", "Opening mission…");
    var o = origin();
    var contentId = attributedContentForMission(SELECTED_ACTION.mission_id);
    return joinSelectedMission(SELECTED_ACTION.mission_id).then(function (r) {
      track("actionable_started", {
        campaign: SLUG,
        actionable: SELECTED_ACTION.key || "",
        mission: SELECTED_ACTION.mission_id,
        assignment: r && r.assignment_id || "",
        content: contentId || "",
        src: o.src || "",
        reel: o.reel || ""
      });
      root.location.assign(missionHref(SELECTED_ACTION.mission_id));
    }).catch(function (e) {
      missionBusy = false;
      say("anActionStatus", e.message || "Could not open that mission. Try again.", true);
      paintJoin();
    });
  }

  function selectAction(x) {
    if (!x) return;
    say("anActionStatus", "");
    rememberSelection(x);
    paintIntake();

    if (x.kind === "live") {
      var liveCategory = String(x.category || (SLUG === "homelessness" ? "field" : "")).replace(/[^a-z0-9_-]/g, "");
      root.location.assign("/mnet.html?view=live" + (liveCategory ? "&category=" + encodeURIComponent(liveCategory) : ""));
      return;
    }
    if (x.kind === "fund" || x.kind === "bounty") {
      jump("anBounties");
      return;
    }
    if (x.kind !== "mission" || !x.mission_id) return;

    var m = missionRow(x.mission_id);
    if (m && m.status !== "open") {
      paintJoin();
      say("anActionStatus", "That action is not open right now.", true);
      return;
    }

    if (!signedIn()) {
      paintJoin();
      jump("join");
      root.setTimeout(function () {
        var email = $("anEmail");
        if (email) email.focus({ preventScroll: true });
      }, 350);
      return;
    }

    if (ME) {
      takeSelectedMission();
      return;
    }

    rpc("action_me", { p_campaign: C.id }, true).then(function (me) {
      ME = me || null;
      if (ME) return takeSelectedMission();
      return doJoin({ contributions: [], skills: [] });
    }).catch(function () {
      return doJoin({ contributions: [], skills: [] });
    });
  }

  function paintIntake() {
    var sec = $("anIntake"), box = $("anIntakeChoices");
    if (!sec || !box || !C) return;
    var chapter = C.chapter && typeof C.chapter === "object" ? C.chapter : {};
    var choices = intakeChoices();
    sec.hidden = false;
    if ($("anIntakeLaw")) $("anIntakeLaw").textContent = chapter.proof_law || "";
    box.textContent = "";
    if (!choices.length) {
      var empty = el("button", "an-intake-choice");
      empty.type = "button";
      empty.disabled = true;
      var emptyCopy = el("span");
      emptyCopy.appendChild(el("b", null, "No action is open right now."));
      emptyCopy.appendChild(el("small", null, "This campaign stays visible, but joining waits until there is something concrete to do."));
      empty.appendChild(emptyCopy);
      empty.appendChild(el("i", null, "Closed"));
      box.appendChild(empty);
      return;
    }

    choices.forEach(function (x) {
      var b = el("button", "an-intake-choice");
      b.type = "button";
      var selected = SELECTED_ACTION && (SELECTED_ACTION.key === x.key || (x.mission_id && SELECTED_ACTION.mission_id === x.mission_id));
      if (selected) b.classList.add("is-selected");

      var disabled = x.kind === "mission" && x.status && x.status !== "open";
      b.disabled = !!disabled;
      var copy = el("span");
      copy.appendChild(el("b", null, x.label));
      if (x.note) copy.appendChild(el("small", null, x.note));
      b.appendChild(copy);
      b.appendChild(el("i", null, disabled ? "Not open" : selected ? "✓" : "→"));
      b.addEventListener("click", function () { selectAction(x); });
      box.appendChild(b);
    });
  }

  function paintBounties(data) {
    BOUNTIES = data || { bounties: [] };
    var sec = $("anBounties"), box = $("anBountyList");
    if (!sec || !box) return;
    var rows = Array.isArray(BOUNTIES.bounties) ? BOUNTIES.bounties : [];
    sec.hidden = !rows.length;
    if (!rows.length) return;
    box.textContent = "";
    rows.forEach(function (b) {
      var card = el("article", "an-bounty");
      var top = el("div", "an-bounty__top");
      var copy = el("div");
      copy.appendChild(el("small", "an-bounty__cat", (b.category || "action").replace(/_/g, " ") + " · risk " + (b.risk_tier || 1)));
      copy.appendChild(el("b", null, b.title || b.mission_title || "Action bounty"));
      if (b.description) copy.appendChild(el("p", null, b.description));
      top.appendChild(copy);
      top.appendChild(el("strong", "an-bounty__reward", money(b.reward_cents)));
      card.appendChild(top);

      var stats = el("div", "an-bounty__stats");
      stats.appendChild(el("span", null, fmt(b.funded_slots) + " funded"));
      stats.appendChild(el("span", null, fmt(b.committed_awards) + " claimed"));
      stats.appendChild(el("span", null, fmt(b.available_slots) + " available"));
      card.appendChild(stats);

      if (b.public_proof_guidance) {
        var proof = el("p", "an-bounty__proof", b.public_proof_guidance);
        card.appendChild(proof);
      }

      var actions = el("div", "an-bounty__actions");
      var mission = el("a", "an-btn");
      mission.href = missionHref(b.mission_id);
      mission.textContent = "See mission";
      actions.appendChild(mission);

      var take = el("button", "an-btn an-btn--hot");
      take.type = "button";
      take.textContent = Number(b.available_slots) > 0 ? "Take " + money(b.reward_cents) + " bounty" : "Waiting for funding";
      take.disabled = Number(b.available_slots) < 1 || b.status !== "open";
      take.addEventListener("click", function () { claimBounty(b, take); });
      actions.appendChild(take);

      var fund = el("button", "an-btn an-btn--gold");
      fund.type = "button";
      fund.textContent = "Fund " + money(b.reward_cents);
      fund.disabled = !BOUNTIES.support_open;
      fund.addEventListener("click", function () {
        if (!BOUNTIES.support_open) return;
        /* The support rail remains campaign-controlled. Never turn a bounty
           button into an ungoverned payment endpoint. */
        root.location.assign("/give.html");
      });
      actions.appendChild(fund);
      card.appendChild(actions);
      box.appendChild(card);
    });
    $("anBountyFunding").textContent = BOUNTIES.support_open
      ? "Funding is open only through the campaign’s governed support rail. The bounty board counts verified allocations, not clicks."
      : (BOUNTIES.support_note || "Funding is not open right now. You can still join and do an unfunded mission.");
  }

  function loadBounties() {
    if (!C) return Promise.resolve(null);
    return rpc("action_bounty_public", { p_campaign: C.id }, false)
      .then(function (data) { paintBounties(data); return data; })
      .catch(function () {
        var sec = $("anBounties");
        if (sec) sec.hidden = true;
        return null;
      });
  }

  function claimBounty(bounty, btn) {
    say("anBountyStatus", "");
    if (!signedIn()) {
      say("anBountyStatus", "Join or sign in first. Paid field work is attached to your Action identity.", true);
      jump("join");
      return;
    }
    if (btn) btn.disabled = true;
    rpc("claim_action_bounty", { p_bounty_id: bounty.id }, true).then(function (r) {
      track("action_bounty_claim", { campaign: SLUG, bounty: bounty.id, mission: bounty.mission_id, reward_cents: bounty.reward_cents });
      say("anBountyStatus", "Bounty reserved. Finish the mission and submit proof before the reservation expires.");
      root.setTimeout(function () { root.location.assign(missionHref(r && r.mission_id || bounty.mission_id)); }, 450);
    }).catch(function (e) {
      var msg = e && e.message || "Could not reserve that bounty.";
      if (/approved program participants/i.test(msg)) {
        msg = "Paid bounties are for the approved field team. Join this campaign first; the desk assigns the field-team cohort seat before paid work.";
      }
      say("anBountyStatus", msg, true);
      if (btn) btn.disabled = false;
      loadBounties();
    });
  }

  function paintJoin() {
    $("anAcct").textContent = signedIn() ? "Account" : "Sign in";
    if (!C) return;

    var open = C.status === "live";
    var inNet = !!ME;
    var choices = intakeChoices();
    var quick = !!(SELECTED_ACTION && SELECTED_ACTION.kind === "mission" && SELECTED_ACTION.mission_id);
    var join = $("join");

    join.classList.toggle("is-quick", quick);
    join.hidden = inNet || !quick;

    var selected = $("anSelectedAction");
    if (selected) {
      selected.hidden = !quick;
      if (quick) {
        $("anSelectedTitle").textContent = SELECTED_ACTION.label || "Selected mission";
        $("anSelectedNote").textContent = SELECTED_ACTION.note || "";
      }
    }

    $("anCta").hidden = true;
    if ($("anMnet")) {
      $("anMnet").textContent = signedIn() ? "Choose another mission →" : "Enter the Action Network →";
      $("anMnet").setAttribute("href", signedIn() ? missionHubHref() : "/mnet.html");
    }

    if (!open && !inNet) {
      $("anJoin").disabled = true;
      $("anAuth").hidden = true;
      say("anMsg", C.status === "paused" ? "This campaign is paused." : "This campaign is closed.");
      return;
    }

    $("anJoin").disabled = busy || missionBusy;
    $("anAuth").hidden = signedIn();
    if (quick) {
      $("anJoinH").textContent = "Take this action.";
      $("anJoinSub").textContent = signedIn() ? "Opening your mission." : "Sign in once. Then go straight to the mission.";
      $("anJoin").textContent = signedIn()
        ? "Take action"
        : (mode === "new" ? "Create account & take action" : "Sign in & take action");
    } else {
      $("anJoinH").textContent = "Join the Action Network.";
      $("anJoinSub").textContent = "Choose an action above first.";
      $("anJoin").textContent = signedIn() ? "Join campaign" : (mode === "new" ? "Create account & join" : "Sign in & join");
    }
  }

  function setMode(m) {
    mode = m;
    $("anModeNew").setAttribute("aria-selected", m === "new" ? "true" : "false");
    $("anModeIn").setAttribute("aria-selected", m === "in" ? "true" : "false");
    $("anNewFields").hidden = m !== "new";
    $("anPrivacyRow").hidden = m !== "new";
    $("anForgot").hidden = m !== "in";
    $("anPass").setAttribute("autocomplete", m === "new" ? "new-password" : "current-password");
    say("anMsg", "");
    paintJoin();
  }

  /* ---------- you ---------- */
  function doneKey() { return "mcc_action_done:" + SLUG; }
  function shareUrl() {
    return root.location.origin + "/action/?c=" + encodeURIComponent(SLUG) +
      (ME && ME.referral_code ? "&ref=" + encodeURIComponent(ME.referral_code) : "");
  }
  function labelOf(list, key) {
    var hit = list.filter(function (x) { return x[0] === key; })[0];
    return hit ? hit[1] : key;
  }

  function paintMe() {
    $("anCard").hidden = !ME;
    paintJoin();
    if (!ME) return;
    $("anCardNo").textContent = "#" + fmt(ME.participant_no);
    $("anCardFrom").textContent = fromLabel(ME.origin);
    $("anCardActions").textContent = fmt(ME.actions);
    $("anCardRecruited").textContent = fmt(ME.recruited);
    $("anCardPhase").textContent = phaseTitle(ME.phase) || "Mobilize";
    var brings = (ME.contributions || []).map(function (k) { return labelOf(HAVE, k).replace(/^I (have|want to) /, ""); });
    var skills = (ME.skills || []).map(function (k) { return labelOf(SKILLS, k); });
    $("anCardSkills").textContent = [brings.length ? "Brings " + brings.join(", ") : "", skills.length ? "Skills: " + skills.join(", ") : ""]
      .filter(Boolean).join(" · ");
    $("anShareUrl").value = shareUrl();
    paintLanes();
  }

  function paintLanes() {
    var box = $("anLanes");
    var done = read(doneKey()) || {};
    box.textContent = "";
    LANES.forEach(function (l) {
      if (l[0] === "give_intent" && !(C && C.money)) return;
      var b = el("button", "an-lane" + (done[l[0]] ? " is-done" : ""));
      b.type = "button";
      var t = el("span", null, l[1]);
      t.appendChild(el("small", null, l[2]));
      b.appendChild(t);
      b.appendChild(el("i", null, done[l[0]] ? "✓" : "→"));
      b.addEventListener("click", function () { act(l, b); });
      box.appendChild(b);
    });
  }

  function remember(kind) {
    var done = read(doneKey()) || {};
    done[kind] = Date.now();
    write(doneKey(), done);
  }

  function act(lane, btn) {
    var kind = lane[0];
    if (btn) btn.disabled = true;
    var detail = kind === "volunteer" ? { skills: (ME && ME.skills) || [] } : {};
    return rpc("action_act", { p_campaign: C.id, p_kind: kind, p_detail: detail }, true).then(function (me) {
      if (me) ME = me;
      remember(kind);
      track("action_act", { campaign: SLUG, kind: kind });
      paintMe();
      if (kind === "give_intent") { root.location.assign("/give.html"); return; }
      if (lane[3]) say("anLaneMsg", lane[3]);
      if (kind === "learn") { var ev = $("evidence"); if (ev) ev.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }).catch(function (e) {
      say("anLaneMsg", e.message || "That did not go through. Try again.", true);
    }).then(function () { if (btn) btn.disabled = false; });
  }

  /* ---------- joining ---------- */
  function wanted() {
    var shown = haveList().map(function (h) { return h[0]; });
    return {
      contributions: Object.keys(picked.have).filter(function (k) { return shown.indexOf(k) > -1; }),
      skills: Object.keys(picked.skills)
    };
  }
  function savePending(want) {
    write(PENDING, {
      slug: SLUG,
      want: want,
      action: SELECTED_ACTION ? {
        key: SELECTED_ACTION.key || "",
        kind: SELECTED_ACTION.kind || "",
        mission_id: SELECTED_ACTION.mission_id || "",
        label: SELECTED_ACTION.label || "",
        note: SELECTED_ACTION.note || ""
      } : null,
      content_id: SELECTED_ACTION && SELECTED_ACTION.mission_id ? attributedContentForMission(SELECTED_ACTION.mission_id) : "",
      attribution_mission_id: ATTRIBUTION_MISSION_ID,
      at: Date.now()
    });
  }

  function doJoin(want) {
    if (busy) return Promise.resolve();
    busy = true;
    paintJoin();
    say("anMsg", "Joining…");
    var fresh = !ME;
    var o = origin();
    return rpc("action_join", {
      p_campaign: C.id, p_origin: o,
      p_contributions: want.contributions || [], p_skills: want.skills || [],
      p_ref: referral()
    }, true).then(function (me) {
      drop(PENDING);
      ME = me;
      busy = false;
      say("anMsg", "");
      if (fresh && me) {
        track("action_joined", { campaign: SLUG, reel: o.reel || "", src: o.src || "", no: me.participant_no });
      }
      paintMe();
      if (signedIn() && me && SELECTED_ACTION && SELECTED_ACTION.kind === "mission") {
        track("action_mission_handoff", { campaign: SLUG, mission: SELECTED_ACTION.mission_id });
        return takeSelectedMission();
      }
      if (signedIn() && me) {
        root.location.assign(missionHubHref());
        return;
      }
    }).catch(function (e) {
      busy = false;
      paintJoin();
      say("anMsg", e.status === 401 ? "Sign in to continue." : (e.message || "Could not join. Try again."), true);
    });
  }

  function joinClick() {
    if (!C || busy) return;
    var want = wanted();
    if (signedIn()) { doJoin(want); return; }
    if (!root.MCC) { say("anMsg", "Sign-in is unavailable right now. Refresh and try again.", true); return; }
    var email = $("anEmail").value.trim(), pass = $("anPass").value;
    if (!email || !pass) { say("anMsg", "Email and password, please.", true); return; }

    if (mode === "in") {
      busy = true; paintJoin(); say("anMsg", "Signing in…");
      root.MCC.signInWithPassword(email, pass).then(function () {
        busy = false;
        return doJoin(want);
      }).catch(function (e) {
        busy = false; paintJoin();
        say("anMsg", e.message || "That email and password did not match.", true);
      });
      return;
    }

    var check = root.MCC_NAME_INTEGRITY && root.MCC_NAME_INTEGRITY.validate($("anFirst").value, $("anLast").value);
    if (!check || !check.ok) { say("anMsg", (check && check.reason) || "Enter your first and last name.", true); return; }
    if (pass.length < 8) { say("anMsg", "Use at least 8 characters for your password.", true); return; }
    if (!$("anPrivacy").checked) { say("anMsg", "Read and agree to the Privacy Policy first.", true); return; }

    busy = true; paintJoin(); say("anMsg", "Creating your account…");
    savePending(want);
    root.MCC.signUpWithPassword(email, pass, {
      name: check.legal_name, full_name: check.legal_name,
      first_name: check.first_name, last_name: check.last_name,
      privacy_policy_version: "2026-09-26",
      privacy_acknowledged_at: new Date().toISOString(),
      joined_via: "action:" + SLUG
    }).then(function (res) {
      busy = false;
      if (res && res.session) return doJoin(want);
      paintJoin();
      if (res && res.existing) {
        setMode("in");
        $("anEmail").value = email;
        say("anMsg", "An account already exists for that email. Sign in to join.");
        return;
      }
      say("anMsg", "Check your email to confirm your address, then open this link again to finish joining. What you picked is saved on this device.");
    }).catch(function (e) {
      busy = false; paintJoin();
      say("anMsg", e.message || "Could not create that account.", true);
    });
  }

  function googleClick() {
    if (!root.MCC) return;
    savePending(wanted());
    var next = root.location.pathname + root.location.search;
    root.MCC.signInWithProvider("google", root.location.origin + "/auth/?next=" + encodeURIComponent(next))
      .catch(function (e) { say("anMsg", e.message || "Could not start Google sign-in.", true); });
  }

  /* A sign-up that needed an emailed confirmation, or a Google round
     trip, comes back here signed in: finish the join they started. */
  function pending() {
    var p = read(PENDING);
    if (!p || p.slug !== SLUG) return null;
    if (!p.at || Date.now() - p.at > PENDING_DAYS * 864e5) { drop(PENDING); return null; }
    return p;
  }
  function restorePicks(p) {
    (p.want && p.want.contributions || []).forEach(function (k) { picked.have[k] = true; });
    (p.want && p.want.skills || []).forEach(function (k) { picked.skills[k] = true; });
    if (p.action && p.action.mission_id) {
      var hit = intakeChoices().filter(function (x) { return x.mission_id === p.action.mission_id; })[0];
      SELECTED_ACTION = hit || p.action;
      if (!ATTRIBUTION_CONTENT_ID && UUID_RE.test(String(p.content_id || "")) &&
          String(p.attribution_mission_id || "").toLowerCase() === String(p.action.mission_id).toLowerCase()) {
        ATTRIBUTION_CONTENT_ID = String(p.content_id).toLowerCase();
        ATTRIBUTION_MISSION_ID = String(p.attribution_mission_id).toLowerCase();
      }
    }
    chips($("anHave"), haveList(), picked.have);
    chips($("anSkills"), SKILLS, picked.skills);
    paintIntake();
    paintJoin();
  }
  function resumePending() {
    var p = pending();
    if (!p || C.status !== "live") return;
    restorePicks(p);
    if (signedIn()) { doJoin(wanted()); return; }
    /* back from the confirmation email, not signed in yet */
    setMode("in");
    say("anMsg", "Confirmed your email? Sign in to finish joining. What you picked is still here.");
  }

  /* ---------- share ---------- */
  function copyLink(url) {
    var done = function () {
      say("anLaneMsg", "Link copied. Everyone who joins through it counts as yours.");
      return shared("copy");
    };
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(url).then(done, function () {
        $("anShareUrl").select();
        say("anLaneMsg", "Copy the link above to share it.");
      });
    }
    $("anShareUrl").select();
    say("anLaneMsg", "Copy the link above to share it.");
    return Promise.resolve();
  }
  function shared(via) {
    track("action_share", { campaign: SLUG, via: via });
    return act(["share", "", "", ""], null).then(function () {
      if (via !== "copy") say("anLaneMsg", "Shared. Everyone who joins through your link counts as yours.");
    });
  }
  function shareClick() {
    if (!ME) return;
    var url = shareUrl();
    var data = { title: C.title, text: "I’m participant #" + ME.participant_no + " in " + C.title + ". You saw it. Now do something.", url: url };
    if (root.navigator.share) {
      root.navigator.share(data).then(function () { return shared("webshare"); }, function (e) {
        if (!e || e.name !== "AbortError") copyLink(url);
      });
    } else {
      copyLink(url);
    }
  }

  /* The participant card as an image: plain type on the house ground,
     sized for a Story. Text only — no marks are drawn here. */
  function cardClick() {
    if (!ME) return;
    var W = 1080, H = 1920;
    var cv = doc.createElement("canvas");
    cv.width = W; cv.height = H;
    var g = cv.getContext("2d");
    var fonts = doc.fonts && doc.fonts.load
      ? Promise.all([doc.fonts.load("400 200px Anton"), doc.fonts.load("800 40px Manrope")]).catch(function () {})
      : Promise.resolve();
    fonts.then(function () {
      g.fillStyle = "#0a0807"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#ff4d3d"; g.fillRect(96, 240, 120, 12);
      g.textBaseline = "alphabetic";
      g.fillStyle = "#ff4d3d";
      g.font = "800 40px Manrope, system-ui, sans-serif";
      g.fillText("UPRISE ACTION NETWORK", 96, 340);
      g.fillStyle = "#b3a89c";
      g.fillText("YOU ARE PARTICIPANT", 96, 620);
      g.fillStyle = "#f4efe6";
      var no = "#" + fmt(ME.participant_no);
      var size = 420;
      g.font = "400 " + size + "px Anton, Impact, sans-serif";
      while (g.measureText(no).width > W - 192 && size > 120) { size -= 20; g.font = "400 " + size + "px Anton, Impact, sans-serif"; }
      g.fillText(no, 90, 620 + size * 0.95);
      g.font = "400 96px Anton, Impact, sans-serif";
      wrap(g, String(C.title || "").toUpperCase(), 96, 1320, W - 192, 104);
      g.fillStyle = "#b3a89c";
      g.font = "800 44px Manrope, system-ui, sans-serif";
      g.fillText("You saw it. Now do something.", 96, 1640);
      g.fillStyle = "#f4efe6";
      g.font = "800 38px Manrope, system-ui, sans-serif";
      g.fillText(root.location.host + "/action/?c=" + SLUG, 96, 1760);
      cv.toBlob(function (blob) {
        if (!blob) return;
        var name = "participant-" + ME.participant_no + "-" + SLUG + ".png";
        var file = null;
        try { file = new File([blob], name, { type: "image/png" }); } catch (e) { file = null; }
        if (file && root.navigator.canShare && root.navigator.canShare({ files: [file] })) {
          root.navigator.share({ files: [file], title: C.title, url: shareUrl() })
            .then(function () { return shared("card"); }, function () {});
          return;
        }
        var a = doc.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        doc.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        say("anLaneMsg", "Card saved. Post it with your link.");
      }, "image/png");
    });
  }
  function wrap(g, text, x, y, max, lh) {
    var words = text.split(/\s+/), line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (g.measureText(test).width > max && line) { g.fillText(line, x, y); y += lh; line = w; }
      else line = test;
    });
    if (line) g.fillText(line, x, y);
  }

  /* ---------- no campaign named: the open ones ---------- */
  function paintIndex(note) {
    if ($("anHero")) $("anHero").hidden = false;
    doc.body.classList.remove("an-action-first");
    $("anIndex").hidden = false;
    $("anIndexNote").textContent = note || "";
    var keep = new URLSearchParams();
    ["src", "med", "reel", "cmp", "ref", "utm_source", "utm_medium", "utm_content", "utm_campaign"].forEach(function (k) {
      if (q.get(k)) keep.set(k, q.get(k));
    });
    return rpc("action_campaigns_live", {}, false).then(function (list) {
      var ul = $("anIndexList");
      ul.textContent = "";
      (list || []).forEach(function (c) {
        var li = el("li"), a = el("a");
        var qs = new URLSearchParams(keep);
        qs.set("c", c.slug);
        a.href = "/action/?" + qs.toString();
        a.appendChild(el("small", null, c.kicker || (c.chapter && c.chapter.region) || "Campaign"));
        a.appendChild(el("b", null, c.title));
        a.appendChild(el("span", null, fmt(c.people) + (Number(c.people) === 1 ? " person" : " people") +
          (c.chapter && c.chapter.line ? " · " + c.chapter.line : "")));
        li.appendChild(a);
        ul.appendChild(li);
      });
      if (!(list || []).length) $("anIndexNote").textContent = "No campaign is open right now.";
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    $("anModeNew").addEventListener("click", function () { setMode("new"); });
    $("anModeIn").addEventListener("click", function () { setMode("in"); });
    $("anJoin").addEventListener("click", joinClick);
    $("anGoogle").addEventListener("click", googleClick);
    $("anShare").addEventListener("click", shareClick);
    $("anCardSave").addEventListener("click", cardClick);
    $("anPass").addEventListener("keydown", function (e) { if (e.key === "Enter") joinClick(); });
    $("anAcct").addEventListener("click", function (e) {
      if (signedIn() || !C || !C.status || C.status !== "live" || ME) return;
      e.preventDefault();
      setMode("in");
      $("join").scrollIntoView({ behavior: "smooth", block: "start" });
      $("anEmail").focus({ preventScroll: true });
    });
    root.addEventListener("mcc:auth-changed", paintJoin);
    setMode("new");

    if (root.MCC && root.MCC.providers) {
      root.MCC.providers().then(function (p) { $("anGoogle").hidden = !(p && p.google); }).catch(function () {});
    }

    var main = $("an");
    /* 404 means the campaign functions are not there at all (nothing is
       open yet); anything else is the network failing to answer */
    function unreachable(e) {
      $("anIndex").hidden = false;
      $("anIndexNote").textContent = e && e.status === 404
        ? "No campaign is open yet."
        : "The network is unreachable right now. Try again in a minute.";
    }
    if (!SLUG) {
      track("action_view", { campaign: "", reel: URL_ORIGIN.reel || "", src: URL_ORIGIN.src || "" });
      paintIndex().catch(unreachable).then(function () { main.setAttribute("aria-busy", "false"); });
      return;
    }

    var o = origin();
    track("action_view", { campaign: SLUG, reel: o.reel || "", src: o.src || "" });
    rpc("action_campaign_public", { p_slug: SLUG }, false).then(function (c) {
      if (!c) return paintIndex("That campaign is not open. These are.").catch(unreachable);
      C = c;
      paintCampaign();
      var ready = Promise.all([loadMissions(), loadBounties()]);
      if (!signedIn()) {
        return ready.then(function () { resumePending(); return null; });
      }
      return ready.then(function () {
        return rpc("action_me", { p_campaign: C.id }, true);
      }).then(function (me) {
        ME = me || null;
        paintMe();
        resumePending();
      }).catch(function () { paintMe(); });
    }).catch(unreachable).then(function () { main.setAttribute("aria-busy", "false"); });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(window, document);
