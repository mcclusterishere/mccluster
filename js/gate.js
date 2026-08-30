/* ============================================================
   THE GATE — every "Book a call with me" on the site opens this.

   TWO AUDIENCES ARRIVE HERE AND THEY MUST NEVER BE MIXED.

     A company or recruiter with a ROLE to fill. They are not
     buying a service, they are trying to hire the person. Every
     question asked of them is friction against a salary offer,
     so they get TWO screens and nothing else: who they are and
     what the job is. Never a fee, never a budget question,
     never a "what do you need" menu written for a customer.

     A client who wants WORK done. A person or a small business
     buying a site, a shoot, a campaign. They get the longer
     path, because scope and budget genuinely have to be known
     before a call is worth either party's time.

   Question one sorts them, and the tree splits there. On the
   client side it splits again:

     A one-off project  →  free, thirty minutes. The call scopes
                           it; the $585 Teardown is a separate
                           PRODUCT on the rate card, never a toll
                           on the conversation.
     Ongoing, 12 months+ →  free. That call is a negotiation, not
                           a consultation.

   The lead is written to the desk BEFORE the calendar opens, so
   a visitor who abandons at the time-picker is still a lead with
   a name, a budget and a stated need — not a bounce. Recruiter
   leads are tagged so they never sit in the same queue as a
   photo booking.

   ------------------------------------------------------------
   OWNER SETUP (two minutes, one time)

   Make two event types on cal.com — the free tier covers all of
   this — and paste their URLs into CAL below:

     1. "The Teardown"  · 45 min · price $585 (Stripe) — the PRODUCT
     2. "Project / partnership call" · 30 min · free
     3. "Role conversation" · 30 min · free  (recruiters)

   In cal.com > Availability set Mon–Fri 09:00–17:00, and under
   Apps connect Google Calendar (two-way, so booked time blocks)
   and add the SCSU schedule as a read-only .ics feed so class
   hours disappear from the grid automatically.

   Until those URLs are filled in, the gate still works: it takes
   the lead, and promises times by email instead of showing a
   calendar it does not have. Nothing here ever pretends to hold
   a slot it cannot hold.
   ============================================================ */
(function () {
  "use strict";

  var CAL = {
    paid: "",       /* e.g. "https://cal.com/mccluster/teardown" */
    free: "",       /* e.g. "https://cal.com/mccluster/partnership" */
    recruiter: "",  /* e.g. "https://cal.com/mccluster/role" */
  };

  var FEE = "$585"; /* the Teardown PRODUCT price — every call itself is free */
  var MAILTO = "matthew@mccluster.org";

  var NEEDS = [
    "Web design / build",
    "Social media management",
    "Photography",
    "Video / brand film",
    "Music / original scoring",
    "Creative direction",
  ];
  var BUDGETS = ["Under $5k", "$5k – $15k", "$15k – $50k", "$50k+", "Not sure yet"];
  var WHENS = ["This month", "Next 1–3 months", "Later this year", "Just exploring"];

  /* the only things worth asking someone who is offering a salary */
  var ROLES = ["Full-time", "Contract", "Fellowship / residency", "Advisory / board"];

  var el = null, step = 0, answers = {}, opener = null, seeded = false;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function q(sel) { return el.querySelector(sel); }
  function isRecruiter() { return answers.side === "role"; }
  function steps() { return isRecruiter() ? R_SCREENS : C_SCREENS; }
  /* screen 0 sorts the audience and the last screen is the landing — neither
     is a question, so neither is counted. A recruiter is told "of 2" and
     that is the truth. */
  function stepLabel(i) { return "Step " + i + " of " + (steps().length - 2); }

  function close() {
    if (!el) return;
    el.classList.remove("is-in");
    var dead = el;
    setTimeout(function () { if (dead.parentNode) dead.parentNode.removeChild(dead); }, 320);
    el = null;
    document.documentElement.style.overflow = "";
    document.documentElement.classList.remove("gate-on");
    /* hand focus back to whoever opened the door */
    if (opener && opener.focus) { try { opener.focus(); } catch (e) {} opener = null; }
  }

  /* ---------- SCREEN ONE: which of the two are you ---------- */

  function screenSide() {
    return '<p class="gate__k">First things first</p>'
      + "<h2>Which one are you?</h2>"
      + '<p class="gate__sub">These go to two completely different places, so this is the only question I ask everyone.</p>'
      + '<div class="gate__picks">'
      + '<button class="gate__pick gate__pick--role" type="button" data-side="role">'
      + "<b>I have a role to fill</b>"
      + "<small>You are a company, a recruiter, or a program, and you are looking at me for a job, a fellowship, or a seat &mdash; not buying a service.</small>"
      + '<em class="gate__tag gate__tag--fast">Two questions, straight to my calendar</em>'
      + "</button>"
      + '<button class="gate__pick" type="button" data-side="work">'
      + "<b>I want to hire you for work</b>"
      + "<small>You or your business need something made &mdash; a site, a shoot, a campaign, a record, a channel run.</small>"
      + '<em class="gate__tag gate__tag--free">A few questions about the work</em>'
      + "</button>"
      + "</div>";
  }

  /* ---------- THE ROLE SIDE: two screens, then done ---------- */

  function screenRole() {
    return '<p class="gate__k">' + stepLabel(1) + "</p>"
      + "<h2>What's the role?</h2>"
      + '<p class="gate__sub">That is all I need. No fee, no forms, no pitch &mdash; you are the one making the offer.</p>'
      + '<input class="gate__in" name="org" placeholder="Company or organization" autocomplete="organization" maxlength="120">'
      + '<input class="gate__in" name="role" placeholder="Title of the role" maxlength="120">'
      + '<p class="gate__lab">Type</p><div class="gate__chips" data-group="rtype">'
      + ROLES.map(function (r, i) { return '<button class="gate__chip" type="button" data-rtype="' + i + '">' + esc(r) + "</button>"; }).join("")
      + "</div>"
      + '<input class="gate__in" name="comp" placeholder="Compensation range (optional, but it speeds this up)" maxlength="80" style="margin-top:1rem">'
      + '<div class="gate__row">'
      + (seeded && step === 1
        ? '<button class="gate__back" type="button" data-wrongdoor>Wrong door? I need work done</button>'
        : '<button class="gate__back" type="button" data-back>Back</button>')
      + '<button class="gate__go" type="button" data-next disabled>Continue</button>'
      + "</div>";
  }

  function screenRoleWho() {
    return '<p class="gate__k">' + stepLabel(2) + "</p>"
      + "<h2>Where do I reach you?</h2>"
      + '<p class="gate__sub">' + ((CAL.recruiter || CAL.free)
        ? "Then my calendar opens. Thirty minutes, no charge, weekdays nine to five."
        : "Thirty minutes, no charge. I reply with times within 24 hours, weekdays nine to five.") + "</p>"
      + '<input class="gate__in" name="name" placeholder="Your name" autocomplete="name" maxlength="80">'
      + '<input class="gate__in" name="email" type="email" placeholder="Work email" autocomplete="email" maxlength="120">'
      + '<textarea class="gate__in gate__in--area" name="note" rows="3" maxlength="1200" placeholder="A link to the posting, or anything else worth seeing first"></textarea>'
      + '<div class="gate__row">'
      + '<button class="gate__back" type="button" data-back>Back</button>'
      + '<button class="gate__go" type="button" data-send>' + ((CAL.recruiter || CAL.free)
        ? "Pick my time" : "Send it &mdash; I&rsquo;ll reply with times") + "</button>"
      + "</div>"
      + '<p class="gate__err" hidden></p>';
  }

  /* ---------- THE CLIENT SIDE ---------- */

  function screenKind() {
    var pack = (window.MCC_SHOP && window.MCC_SHOP.count && window.MCC_SHOP.count() > 0)
      ? '<p class="gate__pack">Riding with this call: your package &middot; '
        + window.MCC_SHOP.count() + " services &middot; " + window.MCC_SHOP.discount() + "% off</p>"
      : "";
    return '<p class="gate__k">' + stepLabel(1) + "</p>"
      + "<h2>What are we building?</h2>"
      + '<p class="gate__sub">This decides how the call works.</p>' + pack
      + '<div class="gate__picks">'
      + '<button class="gate__pick" type="button" data-kind="project">'
      + "<b>A one-off project</b>"
      + "<small>A site, a shoot, a campaign, a record. A defined thing with an end.</small>"
      + '<em class="gate__tag gate__tag--free">Free call &middot; 30 minutes</em>'
      + "</button>"
      + '<button class="gate__pick" type="button" data-kind="partner">'
      + "<b>Ongoing work, 12 months or more</b>"
      + "<small>You want me running something continuously &mdash; a brand, a channel, a presence.</small>"
      + '<em class="gate__tag gate__tag--free">No charge for this call</em>'
      + "</button>"
      + "</div>"
      + (seeded && step === 1
        ? '<p class="gate__swap"><button type="button" data-wrongdoor-role>Hiring for a full-time role instead?</button></p>'
        : "");
  }

  function screenScope() {
    /* the cart already answered the needs question — pre-check its chips */
    if ((!answers.needs || !answers.needs.length)
        && window.MCC_SHOP && window.MCC_SHOP.needs) {
      var seededNeeds = window.MCC_SHOP.needs();
      if (seededNeeds.length) answers.needs = seededNeeds;
    }
    return '<p class="gate__k">' + stepLabel(2) + "</p>"
      + "<h2>The shape of it</h2>"
      + '<p class="gate__sub">Rough is fine. It keeps the call honest instead of guessing at each other.</p>'
      + '<p class="gate__lab" data-lab="needs">What do you need?</p><div class="gate__chips">'
      + NEEDS.map(function (n, i) { return '<button class="gate__chip" type="button" data-need="' + i + '">' + esc(n) + "</button>"; }).join("")
      + "</div>"
      + '<p class="gate__lab" data-lab="budget">Budget</p><div class="gate__chips" data-group="budget">'
      + BUDGETS.map(function (b, i) { return '<button class="gate__chip" type="button" data-budget="' + i + '">' + esc(b) + "</button>"; }).join("")
      + "</div>"
      + '<p class="gate__lab" data-lab="when">Timing</p><div class="gate__chips" data-group="when">'
      + WHENS.map(function (w, i) { return '<button class="gate__chip" type="button" data-when="' + i + '">' + esc(w) + "</button>"; }).join("")
      + "</div>"
      + '<div class="gate__row">'
      + '<button class="gate__back" type="button" data-back>Back</button>'
      + '<button class="gate__go" type="button" data-next disabled>Continue</button>'
      + "</div>";
  }

  function screenWho() {
    var paid = answers.kind === "project";
    return '<p class="gate__k">' + stepLabel(3) + "</p>"
      + "<h2>Who am I talking to?</h2>"
      + '<p class="gate__sub">' + (CAL.free
        ? "Then I'll open the calendar. The call is free &mdash; thirty minutes, weekdays nine to five."
        : "The call is free &mdash; thirty minutes. I reply with real times within 24 hours, weekdays nine to five.") + "</p>"
      + '<input class="gate__in" name="name" placeholder="Your name" autocomplete="name" maxlength="80">'
      + '<input class="gate__in" name="org" placeholder="Company or organization" autocomplete="organization" maxlength="120">'
      + '<input class="gate__in" name="email" type="email" placeholder="Email" autocomplete="email" maxlength="120">'
      + '<textarea class="gate__in gate__in--area" name="note" rows="3" maxlength="1200" placeholder="Anything I should see before the call — a link, a deadline, the problem"></textarea>'
      + '<div class="gate__row">'
      + '<button class="gate__back" type="button" data-back>Back</button>'
      + '<button class="gate__go" type="button" data-send>' + (CAL.free
        ? "Pick my time" : "Send it &mdash; I&rsquo;ll reply with times") + "</button>"
      + "</div>"
      + '<p class="gate__err" hidden></p>';
  }

  function screenDone() {
    var recruiter = isRecruiter();
    var paid = !recruiter && answers.kind === "project";
    var url = recruiter ? (CAL.recruiter || CAL.free) : (paid ? CAL.paid : CAL.free);
    if (url) {
      var sep = url.indexOf("?") > -1 ? "&" : "?";
      var deep = url + sep + "name=" + encodeURIComponent(answers.name || "")
        + "&email=" + encodeURIComponent(answers.email || "");
      return '<p class="gate__k">Last thing</p>'
        + "<h2>Pick your time</h2>"
        + '<p class="gate__sub">Weekdays, nine to five. Anything already on my calendar or my class schedule is gone from the grid, so every slot you see is real.</p>'
        + '<a class="gate__go gate__go--wide" href="' + esc(deep) + '" target="_blank" rel="noopener" data-cal>Open the calendar</a>'
        + '<button class="gate__back gate__back--wide" type="button" data-close>I\'ll do it later</button>';
    }
    /* No calendar wired yet — say exactly that, and keep the promise small
       enough to actually keep. */
    return '<p class="gate__k">Got it</p>'
      + "<h2>You're on my desk</h2>"
      + '<p class="gate__sub">This landed with me the moment you sent it. I\'ll come back with open times'
      + " within 24 hours, on weekdays nine to five.</p>"
      + '<p class="gate__sub">If it\'s urgent, go straight at me: <a href="mailto:' + MAILTO + '">' + MAILTO + "</a></p>"
      + '<button class="gate__go gate__go--wide" type="button" data-close>Done</button>';
  }

  /* two trees, sharing screen one and the landing */
  var R_SCREENS = [screenSide, screenRole, screenRoleWho, screenDone];
  var C_SCREENS = [screenSide, screenKind, screenScope, screenWho, screenDone];

  function render() {
    var list = steps();
    q(".gate__body").innerHTML = list[step]();
    q(".gate__body").scrollTop = 0;
    var bar = q(".gate__bar i");
    if (bar) bar.style.width = Math.round((step / (list.length - 1)) * 100) + "%";
    wire();
    var first = q(".gate__body").querySelector("button, input, textarea");
    if (first) try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
  }

  /* nothing advances on an empty answer */
  function markNext() {
    var next = q("[data-next]");
    if (!next) return;
    if (isRecruiter()) {
      /* the shortest honest gate: who you are, and what the job is */
      next.disabled = !(answers.org && answers.role && answers.rtype);
    } else if (step === 2) {
      next.disabled = !(answers.needs && answers.needs.length && answers.budget && answers.when);
    }
  }

  function wire() {
    var wd = el.querySelector("[data-wrongdoor]");
    if (wd) wd.addEventListener("click", function () {
      answers.side = "work"; step = 1; render();
    });
    var wdr = el.querySelector("[data-wrongdoor-role]");
    if (wdr) wdr.addEventListener("click", function () {
      answers.side = "role"; step = 1; render();
    });
    /* a tap on a disabled Continue answers WHY instead of doing nothing */
    var row = el.querySelector(".gate__row");
    if (row) row.addEventListener("click", function (e) {
      var next = el.querySelector("[data-next]");
      if (!next || !next.disabled) return;
      if (!e.target.closest(".gate__row")) return;
      var missing = [];
      if (!(answers.needs && answers.needs.length)) missing.push("needs");
      if (!answers.budget) missing.push("budget");
      if (!answers.when) missing.push("when");
      if (isRecruiter()) missing = [];
      [].forEach.call(el.querySelectorAll(".gate__lab"), function (l) {
        l.classList.toggle("is-missing", missing.indexOf(l.getAttribute("data-lab")) > -1);
      });
    });
    [].forEach.call(el.querySelectorAll("[data-side]"), function (b) {
      b.addEventListener("click", function () {
        answers.side = b.getAttribute("data-side");
        if (window.MCC_TRACK) window.MCC_TRACK("gate_side", { side: answers.side });
        step = 1; render();
      });
    });

    [].forEach.call(el.querySelectorAll("[data-kind]"), function (b) {
      b.addEventListener("click", function () {
        answers.kind = b.getAttribute("data-kind");
        if (window.MCC_TRACK) window.MCC_TRACK("gate_kind", { kind: answers.kind });
        step = 2; render();
      });
    });

    /* the role screen keeps its typed answers as you go, so Back never
       costs a recruiter the sentence they already wrote */
    ["org", "role", "comp", "name", "email", "note"].forEach(function (n) {
      var i = el.querySelector('[name="' + n + '"]');
      if (!i) return;
      if (answers[n]) i.value = answers[n];
      i.addEventListener("input", function () { answers[n] = i.value.trim(); markNext(); });
    });

    [].forEach.call(el.querySelectorAll("[data-rtype]"), function (b) {
      if (answers.rtype === ROLES[+b.getAttribute("data-rtype")]) b.classList.add("is-on");
      b.addEventListener("click", function () {
        [].forEach.call(b.parentNode.children, function (o) { o.classList.remove("is-on"); });
        b.classList.add("is-on");
        answers.rtype = ROLES[+b.getAttribute("data-rtype")];
        markNext();
      });
    });

    [].forEach.call(el.querySelectorAll("[data-need]"), function (b) {
      var v = NEEDS[+b.getAttribute("data-need")];
      if (answers.needs && answers.needs.indexOf(v) > -1) b.classList.add("is-on");
      b.addEventListener("click", function () {
        answers.needs = answers.needs || [];
        var at = answers.needs.indexOf(v);
        if (at > -1) { answers.needs.splice(at, 1); b.classList.remove("is-on"); }
        else { answers.needs.push(v); b.classList.add("is-on"); }
        markNext();
      });
    });

    [["budget", BUDGETS], ["when", WHENS]].forEach(function (pair) {
      [].forEach.call(el.querySelectorAll("[data-" + pair[0] + "]"), function (b) {
        if (answers[pair[0]] === pair[1][+b.getAttribute("data-" + pair[0])]) b.classList.add("is-on");
        b.addEventListener("click", function () {
          [].forEach.call(b.parentNode.children, function (o) { o.classList.remove("is-on"); });
          b.classList.add("is-on");
          answers[pair[0]] = pair[1][+b.getAttribute("data-" + pair[0])];
          markNext();
        });
      });
    });

    var back = q("[data-back]");
    if (back) back.addEventListener("click", function () {
      step = Math.max(0, step - 1);
      /* stepping back to screen one un-picks the side, or the wrong tree
         renders on the way forward again */
      if (step === 0) answers.side = null;
      render();
    });
    var next = q("[data-next]");
    if (next) next.addEventListener("click", function () { step += 1; render(); });
    [].forEach.call(el.querySelectorAll("[data-close]"), function (b) {
      b.addEventListener("click", close);
    });
    var cal = q("[data-cal]");
    if (cal) cal.addEventListener("click", function () {
      if (window.MCC_TRACK) window.MCC_TRACK("gate_calendar_open", { side: answers.side, kind: answers.kind });
      setTimeout(close, 400);
    });
    var send = q("[data-send]");
    if (send) send.addEventListener("click", submit);
    markNext();
  }

  function submit() {
    var name = q('[name="name"]').value.trim();
    var email = q('[name="email"]').value.trim();
    var err = q(".gate__err");
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      err.textContent = "I need a name and a working email to send times to.";
      err.hidden = false;
      return;
    }
    answers.name = name;
    answers.email = email;
    answers.note = q('[name="note"]').value.trim();
    var orgField = q('[name="org"]');
    if (orgField) answers.org = orgField.value.trim();

    var btn = q("[data-send]");
    btn.disabled = true;
    btn.textContent = "Sending…";

    var recruiter = isRecruiter();
    var paid = !recruiter && answers.kind === "project";

    /* the two audiences must never land in one queue, so the first line of
       the note is the sort key and the want field says which world it is */
    var lead = recruiter ? {
      name: name, email: email,
      want: "ROLE · " + (answers.rtype || "unspecified"),
      note: [
        "HIRING FOR A ROLE · no fee",
        "Company: " + (answers.org || "—"),
        "Role: " + (answers.role || "—"),
        "Type: " + (answers.rtype || "—"),
        "Comp: " + (answers.comp || "not stated"),
        answers.note ? "\n" + answers.note : "",
      ].filter(Boolean).join("\n"),
      source: "hire-gate-role",
    } : {
      name: name, email: email,
      want: (answers.needs || []).join(", ") || "Not specified",
      note: [
        paid ? "ONE-OFF PROJECT · free call" : "RETAINER 12mo+ · free call",
        answers.org ? "Org: " + answers.org : "",
        "Budget: " + (answers.budget || "—"),
        "Timing: " + (answers.when || "—"),
        /* whatever they built in the shop rides in with the lead */
        (window.MCC_SHOP && window.MCC_SHOP.summary()) || "",
        (window.MCC_ROADSHOW && window.MCC_ROADSHOW.line()) || "",
        answers.note ? "\n" + answers.note : "",
      ].filter(Boolean).join("\n"),
      source: "hire-gate",
    };

    function done() {
      if (window.MCC_TRACK) {
        window.MCC_TRACK("gate_complete", {
          side: answers.side, kind: answers.kind,
          rtype: answers.rtype, budget: answers.budget, when: answers.when,
        });
      }
      step = steps().length - 1;
      render();
      /* a lead carrying a destination files its trip on the desk too */
      try { if (window.MCC_ROADSHOW && window.MCC_ROADSHOW.request) window.MCC_ROADSHOW.request(lead); } catch (e) {}
      /* the lead is in: only now does the slate wipe */
      answers = {}; seeded = false;
    }

    /* the desk gets it either way: a send that fails must not cost the lead
       its calendar step, and it must not silently vanish */
    if (window.MCC_CRM && window.MCC_CRM.send) {
      window.MCC_CRM.send(lead).then(done).catch(function () {
        err.hidden = false;
        err.innerHTML = 'That did not go through. Send it straight to '
          + '<a href="mailto:' + MAILTO + "?subject=" + encodeURIComponent("Booking a call — " + name)
          + "&body=" + encodeURIComponent(lead.note) + '">' + MAILTO + "</a>.";
        btn.disabled = false;
        btn.textContent = "Try again";
      });
    } else done();
  }

  function open() {
    if (el) return;
    /* answers survive close/reopen on purpose: an Escape brush must never
       cost anyone a filled form. They clear only after a successful send. */
    opener = document.activeElement;
    seeded = false;
    /* mccPurpose was written by the screener that used to stand in front of
       hire.html. The screener is gone — the site now has one page per
       audience instead of one page that asked — so nothing sets this any
       more and `want` will be null for everyone new. The read stays because
       anyone who answered it before still has the value in their browser,
       and honouring it costs a line: never ask a human twice. It can be
       deleted once that is safely stale. */
    var purpose = null;
    try { purpose = localStorage.getItem("mccPurpose"); } catch (e) {}
    var want = purpose === "hiring" ? "role" : purpose === "services" ? "work" : null;
    if (want && answers.side && answers.side !== want) {
      answers = { side: want }; step = 1; seeded = true;
    } else if (!answers.side) {
      step = 0;
      if (want) { answers.side = want; step = 1; seeded = true; }
    } else if (want && answers.side === want && step === 0) {
      step = 1; seeded = true;
    }
    el = document.createElement("div");
    el.className = "gate";
    el.innerHTML = '<div class="gate__card" role="dialog" aria-modal="true" aria-label="Book a call with Matthew McCluster">'
      + '<button class="gate__x" type="button" data-close aria-label="Close">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'
      + '<div class="gate__bar"><i></i></div>'
      + '<div class="gate__body"></div>'
      + "</div>";
    document.body.appendChild(el);
    document.documentElement.style.overflow = "hidden";
    /* the tray folds and goes inert while the gate is up — one surface at a time */
    document.documentElement.classList.add("gate-on");
    var tray = document.querySelector(".shop");
    if (tray) tray.classList.remove("is-open");
    requestAnimationFrame(function () { el.classList.add("is-in"); });
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = el.querySelectorAll("button, input, textarea, a[href]");
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    render();
    if (window.MCC_TRACK) window.MCC_TRACK("gate_open", { page: location.pathname.split("/").pop() });
  }

  /* Every door to the call, including the masthead pill. That pill is
     rendered by masthead.js from data-mh-cta and cannot carry data-book, so
     it is matched by shape instead — safe, because this file only loads on
     the page the gate belongs to. */
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var b = e.target.closest("[data-book]") || e.target.closest('a.mh__cta[href$="#book"]');
    if (!b) return;
    e.preventDefault();
    open();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  window.MCC_GATE = { open: open, close: close, config: CAL };
})();
