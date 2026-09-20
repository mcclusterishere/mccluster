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

  Promise.all([
    api("creator_tracks?status=eq.published&select=id,m_uid,title,artist,art_url,audio_url,preview_bucket,preview_path,access_mode,genre,published_at&order=published_at.desc&limit=30"),
    api("music_creator_profiles?status=eq.active&select=m_uid,handle,artist_name,avatar_url,verification_state")
  ]).then(function (all) {
    var tracks = all[0] || [], profiles = {};
    (all[1] || []).forEach(function (p) { profiles[p.m_uid] = p; });
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
      var art = t.art_url || p.avatar_url || "assets/img/m-mark.png";
      root.MCC_MUSIC.registerCreatorTrack(Object.assign({}, t, {
        artist_name: artist,
        avatar_url: p.avatar_url || "",
        handle: p.handle || "",
        preview_seconds: 30
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
