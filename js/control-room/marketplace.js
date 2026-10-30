/* Native Control · Work · Marketplace.

   The owner's desk for the McCluster Corp merch marketplace: approve or
   suspend sellers, take a listing down (or restore it to its seller as a
   draft), and see orders and McCluster's platform fee. Every read and action
   is GET/POST /v1/merch/admin* on Worker `mccluster`, which refuses anyone
   without `ops.use` on the house org; nothing here decides authority. */
(function () {
  "use strict";
  window.CR = window.CR || {};
  var S = { request: null, rerender: null, loading: false, loaded: false, error: null, data: null, tab: "sellers", busy: false };
  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(c) { return "$" + (Number(c || 0) / 100).toFixed(2); }
  function note(t, bad) { return '<div class="cro-note' + (bad ? " cro-note--bad" : "") + '">' + e(t) + "</div>"; }
  function redraw() { if (S.rerender) S.rerender(); }
  function load() {
    if (S.loading) return Promise.resolve();
    S.loading = true; S.error = null; redraw();
    return S.request("/v1/merch/admin").then(function (d) { S.data = d; })
      .catch(function (err) { S.error = err; })
      .then(function () { S.loading = false; S.loaded = true; redraw(); });
  }
  function stripeWord(r) {
    if (!r) return "Stripe not started";
    if (r.charges_enabled && r.payouts_enabled && r.details_submitted) return "Stripe ready";
    return "Stripe " + (r.onboarding_status || "onboarding");
  }
  function sellers(d) {
    var list = d.sellers || [];
    if (!list.length) return note("No seller has applied yet.");
    var order = { applied: 0, suspended: 1, approved: 2 };
    return '<div class="cro-list">' + list.slice().sort(function (a, b) { return order[a.status] - order[b.status]; }).map(function (s) {
      return '<div class="cro-item"><div class="cro-item__head"><div><strong>' + e(s.display_name) + '</strong><div class="cro-meta">/' + e(s.slug) + " · " + e(stripeWord(s.stripe)) + " · applied " + e(new Date(s.created_at).toLocaleDateString()) + "</div>" +
        (s.bio ? '<div class="cro-meta">' + e(s.bio.slice(0, 240)) + "</div>" : "") + (s.status_reason ? '<div class="cro-meta">Reason: ' + e(s.status_reason) + "</div>" : "") +
        '</div><span class="cro-pill">' + e(s.status) + '</span></div><div class="cro-actions">' +
        (s.status !== "approved" ? '<button class="cr-btn cr-btn--primary" type="button" data-crmk-seller="approve" data-id="' + e(s.org_id) + '">Approve</button>' : "") +
        (s.status !== "suspended" ? '<button class="cr-btn" type="button" data-crmk-seller="suspend" data-id="' + e(s.org_id) + '">Suspend</button>' : "") +
        '<a class="cr-btn" href="market/shop.html?s=' + encodeURIComponent(s.slug) + '" target="_blank" rel="noopener">Shop</a></div></div>';
    }).join("") + "</div>";
  }
  function listings(d) {
    var by = {}; (d.sellers || []).forEach(function (s) { by[s.org_id] = s; });
    var list = d.listings || [];
    if (!list.length) return note("No listings yet.");
    return '<div class="cro-list">' + list.map(function (l) {
      var s = by[l.seller_org_id] || {};
      return '<div class="cro-item"><div class="cro-item__head"><div><strong>' + e(l.title) + '</strong><div class="cro-meta">' + e(s.display_name || "") + " · " + money(l.price_cents) + " + " + money(l.shipping_cents) + " shipping</div>" +
        (l.removed_reason ? '<div class="cro-meta">Removed: ' + e(l.removed_reason) + "</div>" : "") + '</div><span class="cro-pill">' + e(l.status) + '</span></div>' +
        ((l.image_urls || []).length ? '<div class="cro-meta"><img src="' + e(l.image_urls[0]) + '" alt="" width="64" height="64" style="object-fit:cover;border-radius:8px"></div>' : "") +
        '<div class="cro-actions">' + (l.status !== "removed" ? '<button class="cr-btn" type="button" data-crmk-listing="remove" data-id="' + e(l.id) + '">Remove</button>' : '<button class="cr-btn" type="button" data-crmk-listing="restore" data-id="' + e(l.id) + '">Restore as draft</button>') +
        (l.status === "published" ? '<a class="cr-btn" href="market/item.html?id=' + encodeURIComponent(l.id) + '" target="_blank" rel="noopener">View</a>' : "") + "</div></div>";
    }).join("") + "</div>";
  }
  function orders(d) {
    var by = {}; (d.sellers || []).forEach(function (s) { by[s.org_id] = s; });
    var list = (d.orders || []).filter(function (o) { return o.status !== "canceled"; });
    if (!list.length) return note("No paid orders yet.");
    return '<div class="cro-list">' + list.map(function (o) {
      return '<div class="cro-row"><div class="cro-row__top"><b>' + e(o.title_snapshot) + " · " + e(o.variant_label) + " × " + e(o.quantity) + '</b><span class="cro-meta">' + e((by[o.seller_org_id] || {}).display_name || "") + "</span></div>" +
        '<div class="cro-meta">' + (o.livemode ? "" : "TEST · ") + e(o.status) + " · " + money(o.total_cents) + " (tax " + money(o.tax_cents) + ") · fee " + money(o.platform_fee_cents) + (o.amount_refunded_cents ? " · refunded " + money(o.amount_refunded_cents) : "") + "</div></div>";
    }).join("") + "</div>";
  }
  function render() {
    if (!S.loaded && !S.loading) load();
    var head = S.loading && !S.loaded ? note("Loading the marketplace…") : S.error ? note("The marketplace could not be read: " + (S.error.message || S.error) + (S.error.status === 503 ? ". The marketplace SQL (supabase/pending/merch_marketplace_v1.sql) is not applied yet." : ""), true) : "";
    var d = S.data;
    if (!d) return '<div class="cro">' + head + "</div>";
    var t = d.totals || {}, waiting = (d.sellers || []).filter(function (s) { return s.status === "applied"; }).length;
    var stats = '<div class="cro-statgrid"><div class="cro-stat"><b>' + e(waiting) + '</b><span>sellers waiting</span></div><div class="cro-stat"><b>' + e(t.orders || 0) + '</b><span>live orders</span></div>' +
      '<div class="cro-stat"><b>' + money(t.gross_cents) + '</b><span>sold (incl. tax)</span></div><div class="cro-stat"><b>' + money(t.platform_fee_cents) + '</b><span>McCluster fee (' + (d.platform_fee_bps / 100) + '%)</span></div></div>' +
      (t.test_orders ? '<div class="cro-meta">Test mode: ' + e(t.test_orders) + " test orders kept apart, not revenue.</div>" : "");
    var tabs = '<div class="cro-chips" style="margin-top:10px">' + [["sellers", "Sellers"], ["listings", "Listings"], ["orders", "Orders"]].map(function (x) { return '<button class="cro-chip' + (S.tab === x[0] ? " is-on" : "") + '" type="button" data-crmk-tab="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>";
    var body = S.tab === "listings" ? listings(d) : S.tab === "orders" ? orders(d) : sellers(d);
    return '<div class="cro">' + head + '<section class="cro-card"><h2>Marketplace</h2>' + stats + tabs + '<div style="margin-top:10px">' + body + "</div>" +
      '<p class="cro-meta" style="margin-top:8px">Sellers are the merchant of record on their own Stripe accounts; McCluster takes its fee on items and shipping, never on tax. A seller is public only when approved here and ready at Stripe.</p></section></div>';
  }
  function act(path, body, btn) {
    if (S.busy) return; S.busy = true; if (btn) btn.disabled = true;
    S.request(path, { method: "POST", body: body || {} }).then(function () { S.busy = false; S.loaded = false; return load(); })
      .catch(function (err) { S.busy = false; if (btn) btn.disabled = false; alert(err.message || "Marketplace action failed"); });
  }
  function bind(root) {
    if (!root) return;
    root.querySelectorAll("[data-crmk-tab]").forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute("data-crmk-tab"); redraw(); }; });
    root.querySelectorAll("[data-crmk-seller]").forEach(function (b) {
      b.onclick = function () {
        var what = b.getAttribute("data-crmk-seller"), reason = "";
        if (what === "suspend") { reason = prompt("Why is this shop suspended? The seller sees this.", "") ; if (reason === null) return; }
        act("/v1/merch/admin/sellers/" + encodeURIComponent(b.getAttribute("data-id")) + "/" + what, { reason: reason }, b);
      };
    });
    root.querySelectorAll("[data-crmk-listing]").forEach(function (b) {
      b.onclick = function () {
        var what = b.getAttribute("data-crmk-listing"), reason = "";
        if (what === "remove") { reason = prompt("Why is this listing removed? The seller sees this.", ""); if (reason === null) return; }
        act("/v1/merch/admin/listings/" + encodeURIComponent(b.getAttribute("data-id")) + "/" + what, { reason: reason }, b);
      };
    });
  }
  window.CR.marketplace = { init: function (opts) { S.request = opts.request; S.rerender = opts.render; }, render: render, bind: bind, load: load, state: S };
})();
