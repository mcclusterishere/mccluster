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
  function build(albums, cat, reach) {
    ALBUMS = (albums && albums.albums) || [];
    var meta = {};
    ((cat && cat.tracks) || []).forEach(function (t) { meta[key(t.title)] = t; });
    var rank = {};
    (reach || []).forEach(function (r) { rank[key(r.track_key)] = r; });
    RANKED = (reach || []).length > 0;

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
          reach: r ? r.reach : 0,
        });
      });
    });
    TRACKS = out;
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
  function card(t) {
    return '<a class="feat__card" href="' + escAttr(href(t)) + '" data-cta="listen-card">' +
      '<img class="feat__bg" src="' + escAttr(t.art) + '" alt="" loading="lazy">' +
      '<span class="feat__smoke"></span>' +
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
     THE PAINT
     --------------------------------------------------------------- */
  function paint() {
    var needle = key(q);
    var searching = !!needle;
    var hits = TRACKS.filter(function (t) { return matches(t, needle); }).sort(byReach);
    var mine = TRACKS.filter(function (t) { return saved(t.albumSlug, t.title); }).sort(byReach);

    /* A search is its own view: the rails are a browse aid and they get out
       of the way the moment somebody says what they came for. */
    var showRails = !searching && (chip === "all" || chip === "albums" || chip === "saved");
    el("topWrap").hidden = searching || chip !== "all";
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
      el("topK").textContent = RANKED ? "Most played" : "Start here";
      el("topWhy").textContent = RANKED
        ? "What listeners are actually reaching for."
        : "The six the room opens on.";
      el("top").innerHTML = TRACKS.slice().sort(byReach).slice(0, 6).map(card).join("");
      el("rot").innerHTML = mine.slice(0, 8).map(card).join("");
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

  Promise.all([
    j("data/albums.json"),
    j("data/catalogue.json").catch(function () { return null; }),
    /* The order is an enhancement. A failure here is not a failure of the
       page, so it resolves to nothing and the shelf order stands. */
    j(SB_URL + "/rest/v1/v_track_reach?select=track_key,position,reach&order=position.asc", {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
      cache: "no-cache",
    }).catch(function () { return null; }),
  ]).then(function (all) {
    build(all[0], all[1], all[2]);
    paint();
    if (root.MCC_TRACK) {
      root.MCC_TRACK("listen_view", {
        tracks: TRACKS.length, albums: ALBUMS.length, ranked: RANKED,
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
