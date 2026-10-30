/* McCluster Corp marketplace — the buyer's pages (market/index.html,
   shop.html, item.html, order.html). Everything is read from and sent to the
   canonical API, Worker `mccluster` (/v1/merch, workers/mccluster/src/merch/
   router.js). The page sends a listing, an option and a quantity; the server
   decides the price, the seller, the fee and the Stripe account. */
(function () {
  'use strict';
  var API = (window.MCC_MARKET_API || 'https://api.mccluster.org') + '/v1/merch';
  var $ = function (id) { return document.getElementById(id); };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(c) { return '$' + (Number(c || 0) / 100).toFixed(2); }
  function q(name) { try { return new URLSearchParams(location.search).get(name) || ''; } catch (_) { return ''; } }
  function call(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Request failed (' + r.status + ')')); e.status = r.status; e.detail = j.detail; throw e; }
        return j;
      });
    });
  }
  function alertBox(el, text, kind) { if (el) el.innerHTML = text ? '<div class="mk-alert' + (kind ? ' mk-alert--' + kind : '') + '" role="status">' + esc(text) + '</div>' : ''; }
  function fromPrice(l) {
    var prices = (l.variants || []).map(function (v) { return v.price_cents; }).filter(Boolean);
    var min = prices.length ? Math.min.apply(null, prices) : l.price_cents;
    return (prices.length && Math.max.apply(null, prices) !== min ? 'From ' : '') + money(min);
  }
  function card(l) {
    var img = (l.image_urls || [])[0];
    var soldOut = (l.variants || []).length && !(l.variants || []).some(function (v) { return v.in_stock; });
    return '<a class="mk-card" href="item.html?id=' + encodeURIComponent(l.id) + '">' +
      (img ? '<img class="mk-card__img" src="' + esc(img) + '" alt="" loading="lazy">' : '<div class="mk-card__img" aria-hidden="true"></div>') +
      '<div class="mk-card__body"><span class="mk-card__title">' + esc(l.title) + '</span>' +
      '<span class="mk-card__meta">' + esc(l.seller && l.seller.display_name) + '</span>' +
      '<span class="mk-price">' + (soldOut ? 'Sold out' : esc(fromPrice(l))) + '</span></div></a>';
  }
  function grid(el, listings) {
    el.innerHTML = listings.length ? '<div class="mk-grid">' + listings.map(card).join('') + '</div>'
      : '<div class="mk-empty">Nothing for sale here yet.</div>';
  }

  /* ---- storefront ---- */
  function storefront() {
    var el = $('mkListings');
    call('/listings').then(function (j) { grid(el, j.listings || []); })
      .catch(function (e) { alertBox(el, 'The marketplace could not load: ' + e.message, 'bad'); });
  }

  /* ---- a seller's shop ---- */
  function shop() {
    var slug = q('s'), el = $('mkListings');
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) { alertBox(el, 'That shop address is not right.', 'bad'); return; }
    call('/sellers/' + slug).then(function (j) {
      $('mkShopName').textContent = j.seller.display_name;
      $('mkShopBio').textContent = j.seller.bio || '';
      document.title = j.seller.display_name + ' · McCluster Corp Marketplace';
      if (j.seller.logo_url) { var logo = $('mkShopLogo'); logo.src = j.seller.logo_url; logo.hidden = false; }
      grid(el, j.listings || []);
    }).catch(function (e) { alertBox(el, e.status === 404 ? 'This shop is not open.' : e.message, 'bad'); });
  }

  /* ---- a product ---- */
  function product() {
    var id = q('id'), root = $('mkProduct'), state = { listing: null, variant: null, qty: 1, image: 0 };
    if (!/^[0-9a-f-]{36}$/i.test(id)) { alertBox(root, 'That item address is not right.', 'bad'); return; }
    function render() {
      var l = state.listing, v = state.variant, imgs = l.image_urls || [];
      var price = v ? v.price_cents : l.price_cents;
      root.innerHTML = '<div class="mk-product">' +
        '<div class="mk-gallery">' + (imgs.length ? '<img class="mk-gallery__main" id="mkMain" src="' + esc(imgs[state.image]) + '" alt="' + esc(l.title) + '">' : '<div class="mk-gallery__main" aria-hidden="true"></div>') +
        (imgs.length > 1 ? '<div class="mk-thumbs">' + imgs.map(function (u, i) { return '<img src="' + esc(u) + '" alt="Image ' + (i + 1) + '" data-img="' + i + '"' + (i === state.image ? ' class="is-on"' : '') + '>'; }).join('') + '</div>' : '') + '</div>' +
        '<div><a class="mk-muted" href="shop.html?s=' + encodeURIComponent(l.seller.slug) + '">' + esc(l.seller.display_name) + '</a>' +
        '<h1 class="mk-h1">' + esc(l.title) + '</h1>' +
        '<p class="mk-price" style="font-size:22px;margin:0 0 4px">' + money(price) + '</p>' +
        '<p class="mk-note" style="margin:0 0 14px">' + (l.shipping_cents ? '+ ' + money(l.shipping_cents) + ' shipping' : 'Free shipping') + ' · US only · sales tax at checkout</p>' +
        '<div class="mk-field"><span>Option</span><div class="mk-variants" role="radiogroup" aria-label="Option">' + (l.variants || []).map(function (x) {
          return '<button type="button" class="mk-variant' + (v && v.id === x.id ? ' is-on' : '') + '" role="radio" aria-checked="' + (v && v.id === x.id) + '" data-variant="' + esc(x.id) + '"' + (x.in_stock ? '' : ' disabled') + '>' + esc(x.label) + (x.available != null && x.available > 0 && x.available <= 5 ? ' · ' + x.available + ' left' : '') + '</button>';
        }).join('') + '</div></div>' +
        '<div class="mk-row" style="margin:14px 0"><label class="mk-field" style="width:110px"><span>Quantity</span><select id="mkQty">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return '<option' + (n === state.qty ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' +
        '<button type="button" class="mk-btn mk-btn--primary mk-btn--block" id="mkBuy"' + (v ? '' : ' disabled') + '>' + (v ? 'Buy now · ' + money(price * state.qty + l.shipping_cents) + ' + tax' : 'Choose an option') + '</button>' +
        '<div id="mkBuyNote"></div>' +
        '<p class="mk-note">You pay ' + esc(l.seller.display_name) + ' directly through Stripe; they ship it. McCluster Corp runs the marketplace.</p>' +
        (l.description ? '<div class="mk-panel" style="margin-top:14px;white-space:pre-wrap">' + esc(l.description) + '</div>' : '') +
        '</div></div>';
      root.querySelectorAll('[data-variant]').forEach(function (b) { b.onclick = function () { state.variant = (l.variants || []).find(function (x) { return x.id === b.getAttribute('data-variant'); }); render(); }; });
      root.querySelectorAll('[data-img]').forEach(function (b) { b.onclick = function () { state.image = Number(b.getAttribute('data-img')); render(); }; });
      $('mkQty').onchange = function () { state.qty = Number(this.value) || 1; render(); };
      var buy = $('mkBuy');
      buy.onclick = function () {
        buy.disabled = true; buy.textContent = 'Opening secure checkout…';
        call('/checkout', { method: 'POST', body: { listing_id: l.id, variant_id: state.variant.id, quantity: state.qty } }).then(function (j) {
          try { var mine = JSON.parse(localStorage.getItem('mcc_market_orders') || '[]'); mine.unshift({ t: j.order_token, title: l.title, at: Date.now() }); localStorage.setItem('mcc_market_orders', JSON.stringify(mine.slice(0, 20))); } catch (_) {}
          location.href = j.url;
        }).catch(function (e) { alertBox($('mkBuyNote'), e.message, 'bad'); buy.disabled = false; buy.textContent = 'Try again'; });
      };
    }
    call('/listings/' + id).then(function (j) {
      state.listing = j.listing;
      var first = (j.listing.variants || []).filter(function (x) { return x.in_stock; });
      state.variant = first.length === 1 && j.listing.variants.length === 1 ? first[0] : null;
      document.title = j.listing.title + ' · ' + j.listing.seller.display_name + ' · McCluster Corp Marketplace';
      render();
    }).catch(function (e) { alertBox(root, e.status === 404 ? 'This item is not for sale right now.' : e.message, 'bad'); });
  }

  /* ---- the buyer's order ---- */
  var STATUS = {
    pending: ['Waiting for payment', 'warn'], paid: ['Paid · the seller is preparing it', 'good'], fulfilled: ['Packed · shipping soon', 'good'],
    shipped: ['Shipped', 'good'], delivered: ['Delivered', 'good'], canceled: ['Checkout not completed', 'bad'], refunded: ['Refunded', 'bad']
  };
  function order() {
    var token = q('t'), root = $('mkOrder'), tries = 0;
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) { alertBox(root, 'Open this page from the link you got at checkout.', 'bad'); return; }
    function show(o) {
      var s = STATUS[o.status] || [o.status, ''];
      root.innerHTML = '<div class="mk-panel">' + (o.livemode === false ? '<div class="mk-alert">TEST ORDER · no money moved</div>' : '') +
        '<span class="mk-pill mk-pill--' + s[1] + '">' + esc(s[0]) + '</span>' +
        '<h1 class="mk-h1">' + esc(o.title) + '</h1><p class="mk-muted" style="margin:0">' + esc(o.variant) + ' × ' + esc(o.quantity) + ' · sold by <a href="shop.html?s=' + encodeURIComponent(o.seller.slug) + '">' + esc(o.seller.display_name) + '</a></p></div>' +
        '<div class="mk-panel"><h2>Total</h2><ul class="mk-steps"><li>Items <span style="margin-left:auto">' + money(o.subtotal_cents) + '</span></li><li>Shipping <span style="margin-left:auto">' + money(o.shipping_cents) + '</span></li>' +
        '<li>Sales tax <span style="margin-left:auto">' + (o.tax_cents == null ? '—' : money(o.tax_cents)) + '</span></li><li><b>Paid</b> <b style="margin-left:auto">' + (o.total_cents == null ? '—' : money(o.total_cents)) + '</b></li>' +
        (o.amount_refunded_cents ? '<li>Refunded <span style="margin-left:auto">' + money(o.amount_refunded_cents) + '</span></li>' : '') + '</ul></div>' +
        '<div class="mk-panel"><h2>Delivery</h2>' + (o.tracking_number ? '<p style="margin:0">' + esc(o.carrier) + ' · <b>' + esc(o.tracking_number) + '</b></p>' : '<p class="mk-muted" style="margin:0">Tracking appears here when the seller ships.</p>') +
        (o.ship_to ? '<p class="mk-note">Shipping to ' + esc([o.ship_to.city, o.ship_to.state].filter(Boolean).join(', ')) + '</p>' : '') +
        '<p class="mk-note">Keep this page\'s address: it is how you check this order.</p></div>';
    }
    function load() {
      call('/orders/status?token=' + encodeURIComponent(token)).then(function (j) {
        show(j.order);
        /* Stripe returns before its webhook lands: look again a few times */
        if (j.order.status === 'pending' && q('done') && tries++ < 8) setTimeout(load, 2500);
      }).catch(function (e) { alertBox(root, e.status === 404 ? 'We could not find that order.' : e.message, 'bad'); });
    }
    load();
  }

  window.MCC_MARKET = { esc: esc, money: money, call: call, alertBox: alertBox };
  var page = document.body.getAttribute('data-market');
  if (page === 'storefront') storefront();
  else if (page === 'shop') shop();
  else if (page === 'item') product();
  else if (page === 'order') order();
})();
