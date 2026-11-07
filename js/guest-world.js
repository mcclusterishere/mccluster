/* Shared globe embed (data-profile-world keeps it visible for members): add #guestWorld and an iframe[data-src] to any public landing page. */
(function(){'use strict';
var panel=document.getElementById('guestWorld');if(!panel)return;
var shared=panel.hasAttribute('data-profile-world');
function show(signedIn){
  var state=document.documentElement.getAttribute('data-front-state');
  var disabled=(state&&state!=='ready')||(window.MCC_SITE_POLICY&&window.MCC_SITE_POLICY.world!==true);
  panel.hidden=!!disabled||(shared?false:!!signedIn);
  var entry=panel.querySelector('[data-world-entry]');
  if(entry){entry.textContent=signedIn?'Enter the World →':'Sign in / Join the World →';entry.href=signedIn?'mnet.html?view=feed':'account.html';}
  if(!panel.hidden)watchFrame();
  else {
    clearTimeout(recoveryTimer);recoveryTimer=0;if(observer)observer.disconnect();observer=null;
    if(frameStarted){frameStarted=false;retried=false;try{frame.contentWindow.location.replace('about:blank');}catch(e){}}
  }
}
var frame=panel.querySelector('iframe[data-src]');var epoch=0;var observer=null;var frameStarted=false;
var pending=false,leaving=false,retried=false,recoveryTimer=0;
/* Native lazy iframe navigation can start during a cross-document snapshot and
   strand browser Back. Defer explicitly while leaving the blank frame settled. */
if(frame)frame.loading='eager';
function nearFrame(){
  var box=panel.getBoundingClientRect();
  return !panel.hidden&&box.bottom>=-600&&box.top<=window.innerHeight+600;
}
function blankFrame(){
  try{return frame.isConnected&&panel.querySelector('iframe[data-src]')===frame&&frame.contentWindow.location.href==='about:blank';}catch(e){return false;}
}
function afterReveal(action){
  var transition=document.activeViewTransition;
  if(transition&&transition.finished)Promise.resolve(transition.finished).catch(function(){}).then(function(){if(!leaving)action();});
  else if(!leaving)action();
}
function recoverFrame(){
  recoveryTimer=0;
  if(leaving||retried||!frameStarted||!nearFrame()||!blankFrame())return;
  afterReveal(function(){
    if(retried||!nearFrame()||!blankFrame())return;
    // An assigned src is not proof that the child navigation committed. Recover
    // one stranded initial document without adding an iframe history entry.
    retried=true;frame.contentWindow.location.replace(new URL(frame.getAttribute('data-src'),document.baseURI).href);
  });
}
function scheduleRecovery(){
  if(!recoveryTimer&&!retried&&!leaving)recoveryTimer=setTimeout(recoverFrame,1500);
}
function loadFrame(){
  if(!frame||frameStarted||pending||panel.hidden||leaving)return;
  pending=true;
  afterReveal(function(){
    pending=false;if(!nearFrame())return;
    frameStarted=true;frame.src=frame.getAttribute('data-src');scheduleRecovery();
  });
}
function watchFrame(){
  if(!frame)return;
  if(!window.IntersectionObserver){loadFrame();return;}
  if(!observer){observer=new IntersectionObserver(function(entries){if(entries.some(function(entry){return entry.isIntersecting;})){if(frameStarted)scheduleRecovery();else loadFrame();}},{rootMargin:'600px'});observer.observe(panel);}
}
if(frame)frame.addEventListener('load',function(){if(!blankFrame()){clearTimeout(recoveryTimer);recoveryTimer=0;if(observer)observer.disconnect();}});
window.addEventListener('pagehide',function(){leaving=true;pending=false;clearTimeout(recoveryTimer);recoveryTimer=0;if(observer)observer.disconnect();observer=null;});
window.addEventListener('pageshow',function(){leaving=false;if(frame&&(!frameStarted||blankFrame())){watchFrame();if(frameStarted&&nearFrame())scheduleRecovery();}});
/* Control → Create → Front page previews the page as a visitor gets it; the frame shares the owner's session, so the
   guest-only World is shown there as a guest would see it (js/control-room/front-page.js, Codex #591) */
var preview=(function(){try{return window.parent!==window&&window.parent.location.origin===location.origin&&/control\.html$/.test(window.parent.location.pathname);}catch(e){return false;}})();
function sessionPresent(){try{var s=JSON.parse(localStorage.getItem('mccdb_session')||'null');if(!s||!s.access_token)return false;var part=s.access_token.split('.')[1];var payload=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));return Number(payload.exp||0)*1000>Date.now();}catch(e){return false;}}
function render(){var seq=++epoch;var bar=window.MCC_BAR;var maybe=bar&&bar.refreshAuth?bar.refreshAuth():Promise.resolve(null);Promise.resolve(maybe).then(function(auth){if(seq!==epoch)return;var signedIn=preview?false:auth&&auth.verified?auth.signed_in:sessionPresent();show(signedIn);}).catch(function(){if(seq!==epoch)return;show(!preview&&sessionPresent());});}
render();window.addEventListener('mcc:auth-changed',render);window.addEventListener('mcc:site-policy-changed',render);window.addEventListener('storage',function(e){if(e.key==='mccdb_session')render()});
})();
