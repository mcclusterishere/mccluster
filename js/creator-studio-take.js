/* Creator Studio: the Take bench (the Make chapter's first tool).

   One take at a time: record from the microphone or import an audio file, see
   the waveform, drag the trim handles, set fades, hear the trimmed region,
   write it to a WAV in the browser, keep it on this device, and hand it to
   the release form that creator.html already has.

   What it never does:
   - it uploads nothing. A take leaves this device only when the member
     submits the release form themselves, through the existing upload path.
   - it plays nothing but the take that is open. It has its own small Web
     Audio graph (a buffer source and one gain), asks the site player to pause
     before it sounds, and stops itself if anything else on the page starts.
   - it is not a second player engine and not a second backend. Takes live in
     this browser's IndexedDB, scoped to the signed-in account.

   Memory, because a phone tab is small:
   - the list of takes is metadata only. A take's audio is a Blob in its own
     object store and is read only when it is opened, downloaded or used.
   - a file's length is read from its header before it is decoded, so a file
     that is too long is refused without being decoded first.
   - the WAV is written straight from the open buffer, in slices; there is no
     second decoded copy.

   A take is stored with a one-track, one-clip session document beside the
   audio, so the multitrack sessions that come later can open it as track 1. */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------
     Pure helpers (also loaded by scripts/test/creator-studio-shell.test.mjs)
     ------------------------------------------------------------------ */
  var MIN_REGION = 0.05;                 /* seconds: the shortest take */
  var MAX_FILE_BYTES = 300 * 1024 * 1024;
  var MAX_SECONDS = 30 * 60;
  /* decoded audio is 4 bytes a sample: this is about 18 minutes of 48 kHz stereo, or 30 of mono */
  var MAX_FLOAT_BYTES = 420 * 1024 * 1024;
  var MAX_FADE = 10;
  /* the creator-previews ceiling the release form enforces (BUCKET_MAX_BYTES in js/music-creator-studio.js):
     the file listeners hear. A public release with no separate preview uses its master as that file. */
  var PREVIEW_MAX_BYTES = 52428800;

  function clamp(v, lo, hi) { v = Number(v); if (!isFinite(v)) v = lo; return Math.min(hi, Math.max(lo, v)); }
  function dbToGain(db) { return Math.pow(10, clamp(db, -60, 24) / 20); }

  /* m:ss.cc, tabular */
  function clock(t) {
    t = Math.max(0, Number(t) || 0);
    var cs = Math.round(t * 100);
    var m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
    return m + ":" + (s < 10 ? "0" : "") + s + "." + (c < 10 ? "0" : "") + c;
  }

  /* the trim and fades a region can actually have, given the audio's length */
  function region(duration, start, end, fadeIn, fadeOut) {
    duration = Math.max(0, Number(duration) || 0);
    var min = Math.min(MIN_REGION, duration);
    var s = clamp(start, 0, Math.max(0, duration - min));
    var e = clamp(end, s + min, duration);
    var len = e - s;
    var fi = clamp(fadeIn, 0, Math.min(MAX_FADE, len));
    var fo = clamp(fadeOut, 0, Math.min(MAX_FADE, len));
    if (fi + fo > len) { var k = len / (fi + fo); fi *= k; fo *= k; }
    return { start: s, end: e, length: len, fadeIn: fi, fadeOut: fo };
  }

  /* the fade envelope (0..1) at r seconds into a region */
  function envelope(r, len, fadeIn, fadeOut) {
    if (r < 0 || r > len) return 0;
    var g = 1;
    if (fadeIn > 0 && r < fadeIn) g = Math.min(g, r / fadeIn);
    if (fadeOut > 0 && r > len - fadeOut) g = Math.min(g, (len - r) / fadeOut);
    return Math.max(0, Math.min(1, g));
  }

  /* ---- WAV writing: 16-bit PCM, straight from planar float channels ---- */
  function wavHeader(channels, sampleRate, frames) {
    var bytes = frames * channels * 2;
    var buf = new ArrayBuffer(44), v = new DataView(buf);
    function tag(at, s) { for (var i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); }
    tag(0, "RIFF"); v.setUint32(4, 36 + bytes, true); tag(8, "WAVE");
    tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * channels * 2, true);
    v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
    tag(36, "data"); v.setUint32(40, bytes, true);
    return buf;
  }
  /* a region in whole frames of the buffer it is cut from */
  function regionFrames(totalFrames, sampleRate, r) {
    var n = Math.min(totalFrames, Math.max(1, Math.round(r.length * sampleRate)));
    var s = Math.min(Math.max(0, Math.round(r.start * sampleRate)), Math.max(0, totalFrames - n));
    return { start: s, frames: n, fadeIn: Math.round((r.fadeIn || 0) * sampleRate), fadeOut: Math.round((r.fadeOut || 0) * sampleRate) };
  }
  /* frames a..b of the region, interleaved, through the fades.
     A sample is scaled back by what the decoder divided it by, and clipped, so a 16-bit file that is only
     trimmed comes back out with the samples it went in with. Negative samples are always over 32768.
     Positive ones are over 32768 in most decoders and over 32767 in Chromium's; `pos` says which (the bench
     measures it once, see calibrate). */
  function pcm16(channels, rf, a, b, pos) {
    pos = pos === 32767 ? 32767 : 32768;
    var n = channels.length, buf = new ArrayBuffer(Math.max(0, b - a) * n * 2), v = new DataView(buf), at = 0;
    var N = rf.frames, fi = rf.fadeIn, fo = rf.fadeOut, plain = !fi && !fo;
    for (var f = a; f < b; f++) {
      var g = 1;
      if (!plain) {
        if (fi > 0 && f < fi) g = f / fi;
        if (fo > 0 && f > N - fo) { var q = (N - f) / fo; if (q < g) g = q; }
        if (g < 0) g = 0;
      }
      for (var c = 0; c < n; c++) {
        var x = channels[c][rf.start + f] * g;
        x = Math.round(x * (x < 0 ? 32768 : pos));
        v.setInt16(at, x > 32767 ? 32767 : x < -32768 ? -32768 : x, true);
        at += 2;
      }
    }
    return buf;
  }
  function join(parts) {
    var total = 0, i;
    for (i = 0; i < parts.length; i++) total += parts[i].byteLength;
    var out = new Uint8Array(total), at = 0;
    for (i = 0; i < parts.length; i++) { out.set(new Uint8Array(parts[i]), at); at += parts[i].byteLength; }
    return out.buffer;
  }
  /* the whole of some channels as a WAV */
  function encodeWav(channels, sampleRate, pos) {
    var frames = channels.length ? channels[0].length : 0;
    return join([wavHeader(channels.length, sampleRate, frames), pcm16(channels, { start: 0, frames: frames, fadeIn: 0, fadeOut: 0 }, 0, frames, pos)]);
  }
  /* a trimmed, faded region of some channels as a WAV */
  function encodeRegion(channels, sampleRate, r, pos) {
    var rf = regionFrames(channels.length ? channels[0].length : 0, sampleRate, r);
    return join([wavHeader(channels.length, sampleRate, rf.frames), pcm16(channels, rf, 0, rf.frames, pos)]);
  }

  /* what a WAV header says: used to check a render before it is kept */
  function wavInfo(buffer) {
    var v = new DataView(buffer);
    function tag(at) { return String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3)); }
    if (buffer.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
    var channels = v.getUint16(22, true), rate = v.getUint32(24, true), bits = v.getUint16(34, true), data = v.getUint32(40, true);
    var frames = data / (channels * (bits / 8));
    return { channels: channels, sampleRate: rate, bits: bits, frames: frames, duration: rate ? frames / rate : 0 };
  }

  /* ---- how long a file is, read from its first bytes, before anything is decoded ---- */
  function cc(u, i) { return String.fromCharCode(u[i], u[i + 1], u[i + 2], u[i + 3]); }
  function be32(u, i) { return ((u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]) >>> 0; }
  function le32(u, i) { return (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16) | (u[i + 3] << 24)) >>> 0; }
  function le16(u, i) { return u[i] | (u[i + 1] << 8); }
  /* a WAV: the format chunk gives bytes a second, the data chunk gives the bytes */
  function wavProbe(u, fileSize) {
    if (!u || u.length < 12 || cc(u, 0) !== "RIFF" || cc(u, 8) !== "WAVE") return null;
    var at = 12, rate = 0, ch = 0, perSecond = 0, data = -1;
    while (at + 8 <= u.length) {
      var id = cc(u, at), len = le32(u, at + 4);
      if (id === "fmt " && at + 20 <= u.length) { ch = le16(u, at + 10); rate = le32(u, at + 12); perSecond = le32(u, at + 16); }
      else if (id === "data") {
        var rest = Math.max(0, (Number(fileSize) || u.length) - (at + 8));
        data = (!len || len > rest) ? rest : len;
        break;
      }
      at += 8 + len + (len & 1);
    }
    if (!rate || !perSecond) return null;
    if (data < 0) data = Math.max(0, (Number(fileSize) || u.length) - 44);
    return { duration: data / perSecond, sampleRate: rate, channels: ch || 1 };
  }
  /* the length of an ID3v2 tag at the head of an MP3, so the first audio frame can be found */
  function id3Size(u) {
    if (!u || u.length < 10 || u[0] !== 0x49 || u[1] !== 0x44 || u[2] !== 0x33) return 0;
    return 10 + (((u[6] & 127) << 21) | ((u[7] & 127) << 14) | ((u[8] & 127) << 7) | (u[9] & 127));
  }
  var MP3_RATES = { 0: [11025, 12000, 8000], 2: [22050, 24000, 16000], 3: [44100, 48000, 32000] };
  var MP3_KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  var MP3_KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  /* an MP3 (Layer III): the frame count if the encoder wrote one, otherwise bytes over bitrate.
     u starts at or after the ID3 tag; audioBytes is the file's size without that tag. */
  function mp3Probe(u, audioBytes) {
    if (!u) return null;
    for (var i = 0; i + 4 <= u.length; i++) {
      if (u[i] !== 0xFF || (u[i + 1] & 0xE0) !== 0xE0) continue;
      var ver = (u[i + 1] >> 3) & 3, layer = (u[i + 1] >> 1) & 3, br = u[i + 2] >> 4, sr = (u[i + 2] >> 2) & 3;
      if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) continue;
      var rate = MP3_RATES[ver][sr], kbps = (ver === 3 ? MP3_KBPS_V1 : MP3_KBPS_V2)[br], perFrame = ver === 3 ? 1152 : 576;
      var channels = (u[i + 3] >> 6) === 3 ? 1 : 2;
      for (var j = i + 4, end = Math.min(u.length - 12, i + 200); j < end; j++) {
        var t = cc(u, j);
        if ((t === "Xing" || t === "Info") && (u[j + 7] & 1)) {
          var frames = be32(u, j + 8);
          if (frames) return { duration: frames * perFrame / rate, sampleRate: rate, channels: channels };
        }
      }
      return { duration: Math.max(0, (Number(audioBytes) || u.length) - i) * 8 / (kbps * 1000), sampleRate: rate, channels: channels };
    }
    return null;
  }
  /* an M4A: the movie header's duration over its timescale. u is the start of the moov box's contents. */
  function mvhdProbe(u) {
    if (!u) return null;
    for (var j = 4; j + 32 <= u.length; j++) {
      if (cc(u, j) !== "mvhd") continue;
      var scale, dur;
      if (u[j + 4] === 1) { scale = be32(u, j + 24); dur = be32(u, j + 28) * 4294967296 + be32(u, j + 32); }
      else { scale = be32(u, j + 16); dur = be32(u, j + 20); }
      if (!scale) return null;
      /* the movie header does not name the audio's sample rate or channel count: stereo is assumed for the size check */
      return { duration: dur / scale, sampleRate: 0, channels: 2 };
    }
    return null;
  }
  /* why a file of this length cannot be opened, or "" when it can */
  function tooLong(info, fallbackRate) {
    if (!info || !(info.duration > 0)) return "";
    if (info.duration > MAX_SECONDS) {
      return "That file is " + Math.round(info.duration / 60) + " minutes long. The take bench opens up to 30 minutes at a time.";
    }
    var floats = info.duration * (info.sampleRate || fallbackRate || 48000) * (info.channels || 2) * 4;
    if (floats > MAX_FLOAT_BYTES) {
      return "That file is " + Math.round(info.duration / 60) + " minutes of " + ((info.channels || 2) > 1 ? "stereo" : "mono") +
        ", which is more than a browser tab can hold open to edit. Cut it into shorter parts first, or choose the finished file under Releases.";
    }
    return "";
  }

  /* min/max pairs, one per column, across all channels */
  function peaks(channels, columns) {
    var out = new Float32Array(columns * 2);
    var frames = channels.length ? channels[0].length : 0;
    if (!frames || !columns) return out;
    var per = frames / columns;
    for (var x = 0; x < columns; x++) {
      var a = Math.floor(x * per), b = Math.max(a + 1, Math.floor((x + 1) * per));
      /* at most ~200 samples a column: plenty for a picture, quick on a long file */
      var step = Math.max(1, Math.floor((b - a) / 200));
      var lo = 0, hi = 0;
      for (var c = 0; c < channels.length; c++) {
        var d = channels[c];
        for (var i = a; i < b && i < frames; i += step) { var s = d[i]; if (s < lo) lo = s; if (s > hi) hi = s; }
      }
      out[x * 2] = lo; out[x * 2 + 1] = hi;
    }
    return out;
  }

  function safeName(name) {
    var s = String(name || "").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return s || "Take";
  }
  function stem(fileName) { return safeName(String(fileName || "").replace(/\.[a-z0-9]{1,5}$/i, "")); }

  /* the session document a take carries: one track, one clip */
  function sessionDoc(take) {
    return {
      version: 1,
      sampleRate: take.sampleRate,
      tracks: [{ id: "t1", name: take.name, gainDb: 0, clips: [{ id: "c1", take: take.id, at: 0, offset: 0, duration: take.duration }] }]
    };
  }

  var PURE = {
    MIN_REGION: MIN_REGION, MAX_SECONDS: MAX_SECONDS, MAX_FLOAT_BYTES: MAX_FLOAT_BYTES, PREVIEW_MAX_BYTES: PREVIEW_MAX_BYTES,
    clamp: clamp, dbToGain: dbToGain, clock: clock, region: region, envelope: envelope,
    encodeWav: encodeWav, encodeRegion: encodeRegion, regionFrames: regionFrames, wavInfo: wavInfo,
    wavProbe: wavProbe, id3Size: id3Size, mp3Probe: mp3Probe, mvhdProbe: mvhdProbe, tooLong: tooLong,
    peaks: peaks, safeName: safeName, stem: stem, sessionDoc: sessionDoc
  };
  if (typeof module === "object" && module && module.exports) module.exports = PURE;
  var w = root, d = root && root.document;
  if (!d || !d.getElementById) return;

  /* ------------------------------------------------------------------
     The bench
     ------------------------------------------------------------------ */
  var mount = d.getElementById("takeBenchMount");
  if (!mount) return;
  var $ = function (id) { return d.getElementById(id); };
  var AC = w.AudioContext || w.webkitAudioContext;
  var OAC = w.OfflineAudioContext || w.webkitOfflineAudioContext;

  mount.innerHTML =
    '<div class="tb__col">' +
      '<div class="tb-start">' +
        '<button type="button" class="creator-btn primary tb-rec" id="tbRecord"><span class="tb-dot" aria-hidden="true"></span><span id="tbRecordLabel">Record</span></button>' +
        '<button type="button" class="creator-btn quiet" id="tbImport">Import a file</button>' +
        '<input type="file" class="tb-file" id="tbFile" tabindex="-1" aria-label="Import an audio file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a">' +
      '</div>' +
      '<p class="tb-hint" id="tbFormats">Import takes MP3, WAV or M4A. Nothing here is uploaded.</p>' +
      '<div class="tb-live" id="tbLive" hidden>' +
        '<div class="tb-live__row"><span class="tb-live__dot" aria-hidden="true"></span><b>Recording</b><span class="tb-num" id="tbRecTime">0:00.00</span></div>' +
        '<div class="tb-meter" id="tbMeter" role="meter" aria-label="Microphone input level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="tbMeterBar"></span></div>' +
        '<p class="tb-hint">Keep this tab open and the screen awake. Press Stop when you are done.</p>' +
      '</div>' +
      '<p class="creator-status" id="tbStatus" role="status" aria-live="polite"></p>' +
      '<p class="tb-error" id="tbError" role="alert" hidden></p>' +
      '<p class="tb-empty" id="tbEmpty">No take open. Record with your microphone or import a file, and its waveform appears here to trim.</p>' +
      '<div class="tb-editor" id="tbEditor" hidden>' +
        '<div class="creator-field"><label for="tbName">Take name</label><input id="tbName" maxlength="80" autocomplete="off"></div>' +
        '<div class="tb-wave" id="tbWave" role="group" aria-label="Waveform. Drag the two handles to trim.">' +
          '<canvas id="tbCanvas" aria-hidden="true"></canvas>' +
          '<div class="tb-shade tb-shade--a" id="tbShadeA"></div><div class="tb-shade tb-shade--b" id="tbShadeB"></div>' +
          '<div class="tb-playhead" id="tbPlayhead" hidden></div>' +
          '<div class="tb-handle tb-handle--start" id="tbHandleStart" role="slider" tabindex="0" aria-label="Trim start" aria-orientation="horizontal"></div>' +
          '<div class="tb-handle tb-handle--end" id="tbHandleEnd" role="slider" tabindex="0" aria-label="Trim end" aria-orientation="horizontal"></div>' +
        '</div>' +
        '<div class="tb-times"><span>At <b class="tb-num" id="tbPos">0:00.00</b></span><span>Length <b class="tb-num" id="tbLen">0:00.00</b></span></div>' +
        '<div class="tb-transport">' +
          '<button type="button" class="creator-btn primary" id="tbPlay">Play</button>' +
          '<button type="button" class="creator-btn quiet" id="tbStop">Stop</button>' +
        '</div>' +
        '<div class="tb-grid">' +
          '<div class="creator-field"><label for="tbStart">Start (seconds)</label><input class="tb-num" id="tbStart" type="number" inputmode="decimal" min="0" step="0.01"></div>' +
          '<div class="creator-field"><label for="tbEnd">End (seconds)</label><input class="tb-num" id="tbEnd" type="number" inputmode="decimal" min="0" step="0.01"></div>' +
          '<div class="creator-field tb-range tb-span"><label for="tbFadeIn">Fade in</label><output class="tb-num" id="tbFadeInOut" for="tbFadeIn">0.00 s</output><input id="tbFadeIn" type="range" min="0" max="5" step="0.05" value="0"></div>' +
          '<div class="creator-field tb-range tb-span"><label for="tbFadeOut">Fade out</label><output class="tb-num" id="tbFadeOutOut" for="tbFadeOut">0.00 s</output><input id="tbFadeOut" type="range" min="0" max="5" step="0.05" value="0"></div>' +
        '</div>' +
        '<div class="creator-actions">' +
          '<button type="button" class="creator-btn primary" id="tbSave">Save take</button>' +
          '<button type="button" class="creator-btn quiet" id="tbClose">Close</button>' +
        '</div>' +
        '<p class="tb-hint" id="tbFormat"></p>' +
      '</div>' +
    '</div>' +
    '<div class="tb__col">' +
      '<h3 class="tb-h3" id="tbTakesHeading">Your takes</h3>' +
      '<p class="tb-hint" id="tbTakesNote">Kept in this browser, on this device only. Clearing site data deletes them.</p>' +
      '<ul class="tb-takes" id="tbTakes" aria-labelledby="tbTakesHeading"></ul>' +
      '<p class="tb-empty" id="tbTakesEmpty">No takes yet. Save one and it is listed here, ready to use in a release.</p>' +
    '</div>';

  /* A recording does not stop when another chapter is opened, so it must stay in sight there: this strip sits
     under the chapter row, outside the Make panel, only while a recording runs and Make is not the open chapter. */
  var stripEl = null;
  (function () {
    var row = d.getElementById("creatorChapters");
    if (!row || !row.parentNode) return;
    stripEl = d.createElement("div");
    stripEl.className = "tb-strip"; stripEl.id = "tbRecStrip"; stripEl.hidden = true;
    stripEl.setAttribute("role", "group");
    stripEl.setAttribute("aria-label", "Recording in progress");
    stripEl.innerHTML =
      '<span class="tb-live__dot" aria-hidden="true"></span>' +
      '<b id="tbStripSay" role="status"></b><span class="tb-num" id="tbStripTime">0:00.00</span>' +
      '<button type="button" class="creator-btn primary" id="tbStripStop">Stop recording</button>';
    row.parentNode.insertBefore(stripEl, row.nextSibling);
  })();

  var S = {
    buffer: null, name: "", start: 0, end: 0, fadeIn: 0, fadeOut: 0,
    pos: 0, playing: false, src: null, gain: null, t0: 0, raf: 0,
    recording: false, pending: false, busy: false,
    takes: [], volatile: false, peaks: null, peaksFor: 0
  };
  var ctx = null, restTimer = 0;
  function audio() {
    if (!AC) throw new Error("no-audio");
    w.clearTimeout(restTimer);
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended" && ctx.resume) { try { ctx.resume(); } catch (_) {} }
    return ctx;
  }
  /* the audio session is given back whenever nothing is sounding and nothing is being recorded */
  function rest() {
    w.clearTimeout(restTimer);
    restTimer = w.setTimeout(function () {
      if (!ctx || S.playing || S.recording || S.pending) return;
      if (ctx.state === "running" && ctx.suspend) { try { ctx.suspend(); } catch (_) {} }
    }, 300);
  }

  /* ---------- messages ---------- */
  function say(text) { $("tbStatus").textContent = text || ""; }
  function fail(text) {
    var el = $("tbError");
    el.textContent = text || "";
    el.hidden = !text;
  }

  /* ---------- only one thing sounds ---------- */
  function quietSite() {
    try { if (w.MCC_MUSIC && typeof w.MCC_MUSIC.pause === "function") w.MCC_MUSIC.pause(); } catch (_) {}
    try {
      Array.prototype.forEach.call(d.querySelectorAll("audio,video"), function (m) { if (!m.paused) m.pause(); });
    } catch (_) {}
  }
  w.addEventListener("mcc:music-state", function (e) {
    if (e && e.detail && e.detail.playing && S.playing) pause();
  });
  /* any media element on the page that starts while the bench is sounding takes over (media events do not
     bubble, so this listens on the way down) */
  d.addEventListener("play", function () { if (S.playing) pause(); }, true);

  /* ---------- decode ---------- */
  /* Decoding uses an offline context at the file's own sample rate, so an imported file is not resampled to
     whatever rate this device's speakers run at. It also needs no permission to make sound. */
  function decodeContext(rate) {
    rate = Math.round(Number(rate) || (ctx && ctx.sampleRate) || 48000);
    if (OAC) {
      try { return new OAC(1, 1, rate); } catch (_) {}
      try { return new OAC(1, 1, 48000); } catch (_) {}
    }
    return audio();
  }
  function decodeIn(c, arrayBuffer) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var p = c.decodeAudioData(arrayBuffer, function (b) { done = true; resolve(b); }, function (e) { done = true; reject(e || new Error("decode")); });
      if (p && typeof p.then === "function") p.then(function (b) { if (!done) resolve(b); }, function (e) { if (!done) reject(e); });
    });
  }
  /* What this browser's decoder turns the largest 16-bit sample into, measured once on 64 samples of silence-free
     WAV made here: 1 means it divides positive samples by 32767, anything else by 32768. The WAV writer uses
     the same number, so trimming a 16-bit file does not change a single sample. */
  var POS = 32768, calibrated = null;
  function calibrate() {
    if (calibrated) return calibrated;
    var top = new Float32Array(64);
    for (var i = 0; i < top.length; i++) top[i] = 32767 / 32768;
    calibrated = decodeIn(decodeContext(44100), encodeWav([top], 44100)).then(function (b) {
      var f = b && b.length > 40 ? b.getChannelData(0)[32] : 0;
      if (f > 0.9999 && f < 1.0001) POS = Math.round(32767 / f) === 32767 ? 32767 : 32768;
    }).catch(function () {});
    return calibrated;
  }
  function decode(arrayBuffer, rate) {
    return calibrate().then(function () { return decodeIn(decodeContext(rate), arrayBuffer); });
  }
  function readFile(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error("read")); };
      r.readAsArrayBuffer(file);
    });
  }
  function bytesOf(file, from, to) {
    return readFile(file.slice(from, Math.min(file.size, to))).then(function (ab) { return new Uint8Array(ab); });
  }
  /* an M4A is a list of boxes; the movie box may be at the end, so each box header is read on its own */
  function walkBoxes(file, pos, n) {
    if (n > 64 || pos + 8 > file.size) return Promise.resolve(null);
    return bytesOf(file, pos, pos + 16).then(function (u) {
      var size = be32(u, 0), type = cc(u, 4), head = 8;
      if (size === 1 && u.length >= 16) { size = be32(u, 8) * 4294967296 + be32(u, 12); head = 16; }
      else if (size === 0) size = file.size - pos;
      if (size < head) return null;
      if (type === "moov") return bytesOf(file, pos + head, pos + Math.min(size, 8192)).then(mvhdProbe);
      return walkBoxes(file, pos + size, n + 1);
    });
  }
  /* length, sample rate and channels from the file's header; null when the header cannot be read */
  function probeFile(file) {
    if (!file || !file.slice) return Promise.resolve(null);
    return bytesOf(file, 0, 65536).then(function (head) {
      if (head.length >= 12 && cc(head, 0) === "RIFF") return wavProbe(head, file.size);
      if (head.length >= 12 && cc(head, 4) === "ftyp") return walkBoxes(file, 0, 0);
      var skip = id3Size(head);
      if (!skip) return mp3Probe(head, file.size);
      return bytesOf(file, skip, skip + 16384).then(function (u) { return mp3Probe(u, file.size - skip); });
    }).catch(function () { return null; });
  }

  /* ---------- import ---------- */
  function importFile(file) {
    fail("");
    if (!file) return Promise.resolve(false);
    if (S.recording || S.pending) { fail("Stop the recording first, then import."); return Promise.resolve(false); }
    if (!AC) { fail("This browser cannot open audio here, so the take bench cannot run."); return Promise.resolve(false); }
    var looksAudio = /^audio\//i.test(file.type || "") || /\.(mp3|wav|m4a)$/i.test(file.name || "");
    if (!looksAudio) { fail("That is not an audio file the bench can open. Choose an MP3, WAV or M4A."); return Promise.resolve(false); }
    if (file.size > MAX_FILE_BYTES) { fail("That file is over 300 MB, which is more than the bench can open in a browser."); return Promise.resolve(false); }
    if (!file.size) { fail("That file is empty."); return Promise.resolve(false); }
    stopPlayback();
    setBusy(true);
    say("Opening " + (file.name || "the file") + "…");
    return probeFile(file).then(function (info) {
      /* refused from the header, before any of it is decoded */
      var why = tooLong(info, ctx && ctx.sampleRate);
      if (why) { setBusy(false); say(""); fail(why); return false; }
      return readFile(file).then(function (ab) { return decode(ab, info && info.sampleRate); }).then(function (buffer) {
        setBusy(false);
        if (!buffer || !buffer.length) throw new Error("empty");
        /* the header could not be read, or was wrong: the decoded length is the last word */
        var late = tooLong({ duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels });
        if (late) { say(""); fail(late); return false; }
        open(buffer, stem(file.name));
        say("Opened “" + S.name + "”, " + clock(buffer.duration) + ". Drag the handles to trim it.");
        return true;
      });
    }).catch(function () {
      setBusy(false);
      say("");
      fail("This browser could not read that file as audio. Try an MP3, a WAV or an M4A.");
      return false;
    });
  }

  /* ---------- the editor ---------- */
  function open(buffer, name) {
    stopPlayback();
    S.buffer = buffer;
    S.name = safeName(name);
    S.start = 0; S.end = buffer.duration; S.fadeIn = 0; S.fadeOut = 0; S.pos = 0;
    S.peaks = null; S.peaksFor = 0;
    $("tbName").value = S.name;
    $("tbFadeIn").value = "0"; $("tbFadeOut").value = "0";
    $("tbFormat").textContent = "Save take writes a 16-bit WAV at this take's own rate (" + buffer.sampleRate.toLocaleString() + " Hz, " +
      (buffer.numberOfChannels > 1 ? "stereo" : "mono") + "). For a 24-bit master, choose the finished file under Releases instead.";
    $("tbEmpty").hidden = true;
    $("tbEditor").hidden = false;
    sync();
    draw();
  }
  function close() {
    stopPlayback();
    S.buffer = null; S.peaks = null;
    $("tbEditor").hidden = true;
    $("tbEmpty").hidden = false;
    say("");
  }
  function reg() { return region(S.buffer ? S.buffer.duration : 0, S.start, S.end, S.fadeIn, S.fadeOut); }

  function setTrim(start, end, which) {
    if (!S.buffer) return;
    var dur = S.buffer.duration, min = Math.min(MIN_REGION, dur);
    if (which === "start") { S.start = clamp(start, 0, Math.max(0, S.end - min)); }
    else if (which === "end") { S.end = clamp(end, Math.min(dur, S.start + min), dur); }
    else { var r = region(dur, start, end, 0, 0); S.start = r.start; S.end = r.end; }
    if (S.playing) pause();
    S.pos = clamp(S.pos, S.start, S.end);
    sync();
    draw();
  }

  function sync() {
    if (!S.buffer) return;
    var dur = S.buffer.duration, r = reg(), min = Math.min(MIN_REGION, dur);
    var a = dur ? (r.start / dur) * 100 : 0, b = dur ? (r.end / dur) * 100 : 100;
    $("tbShadeA").style.width = a + "%";
    $("tbShadeB").style.width = (100 - b) + "%";
    var hs = $("tbHandleStart"), he = $("tbHandleEnd");
    hs.style.left = a + "%"; he.style.left = b + "%";
    /* each handle's range is what it can reach: the other handle is its limit */
    hs.setAttribute("aria-valuemin", "0"); hs.setAttribute("aria-valuemax", Math.max(0, r.end - min).toFixed(2));
    hs.setAttribute("aria-valuenow", r.start.toFixed(2)); hs.setAttribute("aria-valuetext", clock(r.start));
    he.setAttribute("aria-valuemin", Math.min(dur, r.start + min).toFixed(2)); he.setAttribute("aria-valuemax", dur.toFixed(2));
    he.setAttribute("aria-valuenow", r.end.toFixed(2)); he.setAttribute("aria-valuetext", clock(r.end));
    var si = $("tbStart"), ei = $("tbEnd");
    si.max = dur.toFixed(2); ei.max = dur.toFixed(2);
    if (d.activeElement !== si) si.value = r.start.toFixed(2);
    if (d.activeElement !== ei) ei.value = r.end.toFixed(2);
    $("tbLen").textContent = clock(r.length);
    $("tbFadeInOut").textContent = r.fadeIn.toFixed(2) + " s";
    $("tbFadeOutOut").textContent = r.fadeOut.toFixed(2) + " s";
    head();
  }
  function head() {
    if (!S.buffer) return;
    var dur = S.buffer.duration, p = clamp(S.pos, 0, dur);
    $("tbPos").textContent = clock(p);
    var ph = $("tbPlayhead");
    ph.hidden = !(S.playing || (p > S.start + 0.005 && p < S.end - 0.005));
    ph.style.left = (dur ? (p / dur) * 100 : 0) + "%";
  }

  /* the waveform's colours come from the Music V2 tokens; if one is missing it is drawn in the text colour
     the waveform box already has, never in a colour written here */
  function token(name, box) {
    var v = "";
    try { v = w.getComputedStyle(d.body).getPropertyValue(name); } catch (_) {}
    v = v && v.trim();
    if (v) return v;
    try { return w.getComputedStyle(box).color; } catch (_) { return "currentColor"; }
  }
  function draw() {
    var cv = $("tbCanvas"), box = $("tbWave");
    if (!S.buffer || !cv || !box.clientWidth) return;
    var dpr = Math.min(3, w.devicePixelRatio || 1);
    var W = Math.max(1, Math.round(box.clientWidth * dpr)), H = Math.max(1, Math.round(box.clientHeight * dpr));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    var cols = Math.max(1, Math.floor(W / Math.max(1, Math.round(dpr))));
    if (!S.peaks || S.peaksFor !== cols) {
      var ch = [];
      for (var c = 0; c < S.buffer.numberOfChannels; c++) ch.push(S.buffer.getChannelData(c));
      S.peaks = peaks(ch, cols); S.peaksFor = cols;
    }
    var g = cv.getContext("2d");
    g.clearRect(0, 0, W, H);
    var dur = S.buffer.duration, r = reg(), mid = H / 2, colW = W / cols;
    var inside = token("--music-text", box), outside = token("--music-faint", box);
    g.fillStyle = token("--music-border", box);
    g.fillRect(0, Math.round(mid), W, 1);
    for (var x = 0; x < cols; x++) {
      var t = ((x + 0.5) / cols) * dur;
      var on = t >= r.start && t <= r.end;
      /* inside the trim the picture is drawn through the fades, so a fade can be seen as well as heard */
      var k = on ? envelope(t - r.start, r.length, r.fadeIn, r.fadeOut) : 1;
      var lo = S.peaks[x * 2] * k, hi = S.peaks[x * 2 + 1] * k;
      var y0 = mid - hi * mid * 0.92, y1 = mid - lo * mid * 0.92;
      g.fillStyle = on ? inside : outside;
      g.fillRect(x * colW, y0, Math.max(1, colW - (colW > 2 ? 1 : 0)), Math.max(1, y1 - y0));
    }
  }

  /* ---------- playback of the trimmed region ---------- */
  /* the same envelope the WAV is written through, scheduled on a gain */
  function schedule(param, when, r, from) {
    var rel = clamp(from - r.start, 0, r.length);
    var v0 = envelope(rel, r.length, r.fadeIn, r.fadeOut);
    param.cancelScheduledValues(0);
    param.setValueAtTime(v0, when);
    if (r.fadeIn > 0 && rel < r.fadeIn) param.linearRampToValueAtTime(1, when + (r.fadeIn - rel));
    if (r.fadeOut > 0) {
      var out = r.length - r.fadeOut;
      if (rel < out) param.setValueAtTime(1, when + (out - rel));
      param.linearRampToValueAtTime(0, when + (r.length - rel));
    }
  }
  function play() {
    if (!S.buffer || S.recording || S.busy) return;
    var c;
    try { c = audio(); } catch (_) { fail("This browser cannot play audio here."); return; }
    stopSource();
    quietSite();
    var r = reg();
    var from = (S.pos >= r.start && S.pos < r.end - 0.02) ? S.pos : r.start;
    var src = c.createBufferSource(), gain = c.createGain();
    src.buffer = S.buffer;
    src.connect(gain); gain.connect(c.destination);
    var when = c.currentTime + 0.02;
    schedule(gain.gain, when, r, from);
    src.onended = function () {
      if (S.src !== src) return;
      S.src = null; S.gain = null;
      S.pos = reg().start;
      setPlaying(false);
    };
    src.start(when, from, Math.max(0.01, r.end - from));
    S.src = src; S.gain = gain; S.t0 = when - from;
    setPlaying(true);
    tick();
  }
  function tick() {
    w.cancelAnimationFrame(S.raf);
    if (!S.playing || !ctx) return;
    S.pos = clamp(ctx.currentTime - S.t0, S.start, S.end);
    head();
    S.raf = w.requestAnimationFrame(tick);
  }
  function stopSource() {
    var src = S.src;
    S.src = null; S.gain = null;
    if (src) { src.onended = null; try { src.stop(0); } catch (_) {} try { src.disconnect(); } catch (_) {} }
  }
  function pause() {
    if (S.playing && ctx) S.pos = clamp(ctx.currentTime - S.t0, S.start, S.end);
    stopSource();
    setPlaying(false);
  }
  function stopPlayback() {
    stopSource();
    S.pos = S.start;
    setPlaying(false);
  }
  function setPlaying(on) {
    S.playing = !!on;
    if (!on) { w.cancelAnimationFrame(S.raf); rest(); }
    /* the name says what a press does; there is no pressed state to contradict it */
    $("tbPlay").textContent = on ? "Pause" : "Play";
    head();
  }

  /* ---------- write the WAV ---------- */
  /* straight from the buffer, a slice at a time, so the page stays alive and there is never a second decoded copy */
  function render(buffer, r) {
    if (!buffer) return Promise.reject(new Error("nothing"));
    var ch = [];
    for (var c = 0; c < buffer.numberOfChannels; c++) ch.push(buffer.getChannelData(c));
    var rf = regionFrames(buffer.length, buffer.sampleRate, r);
    var parts = [wavHeader(ch.length, buffer.sampleRate, rf.frames)], at = 0, STEP = 1 << 21;
    return new Promise(function (resolve, reject) {
      (function step() {
        try {
          var to = Math.min(rf.frames, at + STEP);
          parts.push(pcm16(ch, rf, at, to, POS));
          at = to;
          if (at < rf.frames) { w.setTimeout(step, 0); return; }
          var blob = new Blob(parts, { type: "audio/wav" });
          resolve({ data: blob, bytes: blob.size, duration: rf.frames / buffer.sampleRate, sampleRate: buffer.sampleRate, channels: ch.length });
        } catch (e) { reject(e); }
      })();
    });
  }

  /* ---------- takes on this device (IndexedDB) ----------
     takes: what the list shows (no audio).  audio: one Blob per take, read on demand.
     rec: the pieces of a recording in progress, so a reload or a closed tab does not lose it. */
  var DB_NAME = "mcc-creator-takes", DB_VERSION = 2, STORE = "takes", AUDIO = "audio", RECS = "rec";
  var DB_WAIT_MS = 8000;
  var dbp = null, memory = [];
  function owner() {
    try { return String((w.MCC && typeof w.MCC.account === "function" && w.MCC.account()) || ""); } catch (_) { return ""; }
  }
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var idb = w.indexedDB;
      if (!idb) { reject(new Error("no-idb")); return; }
      var req, settled = false;
      /* a database that never answers must not lock the bench: after a wait, takes are held in the tab instead */
      var timer = w.setTimeout(function () { if (!settled) { settled = true; reject(new Error("idb-timeout")); } }, DB_WAIT_MS);
      function no(e) { if (settled) return; settled = true; w.clearTimeout(timer); reject(e); }
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { no(e); return; }
      req.onupgradeneeded = function (ev) {
        var x = req.result;
        if (!x.objectStoreNames.contains(STORE)) x.createObjectStore(STORE, { keyPath: "id" });
        if (!x.objectStoreNames.contains(AUDIO)) x.createObjectStore(AUDIO, { keyPath: "id" });
        if (!x.objectStoreNames.contains(RECS)) x.createObjectStore(RECS, { autoIncrement: true });
        /* version 1 kept each take's audio inside its list record: move it out, once */
        if (ev.oldVersion === 1) {
          var takes = req.transaction.objectStore(STORE), sound = req.transaction.objectStore(AUDIO);
          takes.openCursor().onsuccess = function (e) {
            var cur = e.target.result;
            if (!cur) return;
            var v = cur.value;
            if (v && v.data) {
              sound.put({ id: v.id, data: new Blob([v.data], { type: "audio/wav" }) });
              delete v.data;
              cur.update(v);
            }
            cur.continue();
          };
        }
      };
      req.onsuccess = function () {
        if (settled) { try { req.result.close(); } catch (_) {} return; }
        settled = true; w.clearTimeout(timer);
        resolve(req.result);
      };
      req.onerror = function () { no(req.error || new Error("idb")); };
      req.onblocked = function () { no(new Error("idb-blocked")); };
    });
    dbp.catch(function () {});
    return dbp;
  }
  function tx(stores, mode, work) {
    return db().then(function (x) {
      return new Promise(function (resolve, reject) {
        var t = x.transaction(stores, mode), out;
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error || new Error("idb")); };
        t.onabort = function () { reject(t.error || new Error("idb-abort")); };
        var req = work(t);
        if (req) req.onsuccess = function () { out = req.result; };
      });
    });
  }
  function mine(list) {
    var me = owner();
    return (list || []).filter(function (t) { return (t.owner || "") === me; })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  }
  /* the list: metadata from the database, plus any take this tab is holding because it could not be written */
  function loadTakes() {
    return tx([STORE], "readonly", function (t) { return t.objectStore(STORE).getAll(); }).then(function (all) {
      S.volatile = false;
      S.takes = mine((all || []).concat(memory));
    }, function () {
      S.volatile = true;
      S.takes = mine(memory);
    }).then(listTakes);
  }
  function hold(take, blob) {
    take.local = true; take.data = blob;
    memory.push(take);
    return false;
  }
  function putTake(take, blob) {
    if (S.volatile) return Promise.resolve(hold(take, blob));
    return tx([STORE, AUDIO], "readwrite", function (t) {
      t.objectStore(AUDIO).put({ id: take.id, data: blob });
      return t.objectStore(STORE).put(take);
    }).then(function () { return true; }, function (err) {
      if (err && /quota/i.test(String(err.name || err.message || ""))) throw err;
      /* the write failed for another reason: the take is held in this tab, and the list says so */
      return hold(take, blob);
    });
  }
  /* a take's audio, read only when it is needed */
  function dataOf(take) {
    if (!take) return Promise.reject(new Error("gone"));
    if (take.data) return Promise.resolve(take.data);
    return tx([AUDIO], "readonly", function (t) { return t.objectStore(AUDIO).get(take.id); }).then(function (rec) {
      if (!rec || !rec.data) throw new Error("gone");
      return rec.data instanceof Blob ? rec.data : new Blob([rec.data], { type: "audio/wav" });
    });
  }
  function dropTake(id) {
    var held = memory.some(function (t) { return t.id === id; });
    memory = memory.filter(function (t) { return t.id !== id; });
    if (S.volatile || held) return Promise.resolve();
    return tx([STORE, AUDIO], "readwrite", function (t) { t.objectStore(AUDIO).delete(id); return t.objectStore(STORE).delete(id); });
  }
  function newId() {
    try { if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID(); } catch (_) {}
    return "take-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function keep(rendered, name) {
    var take = {
      id: newId(), owner: owner(), name: safeName(name), duration: rendered.duration,
      sampleRate: rendered.sampleRate, channels: rendered.channels, bytes: rendered.bytes,
      createdAt: new Date().toISOString(), format: "wav"
    };
    take.session = sessionDoc(take);
    return putTake(take, rendered.data).then(function (stored) {
      return loadTakes().then(function () { return { take: take, stored: stored }; });
    });
  }

  function when(iso) {
    try { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); }
    catch (_) { return String(iso || ""); }
  }
  function size(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
  }
  function listTakes() {
    var ul = $("tbTakes");
    ul.replaceChildren();
    var someHeld = S.takes.some(function (t) { return t.local; });
    $("tbTakesNote").textContent = S.volatile
      ? "This browser is not letting the studio keep takes (private browsing, or storage is blocked). They last only until this tab closes: download any you want."
      : someHeld
        ? "This browser could not keep every take. Any marked “Until this tab closes” is lost when the tab closes: download it. The others are kept in this browser, on this device only."
        : "Kept in this browser, on this device only. Clearing site data deletes them.";
    $("tbTakesEmpty").hidden = S.takes.length > 0;
    S.takes.forEach(function (t) {
      var li = d.createElement("li");
      li.className = "tb-take";
      li.setAttribute("data-take", t.id);
      var who = d.createElement("div");
      var b = d.createElement("b"); b.textContent = t.name;
      var meta = d.createElement("span"); meta.className = "tb-take__meta tb-num";
      meta.textContent = clock(t.duration) + " · " + when(t.createdAt) + " · WAV, " + size(t.bytes) + " · " + ((S.volatile || t.local) ? "Until this tab closes" : "On this device only");
      who.appendChild(b); who.appendChild(meta);
      if (t.bytes > PREVIEW_MAX_BYTES) {
        var big = d.createElement("span"); big.className = "tb-take__meta";
        big.textContent = "Over 50 MB: a release that uses this as its master also needs a shorter preview file.";
        who.appendChild(big);
      }
      var acts = d.createElement("div"); acts.className = "tb-take__actions";
      [["use", "Use in a release", "creator-btn primary tb-use", "Use “" + t.name + "” in a release"],
       ["preview", "Use as preview", "creator-btn quiet", "Use “" + t.name + "” as the preview in a release"],
       ["open", "Open", "creator-btn quiet", "Open “" + t.name + "”"],
       ["download", "Download", "creator-btn quiet", "Download “" + t.name + "”"],
       ["delete", "Delete", "creator-btn quiet", "Delete “" + t.name + "”"]].forEach(function (a) {
        var btn = d.createElement("button");
        btn.type = "button"; btn.className = a[2]; btn.textContent = a[1];
        btn.setAttribute("data-take-act", a[0]);
        btn.setAttribute("aria-label", a[3]);
        acts.appendChild(btn);
      });
      li.appendChild(who); li.appendChild(acts);
      ul.appendChild(li);
    });
  }
  function takeById(id) { for (var i = 0; i < S.takes.length; i++) if (S.takes[i].id === id) return S.takes[i]; return null; }
  function fileOf(take) {
    var name = safeName(take.name).replace(/\s+/g, "-") + ".wav";
    return dataOf(take).then(function (blob) {
      return new File([blob], name, { type: "audio/wav", lastModified: Date.parse(take.createdAt) || Date.now() });
    });
  }

  /* ---------- hand a take to the release form ---------- */
  var autoTitle = "";
  function handoffNote(input, id) {
    var note = d.getElementById(id);
    if (note) return note;
    note = d.createElement("p");
    note.id = id; note.className = "cs-handoff";
    note.setAttribute("role", "status");
    input.parentNode.appendChild(note);
    if (input.form) input.form.addEventListener("reset", function () { note.hidden = true; });
    input.addEventListener("change", function (e) { if (e.isTrusted) note.hidden = true; });
    return note;
  }
  /* slot "master" (the default) fills the release's master audio; slot "preview" fills its public preview */
  function useInRelease(id, slot) {
    fail("");
    var preview = slot === "preview";
    var take = takeById(id), input = preview ? d.getElementById("trackPreview") : d.getElementById("trackMaster");
    if (!take) { fail("That take is no longer on this device."); return Promise.resolve(false); }
    if (!input) { fail("The release form is not on this page."); return Promise.resolve(false); }
    if (preview && take.bytes > PREVIEW_MAX_BYTES) {
      fail("“" + take.name + "” is " + size(take.bytes) + ". A preview can be 50 MB at most. Open the take, trim a shorter part, save it, and use that as the preview.");
      return Promise.resolve(false);
    }
    return fileOf(take).then(function (file) {
      var placed = false;
      try {
        var dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        placed = input.files && input.files.length === 1 && input.files[0].size === file.size;
      } catch (_) { placed = false; }
      if (!placed) {
        fail("This browser will not let the studio place a file in the form for you. Press Download, then choose that WAV under Releases.");
        return false;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      var what = "From your takes: " + file.name + " (" + clock(take.duration) + ", " + size(take.bytes) + "). ";
      var note = handoffNote(input, preview ? "tbHandoffPreview" : "tbHandoff");
      note.hidden = false;
      if (preview) {
        note.textContent = what + "This is the clip the public hears. It is uploaded only when you submit this release.";
      } else {
        /* the title follows the take while it is still the one the bench put there */
        var title = d.getElementById("trackTitle");
        if (title && (!title.value || title.value === autoTitle)) {
          title.value = take.name; autoTitle = take.name;
          title.dispatchEvent(new Event("input", { bubbles: true }));
        }
        note.textContent = what + "It is uploaded only when you submit this release." + (take.bytes > PREVIEW_MAX_BYTES
          ? " This WAV is over 50 MB, the most the file listeners hear can be: add a shorter preview file below, or the form will refuse a public release that has none."
          : "");
      }
      stopPlayback();
      say("“" + take.name + "” is in the release form as the " + (preview ? "preview" : "master") + " audio.");
      if (w.MCC_STUDIO_SHELL && w.MCC_STUDIO_SHELL.go) w.MCC_STUDIO_SHELL.go("releases", { keepScroll: true });
      else { try { w.location.hash = "releases"; } catch (_) {} }
      try { input.scrollIntoView({ block: "center" }); input.focus({ preventScroll: true }); } catch (_) {}
      return true;
    }, function () {
      fail("That take's audio could not be read on this device.");
      return false;
    });
  }
  function download(id) {
    var take = takeById(id);
    if (!take) { fail("That take is no longer on this device."); return Promise.resolve(false); }
    return fileOf(take).then(function (file) {
      var url = URL.createObjectURL(file), a = d.createElement("a");
      a.href = url; a.download = file.name; a.hidden = true;
      d.body.appendChild(a); a.click(); a.remove();
      w.setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      return true;
    }, function () { fail("That take could not be prepared for download."); return false; });
  }
  function openTake(id) {
    var take = takeById(id);
    if (!take) return Promise.resolve(false);
    fail("");
    if (S.recording || S.pending) { fail("Stop the recording first."); return Promise.resolve(false); }
    if (S.busy) return Promise.resolve(false);
    setBusy(true);
    return dataOf(take).then(readFile).then(function (ab) { return decode(ab, take.sampleRate); }).then(function (buffer) {
      setBusy(false);
      open(buffer, take.name);
      say("Opened “" + take.name + "” to trim again. Saving makes a new take; this one stays.");
      try { $("tbName").focus(); } catch (_) {}
      return true;
    }, function () {
      setBusy(false);
      fail("That take could not be opened.");
      return false;
    });
  }

  /* ---------- save the open take ---------- */
  function saved(res) {
    return "Saved “" + res.take.name + "”, " + clock(res.take.duration) +
      (res.stored ? ", on this device." : ". This browser is not keeping takes, so download it before closing the tab.");
  }
  function saveError(err) {
    if (err && /quota/i.test(String(err.name || err.message || ""))) return "This device is out of room for another take. Delete one, or download and remove older takes.";
    return "The take could not be made. Nothing was changed.";
  }
  function save(opts) {
    opts = opts || {};
    if (!S.buffer || S.busy) return Promise.resolve(null);
    fail("");
    stopPlayback();
    setBusy(true);
    say("Making the WAV. Keep this tab open…");
    var name = safeName($("tbName").value || S.name);
    return render(S.buffer, reg()).then(function (out) {
      return keep(out, name);
    }).then(function (res) {
      setBusy(false);
      say(res.stored && opts.message ? opts.message : saved(res));
      return res.take;
    }).catch(function (err) {
      setBusy(false);
      say("");
      fail(saveError(err));
      return null;
    });
  }

  /* ---------- what can be pressed ----------
     A control that is only waiting keeps the keyboard's focus: it is marked aria-disabled and its presses are
     ignored, instead of being disabled, which would throw focus to the top of the page. A control that can never
     work on this browser is disabled outright. */
  function lock(id, on) {
    var el = $(id);
    if (on) el.setAttribute("aria-disabled", "true"); else el.removeAttribute("aria-disabled");
  }
  function swallow(e) {
    var b = e.target && e.target.closest ? e.target.closest('[aria-disabled="true"]') : null;
    if (b) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  mount.addEventListener("click", swallow, true);
  function chapter() {
    try { return (w.MCC_STUDIO_SHELL && w.MCC_STUDIO_SHELL.current()) || "make"; } catch (_) { return "make"; }
  }
  function ui() {
    var rec = S.recording, wait = S.pending, busy = S.busy;
    ["tbSave", "tbPlay", "tbStop", "tbClose"].forEach(function (id) { lock(id, busy); });
    $("tbImport").disabled = !AC;
    lock("tbImport", busy || rec || wait);
    var b = $("tbRecord");
    b.disabled = !canRecord();
    lock("tbRecord", wait || busy);
    b.classList.toggle("is-recording", rec);
    $("tbRecordLabel").textContent = wait ? "Waiting for the microphone…" : rec ? "Stop recording" : "Record";
    $("tbLive").hidden = !rec;
    /* the Make tab says a recording is running, and the strip carries Stop into the other chapters */
    var tab = d.getElementById("cs-tab-make");
    if (tab) {
      if (rec) { tab.setAttribute("data-recording", "1"); tab.setAttribute("aria-label", "Make, recording"); }
      else { tab.removeAttribute("data-recording"); tab.removeAttribute("aria-label"); }
    }
    if (stripEl) {
      var away = rec && chapter() !== "make";
      if (stripEl.hidden === away) {
        stripEl.hidden = !away;
        $("tbStripSay").textContent = away ? "Recording" : "";
      }
    }
  }
  function setBusy(on) { S.busy = !!on; ui(); }

  /* ---------- record ---------- */
  var REC = { stream: null, rec: null, chunks: [], node: null, analyser: null, raf: 0, t0: 0, data: null, level: 0, said: 0, session: "", mime: "" };
  function canRecord() {
    return !!(AC && w.MediaRecorder && w.navigator && w.navigator.mediaDevices && w.navigator.mediaDevices.getUserMedia);
  }
  function recorderType() {
    var MR = w.MediaRecorder, list = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    if (!MR || typeof MR.isTypeSupported !== "function") return "";
    for (var i = 0; i < list.length; i++) { try { if (MR.isTypeSupported(list[i])) return list[i]; } catch (_) {} }
    return "";
  }
  function micError(err) {
    var n = (err && err.name) || "";
    if (n === "NotAllowedError" || n === "PermissionDeniedError" || n === "SecurityError")
      return "The microphone is blocked for this site. Allow it in your browser's site settings, then press Record again. You can still import a file.";
    if (n === "NotFoundError" || n === "DevicesNotFoundError" || n === "OverconstrainedError")
      return "No microphone was found on this device. Plug one in, or import a file instead.";
    if (n === "NotReadableError" || n === "TrackStartError" || n === "AbortError")
      return "The microphone is busy or could not start. Close other apps that are using it, then try again.";
    return "Recording could not start on this browser. You can still import a file.";
  }

  /* each piece of a recording is written to this device as it arrives, so the page closing mid-take does not
     lose what was captured; the pieces are removed once the finished take is kept */
  function recPut(blob) {
    if (S.volatile) return;
    var row = { session: REC.session, owner: owner(), mime: REC.mime, at: Date.now(), blob: blob };
    tx([RECS], "readwrite", function (t) { t.objectStore(RECS).add(row); }).catch(function () {});
  }
  function recClear(session) {
    return tx([RECS], "readwrite", function (t) {
      t.objectStore(RECS).openCursor().onsuccess = function (e) {
        var cur = e.target.result;
        if (!cur) return;
        if (cur.value && cur.value.session === session) cur.delete();
        cur.continue();
      };
    }).catch(function () {});
  }
  function takeName(prefix, date) {
    return prefix + " " + date.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " +
      date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/:/g, ".");
  }
  /* pieces left behind by a recording that never reached Stop: keep what was captured as a take */
  var RECOVER_QUIET_MS = 5000, recoverTimer = 0;
  function recover() {
    w.clearTimeout(recoverTimer);
    return tx([RECS], "readonly", function (t) { return t.objectStore(RECS).getAll(); }).then(function (rows) {
      var me = owner(), sessions = {}, order = [], fresh = false, now = Date.now();
      (rows || []).forEach(function (r) {
        if (!r || !r.blob || (r.owner || "") !== me || r.session === REC.session) return;
        if (!sessions[r.session]) { sessions[r.session] = { mime: r.mime, at: 0, first: r.at, blobs: [] }; order.push(r.session); }
        sessions[r.session].blobs.push(r.blob);
        if (r.at > sessions[r.session].at) sessions[r.session].at = r.at;
      });
      var chain = Promise.resolve(0);
      order.forEach(function (key) {
        var s = sessions[key];
        /* pieces that are still arriving belong to a recording running in another tab: leave them */
        if (now - s.at < RECOVER_QUIET_MS) { fresh = true; return; }
        chain = chain.then(function (n) {
          var name = takeName("Recovered take", new Date(s.first || now));
          return readFile(new Blob(s.blobs, { type: s.mime || "audio/webm" })).then(function (ab) { return decode(ab); }).then(function (buffer) {
            return render(buffer, region(buffer.duration, 0, buffer.duration, 0, 0));
          }).then(function (out) { return keep(out, name); }).then(function (res) {
            say("A recording was cut short when the page closed. The " + clock(res.take.duration) + " that had been captured is kept as “" + res.take.name + "”.");
            return recClear(key).then(function () { return n + 1; });
          }, function (err) {
            if (err && /quota/i.test(String(err.name || err.message || ""))) { fail(saveError(err)); return n; }
            fail("A recording was cut short when the page closed, and what was captured could not be read back.");
            return recClear(key).then(function () { return n; });
          });
        });
      });
      if (fresh) recoverTimer = w.setTimeout(recover, RECOVER_QUIET_MS + 500);
      return chain;
    }, function () { return 0; });
  }
  /* leaving the page mid-take asks first; the handler exists only while a recording runs */
  function warnLeaving(e) { e.preventDefault(); e.returnValue = ""; return ""; }

  function startRecording() {
    fail("");
    if (!canRecord()) { fail(noRecordReason()); return Promise.resolve(false); }
    if (S.recording || S.pending || S.busy) return Promise.resolve(false);
    stopPlayback();
    S.pending = true; ui();
    say("");
    var c;
    try { c = audio(); } catch (_) { S.pending = false; ui(); fail("This browser cannot open audio here."); return Promise.resolve(false); }
    return w.navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      quietSite();
      var type = recorderType(), rec;
      try { rec = type ? new w.MediaRecorder(stream, { mimeType: type }) : new w.MediaRecorder(stream); }
      catch (e) { stream.getTracks().forEach(function (t) { t.stop(); }); throw e; }
      REC.stream = stream; REC.rec = rec; REC.chunks = [];
      REC.session = newId(); REC.mime = rec.mimeType || type || "audio/webm";
      rec.ondataavailable = function (e) { if (e.data && e.data.size) { REC.chunks.push(e.data); recPut(e.data); } };
      rec.onstop = finishRecording;
      rec.onerror = function () { fail("The recording stopped because of an error. What was captured is being kept."); stopRecording(); };
      /* the meter listens to the microphone; nothing is sent to the speakers, so there is no feedback */
      try {
        REC.node = c.createMediaStreamSource(stream);
        REC.analyser = c.createAnalyser();
        REC.analyser.fftSize = 1024;
        REC.data = new Float32Array(REC.analyser.fftSize);
        REC.node.connect(REC.analyser);
      } catch (_) { REC.node = null; REC.analyser = null; }
      rec.start(250);
      REC.t0 = (w.performance && w.performance.now()) || Date.now();
      REC.level = 0; REC.said = 0;
      S.pending = false; S.recording = true;
      w.addEventListener("beforeunload", warnLeaving);
      ui();
      say("Recording.");
      meter();
      return true;
    }).catch(function (err) {
      S.pending = false; S.recording = false;
      ui();
      rest();
      fail(micError(err));
      return false;
    });
  }
  function meter() {
    w.cancelAnimationFrame(REC.raf);
    if (!S.recording) return;
    var now = (w.performance && w.performance.now()) || Date.now();
    var time = clock((now - REC.t0) / 1000);
    $("tbRecTime").textContent = time;
    if (stripEl && !stripEl.hidden) $("tbStripTime").textContent = time;
    if (REC.analyser) {
      var peak = 0, data = REC.data;
      if (REC.analyser.getFloatTimeDomainData) {
        REC.analyser.getFloatTimeDomainData(data);
        for (var i = 0; i < data.length; i++) { var a = data[i] < 0 ? -data[i] : data[i]; if (a > peak) peak = a; }
      }
      /* a dB scale from -60 to 0 reads like a meter; a straight line would sit near empty */
      var db = peak > 0 ? 20 * Math.log(peak) / Math.LN10 : -100;
      var lvl = clamp((db + 60) / 60, 0, 1);
      /* the bar falls back slowly so a peak can be seen; what is announced is the level right now, in both forms */
      REC.level = Math.max(lvl, REC.level - 0.03);
      $("tbMeterBar").style.transform = "scaleX(" + REC.level.toFixed(3) + ")";
      $("tbMeter").classList.toggle("is-hot", peak >= 0.98);
      if (now - REC.said > 300) {
        REC.said = now;
        $("tbMeter").setAttribute("aria-valuenow", String(Math.round(lvl * 100)));
        $("tbMeter").setAttribute("aria-valuetext", peak >= 0.98 ? "Too loud" : db <= -60 ? "Silent" : Math.round(db) + " decibels");
      }
    }
    REC.raf = w.requestAnimationFrame(meter);
  }
  function stopRecording() {
    if (!S.recording) return;
    S.recording = false;
    w.cancelAnimationFrame(REC.raf);
    w.removeEventListener("beforeunload", warnLeaving);
    ui();
    try { if (REC.rec && REC.rec.state !== "inactive") REC.rec.stop(); else finishRecording(); } catch (_) { finishRecording(); }
  }
  function releaseMic() {
    try { if (REC.node) REC.node.disconnect(); } catch (_) {}
    try { if (REC.stream) REC.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
    REC.node = null; REC.analyser = null; REC.stream = null;
  }
  function finishRecording() {
    var rec = REC.rec, chunks = REC.chunks, session = REC.session;
    REC.rec = null; REC.chunks = []; REC.session = "";
    releaseMic();
    rest();
    if (!rec) return;
    var blob = new Blob(chunks, { type: (rec.mimeType || "audio/webm") });
    if (!blob.size) { recClear(session); say(""); fail("Nothing was recorded. Check the microphone is not muted and try again."); return; }
    setBusy(true);
    say("Reading the recording…");
    var name = takeName("Take", new Date());
    readFile(blob).then(function (ab) { return decode(ab); }).then(function (buffer) {
      setBusy(false);
      open(buffer, name);
      /* a recording is kept at once, whole; trimming it saves a second take */
      return save({ message: "Recorded " + clock(buffer.duration) + " and kept it as “" + S.name + "”. Trim it and press Save take for the short version." });
    }).then(function (take) {
      /* the pieces are no longer needed once the whole take is kept */
      if (take) recClear(session);
    }).catch(function () {
      setBusy(false);
      say("");
      fail("The recording could not be read back on this browser. Nothing was kept.");
      recClear(session);
    });
  }
  function noRecordReason() {
    if (w.isSecureContext === false) return "Recording needs a secure (https) page. You can still import a file.";
    return "This browser cannot record here. You can still import a file.";
  }

  /* ---------- wiring ---------- */
  $("tbRecord").addEventListener("click", function () { if (S.recording) stopRecording(); else startRecording(); });
  if (stripEl) $("tbStripStop").addEventListener("click", function () {
    stopRecording();
    /* the take that was just recorded opens on Make: go there, to its Record button */
    if (w.MCC_STUDIO_SHELL && w.MCC_STUDIO_SHELL.go) w.MCC_STUDIO_SHELL.go("make");
    try { $("tbRecord").focus(); } catch (_) {}
  });
  $("tbImport").addEventListener("click", function () { $("tbFile").click(); });
  $("tbFile").addEventListener("change", function () {
    var f = this.files && this.files[0];
    var input = this;
    if (f) importFile(f).then(function () { try { input.value = ""; } catch (_) {} });
  });
  $("tbPlay").addEventListener("click", function () { if (S.playing) pause(); else play(); });
  $("tbStop").addEventListener("click", stopPlayback);
  $("tbSave").addEventListener("click", function () { save(); });
  $("tbClose").addEventListener("click", close);
  $("tbName").addEventListener("input", function () { S.name = safeName(this.value); });
  $("tbStart").addEventListener("change", function () { setTrim(parseFloat(this.value), 0, "start"); this.value = S.start.toFixed(2); });
  $("tbEnd").addEventListener("change", function () { setTrim(0, parseFloat(this.value), "end"); this.value = S.end.toFixed(2); });
  function fades() {
    S.fadeIn = clamp($("tbFadeIn").value, 0, MAX_FADE);
    S.fadeOut = clamp($("tbFadeOut").value, 0, MAX_FADE);
    if (S.playing) pause();
    sync(); draw();
  }
  $("tbFadeIn").addEventListener("input", fades);
  $("tbFadeOut").addEventListener("input", fades);

  /* the handles: drag with a finger or a mouse, or use the arrow keys */
  function timeAt(clientX) {
    var box = $("tbWave").getBoundingClientRect();
    return S.buffer ? clamp((clientX - box.left) / Math.max(1, box.width), 0, 1) * S.buffer.duration : 0;
  }
  function handle(el, which) {
    var grab = 0, dragging = false;
    el.addEventListener("pointerdown", function (e) {
      if (!S.buffer || (e.button != null && e.button > 0)) return;
      dragging = true;
      grab = timeAt(e.clientX) - (which === "start" ? S.start : S.end);
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      /* the handle in hand sits on top when the two meet */
      $("tbHandleStart").style.zIndex = which === "start" ? "3" : "2";
      $("tbHandleEnd").style.zIndex = which === "end" ? "3" : "2";
      e.preventDefault(); e.stopPropagation();
      try { el.focus({ preventScroll: true }); } catch (_) {}
    });
    el.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var t = timeAt(e.clientX) - grab;
      if (which === "start") setTrim(t, 0, "start"); else setTrim(0, t, "end");
    });
    function end(e) { if (!dragging) return; dragging = false; try { el.releasePointerCapture(e.pointerId); } catch (_) {} }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("click", function (e) { e.stopPropagation(); });
    el.addEventListener("keydown", function (e) {
      if (!S.buffer) return;
      var step = e.shiftKey ? 0.1 : 0.01, cur = which === "start" ? S.start : S.end, next = null;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = cur - step;
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = cur + step;
      else if (e.key === "PageDown") next = cur - 1;
      else if (e.key === "PageUp") next = cur + 1;
      else if (e.key === "Home") next = which === "start" ? 0 : S.start;
      else if (e.key === "End") next = which === "start" ? S.end : S.buffer.duration;
      if (next == null) return;
      e.preventDefault();
      if (which === "start") setTrim(next, 0, "start"); else setTrim(0, next, "end");
    });
  }
  handle($("tbHandleStart"), "start");
  handle($("tbHandleEnd"), "end");
  /* a tap on the waveform inside the trim moves the playhead there */
  $("tbWave").addEventListener("click", function (e) {
    if (!S.buffer) return;
    var t = timeAt(e.clientX), was = S.playing;
    if (t < S.start || t > S.end) return;
    if (was) pause();
    S.pos = t; head();
    if (was) play();
  });

  /* Delete takes two presses, in place: no browser dialog, and nothing is deleted by one stray tap. The second
     press is named for what it does, said aloud, and called off by Escape, by leaving the button, or by waiting. */
  function disarm(btn, quiet) {
    if (!btn || btn.getAttribute("data-armed") !== "1") return;
    btn.removeAttribute("data-armed");
    btn.textContent = "Delete";
    var take = takeById((btn.closest("[data-take]") || btn).getAttribute("data-take"));
    btn.setAttribute("aria-label", "Delete “" + (take ? take.name : "this take") + "”");
    if (!quiet) say("Nothing was deleted.");
  }
  $("tbTakes").addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-take-act]") : null;
    if (!btn) return;
    var li = btn.closest("[data-take]"), id = li && li.getAttribute("data-take"), act = btn.getAttribute("data-take-act");
    if (!id) return;
    if (act === "use") useInRelease(id);
    else if (act === "preview") useInRelease(id, "preview");
    else if (act === "open") openTake(id);
    else if (act === "download") download(id);
    else if (act === "delete") {
      var take = takeById(id), name = take ? take.name : "this take";
      if (btn.getAttribute("data-armed") !== "1") {
        btn.setAttribute("data-armed", "1");
        btn.textContent = "Delete for good?";
        btn.setAttribute("aria-label", "Delete “" + name + "” for good?");
        say("Press Delete again to remove “" + name + "” for good. Escape keeps it.");
        w.setTimeout(function () { if (btn.isConnected) disarm(btn); }, 6000);
        return;
      }
      dropTake(id).then(loadTakes).then(function () {
        say(take ? "Deleted “" + take.name + "” from this device." : "Deleted.");
        try { $("tbTakesHeading").setAttribute("tabindex", "-1"); $("tbTakesHeading").focus(); } catch (_) {}
      }, function () { fail("That take could not be deleted."); });
    }
  });
  $("tbTakes").addEventListener("keydown", function (e) {
    if (e.key !== "Escape" && e.key !== "Esc") return;
    var btn = e.target && e.target.closest ? e.target.closest('[data-take-act="delete"]') : null;
    if (btn && btn.getAttribute("data-armed") === "1") { e.preventDefault(); disarm(btn); }
  });
  $("tbTakes").addEventListener("focusout", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-take-act="delete"]') : null;
    if (btn && btn.isConnected) disarm(btn, true);
  });

  if ("ResizeObserver" in w) new ResizeObserver(function () { draw(); }).observe($("tbWave"));
  else w.addEventListener("resize", draw);
  /* the canvas has no size while the Make chapter is hidden: draw when it comes back. Playback stops with the
     chapter; a recording does not, and the strip keeps it in sight. */
  w.addEventListener("mcc:studio-chapter", function (e) {
    if (e && e.detail && e.detail.chapter === "make") w.setTimeout(draw, 0);
    else if (S.playing) pause();
    ui();
  });
  w.addEventListener("pagehide", function () {
    if (S.recording) { try { if (REC.rec && REC.rec.state !== "inactive") REC.rec.stop(); } catch (_) {} }
    releaseMic();
    stopSource();
  });
  d.addEventListener("visibilitychange", function () { if (d.hidden && S.playing) pause(); });
  try { if (w.MCC && typeof w.MCC.onAccountChange === "function") w.MCC.onAccountChange(function () { close(); loadTakes(); }); } catch (_) {}

  if (!AC) {
    fail("This browser cannot open audio here, so the take bench cannot run. Releases still work: choose a finished file there.");
  } else if (!canRecord()) {
    $("tbFormats").textContent = noRecordReason() + " Import takes MP3, WAV or M4A. Nothing here is uploaded.";
  }
  ui();
  loadTakes().then(function () { if (!S.volatile) recover(); });

  w.MCC_TAKE_BENCH = {
    importFile: importFile, save: save, useInRelease: useInRelease, openTake: openTake, download: download,
    setTrim: function (a, b) { setTrim(a, b); }, setFades: function (i, o) { $("tbFadeIn").value = i; $("tbFadeOut").value = o; fades(); },
    play: play, pause: pause, stop: stopPlayback, startRecording: startRecording, stopRecording: stopRecording,
    /* a take's WAV bytes, read from this device on request */
    bytes: function (id) { return dataOf(takeById(id)).then(readFile); },
    state: function () {
      var r = S.buffer ? reg() : null;
      return {
        open: !!S.buffer, name: S.name, duration: S.buffer ? S.buffer.duration : 0, sampleRate: S.buffer ? S.buffer.sampleRate : 0, region: r,
        playing: S.playing, recording: S.recording, pending: S.pending, busy: S.busy, volatile: S.volatile,
        position: S.pos, canRecord: canRecord(), audioState: ctx ? ctx.state : "none",
        takes: S.takes.map(function (t) { return { id: t.id, name: t.name, duration: t.duration, bytes: t.bytes, createdAt: t.createdAt, sampleRate: t.sampleRate, channels: t.channels, held: !!t.local, hasAudioInList: !!t.data && !t.local }; })
      };
    },
    pure: PURE
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
