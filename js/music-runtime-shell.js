/* Opt-in persistent Music runtime: ONE MCC_MUSIC audio element in this document.
 * The workspace iframe contains same-origin document UI, not another player.
 * Site-wide zero-gap playback needs more coverage and real Safari QA.
 */
(function(root){
 "use strict";
 const frame=document.getElementById("mccStage");
 const status=document.getElementById("mccShellStatus");
 const nav=document.getElementById("mccShellNav");
 const engine=root.MCC_MUSIC;
 const allowed=new Set(["listen.html","resonance.html","catalogue.html","creator.html"]);
 if(!frame||!engine||!engine.audio)throw Error("Canonical music host is required");
 let active="listen.html",child=null,cleanup=[];
 const message=s=>{status.textContent=s;};
 function routeName(){
   try{
     const u=new URL(frame.contentWindow.location.href);
     if(u.origin!==location.origin)return null;
     const name=u.pathname.split("/").pop();
     return allowed.has(name)?name:null;
   }catch{return null;}
 }
 function paintNav(){
   nav.querySelectorAll("[data-shell-page]").forEach(a=>{
     if(a.dataset.shellPage===active)a.setAttribute("aria-current","page");
     else a.removeAttribute("aria-current");
   });
 }
 function browse(page){
   if(!allowed.has(page))return;
   if(page===active&&routeName()===page)return;
   active=page;paintNav();
   frame.src=page;
   message("Opening "+page.replace(".html","")+" without replacing the active Music transport.");
 }
 function childEngineEvent(event){
   // These events are notifications, not capabilities or signed audio URLs.
   try{
     if(child&&child.location.origin===location.origin){
       child.dispatchEvent(new CustomEvent(event.type,{
         detail:{title:String(event.detail?.title||""),playing:!!event.detail?.playing,
           access:String(event.detail?.access||"")}
       }));
     }
   }catch{}
 }
 ["mcc:music-state","mcc:music-selected"].forEach(name=>{
   root.addEventListener(name,childEngineEvent);
 });
 function proxyPlay(event){
   const hit=event.target?.closest?.("[data-music-play]");
   if(!hit)return;
   event.preventDefault();event.stopImmediatePropagation();
   // The embedded page never receives storage/signed master URLs.
   const creatorId=hit.getAttribute("data-creator-track");
   const pending=creatorId
     ? engine.playCreator(creatorId)
     : engine.play(hit.getAttribute("data-album"),hit.getAttribute("data-track"));
   if(pending&&typeof pending.catch==="function")
     pending.catch(error=>message("Player: "+String(error?.message||"Track unavailable")));
 }
 function proxyKeyboard(event){
   if(event.key!=="Enter"&&event.key!==" ")return;
   const hit=event.target?.closest?.('[data-music-play][role="button"]');
   if(hit){event.preventDefault();hit.click();}
 }
 function captureLinks(event){
   const anchor=event.target?.closest?.("a[href]");
   if(!anchor||event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||
      event.shiftKey||anchor.hasAttribute("download")||
      anchor.getAttribute("target")==="_blank")return;
   let u;try{u=new URL(anchor.href);}catch{return;}
   if(u.origin!==location.origin)return;
   const page=u.pathname.split("/").pop();
   if(!allowed.has(page))return; // ordinary iframe navigation still works outside the runtime.
   event.preventDefault();
   browse(page);
 }
 function loaded(){
   cleanup.forEach(fn=>fn());cleanup=[];
   const page=routeName();
   if(!page){
     message("This room is outside the supported Music runtime. Return to one of the four workspace sections.");
     return;
   }
   active=page;paintNav();
   let doc;
   try{child=frame.contentWindow;doc=child.document;}catch{
     message("Cross-origin content cannot join the Music transport");return;
   }
   // Child scripts that load js/music-engine.js reuse the top-level transport
   // instead of creating a second Audio element. Other rooms receive the same
   // method interface; signing in still goes through the normal auth layer.
   child.MCC_MUSIC=engine;
   doc.addEventListener("click",proxyPlay,true);
   doc.addEventListener("keydown",proxyKeyboard,true);
   doc.addEventListener("click",captureLinks,true);
   cleanup.push(()=>doc.removeEventListener("click",proxyPlay,true),
     ()=>doc.removeEventListener("keydown",proxyKeyboard,true),
     ()=>doc.removeEventListener("click",captureLinks,true));
   message("Music is persistent in this workspace. Choose a song to begin; leaving this workspace ends continuity.");
 }
 nav.addEventListener("click",event=>{
   const a=event.target.closest("[data-shell-page]");
   if(!a)return;
   event.preventDefault();browse(a.dataset.shellPage);
 });
 frame.addEventListener("load",loaded);
 document.getElementById("mccShellNow").onclick=()=>engine.openNow?.();
 document.addEventListener("visibilitychange",()=>{
   // Never start autoplay when a tab returns from the background.
   if(document.visibilityState==="visible"&&engine.current?.())
     message("Your Music session is still hosted here. Resume only through the player.");
 });
 root.addEventListener("pagehide",()=>cleanup.forEach(fn=>fn()),{once:true});
 const query=new URLSearchParams(location.search).get("page");
 browse(query&&allowed.has(query)?query:"listen.html");
})(window);
