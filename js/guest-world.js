/* Shared globe embed (data-profile-world keeps it visible for members): add #guestWorld and an iframe[data-src] to any public landing page. */
(function(){'use strict';
var panel=document.getElementById('guestWorld');if(!panel)return;
var shared=panel.hasAttribute('data-profile-world');
function show(signedIn){
  panel.hidden=shared?false:!!signedIn;
  var entry=panel.querySelector('[data-world-entry]');
  if(entry){entry.textContent=signedIn?'Enter the World →':'Sign in / Join the World →';entry.href=signedIn?'mnet.html?view=feed':'account.html';}
  if(!panel.hidden)watchFrame();
}
var frame=panel.querySelector('iframe[data-src]');var epoch=0;var observer=null;var frameStarted=false;
/* Native lazy iframe navigation can start during a cross-document snapshot and
   strand browser Back. Defer explicitly while leaving the blank frame settled. */
if(frame)frame.loading='eager';
function loadFrame(){
  if(!frame||frameStarted||panel.hidden)return;
  frameStarted=true;if(observer)observer.disconnect();
  frame.src=frame.getAttribute('data-src');
}
function watchFrame(){
  if(!frame||frameStarted)return;
  if(!window.IntersectionObserver){loadFrame();return;}
  if(!observer){observer=new IntersectionObserver(function(entries){if(entries.some(function(entry){return entry.isIntersecting;}))loadFrame();},{rootMargin:'600px'});observer.observe(panel);}
}
/* Control → Create → Front page previews the page as a visitor gets it; the frame shares the owner's session, so the
   guest-only World is shown there as a guest would see it (js/control-room/front-page.js, Codex #591) */
var preview=(function(){try{return window.parent!==window&&window.parent.location.origin===location.origin&&/control\.html$/.test(window.parent.location.pathname);}catch(e){return false;}})();
function sessionPresent(){try{var s=JSON.parse(localStorage.getItem('mccdb_session')||'null');if(!s||!s.access_token)return false;var part=s.access_token.split('.')[1];var payload=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));return Number(payload.exp||0)*1000>Date.now();}catch(e){return false;}}
function render(){var seq=++epoch;var bar=window.MCC_BAR;var maybe=bar&&bar.refreshAuth?bar.refreshAuth():Promise.resolve(null);Promise.resolve(maybe).then(function(auth){if(seq!==epoch)return;var signedIn=preview?false:auth&&auth.verified?auth.signed_in:sessionPresent();show(signedIn);}).catch(function(){if(seq!==epoch)return;show(!preview&&sessionPresent());});}
render();window.addEventListener('mcc:auth-changed',render);window.addEventListener('storage',function(e){if(e.key==='mccdb_session')render()});
})();
