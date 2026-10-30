/* DIRECT CHECKOUT: "Buy MP3 — $X" on Matthew McCluster's own recordings.
   =====================================================================
   Owner, 2026-10-30: "I definitely need a direct checkout for all the music."

   Any element carrying data-albslug + data-title (album.html's track rows,
   catalogue.html's registry rows) is a recording; its catalogue key is the
   album slug and the slugified title, exactly as public.music_catalog_objects
   keys it ("here:who-did-the-shoot"). A button appears only when that
   recording has an offer on sale now, read from music-direct-checkout
   ("offers"); nothing appears when there is none or the service is down.
   A tap asks music-direct-checkout for a Stripe Checkout page for that
   offer: the request names the offer and nothing else, the server prices it.
   Stripe returns the buyer to purchase.html.
   ===================================================================== */
(function (root) {
  "use strict";
  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var FN = SB + "/functions/v1/music-direct-checkout";
  var offersP = null, byKey = {};

  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function catalogKey(album, title) { return slug(album) + ":" + slug(title); }
  function money(c, cur) {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: String(cur || "usd").toUpperCase() }).format(Number(c || 0) / 100); }
    catch (_) { return "$" + (Number(c || 0) / 100).toFixed(2); }
  }
  function post(body) {
    return fetch(FN, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || "Checkout is unavailable right now."); return d; }); });
  }
  function offers() {
    if (!offersP) {
      offersP = post({ action: "offers" }).then(function (d) {
        byKey = {};
        (d.offers || []).forEach(function (o) { if (o && o.catalog_key) byKey[o.catalog_key] = o; });
        return byKey;
      }).catch(function () { byKey = {}; return byKey; });
    }
    return offersP;
  }

  var styled = false;
  function style() {
    if (styled) return; styled = true;
    var s = document.createElement("style");
    s.textContent =
      ".mdbuy{-webkit-appearance:none;appearance:none;display:inline-flex;align-items:center;gap:.35em;margin-top:.4rem;" +
      "min-height:36px;padding:.4rem .8rem;border-radius:999px;border:1px solid currentColor;background:transparent;" +
      "color:var(--ruby-text,#ff6b6e);font:800 max(16px,.85rem)/1.1 var(--ui,system-ui,sans-serif);cursor:pointer;" +
      "touch-action:manipulation;white-space:nowrap;max-width:100%}" +
      ".mdbuy:hover,.mdbuy:focus-visible{background:color-mix(in srgb,currentColor 14%,transparent)}" +
      ".mdbuy[aria-busy=true]{opacity:.6;cursor:progress}" +
      ".mdbuy-err{display:block;margin-top:.3rem;font-size:.8rem;color:var(--cream-dim,#c9bfb2)}";
    document.head.appendChild(s);
  }

  function decorate(scope) {
    var rows = (scope || document).querySelectorAll("[data-albslug][data-title]:not([data-direct-done])");
    if (!rows.length) return;
    offers().then(function (map) {
      Array.prototype.forEach.call(rows, function (row) {
        if (row.hasAttribute("data-direct-done")) return;
        row.setAttribute("data-direct-done", "");
        var o = map[catalogKey(row.getAttribute("data-albslug"), row.getAttribute("data-title"))];
        if (!o) return;
        style();
        var b = document.createElement("button");
        b.type = "button";
        b.className = "mdbuy";
        b.setAttribute("data-direct-offer", o.offer_key);
        b.setAttribute("data-cta", "direct-buy");
        b.setAttribute("aria-label", "Buy " + (o.title || row.getAttribute("data-title")) + " as an MP3 for " + money(o.price_cents, o.currency));
        b.textContent = "Buy MP3 — " + money(o.price_cents, o.currency);
        var host = row.querySelector(".t") || row;
        host.appendChild(b);
      });
    });
  }

  /* capture phase: the album row plays on click, the buy button must not */
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("[data-direct-offer]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.getAttribute("aria-busy") === "true") return;
    b.setAttribute("aria-busy", "true");
    var key = b.getAttribute("data-direct-offer");
    if (root.MCC_TRACK) root.MCC_TRACK("direct_buy_click", { offer: key });
    var old = b.parentNode && b.parentNode.querySelector(".mdbuy-err");
    if (old) old.remove();
    post({ action: "checkout", offer_key: key }).then(function (d) {
      if (!d.url || !/^https:\/\/checkout\.stripe\.com\//.test(d.url)) throw new Error("Checkout is unavailable right now.");
      root.location.assign(d.url);
    }).catch(function (err) {
      b.removeAttribute("aria-busy");
      var m = document.createElement("small");
      m.className = "mdbuy-err";
      m.setAttribute("role", "status");
      m.textContent = err.message || "Checkout is unavailable right now.";
      b.insertAdjacentElement("afterend", m);
    });
  }, true);

  function start() {
    decorate(document);
    if (root.MutationObserver) {
      new MutationObserver(function () { decorate(document); })
        .observe(document.body, { childList: true, subtree: true });
    }
  }
  root.MCC_DIRECT = { catalogKey: catalogKey, offers: offers, decorate: decorate };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(window);
