/* ============================================================
   PICTURES ARE MADE SMALL BEFORE THEY GO UP.

   The World painted a 1.6 MB and an 867 KB PNG into 42px circles on every
   visit: the profile picker (js/mnet.js uploadAvatar) sent whatever the
   phone's camera roll handed it, as-is, to the public mnet-avatars bucket,
   and every row that face appears in loaded the whole file. Post pictures
   went up the same way.

   So the picture is decoded here, drawn onto a canvas at the size it will
   ever be shown at, and re-encoded as WebP (JPEG where the browser cannot
   write WebP; PNG where it cannot and the picture is see-through). A face
   is cover-cropped to a square, because every place it is painted is a
   circle or a square (.mn__avatar-btn, .mn__mini-avatar, .mf__avatar).
   A GIF is not touched: re-encoding would stop its animation. Nothing here
   throws for a picture that cannot be decoded; the original goes up as it
   did before, and the server's caps still stand.

   No dependencies. The dimension and type decisions are pure and tested in
   scripts/test/image-resize.test.mjs; the canvas work is checked in a real
   browser. Loaded by mnet.html before js/mnet.js.
   ============================================================ */
(function (root) {
  "use strict";

  var QUALITY = 0.85;                       // WebP / JPEG
  var AVATAR = { maxEdge: 512, square: true };
  var PICTURE = { maxEdge: 1600, square: false };
  var RASTER = /^image\/(png|jpeg|webp|avif)$/;   // what gets re-encoded
  var SAMPLE = 32;                          // the transparency check is the picture shrunk to 32 x 32

  /* Where the source is read from and how big the drawing is.
     Square: the largest centred square, then no bigger than maxEdge a side.
     Otherwise: the whole picture, the long edge no longer than maxEdge.
     Never scaled up. */
  function fit(width, height, opts) {
    var w = Math.max(1, Math.floor(Number(width) || 0)), h = Math.max(1, Math.floor(Number(height) || 0));
    var maxEdge = Math.max(1, Math.floor(Number(opts && opts.maxEdge) || PICTURE.maxEdge));
    var sx = 0, sy = 0, sw = w, sh = h;
    if (opts && opts.square) {
      var side = Math.min(w, h);
      sx = Math.floor((w - side) / 2); sy = Math.floor((h - side) / 2);
      sw = side; sh = side;
    }
    var scale = Math.min(1, maxEdge / Math.max(sw, sh));
    var dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
    return { sx: sx, sy: sy, sw: sw, sh: sh, dw: dw, dh: dh, scaled: dw !== sw || dh !== sh };
  }

  /* canvas.toBlob hands back a PNG when it does not know the type asked for,
     so the type of what came back says whether WebP is written here. Given
     that and whether the picture is see-through: null means "keep what came
     back", otherwise the type to encode next. */
  function nextType(got, alpha) {
    if (got === "image/webp") return null;
    if (alpha) return got === "image/png" ? null : "image/png";
    return "image/jpeg";
  }

  function extension(type) {
    return type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
  }
  /* the original name, with the extension of what is actually being sent */
  function outputName(name, type) {
    var base = String(name || "").replace(/\.[^.]*$/, "");
    return (base || "picture") + "." + extension(type);
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      try { canvas.toBlob(function (b) { resolve(b || null); }, type, quality); } catch (e) { resolve(null); }
    });
  }

  /* createImageBitmap, honouring the camera's EXIF orientation so a portrait
     photo is not sent sideways (re-encoding strips the EXIF that would have
     turned it); an <img> where that is not available, which turns it too. */
  function decode(file) {
    var bitmap = typeof root.createImageBitmap === "function"
      ? root.createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return root.createImageBitmap(file); })
      : Promise.reject(new Error("no createImageBitmap"));
    return bitmap.then(function (b) {
      return { source: b, width: b.width, height: b.height, close: function () { try { b.close(); } catch (e) {} } };
    }, function () {
      return new Promise(function (resolve, reject) {
        var url, img = new root.Image();
        try { url = root.URL.createObjectURL(file); } catch (e) { return reject(e); }
        function done() { try { root.URL.revokeObjectURL(url); } catch (e) {} }
        img.onload = function () {
          done();
          resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: function () {} });
        };
        img.onerror = function () { done(); reject(new Error("decode")); };
        img.src = url;
      });
    });
  }

  function canvasOf(w, h) {
    var c = root.document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  function draw(src, box, w, h) {
    var c = canvasOf(w, h), ctx = c.getContext("2d");
    if (!ctx) return null;
    try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; } catch (e) {}
    ctx.drawImage(src.source, box.sx, box.sy, box.sw, box.sh, 0, 0, w, h);
    return c;
  }
  /* a JPEG has no transparency to lose; for the rest, look at a 32 x 32 of the crop */
  function seeThrough(file, src, box) {
    if (file.type === "image/jpeg") return false;
    try {
      var c = draw(src, box, SAMPLE, SAMPLE), data = c && c.getContext("2d").getImageData(0, 0, SAMPLE, SAMPLE).data;
      if (!data) return false;
      for (var i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    } catch (e) {}
    return false;
  }
  function makeFile(blob, name) {
    try { return new root.File([blob], name, { type: blob.type }); } catch (e) {
      try { blob.name = name; } catch (e2) {}
      return blob;
    }
  }

  /* resize(file, { maxEdge, square, maxBytes }) resolves { file, width, height, changed }.
     `file` is the picture to send: the smaller one, or the original where
     nothing was gained or nothing could be done. Only maxBytes rejects: a
     result over it is a resize that did not happen, and must not go up. */
  function resize(file, opts) {
    opts = opts || PICTURE;
    var same = { file: file, width: undefined, height: undefined, changed: false };
    function sized(out) {
      if (opts.maxBytes && out.file.size > opts.maxBytes) {
        return Promise.reject(new Error("That picture could not be made small enough. Try a different one."));
      }
      return out;
    }
    if (!file || !RASTER.test(String(file.type || "")) || !root.document) return Promise.resolve(same).then(sized);
    return decode(file).then(function (src) {
      var box = fit(src.width, src.height, opts);
      var alpha = seeThrough(file, src, box);
      var canvas = draw(src, box, box.dw, box.dh);
      src.close();
      if (!canvas) return same;
      return toBlob(canvas, "image/webp", QUALITY).then(function (first) {
        if (!first) return same;
        var next = nextType(first.type, alpha);
        return next ? toBlob(canvas, next, QUALITY) : first;
      }).then(function (blob) {
        if (!blob) return same;
        /* a small, already-tight picture can come out bigger than it went in: then it goes as it was */
        if (!box.scaled && !(opts.square && box.sw !== src.width) && blob.size >= file.size) {
          return { file: file, width: src.width, height: src.height, changed: false };
        }
        return { file: makeFile(blob, outputName(file.name, blob.type)), width: box.dw, height: box.dh, changed: true };
      });
    }, function () { return same; }).then(sized);
  }

  root.MCCImageResize = {
    resize: resize, fit: fit, nextType: nextType, outputName: outputName,
    AVATAR: AVATAR, PICTURE: PICTURE, QUALITY: QUALITY
  };
})(typeof window !== "undefined" ? window : globalThis);
