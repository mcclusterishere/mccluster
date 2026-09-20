(function (root) {
  "use strict";
  var doc = root.document;
  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var handle = (new URLSearchParams(location.search).get("handle") || "").trim().toLowerCase();

  function esc(x) { var d = doc.createElement("i"); d.textContent = x == null ? "" : String(x); return d.innerHTML; }
  function attr(x) { return esc(x).replace(/"/g, "&quot;"); }
  function money(cents, cur) {
    try { return new Intl.NumberFormat(undefined,{style:"currency",currency:(cur||"usd").toUpperCase()}).format(Number(cents||0)/100); }
    catch (_) { return "$" + (Number(cents||0)/100).toFixed(2); }
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
    doc.getElementById("creatorArtist").textContent = "Creator not found";
    doc.getElementById("creatorBio").textContent = message || "This profile is unavailable.";
    doc.getElementById("creatorPublicTracks").innerHTML = "";
  }

  if (!handle) { profileError("No creator handle was supplied."); return; }

  api("music_creator_profiles?handle=eq." + encodeURIComponent(handle) +
      "&status=eq.active&select=m_uid,handle,artist_name,bio,avatar_url,banner_url,website_url,verification_state&limit=1")
    .then(function (profiles) {
      var p = profiles && profiles[0];
      if (!p) throw new Error("profile missing");
      doc.title = p.artist_name + " · McCluster Music";
      doc.getElementById("creatorHandle").textContent = "@" + p.handle +
        (p.verification_state === "verified" ? " · verified" : "");
      doc.getElementById("creatorArtist").textContent = p.artist_name;
      doc.getElementById("creatorBio").textContent = p.bio || "Independent creator on McCluster Music.";
      if (p.avatar_url) doc.getElementById("creatorAvatar").src = p.avatar_url;
      if (p.banner_url) {
        var img = doc.createElement("img");
        img.className = "creator-hero__banner";
        img.src = p.banner_url; img.alt = "";
        doc.getElementById("creatorHero").prepend(img);
      }
      if (root.MCC_TRACK) root.MCC_TRACK("creator_profile_view", { handle: p.handle });

      return Promise.all([
        Promise.resolve(p),
        api("creator_tracks?m_uid=eq." + encodeURIComponent(p.m_uid) +
            "&status=eq.published&select=id,title,artist,description,poster_url,audio_url,preview_bucket,preview_path,access_mode,genre,published_at&order=published_at.desc"),
        api("music_license_offers?creator_m_uid=eq." + encodeURIComponent(p.m_uid) +
            "&active=eq.true&select=id,track_id,title,license_type,price_cents,currency,terms_text,checkout_enabled,sort_order&order=sort_order.asc")
      ]);
    })
    .then(function (all) {
      var p = all[0], tracks = all[1] || [], offers = all[2] || [];
      var byTrack = {};
      offers.forEach(function (o) { (byTrack[o.track_id] || (byTrack[o.track_id] = [])).push(o); });
      var wrap = doc.getElementById("creatorPublicTracks");
      if (!tracks.length) {
        wrap.innerHTML = '<div class="creator-status">No published releases yet.</div>';
        return;
      }
      tracks.forEach(function (t) {
        if (root.MCC_MUSIC) root.MCC_MUSIC.registerCreatorTrack(Object.assign({}, t, {
          artist_name: p.artist_name,
          avatar_url: p.avatar_url || "",
          preview_seconds: t.access_mode === "public" ? 0 : 30
        }));
      });
      wrap.innerHTML = tracks.map(function (t) {
        var art = t.poster_url || p.avatar_url || "assets/img/m-mark.png";
        var os = byTrack[t.id] || [];
        var offerHtml = os.map(function (o) {
          var label = o.price_cents != null ? o.title + " · " + money(o.price_cents, o.currency) : o.title;
          return '<button type="button" class="creator-offer" data-offer="' + attr(o.id) + '" data-checkout="' +
            (o.checkout_enabled ? "1" : "0") + '" title="' + attr(o.terms_text) + '">' + esc(label) + '</button>';
        }).join("");
        var state = t.access_mode === "public" ? "Public full play" :
          t.access_mode === "account" ? "Full track with free M Account" : "Preview · license available";
        return '<article class="creator-track">' +
          '<img src="' + attr(art) + '" alt="">' +
          '<div><h3>' + esc(t.title) + '</h3><p>' + esc(t.artist || p.artist_name) +
            (t.genre ? " · " + esc(t.genre) : "") + " · " + esc(state) + '</p>' +
            (offerHtml ? '<div class="creator-offers">' + offerHtml + '</div>' : '') + '</div>' +
          '<button class="creator-play" type="button" data-music-play data-creator-track="' + attr(t.id) +
            '" aria-label="Play ' + attr(t.title) + '" aria-pressed="false">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>' +
        '</article>';
      }).join("");
    })
    .catch(function () { profileError("This creator profile is unavailable."); });

  doc.addEventListener("click", function (e) {
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
