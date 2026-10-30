/* McCluster Corp marketplace — the seller's page (market/sell.html).
   Apply, finish Stripe onboarding (Express, Stripe-hosted), then run the shop:
   listings with images, options, stock, price and shipping; orders with
   shipping and tracking; refunds; the Stripe payouts dashboard. Every call is
   the canonical API with the member's own session (/v1/merch/seller*); the
   server decides who may do what. */
(function () {
  'use strict';
  var API = (window.MCC_MARKET_API || 'https://api.mccluster.org') + '/v1/merch';
  var $ = function (id) { return document.getElementById(id); };
  var M = window.MCC_MARKET;
  var esc = M.esc, money = M.money;
  var S = { data: null, tab: 'listings', editing: null, busy: false, flash: null };
  var root = $('mkSell');

  function token() { return window.MCC_SUPA && MCC_SUPA.token ? MCC_SUPA.token() : Promise.resolve(null); }
  function call(path, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (!t) { var e = new Error('Sign in first'); e.status = 401; throw e; }
      return fetch(API + path, { method: opts.method || 'GET', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Request failed (' + r.status + ')')); e.status = r.status; e.detail = j.detail; throw e; }
        return j;
      });
    });
  }
  function dollars(c) { return c == null ? '' : (Number(c) / 100).toFixed(2); }
  function cents(v) { var n = Math.round(parseFloat(String(v).replace(/[$,]/g, '')) * 100); return Number.isFinite(n) ? n : null; }
  function flash(text, kind) { S.flash = text ? { text: text, kind: kind } : null; var el = $('mkFlash'); if (el) M.alertBox(el, text, kind); if (text) window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function flashBox() { return '<div id="mkFlash">' + (S.flash ? '<div class="mk-alert' + (S.flash.kind ? ' mk-alert--' + S.flash.kind : '') + '" role="status">' + esc(S.flash.text) + '</div>' : '') + '</div>'; }
  function pill(text, kind) { return '<span class="mk-pill' + (kind ? ' mk-pill--' + kind : '') + '">' + esc(text) + '</span>'; }

  function load() {
    return call('/seller').then(function (j) { S.data = j; render(); }).catch(function (e) {
      if (e.status === 401) {
        root.innerHTML = '<div class="mk-panel"><h2>Sign in to sell</h2><p class="mk-muted">Your M Account opens your shop. It is the same sign-in you use across McCluster.</p>' +
          '<a class="mk-btn mk-btn--primary" href="/login.html?next=' + encodeURIComponent('/market/sell.html') + '">Sign in</a></div>';
        return;
      }
      M.alertBox(root, e.message, 'bad');
    });
  }

  /* ---------------- apply ---------------- */
  function applyForm() {
    return '<div class="mk-panel"><h2>Open your shop</h2><p class="mk-muted">Sell your merch to the McCluster community. You are the seller: buyers pay you through Stripe, you ship, and McCluster Corp keeps ' +
      (S.data.platform_fee_bps / 100) + '% of each sale\'s items and shipping (never of sales tax). McCluster approves each shop before it goes public.</p>' +
      '<form class="mk-form" id="mkApply"><label class="mk-field"><span>Shop name</span><input name="display_name" maxlength="80" required autocomplete="organization"></label>' +
      '<label class="mk-field"><span>Shop address</span><input name="slug" maxlength="40" required pattern="[a-z0-9][a-z0-9\\-]{1,38}[a-z0-9]" placeholder="your-shop" autocapitalize="none" spellcheck="false"></label>' +
      '<label class="mk-field"><span>About the shop</span><textarea name="bio" maxlength="2000"></textarea></label>' +
      '<button class="mk-btn mk-btn--primary" type="submit">Apply</button></form></div>';
  }

  /* ---------------- status ---------------- */
  function statusPanel(d) {
    var s = d.seller, st = d.stripe || {}, tax = d.tax || {};
    var approval = s.status === 'approved' ? pill('Approved', 'good') : s.status === 'suspended' ? pill('Suspended', 'bad') : pill('Waiting for McCluster approval', 'warn');
    var stripe = st.ready ? pill('Stripe ready', 'good') : st.connected ? pill('Stripe: finish onboarding', 'warn') : pill('Stripe not connected', 'warn');
    var taxPill = tax.status === 'active' ? pill('Sales tax on', 'good') : pill('Sales tax not set up', 'warn');
    var due = (st.requirements && st.requirements.currently_due || []).length;
    return '<div class="mk-panel"><div class="mk-item__head"><div><h2 style="margin:0">' + esc(s.display_name) + '</h2><a class="mk-muted" href="shop.html?s=' + encodeURIComponent(s.slug) + '">/market/shop.html?s=' + esc(s.slug) + '</a></div></div>' +
      '<ul class="mk-steps" style="margin-top:12px"><li>' + approval + '</li><li>' + stripe + (due ? '<span class="mk-muted">' + due + ' item' + (due === 1 ? '' : 's') + ' Stripe still needs</span>' : '') + '</li><li>' + taxPill + '</li></ul>' +
      (s.status_reason ? '<p class="mk-note">' + esc(s.status_reason) + '</p>' : '') +
      (tax.status !== 'active' && st.connected ? '<p class="mk-note">Buyers cannot check out until Stripe Tax is active on your account: your head office address and the states where you are registered to collect sales tax. You are the seller of record and owe the tax; McCluster never sells untaxed.</p>' : '') +
      '<div class="mk-row" style="margin-top:12px">' + (s.role === 'owner' ? (!st.ready ? '<button class="mk-btn mk-btn--primary" type="button" data-act="onboard">' + (st.connected ? 'Continue Stripe onboarding' : 'Connect Stripe') + '</button>' : '<button class="mk-btn" type="button" data-act="payouts">Payouts &amp; Stripe dashboard</button>') : '') + '</div></div>';
  }

  /* ---------------- listings ---------------- */
  function listingCard(l) {
    var kind = { draft: '', pending_review: 'warn', published: 'good', removed: 'bad' }[l.status];
    var stock = (l.variants || []).filter(function (v) { return v.active; }).map(function (v) { return esc(v.label) + (l.inventory_policy === 'tracked' ? ' (' + (v.inventory_count || 0) + ')' : ''); }).join(' · ');
    return '<div class="mk-item"><div class="mk-item__head"><div><b>' + esc(l.title) + '</b><div class="mk-muted" style="font-size:14px">' + money(l.price_cents) + ' · ship ' + money(l.shipping_cents) + '</div><div class="mk-muted" style="font-size:13px">' + stock + '</div></div>' +
      pill(l.status === 'pending_review' ? 'waiting for approval' : l.status, kind) + '</div>' +
      (l.removed_reason ? '<p class="mk-note">Removed by McCluster: ' + esc(l.removed_reason) + '</p>' : '') +
      '<div class="mk-row">' + (l.status !== 'removed' ? '<button class="mk-btn mk-btn--small" type="button" data-edit="' + esc(l.id) + '">Edit</button>' : '') +
      (l.status === 'draft' ? '<button class="mk-btn mk-btn--small mk-btn--primary" type="button" data-publish="' + esc(l.id) + '">Publish</button>' : '') +
      (l.status === 'published' ? '<a class="mk-btn mk-btn--small" href="item.html?id=' + encodeURIComponent(l.id) + '">View</a>' : '') + '</div></div>';
  }
  function blankListing() { return { id: null, title: '', description: '', images: [], image_urls: [], price_cents: null, shipping_cents: 500, inventory_policy: 'tracked', variants: [{ label: 'One size', options: {}, sku: '', price_cents: null, inventory_count: 0, active: true }] }; }
  function editor(l) {
    var vrows = (l.variants || []).filter(function (v) { return v.active !== false; });
    return '<div class="mk-panel"><h2>' + (l.id ? 'Edit listing' : 'New listing') + '</h2><form class="mk-form" id="mkEditor">' +
      '<label class="mk-field"><span>Title</span><input name="title" maxlength="120" required value="' + esc(l.title) + '"></label>' +
      '<label class="mk-field"><span>Description</span><textarea name="description" maxlength="5000">' + esc(l.description) + '</textarea></label>' +
      '<div class="mk-form mk-form--2"><label class="mk-field"><span>Price (USD)</span><input name="price" inputmode="decimal" required value="' + esc(dollars(l.price_cents)) + '" placeholder="25.00"></label>' +
      '<label class="mk-field"><span>Shipping (USD, US only)</span><input name="shipping" inputmode="decimal" value="' + esc(dollars(l.shipping_cents)) + '"></label></div>' +
      '<label class="mk-field"><span>Stock</span><select name="inventory_policy"><option value="tracked"' + (l.inventory_policy === 'tracked' ? ' selected' : '') + '>Count my stock</option><option value="untracked"' + (l.inventory_policy === 'untracked' ? ' selected' : '') + '>Made to order (no count)</option></select></label>' +
      '<div class="mk-field"><span>Images (JPEG, PNG or WebP, up to 8)</span><div class="mk-imgs" id="mkImgs">' + (l.images || []).map(function (p, i) { return '<figure><img src="' + esc((l.image_urls || [])[i] || '') + '" alt=""><button type="button" aria-label="Remove image" data-rmimg="' + i + '">×</button></figure>'; }).join('') + '</div>' +
      '<input type="file" id="mkFile" accept="image/jpeg,image/png,image/webp"></div>' +
      '<div class="mk-field"><span>Options (size, colour…), each with its own SKU, price and stock</span><div class="mk-list" id="mkVariants">' + vrows.map(variantRow).join('') + '</div>' +
      '<button class="mk-btn mk-btn--small" type="button" data-act="addvariant">+ Add option</button></div>' +
      '<div class="mk-row"><button class="mk-btn mk-btn--primary" type="submit">Save</button><button class="mk-btn" type="button" data-act="cancel">Cancel</button>' +
      (l.status === 'published' ? '<button class="mk-btn" type="button" data-act="unpublish">Unpublish</button>' : '') + '</div></form></div>';
  }
  function variantRow(v) {
    var o = v.options || {};
    return '<div class="mk-vrow" data-vid="' + esc(v.id || '') + '"><label class="mk-field mk-field--wide"><span>Name</span><input data-v="label" maxlength="80" value="' + esc(v.label) + '"></label>' +
      '<label class="mk-field"><span>Size</span><input data-v="size" maxlength="40" value="' + esc(o.size || '') + '"></label>' +
      '<label class="mk-field"><span>Colour</span><input data-v="colour" maxlength="40" value="' + esc(o.colour || '') + '"></label>' +
      '<label class="mk-field"><span>SKU</span><input data-v="sku" maxlength="64" value="' + esc(v.sku || '') + '" autocapitalize="characters"></label>' +
      '<label class="mk-field"><span>Price override</span><input data-v="price" inputmode="decimal" value="' + esc(dollars(v.price_cents)) + '" placeholder="same"></label>' +
      '<label class="mk-field"><span>In stock</span><input data-v="stock" inputmode="numeric" value="' + esc(v.inventory_count == null ? '' : v.inventory_count) + '"></label>' +
      '<div class="mk-field" style="align-self:end"><button class="mk-btn mk-btn--small" type="button" data-rmvariant>Remove</button></div></div>';
  }
  function readEditor(form) {
    var l = S.editing;
    var variants = Array.prototype.map.call(form.querySelectorAll('.mk-vrow'), function (row) {
      var g = function (k) { return (row.querySelector('[data-v="' + k + '"]') || {}).value || ''; };
      var stock = g('stock').trim();
      return { id: row.getAttribute('data-vid') || null, label: g('label').trim(), options: { size: g('size').trim(), colour: g('colour').trim() }, sku: g('sku').trim(),
        price_cents: g('price').trim() ? cents(g('price')) : null, inventory_count: stock === '' ? null : parseInt(stock, 10), active: true };
    });
    return { title: form.title.value, description: form.description.value, price_cents: cents(form.price.value), shipping_cents: cents(form.shipping.value || '0') || 0,
      inventory_policy: form.inventory_policy.value, images: l.images.slice(), variants: variants };
  }

  /* ---------------- orders ---------------- */
  function orderCard(o) {
    var kind = { paid: 'warn', fulfilled: 'warn', shipped: 'good', delivered: 'good', refunded: 'bad' }[o.status];
    var a = o.shipping_address || {};
    var left = (o.total_cents || 0) - (o.amount_refunded_cents || 0);
    return '<div class="mk-item"><div class="mk-item__head"><div><b>' + esc(o.title_snapshot) + '</b><div class="mk-muted" style="font-size:14px">' + esc(o.variant_label) + (o.sku ? ' · ' + esc(o.sku) : '') + ' × ' + esc(o.quantity) + '</div></div>' + pill(o.livemode ? o.status : 'test · ' + o.status, kind) + '</div>' +
      '<div style="font-size:14px">' + money(o.total_cents) + ' paid (' + money(o.tax_cents) + ' tax) · McCluster fee ' + money(o.platform_fee_cents) + (o.amount_refunded_cents ? ' · refunded ' + money(o.amount_refunded_cents) : '') + '</div>' +
      '<div class="mk-muted" style="font-size:14px;overflow-wrap:anywhere">Ship to: ' + esc([a.name, a.line1, a.line2, a.city, a.state, a.postal_code].filter(Boolean).join(', ') || '—') + (o.buyer_email ? '<br>' + esc(o.buyer_email) : '') + '</div>' +
      (o.tracking_number ? '<div style="font-size:14px">' + esc(o.carrier) + ' · ' + esc(o.tracking_number) + '</div>' : '') +
      (['paid', 'fulfilled'].indexOf(o.status) >= 0 ? '<div class="mk-form mk-form--2"><label class="mk-field"><span>Carrier</span><select data-carrier="' + esc(o.id) + '"><option>USPS</option><option>UPS</option><option>FedEx</option><option>DHL</option><option>Other</option></select></label>' +
        '<label class="mk-field"><span>Tracking number</span><input data-tracking="' + esc(o.id) + '" maxlength="64" autocapitalize="characters"></label></div>' : '') +
      '<div class="mk-row">' + (['paid', 'fulfilled'].indexOf(o.status) >= 0 ? '<button class="mk-btn mk-btn--small mk-btn--primary" type="button" data-ship="' + esc(o.id) + '">Mark shipped</button>' : '') +
      (o.status === 'paid' ? '<button class="mk-btn mk-btn--small" type="button" data-pack="' + esc(o.id) + '">Mark packed</button>' : '') +
      (o.status === 'shipped' ? '<button class="mk-btn mk-btn--small" type="button" data-deliver="' + esc(o.id) + '">Mark delivered</button>' : '') +
      (S.data.seller.role === 'owner' && o.status !== 'refunded' && left > 0 ? '<button class="mk-btn mk-btn--small" type="button" data-refund="' + esc(o.id) + '" data-left="' + left + '">Refund</button>' : '') + '</div></div>';
  }

  function render() {
    var d = S.data;
    if (!d.seller) { root.innerHTML = flashBox() + applyForm(); bind(); return; }
    var orders = d.orders || [], open = orders.filter(function (o) { return o.status === 'paid' || o.status === 'fulfilled'; }).length;
    var body;
    if (S.editing) body = editor(S.editing);
    else if (S.tab === 'orders') body = orders.length ? '<div class="mk-list">' + orders.map(orderCard).join('') + '</div>' : '<div class="mk-empty">No orders yet.</div>';
    else body = '<div class="mk-row" style="margin-bottom:10px"><button class="mk-btn mk-btn--primary" type="button" data-act="new">+ New listing</button></div>' +
      ((d.listings || []).length ? '<div class="mk-list">' + d.listings.map(listingCard).join('') + '</div>' : '<div class="mk-empty">No listings yet. Add your first item.</div>');
    root.innerHTML = flashBox() + statusPanel(d) +
      (S.editing ? '' : '<div class="mk-tabs" role="tablist"><button class="mk-tab' + (S.tab === 'listings' ? ' is-on' : '') + '" type="button" role="tab" data-tab="listings">Listings · ' + (d.listings || []).length + '</button><button class="mk-tab' + (S.tab === 'orders' ? ' is-on' : '') + '" type="button" role="tab" data-tab="orders">Orders' + (open ? ' · ' + open + ' to ship' : '') + '</button></div>') + body;
    bind();
  }

  function act(promise, okText) {
    if (S.busy) return; S.busy = true;
    return promise.then(function (r) { S.busy = false; if (okText) flash(typeof okText === 'function' ? okText(r) : okText, 'good'); return load(); })
      .catch(function (e) { S.busy = false; flash(e.message, 'bad'); });
  }

  function upload(file) {
    if (!file) return;
    if (S.editing.images.length >= 8) { flash('Up to 8 images', 'bad'); return; }
    flash('Uploading…');
    call('/seller/uploads', { method: 'POST', body: { content_type: file.type, byte_size: file.size } }).then(function (g) {
      return fetch(g.upload_url, { method: 'PUT', headers: { 'content-type': file.type }, body: file }).then(function (r) {
        if (!r.ok) throw new Error('The image did not upload');
        S.editing.images.push(g.path); S.editing.image_urls = (S.editing.image_urls || []).concat(g.public_url);
        var form = $('mkEditor'); if (form) { var draft = readEditor(form); Object.assign(S.editing, draft, { images: S.editing.images }); }
        flash(''); render();
      });
    }).catch(function (e) { flash(e.message, 'bad'); });
  }

  function bind() {
    var apply = $('mkApply');
    if (apply) apply.onsubmit = function (ev) {
      ev.preventDefault();
      act(call('/seller/apply', { method: 'POST', body: { display_name: apply.display_name.value, slug: apply.slug.value.toLowerCase(), bio: apply.bio.value } }), 'Applied. Next: connect Stripe so buyers can pay you.');
    };
    root.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-tab'); render(); }; });
    root.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-act');
        if (a === 'onboard' || a === 'payouts') { b.disabled = true; call(a === 'onboard' ? '/seller/onboard' : '/seller/payouts-link', { method: 'POST', body: {} }).then(function (j) { location.href = j.url; }).catch(function (e) { b.disabled = false; flash(e.message, 'bad'); }); }
        if (a === 'new') { S.editing = blankListing(); render(); }
        if (a === 'cancel') { S.editing = null; render(); }
        if (a === 'addvariant') { var list = $('mkVariants'); list.insertAdjacentHTML('beforeend', variantRow({ label: '', options: {}, inventory_count: 0 })); bind(); }
        if (a === 'unpublish') act(call('/seller/listings/' + S.editing.id, { method: 'PATCH', body: { unpublish: true } }).then(function () { S.editing = null; }), 'Unpublished. It is a draft again.');
      };
    });
    root.querySelectorAll('[data-rmvariant]').forEach(function (b) { b.onclick = function () { b.closest('.mk-vrow').remove(); }; });
    root.querySelectorAll('[data-rmimg]').forEach(function (b) { b.onclick = function () { var i = Number(b.getAttribute('data-rmimg')); S.editing.images.splice(i, 1); S.editing.image_urls.splice(i, 1); render(); }; });
    var file = $('mkFile'); if (file) file.onchange = function () { upload(file.files && file.files[0]); };
    var ed = $('mkEditor');
    if (ed) ed.onsubmit = function (ev) {
      ev.preventDefault();
      var body = readEditor(ed), id = S.editing.id;
      act((id ? call('/seller/listings/' + id, { method: 'PATCH', body: body }) : call('/seller/listings', { method: 'POST', body: body })).then(function (r) { S.editing = null; return r; }), 'Saved.');
    };
    root.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { var l = S.data.listings.find(function (x) { return x.id === b.getAttribute('data-edit'); }); S.editing = JSON.parse(JSON.stringify(l)); render(); }; });
    root.querySelectorAll('[data-publish]').forEach(function (b) {
      b.onclick = function () { act(call('/seller/listings/' + b.getAttribute('data-publish') + '/publish', { method: 'POST', body: {} }), function (r) { return r.status === 'published' ? 'Published. It is live in the marketplace.' : 'Sent for review: it goes live once McCluster approves your shop and Stripe is ready.'; }); };
    });
    root.querySelectorAll('[data-ship]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-ship');
        act(call('/seller/orders/' + id + '/fulfil', { method: 'POST', body: { status: 'shipped', carrier: root.querySelector('[data-carrier="' + id + '"]').value, tracking_number: root.querySelector('[data-tracking="' + id + '"]').value } }), 'Marked shipped. The buyer sees the tracking number.');
      };
    });
    root.querySelectorAll('[data-pack]').forEach(function (b) { b.onclick = function () { act(call('/seller/orders/' + b.getAttribute('data-pack') + '/fulfil', { method: 'POST', body: { status: 'fulfilled' } }), 'Marked packed.'); }; });
    root.querySelectorAll('[data-deliver]').forEach(function (b) { b.onclick = function () { act(call('/seller/orders/' + b.getAttribute('data-deliver') + '/fulfil', { method: 'POST', body: { status: 'delivered' } }), 'Marked delivered.'); }; });
    root.querySelectorAll('[data-refund]').forEach(function (b) {
      b.onclick = function () {
        var left = Number(b.getAttribute('data-left'));
        var raw = window.prompt('Refund how much? Up to ' + money(left) + '. McCluster\'s fee is returned with it.', (left / 100).toFixed(2));
        if (raw == null) return;
        act(call('/seller/orders/' + b.getAttribute('data-refund') + '/refund', { method: 'POST', body: { amount_cents: cents(raw) } }), 'Refund sent to Stripe. The order updates when Stripe confirms it.');
      };
    });
  }

  var back = new URLSearchParams(location.search).get('stripe');
  load().then(function () { if (back === 'return') flash('Back from Stripe. If anything is still due, Stripe lists it above.', 'good'); });
})();
