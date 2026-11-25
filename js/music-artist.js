/* THE ARTIST VIEW: artist.html?artist=<slug>.

   Owner, 2026-11-24: every artist credited on any track, featured artists included, gets an entry, and opening one
   shows everything they appear on ("Los Fidel features on Please Set Me Free; opening Los Fidel shows that song and
   any other that mentions him").

   This is the page for an artist who has no page of their own. It reads data/albums.json and nothing else: the
   artists registry for the name, and js/music-credits.js for what they appear on, grouped by what they did there
   (their own tracks, the ones they are on, the ones they produced, any other stated role). Every row plays through
   the one player (js/music-engine.js, data-music-play) and opens its album. The picture is the artist's initial,
   never a mark drawn for them. An artist who has a page of their own (the house, PRIM3) is linked to it. */
(function (root) {
  "use strict";

  function esc(x) {
    return String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function clock(seconds) {
    var s = Math.round(Number(seconds) || 0);
    return s > 0 ? Math.floor(s / 60) + ":" + String(s % 60 + 100).slice(1) : "";
  }
  function initialOf(name) { var m = String(name || "").match(/[A-Za-z0-9À-ɏ]/); return m ? m[0].toUpperCase() : "@"; }

  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  /* the groups, in the order the page shows them */
  var GROUPS = [
    { key: "own", title: "Tracks", why: "Records that are theirs." },
    { key: "featured", title: "Featured on", why: "Records they are on." },
    { key: "produced", title: "Produced", why: "Records they produced." },
    { key: "other", title: "Also credited", why: "Other credits by name." }
  ];

  function row(doc, item) {
    var a = item.album, t = item.track, C = root.MCC_CREDITS;
    var credit = C.line(doc, t);
    var href = "album.html?album=" + encodeURIComponent(a.slug) + "&t=" + encodeURIComponent(t.title);
    return "<li>" +
      '<a class="row" href="' + esc(href) + '" data-cta="artist-track">' +
        '<span class="th" style="background-image:url(' + esc(a.art) + ')"></span>' +
        '<span class="t">' + esc(t.title) +
          "<small>" + esc(a.name) + (credit ? " &middot; " + esc(credit) : "") + "</small>" +
        "</span>" +
      "</a>" +
      '<button class="music-inline-play" type="button" aria-label="Play ' + esc(t.title) + '" aria-pressed="false" data-music-play data-album="' + esc(a.slug) + '" data-track="' + esc(t.title) + '">' + PLAY + "</button>" +
      '<span class="d">' + esc(clock(t.seconds)) + "</span>" +
      "</li>";
  }

  /* everything the page shows for one artist, as data and markup; null when the registry has no such artist */
  function view(doc, slug) {
    var C = root.MCC_CREDITS;
    var artist = C.index(doc)[slug];
    if (!artist) return null;
    var seen = C.appearances(doc, slug);
    var total = C.count(doc, slug);
    var relations = C.groupLinks(doc, slug);
    var label = artist.kind === "act" ? "Act" : "Artist";
    if (relations.members.length) label = "Group";
    else if (seen.produced.length) {
      label = seen.own.length || seen.featured.length || relations.groups.length ? "Artist and producer" : "Producer";
    }
    var sections = GROUPS.map(function (g) {
      var items = seen[g.key];
      return { key: g.key, title: g.title, why: g.why, count: items.length,
        html: items.map(function (x) { return row(doc, x); }).join("") };
    }).filter(function (s) { return s.count > 0; });
    return {
      slug: artist.slug, name: artist.name, kind: artist.kind, initial: initialOf(artist.name), total: total,
      /* their own page, when they have one (data/albums.json artists[].page, a same-site .html file) */
      page: /^[a-z0-9-]+\.html$/.test(artist.page || "") ? artist.page : "",
      summary: label + " · on " + total + (total === 1 ? " track" : " tracks") + " in the McCluster catalogue",
      sections: sections, relations: relations, equityCredit: C.equityCredit(doc, slug)
    };
  }

  root.MCC_ARTIST_VIEW = { view: view, GROUPS: GROUPS };

  /* the catalogue artist a creator profile is, by handle or by name: the same rule the Artists row merges on
     (js/music-community.js), so a card that opens a creator's page still leads to everything they appear on */
  function same(x) { return String(x || "").toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ""); }
  function artistFor(doc, handle, name) {
    var found = null;
    ((doc && doc.artists) || []).forEach(function (a) {
      if (found || !a || !a.slug) return;
      if (root.MCC_CREDITS.equityCredit(doc, a.slug)) {
        if (a.handle && a.handle.toLowerCase() === String(handle || "").toLowerCase()) found = a;
        return;
      }
      var h = same(handle);
      if ((h && (h === same(a.slug) || (a.handle && h === same(a.handle)))) || (name && same(name) === same(a.name))) found = a;
    });
    return found;
  }

  root.MCC_ARTIST_VIEW.artistFor = artistFor;

  /* THE SAME LIST ON A CREATOR'S OWN FRONT PAGE, in that page's own rows (css/music-artist.css .ap-track): every
     track the catalogue credits them on, in the view's order, each one playable and linked to its album, with what
     they did there said when the record is not their own. The cover is shown whole (contain), never cropped. */
  function creatorRows(doc, slug) {
    var C = root.MCC_CREDITS, seen = C.appearances(doc, slug), done = {}, rows = [];
    GROUPS.forEach(function (g) {
      seen[g.key].forEach(function (x) {
        var id = x.album.slug + "|" + x.track.title;
        if (done[id]) return;
        done[id] = true;
        rows.push(x);
      });
    });
    return rows.map(function (x, i) {
      var a = x.album, t = x.track, credit = C.line(doc, t);
      var href = "album.html?album=" + encodeURIComponent(a.slug) + "&t=" + encodeURIComponent(t.title);
      return '<li class="ap-track">' +
        '<span class="ap-track__n">' + (i + 1) + "</span>" +
        '<img class="ap-track__cover" src="' + esc(a.art) + '" alt="" loading="lazy" width="48" height="48">' +
        '<span class="ap-track__t"><b><a href="' + esc(href) + '" data-cta="creator-catalogue-track">' + esc(t.title) + "</a></b>" +
          "<small>" + esc(a.name) + (credit ? " &middot; " + esc(credit) : "") + "</small></span>" +
        '<span class="ap-track__d">' + esc(clock(t.seconds)) + "</span>" +
        '<button class="creator-play" type="button" data-music-play data-album="' + esc(a.slug) + '" data-track="' + esc(t.title) +
          '" aria-label="Play ' + esc(t.title) + '" aria-pressed="false">' + PLAY + "</button>" +
        "</li>";
    }).join("");
  }
  root.MCC_ARTIST_VIEW.creatorRows = creatorRows;

  function relationMarkup(relations) {
    return [["Members", relations.members], ["Groups", relations.groups]].map(function (pair) {
      if (!pair[1].length) return "";
      return '<section class="artist-relations" aria-label="' + pair[0] + '"><h2 class="lib__k">' + pair[0] +
        '</h2><ul>' + pair[1].map(function (a) {
          return '<li><a href="artist.html?artist=' + esc(encodeURIComponent(a.slug)) + '">' + esc(a.name) + '</a></li>';
        }).join("") + '</ul></section>';
    }).join("");
  }

  var doc = root.document;
  if (!doc || !doc.getElementById) return;
  function el(id) { return doc.getElementById(id); }

  /* A CREATOR'S OWN PAGE (music-creator.html) keeps its page and gains one section: when the creator is also
     credited in the house catalogue, everything they appear on there, listed on the page itself (owner, 2026-11-24:
     opening an artist shows everything they appear on), with a link to the same list grouped by role. */
  var line = el("apCatalogue");
  if (line) {
    var nameEl = el("creatorArtist");
    if (!nameEl) return;
    fetch("data/albums.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (albums) {
      if (!albums) return;
      function show() {
        var handle = nameEl.dataset.creatorHandle;
        if (!handle) return false;
        var a = artistFor(albums, handle, nameEl.dataset.catalogueName);
        var n = a ? root.MCC_CREDITS.count(albums, a.slug) : 0;
        if (!a) return false;
        var relations = root.MCC_CREDITS.groupLinks(albums, a.slug);
        if (!n && !relations.groups.length && !relations.members.length) return false;
        el("creatorEquityCredit").hidden = !root.MCC_CREDITS.equityCredit(albums, a.slug);
        line.innerHTML = '<h2 class="ap-label" id="apCatalogueTitle">In the McCluster catalogue</h2>' +
          relationMarkup(relations) + '<ol class="ap-tracks">' + creatorRows(albums, a.slug) + "</ol>" +
          '<p class="ap-cat__more"><a href="artist.html?artist=' + esc(encodeURIComponent(a.slug)) + '" data-cta="creator-catalogue">' +
          n + (n === 1 ? " track" : " tracks") + " credited to " + esc(a.name) + ", grouped by role</a></p>";
        line.hidden = false;
        return true;
      }
      /* Either the active creator record or the catalogue can arrive first. */
      if (show() || typeof root.MutationObserver !== "function") return;
      var seen = new root.MutationObserver(function () { show(); seen.disconnect(); });
      seen.observe(nameEl, { attributes: true, attributeFilter: ["data-creator-handle"] });
    }).catch(function () { /* the page is the creator's; the line is an extra */ });
    return;
  }

  if (!el("artistSections")) return;
  var slug = "";
  try { slug = String(new URLSearchParams(root.location.search).get("artist") || "").toLowerCase(); } catch (e) { slug = ""; }

  function missing() {
    el("artistName").textContent = "No artist by that name";
    el("artistSummary").textContent = "The catalogue has no artist at this address.";
    el("artistPic").textContent = "?";
  }

  fetch("data/albums.json", { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }).then(function (albums) {
    var v = /^[a-z0-9-]{1,64}$/.test(slug) ? view(albums, slug) : null;
    if (!v) { missing(); return; }
    doc.title = v.name + " · McCluster Music";
    el("artistName").textContent = v.name;
    el("artistPic").textContent = v.initial;
    el("artistSummary").textContent = v.summary + ".";
    el("artistCreditBadge").hidden = !v.equityCredit;
    if (v.page) {
      var own = el("artistOwn");
      own.href = v.page;
      own.textContent = "Open " + v.name + "’s page →";
      own.hidden = false;
    }
    el("artistSections").innerHTML = relationMarkup(v.relations) + v.sections.map(function (s) {
      return '<section class="ls__sec" id="' + s.key + '" aria-label="' + esc(s.title) + '" data-group="' + esc(s.key) + '">' +
        '<p class="lib__k">' + esc(s.title) + "</p>" +
        '<p class="lib__why">' + esc(s.why) + "</p>" +
        '<ul class="tr">' + s.html + "</ul></section>";
    }).join("");
    if (root.location.hash === "#produced" && el("produced")) el("produced").scrollIntoView();
    /* music_artist_view is a new event name: js/analytics.js holds it (AWAITING_APPROVAL) and sends nothing until
       Matthew approves measuring it and it is added to the measurement dictionary */
    if (root.MCC_TRACK) root.MCC_TRACK("music_artist_view", { artist: v.slug, tracks: v.total });
  }).catch(function () {
    el("artistSummary").textContent = "The shelf is warming up. Refresh in a moment.";
  });
})(typeof window !== "undefined" ? window : globalThis);
