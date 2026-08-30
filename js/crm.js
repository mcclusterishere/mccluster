/* ============================================================
   THE FRONT DESK, street side. No lead ever slips.
   - First-touch attribution: utm_* / gclid on ANY landing gets
     remembered on the device, so a Google Ads click three pages
     ago still shows up on the lead it becomes.
   - THE SHEET: name, email, what you need. Twenty seconds and
     it's on the owner's desk. Any [data-lead-sheet] opens it.
   ============================================================ */
(function () {
  "use strict";
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";

  /* ---------- first touch: remember how they found the house ---------- */
  var A_KEY = "mcc_attrib";
  try {
    var q = new URLSearchParams(location.search);
    var src = q.get("utm_source") || (q.get("gclid") ? "google-ads" : null);
    if (src && !localStorage.getItem(A_KEY)) {
      localStorage.setItem(A_KEY, JSON.stringify({
        source: src, medium: q.get("utm_medium"), campaign: q.get("utm_campaign"),
        gclid: q.get("gclid"), landing: location.pathname.split("/").pop() || "index.html",
        at: new Date().toISOString(),
      }));
      if (window.MCC_TRACK) window.MCC_TRACK("ad_visit", { source: src, campaign: q.get("utm_campaign") || "" });
    }
  } catch (e) {}
  function attrib() { try { return JSON.parse(localStorage.getItem(A_KEY)) || {}; } catch (e) { return {}; } }

  function send(lead) {
    var a = attrib();
    return fetch(SB_URL + "/rest/v1/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, Prefer: "return=minimal" },
      body: JSON.stringify({
        name: lead.name, email: lead.email, want: lead.want || "", note: lead.note || "",
        page: location.pathname.split("/").pop() || "index.html",
        source: lead.source || a.source || "direct", medium: a.medium || null,
        campaign: lead.campaign || a.campaign || null, gclid: a.gclid || null,
      }),
    }).then(function (r) { if (!r.ok) throw new Error("lead " + r.status); });
  }

  /* ---------- THE SHEET ---------- */
  var WANTS = ["Video / brand film", "Photography", "Web design", "Media management / consulting", "Music / scoring", "Something else"];
  var el = null;
  function close() { if (el && el.parentNode) el.parentNode.removeChild(el); el = null; }
  function open(want) {
    close();
    el = document.createElement("div");
    el.className = "leadsheet";
    el.innerHTML =
      '<div class="leadsheet__card" role="dialog" aria-label="Lock in">' +
      "<b>Lock in.</b>" +
      "<small>Tell me what you need. It lands on my desk the second you send it.</small>" +
      '<input name="name" placeholder="Your name" autocomplete="name" maxlength="80">' +
      '<input name="email" type="email" placeholder="Email" autocomplete="email" maxlength="120">' +
      '<select name="want"><option value="">What do you need?</option>' +
      WANTS.map(function (w) { return "<option" + (w === want ? " selected" : "") + ">" + w + "</option>"; }).join("") +
      "</select>" +
      '<textarea name="note" rows="3" maxlength="1200" placeholder="The project, the date, the budget, whatever you have"></textarea>' +
      '<button class="leadsheet__go" type="button">Send it &#8594;</button>' +
      '<button class="leadsheet__no" type="button">Not yet</button>' +
      '<p class="leadsheet__err" hidden>That didn’t go through. Check the email and try again, or just email matthew@mccluster.org.</p>' +
      "</div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el || (e.target.closest && e.target.closest(".leadsheet__no"))) { close(); return; }
      if (!(e.target.closest && e.target.closest(".leadsheet__go"))) return;
      var f = function (n) { var i = el.querySelector('[name="' + n + '"]'); return i ? i.value.trim() : ""; };
      var lead = { name: f("name"), email: f("email"), want: f("want"), note: f("note") };
      var err = el.querySelector(".leadsheet__err");
      if (!lead.name || !/.+@.+\..+/.test(lead.email)) { err.hidden = false; return; }
      var go = el.querySelector(".leadsheet__go");
      go.disabled = true; go.textContent = "Sending…";
      send(lead).then(function () {
        if (window.MCC_TRACK) window.MCC_TRACK("lead_submit", { want: lead.want, source: attrib().source || "direct" });
        el.querySelector(".leadsheet__card").innerHTML =
          "<b>On the desk.</b>" +
          "<small>Got it, I reply fast. Want the date locked today? Book the call now and the deposit applies to your project.</small>" +
          '<a class="leadsheet__go" href="mailto:matthew@mccluster.org?subject=' +
          encodeURIComponent("Book a call from " + lead.name) + '">Book a call &#8594;</a>' +
          '<button class="leadsheet__no" type="button">Done</button>';
      }).catch(function () {
        go.disabled = false; go.textContent = "Send it →"; err.hidden = false;
      });
    });
    var first = el.querySelector('[name="name"]');
    if (first) first.focus();
  }

  /* ---------- SITES: THE TWO DOORS ----------
     The deal switch already owns the behavior. This gives each side its
     canonical house mark without redrawing either emblem: M for standard
     service, E=up for the Equity Uprise program lane. The guard keeps this
     code inert on every other room that loads the front desk. */
  function brandSitesDealModes() {
    var wrap = document.getElementById("dealWrap");
    if (!wrap) return;
    var modes = {
      paid: {
        src: "assets/img/m-mark.png",
        label: "M / Paid",
        sub: "Standard studio service · keep 100% of revenue",
        aria: "M emblem, activate standard paid mode"
      },
      equity: {
        src: "assets/img/eu-favicon.png",
        label: "Equity Uprise",
        sub: "McCluster Corp program · lower cash + revenue share",
        aria: "Equity Uprise E equals up emblem, activate Equity Uprise mode"
      }
    };

    Object.keys(modes).forEach(function (slug) {
      var btn = wrap.querySelector('button[data-mode="' + slug + '"]');
      if (!btn || btn.querySelector(".dealpick__emblem")) return;
      var cfg = modes[slug];
      var mark = document.createElement("img");
      mark.className = "dealpick__emblem";
      mark.src = cfg.src;
      mark.alt = "";
      mark.setAttribute("aria-hidden", "true");
      mark.style.cssText = "display:block;width:clamp(3.2rem,8vw,4.6rem);height:clamp(3.2rem,8vw,4.6rem);object-fit:contain;margin:0 auto .55rem;pointer-events:none";
      btn.insertBefore(mark, btn.firstChild);
      btn.style.textAlign = "center";
      btn.style.display = "grid";
      btn.style.justifyItems = "center";
      btn.style.alignContent = "center";
      btn.style.minHeight = "8.4rem";
      btn.setAttribute("aria-label", cfg.aria);
      var title = btn.querySelector("b");
      var small = btn.querySelector("small");
      if (title) title.textContent = cfg.label;
      if (small) small.textContent = cfg.sub;
    });

    function syncProgramNote() {
      var note = document.getElementById("dealNote");
      if (!note) return;
      var equity = document.body.getAttribute("data-deal-mode") === "equity";
      note.innerHTML = equity
        ? "<b>Equity Uprise:</b> McCluster Corp's business/workforce-development program lane. No stock or ownership changes hands. The domain stays separate, and program participation requires approval plus a signed revenue-share agreement."
        : "<b>M / Paid:</b> the standard studio service. Pay the published monthly rate and keep 100% of business revenue. The domain stays separate.";
    }

    syncProgramNote();
    wrap.addEventListener("click", function (e) {
      if (!e.target.closest || !e.target.closest("button[data-mode]")) return;
      setTimeout(syncProgramNote, 0);
    });
  }

  window.MCC_CRM = { open: open, attrib: attrib, send: send };
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lead-sheet]");
    if (b) { e.preventDefault(); open(b.getAttribute("data-lead-sheet") || ""); }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", brandSitesDealModes);
  else brandSitesDealModes();
})();
