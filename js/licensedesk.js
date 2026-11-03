/* ============================================================
   THE DESK, BROUGHT TO THE RECORD.

   Licensing used to be a separate address: you were watching the
   lyric film, you wanted the song, and the site sent you to another
   page to ask for it. The desk now opens where you already are.

   Anything marked data-license="<track-slug>" opens this drawer in
   place — pre-picked to that record, same fields, same destination
   as license.html, which stays put for direct links and search.

   It builds itself on first open, so a page that never asks pays
   nothing for it.
   ============================================================ */
(function () {
  "use strict";

  var TRACKS = [
    ["who-did-the-shoot", "Who Did The Shoot"],
    ["runway-walk", "Runway Walk"],
    ["write-a-song", "Write a Song"],
    ["here", "Here"],
    ["antisocial", "Antisocial"],
    ["lightroom", "Lightroom"],
    ["other", "Something else in the catalog"],
  ];
  var MEDIA = ["Film / TV", "Advertising", "Branded content", "Social / online",
    "Civic or nonprofit campaign", "Broadcast", "Game", "Other"];

  var el = null, built = false;

  function field(label, inner) {
    return '<label class="lcd__l">' + label + "</label>" + inner;
  }

  function build() {
    if (built) return;
    built = true;
    el = document.createElement("div");
    el.className = "lcd";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "License this track");
    el.innerHTML =
      '<div class="lcd__scrim" data-lcd-x></div>' +
      '<div class="lcd__card">' +
        '<button class="lcd__x" type="button" data-lcd-x aria-label="Close">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" ' +
          'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        "</button>" +
        '<p class="lcd__k">The licensing desk</p>' +
        '<h2 class="lcd__h" id="lcdHead">License this track</h2>' +
        '<p class="lcd__sub">Sync, film &amp; TV, commercial, civic campaigns, branded content, ' +
          "broadcast. Tell the desk what you're making — you hear back fast, with a real quote. " +
          "Instrumentals and clean versions available.</p>" +
        '<div class="lcd__form" id="lcdForm">' +
          field("Your name", '<input id="lcdName" autocomplete="name" maxlength="80" placeholder="Requester name">') +
          field("Organization", '<input id="lcdOrg" autocomplete="organization" maxlength="120" placeholder="Company, agency, production, campaign">') +
          field("Email", '<input id="lcdEmail" type="email" autocomplete="email" maxlength="120" placeholder="Where the quote lands">') +
          field("Track", '<select id="lcdTrack">' + TRACKS.map(function (t) {
            return '<option value="' + t[0] + '">' + t[1] + "</option>"; }).join("") + "</select>") +
          field("Intended use", '<textarea id="lcdUse" maxlength="1500" rows="3" placeholder="What are you making, and where does the music sit in it?"></textarea>') +
          '<div class="lcd__grid">' +
            field("Media", '<select id="lcdMedia">' + MEDIA.map(function (m) {
              return '<option>' + m + "</option>"; }).join("") + "</select>") +
            field("Territory", '<input id="lcdTerritory" maxlength="80" placeholder="US, worldwide…">') +
            field("Term", '<input id="lcdTerm" maxlength="80" placeholder="1 year, perpetuity…">') +
            field("Budget", '<input id="lcdBudget" maxlength="60" placeholder="Range is fine">') +
          "</div>" +
          '<div class="lcd__checks">' +
            '<label><input type="checkbox" id="lcdInstr"> Need the instrumental</label>' +
            '<label><input type="checkbox" id="lcdClean"> Need a clean version</label>' +
          "</div>" +
          '<button class="lcd__go" type="button" id="lcdGo">Send it to the desk</button>' +
          '<p class="lcd__err" id="lcdErr" hidden></p>' +
        "</div>" +
        '<div class="lcd__done" id="lcdDone" hidden>' +
          "<b>It's on the desk.</b>" +
          "<small>Your request is in. The quote comes back to your email, usually same day — " +
          "and the record never stopped playing.</small>" +
        "</div>" +
      "</div>";
    document.body.appendChild(el);

    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-lcd-x]")) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && el.classList.contains("on")) close();
    });
    document.getElementById("lcdGo").addEventListener("click", send);
  }

  function v(id) { var n = document.getElementById(id); return ((n && n.value) || "").trim(); }

  function send() {
    var btn = document.getElementById("lcdGo");
    var err = document.getElementById("lcdErr");
    if (!v("lcdName") || !/.+@.+\..+/.test(v("lcdEmail"))) {
      err.textContent = "Name and a real email. The quote has to land somewhere.";
      err.hidden = false; return;
    }
    if (!v("lcdUse")) {
      err.textContent = "Say what you're making, even in one line.";
      err.hidden = false; return;
    }
    err.hidden = true;
    btn.disabled = true; btn.textContent = "Sending…";

    var note = "LICENSE REQUEST · track: " + v("lcdTrack") +
      " · org: " + (v("lcdOrg") || "n/a") +
      " · media: " + (v("lcdMedia") || "n/a") +
      " · territory: " + (v("lcdTerritory") || "n/a") +
      " · term: " + (v("lcdTerm") || "n/a") +
      " · budget: " + (v("lcdBudget") || "n/a") +
      (document.getElementById("lcdInstr").checked ? " · INSTRUMENTAL" : "") +
      (document.getElementById("lcdClean").checked ? " · CLEAN VERSION" : "") +
      " · use: " + v("lcdUse");

    var done = function () {
      if (window.MCC_TRACK) window.MCC_TRACK("license_request", { track: v("lcdTrack"), media: v("lcdMedia") });
      if (window.MCC_SIGNALS) window.MCC_SIGNALS.log("license_request", v("lcdTrack"), 5);
      document.getElementById("lcdForm").hidden = true;
      document.getElementById("lcdDone").hidden = false;
    };
    var failed = function () {
      btn.disabled = false; btn.textContent = "Send it to the desk";
      /* the desk is never a dead end: hand them the mailbox */
      err.innerHTML = 'That didn\'t go through. Send it straight to ' +
        '<a href="mailto:matthew@mccluster.org?subject=License%20request">matthew@mccluster.org</a>.';
      err.hidden = false;
    };

    if (window.MCC_CRM && window.MCC_CRM.send) {
      window.MCC_CRM.send({
        name: v("lcdName"), email: v("lcdEmail"), want: "Music / scoring",
        note: note, campaign: "here-licensing",
      }).then(done).catch(failed);
    } else { failed(); }
  }

  function open(slug, title) {
    build();
    var sel = document.getElementById("lcdTrack");
    if (slug && sel.querySelector('[value="' + slug + '"]')) sel.value = slug;
    document.getElementById("lcdHead").textContent =
      title ? "License “" + title + "”" : "License this track";
    el.classList.add("on");
    document.documentElement.style.overflow = "hidden";
    if (window.MCC_TRACK) window.MCC_TRACK("license_view", { track: slug || "" });
  }
  function close() {
    if (!el) return;
    el.classList.remove("on");
    document.documentElement.style.overflow = "";
  }

  /* any door on any page, without that page knowing how the desk works */
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-license]");
    if (!t) return;
    e.preventDefault();
    open(t.getAttribute("data-license"), t.getAttribute("data-license-title"));
  });

  window.MCC_LICENSE = { open: open, close: close };
})();
