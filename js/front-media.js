/* AN ACCOUNT'S MEDIA, PREPARED ON ITS OWN DEVICE (front-studio.html).

   The house's scroll films are frames, not video: the engine (js/main.js) draws frame N for scroll position N, which is
   what makes a scrub feel held instead of chased. So an account's film is cut into frames here, in its own browser,
   from the video it picks: up to 160 frames, each at full size (up to 1280px on the long side) and at phone size
   (640px, the engine's sm/ set), as WebP where the browser can make it and JPEG where it cannot. Nothing is sent to a
   server to be processed; the frames go straight to the account's own folder of the public front-media bucket with its
   own session (the bucket's policies allow nothing else), uploaded as they are cut.

   A 360 room (an equirectangular video or photo), a still and a soundtrack are uploaded as they are, after a size
   check; a 360 video also gets a poster from its first frame. */
(function (w) {
  "use strict";
  var BUCKET = "front-media";
  var LIMITS = { cabin: 300 * 1048576, still: 20 * 1048576, sound: 30 * 1048576, film: 500 * 1048576 };
  var BIG = 1280, SMALL = 640, MAX_FRAMES = 160, MIN_FRAMES = 48, PER_SECOND = 12, PARALLEL = 4;

  function sb() { return w.MCC_SUPA || {}; }
  function stamp() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function pad4(n) { return String(n).padStart(4, "0"); }
  function extOf(type) { return { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav" }[type] || ""; }
  /* the type a file is stored as: a phone or desktop names some audio its own way (macOS: audio/x-m4a), the bucket takes one */
  var STORED = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav" };
  function publicUrl(path) { return sb().url + "/storage/v1/object/public/" + BUCKET + "/" + path; }

  /* one object to the account's folder; XHR so a big 360 film can report its progress */
  function put(path, blob, type, onProgress) {
    return Promise.resolve(sb().token ? sb().token() : null).then(function (token) {
      if (!token) throw new Error("Sign in to upload.");
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open("POST", sb().url + "/storage/v1/object/" + BUCKET + "/" + path);
        x.setRequestHeader("authorization", "Bearer " + token);
        x.setRequestHeader("apikey", sb().key);
        x.setRequestHeader("content-type", type);
        x.setRequestHeader("x-upsert", "true");
        x.setRequestHeader("cache-control", "max-age=31536000");
        if (onProgress && x.upload) x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        x.onload = function () { x.status >= 200 && x.status < 300 ? resolve(publicUrl(path)) : reject(new Error("Upload refused (" + x.status + ")")); };
        x.onerror = function () { reject(new Error("Upload failed: check the connection")); };
        x.send(blob);
      });
    });
  }
  function encode(canvas, type, q) { return new Promise(function (res) { canvas.toBlob(function (b) { res(b); }, type, q); }); }
  function load(file, kind) {
    return new Promise(function (resolve, reject) {
      var el = d.createElement(kind), url = URL.createObjectURL(file);
      el.muted = true; el.playsInline = true; el.preload = "auto"; el.crossOrigin = "anonymous";
      el.onloadedmetadata = function () { resolve({ el: el, url: url }); };
      el.onerror = function () { URL.revokeObjectURL(url); reject(new Error("This browser cannot open that video. Try an MP4 (H.264) or WebM.")); };
      el.src = url;
    });
  }
  var d = w.document;
  function seek(v, t) {
    return new Promise(function (resolve) {
      var done = function () { v.removeEventListener("seeked", done); resolve(); };
      v.addEventListener("seeked", done);
      v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.04));
    });
  }
  function fit(wd, ht, max) { var k = Math.min(1, max / Math.max(wd, ht)); return [Math.max(2, Math.round(wd * k)), Math.max(2, Math.round(ht * k))]; }

  /* A FILM: cut into frames and uploaded as they come. Resolves to the film as the page reads it:
     { base, count, ext, sm: true, poster } */
  function film(file, prefixPath, onProgress, signal) {
    if (!file || !/^video\//.test(file.type || "")) return Promise.reject(new Error("Pick a video for this film."));
    if (file.size > LIMITS.film) return Promise.reject(new Error("That video is over 500 MB. Trim it first: a scroll film is a few seconds."));
    var dir = prefixPath + "films/" + stamp() + "/";
    return load(file, "video").then(function (o) {
      var v = o.el, dur = v.duration;
      if (!isFinite(dur) || dur <= 0) throw new Error("That video has no length this browser can read.");
      var n = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.round(dur * PER_SECOND)));
      var big = fit(v.videoWidth, v.videoHeight, BIG), small = fit(v.videoWidth, v.videoHeight, SMALL);
      var cb = d.createElement("canvas"), cs = d.createElement("canvas");
      cb.width = big[0]; cb.height = big[1]; cs.width = small[0]; cs.height = small[1];
      var xb = cb.getContext("2d"), xs = cs.getContext("2d");
      var type = "image/webp", ext = "webp", cut = 0, sent = 0, total = n * 2, queue = [], running = 0, failed = null;
      var report = function () { if (onProgress) onProgress({ cut: cut, of: n, sent: sent, total: total }); };
      var pump = function () {
        while (running < PARALLEL && queue.length && !failed) {
          var job = queue.shift(); running++;
          put(job.path, job.blob, type).then(function () { sent++; running--; report(); pump(); }, function (e) { failed = e; running--; pump(); });
        }
      };
      var drained = function () { return new Promise(function (res, rej) { (function wait() { if (failed) return rej(failed); if (!queue.length && !running) return res(); setTimeout(wait, 60); })(); }); };
      var i = 0;
      var next = function () {
        if (signal && signal.aborted) return Promise.reject(new Error("Stopped."));
        if (failed) return Promise.reject(failed);
        if (i >= n) return Promise.resolve();
        var t = n === 1 ? 0 : (dur * i) / (n - 1);
        return seek(v, t).then(function () {
          xb.drawImage(v, 0, 0, big[0], big[1]); xs.drawImage(v, 0, 0, small[0], small[1]);
          return Promise.all([encode(cb, type, 0.78), encode(cs, type, 0.72)]);
        }).then(function (b) {
          /* the first frame decides the format for the whole film: Safari makes no WebP and hands back PNG */
          if (i === 0 && (!b[0] || b[0].type !== "image/webp")) { type = "image/jpeg"; ext = "jpg"; return Promise.all([encode(cb, type, 0.82), encode(cs, type, 0.78)]); }
          return b;
        }).then(function (b) {
          if (!b[0] || !b[1]) throw new Error("This browser could not draw that video's frames.");
          var name = pad4(i + 1) + "." + ext;
          queue.push({ path: dir + name, blob: b[0] }, { path: dir + "sm/" + name, blob: b[1] });
          cut = ++i; report(); pump();
          /* keep the queue short: a phone holds a few frames, not the film */
          return new Promise(function (res) { (function wait() { if (queue.length < PARALLEL * 3 || failed) return res(); setTimeout(wait, 40); })(); });
        }).then(next);
      };
      report();
      return next().then(drained).then(function () {
        URL.revokeObjectURL(o.url);
        return { base: publicUrl(dir), count: n, ext: ext, sm: true, poster: publicUrl(dir + pad4(1) + "." + ext) };
      }, function (e) { URL.revokeObjectURL(o.url); throw e; });
    });
  }

  /* A 360 ROOM: a 2:1 video or photo, uploaded as it is (a video also gets a poster from its first frame) */
  function cabin(file, prefixPath, onProgress) {
    var t = (file && file.type) || "";
    var kind = /^video\//.test(t) ? "video" : /^image\//.test(t) ? "image" : "";
    if (!kind) return Promise.reject(new Error("Pick a 360 video or a 360 photo."));
    if (file.size > LIMITS.cabin) return Promise.reject(new Error("That file is over 300 MB."));
    var ext = extOf(t);
    if (!ext || (kind === "video" && ext !== "mp4" && ext !== "webm") || (kind === "image" && ext === "png" && file.size > LIMITS.still)) return Promise.reject(new Error("Use an MP4 or WebM 360 video, or a JPEG, WebP or PNG 360 photo."));
    var id = stamp(), path = prefixPath + "cabin-" + id + "." + ext;
    var shape = kind === "video" ? load(file, "video").then(function (o) { return { el: o.el, url: o.url, w: o.el.videoWidth, h: o.el.videoHeight }; })
      : new Promise(function (res, rej) { var im = new Image(), url = URL.createObjectURL(file); im.onload = function () { res({ el: im, url: url, w: im.naturalWidth, h: im.naturalHeight }); }; im.onerror = function () { rej(new Error("That photo could not be opened.")); }; im.src = url; });
    return shape.then(function (s) {
      var ratio = s.w / s.h;
      /* an equirectangular 360 is twice as wide as it is tall */
      if (!(ratio > 1.9 && ratio < 2.1)) { URL.revokeObjectURL(s.url); throw new Error("That is not a 360 (" + s.w + "×" + s.h + "). A 360 video or photo is twice as wide as it is tall, like 3840×1920."); }
      var poster = Promise.resolve(null);
      if (kind === "video") {
        poster = seek(s.el, 0.1).then(function () {
          var c = d.createElement("canvas"), sz = fit(s.w, s.h, 2048); c.width = sz[0]; c.height = sz[1];
          c.getContext("2d").drawImage(s.el, 0, 0, sz[0], sz[1]);
          return encode(c, "image/jpeg", 0.82);
        }).then(function (b) { return b ? put(prefixPath + "cabin-" + id + "-poster.jpg", b, "image/jpeg") : null; });
      }
      return poster.then(function (posterUrl) {
        return put(path, file, t, onProgress).then(function (src) { URL.revokeObjectURL(s.url); return { src: src, kind: kind, poster: posterUrl || undefined }; });
      });
    });
  }
  function still(file, prefixPath, onProgress) {
    var t = (file && file.type) || "", ext = extOf(t);
    if (!/^image\/(webp|jpeg|png)$/.test(t)) return Promise.reject(new Error("Pick a JPEG, WebP or PNG photo."));
    if (file.size > LIMITS.still) return Promise.reject(new Error("That photo is over 20 MB."));
    return put(prefixPath + "still-" + stamp() + "." + ext, file, t, onProgress).then(function (src) { return { src: src }; });
  }
  function sound(file, prefixPath, onProgress) {
    var t = (file && file.type) || "", ext = extOf(t);
    if (!/^audio\//.test(t) || !ext) return Promise.reject(new Error("Pick an MP3, M4A, AAC or WAV file."));
    if (file.size > LIMITS.sound) return Promise.reject(new Error("That track is over 30 MB."));
    return put(prefixPath + "sound-" + stamp() + "." + ext, file, STORED[ext], onProgress).then(function (src) { return { src: src }; });
  }
  w.MCC_FRONT_MEDIA = { film: film, cabin: cabin, still: still, sound: sound, LIMITS: LIMITS, MAX_FRAMES: MAX_FRAMES };
})(window);
