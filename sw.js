/* ============================================================
   THE KEEPER: the offline layer every store demands.
   Conservative by law:
   - never touches other origins (Supabase, CDNs ride untouched)
   - fonts & images: cache-first (instant on revisit)
   - pages, css, js, data: network-first with cache fallback
     (the app opens even with no signal)
   The version stamp changes on every deploy, which retires the
   old cache automatically. No stale sites, ever.

   THE VAULT: the second cache, and the second law. When the
   listener says "keep the masters," the page puts the records
   here — and this cache is NOT stamped, so a deploy never takes
   the music out of anyone's pocket. Media requests check the
   vault first; a kept record plays with no signal, and range
   requests (Safari won't play audio without them) are answered
   by slicing the kept copy by hand. A record not in the vault
   streams from the network exactly as it always did.
   ============================================================ */
var V = "mcc-unblack-1-__STAMP__";
var VAULT = "mcc-vault-v1";

self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) {
        return Promise.all(ks.filter(function (k) {
          // retire old stamped caches; never the vault — that's the
          // listener's downloaded music, it survives every deploy
          return k !== V && k !== VAULT;
        }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* a kept record, sliced to order: media elements ask in ranges */
function fromVault(r) {
  return caches.open(VAULT).then(function (c) {
    return c.match(r.url.split("?")[0]).then(function (hit) {
      if (!hit) return fetch(r); // not kept: stream from the network, untouched
      var range = r.headers.get("range");
      var m = range && /bytes=(\d+)-(\d*)/.exec(range);
      if (!m) return hit.clone();
      return hit.clone().arrayBuffer().then(function (buf) {
        var start = Math.min(+m[1], Math.max(0, buf.byteLength - 1));
        var end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
        return new Response(buf.slice(start, end + 1), {
          status: 206,
          statusText: "Partial Content",
          headers: {
            "Content-Type": hit.headers.get("Content-Type") || "audio/mpeg",
            "Accept-Ranges": "bytes",
            "Content-Range": "bytes " + start + "-" + end + "/" + buf.byteLength,
            "Content-Length": String(end - start + 1),
          },
        });
      });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET") return;
  var u = new URL(r.url);
  if (u.origin !== location.origin) return;

  if (/\.(mp3|m4a|wav|mp4|webm)$/i.test(u.pathname)) {
    e.respondWith(fromVault(r));
    return;
  }
  if (r.headers.has("range")) return;

  if (/\.(woff2|png|jpg|jpeg|webp|svg|ico)$/i.test(u.pathname)) {
    e.respondWith(
      caches.open(V).then(function (c) {
        // caches.match is global on purpose: cover art kept in the vault
        // still shows after a deploy rotates the stamped cache away
        return caches.match(r).then(function (hit) {
          return hit || fetch(r).then(function (res) {
            if (res.ok) c.put(r, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  e.respondWith(
    fetch(r).then(function (res) {
      if (res.ok) caches.open(V).then(function (c) { c.put(r, res.clone()); });
      return res;
    }).catch(function () {
      return caches.match(r).then(function (hit) {
        if (hit) return hit;
        // The app-shell fallback is ONLY for real page navigations.
        // Never hand index.html to a CSS/JS/JSON request. That renders
        // the page unstyled/broken on a flaky phone connection.
        var wantsPage = r.mode === "navigate" ||
          (r.headers.get("accept") || "").indexOf("text/html") !== -1;
        return wantsPage ? caches.match("index.html") : Response.error();
      });
    })
  );
});
