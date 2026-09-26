/* MNET — consumer social surface for the canonical McCluster Network. */
(function () {
  "use strict";

  var APP = "mccluster-web";
  var state = {
    user: null,
    boot: null,
    feed: [],
    nextBefore: null,
    loadingFeed: false,
    threadPost: null,
    currentView: "feed",
    mediaAssets: [],
    mediaCache: {},
    conversations: [],
    currentConversation: null,
    pollTimer: null
  };
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function setStatus(node, text, kind) {
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", kind === "error");
    node.classList.toggle("is-ok", kind === "ok");
  }
  function initials(name) {
    var parts = String(name || "M").trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map(function (p) { return p.charAt(0); }).join("") || "M").toUpperCase();
  }
  function safeHttpUrl(value) {
    try {
      var u = new URL(String(value || ""), location.origin);
      return /^(https?:)$/.test(u.protocol) ? u.href : "";
    } catch (e) { return ""; }
  }
  function timeAgo(iso) {
    var d = new Date(iso), ms = Date.now() - d.getTime();
    if (!Number.isFinite(ms)) return "";
    var sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return "now";
    var min = Math.floor(sec / 60); if (min < 60) return min + "m";
    var hr = Math.floor(min / 60); if (hr < 24) return hr + "h";
    var day = Math.floor(hr / 24); if (day < 7) return day + "d";
    return d.toLocaleDateString(undefined, { month:"short", day:"numeric", year:d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }
  function parse(res) {
    return res.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!res.ok) {
        var msg = data && (data.error || data.message || data.msg);
        throw Object.assign(new Error(msg || ("Request failed (" + res.status + ")")), { status:res.status, data:data });
      }
      return data;
    });
  }
  function api(path, init) {
    return window.MCC.api(path, init).then(parse);
  }
  function profile() { return state.boot && state.boot.profile || {}; }
  function identity() { return state.boot && state.boot.identity || {}; }

  function setAvatar(img, fallback, url, name) {
    var safe = safeHttpUrl(url);
    if (img) {
      if (safe) {
        img.src = safe;
        img.hidden = false;
        img.onerror = function () { img.hidden = true; };
      } else img.hidden = true;
    }
    if (fallback) fallback.textContent = initials(name);
  }

  function paintSelf() {
    var p = profile(), id = identity(), name = p.display_name || (state.user && (state.user.user_metadata && (state.user.user_metadata.name || state.user.user_metadata.full_name))) || state.user && state.user.email || "M";
    $("mnMe").hidden = false;
    setAvatar($("mnAvatar"), $("mnAvatarFallback"), p.avatar_url, name);
    $("mnComposerAvatar").textContent = initials(name);
    var avatar = safeHttpUrl(p.avatar_url);
    if (avatar) {
      $("mnComposerAvatar").style.backgroundImage = "url(" + JSON.stringify(avatar) + ")";
      $("mnComposerAvatar").style.backgroundSize = "cover";
      $("mnComposerAvatar").textContent = "";
    } else {
      $("mnComposerAvatar").style.backgroundImage = "";
    }
    $("mnProfileName").textContent = p.display_name || name;
    $("mnProfileHandle").textContent = id.mccluster_id ? "@" + id.mccluster_id : "";
    $("mnProfileHeadline").textContent = p.headline || "";
    $("mnProfileBio").textContent = p.bio || "";
    var banner = safeHttpUrl(p.banner_url);
    $("mnProfileBanner").style.backgroundImage = banner ? "url(" + JSON.stringify(banner) + ")" : "";
    $("mnProfileAvatar").textContent = initials(name);
    $("mnProfileAvatar").style.backgroundImage = avatar ? "url(" + JSON.stringify(avatar) + ")" : "";
    if (avatar) $("mnProfileAvatar").textContent = "";
    var site = $("mnProfileWebsite"), website = safeHttpUrl(p.website_url);
    if (website) {
      site.href = website;
      site.textContent = website.replace(/^https?:\/\//, "");
      site.hidden = false;
    } else site.hidden = true;
  }

  function fillProfileForm(editing) {
    var p = profile(), id = identity();
    $("mnHandle").value = id.mccluster_id || "";
    $("mnDisplay").value = p.display_name || (state.user && state.user.user_metadata && (state.user.user_metadata.name || state.user.user_metadata.full_name)) || "";
    $("mnHeadline").value = p.headline || "";
    $("mnBio").value = p.bio || "";
    $("mnAvatarUrl").value = p.avatar_url || "";
    $("mnWebsite").value = p.website_url || "";
    $("mnNewPassword").value = "";
    $("mnNewPassword2").value = "";
    setStatus($("mnPasswordChangeStatus"), "");
    $("mnProfileSecurity").hidden = !editing;
    $("mnProfileTitle").textContent = editing ? "Edit your profile." : "Finish your profile.";
    $("mnProfileBack").hidden = !editing;
  }

  function showGate(which) {
    $("mnSignedOut").hidden = which !== "signedout";
    $("mnProfileGate").hidden = which !== "profile";
    $("mnApp").hidden = which !== "app";
  }

  function providerLabel(key) {
    return { google:"Continue with Google", apple:"Continue with Apple", facebook:"Continue with Facebook", x:"Continue with X" }[key] || ("Continue with " + key);
  }
  function mountProviders() {
    if (!window.MCC || !MCC.providers) return;
    MCC.providers().then(function (live) {
      var host = $("mnProviderButtons"), any = false;
      host.innerHTML = "";
      ["google","apple","facebook","x"].forEach(function (key) {
        if (!live[key]) return;
        any = true;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "mn__provider";
        b.textContent = providerLabel(key);
        b.onclick = function () {
          b.disabled = true;
          MCC.signInWithProvider(key, location.origin + "/auth/?next=/mnet.html").catch(function (e) {
            b.disabled = false;
            setStatus($("mnAuthStatus"), e.message, "error");
          });
        };
        host.appendChild(b);
      });
      $("mnProviders").hidden = !any;
    }).catch(function () {});
  }

  function bootstrap() {
    return api("/v1/mnet/bootstrap?app_key=" + encodeURIComponent(APP)).then(function (boot) {
      state.boot = boot;
      if (boot.next_step === "profile") {
        fillProfileForm(false);
        showGate("profile");
        return;
      }
      showGate("app");
      paintSelf();
      return loadFeed(true).then(loadNotificationsSilently);
    });
  }

  /* Authentication and Mnet availability are different states. A network/API
     failure must never throw a signed-in member back at the login form. */
  function showSignedInLoadError(error) {
    showGate("app");
    var host = $("mnFeed");
    host.innerHTML = '<div class="mn__empty">You are signed in. Mnet could not load the feed right now.</div>';
    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "mn__more";
    retry.textContent = "Retry Mnet";
    retry.onclick = function () {
      retry.disabled = true;
      setStatus($("mnFeedStatus"), "Loading Mnet…");
      bootstrap().catch(function (e) {
        retry.disabled = false;
        showSignedInLoadError(e);
      });
    };
    host.appendChild(retry);
    setStatus($("mnFeedStatus"), "Your M Account is still signed in.", "error");
    try { console.warn("[mnet] signed-in bootstrap failed", error); } catch (e) {}
  }

  /* THE PROFILE PICTURE.
     ------------------------------------------------------------------
     Post attachments already have an upload pipeline, and an avatar
     deliberately does not use it. That one stores into the PRIVATE
     mnet-media bucket and hands back a signed view URL, which expires —
     fine for a picture inside a post the reader is looking at now, useless
     for network_profiles.avatar_url, which is a plain address painted as a
     background-image on every row this person appears in, forever. So the
     avatar goes to mnet-avatars, which is public read and owner-write, and
     the address it returns keeps working.

     The first path segment is the uploader's own auth id because the
     storage policy checks exactly that: `(storage.foldername(name))[1] =
     auth.uid()::text`. Getting this wrong is a 403, not a silent
     mis-file. */
  var AVATAR_BUCKET = "mnet-avatars";
  var AVATAR_MAX = 5 * 1024 * 1024;

  function uploadAvatar(file) {
    var token = sessionToken();
    var uid = state.user && state.user.id;
    if (!token || !uid) return Promise.reject(new Error("Sign in before uploading a photo."));
    if (file.size > AVATAR_MAX) return Promise.reject(new Error("That image is over 5 MB. Try a smaller one."));
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type || "")) {
      return Promise.reject(new Error("Use a PNG, JPEG, WebP or GIF."));
    }
    /* A fresh name every time: same-name overwrites are what make a new
       photo show the old one until the cache gives up. */
    var ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    var path = uid + "/avatar-" + Date.now() + "." + ext;
    setStatus($("mnAvatarStatus"), "Uploading…");
    return fetch(SB_URL + "/storage/v1/object/" + AVATAR_BUCKET + "/" + path, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        authorization: "Bearer " + token,
        "content-type": file.type,
        "x-upsert": "true"
      },
      body: file
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(t || "Upload failed."); });
      var url = SB_URL + "/storage/v1/object/public/" + AVATAR_BUCKET + "/" + path;
      $("mnAvatarUrl").value = url;
      var prev = $("mnAvatarPreview");
      if (prev) { prev.src = url; prev.hidden = false; }
      setStatus($("mnAvatarStatus"), "Photo ready. Save the profile to keep it.", "ok");
      return url;
    }).catch(function (e) {
      setStatus($("mnAvatarStatus"), e.message || "Upload failed.", "error");
      throw e;
    });
  }

  function wireAvatarPicker() {
    var pick = $("mnAvatarPick"), input = $("mnAvatarFile");
    if (!pick || !input) return;
    pick.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      uploadAvatar(file).catch(function () {});
      input.value = "";
    });
  }

  function saveProfile(event) {
    event.preventDefault();
    var button = $("mnProfileSave");
    button.disabled = true;
    setStatus($("mnProfileStatus"), "Saving…");
    api("/v1/mnet/profile?app_key=" + encodeURIComponent(APP), {
      method: "PATCH",
      body: {
        mccluster_id: $("mnHandle").value.trim(),
        display_name: $("mnDisplay").value.trim(),
        headline: $("mnHeadline").value.trim(),
        bio: $("mnBio").value.trim(),
        avatar_url: $("mnAvatarUrl").value.trim(),
        website_url: $("mnWebsite").value.trim()
      }
    }).then(function (boot) {
      state.boot = boot;
      showGate("app");
      paintSelf();
      setView("profile");
      return loadFeed(true);
    }).catch(function (e) {
      var m = e.message || "Could not save your profile.";
      if (/mccluster_id_taken/.test(m)) m = "That McCluster ID is already taken.";
      if (/invalid_mccluster_id/.test(m)) m = "Use 3–32 letters, numbers, dots, underscores or hyphens.";
      setStatus($("mnProfileStatus"), m, "error");
    }).finally(function () { button.disabled = false; });
  }

  function authorHtml(actor) {
    actor = actor || {};
    var name = actor.display_name || actor.mccluster_id || "Mnet member";
    var handle = actor.mccluster_id ? "@" + actor.mccluster_id : "McCluster";
    var avatar = safeHttpUrl(actor.avatar_url);
    var av = avatar
      ? '<img src="' + esc(avatar) + '" alt="">'
      : esc(initials(name));
    var inner = '<div class="mn__author-avatar">' + av + '</div>' +
      '<div class="mn__author-meta"><span class="mn__author-name">' + esc(name) + '</span>' +
      '<div class="mn__author-sub">' + esc(handle) + '</div></div>';
    return actor.mccluster_id
      ? '<button class="mn__author-link" type="button" data-person="' + esc(actor.mccluster_id) + '">' + inner + '</button>'
      : inner;
  }

  function postMediaHtml(post) {
    var media = Array.isArray(post.media) ? post.media : [];
    if (!media.length) return "";
    return '<div class="mn__post-media' + (media.length > 1 ? ' is-grid' : '') + '">' +
      media.map(function (m) {
        var id = m && (m.asset_id || m.id);
        if (!id) return "";
        return '<div class="mn__post-media-item" data-mnet-media="' + esc(id) + '" data-media-type="' + esc(m.type || m.media_type || "file") + '">' +
          '<div class="mn__post-media-loading">Loading media…</div></div>';
      }).join("") + '</div>';
  }

  /* A SHARED TRACK IS PLAYABLE WHERE IT IS READ. The card links straight
     into the album room at that exact track (album.html?album=&t=), which is
     the deep link the listening room already uses, so a post is a door into
     the catalogue rather than a mention of it. */
  function trackCardHtml(item, post) {
    var t = (item && item.payload && item.payload.track) ||
            (post && post.metadata && post.metadata.track) || null;
    if (!t || !t.title) return "";
    var href = "album.html?album=" + encodeURIComponent(t.albumSlug || "here") +
               "&t=" + encodeURIComponent(t.title);
    return '<a class="mn__track" href="' + esc(href) + '">' +
      (t.art ? '<img class="mn__track-art" src="' + esc(t.art) + '" alt="" loading="lazy">' : '<span class="mn__track-art"></span>') +
      '<span class="mn__track-meta"><b>' + esc(t.title) + '</b>' +
        (t.album ? '<small>' + esc(t.album) + '</small>' : '') + '</span>' +
      '<span class="mn__track-play" aria-hidden="true">&#9654;</span>' +
      '<span class="sr-only">Play ' + esc(t.title) + '</span></a>';
  }

  function postCard(item, opts) {
    opts = opts || {};
    var post = item.post || item, actor = item.actor || post.actor || {};
    var likes = Number(post.reaction_count || 0), replies = Number(post.reply_count || 0);
    var liked = !!post.liked_by_me, saved = !!post.bookmarked_by_me;
    var id = post.id || item.post_id, mine = !!(identity().m_uid && post.author_m_uid === identity().m_uid);
    var pinned = !!(item && item.payload && item.payload.pinned);
    return '<article class="mn__post-card' + (pinned ? ' is-pinned' : '') + '" data-post-id="' + esc(id || "") + '">' +
      (pinned ? '<span class="mn__pin">Pinned</span>' : '') +
      '<div class="mn__post-head">' + authorHtml(actor) +
        '<span class="mn__author-sub">' + esc(timeAgo(post.created_at || item.occurred_at)) + '</span></div>' +
      (post.body ? '<p class="mn__post-body">' + esc(post.body) + '</p>' : '') +
      trackCardHtml(item, post) +
      postMediaHtml(post) +
      (opts.actions === false ? '' :
        '<div class="mn__post-actions">' +
          '<button class="mn__action' + (liked ? ' is-active' : '') + '" type="button" data-action="like" data-post="' + esc(id) + '">' +
            (liked ? "Liked" : "Like") + (likes ? " · " + likes : "") + '</button>' +
          '<button class="mn__action" type="button" data-action="comments" data-post="' + esc(id) + '">Comment' + (replies ? " · " + replies : "") + '</button>' +
          '<button class="mn__action' + (saved ? ' is-active' : '') + '" type="button" data-action="save" data-post="' + esc(id) + '">' + (saved ? "Saved" : "Save") + '</button>' +
          (mine ? '<button class="mn__action mn__danger" type="button" data-action="delete" data-post="' + esc(id) + '">Delete</button>' : '') +
        '</div>') +
    '</article>';
  }

  function bindFeedActions(root) {
    root.querySelectorAll("[data-action=like]").forEach(function (b) {
      b.onclick = function () { toggleLike(b.dataset.post, b); };
    });
    root.querySelectorAll("[data-action=comments]").forEach(function (b) {
      b.onclick = function () { openThread(b.dataset.post); };
    });
    root.querySelectorAll("[data-action=save]").forEach(function (b) {
      b.onclick = function () { toggleBookmark(b.dataset.post, b); };
    });
    root.querySelectorAll("[data-action=delete]").forEach(function (b) {
      b.onclick = function () { deletePost(b.dataset.post, b); };
    });
    root.querySelectorAll("[data-person]").forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openPerson(b.dataset.person); };
    });
    resolvePostMedia(root);
  }

  function renderFeed(append) {
    var host = $("mnFeed");
    if (!append) host.innerHTML = "";
    if (!state.feed.length) {
      host.innerHTML = '<div class="mn__empty">Mnet is live. There are no posts yet — yours can be the first.</div>';
      return;
    }
    host.innerHTML = state.feed.map(function (item) {
      if (item.item_type === "activity") {
        var p = item.payload || {};
        return '<article class="mn__post-card"><div class="mn__post-head">' + authorHtml(item.actor) + '<span class="mn__author-sub">' + esc(timeAgo(item.occurred_at)) + '</span></div><p class="mn__post-body">' + esc(p.summary || p.text || "Activity on McCluster") + '</p></article>';
      }
      return postCard(item);
    }).join("");
    bindFeedActions(host);
  }

  function loadFeed(reset) {
    if (state.loadingFeed) return Promise.resolve();
    state.loadingFeed = true;
    if (reset) {
      state.nextBefore = null;
      state.feed = [];
      setStatus($("mnFeedStatus"), "Loading Mnet…");
    }
    var path = "/v1/mnet/feed?app_key=" + encodeURIComponent(APP) + "&limit=20";
    if (!reset && state.nextBefore) path += "&before=" + encodeURIComponent(state.nextBefore);
    return api(path).then(function (data) {
      var incoming = data.items || [];
      state.feed = reset ? incoming : state.feed.concat(incoming);
      state.nextBefore = data.next_before || null;
      renderFeed(false);
      $("mnMore").hidden = !state.nextBefore;
      setStatus($("mnFeedStatus"), "");
    }).catch(function (e) {
      setStatus($("mnFeedStatus"), e.message || "Could not load Mnet.", "error");
    }).finally(function () { state.loadingFeed = false; });
  }

  /* THE CATALOGUE, LOADED ONCE. data/albums.json is the same file the
     listening room and the corner player read, so a track shared here is by
     construction a track that exists and plays. */
  function loadCatalogue() {
    if (state.catalogue) return Promise.resolve(state.catalogue);
    return fetch("data/albums.json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var out = [];
        ((d && d.albums) || []).forEach(function (a) {
          (a.tracks || []).forEach(function (t) {
            out.push({ title: t.title, album: a.name, albumSlug: a.slug, art: a.art });
          });
        });
        state.catalogue = out;
        return out;
      }).catch(function () { state.catalogue = []; return []; });
  }

  function wireTrackPicker() {
    var sel = $("mnTrackPick");
    if (!sel) return;
    loadCatalogue().then(function (tracks) {
      if (!tracks.length) { sel.hidden = true; return; }
      tracks.forEach(function (t, i) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = t.title + " — " + t.album;
        sel.appendChild(o);
      });
    });
  }

  function pickedTrack() {
    var sel = $("mnTrackPick");
    if (!sel || !sel.value || !state.catalogue) return null;
    return state.catalogue[Number(sel.value)] || null;
  }

  function createPost() {
    var body = $("mnPostBody").value.trim();
    var track = pickedTrack();
    if (!body && !state.mediaAssets.length && !track) { setStatus($("mnPostStatus"), "Write something, attach media, or pick a track first.", "error"); return; }
    var button = $("mnPost");
    button.disabled = true;
    setStatus($("mnPostStatus"), "Posting…");
    api("/v1/mnet/posts?app_key=" + encodeURIComponent(APP), {
      method:"POST",
      body:{ body:body, visibility:$("mnVisibility").value, track:track,
             media_asset_ids:state.mediaAssets.map(function (x) { return x.id; }) }
    }).then(function () {
      $("mnPostBody").value = "";
      if ($("mnTrackPick")) $("mnTrackPick").value = "";
      clearMediaQueue();
      setStatus($("mnPostStatus"), "Posted.", "ok");
      return loadFeed(true);
    }).catch(function (e) {
      setStatus($("mnPostStatus"), e.message || "Could not post.", "error");
    }).finally(function () { button.disabled = false; });
  }

  function findPost(postId) {
    for (var i=0; i<state.feed.length; i++) {
      var item = state.feed[i];
      if ((item.post && item.post.id) === postId || item.post_id === postId) return item;
    }
    return null;
  }

  function toggleLike(postId, button) {
    var item = findPost(postId), post = item && item.post;
    var liked = !!(post && post.liked_by_me);
    button.disabled = true;
    api("/v1/mnet/posts/" + encodeURIComponent(postId) + "/reactions", {
      method: liked ? "DELETE" : "POST",
      body: liked ? undefined : { reaction:"like" }
    }).then(function () {
      if (post) {
        post.liked_by_me = !liked;
        post.reaction_count = Math.max(0, Number(post.reaction_count || 0) + (liked ? -1 : 1));
      }
      renderFeed(false);
    }).catch(function (e) {
      setStatus($("mnFeedStatus"), e.message || "Could not update reaction.", "error");
    }).finally(function () { button.disabled = false; });
  }

  function openThread(postId) {
    var item = findPost(postId);
    state.threadPost = item;
    $("mnThreadRoot").innerHTML = item ? postCard(item, { actions:false }) : "";
    $("mnReplies").innerHTML = '<div class="mn__empty">Loading comments…</div>';
    $("mnReplyBody").value = "";
    setStatus($("mnReplyStatus"), "");
    $("mnThread").showModal();
    loadReplies(postId);
  }

  function loadReplies(postId) {
    return api("/v1/mnet/posts/" + encodeURIComponent(postId) + "/replies").then(function (data) {
      var rows = data.replies || [];
      $("mnReplies").innerHTML = rows.length ? rows.map(function (r) { return postCard(r, { actions:false }); }).join("") : '<div class="mn__empty">No comments yet.</div>';
    }).catch(function (e) {
      $("mnReplies").innerHTML = "";
      setStatus($("mnReplyStatus"), e.message || "Could not load comments.", "error");
    });
  }

  function createReply(event) {
    event.preventDefault();
    var item = state.threadPost, post = item && item.post;
    if (!post) return;
    var body = $("mnReplyBody").value.trim();
    if (!body) return;
    var button = $("mnReplyForm").querySelector("button");
    button.disabled = true;
    setStatus($("mnReplyStatus"), "Replying…");
    api("/v1/mnet/posts?app_key=" + encodeURIComponent(APP), {
      method:"POST",
      body:{ body:body, reply_to_id:post.id }
    }).then(function () {
      $("mnReplyBody").value = "";
      post.reply_count = Number(post.reply_count || 0) + 1;
      renderFeed(false);
      setStatus($("mnReplyStatus"), "Replied.", "ok");
      return loadReplies(post.id);
    }).catch(function (e) {
      setStatus($("mnReplyStatus"), e.message || "Could not reply.", "error");
    }).finally(function () { button.disabled = false; });
  }

  function renderNotifications(rows) {
    var host = $("mnNotifications");
    if (!rows.length) {
      host.innerHTML = '<div class="mn__empty">Nothing here yet.</div>';
      return;
    }
    host.innerHTML = rows.map(function (n) {
      return '<article class="mn__notification"><strong>' + esc(n.body || n.type || "Mnet notification") + '</strong><p>' + esc(timeAgo(n.created_at)) + '</p></article>';
    }).join("");
  }

  function loadNotificationsSilently() {
    return api("/v1/mnet/notifications").then(function (data) {
      var rows = data.notifications || [];
      var unread = rows.filter(function (n) { return !n.read_at; }).length;
      $("mnNotifBadge").hidden = !unread;
      $("mnNotifBadge").textContent = unread > 99 ? "99+" : unread;
      renderNotifications(rows);
      setStatus($("mnNotificationStatus"), "");
      return rows;
    }).catch(function () { return []; });
  }

  function markNotificationsRead() {
    return api("/v1/mnet/notifications/read", { method:"POST", body:{} }).then(function () {
      $("mnNotifBadge").hidden = true;
    }).catch(function () {});
  }

  function sessionToken() {
    try { var s = MCC.session && MCC.session(); return s && s.access_token || ""; } catch (e) { return ""; }
  }
  function storagePath(path) {
    return String(path || "").split("/").map(encodeURIComponent).join("/");
  }
  function clearMediaQueue() {
    state.mediaAssets.forEach(function (x) { if (x.preview) try { URL.revokeObjectURL(x.preview); } catch (e) {} });
    state.mediaAssets = [];
    if ($("mnMediaQueue")) { $("mnMediaQueue").innerHTML = ""; $("mnMediaQueue").hidden = true; }
    if ($("mnMediaInput")) $("mnMediaInput").value = "";
    setStatus($("mnMediaStatus"), "");
  }
  function renderMediaQueue() {
    var host = $("mnMediaQueue");
    if (!host) return;
    host.hidden = !state.mediaAssets.length;
    host.innerHTML = state.mediaAssets.map(function (x, i) {
      var visual = x.media_type === "image" && x.preview ? '<img src="' + esc(x.preview) + '" alt="">' :
        x.media_type === "video" && x.preview ? '<video src="' + esc(x.preview) + '" muted playsinline></video>' :
        '<span>' + esc(x.name || x.media_type) + '</span>';
      return '<div class="mn__media-chip">' + visual + '<button type="button" data-remove-media="' + i + '" aria-label="Remove attachment">×</button></div>';
    }).join("");
    host.querySelectorAll("[data-remove-media]").forEach(function (b) {
      b.onclick = function () {
        var i = Number(b.dataset.removeMedia), item = state.mediaAssets[i];
        if (item && item.preview) try { URL.revokeObjectURL(item.preview); } catch (e) {}
        state.mediaAssets.splice(i,1); renderMediaQueue();
      };
    });
  }
  function uploadMediaFiles(files) {
    files = Array.prototype.slice.call(files || []).slice(0, Math.max(0, 4 - state.mediaAssets.length));
    if (!files.length) return Promise.resolve();
    var token = sessionToken();
    if (!token) return Promise.reject(new Error("Sign in before uploading media."));
    setStatus($("mnMediaStatus"), "Uploading " + files.length + (files.length === 1 ? " file…" : " files…"));
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        return api("/v1/mnet/media/upload-url", { method:"POST", body:{ file_name:file.name, mime_type:file.type || "application/octet-stream", byte_size:file.size } })
          .then(function (grant) {
            var path = grant && grant.upload && grant.upload.path;
            var asset = grant && grant.asset;
            if (!path || !asset) throw new Error("The upload slot was not created.");
            /* USE THE SIGNED SLOT WE WERE JUST HANDED.
               supabase/functions/mnet-media mints one with
               createSignedUploadUrl and returns grant.upload.token. This
               code was throwing that away and POSTing to the plain object
               endpoint on the user's own JWT instead -- which depends on
               storage RLS lining up at upload time, on a PRIVATE bucket,
               with x-upsert:false against a path the signing step already
               reserved. The signed endpoint is what the token is for, it
               does not care about RLS, and it is the documented path. */
            var uploadToken = grant.upload && grant.upload.token;
            var url = uploadToken
              ? SB_URL + "/storage/v1/object/upload/sign/mnet-media/" + storagePath(path) +
                  "?token=" + encodeURIComponent(uploadToken)
              : SB_URL + "/storage/v1/object/mnet-media/" + storagePath(path);
            return fetch(url, {
              method: uploadToken ? "PUT" : "POST",
              headers:{ apikey:SB_KEY, authorization:"Bearer " + token, "content-type":file.type || "application/octet-stream", "x-upsert":"false" },
              body:file
            }).then(function (res) {
              if (!res.ok) return res.text().then(function (t) {
                /* Say which step failed. "Media upload failed." with no
                   detail is why this went unnoticed for so long. */
                throw new Error("Upload rejected (" + res.status + "): " + (t || "no detail"));
              });
              return api("/v1/mnet/media/finalize", { method:"POST", body:{ asset_id:asset.id } });
            }).then(function (fin) {
              var ready = fin && fin.asset || asset;
              state.mediaAssets.push({ id:ready.id, media_type:ready.media_type || asset.media_type, name:file.name, preview:URL.createObjectURL(file) });
              renderMediaQueue();
            });
          });
      });
    });
    return chain.then(function () { setStatus($("mnMediaStatus"), state.mediaAssets.length + " attachment" + (state.mediaAssets.length === 1 ? "" : "s") + " ready.", "ok"); })
      .catch(function (e) { setStatus($("mnMediaStatus"), e.message || "Upload failed.", "error"); throw e; });
  }
  function resolvePostMedia(root) {
    if (!root) return;
    root.querySelectorAll("[data-mnet-media]").forEach(function (node) {
      var id = node.dataset.mnetMedia;
      if (!id || node.dataset.loaded === "1") return;
      node.dataset.loaded = "1";
      var cached = state.mediaCache[id];
      var load = cached ? Promise.resolve(cached) : api("/v1/mnet/media/" + encodeURIComponent(id) + "/url").then(function (x) { state.mediaCache[id] = x; return x; });
      load.then(function (data) {
        var type = data.media_type || node.dataset.mediaType || "file", url = safeHttpUrl(data.url);
        if (!url) throw new Error("Media URL unavailable");
        if (type === "image") node.innerHTML = '<img src="' + esc(url) + '" alt="' + esc(data.alt_text || "") + '" loading="lazy">';
        else if (type === "video") node.innerHTML = '<video src="' + esc(url) + '" controls playsinline preload="metadata"></video>';
        else if (type === "audio") node.innerHTML = '<audio src="' + esc(url) + '" controls preload="metadata"></audio>';
        else node.innerHTML = '<a class="mn__profile-link" href="' + esc(url) + '" target="_blank" rel="noopener">Open attachment</a>';
      }).catch(function () { node.innerHTML = '<div class="mn__post-media-loading">Media unavailable.</div>'; });
    });
  }
  function toggleBookmark(postId, button) {
    var item=findPost(postId), post=item&&item.post, saved=!!(post&&post.bookmarked_by_me);
    button.disabled=true;
    api("/v1/mnet/posts/" + encodeURIComponent(postId) + "/bookmark", {method:saved?"DELETE":"POST",body:{}})
      .then(function () { if(post)post.bookmarked_by_me=!saved; renderFeed(false); })
      .catch(function (e) { setStatus($("mnFeedStatus"),e.message||"Could not save that post.","error"); })
      .finally(function () { button.disabled=false; });
  }
  function deletePost(postId, button) {
    if (!confirm("Delete this post?")) return;
    button.disabled=true;
    api("/v1/mnet/posts/" + encodeURIComponent(postId), {method:"DELETE",body:{}})
      .then(function () { state.feed=state.feed.filter(function (x) { return (x.post&&x.post.id)!==postId&&x.post_id!==postId; }); renderFeed(false); })
      .catch(function (e) { setStatus($("mnFeedStatus"),e.message||"Could not delete that post.","error"); })
      .finally(function () { button.disabled=false; });
  }

  function personRow(p) {
    var name=p.display_name||p.mccluster_id||"Mnet member", handle=p.mccluster_id?"@"+p.mccluster_id:"";
    var av=safeHttpUrl(p.avatar_url),avatar=av?'<img src="'+esc(av)+'" alt="">':esc(initials(name));
    return '<article class="mn__person-row"><button type="button" data-person="'+esc(p.mccluster_id||"")+'" class="mn__author-avatar">'+avatar+'</button>' +
      '<button type="button" data-person="'+esc(p.mccluster_id||"")+'" class="mn__person-copy"><span class="mn__person-name">'+esc(name)+'</span><span class="mn__person-sub">'+esc(handle+(p.headline?" · "+p.headline:""))+'</span></button>' +
      '<button type="button" class="mn__follow'+(p.following?' is-active':'')+'" data-follow-person="'+esc(p.mccluster_id||"")+'" data-following="'+(p.following?"1":"0")+'">'+(p.following?"Following":"Follow")+'</button></article>';
  }
  function bindPeople(root) {
    root.querySelectorAll("[data-person]").forEach(function (b) { b.onclick=function () { if(b.dataset.person)openPerson(b.dataset.person); }; });
    root.querySelectorAll("[data-follow-person]").forEach(function (b) {
      b.onclick=function () {
        var following=b.dataset.following==="1"; b.disabled=true;
        api("/v1/mnet/people/"+encodeURIComponent(b.dataset.followPerson)+"/follow",{method:following?"DELETE":"POST",body:{}})
          .then(function () { b.dataset.following=following?"0":"1"; b.textContent=following?"Follow":"Following"; b.classList.toggle("is-active",!following); })
          .catch(function (e) { setStatus($("mnDiscoverStatus"),e.message||"Could not update follow.","error"); })
          .finally(function () { b.disabled=false; });
      };
    });
  }
  function blockedPersonRow(item) {
    var p=item.profile||{}, handle=p.mccluster_id||"", name=p.display_name||handle||"Mnet member";
    var av=safeHttpUrl(p.avatar_url),avatar=av?'<img src="'+esc(av)+'" alt="">':esc(initials(name));
    return '<article class="mn__person-row"><div class="mn__author-avatar">'+avatar+'</div>' +
      '<div class="mn__person-copy"><span class="mn__person-name">'+esc(name)+'</span><span class="mn__person-sub">'+esc(handle?"@"+handle:"Blocked member")+'</span></div>' +
      '<button type="button" class="mn__follow is-active" data-unblock-person="'+esc(handle)+'">Unblock</button></article>';
  }
  function loadBlocked() {
    setStatus($("mnDiscoverStatus"),"Loading blocked people…");
    return api("/v1/mnet/blocks").then(function (data) {
      var rows=data.blocks||[];
      $("mnDiscoverResults").innerHTML=rows.length?rows.map(blockedPersonRow).join(""):'<div class="mn__empty">You have not blocked anyone.</div>';
      $("mnDiscoverResults").querySelectorAll("[data-unblock-person]").forEach(function (b) {
        b.onclick=function () {
          if(!b.dataset.unblockPerson)return;
          b.disabled=true;
          api("/v1/mnet/people/"+encodeURIComponent(b.dataset.unblockPerson)+"/block",{method:"DELETE",body:{}})
            .then(loadBlocked)
            .catch(function (e) { setStatus($("mnDiscoverStatus"),e.message||"Could not unblock that person.","error"); b.disabled=false; });
        };
      });
      setStatus($("mnDiscoverStatus"),rows.length?rows.length+" blocked":"");
    }).catch(function (e) { $("mnDiscoverResults").innerHTML=""; setStatus($("mnDiscoverStatus"),e.message||"Could not load blocked people.","error"); });
  }

  function loadDiscover() {
    var q=$("mnDiscoverQuery").value.trim(); setStatus($("mnDiscoverStatus"),"Searching…");
    return api("/v1/mnet/discover?q="+encodeURIComponent(q)+"&limit=50").then(function (data) {
      var rows=data.people||[]; $("mnDiscoverResults").innerHTML=rows.length?rows.map(personRow).join(""):'<div class="mn__empty">No people found.</div>';
      bindPeople($("mnDiscoverResults")); setStatus($("mnDiscoverStatus"),rows.length?rows.length+" people":"");
    }).catch(function (e) { $("mnDiscoverResults").innerHTML=""; setStatus($("mnDiscoverStatus"),e.message||"Could not search Mnet.","error"); });
  }
  function openPerson(handle) {
    if(!handle)return;
    var dlg=$("mnPersonDialog"); $("mnPersonBody").innerHTML='<div class="mn__empty">Loading profile…</div>'; dlg.showModal();
    Promise.all([
      api("/v1/mnet/people/"+encodeURIComponent(handle)),
      api("/v1/mnet/people/"+encodeURIComponent(handle)+"/posts?limit=20")
    ]).then(function (all) {
      var data=all[0], posts=all[1].posts||[], p=data.profile||{}, id=data.identity||{}, name=p.display_name||id.display_name||id.mccluster_id||"Mnet member";
      var avatar=safeHttpUrl(p.avatar_url),banner=safeHttpUrl(p.banner_url),avatarHtml=avatar?'style="background-image:url('+JSON.stringify(avatar)+')"':"";
      $("mnPersonBody").innerHTML='<div class="mn__person-sheet"><div class="mn__person-hero"'+(banner?' style="background-image:url('+JSON.stringify(banner)+')"':'')+'></div>' +
        '<div class="mn__person-main"><div class="mn__profile-avatar" '+avatarHtml+'>'+(avatar?"":esc(initials(name)))+'</div><h2>'+esc(name)+'</h2><p class="mn__handle">@'+esc(id.mccluster_id||"")+'</p>' +
        (p.headline?'<p class="mn__profile-headline">'+esc(p.headline)+'</p>':'')+(p.bio?'<p class="mn__profile-bio">'+esc(p.bio)+'</p>':'')+
        '<div class="mn__profile-counts"><span><strong>'+Number(data.counts&&data.counts.followers||0)+'</strong> followers</span><span><strong>'+Number(data.counts&&data.counts.following||0)+'</strong> following</span><span><strong>'+Number(data.counts&&data.counts.posts||0)+'</strong> posts</span></div>'+
        '<div class="mn__person-actions"><button class="is-primary" type="button" id="mnPersonFollow">'+(data.following?"Following":"Follow")+'</button><button type="button" id="mnPersonMessage">Message</button><button type="button" id="mnPersonMute">'+(data.muted?"Unmute":"Mute")+'</button><button type="button" class="mn__danger" id="mnPersonBlock">Block</button><button type="button" id="mnPersonReport">Report</button></div>'+
        '<div class="mn__person-posts" id="mnPersonPosts">'+(posts.length?posts.map(function(x){return postCard(x);}).join(""):'<div class="mn__empty">No posts yet.</div>')+'</div></div></div>';
      bindFeedActions($("mnPersonPosts"));
      $("mnPersonFollow").onclick=function(){var was=data.following;api("/v1/mnet/people/"+encodeURIComponent(handle)+"/follow",{method:was?"DELETE":"POST",body:{}}).then(function(){openPerson(handle);});};
      $("mnPersonMessage").onclick=function(){startConversation({mccluster_id:handle});};
      $("mnPersonMute").onclick=function(){api("/v1/mnet/people/"+encodeURIComponent(handle)+"/mute",{method:data.muted?"DELETE":"POST",body:{}}).then(function(){openPerson(handle);});};
      $("mnPersonBlock").onclick=function(){if(confirm("Block @"+handle+"? You will stop seeing each other on Mnet."))api("/v1/mnet/people/"+encodeURIComponent(handle)+"/block",{method:"POST",body:{}}).then(function(){dlg.close();loadFeed(true);});};
      $("mnPersonReport").onclick=function(){var details=prompt("What should the Mnet moderation queue know?","");if(details===null)return;api("/v1/mnet/reports",{method:"POST",body:{target_type:"profile",target_id:data.profile&&data.profile.m_uid||id.mccluster_id,reason:"other",details:details}}).then(function(){alert("Report submitted.");});};
    }).catch(function (e) { $("mnPersonBody").innerHTML='<div class="mn__empty">'+esc(e.message||"Could not load profile.")+'</div>'; });
  }

  function loadConversations() {
    setStatus($("mnMessageStatus"),"Loading…");
    return api("/v1/mnet/conversations").then(function (data) {
      state.conversations=data.conversations||[];
      var requests=state.conversations.filter(function (x) { return x.my&&x.my.member_state==="requested"; }).length;
      $("mnMessageBadge").hidden=!requests; $("mnMessageBadge").textContent=requests||"";
      $("mnConversations").innerHTML=state.conversations.length?state.conversations.map(function (x) {
        var other=(x.members||[]).find(function(m){return m.m_uid!==identity().m_uid;})||{},p=other.profile||{},name=p.display_name||p.mccluster_id||"Conversation",last=x.last_message;
        return '<article class="mn__conversation-row"><div class="mn__author-avatar">'+esc(initials(name))+'</div><button type="button" class="mn__conversation-copy" data-conversation="'+esc(x.conversation.id)+'"><span class="mn__conversation-name">'+esc(name)+'</span><span class="mn__conversation-sub">'+esc(x.my&&x.my.member_state==="requested"?"Message request":last&&last.body||"Start the conversation")+'</span></button><span class="mn__author-sub">'+esc(last?timeAgo(last.created_at):"")+'</span></article>';
      }).join(""):'<div class="mn__empty">No conversations yet. Open a person from Discover and tap Message.</div>';
      $("mnConversations").querySelectorAll("[data-conversation]").forEach(function(b){b.onclick=function(){openConversation(b.dataset.conversation);};});
      setStatus($("mnMessageStatus"),"");
      return state.conversations;
    }).catch(function (e) { setStatus($("mnMessageStatus"),e.message||"Could not load messages.","error"); return []; });
  }
  function startConversation(target) {
    return api("/v1/mnet/conversations",{method:"POST",body:target||{}}).then(function (x) {
      if($("mnPersonDialog").open)$("mnPersonDialog").close();
      setView("messages"); return loadConversations().then(function(){return openConversation(x.conversation_id);});
    }).catch(function (e) { setStatus($("mnMessageStatus"),e.message||"Could not start a conversation.","error"); });
  }
  function renderMessages(rows) {
    $("mnConversationMessages").innerHTML=rows.length?rows.map(function(m){
      var mine=m.sender_m_uid===identity().m_uid;
      return '<article class="mn__message'+(mine?' is-mine':'')+'"><p>'+esc(m.body||"")+'</p><small>'+esc(mine?"You":m.sender&&m.sender.display_name||m.sender&&m.sender.mccluster_id||"Mnet")+' · '+esc(timeAgo(m.created_at))+'</small></article>';
    }).join(""):'<div class="mn__empty">No messages yet.</div>';
    $("mnConversationMessages").scrollTop=$("mnConversationMessages").scrollHeight;
  }
  function loadConversationMessages(id) {
    return api("/v1/mnet/conversations/"+encodeURIComponent(id)+"/messages?limit=100").then(function(data){renderMessages(data.messages||[]);return data.messages||[];});
  }
  function openConversation(id) {
    state.currentConversation=id;var dlg=$("mnConversationDialog");$("mnConversationMessages").innerHTML='<div class="mn__empty">Loading messages…</div>';dlg.showModal();
    return api("/v1/mnet/conversations/"+encodeURIComponent(id)).then(function(data){
      var other=(data.members||[]).find(function(m){return m.m_uid!==identity().m_uid;})||{},p=other.profile||{};
      $("mnConversationTitle").textContent=p.display_name||p.mccluster_id||"Messages";
      $("mnAcceptConversation").hidden=!(data.my&&data.my.member_state==="requested");
      $("mnMessageForm").hidden=!!(data.my&&data.my.member_state==="requested");
      setStatus($("mnConversationStatus"),data.my&&data.my.member_state==="requested"?"Accept this request to reply.":"");
      return loadConversationMessages(id);
    }).catch(function(e){setStatus($("mnConversationStatus"),e.message||"Could not open messages.","error");});
  }
  function sendMessage(event) {
    event.preventDefault();if(!state.currentConversation)return;var body=$("mnMessageBody").value.trim();if(!body)return;
    var b=$("mnMessageForm").querySelector("button");b.disabled=true;
    api("/v1/mnet/conversations/"+encodeURIComponent(state.currentConversation)+"/messages",{method:"POST",body:{body:body}})
      .then(function(){ $("mnMessageBody").value=""; return loadConversationMessages(state.currentConversation).then(loadConversations); })
      .catch(function(e){setStatus($("mnConversationStatus"),e.message||"Could not send message.","error");})
      .finally(function(){b.disabled=false;});
  }

  function setView(name) {
    state.currentView = name;
    ["feed","discover","groups","messages","notifications","profile"].forEach(function (view) {
      var ids={feed:"mnFeedView",discover:"mnDiscoverView",groups:"mnGroupsView",messages:"mnMessagesView",notifications:"mnNotificationsView",profile:"mnProfileView"};
      var panel=$(ids[view]); if(panel)panel.hidden=view!==name;
      var tab=document.querySelector('[data-mn-view="' + view + '"]');
      if(tab)tab.classList.toggle("is-active",view===name);
    });
    if(name==="discover")loadDiscover();
    if(name==="groups")loadGroups();
    if(name==="messages")loadConversations();
    if(name==="notifications")loadNotificationsSilently().then(markNotificationsRead);
    if(name==="profile")paintSelf();
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function editProfile() {
    fillProfileForm(true);
    showGate("profile");
  }

  function changePassword() {
    var password = $("mnNewPassword").value;
    var confirm = $("mnNewPassword2").value;
    var button = $("mnPasswordChange");
    if (password.length < 8) {
      setStatus($("mnPasswordChangeStatus"), "Use at least 8 characters.", "error");
      return;
    }
    if (password !== confirm) {
      setStatus($("mnPasswordChangeStatus"), "Those passwords do not match.", "error");
      return;
    }
    button.disabled = true;
    button.textContent = "Changing…";
    setStatus($("mnPasswordChangeStatus"), "");
    MCC.updatePassword(password).then(function () {
      $("mnNewPassword").value = "";
      $("mnNewPassword2").value = "";
      setStatus($("mnPasswordChangeStatus"), "Password changed. Use the new password the next time you sign in.", "ok");
    }).catch(function (e) {
      setStatus($("mnPasswordChangeStatus"), e.message || "Could not change your password.", "error");
    }).finally(function () {
      button.disabled = false;
      button.textContent = "Change password";
    });
  }

  function setAuthMode(mode) {
    var create = mode === "create";
    $("mnCreateNameWrap").hidden = !create;
    $("mnConfirmWrap").hidden = !create;
    $("mnSignInTab").classList.toggle("is-active", !create);
    $("mnCreateTab").classList.toggle("is-active", create);
    $("mnSignInTab").setAttribute("aria-selected", create ? "false" : "true");
    $("mnCreateTab").setAttribute("aria-selected", create ? "true" : "false");
    $("mnPassword").setAttribute("autocomplete", create ? "new-password" : "current-password");
    $("mnAuthGo").textContent = create ? "Create account" : "Sign in";
    $("mnPasswordHint").hidden = !create;
    $("mnPasswordHint").textContent = "Use at least 8 characters.";
    $("mnForgot").hidden = create;
    $("mnResend").hidden = true;
    $("mnSignedOut").setAttribute("data-auth-mode", create ? "create" : "signin");
    setStatus($("mnAuthStatus"), "");
  }

  function enterAfterAuth() {
    return MCC.user().then(function (user) {
      state.user = user;
      if (!user) throw new Error("Your session did not open.");
      if (window.MCC_BAR && MCC_BAR.refreshAuth) MCC_BAR.refreshAuth();

      /* An auth row is not yet a complete member profile. OAuth providers can
         create an auth record without walking through the password form, so
         enforce mailing-profile completion here too instead of trusting only
         the signup UI. */
      var completeness = (window.MCC_FAN && window.MCC_ACCOUNT_INTEGRITY)
        ? MCC_FAN.load().then(function (row) {
            return MCC_ACCOUNT_INTEGRITY.completeProfile(row);
          }).catch(function () { return false; })
        : Promise.resolve(false);

      return completeness.then(function (complete) {
        if (!complete) {
          location.href = "account.html?complete=1";
          return null;
        }
        return MCC.autoTouch().catch(function () {}).then(function () {
          if (!state.pollTimer) state.pollTimer = setInterval(function () {
            if (document.visibilityState !== "visible" || !state.user) return;
            loadNotificationsSilently();
            if (state.currentView === "messages") loadConversations();
            if (state.currentConversation && $("mnConversationDialog").open) loadConversationMessages(state.currentConversation);
          }, 15000);
          return bootstrap().catch(function (error) {
            showSignedInLoadError(error);
            return null;
          });
        });
      });
    });
  }

  function submitPasswordAuth() {
    var create = $("mnSignedOut").getAttribute("data-auth-mode") === "create";
    var email = $("mnEmail").value.trim(), password = $("mnPassword").value;
    var button = $("mnAuthGo");
    if (!email || !password) { setStatus($("mnAuthStatus"), "Enter your email and password.", "error"); return; }
    if (create && password.length < 8) { setStatus($("mnAuthStatus"), "Use at least 8 characters.", "error"); return; }
    if (create && password !== $("mnPassword2").value) { setStatus($("mnAuthStatus"), "Those passwords do not match.", "error"); return; }

    button.disabled = true;
    button.textContent = create ? "Creating…" : "Signing in…";
    setStatus($("mnAuthStatus"), "");

    var nameCheck = create && window.MCC_ACCOUNT_INTEGRITY
      ? MCC_ACCOUNT_INTEGRITY.validateName($("mnCreateFirst").value, $("mnCreateLast").value)
      : null;
    if (create && (!nameCheck || !nameCheck.ok)) {
      setStatus($("mnAuthStatus"), (nameCheck && nameCheck.message) || "First and last name are required.", "error");
      button.disabled = false;
      button.textContent = "Create account";
      return;
    }
    var action = create
      ? MCC.signUpWithPassword(email, password, {
          name:nameCheck.full_name, full_name:nameCheck.full_name,
          first_name:nameCheck.first_name, last_name:nameCheck.last_name
        })
      : MCC.signInWithPassword(email, password);

    Promise.resolve(action).then(function (result) {
      if (create && result && result.existing) {
        setAuthMode("signin");
        $("mnEmail").value = email;
        setStatus($("mnAuthStatus"), "An account already exists for that email. Sign in, or use Forgot password.", "error");
        return null;
      }
      if (create && result && result.confirm) {
        state.pendingVerificationEmail = email;
        setStatus($("mnAuthStatus"), "Check your email to verify your address. After verification, sign in with the password you just created.", "ok");
        $("mnResend").hidden = false;
        return null;
      }
      return enterAfterAuth();
    }).catch(function (e) {
      setStatus($("mnAuthStatus"), e.message || (create ? "Could not create that account." : "Could not sign in."), "error");
    }).finally(function () {
      button.disabled = false;
      button.textContent = create ? "Create account" : "Sign in";
    });
  }

  function boot() {
    mountProviders();
    setAuthMode("signin");
    $("mnSignInTab").onclick = function () { setAuthMode("signin"); };
    $("mnCreateTab").onclick = function () { setAuthMode("create"); };
    $("mnAuthGo").onclick = submitPasswordAuth;
    /* Hands off to forgot-password.html, which explains what the link will do
       and can resend. It no longer demands an email before it will help —
       being locked out is not a reason to be refused the way out. */
    $("mnForgot").onclick = function () {
      var email = $("mnEmail").value.trim();
      location.href = "forgot-password.html" + (email ? "?email=" + encodeURIComponent(email) : "");
    };
    $("mnResend").onclick = function () {
      var email = state.pendingVerificationEmail || $("mnEmail").value.trim(), button = $("mnResend");
      if (!email) return;
      button.disabled = true; button.textContent = "Sending…";
      MCC.resendSignupVerification(email).then(function () {
        setStatus($("mnAuthStatus"), "Verification email sent. Check your inbox and spam folder.", "ok");
        MCC.holdButton(button, 60, "Resend verification email");
      }).catch(function (e) {
        setStatus($("mnAuthStatus"), e.message || "Could not resend verification.", "error");
        if (e.mailQuota) MCC.holdButton(button, e.retryAfter, "Resend verification email");
        else { button.disabled = false; button.textContent = "Resend verification email"; }
      });
    };
    $("mnPassword").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && $("mnSignedOut").getAttribute("data-auth-mode") !== "create") submitPasswordAuth();
    });
    $("mnPassword2").addEventListener("keydown", function (e) { if (e.key === "Enter") submitPasswordAuth(); });
    $("mnProfileForm").addEventListener("submit", saveProfile);
    $("mnPasswordChange").onclick = changePassword;
    $("mnNewPassword2").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); changePassword(); }
    });
    wireAvatarPicker();
    wireTrackPicker();
    $("mnProfileBack").onclick = function () { showGate("app"); setView("profile"); };
    $("mnPost").onclick = createPost;
    $("mnMediaInput").onchange = function () { uploadMediaFiles(this.files).catch(function () {}); };
    $("mnDiscoverGo").onclick = loadDiscover;
    $("mnShowBlocked").onclick = loadBlocked;
    $("mnDiscoverQuery").addEventListener("keydown", function (e) { if (e.key === "Enter") loadDiscover(); });
    $("mnRefreshMessages").onclick = loadConversations;
    $("mnPersonClose").onclick = function () { $("mnPersonDialog").close(); };
    $("mnConversationClose").onclick = function () { $("mnConversationDialog").close(); state.currentConversation=null; };
    $("mnMessageForm").addEventListener("submit", sendMessage);
    $("mnAcceptConversation").onclick = function () {
      if (!state.currentConversation) return;
      api("/v1/mnet/conversations/" + encodeURIComponent(state.currentConversation) + "/accept", {method:"POST",body:{}})
        .then(function () { $("mnAcceptConversation").hidden=true; $("mnMessageForm").hidden=false; setStatus($("mnConversationStatus"),"Accepted.","ok"); return loadConversations(); })
        .catch(function (e) { setStatus($("mnConversationStatus"),e.message||"Could not accept request.","error"); });
    };
    $("mnMore").onclick = function () { loadFeed(false); };
    $("mnRefreshNotifications").onclick = loadNotificationsSilently;
    $("mnMe").onclick = function () { showGate("app"); setView("profile"); };
    $("mnEditProfile").onclick = editProfile;
    $("mnThreadClose").onclick = function () { $("mnThread").close(); };
    $("mnReplyForm").addEventListener("submit", createReply);
    document.querySelectorAll("[data-mn-view]").forEach(function (b) { b.onclick = function () { setView(b.dataset.mnView); }; });

    MCC.user().then(function (user) {
      state.user = user;
      if (!user) {
        var existing = MCC.session && MCC.session();
        if (existing && existing.access_token) showSignedInLoadError(new Error("Could not verify the existing session."));
        else showGate("signedout");
        return;
      }
      return MCC.autoTouch().catch(function () {}).then(function () {
        return bootstrap().catch(function (error) {
          showSignedInLoadError(error);
          return null;
        });
      });
    }).catch(function (error) {
      var existing = MCC.session && MCC.session();
      if (existing && existing.access_token) showSignedInLoadError(error);
      else showGate("signedout");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* ---------- THE HANDLE IS THE USERNAME, SO SAY SO WHILE THEY TYPE ----
     Every account already picks one here and the database has always made
     it unique. What it could not do was tell you BEFORE you submitted: you
     filled the whole form, pressed save, and got the name back as an error.
     mccluster_id_check answers while the field is still focused, and
     answers with the reason rather than a bare "unavailable".

     It is advisory on purpose. The unique index is what actually decides,
     because somebody can claim the name between this answer and the save. */
  (function handleAvailability() {
    var field = $("mnHandle");
    if (!field || !window.MCC_SUPA) return;

    var note = document.createElement("p");
    note.className = "mn__hint";
    note.id = "mnHandleState";
    note.setAttribute("role", "status");
    field.closest(".mn__handle-row").insertAdjacentElement("afterend", note);

    var timer = null, seq = 0;
    function say(text, kind) {
      note.textContent = text || "";
      note.style.color = kind === "bad" ? "#ff8e8e" : kind === "ok" ? "#9fdaa9" : "";
    }

    function ask() {
      var want = field.value.trim();
      if (!want) { say(""); return; }
      var mine = ++seq;
      say("Checking…");
      window.MCC_SUPA.token().then(function (t) {
        if (!t) return null;
        return fetch(window.MCC_SUPA.url + "/rest/v1/rpc/mccluster_id_check", {
          method: "POST",
          headers: { apikey: window.MCC_SUPA.key, authorization: "Bearer " + t,
                     "content-type": "application/json" },
          body: JSON.stringify({ p_id: want })
        }).then(function (r) { return r.ok ? r.json() : null; });
      }).then(function (out) {
        if (mine !== seq) return;              // a newer keystroke won
        if (!out) { say(""); return; }         // cannot check: the save still will
        say(out.ok ? "@" + want + " is free." : out.reason, out.ok ? "ok" : "bad");
      }).catch(function () { if (mine === seq) say(""); });
    }

    field.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(ask, 350);            // a keystroke is not a question
    });
    field.addEventListener("blur", function () { clearTimeout(timer); ask(); });
  })();


  /* ================= GROUPS =================
     Rooms inside the network, following two Mobbin references: Lex splits
     "Your groups" from "Explore" inside one screen rather than making them
     two places, and X's group detail leads with a cover, the name, one line
     of what the room is for, and then its feed.

     THE COVER IS GENERATED. Each group gets a gradient derived from its
     slug, so the rooms are distinguishable at a glance and stay the same
     colour between visits, without anybody having to make artwork for five
     rooms that may become fifty. It is abstract colour and never a mark.
     The pairs are picked, not computed from a hash into arbitrary hues, so
     every room lands somewhere that was chosen to sit on this surface. */
  var GROUP_SKINS = [
    ["#e5383b", "#7a1721"], ["#3f93d2", "#17324f"], ["#c98500", "#4a3105"],
    ["#199e70", "#0c3b2b"], ["#8b5cf6", "#2e1a52"], ["#d9a441", "#4b3512"],
    ["#d4448c", "#4d1435"], ["#2bb3a3", "#0b3a35"], ["#6d7ce6", "#22265c"],
    ["#e0692c", "#4a2009"], ["#5aa832", "#1b3610"], ["#b0568f", "#3a1a2f"]
  ];
  /* FNV-1a rather than the n*31 hash this first used. That one put
     the-listening-room, first-listens and behind-the-record on the same
     amber, because multiplying by 31 leaves short similar strings close
     together in the low bits, which is exactly where a modulo reads. */
  function skinSeed(slug) {
    var str = String(slug || ""), h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h;
  }
  /* The seed alone is not enough. Twelve skins and five rooms still put two
     of them on the same purple, and a cover exists to tell rooms apart, so
     "usually distinct" is the wrong guarantee. The seed picks a starting
     slot and a taken slot probes forward to the next free one, which is
     deterministic for a given list and distinct up to the palette size.
     Rooms only change colour if the list itself changes. */
  var skinOf = {};
  function assignSkins(list) {
    skinOf = {};
    var taken = {};
    list.slice().sort(function (a, b) {
      return String(a.slug).localeCompare(String(b.slug));   // order-independent
    }).forEach(function (g) {
      var i = skinSeed(g.slug) % GROUP_SKINS.length, n = 0;
      while (taken[i] && n < GROUP_SKINS.length) { i = (i + 1) % GROUP_SKINS.length; n++; }
      taken[i] = true;
      skinOf[g.slug] = i;
    });
  }
  function groupSkin(slug) {
    var i = skinOf[slug];
    if (i === undefined) i = skinSeed(slug) % GROUP_SKINS.length;
    var pair = GROUP_SKINS[i];
    return "linear-gradient(135deg," + pair[0] + " 0%," + pair[1] + " 100%)";
  }
  function people(n) {
    n = Number(n || 0);
    return n.toLocaleString() + " member" + (n === 1 ? "" : "s");
  }

  var groups = { all: [], seg: "yours", open: null, busy: false };

  function groupCard(g) {
    return '<article class="mng__card" data-group="' + esc(g.slug) + '">' +
      '<div class="mng__cover" style="background:' + groupSkin(g.slug) + '">' +
        "<b>" + esc((g.name || "?").trim().charAt(0).toUpperCase()) + "</b></div>" +
      '<div class="mng__body">' +
        '<h3 class="mng__name">' + esc(g.name) + "</h3>" +
        '<p class="mng__purpose">' + esc(g.purpose || "") + "</p>" +
        '<div class="mng__foot">' +
          '<span class="mng__count">' + esc(people(g.member_count)) + "</span>" +
          '<button type="button" class="mng__join' + (g.joined ? " is-in" : "") +
            '" data-join="' + esc(g.slug) + '">' + (g.joined ? "Joined" : "Join") + "</button>" +
        "</div></div></article>";
  }

  function renderGroups() {
    var host = $("mngCards");
    if (!host) return;
    var mine = groups.all.filter(function (g) { return g.joined; });
    var list = groups.seg === "yours" ? mine : groups.all;

    if (!list.length) {
      host.innerHTML = '<p class="mng__empty">' + (groups.seg === "yours"
        ? "<b>You have not joined a room yet.</b>Explore is where they are. " +
          "Joining one puts its posts in front of you and yours in front of the people already there."
        : "<b>No rooms yet.</b>They arrive with the next release.") + "</p>";
      return;
    }
    host.innerHTML = '<div class="mng__grid">' + list.map(groupCard).join("") + "</div>";
  }

  function loadGroups() {
    var host = $("mngCards");
    if (!host) return Promise.resolve();
    if (!groups.all.length) host.innerHTML = '<p class="mng__empty">Loading rooms…</p>';
    return api("/v1/mnet/groups").then(function (out) {
      groups.all = (out && out.groups) || [];
      assignSkins(groups.all);
      renderGroups();
    }).catch(function (e) {
      host.innerHTML = '<p class="mng__empty"><b>The rooms did not load.</b>' +
        esc(e.message || "") + "</p>";
    });
  }

  /* Optimistic, then reconciled. A join that waits on a round trip before
     the button changes feels broken on a phone; a join that never reconciles
     lies when the request fails. */
  function toggleJoin(slug, button) {
    if (groups.busy) return;
    var g = groups.all.filter(function (x) { return x.slug === slug; })[0];
    if (!g) return;
    groups.busy = true;
    var was = !!g.joined;
    g.joined = !was;
    g.member_count = Math.max(0, Number(g.member_count || 0) + (was ? -1 : 1));
    if (button) {
      button.classList.toggle("is-in", g.joined);
      button.textContent = g.joined ? "Joined" : "Join";
      button.disabled = true;
    }
    return api("/v1/mnet/groups/" + encodeURIComponent(slug) + "/membership",
      { method: was ? "DELETE" : "POST" })
      .then(function (out) {
        g.joined = !!(out && out.joined);
      })
      .catch(function () {
        g.joined = was;                                  // put it back
        g.member_count = Math.max(0, Number(g.member_count || 0) + (was ? 1 : -1));
      })
      .then(function () {
        groups.busy = false;
        if (groups.open && groups.open.slug === slug) { groups.open.joined = g.joined; paintGroup(); }
        renderGroups();
      });
  }

  function paintGroup() {
    var g = groups.open;
    if (!g) return;
    $("mngHead").innerHTML =
      '<div class="mng__banner" style="background:' + groupSkin(g.slug) + '"></div>' +
      '<div class="mng__headin"><h2>' + esc(g.name) + "</h2>" +
        '<span class="mng__meta">' +
          esc(g.visibility === "open" ? "Open group" : g.visibility === "request" ? "Approval to join" : "Invitation only") +
          " · " + esc(people(g.member_count)) + "</span>" +
        "<p>" + esc(g.purpose || "") + "</p>" +
        '<button type="button" class="mng__join' + (g.joined ? " is-in" : "") +
          '" data-join="' + esc(g.slug) + '">' + (g.joined ? "Joined" : "Join this group") + "</button>" +
      "</div>";
    $("mngComposer").hidden = !g.joined;
  }

  function openGroup(slug) {
    $("mnGroupsList").hidden = true;
    $("mnGroupsOne").hidden = false;
    $("mngFeed").innerHTML = '<p class="mng__empty">Loading…</p>';
    window.scrollTo({ top: 0, behavior: "smooth" });
    return api("/v1/mnet/groups/" + encodeURIComponent(slug)).then(function (out) {
      groups.open = out.group;
      if (skinOf[out.group.slug] === undefined) assignSkins(groups.all.concat([out.group]));
      paintGroup();
      var items = out.items || [];
      $("mngFeed").innerHTML = items.length
        ? items.map(function (it) { return postCard(it); }).join("")
        : '<p class="mng__empty"><b>Nothing here yet.</b>' +
          (out.group.joined ? "Be the first to say something."
                            : "Join to see what gets posted, and to post yourself.") + "</p>";
    }).catch(function (e) {
      $("mngFeed").innerHTML = '<p class="mng__empty"><b>That room did not open.</b>' +
        esc(e.message || "") + "</p>";
    });
  }

  function closeGroup() {
    groups.open = null;
    $("mnGroupsOne").hidden = true;
    $("mnGroupsList").hidden = false;
    renderGroups();
  }

  function postToGroup() {
    var g = groups.open, body = ($("mngPostBody").value || "").trim();
    if (!g || !body) return;
    var button = $("mngPost");
    button.disabled = true;
    setStatus($("mngPostStatus"), "Posting…");
    api("/v1/mnet/posts?app_key=" + encodeURIComponent(APP), {
      method: "POST",
      body: { body: body, group_id: g.id }
    }).then(function () {
      $("mngPostBody").value = "";
      setStatus($("mngPostStatus"), "");
      return openGroup(g.slug);
    }).catch(function (e) {
      setStatus($("mngPostStatus"), e.message || "Could not post.", "bad");
    }).then(function () { button.disabled = false; });
  }

  (function wireGroups() {
    var view = $("mnGroupsView");
    if (!view) return;
    view.addEventListener("click", function (e) {
      var seg = e.target.closest && e.target.closest("[data-mng-seg]");
      if (seg) {
        groups.seg = seg.getAttribute("data-mng-seg");
        Array.prototype.forEach.call(view.querySelectorAll("[data-mng-seg]"), function (x) {
          x.classList.toggle("is-on", x === seg);
          x.setAttribute("aria-selected", x === seg ? "true" : "false");
        });
        renderGroups();
        return;
      }
      /* The join button sits inside the card, and the card opens the room.
         Checking join first is what stops a join from also navigating. */
      var join = e.target.closest && e.target.closest("[data-join]");
      if (join) { e.stopPropagation(); toggleJoin(join.getAttribute("data-join"), join); return; }
      if (e.target.closest && e.target.closest("#mngBack")) { closeGroup(); return; }
      var card = e.target.closest && e.target.closest("[data-group]");
      if (card) openGroup(card.getAttribute("data-group"));
    });
    var post = $("mngPost");
    if (post) post.addEventListener("click", postToGroup);
  })();

})();
