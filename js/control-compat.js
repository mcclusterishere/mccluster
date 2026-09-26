/* Compatibility bridge for former standalone operator rooms.
   Direct visits return to the canonical Control Room. The same pages can be
   mounted inside Control with ?control_embed=1 while their feature code is
   migrated into native Control modules. */
(function () {
  "use strict";
  var script=document.currentScript;
  var target=(script&&script.getAttribute("data-control-target"))||"#home";
  var embed=false;
  try{embed=new URLSearchParams(location.search).get("control_embed")==="1";}catch(_){}
  if(!embed){
    location.replace("control.html"+target);
    return;
  }
  document.documentElement.classList.add("control-embed");
  var style=document.createElement("style");
  style.textContent=[
    ".control-embed .appbar,.control-embed .mh,.control-embed .cmdk,.control-embed .cmdk-hint{display:none!important}",
    ".control-embed body{padding-bottom:24px!important}",
    ".control-embed [data-appnav]{display:none!important}"
  ].join("");
  document.head.appendChild(style);
})();
