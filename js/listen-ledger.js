/* ============================================================
   THE LISTEN LEDGER, BROWSER SIDE.

   A signed-in listener's songs are counted on the server so that a gated
   record can be earned: five different songs heard all the way through,
   then one play, then one more song per play after that. This file only
   says "this song started" and "this song ended". It never says how long
   a song is and never decides whether a listen counted; the API Worker
   times it against the song's measured length, so skipping to the end
   or speeding it up does not count.

   Every player uses the same calls:
     var h = MCC_LISTENS.start(key, isPlaying)  a song starts from the top
     var h = MCC_LISTENS.adopt(key, isPlaying)  pick up a song another page
                                                started (same song only)
     MCC_LISTENS.finish(h)                      the song reached its end
     MCC_LISTENS.onFinish(fn)                   repaint a gate after a count
   isPlaying() says whether audio is actually playing; beats are sent only
   while it is, and the server counts only the time they cover.

   Nothing here throws and nothing here blocks playback: a listener who is
   signed out, offline, or on an old session simply is not counted.
   ============================================================ */
(function (root) {
  "use strict";
  if (root.MCC_LISTENS) return;

  var API = "https://api.mccluster.org";

  function token() {
    try {
      var s = root.MCC && root.MCC.session && root.MCC.session();
      if (s && s.access_token) return s.access_token;
    } catch (e) {}
    try {
      var raw = root.localStorage.getItem("mccdb_session");
      var parsed = raw && JSON.parse(raw);
      return (parsed && parsed.access_token) || null;
    } catch (e) { return null; }
  }

  /* The server knows a song by its file name without the extension; a
     gated record by the folder its master lives in. */
  function keyOf(t) {
    if (!t) return "";
    if (t.gated && t.gated.object) return String(t.gated.object).split("/")[0];
    var src = String(typeof t === "string" ? t : t.src || "").split(/[?#]/)[0];
    return (src.split("/").pop() || "").replace(/\.[a-z0-9]+$/i, "").replace(/-preview$/, "").toLowerCase();
  }

  function post(path, body) {
    var t = token();
    if (!t) return Promise.resolve(null);
    return fetch(API + path, {
      method: "POST",
      headers: { authorization: "Bearer " + t, "content-type": "application/json" },
      body: JSON.stringify(body || {}),
      /* the last song of a visit often ends as the tab is closing */
      keepalive: true
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  var watchers = [];
  var OPEN = "mcc_listen_open";   /* the listen in progress, for the next page */
  var BEAT_MS = 15000;

  function remember(h) {
    try { root.localStorage.setItem(OPEN, JSON.stringify({ id: h.resolved, key: h.key, at: Date.now() })); } catch (e) {}
  }
  function forgetOpen(id) {
    try {
      var o = JSON.parse(root.localStorage.getItem(OPEN) || "null");
      if (!id || (o && o.id === id)) root.localStorage.removeItem(OPEN);
    } catch (e) {}
  }

  /* A listen counts on time actually played: while the song is playing the
     API gets a beat every 15 seconds, and a paused song sends none, so the
     server credits nothing for the pause. */
  function arm(h, isPlaying) {
    h.timer = root.setInterval(function () {
      if (h.done || !h.resolved) return;
      if (isPlaying && !isPlaying()) return;
      post("/v1/music/listens/" + h.resolved + "/beat");
      remember(h);
    }, BEAT_MS);
    return h;
  }

  function handle(key, idPromise, isPlaying) {
    var h = { key: key, done: false, resolved: null, timer: null };
    h.id = idPromise.then(function (id) { h.resolved = id; if (id) remember(h); return id; });
    return arm(h, isPlaying);
  }

  function start(key, isPlaying) {
    if (!key || !token()) return null;
    return handle(key, post("/v1/music/listens", { track: key }).then(function (d) {
      return (d && d.listen_id) || null;
    }), isPlaying);
  }

  /* Pick up the listen another page started (the album hands the song to
     the pocket player when the listener moves on), so a song heard across
     a page change still counts. Only the same song, and only recently. */
  function adopt(key, isPlaying) {
    if (!key || !token()) return null;
    try {
      var o = JSON.parse(root.localStorage.getItem(OPEN) || "null");
      if (!o || o.key !== key || !o.id || Date.now() - o.at > 10 * 60 * 1000) return null;
      return handle(key, Promise.resolve(o.id), isPlaying);
    } catch (e) { return null; }
  }

  function stop(h) {
    if (h && h.timer) { root.clearInterval(h.timer); h.timer = null; }
  }

  function finish(handle) {
    if (!handle || handle.done) return Promise.resolve(null);
    handle.done = true;
    stop(handle);
    return handle.id.then(function (id) {
      if (!id) return null;
      forgetOpen(id);
      return post("/v1/music/listens/" + id + "/finish").then(function (d) {
        if (d) watchers.forEach(function (fn) { try { fn(d); } catch (e) {} });
        return d;
      });
    });
  }

  /* This page is done with the song but the song may go on elsewhere:
     stop beating here and leave it open for adopt(). */
  function release(h) { stop(h); }

  root.MCC_LISTENS = {
    keyOf: keyOf,
    start: start,
    adopt: adopt,
    finish: finish,
    release: release,
    onFinish: function (fn) { if (typeof fn === "function") watchers.push(fn); },
    signedIn: function () { return !!token(); }
  };
  try { root.dispatchEvent(new CustomEvent("mcc:listens-ready")); } catch (e) {}
})(window);
