/* ============================================================
   THE LENS — the document opens on the page it was claimed on.

   Two things on this site want to open in place instead of
   throwing the reader out of the room:

     [data-lens]  a credential. The pill is a real <a> pointing at
                  the PDF, so with no JavaScript, a middle-click, or
                  a command-click it does the plainly useful thing
                  and opens the document. With JavaScript it opens
                  the SCAN — the paper itself, at full fidelity —
                  and the PDF stays one click away in the caption.

     [data-pop]   a door. The card is a real <a> to a real page and
                  carries a <template> with the short version. The
                  popup is a preview, never a replacement: the door
                  to the full page is the last thing in it.

   Rules the popup keeps, because a popup that breaks any of them
   is worse than no popup at all:

   - It is a native <dialog>. showModal() gives the focus trap, the
     inert background, the Escape key and the ::backdrop for free,
     and gives them the same way the platform gives them everywhere
     else. No hand-rolled trap to get wrong.
   - preventDefault() is called only once the popup is KNOWN to be
     buildable. A missing template or a stripped attribute means the
     link simply navigates, which is what it always said it would do.
   - A modified click — command, control, shift, alt, or the middle
     button — is never intercepted. "Open in a new tab" is a promise
     the browser made, not ours to break.
   - Opening pushes one history entry, so the Android back gesture
     closes the document instead of leaving the page.
   - The scroll lock is WRITTEN on open and CLEARED on close. It is
     never captured first. dialog.close() queues its close event
     instead of firing it there and then, so a reader who shuts one
     document and reaches for the next one in the same breath — which
     is the whole point of a wall of nine documents — gets a second
     open before the first close has drained. A capture in that gap
     reads back the "hidden" the first open just wrote, and every
     close from then on faithfully restores the lock: the dialog is
     shut, the page never scrolls again, and only a reload gets out.
     Nothing on these pages leaves an inline overflow on <html> worth
     preserving (js/gate.js writes the same property and clears it the
     same way, and the two are never open at once), so clearing to ""
     hands the value back to the stylesheet, which is the truth.
   - Focus goes into the dialog on open and comes back to the exact
     trigger on close, including when Escape did the closing.
   - Every value that reaches innerHTML goes through esc() first.
     The attributes are ours today; they are still user input the
     moment somebody pastes a caption with an angle bracket in it.
   ============================================================ */
(function () {
  "use strict";

  if (!document.querySelector("[data-lens],[data-pop]")) return;
  /* no <dialog> means an old engine: leave every link exactly as it
     is written in the markup. The PDF and the page both still work. */
  var probe = document.createElement("dialog");
  if (typeof probe.showModal !== "function") return;

  var CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" '
    + 'stroke-width="2.2" stroke-linecap="round"/></svg>';

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* the shell is built once and refilled; two fills, one frame */
  var dlg = null, body = null, xbtn = null;
  var opener = null;     /* who to hand focus back to */
  var pushed = false;    /* did WE add the history entry */

  function shell() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "lens";
    dlg.innerHTML =
      '<button type="button" class="lens__x" data-lens-close>'
      + CROSS + '<span class="sr-only">Close</span></button>'
      + '<div class="lens__body"></div>';
    document.body.appendChild(dlg);
    body = dlg.querySelector(".lens__body");
    xbtn = dlg.querySelector("[data-lens-close]");

    xbtn.addEventListener("click", function () { dlg.close(); });
    /* a click that lands on the dialog element itself landed on the
       backdrop: everything real is inside .lens__body or the button */
    dlg.addEventListener("mousedown", function (e) { if (e.target === dlg) dlg.close(); });

    dlg.addEventListener("close", function () {
      document.documentElement.style.overflow = "";
      body.innerHTML = "";
      if (pushed) { pushed = false; history.back(); }
      if (opener) { try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); } }
      opener = null;
    });

    window.addEventListener("popstate", function () {
      if (dlg.open) { pushed = false; dlg.close(); }
    });
    return dlg;
  }

  function show(trigger, label) {
    shell();
    opener = trigger;
    dlg.setAttribute("aria-label", label || "Document");
    document.documentElement.style.overflow = "hidden";
    dlg.showModal();
    try { history.pushState({ mccLens: 1 }, ""); pushed = true; }
    catch (e) { pushed = false; }
    try { xbtn.focus({ preventScroll: true }); } catch (e) { xbtn.focus(); }
    if (window.MCC_TRACK) window.MCC_TRACK("lens_open", { label: label || "" });
  }

  /* ---------- fill one: the scan ---------- */
  function openScan(a) {
    var img = a.getAttribute("data-lens");
    var doc = a.getAttribute("data-lens-doc") || a.getAttribute("href") || "";
    var cap = a.getAttribute("data-lens-cap") || (a.textContent || "").trim();
    show(a, cap);
    body.innerHTML =
      '<figure class="lens__fig">'
      + '<img class="lens__img" alt="' + esc(cap) + '">'
      + '<figcaption class="lens__cap"><span>' + esc(cap) + '</span>'
      + (doc ? '<a class="lens__doc" href="' + esc(doc) + '" target="_blank" rel="noopener">'
        + 'Open the PDF</a>' : "")
      + '</figcaption></figure>';
    var el = body.querySelector(".lens__img");
    var swapped = false;
    /* a scan that will not load must still say what it was and where the
       paper is, rather than leaving a broken frame on the record */
    function miss() {
      if (swapped) return;
      swapped = true;
      var p = document.createElement("p");
      p.className = "lens__miss";
      p.innerHTML = "The scan did not load. " + (doc
        ? 'The document itself is here: <a href="' + esc(doc) + '" target="_blank" rel="noopener">'
          + esc(doc.split("/").pop()) + "</a>."
        : "");
      el.replaceWith(p);
    }
    el.addEventListener("error", miss);
    el.addEventListener("load", function () { if (!el.naturalWidth) miss(); });
    /* the address goes on LAST: set it in the markup above and a cached
       failure can beat the listener to the event and never be caught */
    el.src = img;
    if (el.complete && !el.naturalWidth) miss();
  }

  /* ---------- fill two: the summary ---------- */
  function openPop(a, tpl) {
    var cap = a.getAttribute("data-pop-cap")
      || (a.querySelector("b") ? a.querySelector("b").textContent : (a.textContent || "").trim());
    show(a, cap);
    body.appendChild(tpl.content.cloneNode(true));
    /* the door out of the preview is the card's own destination —
       one href, declared once in the markup, never retyped here */
    var go = body.querySelector("[data-pop-go]");
    if (go && !go.getAttribute("href")) go.setAttribute("href", a.getAttribute("href") || "#");
  }

  /* ---------- the one listener ---------- */
  document.addEventListener("click", function (e) {
    if (e.button !== 0 && e.button !== undefined) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest("[data-lens],[data-pop]") : null;
    if (!a) return;
    if (a.hasAttribute("target") && a.getAttribute("target") !== "_self") return;

    if (a.hasAttribute("data-lens")) {
      if (!a.getAttribute("data-lens")) return;   /* nothing to show: let it navigate */
      e.preventDefault();
      openScan(a);
      return;
    }
    var tpl = document.getElementById(a.getAttribute("data-pop"));
    if (!tpl || !tpl.content) return;             /* no template: let it navigate */
    e.preventDefault();
    openPop(a, tpl);
  });
})();
