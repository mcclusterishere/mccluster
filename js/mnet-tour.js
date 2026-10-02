/* THE WALKTHROUGH — a guided tour of Mnet for somebody who just arrived.

   Started three ways, all the same tour:
     - mnet.html?tour=1, the link in Matthew's welcome message;
     - any element carrying data-tour-start (the welcome message renders its
       link as one, and the Me tab has a "Take the tour" button);
     - window.MCC_TOUR.start() from anywhere else.

   Each step names one thing, rings it, and dims the rest. Steps that live
   on another Mnet tab switch to it by pressing that tab's own button, so the
   tour uses the page exactly the way a person does and needs nothing from
   js/mnet.js. A step whose target is not on screen (a signed-out view, an
   empty list) still shows, centred, so the tour never stalls.

   Phone first: the card is a bottom sheet that sits above the app bar,
   buttons are 44px, and the ring follows the target on scroll and rotate.
   Colours are the site's own tokens, so light and dark both hold. Nothing
   is sent anywhere; "seen" is a per-device convenience in localStorage. */
(function (w, d) {
  "use strict";

  var SEEN = "mcc_mnet_tour_seen";

  var STEPS = [
    { title: "Welcome to the Action Network",
      body: "The network behind McCluster: the music, the people around it, and a straight line to Matthew. This takes about a minute." },
    { target: ".mn__tabs", title: "Six tabs, that's the whole map",
      body: "Feed, Discover, Groups, Messages, Alerts and Me. Everything on the network lives behind one of these." },
    { view: "feed", target: "#mnPostBody", title: "Post something",
      body: "Say what you're listening to, share a photo, ask a question. Your posts show up in the feed for everyone who follows you." },
    { view: "discover", target: "#mnDiscoverView", title: "Find people",
      body: "Search for anyone on the network by name or @handle, and follow the ones you want to hear from." },
    { view: "groups", target: "#mngCards", title: "Join a group",
      body: "Groups are where the real conversations happen. Open Explore, pick one that fits, and say hello." },
    { view: "messages", target: "#mnConversations", title: "Your messages",
      body: "Matthew's welcome is in here. Reply any time: questions, ideas, problems. It goes straight to him." },
    { view: "profile", target: "#mnEditProfile", title: "Make it yours",
      body: "Add a photo, a headline and a short bio so people know who they're talking to." },
    { target: '.appbar [data-appnav="music"]', title: "The music",
      body: "This tab at the bottom takes you to the music. The middle one is home, and the last one brings you back here." },
    { title: "That's the tour",
      body: "You can replay it any time from Me → Take the tour.",
      finish: [
        { label: "Message Matthew", view: "messages" },
        { label: "Done" }
      ] }
  ];

  var ui = null, idx = 0, active = false, lastTarget = null, raf = 0;

  function css() {
    if (d.getElementById("mccTourStyle")) return;
    var s = d.createElement("style");
    s.id = "mccTourStyle";
    s.textContent =
      ".mcct-ring{position:fixed;z-index:9990;pointer-events:none;border-radius:14px;" +
        "box-shadow:0 0 0 3px var(--ruby-hot,#e5383b),0 0 0 9999px rgba(0,0,0,.62);transition:all .22s ease}" +
      ".mcct-ring.is-center{left:50%;top:40%;width:0;height:0;box-shadow:0 0 0 9999px rgba(0,0,0,.62)}" +
      ".mcct-card{position:fixed;z-index:9991;left:12px;right:12px;bottom:calc(96px + env(safe-area-inset-bottom,0px));" +
        "max-width:30rem;margin:0 auto;background:var(--ink,#0a0807);color:var(--cream,#f4efe6);" +
        "border:1px solid var(--edge,rgba(255,255,255,.14));border-radius:18px;padding:16px 16px 14px;" +
        "box-shadow:0 18px 50px rgba(0,0,0,.55);font-family:var(--ui,system-ui,sans-serif)}" +
      ".mcct-card:focus{outline:none}" +
      ".mcct-step{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--cream-dim,rgba(244,239,230,.88))}" +
      ".mcct-title{margin:0 0 6px;font-size:19px;line-height:1.25;font-weight:800}" +
      ".mcct-body{margin:0;font-size:15px;line-height:1.5;color:var(--cream-dim,rgba(244,239,230,.88))}" +
      ".mcct-dots{display:flex;gap:5px;margin:12px 0 0}" +
      ".mcct-dots i{width:6px;height:6px;border-radius:50%;background:var(--edge,rgba(255,255,255,.2))}" +
      ".mcct-dots i.is-on{background:var(--ruby-hot,#e5383b)}" +
      ".mcct-row{display:flex;gap:8px;align-items:center;margin-top:14px;flex-wrap:wrap}" +
      ".mcct-btn{appearance:none;border:0;cursor:pointer;min-height:44px;padding:10px 16px;border-radius:12px;" +
        "font:800 15px/1 var(--ui,system-ui,sans-serif);background:rgba(255,255,255,.07);color:var(--cream,#f4efe6);" +
        "box-shadow:inset 0 0 0 1px var(--edge,rgba(255,255,255,.14))}" +
      ".mcct-btn--go{background:var(--ruby-hot,#e5383b);color:#fff;box-shadow:none;margin-left:auto}" +
      ".mcct-skip{appearance:none;border:0;background:none;cursor:pointer;min-height:44px;padding:0 4px;" +
        "color:var(--cream-dim,rgba(244,239,230,.88));font:600 14px var(--ui,system-ui,sans-serif);text-decoration:underline}" +
      "@media (min-width:760px){.mcct-card{left:auto;right:24px;bottom:calc(104px + env(safe-area-inset-bottom,0px))}}";
    d.head.appendChild(s);
  }

  function build() {
    css();
    var ring = d.createElement("div");
    ring.className = "mcct-ring is-center";
    ring.setAttribute("aria-hidden", "true");
    var card = d.createElement("section");
    card.className = "mcct-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "false");
    card.setAttribute("aria-labelledby", "mcctTitle");
    card.tabIndex = -1;
    card.innerHTML =
      '<p class="mcct-step" id="mcctStep"></p>' +
      '<h2 class="mcct-title" id="mcctTitle"></h2>' +
      '<p class="mcct-body" id="mcctBody" aria-live="polite"></p>' +
      '<div class="mcct-dots" id="mcctDots" aria-hidden="true"></div>' +
      '<div class="mcct-row" id="mcctRow"></div>';
    d.body.appendChild(ring);
    d.body.appendChild(card);
    ui = { ring: ring, card: card };
    card.addEventListener("click", onCardClick);
    d.addEventListener("keydown", onKey);
    w.addEventListener("resize", follow);
    w.addEventListener("scroll", follow, true);
  }

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function place() {
    if (!ui) return;
    if (!lastTarget || !visible(lastTarget)) {
      ui.ring.className = "mcct-ring is-center";
      ui.ring.removeAttribute("style");
      return;
    }
    var r = lastTarget.getBoundingClientRect(), pad = 6;
    ui.ring.className = "mcct-ring";
    ui.ring.style.left = (r.left - pad) + "px";
    ui.ring.style.top = (r.top - pad) + "px";
    ui.ring.style.width = (r.width + pad * 2) + "px";
    ui.ring.style.height = (r.height + pad * 2) + "px";
  }
  function follow() {
    if (!active) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(place);
  }

  function openView(name) {
    if (!name) return;
    var tab = d.querySelector('.mn__tabs [data-mn-view="' + name + '"]');
    if (tab && !tab.classList.contains("is-active")) tab.click();
  }

  function show(i) {
    idx = Math.max(0, Math.min(STEPS.length - 1, i));
    var step = STEPS[idx];
    openView(step.view);
    d.getElementById("mcctStep").textContent = (idx + 1) + " of " + STEPS.length;
    d.getElementById("mcctTitle").textContent = step.title;
    d.getElementById("mcctBody").textContent = step.body;
    d.getElementById("mcctDots").innerHTML = STEPS.map(function (_, k) {
      return "<i" + (k === idx ? ' class="is-on"' : "") + "></i>";
    }).join("");
    var row = "";
    if (step.finish) {
      row = step.finish.map(function (f, k) {
        return '<button type="button" class="mcct-btn' + (k === step.finish.length - 1 ? " mcct-btn--go" : "") +
          '" data-tour-finish="' + k + '">' + f.label + "</button>";
      }).join("");
    } else {
      row = '<button type="button" class="mcct-skip" data-tour="skip">Skip tour</button>' +
        (idx > 0 ? '<button type="button" class="mcct-btn" data-tour="back">Back</button>' : "") +
        '<button type="button" class="mcct-btn mcct-btn--go" data-tour="next">' + (idx === 0 ? "Show me" : "Next") + "</button>";
    }
    d.getElementById("mcctRow").innerHTML = row;

    /* Let a tab switch paint before measuring what it revealed. */
    setTimeout(function () {
      lastTarget = step.target ? d.querySelector(step.target) : null;
      if (lastTarget && visible(lastTarget)) {
        lastTarget.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(place, 320);
      }
      place();
      var go = ui.card.querySelector(".mcct-btn--go");
      (go || ui.card).focus({ preventScroll: true });
    }, 60);
  }

  function end() {
    active = false;
    try { localStorage.setItem(SEEN, new Date().toISOString()); } catch (e) { /* storage blocked */ }
    if (ui) {
      ui.ring.remove(); ui.card.remove();
      d.removeEventListener("keydown", onKey);
      w.removeEventListener("resize", follow);
      w.removeEventListener("scroll", follow, true);
      ui = null;
    }
    if (/[?&]tour=1\b/.test(location.search) && history.replaceState) {
      history.replaceState(null, "", location.pathname + location.search.replace(/([?&])tour=1(&|$)/, "$1").replace(/[?&]$/, "") + location.hash);
    }
  }

  function onCardClick(e) {
    var b = e.target.closest("button");
    if (!b) return;
    var act = b.getAttribute("data-tour");
    if (act === "next") show(idx + 1);
    else if (act === "back") show(idx - 1);
    else if (act === "skip") end();
    var fin = b.getAttribute("data-tour-finish");
    if (fin != null) {
      var f = STEPS[idx].finish[Number(fin)];
      end();
      if (f && f.view) openView(f.view);
    }
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === "Escape") end();
    else if (e.key === "ArrowRight" && !STEPS[idx].finish) show(idx + 1);
    else if (e.key === "ArrowLeft" && idx > 0) show(idx - 1);
  }

  /* The tour is about the signed-in app. Somebody arriving from the welcome
     link may still be on the sign-in or profile screen, so wait for the app
     to appear rather than touring a door. */
  function whenAppReady(cb) {
    /* No time limit: signing in and finishing the Mnet profile can take
       minutes, and the walkthrough should still start the moment the app
       appears. Watches #mnApp's hidden attribute rather than polling. */
    var app = d.getElementById("mnApp");
    if (!app) return;
    if (!app.hidden) return cb(true);
    if (!w.MutationObserver) {
      var t = setInterval(function () { if (!app.hidden) { clearInterval(t); cb(true); } }, 500);
      return;
    }
    var mo = new MutationObserver(function () {
      if (app.hidden) return;
      mo.disconnect();
      cb(true);
    });
    mo.observe(app, { attributes: true, attributeFilter: ["hidden"] });
  }

  /* The welcome's button lives inside the conversation, which is a modal
     <dialog>. A modal sits in the browser's top layer, above any z-index,
     so a tour started from it would run invisibly behind it. Close it. */
  function closeDialogs() {
    Array.prototype.forEach.call(d.querySelectorAll("dialog[open]"), function (dl) {
      try { dl.close(); } catch (e) { dl.removeAttribute("open"); }
    });
  }

  function start() {
    if (active) return;
    closeDialogs();
    whenAppReady(function (ready) {
      if (!ready || active) return;
      active = true;
      if (!ui) build();
      show(0);
    });
  }

  d.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-tour-start]");
    if (!t) return;
    e.preventDefault();
    start();
  });

  w.MCC_TOUR = { start: start, stop: end, steps: STEPS.length };

  if (/[?&]tour=1\b/.test(location.search)) start();
})(window, document);
