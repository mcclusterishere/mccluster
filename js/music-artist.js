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
    var sections = GROUPS.map(function (g) {
      var items = seen[g.key];
      return { key: g.key, title: g.title, why: g.why, count: items.length,
        html: items.map(function (x) { return row(doc, x); }).join("") };
    }).filter(function (s) { return s.count > 0; });
    return {
      slug: artist.slug, name: artist.name, kind: artist.kind, initial: initialOf(artist.name), total: total,
      /* their own page, when they have one (data/albums.json artists[].page, a same-site .html file) */
      page: /^[a-z0-9-]+\.html$/.test(artist.page || "") ? artist.page : "",
      summary: (artist.kind === "act" ? "Act" : "Artist") + " · on " + total + (total === 1 ? " track" : " tracks") + " in the McCluster catalogue",
      sections: sections
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
      var h = same(handle);
      if ((h && (h === same(a.slug) || (a.handle && h === same(a.handle)))) || (name && same(name) === same(a.name))) found = a;
    });
    return found;
  }

  root.MCC_ARTIST_VIEW.artistFor = artistFor;

  var doc = root.document;
  if (!doc || !doc.getElementById) return;
  function el(id) { return doc.getElementById(id); }

  /* A CREATOR'S OWN PAGE (music-creator.html) keeps its page and gains one line: when the creator is also credited
     in the house catalogue, a link to everything they appear on there. */
  var line = el("apCatalogue");
  if (line) {
    var handle = "";
    try { handle = String(new URLSearchParams(root.location.search).get("handle") || "").trim().toLowerCase(); } catch (e) { handle = ""; }
    fetch("data/albums.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (albums) {
      if (!albums) return;
      function show(name) {
        var a = artistFor(albums, handle, name);
        var n = a ? root.MCC_CREDITS.count(albums, a.slug) : 0;
        if (!n) return false;
        line.innerHTML = 'Also in the McCluster catalogue: <a href="artist.html?artist=' + esc(encodeURIComponent(a.slug)) + '" data-cta="creator-catalogue">' +
          n + (n === 1 ? " track" : " tracks") + " credited to " + esc(a.name) + "</a>";
        line.hidden = false;
        return true;
      }
      if (show("")) return;
      /* no match on the handle: try the artist's name once the profile has written it */
      var nameEl = el("creatorArtist");
      if (!nameEl || typeof root.MutationObserver !== "function") return;
      var seen = new root.MutationObserver(function () { if (show(nameEl.textContent)) seen.disconnect(); });
      seen.observe(nameEl, { childList: true, characterData: true, subtree: true });
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
    if (v.page) {
      var own = el("artistOwn");
      own.href = v.page;
      own.textContent = "Open " + v.name + "’s page →";
      own.hidden = false;
    }
    el("artistSections").innerHTML = v.sections.map(function (s) {
      return '<section class="ls__sec" aria-label="' + esc(s.title) + '" data-group="' + esc(s.key) + '">' +
        '<p class="lib__k">' + esc(s.title) + "</p>" +
        '<p class="lib__why">' + esc(s.why) + "</p>" +
        '<ul class="tr">' + s.html + "</ul></section>";
    }).join("");
    if (root.MCC_TRACK) root.MCC_TRACK("music_artist_view", { artist: v.slug, tracks: v.total });
  }).catch(function () {
    el("artistSummary").textContent = "The shelf is warming up. Refresh in a moment.";
  });
})(typeof window !== "undefined" ? window : globalThis);
