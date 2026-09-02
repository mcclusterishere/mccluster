(function(){
  "use strict";

  var state={data:null,floor:"upper",room:null,mode:"simple",view:"plan"};
  var roomPositions={
    upper:{sanctuary:[50,48]},
    lower:{kitchen:[25,30],"mess-hall":[60,28],offices:[76,61],"lower-circulation":[45,61],stairs:[22,70]},
    site:{entrances:[52,58],perimeter:[33,30]}
  };

  function q(sel,root){return (root||document).querySelector(sel)}
  function qa(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel))}
  function esc(value){return String(value==null?"":value).replace(/[&<>\"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]})}

  function setMode(mode){
    state.mode=mode==="engineer"?"engineer":"simple";
    document.body.setAttribute("data-mode",state.mode);
    qa("[data-mode-button]").forEach(function(btn){btn.setAttribute("aria-pressed",String(btn.getAttribute("data-mode-button")===state.mode))});
    try{localStorage.setItem("s477-mode",state.mode)}catch(e){}
  }

  function renderMetrics(){
    var host=q("#scMetrics"); if(!host||!state.data)return;
    host.innerHTML=state.data.metrics.map(function(m){
      var unit=m.unit,note=m.note;
      if(m.label==="Video"){unit="planned cameras";note="33 provisioned incl. 3 cold spares"}
      return '<article class="sc-metric"><div><b>'+esc(m.value)+'</b><span>'+esc(unit)+'</span></div><small>'+esc(m.label)+' · '+esc(note)+'</small></article>';
    }).join("");
  }

  function renderFloorTabs(){
    var host=q("#floorTabs"); if(!host||!state.data)return;
    host.innerHTML=state.data.floors.map(function(f){return '<button class="sc-tab" type="button" role="tab" data-floor="'+esc(f.id)+'" aria-selected="'+String(f.id===state.floor)+'">'+esc(f.label)+'</button>'}).join("");
  }

  function floorRooms(){return state.data.rooms.filter(function(r){return r.floor===state.floor})}

  function renderPlan(){
    var host=q("#roomNodes"); if(!host||!state.data)return;
    var positions=roomPositions[state.floor]||{};
    var rooms=floorRooms();
    host.innerHTML=rooms.map(function(r,i){var p=positions[r.id]||[30+(i*18)%60,30+(i*21)%55];return '<button class="sc-node'+(state.room&&state.room.id===r.id?' on':'')+'" type="button" data-room="'+esc(r.id)+'" style="left:'+p[0]+'%;top:'+p[1]+'%">'+esc(r.name)+'</button>'}).join("");
    var label=q("#floorSvgLabel");if(label){var f=state.data.floors.find(function(x){return x.id===state.floor});label.textContent=f?f.label.toUpperCase():"S477"}
    var floorName=q("#floorName");if(floorName){var current=state.data.floors.find(function(x){return x.id===state.floor});floorName.textContent=current?current.label:"Building"}
    if(!state.room||state.room.floor!==state.floor){selectRoom(rooms[0]&&rooms[0].id,false)}
  }

  function selectRoom(id,focus){
    if(!state.data)return;
    var room=state.data.rooms.find(function(r){return r.id===id});if(!room)return;
    state.room=room;
    qa("[data-room]").forEach(function(btn){btn.classList.toggle("on",btn.getAttribute("data-room")===id)});
    var title=q("#inspectorTitle"),purpose=q("#inspectorPurpose"),plain=q("#inspectorPlain"),measurement=q("#inspectorMeasurement"),dimensions=q("#inspectorDimensions"),engineering=q("#inspectorEngineering"),tags=q("#inspectorTags");
    if(title)title.textContent=room.name;
    if(purpose)purpose.textContent=room.purpose;
    if(plain)plain.textContent=room.plain;
    if(measurement)measurement.textContent=room.measurementStatus;
    if(dimensions)dimensions.textContent=room.dimensions||"Not yet measured";
    if(engineering)engineering.textContent=room.engineering;
    if(tags)tags.innerHTML=room.systems.map(function(x){return '<span>'+esc(x)+'</span>'}).join("");
    if(focus&&title)title.focus&&title.focus();
  }

  function setFloor(id){
    if(!state.data.floors.some(function(f){return f.id===id}))return;
    state.floor=id;state.room=null;
    qa("[data-floor]").forEach(function(btn){btn.setAttribute("aria-selected",String(btn.getAttribute("data-floor")===id))});
    renderPlan();
  }

  function setView(view){
    state.view=view==="360"?"360":"plan";
    qa("[data-view]").forEach(function(btn){btn.classList.toggle("on",btn.getAttribute("data-view")===state.view)});
    var pano=q("#panoramaPlaceholder"),svg=q("#planSvg"),nodes=q("#roomNodes");
    if(pano)pano.classList.toggle("on",state.view==="360");
    if(svg)svg.style.display=state.view==="360"?"none":"block";
    if(nodes)nodes.style.display=state.view==="360"?"none":"block";
  }

  function renderSystems(){
    var host=q("#systemGrid");if(!host||!state.data)return;
    host.innerHTML=state.data.systems.map(function(s,i){return '<article class="sc-system" id="system-'+esc(s.id)+'" data-accent="'+esc(s.accent)+'"><span class="sc-system__num">0'+(i+1)+' / 0'+state.data.systems.length+'</span><span class="sc-system__state">'+esc(s.state)+'</span><h3>'+esc(s.name)+'</h3><p class="sc-system__plain">'+esc(s.plain)+'</p><div class="sc-system__metrics">'+s.metrics.map(function(m){return '<span>'+esc(m)+'</span>'}).join("")+'</div><details data-detail="engineer"><summary>Engineering stack</summary><ul>'+s.stack.map(function(x){return '<li>'+esc(x)+'</li>'}).join("")+'</ul><p class="sc-system__eng">'+esc(s.engineering)+'</p></details></article>'}).join("");
  }

  function renderArchitecture(){
    var host=q("#architectureLayers");if(!host||!state.data)return;
    host.innerHTML=state.data.architectureLayers.map(function(l){return '<article class="sc-layer"><h3>'+esc(l.name)+'</h3><div class="sc-layer__items">'+l.items.map(function(x){return '<span>'+esc(x)+'</span>'}).join("")+'</div></article>'}).join("");
  }

  function renderSurvey(){
    var host=q("#surveyChecks");if(!host||!state.data)return;
    host.innerHTML=state.data.surveyGates.map(function(x){return '<div class="sc-check"><i aria-hidden="true"></i><span>'+esc(x.item)+'</span><small>'+esc(x.state)+'</small></div>'}).join("");
  }

  function renderVendors(){
    var host=q("#vendorList");if(!host||!state.data)return;
    host.innerHTML=state.data.vendors.map(function(v){return '<article class="sc-vendor"><b>'+esc(v.name)+'</b><p>'+esc(v.role)+'</p></article>'}).join("");
  }

  function renderProject(){
    if(!state.data)return;
    var p=state.data.project;
    var status=q("#projectStatus"),area=q("#projectArea"),budget=q("#projectBudget"),notice=q("#publicNotice");
    if(status)status.textContent=p.status;
    if(area)area.textContent=p.buildingAreaSqFt.toLocaleString()+" sq ft";
    if(budget)budget.textContent=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(p.capitalBaseline);
    if(notice)notice.textContent=p.publicModelNotice;
  }

  function bind(){
    document.addEventListener("click",function(e){
      var mode=e.target.closest&&e.target.closest("[data-mode-button]");if(mode){setMode(mode.getAttribute("data-mode-button"));return}
      var floor=e.target.closest&&e.target.closest("[data-floor]");if(floor){setFloor(floor.getAttribute("data-floor"));return}
      var room=e.target.closest&&e.target.closest("[data-room]");if(room){selectRoom(room.getAttribute("data-room"),false);return}
      var view=e.target.closest&&e.target.closest("[data-view]");if(view){setView(view.getAttribute("data-view"));return}
    });
  }

  function boot(data){
    state.data=data;
    try{state.mode=localStorage.getItem("s477-mode")==="engineer"?"engineer":"simple"}catch(e){}
    renderProject();renderMetrics();renderFloorTabs();renderPlan();renderSystems();renderArchitecture();renderSurvey();renderVendors();setMode(state.mode);setView("plan");bind();
  }

  fetch("data/s477-public.json?v=2").then(function(r){if(!r.ok)throw new Error("S477 data unavailable");return r.json()}).then(boot).catch(function(err){var host=q("#smartChurchApp");if(host)host.insertAdjacentHTML("afterbegin",'<p style="padding:1rem;border:1px solid rgba(229,56,59,.35);color:#f4efe6">Smart Church data could not load. '+esc(err.message)+'</p>')});
})();

/* Responsive evidence/budget/LiDAR layer is isolated so the core twin remains
   functional even if a supplemental dataset fails. */
(function(){
  var s=document.createElement("script");
  s.src="js/smart-church-visuals.js?v=3";
  s.defer=true;
  document.head.appendChild(s);
})();
