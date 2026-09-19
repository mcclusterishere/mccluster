/* THE LISTENING ROOM.
   ===========================================================
   The Music tab used to open data/albums.json's first album and stop
   there. Eight records existed; one was reachable from the bar, and the
   only way to the other seven was the catalogue page, which is a
   registry — ISRC codes and credits — rather than somewhere to listen.
   The magnifying glass in album.html's top row was a link to that
   registry, which is why a search icon never searched anything.

   This room is the whole shelf: every album, every track, one page, in
   an order the listeners decided, with a search field that is a search
   field.

   WHAT ORDERS IT. public.v_track_reach, which collapses album_play and
   rotation_add into a position and a 0-100 index and publishes neither
   the counts nor anything identifying. It is the only thing about
   public.events an anonymous visitor can read, and it is aggregate by
   construction — see the migration.

   WHAT HAPPENS WHEN THAT IS NOT THERE. A new deploy, a blocked request,
   a database asleep: the room still opens, ordered by the catalogue's
   own numbering. The ranking is an improvement on the order, never the
   thing the page needs in order to exist.
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
     album.html writes. It is read here so somebody's own shelf sorts to the
     top of their room; it never leaves the browser. */
  var ROT_KEY = "mcc_rotation";
  function rotation() { return safe(function () { return JSON.parse(localStorage.getItem(ROT_KEY)) || []; }) || []; }

  var TRACKS = [];   // the unified index
  var ALBUMS = [];
  var q = "";
  /* Whether anything actually ranked. The rail is headed on what the data
     can support: calling the catalogue order "Most played" when no play has
     been counted yet is a claim the page cannot back, and it would read as
     one the day the first listener disagreed with it. */
  var RANKED = false;

  /* ---------------------------------------------------------------
     THE INDEX: one row per playable track, from the three sources
     --------------------------------------------------------------- */
  function build(albums, cat, reach) {
    ALBUMS = (albums && albums.albums) || [];
    var meta = {};
    ((cat && cat.tracks) || []).forEach(function (t) { meta[key(t.title)] = t; });
    var rank = {};
    (reach || []).forEach(function (r) { rank[key(r.track_key)] = r; });
    RANKED = (reach || []).length > 0;

    var saved = {};
    rotation().forEach(function (r) { saved[key(r.title)] = true; });

    var out = [];
    ALBUMS.forEach(function (a, ai) {
      (a.tracks || []).forEach(function (t, i) {
        var k = key(t.title);
        var m = meta[k] || {};
        var r = rank[k];
        out.push({
          k: k,
          title: t.title,
          sub: t.sub || "",
          album: a.name,
          albumSlug: a.slug,
          art: a.art,
          no: i + 1,
          gated: !!(t.gated || m.gated),
          length: m.length || "",
          credit: m.credit || "",
          isrc: m.isrc || "",
          /* THE FALLBACK ORDER IS THE SHELF'S OWN, not the registry's.
             data/catalogue.json numbers the fifteen tracks it has
             registered and knows nothing about the other three, so
             ordering by its number put "Deep End" — unregistered, first
             on its own record — second in the whole room, ahead of five
             tracks of the album it is not on. Album position then track
             position is the order somebody browsing a shelf expects, it
             covers every track whether or not it is registered, and it
             cannot collide. */
          seq: (ai * 1000) + i,
          position: r ? r.position : null,
          reach: r ? r.reach : 0,
          saved: !!saved[k],
        });
      });
    });
    TRACKS = out;
  }

  /* ---------------------------------------------------------------
     THE ORDER
     --------------------------------------------------------------- */
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
     THE SEARCH — the thing the magnifying glass never did
     --------------------------------------------------------------- */
  function matches(t, needle) {
    if (!needle) return true;
    var hay = key(t.title + " " + t.album + " " + t.credit + " " + t.sub) + " " + String(t.isrc || "").toLowerCase();
    /* Every word has to appear somewhere, in any order: "here antisocial"
       finds nothing, but "antisocial here" and "here album" both behave the
       way somebody typing them expects. */
    return needle.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
  }

  function href(t) {
    return "album.html?album=" + encodeURIComponent(t.albumSlug) + "&t=" + encodeURIComponent(t.title);
  }

  function row(t) {
    return '<li class="tk' + (t.saved ? " is-saved" : "") + '">' +
      '<a class="tk__go" href="' + escAttr(href(t)) + '" data-cta="listen-track">' +
        '<img class="tk__art" src="' + escAttr(t.art) + '" alt="" loading="lazy">' +
        '<span class="tk__mid">' +
          '<b class="tk__t">' + esc(t.title) + (t.gated ? ' <span class="tk__lock" aria-label="Members">&#9679;</span>' : "") + "</b>" +
          '<small class="tk__sub">' + esc(t.album) + (t.credit ? " &middot; " + esc(t.credit) : "") + "</small>" +
        "</span>" +
        '<span class="tk__end">' + (t.saved ? '<span class="tk__heart" aria-label="In your rotation">&#9829;</span>' : "") +
          (t.length ? '<span class="tk__len">' + esc(t.length) + "</span>" : "") + "</span>" +
      "</a></li>";
  }

  function paint() {
    var needle = key(q);
    var hits = TRACKS.filter(function (t) { return matches(t, needle); }).sort(byReach);

    var searching = !!needle;
    el("shelfWrap").hidden = searching;
    el("topWrap").hidden = searching;

    var count = el("count");
    if (searching) {
      count.hidden = false;
      count.textContent = hits.length === 0
        ? "Nothing matches “" + q.trim() + "”"
        : hits.length + (hits.length === 1 ? " track" : " tracks");
    } else {
      count.hidden = true;
    }

    el("allK").textContent = searching ? "Results" : "Everything";
    el("all").innerHTML = hits.map(row).join("") ||
      '<li class="tk tk--empty">No track by that name. Try an album, a lyric credit, or clear the field.</li>';

    if (!searching) {
      var top = TRACKS.slice().sort(byReach).slice(0, 5);
      el("topK").textContent = RANKED ? "Most played" : "Start here";
      el("top").innerHTML = top.map(row).join("");
    }
  }

  function shelf() {
    el("shelf").innerHTML = ALBUMS.map(function (a) {
      var n = (a.tracks || []).length;
      return '<a href="album.html?album=' + escAttr(a.slug) + '" data-cta="listen-album">' +
        '<img class="cov" src="' + escAttr(a.art) + '" alt="" loading="lazy">' +
        "<b>" + esc(a.name) + "</b><small>" + n + (n === 1 ? " track" : " tracks") + "</small></a>";
    }).join("");
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
       page, so it resolves to nothing and the catalogue order stands. */
    j(SB_URL + "/rest/v1/v_track_reach?select=track_key,position,reach&order=position.asc", {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
      cache: "no-cache",
    }).catch(function () { return null; }),
  ]).then(function (all) {
    build(all[0], all[1], all[2]);
    shelf();
    paint();
    if (root.MCC_TRACK) {
      root.MCC_TRACK("listen_view", {
        tracks: TRACKS.length,
        albums: ALBUMS.length,
        ranked: !!(all[2] && all[2].length),
      });
    }
  }).catch(function () {
    el("all").innerHTML = '<li class="tk tk--empty">The shelf is warming up. Refresh in a moment.</li>';
  });

  /* ---------------------------------------------------------------
     THE FIELD
     --------------------------------------------------------------- */
  var box = el("q");
  var typed = null;
  box.addEventListener("input", function () {
    q = box.value;
    el("qClear").hidden = !q;
    paint();
    /* One event per search, not one per keystroke: what somebody was looking
       for is the useful signal, and the half-typed prefixes on the way there
       are noise. */
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
    if (e.key === "Escape") { box.value = ""; q = ""; el("qClear").hidden = true; paint(); return; }
    /* Enter plays the top result, because that is what pressing Enter on a
       search field is for. */
    if (e.key === "Enter") {
      var first = el("all").querySelector(".tk__go");
      if (first) root.location.href = first.getAttribute("href");
    }
  });

  el("qClear").addEventListener("click", function () {
    box.value = ""; q = ""; el("qClear").hidden = true; paint(); box.focus();
  });
})(window);
