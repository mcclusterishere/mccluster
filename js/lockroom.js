/* ============================================================
   THE ROOM — the close on the home page.

   WHAT IT REPLACES. Four buttons: Book a call, Lock in a date, The
   Print Shop, Subscribe. Four decisions asked of somebody who has not
   yet said a single word about what they came for, three of which are
   the wrong door for most of the people tapping. The visitor was doing
   the routing, and the visitor is the one person in the exchange who
   does not know the catalogue.

   SO THE ROOM ASKS. What do you need, what kind, when, what's the
   number, who are you, where do I reach you. Six short questions, and
   every one of them has its answers already on screen. Typing is
   available the whole way through and required exactly twice — your
   name and your contact — because those are the two things nobody can
   put in a chip for you.

   WHY IT IS NOT A FORM. A form shows you six empty fields and asks you
   to fill them. This shows you one question, takes a tap, and asks the
   next one — so the cost of starting is one tap and the cost of
   stopping is nothing. It reads back what you said as you go, so by the
   last screen the brief is something the visitor watched themselves
   write.

   WHY IT DOES NOT QUOTE A PRICE. data/offers.json is the ledger and it
   says so itself: prices live there and nowhere else. The room asks for
   the visitor's number and never states one of its own. Where a branch
   has a priced page, the receipt links to it, and that page renders the
   real figure from the ledger.

   HOW IT SENDS, and why it cannot fail closed. The brief goes to the
   inbox function on the anonymous key — the same pipe the desk chat
   uses, no account, no session, and it lands in the same inbox with the
   desk's own reply coming back. If that is unreachable or the site
   channel is off, the intake endpoint takes it. If both are down, the
   receipt hands over a mailto with the entire brief already written. A
   close that can 500 into a dead card is not a close.
   ============================================================ */
(function () {
  "use strict";

  var mount = document.querySelector("[data-lockroom]");
  if (!mount) return;

  var MAILTO = "matthew@mccluster.org";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function track(n, p) { if (window.MCC_TRACK) window.MCC_TRACK(n, p || {}); }
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================================================
     THE WALK.

     Steps are data. `chips` are the answers on screen; `free` is what
     the input offers when somebody would rather type; `next` lets a
     step choose what follows it, which is the whole branch mechanism —
     there is no second step table per service, just one table where
     `detail` asks a different question depending on what came first.
     ============================================================ */
  var DETAIL = {
    website: {
      q: "What's the site for?",
      chips: ["A business", "An artist or a brand", "A church or a nonprofit",
              "A store", "A campaign", "Not sure yet"],
    },
    shoot: {
      q: "What kind of shoot?",
      chips: ["Portraits / headshots", "An event", "A brand shoot",
              "A music video", "A full production", "Not sure yet"],
    },
    social: {
      q: "How much of it do you want handled?",
      chips: ["Just the feeds", "The site and the feeds", "All of it — run it",
              "Not sure yet"],
    },
    music: {
      q: "What do you need from the music?",
      chips: ["License a song", "Original music for a project",
              "Production / a beat", "Something else"],
    },
    campaign: {
      q: "What's the campaign?",
      chips: ["A rally or an event", "Voter outreach", "A civic anthem",
              "A whole program"],
    },
  };

  /* the door the receipt offers, per branch. Every one of these pages
     renders its real numbers from the ledger; this file states none. */
  var DOORS = {
    website: { href: "sites.html", label: "See the four offers" },
    social: { href: "sites.html", label: "See the four offers" },
    shoot: { href: "hire.html", label: "The rate card" },
    music: { href: "hire.html", label: "The rate card" },
    campaign: { href: "equity-uprise.html", label: "Equity Uprise" },
    other: { href: "hire.html", label: "The rate card" },
  };

  var STEPS = [
    {
      id: "need", label: "Need",
      q: "What do you need?",
      chips: [
        { b: "A website", v: "website" },
        { b: "A shoot", v: "shoot" },
        { b: "My socials handled", v: "social" },
        { b: "Music", v: "music" },
        { b: "A campaign", v: "campaign" },
        { b: "Something else", v: "other" },
      ],
      free: "…or say it in your own words",
    },
    {
      id: "detail", label: "Shape",
      /* the one branching step: it borrows its question and its answers
         from whatever the first tap was, and stands down entirely for a
         visitor who picked Something else — there is nothing useful to
         offer them as a chip, and the next question is free text anyway */
      when: function (S) { return !!DETAIL[S.need]; },
      q: function (S) { return DETAIL[S.need].q; },
      chips: function (S) { return DETAIL[S.need].chips; },
      free: "…or say it in your own words",
    },
    {
      id: "about", label: "Brief",
      q: "Tell me about it in a line or two.",
      chips: [{ b: "Skip this", v: "", skip: true }],
      free: "What are we making?",
    },
    {
      id: "when", label: "Timing",
      q: "When do you need it?",
      chips: ["This month", "In the next 90 days", "Sometime this year",
              "No date yet — I'm asking around"],
      free: "…or name the date",
    },
    {
      id: "budget", label: "Money",
      /* the same bands the onboarding walk uses, so one visitor answering
         both questions is not asked to convert between two scales */
      q: "What's the budget?",
      note: "An honest band gets you an honest answer faster than a guess does.",
      chips: ["Under $1,000", "$1,000 – $3,000", "$3,000 – $8,000",
              "$8,000 – $20,000", "$20,000 and up", "I need guidance"],
      free: "…or name your number",
    },
    {
      id: "name", label: "You",
      q: "What should I call you?",
      free: "Your name", needsText: true, autocomplete: "name",
    },
    {
      id: "reach", label: "Reach",
      q: "Where do I reach you?",
      note: "Email or a phone number. It goes to Matthew and nowhere else.",
      free: "Email or phone", needsText: true, autocomplete: "email",
    },
  ];

  function live() {
    return STEPS.filter(function (s) { return !s.when || s.when(S); });
  }
  function val(x, s) { return typeof x === "function" ? x(s) : x; }

  var S = {};        // the answers, keyed by step id
  var LABELS = {};   // what the visitor actually saw themselves tap
  var at = 0;
  var sent = false;
  var threadLive = false;   // the desk answered, so typing keeps talking to it

  /* ============================================================
     THE ROOM'S FURNITURE
     ============================================================ */
  mount.innerHTML =
    '<div class="lockroom__card">' +
      '<header class="lockroom__top">' +
        '<span class="lockroom__who"><b>The desk</b>' +
          "<small>Tap it through &middot; a person reads every one of these</small></span>" +
        '<button class="lockroom__reset" type="button" hidden>Start over</button>' +
      "</header>" +
      '<ol class="lockroom__rail" aria-hidden="true"></ol>' +
      /* data-lenis-prevent: Lenis owns this page's wheel and touch, so
         without it a scroll inside the transcript is taken by the page
         and the log can only be read by dragging its scrollbar */
      '<div class="lockroom__log" role="log" aria-live="polite" data-lenis-prevent></div>' +
      '<div class="lockroom__tray"></div>' +
      '<form class="lockroom__bar">' +
        '<input class="lockroom__in" type="text" autocomplete="off" maxlength="600" ' +
          'aria-label="Your answer" placeholder="…">' +
        '<button class="lockroom__go" type="submit" aria-label="Send">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5L20 4l-7 16-2.3-6.4z"/></svg>' +
        "</button>" +
      "</form>" +
    "</div>";

  var card = mount.querySelector(".lockroom__card");
  var rail = mount.querySelector(".lockroom__rail");
  var log = mount.querySelector(".lockroom__log");
  var tray = mount.querySelector(".lockroom__tray");
  var bar = mount.querySelector(".lockroom__bar");
  var input = mount.querySelector(".lockroom__in");
  var reset = mount.querySelector(".lockroom__reset");

  rail.innerHTML = STEPS.map(function (s) {
    return '<li data-rail="' + esc(s.id) + '"><span>' + esc(s.label) + "</span></li>";
  }).join("");

  function paintRail() {
    var w = live();
    var here = w[at] ? w[at].id : null;
    var seen = {};
    w.slice(0, at).forEach(function (s) { seen[s.id] = 1; });
    Array.prototype.forEach.call(rail.children, function (li) {
      var id = li.getAttribute("data-rail");
      var inWalk = w.some(function (s) { return s.id === id; });
      li.hidden = !inWalk;
      li.className = seen[id] ? "is-done" : (id === here ? "is-here" : "");
    });
  }

  /* the log grows downward and the card does not: it scrolls its own
     transcript, so the page underneath never jumps while somebody is
     halfway through answering */
  function toBottom() { log.scrollTop = log.scrollHeight; }

  function bubble(side, html, cls) {
    var d = document.createElement("div");
    d.className = "lockroom__m lockroom__m--" + side + (cls ? " " + cls : "");
    d.innerHTML = html;
    log.appendChild(d);
    toBottom();
    return d;
  }

  function typing(on) {
    var t = log.querySelector(".lockroom__typing");
    if (on && !t) {
      t = bubble("them", "<i></i><i></i><i></i>", "lockroom__typing");
    } else if (!on && t) { t.remove(); }
  }

  /* a beat before each question, so the room reads as a room. Under
     reduced motion the beat is gone and the question is simply there. */
  function after(ms, fn) {
    if (reduced) { fn(); return; }
    typing(true);
    setTimeout(function () { typing(false); fn(); }, ms);
  }

  function setTray(html) { tray.innerHTML = html; }

  function chipRow(step) {
    var chips = val(step.chips, S) || [];
    return chips.map(function (c) {
      var b = typeof c === "string" ? c : c.b;
      var v = typeof c === "string" ? c : (c.v != null ? c.v : c.b);
      /* a skip chip answers with nothing at all rather than with its own
         label — "In their words: Skip this" is not a brief line */
      return '<button class="lockroom__chip' + (c && c.skip ? " lockroom__chip--skip" : "") +
        '" type="button"' + (c && c.skip ? " data-skip" : "") +
        ' data-v="' + esc(v) + '">' + esc(b) + "</button>";
    }).join("");
  }

  function ask() {
    var w = live();
    if (at >= w.length) { review(); return; }
    var step = w[at];
    paintRail();
    after(420, function () {
      bubble("them", "<p>" + esc(val(step.q, S)) + "</p>" +
        (step.note ? '<small class="lockroom__note">' + esc(step.note) + "</small>" : ""));
      setTray(chipRow(step));
      input.placeholder = step.free || "Type your answer";
      /* the two steps that must be typed are the two a browser can fill
         for you, so let it: nobody should hand-key their own email */
      input.setAttribute("autocomplete", step.autocomplete || "off");
      input.value = "";
      bar.hidden = false;
      bar.classList.toggle("is-required", !!step.needsText);
    });
  }

  function answer(value, shown) {
    var w = live();
    var step = w[at];
    if (!step) return;
    if (step.needsText && !String(value).trim()) return;
    S[step.id] = String(value);
    LABELS[step.id] = String(shown != null ? shown : value);
    if (String(shown || value).trim()) bubble("me", "<p>" + esc(shown != null ? shown : value) + "</p>");
    else bubble("me", "<p><em>skipped</em></p>", "lockroom__m--skip");
    setTray("");
    at += 1;
    reset.hidden = false;
    track("lockroom_answer", { step: step.id, page: "home" });
    ask();
  }


  bar.addEventListener("submit", function (e) {
    e.preventDefault();
    var t = input.value.trim();
    if (!t) return;
    if (threadLive) { keepTalking(t); return; }
    answer(t, t);
  });

  reset.addEventListener("click", function () {
    S = {}; LABELS = {}; at = 0; sent = false; threadLive = false;
    log.innerHTML = ""; setTray(""); reset.hidden = true;
    card.classList.remove("is-done");
    bar.hidden = false;
    track("lockroom_reset", { page: "home" });
    ask();
  });

  /* ============================================================
     THE BRIEF, and the review before it goes
     ============================================================ */
  var LINE = {
    need: "Needs", detail: "Shape", about: "In their words",
    when: "Timing", budget: "Budget", name: "Name", reach: "Reach them at",
  };

  function lines() {
    return live().map(function (s) {
      var v = LABELS[s.id];
      if (!v || !String(v).trim()) return null;
      return LINE[s.id] + ": " + v;
    }).filter(Boolean);
  }

  function briefBody() {
    return ["LOCK IN · from the room on the home page", ""]
      .concat(lines())
      .concat(["", "Sent from " + location.pathname]).join("\n");
  }

  function review() {
    paintRail();
    after(420, function () {
      bubble("them",
        "<p>That's the brief. Send it and it's on the desk.</p>" +
        '<ul class="lockroom__brief">' + lines().map(function (l) {
          var i = l.indexOf(": ");
          return "<li><span>" + esc(l.slice(0, i)) + "</span><b>" + esc(l.slice(i + 2)) + "</b></li>";
        }).join("") + "</ul>");
      setTray('<button class="lockroom__send" type="button">Lock it in</button>' +
              '<button class="lockroom__chip lockroom__chip--skip" type="button" data-edit>Start over</button>');
      bar.hidden = true;
    });
  }

  /* ONE handler for the tray, not two. The review screen's "Start over"
     is itself a chip, so a second listener that only knew about chips
     would answer the review step with the word "Start over" before the
     listener that meant to reset ever ran. */
  tray.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    if (e.target.closest("[data-edit]")) { reset.click(); return; }
    var go = e.target.closest(".lockroom__send");
    if (go) { send(go); return; }
    var b = e.target.closest(".lockroom__chip");
    if (!b) return;
    if (b.hasAttribute("data-skip")) { answer("", ""); return; }
    answer(b.getAttribute("data-v"), b.textContent);
  });

  /* ============================================================
     THE WIRE. Three ways out, tried in order, and the third one
     cannot fail because it is the visitor's own mail client.
     ============================================================ */
  function visitorKey() {
    var K = "mcc_desk_key", k = null;
    try { k = localStorage.getItem(K); } catch (e) {}
    if (k && /^[A-Za-z0-9_-]{16,64}$/.test(k)) return k;
    var b = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(b);
    k = btoa(String.fromCharCode.apply(null, b))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { localStorage.setItem(K, k); } catch (e) {}
    return k;
  }

  /* EVERY WIRE GETS A CLOCK.

     no-cors makes the sheet's response opaque, so a hung request is
     indistinguishable from a slow one and its promise simply never
     settles — which leaves the visitor watching a button that says
     "Sending…" until they give up. A send that cannot time out cannot
     fall back, and the fallback is the whole reason the mailto exists. */
  function withClock(p, ms) {
    return new Promise(function (res, rej) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; rej(new Error("timeout")); } }, ms);
      p.then(function (v) { if (!done) { done = true; clearTimeout(t); res(v); } },
             function (e) { if (!done) { done = true; clearTimeout(t); rej(e); } });
    });
  }

  /* the desk's own pipe: anonymous, no session, same inbox, and it
     hands back whatever the desk says in return */
  function toDesk(body) {
    var Sb = window.MCC_SUPA;
    if (!Sb || !Sb.url) return Promise.reject(new Error("no backend"));
    return fetch(Sb.url + "/functions/v1/inbox", {
      method: "POST",
      headers: { "content-type": "application/json", apikey: Sb.key, Authorization: "Bearer " + Sb.key },
      body: JSON.stringify({
        action: "say", org: window.MCC_ORG || "mccluster",
        visitor_key: visitorKey(), page: location.pathname,
        body: body.slice(0, 2000),
      }),
    }).then(function (r) {
      if (!r.ok) throw new Error("desk " + r.status);
      return r.json();
    });
  }

  /* the sheet: opaque by design, so a resolved promise is all the
     confirmation there is — which is why the desk is tried first */
  function toSheet(body) {
    var ep = window.INTAKE_ENDPOINT;
    if (!ep) return Promise.reject(new Error("no endpoint"));
    var row = JSON.stringify({
      name: LABELS.name || "", email: LABELS.reach || "",
      message: body, page: location.pathname + " · lockroom",
    });
    return fetch(ep, { method: "POST", mode: "no-cors", body: row, keepalive: true });
  }

  function mailHref(body) {
    return "mailto:" + MAILTO +
      "?subject=" + encodeURIComponent("Lock in · " + (LABELS.need || "a project")) +
      "&body=" + encodeURIComponent(body);
  }

  function send(btn) {
    if (sent) return;
    sent = true;
    btn.disabled = true;
    btn.textContent = "Sending…";
    var body = briefBody();

    withClock(toDesk(body), 9000)
      .then(function (r) { done(body, r && r.replies); })
      .catch(function () {
        return withClock(toSheet(body), 7000).then(function () { done(body, null); });
      })
      .catch(function () { done(body, null, true); });
  }

  function done(body, replies, wireDown) {
    var door = DOORS[S.need] || DOORS.other;
    card.classList.add("is-done");
    setTray("");
    bubble("them",
      "<p><b>" + (wireDown ? "Almost." : "Locked in.") + "</b></p>" +
      (wireDown
        ? "<p>The wire is busy. The whole brief is already written &mdash; " +
          '<a class="lockroom__mail" href="' + esc(mailHref(body)) + '">send it by email in one tap</a>. ' +
          "It lands on the same desk.</p>"
        : "<p>It's on the desk. Matthew reads these himself and answers fast, " +
          "usually the same day.</p>") +
      '<a class="lockroom__door" href="' + esc(door.href) + '" data-cta="lockroom-door">' +
        esc(door.label) + " <span aria-hidden=\"true\">&rarr;</span></a>");

    track(wireDown ? "lockroom_wire_down" : "lockroom_sent",
      { need: S.need || "", budget: LABELS.budget || "", page: "home" });

    /* the desk answered, so this stops being a form and starts being a
       conversation: what gets typed from here goes to the same thread */
    if (replies && replies.length) {
      threadLive = true;
      bar.hidden = false;
      /* the last thing typed was their email address; leaving it sitting in
         the box makes the new placeholder invisible and the next message
         start with it */
      input.value = "";
      input.setAttribute("autocomplete", "off");
      input.placeholder = "Say something else…";
      replies.forEach(function (rep, i) {
        setTimeout(function () { bubble("them", "<p>" + esc(rep.body) + "</p>"); }, (i + 1) * 550);
      });
    }
  }

  function keepTalking(text) {
    input.value = "";
    bubble("me", "<p>" + esc(text) + "</p>");
    typing(true);
    withClock(toDesk(text), 9000).then(function (r) {
      typing(false);
      (r.replies || []).forEach(function (rep, i) {
        setTimeout(function () { bubble("them", "<p>" + esc(rep.body) + "</p>"); }, i * 550);
      });
    }).catch(function () {
      typing(false);
      bubble("them", "<p>That one didn't send. " +
        '<a class="lockroom__mail" href="mailto:' + MAILTO + '">Email it</a> and it reaches him directly.</p>');
    });
  }

  /* ---- open the room only once it is actually on screen, so the first
          question is asked to somebody who is there to read it ---- */
  function begin() {
    if (begin.done) return;
    begin.done = true;
    track("lockroom_open", { page: "home" });
    ask();
  }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { io.disconnect(); begin(); }
    }, { threshold: 0.25 });
    io.observe(mount);
  } else { begin(); }
})();
