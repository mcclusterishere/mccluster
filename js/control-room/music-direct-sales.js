/* Native Control · Create · Music · Direct sales.
   =====================================================================
   Owner, 2026-10-30: "I definitely need a direct checkout for all the
   music. I would like to be able to put some of my music for sale."

   Lists the catalogue the site already uses (public.music_catalog_objects)
   and, for each recording: a price, the full-quality file (uploaded straight
   into the PRIVATE mcc-gated-audio bucket under direct-sales/ through a
   one-time signed upload slot that never overwrites), the downloads each
   purchase gets and for how many days, and on/off sale. A "Buy MP3" button
   then appears on that track in album.html and catalogue.html.

   Every read and write goes through music-direct-access operator-* actions,
   which verify the caller's token and the music desk's own authority
   (ops.use on the mccluster org, supabase/functions/_shared/house-ops.ts).
   The browser never writes music_direct_offers. Mounted as the fourth tab of
   js/control-room/music-ops.js.
   ===================================================================== */
(function () {
  "use strict";
  window.CR = window.CR || {};
  var D = { rerender: null, loading: false, loaded: false, error: null, catalogue: [], offers: {}, sales: {},
    defaults: { max_downloads: 5, download_window_days: 30 }, files: {}, msg: {}, busy: {} };
  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(c) { return "$" + (Number(c || 0) / 100).toFixed(2); }
  function token() { return window.MCC_SUPA && MCC_SUPA.token ? MCC_SUPA.token() : Promise.resolve(null); }
  function call(action, body) {
    return token().then(function (t) {
      if (!t) throw new Error("Signed out");
      return fetch(window.MCC_SUPA.url + "/functions/v1/music-direct-access", {
        method: "POST",
        headers: { apikey: window.MCC_SUPA.key, authorization: "Bearer " + t, "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ action: action }, body || {}))
      });
    }).then(function (r) {
      return r.text().then(function (raw) {
        var j = {}; try { j = raw ? JSON.parse(raw) : {}; } catch (_) {}
        if (!r.ok) throw new Error(j.error || ("Direct sales " + r.status));
        return j;
      });
    });
  }
  function redraw() { if (D.rerender) D.rerender(); }
  function load() {
    if (D.loading) return Promise.resolve();
    D.loading = true; D.error = null; redraw();
    return call("operator-direct-list").then(function (d) {
      D.catalogue = d.catalogue || [];
      D.offers = {}; (d.offers || []).forEach(function (o) { D.offers[o.catalog_key] = o; });
      D.sales = d.sales || {};
      if (d.defaults) D.defaults = d.defaults;
    }).catch(function (err) { D.error = err; }).then(function () { D.loading = false; D.loaded = true; redraw(); });
  }
  function note(t, bad) { return '<div class="cro-note' + (bad ? " cro-note--bad" : "") + '">' + e(t) + "</div>"; }

  function item(c) {
    var o = D.offers[c.catalog_key] || null, s = (o && D.sales[o.offer_key]) || null, live = !!(o && o.active);
    var file = D.files[c.catalog_key] || (o && o.asset_path) || "", k = e(c.catalog_key), busy = !!D.busy[c.catalog_key];
    return '<div class="cro-item" data-crds="' + k + '"><div class="cro-item__head"><div><strong>' + e(c.track_title) + '</strong>' +
      '<div class="cro-meta">' + e(c.album_title) + " · file " + (file ? e(file.split("/").pop()) : "none yet") +
      (s ? " · " + e(s.paid) + " sold" + (s.refunded ? ", " + e(s.refunded) + " refunded" : "") + " · " + e(money(s.gross_cents)) : "") + "</div></div>" +
      '<span class="cro-pill">' + (live ? "on sale " + e(money(o.price_cents)) : o ? "off sale" : "not set up") + "</span></div>" +
      '<div class="cro-form cro-form--2" style="margin-top:8px">' +
        '<label>Price (USD)<input type="number" inputmode="decimal" min="0.50" max="500" step="0.01" data-crds-f="price" value="' + (o ? (o.price_cents / 100).toFixed(2) : "1.99") + '"></label>' +
        '<label>Full-quality file<input type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/flac,.mp3,.m4a,.wav,.flac" data-crds-f="file"></label>' +
        '<label>Downloads per purchase<input type="number" min="1" max="50" step="1" data-crds-f="max" value="' + e(o ? o.max_downloads : D.defaults.max_downloads) + '"></label>' +
        '<label>Days to download<input type="number" min="1" max="365" step="1" data-crds-f="days" value="' + e(o ? o.download_window_days : D.defaults.download_window_days) + '"></label>' +
      "</div>" +
      (D.msg[c.catalog_key] ? '<div class="cro-meta" role="status" data-crds-msg>' + e(D.msg[c.catalog_key]) + "</div>" : "") +
      '<div class="cro-actions"><button class="cr-btn" type="button" data-crds-save="keep"' + (busy ? " disabled" : "") + ">Save</button>" +
      '<button class="cr-btn' + (live ? "" : " cr-btn--primary") + '" type="button" data-crds-save="' + (live ? "off" : "on") + '"' + (busy ? " disabled" : "") + ">" + (live ? "Take off sale" : "Put on sale") + "</button></div></div>";
  }

  function render() {
    if (!D.loaded && !D.loading) load();
    var head = '<section class="cro-card"><h2>Direct sales</h2><p class="cro-meta">Sell your own recordings straight from matthew.mccluster.org. Set a price, upload the full-quality file (it stays private; a buyer gets a five-minute link), choose how many downloads each purchase gets and for how many days, then put it on sale. Taking a track off sale never takes a download away from someone who bought it; a refund in Stripe closes that buyer\'s downloads.</p>';
    if (D.loading && !D.loaded) return head + note("Loading the catalogue…") + "</section>";
    if (D.error) return head + note("Direct sales are unavailable: " + (D.error.message || D.error), true) + "</section>";
    var groups = {}, order = [];
    D.catalogue.forEach(function (c) { if (!groups[c.album_title]) { groups[c.album_title] = []; order.push(c.album_title); } groups[c.album_title].push(c); });
    return head + (order.length ? order.map(function (a) { return "<h3>" + e(a) + '</h3><div class="cro-list">' + groups[a].map(item).join("") + "</div>"; }).join("") : note("The catalogue is empty.")) + "</section>";
  }

  function upload(key, file) {
    return call("operator-direct-upload-url", { catalog_key: key, file_name: file.name }).then(function (g) {
      var url = window.MCC_SUPA.url + "/storage/v1/object/upload/sign/" + encodeURIComponent(g.bucket) + "/" +
        g.path.split("/").map(encodeURIComponent).join("/") + "?token=" + encodeURIComponent(g.token);
      return fetch(url, { method: "PUT", headers: { "content-type": g.content_type || file.type || "application/octet-stream", "x-upsert": "false" }, body: file })
        .then(function (r) { if (!r.ok) throw new Error("Upload failed (" + r.status + ")"); D.files[key] = g.path; return g.path; });
    });
  }

  function bind(root) {
    (root ? root.querySelectorAll("[data-crds-save]") : []).forEach(function (b) {
      b.onclick = function () {
        var row = b.closest("[data-crds]"), key = row.getAttribute("data-crds"), mode = b.getAttribute("data-crds-save");
        var f = function (n) { return row.querySelector('[data-crds-f="' + n + '"]'); };
        var file = f("file").files && f("file").files[0];
        var body = { catalog_key: key, price_cents: Math.round(Number(f("price").value) * 100), max_downloads: Number(f("max").value), download_window_days: Number(f("days").value) };
        if (mode === "on") body.active = true;
        if (mode === "off") body.active = false;
        D.busy[key] = true; D.msg[key] = file ? "Uploading the file…" : "Saving…"; redraw();
        (file ? upload(key, file) : Promise.resolve(D.files[key] || "")).then(function (path) {
          if (path) body.asset_path = path;
          return call("operator-direct-save", body);
        }).then(function () {
          D.msg[key] = mode === "on" ? "On sale." : mode === "off" ? "Taken off sale. Buyers keep their downloads." : "Saved.";
          D.busy[key] = false; D.loaded = false; return load();
        }).catch(function (err) { D.busy[key] = false; D.msg[key] = err.message || "Could not save."; redraw(); });
      };
    });
  }

  window.CR.musicDirect = { init: function (opts) { D.rerender = opts.render; }, render: render, bind: bind, load: load, state: D };
})();
