/* ============================================================
   THE ROADSHOW — book him anywhere on Earth, travel priced in.

   The section on the hire page takes a destination and a date
   and asks the Worker (/api/travel/quote) for the real numbers:
   ride to the airport, live flight, ride to the venue, the
   Hilton-family room, and the whole thing in reverse — origin
   decided by whichever home base Matthew last logged in at
   (Connecticut or Georgia; the Worker holds the flag). Local
   bookings skip the sky and bill the ride to the venue and
   back.

   Until the Worker is deployed (see workers/travel-quote.js +
   docs/BIG-LEAGUE.md), the section still works as a door: it
   itemizes what the quote WILL contain, stores the destination,
   and rides it into the booking lead — so no request is ever
   lost to a missing backend. Honesty law: live numbers say
   live, estimates say estimate, and nothing pretends.
   ============================================================ */
(function () {
  "use strict";
  var API = window.MCC_TRAVEL_API || "/api/travel/quote";
  var REQ_API = window.MCC_TRAVEL_REQ_API || "/api/travel/request";
  var KEY = "mccJobLoc";
  var KEY_WHEN = "mccJobWhen";

  var host = document.getElementById("roadshow");
  if (!host) return;

  var out = host.querySelector(".roadshow__out");
  var input = host.querySelector('[name="dest"]');
  var dateEl = host.querySelector('[name="when"]');

  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function remember(dest) {
    try { localStorage.setItem(KEY, dest);
      if (dateEl && dateEl.value) localStorage.setItem(KEY_WHEN, dateEl.value); } catch (e) {}
  }

  function rows(legs, hotel) {
    var h = "";
    legs.forEach(function (l) {
      h += "<li>" + esc(l.what) + "<b>" + (l.usd == null ? "at booking" : money(l.usd)) + "</b></li>";
    });
    if (hotel) h += "<li>" + esc(hotel.what) + "<b>" + (hotel.usd == null ? "at booking" : money(hotel.usd)) + "</b></li>";
    return h;
  }

  function paintQuote(q) {
    out.innerHTML =
      '<p class="roadshow__k">The trip, itemized &middot; from the ' + esc(q.base.label) + " base</p>"
      + "<ul>" + rows(q.legs, q.hotel) + "</ul>"
      + '<p class="roadshow__total">Travel rides on the invoice at <b>'
      + (q.totals.travel ? money(q.totals.travel) : "cost") + "</b>"
      + (q.mode === "fly" ? " &middot; plus the service you book below" : " &middot; local: just the ride and the work") + "</p>"
      + '<p class="roadshow__note">' + esc(q.totals.note) + "</p>";
    out.hidden = false;
  }

  function paintPending(dest) {
    out.innerHTML =
      '<p class="roadshow__k">The trip, itemized &middot; what your quote includes</p>'
      + "<ul>"
      + "<li>Ride, home base to the airport<b>estimated</b></li>"
      + "<li>Flight out &middot; live price<b>quoted</b></li>"
      + "<li>Ride, airport to your venue<b>estimated</b></li>"
      + "<li>Hilton-family room &middot; never a motel<b>quoted</b></li>"
      + "<li>The same road home, in reverse<b>estimated</b></li>"
      + "</ul>"
      + '<p class="roadshow__total">Book the call and the itemized number for <b>' + esc(dest)
      + "</b> comes with the reply &mdash; within 24 hours, weekdays.</p>"
      + '<p class="roadshow__note">Travel bills at cost, itemized on the invoice. Local to the active base: just the ride to the venue and back.</p>';
    out.hidden = false;
  }

  host.addEventListener("submit", function (e) {
    e.preventDefault();
    var dest = (input.value || "").trim();
    if (!dest) { input.focus(); return; }
    remember(dest);
    if (window.MCC_TRACK) window.MCC_TRACK("roadshow_quote", { dest: dest });
    out.hidden = false;
    out.innerHTML = '<p class="roadshow__k">Pricing the road&hellip;</p>';
    fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: dest, date: dateEl.value || undefined }),
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(paintQuote)
      .catch(function () { paintPending(dest); });
  });

  window.MCC_ROADSHOW = {
    line: function () {
      try { var l = localStorage.getItem(KEY); return l ? "Job location: " + l : ""; }
      catch (e) { return ""; }
    },
    /* the gate calls this after a lead lands: the trip request files
       itself on the desk, quote snapshot and all. Fire-and-forget —
       a missing backend can never break a booking. */
    request: function (lead) {
      var dest, when;
      try { dest = localStorage.getItem(KEY); when = localStorage.getItem(KEY_WHEN); } catch (e) {}
      if (!dest) return;
      try {
        fetch(REQ_API, { method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ destination: dest, date: when || undefined,
            name: (lead && lead.name) || "", email: (lead && lead.email) || "" }),
        }).catch(function () {});
      } catch (e) {}
    },
  };
})();
