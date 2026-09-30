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

  /* BACKERS + SHOP. Rewards backing, not investment. The room only sells
     when its artist_ecosystems row is live and the artist's own Stripe
     account is ready; artist-checkout makes the charge on that account.
     See docs/explore/ARTIST-ECOSYSTEM.md for where the lines sit. */
  var session = null, credit = 0;
  function money(c) { return "$" + (Number(c || 0) / 100).toFixed(2); }
  function authed(path, init) {
    init = init || {};
    return fetch(SB + path, {
      method: init.method || "GET",
      headers: { apikey: KEY, authorization: "Bearer " + session.access_token, "content-type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || d.message || r.status); return d; }); });
  }
  function notice(msg) { var n = $("aeNotice"); n.textContent = msg; n.hidden = !msg; }

  // A referral code rides in this tab only: no tracking cookie, and the
  // price is the same whoever sent you.
  var refKey = "ae_ref:" + slug;
  var refIn = (new URLSearchParams(location.search).get("ref") || "").trim().toLowerCase();
  try { if (/^[a-z0-9-]{6,48}$/.test(refIn)) sessionStorage.setItem(refKey, refIn); } catch (_) {}
  function refCode() { try { return sessionStorage.getItem(refKey) || ""; } catch (_) { return ""; } }

  function paintBackers(cfg) {
    var b = cfg.backers || {};
    $("aeBackers").hidden = false;
    if (b.headline) $("aeBackersHead").textContent = b.headline;
    $("aeBackersCopy").textContent = b.copy || "";
    $("aePulseDrop").textContent = "Soon";
    var outcome = new URLSearchParams(location.search).get("purchase");
    if (outcome === "success") notice("Thank you. Your backing is recorded below once payment confirms.");
    if (outcome === "canceled") notice("Checkout closed. Nothing was charged.");

    api("artist_products?artist_slug=eq." + encodeURIComponent(slug) +
        "&select=id,sku,title,description,image_url,price_cents,edition_size,status&order=sort_order.asc")
      .then(function (items) {
        if (!items || !items.length) return;   // room not live or nothing listed: keep "Opens with the first drop."
        $("aePulseDrop").textContent = "Open";
        $("aeShop").innerHTML = items.map(function (it) {
          // No photo supplied: an empty tile, never the house mark on the artist's product.
          var pic = /^https:\/\//.test(it.image_url || "") ? '<img src="' + attr(it.image_url) + '" alt="">' : '<span class="ae__ph"></span>';
          var ed = it.edition_size ? " · Edition of " + it.edition_size : "";
          var out = it.status === "sold_out";
          return '<article class="ae__item">' + pic +
            '<div><h3>' + esc(it.title) + '</h3>' +
            '<p><span class="ae__price">' + money(it.price_cents) + '</span>' + esc(ed) + '</p>' +
            (it.description ? '<p>' + esc(it.description) + '</p>' : '') +
            '<button class="ae__btn" type="button" data-buy="' + attr(it.id) + '"' + (out ? " disabled" : "") + '>' +
            (out ? "Sold out" : "Back it") + '</button></div></article>';
        }).join("");
      })
      .catch(function () { /* shop stays closed */ });
  }

  doc.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-buy]") : null;
    if (!b) return;
    e.preventDefault();
    if (!session) { location.href = "account.html?next=" + encodeURIComponent(here()); return; }
    b.disabled = true; b.textContent = "Opening checkout…";
    authed("/functions/v1/artist-checkout", { method: "POST", body: {
      artist: slug, product_id: b.getAttribute("data-buy"), ref: refCode() || undefined,
      use_credit: credit > 0 && $("aeUseCredit").checked
    } }).then(function (d) {
      track("artist_checkout_start", { product_id: b.getAttribute("data-buy"), referred: !!refCode() });
      location.href = d.url;
    }).catch(function (err) {
      b.disabled = false; b.textContent = "Back it";
      var m = String(err.message || "");
      notice(m === "sold_out" ? "That one just sold out." :
        m === "artist_payouts_not_ready" ? "The shop opens once the artist finishes payout setup." :
        "Checkout is not available right now.");
    });
  });

  function paintMine(cfg) {
    $("aeMine").hidden = false;
    authed("/rest/v1/backer_ledger?artist_slug=eq." + encodeURIComponent(slug) +
      "&select=kind,amount_cents,item_ref,note,at&order=at.desc&limit=30")
      .then(function (rows) {
        var label = { backed: "Backed", refunded: "Refunded", item_shipped: "Shipped", item_delivered: "Delivered",
          store_credit_earned: "Credit earned", store_credit_spent: "Credit used",
          store_credit_returned: "Credit returned", store_credit_reversed: "Credit reversed" };
        var backed = 0;
        rows.forEach(function (r) { if (r.kind === "backed") backed += r.amount_cents; if (r.kind === "refunded") backed -= r.amount_cents; });
        if (!rows.length) return;
        $("aeLedger").innerHTML = '<li>Total backed with ' + esc(cfg.name) + ': <b>' + money(backed) + '</b></li>' +
          rows.map(function (r) {
            return '<li><b>' + esc(label[r.kind] || r.kind) + '</b> ' + money(r.amount_cents) +
              (r.item_ref ? ' · ' + esc(r.item_ref) : '') + ' · ' + esc(new Date(r.at).toLocaleDateString()) + '</li>';
          }).join("");
      }).catch(function () {});
    authed("/rest/v1/rpc/artist_my_credit", { method: "POST", body: { p_slug: slug } })
      .then(function (c) {
        credit = Number(c) || 0;
        $("aeCredit").textContent = money(credit);
        $("aeCreditRow").hidden = credit <= 0;
      }).catch(function () {});
    $("aeGetLink").addEventListener("click", function () {
      var btn = this; btn.disabled = true;
      authed("/rest/v1/rpc/artist_referral_link", { method: "POST", body: { p_slug: slug } })
        .then(function (code) {
          $("aeLinkUrl").value = location.origin + location.pathname + "?a=" + slug + "&ref=" + code;
          $("aeLinkRow").hidden = false; btn.hidden = true;
        }).catch(function () { btn.disabled = false; btn.textContent = "Links open with the first drop"; });
    });
    $("aeCopy").addEventListener("click", function () {
      var v = $("aeLinkUrl").value;
      if (root.navigator.clipboard) root.navigator.clipboard.writeText(v).then(function () { $("aeCopy").textContent = "Copied"; });
      else { $("aeLinkUrl").select(); }
    });
  }

  /* ME. The one M session. Signing in here signs you in everywhere. */
  function paintMe(cfg) {
    var me = $("aeMe");
    me.href = "account.html?next=" + encodeURIComponent(here());
    if (!root.MCC) return;
    root.MCC.refreshIfNeeded().then(function (s) {
      if (!s || !s.access_token) return null;
      session = s;
      return root.MCC.user();
    }).then(function (u) {
      if (!u) return;
      var meta = u.user_metadata || {};
      me.textContent = meta.mccluster_id ? "@" + meta.mccluster_id : "Signed in";
      me.classList.add("is-in");
      me.href = "account.html";
      if ((cfg.sections || {}).backers) paintMine(cfg);
    });
  }
})(window);
