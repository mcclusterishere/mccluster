/* ============================================================
   THE VOLUME CALL — "turn it up", pointed at the actual key.

   Apple's Double Click to Pay works because it does not describe
   the button, it draws one on the screen edge the real button is
   behind, and animates toward it. Nobody reads it; they just look
   where it points and press.

   This is that, for volume. The rocker is drawn flush against the
   edge THIS device keeps its volume keys on — left for an iPhone,
   right for a Samsung or a Pixel — at roughly the height the keys
   physically sit, and chevrons run outward from the card into the
   bezel. Anything that cannot be pointed at honestly (a laptop, an
   iPad whose generation the UA will not reveal) gets a plain
   prompt aimed at the site's own Sound pill instead of a confident
   arrow at hardware that may not be there.

   Shows once a session, only while the site is silent, and gets
   out of the way at the first sign of a visitor: a scroll, the
   sound coming on, or eight seconds of being ignored. While it is
   up, ANY tap on open ground starts the record — not just a tap
   on the card. No phone tells a web page its volume keys were
   pressed, so the screen touch is the trigger; making the whole
   screen the target means the natural motion (thumb on the
   rocker, tap the glass) always lands.
   ============================================================ */
(function () {
  "use strict";

  var KEY = "mcc-volcall";           // once a session, never across visits
  var SHOW_AFTER = 900;              // let the hero letters land first
  var LIFESPAN = 8000;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var toggle = document.getElementById("soundToggle");
    if (!toggle) return;                       // no sound on this page, no ask

    try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}

    var dev = window.MCC_DEVICE || { kind: "computer", name: "device", volumeSide: null };
    var side = dev.volumeSure ? dev.volumeSide : null;
    var el, timer, done = false, taken = false;

    /* the rocker: two stacked keys, the upper one lit, because up is
       the direction being asked for */
    function rocker(vertical) {
      var box = vertical ? "0 0 22 74" : "0 0 74 22";
      var up = vertical
        ? '<rect class="volcall__key volcall__key--up" x="3" y="2" width="16" height="32" rx="8"/>'
        : '<rect class="volcall__key volcall__key--up" x="40" y="3" width="32" height="16" rx="8"/>';
      var down = vertical
        ? '<rect class="volcall__key" x="3" y="40" width="16" height="32" rx="8"/>'
        : '<rect class="volcall__key" x="2" y="3" width="32" height="16" rx="8"/>';
      return '<svg class="volcall__rocker" viewBox="' + box + '" aria-hidden="true">' + down + up + "</svg>";
    }

    /* three chevrons running toward the bezel */
    function chevrons(dir) {
      var d = dir === "left" ? "M13 4L5 12l8 8"
        : dir === "right" ? "M11 4l8 8-8 8"
        : "M4 13l8-8 8 8";
      var out = "";
      for (var i = 0; i < 3; i++) {
        out += '<svg class="volcall__chev" style="--i:' + i + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
      }
      return '<span class="volcall__chevs">' + out + "</span>";
    }

    var speaker = '<svg class="volcall__spk" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z"/>'
      + '<path d="M16 9.2a4 4 0 0 1 0 5.6"/><path d="M18.6 6.4a8 8 0 0 1 0 11.2"/></svg>';

    function build() {
      el = document.createElement("div");
      el.className = "volcall volcall--" + (side || "none");
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", "Turn the sound on");

      var card = '<span class="volcall__card">'
        + '<span class="volcall__spkwrap">' + speaker + "</span>"
        + '<b class="volcall__big">Turn your volume up</b>'
        + '<span class="volcall__sub">' + (side
          ? "Then tap \u2014 your " + dev.name + "'s keys are right here"
          : "Then tap \u2014 the record comes up soft") + "</span>"
        + "</span>";

      /* With a known side, the pointer aims at real hardware in the bezel.
         Without one, there is nothing honest to point at out there — so it
         aims up at the Sound pill instead, and parks beside it rather than
         bottom-centre, which is the tuner's grab bar. */
      el.innerHTML = side
        ? card + chevrons(side) + '<span class="volcall__edge">' + rocker(side !== "top") + "</span>"
        : chevrons("top") + card;
      document.body.appendChild(el);
      /* One ask, one voice. The Sound pill runs its own "Tap for sound"
         hint on a loop; while this card is up, two prompts are competing
         for the same single action in the same corner of the same
         viewport. The flag lets CSS silence the pill's hint until the
         card is gone. */
      document.documentElement.classList.add("volcall-on");
      requestAnimationFrame(function () { el.classList.add("is-in"); });
      if (window.MCC_TRACK) {
        window.MCC_TRACK("volume_call", { device: dev.name, side: side || "none" });
      }
    }

    function close(why) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
      document.documentElement.classList.remove("volcall-on");
      if (el) {
        el.classList.remove("is-in");
        setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 420);
      }
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", anyTap, true);
      if (window.MCC_TRACK) window.MCC_TRACK("volume_call_end", { why: why });
    }

    /* one scroll is a visitor who has moved on; the prompt is not a wall */
    var y0 = window.scrollY;
    function onScroll() { if (!taken && Math.abs(window.scrollY - y0) > 120) close("scroll"); }

    /* The record opens from near-silence and rises over several seconds, and
       the call HOLDS through that rise instead of leaving with the tap. That
       is the whole point of having pointed at the keys: the sound arrives
       while the hand is still on the rocker, so riding it up — or killing it
       — is a press away, not a hunt.

       No browser reports a hardware volume press, so the tap is what starts
       the music. What is bought here is the order of events. */
    function take(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (toggle.classList.contains("is-on")) { close("already-on"); return; }

      /* claim it BEFORE starting the sound: setSound announces "now playing"
         synchronously, and the listener below would read our own echo as
         someone else turning the sound on and close the card mid-rise */
      taken = true;
      var rise = 0;
      if (typeof window.MCC_SOUND_GENTLE === "function") rise = window.MCC_SOUND_GENTLE();
      if (!rise) { taken = false; toggle.click(); close("taken"); return; }

      el.classList.add("is-playing");
      var big = el.querySelector(".volcall__big");
      var sub = el.querySelector(".volcall__sub");
      if (big) big.textContent = "Coming up now";
      if (sub) {
        sub.textContent = side
          ? "These keys set it, either way"
          : "Set it wherever you like";
      }
      el.removeEventListener("click", take);
      if (window.MCC_TRACK) window.MCC_TRACK("volume_call_take", { device: dev.name });
      // hold for the rise, then leave them to it
      clearTimeout(timer);
      timer = setTimeout(function () { close("risen"); }, rise * 1000 + 700);
    }

    /* The Sound pill only appears once the audio manifest lands, so a hidden
       toggle means "not yet", not "never". Wait for it rather than losing
       the ask to a slow fetch — but not forever. */
    /* while the call is up, the whole screen is the button — a tap on
       anything that is not itself a control starts the record */
    function anyTap(e) {
      if (done || taken) return;
      if (e.target.closest("a, button, input, textarea, select, [role=button], .appbar, .mh__cta, .tuner, .pocket, audio, video")) return;
      take(e);
    }

    function open(tries) {
      if (done || toggle.classList.contains("is-on")) return;
      if (toggle.hidden) {
        if ((tries || 0) > 12) return;         // ~6s: this page has no audio
        setTimeout(function () { open((tries || 0) + 1); }, 500);
        return;
      }
      build();
      el.addEventListener("click", take);
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") take(ev);
      });
      document.addEventListener("click", anyTap, true);
      window.addEventListener("scroll", onScroll, { passive: true });
      timer = setTimeout(function () { close("timeout"); }, LIFESPAN);
    }

    // the sound arriving by any other route retires the ask on the spot
    /* sound arriving by any OTHER route retires the ask. Once it is us
       starting it, these are our own echo and must not cut the hold short. */
    toggle.addEventListener("click", function () { if (!taken) close("toggle"); });
    window.addEventListener("mcc:nowplaying", function (e) {
      if (!taken && e.detail && e.detail.playing) close("playing");
    });

    /* the site opens on a preloader; the call belongs to the room behind
       it, so it waits for the hand-off rather than a clock */
    var pre = document.getElementById("preloader");
    if (pre && !pre.classList.contains("is-done")) {
      var mo = new MutationObserver(function () {
        if (pre.classList.contains("is-done")) { mo.disconnect(); setTimeout(function () { open(0); }, SHOW_AFTER); }
      });
      mo.observe(pre, { attributes: true, attributeFilter: ["class"] });
    } else {
      setTimeout(function () { open(0); }, SHOW_AFTER);
    }
  });
})();
