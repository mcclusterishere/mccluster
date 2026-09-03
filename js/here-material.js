/* HERE Material System 2.0 light driver — REMOVED 2026-08-15 by the owner's
   call. The old skin remains retired.

   album.html still loads this compatibility stub, so it carries one scoped
   piece of presentation logic for the private listening room. No other page
   is changed. */
(function () {
  "use strict";
  if (!document.body || !document.body.classList.contains("music-room--album")) return;

  document.body.classList.add("music-lounge-v2");

  var greet = document.querySelector(".greet");
  var sub = document.querySelector(".greet__sub");
  if (greet) greet.textContent = "The Listening Room.";
  if (sub) sub.textContent = "Independent releases, films and civic records. Built to be entered, not scrolled past.";

  var curated = document.querySelector("#featWrap .lib__k");
  var playlists = document.querySelector("#plWrap .lib__k");
  if (curated) curated.textContent = "Selected releases";
  if (playlists) playlists.textContent = "Private sets";

  var chips = document.querySelectorAll("#chips [data-chip]");
  chips.forEach(function (b) {
    var key = b.getAttribute("data-chip");
    if (key === "all") b.textContent = "Catalogue";
    if (key === "albums") b.textContent = "Releases";
    if (key === "playlists") b.textContent = "Sets";
  });

  var rot = document.querySelector('.top__circle[href*="my-rotation"]');
  if (rot) rot.setAttribute("aria-label", "Private collection");

  var cat = document.querySelector('.top__circle[href="catalogue.html"]');
  if (cat) cat.setAttribute("aria-label", "Catalogue index");
})();