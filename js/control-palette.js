/* ============================================================
   THE COMMAND PALETTE. Cmd/Ctrl-K anywhere on the operator side.

   The complaint it answers: "it needs to logically make sense for me to
   get to where I need to get to without having to guess". A rail helps
   only if you are already on the page that has the rail. This works on
   every admin surface, so wherever you land, one chord gets you anywhere
   -- you type what you want rather than remembering where it lives.

   It reads js/control-registry.js and nothing else, so a surface added
   there is instantly reachable from every page without touching this.
   ============================================================ */
(function (root, doc) {
  "use strict";

  var R = root.MCC_SURFACES;
  if (!R) return;                       // registry absent: stay silent
  if (doc.getElementById("cmdkRoot")) return;  // already mounted

  /* WHO GETS THIS. Some surfaces in the registry are public pages --
     the listening room and Mnet are the product, not the back office --
     and mounting an operator menu there would show every visitor a list
     of the owner's internal desks. Not a hole, since each page gates
     itself, but a map of the house handed to strangers.

     So the palette only mounts for the owner. It reads the same session
     key the rest of the site uses, and on a page with no session (or in
     a private window where storage throws) it simply never appears. */
  var OWNER = "matthew@mccluster.org";

  function isOwner() {
    try {
      var raw = localStorage.getItem("mccdb_session");
      if (!raw) return false;
      var s = JSON.parse(raw);
      var email = s && s.user && s.user.email;
      if (!email && s && s.access_token) {
        /* Fall back to the token's own claim: backend.js and mcc-auth.js
           do not always store the user object, but both store the token. */
        var body = s.access_token.split(".")[1];
        if (body) {
          var pad = body.replace(/-/g, "+").replace(/_/g, "/");
          while (pad.length % 4) pad += "=";
          email = (JSON.parse(atob(pad)) || {}).email;
        }
      }
      return String(email || "").toLowerCase() === OWNER;
    } catch (e) { return false; }
  }

  if (!isOwner()) {
    /* Signing in later should not require a reload to get navigation. */
    root.addEventListener("mcc:auth-changed", function () {
      if (isOwner() && !doc.getElementById("cmdkRoot")) location.reload();
    });
    return;
  }

  var HERE = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  var el = doc.createElement("div");
  el.className = "cmdk";
  el.id = "cmdkRoot";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Go to");
  el.innerHTML =
    '<div class="cmdk__box">' +
      '<input class="cmdk__in" id="cmdkIn" type="text" autocomplete="off" spellcheck="false"' +
        ' placeholder="Where to? Type anything…" aria-label="Search surfaces">' +
      '<ul class="cmdk__list" id="cmdkList" role="listbox"></ul>' +
      '<div class="cmdk__foot">' +
        '<span><kbd>&uarr;</kbd><kbd>&darr;</kbd> move</span>' +
        '<span><kbd>&crarr;</kbd> open</span>' +
        '<span><kbd>esc</kbd> close</span>' +
      '</div>' +
    '</div>';
  doc.body.appendChild(el);

  var hint = doc.createElement("button");
  hint.className = "cmdk-hint";
  hint.type = "button";
  hint.innerHTML = '<span aria-hidden="true">&#9906;</span> Go to&nbsp; <kbd>' +
    (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl") + 'K</kbd>';
  doc.body.appendChild(hint);

  var input = doc.getElementById("cmdkIn");
  var list  = doc.getElementById("cmdkList");
  var rows = [];      // flat, selectable, in painted order
  var cursor = 0;
  var lastFocus = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function paint(q) {
    var matches = R.search(q);
    rows = [];
    if (!matches.length) {
      list.innerHTML = '<li class="cmdk__empty">Nothing matches &ldquo;' + esc(q) + '&rdquo;.</li>';
      return;
    }
    /* Grouped while browsing, flat once you are searching: groups are
       for orientation, and when you have typed something you want the
       best match first, not the best match in the third heading down. */
    var html = "";
    if (!String(q || "").trim()) {
      R.byGroup().forEach(function (g) {
        html += '<li class="cmdk__group">' + esc(g.group) + "</li>";
        g.items.forEach(function (s) { html += rowHtml(s); rows.push(s); });
      });
    } else {
      matches.forEach(function (s) { html += rowHtml(s); rows.push(s); });
    }
    list.innerHTML = html;
    cursor = 0;
    mark();
  }

  function rowHtml(s) {
    var tag = s.state === "legacy" ? '<span class="cmdk__tag cmdk__tag--legacy">legacy</span>'
            : s.state === "dark"   ? '<span class="cmdk__tag cmdk__tag--dark">needs setup</span>'
            : "";
    var here = s.href.toLowerCase() === HERE ? " (you are here)" : "";
    return '<li><a class="cmdk__item" role="option" href="' + esc(s.href) + '">' +
      '<span class="cmdk__label">' + esc(s.label) + esc(here) + "</span>" +
      '<span class="cmdk__blurb">' + esc(s.blurb) + "</span>" + tag +
    "</a></li>";
  }

  function items() { return list.querySelectorAll(".cmdk__item"); }

  function mark() {
    var nodes = items();
    for (var i = 0; i < nodes.length; i++) {
      var on = i === cursor;
      nodes[i].classList.toggle("is-on", on);
      nodes[i].setAttribute("aria-selected", on ? "true" : "false");
      if (on && nodes[i].scrollIntoView) nodes[i].scrollIntoView({ block: "nearest" });
    }
  }

  function open() {
    lastFocus = doc.activeElement;
    el.classList.add("is-open");
    input.value = "";
    paint("");
    input.focus();
  }

  function close() {
    el.classList.remove("is-open");
    // Put focus back where it was, or the page loses the keyboard entirely.
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function go() {
    var node = items()[cursor];
    if (node) location.href = node.getAttribute("href");
  }

  hint.addEventListener("click", open);
  input.addEventListener("input", function () { paint(input.value); });

  el.addEventListener("click", function (e) { if (e.target === el) close(); });

  el.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); cursor = Math.min(cursor + 1, items().length - 1); mark(); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); cursor = Math.max(cursor - 1, 0); mark(); }
    else if (e.key === "Enter")     { e.preventDefault(); go(); }
  });

  doc.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      el.classList.contains("is-open") ? close() : open();
    }
  });

  root.MCC_PALETTE = { open: open, close: close };
})(window, document);
