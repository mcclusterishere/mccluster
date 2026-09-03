(function(){
  "use strict";

  var shell=document.querySelector(".eui-shell");
  if(!shell)return;

  var navButtons=[].slice.call(document.querySelectorAll("[data-eui-view]"));
  var panels=[].slice.call(document.querySelectorAll("[data-eui-panel]"));
  var railButtons=[].slice.call(document.querySelectorAll(".eui-nav [data-eui-view]"));
  var main=document.getElementById("euiMain");

  function validView(name){return panels.some(function(p){return p.getAttribute("data-eui-panel")===name;});}
  function showView(name,opts){
    opts=opts||{};
    if(!validView(name))name="overview";
    panels.forEach(function(p){p.classList.toggle("is-active",p.getAttribute("data-eui-panel")===name);});
    railButtons.forEach(function(b){b.classList.toggle("is-active",b.getAttribute("data-eui-view")===name);});
    if(!opts.noHash){try{history.replaceState(null,"","#"+name);}catch(e){}}
    if(!opts.noScroll){
      if(window.innerWidth<=800)window.scrollTo({top:0,behavior:"smooth"});
      else if(main)main.scrollTo({top:0,behavior:"auto"});
    }
    try{sessionStorage.setItem("eui-view",name);}catch(e){}
  }

  navButtons.forEach(function(btn){
    btn.addEventListener("click",function(e){
      if(btn.tagName.toLowerCase()==="a")return;
      var name=btn.getAttribute("data-eui-view");
      if(name){e.preventDefault();showView(name);}
      var caseName=btn.getAttribute("data-eui-case-open");
      if(caseName)setTimeout(function(){showCase(caseName);},0);
    });
  });

  function showCase(name){
    var buttons=[].slice.call(document.querySelectorAll("[data-eui-case]"));
    var casePanels=[].slice.call(document.querySelectorAll("[data-eui-case-panel]"));
    if(!casePanels.some(function(p){return p.getAttribute("data-eui-case-panel")===name;}))return;
    buttons.forEach(function(b){b.classList.toggle("is-active",b.getAttribute("data-eui-case")===name);});
    casePanels.forEach(function(p){p.classList.toggle("is-active",p.getAttribute("data-eui-case-panel")===name);});
  }
  document.querySelectorAll("[data-eui-case]").forEach(function(btn){btn.addEventListener("click",function(){showCase(btn.getAttribute("data-eui-case"));});});

  function showPolicy(name){
    var buttons=[].slice.call(document.querySelectorAll("[data-eui-policy]"));
    var policyPanels=[].slice.call(document.querySelectorAll("[data-eui-policy-panel]"));
    if(!policyPanels.some(function(p){return p.getAttribute("data-eui-policy-panel")===name;}))return;
    buttons.forEach(function(b){b.classList.toggle("is-active",b.getAttribute("data-eui-policy")===name);});
    policyPanels.forEach(function(p){p.classList.toggle("is-active",p.getAttribute("data-eui-policy-panel")===name);});
  }
  document.querySelectorAll("[data-eui-policy]").forEach(function(btn){btn.addEventListener("click",function(){showPolicy(btn.getAttribute("data-eui-policy"));});});

  var modal=document.getElementById("euiVideoModal");
  var frame=document.getElementById("euiVideoFrame");
  function closeVideo(){
    if(!modal)return;
    if(frame)frame.src="";
    if(modal.open)modal.close();
  }
  document.querySelectorAll("[data-eui-video]").forEach(function(btn){
    btn.addEventListener("click",function(){
      if(!modal||!frame)return;
      frame.src=btn.getAttribute("data-eui-video")+"?autoplay=1&rel=0";
      if(typeof modal.showModal==="function")modal.showModal();
      else modal.setAttribute("open","");
    });
  });
  document.querySelectorAll("[data-eui-modal-close]").forEach(function(btn){btn.addEventListener("click",closeVideo);});
  if(modal){
    modal.addEventListener("click",function(e){if(e.target===modal)closeVideo();});
    modal.addEventListener("cancel",function(e){e.preventDefault();closeVideo();});
  }

  var initial=(location.hash||"").replace(/^#/,"");
  if(!validView(initial)){
    try{initial=sessionStorage.getItem("eui-view")||"overview";}catch(e){initial="overview";}
  }
  showView(initial,{noHash:true,noScroll:true});

  window.addEventListener("hashchange",function(){var h=(location.hash||"").replace(/^#/,"");if(validView(h))showView(h,{noHash:true});});
})();