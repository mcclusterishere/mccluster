/* Published creator music becomes part of the same discovery room.
   No second app and no second identity: rows come from creator_tracks and
   music_creator_profiles, then register with MCC_MUSIC's one transport. */
(function (root) {
  "use strict";
  var doc = root.document;
  if (!doc.body.classList.contains("music-room--listen")) return;

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  function esc(x) {
    var d = doc.createElement("i");
    d.textContent = x == null ? "" : String(x);
    return d.innerHTML;
  }
  function attr(x) { return esc(x).replace(/"/g, "&quot;"); }
  function api(path) {
    return fetch(SB + "/rest/v1/" + path, {
      headers: { apikey: KEY, authorization: "Bearer " + KEY },
      cache: "no-cache"
    }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  /* List McCluster once. His catalogue card opens his credits and links on to the house.
     Registered creators open their own profile; the catalogue never borrows an unlinked account. */
  /* A creator's picture is the one Creator Studio stored for them, and
     nothing else: the same rule the creator's own page applies
     (js/music-creator-page.js, safeArtwork). */
  var ARTWORK = SB + "/storage/v1/object/public/creator-artwork/";
  function safeArtwork(u) {
    u = String(u || "");
    if (u.indexOf(ARTWORK) !== 0 || u.length > 600) return "";
    return /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(u.slice(ARTWORK.length)) ? u : "";
  }
  function initialOf(name) { var m = String(name || "").match(/[A-Za-z0-9\u00C0-\u024F]/); return m ? m[0].toUpperCase() : "@"; }
  /* EVERY CREDITED ARTIST HAS AN ENTRY. Owner, 2026-11-24: an artist who is credited on any track, featured
     artists included, is in this row, and opening one shows everything they appear on. The catalogue's artists come
     from data/albums.json through js/music-credits.js (roster: on at least one track); a creator profile with the
     only an explicit catalogue handle links an artist to an account page. An artist with
     no profile opens the artist view (artist.html) and shows their initial, never a mark drawn for them. */
  var ROSTER = [], PRODUCERS = [];
  function creditBadge(on) {
    return on ? '<span class="artist__credit-badge">Equity Uprise verified</span>' : "";
  }
  var PROFILES = [];
  function same(x) { return String(x || "").toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ""); }
  function profileOf(a, profiles) {
    if (!a.handle) return null;
    var matches = profiles.filter(function (p) {
      return p && p.handle && String(p.handle).toLowerCase() === String(a.handle).toLowerCase();
    });
    return matches.length === 1 ? matches[0] : null;
  }
  function catalogueCard(a) {
    return '<a class="artist" href="' + attr(a.href) + '" data-name="' + attr(a.name) + '">' +
      '<span class="artist__pic artist__pic--initial" aria-hidden="true">' + esc(initialOf(a.name)) + '</span>' +
      '<b>' + esc(a.name) + '</b><small>' + a.tracks + (a.tracks === 1 ? " track" : " tracks") +
      '</small>' + creditBadge(a.equityCredit) + '</a>';
  }
  function paintArtists(profiles) {
    PROFILES = profiles || [];
    var ls = doc.querySelector(".ls");
    if (!ls) return;
    var section = doc.getElementById("artistsWrap");
    if (!section) {
      section = doc.createElement("section");
      section.className = "ls__sec artists";
      section.id = "artistsWrap";
      section.setAttribute("aria-label", "Artists");
      section.innerHTML =
        '<p class="lib__k">Artists</p>' +
        '<p class="lib__why">Open an artist for their page and their music.</p>' +
        '<div class="artists__row" id="artistsRow"></div>';
      var first = ls.querySelector(".ls__sec");
      if (first) ls.insertBefore(section, first); else ls.appendChild(section);
    }
    /* ONE McCLUSTER. Owner, 2026-11-24: the row showed McCluster twice, once
       as "the house" and once as the artist profile @mccluster. McCluster is
       one artist here: this first card is his, it carries his handle like
       every other card, and his own profile row is not drawn a second time. */
    var HOUSE_HANDLE = "mccluster";
    var cards = ['<a class="artist artist--house" href="artist.html?artist=' + HOUSE_HANDLE + '" data-name="McCluster">' +
      '<img class="artist__pic artist__pic--house" src="assets/img/m-mark.png" alt="" width="56" height="56">' +
      '<b>McCluster</b><small>@' + HOUSE_HANDLE + '</small>' + creditBadge(ROSTER.some(function (a) { return a.slug === HOUSE_HANDLE && a.equityCredit; })) + '</a>'];
    var shown = {};
    function profileCard(p, catalogueName, verified) {
      shown[String(p.handle).toLowerCase()] = true;
      var name = catalogueName || p.artist_name || "@" + p.handle;
      var avatar = safeArtwork(p.avatar_url);
      return '<a class="artist" href="music-creator.html?handle=' + encodeURIComponent(p.handle) + '" data-name="' + attr(name + " " + p.handle + " " + (p.artist_name || "")) + '">' +
        (avatar
          ? '<img class="artist__pic" src="' + attr(avatar) + '" alt="" loading="lazy" width="56" height="56">'
          : '<span class="artist__pic artist__pic--initial" aria-hidden="true">' + esc(initialOf(name)) + '</span>') +
        '<b>' + esc(name) + '</b><small>@' + esc(p.handle) + (p.verification_state === "verified" ? " \u00b7 verified" : "") + '</small>' + creditBadge(verified) + '</a>';
    }
    /* the catalogue's artists next, in the registry's order: with their profile's page and picture when they have
       one, else the artist view and their initial */
    ROSTER.forEach(function (a) {
      if (a.slug === HOUSE_HANDLE) return;
      var available = (profiles || []).filter(function (x) {
        return x && x.handle && String(x.handle).toLowerCase() !== HOUSE_HANDLE && !shown[String(x.handle).toLowerCase()];
      });
      var p = profileOf(a, available);
      /* An editable account name can match a recording artist. Only a catalogue-linked handle
         may carry their release badge to an account page. Otherwise open the catalogue entry. */
      if (p) {
        cards.push(profileCard(p, a.name, a.equityCredit));
      } else {
        cards.push(catalogueCard(a));
      }
    });
    (profiles || []).forEach(function (p) {
      if (!p || !p.handle || String(p.handle).toLowerCase() === HOUSE_HANDLE) return;
      if (shown[String(p.handle).toLowerCase()]) return;
      var sharesName = ROSTER.concat(PRODUCERS).some(function (a) {
        return p.artist_name && same(p.artist_name) === same(a.name);
      });
      cards.push(profileCard(p, sharesName ? "@" + p.handle : ""));
    });
    doc.getElementById("artistsRow").innerHTML = cards.join("");
    var producers = doc.getElementById("producersWrap");
    if (!producers) {
      producers = doc.createElement("section");
      producers.className = "ls__sec artists";
      producers.id = "producersWrap";
      producers.setAttribute("aria-label", "Producers");
      producers.innerHTML = '<p class="lib__k">Producers</p><p class="lib__why">Open a producer to see what they made.</p><div class="artists__row" id="producersRow"></div>';
      ls.insertBefore(producers, section.nextSibling);
    }
    doc.getElementById("producersRow").innerHTML = PRODUCERS.map(catalogueCard).join("");
    narrowArtists();
  }
  /* A SEARCH NAMES AN ARTIST TOO. Typing "Los Fidel" in the room's search finds his track and leaves his card, the
     only one, at the front of the row; a search that names no artist takes the row out of the way like the other
     rails (js/listen.js paint). Accents and case do not matter: "VVS Made" is VVS Madè. */
  function fold(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function narrowArtists() {
    narrowRow("artistsRow", "artistsWrap", false);
    narrowRow("producersRow", "producersWrap", true);
  }
  function narrowRow(rowId, wrapId, hideWhenEmpty) {
    var row = doc.getElementById(rowId), wrap = doc.getElementById(wrapId), box = doc.getElementById("q");
    if (!row || !wrap || !row.querySelectorAll) return;
    var words = fold(box && box.value).split(" ").filter(Boolean), shown = 0;
    Array.prototype.forEach.call(row.querySelectorAll("a.artist"), function (card) {
      var name = fold(card.getAttribute("data-name"));
      var hit = words.every(function (w) { return name.indexOf(w) > -1; });
      card.hidden = !hit;
      if (hit) shown += 1;
    });
    wrap.hidden = (hideWhenEmpty || words.length > 0) && shown === 0;
    if (words.length) row.scrollLeft = 0;
  }
  var searchBox = doc.getElementById("q");
  if (searchBox && searchBox.addEventListener) {
    searchBox.addEventListener("input", narrowArtists);
  }
  root.MCC_ARTISTS_ROW = { fold: fold, narrow: narrowArtists };
  /* the catalogue's artists, as soon as the shelf answers; the row is repainted with whatever profiles it has */
  if (root.MCC_CREDITS) {
    fetch("data/albums.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (albums) {
      if (!albums) return;
      ROSTER = root.MCC_CREDITS.roster(albums);
      PRODUCERS = root.MCC_CREDITS.producers(albums);
      paintArtists(PROFILES);
    }).catch(function () { /* the row keeps the house and the creators */ });
  }
  paintArtists([]);

  Promise.all([
    api("creator_tracks?status=eq.published&select=id,m_uid,title,artist,poster_url,audio_url,preview_bucket,preview_path,access_mode,genre,published_at&order=published_at.desc&limit=30"),
    api("music_creator_profiles?status=eq.active&select=m_uid,handle,artist_name,avatar_url,verification_state")
  ]).then(function (all) {
    var tracks = all[0] || [], profiles = {};
    (all[1] || []).forEach(function (p) { profiles[p.m_uid] = p; });
    paintArtists(all[1] || []);
    if (!tracks.length || !root.MCC_MUSIC) return;

    var section = doc.createElement("section");
    section.className = "ls__sec";
    section.id = "creatorWrap";
    section.setAttribute("aria-label", "From creators");
    section.innerHTML =
      '<p class="lib__k">From creators</p>' +
      '<p class="lib__why">Independent releases uploaded into the McCluster ecosystem.</p>' +
      '<div class="feat" id="creatorRail"></div>';

    var allWrap = doc.getElementById("allWrap");
    if (allWrap && allWrap.parentNode) allWrap.parentNode.insertBefore(section, allWrap);
    else doc.querySelector(".ls").appendChild(section);

    doc.getElementById("creatorRail").innerHTML = tracks.map(function (t) {
      var p = profiles[t.m_uid] || {};
      var artist = p.artist_name || t.artist || "Independent creator";
      var art = t.poster_url || p.avatar_url || "assets/img/m-mark.png";
      root.MCC_MUSIC.registerCreatorTrack(Object.assign({}, t, {
        artist_name: artist,
        avatar_url: p.avatar_url || "",
        handle: p.handle || "",
        preview_seconds: t.access_mode === "public" ? 0 : 30
      }));
      return '<a class="feat__card creator-card" href="music-creator.html?handle=' + encodeURIComponent(p.handle || "") + '">' +
        '<img class="feat__bg" src="' + attr(art) + '" alt="" loading="lazy">' +
        '<span class="feat__smoke"></span>' +
        '<span class="feat__why">' + esc(t.access_mode === "public" ? "Open play" : t.access_mode === "purchase" ? "Preview · licensable" : "Full track with M Account") + '</span>' +
        '<b>' + esc(t.title) + '</b>' +
        '<small>' + esc(artist) + (t.genre ? " · " + esc(t.genre) : "") + '</small>' +
        '<span class="feat__acts">' +
          '<span class="feat__play" role="button" tabindex="0" aria-label="Play ' + attr(t.title) + '" aria-pressed="false" data-music-play data-creator-track="' + attr(t.id) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' +
          '</span>' +
          '<span class="feat__n">' + esc(t.access_mode === "purchase" ? "Preview" : "Play") + '</span>' +
        '</span>' +
      '</a>';
    }).join("");

    if (root.MCC_TRACK) root.MCC_TRACK("music_creator_rail_view", { tracks: tracks.length });
  }).catch(function () {
    /* Community is an enhancement. The owned catalogue remains usable when
       the public creator read is temporarily unavailable. */
  });
})(window);
