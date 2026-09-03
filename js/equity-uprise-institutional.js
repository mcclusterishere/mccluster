(function(){
  "use strict";
  var fill=document.getElementById("euScrollFill");
  var sceneNo=document.getElementById("euSceneNo");
  var sceneName=document.getElementById("euSceneName");
  var dockLabel=document.getElementById("euDockLabel");
  var scenes=[].slice.call(document.querySelectorAll("[data-scene]"));

  function updateProgress(){
    var h=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    var p=Math.max(0,Math.min(1,scrollY/h));
    if(fill) fill.style.transform="scaleX("+p+")";
  }

  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting) return;
      var idx=scenes.indexOf(entry.target);
      var name=entry.target.getAttribute("data-scene")||"Institutional experience";
      if(sceneNo) sceneNo.textContent=String(idx+1).padStart(2,"0");
      if(sceneName) sceneName.textContent=name;
      if(dockLabel) dockLabel.textContent=name;
    });
  },{threshold:.48,rootMargin:"-12% 0px -28% 0px"});
  scenes.forEach(function(s){io.observe(s);});

  var revealTargets=[].slice.call(document.querySelectorAll(".eu-sectionhead,.eu-proofband__intro,.eu-numbers,.eu-current__grid,.eu-case,.eu-policy__intro,.eu-policy__stack,.eu-flowline,.eu-media__grid,.eu-docgrid,.eu-partner__top,.eu-lanes,.eu-partner__cta,.eu-yinyang"));
  revealTargets.forEach(function(el){el.classList.add("eu-reveal");});
  var rio=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add("is-visible");rio.unobserve(entry.target);}});
  },{threshold:.14,rootMargin:"0px 0px -8% 0px"});
  revealTargets.forEach(function(el){rio.observe(el);});

  document.querySelectorAll(".eu-policyrow").forEach(function(row){
    row.addEventListener("click",function(){
      var was=row.classList.contains("is-open");
      document.querySelectorAll(".eu-policyrow.is-open").forEach(function(x){x.classList.remove("is-open");});
      if(!was) row.classList.add("is-open");
    });
  });

  var video=document.getElementById("euVideo");
  var frame=document.getElementById("euVideoFrame");
  var lastFocus=null;
  function openVideo(id){
    if(!video||!frame) return;
    lastFocus=document.activeElement;
    frame.src="https://www.youtube.com/embed/"+encodeURIComponent(id)+"?autoplay=1&rel=0&modestbranding=1";
    video.hidden=false;
    document.body.style.overflow="hidden";
    var close=video.querySelector("[data-video-close]");
    if(close) close.focus();
  }
  function closeVideo(){
    if(!video||!frame) return;
    video.hidden=true;
    frame.src="";
    document.body.style.overflow="";
    if(lastFocus&&lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener("click",function(e){
    var opener=e.target.closest&&e.target.closest("[data-video]");
    if(opener){e.preventDefault();openVideo(opener.getAttribute("data-video"));return;}
    if(e.target.closest&&e.target.closest("[data-video-close]")){e.preventDefault();closeVideo();}
  });
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&video&&!video.hidden) closeVideo();});

  if(matchMedia("(pointer:fine)").matches&&!matchMedia("(prefers-reduced-motion:reduce)").matches){
    document.querySelectorAll("[data-tilt]").forEach(function(el){
      el.addEventListener("pointermove",function(e){
        var r=el.getBoundingClientRect();
        var x=(e.clientX-r.left)/r.width-.5;
        var y=(e.clientY-r.top)/r.height-.5;
        el.style.transform="perspective(1200px) rotateX("+(-y*2.2)+"deg) rotateY("+(x*2.6)+"deg) translateY(-2px)";
      });
      el.addEventListener("pointerleave",function(){el.style.transform="";});
    });
  }

  var ticking=false;
  addEventListener("scroll",function(){
    if(ticking) return;
    ticking=true;
    requestAnimationFrame(function(){updateProgress();ticking=false;});
  },{passive:true});
  updateProgress();
})();
