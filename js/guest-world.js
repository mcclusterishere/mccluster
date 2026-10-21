/* Shared guest-only globe embed: add #guestWorld and an iframe[data-src] to any public landing page. */
(function(){'use strict';
var panel=document.getElementById('guestWorld');if(!panel)return;
var frame=panel.querySelector('iframe[data-src]');var epoch=0;
/* Control → Create → Front page previews the page as a visitor gets it; the frame shares the owner's session, so the
   guest-only World is shown there as a guest would see it (js/control-room/front-page.js, Codex #591) */
var preview=(function(){try{return window.parent!==window&&window.parent.location.origin===location.origin&&/control\.html$/.test(window.parent.location.pathname);}catch(e){return false;}})();
function sessionPresent(){try{var s=JSON.parse(localStorage.getItem('mccdb_session')||'null');if(!s||!s.access_token)return false;var part=s.access_token.split('.')[1];var payload=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));return Number(payload.exp||0)*1000>Date.now();}catch(e){return false;}}
function render(){var seq=++epoch;var bar=window.MCC_BAR;var maybe=bar&&bar.refreshAuth?bar.refreshAuth():Promise.resolve(null);Promise.resolve(maybe).then(function(auth){if(seq!==epoch)return;var signedIn=preview?false:auth&&auth.verified?auth.signed_in:sessionPresent();panel.hidden=!!signedIn;if(!signedIn&&frame&&!frame.src)frame.src=frame.getAttribute('data-src');}).catch(function(){if(seq!==epoch)return;panel.hidden=!preview&&sessionPresent();if(!panel.hidden&&frame&&!frame.src)frame.src=frame.getAttribute('data-src');});}
render();window.addEventListener('mcc:auth-changed',render);window.addEventListener('storage',function(e){if(e.key==='mccdb_session')render()});
})();