/* ============================================================
   THE PEAKS — the album room's light and waveform, measured once.

   The album room's deck is a plain <audio> element and nothing on
   the page ever routes it through Web Audio: iOS keeps a plain
   element playing when the screen locks and silences Web Audio in
   the background (decision D-3, docs/music/MUSIC-RELEASE-20261119.md).
   So the light js/chamber.js paints and the waveform js/filament.js
   draws are not heard live any more. scripts/music-peaks.mjs measures
   every public catalogue file once, with the same analysis the
   analyser used to run on the deck, into data/peaks/<file>.json:
   168 bars for the waveform and the bass, middle and top of the
   record twenty times a second for the light.

   This reads that file for whatever the deck is playing, once per
   song, and hands out the light at any second. Only a public file of
   the house catalogue (this site's assets/audio/<name>.mp3 or .m4a)
   has a measured light. A signed or streamed master (the gated
   closer's one play, a creator's cut) is never fetched for its shape:
   it gets a quiet, even light and a flat waveform.
   ============================================================ */
(function (root) {
  "use strict";
  if (root.MCC_PEAKS) return;
  var script = root.document && root.document.currentScript && root.document.currentScript.src;
  var ROOT = script ? script.replace(/js\/peaks\.js.*$/, "") : "";
  var cache = {};
  /* the quiet, even light of a record that was not measured */
  var NEUTRAL = { bass: 0.16, mid: 0.12, high: 0.08 };
  /* and its waveform: every bar the same, low */
  var FLAT = 0.3;

  function keyOf(src) {
    var u;
    try { u = new URL(String(src || ""), root.location.href); } catch (e) { return null; }
    if (u.origin !== root.location.origin) return null;
    var m = /^\/(?:[^?#]*\/)?assets\/audio\/([a-z0-9][a-z0-9._-]*)\.(?:mp3|m4a)$/i.exec(u.pathname);
    if (!m || /\.\./.test(u.pathname)) return null;
    return m[1].toLowerCase();
  }
  function bytes(b64) {
    var s = root.atob(String(b64 || "")), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function read(d) {
    if (!d || !Array.isArray(d.bars) || !d.light || !(d.light.rate > 0)) return null;
    var light = { rate: d.light.rate, bass: bytes(d.light.bass), mid: bytes(d.light.mid), high: bytes(d.light.high) };
    if (!light.bass.length || light.mid.length !== light.bass.length || light.high.length !== light.bass.length) return null;
    return { seconds: Number(d.seconds) || 0, bars: d.bars.slice(), light: light };
  }
  /* one request per song, and only for a public catalogue file */
  function load(src) {
    var key = keyOf(src);
    if (!key) return Promise.resolve(null);
    if (!cache[key]) {
      cache[key] = root.fetch(ROOT + "data/peaks/" + key + ".json", { credentials: "omit" })
        .then(function (r) { if (!r.ok) throw new Error("no peaks"); return r.json(); })
        .then(read)
        .then(function (p) { if (!p) delete cache[key]; return p; },
              function () { delete cache[key]; return null; });
    }
    return cache[key];
  }
  /* the light at second t: read between the two measures either side of it */
  function at(p, t) {
    var L = p && p.light;
    if (!L || !L.bass.length) return NEUTRAL;
    var n = L.bass.length, x = Math.max(0, Number(t) || 0) * L.rate, i = Math.floor(x), f = x - i;
    if (i >= n - 1) { i = n - 1; f = 0; }
    var j = Math.min(i + 1, n - 1);
    function v(a) { return (a[i] + (a[j] - a[i]) * f) / 255; }
    return { bass: v(L.bass), mid: v(L.mid), high: v(L.high) };
  }
  root.MCC_PEAKS = { keyOf: keyOf, load: load, at: at, neutral: NEUTRAL, flat: FLAT };
})(window);
