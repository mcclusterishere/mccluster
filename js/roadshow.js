/* ============================================================
   THE ROADSHOW — book him anywhere on Earth, travel priced in.

   The section on the hire page takes a destination and a date,
   itemizes what the quote WILL contain (ride to the airport, the
   live flight, ride to the venue, the Hilton-family room, and the
   whole thing in reverse; local bookings skip the sky), stores the
   destination, and rides it into the booking lead — so no request
   is ever lost. The itemized number comes with the reply.

   There is no quote backend. A loose Worker once sketched one
   (/api/travel/quote) but was never deployed, and the fetch to it
   only ever 404'd; both are gone. Honesty law: estimates say
   estimate, and nothing pretends to be live.
   ============================================================ */
(function () {
  "use strict";
  var KEY = "mccJobLoc";
  var KEY_WHEN = "mccJobWhen";

  var host = document.getElementById("roadshow");
  if (!host) return;

  var out = host.querySelector(".roadshow__out");
  var input = host.querySelector('[name="dest"]');
  var dateEl = host.querySelector('[name="when"]');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function remember(dest) {
    try { localStorage.setItem(KEY, dest);
      if (dateEl && dateEl.value) localStorage.setItem(KEY_WHEN, dateEl.value); } catch (e) {}
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
    paintPending(dest);
  });

  window.MCC_ROADSHOW = {
    line: function () {
      try { var l = localStorage.getItem(KEY); return l ? "Job location: " + l : ""; }
      catch (e) { return ""; }
    },
  };
})();
