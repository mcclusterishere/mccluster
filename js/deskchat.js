/* HITMAN bottom-tab + home-page desk bridge.
   The fourth persistent bottom tab is HITMAN and goes straight to clothing.
   Chat does NOT need to occupy a tab: the main page carries the full desk at
   its bottom, where a visitor can talk through and start ordering services.

   tabbar.js still uses the legacy internal key "sites", so this small bridge
   patches the rendered tab without forcing a navigation rewrite across the
   rest of the five-wing system. The original desk implementation stays in
   deskchat-core.js and is mounted inline on the home page. */
(function () {
  "use strict";

  var self = document.currentScript;
  var src = self && self.src ? self.src : "";
  var ROOT = src ? src.replace(/js\/deskchat\.js.*$/, "") : "";
  var SHOP = ROOT + "prayer-closet.html#theRack";
  var MARK = ROOT + "assets/img/hm-mark-96.png";

  window.MCC_HITMAN_SHOP = SHOP;

  function setLabel(a) {
    var span = a.querySelector("span");
    if (span) {
      span.textContent = "HITMAN";
      return;
    }
    a.appendChild(document.createElement("span")).textContent = "HITMAN";
  }

  function setMark(a) {
    var img = a.querySelector("img.appbar__m");
    if (!img) {
      img = document.createElement("img");
      img.className = "appbar__m";
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      var old = a.querySelector("svg");
      if (old) old.parentNode.replaceChild(img, old);
      else a.insertBefore(img, a.firstChild);
    }
    img.src = MARK;
  }

  function makeHitman(a) {
    if (!a) return;
    a.href = SHOP;
    a.setAttribute("data-appnav", "hitman");
    a.setAttribute("data-hitman-tab", "1");
    a.setAttribute("aria-label", "HITMAN clothing shop");
    setLabel(a);
    setMark(a);

    var page = location.pathname.split("/").pop();
    if (page === "prayer-closet.html") a.classList.add("is-here");
  }

  function patch() {
    /* Catch the legacy fourth tab on first paint, and the HITMAN version on
       subsequent bar restores/mutations. */
    var tabs = document.querySelectorAll('.appbar [data-appnav="sites"], .appbar [data-hitman-tab="1"]');
    for (var i = 0; i < tabs.length; i++) makeHitman(tabs[i]);

    /* If the old Sites/Chat wing is painted by tabbar.js, its legacy first
       slot must not put Chat back into the persistent navigation. */
    var slots = document.querySelectorAll(".appbar a[data-dock]");
    for (var j = 0; j < slots.length; j++) {
      var dock = slots[j].getAttribute("data-dock") || "";
      var href = slots[j].getAttribute("href") || "";
      if (/sites\.html(?:$|[#?])/.test(dock) || /sites\.html(?:$|[#?])/.test(href)) {
        slots[j].setAttribute("data-dock", SHOP);
        slots[j].href = SHOP;
        slots[j].setAttribute("data-hitman-tab", "1");
        setLabel(slots[j]);
        setMark(slots[j]);
      }
    }
  }

  function isHome() {
    var p = location.pathname.replace(/\/+$/, "").split("/").pop();
    return !p || p === "index.html";
  }

  /* The sales desk lives at the literal bottom of the main page. It is a
     real inline conversation, not a floating launcher and not another tab.
     Service buttons seed a useful order sentence, then leave the visitor in
     control of what gets sent. */
  function mountHomeDesk() {
    if (!isHome() || document.getElementById("homeServiceDesk")) return;
    var main = document.querySelector("main");
    if (!main) return;

    var style = document.createElement("style");
    style.id = "homeServiceDeskStyle";
    style.textContent =
      ".home-desk{position:relative;padding:clamp(4rem,10vh,7rem) clamp(1rem,4vw,2rem) 7rem;background:radial-gradient(circle at 50% 0,rgba(193,18,31,.14),transparent 34rem),#0a0807;color:var(--cream,#f4efe6);border-top:1px solid rgba(244,239,230,.10)}" +
      ".home-desk__in{width:min(48rem,100%);margin:0 auto}" +
      ".home-desk__k{margin:0 0 .65rem;color:var(--ruby-hot,#e5383b);font:800 .68rem/1 var(--body,system-ui);letter-spacing:.28em;text-transform:uppercase}" +
      ".home-desk h2{margin:0;font-family:var(--sig,Impact,sans-serif);font-size:clamp(2.7rem,10vw,5.4rem);line-height:.9;text-transform:uppercase;letter-spacing:-.025em}" +
      ".home-desk__sub{max-width:43rem;margin:1rem 0 1.35rem;color:var(--cream-dim,rgba(244,239,230,.72));font:500 clamp(.95rem,2.6vw,1.08rem)/1.7 var(--body,system-ui)}" +
      ".home-desk__quick{display:flex;flex-wrap:wrap;gap:.55rem;margin:0 0 1rem}" +
      ".home-desk__quick button{appearance:none;border:1px solid rgba(244,239,230,.18);border-radius:999px;background:rgba(255,255,255,.055);color:var(--cream,#f4efe6);padding:.68rem .92rem;font:800 .72rem/1 var(--body,system-ui);letter-spacing:.06em;cursor:pointer;touch-action:manipulation}" +
      ".home-desk__quick button:hover,.home-desk__quick button:focus-visible{border-color:rgba(229,56,59,.72);background:rgba(193,18,31,.12);outline:none}" +
      ".home-desk [data-desk-inline]{margin-top:.6rem}" +
      ".home-desk .dsk--inline{border:1px solid rgba(244,239,230,.10);box-shadow:0 36px 90px -45px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,255,255,.08)}" +
      ".home-desk__foot{margin:.9rem .1rem 0;color:var(--cream-dim,rgba(244,239,230,.62));font:600 .74rem/1.55 var(--body,system-ui)}" +
      ".home-desk__foot a{color:inherit;text-underline-offset:3px}";
    document.head.appendChild(style);

    var section = document.createElement("section");
    section.className = "home-desk";
    section.id = "homeServiceDesk";
    section.setAttribute("aria-labelledby", "homeServiceDeskTitle");
    section.innerHTML =
      '<div class="home-desk__in">' +
        '<p class="home-desk__k">McCluster Desk · services</p>' +
        '<h2 id="homeServiceDeskTitle">Tell us what you need.</h2>' +
        '<p class="home-desk__sub">Start the order right here. Websites, photography, video, campaign creative, music and production. A person reads everything you send.</p>' +
        '<div class="home-desk__quick" aria-label="Start a service order">' +
          '<button type="button" data-desk-prompt="I want to order a website. Please help me start the project and collect what you need from me.">Website</button>' +
          '<button type="button" data-desk-prompt="I want to book photography or video. Please help me start the booking and collect the project details.">Photo / Video</button>' +
          '<button type="button" data-desk-prompt="I need campaign or creative direction. Please help me scope the work and start the order.">Campaign / Creative</button>' +
          '<button type="button" data-desk-prompt="I need music, recording, or production services. Please help me scope it and start the order.">Music / Production</button>' +
        '</div>' +
        '<div data-desk-inline></div>' +
        '<p class="home-desk__foot">Prefer to browse first? <a href="' + ROOT + 'hire.html">See the agency services</a>. Ready to shop clothing? Use the <b>HITMAN</b> tab below.</p>' +
      '</div>';
    main.appendChild(section);

    section.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-desk-prompt]");
      if (!b) return;
      var input = section.querySelector(".dsk__in");
      if (!input) return;
      input.value = b.getAttribute("data-desk-prompt") || "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      if (input.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function bootPatch() {
    patch();
    mountHomeDesk();
    var bar = document.querySelector(".appbar");
    if (bar && window.MutationObserver) {
      new MutationObserver(patch).observe(bar, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootPatch);
  else bootPatch();

  /* Load the real desk after the inline host exists, so deskchat-core sees
     [data-desk-inline] on first boot and mounts the conversation there. */
  var core = document.createElement("script");
  core.src = ROOT + "js/deskchat-core.js" + (src.indexOf("?") > -1 ? src.slice(src.indexOf("?")) : "");
  core.onload = patch;
  core.onerror = function () { console.error("[HITMAN] desk chat core failed to load"); };
  (document.head || document.documentElement).appendChild(core);
})();