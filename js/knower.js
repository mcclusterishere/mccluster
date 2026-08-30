/* ============================================================
   THE KNOWER — the site addresses the machine by name.

   "your phone" is a stranger's word. The room reads what's
   actually holding it — iPhone, iPad, Samsung, Pixel, Android
   phone, Mac, PC, Chromebook, TV — plus the hour of the day,
   and every line of copy that names the device asks MCC_DEVICE
   instead of guessing.

   Best effort, never creepy: one UA read, no fingerprinting, no
   storage. High-entropy model names come only from the browser's
   own client-hints API where it exists, and only to say
   "Samsung" instead of "Android phone".

   Fills on sight:
     [data-device-phrase]  →  "your iPhone" / "your Samsung" …
     [data-daypart]        →  " · good evening" (by their clock)
   ============================================================ */
(function () {
  "use strict";
  var ua = navigator.userAgent || "";
  var D = { kind: "computer", name: "computer", phrase: "your computer" };

  function set(kind, name) { D.kind = kind; D.name = name; D.phrase = "your " + name; }

  if (/iphone|ipod/i.test(ua)) set("iphone", "iPhone");
  else if (/ipad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) set("ipad", "iPad");
  else if (/smart-?tv|tizen|webos|crkey|googletv|bravia|hbbtv/i.test(ua)) set("tv", "TV");
  else if (/android/i.test(ua)) {
    if (/samsungbrowser|sm-[a-z]\d|samsung/i.test(ua)) set("android", "Samsung");
    else if (/pixel/i.test(ua)) set("android", "Pixel");
    else set("android", /mobile/i.test(ua) ? "Android phone" : "Android tablet");
  }
  else if (/cros/i.test(ua)) set("chromebook", "Chromebook");
  else if (/macintosh/i.test(ua)) set("mac", "Mac");
  else if (/windows/i.test(ua)) set("pc", "PC");
  else if (/linux/i.test(ua)) set("computer", "computer");

  /* the browser's own word beats a UA guess (Android models: SM- = Samsung) */
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues && D.kind === "android") {
    navigator.userAgentData.getHighEntropyValues(["model"]).then(function (h) {
      var m = (h && h.model) || "";
      if (/^sm-/i.test(m)) set("android", "Samsung");
      else if (/pixel/i.test(m)) set("android", "Pixel");
      // the model string also settles the odd handset whose keys are
      // on the far side from the rest of the field
      if (/^(cph|kb|le|in|be|gm|hd|dn|ne|pj|cp)/i.test(m) && /oneplus/i.test(ua)) D.volumeSide = "left";
      D.model = m;
      fill();
      emit();
    }).catch(function () {});
  }

  /* ============================================================
     WHERE THE VOLUME KEYS ARE.

     A prompt that points at hardware has to point at the RIGHT
     hardware — and the physical object in someone's hand is the
     one thing a browser can never actually see. So this is stated
     with a confidence, and callers only draw an edge indicator
     when the answer is sure.

       iPhone   left   every iPhone since the 5 puts volume on the
                       left, under the ringer/Action switch
       OnePlus  left   volume left; alert slider and power right
       Android  right  Galaxy S21+ and Pixel 6+ both stack power
                       over volume on the right, and right is the
                       safe read for most of the rest of the field
       iPad     top    true of every USB-C iPad, but the older
                       home-button models put volume upper-right
                       and nothing in the UA separates them — so
                       this ships as a guess, not a fact
       computer none   no side keys; the keyboard has them

     volumeSide is null wherever there is nothing to point at, and
     `sure` is false where the guess should not be drawn as one.
     ============================================================ */
  if (D.kind === "iphone") { D.volumeSide = "left"; D.volumeSure = true; }
  else if (D.kind === "android") {
    D.volumeSide = /oneplus/i.test(ua) ? "left" : "right";
    D.volumeSure = true;
  } else if (D.kind === "ipad") { D.volumeSide = "top"; D.volumeSure = false; }
  else { D.volumeSide = null; D.volumeSure = false; }

  /* the model name can arrive a beat after boot; anything that drew
     itself from D gets told rather than left holding the first guess */
  function emit() {
    try { window.dispatchEvent(new CustomEvent("mcc:device", { detail: D })); } catch (e) {}
  }

  function daypart() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return "good morning";
    if (h >= 12 && h < 17) return "good afternoon";
    if (h >= 17 && h < 22) return "good evening";
    return "good night";
  }

  /* pages paint copy late (boot scripts, fetched data) — fill is
     idempotent and re-runs on every DOM change, so the name always
     lands and never loops */
  var DP = / · good (morning|afternoon|evening|night)$/;
  function fill() {
    [].forEach.call(document.querySelectorAll("[data-device-phrase]"), function (el) {
      var want = el.getAttribute("data-device-phrase").replace("%d", D.phrase);
      if (el.textContent !== want) el.textContent = want;
    });
    [].forEach.call(document.querySelectorAll("[data-daypart]"), function (el) {
      var base = el.textContent.replace(DP, "");
      var want = base + " · " + daypart();
      if (el.textContent !== want) el.textContent = want;
    });
  }
  function watch() {
    fill();
    if (window.MutationObserver) {
      new MutationObserver(fill).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
  else watch();

  D.daypart = daypart;
  window.MCC_DEVICE = D;
})();
