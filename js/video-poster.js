/* ============================================================
   VIDEO POSTERS: every video post shows a real picture.

   Owner, 2026-10-20: "when people upload videos, there's no thumbnail,
   just a black video ... I want people to be even able to edit the videos
   they previously posted as a thumbnail."

   One way to take a picture out of a video, shared by the composer and
   mission proof (js/mnet.js), Create (js/create.js) and the Thumbnail
   editor on a member's own post. A detached video that has never played
   gives WebKit nothing to draw, so the frame is taken from an element that
   is attached (out of sight), muted and inline; after the seek it waits
   for a frame that was really put up (requestVideoFrameCallback, or a
   quick muted play and pause where that does not exist); and a frame that
   comes out (near) black is tried again further in. Nothing here throws:
   a video this device cannot decode gives back no file, and the caller
   posts without a poster rather than not at all.
   ============================================================ */
(function (root) {
  "use strict";

  var MAX_EDGE = 1080;     // the long edge of a poster, in pixels
  var QUALITY = 0.85;      // JPEG
  var SAMPLE = 24;         // the brightness sample is the whole frame shrunk to 24 x 24
  /* generous: a phone busy with the globe decodes slowly, and the capture runs beside the upload, never before it */
  var LOAD_WAIT = 15000;   // for the first frame's data
  var SEEK_WAIT = 4000;    // for one seek
  var FRAME_WAIT = 500;    // for the frame callback after a seek
  var TOTAL_WAIT = 20000;  // for the whole capture

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function listen(el, names, fn) {
    names.forEach(function (n) { el.addEventListener(n, fn); });
    return function () { names.forEach(function (n) { el.removeEventListener(n, fn); }); };
  }
  /* the first of `names` to fire, or the element's error, or the clock */
  function until(el, names, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { done(); reject(new Error("timeout")); }, ms);
      var offOk = listen(el, names, function () { done(); resolve(); });
      var offBad = listen(el, ["error"], function () { done(); reject(new Error("decode")); });
      function done() { clearTimeout(timer); offOk(); offBad(); }
    });
  }
  function baseName(name) {
    return String(name || "video").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "video";
  }

  /* where to look for a picture in the kept stretch [start, end): a second in (or a quarter of a short clip), then a
     quarter, then halfway. A video whose length is not known yet (a fresh WebM often says Infinity) is read as four
     seconds from the start. */
  function times(duration, start, end) {
    var known = isFinite(duration) && duration > 0;
    start = Math.max(0, Number(start) || 0);
    if (known) start = Math.min(start, duration);
    end = Number(end) > start ? Number(end) : (known ? duration : start + 4);
    if (known) end = Math.min(end, duration);
    var len = Math.max(0, end - start), last = known ? Math.max(0, duration - 0.05) : Infinity, out = [];
    [start + Math.min(1, len * 0.25), start + len * 0.25, start + len * 0.5].forEach(function (t) {
      t = Math.min(Math.max(0, t), last);
      if (!out.some(function (x) { return Math.abs(x - t) < 0.05; })) out.push(Number(t.toFixed(3)));
    });
    return out;
  }

  /* how light a frame is: mean and brightest luminance (0..255) over the whole picture shrunk to SAMPLE x SAMPLE,
     transparency counted as black. Throws on a canvas the page may not read (a video from another origin without
     CORS). */
  function lightOf(pixels) {
    var sum = 0, max = 0, n = pixels.length / 4;
    for (var i = 0; i < pixels.length; i += 4) {
      var y = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) * (pixels[i + 3] / 255);
      sum += y; if (y > max) max = y;
    }
    return { mean: n ? sum / n : 0, max: max };
  }
  function light(canvas) {
    var s = document.createElement("canvas");
    s.width = SAMPLE; s.height = SAMPLE;
    var ctx = s.getContext("2d");
    ctx.drawImage(canvas, 0, 0, SAMPLE, SAMPLE);
    return lightOf(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data);
  }
  /* (near) black: nothing in the picture rises above a dim grey */
  function isDark(l) { return !l || (l.mean < 10 && l.max < 40); }

  /* a muted, inline play() needs no tap; it makes a decoder that is holding back put a picture up */
  function nudge(video) {
    try {
      var p = video.play();
      if (p && typeof p.then === "function") {
        return Promise.race([p.then(function () { video.pause(); }, function () {}), wait(800)]).then(function () {
          try { video.pause(); } catch (e) {}
        });
      }
      video.pause();
    } catch (e) {}
    return Promise.resolve();
  }
  function ready(video) {
    if (video.readyState >= 2) return Promise.resolve();
    var kick = setTimeout(function () { nudge(video); }, 1200);
    return until(video, ["loadeddata"], LOAD_WAIT).then(
      function () { clearTimeout(kick); },
      function (e) { clearTimeout(kick); throw e; });
  }
  /* seek, then wait for that frame to be put up */
  function seekTo(video, t) {
    var framed = null;
    if (typeof video.requestVideoFrameCallback === "function") {
      framed = new Promise(function (r) {
        try { video.requestVideoFrameCallback(function () { r(true); }); } catch (e) { r(false); }
      });
    }
    var seeked = until(video, ["seeked"], SEEK_WAIT);
    try { video.currentTime = t; } catch (e) { return Promise.reject(e); }
    return seeked.then(function () {
      return framed ? Promise.race([framed, wait(FRAME_WAIT).then(function () { return false; })]) : false;
    }).then(function (painted) { return painted ? null : nudge(video); });
  }
  /* the current frame on a canvas no longer than maxEdge on its long side */
  function draw(video, maxEdge) {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    var scale = Math.min(1, (maxEdge || MAX_EDGE) / Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    var ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, c.width, c.height);
    return c;
  }
  function toFile(canvas, name) {
    return new Promise(function (resolve) {
      try {
        canvas.toBlob(function (blob) {
          if (!blob) return resolve(null);
          try { resolve(new File([blob], name, { type: "image/jpeg" })); }
          catch (e) { try { blob.name = name; } catch (_) {} resolve(blob); }
        }, "image/jpeg", QUALITY);
      } catch (e) { resolve(null); }
    });
  }
  /* an element out of sight but in the document: WebKit does not decode a detached one the same way */
  function makeVideo(src, crossOrigin) {
    var v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.setAttribute("aria-hidden", "true"); v.tabIndex = -1;
    v.preload = "auto";
    if (crossOrigin) v.crossOrigin = crossOrigin;
    v.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    (document.body || document.documentElement).appendChild(v);
    v.src = src;
    return v;
  }
  function release(video) {
    try { video.pause(); } catch (e) {}
    try { video.removeAttribute("src"); video.load(); } catch (e) {}
    if (video.parentNode) video.parentNode.removeChild(video);
  }

  /* capture(fileOrUrl, { start, end, at, name, crossOrigin, maxEdge, timeout, onMeta })
       -> Promise<{ file: File|null, width, height, at, video: { width, height, duration_ms }, reason }>
     Without `at`, the kept stretch [start, end) is searched for a picture that is not black; with `at`, that exact
     moment is taken as it is (the person chose it). onMeta({ width, height, duration_ms }) is told the video's size
     and length as soon as they are known, so a finalize need not wait for the picture. Never rejects. */
  function capture(src, opts) {
    opts = opts || {};
    var out = { file: null, width: 0, height: 0, at: 0, video: {}, reason: "" };
    if (!src || typeof document === "undefined") { out.reason = "unsupported"; return Promise.resolve(out); }
    var owned = typeof src !== "string", url;
    try { url = owned ? URL.createObjectURL(src) : src; } catch (e) { out.reason = "unsupported"; return Promise.resolve(out); }
    var name = baseName(opts.name || (owned && src.name)) + "-poster.jpg";
    var video = makeVideo(url, opts.crossOrigin), over = false;
    var offMeta = listen(video, ["loadedmetadata"], function () {
      var d = video.duration;
      out.video = {
        width: video.videoWidth || undefined, height: video.videoHeight || undefined,
        duration_ms: isFinite(d) && d > 0 ? Math.round(d * 1000) : undefined
      };
      if (typeof opts.onMeta === "function") try { opts.onMeta(out.video); } catch (e) {}
    });
    var work = ready(video).then(function () {
      var list = opts.at != null ? [Math.max(0, Math.min(Number(opts.at) || 0, isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : Infinity))]
        : times(video.duration, opts.start, opts.end);
      var best = null, i = 0;
      function attempt() {
        if (over || i >= list.length) return best;
        var t = list[i++];
        return seekTo(video, t).then(function () {
          var c = draw(video, opts.maxEdge);
          if (!c) return attempt();
          var l = light(c), pick = { canvas: c, at: video.currentTime || t, light: l };
          if (!best || l.mean > best.light.mean) best = pick;
          return opts.at != null || !isDark(l) ? pick : attempt();
        }, function (e) {
          if (e && e.message === "decode") throw e;
          return attempt();
        });
      }
      return attempt();
    }).then(function (pick) {
      if (!pick) { out.reason = out.reason || "no-frame"; return out; }
      if (isDark(pick.light)) out.reason = "dark";
      return toFile(pick.canvas, name).then(function (file) {
        out.file = file; out.width = pick.canvas.width; out.height = pick.canvas.height; out.at = Number((pick.at || 0).toFixed(3));
        if (!file) out.reason = "encode";
        return out;
      });
    }, function (e) {
      var m = String(e && (e.name === "SecurityError" ? "tainted" : e.message) || "");
      out.reason = m === "tainted" || m === "decode" || m === "timeout" ? m : "error";
      return out;
    });
    var late = wait(opts.timeout || TOTAL_WAIT).then(function () {
      return { file: null, width: 0, height: 0, at: 0, video: out.video, reason: "timeout" };
    });
    return Promise.race([work, late])
      .then(function (result) {
        over = true; offMeta(); release(video);
        if (owned) try { URL.revokeObjectURL(url); } catch (e) {}
        return result;
      });
  }

  /* grab(videoElement, { name, maxEdge }) -> Promise<{ file, width, height, at, reason }>: the frame a person is
     looking at, from an element already on screen (the Thumbnail editor, Create's stage). */
  function grab(video, opts) {
    opts = opts || {};
    var out = { file: null, width: 0, height: 0, at: 0, reason: "" };
    var c;
    try {
      c = draw(video, opts.maxEdge);
      if (!c) { out.reason = "no-frame"; return Promise.resolve(out); }
      c.getContext("2d").getImageData(0, 0, 1, 1);
    } catch (e) { out.reason = e && e.name === "SecurityError" ? "tainted" : "error"; return Promise.resolve(out); }
    return toFile(c, baseName(opts.name) + "-poster.jpg").then(function (file) {
      out.file = file; out.width = c.width; out.height = c.height; out.at = Number((video.currentTime || 0).toFixed(3));
      if (!file) out.reason = "encode";
      return out;
    });
  }

  /* may this page read the pixels of this video? A storage URL without CORS taints the canvas, and then a frame
     cannot become a poster (an uploaded image still can). */
  function readable(video) {
    try {
      var c = document.createElement("canvas");
      c.width = 2; c.height = 2;
      var ctx = c.getContext("2d");
      ctx.drawImage(video, 0, 0, 2, 2);
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch (e) { return false; }
  }

  /* an image's own size, for finalize */
  function imageSize(file) {
    return new Promise(function (resolve) {
      var url, img = new Image();
      try { url = URL.createObjectURL(file); } catch (e) { return resolve({}); }
      function done(v) { try { URL.revokeObjectURL(url); } catch (e) {} resolve(v); }
      img.onload = function () { done({ width: img.naturalWidth || undefined, height: img.naturalHeight || undefined }); };
      img.onerror = function () { done({}); };
      img.src = url;
    });
  }

  root.MCCVideoPoster = {
    capture: capture, grab: grab, readable: readable, imageSize: imageSize, prime: nudge,
    times: times, lightOf: lightOf, isDark: isDark, MAX_EDGE: MAX_EDGE
  };
})(typeof window !== "undefined" ? window : globalThis);
