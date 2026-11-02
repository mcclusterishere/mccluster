/* THE SONG-LED DOOR (free-website.html).

   Three things, nothing more: sound only on the visitor's press (and captions from the song's own caption file,
   read at runtime from assets/captions/antisocial.en.vtt, never typed here); the template the visitor chose kept
   across sign-in through account.html?next=…; and the existing analytics attribute (data-cta) on each door, which
   the site's consent-gated collector already understands. No new tracking, no autoplay, no promises. */
(function (w, d) {
  "use strict";
  var audio = d.getElementById("fwAudio"), play = d.getElementById("fwPlay"), line = d.getElementById("fwCaptionLine");
  var toggle = d.getElementById("fwTranscript"), lyrics = d.getElementById("fwLyrics");
  if (!audio || !play) return;
  var reduced = w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- sound: opt in, and say what is happening ---------- */
  function setPlaying(on) { play.setAttribute("aria-pressed", String(on)); play.textContent = on ? "Pause Antisocial" : "Play Antisocial"; }
  play.addEventListener("click", function () {
    if (audio.paused) { var p = audio.play(); if (p && p.catch) p.catch(function () { line.textContent = "Your browser did not start the sound. Press play again."; }); }
    else audio.pause();
  });
  audio.addEventListener("play", function () { setPlaying(true); });
  audio.addEventListener("pause", function () { setPlaying(false); });
  audio.addEventListener("ended", function () { setPlaying(false); line.textContent = ""; });
  audio.addEventListener("error", function () { line.textContent = "The song could not be loaded. The page still works without it."; });

  /* ---------- captions: the track the asset ships with ---------- */
  var track = audio.textTracks && audio.textTracks[0];
  if (track) {
    track.mode = "hidden";
    track.addEventListener("cuechange", function () {
      var cues = track.activeCues; line.textContent = cues && cues.length ? Array.prototype.map.call(cues, function (c) { return c.text; }).join(" ") : "";
    });
  }
  /* the words, as the caption file carries them, on request; cues come from the same file, not from this script */
  var loaded = false;
  if (toggle && lyrics) toggle.addEventListener("click", function () {
    var open = lyrics.hidden; lyrics.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); toggle.textContent = open ? "Hide the words" : "Show the words";
    if (!open || loaded) return; loaded = true;
    fetch("assets/captions/antisocial.en.vtt", { cache: "force-cache" }).then(function (r) { if (!r.ok) throw new Error("captions unavailable"); return r.text(); }).then(function (vtt) {
      var blocks = vtt.split(/\r?\n\r?\n/).filter(function (b) { return /-->/.test(b); });
      lyrics.replaceChildren();
      blocks.forEach(function (b) { var text = b.split(/\r?\n/).filter(function (l) { return l && !/-->/.test(l) && !/^\d+$/.test(l); }).join(" ").replace(/<[^>]+>/g, ""); if (text) { var p = d.createElement("p"); p.textContent = text; lyrics.appendChild(p); } });
      if (!lyrics.childNodes.length) lyrics.textContent = "The caption file has no words to show.";
    }).catch(function () { lyrics.textContent = "The words could not be loaded from the caption file."; });
  });

  /* ---------- the chosen template survives sign-in ---------- */
  Array.prototype.forEach.call(d.querySelectorAll("[data-template]"), function (a) {
    a.addEventListener("click", function () {
      try { w.sessionStorage.setItem("free-website-intent", a.getAttribute("data-template")); } catch (_) {}
      if (!audio.paused && !reduced) audio.pause();
    });
  });
  /* a signed-in visitor skips account.html: the editor is the next page already */
  function direct() {
    var s = w.MCC && w.MCC.session && w.MCC.session();
    if (!s || !s.access_token) return;
    Array.prototype.forEach.call(d.querySelectorAll("[data-template]"), function (a) {
      var m = a.getAttribute("href").match(/next=([^&]+)/); if (m) a.setAttribute("href", decodeURIComponent(m[1]));
    });
  }
  if (w.MCC && w.MCC.session) direct(); else w.addEventListener("mcc:auth-changed", direct);
  w.__MCC_FREE_WEBSITE = { direct: direct };
})(window, document);
