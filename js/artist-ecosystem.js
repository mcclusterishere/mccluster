/* ARTIST ECOSYSTEM — artist.html?a=<slug>
 *
 * An artist's own front door, built on the McCluster plane rather than
 * beside it. Branding and copy come from data/artists/<slug>.json. Identity
 * is the one M Account (js/mcc-auth.js), music is the shared engine
 * (js/music-engine.js) fed by the artist's music_creator_profiles row, and
 * social is the M Network. Nothing here owns a user table.
 *
 * A null config field is pending from the artist: it renders as absent,
 * never as placeholder copy that could be mistaken for theirs.
 */
(function (root) {
  "use strict";
  var doc = root.document;
  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var slug = (new URLSearchParams(location.search).get("a") || "").trim().toLowerCase();

  function $(id) { return doc.getElementById(id); }
  function esc(x) { var d = doc.createElement("i"); d.textContent = x == null ? "" : String(x); return d.innerHTML; }
  function attr(x) { return esc(x).replace(/"/g, "&quot;"); }
  function safeUrl(u) { return typeof u === "string" && /^https:\/\//.test(u) ? u : null; }
  function api(path) {
    return fetch(SB + "/rest/v1/" + path, {
      headers: { apikey: KEY, authorization: "Bearer " + KEY }, cache: "no-cache"
    }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  }
  function track(name, extra) {
    if (root.MCC_TRACK) root.MCC_TRACK(name, Object.assign({ artist: slug }, extra || {}));
  }
  function here() { return location.pathname + location.search; }

  function fail(msg) {
    $("aeName").textContent = "Artist not found";
    $("aeKicker").textContent = "McCluster";
    var b = $("aeBio"); b.textContent = msg; b.hidden = false;
  }

  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) { fail("No artist was named in the link."); return; }

  fetch("data/artists/" + slug + ".json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(paint)
    .catch(function () { fail("This artist's room is not open yet."); });

  function paint(cfg) {
    var main = $("ae");
    if (cfg.brand && /^#[0-9a-f]{6}$/i.test(cfg.brand.accent || "")) {
      main.style.setProperty("--artist-accent", cfg.brand.accent);
    }
    doc.title = cfg.name + " · on McCluster";
    $("aeName").textContent = cfg.name;
    $("aeKicker").textContent = cfg.music_handle ? "@" + cfg.music_handle + " · on McCluster" : "On McCluster";
    $("aeFootName").textContent = cfg.name + "'s room.";

    if (cfg.bio) { $("aeBio").textContent = cfg.bio; $("aeBio").hidden = false; }
    var ava = safeUrl(cfg.avatar) || (cfg.avatar && /^assets\//.test(cfg.avatar) ? cfg.avatar : null);
    if (ava) { $("aeAva").src = ava; $("aeAva").alt = cfg.name; $("aeAva").hidden = false; }
    var banner = safeUrl(cfg.banner) || (cfg.banner && /^assets\//.test(cfg.banner) ? cfg.banner : null);
    if (banner) $("aeBanner").innerHTML = '<img class="ae__banner" src="' + attr(banner) + '" alt="">';

    var links = [];
    var ig = cfg.links && safeUrl(cfg.links.instagram);
    if (ig) links.push('<a class="ae__chip" href="' + attr(ig) + '" rel="noopener" target="_blank">Instagram</a>');
    var web = cfg.links && safeUrl(cfg.links.website);
    if (web) links.push('<a class="ae__chip" href="' + attr(web) + '" rel="noopener" target="_blank">Website</a>');
    $("aeLinks").innerHTML = links.join("");

    var s = cfg.sections || {};
    if (s.pulse) $("aePulse").hidden = false;
    if (s.social) paintSocial(cfg);
    if (s.backers) paintBackers(cfg);
    if (s.music) paintMusic(cfg);
    else $("aePulseReleases").textContent = "–";

    paintMe(cfg);
    track("artist_room_view", {});
  }

  /* MUSIC. The same public read music-creator.html makes, rendered in this
     room's skin, registered with the one shared engine. */
  function paintMusic(cfg) {
    $("aeMusic").hidden = false;
    var wrap = $("aeTracks");
    function empty(copy, count) {
      $("aePulseReleases").textContent = count == null ? "0" : count;
      wrap.innerHTML = '<div class="ae__status">' + esc(copy) + '</div>' +
        '<a class="ae__btn ae__btn--ghost" href="listen.html">Open the shared room</a>';
    }
    if (!cfg.music_handle) { empty("Releases land here once " + cfg.name + " claims a creator profile."); return; }

    api("music_creator_profiles?handle=eq." + encodeURIComponent(cfg.music_handle) +
        "&status=eq.active&select=m_uid,handle,artist_name,avatar_url&limit=1")
      .then(function (rows) {
        var p = rows && rows[0];
        if (!p) return null;
        return api("creator_tracks?m_uid=eq." + encodeURIComponent(p.m_uid) +
          "&status=eq.published&select=id,title,artist,poster_url,audio_url,preview_bucket,preview_path,access_mode,genre,published_at&order=published_at.desc")
          .then(function (tracks) { return { p: p, tracks: tracks || [] }; });
      })
      .then(function (out) {
        if (!out) { empty(cfg.name + " has not claimed @" + cfg.music_handle + " on McCluster Music yet. Once the artist claims it with their own M Account in the Creator Studio, the releases play here."); return; }
        var p = out.p, tracks = out.tracks;
        $("aePulseReleases").textContent = String(tracks.length);
        if (!tracks.length) { empty("No published releases yet."); return; }
        tracks.forEach(function (t) {
          if (root.MCC_MUSIC) root.MCC_MUSIC.registerCreatorTrack(Object.assign({}, t, {
            artist_name: p.artist_name, avatar_url: p.avatar_url || "",
            preview_seconds: t.access_mode === "public" ? 0 : 30
          }));
        });
        wrap.innerHTML = tracks.map(function (t) {
          var art = t.poster_url || p.avatar_url || "assets/img/m-mark.png";
          var state = t.access_mode === "public" ? "Full play" :
            t.access_mode === "account" ? "Full track with your M Account" : "Preview";
          return '<article class="ae__track"><img src="' + attr(art) + '" alt="">' +
            '<div><h3>' + esc(t.title) + '</h3><p>' + esc(t.genre ? t.genre + " · " + state : state) + '</p></div>' +
            '<button class="ae__play" type="button" data-music-play data-creator-track="' + attr(t.id) +
            '" aria-label="Play ' + attr(t.title) + '" aria-pressed="false">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button></article>';
        }).join("");
      })
      .catch(function () { empty("Releases could not be loaded right now.", "–"); });
  }

  function paintSocial(cfg) {
    $("aeSocial").hidden = false;
    if (cfg.mnet_handle && /^[a-z0-9][a-z0-9._-]{2,31}$/.test(cfg.mnet_handle)) {
      // mnet.html has no per-profile deep link yet; search for the handle there.
      $("aeSocialGo").textContent = "Follow " + cfg.name + " on the M Network";
    }
  }

  /* BACKERS. Rewards backing, not investment. Nothing can be bought here
     until the ledger tables exist and a drop is live; see
     docs/explore/ARTIST-ECOSYSTEM.md for why the line sits where it does. */
  function paintBackers(cfg) {
    var b = cfg.backers || {};
    $("aeBackers").hidden = false;
    if (b.headline) $("aeBackersHead").textContent = b.headline;
    $("aeBackersCopy").textContent = b.copy || "";
    $("aePulseBackers").textContent = b.live ? "0" : "–";
    $("aePulseDrop").textContent = b.live ? "Open" : "Soon";
  }

  /* ME. The one M session. Signing in here signs you in everywhere. */
  function paintMe(cfg) {
    var me = $("aeMe");
    me.href = "account.html?next=" + encodeURIComponent(here());
    if (!root.MCC) return;
    root.MCC.user().then(function (u) {
      if (!u) return;
      var meta = u.user_metadata || {};
      me.textContent = meta.mccluster_id ? "@" + meta.mccluster_id : "Signed in";
      me.classList.add("is-in");
      me.href = "account.html";
      $("aeLedger").textContent = "Your backer ledger for " + cfg.name +
        ": nothing backed yet. Everything you put in and everything you receive will be listed here.";
    });
  }
})(window);
