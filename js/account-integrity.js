/* ============================================================
   ACCOUNT INTEGRITY — plausibility checks, not identity proof.

   This catches obvious junk before it spends an auth record: placeholders,
   URLs/emails, numeric strings, repeated keyboard garbage, and a small set
   of known throwaway phrases. It intentionally accepts Unicode letters,
   spaces, apostrophes, periods and hyphens.

   It cannot prove a government identity. Email verification and the
   required account-profile completion gate remain the hard controls.
   ============================================================ */
(function (root) {
  "use strict";

  var BLOCKED = {
    "test":1, "testing":1, "fake":1, "faker":1, "anonymous":1, "anon":1,
    "asdf":1, "qwerty":1, "null":1, "none":1, "n a":1, "na":1,
    "first name":1, "firstname":1, "last name":1, "lastname":1,
    "admin":1, "administrator":1, "user":1, "username":1,
    "dog":1, "chicken":1, "feet":1, "dog chicken feet":1
  };

  function norm(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function reason(part, label) {
    var s = norm(part);
    var low = s.toLowerCase().replace(/[._'’\-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return label + " is required.";
    if (s.length < 2 || s.length > 60) return "Enter a valid " + label.toLowerCase() + ".";
    if (BLOCKED[low]) return "Enter your real " + label.toLowerCase() + ".";
    if (/https?:\/\/|www\.|@/.test(s)) return "A name cannot be a URL or email address.";
    if (/\d/.test(s)) return "A name cannot contain numbers.";
    if (/(.)\1{4,}/iu.test(s)) return "That name looks like repeated placeholder text.";
    try {
      if (!/^[\p{L}\p{M}][\p{L}\p{M}'’\.\- ]*$/u.test(s)) {
        return "Use letters and normal name punctuation only.";
      }
    } catch (_) {
      if (!/^[A-Za-z][A-Za-z'\.\- ]*$/.test(s)) return "Use letters and normal name punctuation only.";
    }
    var words = low.split(" ").filter(Boolean);
    if (words.length && words.every(function (w) { return BLOCKED[w]; })) {
      return "Enter your real " + label.toLowerCase() + ".";
    }
    return "";
  }

  function validateName(first, last) {
    var a = reason(first, "First name");
    if (a) return { ok:false, message:a };
    var b = reason(last, "Last name");
    if (b) return { ok:false, message:b };
    var joined = norm(first) + " " + norm(last);
    var low = joined.toLowerCase().replace(/[._'’\-]+/g, " ").replace(/\s+/g, " ").trim();
    if (BLOCKED[low]) return { ok:false, message:"Enter your real first and last name." };
    return { ok:true, first_name:norm(first), last_name:norm(last), full_name:joined };
  }

  function completeProfile(row) {
    row = row || {};
    return !!(
      norm(row.legal_name) &&
      norm(row.address_line1) &&
      norm(row.city) &&
      norm(row.region) &&
      norm(row.postal_code) &&
      norm(row.country)
    );
  }

  root.MCC_ACCOUNT_INTEGRITY = {
    validateName: validateName,
    completeProfile: completeProfile
  };
})(window);
