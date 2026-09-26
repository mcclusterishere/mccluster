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
      return fetch(S.url+"/rest/v1/rpc/eu_is_admin",{
        method:"POST",
        headers:{apikey:S.key,authorization:"Bearer "+t,"content-type":"application/json"},
        body:"{}"
      }).then(function(r){return r.ok?r.json():false;});
    }).then(function(ok){
      if(ok===true) location.replace("control.html"+target);
    }).catch(function(){});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",check);
  else check();
})();
