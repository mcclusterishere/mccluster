/* Former standalone owner rooms are compatibility URLs only.
   Their functionality lives natively in control.html. */
(function () {
  "use strict";
  var script=document.currentScript;
  var target=(script&&script.getAttribute("data-control-target"))||"#home";
  location.replace("control.html"+target);
})();
