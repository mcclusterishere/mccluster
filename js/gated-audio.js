/* ============================================================
   GATED AUDIO — the full record lives where the account can be checked.

   THE ONLY HONEST WAY TO GATE A FILE ON A STATIC HOST.

   This site is GitHub Pages. Anything committed under assets/ is
   world-readable the moment it deploys, and no amount of front-end
   code changes that: a "locked" player pointed at a public MP3 is
   theatre, because the URL is sitting in the page source. So the
   full master is NOT in this repository. It lives in a PRIVATE
   Supabase Storage bucket, and the only way to get a playable URL
   for it is to ask Supabase for a signed one while holding an M
   Account access token. Supabase does the checking, not this file.

   What ships publicly is a short preview cut. That is a real file,
   it really is public, and it is supposed to be.

   WHAT A VISITOR GETS
     no account   → the preview, and a plain invitation to make one
     account      → a signed URL to the master, plus the download
     storage down → told exactly that

   The third case is the one most sites get wrong. An outage is not
   a locked door, and a locked door is not an empty shelf. Each one
   says its own name, because a listener who made an account and
   still cannot hear the record deserves to know it is our fault.

   A signed URL expires. LIFETIME_S below is how long Supabase is
   asked to honour one; refresh() re-signs well before that, so a
   deck that has been open all afternoon does not fail on play.
   ============================================================ */
(function (root) {
  "use strict";

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  var LIFETIME_S = 3600;   /* what we ask Supabase to sign for */
  var REFRESH_MS = 45 * 60 * 1000;  /* re-sign before that runs out */

  /* One entry per gated object, so two rows pointing at the same
     master do not sign it twice. */
  var cache = {};

  function sessionToken() {
    try {
      var s = root.MCC && root.MCC.session && root.MCC.session();
      return (s && s.access_token) || null;
    } catch (e) { return null; }
  }

  function objectPath(gated) {
    return String(gated.bucket) + "/" + String(gated.object)
      .split("/").map(encodeURIComponent).join("/");
  }

  /* Sign one object. Resolves to a state, never rejects: every caller
     here is painting a row, and a thrown error would leave that row
     lying about which of the three situations it is in. */
  function sign(gated) {
    var token = sessionToken();
    if (!token) return Promise.resolve({ state: "preview", reason: "account" });

    return fetch(SB + "/storage/v1/object/sign/" + objectPath(gated), {
      method: "POST",
      headers: {
        apikey: KEY,
        authorization: "Bearer " + token,
        "content-type": "application/json"
      },
      body: JSON.stringify({ expiresIn: LIFETIME_S })
    }).then(function (r) {
      /* 401/403 is a door, and the listener can open it by signing in
         or by having the account they already made recognised. 404 is
         the master simply not being uploaded yet, which is ours to
         fix and must never be dressed up as a paywall. */
      if (r.status === 401 || r.status === 403) {
        return { state: "preview", reason: "account" };
      }
      if (r.status === 404) {
        return { state: "unavailable", reason: "missing" };
      }
      if (!r.ok) return { state: "unavailable", reason: "http-" + r.status };
      return r.json().then(function (d) {
        var signed = d && (d.signedURL || d.signedUrl);
        if (!signed) return { state: "unavailable", reason: "no-url" };
        return {
          state: "full",
          url: SB + "/storage/v1" + signed,
          signed_at: Date.now()
        };
      });
    }).catch(function () {
      return { state: "unavailable", reason: "network" };
    });
  }

  function key(gated) { return gated.bucket + "/" + gated.object; }

  function resolve(gated) {
    if (!gated || !gated.bucket || !gated.object) {
      return Promise.resolve({ state: "unavailable", reason: "unconfigured" });
    }
    var k = key(gated);
    var hit = cache[k];
    if (hit && hit.state === "full" && (Date.now() - hit.signed_at) < REFRESH_MS) {
      return Promise.resolve(hit);
    }
    /* An in-flight sign is shared rather than raced, so a row that
       repaints twice does not ask Supabase twice. */
    if (hit && hit.inflight) return hit.inflight;

    var p = sign(gated).then(function (out) {
      cache[k] = out;
      return out;
    });
    cache[k] = { inflight: p };
    return p;
  }

  /* The download. A signed Supabase URL is cross-origin, and the
     download attribute is ignored across origins, so the browser
     would navigate to the file instead of saving it and the listener
     would lose the page. Pulling the bytes and handing over a blob
     is what actually saves, and it is also the only way the file
     lands with the record's name on it instead of a signing token. */
  function download(gated, filename) {
    return resolve(gated).then(function (out) {
      if (out.state !== "full") return out;
      return fetch(out.url).then(function (r) {
        if (!r.ok) return { state: "unavailable", reason: "http-" + r.status };
        return r.blob().then(function (blob) {
          var url = root.URL.createObjectURL(blob);
          var a = root.document.createElement("a");
          a.href = url;
          a.download = filename || "track.mp3";
          root.document.body.appendChild(a);
          a.click();
          root.document.body.removeChild(a);
          /* revoke on the next turn: Safari has not finished reading
             the blob when click() returns */
          root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 30000);
          return { state: "saved" };
        });
      }).catch(function () {
        return { state: "unavailable", reason: "network" };
      });
    });
  }

  /* Sign-in and sign-out both have to repaint every gated row, and
     neither reloads the page. Callers register here. */
  var watchers = [];
  function onChange(fn) { if (typeof fn === "function") watchers.push(fn); }
  function forget() { cache = {}; watchers.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  root.MCC_GATED = {
    resolve: resolve,
    download: download,
    forget: forget,
    onChange: onChange,
    signedIn: function () { return !!sessionToken(); }
  };

  /* The session is in localStorage, so another tab signing in or out
     is a storage event here. */
  if (root.addEventListener) {
    root.addEventListener("storage", function (e) {
      if (e && e.key === "mccdb_session") forget();
    });
  }

  /* This file is deferred, so a page that paints its shelf from a fetch
     can finish either before or after it. Whoever is late listens for
     this; nobody polls, and a row is never left locked because two
     scripts finished in the wrong order. */
  try {
    root.dispatchEvent(new CustomEvent("mcc:gated-ready"));
  } catch (e) { /* no CustomEvent: the ready check below still catches it */ }
})(window);
