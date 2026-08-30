/* ============================================================
   THE COUNTER: the buy sheet, portable.

   The gallery and the print shop are one room now: anywhere a
   frame hangs, this sheet sells it on the spot. One include and
   any page can call MCC_COUNTER.open(), or simply carry an old
   "prints.html#/id" link, which the counter upgrades in place so
   the visitor never leaves the wall they're looking at.

   Pricing is the shop's own (data/prints.json through MCC_PRICE),
   orders ride the same CRM rail as always, and the note format on
   the desk stays identical. Only the room the sale happens in
   has changed.
   ============================================================ */
(function () {
  "use strict";

  /* the script knows where the house root is from its own address,
     so the walls/ subpages resolve data and links correctly */
  var ROOT = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/counter\.js.*$/, "") : "";
  })();

  var CSS = "" +
    ".bs{position:fixed;inset:0;z-index:340;display:none;overflow-y:auto;background:rgba(7,5,4,0.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}" +
    ".bs.on{display:block}" +
    ".bs__in{max-width:34rem;margin:0 auto;padding:1rem clamp(1rem,4vw,1.6rem) 7rem;font-family:var(--ui,\"Manrope\",system-ui,sans-serif);color:#fff}" +
    ".bs__bar{display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0 0.9rem}" +
    ".bs__bar b{font-weight:800;font-size:0.78rem;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.7)}" +
    ".bs__x{-webkit-appearance:none;appearance:none;border:0;cursor:pointer;width:2.4rem;height:2.4rem;border-radius:100px;color:#fff;font-size:1rem;font-weight:800;background:linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.05));box-shadow:inset 0 1px 0 rgba(255,255,255,0.18)}" +
    ".bs__pic{position:relative;border-radius:16px;overflow:hidden;aspect-ratio:16/10;isolation:isolate}" +
    ".bs__pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1}" +
    ".bs__pic .wm{position:absolute;inset:0;pointer-events:none;opacity:0.85;background-image:url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='150'%3E%3Ctext x='6' y='84' font-family='sans-serif' font-size='15' font-weight='800' fill='rgba(255,255,255,0.28)' transform='rotate(-18 110 75)'%3E%C2%A9 MCCLUSTER%3C/text%3E%3C/svg%3E\")}" +
    ".bs h2{font-weight:800;font-size:1.3rem;margin:0.9rem 0 0.1rem}" +
    ".bs__sub{font-weight:600;font-size:0.8rem;color:rgba(255,255,255,0.6)}" +
    ".bs__rights{display:inline-block;font-weight:800;font-size:0.6rem;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.75);border-radius:100px;padding:0.34rem 0.75rem;margin-top:0.6rem;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.22)}" +
    ".bs__rights.rel{color:#fff;box-shadow:inset 0 0 0 1px rgba(229,56,59,0.7)}" +
    ".bs h3{font-weight:800;font-size:0.66rem;letter-spacing:0.22em;text-transform:uppercase;color:#e5383b;margin:1.3rem 0 0.6rem}" +
    ".bs__opt{display:block;width:100%;text-align:left;-webkit-appearance:none;appearance:none;border:0;cursor:pointer;touch-action:manipulation;font-family:inherit;color:#fff;border-radius:14px;padding:0.85rem 1rem;margin-bottom:0.5rem;background:linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03));box-shadow:inset 0 0 0 1px rgba(255,255,255,0.12)}" +
    ".bs__opt.on{box-shadow:inset 0 0 0 2px #de3a3a}" +
    ".bs__opt b{font-weight:800;font-size:0.9rem}" +
    ".bs__opt .p{float:right;font-weight:800;color:#e5383b}" +
    ".bs__opt small{display:block;font-weight:500;font-size:0.74rem;color:rgba(255,255,255,0.55);margin-top:0.2rem}" +
    ".bs__ship{font-weight:600;font-size:0.74rem;color:rgba(255,255,255,0.5);margin:0.2rem 0 0}" +
    ".bs input{width:100%;-webkit-appearance:none;appearance:none;border:0;margin-top:0.5rem;font-family:inherit;font-weight:600;font-size:1rem;color:#fff;border-radius:13px;padding:0.8rem 0.95rem;background:rgba(255,255,255,0.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.14)}" +
    ".bs input::placeholder{color:rgba(255,255,255,0.4)}" +
    ".bs__go{-webkit-appearance:none;appearance:none;border:0;cursor:pointer;touch-action:manipulation;width:100%;margin-top:0.8rem;font-family:inherit;font-weight:800;font-size:0.95rem;color:#fff;background:var(--metal,linear-gradient(165deg,#ff5a5c 0%,#e5383b 34%,#b3121b 58%,#ff6a6c 100%));border-radius:100px;padding:0.95rem;box-shadow:inset 0 1px 0 rgba(255,255,255,0.6)}" +
    ".bs__err{color:#e8a68a;font-weight:700;font-size:0.78rem;margin:0.5rem 0 0}" +
    ".bs__flip{background:none;border:0;cursor:pointer;padding:0;margin-top:0.8rem;color:rgba(255,255,255,0.55);font-family:inherit;font-weight:600;font-size:0.78rem;text-decoration:underline}" +
    ".bs__who{font-weight:600;font-size:0.76rem;color:rgba(255,255,255,0.55);margin:0.6rem 0 0}" +
    ".bs__who b{color:rgba(255,255,255,0.85)}" +
    ".bs__alt{display:block;text-align:center;text-decoration:none;font-weight:800;font-size:0.95rem;color:#fff;background:var(--metal,linear-gradient(165deg,#ff5a5c 0%,#e5383b 34%,#b3121b 58%,#ff6a6c 100%));border-radius:100px;padding:0.95rem;margin-top:0.8rem;box-shadow:inset 0 1px 0 rgba(255,255,255,0.6)}" +
    ".bs__done b{display:block;font-weight:800;font-size:1.1rem}" +
    ".bs__done small{display:block;font-weight:500;font-size:0.84rem;color:rgba(255,255,255,0.6);margin-top:0.4rem;line-height:1.5}" +
    ".bs__total{display:flex;justify-content:space-between;font-weight:800;font-size:0.95rem;border-top:1px solid rgba(255,255,255,0.14);margin-top:1.1rem;padding-top:0.8rem}";

  var SHOP = null, READY = null, OPEN = null, PICK = 0, VIA = "page";
  var HOST = null, PREV_OVERFLOW = "", ON_CLOSE = null;

  var esc = function (x) { var d = document.createElement("i"); d.textContent = x == null ? "" : x; return d.innerHTML; };
  var track = function (n, p) { if (window.MCC_TRACK) window.MCC_TRACK(n, p || {}); };
  var money = function (n) { return "$" + n; };

  /* THE RIGHTS DESK: the owner can flip a frame's class from the back
     office (rights_flags in the database); the flag wins over whatever
     the static catalog says. Missing table, offline, anything: the
     baseline in the JSON still rules, silently. */
  var FLAGS = {};
  function loadFlags() {
    var S = window.MCC_SUPA;
    if (!S || !S.url) return Promise.resolve();
    var call = fetch(S.url + "/rest/v1/rights_flags?select=id,rights", {
      headers: { apikey: S.key, Authorization: "Bearer " + S.key },
    }).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { (rows || []).forEach(function (f) { FLAGS[f.id] = f.rights; }); })
      .catch(function () {});
    /* the flags never hold the register. A slow read means the JSON
       baseline rules this load, and late rows still land in FLAGS for
       any sheet opened after */
    var patience = new Promise(function (res) { setTimeout(res, 2500); });
    return Promise.race([call, patience]);
  }

  function load() {
    if (READY) return READY;
    READY = Promise.all([
      fetch(ROOT + "data/prints.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
      loadFlags(),
    ]).then(function (all) {
      SHOP = window.MCC_PRICE ? window.MCC_PRICE.derive(all[0]) : all[0];
      (SHOP.photos || []).forEach(function (p) { if (FLAGS[p.id]) p.rights = FLAGS[p.id]; });
      return SHOP;
    });
    return READY;
  }

  function from() {
    if (!SHOP) return null;
    return Math.min(SHOP.sizes[0].price, SHOP.digital[0].price);
  }

  /* THE RIGHTS LAW: an editorial frame has real people and no release
     on file, so its RAW carries an editorial-use license, never a
     commercial one. Prints and personal files are untouched; only what
     the license is FOR changes. (docs/the-vault.md: nothing goes on
     commercial sale until the release is clear.) */
  function options(rights) {
    var out = [];
    SHOP.sizes.forEach(function (s) {
      out.push({ kind: "print", id: s.id, label: s.label, price: s.price, note: SHOP.shippingNote });
    });
    SHOP.digital.forEach(function (d) {
      var o = { kind: "digital", id: d.id, label: d.label, price: d.price, note: d.note };
      if (d.id === "raw" && rights !== "released") {
        o.label = "RAW + editorial license";
        o.note = "The negative, licensed for press, publications & documentation of this real event. Not for ads or promotion; no model releases on file.";
      }
      out.push(o);
    });
    return out;
  }

  function host() {
    if (HOST) return HOST;
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    HOST = document.createElement("div");
    HOST.className = "bs";
    HOST.setAttribute("role", "dialog");
    HOST.setAttribute("aria-label", "Buy this work");
    HOST.innerHTML = '<div class="bs__in"></div>';
    document.body.appendChild(HOST);
    HOST.addEventListener("click", onClick);
    return HOST;
  }

  function buyer() { return (window.MCC_AUTH && MCC_AUTH.user && MCC_AUTH.user()) || null; }

  function headHTML(p) {
    return '<div class="bs__bar"><b>Own this work</b><button class="bs__x" type="button" data-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:1em;height:1em;vertical-align:-2px"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
      '<div class="bs__pic"><img src="' + esc(p.src) + '" alt=""><span class="wm"></span></div>' +
      "<h2>" + esc(p.title) + "</h2>" +
      '<p class="bs__sub">' + esc(p.sub || "") + "</p>" +
      (p.rights === "released"
        ? '<span class="bs__rights rel">Released &middot; commercial-clear</span>'
        : '<span class="bs__rights">Editorial frame &middot; real event, real people</span>');
  }

  /* THE GATE: this is a store, and the register knows its buyers.
     No profile, no purchase: thirty seconds, once, any device. */
  function gateHTML(p) {
    return headHTML(p) +
      "<h3>Make your profile to buy</h3>" +
      '<p class="bs__ship" style="margin:0 0 0.3rem">Every order lands on your record: prints, files, receipts, on any device. Buying takes a profile; it takes thirty seconds.</p>' +
      "<div data-gate-make>" +
      '<input name="gname" placeholder="Your name" autocomplete="name" maxlength="80">' +
      '<input name="gemail" type="email" placeholder="Email" autocomplete="email" maxlength="120">' +
      '<input name="gphone" type="tel" placeholder="Phone" autocomplete="tel" inputmode="tel" maxlength="30">' +
      '<input name="gpass" type="password" placeholder="Password (8+ characters)" autocomplete="new-password" maxlength="80">' +
      '<button class="bs__go" type="button" data-join>Make my profile &#8594;</button>' +
      '<button class="bs__flip" type="button" data-flip="in">Already have one? Sign in</button>' +
      "</div>" +
      "<div data-gate-in hidden>" +
      '<input name="semail" type="email" placeholder="Email" autocomplete="email" maxlength="120">' +
      '<input name="spass" type="password" placeholder="Password" autocomplete="current-password" maxlength="80">' +
      '<button class="bs__go" type="button" data-signin>Sign in &#8594;</button>' +
      '<button class="bs__flip" type="button" data-flip="make">New here? Make a profile</button>' +
      "</div>" +
      '<p class="bs__err" hidden></p>';
  }

  function sheetHTML(p) {
    var u = buyer();
    if (!u) return gateHTML(p);
    var opts = options(p.rights);
    return headHTML(p) +
      "<h3>Pick your format</h3><div data-opts>" +
      opts.map(function (o, i) {
        return '<button class="bs__opt' + (i === 0 ? " on" : "") + '" type="button" data-opt="' + i + '">' +
          '<span class="p">' + money(o.price) + "</span><b>" + esc(o.label) + "</b><small>" + esc(o.note || "") + "</small></button>";
      }).join("") + "</div>" +
      "<h3>Where it goes</h3>" +
      '<p class="bs__who">Signed in as <b>' + esc(u.name || u.email) + "</b>. This order goes on your record.</p>" +
      '<input name="name" placeholder="Your name" autocomplete="name" maxlength="80" value="' + esc(u.name || "") + '">' +
      '<input name="email" type="email" placeholder="Email" autocomplete="email" maxlength="120" value="' + esc(u.email || "") + '">' +
      '<div data-ship>' +
      '<input name="addr" placeholder="Street address" autocomplete="street-address" maxlength="160">' +
      '<input name="city" placeholder="City, State, ZIP" maxlength="120">' +
      "</div>" +
      '<div class="bs__total"><span>Total today</span><span data-total>' + money(opts[0].price) + "</span></div>" +
      '<button class="bs__go" type="button" data-order>Place the order &#8594;</button>' +
      '<p class="bs__ship">Checkout opens right after: card, Apple&nbsp;Pay or Google&nbsp;Pay. Prints ship tracked; files deliver by email as soon as it clears. Sold by McCluster.</p>' +
      '<p class="bs__err" hidden></p>';
  }

  /* open({id, src, title, sub}, via, {onClose}): the shop's curated
     card wins when the id is in the catalog; the wall's own context
     covers everything else, so no sellable frame is ever a dead end. */
  function open(ctx, via, opts) {
    load().then(function () {
      var cat = (SHOP.photos || []).find(function (x) { return x.id === ctx.id; });
      var p = {
        id: ctx.id,
        src: cat && cat.src ? ROOT + cat.src : (ctx.src || ""),
        title: (cat && cat.title) || ctx.title || "This frame",
        sub: (cat && cat.sub) || ctx.sub || "",
        /* the owner's live flag wins; then the catalog; then the wall's
           own context; editorial is the safe default. No paper on
           file, no commercial sale */
        rights: FLAGS[ctx.id] || (cat && cat.rights) || ctx.rights || "editorial",
      };
      OPEN = p; PICK = 0; VIA = via || "page";
      ON_CLOSE = (opts && opts.onClose) || null;
      var h = host();
      h.querySelector(".bs__in").innerHTML = sheetHTML(p);
      h.classList.add("on");
      h.scrollTop = 0;
      PREV_OVERFLOW = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      track("prints_open", { photo: p.id, via: VIA, gated: !buyer() });
    });
  }

  function close() {
    if (!HOST) return;
    HOST.classList.remove("on");
    document.body.style.overflow = PREV_OVERFLOW;
    OPEN = null;
    if (ON_CLOSE) { var f = ON_CLOSE; ON_CLOSE = null; f(); }
  }

  function isOpen() { return !!(HOST && HOST.classList.contains("on")); }

  function onClick(e) {
    if (e.target.closest("[data-close]")) { close(); return; }
    var box = HOST.querySelector(".bs__in");
    var fv = function (n) { var i = box.querySelector('[name="' + n + '"]'); return i ? i.value.trim() : ""; };
    var err = function (m) { var el2 = box.querySelector(".bs__err"); if (el2) { el2.textContent = m; el2.hidden = false; } };

    /* ---- the gate ---- */
    var flip = e.target.closest("[data-flip]");
    if (flip) {
      var toIn = flip.getAttribute("data-flip") === "in";
      box.querySelector("[data-gate-make]").hidden = toIn;
      box.querySelector("[data-gate-in]").hidden = !toIn;
      return;
    }
    if (e.target.closest("[data-join]")) {
      var jn = fv("gname"), je = fv("gemail"), jp = fv("gphone"), jw = fv("gpass");
      if (!jn) { err("Your name goes on the record. Type it first."); return; }
      if (!/.+@.+\..+/.test(je)) { err("Type the whole email address."); return; }
      if (!jp) { err("A phone number, for order questions and nothing else."); return; }
      if (jw.length < 8) { err("Password needs 8 characters or more."); return; }
      var jb = e.target.closest("[data-join]");
      jb.disabled = true; jb.textContent = "Making it…";
      MCC_AUTH.signUpPassword(je, jw, { name: jn, phone: jp }).then(function (res) {
        track("profile_created", { via: "counter-" + VIA });
        if (res && res.confirm) {
          jb.innerHTML = "Check your email " + '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="vertical-align:-2px;display:inline-block"><path d="M4 12.5l5.2 5.2L20 6.8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          err("One more step: confirm the email we just sent, then come back to this frame.");
          return;
        }
        HOST.querySelector(".bs__in").innerHTML = sheetHTML(OPEN);
        HOST.scrollTop = 0;
      }).catch(function (ex) {
        jb.disabled = false; jb.textContent = "Make my profile →";
        err(/registered|exists/i.test(ex.message || "") ? "That email already has a profile. Sign in instead." : (ex.message || "That didn't go through. Try again."));
      });
      return;
    }
    if (e.target.closest("[data-signin]")) {
      var se = fv("semail"), sw = fv("spass");
      if (!/.+@.+\..+/.test(se) || !sw) { err("Email and password. Both."); return; }
      var sb2 = e.target.closest("[data-signin]");
      sb2.disabled = true; sb2.textContent = "Signing in…";
      MCC_AUTH.signInPassword(se, sw).then(function () {
        track("profile_signin", { via: "counter-" + VIA });
        HOST.querySelector(".bs__in").innerHTML = sheetHTML(OPEN);
        HOST.scrollTop = 0;
      }).catch(function (ex) {
        sb2.disabled = false; sb2.textContent = "Sign in →";
        err(ex.message || "That didn't turn the lock. Check both fields.");
      });
      return;
    }

    var opt = e.target.closest("[data-opt]");
    if (opt) {
      PICK = parseInt(opt.getAttribute("data-opt"), 10);
      box.querySelectorAll(".bs__opt").forEach(function (o) { o.classList.toggle("on", o === opt); });
      var o = options(OPEN.rights)[PICK];
      box.querySelector("[data-total]").textContent = money(o.price);
      box.querySelector("[data-ship]").style.display = o.kind === "print" ? "" : "none";
      return;
    }
    if (e.target.closest("[data-order]")) {
      var u = buyer();
      if (!u) { HOST.querySelector(".bs__in").innerHTML = sheetHTML(OPEN); return; }
      var o = options(OPEN.rights)[PICK];
      var name = fv("name"), email = fv("email"), addr = fv("addr"), city = fv("city");
      if (!name || !/.+@.+\..+/.test(email)) { err("Name and a real email. The order has to land somewhere."); return; }
      if (o.kind === "print" && (!addr || !city)) { err("Prints need a shipping address."); return; }
      var btn = box.querySelector("[data-order]");
      btn.disabled = true; btn.textContent = "Placing…";
      /* the sale is an OFFERING: server-side price, single seller.
         print sizes map to print-<size>, files to file-<id>. */
      var offerSlug = (o.kind === "print" ? "print-" : "file-") + o.id;
      window.MCC_CRM.send({
        name: name, email: email, want: "Photography",
        note: "PRINT SHOP · " + OPEN.id + " · " + o.label + " (" + money(o.price) + ")" +
          (o.kind === "print" ? " · SHIP TO: " + addr + ", " + city : " · digital delivery") +
          (u.phone ? " · PH: " + u.phone : "") +
          " · buyer " + (u.id || "?") + " · via " + VIA,
        campaign: "print-shop",
      }).then(function () {
        track("prints_order", { photo: OPEN.id, format: o.id, price: o.price, via: VIA });
        btn.textContent = "Opening checkout…";
        return checkoutLink(offerSlug, OPEN.id).then(function (url) {
          if (url) {
            track("prints_checkout", { photo: OPEN.id, offer: offerSlug, price: o.price });
            location.href = url;
            return;
          }
          /* the checkout function isn't armed yet, so hand over to the
             offering checkout page, which carries the same law */
          box.innerHTML = '<div class="bs__bar"><b>Order placed</b><button class="bs__x" type="button" data-close><svg viewBox="0 0 24 24" aria-hidden="true" style="width:1em;height:1em;vertical-align:-2px"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
            '<div class="bs__done" style="margin-top:1rem"><b>It&rsquo;s on the desk. Pay and it moves.</b>' +
            "<small>" + esc(o.label) + " &middot; <b>" + money(o.price) + "</b>. " +
            (o.kind === "print"
              ? "The print ships tracked as soon as payment clears."
              : (o.id === "raw"
                ? "The RAW and your " + (OPEN.rights === "released" ? "commercial" : "editorial-use") + " license deliver within 24 hours of payment."
                : "Your file delivers by email as soon as payment clears.")) +
            "</small></div>" +
            '<a class="bs__alt" href="' + ROOT + "pay.html?offer=" + encodeURIComponent(offerSlug) +
            "&note=" + encodeURIComponent(OPEN.id) + '">Pay now &#8594; card · Apple&nbsp;Pay · Google&nbsp;Pay</a>' +
            '<p class="bs__ship">Rather not pay on the spot? The invoice lands in your email today either way.</p>';
        });
      }).catch(function () {
        btn.disabled = false; btn.textContent = "Place the order →";
        err("That didn’t go through. Try again in a second.");
      });
    }
  }

  /* THE CHECKOUT RAIL: the offering checkout function resolves the
     authoritative price and provider server-side. If it isn't deployed
     yet this resolves null fast and the sheet hands over to pay.html,
     which speaks the same offering language. */
  function checkoutLink(offerSlug, noteText) {
    var S = window.MCC_SUPA;
    if (!S || !S.url) return Promise.resolve(null);
    var call = fetch(S.url + "/functions/v1/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: S.key },
      body: JSON.stringify({ offer: offerSlug, note: noteText }),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.url ? j.url : null; })
      .catch(function () { return null; });
    var patience = new Promise(function (res) { setTimeout(function () { res(null); }, 3500); });
    return Promise.race([call, patience]);
  }

  /* Escape closes the counter before anything underneath hears it;
     the gallery's lightbox stays open behind, exactly where you were */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) { e.stopPropagation(); e.preventDefault(); close(); }
  }, true);

  /* THE UPGRADE: any old "prints.html#/id" link on the page now sells
     in place. The href stays real for crawlers and for pages that never
     load this script; with the counter present, the visitor stays put. */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href*="prints.html#/"]');
    if (!a || isOpen()) return;
    var m = (a.getAttribute("href") || "").match(/prints\.html#\/(.+)$/);
    if (!m) return;
    /* the shop page itself keeps its own hash routing */
    if (/(^|\/)prints\.html$/.test(location.pathname)) return;
    e.preventDefault();
    open({ id: decodeURIComponent(m[1]) }, "wall-link");
  });

  window.MCC_COUNTER = { open: open, close: close, isOpen: isOpen, load: load, from: from };
})();
