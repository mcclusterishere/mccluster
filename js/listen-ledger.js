/* ============================================================
   THE LISTEN LEDGER, BROWSER SIDE.

   A signed-in listener's songs are counted on the server so that a gated
   record can be earned. For CIA Mind Control the gated record is the last
   song, and it plays only after the songs before it are heard all the way
   through, in album order; every play needs a fresh run of the album. This file only
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
   signed out or offline, or whose session the auth server has ended, simply
   is not counted. An old token is renewed first, not given up on.
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

  /* The token is the shared auth's, renewed for this call when it is near
     its end and asked again once after a 401 (js/mcc-auth.js authFetch).
     The stored one, an hour old, was refused and the song never counted
     (music slice M4; delivery lane DEL-3). */
  function post(path, body) {
    var t = token();
    if (!t) return Promise.resolve(null);
    var init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
      /* the last song of a visit often ends as the tab is closing */
      keepalive: true
    };
    var call = root.MCC && root.MCC.authFetch
      ? root.MCC.authFetch(API + path, init)
      : fetch(API + path, Object.assign(init, { headers: { authorization: "Bearer " + t, "content-type": "application/json" } }));
    return call.then(function (r) { return r.ok ? r.json() : null; })
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

  /* A FINISHED SONG IS COUNTED BEFORE THE NEXT ONE STARTS (music slice M3; music map 02, DEL-4).
     When a song ends the player finishes it and starts the next one in the same moment. The two
     requests used to race, and when the next start reached the database first, music_listen_start
     closed the song just heard as not completed: production held 55 such rows beside 59 completed
     ones. A start now waits for the finish in flight to come back, for FINISH_WAIT_MS at most, so
     a finish that never answers cannot stop the next song counting. The music never waits: only
     this request does.
     THE WAIT COMES OUT OF THE NEXT SONG'S MARGIN (music slice M3 follow-up; review PB-R10). The next
     song is credited from the moment its start reaches the database, and the Worker counts it once
     floor(length x 0.95) is heard, so a start that waited 5 s could leave the shortest song
     (Towyard Killer, 65.7 s, counted after 62 s) uncounted. The wait is half the smallest margin
     in the catalogue: scripts/music-track-lengths.mjs writes it from the songs' own lengths. */
  /* FINISH WAIT BEGIN: written by scripts/music-track-lengths.mjs; --check fails when it is stale */
  /* half of 3.7 s, the smallest margin in the catalogue: Towyard Killer, 65.7 s, counted after 62 s */
  var FINISH_WAIT_MS = 1850;
  /* FINISH WAIT END */
  var finishing = null;
  function afterFinish() {
    var pending = finishing;
    if (!pending) return Promise.resolve();
    return new Promise(function (resolve) {
      var timer = root.setTimeout ? root.setTimeout(resolve, FINISH_WAIT_MS) : 0;
      pending.then(function () { if (timer && root.clearTimeout) root.clearTimeout(timer); resolve(); });
    });
  }

  function start(key, isPlaying) {
    if (!key || !token()) return null;
    return handle(key, afterFinish().then(function () {
      return post("/v1/music/listens", { track: key });
    }).then(function (d) {
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
    var done = handle.id.then(function (id) {
      if (!id) return null;
      forgetOpen(id);
      return post("/v1/music/listens/" + id + "/finish").then(function (d) {
        if (d) watchers.forEach(function (fn) { try { fn(d); } catch (e) {} });
        return d;
      });
    });
    /* the next start waits for this one (post() never rejects; a lost finish settles as null) */
    var settled = done.then(function () {}, function () {});
    finishing = settled;
    settled.then(function () { if (finishing === settled) finishing = null; });
    return done;
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
