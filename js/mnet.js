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
    currentView: "feed"
  };

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
    if (img) {
      if (url) {
        img.src = url;
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
    if (p.avatar_url) {
      $("mnComposerAvatar").style.backgroundImage = "url(" + JSON.stringify(p.avatar_url).slice(1,-1) + ")";
      $("mnComposerAvatar").style.backgroundSize = "cover";
      $("mnComposerAvatar").textContent = "";
    }
    $("mnProfileName").textContent = p.display_name || name;
    $("mnProfileHandle").textContent = id.mccluster_id ? "@" + id.mccluster_id : "";
    $("mnProfileHeadline").textContent = p.headline || "";
    $("mnProfileBio").textContent = p.bio || "";
    $("mnProfileBanner").style.backgroundImage = p.banner_url ? "url(" + JSON.stringify(p.banner_url).slice(1,-1) + ")" : "";
    $("mnProfileAvatar").textContent = initials(name);
    $("mnProfileAvatar").style.backgroundImage = p.avatar_url ? "url(" + JSON.stringify(p.avatar_url).slice(1,-1) + ")" : "";
    if (p.avatar_url) $("mnProfileAvatar").textContent = "";
    var site = $("mnProfileWebsite");
    if (p.website_url) {
      site.href = p.website_url;
      site.textContent = p.website_url.replace(/^https?:\/\//, "");
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
    var av = actor.avatar_url
      ? '<img src="' + esc(actor.avatar_url) + '" alt="">'
      : esc(initials(name));
    return '<div class="mn__author-avatar">' + av + '</div>' +
      '<div class="mn__author-meta"><span class="mn__author-name">' + esc(name) + '</span>' +
      '<div class="mn__author-sub">' + esc(handle) + '</div></div>';
  }

  function postCard(item, opts) {
    opts = opts || {};
    var post = item.post || item, actor = item.actor || post.actor || {};
    var likes = Number(post.reaction_count || 0), replies = Number(post.reply_count || 0);
    var liked = !!post.liked_by_me;
    var id = post.id || item.post_id;
    return '<article class="mn__post-card" data-post-id="' + esc(id || "") + '">' +
      '<div class="mn__post-head">' + authorHtml(actor) +
        '<span class="mn__author-sub">' + esc(timeAgo(post.created_at || item.occurred_at)) + '</span></div>' +
      '<p class="mn__post-body">' + esc(post.body || "") + '</p>' +
      (opts.actions === false ? '' :
        '<div class="mn__post-actions">' +
          '<button class="mn__action' + (liked ? ' is-active' : '') + '" type="button" data-action="like" data-post="' + esc(id) + '">' +
            (liked ? "Liked" : "Like") + (likes ? " · " + likes : "") + '</button>' +
          '<button class="mn__action" type="button" data-action="comments" data-post="' + esc(id) + '">Comment' + (replies ? " · " + replies : "") + '</button>' +
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

  function createPost() {
    var body = $("mnPostBody").value.trim();
    if (!body) { setStatus($("mnPostStatus"), "Write something first.", "error"); return; }
    var button = $("mnPost");
    button.disabled = true;
    setStatus($("mnPostStatus"), "Posting…");
    api("/v1/mnet/posts?app_key=" + encodeURIComponent(APP), {
      method:"POST",
      body:{ body:body, visibility:$("mnVisibility").value }
    }).then(function () {
      $("mnPostBody").value = "";
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
    }).catch(function () {});
  }

  function setView(name) {
    state.currentView = name;
    ["feed","notifications","profile"].forEach(function (view) {
      var panel = $(view === "feed" ? "mnFeedView" : view === "notifications" ? "mnNotificationsView" : "mnProfileView");
      panel.hidden = view !== name;
      var tab = document.querySelector('[data-mn-view="' + view + '"]');
      if (tab) tab.classList.toggle("is-active", view === name);
    });
    if (name === "notifications") loadNotificationsSilently();
    if (name === "profile") paintSelf();
    window.scrollTo({ top:0, behavior:"smooth" });
  }

  function editProfile() {
    fillProfileForm(true);
    showGate("profile");
  }

  function boot() {
    mountProviders();
    $("mnEmailGo").onclick = function () {
      var email = $("mnEmail").value.trim();
      if (!email) { setStatus($("mnAuthStatus"), "Enter your email.", "error"); return; }
      $("mnEmailGo").disabled = true;
      setStatus($("mnAuthStatus"), "Sending…");
      MCC.signInWithEmail(email, location.origin + "/auth/?next=/mnet.html").then(function () {
        setStatus($("mnAuthStatus"), "Check your email and open the link on this device.", "ok");
      }).catch(function (e) {
        setStatus($("mnAuthStatus"), e.message || "Could not send the link.", "error");
      }).finally(function () { $("mnEmailGo").disabled = false; });
    };
    $("mnProfileForm").addEventListener("submit", saveProfile);
    $("mnProfileBack").onclick = function () { showGate("app"); setView("profile"); };
    $("mnPost").onclick = createPost;
    $("mnMore").onclick = function () { loadFeed(false); };
    $("mnRefreshNotifications").onclick = loadNotificationsSilently;
    $("mnMe").onclick = function () { showGate("app"); setView("profile"); };
    $("mnEditProfile").onclick = editProfile;
    $("mnThreadClose").onclick = function () { $("mnThread").close(); };
    $("mnReplyForm").addEventListener("submit", createReply);
    document.querySelectorAll("[data-mn-view]").forEach(function (b) { b.onclick = function () { setView(b.dataset.mnView); }; });

    MCC.user().then(function (user) {
      state.user = user;
      if (!user) { showGate("signedout"); return; }
      return MCC.autoTouch().catch(function () {}).then(bootstrap);
    }).catch(function () { showGate("signedout"); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
