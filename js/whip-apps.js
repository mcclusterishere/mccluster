/* ============================================================
   THE REAL APPS, IN THE PAGE.

   WHAT STOOD HERE. A simulation: three hand-written flows that looked
   like Rider, Driver and Rentals and quoted their fees off the live
   policy. It was built without checking whether the apps existed. They
   did — mcclusterishere/Whip-Equipped, -Driver and -Rentals — finished,
   with a Leaflet map on live tiles, Supabase auth, Stripe payment
   intents on a connected account, and ride polling across a real state
   machine. A mock next to a real app is worth nothing, so the mock is
   gone and these are the applications themselves.

   They are vendored under apps/ from those three repositories and run in
   an iframe inside the phone. Same code that ships to the App Store
   builds, pointed at the same API this site's Worker serves. Nothing is
   reimplemented here: if the app changes in its own repo, it changes
   here when it is copied across, and there is no second version of the
   logic to drift.

   THE API IS THE LIVE ONE. ?api=https://api.mccluster.org is passed
   explicitly even though each app now defaults to it, because the param
   is the app's own documented override and it makes what this page is
   pointing at readable in the markup instead of buried in a bundle.
   ============================================================ */
window.MCC_WHIP = (function () {
  "use strict";

  var API = "https://api.mccluster.org";
  var APPS = {
    rider: { path: "whip/rider/index.html", name: "Whip Equipped Rider" },
    driver: { path: "whip/driver/index.html", name: "Whip Equipped Driver" },
    rentals: { path: "whip/rentals/index.html", name: "Whip Equipped Rentals" }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function mount(el, key) {
    var app = APPS[key];
    if (!el || !app) return function () {};
    var src = app.path + "?api=" + encodeURIComponent(API) + "&embed=1";

    el.innerHTML =
      '<div class="wd">' +
        '<div class="wd__phone"><div class="wd__notch"></div>' +
          '<iframe class="wd__frame" title="' + esc(app.name) + '" src="' + esc(src) + '"' +
            ' loading="lazy" allow="geolocation"' +
            ' sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>' +
        "</div>" +
        '<p class="wd__legal">The real ' + esc(app.name) +
          ', running against <a href="' + API + '/api/config" rel="noopener">api.mccluster.org</a>. ' +
          'Signing in creates a real account. Payments run on Stripe test keys, so a card is ' +
          'authorized but never charged. ' +
          '<a href="' + esc(app.path) + '?api=' + encodeURIComponent(API) + '" target="_blank" rel="noopener">Open full screen &#8599;</a></p>' +
      "</div>";

    /* the iframe holds a live session and a poll timer; dropping the node
       is what stops both, so closing the panel has to actually empty it */
    return function () { el.innerHTML = ""; };
  }

  return { mount: mount };
})();
