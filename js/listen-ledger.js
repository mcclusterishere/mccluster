/* ============================================================
   THE LISTEN LEDGER, BROWSER SIDE.

   A signed-in listener's songs are counted on the server so that a gated
   record can be earned: five different songs heard all the way through,
   then one play, then one more song per play after that. This file only
   says "this song started" and "this song ended". It never says how long
   a song is and never decides whether a listen counted; the API Worker
   times it against the song's measured length, so skipping to the end
   or speeding it up does not count.

   Every player uses the same three calls:
     var h = MCC_LISTENS.start(key)   when a song starts from the top
     MCC_LISTENS.finish(h)            when that song reaches its end
     MCC_LISTENS.onFinish(fn)         to repaint a gate after a count

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

  function start(key) {
    if (!key || !token()) return null;
    return {
      key: key,
      done: false,
      id: post("/v1/music/listens", { track: key }).then(function (d) { return (d && d.listen_id) || null; })
    };
  }

  function finish(handle) {
    if (!handle || handle.done) return Promise.resolve(null);
    handle.done = true;
    return handle.id.then(function (id) {
      if (!id) return null;
      return post("/v1/music/listens/" + id + "/finish").then(function (d) {
        if (d) watchers.forEach(function (fn) { try { fn(d); } catch (e) {} });
        return d;
      });
    });
  }

  root.MCC_LISTENS = {
    keyOf: keyOf,
    start: start,
    finish: finish,
    onFinish: function (fn) { if (typeof fn === "function") watchers.push(fn); },
    signedIn: function () { return !!token(); }
  };
  try { root.dispatchEvent(new CustomEvent("mcc:listens-ready")); } catch (e) {}
})(window);
