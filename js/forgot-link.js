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
(function (d) {
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
    if (hasOwnLink(scope) || input.getAttribute("data-forgot-link") === "1") return;
    input.setAttribute("data-forgot-link", "1");
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
    var anchor = input.parentElement && input.parentElement.tagName === "LABEL" ? input.parentElement : input;
    anchor.insertAdjacentElement("afterend", a);
  }

  function run() {
    Array.prototype.forEach.call(
      d.querySelectorAll('input[type="password"][autocomplete="current-password"]'), addLink);
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", run);
  else run();
})(document);
