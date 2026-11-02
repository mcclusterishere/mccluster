/* Control · Create · PRIM3 levels. The editor shares this site's M Account.
   Launch a full-page workspace so Control refreshes cannot reset an edit.
   Private cloud operations keep their own server-side house-owner checks. */
(function (root) {
  "use strict";
  root.CR = root.CR || {};
  root.CR.prim3Levels = {
    render: function () {
      return '<section class="cr-panel2">' +
        '<div class="cr-panel2__head"><h2>Build a PRIM3 sector</h2></div>' +
        '<div class="cr-panel2__body">' +
        '<p>Place buildings, cover, water and terrain on a numbered tactical grid. Set operative spawns, connect rooftops and test the mission.</p>' +
        '<p><a class="cr-btn cr-btn--primary" href="/prim3-level-builder/index.html">Open level builder</a></p>' +
        '<p class="cr-muted">Your browser keeps a working draft. Cloud drafts and playable versions use your M Account.</p>' +
        '</div></section>';
    }
  };
})(window);
