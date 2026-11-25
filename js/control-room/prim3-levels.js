/* Control · Create · PRIM3 Level Forge (#create:level-forge). The editor shares this site's M Account.
   Launch a full-page workspace so Control refreshes cannot reset an edit.
   Private cloud operations keep their own server-side house-owner checks. */
(function (root) {
  "use strict";
  root.CR = root.CR || {};
  root.CR.prim3Levels = {
    render: function () {
      return '<section class="cr-panel2">' +
        '<div class="cr-panel2__head"><h2>Build a PRIM3 level</h2></div>' +
        '<div class="cr-panel2__body">' +
        '<p>Place buildings, cover, water and terrain on a numbered grid. Set operative spawns, connect rooftops, then play test it in the PRIM3 game itself: the same page, rules and 3.54 m tiles as Transit / Relay.</p>' +
        '<p><a class="cr-btn cr-btn--primary" href="/prim3-level-builder/index.html">Open the Level Forge</a></p>' +
        '<p class="cr-muted">Your browser keeps a working draft. Cloud drafts and playable versions use your M Account.</p>' +
        '</div></section>';
    }
  };
})(window);
