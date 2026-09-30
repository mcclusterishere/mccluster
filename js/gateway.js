/* ============================================================
   HEAL THE 3RD WORLD — the gateway (heal-the-3rd-world.html).

   The cultural front door to the Uprise Action Network. Four acts:
     I   LOOK        the chapters (live campaigns) and what is true,
                     scored by Deep End, the dark side of the EP
     II  LISTEN      the EP itself; the full player is one tap away
     III DO SOMETHING the network's real count and the lanes,
                     scored by Heal the 3rd World, the light side
     IV  ENTER       into the campaign, and Mnet

   Campaigns are chapters, not songs: the chapter list is
   action_campaigns_live(), and /heal-the-3rd-world.html#cobalt opens
   on that chapter and points Acts III and IV at it.

   The score never starts itself. Browsers refuse sound without a tap,
   and a page that ambushes a phone with audio loses the person holding
   it. Once the listener turns it on, the act on screen picks the song,
   crossfading where the browser allows volume (iOS does not, so there
   it simply changes). Background films only run while their act is on
   screen, and never under reduced motion or Save-Data.

   Every number is a live count. Money appears only if the owner has
   switched it on for the campaign.
   ============================================================ */
(function (root, doc) {
  "use strict";

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var SONGS = {
    deep: { title: "Deep End", src: "assets/audio/deep-end.m4a" },
    heal: { title: "Heal the 3rd World", src: "assets/audio/heal-the-3rd-world.m4a" }
  };
  var HAVE = [
    ["give", "I have $5"],
    ["time", "I have time"],
    ["skills", "I have skills"],
    ["reach", "I have reach"],
    ["resources", "I have resources"],
    ["learn", "I want to learn"]
  ];
  var q = new URLSearchParams(root.location.search);
  var KEEP = ["src", "med", "reel", "cmp", "ref", "utm_source", "utm_medium", "utm_content", "utm_campaign"];

  function $(id) { return doc.getElementById(id); }
  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function track(name, props) { try { if (root.MCC_TRACK) root.MCC_TRACK(name, props || {}); } catch (e) {} }
  function rpc(fn, args) {
    return fetch(SB + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: KEY, "content-type": "application/json" },
      body: JSON.stringify(args || {})
    }).then(function (r) { if (!r.ok) throw new Error(fn); return r.json(); });
  }
  /* The Reel that brought someone here still gets the credit when they
     join on the campaign page. */
  function actionHref(slug, extra, hash) {
    var qs = new URLSearchParams();
    KEEP.forEach(function (k) { if (q.get(k)) qs.set(k, q.get(k)); });
    if (slug) qs.set("c", slug);
    Object.keys(extra || {}).forEach(function (k) { qs.set(k, extra[k]); });
    var s = qs.toString();
    return "action/" + (s ? "?" + s : "") + (hash || "");
  }

  /* ---------- the score ---------- */
  var quiet = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var saveData = !!(root.navigator.connection && root.navigator.connection.saveData);
  var players = {};
  var soundOn = false;
  var current = null;     /* the song key playing, if any */
  var chosen = null;      /* a song picked by hand in Act II */
  var actNow = "look";

  function player(key) {
    if (!players[key]) {
      var a = new Audio();
      a.preload = "none";
      a.loop = true;
      a.src = SONGS[key].src;
      players[key] = a;
    }
    return players[key];
  }
  function fade(a, to, ms, done) {
    var from = a.volume, t0 = performance.now();
    function step(t) {
      var k = Math.min(1, (t - t0) / ms);
      try { a.volume = from + (to - from) * k; } catch (e) {}
      if (k < 1) root.requestAnimationFrame(step);
      else if (done) done();
    }
    root.requestAnimationFrame(step);
  }
  function scoreFor(act) {
    if (act === "listen") return chosen || current || "deep";
    return act === "look" ? "deep" : "heal";
  }
  function paintSound() {
    $("gwSound").setAttribute("aria-pressed", soundOn ? "true" : "false");
    $("gwSoundLabel").textContent = soundOn && current ? "Sound on · " + SONGS[current].title : "Play the score";
    Array.prototype.forEach.call(doc.querySelectorAll("[data-play]"), function (b) {
      var on = soundOn && current === b.getAttribute("data-play");
      b.classList.toggle("is-playing", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function playSong(key) {
    if (current === key && !player(key).paused) { paintSound(); return; }
    var prev = current && players[current];
    current = key;
    var a = player(key);
    try { a.volume = prev ? 0 : 1; } catch (e) {}
    var go = a.play();
    if (go && go.catch) go.catch(function () { soundOn = false; current = null; paintSound(); });
    if (prev && prev !== a) fade(prev, 0, 900, function () { prev.pause(); });
    if (prev) fade(a, 1, 900);
    if ("mediaSession" in root.navigator) {
      try {
        root.navigator.mediaSession.metadata = new root.MediaMetadata({
          title: SONGS[key].title, artist: "McCluster × VVS Madè", album: "Heal the 3",
          artwork: [{ src: "assets/img/heal-the-3-cover.jpg", sizes: "1024x1024", type: "image/jpeg" }]
        });
      } catch (e) {}
    }
    track("gateway_score", { song: key, act: actNow });
    paintSound();
  }
  function silence() {
    Object.keys(players).forEach(function (k) { var a = players[k]; fade(a, 0, 400, function () { a.pause(); }); });
    current = null;
    paintSound();
  }
  function toggleSound() {
    soundOn = !soundOn;
    if (soundOn) playSong(scoreFor(actNow)); else silence();
  }

  /* ---------- the acts ---------- */
  function watchActs() {
    if (!("IntersectionObserver" in root)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var sec = e.target, v = sec.querySelector("video.gw-bg");
        if (e.isIntersecting) {
          actNow = sec.id;
          if (soundOn) playSong(scoreFor(actNow));
          if (v && !quiet && !saveData) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        } else if (v) {
          v.pause();
        }
      });
    /* an act is "on" while it crosses the middle of the screen, however
       tall it is on a phone */
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
    Array.prototype.forEach.call(doc.querySelectorAll(".gw-act"), function (s) { io.observe(s); });
  }

  /* ---------- the chapters ---------- */
  function paintChapters(list, want) {
    var ul = $("gwChapters");
    ul.textContent = "";
    if (!list.length) {
      var li = el("li");
      li.appendChild(el("p", "gw-empty", "The first chapter is being written. Enter the network and you’ll be in it from the start."));
      ul.appendChild(li);
      return;
    }
    list.forEach(function (c) {
      var li = el("li");
      li.id = c.slug;
      if (c.slug === want) li.className = "is-target";
      var a = el("a");
      a.href = actionHref(c.slug);
      var ch = c.chapter || {};
      a.appendChild(el("small", null, [ch.region, ch.title].filter(Boolean).join(" · ") || c.kicker || "Chapter"));
      a.appendChild(el("b", null, c.title));
      if (ch.line) a.appendChild(el("span", null, ch.line));
      a.appendChild(el("em", null, fmt(c.people) + (Number(c.people) === 1 ? " person" : " people") + " in · open the chapter →"));
      li.appendChild(a);
      ul.appendChild(li);
    });
  }

  function paintFeatured(c) {
    var facts = $("gwFacts");
    facts.textContent = "";
    (Array.isArray(c.facts) ? c.facts : []).slice(0, 3).forEach(function (f) {
      if (!f || !f.text) return;
      var li = el("li");
      li.appendChild(el("p", null, f.text));
      if (/^https:\/\//i.test(String(f.url || ""))) {
        var a = el("a", null, f.source || "Source");
        a.href = f.url; a.target = "_blank"; a.rel = "noopener";
        li.appendChild(a);
      }
      facts.appendChild(li);
    });

    var people = Number(c.people || 0), goal = Number(c.people_goal || 0);
    $("gwPeople").textContent = fmt(people);
    $("gwPeopleLabel").textContent = (people === 1 ? "person" : "people") + " in " + c.title;
    var bar = $("gwBar");
    bar.hidden = !goal;
    if (goal) {
      bar.setAttribute("aria-valuemax", String(goal));
      bar.setAttribute("aria-valuenow", String(people));
      bar.firstElementChild.style.width = Math.min(100, people / goal * 100) + "%";
      $("gwGoal").textContent = people ? "Goal: " + fmt(goal) + " people · " + fmt(Math.max(0, goal - people)) + " to go"
        : "Goal: " + fmt(goal) + " people. Be the first.";
    }
    $("gwMeter").hidden = false;

    var lanes = $("gwLanes");
    lanes.textContent = "";
    HAVE.forEach(function (h) {
      if (h[0] === "give" && !c.money) return;
      var a = el("a", null, h[1]);
      a.href = actionHref(c.slug, { have: h[0] }, "#join");
      a.addEventListener("click", function () { track("gateway_lane", { campaign: c.slug, have: h[0] }); });
      lanes.appendChild(a);
    });
    $("gwEnter").href = actionHref(c.slug, null, "#join");
  }

  function paintLanesWithout() {
    var lanes = $("gwLanes");
    lanes.textContent = "";
    HAVE.forEach(function (h) {
      if (h[0] === "give") return;
      var a = el("a", null, h[1]);
      a.href = actionHref(null, { have: h[0] });
      lanes.appendChild(a);
    });
  }

  function load() {
    var want = String(root.location.hash || "").replace(/^#/, "").toLowerCase();
    return rpc("action_campaigns_live").then(function (list) {
      list = Array.isArray(list) ? list : [];
      paintChapters(list, want);
      var pick = list.filter(function (c) { return c.slug === want; })[0] || list[0];
      if (pick && want === pick.slug) {
        var target = $(pick.slug);
        if (target) target.scrollIntoView({ block: "start" });
      }
      if (!pick) { paintLanesWithout(); return null; }
      return rpc("action_campaign_public", { p_slug: pick.slug }).then(function (c) { if (c) paintFeatured(c); });
    }).catch(function () {
      paintChapters([], want);
      paintLanesWithout();
    });
  }

  function boot() {
    try {
      var s = root.MCC && root.MCC.session();
      if (s && s.access_token) $("gwAcct").textContent = "Account";
    } catch (e) {}
    $("gwSound").addEventListener("click", toggleSound);
    Array.prototype.forEach.call(doc.querySelectorAll("[data-play]"), function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-play");
        if (soundOn && current === key) { soundOn = false; silence(); return; }
        chosen = key;
        soundOn = true;
        playSong(key);
      });
    });
    paintSound();
    watchActs();
    track("gateway_view", { chapter: String(root.location.hash || "").replace(/^#/, ""), src: q.get("src") || q.get("utm_source") || "", reel: q.get("reel") || q.get("utm_content") || "" });
    load();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(window, document);
