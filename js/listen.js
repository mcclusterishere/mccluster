/* THE LISTENING ROOM.
   ===========================================================
   The Music tab used to open data/albums.json's first album and stop
   there. Eight records existed; one was reachable from the bar, and the
   only way to the other seven was the catalogue page, which is a
   registry — ISRC codes and credits — rather than somewhere to listen.
   The magnifying glass in album.html's top row was a link to that
   registry, which is why a search icon never searched anything.

   IT IS A DECK, NOT A LIST. The first build of this room was a flat
   index: correct, searchable, and the wrong shape. Somebody arriving
   at a music room has not decided what to play yet, so the page has to
   show them something before it asks them to read. Rails of large
   cards first — where to start, what they already saved, the shelf —
   and the full index underneath for the people who know what they
   want. The card, chip and row vocabulary is album.html's, moved into
   css/music-room.css so the two rooms are one product.

   WHAT ORDERS IT. public.v_track_reach, which collapses album_play and
   rotation_add into a position and a 0-100 index and publishes neither
   the counts nor anything identifying.

   WHAT HAPPENS WHEN THAT IS NOT THERE. A new deploy, a blocked request,
   a database asleep: the room still opens, ordered by the shelf, and
   the rail heads itself on what the data can support.
   =========================================================== */
(function (root) {
  "use strict";
  var doc = root.document;

  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  function el(id) { return doc.getElementById(id); }
  function esc(x) { var d = doc.createElement("i"); d.textContent = x == null ? "" : x; return d.innerHTML; }
  function escAttr(x) { return esc(x).replace(/"/g, "&quot;"); }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }

  /* The join key between three sources that never agreed on one. albums.json
     names a track, catalogue.json slugs it, and the telemetry recorded
     whatever string the player had on screen. Lowercased and stripped, all
     three land on the same key. */
  function key(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  /* THE ROTATION is this device's own saves, the same localStorage list
     album.html writes, in the same shape, so a heart tapped in either room
     shows in the other. It never leaves the browser. */
  var ROT_KEY = "mcc_rotation";
  function rotation() { return safe(function () { return JSON.parse(localStorage.getItem(ROT_KEY)) || []; }) || []; }
  function saved(alb, title) {
    return rotation().some(function (r) { return r.album === alb && r.title === title; });
  }
  function toggleSave(alb, title) {
    var all = rotation();
    var kept = all.filter(function (x) { return !(x.album === alb && x.title === title); });
    var added = kept.length === all.length;
    if (added) kept.push({ album: alb, title: title });
    safe(function () { localStorage.setItem(ROT_KEY, JSON.stringify(kept)); });
    /* The same event album.html files, because this is the same act and the
       ranking view counts both without caring which room it happened in. */
    if (root.MCC_TRACK) root.MCC_TRACK(added ? "rotation_add" : "rotation_drop", { track: title });
    return added;
  }

  var TRACKS = [];
  var ALBUMS = [];
  var BY_KEY = {};
  var NEIGHBOURS = {};
  var AFFINITY_ROWS = 0;
  var q = "";
  var chip = "all";
  /* Whether anything actually ranked. The rail is headed on what the data
     can support: calling the shelf order "Most played" when no play has been
     counted yet is a claim the page cannot back, and it would read as one the
     day the first listener disagreed with it. */
  var RANKED = false;

  /* ---------------------------------------------------------------
     THE INDEX
     --------------------------------------------------------------- */
  function build(albums, cat, signals, affinity) {
    ALBUMS = (albums && albums.albums) || [];
    var meta = {};
    ((cat && cat.tracks) || []).forEach(function (t) { meta[key(t.title)] = t; });
    var rank = {};
    (signals || []).forEach(function (r) { rank[key(r.track_key)] = r; });
    RANKED = (signals || []).length > 0;

    /* The similarity matrix, indexed by seed. Only the top few neighbours of
       each track are fetched: past that the scores are noise and the payload
       grows with the square of the catalogue. */
    NEIGHBOURS = {};
    (affinity || []).forEach(function (r) {
      var k = key(r.track_key);
      (NEIGHBOURS[k] || (NEIGHBOURS[k] = [])).push({ k: key(r.other_key), score: Number(r.score) || 0 });
    });
    AFFINITY_ROWS = (affinity || []).length;

    var out = [];
    ALBUMS.forEach(function (a, ai) {
      (a.tracks || []).forEach(function (t, i) {
        var k = key(t.title);
        var m = meta[k] || {};
        var r = rank[k];
        out.push({
          k: k, title: t.title, sub: t.sub || "",
          album: a.name, albumSlug: a.slug, art: a.art,
          no: i + 1,
          gated: !!(t.gated || m.gated),
          length: m.length || "",
          credit: m.credit || "",
          isrc: m.isrc || "",
          /* THE FALLBACK ORDER IS THE SHELF'S OWN, not the registry's.
             data/catalogue.json numbers the fifteen tracks it has registered
             and knows nothing about the other three, so ordering by its
             number put "Deep End" — unregistered, first on its own record —
             second in the whole room, ahead of five tracks of an album it is
             not on. Album position then track position covers every track
             and cannot collide. */
          seq: (ai * 1000) + i,
          position: r ? r.position : null,
          keep: r ? r.keep_score : 0,
          momentum: r ? r.momentum_score : 0,
          momentumRank: r ? r.momentum_rank : null,
          deepCut: !!(r && r.deep_cut),
        });
      });
    });
    TRACKS = out;
    BY_KEY = {};
    out.forEach(function (t) { BY_KEY[t.k] = t; });
  }

  function byReach(a, b) {
    /* A ranked track always outranks an unranked one: a record nobody has
       played yet sits below every record somebody has, rather than being
       shuffled through them by a zero. */
    if (a.position && b.position) return a.position - b.position;
    if (a.position) return -1;
    if (b.position) return 1;
    return a.seq - b.seq;
  }

  /* ---------------------------------------------------------------
     THE SEARCH
     --------------------------------------------------------------- */
  function matches(t, needle) {
    if (!needle) return true;
    var hay = key(t.title + " " + t.album + " " + t.credit + " " + t.sub) + " " +
      String(t.isrc || "").toLowerCase();
    /* Every word has to appear somewhere, in any order, so "song write"
       finds "Write a Song". */
    return needle.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
  }

  function href(t) {
    return "album.html?album=" + encodeURIComponent(t.albumSlug) + "&t=" + encodeURIComponent(t.title);
  }

  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true" width="17" height="17" fill="none" ' +
    'stroke="currentColor" stroke-width="2"><path d="M12 20s-7-4.6-9-9c-1.2-2.7 0.6-6 3.8-6 2 0 3.4 1.2 5.2 3.2' +
    'C13.8 6.2 15.2 5 17.2 5c3.2 0 5 3.3 3.8 6-2 4.4-9 9-9 9z"/></svg>';

  /* ---------------------------------------------------------------
     THE CARD — the art IS the card, the way the album room does it
     --------------------------------------------------------------- */
  function card(t, why) {
    return '<a class="feat__card" href="' + escAttr(href(t)) + '" data-cta="listen-card">' +
      '<img class="feat__bg" src="' + escAttr(t.art) + '" alt="" loading="lazy">' +
      '<span class="feat__smoke"></span>' +
      (why ? '<span class="feat__why">' + esc(why) + "</span>" : "") +
      "<b>" + esc(t.title) + "</b>" +
      "<small>" + esc(t.album) + "</small>" +
      '<span class="feat__acts">' +
        '<span class="feat__play">' + PLAY + "</span>" +
        '<span class="feat__n">' + esc(t.length || "Play") + "</span>" +
      "</span></a>";
  }

  function albumCard(a) {
    var n = (a.tracks || []).length;
    return '<a class="feat__card is-album" href="album.html?album=' + escAttr(a.slug) + '" data-cta="listen-album">' +
      '<img class="feat__bg" src="' + escAttr(a.art) + '" alt="" loading="lazy">' +
      '<span class="feat__smoke"></span>' +
      "<b>" + esc(a.name) + "</b>" +
      "<small>" + esc(a.by || "") + "</small>" +
      '<span class="feat__acts">' +
        '<span class="feat__play">' + PLAY + "</span>" +
        '<span class="feat__n">' + n + (n === 1 ? " track" : " tracks") + "</span>" +
      "</span></a>";
  }

  /* THE NUMBER IS THE LIST'S, NOT THE ALBUM'S. album.html numbers a track
     by its place on the record, which is right there on the page. In a room
     that crosses eight records a per-album number restarts at 1 over and
     over and reads as a bug, so this counts the list somebody is actually
     looking at — including a search, where "result 3" is the useful fact. */
  function row(t, i) {
    var on = saved(t.albumSlug, t.title);
    return "<li>" +
      '<a class="row" href="' + escAttr(href(t)) + '" data-cta="listen-track">' +
        '<span class="n">' + (i + 1) + "</span>" +
        '<span class="th" style="background-image:url(' + escAttr(t.art) + ')"></span>' +
        '<span class="t">' + esc(t.title) +
          "<small>" + esc(t.album) + (t.credit ? " &middot; " + esc(t.credit) : "") + "</small>" +
        "</span>" +
      "</a>" +
      '<span class="d">' + esc(t.length) + "</span>" +
      '<button class="hrt' + (on ? " on" : "") + '" type="button" data-alb="' + escAttr(t.albumSlug) +
        '" data-title="' + escAttr(t.title) + '" aria-pressed="' + (on ? "true" : "false") +
        '" aria-label="Save ' + escAttr(t.title) + '">' + HEART + "</button>" +
      "</li>";
  }

  /* ---------------------------------------------------------------
     THE RECOMMENDERS

     Two halves, and the split is deliberate. The server computes what is
     true of everybody — a Wilson-bounded keep rate, a decayed momentum, a
     co-occurrence matrix — and publishes it with no identifier on it. The
     browser computes what is true of itself, from its own history, and
     never asks the server who it is. Personalisation happens where the
     person already is.
     --------------------------------------------------------------- */

  /* This device's own recent plays, newest first. Written by js/analytics.js
     on every album_play, capped, and cleared when the visitor clears their
     storage. */
  function heard() {
    var h = (root.MCC_HEARD && root.MCC_HEARD.read()) || [];
    return h.filter(function (r) { return r && r.t; });
  }

  /* BECAUSE YOU PLAYED X — item-to-item collaborative filtering.
     Each of the last few plays is a seed; its neighbours in the published
     similarity matrix are candidates; a candidate that several seeds agree
     on scores higher than one that a single seed likes a lot. Recency
     weights the seeds, because what somebody played an hour ago says more
     about now than what they played last month. Anything already heard is
     dropped: this rail exists to find the next record, not to re-describe
     the last one. */
  var SEEDS = 4;
  function becausePlayed() {
    var h = heard().slice(0, SEEDS);
    if (!h.length || !AFFINITY_ROWS) return [];
    var seen = {};
    heard().forEach(function (r) { seen[key(r.t)] = true; });

    var pool = {};
    h.forEach(function (row, i) {
      var seedKey = key(row.t);
      var weight = 1 / (i + 1);          // 1, ½, ⅓, ¼ by recency
      (NEIGHBOURS[seedKey] || []).forEach(function (n) {
        if (seen[n.k] || !BY_KEY[n.k]) return;
        var e = pool[n.k] || (pool[n.k] = { k: n.k, score: 0, best: 0, seed: row.t });
        e.score += n.score * weight;
        /* the card names the seed that contributed most, so the reason on
           it is true rather than a summary of four */
        if (n.score * weight > e.best) { e.best = n.score * weight; e.seed = row.t; }
      });
    });
    return Object.keys(pool).map(function (k) { return pool[k]; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 8)
      .map(function (e) { return { t: BY_KEY[e.k], why: "Plays with " + e.seed }; });
  }

  /* FINISH THE RECORD — the one recommender that needs no server at all.
     An album somebody started and did not play out is the most obvious
     thing to put in front of them, and for an artist who releases albums it
     is worth more than any similarity score. */
  function finishTheRecord() {
    var h = heard();
    if (!h.length) return [];
    var seen = {};
    h.forEach(function (r) { seen[key(r.t)] = true; });

    var out = [];
    ALBUMS.forEach(function (a) {
      var tracks = TRACKS.filter(function (t) { return t.albumSlug === a.slug; });
      if (tracks.length < 2) return;
      var done = tracks.filter(function (t) { return seen[t.k]; }).length;
      if (!done || done === tracks.length) return;
      var next = tracks.filter(function (t) { return !seen[t.k]; })[0];
      if (next) out.push({ t: next, why: done + " of " + tracks.length + " played", done: done / tracks.length });
    });
    /* the album closest to finished goes first: the shortest ask wins */
    return out.sort(function (x, y) { return y.done - x.done; }).slice(0, 6);
  }

  /* A rail sorts by the signal it is about. Ranking "Rising" by the keep
     rank put the fourth-fastest-climbing track at the head of it and the
     actual leader three cards along, which is the rail quietly not doing
     the thing its heading claims. */
  function pick(fn, why, rankOf) {
    var order = rankOf || function (t) { return t.position || 99; };
    return TRACKS.filter(fn)
      .sort(function (a, b) { return order(a) - order(b); })
      .slice(0, 8)
      .map(function (t) { return { t: t, why: typeof why === "function" ? why(t) : why }; });
  }

  function rail(id, wrapId, items) {
    var wrap = el(wrapId);
    wrap.hidden = !items.length;
    if (items.length) el(id).innerHTML = items.map(function (x) { return card(x.t, x.why); }).join("");
    return items.length;
  }

  /* ---------------------------------------------------------------
     THE PAINT
     --------------------------------------------------------------- */
  function paint() {
    var needle = key(q);
    var searching = !!needle;
    var hits = TRACKS.filter(function (t) { return matches(t, needle); }).sort(byReach);
    var mine = TRACKS.filter(function (t) { return saved(t.albumSlug, t.title); }).sort(byReach);

    /* A search is its own view: the rails are a browse aid and they get out
       of the way the moment somebody says what they came for. */
    /* A search is its own view: the rails are a browse aid and they get out
       of the way the moment somebody says what they came for. */
    var showRails = !searching && chip !== "tracks";
    ["ffWrap", "finWrap", "riseWrap", "keptWrap", "deepWrap"].forEach(function (id) {
      if (searching || chip !== "all") el(id).hidden = true;
    });
    el("shelfWrap").hidden = searching || (chip !== "all" && chip !== "albums");
    el("rotWrap").hidden = searching || !mine.length || (chip !== "all" && chip !== "saved");
    el("allWrap").hidden = chip === "albums" && !searching;

    var count = el("count");
    count.hidden = !searching;
    if (searching) {
      count.textContent = hits.length === 0
        ? "Nothing matches “" + q.trim() + "”"
        : hits.length + (hits.length === 1 ? " track" : " tracks");
    }

    var list = hits;
    if (!searching && chip === "saved") list = mine;

    el("allK").textContent = searching ? "Results" : (chip === "saved" ? "Saved" : "Everything");
    el("allWhy").textContent = searching
      ? "Matched on title, album, credit and registered code."
      : (chip === "saved" ? "Every track you have saved on this device." : "All of it, in one list.");
    el("all").innerHTML = list.map(row).join("") ||
      '<li><span class="t">' + (searching
        ? "No track by that name. Try an album, a credit, or clear the field."
        : "Nothing saved yet. Tap a heart and it lands here.") + "</span></li>";

    if (showRails) {
      /* Each rail is one method, and it is on the page only when that method
         produced something. A recommender with nothing to say says nothing;
         it does not fall back to the top of the catalogue wearing a
         personalised heading. */
      rail("ff",   "ffWrap",   becausePlayed());
      rail("fin",  "finWrap",  finishTheRecord());
      rail("rise", "riseWrap", pick(
        function (t) { return t.momentumRank && t.momentumRank <= 8 && t.momentum > 0; },
        function (t) { return t.momentum >= 60 ? "Climbing" : "Up this week"; },
        function (t) { return t.momentumRank || 99; }));
      rail("kept", "keptWrap", pick(
        function (t) { return t.position && t.position <= 8 && !t.deepCut; },
        function (t) { return t.position === 1 ? "Most kept in the catalogue" : "Kept after playing"; }));
      rail("deep", "deepWrap", pick(
        function (t) { return t.deepCut; }, "Kept more than it is found",
        function (t) { return t.position || 99; }));
      rail("rot",  "rotWrap",  mine.slice(0, 8).map(function (t) {
        return { t: t, why: "Saved on this device" };
      }));
      el("shelf").innerHTML = ALBUMS.map(albumCard).join("");
    }
  }

  /* ---------------------------------------------------------------
     BOOT
     --------------------------------------------------------------- */
  var j = function (u, opts) {
    return fetch(u, opts || { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  };

  var sb = function (path) {
    /* Every rail the server feeds is an enhancement. A failure resolves to
       nothing and that rail simply does not appear, which is the honest
       outcome: a section headed with a method and filled with a fallback is
       worse than no section. */
    return j(SB_URL + "/rest/v1/" + path, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
      cache: "no-cache",
    }).catch(function () { return null; });
  };

  Promise.all([
    j("data/albums.json"),
    j("data/catalogue.json").catch(function () { return null; }),
    sb("v_track_signals?select=track_key,position,keep_score,momentum_score,momentum_rank,deep_cut"),
    sb("v_track_affinity?select=track_key,other_key,score&rn=lte.6&order=score.desc"),
  ]).then(function (all) {
    build(all[0], all[1], all[2], all[3]);
    paint();
    if (root.MCC_TRACK) {
      root.MCC_TRACK("listen_view", {
        tracks: TRACKS.length, albums: ALBUMS.length,
        ranked: RANKED, affinity: AFFINITY_ROWS, heard: heard().length,
      });
    }
  }).catch(function () {
    el("all").innerHTML = '<li><span class="t">The shelf is warming up. Refresh in a moment.</span></li>';
  });

  /* ---------------------------------------------------------------
     THE FIELD
     --------------------------------------------------------------- */
  var box = el("q");
  var typed = null;
  function clear() { box.value = ""; q = ""; el("qClear").hidden = true; paint(); }

  box.addEventListener("input", function () {
    q = box.value;
    el("qClear").hidden = !q;
    paint();
    /* One event per search, not one per keystroke: what somebody was looking
       for is the signal, and the half-typed prefixes on the way there are
       noise. */
    clearTimeout(typed);
    typed = setTimeout(function () {
      var needle = key(q);
      if (!needle || !root.MCC_TRACK) return;
      root.MCC_TRACK("listen_search", {
        q: q.trim().slice(0, 60),
        hits: TRACKS.filter(function (t) { return matches(t, needle); }).length,
      });
    }, 900);
  });

  box.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { clear(); return; }
    /* Enter plays the top result, because that is what pressing Enter on a
       search field is for. */
    if (e.key === "Enter") {
      var first = el("all").querySelector("a.row");
      if (first) root.location.href = first.getAttribute("href");
    }
  });

  el("qClear").addEventListener("click", function () { clear(); box.focus(); });

  el("chips").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-chip]");
    if (!b) return;
    chip = b.getAttribute("data-chip");
    [].forEach.call(el("chips").querySelectorAll("button"), function (x) {
      x.classList.toggle("on", x === b);
    });
    paint();
    if (root.MCC_TRACK) root.MCC_TRACK("listen_chip", { chip: chip });
  });

  /* The heart is live here, not decoration. A save made in the discovery
     room is the same act as one made in the album room and feeds the same
     ranking, so the room that recommends also collects. */
  el("all").addEventListener("click", function (e) {
    var b = e.target.closest(".hrt");
    if (!b) return;
    e.preventDefault();
    var on = toggleSave(b.getAttribute("data-alb"), b.getAttribute("data-title"));
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    if (chip === "saved" || !el("rotWrap").hidden) paint();
  });
})(window);
