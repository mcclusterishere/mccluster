/* ============================================================
   THE OFFER LADDER — shared engine + renderer

   One ledger, data/offers.json, read once and shared by
   sites.html, hire.html and onboard.html through window.MCC_OFFERS.

   Two rules this file exists to enforce:

   1. NOTHING IS HARDCODED. The Equity cash price, the Equity cap
      and Runway's first-year total are computed from the formulas
      in the ledger. Change the standard price and every derived
      figure moves with it, on the next load, with no code edit.

   2. NOTHING INTERNAL REACHES A VISITOR. Values the ledger marks
      approved:false never render a number and never render the
      reason they are unapproved. They render the offer's
      public_note — polished sales language — and nothing else.
      No filenames, no branch names, no approval internals.
      That reasoning lives in docs/sales-redesign/.

   The renderer paints into #offerLadder if that element exists,
   and does nothing at all if it does not.
   ============================================================ */
(function () {
  "use strict";

  var STAMP = (document.currentScript && /v=([^&]*)/.exec(document.currentScript.src) || [])[1] || "";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* money: whole dollars stay whole, cents only when they exist */
  function money(n) {
    if (n == null) return null;
    return Number(n).toFixed(2).replace(/\.00$/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function dollars(n) { return n == null ? null : "$" + money(n); }

  /* ---------- the formulas, applied once at load ----------
     Every derived number on every page comes from here. */
  function derive(L) {
    (L.offers || []).forEach(function (o) {
      var p = o.pricing || {};

      /* Runway: the domain plus twelve months of hosting. Month one
         already sits inside the $60 start total, so it is counted
         once here and never added twice. */
      if (p.start && p.recurring && p.first_year) {
        var domain = (p.start.components || []).filter(function (c) { return c.id === "domain"; })[0];
        var domainAmt = domain ? domain.amount : 0;
        p.first_year.amount = domainAmt + 12 * p.recurring.amount;
        p.first_year.remaining_months = 11;
        p.first_year.remaining_amount = 11 * p.recurring.amount;

        /* THE YEAR PAID TOGETHER.
           One number is stored — the annual monthly-equivalent rate — and
           the three figures the card prints are all arithmetic on it: the
           twelve months, the go-live total that includes the domain, and
           what it saves against paying monthly. A stored saving is a
           saving that survives the next price change. */
        if (p.annual && p.annual.monthly_equivalent != null) {
          var months = p.annual.months || 12;
          p.annual.hosting_amount = p.annual.monthly_equivalent * months;
          p.annual.total = domainAmt + p.annual.hosting_amount;
          p.annual.saving = (months * p.recurring.amount) - p.annual.hosting_amount;
          if (p.hosting_year) p.hosting_year.amount = p.annual.hosting_amount;
        }
      }

      /* the standard twelve-month value of the service */
      if (p.m && p.m.amount != null && p.m.cadence === "month") {
        p.m.annual_value = p.m.amount * 12;
      }

      /* Equity: a fraction of the approved standard price, and a cap
         that is a multiple of the normal twelve-month value. Neither
         is ever a stored constant. */
      if (p.equity && p.equity.approved && p.m && p.m.amount != null) {
        if (p.equity.base_multiplier != null) {
          p.equity.amount = p.m.amount * p.equity.base_multiplier;
        }
        if (p.equity.cap && p.equity.cap.multiplier != null) {
          p.equity.cap.amount = p.equity.cap.multiplier * 12 * p.m.amount;
        }
      }
    });
    return L;
  }

  /* an offer/mode pair is only sellable as a price if the ledger approved it */
  function priced(pr) {
    return !!(pr && pr.approved === true && pr.amount != null);
  }

  /* the public voice for anything not yet approved — never a warning */
  function publicNote(pr) {
    return (pr && (pr.public_note || pr.note)) || "Terms structured during discovery.";
  }

  /* canonical CRM identity for a configuration */
  function configOf(L, offerId, mode) {
    var rows = ((L.crm || {}).configurations) || [];
    var want = offerId === "runway" ? "runway" : offerId + "." + mode;
    for (var i = 0; i < rows.length; i++) if (rows[i].config === want) return rows[i];
    return { config: want, offer: offerId, mode: mode, legacy_plan: null, label: offerId };
  }

  function offerOf(L, id) {
    var list = L.offers || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* the price line a configuration shows, as plain data any page can render */
  function priceOf(L, offerId, mode) {
    var o = offerOf(L, offerId);
    if (!o) return null;
    var p = o.pricing || {};

    if (offerId === "runway") {
      /* Two ways to pay for the same service, and only one of them is
         showing at a time. This is not the two-prices-for-one-product
         fault the cards were rebuilt to remove: that was one purchase
         wearing two numbers with no way to choose between them. */
      if (mode === "year" && p.annual && p.annual.approved) {
        return {
          approved: true, kind: "year",
          amount: p.annual.total, cadence: "once",
          display: dollars(p.annual.total), per: p.annual.label,
          recurring: dollars(p.annual.hosting_amount) + "/year",
          monthly_equivalent: dollars(p.annual.monthly_equivalent),
          saving: dollars(p.annual.saving)
        };
      }
      return {
        approved: true, kind: "start",
        amount: p.start.total, cadence: "once",
        display: dollars(p.start.total), per: p.start.label,
        recurring: dollars(p.recurring.amount) + "/" + p.recurring.cadence,
        first_year: dollars(p.first_year.amount)
      };
    }

    var pr = p[mode] || {};
    if (priced(pr)) {
      return {
        approved: true, kind: mode,
        amount: pr.amount, cadence: pr.cadence,
        display: dollars(pr.amount), per: "per " + pr.cadence,
        share_percent: pr.share_percent, term_months: pr.term_months,
        cap: pr.cap ? pr.cap.amount : null
      };
    }
    /* M Mode on the project services: a floor, not a single number */
    if (pr.approved === true && pr.from != null) {
      return {
        approved: true, kind: mode, from: pr.from, cadence: pr.cadence,
        display: "from " + dollars(pr.from), per: "per " + pr.cadence,
        rate_lines: pr.rate_lines || []
      };
    }
    return { approved: false, kind: mode, display: null, note: publicNote(pr) };
  }

  /* ============================================================
     THE LADDER RENDERER (sites.html)
     ============================================================ */

  /* ============================================================
     THE MODE BUTTONS ARE THE MARKS.

     M Mode and Equity Uprise are the two ways to buy, and they are
     brands before they are words -- the M coin is on the bar, on the
     favicon and on the masthead, and Equity Uprise has its own mark on
     its own pages. Setting the words in a pill made them read as two
     tab labels; the marks make them read as the two houses they are.

     The name does not disappear, it stops being drawn: it stays on the
     button as its accessible name and as .sr-only text, so a screen
     reader still hears "Equity Uprise" and never "button, image".

     THE TWO MARKS NEED OPPOSITE TREATMENT. The M is a house mark and
     flips with the coat like every other one (m-mark on ink,
     m-mark-dark on bone). The Equity Uprise mark is a navy wordmark
     belonging to a separate program, and recolouring somebody's logo to
     survive a background is the wrong fix -- so it keeps its own colour
     and gets its own pale plate to sit on, on both coats.
     ============================================================ */
  function modeButton(L, o, m, i, idPrefix, panelId) {
    var md = (L.modes || {})[m] || { name: m };
    var on = i === 0;
    return '<button type="button" role="tab" data-mode="' + esc(m) + '"' +
      ' id="' + esc(idPrefix) + "-" + esc(o.id) + "-" + esc(m) + '"' +
      ' aria-selected="' + (on ? "true" : "false") + '"' +
      ' tabindex="' + (on ? "0" : "-1") + '"' +
      ' aria-label="' + esc(md.name) + '"' +
      ' title="' + esc(md.name) + '"' +
      ' aria-controls="' + esc(panelId) + "-" + esc(o.id) + '">' +
      (md.emblem
        ? '<img class="modes__mark" src="' + esc(STAMP ? md.emblem + "?v=" + STAMP : md.emblem) +
          '" alt="" width="40" height="40" decoding="async">'
        : "") +
      /* THE MARK ALONE WAS NOT A LABEL. At 26px the Equity wordmark read
         as a grey smudge and the segment looked broken rather than
         unselected. The mark still carries the programme -- that
         distinction from a billing period is real -- but a person has to
         be able to read which half they are pressing. */
      '<span class="modes__word">' + esc(md.name) + "</span>" +
    "</button>";
  }

  function renderDisclose(L) {
    var eq = L.modes.equity;
    return '<section class="disclose">' +
      "<h3>What Equity Uprise is, and is not</h3>" +
      "<p><b>" + esc(eq.plain) + "</b></p>" +
      "<p>Equity Uprise is a " + esc(eq.program_owner) + " program for " +
        esc((eq.program_purpose || []).join(", ")) +
        ". It is never preselected, and it always requires a signed agreement.</p>" +
      "<p>" + esc(L.revenue_definition.public_note) + "</p>" +
      '<p class="receipt__note">' + esc(L.estimate_disclaimer) + "</p>" +
    "</section>";
  }

  /* ============================================================
     THE FIRST MONTH.

     One offer on the ladder is not bought the way the others are: the
     management service opens with a free month delivered as four weekly
     sprints, one module switched on per week, and ends with a decision
     the customer makes on evidence.

     This page states that plainly, because it is my page. Two things
     have to be unmissable or the whole thing reads as a trap: which
     modules SWITCH OFF if they do not continue, and which one does not.
     The website does not. It is theirs from week one and it stays live
     whatever they decide, so the choice at the end is between keeping
     the automation and keeping just the site, never between paying and
     going dark. Every word below comes from the ledger.
     ============================================================ */
  /* ============================================================
     THE REDRAW.

     Buying the domain does not just buy an address, it starts a
     subscription to the site being remade: a draft a month for the
     first year, then a draft every quarter for as long as it is hosted
     here, and it never steps down at all on the full service.

     This is the retention number, so it gets stated as three states
     rather than one sentence with two clauses hanging off it. The
     third state is the argument for upgrading and is deliberately not
     dressed as one.
     ============================================================ */
  function renderDrafts(L) {
    var o = (L.offers || []).filter(function (x) { return (x.drafts || {}).first_year; })[0];
    if (!o) return "";
    var d = o.drafts;
    var states = [
      ["Year one", d.first_year.count + " drafts", d.first_year.line],
      ["After that", "Every quarter, for life", d.after.line],
      ["On the full service", "It never steps down", d.upgraded.line],
    ].map(function (r) {
      return '<li><span class="redraw__k">' + esc(r[0]) + "</span>" +
        "<b>" + esc(r[1]) + "</b><p>" + esc(r[2]) + "</p></li>";
    }).join("");

    return '<section class="redraw" aria-label="' + esc(d.name) + '">' +
      '<p class="redraw__kick">' + esc(o.name) + " &middot; what the domain actually buys</p>" +
      "<h2>" + esc(d.headline) + "</h2>" +
      '<p class="redraw__lede">' + esc(d.what) + "</p>" +
      '<ol class="redraw__rail">' + states + "</ol>" +
      '<p class="redraw__plain">' + esc(d.plain) + "</p>" +
    "</section>";
  }

  /* ============================================================
     THE CUSTOMER LICENCE.

     The catalogue comes free with the management service, in either
     mode, for as long as the service runs. Three things have to be
     unmissable or it reads as marketing:

       WHAT IT ACTUALLY COVERS, itemised, because "you can use my
       music" is not a licence and nobody can act on it.

       WHAT IT DOES NOT, in the same list voice as what it does. A
       grant that only prints its permissions is a grant somebody
       breaks by accident.

       THAT IT ENDS WITH THE SERVICE. Said plainly, next to the offer,
       rather than discovered later. It is a reason to stay, and the
       moment it is dressed as anything else it becomes a trap.

     A coverage line the ledger has not approved prints its public
     note and never a promise -- same law as a price.
     ============================================================ */
  function renderLicense(L) {
    var cl = L.customer_license;
    if (!cl || !cl.covers) return "";
    var by = (cl.granted_by || []).map(function (g) {
      var o = offerOf(L, g.offer);
      return o ? o.name : g.offer;
    }).join(", ");

    var covers = cl.covers.map(function (c) {
      var open = c.approved === true;
      return '<li class="lic' + (open ? " is-open" : " is-arranged") + '">' +
        '<span class="lic__state">' + (open ? "Included" : "Arranged") + "</span>" +
        "<b>" + esc(c.name) + "</b>" +
        "<p>" + esc(open ? c.what : publicNote(c)) + "</p>" +
      "</li>";
    }).join("");

    var nots = (cl.excludes || []).map(function (x) {
      return "<li>" + esc(x) + "</li>";
    }).join("");

    return '<section class="licgrant" aria-label="' + esc(cl.name) + '">' +
      '<p class="licgrant__k">' + esc(by) + " &middot; included</p>" +
      "<h2>" + esc(cl.headline) + "</h2>" +
      '<p class="licgrant__lede">' + esc(cl.lede) + "</p>" +
      '<ul class="licgrant__covers">' + covers + "</ul>" +
      '<div class="licgrant__foot">' +
        '<div><p class="licgrant__ft">What it does not cover</p><ul class="licgrant__nots">' + nots + "</ul></div>" +
        '<div><p class="licgrant__ft">How long</p>' +
          "<p>" + esc(cl.term) + "</p><p>" + esc(cl.ends) + "</p></div>" +
      "</div>" +
      '<p class="licgrant__mail">' + esc(cl.delivery) + "</p>" +
      '<p class="licgrant__desk">' + esc(cl.still_a_desk) +
        ' <a href="license.html">The licensing desk</a>.</p>' +
    "</section>";
  }

  function renderActivation(L) {
    var host = (L.offers || []).filter(function (o) { return (o.activation || {}).sprints; })[0];
    if (!host) return "";
    var a = host.activation;
    var weeks = a.sprints.map(function (s) {
      return '<li class="sprint' + (s.permanent ? " is-kept" : "") + '">' +
        '<span class="sprint__wk">Week ' + esc(s.week) + "</span>" +
        "<b>" + esc(s.name) + "</b>" +
        "<p>" + esc(s.what) + "</p>" +
        '<p class="sprint__after"><i>' +
          (s.permanent ? "Stays" : "Switches off") + "</i> " + esc(s.after) + "</p>" +
      "</li>";
    }).join("");

    var exits = (a.at_the_end.options || []).map(function (opt) {
      var pr = priceOf(L, opt.price_from, "m");
      var line = "";
      if (opt.price_from === "anti-social" && pr && pr.approved) {
        line = pr.display + " " + pr.per;
      } else if (opt.price_from === "runway") {
        var r = (((L.offers || []).filter(function (o) { return o.id === "runway"; })[0] || {}).pricing || {});
        if (r.recurring) line = dollars(r.recurring.amount) + " per " + r.recurring.cadence;
      }
      /* no approved number is not a blank: the slot says how the thing is
         bought instead, which is the truth and never a placeholder price */
      if (!line && opt.mode === "equity") line = ((L.modes || {}).equity || {}).name || "";
      if (!line && opt.requires_agreement) line = "By agreement";
      return '<div class="exit exit--' + esc(opt.id) + '">' +
        "<b>" + esc(opt.name) + "</b>" +
        (line ? '<span class="exit__n">' + esc(line) + "</span>" : "") +
        "<p>" + esc(opt.what) + "</p>" +
      "</div>";
    }).join("");

    return '<section class="activate" id="activation" aria-label="The first month">' +
      '<p class="activate__k">' + esc(host.name) + " &middot; how it starts</p>" +
      "<h2>" + esc(a.name) + " is <em>free.</em></h2>" +
      '<p class="activate__lede">' + esc(a.free_note) + "</p>" +
      '<p class="activate__shape">' + esc(a.shape) + "</p>" +
      '<ol class="sprints">' + weeks + "</ol>" +
      '<p class="activate__prompt">' + esc(a.at_the_end.prompt) + "</p>" +
      '<div class="exits">' + exits + "</div>" +
      '<p class="activate__notrap">' + esc(a.at_the_end.no_trap) + "</p>" +
    "</section>";
  }

  /* AN UNLISTED OFFER IS STILL AN OFFER.

     "Social only" is the week-four module bought on its own. It is real,
     it is sellable, and ?offer=social has to keep working -- but it is not
     a rung on the ladder, because putting it there turns three services
     into four and re-tells the exact story the ladder was rebuilt to stop
     telling. listed:false means "the ledger sells this, the shelf does not
     display it". Anything walking the ladder filters through here. */
  function listed(L) {
    return (L.offers || []).filter(function (o) { return o.listed !== false; })
      .sort(function (a, b) { return a.position - b.position; });
  }

  /* ============================================================
     THE BUY CARD — the whole page, four times.

     The ladder that used to live here answered every question somebody
     might have before buying. It was 8,357px tall on a phone, and the
     front door card carried TWO prices for one product: $33 as the big
     number and $66 in a receipt table underneath. The owner of the
     business read his own page and named it as two separate products.
     That is the tell, and it is the whole reason this exists.

     So a card has one price, one sentence, one button. What it costs
     afterwards is one line under the button, because that is the only
     other thing anybody needs before deciding. Everything else moved to
     sites-details.html, which nobody has to read in order to buy.

     THE TWO MODES ARE NOT TWO CHECKOUTS. M Mode is a price you click.
     Equity Uprise is a revenue-share agreement, and an agreement cannot
     be a button — flipping the mode says what the terms are and sends
     you to the questions, which is the honest shape of it.
     ============================================================ */

  /* THE PRICE COMES FROM THE LEDGER. ALWAYS.
     An earlier cut of this card carried its own numbers in the checkout
     block, which is the one thing the top of this file forbids: a price
     typed twice is a price that drifts, and the drift is silent. So the
     card asks priceOf() the same question every other surface asks, and
     the checkout block says only where the button goes and what it says
     on it. */
  function buyPrice(pr) {
    if (!pr || !pr.approved) {
      return '<div class="buy__price buy__price--words">' +
        esc((pr && pr.note) || "Priced with you") + "</div>";
    }
    if (pr.from != null) {
      return '<div class="buy__price"><i class="buy__from">from</i><sup>$</sup>' + money(pr.from) +
        '<span class="buy__per">' + esc(pr.per || "") + "</span></div>";
    }
    return '<div class="buy__price"><sup>$</sup>' +
      esc(String(pr.display || "").replace(/^\$/, "")) +
      '<span class="buy__per">' + esc(pr.per || "") + "</span></div>";
  }

  /* The line under the button, with the ledger's own figures written into
     it. {recurring}, {share}, {term} and {cap} are the only placeholders,
     and an unresolved one drops the sentence rather than printing a brace
     at somebody. */
  function buyAfter(pr, tpl) {
    if (!tpl) return "";
    var vals = {
      recurring: pr && pr.recurring,
      share: pr && pr.share_percent,
      term: pr && pr.term_months,
      cap: pr && pr.cap != null ? dollars(pr.cap) : null,
      saving: pr && pr.saving,
      monthly: pr && pr.monthly_equivalent
    };
    var missing = false;
    var out = tpl.replace(/\{(\w+)\}/g, function (_, k) {
      if (vals[k] == null) { missing = true; return ""; }
      return String(vals[k]);
    });
    return missing ? "" : out;
  }

  /* ============================================================
     THE ADDRESS BOX

     The card said "Get the address" and then took money for an
     address nobody had looked up. The name is the first real
     decision anybody makes about a website — it is the thing they
     say out loud to people — and it was the one thing this card
     would not let them do. So: type it, see whether it is free and
     what it costs, THEN press the button.

     Three rules hold this together.

     1. THE ANSWER COMES FROM A REGISTRY, NOT FROM US. The
        domain-check function asks RDAP, the registries' own
        protocol. "Couldn't check" is a third answer and it is
        never dressed up as "yours" — a rate limit read as
        available sells somebody a name that belongs to a bank.

     2. THE PRICE COMES FROM THE SAME PLACE THE CHARGE DOES.
        public.domain_tlds says what an ending costs; the ledger
        says what the domain component of this card costs. If those
        two ever disagree, the address is NOT offered in one tap —
        it routes to the questions instead. A card that shows one
        number and charges another is the bug this whole file was
        written to prevent, and it does not get a second door.

     3. NOT SEARCHING STILL BUYS. Somebody who already owns their
        name, or who would rather sort it out in conversation, taps
        the button exactly as before. The box is an option on the
        way to the button, never a gate in front of it.
     ============================================================ */

  var DOMAIN_FN = "/functions/v1/domain-check";

  function domainBox(o, mode) {
    var uid = esc(o.id + "-" + mode);
    return '<div class="dom" data-dom="' + esc(o.id) + '" data-mode="' + esc(mode) + '">' +
      '<label class="dom__lab" for="domq-' + uid + '">Your address</label>' +
      '<div class="dom__row">' +
        '<input class="dom__in" id="domq-' + uid + '" type="text" name="domain"' +
          ' inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"' +
          ' maxlength="80" placeholder="yourbusiness"' +
          ' aria-describedby="domsay-' + uid + '">' +
        '<button class="dom__go" type="button">Check</button>' +
      "</div>" +
      '<p class="dom__say" id="domsay-' + uid + '" role="status" aria-live="polite"></p>' +
      '<div class="dom__list" role="group" aria-label="Addresses"></div>' +
      '<p class="dom__hold" hidden>Checking an address does not hold it. This one gets ' +
      "registered in your name once the payment lands.</p>" +
      "</div>";
  }

  /* What the card may say about one result, decided once so the chip,
     the button and the sentence under it can never disagree. `domain`
     is the ledger's own price for the domain component of this card;
     a registry price that is not that price is not a one-tap sale. */
  function domainOffer(r, domain) {
    var free = r && r.available === true;
    var priced = r && r.sellable === true && typeof r.price === "number" && r.price > 0;
    var agrees = priced && domain != null && Number(r.price) === Number(domain);
    return {
      free: free,
      buyable: !!(free && agrees),
      /* Available, ours to sell, but priced somewhere other than this
         card's own figure: real, and not a button. */
      quoted: !!(free && !agrees),
      price: priced ? Number(r.price) : null,
      line: r.available === null ? "Couldn't check that one just now."
          : r.available === false ? "Taken."
          : (free && agrees) ? "Available."
          : (r.note || "Available. Priced with you."),
    };
  }

  function mountDomain(panel, L, o, mode) {
    var box = panel.querySelector(".dom");
    if (!box) return;

    var input = box.querySelector(".dom__in");
    var go = box.querySelector(".dom__go");
    var say = box.querySelector(".dom__say");
    var list = box.querySelector(".dom__list");
    var hold = box.querySelector(".dom__hold");
    var btn = panel.querySelector(".buy__go");
    if (!input || !go || !btn) return;

    var baseHref = btn.getAttribute("href");
    var baseLabel = btn.textContent;
    var c = ((o.checkout || {})[mode]) || {};

    /* the domain component of this card, from the ledger — the number
       the registry's price has to match before a button appears */
    var p = ((L.offers || []).filter(function (x) { return x.id === o.id; })[0] || {}).pricing || {};
    var comp = ((p.start || {}).components || []).filter(function (x) { return x.id === "domain"; })[0];
    var domainAmt = comp ? comp.amount : null;

    var busy = false, last = "";

    function reset() {
      btn.setAttribute("href", baseHref);
      btn.textContent = baseLabel;
      btn.removeAttribute("data-domain");
      if (hold) hold.hidden = true;
    }

    function choose(r, off, chip) {
      [].slice.call(list.querySelectorAll(".dom__one")).forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === chip));
      });
      if (off.buyable) {
        btn.setAttribute("href",
          "pay.html?offer=" + encodeURIComponent(c.offering || "") + "&for=" + encodeURIComponent(r.name));
        btn.textContent = "Get " + r.name;
        /* SAY THE ONE THING A SEARCH RESULT DOES NOT SAY.
           "Available" is true at the moment it was asked and nothing
           more: a search does not reserve anything, and the gap between
           reading this and paying is a gap where somebody else can take
           the name. Letting a buyer assume the box held it for them is
           the kind of quiet assumption that ends in a refund argument. */
        if (hold) hold.hidden = false;
      } else {
        /* Free but not one-tap: the name travels to the questions, where
           it lands as "I need one, this one".

           Taken or unanswered: the name does NOT travel. Carrying a name
           somebody else owns into a form that reads "the one you want"
           is how a desk ends up quoting for an address it cannot get. */
        btn.setAttribute("href", "onboard.html?offer=" + encodeURIComponent(o.id) +
          "&mode=" + encodeURIComponent(mode) +
          (off.free ? "&domain=" + encodeURIComponent(r.name) : ""));
        btn.textContent = off.free ? "Ask about " + r.name : "Start with a different name";
        if (hold) hold.hidden = true;
      }
      btn.setAttribute("data-domain", r.name);
      if (window.MCC_TRACK) window.MCC_TRACK("domain_pick", { offer: o.id, name: r.name, buyable: off.buyable });
    }

    function paint(res) {
      list.innerHTML = "";
      var first = null;
      (res || []).forEach(function (r) {
        var off = domainOffer(r, domainAmt);
        var b = document.createElement("button");
        b.type = "button";
        b.className = "dom__one" + (off.free ? "" : " is-gone");
        b.setAttribute("aria-pressed", "false");
        b.disabled = r.available === false;
        b.innerHTML =
          '<b>' + esc(r.name) + "</b>" +
          '<i>' + esc(off.line) + "</i>" +
          (off.buyable ? '<span class="dom__price">' + esc(dollars(off.price)) + "/yr</span>" : "");
        b.addEventListener("click", function () { choose(r, off, b); });
        list.appendChild(b);
        /* PRESELECT ON FREE, NOT ON BUYABLE.
           Results come back sorted with the one-tap answer first, so the
           first FREE row is the buyable one whenever a buyable one
           exists. When none does — an ending we quote rather than sell —
           the free name is still the answer they asked for, and it still
           gets picked; it just points at the questions instead of at a
           card form. What is never picked is a name somebody else owns,
           or one the registry would not speak about. */
        if (!first && off.free) { first = { r: r, off: off, el: b }; }
      });
      /* the one they can act on is preselected, because making somebody
         tap twice to accept the answer they just asked for is friction
         with no information in it */
      if (first) choose(first.r, first.off, first.el);
      else reset();
    }

    function check() {
      var q = input.value.trim();
      if (!q) { say.textContent = "Type a name to check."; list.innerHTML = ""; reset(); return; }
      if (busy) return;
      if (q === last && list.children.length) return;
      busy = true; last = q;
      go.disabled = true;
      say.textContent = "Checking…";
      list.innerHTML = "";
      reset();

      var S = window.MCC_SUPA;
      if (!S || !S.url) { busy = false; go.disabled = false; say.textContent = "Search is offline — tap the button and we will sort the name out with you."; return; }

      fetch(S.url + DOMAIN_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: S.key },
        body: JSON.stringify({ name: q }),
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          busy = false; go.disabled = false;
          if (!j || !j.ok) {
            say.textContent = (j && j.reason) || "Couldn't check that one.";
            return;
          }
          var free = (j.results || []).filter(function (r) { return r.available === true; }).length;
          say.textContent = free
            ? (free === 1 ? "One address is free." : free + " addresses are free.")
            : "Every ending of that name is taken. Try another.";
          paint(j.results);
          if (window.MCC_TRACK) window.MCC_TRACK("domain_search", { offer: o.id, free: free });
        })
        .catch(function (e) {
          busy = false; go.disabled = false;
          console.error("domain check failed", e);
          say.textContent = "Couldn't reach the registry. Tap the button and we will sort the name out with you.";
        });
    }

    go.addEventListener("click", check);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); check(); }
    });
    /* editing invalidates the answer on screen: a button that still says
       "Get oldname.com" while the box reads something else is a lie with
       a price on it */
    input.addEventListener("input", function () {
      if (input.value.trim() === last) return;
      list.innerHTML = ""; say.textContent = ""; reset();
    });
  }

  function buyBody(L, o, mode) {
    var c = ((o.checkout || {})[mode]) || {};
    var pr = priceOf(L, o.id, mode);
    var href = c.onboard
      ? "onboard.html?offer=" + encodeURIComponent(o.id) + "&mode=" + encodeURIComponent(mode)
      : "pay.html?offer=" + encodeURIComponent(c.offering || "");

    var out = buyPrice(pr) +
      (c.domain_search ? domainBox(o, mode) : "") +
      '<a class="buy__go" href="' + esc(href) + '"' +
        (c.offering ? ' data-buy="' + esc(c.offering) + '"' : "") +
        ' data-cta="sites-buy-' + esc(o.id) + "-" + esc(mode) + '">' + esc(c.label || "Start") + "</a>";

    var after = buyAfter(pr, c.after);
    if (after) out += '<p class="buy__after">' + esc(after) + "</p>";

    /* THE DISCLOSURE TRAVELS WITH THE TOGGLE.
       It used to be a section roughly six thousand pixels below the buy
       button, which is a disclosure nobody reads. Somebody flipping to
       Equity Uprise is the exact person who has to see it, at the exact
       moment they are considering it. */
    if (mode === "equity") {
      var eq = (L.modes || {}).equity || {};
      out += '<p class="buy__disclose">' + esc(eq.plain || "") +
        ' <a href="sites-details.html#equity">The full terms &rarr;</a></p>';
    }
    return out;
  }

  /* TWO KINDS OF TOGGLE, AND THEY MUST NOT LOOK ALIKE.

     M Mode and Equity Uprise are two PROGRAMMES with their own marks,
     their own terms and their own pages, so they get the marks. Monthly
     and yearly are two ways to pay for one service, so they get words —
     dressing a billing period in a brand mark would say the two things
     are the same kind of choice, and they are not. */
  function billButton(o, m, i) {
    var label = m === "year" ? "Pay the year" : "Monthly";
    return '<button type="button" role="tab" data-mode="' + esc(m) + '"' +
      ' id="btab-' + esc(o.id) + "-" + esc(m) + '"' +
      ' aria-selected="' + (i === 0 ? "true" : "false") + '"' +
      ' tabindex="' + (i === 0 ? "0" : "-1") + '"' +
      ' aria-controls="bpanel-' + esc(o.id) + '">' + esc(label) + "</button>";
  }

  /* WHAT THE CARD IS, BEFORE WHAT IT COSTS.
     The ledger already says where each offer sits in the journey and what
     it is for. Both were only readable on the details page, so every card
     opened on a name with no bearing. */
  function eyebrow(o) {
    var bits = [o.stage, o.identity].filter(Boolean);
    if (!bits.length) return "";
    return '<p class="buy__eyebrow">' + esc(bits.join(" \u00b7 ")) + "</p>";
  }

  /* THE SAME NUMBER OF LINES ON EVERY CARD.
     The ledger carries five to twelve inclusions per offer. Printing all
     of them made one card tower over its neighbour and left the other
     three looking thin, so every card shows the same five and says how
     many more there are. The count is read, never typed. */
  var INCLUDE_LINES = 5;

  function includesList(o) {
    var items = (Array.isArray(o.includes) ? o.includes : []).filter(Boolean);
    if (!items.length) return "";
    var shown = items.slice(0, INCLUDE_LINES);
    var rest = items.length - shown.length;
    return '<div class="buy__inc">' +
      '<p class="buy__inck">What you get</p>' +
      '<ul class="buy__list">' +
        shown.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") +
      "</ul>" +
      (rest > 0
        ? '<a class="buy__more" href="sites-details.html#' + esc(o.id) + '">' +
            "And " + rest + " more &rarr;</a>"
        : "") +
    "</div>";
  }

  function renderBuy(L, o) {
    var billing = o.billing_modes || null;
    var modes = (billing || o.modes || ["m"]).filter(function (m) { return (o.checkout || {})[m]; });
    var toggle = modes.length > 1
      ? '<div class="modes' + (billing ? " modes--words" : "") + '" role="tablist"' +
          ' aria-label="' + esc(o.name) + (billing ? " billing" : " payment mode") + '">' +
          modes.map(function (m, i) {
            return billing ? billButton(o, m, i) : modeButton(L, o, m, i, "btab", "bpanel");
          }).join("") +
        "</div>"
      : "";

    return '<article class="buy" data-offer="' + esc(o.id) + '">' +
      eyebrow(o) +
      "<h2>" + esc(o.name) + "</h2>" +
      '<p class="buy__one">' + esc(o.one_line || o.tagline || "") + "</p>" +
      toggle +
      '<div class="buy__body" id="bpanel-' + esc(o.id) + '"' +
        (modes.length > 1 ? ' role="tabpanel" aria-labelledby="btab-' + esc(o.id) + '-' + esc(modes[0]) + '"' : "") +
        ">" + buyBody(L, o, modes[0]) + "</div>" +
      includesList(o) +
    "</article>";
  }

  function paintLean(MOUNT, L) {
    /* An offer with no checkout block is a service the ledger sells and
       this page cannot take money for. It is not drawn here rather than
       drawn with a dead button. */
    var offers = listed(L).filter(function (o) { return o.checkout; });

    /* THE COUNT IS COUNTED, NOT TYPED.
       This line said "seven ways to buy them" in the markup, which was
       true until a way was added. Adding the yearly option made it eight
       the moment the ledger changed and the sentence did not. */
    var ways = offers.reduce(function (n, o) {
      return n + ((o.billing_modes || o.modes || ["m"])
        .filter(function (m) { return (o.checkout || {})[m]; }).length);
    }, 0);
    var word = ["", "one", "two", "three", "four", "five", "six", "seven",
                "eight", "nine", "ten", "eleven", "twelve"][offers.length] || offers.length;
    var waysWord = ["", "one", "two", "three", "four", "five", "six", "seven",
                    "eight", "nine", "ten", "eleven", "twelve"][ways] || ways;

    MOUNT.innerHTML =
      '<p class="buys__k">' + esc(word.charAt(0).toUpperCase() + word.slice(1)) +
        " offers &middot; " + esc(waysWord) + " ways to buy them</p>" +
      '<div class="buys__rule"></div>' +
      offers.map(function (o) { return renderBuy(L, o); }).join("");

    offers.forEach(function (o) {
      var art = MOUNT.querySelector('.buy[data-offer="' + o.id + '"]');
      if (!art) return;
      var panel = art.querySelector(".buy__body");
      var tabs = [].slice.call(art.querySelectorAll(".modes button"));

      /* THE BOX IS WIRED WHEREVER IT LANDS.
         buyBody() rebuilds this panel every time the toggle moves, so
         the listeners have to be attached after each paint and not once
         at load. A card with no toggle never repaints, and gets its one
         pass here. */
      var modes0 = (o.billing_modes || o.modes || ["m"])
        .filter(function (m) { return (o.checkout || {})[m]; });
      mountDomain(panel, L, o, modes0[0]);

      if (!tabs.length) return;

      /* M Mode is always the default. Equity Uprise is never preselected. */
      function select(btn) {
        tabs.forEach(function (b) {
          var on = b === btn;
          b.setAttribute("aria-selected", String(on));
          b.tabIndex = on ? 0 : -1;
        });
        panel.setAttribute("aria-labelledby", btn.id);
        panel.innerHTML = buyBody(L, o, btn.dataset.mode);
        mountDomain(panel, L, o, btn.dataset.mode);
        if (window.MCC_TRACK) window.MCC_TRACK("offer_mode_view", { offer: o.id, mode: btn.dataset.mode });
      }
      tabs.forEach(function (btn) {
        btn.addEventListener("click", function () { select(btn); });
        btn.addEventListener("keydown", function (e) {
          var i = tabs.indexOf(btn), next = null;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") next = tabs[(i + 1) % tabs.length];
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = tabs[(i + tabs.length - 1) % tabs.length];
          else if (e.key === "Home") next = tabs[0];
          else if (e.key === "End") next = tabs[tabs.length - 1];
          if (next) { e.preventDefault(); next.focus(); select(next); }
        });
      });
    });
  }

  /* The long version, on its own page. Every section the cards no longer
     carry, rendered by the same functions from the same ledger. Nothing
     was deleted; it stopped standing between somebody and the button. */
  function paintDetails(MOUNT, L) {
    MOUNT.innerHTML =
      renderDrafts(L) +
      renderActivation(L) +
      renderLicense(L) +
      '<div id="equity"></div>' +
      renderDisclose(L);
  }

  /* ============================================================
     THE SHARED API
     ============================================================ */
  var cache = null;
  function load() {
    if (cache) return cache;
    cache = fetch("data/offers.json" + (STAMP ? "?v=" + STAMP : ""))
      .then(function (r) { if (!r.ok) throw new Error("ledger " + r.status); return r.json(); })
      .then(derive);
    return cache;
  }

  /* ============================================================
     BUY NOW MEANS BUY NOW.

     Every primary action on the sales pages used to open a mail client.
     They go to checkout now, and the label carries the price -- but the
     price is not typed into the markup, because the moment it is, the
     ledger has a second opinion of itself living in three HTML files.
     Any [data-buy="<slug>"] gets its amount written in from the ledger
     on load. A slug the ledger cannot price keeps whatever the markup
     said, which is a working link with a wordless label, never a button
     advertising the wrong number.
     ============================================================ */
  function priceButtons(L) {
    var byOffering = {
      "domain-hosting-deposit": function () {
        var p = ((offerOf(L, "runway") || {}).pricing || {}).deposit;
        return p ? dollars(p.amount) : null;
      },
      "domain-hosting-start": function () {
        var p = ((offerOf(L, "runway") || {}).pricing || {}).start;
        return p ? dollars(p.total) : null;
      },
      "hosting-monthly": function () {
        var p = ((offerOf(L, "runway") || {}).pricing || {}).recurring;
        return p ? dollars(p.amount) + "/mo" : null;
      },
      "anti-social-m": function () {
        var pr = priceOf(L, "anti-social", "m");
        return pr && pr.approved ? pr.display + "/mo" : null;
      }
    };
    /* NOT the buy cards. A card already prints its price four times the
       size of anything else in it, and stamping it onto the button too is
       the exact fault this page was rebuilt to remove: one product, two
       numbers. This is for the buttons on other pages, which have no
       price near them and need one. */
    [].forEach.call(document.querySelectorAll("[data-buy]:not(.buy__go)"), function (el) {
      var f = byOffering[el.getAttribute("data-buy")];
      var amount = f && f();
      if (!amount) return;
      el.innerHTML = esc(el.textContent.trim()) +
        ' <span class="btn__price">' + esc(amount) + "</span>";
    });
  }

  window.MCC_OFFERS = {
    load: load, derive: derive, money: money, dollars: dollars,
    priced: priced, publicNote: publicNote,
    offerOf: offerOf, priceOf: priceOf, configOf: configOf,
    listed: listed, renderActivation: renderActivation, renderDrafts: renderDrafts,
    priceButtons: priceButtons, modeButton: modeButton, renderLicense: renderLicense
  };

  /* ---------- paint the ladder where a page asks for it ---------- */
  /* The ladder mounts only where a page asks for it, but the buy buttons
     are on pages that have no ladder at all -- so bailing on a missing
     #offerLadder used to mean hire.html's checkout buttons never got their
     price. Load whenever there is either thing to do. */
  /* The id is the instruction. #offerBuy is the four cards and nothing
     else; #offerDetails is everything the cards no longer carry. */
  var MOUNT = document.getElementById("offerBuy")
           || document.getElementById("offerDetails");
  var BUYS = document.querySelector("[data-buy]");
  if (!MOUNT && !BUYS) return;

  load().then(function (L) {
    if (MOUNT) {
      if (MOUNT.id === "offerDetails") paintDetails(MOUNT, L);
      else paintLean(MOUNT, L);
    }
    priceButtons(L);
  }).catch(function (e) {
    if (window.console) console.error("offers:", e && (e.stack || e.message || e));
    if (!MOUNT) return;
    MOUNT.innerHTML = '<p class="receipt__note">The offers are a moment away. ' +
      '<a href="onboard.html">Start onboarding</a> or <a href="hire.html">see every service</a>.</p>';
  });
})();
