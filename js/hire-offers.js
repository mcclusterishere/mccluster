/* ============================================================
   HIRE: three services and the ground they stand on.

   This used to render four numbered services. It renders three
   now, because the fourth was never a service: a domain and a
   month of hosting is an address and a machine, and pricing it
   beside creative direction made a $33 utility look like a tier
   of the same product. It leads the page, unnumbered, described
   as infrastructure. Manage, Create and Campaign are 01, 02, 03.

   The mode switch lives INSIDE the three services, so the seven
   configurations are seven states of three chapters plus the
   ground, rather than seven things to compare.

   There is no "recommended" badge in this file, by design. The
   only reason the infrastructure chapter is bigger is that it is
   where everybody starts.

   Every figure comes from data/offers.json through MCC_OFFERS.
   Nothing is priced in markup, and anything the ledger has not
   approved renders as polished discovery language — never a
   warning, a filename or a reason.
   ============================================================ */
(function () {
  "use strict";

  var MOUNT = document.getElementById("offerChapters");
  if (!MOUNT || !window.MCC_OFFERS) return;

  var O = window.MCC_OFFERS, M = O.money;
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function chips(list, n) {
    return '<ul class="incl">' + (list || []).slice(0, n || 99).map(function (x) {
      return "<li>" + esc(x) + "</li>";
    }).join("") + "</ul>";
  }

  /* ---------- the ground: a receipt and one big number, no service number ---------- */
  function runwayChapter(o) {
    var p = o.pricing;
    var rows = (p.deposit ? "<li><span class='rates__k'>" + esc(p.deposit.label) +
        "<span class='rates__u'>credited to your first month, not charged on top of it</span></span><b>$" +
        M(p.deposit.amount) + "</b></li>" : "") +
      (p.start.components || []).map(function (c) {
        return "<li><span class='rates__k'>" + esc(c.label) + "</span><b>$" + M(c.amount) + "</b></li>";
      }).join("") +
      "<li><span class='rates__k'>To go live<span class='rates__u'>domain plus the first month</span></span><b>$" +
        M(p.start.total) + "</b></li>" +
      "<li><span class='rates__k'>" + esc(p.recurring.label) + "</span><b>$" +
        M(p.recurring.amount) + "/" + esc(p.recurring.cadence) + "</b></li>" +
      "<li><span class='rates__k'>" + esc(p.domain_renewal.label) + "</span><b>$" +
        M(p.domain_renewal.amount) + "/" + esc(p.domain_renewal.cadence) + "</b></li>" +
      "<li><span class='rates__k'>Basic website build</span><b>Included</b></li>" +
      "<li><span class='rates__k'>Revenue share</span><b>None</b></li>" +
      "<li><span class='rates__k'>First year, all in<span class='rates__u'>" +
        esc(p.first_year.breakdown) + "</span></span><b>$" + M(p.first_year.amount) + "</b></li>";

    return '<section class="chapter chapter--lead" id="offer-runway">' +
      /* no numeral: numbering it 01 is what made it read as the first of
         four services instead of the ground the three stand on */
      '<p class="chapter__no">' + esc(o.stage) + " &middot; infrastructure, not a service</p>" +
      '<div class="chapter__head"><h3>' + esc(o.name) + "</h3></div>" +
      '<p class="chapter__lede">' + esc(o.lede) + "</p>" +
      '<div class="chapter__grid">' +
        "<div>" +
          /* the headline is what it costs to start, which is the deposit:
             nobody is asked for the go-live total before seeing a draft */
          '<div class="chapter__money"><sup>$</sup>' + M((p.deposit || p.start).amount || p.start.total) +
            '<span class="chapter__per">' + esc((p.deposit || p.start).label) + "</span></div>" +
          '<a class="chapter__go" href="' + esc(o.next_step.href) + '">' + esc(o.next_step.label) + "</a>" +
          (p.deposit ? '<p class="rung__fine">' + esc(p.deposit.line) + "</p>" : "") +
          chips(o.includes) +
          '<p class="rung__fine">' + esc(o.equity_note) + "</p>" +
        "</div>" +
        '<div><ul class="rates">' + rows + "</ul></div>" +
      "</div></section>";
  }

  /* ---------- the mode panel inside a service chapter ---------- */
  function modePanel(L, o, mode) {
    var pr = (o.pricing || {})[mode] || {};
    var out = "";

    if (O.priced(pr)) {
      out += '<div class="chapter__money"><sup>$</sup>' + M(pr.amount) +
        '<span class="chapter__per">per ' + esc(pr.cadence) + "</span></div>";
    } else if (pr.approved === true && pr.from != null) {
      out += '<div class="chapter__money"><i class="rung__from">from</i><sup>$</sup>' + M(pr.from) +
        '<span class="chapter__per">' + esc(pr.cadence === "project" ? "priced per project" : "priced per campaign") + "</span></div>";
    } else {
      out += '<div class="rung__discovery">' + esc(O.publicNote(pr)) + "</div>";
    }

    /* the two economic outcomes, side by side — after Contra */
    if (mode === "m") {
      out += '<div class="compare">' +
        '<div class="compare__side is-on"><p class="compare__k">You keep</p>' +
          '<p class="compare__n">100%</p><p class="compare__sub">Every dollar the business makes stays with the business.</p></div>' +
        '<div class="compare__side"><p class="compare__k">You share</p>' +
          '<p class="compare__n">None</p><p class="compare__sub">No revenue share of any kind in M Mode.</p></div>' +
      "</div>";
    } else if (O.priced(pr)) {
      out += '<div class="compare">' +
        '<div class="compare__side is-on"><p class="compare__k">You pay monthly</p>' +
          '<p class="compare__n"><sup>$</sup>' + M(pr.amount) + "</p>" +
          '<p class="compare__sub">Half the standard price, for up to ' + pr.term_months + " months.</p></div>" +
        '<div class="compare__side"><p class="compare__k">You share</p>' +
          '<p class="compare__n">' + pr.share_percent + "%</p>" +
          '<p class="compare__sub">Of eligible connected online revenue, never past $' +
            M(pr.cap.amount) + " in total.</p></div>" +
      "</div>";
    } else {
      out += '<div class="compare">' +
        '<div class="compare__side is-on"><p class="compare__k">Structure</p>' +
          '<p class="compare__n">Built to fit</p>' +
          '<p class="compare__sub">' + esc(pr.public_detail || "") + "</p></div>" +
        '<div class="compare__side"><p class="compare__k">Ownership taken</p>' +
          '<p class="compare__n">None</p>' +
          '<p class="compare__sub">Equity Uprise never takes stock, membership interest or ownership.</p></div>' +
      "</div>";
    }

    /* the published rate lines for the project services */
    if (pr.rate_lines && pr.rate_lines.length) {
      /* data-shop keeps the package tray (js/shop.js) working on the new
         rate lines exactly as it did on the old hand-written cards */
      out += '<ul class="rates rates--lines">' + pr.rate_lines.map(function (r) {
        return "<li data-shop=\"" + esc(r.id) + "\" data-shop-n=\"" + esc(r.label) +
          "\" data-shop-p=\"" + esc(r.amount) + "\" data-shop-m=\"" +
          esc(/^from/.test(r.unit) ? "from" : "once") + "\">" +
          "<span class='rates__k'>" + esc(r.label) +
          "<span class='rates__u'>" + esc(r.unit) + "</span></span><b>$" + M(r.amount) + "</b></li>";
      }).join("") + "</ul>";
      if (pr.note) out += '<p class="rung__fine">' + esc(pr.note) + "</p>";
    }

    if (mode === "equity" && O.priced(pr)) {
      out += '<ul class="rates">' +
        "<li><span class='rates__k'>Term</span><b>Up to " + pr.term_months + " months</b></li>" +
        "<li><span class='rates__k'>Cap<span class='rates__u'>" + pr.cap.multiplier +
          " × 12 × the standard price</span></span><b>$" + M(pr.cap.amount) + "</b></li>" +
        "<li><span class='rates__k'>Sharing ends</span><b>At the term or the cap, whichever is first</b></li>" +
        "<li><span class='rates__k'>Ownership taken</span><b>None</b></li></ul>";
    }
    return out;
  }

  function serviceChapter(L, o, i) {
    /* the same two marks the ladder uses -- one definition, both pages */
    var tabs = o.modes.map(function (m, k) {
      return O.modeButton(L, o, m, k, "ctab", "cpanel");
    }).join("");

    return '<section class="chapter" id="offer-' + esc(o.id) + '" data-chapter="' + esc(o.id) + '">' +
      '<p class="chapter__no">' + esc("0" + i) + " &middot; " + esc(o.stage) + "</p>" +
      '<div class="chapter__head"><h3>' + esc(o.name) + "</h3></div>" +
      '<p class="chapter__lede">' + esc(o.lede) + "</p>" +
      '<div class="chapter__grid">' +
        "<div>" +
          '<div class="modes" role="tablist" aria-label="' + esc(o.name) + ' payment mode">' + tabs + "</div>" +
          '<div class="chapter__panel" id="cpanel-' + esc(o.id) + '" role="tabpanel"' +
            ' aria-labelledby="ctab-' + esc(o.id) + '-m"></div>' +
          '<a class="chapter__go" href="' + esc(o.next_step.href) + '">' + esc(o.next_step.label) + "</a>" +
        "</div>" +
        "<div>" + chips(o.includes) +
          (o.excludes && o.excludes.length
            ? '<p class="rung__fine">Not included: ' + esc(o.excludes.join(" ")) + "</p>" : "") +
          (o.rights_note ? '<p class="rung__fine">' + esc(o.rights_note) + "</p>" : "") +
        "</div>" +
      "</div></section>";
  }

  function adjunct(a) {
    return '<div class="chapter" style="border-top-style:dashed">' +
      '<p class="chapter__no">' + esc(a.kicker) + "</p>" +
      '<div class="chapter__grid"><div>' +
        "<h3 style=\"font-size:clamp(1.6rem,5vw,2.2rem)\">" + esc(a.name) + "</h3>" +
        '<div class="chapter__money" style="font-size:clamp(2rem,7vw,2.8rem)"><sup>$</sup>' + M(a.amount) +
          '<span class="chapter__per">' + esc(a.unit) + "</span></div>" +
      "</div><div><p class=\"chapter__lede\">" + esc(a.line) + "</p></div></div></div>";
  }

  O.load().then(function (L) {
    /* listed:false offers are sellable but not shelved -- see js/offers.js */
    var offers = O.listed ? O.listed(L)
      : (L.offers || []).slice().sort(function (a, b) { return a.position - b.position; });
    var adj = ((L.adjuncts || {}).items) || [];

    MOUNT.innerHTML =
      '<div class="chapters">' +
      adj.filter(function (a) { return a.position === "before"; }).map(adjunct).join("") +
      /* the ground first and unnumbered; the three services numbered
         among themselves, so 01, 02, 03 counts services and nothing else */
      offers.filter(function (o) { return o.primary; }).map(runwayChapter).join("") +
      offers.filter(function (o) { return !o.primary; })
        .map(function (o, i) { return serviceChapter(L, o, i + 1); }).join("") +
      adj.filter(function (a) { return a.position === "after"; }).map(adjunct).join("") +
      "</div>" +
      /* the first month, printed here in full rather than summarised: the
         management service is not bought the way the others are, and the
         page that sells it has to say so where the price is */
      (O.renderDrafts ? O.renderDrafts(L) : "") +
      (O.renderActivation ? O.renderActivation(L) : "") +
      (O.renderLicense ? O.renderLicense(L) : "");

    /* wire each chapter's mode switch: M Mode default, Equity never preselected */
    offers.filter(function (o) { return !o.primary; }).forEach(function (o) {
      var sec = MOUNT.querySelector('[data-chapter="' + o.id + '"]');
      if (!sec) return;
      var panel = sec.querySelector(".chapter__panel");
      var tabs = Array.prototype.slice.call(sec.querySelectorAll(".modes button"));
      panel.innerHTML = modePanel(L, o, o.modes[0]);

      function select(btn) {
        tabs.forEach(function (b) {
          var on = b === btn;
          b.setAttribute("aria-selected", String(on));
          b.tabIndex = on ? 0 : -1;
        });
        panel.setAttribute("aria-labelledby", btn.id);
        panel.innerHTML = modePanel(L, o, btn.dataset.mode);
        if (window.MCC_SHOP && window.MCC_SHOP.rescan) window.MCC_SHOP.rescan();
        if (window.MCC_TRACK) window.MCC_TRACK("hire_mode_view", { offer: o.id, mode: btn.dataset.mode });
      }

      tabs.forEach(function (btn) {
        btn.addEventListener("click", function () { select(btn); });
        btn.addEventListener("keydown", function (e) {
          var i = tabs.indexOf(btn), next = null;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") next = tabs[(i + 1) % tabs.length];
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = tabs[(i + tabs.length - 1) % tabs.length];
          else if (e.key === "Home") next = tabs[0];
          else if (e.key === "End") next = tabs[tabs.length - 1];
          if (!next) return;
          e.preventDefault(); next.focus(); select(next);
        });
      });
    });

    /* the package tray was wired at DOMContentLoaded, before these rate
       lines existed — hand it the ones that just landed */
    if (window.MCC_SHOP && window.MCC_SHOP.rescan) window.MCC_SHOP.rescan();

    /* ---------- the Equity calculator ---------- */
    var calc = document.getElementById("equityCalc");
    if (!calc) return;
    var anti = O.offerOf(L, "anti-social");
    var eq = anti.pricing.equity, m = anti.pricing.m;

    calc.innerHTML =
      "<h4>What Equity Uprise actually costs</h4>" +
      '<p class="calc__lede">Move your own revenue through it. Nothing here is hidden in a footnote: ' +
        "the monthly price is half the standard, the share is " + eq.share_percent +
        "% of eligible connected online revenue, and sharing stops at the earlier of " +
        eq.term_months + " months or the cap.</p>" +
      '<div class="calc__grid">' +
        '<div class="calc__field">' +
          '<label for="calcRev">Your eligible online revenue, per month</label>' +
          '<div class="calc__row"><span>$</span>' +
            '<input type="number" id="calcRev" min="0" max="200000" step="100" value="5000" inputmode="numeric"></div>' +
          '<input type="range" id="calcRange" min="0" max="60000" step="500" value="5000" aria-labelledby="calcRevLbl">' +
          '<p class="calc__hint" id="calcRevLbl">Only revenue processed through the payment rails connected to the ' +
            "website counts. What that includes is written into your agreement before anything is signed.</p>" +
        "</div>" +
        '<div><ul class="rates" id="calcOut"></ul>' +
          '<p class="calc__note" id="calcNote"></p></div>' +
      "</div>";

    var revIn = document.getElementById("calcRev"),
        range = document.getElementById("calcRange"),
        out = document.getElementById("calcOut"),
        note = document.getElementById("calcNote");

    function paint(v) {
      v = Math.max(0, Number(v) || 0);
      var share = v * (eq.share_percent / 100);
      var mYear = m.amount * 12;
      var eqYear = eq.amount * 12 + share * 12;
      var cap = eq.cap.amount;
      var monthsToCap = share > 0 ? Math.ceil(cap / share) : null;

      out.innerHTML =
        "<li><span class='rates__k'>M Mode<span class='rates__u'>the standard price, no revenue share</span></span><b>$" +
          M(m.amount) + "/mo</b></li>" +
        "<li><span class='rates__k'>Equity Uprise base<span class='rates__u'>half the standard price</span></span><b>$" +
          M(eq.amount) + "/mo</b></li>" +
        "<li><span class='rates__k'>Plus " + eq.share_percent + "% of $" + M(v) +
          "<span class='rates__u'>your share, at this revenue</span></span><b>$" + M(share) + "/mo</b></li>" +
        "<li><span class='rates__k'>Equity Uprise, this month</span><b>$" + M(eq.amount + share) + "</b></li>" +
        "<li><span class='rates__k'>Twelve months on M Mode</span><b>$" + M(mYear) + "</b></li>" +
        "<li><span class='rates__k'>Twelve months on Equity Uprise<span class='rates__u'>if revenue held steady</span></span><b>$" +
          M(eqYear) + "</b></li>" +
        "<li><span class='rates__k'>The cap<span class='rates__u'>" + eq.cap.multiplier +
          " × 12 × $" + M(m.amount) + "</span></span><b>$" + M(cap) + "</b></li>";

      note.textContent = share <= 0
        ? "At no online revenue, Equity Uprise costs $" + M(eq.amount) + " a month and shares nothing."
        : eqYear < mYear
          ? "At this revenue, Equity Uprise costs $" + M(mYear - eqYear) + " less over twelve months than M Mode. " +
            "Sharing would reach the $" + M(cap) + " cap in about " + monthsToCap + " months, and the term ends at " +
            eq.term_months + " months regardless."
          : "At this revenue, M Mode is the cheaper of the two by $" + M(eqYear - mYear) +
            " over twelve months. Sharing would reach the $" + M(cap) + " cap in about " + monthsToCap +
            " months, and the term ends at " + eq.term_months + " months regardless.";
    }

    revIn.addEventListener("input", function () { range.value = Math.min(revIn.value, range.max); paint(revIn.value); });
    range.addEventListener("input", function () { revIn.value = range.value; paint(range.value); });
    paint(revIn.value);
  }).catch(function () {
    MOUNT.innerHTML = '<p class="chapter__lede">The rate card is a moment away. ' +
      '<a href="onboard.html" style="color:#e5383b">Start onboarding</a> and the desk picks it up either way.</p>';
  });
})();
