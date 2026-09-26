/* McCluster name integrity — conservative account-intake screening.
   This rejects obvious placeholder/gibberish input. It is NOT government-ID
   verification and must never be represented as such. */
(function (root) {
  "use strict";

  var BLOCKED_PHRASES = new Set([
    "dog chicken feet",
    "fake name",
    "test user",
    "asdf qwerty",
    "qwerty asdf",
    "first last",
    "firstname lastname",
    "null null",
    "undefined undefined"
  ]);

  function clean(value) {
    var s = String(value || "");
    try { s = s.normalize("NFKC"); } catch (_) {}
    return s.trim().replace(/\s+/g, " ");
  }

  function lettersOnlyEnough(value) {
    try { return /\p{L}/u.test(value); }
    catch (_) { return /[A-Za-z]/.test(value); }
  }

  function hasBadChars(value) {
    if (/\d/.test(value) || /https?:|www\.|@/.test(value)) return true;
    try { return /[^\p{L}\p{M}\s.'’\-]/u.test(value); }
    catch (_) { return /[^A-Za-zÀ-ÖØ-öø-ÿ\s.'’\-]/.test(value); }
  }

  function partOkay(value) {
    if (!value || value.length < 1 || value.length > 80) return false;
    if (!lettersOnlyEnough(value) || hasBadChars(value)) return false;
    if (/(.)\1{4,}/i.test(value)) return false;
    return true;
  }

  function validate(firstName, lastName) {
    var first = clean(firstName), last = clean(lastName);
    if (!first || !last) return { ok: false, reason: "Enter your legal first and last name." };
    if (!partOkay(first) || !partOkay(last)) {
      return { ok: false, reason: "Enter a plausible legal name using letters, spaces, apostrophes, periods, or hyphens." };
    }
    var combined = (first + " " + last).toLowerCase();
    if (BLOCKED_PHRASES.has(combined)) {
      return { ok: false, reason: "That looks like placeholder or fake account information." };
    }
    var tokens = combined.replace(/[.'’\-]/g, " ").split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && tokens.every(function (t) { return t === tokens[0]; })) {
      return { ok: false, reason: "That looks like repeated placeholder text." };
    }
    return { ok: true, first_name: first, last_name: last, legal_name: first + " " + last };
  }

  root.MCC_NAME_INTEGRITY = { validate: validate, clean: clean };
})(window);
