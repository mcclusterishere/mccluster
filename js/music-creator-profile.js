/* An artist's front page on McCluster Music: music-creator.html?handle=x.

   The house album's front door (album.html) for any creator: the name you
   cannot miss over the artist's own photo, the featured record with Play and
   its tracklist, the rest of the albums on a shelf, and the singles. It reads
   only what RLS shows the public: an active creator profile (with the albums
   the creator arranged in Creator Studio, settings.albums) and that
   creator's PUBLISHED tracks. Albums and their rules: js/music-creator-albums.js. */
(function (root) {
  "use strict";
  var doc = root.document;
  var ALB = root.MCC_CREATOR_ALBUMS;
  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  /* No artwork: a transparent pixel over the page's own colour tile
     (css/music-artist.css). The house mark is McCluster's, not the artist's. */
  var NO_ART = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  var handle = (new URLSearchParams(location.search).get("handle") || "").trim().toLowerCase();
  var $ = function (id) { return doc.getElementById(id); };

  function esc(x) { var d = doc.createElement("i"); d.textContent = x == null ? "" : String(x); return d.innerHTML; }
  function attr(x) { return esc(x).replace(/"/g, "&quot;"); }
  function money(cents, cur) {
    try { return new Intl.NumberFormat(undefined,{style:"currency",currency:(cur||"usd").toUpperCase()}).format(Number(cents||0)/100); }
    catch (_) { return "$" + (Number(cents||0)/100).toFixed(2); }
  }
  function duration(ms) {
    var s = Math.round(Number(ms) / 1000);
    if (!(s > 0)) return "";
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function api(path, token) {
    return fetch(SB + "/rest/v1/" + path, {
      headers: { apikey: KEY, authorization: "Bearer " + (token || KEY) },
      cache: "no-cache"
    }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }
  function profileError(message) {
    $("creatorArtist").textContent = "Artist not found";
    $("creatorBio").textContent = message || "This page is unavailable.";
    $("creatorPublicTracks").innerHTML = "";
    $("apSinglesWrap").hidden = true;
  }

  if (!handle || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(handle)) { profileError("No artist was named in the link."); return; }

  var state = { p: null, cat: null, byTrack: {}, featured: "" };

  /* The artist's colours from Creator Studio, validated hex only. */
  function applyTheme(settings) {
    var t = ALB.theme(settings);
    var page = $("artistPage");
    if (t.accent) { page.style.setProperty("--ap-accent", t.accent); doc.body.style.setProperty("--music-accent", t.accent); }
    if (t.background) { page.style.setProperty("--ap-bg", t.background); doc.body.style.setProperty("--music-bg", t.background); }
    if (t.foreground) { page.style.setProperty("--ap-fg", t.foreground); doc.body.style.setProperty("--music-text", t.foreground); }
    if (t.surface) page.style.setProperty("--ap-surface", t.surface);
  }

  /* The name, set like the house front page: every word but the last, then
     the last in the artist's accent. Sized to the longest word so a long
     name shrinks instead of pushing the page sideways. */
  function setName(name) {
    var h1 = $("creatorArtist");
    var words = String(name).trim().split(/\s+/).filter(Boolean);
    var longest = words.reduce(function (n, w) { return Math.max(n, w.length); }, 4);
    h1.style.setProperty("--ap-fit", String(Math.min(longest, 160)));
    if (words.length < 2) { h1.innerHTML = '<span class="ap-hero__line">' + esc(name) + "</span>"; return; }
    h1.innerHTML = '<span class="ap-hero__line">' + esc(words.slice(0, -1).join(" ")) + '</span>' +
      '<span class="ap-hero__line ap-hero__line--accent">' + esc(words[words.length - 1]) + "</span>";
  }

  function realArt(track, album) {
    return ALB.safeArtwork(track && track.poster_url) || (album && album.cover_url) || ALB.safeArtwork(state.p.avatar_url) || "";
  }
  function artFor(track, album) { return realArt(track, album) || NO_ART; }
  function coverOf(album) {
    return album.cover_url || artFor(album.rows[0], null);
  }

  function offersHtml(t) {
    return (state.byTrack[t.id] || []).map(function (o) {
      var label = o.price_cents != null ? o.title + " · " + money(o.price_cents, o.currency) : o.title;
      return '<button type="button" class="creator-offer" data-offer="' + attr(o.id) + '" data-checkout="' +
        (o.checkout_enabled ? "1" : "0") + '" title="' + attr(o.terms_text) + '">' + esc(label) + '</button>';
    }).join("");
  }

  function rowHtml(t, n, album, tag) {
    var state2 = t.access_mode === "public" ? "" : t.access_mode === "account" ? "Full track with free M Account" : "Preview · license available";
    var meta = [t.artist && t.artist !== state.p.artist_name ? t.artist : "", t.genre, state2].filter(Boolean).join(" · ");
    var offers = offersHtml(t);
    return "<" + tag + ' class="ap-track"' + (tag === "div" ? ' role="listitem"' : "") + ">" +
      '<span class="ap-track__n">' + n + "</span>" +
      '<img src="' + attr(artFor(t, album)) + '" alt="" loading="lazy">' +
      '<span class="ap-track__t"><b>' + esc(t.title) + "</b>" + (meta ? "<small>" + esc(meta) + "</small>" : "") +
        (offers ? '<span class="creator-offers">' + offers + "</span>" : "") + "</span>" +
      '<span class="ap-track__d">' + esc(duration(t.duration_ms)) + "</span>" +
      '<button class="creator-play" type="button" data-music-play data-creator-track="' + attr(t.id) +
        '" aria-label="Play ' + attr(t.title) + '" aria-pressed="false">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>' +
    "</" + tag + ">";
  }

  function showAlbum(id, scroll) {
    var albums = state.cat.albums;
    var a = albums.filter(function (x) { return x.id === id; })[0] || albums[0];
    if (!a) return;
    state.featured = a.id;
    var year = a.release_date ? a.release_date.slice(0, 4) : "";
    $("apFeatured").hidden = false;
    $("apAlbumArt").src = coverOf(a);
    $("apAlbumArt").alt = a.title + " cover";
    $("apAlbumKicker").textContent = [ALB.kindLabel(a.kind), a.rows.length + (a.rows.length === 1 ? " track" : " tracks"), year].filter(Boolean).join(" · ");
    $("apAlbumTitle").textContent = a.title;
    $("apAlbumArtist").textContent = state.p.artist_name;
    $("apAlbumPlay").setAttribute("data-creator-track", a.rows[0].id);
    $("apAlbumPlay").setAttribute("aria-label", "Play " + a.title);
    $("apAlbumAbout").textContent = a.description;
    $("apAlbumAbout").hidden = !a.description;
    $("apTracks").innerHTML = a.rows.map(function (t, i) { return rowHtml(t, i + 1, a, "li"); }).join("");
    renderShelf();
    if (scroll) $("apFeatured").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderShelf() {
    var others = state.cat.albums.filter(function (a) { return a.id !== state.featured; });
    $("apShelfWrap").hidden = !others.length;
    $("apShelfTitle").textContent = "More from " + state.p.artist_name;
    $("apShelf").innerHTML = others.map(function (a) {
      return '<button class="ap-card" type="button" data-album="' + attr(a.id) + '">' +
        '<img src="' + attr(coverOf(a)) + '" alt="" loading="lazy">' +
        "<b>" + esc(a.title) + "</b><small>" + esc([ALB.kindLabel(a.kind), a.release_date ? a.release_date.slice(0, 4) : ""].filter(Boolean).join(" · ")) + "</small></button>";
    }).join("");
  }

  function renderDoors(p, firstTrack) {
    var doors = [];
    if (firstTrack) {
      doors.push('<button class="ap-door ap-door--lead" type="button" data-music-play data-creator-track="' + attr(firstTrack.id) +
        '" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>Play</button>');
    }
    if (state.cat.albums.length) doors.push('<a class="ap-door" href="#apFeatured">' + (state.cat.albums.length > 1 ? "Albums" : "The album") + "</a>");
    var site = ALB.safeLink(p.website_url);
    if (site) doors.push('<a class="ap-door" href="' + attr(site) + '" rel="noopener nofollow ugc" target="_blank">Website</a>');
    $("apDoors").innerHTML = doors.join("");
    var identityLink = doc.createElement("a");
    identityLink.className = "ap-door creator-action-network";
    identityLink.href = "mnet.html?profile=" + encodeURIComponent(p.handle);
    identityLink.textContent = "Put this music into action → @" + p.handle;
    identityLink.setAttribute("aria-label", "Open " + p.artist_name + " on the Action Network");
    $("apDoors").appendChild(identityLink);
  }

  function renderPage(p, tracks, offers) {
    state.p = p;
    state.byTrack = {};
    (offers || []).forEach(function (o) { (state.byTrack[o.track_id] || (state.byTrack[o.track_id] = [])).push(o); });
    state.cat = ALB.publicCatalogue(p.settings || {}, tracks || []);
    var cat = state.cat;

    applyTheme(p.settings || {});
    doc.title = p.artist_name + " · McCluster Music";
    var desc = doc.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", (p.bio || (p.artist_name + " on McCluster Music.")).slice(0, 300));
    $("creatorHandle").textContent = "@" + p.handle + (p.verification_state === "verified" ? " · verified" : "") + " · McCluster Music";
    setName(p.artist_name);
    $("creatorBio").textContent = p.bio || "Independent artist on McCluster Music.";
    var avatar = ALB.safeArtwork(p.avatar_url);
    if (avatar) { $("creatorAvatar").src = avatar; $("creatorAvatar").alt = p.artist_name; $("creatorAvatar").hidden = false; }

    /* Every published track goes to the player in page order: the featured
       album, the other albums, then the singles, so Next follows the page. */
    var hash = (location.hash.match(/^#album=(alb_[a-z0-9]{6,24})$/) || [])[1];
    var first = cat.albums.filter(function (a) { return a.id === hash; })[0] ||
      cat.albums.filter(function (a) { return a.id === cat.featured; })[0] || cat.albums[0] || null;
    var ordered = (first ? [first] : []).concat(cat.albums.filter(function (a) { return a !== first; }));
    if (root.MCC_MUSIC) {
      ordered.forEach(function (a) {
        a.rows.forEach(function (t) {
          root.MCC_MUSIC.registerCreatorTrack(Object.assign({}, t, {
            poster_url: realArt(t, a), artist_name: p.artist_name, avatar_url: avatar, release_name: a.title,
            preview_seconds: t.access_mode === "public" ? 0 : 30
          }));
        });
      });
      cat.singles.forEach(function (t) {
        root.MCC_MUSIC.registerCreatorTrack(Object.assign({}, t, {
          poster_url: realArt(t, null), artist_name: p.artist_name, avatar_url: avatar, release_name: "Singles",
          preview_seconds: t.access_mode === "public" ? 0 : 30
        }));
      });
    }

    var heroImg = ALB.safeArtwork(p.banner_url) || (first && coverOf(first)) || avatar;
    if (heroImg && heroImg !== NO_ART) { $("apHeroImg").src = heroImg; $("apHeroImg").hidden = false; }
    renderDoors(p, first ? first.rows[0] : cat.singles[0]);

    if (first) showAlbum(first.id, false);
    var wrap = $("creatorPublicTracks");
    if (!cat.albums.length && !cat.singles.length) {
      wrap.innerHTML = '<div class="creator-status">No published releases yet.</div>';
    } else if (!cat.singles.length) {
      $("apSinglesWrap").hidden = true;
    } else {
      $("apSinglesTitle").textContent = cat.albums.length ? "Singles" : "Releases";
      wrap.innerHTML = cat.singles.map(function (t, i) { return rowHtml(t, i + 1, null, "div"); }).join("");
    }
    if (root.MCC_TRACK) root.MCC_TRACK("creator_profile_view", { handle: p.handle, albums: cat.albums.length, tracks: (tracks || []).length });
  }

  api("music_creator_profiles?handle=eq." + encodeURIComponent(handle) +
      "&status=eq.active&select=m_uid,handle,artist_name,bio,avatar_url,banner_url,website_url,verification_state,settings&limit=1")
    .then(function (profiles) {
      var p = profiles && profiles[0];
      if (!p) throw new Error("profile missing");
      return Promise.all([
        Promise.resolve(p),
        api("creator_tracks?m_uid=eq." + encodeURIComponent(p.m_uid) +
            "&status=eq.published&select=id,title,artist,description,poster_url,audio_url,preview_bucket,preview_path,access_mode,genre,duration_ms,music_video_url,lyrics_url,experience,published_at&order=published_at.desc"),
        api("music_license_offers?creator_m_uid=eq." + encodeURIComponent(p.m_uid) +
            "&active=eq.true&select=id,track_id,title,license_type,price_cents,currency,terms_text,checkout_enabled,sort_order&order=sort_order.asc")
          .catch(function () { return []; })
      ]);
    })
    .then(function (all) { renderPage(all[0], all[1], all[2]); })
    .catch(function () { profileError("This artist's page is unavailable."); });

  doc.addEventListener("click", function (e) {
    var card = e.target && e.target.closest ? e.target.closest("[data-album]") : null;
    if (card && state.cat) {
      e.preventDefault();
      var id = card.getAttribute("data-album");
      if (history.replaceState) history.replaceState(null, "", "#album=" + id);
      showAlbum(id, true);
      if (root.MCC_TRACK) root.MCC_TRACK("creator_album_open", { handle: handle });
      return;
    }
    var b = e.target && e.target.closest ? e.target.closest("[data-offer]") : null;
    if (!b) return;
    e.preventDefault();
    var offerId = b.getAttribute("data-offer");
    if (b.getAttribute("data-checkout") !== "1") {
      location.href = "mailto:matthew@mccluster.org?subject=" + encodeURIComponent("Music license inquiry · " + handle);
      return;
    }
    var session = root.MCC && root.MCC.session && root.MCC.session();
    if (!session || !session.access_token) {
      location.href = "account.html?next=" + encodeURIComponent(location.pathname + location.search);
      return;
    }
    b.disabled = true;
    b.textContent = "Opening checkout…";
    fetch(SB + "/functions/v1/music-checkout", {
      method: "POST",
      headers: {
        apikey: KEY,
        authorization: "Bearer " + session.access_token,
        "content-type": "application/json"
      },
      body: JSON.stringify({ offer_id: offerId })
    }).then(function (r) { return r.json().then(function (d) { return { ok:r.ok, data:d }; }); })
      .then(function (out) {
        if (!out.ok || !out.data.url) throw new Error(out.data.error || "Checkout unavailable");
        if (root.MCC_TRACK) root.MCC_TRACK("music_license_checkout_start", { offer_id: offerId, creator: handle });
        location.href = out.data.url;
      }).catch(function (err) {
        b.disabled = false; b.textContent = "Checkout unavailable";
        b.title = err.message || "Checkout unavailable";
      });
  });
})(window);
