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

  /* Live Policy OS layer. Static case files remain the resilient fallback; when
     the canonical public initiative graph answers, it owns Project Intelligence. */
  var SUPA=window.MCC_SUPA||null;
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");}
  function stageLabel(v){return String(v||"research").replace(/-/g," ").replace(/\b\w/g,function(c){return c.toUpperCase();});}
  function fmtDate(v){if(!v)return"";var d=new Date(v);return isNaN(d)?"":d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});}
  function liveInitiatives(){
    if(!SUPA||!SUPA.url||!SUPA.key)return Promise.reject(new Error("backend unavailable"));
    var q="eu_initiatives?visibility=eq.public&status=neq.archived&select=id,slug,title,short_title,summary,jurisdiction,stage,status,current_ask,next_milestone,next_milestone_at,target_outcome,updated_at&order=updated_at.desc&limit=12";
    return fetch(SUPA.url+"/rest/v1/"+q,{headers:{apikey:SUPA.key,Accept:"application/json"}}).then(function(r){if(!r.ok)throw new Error("policy "+r.status);return r.json();});
  }
  function projectCard(row,i){
    var lead=i===0;
    var milestone=row.next_milestone||"";
    var when=fmtDate(row.next_milestone_at);
    var meta=[row.jurisdiction||"Policy initiative",when?"Next · "+when:""].filter(Boolean).join(" · ");
    var detail=[];
    if(row.current_ask)detail.push('<div><small>Current ask</small><b>'+esc(row.current_ask)+'</b></div>');
    if(milestone)detail.push('<div><small>Next milestone</small><b>'+esc(milestone)+'</b></div>');
    if(row.target_outcome)detail.push('<div><small>Target outcome</small><b>'+esc(row.target_outcome)+'</b></div>');
    return '<article class="eui-project'+(lead?' eui-project--lead':'')+'" data-eui-live-initiative="'+esc(row.id)+'">'+
      '<div class="eui-project__top"><span class="eui-status'+(row.status==='active'?' eui-status--live':'')+'">'+esc(stageLabel(row.stage))+'</span><span>'+esc(meta)+'</span></div>'+
      '<h3>'+esc(row.title)+'</h3><p>'+esc(row.summary||row.objective||"")+'</p>'+
      (detail.length?'<div class="eui-project__data">'+detail.join("")+'</div>':'')+
      '<div class="eui-project__tags"><span>canonical record</span><span>'+esc(row.status||"active")+'</span></div></article>';
  }
  liveInitiatives().then(function(rows){
    if(!Array.isArray(rows)||!rows.length)return;
    var grid=document.querySelector(".eui-project-grid");
    if(!grid)return;
    grid.innerHTML=rows.map(projectCard).join("");
    var live=document.querySelector(".eui-live");
    if(live){live.innerHTML='<i></i> Institutional record · live sync';live.title="Policy OS synced "+new Date().toLocaleString();}
    shell.setAttribute("data-policy-os","live");
  }).catch(function(){shell.setAttribute("data-policy-os","static-fallback");});
})();
