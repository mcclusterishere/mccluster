/* "FORGOT YOUR PASSWORD?" UNDER EVERY SIGN-IN PASSWORD BOX.

   The reset flow has always existed (forgot-password.html emails a link,
   reset-password.html sets a new password without asking for the old one),
   but ten operator sign-in screens never linked to it, so somebody who
   forgot their password there had no way forward.

   A current password cannot be emailed to anyone: Supabase stores only a
   one-way hash, so the reset link IS the recovery. This adds that link
   under any sign-in password field (autocomplete="current-password") that
   does not already have one nearby, and carries over the email typed in
   the same form so nobody retypes it. Pages with their own forgot button
   (account.html, mnet.html) are left exactly as they are. */
(function (w, d) {
  "use strict";

  function hasOwnLink(scope) {
    if (!scope) return false;
    if (scope.querySelector('a[href*="forgot-password"]')) return true;
    return Array.prototype.some.call(scope.querySelectorAll("button, a"), function (el) {
      return /forgot|reset/i.test(el.textContent || "");
    });
  }

  function scopeOf(input) {
    return input.closest("form") || input.closest("section") || input.parentElement;
  }

  function addLink(input) {
    var scope = scopeOf(input);
    var anchor = input.parentElement && input.parentElement.tagName === "LABEL" ? input.parentElement : input;
    /* Idempotence is read from the DOM, not a marker on the input: a gate
       redrawn from a string can carry a stale marker with no link. */
    var next = anchor.nextElementSibling;
    if (next && next.classList && next.classList.contains("mcc-forgot")) return;
    if (hasOwnLink(scope)) return;
    var a = d.createElement("a");
    a.className = "mcc-forgot";
    a.href = "forgot-password.html";
    a.textContent = "Forgot your password?";
    a.style.cssText = "display:inline-block;margin-top:.5rem;padding:.55rem 0;font-size:.85rem;" +
      "color:inherit;opacity:.85;text-decoration:underline;text-underline-offset:2px";
    a.addEventListener("click", function () {
      var email = scope && scope.querySelector('input[type="email"], input[autocomplete="email"], input[autocomplete="username"]');
      var value = email && String(email.value || "").trim();
      a.href = "forgot-password.html" + (value ? "?email=" + encodeURIComponent(value) : "");
    });
    /* After the field, or after its label when the label wraps it. */
    anchor.insertAdjacentElement("afterend", a);
  }

  function run() {
    Array.prototype.forEach.call(
      d.querySelectorAll('input[type="password"][autocomplete="current-password"]'), addLink);
  }

  /* desk.html, lanes.html and vault.html redraw their sign-in gate with
     innerHTML after a failed attempt, which drops the link and brings a
     fresh password field, at exactly the moment somebody needs the link.
     Watch for added nodes and run again (addLink is idempotent). */
  var queued = false;
  function watch() {
    run();
    if (!w.MutationObserver) return;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      setTimeout(function () { queued = false; run(); }, 50);
    }).observe(d.body, { childList: true, subtree: true });
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", watch);
  else watch();
})(window, document);
