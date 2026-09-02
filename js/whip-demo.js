/* ============================================================
   WHIP EQUIPPED — the three apps, running in the page.

   THERE WAS NO INTERFACE. The registry knew six builds existed, the fee
   policy knew what a trip costs, the ledger knew who the money belongs
   to — and nowhere in this repository, or anywhere else, was there a
   screen. Somebody asking "what are these apps" got a paragraph. These
   are the screens: Rider, Driver and Rentals, running here, tappable.

   THE MONEY IS NOT MADE UP. Every fee on every screen comes from
   api.mccluster.org/v1/fees/quote, which reads platform_fee_policies in
   the McCluster Supabase project — the same rows that would price a real
   trip. That endpoint is already public and already answering; it is the
   one part of these apps that has been built the whole time. Change the
   policy row and these screens quote the new number without a deploy.

   WHAT IS SIMULATED, PLAINLY: no car is dispatched, no card is charged,
   no licence is checked, and the drivers, vehicles and addresses are
   examples. The flow, the states and the arithmetic are real. Every
   screen that touches money says which it is.

   IT FAILS OPEN. If the Worker cannot be reached the demo keeps running
   on the same arithmetic at the policy's published rate and says on the
   receipt that it could not reach the ledger, because a demo that dies
   on a network hiccup teaches a visitor nothing.
   ============================================================ */
window.MCC_WHIP = (function () {
  "use strict";

  var API = "https://api.mccluster.org/v1/fees/quote";
  var FALLBACK_BPS = 300; /* the published rate, used only when the wire is down */
  var REDUCED = false;
  try {
    REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(cents) {
    var n = Math.round(Number(cents) || 0) / 100;
    return "$" + n.toFixed(2);
  }
  function wait(ms, fn) {
    return setTimeout(fn, REDUCED ? Math.min(ms, 180) : ms);
  }

  /* ---------- the one live call ----------
     base_cents is the fare before anybody's fee. The Worker applies the
     policy and hands back both sides of it: what the payer adds on top,
     and what is withheld from the operator. */
  function quote(appKey, baseCents) {
    var url = API + "?app_key=" + encodeURIComponent(appKey) +
      "&base_cents=" + encodeURIComponent(Math.max(1, Math.round(baseCents)));
    return fetch(url, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("quote " + r.status)); })
      .then(function (d) {
        return {
          live: true,
          base: d.quote.base_amount_cents,
          payerFee: d.quote.payer_fee_cents,
          payerTotal: d.quote.payer_total_cents,
          payeeFee: d.quote.payee_fee_cents,
          payeeNet: d.quote.payee_economic_amount_cents,
          payerBps: d.policy.payer_fee_bps,
          payeeBps: d.policy.payee_fee_bps,
          policy: d.policy.key
        };
      })
      .catch(function () {
        var f = Math.round(baseCents * FALLBACK_BPS / 10000);
        return {
          live: false,
          base: baseCents, payerFee: f, payerTotal: baseCents + f,
          payeeFee: f, payeeNet: baseCents - f,
          payerBps: FALLBACK_BPS, payeeBps: FALLBACK_BPS, policy: "whip-network"
        };
      });
  }

  function bps(v) { return (Number(v) / 100).toFixed(Number(v) % 100 ? 1 : 0) + "%"; }

  /* ---------- the route drawing ----------
     A real map needs a tile provider, a key and somebody's terms of use.
     A trip needs to show a shape moving from one end of a line to the
     other, which is two SVG paths and a circle. */
  function mapSvg(id) {
    return '<svg class="wd__map" viewBox="0 0 260 150" aria-hidden="true">' +
      '<rect x="0" y="0" width="260" height="150" rx="10" class="wd__mapbg"/>' +
      '<path class="wd__grid" d="M0 40h260M0 80h260M0 118h260M60 0v150M130 0v150M196 0v150"/>' +
      '<path id="' + id + '" class="wd__route" d="M28 122 C 70 118, 74 74, 118 66 S 186 52, 232 30"/>' +
      '<circle class="wd__pin wd__pin--a" cx="28" cy="122" r="5"/>' +
      '<circle class="wd__pin wd__pin--b" cx="232" cy="30" r="5"/>' +
      '<circle class="wd__car" cx="28" cy="122" r="6.5"/>' +
    "</svg>";
  }

  /* walks the car along the route and calls back when it lands */
  function driveAlong(root, ms, done) {
    var path = root.querySelector(".wd__route");
    var car = root.querySelector(".wd__car");
    if (!path || !car || !path.getTotalLength) { if (done) done(); return function () {}; }
    if (REDUCED) {
      var end = path.getPointAtLength(path.getTotalLength());
      car.setAttribute("cx", end.x); car.setAttribute("cy", end.y);
      var t0 = wait(240, function () { if (done) done(); });
      return function () { clearTimeout(t0); };
    }
    var len = path.getTotalLength();
    var started = null, raf = 0, dead = false;
    function step(ts) {
      if (dead) return;
      if (started === null) started = ts;
      var k = Math.min(1, (ts - started) / ms);
      var p = path.getPointAtLength(len * k);
      car.setAttribute("cx", p.x); car.setAttribute("cy", p.y);
      if (k < 1) raf = requestAnimationFrame(step);
      else if (done) done();
    }
    raf = requestAnimationFrame(step);
    return function () { dead = true; cancelAnimationFrame(raf); };
  }

  function countdown(el, seconds, done) {
    var left = seconds;
    el.textContent = left;
    var iv = setInterval(function () {
      left -= 1;
      el.textContent = Math.max(0, left);
      if (left <= 0) { clearInterval(iv); if (done) done(); }
    }, REDUCED ? 220 : 1000);
    return function () { clearInterval(iv); };
  }

  /* ============================================================
     RIDER
     ============================================================ */
  var TRIPS = [
    { to: "Acworth Beach", mins: 9, miles: 3.4, base: 1180 },
    { to: "Kennesaw Mountain", mins: 16, miles: 7.1, base: 1940 },
    { to: "Hartsfield-Jackson", mins: 47, miles: 38.6, base: 7250 }
  ];
  var DRIVERS = [
    { name: "Andre", car: "Charger R/T", plate: "WE-4417", eta: 4, stars: "4.9" },
    { name: "Simone", car: "Altima SR", plate: "WE-2260", eta: 3, stars: "5.0" }
  ];

  function riderApp(host) {
    var state = { trip: null, q: null, driver: null }, stop = null;

    function screen(html) {
      host.innerHTML = html;
      if (stop) { stop(); stop = null; }
    }

    function pick() {
      screen(
        '<div class="wd__bar"><b>Where to?</b><span class="wd__acct">M</span></div>' +
        '<div class="wd__from"><i class="wd__dot"></i>Whip Equipped, Acworth GA</div>' +
        '<div class="wd__list">' +
          TRIPS.map(function (t, i) {
            return '<button class="wd__row" type="button" data-trip="' + i + '">' +
              "<span><b>" + esc(t.to) + "</b><small>" + t.mins + " min &middot; " + t.miles + " mi</small></span>" +
              "<em>" + money(t.base) + "</em></button>";
          }).join("") +
        "</div>" +
        '<p class="wd__foot">Fare is quoted before the trip, not after.</p>'
      );
      host.querySelectorAll("[data-trip]").forEach(function (b) {
        b.addEventListener("click", function () {
          state.trip = TRIPS[+b.dataset.trip];
          quoting();
        });
      });
    }

    function quoting() {
      screen('<div class="wd__bar"><b>' + esc(state.trip.to) + "</b></div>" +
        '<div class="wd__wait"><i></i><i></i><i></i><span>Pricing the trip</span></div>');
      quote("whip-rider-web", state.trip.base).then(function (q) { state.q = q; fare(); });
    }

    function fare() {
      var q = state.q;
      screen(
        '<div class="wd__bar"><button class="wd__back" type="button" data-back>&larr;</button><b>' +
          esc(state.trip.to) + "</b></div>" +
        mapSvg("rroute") +
        '<div class="wd__sheet">' +
          '<div class="wd__line"><span>Fare</span><span>' + money(q.base) + "</span></div>" +
          '<div class="wd__line"><span>Service fee &middot; ' + bps(q.payerBps) + "</span><span>" + money(q.payerFee) + "</span></div>" +
          '<div class="wd__line wd__line--tot"><span>You pay</span><span>' + money(q.payerTotal) + "</span></div>" +
          '<button class="wd__go" type="button" data-req>Request a whip</button>' +
          '<p class="wd__src">' + (q.live
            ? "Priced live by the <b>" + esc(q.policy) + "</b> policy on api.mccluster.org"
            : "Ledger unreachable &mdash; shown at the published rate") + "</p>" +
        "</div>"
      );
      host.querySelector("[data-back]").addEventListener("click", pick);
      host.querySelector("[data-req]").addEventListener("click", finding);
    }

    function finding() {
      screen('<div class="wd__bar"><b>Finding a whip</b></div>' + mapSvg("rroute") +
        '<div class="wd__wait"><i></i><i></i><i></i><span>Matching you with a driver</span></div>');
      wait(1500, function () {
        state.driver = DRIVERS[Math.floor(Math.random() * DRIVERS.length)];
        enroute();
      });
    }

    function enroute() {
      var d = state.driver;
      screen('<div class="wd__bar"><b>' + d.eta + ' min away</b></div>' + mapSvg("rroute") +
        '<div class="wd__sheet">' +
          '<div class="wd__who"><span class="wd__av">' + esc(d.name[0]) + "</span>" +
            "<span><b>" + esc(d.name) + " &middot; " + esc(d.stars) + "&#9733;</b>" +
            "<small>" + esc(d.car) + " &middot; " + esc(d.plate) + "</small></span></div>" +
          '<div class="wd__prog"><i style="width:0%"></i></div>' +
          '<p class="wd__foot">Watch it come in. Arriving at Whip Equipped, Acworth.</p>' +
        "</div>");
      var barI = host.querySelector(".wd__prog i");
      var t0 = Date.now(), dur = REDUCED ? 400 : 3400;
      var tick = setInterval(function () {
        var k = Math.min(1, (Date.now() - t0) / dur);
        if (barI) barI.style.width = (k * 100).toFixed(1) + "%";
        if (k >= 1) clearInterval(tick);
      }, 60);
      var cancel = driveAlong(host, dur, function () { clearInterval(tick); riding(); });
      stop = function () { clearInterval(tick); cancel(); };
    }

    function riding() {
      screen('<div class="wd__bar"><b>On the way to ' + esc(state.trip.to) + "</b></div>" +
        mapSvg("rroute") +
        '<div class="wd__sheet"><div class="wd__prog"><i style="width:0%"></i></div>' +
        '<p class="wd__foot">' + state.trip.mins + " min &middot; " + state.trip.miles + " mi</p></div>");
      var barI = host.querySelector(".wd__prog i");
      var t0 = Date.now(), dur = REDUCED ? 400 : 2600;
      var tick = setInterval(function () {
        var k = Math.min(1, (Date.now() - t0) / dur);
        if (barI) barI.style.width = (k * 100).toFixed(1) + "%";
        if (k >= 1) clearInterval(tick);
      }, 60);
      var cancel = driveAlong(host, dur, function () { clearInterval(tick); receipt(); });
      stop = function () { clearInterval(tick); cancel(); };
    }

    function receipt() {
      var q = state.q;
      screen('<div class="wd__bar"><b>You&rsquo;re here</b></div>' +
        '<div class="wd__done"><span class="wd__tick">&#10003;</span><b>' + money(q.payerTotal) + "</b>" +
          "<small>" + esc(state.trip.to) + " &middot; " + state.trip.mins + " min</small></div>" +
        '<div class="wd__sheet">' +
          '<div class="wd__line"><span>Fare</span><span>' + money(q.base) + "</span></div>" +
          '<div class="wd__line"><span>Service fee &middot; ' + bps(q.payerBps) + "</span><span>" + money(q.payerFee) + "</span></div>" +
          '<div class="wd__line wd__line--tot"><span>Charged</span><span>' + money(q.payerTotal) + "</span></div>" +
          '<p class="wd__src">To the card on your McCluster account. Receipt on the record.</p>' +
          '<button class="wd__go wd__go--ghost" type="button" data-again>Ride again</button>' +
        "</div>");
      host.querySelector("[data-again]").addEventListener("click", pick);
    }

    pick();
    return function () { if (stop) stop(); };
  }

  /* ============================================================
     DRIVER
     ============================================================ */
  function driverApp(host) {
    var day = 0, trips = 0, stop = null;

    function screen(html) {
      host.innerHTML = html;
      if (stop) { stop(); stop = null; }
    }
    function header(label) {
      return '<div class="wd__bar wd__bar--drv"><b>' + label + "</b>" +
        '<span class="wd__day">' + money(day) + " &middot; " + trips + "</span></div>";
    }

    function offline() {
      screen(header("Off shift") +
        '<div class="wd__hero"><span class="wd__big">' + money(day) + "</span>" +
        "<small>today &middot; " + trips + " trip" + (trips === 1 ? "" : "s") + "</small></div>" +
        '<div class="wd__sheet"><button class="wd__go" type="button" data-on>Go on shift</button>' +
        '<p class="wd__foot">Dispatch only reaches you while you are on shift.</p></div>');
      host.querySelector("[data-on]").addEventListener("click", waiting);
    }

    function waiting() {
      screen(header("On shift") + mapSvg("droute") +
        '<div class="wd__wait"><i></i><i></i><i></i><span>Waiting for a trip</span></div>' +
        '<div class="wd__sheet"><button class="wd__go wd__go--ghost" type="button" data-off>End shift</button></div>');
      host.querySelector("[data-off]").addEventListener("click", offline);
      var t = wait(1600, offer);
      stop = function () { clearTimeout(t); };
    }

    function offer() {
      var trip = TRIPS[Math.floor(Math.random() * TRIPS.length)];
      quote("whip-driver-web", trip.base).then(function (q) {
        screen(header("Trip offered") +
          '<div class="wd__offer">' +
            '<div class="wd__ring"><span data-cd>12</span></div>' +
            "<b>" + money(q.payeeNet) + "</b><small>your take &middot; " + trip.mins + " min &middot; " + trip.miles + " mi</small>" +
            '<div class="wd__ab"><span><i class="wd__dot"></i>Whip Equipped, Acworth</span>' +
            '<span><i class="wd__dot wd__dot--b"></i>' + esc(trip.to) + "</span></div>" +
          "</div>" +
          '<div class="wd__sheet wd__sheet--two">' +
            '<button class="wd__go wd__go--ghost" type="button" data-pass>Pass</button>' +
            '<button class="wd__go" type="button" data-take>Accept</button>' +
          "</div>");
        var cancel = countdown(host.querySelector("[data-cd]"), 12, waiting);
        stop = cancel;
        host.querySelector("[data-pass]").addEventListener("click", function () { cancel(); waiting(); });
        host.querySelector("[data-take]").addEventListener("click", function () { cancel(); running(trip, q); });
      });
    }

    function running(trip, q) {
      screen(header("On trip") + mapSvg("droute") +
        '<div class="wd__sheet"><div class="wd__prog"><i style="width:0%"></i></div>' +
        '<p class="wd__foot">To ' + esc(trip.to) + " &middot; " + trip.miles + " mi</p></div>");
      var barI = host.querySelector(".wd__prog i");
      var t0 = Date.now(), dur = REDUCED ? 400 : 3000;
      var tick = setInterval(function () {
        var k = Math.min(1, (Date.now() - t0) / dur);
        if (barI) barI.style.width = (k * 100).toFixed(1) + "%";
        if (k >= 1) clearInterval(tick);
      }, 60);
      var cancel = driveAlong(host, dur, function () { clearInterval(tick); paid(trip, q); });
      stop = function () { clearInterval(tick); cancel(); };
    }

    function paid(trip, q) {
      day += q.payeeNet; trips += 1;
      screen(header("Paid") +
        '<div class="wd__done"><span class="wd__tick">&#10003;</span><b>' + money(q.payeeNet) + "</b>" +
        "<small>" + esc(trip.to) + "</small></div>" +
        '<div class="wd__sheet">' +
          '<div class="wd__line"><span>Trip fare</span><span>' + money(q.base) + "</span></div>" +
          '<div class="wd__line"><span>Network fee &middot; ' + bps(q.payeeBps) + "</span><span>&minus;" + money(q.payeeFee) + "</span></div>" +
          '<div class="wd__line wd__line--tot"><span>Your payout</span><span>' + money(q.payeeNet) + "</span></div>" +
          '<p class="wd__src">' + (q.live
            ? "Withheld per the <b>" + esc(q.policy) + "</b> policy, shown before you took the trip."
            : "Ledger unreachable &mdash; shown at the published rate.") + "</p>" +
          '<button class="wd__go" type="button" data-next>Back on shift</button>' +
        "</div>");
      host.querySelector("[data-next]").addEventListener("click", waiting);
    }

    offline();
    return function () { if (stop) stop(); };
  }

  /* ============================================================
     RENTALS
     ============================================================ */
  var LOT = [
    { name: "Charger R/T", year: 2019, day: 8900, seats: 5 },
    { name: "Altima SR", year: 2021, day: 5400, seats: 5 },
    { name: "Silverado LT", year: 2018, day: 10500, seats: 6 }
  ];

  function rentalsApp(host) {
    var pickCar = null, days = 3, stop = null;

    function screen(html) { host.innerHTML = html; if (stop) { stop(); stop = null; } }

    function lot() {
      screen('<div class="wd__bar"><b>On the lot</b><span class="wd__acct">M</span></div>' +
        '<div class="wd__list">' +
          LOT.map(function (c, i) {
            return '<button class="wd__row" type="button" data-car="' + i + '">' +
              "<span><b>" + c.year + " " + esc(c.name) + "</b><small>" + c.seats + " seats &middot; Acworth lot</small></span>" +
              "<em>" + money(c.day) + "<i>/day</i></em></button>";
          }).join("") +
        "</div>" +
        '<p class="wd__foot">Rented from the dealership itself, not a host&rsquo;s driveway.</p>');
      host.querySelectorAll("[data-car]").forEach(function (b) {
        b.addEventListener("click", function () { pickCar = LOT[+b.dataset.car]; dates(); });
      });
    }

    function dates() {
      screen('<div class="wd__bar"><button class="wd__back" type="button" data-back>&larr;</button><b>' +
          pickCar.year + " " + esc(pickCar.name) + "</b></div>" +
        '<div class="wd__hero"><span class="wd__big">' + days + '</span><small>day' + (days === 1 ? "" : "s") + "</small></div>" +
        '<div class="wd__sheet">' +
          '<div class="wd__step"><button type="button" data-d="-1" aria-label="Fewer days">&minus;</button>' +
            "<span>" + money(pickCar.day) + " &times; " + days + "</span>" +
            '<button type="button" data-d="1" aria-label="More days">+</button></div>' +
          '<div class="wd__line wd__line--tot"><span>Rental</span><span>' + money(pickCar.day * days) + "</span></div>" +
          '<button class="wd__go" type="button" data-next>Continue</button>' +
        "</div>");
      host.querySelector("[data-back]").addEventListener("click", lot);
      host.querySelectorAll("[data-d]").forEach(function (b) {
        b.addEventListener("click", function () {
          days = Math.min(14, Math.max(1, days + Number(b.dataset.d)));
          dates();
        });
      });
      host.querySelector("[data-next]").addEventListener("click", checks);
    }

    function checks() {
      screen('<div class="wd__bar"><b>Before the keys move</b></div>' +
        '<ul class="wd__checks">' +
          '<li data-c="0"><i></i><span>Driver&rsquo;s licence</span><em>checking</em></li>' +
          '<li data-c="1"><i></i><span>Insurance on file</span><em>waiting</em></li>' +
          '<li data-c="2"><i></i><span>Age and lot policy</span><em>waiting</em></li>' +
        "</ul>" +
        '<p class="wd__foot">A dealership carries the compliance, so the app has to ask.</p>');
      var i = 0;
      function next() {
        var li = host.querySelector('[data-c="' + i + '"]');
        if (!li) { total(); return; }
        li.classList.add("is-ok");
        li.querySelector("em").textContent = "cleared";
        var nx = host.querySelector('[data-c="' + (i + 1) + '"]');
        if (nx) nx.querySelector("em").textContent = "checking";
        i += 1;
        var t = wait(760, next);
        stop = function () { clearTimeout(t); };
      }
      var t0 = wait(760, next);
      stop = function () { clearTimeout(t0); };
    }

    function total() {
      var base = pickCar.day * days;
      screen('<div class="wd__bar"><b>Your rental</b></div>' +
        '<div class="wd__wait"><i></i><i></i><i></i><span>Pricing the rental</span></div>');
      quote("whip-rentals-web", base).then(function (q) {
        screen('<div class="wd__bar"><b>Your rental</b></div>' +
          '<div class="wd__hero"><span class="wd__big">' + money(q.payerTotal) + "</span>" +
          "<small>" + pickCar.year + " " + esc(pickCar.name) + " &middot; " + days + " day" + (days === 1 ? "" : "s") + "</small></div>" +
          '<div class="wd__sheet">' +
            '<div class="wd__line"><span>' + money(pickCar.day) + " &times; " + days + "</span><span>" + money(q.base) + "</span></div>" +
            '<div class="wd__line"><span>Service fee &middot; ' + bps(q.payerBps) + "</span><span>" + money(q.payerFee) + "</span></div>" +
            '<div class="wd__line wd__line--tot"><span>Total</span><span>' + money(q.payerTotal) + "</span></div>" +
            '<button class="wd__go" type="button" data-keys>Take the keys</button>' +
            '<p class="wd__src">' + (q.live
              ? "Priced live by the <b>" + esc(q.policy) + "</b> policy on api.mccluster.org"
              : "Ledger unreachable &mdash; shown at the published rate") + "</p>" +
          "</div>");
        host.querySelector("[data-keys]").addEventListener("click", function () { handoff(q); });
      });
    }

    function handoff(q) {
      screen('<div class="wd__bar"><b>Hand-off</b></div>' +
        '<p class="wd__lead">Four photos of the car as you found it. The same four come back on return.</p>' +
        '<div class="wd__shots">' +
          ["Front", "Driver side", "Rear", "Interior"].map(function (s, i) {
            return '<button class="wd__shot" type="button" data-s="' + i + '"><i></i><span>' + s + "</span></button>";
          }).join("") +
        "</div>" +
        '<div class="wd__sheet"><button class="wd__go" type="button" data-done disabled>Release the keys</button></div>');
      var got = 0;
      var go = host.querySelector("[data-done]");
      host.querySelectorAll("[data-s]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (b.classList.contains("is-shot")) return;
          b.classList.add("is-shot");
          got += 1;
          if (got === 4) { go.disabled = false; go.textContent = "Release the keys"; }
          else go.textContent = "Release the keys (" + (4 - got) + " to go)";
        });
      });
      go.textContent = "Release the keys (4 to go)";
      go.addEventListener("click", function () { keys(q); });
    }

    function keys(q) {
      screen('<div class="wd__bar"><b>Keys released</b></div>' +
        '<div class="wd__done"><span class="wd__tick">&#10003;</span><b>' + money(q.payerTotal) + "</b>" +
        "<small>" + pickCar.year + " " + esc(pickCar.name) + " &middot; back in " + days + " day" + (days === 1 ? "" : "s") + "</small></div>" +
        '<div class="wd__sheet"><p class="wd__src">Same account, same ledger as the rides. Condition photos are on the record.</p>' +
        '<button class="wd__go wd__go--ghost" type="button" data-again>Start over</button></div>');
      host.querySelector("[data-again]").addEventListener("click", function () { days = 3; lot(); });
    }

    lot();
    return function () { if (stop) stop(); };
  }

  var APPS = { rider: riderApp, driver: driverApp, rentals: rentalsApp };

  /* mount(el, key) draws the phone and starts the app inside it. It hands
     back a teardown, because the panel that holds it can be closed
     mid-trip and a timer running against a detached node is a leak. */
  function mount(el, key) {
    var run = APPS[key];
    if (!el || !run) return function () {};
    el.innerHTML =
      '<div class="wd">' +
        '<div class="wd__phone"><div class="wd__notch"></div><div class="wd__screen"></div></div>' +
        '<p class="wd__legal">Live demo. The fee on every screen is quoted by ' +
          '<a href="https://api.mccluster.org/v1/fees/quote?app_key=whip-rider-web&amp;base_cents=1180" rel="noopener">api.mccluster.org</a> ' +
          'from the real policy. No car is dispatched and no card is charged; drivers, vehicles and addresses are examples.</p>' +
      "</div>";
    return run(el.querySelector(".wd__screen"));
  }

  return { mount: mount };
})();
