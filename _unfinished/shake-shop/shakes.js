/* ============================================================
   SHK — the shake run's data layer.

   Same law as js/eu-api.js one floor down: the storefront and the
   runner's desk talk to THIS object and never to storage directly, and
   this file borrows the session from window.MCC_SUPA rather than
   building a second one. Load js/backend.js first.

   THE ONE RULE WORTH REPEATING. Nothing in this file is allowed to
   decide what a shake costs. The cart it sends is a list of NAMES and
   quantities; the price comes back from supabase/functions/shake-order,
   which reads the menu out of the database and does the arithmetic
   there (supabase/functions/shake-order/price.ts, and its tests). If
   you ever find yourself adding up cents in this file for anything but
   a preview the customer is shown, you have put the till in the street.

   The running total drawn on the page IS computed here, because a total
   that waits on a network round-trip per tap feels broken. It is a
   preview and nothing more: the money charged is the money the edge
   function quotes back at checkout, and if the two ever disagree the
   edge function is right.

   THE FALLBACK. The menu falls back to data/shakes.json so the shop
   window still paints on a bad connection or before the migration has
   run anywhere. The WINDOW never falls back: "are we open" has exactly
   one honest answer and it is the live one. No answer means closed.
   ============================================================ */
window.SHK = (function () {
  "use strict";

  var SUPA = window.MCC_SUPA || null;
  var ROOT = (function () {
    var p = location.pathname;
    return /\/(walls|closet|tracks|demos)\//.test(p) ? "../" : "";
  })();

  function rest(path) { return SUPA.url + "/rest/v1/" + path; }

  function pub(path) {
    if (!SUPA) return Promise.reject(new Error("no backend"));
    return fetch(rest(path), { headers: { apikey: SUPA.key, Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("shk " + r.status); return r.json(); });
  }

  function auth(path, opts) {
    opts = opts || {};
    if (!SUPA) return Promise.reject(new Error("no backend"));
    return SUPA.token().then(function (t) {
      if (!t) throw new Error("signed out");
      var h = { apikey: SUPA.key, Authorization: "Bearer " + t, "Content-Type": "application/json" };
      if (opts.prefer) h.Prefer = opts.prefer;
      return fetch(rest(path), {
        method: opts.method || "GET",
        headers: h,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("shk " + r.status)); });
      return r.status === 204 ? null : r.json().catch(function () { return null; });
    });
  }

  /* the till. A customer has no account, so this call carries the anon
     key and, only if there happens to be one, a session. */
  function fn(body) {
    if (!SUPA) return Promise.reject(new Error("no backend"));
    return (SUPA.token ? SUPA.token() : Promise.resolve(null)).catch(function () { return null; })
      .then(function (t) {
        var h = { "Content-Type": "application/json", apikey: SUPA.key };
        if (t) h.Authorization = "Bearer " + t;
        return fetch(SUPA.url + "/functions/v1/shake-order", {
          method: "POST", headers: h, body: JSON.stringify(body),
        });
      })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) { if (j && j.error) throw new Error(j.error); return j; });
  }

  var mirror = null;
  function seed() {
    if (!mirror) {
      mirror = fetch(ROOT + "data/shakes.json", { cache: "no-cache" })
        .then(function (r) { return r.json(); })
        .catch(function () { return null; });
    }
    return mirror;
  }

  /* ---------- the shop window ---------- */

  function menu() {
    if (!SUPA) return seed().then(function (j) { return { rows: (j && j.products) || [], live: false }; });
    return pub("shake_products?available=eq.true&select=*&order=ordinal.asc")
      .then(function (rows) {
        if (rows && rows.length) return { rows: rows, live: true };
        return seed().then(function (j) { return { rows: (j && j.products) || [], live: false }; });
      })
      .catch(function () {
        return seed().then(function (j) { return { rows: (j && j.products) || [], live: false }; });
      });
  }

  function stops() {
    if (!SUPA) return Promise.resolve([]);
    return pub("shake_stops?active=eq.true&select=id,name,note&order=ordinal.asc")
      .catch(function () { return []; });
  }

  /* Is the shop open? One answer, live only. A network failure here is
     "we can't say we're open", which reads as closed — the alternative
     is a page that takes orders nobody is going to walk. */
  function openWindow() {
    if (!SUPA) return Promise.resolve(null);
    return pub("shake_open_window?select=*")
      .then(function (rows) { return (rows && rows[0]) || null; })
      .catch(function () { return null; });
  }

  /* ---------- the cart ---------- */
  /* A preview of the total, computed the same way price.ts computes it,
     so the number on the button matches the number at checkout. It is
     never sent anywhere: see the note at the top of this file. */
  function previewLine(product, line) {
    var each = Number(product.price_cents) || 0;
    var labels = [];
    (product.options || []).forEach(function (g) {
      var chosen = line.choices && line.choices[g.key];
      if (!chosen) return;
      var c = (g.choices || []).find(function (x) { return x.value === chosen; });
      if (!c) return;
      each += Number(c.delta_cents) || 0;
      if (c.label && c.label !== "None") labels.push(c.label);
    });
    return { each_cents: each, choice_labels: labels };
  }

  function previewTotal(lines, bySlug, feeCents) {
    var subtotal = 0;
    lines.forEach(function (l) {
      var p = bySlug[l.slug];
      if (!p) return;
      subtotal += previewLine(p, l).each_cents * (Number(l.qty) || 0);
    });
    return { subtotal_cents: subtotal, fee_cents: feeCents || 0, total_cents: subtotal + (feeCents || 0) };
  }

  function money(cents) {
    var n = Math.round(Number(cents) || 0) / 100;
    return "$" + n.toFixed(2);
  }

  /* ---------- the till ---------- */
  function quote(items) { return fn({ action: "quote", items: items }); }
  function place(p) {
    return fn({
      action: "create",
      items: p.items,
      stop_id: p.stop_id,
      customer_name: p.customer_name,
      room_detail: p.room_detail,
      contact_phone: p.contact_phone,
      contact_email: p.contact_email || "",
      note: p.note || "",
    });
  }
  function confirm(sessionId, claimToken) {
    return fn({ action: "confirm", session_id: sessionId, claim_token: claimToken });
  }
  function track(claimToken) {
    return fn({ action: "track", claim_token: claimToken }).then(function (j) { return j.order; });
  }

  /* ---------- the claim ticket ----------
     A customer with no account still has to be able to come back to
     "where is my shake". The claim token is that: a random string the
     edge function minted, kept in this browser, and the ONLY thing the
     track action will answer to. It is not a password and it is not a
     login — it opens one order and nothing else. */
  var TICKETS = "shk_tickets";
  function tickets() {
    try { return JSON.parse(localStorage.getItem(TICKETS) || "[]"); } catch (e) { return []; }
  }
  function keepTicket(t) {
    if (!t) return;
    var all = tickets().filter(function (x) { return x.claim !== t.claim; });
    all.unshift({ claim: t.claim, code: t.code, at: Date.now() });
    try { localStorage.setItem(TICKETS, JSON.stringify(all.slice(0, 12))); } catch (e) {}
  }
  function lastTicket() { return tickets()[0] || null; }

  /* ---------- the runner ---------- */
  function isCrew() {
    if (!SUPA) return Promise.resolve(false);
    return (SUPA.token ? SUPA.token() : Promise.resolve(null)).catch(function () { return null; })
      .then(function (t) {
        if (!t) return false;
        return fetch(SUPA.url + "/rest/v1/rpc/shake_is_crew", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SUPA.key, Authorization: "Bearer " + t },
          body: "{}",
        }).then(function (r) { return r.ok ? r.json() : false; });
      })
      .then(function (v) { return v === true; })
      .catch(function () { return false; });
  }

  /* Every call below is gated by RLS on the server (0019, section 6).
     The desk page just avoids drawing doors that would not open. */
  var desk = {
    /* the live queue: everything paid and not yet delivered, oldest first,
       because the oldest order is the one somebody has been waiting on */
    queue: function () {
      return auth("shake_orders?status=in.(paid,making,on_the_way)&select=*&order=placed_at.asc&limit=200");
    },
    /* the night's history, for the "did that get delivered" question */
    recent: function () {
      return auth("shake_orders?select=*&order=placed_at.desc&limit=60");
    },
    advance: function (id, status) {
      return auth("shake_orders?id=eq." + id, {
        method: "PATCH", prefer: "return=minimal", body: { status: status },
      });
    },
    windows: function () {
      return auth("shake_windows?select=*&order=closes_at.desc&limit=20");
    },
    open: function (p) {
      return auth("shake_windows", {
        method: "POST", prefer: "return=representation",
        body: {
          opens_at: new Date().toISOString(),
          closes_at: p.closes_at,
          status: "open",
          note: p.note || "",
          max_orders: p.max_orders || 20,
          fee_cents: p.fee_cents || 0,
        },
      });
    },
    close: function (id) {
      return auth("shake_windows?id=eq." + id, {
        method: "PATCH", prefer: "return=minimal", body: { status: "closed" },
      });
    },
    allStops: function () { return auth("shake_stops?select=*&order=ordinal.asc"); },
    addStop: function (name, note, ordinal) {
      return auth("shake_stops", {
        method: "POST", prefer: "return=representation",
        body: { name: name, note: note || "", ordinal: ordinal || 0, active: true },
      });
    },
    setStop: function (id, patch) {
      return auth("shake_stops?id=eq." + id, { method: "PATCH", prefer: "return=minimal", body: patch });
    },
    allProducts: function () { return auth("shake_products?select=*&order=ordinal.asc"); },
    setProduct: function (id, patch) {
      return auth("shake_products?id=eq." + id, { method: "PATCH", prefer: "return=minimal", body: patch });
    },
  };

  return {
    hasBackend: !!SUPA,
    menu: menu, stops: stops, openWindow: openWindow,
    previewLine: previewLine, previewTotal: previewTotal, money: money,
    quote: quote, place: place, confirm: confirm, track: track,
    keepTicket: keepTicket, lastTicket: lastTicket, tickets: tickets,
    isCrew: isCrew, desk: desk,
  };
})();
