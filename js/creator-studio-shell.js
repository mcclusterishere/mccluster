/* Creator Studio shell: four chapters inside #creatorApp.

   Make · Releases · Page · Stats are LOCAL chapter tabs inside this one
   destination (AGENTS.md, "Shared website navigation": chapter tabs stay
   within their destination). This is not a second global navigation.

   What it does, and nothing more:
   - moves the cards creator.html already has into their chapter, by the ids
     they already carry. No id, form, field or listener changes: the studio
     script (js/music-creator-studio.js) finds everything where it always did.
   - routes #make, #releases, #page and #stats; the default is Make, except
     that creator.html?edit=profile opens on Page, where the profile form is.
   - groups the long release form under plain headings. The fields are moved
     inside the same <form>, so the submit handler reads them unchanged.

   Without this script the page still works: every card simply shows in one
   column, as it did before. */
(function (w, d) {
  "use strict";

  var CHAPTERS = ["make", "releases", "page", "stats"];
  /* which existing card belongs to which chapter, in reading order; each is
     found from an id creator.html already had */
  var CARDS = {
    releases: ["creatorTracks", "trackForm"],
    page: ["creatorSummary", "creatorIdentity", "albumCard", "rateCard"],
    stats: ["selfMusicAnalytics"]
  };
  /* the release form's groups: [heading, hint, ids of the controls inside] */
  var GROUPS = [
    ["The track", "What listeners see on the release.",
      ["trackTitle", "trackArtist", "trackGenre", "trackAlbum", "trackAccess", "trackDescription"]],
    ["Audio", "The master stays private. A preview is the public clip for account-only and licensed tracks.",
      ["trackMaster", "trackPreview"]],
    ["Artwork and player colours", "The cover, and the colours the player uses for this track.",
      ["trackArt", "trackAccent", "trackBackground", "trackForeground", "trackSurface"]],
    ["Lyrics and video", "Optional.",
      ["trackLyricSheet", "trackMusicVideo", "trackLyricsUrl"]],
    ["Links on the player", "Optional. A button on the player, and links from lyric lines.",
      ["trackServiceLabel", "trackServiceUrl", "trackLyricCtas"]],
    ["Rights", "Every release needs these before it can be reviewed.",
      ["ownsMaster", "derivativePermissions"]],
    ["License offer", "Optional. Leave the price empty to offer no license.",
      ["licensePrice", "licenseTitle", "licenseTerms"]],
    ["Send for review", "",
      ["releaseTerms", "submitTrack", "trackStatus"]]
  ];

  var app = d.getElementById("creatorApp");
  var row = d.getElementById("creatorChapters");
  if (!app || !row) return;
  var tabs = {}, panels = {}, ok = true;
  CHAPTERS.forEach(function (k) {
    tabs[k] = d.getElementById("cs-tab-" + k);
    panels[k] = d.getElementById("cs-panel-" + k);
    if (!tabs[k] || !panels[k]) ok = false;
  });
  if (!ok) return;

  function cardOf(id) {
    var el = d.getElementById(id);
    while (el && el.parentNode !== app) el = el.parentNode;
    return el && el.nodeType === 1 ? el : null;
  }
  /* 1. the cards go to their chapters */
  Object.keys(CARDS).forEach(function (k) {
    CARDS[k].forEach(function (id) {
      var card = cardOf(id);
      if (card) panels[k].appendChild(card);
    });
  });

  /* 2. the release form gets headings */
  (function groupReleaseForm() {
    var form = d.getElementById("trackForm");
    if (!form || form.querySelector(".cs-group")) return;
    function fieldOf(id) {
      var el = d.getElementById(id);
      while (el && el.parentNode !== form) el = el.parentNode;
      return el && el.nodeType === 1 ? el : null;
    }
    GROUPS.forEach(function (g, i) {
      var members = [];
      g[2].forEach(function (id) {
        var f = fieldOf(id);
        if (f && members.indexOf(f) < 0) members.push(f);
      });
      if (!members.length) return;
      var group = d.createElement("div");
      group.className = "cs-group";
      group.setAttribute("role", "group");
      var head = d.createElement("div");
      head.className = "cs-group__head";
      var title = d.createElement("h3");
      title.className = "cs-group__title";
      title.id = "csGroup" + i;
      title.textContent = g[0];
      head.appendChild(title);
      if (g[1]) {
        var hint = d.createElement("p");
        hint.className = "cs-group__hint";
        hint.textContent = g[1];
        head.appendChild(hint);
      }
      group.setAttribute("aria-labelledby", title.id);
      group.appendChild(head);
      form.insertBefore(group, members[0]);
      members.forEach(function (m) { group.appendChild(m); });
    });
  })();

  /* 3. the tab semantics are added here, not written in the markup: if this script does not run, the row is
     not announced as four tabs that do nothing (css/creator-studio.css hides it until it has its role) */
  row.setAttribute("role", "tablist");
  CHAPTERS.forEach(function (k) {
    tabs[k].setAttribute("role", "tab");
    tabs[k].setAttribute("aria-controls", panels[k].id);
    panels[k].setAttribute("role", "tabpanel");
    panels[k].setAttribute("aria-labelledby", tabs[k].id);
  });
  /* a chapter that holds nothing focusable (Stats, signed out) is itself the next Tab stop after its tab, so it
     can be reached and read; one that holds controls needs no stop of its own */
  function reachable(panel) {
    var list = panel.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]'), any = false;
    for (var i = 0; i < list.length && !any; i++) any = !list[i].disabled && list[i].getClientRects().length > 0;
    if (any) panel.removeAttribute("tabindex"); else panel.tabIndex = 0;
  }

  /* 4. routing */
  function chapterOf(el) {
    while (el && el !== app && el.nodeType === 1) {
      if (el.classList.contains("cs-panel")) return el.getAttribute("data-chapter") || "";
      el = el.parentNode;
    }
    return "";
  }
  /* What the address asks for. A chapter name is a chapter. Any other fragment that names an element inside a
     chapter opens that chapter (creator.html#artistAnalyticsHeading, linked from the World, is in Stats).
     No fragment is the default chapter. `named` is false only for a fragment this page does not know. */
  function wanted() {
    var raw = String(w.location.hash || "").replace(/^#/, ""), h = raw.toLowerCase();
    if (CHAPTERS.indexOf(h) >= 0) return { chapter: h, el: null, named: true };
    if (raw) {
      var el = null;
      try { el = d.getElementById(decodeURIComponent(raw)); } catch (_) { el = d.getElementById(raw); }
      var c = el ? chapterOf(el) : "";
      if (c && CHAPTERS.indexOf(c) >= 0) return { chapter: c, el: el, named: true };
    }
    return { chapter: /[?&]edit=profile(?:&|$)/.test(w.location.search || "") ? "page" : "make", el: null, named: !raw };
  }
  var current = "", anchor = null;
  /* the element a fragment named is scrolled to once it can be seen (the studio is hidden until sign-in is known) */
  function settle() {
    if (!anchor || app.hidden) return;
    var el = anchor;
    anchor = null;
    try { if (el.getClientRects().length) el.scrollIntoView({ block: "start" }); } catch (_) {}
  }
  function show(k) {
    if (CHAPTERS.indexOf(k) < 0) k = "make";
    CHAPTERS.forEach(function (c) {
      var on = c === k;
      tabs[c].setAttribute("aria-selected", on ? "true" : "false");
      tabs[c].tabIndex = on ? 0 : -1;
      panels[c].hidden = !on;
    });
    app.setAttribute("data-chapter", k);
    reachable(panels[k]);
    if (current !== k) {
      current = k;
      try { w.dispatchEvent(new CustomEvent("mcc:studio-chapter", { detail: { chapter: k } })); } catch (_) {}
    }
  }
  /* a chapter chosen from deep in a long one starts at its top, not wherever
     the last one was scrolled to */
  function toTop() {
    var mark = d.getElementById("creatorChaptersMark");
    if (!mark) return;
    var park = parseFloat(w.getComputedStyle(row).top) || 0;
    var top = mark.getBoundingClientRect().top;
    if (top < park) w.scrollTo(0, Math.max(0, (w.pageYOffset || 0) + top - park));
  }
  function go(k, opts) {
    if (CHAPTERS.indexOf(k) < 0) return;
    opts = opts || {};
    try {
      if (opts.replace && w.history && w.history.replaceState) w.history.replaceState(null, "", "#" + k);
      else if (w.location.hash !== "#" + k) w.location.hash = k;
    } catch (_) {}
    show(k);
    if (!opts.keepScroll) toTop();
    if (opts.focus) tabs[k].focus();
  }
  /* Back, Forward and in-page links: the address decides the chapter. An empty fragment is the entry address,
     so it shows the default chapter again; a fragment this page does not know is left alone. */
  w.addEventListener("hashchange", function () {
    var t = wanted();
    if (!t.named) return;
    show(t.chapter);
    if (t.el) { anchor = t.el; settle(); } else toTop();
  });
  row.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".cs-tab") : null;
    if (!t || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(t.getAttribute("data-chapter"));
  });
  /* the tablist keyboard pattern: arrows move and select, Home and End jump */
  row.addEventListener("keydown", function (e) {
    /* with a modifier these keys are the browser's (Alt+Left is Back): leave them alone */
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var i = CHAPTERS.indexOf(current), n = CHAPTERS.length, next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i + n - 1) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === " " || e.key === "Spacebar") {
      var t = e.target && e.target.closest ? e.target.closest(".cs-tab") : null;
      if (t) { e.preventDefault(); go(t.getAttribute("data-chapter")); }
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    go(CHAPTERS[next], { replace: true, focus: true, keepScroll: true });
  });

  /* 5. the row parks below the account chip (fixed, top right, js/tabbar.js)
     whenever the two would otherwise share the same strip of screen */
  var mark = d.getElementById("creatorChaptersMark");
  function clearChip() {
    var chip = d.getElementById("mccAuthChip");
    var clear = 0;
    if (chip && !app.hidden) {
      var c = chip.getBoundingClientRect(), r = row.getBoundingClientRect();
      var fixed = w.getComputedStyle(chip).position === "fixed";
      if (fixed && c.width > 0 && r.width > 0 && c.left < r.right && c.right > r.left) clear = Math.ceil(c.bottom + 8);
    }
    /* on the studio, so the row and anything parked under it read the same length */
    app.style.setProperty("--cs-chip-clear", clear + "px");
    parked();
    keepClear();
    if (current) reachable(panels[current]);
    settle();
  }
  /* A field that takes focus is scrolled clear of the parked row above and of the shared bar fixed at the
     bottom (js/tabbar.js), instead of landing underneath one of them (WCAG 2.2, 2.4.11 Focus Not Obscured).
     Both are measured, never assumed; the page's own scrolling is otherwise unchanged. */
  function keepClear() {
    var root = d.documentElement;
    if (app.hidden) { root.style.scrollPaddingTop = ""; root.style.scrollPaddingBottom = ""; return; }
    var park = parseFloat(w.getComputedStyle(row).top) || 0;
    root.style.scrollPaddingTop = Math.ceil(park + row.offsetHeight + 12) + "px";
    var bar = d.querySelector(".appbar"), under = 0;
    if (bar && w.getComputedStyle(bar).position === "fixed") {
      var b = bar.getBoundingClientRect(), vh = w.innerHeight || root.clientHeight;
      if (b.height > 0 && b.top > vh / 2) under = Math.ceil(vh - b.top + 12);
    }
    root.style.scrollPaddingBottom = under ? under + "px" : "";
  }
  function parked() {
    if (!mark) return;
    var park = parseFloat(w.getComputedStyle(row).top) || 0;
    row.classList.toggle("is-parked", !app.hidden && mark.getBoundingClientRect().top < park - 0.5);
  }
  var queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    (w.requestAnimationFrame || w.setTimeout)(function () { queued = false; parked(); });
  }
  w.addEventListener("scroll", onScroll, { passive: true });
  w.addEventListener("resize", clearChip);
  w.addEventListener("load", clearChip);
  /* the chip is drawn by the shared bar after sign-in state is known, and the
     studio is un-hidden after that: measure again when either happens */
  if ("MutationObserver" in w) {
    new MutationObserver(clearChip).observe(app, { attributes: true, attributeFilter: ["hidden"] });
  }
  w.addEventListener("mcc:auth-changed", function () { w.setTimeout(clearChip, 0); });

  var first = wanted();
  anchor = first.el;
  show(first.chapter);
  clearChip();
  w.MCC_STUDIO_SHELL = { chapters: CHAPTERS.slice(), go: go, current: function () { return current; } };
})(window, document);
