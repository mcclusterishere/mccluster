/* Customer-facing pages stay customer-facing, but an authenticated McCluster
   operator is returned to the one admin shell instead of seeing a second desk. */
(function () {
  "use strict";
  var script=document.currentScript;
  var target=(script&&script.getAttribute("data-control-target"))||"#home";
  function check(){
    var S=window.MCC_SUPA;
    if(!S||!S.token||!S.url||!S.key)return;
    S.token().then(function(t){
      if(!t)return false;
      return fetch("https://api.mccluster.org/v1/status",{
        method:"GET",
        headers:{authorization:"Bearer "+t},
        cache:"no-store"
      }).then(function(r){return r.ok;});
    }).then(function(ok){
      if(ok) location.replace("control.html"+target);
    }).catch(function(){});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",check);
  else check();
})();
