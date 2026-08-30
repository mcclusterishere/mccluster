/* ============================================================
   CHAT PAGE — the menu above the desk.

   Chips type the question into the live widget and send it.
   Doors (anchors) leave the page. Nothing here talks to the
   backend; deskchat.js already owns the thread.
   ============================================================ */
(function () {
  "use strict";
  var menu = document.getElementById("chatMenu");
  if (!menu) return;

  function send(q) {
    var root = document.querySelector(".dsk--inline") || document.querySelector(".dsk");
    var input = root && root.querySelector(".dsk__in");
    var form = root && root.querySelector(".dsk__bar");
    if (!input || !form) return false;
    input.value = q;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    return true;
  }

  menu.addEventListener("click", function (e) {
    var b = e.target.closest("[data-q]");
    if (!b) return;
    var q = b.getAttribute("data-q");
    if (!q) return;
    if (!send(q)) {
      var tries = 0;
      var t = setInterval(function () {
        tries += 1;
        if (send(q) || tries > 20) clearInterval(t);
      }, 150);
    }
    if (window.MCC_TRACK) window.MCC_TRACK("chat_chip", { q: q, page: "chat" });
  });
})();
