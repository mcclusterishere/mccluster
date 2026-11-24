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

  /* THE ARTISTS, FIRST. One McCluster (owner, 2026-11-23: "McCluster has two profiles. One says the house, one says
     the artist. It needs to be one profile. McCluster is the artist."): McCluster is first, painted at once, and opens
     his artist page (music-creator.html?handle=mccluster), where his records are; his directory row is that same card,
     not a second one. The house itself (index.html, the M in the middle of the bar) is not an artist and is not on
     this rail. Every other active creator follows when the directory answers, and opening one gives the bar their
     perspective (js/tabbar.js). A creator's picture is their own avatar or their initial, never a mark drawn for them;
     McCluster's is the M as supplied, scaled, on no plate. */
  var HOUSE_ARTIST = "mccluster";
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
  function paintArtists(profiles) {
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
    var cards = ['<a class="artist artist--house" href="music-creator.html?handle=' + HOUSE_ARTIST + '" aria-label="McCluster, artist">' +
      '<img class="artist__pic artist__pic--house" src="assets/img/m-mark.png" alt="" width="56" height="56">' +
      '<b>McCluster</b><small>Artist</small></a>'];
    (profiles || []).forEach(function (p) {
      if (!p || !p.handle || String(p.handle).toLowerCase() === HOUSE_ARTIST) return;   // his one card is first
      var name = p.artist_name || "@" + p.handle;
      var avatar = safeArtwork(p.avatar_url);
      cards.push('<a class="artist" href="music-creator.html?handle=' + encodeURIComponent(p.handle) + '">' +
        (avatar
          ? '<img class="artist__pic" src="' + attr(avatar) + '" alt="" loading="lazy" width="56" height="56">'
          : '<span class="artist__pic artist__pic--initial" aria-hidden="true">' + esc(initialOf(name)) + '</span>') +
        '<b>' + esc(name) + '</b><small>@' + esc(p.handle) + (p.verification_state === "verified" ? " \u00b7 verified" : "") + '</small></a>');
    });
    doc.getElementById("artistsRow").innerHTML = cards.join("");
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
