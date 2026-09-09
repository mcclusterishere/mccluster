/* HERE Material System 2.0 light driver is retired. This compatibility file
   remains a clean 200 for old pages. Fellowship uses it as a narrow legacy
   bridge so the inline terminal can gain the Policy OS intake without a risky
   rewrite of the question UI. */
(function(){
  "use strict";
  if(!/\/fellowship\.html$/.test(location.pathname))return;

  function loadLive(){
    if(document.querySelector('script[data-eu-fellowship-live]'))return;
    var s=document.createElement("script");
    s.src="js/equity-uprise-fellowship-live.js?v=__STAMP__";
    s.dataset.euFellowshipLive="1";
    document.head.appendChild(s);
  }

  if(window.MCC_SUPA){loadLive();return;}
  var backend=document.createElement("script");
  backend.src="js/backend.js?v=__STAMP__";
  backend.dataset.euBackendBridge="1";
  backend.onload=loadLive;
  backend.onerror=loadLive; // adapter preserves the email fallback if backend loading fails
  document.head.appendChild(backend);
})();
