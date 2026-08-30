/* ============================================================
   Lead capture: the on-page form that replaces mailto friction.
   Inert until window.INTAKE_ENDPOINT (js/analytics.js) is set:
   with no endpoint, every [data-lead] button keeps its normal
   mailto href, so nothing breaks while the backend isn't live.

   With an endpoint: tapping a [data-lead] button opens a three
   field form (name, email, what you need) that POSTs one JSON
   row to the Apps Script -> Sheet. No cookies, no third party,
   just the message the visitor chose to send.
   ============================================================ */
(function () {
  "use strict";

  var endpoint = window.INTAKE_ENDPOINT;
  if (!endpoint) return; // mailto fallback stays in charge

  var btns = document.querySelectorAll("[data-lead]");
  if (!btns.length) return;

  function track(n, p) { if (window.MCC_TRACK) window.MCC_TRACK(n, p); }

  var overlay = document.createElement("div");
  overlay.className = "leadov";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML =
    '<div class="leadov__box">' +
      '<button class="leadov__x" type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:1em;height:1em;vertical-align:-2px"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '<p class="leadov__kicker">Tell me what you need</p>' +
      '<h3 class="leadov__h">Let’s lock it in</h3>' +
      '<form class="leadov__form" novalidate>' +
        // the honeypot: humans never see it, bots can't resist filling it
        '<input name="company" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" ' +
          'style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">' +
        '<input class="leadov__in" name="name" type="text" placeholder="Your name" autocomplete="name" required>' +
        '<input class="leadov__in" name="email" type="email" placeholder="Email" autocomplete="email" required>' +
        '<textarea class="leadov__in leadov__ta" name="message" rows="4" placeholder="What are we building? Shoot, site, campaign, dates…" required></textarea>' +
        '<button class="btn btn--ruby leadov__go" type="submit">Send it</button>' +
        '<p class="leadov__note">Goes straight to Matthew. No lists, no spam.</p>' +
      '</form>' +
      '<div class="leadov__done" hidden>' +
        '<h3 class="leadov__h">Locked in.</h3>' +
        '<p class="leadov__note">Your message is in. You’ll hear back within a day.</p>' +
      '</div>' +
    "</div>";
  document.body.appendChild(overlay);

  var form = overlay.querySelector(".leadov__form");
  var done = overlay.querySelector(".leadov__done");
  var source = "";

  function open(label) {
    source = label || "";
    form.hidden = false; done.hidden = true;
    overlay.classList.add("is-open");
    document.documentElement.classList.add("psy-locked");
    track("lead_form_open", { label: source });
  }
  function close() {
    overlay.classList.remove("is-open");
    document.documentElement.classList.remove("psy-locked");
  }
  overlay.querySelector(".leadov__x").addEventListener("click", close);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  btns.forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.preventDefault();
      open(b.getAttribute("data-cta") || b.getAttribute("data-lead") || "lead");
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = new FormData(form);
    var row = {
      name: String(f.get("name") || "").trim(),
      email: String(f.get("email") || "").trim(),
      message: String(f.get("message") || "").trim(),
      page: location.pathname + " · " + source,
    };
    if (!row.name || !row.email || !row.message) return;
    // a filled honeypot means a bot: pretend success, send nothing
    if (String(f.get("company") || "").trim()) { form.hidden = true; done.hidden = false; return; }
    var body = JSON.stringify(row);
    // no-cors: Apps Script accepts the POST but the response is opaque; that's fine
    fetch(endpoint, { method: "POST", mode: "no-cors", body: body, keepalive: true }).catch(function () {
      if (navigator.sendBeacon) navigator.sendBeacon(endpoint, body);
    });
    form.hidden = true; done.hidden = false;
    track("lead_submitted", { label: source }); // metadata only, never the message
  });
})();
