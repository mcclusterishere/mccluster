/* ============================================================
   CREATE: the bar's record button.

   start  -> pick: Record (the phone's own camera), Photo, Library, Write
   edit   -> see it, trim it with two handles, sound on or off
   details-> caption, a song, who sees it, now or later
   done   -> posted, or scheduled with the time it goes out

   The file starts uploading the moment it is chosen, so by the time the
   caption is written the media is usually already there. Nothing is
   re-encoded on the phone: a trim is saved as a clip on the post and the
   feed plays only that stretch. A post for later is held by the API and
   published by the Worker's cron (see network_scheduled_posts).
   ============================================================ */
(function () {
  "use strict";

  var APP = "mccluster-web";
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var MIN_CLIP = 1; // seconds
  var MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  var MAX_VIDEO_BYTES = 500 * 1024 * 1024;
  var draftStore = window.MCCCompositionDraft.browser("advanced");
  var ownerEpoch = 0;
  // The legacy unowned draft is intentionally never adopted by an account.
  var OK_TYPES = /^(image\/(jpeg|png|webp|avif|gif)|video\/(mp4|webm|quicktime))$/;

  var S = {
    owner: "", file: null, kind: "", url: "", dur: 0, start: 0, end: 0, muted: false,
    upload: null, asset: null, when: "now", catalogue: [], busy: false, uploadError: null, draftRestored: false, xhr: null, uploadGrantAsset: null, uploadCancelled: false, completed: false, uploadPhase: "idle",
    /* the cover: { at, chosen, file, preview, asset, up, dropped, sent }; coverWork settles to the newest one */
    cover: null, coverSeq: 0, coverWork: null, coverPick: null, frameCount: 0
  };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function track(name, data) { try { if (window.MCC_TRACK) window.MCC_TRACK(name, data || {}); } catch (e) {} }
  function clock(sec) {
    sec = Math.max(0, sec || 0);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function session() {
    try {
      if (window.MCC && typeof window.MCC.session === "function") return window.MCC.session();
      return JSON.parse(localStorage.getItem("mccdb_session") || "null");
    } catch (e) { return null; }
  }
  function signedIn() { var s = session(); return !!(s && s.access_token); }
  function draftData() {
    return {
      saved_at: Date.now(), body: $("crCaption").value, visibility: $("crVisibility").value,
      track: $("crTrack").value, when: S.when, date: $("crDate").value, time: $("crTime").value
    };
  }
  function saveDraft() {
    if (!S.owner || S.busy || S.completed) return;
    try {
      var d = draftData(), useful = d.body.trim() || d.track || d.when === "later";
      if (useful) draftStore.write(S.owner, d);
      else draftStore.clear(S.owner);
    } catch (e) {}
  }
  function clearDraft() { draftStore.clear(S.owner); }
  function restoreDraft() {
    var d = null;
    try { d = draftStore.read(S.owner); } catch (e) {}
    if (!d) { clearDraft(); return false; }
    $("crCaption").value = String(d.body || "").slice(0, 5000);
    $("crCount").textContent = $("crCaption").value.length.toLocaleString();
    $("crVisibility").value = /^(public|network|private)$/.test(d.visibility) ? d.visibility : "public";
    S.when = d.when === "later" ? "later" : "now";
    $("crDate").value = d.date || ""; $("crTime").value = d.time || "";
    S.draftRestored = true; $("crDraftNotice").hidden = false;
    paintWhenButtons(); paintPost();
    return true;
  }
  function paintWhenButtons() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-when]"), function (x) {
      var on = x.getAttribute("data-when") === S.when;
      x.classList.toggle("is-on", on); x.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  function assertOwner(epoch,owner){if(epoch!==ownerEpoch||owner!==S.owner)throw Object.assign(new Error("Account changed. Reopen this account's draft."),{stale:true});}
  function api(path, init) {
    var epoch=ownerEpoch,owner=S.owner;
    return window.MCC.api(path, init).then(function (res) {
      if(epoch!==ownerEpoch)throw new Error("Account changed. Reopen this account's draft.");
      return res.text().then(function (t) {
        assertOwner(epoch,owner);
        var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
        if (!res.ok) throw Object.assign(new Error((d && (d.error || d.message)) || ("Request failed (" + res.status + ")")), { status: res.status });
        return d;
      });
    });
  }

  /* ---------- steps ---------- */
  var STEPS = ["start", "edit", "details", "done"];
  function go(step) {
    STEPS.forEach(function (k) {
      var el = $("cr" + k.charAt(0).toUpperCase() + k.slice(1));
      if (el) el.hidden = k !== step;
    });
    $("cr").setAttribute("data-step", step);
    window.scrollTo(0, 0);
    if (step !== "edit") pause();
  }

  /* ---------- start ---------- */
  function paintGate() {
    var on = signedIn() && !!S.owner;
    $("crSignedOut").hidden = on;
    $("crMake").hidden = !on;
    if (on) loadQueue();
  }
  ["crVideoCam", "crPhotoCam", "crLibrary"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";
      if (f) choose(f, id);
    });
  });
  $("crWrite").addEventListener("click", function () {
    reset();
    track("create_pick", { source: "write" });
    toDetails();
    setTimeout(function () { $("crCaption").focus(); }, 60);
  });

  function choose(file, source) {
    reset({ preserveComposition: S.draftRestored });
    var type = String(file.type || "").toLowerCase();
    if (!OK_TYPES.test(type)) {
      alert("That file type cannot be posted yet. Use a photo (JPEG, PNG, WebP) or a video (MP4, MOV, WebM).");
      return;
    }
    var video = type.indexOf("video/") === 0, limit = video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!file.size) { alert("That file is empty. Choose another one."); return; }
    if (file.size > limit) {
      alert(video ? "That video is over 500 MB. Choose a smaller video." : "That image is over 25 MB. Choose a smaller image.");
      return;
    }
    S.file = file;
    S.kind = type.indexOf("video/") === 0 ? "video" : "image";
    S.url = URL.createObjectURL(file);
    track("create_pick", { source: source, kind: S.kind });
    var v = $("crVideo"), img = $("crImage");
    $("crEditTitle").textContent = S.kind === "video" ? "Trim" : "Preview";
    $("crTools").hidden = S.kind !== "video";
    $("crPlay").hidden = S.kind !== "video";
    if (S.kind === "video") {
      img.hidden = true; v.hidden = false;
      v.muted = false; v.src = S.url;
      v.onloadedmetadata = function () {
        S.dur = isFinite(v.duration) ? v.duration : 0;
        S.start = 0; S.end = S.dur;
        paintTrim();
        drawFrames();
        /* the cover is taken while the video goes up */
        setCover(null, false);
      };
    } else {
      v.hidden = true; img.hidden = false; img.src = S.url;
    }
    paintCover();
    go("edit");
    startUpload();
  }

  /* ---------- upload, as soon as the file is chosen ---------- */
  function uploadLine(text, kind, pct) {
    var p = $("crUpload");
    p.className = "cr__upl" + (kind ? " is-" + kind : "");
    $("crUploadT").textContent = text;
    $("crUploadBar").style.width = (pct == null ? 0 : pct) + "%";
  }
  function storagePath(path) { return String(path || "").split("/").map(encodeURIComponent).join("/"); }
  function measure() {
    return new Promise(function (resolve) {
      if (S.kind === "image") {
        var i = new Image();
        i.onload = function () { resolve({ width: i.naturalWidth, height: i.naturalHeight }); };
        i.onerror = function () { resolve({}); };
        i.src = S.url;
        return;
      }
      var v = document.createElement("video");
      v.preload = "metadata"; v.muted = true;
      v.onloadedmetadata = function () {
        resolve({ width: v.videoWidth, height: v.videoHeight, duration_ms: isFinite(v.duration) ? Math.round(v.duration * 1000) : undefined });
      };
      v.onerror = function () { resolve({}); };
      v.src = S.url;
    });
  }
  function put(url, file, token, signed) {
    var epoch=ownerEpoch;
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      S.xhr = x;
      x.open(signed ? "PUT" : "POST", url);
      x.setRequestHeader("apikey", SB_KEY);
      x.setRequestHeader("authorization", "Bearer " + token);
      x.setRequestHeader("content-type", file.type || "application/octet-stream");
      x.setRequestHeader("x-upsert", "false");
      x.upload.onprogress = function (e) {
        if (epoch===ownerEpoch && e.lengthComputable) uploadLine("Uploading… " + Math.round(e.loaded / e.total * 100) + "%", "", Math.round(e.loaded / e.total * 100));
      };
      x.onload = function () { if(S.xhr===x)S.xhr = null; x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("Upload rejected (" + x.status + ")")); };
      x.onerror = function () { if(S.xhr===x)S.xhr = null; reject(new Error("The upload was interrupted. Check your connection.")); };
      x.onabort = function () { if(S.xhr===x)S.xhr = null; reject(Object.assign(new Error("Upload cancelled."), { cancelled: true })); };
      x.send(file);
    });
  }
  function startUpload() {
    var file = S.file, mine = {epoch:ownerEpoch,owner:S.owner};
    if (!file) return;
    if (navigator.onLine === false) {
      S.uploadError = Object.assign(new Error("Waiting for a connection."), { offline: true });
      S.upload = null; S.uploadPhase = "waiting";
      uploadLine("Waiting for a connection…", "", 0); $("crUploadRetry").hidden = false; $("crUploadCancel").hidden = true;
      return;
    }
    S.uploadError = null; S.uploadCancelled = false; S.uploadGrantAsset = null; S.uploadPhase = "reserving"; $("crUploadRetry").hidden = true; $("crUploadCancel").hidden = false;
    uploadLine("Preparing upload…", "", 2);
    S.upload = mine.p = api("/v1/mnet/media/upload-url", {
      method: "POST", body: { file_name: file.name || (S.kind + ".bin"), mime_type: file.type, byte_size: file.size }
    }).then(function (grant) {
      assertOwner(mine.epoch,mine.owner);
      var path = grant && grant.upload && grant.upload.path, asset = grant && grant.asset;
      if (!path || !asset) throw new Error("The upload slot was not created.");
      S.uploadGrantAsset = asset;
      if (S.upload !== mine.p || S.uploadCancelled) {
        S.uploadGrantAsset = null;
        discardUploadAsset(asset);
        throw Object.assign(new Error("Upload cancelled."), { cancelled: true, stale: true });
      }
      S.uploadPhase = "uploading";
      var tok = grant.upload.token, s = session();
      var url = tok
        ? SB_URL + "/storage/v1/object/upload/sign/mnet-media/" + storagePath(path) + "?token=" + encodeURIComponent(tok)
        : SB_URL + "/storage/v1/object/mnet-media/" + storagePath(path);
      return put(url, file, s && s.access_token, !!tok).then(function(){assertOwner(mine.epoch,mine.owner);return measure();}).then(function (m) {
        assertOwner(mine.epoch,mine.owner);
        return api("/v1/mnet/media/finalize", { method: "POST", body: { asset_id: asset.id, width: m.width, height: m.height, duration_ms: m.duration_ms } });
      }).then(function (fin) { return (fin && fin.asset) || asset; });
    }).then(function (asset) {
      assertOwner(mine.epoch,mine.owner);
      if (S.upload !== mine.p || S.uploadCancelled) {
        discardUploadAsset(asset);
        return asset;
      }
      S.asset = asset; S.uploadGrantAsset = null; S.uploadPhase = "ready"; $("crUploadCancel").hidden = true;
      uploadLine("Uploaded. Ready to post.", "ok", 100);
      return asset;
    }, function (e) {
      if (S.upload === mine.p) {
        S.uploadError = e; S.uploadPhase = e.cancelled ? "cancelled" : "failed";
        uploadLine(e.message || "Upload failed.", e.cancelled ? "" : "error", 0);
        $("crUploadRetry").hidden = !!e.cancelled;
        $("crUploadCancel").hidden = true;
      }
      throw e;
    });
    S.upload.catch(function () {});
  }
  function discardUploadAsset(asset) {
    if (!asset || !asset.id) return Promise.resolve();
    return api("/v1/mnet/media/discard", { method: "POST", body: { asset_id: asset.id } }).catch(function () {});
  }
  function cancelUpload() {
    S.uploadCancelled = true; S.uploadPhase = "cancelled";
    var reserved = S.uploadGrantAsset;
    S.upload = null;
    if (S.xhr) try { S.xhr.abort(); } catch (e) {}
    S.uploadGrantAsset = null; S.asset = null;
    $("crUploadCancel").hidden = true; $("crUploadRetry").hidden = true;
    uploadLine("Upload cancelled.", "", 0);
    discardUploadAsset(reserved);
    /* the cover goes with the video it belongs to */
    S.coverSeq++; dropCover(false); $("crCover").removeAttribute("aria-busy"); paintCover();
  }
  $("crUploadRetry").addEventListener("click", function () {
    if (!S.file || S.busy) return;
    if (navigator.onLine === false) { uploadLine("Waiting for a connection…", "", 0); return; }
    startUpload();
    if (S.kind === "video" && !S.cover && S.dur) setCover(S.coverPick && S.coverPick.at, !!(S.coverPick && S.coverPick.chosen));
  });
  $("crUploadCancel").addEventListener("click", cancelUpload);
  window.addEventListener("online", function () {
    if (S.file && S.uploadError && !S.uploadCancelled && !S.asset) {
      uploadLine("Connection restored. Ready to retry.", "", 0); $("crUploadRetry").hidden = false;
    }
  });
  window.addEventListener("offline", function () {
    if (S.file && !S.asset) uploadLine("Connection lost. The upload can be retried.", "error", 0);
  });

  /* ---------- the trim ---------- */
  var v = $("crVideo");
  function pause() { if (!v.paused) v.pause(); }
  function paintTrim() {
    var d = S.dur || 1, l = S.start / d * 100, r = S.end / d * 100;
    $("crShadeL").style.width = l + "%";
    $("crShadeR").style.width = (100 - r) + "%";
    $("crWindow").style.left = l + "%";
    $("crWindow").style.width = (r - l) + "%";
    $("crHandleL").style.left = "max(0px, calc(" + l + "% - 22px))";
    $("crHandleR").style.left = "min(calc(100% - 22px), " + r + "%)";
    $("crTStart").textContent = clock(S.start);
    $("crTEnd").textContent = clock(S.end);
    $("crTLen").textContent = clock(S.end - S.start);
    $("crHandleL").setAttribute("aria-valuetext", clock(S.start));
    $("crHandleR").setAttribute("aria-valuetext", clock(S.end));
    paintHead();
  }
  function paintHead() {
    $("crPlayhead").style.left = ((v.currentTime || 0) / (S.dur || 1) * 100) + "%";
  }
  function drawFrames() {
    var c = $("crFrames"), box = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(box.width * dpr)); c.height = Math.max(1, Math.round(box.height * dpr));
    var ctx = c.getContext("2d"), n = Math.max(4, Math.round(box.width / 44)), w = c.width / n, i = 0;
    S.frameCount = n;
    paintCover();
    var probe = document.createElement("video");
    probe.muted = true; probe.playsInline = true; probe.preload = "auto"; probe.src = S.url;
    var url = S.url;
    function next() {
      if (i >= n || url !== S.url) { probe.removeAttribute("src"); try { probe.load(); } catch (e) {} return; }
      probe.currentTime = Math.min(S.dur - 0.05, (i + 0.5) * S.dur / n);
    }
    probe.onseeked = function () {
      try {
        var vw = probe.videoWidth || 1, vh = probe.videoHeight || 1, scale = Math.max(w / vw, c.height / vh);
        var dw = vw * scale, dh = vh * scale;
        ctx.save(); ctx.beginPath(); ctx.rect(i * w, 0, w, c.height); ctx.clip();
        ctx.drawImage(probe, i * w + (w - dw) / 2, (c.height - dh) / 2, dw, dh);
        ctx.restore();
      } catch (e) {}
      i++; next();
    };
    probe.onloadeddata = next;
  }
  function dragHandle(handle, which) {
    handle.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      pause();
      handle.setPointerCapture(e.pointerId);
      var strip = $("crStrip").getBoundingClientRect();
      function move(ev) {
        var t = Math.min(1, Math.max(0, (ev.clientX - strip.left) / strip.width)) * S.dur;
        if (which === "l") S.start = Math.min(t, S.end - MIN_CLIP);
        else S.end = Math.max(t, S.start + MIN_CLIP);
        S.start = Math.max(0, S.start); S.end = Math.min(S.dur, S.end);
        v.currentTime = which === "l" ? S.start : S.end;
        paintTrim();
      }
      function up() {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        v.currentTime = S.start;
        paintHead();
        coverAfterTrim();
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    /* the keyboard moves a handle a quarter second at a time */
    handle.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowLeft" ? -0.25 : e.key === "ArrowRight" ? 0.25 : 0;
      if (!d) return;
      e.preventDefault();
      if (which === "l") S.start = Math.max(0, Math.min(S.start + d, S.end - MIN_CLIP));
      else S.end = Math.min(S.dur, Math.max(S.end + d, S.start + MIN_CLIP));
      paintTrim();
      coverAfterTrim();
    });
  }
  dragHandle($("crHandleL"), "l");
  dragHandle($("crHandleR"), "r");

  /* ---------- the cover: the picture the post shows before it plays ----------
     Taken for the person from the kept stretch (js/video-poster.js skips a black frame) unless they tap a frame on
     the strip, or pause on one and tap Cover. It goes up as soon as it is taken, beside the video, through the same
     upload-url, PUT and finalize; a cover that is replaced, cancelled or never posted is discarded. */
  function uploadCover(file, meta) {
    var epoch=ownerEpoch,owner=S.owner;
    var s = session(), token = s && s.access_token;
    if (!token) return Promise.reject(new Error("Sign in first."));
    return api("/v1/mnet/media/upload-url", {
      method: "POST", body: { file_name: file.name || "cover.jpg", mime_type: "image/jpeg", byte_size: file.size }
    }).then(function (grant) {
      assertOwner(epoch,owner);
      var path = grant && grant.upload && grant.upload.path, asset = grant && grant.asset, tok = grant && grant.upload && grant.upload.token;
      if (!path || !asset) throw new Error("The upload slot was not created.");
      var url = tok
        ? SB_URL + "/storage/v1/object/upload/sign/mnet-media/" + storagePath(path) + "?token=" + encodeURIComponent(tok)
        : SB_URL + "/storage/v1/object/mnet-media/" + storagePath(path);
      return fetch(url, { method: tok ? "PUT" : "POST", headers: { apikey: SB_KEY, authorization: "Bearer " + token, "content-type": "image/jpeg", "x-upsert": "false" }, body: file })
        .then(function (res) {
          assertOwner(epoch,owner);
          if (!res.ok) { discardUploadAsset(asset); throw new Error("Upload rejected (" + res.status + ")"); }
          return api("/v1/mnet/media/finalize", { method: "POST", body: { asset_id: asset.id, width: meta.width, height: meta.height } });
        }).then(function (fin) { return (fin && fin.asset) || asset; });
    });
  }
  /* at: the moment the person chose (chosen), or ignored (the kept stretch is searched) */
  function setCover(at, chosen) {
    if (S.kind !== "video" || !S.url || !window.MCCVideoPoster) return Promise.resolve(S.cover);
    var seq = ++S.coverSeq, url = S.url, name = S.file && S.file.name, epoch=ownerEpoch, owner=S.owner;
    S.coverPick = { at: chosen ? at : null, chosen: !!chosen };
    $("crCover").setAttribute("aria-busy", "true");
    var work = window.MCCVideoPoster.capture(url, chosen ? { at: at, name: name } : { start: S.start, end: S.end, name: name })
      .then(function (shot) {
        if (seq !== S.coverSeq || url !== S.url) return S.cover;
        $("crCover").removeAttribute("aria-busy");
        if (shot && shot.file) {
          /* the cover before stays until this one is up: a new picture that fails to go up gives the old one back */
          var next = { at: shot.at, chosen: !!chosen, file: shot.file, preview: URL.createObjectURL(shot.file), prev: S.cover };
          next.up = uploadCover(shot.file, { width: shot.width, height: shot.height }).then(function (asset) {
            assertOwner(epoch,owner);
            next.asset = asset;
            if (next.dropped) discardUploadAsset(asset);
            else { retireCover(next.prev, false); next.prev = null; }
            return asset;
          }, function () {
            if (S.cover !== next) return null;
            var back = next.prev;
            next.prev = null; next.dropped = true;
            try { URL.revokeObjectURL(next.preview); } catch (e) {}
            S.cover = back; paintCover();
            return back && back.up ? back.up : null;
          });
          S.cover = next;
        }
        paintCover();
        return S.cover;
      });
    S.coverWork = work;
    return work;
  }
  /* keep: the post went out with it, so it is the post's now */
  function dropCover(keep,accountChanged) {
    var c = S.cover;
    S.cover = null;
    retireCover(c, keep,accountChanged);
  }
  /* a cover, and any it was holding on to until it went up */
  function retireCover(c, keep,accountChanged) {
    if (!c) return;
    c.dropped = true;
    if (c.preview) try { URL.revokeObjectURL(c.preview); } catch (e) {}
    if (!accountChanged && c.asset && !(keep && c.sent)) discardUploadAsset(c.asset);
    if (c.prev) { retireCover(c.prev, keep,accountChanged); c.prev = null; }
  }
  var coverTimer = 0;
  function coverAfterTrim() {
    if (S.kind !== "video" || (S.coverPick && S.coverPick.chosen)) return;
    clearTimeout(coverTimer);
    coverTimer = setTimeout(function () { setCover(null, false); }, 500);
  }
  function paintCover() {
    var on = S.kind === "video", c = S.cover, img = $("crCoverImg"), mark = $("crCoverMark");
    $("crCover").hidden = !on; $("crCoverHint").hidden = !on;
    if (c && c.preview) { img.src = c.preview; img.hidden = false; } else { img.removeAttribute("src"); img.hidden = true; }
    mark.hidden = !(on && c && S.dur);
    if (on && c && S.dur) mark.style.left = Math.min(100, Math.max(0, c.at / S.dur * 100)) + "%";
    if (!$("crDetails").hidden) paintThumb();
  }
  /* a tap on a frame of the strip (not a drag, not a handle) makes that frame the cover */
  $("crStrip").addEventListener("pointerdown", function (e) {
    if (e.target.closest && e.target.closest(".cr__handle")) return;
    var strip = this, x0 = e.clientX, y0 = e.clientY;
    function off() { strip.removeEventListener("pointerup", up); strip.removeEventListener("pointercancel", off); }
    function up(ev) {
      off();
      if (Math.abs(ev.clientX - x0) > 10 || Math.abs(ev.clientY - y0) > 10 || !S.dur) return;
      var box = strip.getBoundingClientRect(), n = S.frameCount || Math.max(4, Math.round(box.width / 44));
      var i = Math.min(n - 1, Math.max(0, Math.floor((ev.clientX - box.left) / box.width * n)));
      var t = Math.min(Math.max(0, S.dur - 0.05), (i + 0.5) * S.dur / n);
      pause(); v.currentTime = t; paintHead();
      setCover(t, true);
    }
    strip.addEventListener("pointerup", up);
    strip.addEventListener("pointercancel", off);
  });
  $("crCover").addEventListener("click", function () {
    if (S.kind !== "video" || !S.dur) return;
    pause();
    setCover(v.currentTime || 0, true);
  });
  /* the cover goes with the post when it is ready in time; a post never waits long on its picture */
  function coverForPost() {
    if (S.kind !== "video" || !S.coverWork) return Promise.resolve(null);
    var late = new Promise(function (r) { setTimeout(function () { r(null); }, 25000); });
    return Promise.race([S.coverWork.then(function (c) {
      return c && c.up ? c.up.then(function (asset) { return { c: c, asset: asset }; }) : null;
    }), late]).then(function (r) {
      /* the cover then is the one sent: the newest, or the one before it if the newest did not go up */
      if (r && r.asset && S.cover && S.cover.asset === r.asset) { S.cover.sent = true; return r.asset; }
      return null;
    }, function () { return null; });
  }

  function playToggle() {
    if (v.paused) {
      if (v.currentTime < S.start || v.currentTime >= S.end - 0.05) v.currentTime = S.start;
      v.play().catch(function () {});
    } else v.pause();
  }
  $("crPlay").addEventListener("click", playToggle);
  v.addEventListener("click", playToggle);
  v.addEventListener("play", function () { $("crPlay").style.opacity = "0"; });
  v.addEventListener("pause", function () { $("crPlay").style.opacity = "1"; });
  /* the preview loops inside the kept stretch, the way the post will play */
  v.addEventListener("timeupdate", function () {
    if (!v.paused && v.currentTime >= S.end) v.currentTime = S.start;
    paintHead();
  });
  $("crMute").addEventListener("click", function () {
    S.muted = !S.muted;
    v.muted = S.muted;
    this.setAttribute("aria-pressed", S.muted ? "true" : "false");
    $("crMuteL").textContent = S.muted ? "Sound off" : "Sound on";
  });

  $("crEditClose").addEventListener("click", function () {
    if (S.file && !confirm("Discard this and start again?")) return;
    reset(); go("start");
  });
  $("crEditNext").addEventListener("click", toDetails);

  /* ---------- details ---------- */
  /* the post's picture beside the caption: the cover once it is taken */
  function paintThumb() {
    var th = $("crThumb");
    th.innerHTML = "";
    th.hidden = !S.file;
    if (S.file) {
      th.innerHTML = S.kind === "video"
        ? (S.cover && S.cover.preview
          ? '<img src="' + esc(S.cover.preview) + '" alt="Cover">'
          : '<video src="' + esc(S.url) + "#t=" + S.start.toFixed(2) + '" muted playsinline preload="metadata"></video>')
        : '<img src="' + esc(S.url) + '" alt="">';
    }
  }
  function toDetails() {
    paintThumb();
    go("details");
    paintPost();
  }
  $("crDetailsBack").addEventListener("click", function () { go(S.file ? "edit" : "start"); });
  $("crCaption").addEventListener("input", function () {
    $("crCount").textContent = this.value.length.toLocaleString(); saveDraft();
  });
  $("crVisibility").addEventListener("change", saveDraft);
  $("crTrack").addEventListener("change", saveDraft);

  function loadCatalogue() {
    return fetch("data/albums.json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var sel = $("crTrack");
        ((d && d.albums) || []).forEach(function (a) {
          (a.tracks || []).forEach(function (t) {
            S.catalogue.push({ title: t.title, album: a.name, albumSlug: a.slug, art: a.art });
            var o = document.createElement("option");
            o.value = String(S.catalogue.length - 1);
            o.textContent = t.title + " · " + a.name;
            sel.appendChild(o);
          });
        });
      }).catch(function () {});
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function localDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function laterDefault() {
    var d = new Date(Date.now() + 60 * 60000);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    $("crDate").value = localDate(d);
    $("crTime").value = pad(d.getHours()) + ":" + pad(d.getMinutes());
    $("crDate").min = localDate(new Date());
    var max = new Date(Date.now() + 89 * 86400000);
    $("crDate").max = localDate(max);
  }
  function pickedTime() {
    var d = $("crDate").value, t = $("crTime").value;
    if (!d || !t) return null;
    var at = new Date(d + "T" + t);
    return isNaN(at.getTime()) ? null : at;
  }
  function whenText(at) {
    return at.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function paintPost() {
    var later = S.when === "later";
    $("crLater").hidden = !later;
    $("crPost").textContent = later ? "Schedule" : "Post";
    if (later) {
      var at = pickedTime();
      $("crWhenHint").textContent = at ? "Goes out " + whenText(at) + ", your time." : "Pick a date and a time.";
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-when]"), function (b) {
    b.addEventListener("click", function () {
      S.when = b.getAttribute("data-when");
      Array.prototype.forEach.call(document.querySelectorAll("[data-when]"), function (x) {
        var on = x === b;
        x.classList.toggle("is-on", on);
        x.setAttribute("aria-checked", on ? "true" : "false");
      });
      if (S.when === "later" && !$("crDate").value) laterDefault();
      paintPost(); saveDraft();
    });
  });
  $("crDate").addEventListener("input", function () { paintPost(); saveDraft(); });
  $("crTime").addEventListener("input", function () { paintPost(); saveDraft(); });

  function status(text, bad) {
    var s = $("crStatus");
    s.textContent = text || "";
    s.classList.toggle("is-error", !!bad);
  }

  $("crPost").addEventListener("click", function () {
    if (S.busy || !S.owner) return;
    var postEpoch=ownerEpoch,postOwner=S.owner;
    var body = $("crCaption").value.trim();
    var song = $("crTrack").value ? S.catalogue[Number($("crTrack").value)] : null;
    if (!body && !S.file && !song) { status("Write something first.", true); return; }
    if (S.file && !S.asset && !S.upload) {
      status(navigator.onLine === false ? "The media upload is waiting for a connection." : "Retry the media upload before posting.", true);
      return;
    }
    var at = null;
    if (S.when === "later") {
      at = pickedTime();
      if (!at) { status("Pick a date and a time.", true); return; }
      if (at.getTime() < Date.now() + 2 * 60000) { status("Pick a time at least two minutes from now, or post now.", true); return; }
    }
    S.busy = true;
    var btn = $("crPost");
    btn.disabled = true;
    status(S.file && !S.asset ? "Finishing the upload…" : (at ? "Scheduling…" : "Posting…"));
    var ready = S.file ? S.upload : Promise.resolve(null);
    ready.then(function (asset) {
      assertOwner(postEpoch,postOwner);
      return (asset ? coverForPost() : Promise.resolve(null)).then(function (poster) { return { asset: asset, poster: poster }; });
    }).then(function (up) {
      assertOwner(postEpoch,postOwner);
      var asset = up.asset;
      status(at ? "Scheduling…" : "Posting…");
      var payload = { body: body, visibility: $("crVisibility").value, track: song };
      if (asset) payload.media_asset_ids = [asset.id];
      /* the cover rides beside the video it belongs to */
      if (asset && up.poster && S.kind === "video") payload.poster_asset_ids = [up.poster.id];
      if (S.kind === "video" && S.dur) {
        var trimmed = S.start > 0.05 || S.end < S.dur - 0.05;
        if (trimmed || S.muted) {
          payload.clip = { muted: S.muted };
          if (trimmed) { payload.clip.start_ms = Math.round(S.start * 1000); payload.clip.end_ms = Math.round(S.end * 1000); }
        }
      }
      if (at) payload.publish_at = at.toISOString();
      return api("/v1/mnet/posts?app_key=" + encodeURIComponent(APP), { method: "POST", body: payload });
    }).then(function (out) {
      assertOwner(postEpoch,postOwner);
      track(at ? "create_scheduled" : "create_posted", { kind: S.kind || "text", trimmed: !!(S.kind === "video" && (S.start > 0.05 || S.end < S.dur - 0.05)) });
      $("crDoneH").textContent = at ? "Scheduled" : "Posted";
      $("crDoneP").textContent = at
        ? "It goes out " + whenText(new Date(out && out.scheduled && out.scheduled.publish_at || at)) + ". You can cancel it from Create until then."
        : "It is on Human Uprise now.";
      S.completed = true; S.draftRestored = false; S.uploadPhase = "attached";
      clearDraft(); $("crDraftNotice").hidden = true;
      go("done");
    }).catch(function (e) {
      if(postEpoch===ownerEpoch)status(e.message || "That did not go through. Try again.", true);
    }).finally(function () {
      if(postEpoch!==ownerEpoch)return;
      S.busy = false;
      btn.disabled = false;
    });
  });

  $("crAgain").addEventListener("click", function () { reset(); go("start"); loadQueue(); });

  /* ---------- waiting to go out ---------- */
  function loadQueue() {
    if (!signedIn() || !window.MCC) return;
    api("/v1/mnet/scheduled").then(function (d) {
      var list = (d && d.scheduled) || [];
      $("crQueue").hidden = !list.length;
      $("crQueueList").innerHTML = list.map(function (r) {
        var what = r.body || (r.media_count ? (r.media_count === 1 ? "1 attachment" : r.media_count + " attachments") : (r.track && r.track.title) || "Post");
        var failed = r.status === "failed";
        return '<li class="cr__qi">' +
          '<span class="cr__qi-when">' + esc(failed ? "Did not go out" : whenText(new Date(r.publish_at))) + "</span>" +
          '<span class="cr__qi-what">' + esc(what) + "</span>" +
          (r.status === "publishing" ? "" : '<button class="cr__qi-x" type="button" data-cancel="' + esc(r.id) + '">' + (failed ? "Clear" : "Cancel") + "</button>") +
          (failed && r.error ? '<span class="cr__qi-err">' + esc(r.error) + "</span>" : "") +
          "</li>";
      }).join("");
    }).catch(function () { $("crQueue").hidden = true; });
  }
  $("crQueueList").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-cancel]");
    if (!b) return;
    if (!confirm("Cancel this post?")) return;
    b.disabled = true;
    api("/v1/mnet/scheduled/" + encodeURIComponent(b.getAttribute("data-cancel")), { method: "DELETE" })
      .then(loadQueue)
      .catch(function (err) { b.disabled = false; alert(err.message || "Could not cancel that post."); });
  });

  /* ---------- reset ---------- */
  function reset(opts) {
    opts = opts || {};
    pause();
    var abandoned = S.completed || opts.accountChanged ? null : (S.uploadGrantAsset || (S.asset && !S.busy ? S.asset : null));
    if (S.xhr) try { S.xhr.abort(); } catch (e) {}
    if (abandoned) discardUploadAsset(abandoned);
    /* a cover that went out with the post is the post's; any other is discarded */
    clearTimeout(coverTimer);
    S.coverSeq++; dropCover(S.completed,opts.accountChanged); S.coverWork = null; S.coverPick = null; S.frameCount = 0;
    $("crCover").removeAttribute("aria-busy");
    if (S.url) try { URL.revokeObjectURL(S.url); } catch (e) {}
    v.removeAttribute("src"); try { v.load(); } catch (e) {}
    $("crImage").removeAttribute("src");
    S.busy=false;$("crPost").disabled=false;
    S.file = null; S.kind = ""; S.url = ""; S.dur = 0; S.start = 0; S.end = 0; S.muted = false;
    S.upload = null; S.asset = null; S.uploadError = null; S.xhr = null; S.uploadGrantAsset = null; S.uploadCancelled = false; S.uploadPhase = "idle"; S.completed = false;
    if (!opts.preserveComposition) S.when = "now";
    $("crMute").setAttribute("aria-pressed", "false");
    $("crMuteL").textContent = "Sound on";
    if (!opts.preserveComposition) {
      $("crCaption").value = ""; $("crCount").textContent = "0";
      $("crTrack").value = ""; $("crVisibility").value = "public";
      $("crDate").value = ""; $("crTime").value = "";
      S.draftRestored = false;
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-when]"), function (x) {
      var on = x.getAttribute("data-when") === S.when;
      x.classList.toggle("is-on", on);
      x.setAttribute("aria-checked", on ? "true" : "false");
    });
    uploadLine("", "", 0); $("crUploadRetry").hidden = true; $("crUploadCancel").hidden = true;
    $("crDraftNotice").hidden = !opts.preserveComposition;
    paintCover();
    status("");
  }

  $("crDraftDiscard").addEventListener("click", function () {
    clearDraft(); reset(); go("start");
  });
  window.addEventListener("beforeunload", saveDraft);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveDraft(); });
  window.addEventListener("resize", function () { if (S.kind === "video" && !$("crEdit").hidden) drawFrames(); });
  var catalogueReady = loadCatalogue();
  function refreshDraftOwner() {
    saveDraft();var epoch=++ownerEpoch;S.owner="";reset({accountChanged:true});go("start");paintGate();
    Promise.resolve(window.MCC.user()).then(function(user){
      if(epoch!==ownerEpoch)return;S.owner=user&&user.id||"";paintGate();
      if(S.owner&&restoreDraft()){
        toDetails();catalogueReady.then(function(){if(epoch!==ownerEpoch)return;var draft=draftStore.read(S.owner);if(draft&&draft.track)$("crTrack").value=draft.track;});
      }
    }).catch(function(){if(epoch===ownerEpoch)paintGate();});
  }
  window.addEventListener("mcc:auth-changed",refreshDraftOwner);
  window.addEventListener("mcc:auth-state",function(e){var auth=e.detail||{};if(auth.verified&&(auth.signed_in?auth.user?.id:"")!==S.owner)refreshDraftOwner();});
  window.addEventListener("storage",function(e){if(!e.key||e.key==="mccdb_session")refreshDraftOwner();});
  refreshDraftOwner();
  track("create_open", {});
})();
