/* McCluster operator registry.
   There is one admin shell, control.html, and one navigation definition,
   js/control-room/nav.js. This file is that definition read as a flat list
   for the owner palette on other pages (js/control-palette.js): every entry
   points back into a Control hash, and is found by its old names too. */
(function (root) {
  "use strict";
  var N = root.CR && root.CR.nav;
  if (!N) { if (root.console) root.console.warn("control-registry: js/control-room/nav.js did not load first"); return; }
  var SURFACES = N.entries();
  var GROUPS = N.NAV.map(function (s) { return s.label; });
  function byGroup() { return GROUPS.map(function (g) { return { group: g, items: SURFACES.filter(function (s) { return s.group === g; }) }; }).filter(function (g) { return g.items.length; }); }
  root.MCC_SURFACES = { all: SURFACES, groups: GROUPS, byGroup: byGroup, search: N.search, get: function (id) { return SURFACES.find(function (s) { return s.id === id; }) || null; } };
})(window);
