/* ============================================================
   THE INTUITION — mind reading, done honestly.

   Two moves that make the site feel like it already knows:

   THE REACH   the moment a hand drifts toward a door — hover,
               first touch, keyboard focus — that page is already
               being fetched. By the time the tap lands, the next
               room is warm. Navigation stops feeling like
               loading and starts feeling like being expected.

   THE WHISPER one quiet suggestion per session, never more,
               drawn from what actually happened: a listener two
               records deep is told the masters can live in their
               pocket; a returning visitor is offered the exact
               record they stopped in the middle of; a long look
               at the gallery is answered with the booking desk.
               Dismiss it and it stays gone.

   No fingerprinting, no third parties, nothing leaves the page.
   The site reads intent the way a good host does: by paying
   attention.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- THE REACH ---------------- */
  var warmed = {};
  function warm(a) {
    if (!a || !a.href) return;
    if (a.origin !== location.origin) return;
    if (a.getAttribute("href").charAt(0) === "#") return;
    var u = a.href.split("#")[0];
    if (warmed[u] || u === location.href.split("#")[0]) return;
    if (!/\.html(\?|$)/.test(u) && !/\/$/.test(u)) return;
    warmed[u] = 1;
    var l = document.createElement("link");
    l.rel = "prefetch";
    l.href = u;
    l.as = "document";
    document.head.appendChild(l);
  }
  ["pointerenter", "touchstart", "focusin"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (a) warm(a);
    }, ev === "pointerenter" ? true : { capture: true, passive: true });
  });

  /* ---------------- THE WHISPER ---------------- */
  var SEEN = "mcc_whispered";
  function spoken() { try { return sessionStorage.getItem(SEEN) === "1"; } catch (e) { return false; } }
  function speak(text, doorLabel, doorHref, onGo) {
    if (spoken()) return;
    try { sessionStorage.setItem(SEEN, "1"); } catch (e) {}
    var w = document.createElement("div");
    w.className = "intu";
    w.setAttribute("role", "status");
    w.innerHTML = '<p>' + text + "</p>" +
      '<a href="' + doorHref + '" data-go>' + doorLabel + ' <span aria-hidden="true">&#8594;</span></a>' +
      '<button type="button" data-shut aria-label="Dismiss"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:1em;height:1em;vertical-align:-2px"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    document.body.appendChild(w);
    requestAnimationFrame(function () { w.classList.add("on"); });
    var gone = false;
    function shut() {
      if (gone) return;
      gone = true;
      w.classList.remove("on");
      setTimeout(function () { w.remove(); }, 500);
    }
    w.querySelector("[data-shut]").addEventListener("click", shut);
    w.querySelector("[data-go]").addEventListener("click", function (e) {
      if (onGo) { e.preventDefault(); onGo(); }
      shut();
    });
    setTimeout(shut, 14000);
    if (window.MCC_TRACK) window.MCC_TRACK("whisper", { text: text.slice(0, 40) });
  }

  var page = location.pathname.split("/").pop() || "index.html";

  /* a returning listener left a record mid-spin: offer the exact spot */
  if (page === "index.html") {
    var radio = null;
    try { radio = JSON.parse(localStorage.getItem("mcc_here_radio")); } catch (e) {}
    if (radio && !spoken()) {
      setTimeout(function () {
        speak("The record remembers where you stopped.", "Pick it back up", "album.html");
      }, 6000);
    }
  }

  /* two records deep and nothing in the pocket: the masters are the move */
  if (page === "album.html") {
    var deck = document.getElementById("deck");
    var plays = 0;
    if (deck) {
      deck.addEventListener("play", function () {
        plays++;
        if (plays === 2 && !spoken()) {
          setTimeout(function () {
            var rail = document.getElementById("labelRail");
            speak("Two records deep. Download the album and airplane mode can't touch it.",
              "Keep the masters", "#labelRail", function () {
                if (rail) rail.scrollIntoView({ behavior: "smooth", block: "center" });
              });
          }, 2500);
        }
      });
    }
  }

  /* a long look through the lens: answer it with the booking desk */
  if (page === "gallery.html") {
    setTimeout(function () {
      if (!spoken() && !document.hidden) {
        speak("Twenty seconds says the lens is speaking to you. It books.",
          "Book a shoot", "hire.html");
      }
    }, 22000);
  }
})();
