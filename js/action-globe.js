(function(){'use strict';
const SB='https://zmnhbrjyhxzhkxmhkexs.supabase.co',KEY='sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4';
const $=id=>document.getElementById(id);const embedded=new URLSearchParams(location.search).has('embedded');if(embedded){document.documentElement.classList.add('globe-embedded');/* inside another page the host owns navigation: no second bar or auth chip (tabbar.js honours data-no-appbar) */document.body.setAttribute('data-no-appbar','')}
/* THE FULL WORLD (owner, 2026-10-15: "if they click the world, it'll allow them to see that in a full pane … without the whole 30, 40 rule"):
   ?explore=1 is this page on its own, the Earth edge to edge (css: .globe-explore). The World's chrome stays home; what floats is the
   way back, the controls, the data toggles, the credit, and the mission in a sheet above the bar. */
const EXPLORE=!embedded&&new URLSearchParams(location.search).has('explore');if(EXPLORE)document.documentElement.classList.add('globe-explore');
/* JUST THE GLOBE (owner, 2026-10-15: the globe "as its own chrome-less experience: just zoom in and click on things"): ?explore=1&chrome=0.
   No toggles, no controls, no way-back pill: the Earth, the pins, and what a tap opens. THE BOTTOM APP BAR NEVER LEAVES
   (owner, 2026-10-15): it stays here as on every other experience. The imagery credit stays (the licences ask for it), and
   one small corner control (and Escape) brings the chrome back. */
const BARE=EXPLORE&&new URLSearchParams(location.search).get('chrome')==='0';if(BARE)document.documentElement.classList.add('globe-bare');
/* Network surface: the globe inside the Human Uprise World tab. The parent page owns the feed and the mission context,
   so this frame shows only the Earth and talks to its same-origin parent. Messages carry public mission fields only. */
const parentFrame=embedded&&window.parent!==window?window.parent:null;if(parentFrame&&new URLSearchParams(location.search).get('surface')==='network')document.documentElement.classList.add('globe-surface-network');
const ANALYTICS=!!parentFrame&&new URLSearchParams(location.search).get('surface')==='analytics';if(ANALYTICS)document.documentElement.classList.add('globe-surface-analytics');
/* THE WORLD IS THE SOCIAL FEED (owner, 2026-10-20): missions=0 (mnet.html, for the frame and the expanded globe) draws no
   mission pins, regions or outlines and keeps the mission panels shut, until Missions comes back */
/* the house owner's World keeps them (js/world-owner-modes.js lifts the switch on the page that holds this frame) */
const NO_MISSIONS=new URLSearchParams(location.search).get('missions')==='0'&&!(()=>{try{return !!parentFrame&&!parentFrame.document.documentElement.classList.contains('hu-social-only')}catch(e){return false}})();if(NO_MISSIONS)document.documentElement.classList.add('globe-no-missions');
// Public World reference approved 2026-10-16. Analytics retains its own rendering contract.
const EDITORIAL=!ANALYTICS; if(EDITORIAL)document.documentElement.classList.add('globe-editorial');
let travelMode=false,journeyPoints=[],journeyEntities=[],journeyConnect=true,journeyFlyPending=false;
// Private travel state lives only in this frame. The parent owns GPS permission,
// routing and navigation; neither coordinates nor route geometry enter analytics.
const MAX_TRAVEL_ROUTE_POINTS=10000,MAX_TRAVEL_ACCURACY=100000;
let travelSceneReady=false,roadRoute=null,roadPositions=[],roadEntities=[],routeFlyPending=false;
let currentLocation=null,locationEntities=[],locationFlyPending=false,locationAnimatePending=false,travelCameraQueued=false;
let travelControlsQueued=false, mapPickKind=null;
// The parent owns the selected endpoints. The Cesium iframe returns only a
// coordinate chosen by a direct user tap, never passive GPS or route content.
function travelPickKind(kind){
 mapPickKind=travelMode&&(kind==='from'||kind==='to')?kind:null;
 document.documentElement.classList.toggle('globe-map-picking',!!mapPickKind);
}
function travelMapPoint(screenPosition){
 if(!viewer||!screenPosition)return null;
 try {
  const ray=viewer.camera.getPickRay(screenPosition);
  const hit=(ray&&viewer.scene.globe.pick(ray,viewer.scene))||
   viewer.camera.pickEllipsoid(screenPosition,viewer.scene.globe.ellipsoid);
  if(!hit)return null;
  const c=Cesium.Cartographic.fromCartesian(hit);
  return travelCoordinates([Cesium.Math.toDegrees(c.longitude),Cesium.Math.toDegrees(c.latitude)]);
 }catch(_){return null}
}
function travelCoordinates(value){
 if(!Array.isArray(value)||value.length!==2)return null;
 const [lon,lat]=value;
 return typeof lon==='number'&&typeof lat==='number'&&Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=90?[lon,lat]:null;
}
function travelRoute(value){
 if(!value||typeof value!=='object'||!Array.isArray(value.geometry)||value.geometry.length<2||value.geometry.length>MAX_TRAVEL_ROUTE_POINTS)return null;
 const origin=travelCoordinates(value.origin),destination=travelCoordinates(value.destination),geometry=[];
 if(!origin||!destination)return null;
 for(let n=0;n<value.geometry.length;n++){
  const point=travelCoordinates(value.geometry[n]);if(!point)return null;
  const previous=geometry[geometry.length-1];if(!previous||previous[0]!==point[0]||previous[1]!==point[1])geometry.push(point);
 }
 return geometry.length>1?{origin,destination,geometry}:null;
}
function sameTravelRoute(a,b){
 return !!a&&!!b&&a.geometry.length===b.geometry.length&&a.origin.every((v,n)=>v===b.origin[n])&&a.destination.every((v,n)=>v===b.destination[n])&&a.geometry.every((p,n)=>p[0]===b.geometry[n][0]&&p[1]===b.geometry[n][1]);
}
function travelMotion(seconds){return matchMedia('(prefers-reduced-motion: reduce)').matches?0:seconds}
function travelVisibility(){
 journeyEntities.forEach(e=>e.show=travelMode&&!roadRoute);
 roadEntities.forEach(e=>e.show=travelMode);
 locationEntities.forEach(e=>e.show=travelMode);
 if(viewer&&mapLayer&&layerMode==='auto')mapLayer.show=streetAuto(viewer.camera.positionCartographic.height);
}
function focusTravelPosition(coordinates,{accuracy=0,follow=false,animate=true}={}){
 if(!travelMode||!travelSceneReady||!viewer)return;
 const c=Cesium.Cartographic.fromDegrees(...coordinates),ground=viewer.scene.globe.getHeight(c);
 const height=Math.max(follow?750:1500,Math.min(600000,accuracy*4));
 const view={destination:Cesium.Cartesian3.fromDegrees(...coordinates,(Number.isFinite(ground)?Math.max(0,ground):0)+height),orientation:{heading:0,pitch:-Math.PI/2,roll:0}};
 if(animate)viewer.camera.flyTo({...view,duration:travelMotion(.9)});else{viewer.camera.cancelFlight();viewer.camera.setView(view)}
}
function fitTravelPositions(positions){
 if(!positions.length||!travelMode||!travelSceneReady||!viewer)return;
 const sphere=Cesium.BoundingSphere.fromPoints(positions),canvas=viewer.scene.canvas;
 const fov=viewer.camera.frustum.fovy||Math.PI/3,aspect=Math.max(1,canvas.clientWidth)/Math.max(1,canvas.clientHeight);
 const angle=Math.atan(Math.tan(fov/2)*Math.min(1,aspect)*.72);
 // Fit the actual route, including bends, with room for pins at phone width.
 // There is deliberately no whole-Earth minimum camera height here.
 const range=Math.max(1100,sphere.radius/Math.sin(angle));
 viewer.camera.flyToBoundingSphere(sphere,{offset:new Cesium.HeadingPitchRange(0,-Math.PI/2,range),duration:travelMotion(1.1)});
}
function scheduleTravelCamera(){
 if(travelCameraQueued||!travelSceneReady||!viewer||!travelMode)return;
 travelCameraQueued=true;requestAnimationFrame(()=>{
  travelCameraQueued=false;if(!travelMode||!viewer)return;
  if(currentLocation?.follow&&locationFlyPending)focusTravelPosition(currentLocation.coordinates,{accuracy:currentLocation.accuracy||0,follow:true,animate:locationAnimatePending});
  else if(routeFlyPending&&roadRoute)fitTravelPositions([...roadPositions,Cesium.Cartesian3.fromDegrees(...roadRoute.origin),Cesium.Cartesian3.fromDegrees(...roadRoute.destination)]);
  else if(locationFlyPending&&currentLocation)focusTravelPosition(currentLocation.coordinates,{accuracy:currentLocation.accuracy||0});
  else if(journeyFlyPending&&!roadRoute)drawJourney(journeyPoints,true);
  routeFlyPending=locationFlyPending=locationAnimatePending=journeyFlyPending=false;
 });
}
function drawRoadRoute(){
 if(!travelSceneReady||!viewer||ANALYTICS)return;
 clear(roadEntities);roadPositions=[];
 if(roadRoute){
  const red=Cesium.Color.fromCssColorString('#c93051'),white=Cesium.Color.WHITE;
  roadPositions=roadRoute.geometry.map(p=>Cesium.Cartesian3.fromDegrees(...p));
  roadEntities.push(viewer.entities.add({show:travelMode,polyline:{positions:roadPositions,width:6,clampToGround:true,classificationType:Cesium.ClassificationType.TERRAIN,zIndex:20,material:new Cesium.PolylineOutlineMaterialProperty({color:red,outlineColor:white.withAlpha(.95),outlineWidth:1.5})}}));
  [[roadRoute.origin,'Start',white],[roadRoute.destination,'Destination',red]].forEach(([coordinates,text,color])=>{
   roadEntities.push(viewer.entities.add({show:travelMode,position:Cesium.Cartesian3.fromDegrees(...coordinates),point:{pixelSize:text==='Start'?10:14,color,outlineColor:text==='Start'?Cesium.Color.fromCssColorString('#253142'):white,outlineWidth:3,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:50000},label:{text,font:'600 13px system-ui,sans-serif',fillColor:white,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-24),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:50000,distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,200000)}}));
  });
 }
 travelVisibility();scheduleTravelCamera();
}
function drawTravelLocation(){
 if(!travelSceneReady||!viewer||ANALYTICS)return;
 if(!currentLocation){clear(locationEntities);travelVisibility();return}
 const position=Cesium.Cartesian3.fromDegrees(...currentLocation.coordinates),blue=Cesium.Color.fromCssColorString('#369aff');
 // The origin already has a label. The blue location dot and accuracy ring
 // must not add a second line of text at the exact same screen position.
 if(!locationEntities[0])locationEntities.push(viewer.entities.add({show:travelMode,position,point:{pixelSize:15,color:blue,outlineColor:Cesium.Color.WHITE,outlineWidth:3,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:50000}}));
 else locationEntities[0].position=position;
 const accuracy=currentLocation.accuracy;
 if(accuracy>0){
  if(!locationEntities[1])locationEntities.push(viewer.entities.add({show:travelMode,position,ellipse:{semiMajorAxis:accuracy,semiMinorAxis:accuracy,material:blue.withAlpha(.14),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,classificationType:Cesium.ClassificationType.TERRAIN}}));
  else{const circle=locationEntities[1];circle.position=position;circle.ellipse.semiMajorAxis=accuracy;circle.ellipse.semiMinorAxis=accuracy}
 }else if(locationEntities[1])viewer.entities.remove(locationEntities.pop());
 travelVisibility();scheduleTravelCamera();
}
function setTravelLocation(data){
 if(data.coordinates===null){
  if(currentLocation?.follow&&viewer)viewer.camera.cancelFlight();currentLocation=null;locationFlyPending=locationAnimatePending=false;drawTravelLocation();return;
 }
 const coordinates=travelCoordinates(data.coordinates);if(!coordinates)return;
 const follow=data.follow===true,previousFollow=currentLocation?.follow===true;
 const accuracy=typeof data.accuracy==='number'&&Number.isFinite(data.accuracy)&&data.accuracy>=0&&data.accuracy<=MAX_TRAVEL_ACCURACY?data.accuracy:null;
 currentLocation={coordinates,accuracy,follow};
 locationFlyPending=locationFlyPending||data.fly===true||follow;
 locationAnimatePending=locationAnimatePending||data.fly===true||(follow&&!previousFollow);
 drawTravelLocation();
}
function restoreTravelScene(){
 drawJourney(journeyPoints,false);drawRoadRoute();drawTravelLocation();travelVisibility();scheduleTravelCamera();
}
function pauseTravelFollow(){
 if(!travelMode||ANALYTICS)return;
 if(currentLocation)currentLocation.follow=false;
 routeFlyPending=locationFlyPending=locationAnimatePending=journeyFlyPending=false;
 if(viewer)viewer.camera.cancelFlight();
 tell({type:'hu:map-interaction'});
}
function wireTravelGestures(){
 const canvas=viewer.scene.canvas,pointers=new Map();let dragging=false;
 // Camera.changed also fires for our own GPS updates. Only real input pauses
 // following, so the next location fix respects a person's map inspection.
 canvas.addEventListener('pointerdown',e=>{pointers.set(e.pointerId,[e.clientX,e.clientY]);if(pointers.size>1){dragging=true;pauseTravelFollow()}},{passive:true});
 canvas.addEventListener('pointermove',e=>{const start=pointers.get(e.pointerId);if(start&&!dragging&&Math.hypot(e.clientX-start[0],e.clientY-start[1])>3){dragging=true;pauseTravelFollow()}},{passive:true});
 const end=e=>{pointers.delete(e.pointerId);if(!pointers.size)dragging=false};
 window.addEventListener('pointerup',end,{passive:true});window.addEventListener('pointercancel',end,{passive:true});
 canvas.addEventListener('pointerleave',()=>{pointers.clear();dragging=false},{passive:true});
 canvas.addEventListener('wheel',pauseTravelFollow,{passive:true});
 for(const id of ['ctlZoomIn','ctlZoomOut'])$(id)?.addEventListener('click',pauseTravelFollow,{capture:true});
}
function liftTravelControls(){
 const rail=document.querySelector('.globe-travel-controls');if(!rail)return;
 for(const key of ['bottom','left','right','flex-direction'])rail.style.removeProperty(key);
 if(!travelMode||!parentFrame||!window.frameElement)return;
 try{
  // Parent and iframe controls share one phone canvas. Check every obstacle,
  // including Expand when the dock does not overlap this stacked map.
  const frame=window.frameElement.getBoundingClientRect(),doc=parentFrame.document;
  const rect=selector=>{const el=doc.querySelector(selector),r=el?.getBoundingClientRect(),style=el&&parentFrame.getComputedStyle(el);return r&&r.width&&r.height&&style.display!=='none'&&style.visibility!=='hidden'?r:null};
  const overlap=(a,b)=>a&&b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  const clearance=parseFloat(parentFrame.getComputedStyle(doc.documentElement).getPropertyValue('--mn-bar-clear'))||0;
  const dock=rect('.appbar')||(doc.body.dataset.worldAudioChild==='ready'&&clearance>0?{left:0,right:doc.documentElement.clientWidth,top:parentFrame.innerHeight-clearance,bottom:parentFrame.innerHeight}:null);
  const obstacles=[dock,...['#mccWorldAudioControls','#mnWorldStack','.mn__world-expand','#mnWorldPlay','.wt-world-modes','.wt-headline','.wt-destination','.mn__top','#wtMapNav','#wtMapPickBanner'].map(rect)].filter(r=>overlap(frame,r));
  const preferred=getComputedStyle(rail).flexDirection;
  for(const direction of [preferred,preferred==='row'?'column':'row']){
   rail.style.flexDirection=direction;const size=rail.getBoundingClientRect();
   for(const side of ['right','left']){
    const left=side==='right'?frame.right-size.width-12:frame.left+12,right=left+size.width;
    const blocking=obstacles.filter(r=>left<r.right&&right>r.left);
    const bottoms=[26,...blocking.map(r=>Math.ceil(frame.bottom-r.top)+10),...blocking.map(r=>Math.floor(frame.bottom-r.bottom-size.height)-10)];
    for(const bottom of bottoms){
     const candidate={left,right,top:frame.bottom-bottom-size.height,bottom:frame.bottom-bottom};
     if(candidate.left<frame.left+8||candidate.right>frame.right-8||candidate.top<frame.top+8||candidate.bottom>frame.bottom-8||blocking.some(r=>overlap(candidate,r)))continue;
     rail.style.left=side==='left'?'12px':'auto';rail.style.right=side==='right'?'12px':'auto';rail.style.bottom=bottom+'px';return;
    }
   }
  }
  // Extremely short keyboard viewports retain full-size controls. The normal
  // phone and expanded layouts have a free slot above the mode switch.
  rail.style.flexDirection='row';rail.style.bottom='26px';
 }catch(_){/* A standalone or differently hosted frame keeps its own controls. */}
}
function scheduleTravelControls(){
 if(travelControlsQueued)return;travelControlsQueued=true;
 requestAnimationFrame(()=>{travelControlsQueued=false;liftTravelControls()});
}
function wireTravelControlLayout(){
 window.addEventListener('resize',scheduleTravelControls,{passive:true});
 try{
  if(!parentFrame)return;parentFrame.addEventListener('resize',scheduleTravelControls,{passive:true});parentFrame.addEventListener('mcc:world-audio-layout',scheduleTravelControls);
  if(window.ResizeObserver){const observer=new ResizeObserver(scheduleTravelControls);for(const el of [window.frameElement,...parentFrame.document.querySelectorAll('.appbar,#mccWorldAudioControls,#mnWorldStack,#mnWorldPlay,.mn__world-expand,.wt-world-modes,#wtMapNav,#wtMapPickBanner')])if(el)observer.observe(el)}
 }catch(_){}
 scheduleTravelControls();
}
// Verification exposes counts only, never a visitor's precise location or route.
window.__huNavigation=()=>({mapPicking:!!mapPickKind,travel:travelMode,routePoints:roadRoute?.geometry.length||0,routeEntities:roadEntities.length,routeVisible:travelMode&&roadEntities.length>0,location:!!currentLocation,locationEntities:locationEntities.length,locationVisible:travelMode&&locationEntities.length>0,following:travelMode&&currentLocation?.follow===true});
/* CITY LIGHTS ONLY AT NIGHT, AND VISIBLE THERE (owner, 2026-10-20: "sections on the light side that have lights on … and
   sections of the dark side where there is no light … doesn't make sense"). The city-lights layer never shows on the
   day side, in Travel or anywhere else, and Cesium's 30% night shading is answered with enough lift and contrast that
   lit cities read as lights while the dark land stays dark. */
const NIGHT_LIGHTS={brightness:3.4,contrast:1.15,gamma:.9};
function travelStyle(){
 if(!viewer||!EDITORIAL)return;
 dayLayer.saturation=1.1;dayLayer.brightness=1.05;
 if(nightLayer){nightLayer.show=true;nightLayer.dayAlpha=0;nightLayer.nightAlpha=1;nightLayer.brightness=NIGHT_LIGHTS.brightness;nightLayer.contrast=NIGHT_LIGHTS.contrast;nightLayer.gamma=NIGHT_LIGHTS.gamma;}
 if(cloudLayer)cloudLayer.alpha=travelMode?.3:EDITORIAL_CLOUD_ALPHA;
}
function setTravelMode(on){
 if(!EDITORIAL||!parentFrame)return;
 const changed=travelMode!==on;travelMode=on;document.documentElement.classList.toggle('globe-travel',on);
 const rail=document.querySelector('.globe-travel-controls'),nav=document.querySelector('.globe-controls');
 if(rail&&nav)for(const id of ['ctlLocate','ctlZoomIn','ctlZoomOut']){const b=$(id);if(b){if(on)rail.appendChild(b);else nav.insertBefore(b,$('ctlLayers'));}}
 scheduleTravelControls();
 if(!viewer)return;travelStyle();
 if(changed||on){showMissions=!on;showCities=!on;draw();}
 if(!on&&typeof travelPickKind==='function'){travelPickKind(null)}
 if(!on&&changed){viewer.camera.cancelFlight();routeFlyPending=locationFlyPending=locationAnimatePending=journeyFlyPending=false;if(currentLocation)currentLocation.follow=false;}
 travelVisibility();scheduleTravelControls();if(on)scheduleTravelCamera();
 drawCompletedEvents();
}
function drawJourney(points,fly){
 if(!viewer||!travelSceneReady||ANALYTICS)return;
 clear(journeyEntities);
 const valid=points.slice(0,2).filter(p=>p&&typeof p.label==='string'&&travelCoordinates(p.coordinates));
 const gold=Cesium.Color.fromCssColorString('#f3ead7');
 const framePositions=valid.map(p=>Cesium.Cartesian3.fromDegrees(...p.coordinates)),show=travelMode&&!roadRoute;
 valid.forEach(p=>journeyEntities.push(viewer.entities.add({show,position:Cesium.Cartesian3.fromDegrees(...p.coordinates),point:{pixelSize:8,color:gold,outlineColor:Cesium.Color.BLACK,outlineWidth:2,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND},label:{text:p.label.slice(0,80),font:'500 13px system-ui,sans-serif',fillColor:gold,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,20),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND}})));
 // A flight draft may show its planned connection. Ground directions never get
 // a guessed straight line while their real road route is loading.
 if(journeyConnect&&!roadRoute&&valid.length===2){try{
  const path=new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromDegrees(...valid[0].coordinates),Cesium.Cartographic.fromDegrees(...valid[1].coordinates));
  if(path.surfaceDistance>100){const positions=Array.from({length:81},(_,i)=>{const t=i/80,c=path.interpolateUsingFraction(t);return Cesium.Cartesian3.fromRadians(c.longitude,c.latitude,20000+Math.sin(Math.PI*t)*Math.min(1000000,path.surfaceDistance*.08))});
   journeyEntities.push(viewer.entities.add({show,polyline:{positions,width:2,material:new Cesium.PolylineDashMaterialProperty({color:gold,dashLength:12}),arcType:Cesium.ArcType.NONE}}));
   framePositions.push(...positions);
  }
 }catch(_){/* Near-antipodal cities still get two truthful points, without a guessed path. */}}
 if(fly&&show)fitTravelPositions(framePositions);
}
window.__huJourney=()=>({travel:travelMode,points:journeyPoints.length,entities:journeyEntities.length});
/* Completed cohort events are public places supplied by the World Missions archive.
   Keep this layer separate from live missions, member locations and travel paths. */
let completedEvents=[],completedPins=[],completedOn=false;
let publicNewsPins=[],publicNewsItems=[],publicNewsOn=false;
function setWorldNewsPins(items,on){
 if(!parentFrame||ANALYTICS)return;
 publicNewsOn=on===true;const seen=new Set();
 publicNewsItems=(Array.isArray(items)?items:[]).slice(0,120).flatMap(x=>{
  if(!x||typeof x.id!=='string'||x.id.length>110||seen.has(x.id)||!Number.isFinite(x.lat)||!Number.isFinite(x.lon)||Math.abs(x.lat)>90||Math.abs(x.lon)>180||(x.lat===0&&x.lon===0))return [];
  seen.add(x.id);return [{id:x.id,lat:x.lat,lon:x.lon}];
 });drawWorldNewsPins();
}
/* A calibrated enamel-and-gold pin, not an undifferentiated bright dot.
   Draw once on a small transparent canvas; the Earth still supplies precise
   geographic placement and accessible story selection in the shared feed. */
let worldNewsMarkerImage=null;
function worldNewsMarker(){
 if(worldNewsMarkerImage)return worldNewsMarkerImage;
 const c=document.createElement('canvas');c.width=c.height=96;
 const g=c.getContext('2d'),x=48,y=45;
 const glow=g.createRadialGradient(x,y,5,x,y,42);
 glow.addColorStop(0,'rgba(245,221,180,.30)');
 glow.addColorStop(.5,'rgba(214,178,119,.12)');
 glow.addColorStop(1,'rgba(214,178,119,0)');
 g.fillStyle=glow;g.fillRect(0,0,96,96);
 g.save();g.translate(x,y);g.rotate(Math.PI/4);
 g.shadowBlur=8;g.shadowColor='rgba(244,213,164,.48)';
 const shell=g.createLinearGradient(-16,-16,17,18);
 shell.addColorStop(0,'#f7e9c8');shell.addColorStop(.45,'#d0a971');shell.addColorStop(1,'#896540');
 g.fillStyle=shell;g.fillRect(-15,-15,30,30);
 g.shadowBlur=0;
 g.fillStyle='#13202c';g.fillRect(-11.5,-11.5,23,23);
 g.strokeStyle='rgba(255,255,255,.34)';g.lineWidth=1;
 g.strokeRect(-10.5,-10.5,21,21);
 g.restore();
 g.beginPath();g.arc(x,y,4.2,0,Math.PI*2);
 g.fillStyle='#f8e4b8';g.shadowBlur=6;g.shadowColor='#f0cf9b';g.fill();
 worldNewsMarkerImage=c.toDataURL('image/png');
 return worldNewsMarkerImage;
}
function drawWorldNewsPins(){
 if(!viewer)return;clear(publicNewsPins);if(!publicNewsOn||travelMode||ANALYTICS)return;
 const marker=worldNewsMarker();
 publicNewsItems.forEach(x=>publicNewsPins.push(viewer.entities.add({
   position:Cesium.Cartesian3.fromDegrees(x.lon,x.lat,3300),
   billboard:{image:marker,width:27,height:27,
     verticalOrigin:Cesium.VerticalOrigin.CENTER,
     scaleByDistance:new Cesium.NearFarScalar(150000,1.12,22000000,.48),
     distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,25000000)},
   properties:{worldNewsId:x.id}
 })));
}
window.__huWorldNewsPins=()=>({on:publicNewsOn,pins:publicNewsPins.length,items:publicNewsItems.length});

function sanitizeCompletedEvents(rows){
 const seen=new Set();return (Array.isArray(rows)?rows:[]).slice(0,50).flatMap(e=>{
  if(!e||typeof e.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(e.id)||seen.has(e.id)||typeof e.title!=='string')return [];
  const latitude=e.latitude,longitude=e.longitude,title=e.title.replace(/\s+/g,' ').trim().slice(0,120);
  if(!title||typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||(latitude===0&&longitude===0))return [];
  let date='';if(typeof e.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(e.date)){const d=new Date(e.date+'T00:00:00Z');if(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===e.date)date=e.date;}
  seen.add(e.id);return [{id:e.id,title,latitude,longitude,date}];
 });
}
function completedVisible(){return !!parentFrame&&!ANALYTICS&&!travelMode&&completedOn;}
function setCompletedEvents(rows,on){
 if(!parentFrame||ANALYTICS)return;completedEvents=sanitizeCompletedEvents(rows);completedOn=on===true;drawCompletedEvents();drawWorldNewsPins();
}
function drawCompletedEvents(){
 if(!viewer)return;clear(completedPins);if(!completedVisible())return;
 const green=Cesium.Color.fromCssColorString('#83e2bc');
 completedEvents.forEach(e=>completedPins.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(e.longitude,e.latitude,3000),point:{pixelSize:13,color:green,outlineColor:Cesium.Color.fromCssColorString('#07231c'),outlineWidth:3},label:{text:'Completed · '+e.title+(e.date?' · '+e.date:''),font:'600 12px system-ui,sans-serif',fillColor:green,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-24),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,8000000)},properties:{completedEventId:e.id}})));
}
function selectCompletedEvent(id){
 if(!completedVisible()||!completedEvents.some(e=>e.id===id))return false;
 tell({type:'hu:completed-selected',eventId:id});return true;
}
window.__huCompletedMissions=()=>({on:completedVisible(),events:completedEvents.length,pins:completedPins.length});
/* the network band is short, so its Earth starts closer and fills the frame */
function homeAltitude(){
 if(EDITORIAL&&viewer){const canvas=viewer.scene.canvas,fov=viewer.camera.frustum.fovy||Math.PI/3,aspect=canvas.clientWidth/Math.max(1,canvas.clientHeight);const angle=Math.atan(Math.tan(fov/2)*Math.min(1,aspect)*.9);return Cesium.Ellipsoid.WGS84.maximumRadius/Math.sin(angle)-Cesium.Ellipsoid.WGS84.maximumRadius}
 return document.documentElement.classList.contains('globe-surface-network')||EXPLORE?12500000:19000000
}
function homePosition(){return Cesium.Cartesian3.fromDegrees(EDITORIAL?-35:0,EDITORIAL?25:15,homeAltitude())}

let readyMessage=null;function tell(msg){if(EXPLORE)exploreTell(msg);if(!parentFrame)return;try{parentFrame.postMessage(msg,location.origin)}catch(e){}}
/* on the full pane there is no parent to tell, so the layer line and a guest's lock are painted here, in the World's own words
   (js/mnet.js paintLayerLine). The Vaunt lead is the owner's referral, the same one the World shows. */
const VAUNT_LEAD='https://vauntapi.flyvaunt.com/referral/nuao1K';const exploreLayers={};
/* A DEGREE IS A REAL NUMBER OR NOTHING. Number(null), Number('') and Number(false) are all 0, and isFinite(null) is true, so a
   missing latitude used to become the equator (and a missing cell edge the prime meridian). deg() never turns "nothing" into 0. */
function deg(v){if(v===null||v===undefined||v===''||typeof v==='boolean'||Array.isArray(v))return null;const n=Number(v);return Number.isFinite(n)?n:null}
function lonLat(lon,lat){const x=deg(lon),y=deg(lat);return x===null||y===null||Math.abs(y)>90||Math.abs(x)>180||(x===0&&y===0)?null:[x,y]}
/* [west, south, east, north], the order /v1/intel/geo's cell_bounds and Cesium.Rectangle.fromDegrees both use */
function cellBounds(bd){if(!Array.isArray(bd)||bd.length!==4)return null;const b=bd.map(deg);if(b.some(v=>v===null))return null;const[w,s_,e,n]=b;return w<e&&s_<n&&w>=-180&&e<=180&&s_>=-90&&n<=90?b:null}
function escHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtCount(n){n=Number(n)||0;try{return n.toLocaleString('en-US')}catch(e){return String(n)}}
function exploreTell(d){const box=$('exploreLine');if(!box||!d)return;
 if(d.type==='hu:ask-sign-in'){box.innerHTML='<span>Sign in to see satellites and space missions on the Earth.</span> <a class="explore-lead" href="account.html?stay=1">Sign in \u2192</a>';box.hidden=false;return}
 if(d.type!=='hu:layer')return;
 if(d.on)exploreLayers[d.layer]=d;else delete exploreLayers[d.layer];
 const rows=[],f=exploreLayers.flights,s=exploreLayers.satellites,l=exploreLayers.launches;
 if(f)rows.push(f.unavailable?'<span>Flights are unavailable right now.</span>':'<span>'+escHtml(fmtCount(f.count))+' aircraft in the air right now'+(f.stale?' (last snapshot)':'')+'.</span> <a class="explore-lead" href="'+VAUNT_LEAD+'" target="_blank" rel="noopener sponsored">Fly Vaunt \u2192</a>');
 if(s)rows.push('<span>'+(s.unavailable?'Satellites are unavailable right now.':escHtml(fmtCount(s.count))+' satellites · calculated positions.')+'</span>');
 if(l){const nx=l.next&&l.next[0];rows.push('<span>'+(l.unavailable?'Launches are unavailable right now.':escHtml(fmtCount(l.count))+' launches coming up'+(nx?' \u00b7 next: '+escHtml(String(nx.name||'').split('|')[0].trim())+(nx.net&&!isNaN(new Date(nx.net))?' \u00b7 '+escHtml(new Date(nx.net).toLocaleDateString('en-US',{month:'short',day:'numeric'})):'')+(nx.where?' \u00b7 '+escHtml(nx.where):''):'')+'.')+'</span>')}
 const ii=exploreLayers.intel;if(ii)rows.push('<span>Intel events: '+escHtml(fmtCount(ii.count))+' located, '+escHtml(fmtCount(ii.unknown))+' without a place, '+escHtml(fmtCount(ii.suppressed))+' in cells under five.'+(ii.attribution?' Sources: '+escHtml(ii.attribution)+'.':'')+'</span>');
 const cc=exploreLayers.cctv;if(cc)rows.push('<span>'+escHtml(fmtCount(cc.count))+' public cameras. Tap one for its live snapshot.</span>');
 if(d.failed&&!d.on)rows.push('<span>'+escHtml(d.layer.charAt(0).toUpperCase()+d.layer.slice(1))+' could not load right now.</span>');
 box.innerHTML=rows.join('<br>');box.hidden=!rows.length}
function publicMission(m){return {mission_id:m.mission_id,title:m.title,description:String(m.description||'').slice(0,280),region_label:m.region_label,action_path:m.action_path}}
function announce(){const m=missions[i];if(m)tell({type:'hu:mission-selected',mission:publicMission(m)})}
function focusMission(id){
 let n=missions.findIndex(m=>m.mission_id===id);
 if(n<0&&allMissions.some(m=>m.mission_id===id)){
  // Search and the public mission list can choose a mission beyond the current
  // country. Release that filter before focusing the explicit choice.
  $('worldSearch').value='';if(countries)countries.select(null);searchPins('');
  n=missions.findIndex(m=>m.mission_id===id);
 }
 if(n<0)return false;show(n);announce();return true
}
window.addEventListener('message',e=>{if(!parentFrame||e.source!==parentFrame||e.origin!==location.origin)return;const d=e.data||{};
if(d.type==='hu:hello'){if(readyMessage)tell(readyMessage);return}
if(d.type==='hu:travel-mode'&&!ANALYTICS){setTravelMode(d.on===true);return}
if(d.type==='hu:map-pick-mode'&&!ANALYTICS){travelPickKind(d.kind);return}
if(d.type==='hu:completed-missions'&&!ANALYTICS){setCompletedEvents(d.events,d.on);return}
if(d.type==='hu:world-news-pins'&&!ANALYTICS){setWorldNewsPins(d.items,d.on);return}
if(d.type==='hu:journey'&&!ANALYTICS&&Array.isArray(d.points)){
 journeyPoints=d.points.slice(0,2).filter(p=>p&&typeof p.label==='string'&&travelCoordinates(p.coordinates)).map(p=>({label:p.label.slice(0,80),coordinates:travelCoordinates(p.coordinates)}));
 journeyConnect=d.connect!==false;journeyFlyPending=journeyFlyPending||d.fly===true;drawJourney(journeyPoints,false);scheduleTravelCamera();return;
}
if(d.type==='hu:route'&&!ANALYTICS){
 const next=d.route===null?null:travelRoute(d.route);if(d.route!==null&&!next)return;
 const changed=roadRoute!==next&&!sameTravelRoute(roadRoute,next);roadRoute=next;routeFlyPending=!!next&&(routeFlyPending||d.fly===true);
 if(changed){drawJourney(journeyPoints,false);drawRoadRoute()}else scheduleTravelCamera();return;
}
if(d.type==='hu:location'&&!ANALYTICS){setTravelLocation(d);return}
if(d.type==='hu:location-state'&&!ANALYTICS){const b=$('ctlLocate');if(b){b.disabled=d.busy===true;b.setAttribute('aria-busy',String(d.busy===true));b.setAttribute('aria-label',d.busy===true?'Finding your current location':'Use my current location');}return}
if(d.type==='hu:route-step'&&!ANALYTICS&&travelMode&&roadRoute){
 const coordinates=travelCoordinates(d.coordinates);if(coordinates){if(currentLocation)currentLocation.follow=false;routeFlyPending=locationFlyPending=locationAnimatePending=journeyFlyPending=false;focusTravelPosition(coordinates)}return;
}
if(d.type==='hu:search'&&typeof d.q==='string'&&viewer){searchPins(d.q.slice(0,80));return}
if(d.type==='hu:focus-mission'&&typeof d.missionId==='string'){if(!viewer||!focusMission(d.missionId))tell({type:'hu:selection-cleared'});return}
if(d.type==='hu:regional'&&viewer){showCities=!!d.on;draw();tell({type:'hu:status',text:!showCities?'Regional impact is hidden.':cities.length?cities.length+(cities.length===1?' region shows its':' regions show their')+' totals: members who agreed to be counted, and verified actions.':'No region has five members who agreed to be counted yet.'});return}
if(d.type==='hu:near-me'){const b=$('ctlLocate');if(b)b.click();return}
if(d.type==='hu:live-places'&&!ANALYTICS){setLivePlaces(d.source,d.places);return}
/* the page puts a signed-out visitor back in their own region (js/mnet.js); select() tells the page through hu:country */
if(d.type==='hu:select-country'){if(countries&&typeof d.code==='string'&&/^[A-Z]{2}$/.test(d.code))countries.select(d.code);return}
/* a news card's "On the Earth" (js/mnet.js): the place a story MENTIONS. Anything can post a message, so the numbers are checked here too */
if(d.type==='hu:focus-place'){if(viewer)focusPlace(d);return}
/* the creator-only audience layer: the page says who may see the switch, and sends the points it fetched with the creator's own session */
if(d.type==='hu:creator-mode'){d.on=!!d.on&&!lockOf('audience');const b=$('ctlAudience');if(b){b.hidden=!d.on;if(!d.on){b.setAttribute('aria-pressed','false');drawAudience([])}}return}
if(d.type==='hu:audience-points'&&Array.isArray(d.points)&&viewer&&!lockOf('audience')){drawAudience(d.points.slice(0,250));return}
if(d.type==='hu:analytics-points'&&ANALYTICS&&Array.isArray(d.points)){analytics.points=d.points.slice(0,300);analytics.selected=typeof d.selected==='string'?d.selected:null;drawAnalytics();return}
if(d.type==='hu:analytics-select'&&ANALYTICS){selectAnalytics(typeof d.code==='string'?d.code:null,true);return}
if(d.type==='hu:clear-selection'&&viewer){selectionShown=false;missionPins.forEach(p=>{if(p.billboard)p.billboard.scale=1});setSelection(false);closeDetail();viewer.camera.flyTo({destination:homePosition(),duration:1.4})}});let missions=[],allMissions=[],cities=[],regions=[],i=0,viewer,missionPins=[],cityPins=[],showMissions=true,showCities=true,activeRegion=null,regionOutlines=[];
window.addEventListener('pagehide',()=>{
 roadRoute=currentLocation=null;journeyPoints=[];roadPositions=[];routeFlyPending=locationFlyPending=locationAnimatePending=journeyFlyPending=false;
 if(viewer){clear(roadEntities);clear(locationEntities);clear(journeyEntities)}
});
window.addEventListener('pageshow',event=>{if(event.persisted&&readyMessage)tell(readyMessage)});
async function rpc(name){const r=await fetch(SB+'/rest/v1/rpc/'+name,{headers:{apikey:KEY,Authorization:'Bearer '+KEY}});if(!r.ok)throw Error('RPC '+r.status);return r.json()}
function clear(arr){arr.forEach(e=>viewer.entities.remove(e));arr.length=0}
/* for the browser checks: how many mission pins the Earth carries (none while the World is the social feed) */
window.__huMissionPins=()=>missionPins.length;
function draw(){clear(missionPins);clear(missionHalos);clear(cityPins);drawContinents();
/* a mission can have many pins (countries, an origin, a context region): every pin opens the same mission */
if(showMissions)missions.forEach((m,n)=>(m.pins||[m]).forEach((p,k)=>{const off=activeRegion&&p.region_key!==activeRegion,ctx=p.pin_role==='context',color=off?'#8b93a3':ctx?'#ffb15e':'#ff3d5e',size=EDITORIAL?(ctx?16:22):(ctx?22:30),position=Cesium.Cartesian3.fromDegrees(p.longitude,p.latitude,3000);
 if(!off){const phase=(n*7+k*3)%11,halo=size*2.6;missionHalos.push(viewer.entities.add({position,billboard:{image:glowHalo(color),width:halo,height:halo,scale:PULSE?new Cesium.CallbackProperty(()=>1+.24*Math.sin(Date.now()/280+phase),false):1.12,color:Cesium.Color.fromAlpha(Cesium.Color.WHITE,.85),eyeOffset:new Cesium.Cartesian3(0,0,120)},properties:{missionIndex:n,halo:true}}))}
 missionPins.push(viewer.entities.add({position,billboard:{image:glowPin(color),width:size,height:size,scale:n===i&&selectionShown?1.5:1},label:off?{text:'🔒',font:'14px sans-serif',pixelOffset:new Cesium.Cartesian2(0,-20)}:undefined,properties:{missionIndex:n}}))}));drawBusinesses();
if(showCities)cities.forEach(c=>cityPins.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(c.longitude,c.latitude),point:{pixelSize:Math.min(22,7+Math.sqrt(c.member_count)),color:Cesium.Color.fromCssColorString('#f4b2b6')},label:{text:c.region_label+' · '+c.member_count+' members · '+c.verified_actions+' actions',font:'12px sans-serif',pixelOffset:new Cesium.Cartesian2(0,-20),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,2400000)}})))}
function show(n){if(!missions.length)return;const next=(n+missions.length)%missions.length;const m=missions[next];i=next;selectionShown=true;missionPins.forEach(p=>{if(p.billboard)p.billboard.scale=p.properties?.missionIndex?.getValue()===i?1.5:1});$('title').textContent=m.title;$('description').textContent=m.description;$('path').textContent=(m.action_path||'mission').replace('_',' ').toUpperCase()+' · '+m.region_label;$('position').textContent=(i+1)+' / '+missions.length;$('missionLink').href='mnet.html?mission='+encodeURIComponent(m.mission_id);setSelection(true);viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(m.longitude,m.latitude,1150000),orientation:{heading:Cesium.Math.toRadians(0),pitch:Cesium.Math.toRadians(-75),roll:0},duration:2.2,easingFunction:Cesium.EasingFunction.QUADRATIC_IN_OUT})}
function setMode(mode){if(mode==='feed'){$('worldFeed').scrollTo({top:0,behavior:'smooth'});$('feedMode').classList.add('is-active');$('globeMode').classList.remove('is-active');}else{$('globeMode').classList.add('is-active');$('feedMode').classList.remove('is-active');closeDetail();}viewer?.resize();}
function setSelection(selected){$('worldFilters').hidden=selected;$('mission').hidden=!selected;$('clearSelection').hidden=!selected;$('filterBack').hidden=!selected;$('deckHeading').textContent=selected?'Selected mission':'Explore the world';}
function closeDetail(){document.documentElement.classList.remove('world-detail-open');$('worldDetail').hidden=true;$('feedBack').hidden=true;$('feedHeading').textContent='MISSIONS';$('worldFeedList').hidden=false;}
function openDetail(n){if(!missions[n])return;show(n);const m=missions[n];$('detailRegion').textContent=(m.region_label||'World')+' · '+(m.action_path||'mission').replace('_',' ');$('detailTitle').textContent=m.title;$('detailDescription').textContent=m.description||'Open the mission to learn how to take action.';$('detailJoin').href='mnet.html?mission='+encodeURIComponent(m.mission_id);$('worldDetail').hidden=false;$('feedBack').hidden=false;$('worldFeedList').hidden=true;$('feedHeading').textContent='MISSION STORY';document.documentElement.classList.add('world-detail-open');$('worldFeed').scrollTop=0;}
function renderFeed(){const list=$('worldFeedList');list.replaceChildren();$('feedCount').textContent=missions.length+' missions';if(!missions.length){const empty=document.createElement('p');empty.textContent=allMissions.length?'No published missions match your search.':'Regional mission pins have not been published yet.';list.appendChild(empty);if(!allMissions.length){const link=document.createElement('a');link.href='mnet.html?view=missions';link.textContent='Browse worldwide actions →';list.appendChild(link)}return;}missions.forEach((m,n)=>{const article=document.createElement('article');article.className='world-story';article.id='world-story-'+n;article.tabIndex=0;article.setAttribute('role','button');article.setAttribute('aria-label','Read '+m.title);const meta=document.createElement('small');meta.textContent=(m.region_label||'World')+' · '+(m.action_path||'mission').replace('_',' ');const title=document.createElement('h2');title.textContent=m.title;const description=document.createElement('p');description.textContent=m.description||'Explore this mission and the actions people can take.';article.append(meta,title,description);article.onclick=()=>openDetail(n);article.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDetail(n)}};list.appendChild(article);});}
function filterMissions(){const q=$('worldSearch').value.trim().toLocaleLowerCase();const selected=missions[i]?.mission_id;missions=allMissions.filter(m=>inCountry(m)&&(!q||[m.title,m.description,m.region_label,m.action_path].some(v=>String(v||'').toLocaleLowerCase().includes(q))));i=Math.max(0,missions.findIndex(m=>m.mission_id===selected));draw();renderFeed();$('mission').hidden=!missions.length;$('status').hidden=!!missions.length;if(missions.length)show(i);else {setSelection(false);closeDetail();$('status').textContent=allMissions.length?'No missions match your search.':'Regional mission pins are not published yet. Browse worldwide actions in Action Network.';}}
/* MANY PINS, ONE MISSION (supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql):
   action_globe_public_region_missions() returns one row per pin, origin first. The feed, the search and
   the deck stay one entry per mission; the Earth draws every pin. Rows without a real point are dropped,
   never placed at 0,0. */
function groupPins(rows){const by=new Map();(Array.isArray(rows)?rows:[]).forEach(r=>{if(!r||!Number.isFinite(r.latitude)||!Number.isFinite(r.longitude))return;let m=by.get(r.mission_id);if(!m){m=Object.assign({},r,{pins:[]});by.set(r.mission_id,m)}m.pins.push({region_key:r.region_key,region_label:r.region_label,country_code:r.country_code||String(r.region_key||'').slice(0,2),latitude:r.latitude,longitude:r.longitude,pin_role:r.pin_role||'pin'})});
 return [...by.values()].map(m=>{const reach=new Set(m.pins.filter(p=>p.pin_role!=='context').map(p=>p.country_code)).size;if(m.pins.length>1&&reach>1)m.region_label=reach+' countries';return m})}
/* approved Black businesses (owner-reviewed listings): coarse points unless the business chose exact */
let businesses=[],businessPins=[],businessesTried=false;
function drawBusinesses(){if(!viewer)return;clear(businessPins);if(!businessesTried){businessesTried=true;rpc('action_globe_public_business_pins').then(r=>{businesses=(Array.isArray(r)?r:[]).filter(b=>Number.isFinite(b.latitude)&&Number.isFinite(b.longitude)&&!(b.latitude===0&&b.longitude===0));drawBusinesses()}).catch(()=>{});return}if(!showMissions)return;
 businesses.forEach(b=>businessPins.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(b.longitude,b.latitude,2000),point:{pixelSize:9,color:Cesium.Color.fromCssColorString('#f5c542'),outlineColor:Cesium.Color.fromCssColorString('#03060c'),outlineWidth:2},label:{text:String(b.business_name||'').slice(0,60)+' · '+String(b.area_label||'').slice(0,60),font:'12px sans-serif',pixelOffset:new Cesium.Cartesian2(0,-16),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,1500000)}})))}
function setRegion(region){activeRegion=region?.region_key||null;const button=$('nearMe');button.textContent=activeRegion?'Region: '+region.region_label:'Near me';$('status').hidden=false;$('status').textContent=activeRegion?'Showing missions in '+region.region_label+'. Other regions are locked in this view; location does not establish mission eligibility.':'Worldwide exploration restored.';filterMissions();}
async function drawBoundaries(){let rows;try{rows=await rpc('action_globe_public_boundaries')}catch(e){console.warn('Boundaries not available',e);return;}regionOutlines.forEach(x=>viewer.dataSources.remove(x));regionOutlines=[];for(const row of rows){try{const feature={type:'Feature',properties:{region_key:row.region_key,region_label:row.region_label},geometry:row.geometry};const source=await Cesium.GeoJsonDataSource.load(feature,{stroke:Cesium.Color.fromCssColorString('#8cb2d9').withAlpha(.65),strokeWidth:1,fill:Cesium.Color.TRANSPARENT,clampToGround:true});await viewer.dataSources.add(source);regionOutlines.push(source);}catch(e){console.warn('Invalid public boundary',row.region_key,e)}}}
function nearestKnownRegion(latitude,longitude){/* Centroids are not boundaries: never use nearest centroid to assert residency. */return null;}
function paintMembersDoor(){const card=$('worldMembers');if(!card)return;let member=false;try{const s=JSON.parse(localStorage.getItem('mccdb_session')||'null');member=!!(s&&(s.access_token||s.refresh_token))}catch(e){}if(member){$('worldMembersText').textContent='Your feed sits under the globe on your World screen.';const a=$('worldMembersLink');a.textContent='Open World';a.href='mnet.html?view=feed'}}
/* ---------- the World look (owner's mockups, 2026-10-14) ----------
   A lit NASA Earth (below), the street map one tap away, an atmosphere
   rim, glowing pins, and continent labels that count public pins only. */
/* THE EARTH (owner's signed-out reference, 2026-10-14): NASA imagery only, all public domain. Day: Blue Marble Next Generation.
   Night: NASA's VIIRS City Lights. Clouds: the Visible Earth composite, a still, not today's weather. The globe's Sun position and day/night line track real time. */
const DAY_TILES='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
/* NASA's City Lights (VIIRS 2012): brighter, crisper lights on a dark Earth than Black Marble 2016's moonlit land */
const NIGHT_TILES='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const CLOUDS='assets/img/globe/nasa-clouds-2048.webp';
const EDITORIAL_CLOUD_ALPHA=.65;
let mapLayer=null,dayLayer=null,nightLayer=null,cloudLayer=null,layerMode='auto',selectionShown=false,continentLabels=[];const pinCache={};
/* MISSION PINS PULSE (owner, 2026-10-19: the dots were too easy to miss). A red halo breathes behind every open mission pin. It is
   decoration only: a tap falls through it to the pin, a marker or the country underneath, so a wide halo over a small country
   never swallows that country's tap. Reduced motion keeps the halo still. */
const missionHalos=[],PULSE=!matchMedia('(prefers-reduced-motion: reduce)').matches;
/* WHERE PEOPLE ARE LIVE (owner, 2026-10-20: "go through the globe, just like you can go through Bigo … where people are live").
   The page sends counts per country from each live source (audio conversations, broadcasts a host placed in a country); a
   breathing red badge marks every country with something on air. A tap selects that country, which narrows the feed and
   the conversations to it. Counts only: never a person, never a point finer than the country's label. */
const liveSources={},livePins=[];let liveRetry=0;
function setLivePlaces(source,places){
 if(!/^[a-z]{1,16}$/.test(String(source||'')))return;
 const m=new Map();(Array.isArray(places)?places:[]).slice(0,250).forEach(p=>{const c=String(p&&p.code||''),n=Math.floor(Number(p&&p.count));if(/^[A-Z]{2}$/.test(c)&&n>0&&n<1e5)m.set(c,(m.get(c)||0)+n)});
 liveSources[source]=m;liveRetry=0;drawLivePlaces();
}
function drawLivePlaces(){
 if(!viewer||!countries)return;
 if(!countries.ready()){if(liveRetry++<40)setTimeout(drawLivePlaces,750);return}
 livePins.splice(0).forEach(e=>viewer.entities.remove(e));
 const total=new Map();Object.values(liveSources).forEach(m=>m.forEach((n,c)=>total.set(c,(total.get(c)||0)+n)));
 total.forEach((n,code)=>{const pt=countries.point(code);if(!pt)return;const img=liveBadge(n);
  livePins.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(pt[0],pt[1],0),billboard:{image:img.url,width:img.w,height:img.h,
   verticalOrigin:Cesium.VerticalOrigin.BOTTOM,pixelOffset:new Cesium.Cartesian2(0,-16),eyeOffset:new Cesium.Cartesian3(0,0,-200),
   scale:PULSE?new Cesium.CallbackProperty(()=>1+.07*Math.sin(Date.now()/320),false):1},properties:{liveCountry:code}}))});
 window.__huLivePlaces=()=>Object.fromEntries(total);
}
function liveBadge(n){const t='LIVE '+(n>99?'99+':n),key='live:'+t;if(pinCache[key])return pinCache[key];
 const c=document.createElement('canvas'),g=c.getContext('2d'),f='700 22px Inter, system-ui, sans-serif';g.font=f;
 const w=Math.ceil(g.measureText(t).width)+52,h=40;c.width=w;c.height=h;g.font=f;
 g.fillStyle='#d8002a';g.beginPath();if(g.roundRect)g.roundRect(1,1,w-2,h-2,19);else g.rect(1,1,w-2,h-2);g.fill();g.strokeStyle='rgba(255,255,255,.85)';g.lineWidth=2;g.stroke();
 g.fillStyle='#fff';g.beginPath();g.arc(21,20,6,0,Math.PI*2);g.fill();g.textBaseline='middle';g.fillText(t,34,21);
 return(pinCache[key]={url:c.toDataURL(),w:w/2,h:h/2})}
function pickSolid(position){const list=viewer.scene.drillPick(position,6)||[];return list.find(x=>!(x&&x.id&&x.id.properties&&x.id.properties.halo))||null}
function glowHalo(color){const key='halo:'+color;if(pinCache[key])return pinCache[key];const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d');const r=g.createRadialGradient(48,48,6,48,48,46);r.addColorStop(0,color+'e6');r.addColorStop(.35,color+'80');r.addColorStop(.7,color+'26');r.addColorStop(1,color+'00');g.fillStyle=r;g.fillRect(0,0,96,96);return pinCache[key]=c.toDataURL('image/png')}
/* Mission markers share the refined enamel language: legible at phone zoom,
   hue encodes the original action type; no overbright blurry white-center dots.
   Cached per hue so thousands of visible points share only a few GPU textures. */
function glowPin(color){
 if(pinCache[color])return pinCache[color];
 const c=document.createElement('canvas');c.width=c.height=88;
 const g=c.getContext('2d'),cx=44,cy=41;
 const halo=g.createRadialGradient(cx,cy,8,cx,cy,40);
 halo.addColorStop(0,'rgba(241,223,198,.23)');
 halo.addColorStop(.52,'rgba(184,152,121,.09)');
 halo.addColorStop(1,'rgba(184,152,121,0)');
 g.fillStyle=halo;g.fillRect(0,0,88,88);
 g.save();g.translate(cx,cy);g.rotate(Math.PI/4);
 g.shadowBlur=9;g.shadowColor=color;
 g.fillStyle='#0d1721';g.fillRect(-18,-18,36,36);
 const bezel=g.createLinearGradient(-18,-18,18,18);
 bezel.addColorStop(0,'#f0ded0');bezel.addColorStop(.43,color);
 bezel.addColorStop(1,'#6b7a8b');
 g.strokeStyle=bezel;g.lineWidth=3;g.strokeRect(-16,-16,32,32);
 g.shadowBlur=0;
 g.strokeStyle='rgba(255,255,255,.24)';g.lineWidth=1;g.strokeRect(-12,-12,24,24);
 g.restore();
 const jewel=g.createRadialGradient(cx-2,cy-3,0,cx,cy,8);
 jewel.addColorStop(0,'#fff1dd');jewel.addColorStop(.35,color);jewel.addColorStop(1,'#192331');
 g.fillStyle=jewel;g.beginPath();g.arc(cx,cy,7,0,Math.PI*2);g.fill();
 g.strokeStyle='rgba(255,255,255,.6)';g.lineWidth=1;g.stroke();
 return pinCache[color]=c.toDataURL('image/png');
}
function sizeEditorialResolution(){
 const canvas=viewer.scene.canvas,pixels=Math.max(1,canvas.clientWidth*canvas.clientHeight);
 viewer.resolutionScale=Math.max(1,Math.min(window.devicePixelRatio||1,2,Math.sqrt(800000/pixels)));
}
function styleScene(){const sc=viewer.scene;sc.backgroundColor=Cesium.Color.fromCssColorString('#03060c');sc.globe.baseColor=Cesium.Color.fromCssColorString('#050a14');
 /* day and night by the real sun. In 3D these fade distances are measured from the Earth's CENTRE, so each carries the radius:
    shading eases off between ~3,000 and ~1,200 km up (the street map takes over at 900 km), and the ground atmosphere's night
    darkness is pushed out of reach so it never paints over the city lights. */
 const R=Cesium.Ellipsoid.WGS84.maximumRadius;viewer.clock.clockStep=Cesium.ClockStep.SYSTEM_CLOCK;sc.globe.enableLighting=true;sc.globe.dynamicAtmosphereLighting=true;sc.globe.dynamicAtmosphereLightingFromSun=true;
 sc.globe.lightingFadeOutDistance=R+1.2e6;sc.globe.lightingFadeInDistance=R+3e6;sc.globe.nightFadeOutDistance=R+1.2e6;sc.globe.nightFadeInDistance=1e9;sc.globe.atmosphereLightIntensity=8;if(sc.skyAtmosphere)sc.skyAtmosphere.show=true;sc.globe.showGroundAtmosphere=true;sc.globe.atmosphereBrightnessShift=-0.05;sc.globe.atmosphereSaturationShift=0.1;sc.globe.atmosphereHueShift=-0.04;if(sc.skyAtmosphere){sc.skyAtmosphere.brightnessShift=0.15;sc.skyAtmosphere.saturationShift=0.1}
 if(EDITORIAL){
  // Sharpen small Retina globes; cap large canvases at an 800k-pixel budget.
  sizeEditorialResolution();
  sc.backgroundColor=Cesium.Color.fromCssColorString('#090b0d');sc.globe.baseColor=Cesium.Color.fromCssColorString('#082b4b');
  if(sc.skyBox)sc.skyBox.show=false;if(sc.sun)sc.sun.show=false;if(sc.moon)sc.moon.show=false;
  /* DAY AND NIGHT BY THE REAL SUN (owner, 2026-10-19): the lit side and the dark side follow the actual time, not a studio lamp.
     The night side carries NASA's city lights; the Sun disc itself stays hidden on the editorial globe. */
  sc.globe.enableLighting=true;sc.light=new Cesium.SunLight();sc.globe.dynamicAtmosphereLightingFromSun=true;sc.globe.atmosphereSaturationShift=.1;sc.globe.atmosphereBrightnessShift=-.05;
  if(sc.skyAtmosphere){sc.skyAtmosphere.saturationShift=.1;sc.skyAtmosphere.brightnessShift=.05}
  dayLayer.saturation=1.1;dayLayer.brightness=1.05;dayLayer.contrast=1.05;dayLayer.gamma=1.1;
  if(nightLayer){nightLayer.show=true;nightLayer.dayAlpha=0;nightLayer.nightAlpha=1;nightLayer.brightness=NIGHT_LIGHTS.brightness;nightLayer.contrast=NIGHT_LIGHTS.contrast;nightLayer.gamma=NIGHT_LIGHTS.gamma}if(cloudLayer){cloudLayer.show=true;cloudLayer.saturation=0;cloudLayer.brightness=1.1;cloudLayer.alpha=EDITORIAL_CLOUD_ALPHA}
 }
 window.__huGlobeStyle=()=>({editorial:EDITORIAL,saturation:dayLayer&&dayLayer.saturation,cloudAlpha:cloudLayer&&cloudLayer.alpha,atmosphereSaturation:sc.globe.atmosphereSaturationShift,stars:!!(sc.skyBox&&sc.skyBox.show)});
 travelStyle();
 /* a hook for the browser test: the evidence shots wait for the tiles */
 window.__huGlobeSettled=()=>!!(viewer&&viewer.scene.globe.tilesLoaded);viewer.camera.percentageChanged=0.08;
 /* labels draw over the limb instead of being cut by it, so only those on the near side of the Earth show */
 viewer.camera.changed.addEventListener(cullLabels);
 /* past street level the night tiles run out of detail, so the map takes over unless someone chose a style or Cesium ion's aerial imagery is there (streetAuto) */
 viewer.camera.changed.addEventListener(()=>{if(layerMode==='auto'&&mapLayer)mapLayer.show=streetAuto(viewer.camera.positionCartographic.height)});}
const CONTINENTS=[['North America',-100,46],['South America',-60,-16],['Europe',14,53],['Africa',19,4],['Asia',92,38],['Oceania',138,-26]];
/* rough boxes, only to word a label; never used for eligibility or anything a member does */
function continentOf(lat,lon){if(lat<-8&&(lon>110||lon<-150))return 'Oceania';if(lon<-25)return lat>8||lon<-82?'North America':'South America';if(lon>34&&lat>12&&lat<42)return 'Asia';if(lat>35&&lon<45)return 'Europe';if(lat<=37&&lon<52)return 'Africa';return lat>-11?'Asia':'Oceania'}
function drawContinents(){clear(continentLabels);if(EDITORIAL||!showMissions)return;const counts={};missions.forEach(m=>{const seen=new Set();(m.pins||[m]).forEach(p=>{if(Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)){const k=continentOf(p.latitude,p.longitude);if(!seen.has(k)){seen.add(k);counts[k]=(counts[k]||0)+1}}})});
 const far=new Cesium.DistanceDisplayCondition(7000000,Number.POSITIVE_INFINITY);
 CONTINENTS.forEach(([name,lon,lat])=>{const n=counts[name];if(!n)return;const at=Cesium.Cartesian3.fromDegrees(lon,lat,250000);
  continentLabels.push(viewer.entities.add({position:at,label:{text:name,font:'600 14px Inter,system-ui,sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.fromCssColorString('#03060c'),outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,distanceDisplayCondition:far,disableDepthTestDistance:Number.POSITIVE_INFINITY,pixelOffset:new Cesium.Cartesian2(0,-9)}}));
  continentLabels.push(viewer.entities.add({position:at,label:{text:n+(n===1?' mission':' missions'),font:'500 12px Inter,system-ui,sans-serif',fillColor:Cesium.Color.fromCssColorString('#c7d0e0'),outlineColor:Cesium.Color.fromCssColorString('#03060c'),outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,distanceDisplayCondition:far,disableDepthTestDistance:Number.POSITIVE_INFINITY,pixelOffset:new Cesium.Cartesian2(0,9)}}));});cullLabels();}
function cullLabels(){if(!viewer||!continentLabels.length)return;const occ=new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84,viewer.camera.positionWC),now=viewer.clock.currentTime;continentLabels.forEach(e=>{e.show=occ.isPointVisible(e.position.getValue(now))})}
function searchPins(q){$('worldSearch').value=q;const t=q.trim().toLocaleLowerCase();missions=allMissions.filter(m=>inCountry(m)&&(!t||[m.title,m.description,m.region_label,m.action_path].some(v=>String(v||'').toLocaleLowerCase().includes(t))));i=0;selectionShown=false;draw();renderFeed()}
/* COUNTRIES (js/world-countries.js): borders, flags, the red-white-blue United States, the fade on zoom. A tapped country filters the pins
   to the missions pinned there (by the rows' own country codes; none means none) without moving the camera. */
let countries=null;function inCountry(m){return !countries||countries.keep(m)}
function mountCountries(){if(!window.HuCountries||ANALYTICS||!viewer)return;countries=HuCountries.mount(viewer,{quiet:EDITORIAL,missions:()=>allMissions,regions:()=>regions,onSelect:c=>{searchPins($('worldSearch').value);tell({type:'hu:country',country:c})}})}
/* three looks, one button: the lit Earth (real sun), the night Earth (city lights everywhere, the owner's World mockups), the street map */
function setLayer(mode){layerMode=mode;const night=mode==='night',g=viewer.scene.globe;if(mapLayer)mapLayer.show=mode==='map'||(mode==='auto'&&streetAuto(viewer.camera.positionCartographic.height));
 if(dayLayer)dayLayer.show=EDITORIAL||!night;if(cloudLayer)cloudLayer.show=EDITORIAL||!night;if(nightLayer){nightLayer.dayAlpha=night?1:0;nightLayer.brightness=night?2.1:6}
 g.enableLighting=EDITORIAL||!night;g.atmosphereBrightnessShift=EDITORIAL?-.05:night?-0.35:-0.05;
 const b=$('ctlLayers');if(b){b.setAttribute('aria-pressed',mode==='auto'?'false':'true');b.title=EDITORIAL?(mode==='map'?'Street map (tap for the Earth)':'The Earth (tap for street map)'):{auto:'The Earth (tap for night)',night:'Night Earth (tap for street map)',map:'Street map (tap for the Earth)'}[mode]}}
let audiencePins=[];
/* a hook for the browser test, like __huGlobeSettled: how many audience points are drawn */
window.__huAudienceCount=()=>audiencePins.length;
function drawAudience(points){if(!viewer)return;audiencePins.forEach(e=>viewer.entities.remove(e));audiencePins=[];
 points.forEach(p=>{const ll=lonLat(p.lon,p.lat),views=Math.max(0,Math.floor(Number(p.views)||0));if(!ll||!views)return;const[lon,lat]=ll;
  audiencePins.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lon,lat,2000),point:{pixelSize:Math.min(28,8+Math.sqrt(views)*2),color:Cesium.Color.fromCssColorString('#4fd1ff').withAlpha(.78),outlineColor:Cesium.Color.WHITE.withAlpha(.9),outlineWidth:1.5},
   label:{text:String(p.name||'').slice(0,40)+' · '+views.toLocaleString()+(views===1?' view':' views'),font:'600 12px Inter, system-ui, sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-20),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,1.8e7)}}))})}
/* ---------- THE WORLD'S DATA LAYERS (owner, 2026-10-15: "let's populate it … flights … satellites and space missions, that only logged in users can see") ----------
   Three toggles at the bottom-left. Flights is for everyone; Satellites and Launches are for members: the Worker checks the
   bearer with Supabase (workers/mccluster/src/world-layers.js), and here a guest's lock only says so and opens sign-in.
   Each source is credited on the imagery line while it is on, by the provider that answered (flights: adsb.lol or OpenSky). Satellites are propagated here from CelesTrak's elements
   (vendor/satellite.min.js, loaded on first use) so they move; flights are the last snapshot the Worker holds. */
const API='https://api.mccluster.org';
const DATA_LAYERS={flights:{id:'ctlFlights',members:false,color:'#ffb347',credit:'Flights: adsb.lol (ODbL)'},satellites:{id:'ctlSats',members:true,color:'#4fd1ff',credit:'Satellites: CelesTrak'},launches:{id:'ctlLaunch',members:true,color:'#ffffff',credit:'Launches: The Space Devs'}};
const layerState={flights:{on:false,points:null,count:0},satellites:{on:false,points:null,sats:[],labels:[],timer:0,count:0},launches:{on:false,entities:[],count:0}};
/* hooks for the browser test, like __huGlobeSettled */
window.__huLayerCounts=()=>({flights:layerState.flights.count,satellites:layerState.satellites.count,launches:layerState.launches.count});
window.__huLayerOn=k=>!!(layerState[k]&&layerState[k].on);
function sessionToken(){try{const s=JSON.parse(localStorage.getItem('mccdb_session')||'null');return s&&s.access_token||''}catch(e){return ''}}
function paintDataLocks(){if(typeof paintAccess==='function')paintAccess()}
async function layerFetch(k){const headers={accept:'application/json'};const t=sessionToken();if(t)headers.authorization='Bearer '+t;const r=await fetch(API+'/v1/world/layers/'+k,{headers});if(r.status===401)throw Error('members');if(!r.ok)throw Error('layer '+r.status);return r.json()}
function clearLayer(k){if(spaceFocus&&spaceFocus.layer===k)clearSpaceFocus();const L=layerState[k];if(L.points){viewer.scene.primitives.remove(L.points);L.points=null}if(L.labels){L.labels.forEach(e=>viewer.entities.remove(e));L.labels=[]}if(L.entities){L.entities.forEach(e=>viewer.entities.remove(e));L.entities=[]}if(L.sats)L.sats=[];if(L.timer){clearInterval(L.timer);L.timer=0}L.count=0}
/* Aircraft silhouettes identify observed contacts; they are not heading arrows.
   No synthetic movement or inferred itinerary is added to the provider snapshot. */
let aircraftIcon;
function flightIcon(){if(aircraftIcon)return aircraftIcon;const c=document.createElement('canvas');c.width=c.height=48;const x=c.getContext('2d');x.fillStyle='#ffcf82';x.strokeStyle='#221706';x.lineWidth=2;x.beginPath();x.moveTo(24,3);x.lineTo(28,8);x.lineTo(28,19);x.lineTo(43,29);x.lineTo(43,34);x.lineTo(28,29);x.lineTo(28,38);x.lineTo(34,43);x.lineTo(34,46);x.lineTo(24,43);x.lineTo(14,46);x.lineTo(14,43);x.lineTo(20,38);x.lineTo(20,29);x.lineTo(5,34);x.lineTo(5,29);x.lineTo(20,19);x.lineTo(20,8);x.closePath();x.fill();x.stroke();aircraftIcon=c;return c}
function drawFlights(data){const L=layerState.flights;clearLayer('flights');const col=new Cesium.BillboardCollection();
 (data.aircraft||[]).forEach(row=>{const a=window.HuTransport&&HuTransport.aircraft(row);if(!a)return;
  col.add({position:Cesium.Cartesian3.fromDegrees(a.lon,a.lat,Math.max(0,a.altitude??9000)),image:flightIcon(),width:20,height:20,
   scaleByDistance:new Cesium.NearFarScalar(100000,1.2,20000000,.35),id:{layer:'flights',aircraft:a,stale:!!data.stale}})});
 viewer.scene.primitives.add(col);L.points=col;L.count=col.length}
function openAircraft(contact){const a=contact.aircraft;if(!a)return;const known=(v,suffix)=>v===null?'Unknown':Math.round(v).toLocaleString()+' '+suffix;
 const values=[['Altitude',known(a.altitude===null?null:a.altitude*3.28084,'ft')],['Ground speed',known(a.speed===null?null:a.speed*1.94384,'kn')],['Track',known(a.heading,'°')],['ICAO',a.id||'Unknown']];
 sheet(a.callsign||'Aircraft contact','<p class="cctv-meta">'+(contact.stale?'Last available snapshot':'Latest received snapshot')+' · '+escHtml(layerState.flights.credit||DATA_LAYERS.flights.credit)+'</p><dl class="flight-facts">'+values.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escHtml(value)+'</dd></div>').join('')+'</dl><p>Position: '+a.lat.toFixed(3)+', '+a.lon.toFixed(3)+'</p><p class="cctv-note">A tracked aircraft is not a bookable flight. Origin, destination, fares and seats are not supplied by this feed.</p>');
 viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(a.lon,a.lat,Math.max(160000,(a.altitude||0)+130000)),duration:1.4})}
let spaceFocus=null;
function clearSpaceFocus(){if(!spaceFocus)return;spaceFocus.entities.forEach(e=>viewer.entities.remove(e));spaceFocus=null}
function openSatellite(sat){const now=new Date(),position=satPos(sat,now);if(!position)return;
 const times=HuSpace.orbitTimes(sat.rec,now.getTime()),path=times.map(t=>satPos(sat,t));
 const valid=path.length>1&&path.every(Boolean),geo=Cesium.Cartographic.fromCartesian(position);
 sheet(sat.name||'Satellite','<p class="cctv-meta">CelesTrak · position calculated from orbital elements</p><dl class="flight-facts"><div><dt>Altitude</dt><dd>'+Math.round(geo.height/1000).toLocaleString()+' km</dd></div><div><dt>Orbit preview</dt><dd>'+(valid?Math.round((times.at(-1)-now)/60000)+' minutes':'Unavailable')+'</dd></div></dl><p class="cctv-note">Generic 3D satellite schematic, enlarged for visibility. Shape and attitude do not represent this spacecraft. The cyan path predicts one orbit from its TLE, not a live observed trail.</p>');
 const model=viewer.entities.add({position,model:{uri:HuSpace.satelliteModel(),minimumPixelSize:90,maximumScale:25000},orientation:Cesium.Transforms.headingPitchRollQuaternion(position,new Cesium.HeadingPitchRoll(.5,.45,.25))});
 const entities=[model];if(valid)entities.push(viewer.entities.add({polyline:{positions:path,width:2,material:Cesium.Color.fromCssColorString('#4fd1ff').withAlpha(.75)}}));
 spaceFocus={layer:'satellites',sat,model,entities};viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(position,120000),{duration:1.5,offset:new Cesium.HeadingPitchRange(0,-.5,700000)});
}
function openLaunch(l){const pad=l.pad||{};if(!HuSpace.coordinates(pad.lon,pad.lat))return;
 const date=l.net?new Date(l.net):null,when=date&&!isNaN(date)?date.toLocaleString():'To be announced';
 sheet(l.name||'Space mission','<p class="cctv-meta">The Space Devs · launch schedule</p><dl class="flight-facts"><div><dt>Scheduled</dt><dd>'+escHtml(when)+'</dd></div><div><dt>Status</dt><dd>'+escHtml(l.status||'Unknown')+'</dd></div></dl><p>'+escHtml(l.mission&&l.mission.name||'Mission details pending')+'</p><p>'+escHtml([pad.name,pad.location].filter(Boolean).join(' · '))+'</p><p class="cctv-note">Generic rocket schematic, enlarged at the pad. Not the actual vehicle or live flight telemetry. Schedule may change.</p>');
 const position=Cesium.Cartesian3.fromDegrees(pad.lon,pad.lat,0),model=viewer.entities.add({position,model:{uri:HuSpace.rocketModel(),minimumPixelSize:110,maximumScale:3000},orientation:Cesium.Transforms.headingPitchRollQuaternion(position,new Cesium.HeadingPitchRoll(0,0,0))});
 spaceFocus={layer:'launches',model,entities:[model]};viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(position,20000),{duration:1.5,offset:new Cesium.HeadingPitchRange(0,-.45,150000)});
}
function satPos(sat,now){try{const pv=satellite.propagate(sat.rec,now);if(!pv||!pv.position||typeof pv.position!=='object')return null;const g=satellite.eciToGeodetic(pv.position,satellite.gstime(now));if(!isFinite(g.latitude)||!isFinite(g.longitude)||!isFinite(g.height))return null;return Cesium.Cartesian3.fromRadians(g.longitude,g.latitude,Math.max(0,g.height*1000))}catch(e){return null}}
function stepSatellites(){const L=layerState.satellites;if(!L.points||!viewer)return;const now=new Date();L.sats.forEach(s=>{const p=satPos(s,now);if(!p)return;s.point.position=p;if(s.label)s.label.position=p;if(spaceFocus&&spaceFocus.sat===s)spaceFocus.model.position=p})}
function loadSatelliteLib(){if(window.satellite)return Promise.resolve();return new Promise((res,rej)=>{const t=document.createElement('script');t.src='vendor/satellite.min.js';t.onload=res;t.onerror=()=>rej(Error('sgp4'));document.head.appendChild(t)})}
const NAMED_SATS=/^(ISS \(ZARYA\)|CSS \(TIANHE\)|HST|TIANGONG)/;
async function drawSatellites(data){await loadSatelliteLib();const L=layerState.satellites;clearLayer('satellites');const col=new Cesium.PointPrimitiveCollection(),c=Cesium.Color.fromCssColorString(DATA_LAYERS.satellites.color),now=new Date();(data.satellites||[]).forEach(s=>{let rec;try{rec=satellite.twoline2satrec(String(s.tle1),String(s.tle2))}catch(e){return}const sat={rec,name:String(s.name||'')};const p=satPos(sat,now);if(!p)return;const named=NAMED_SATS.test(sat.name);sat.point=col.add({position:p,pixelSize:named?6:4,color:c,outlineColor:Cesium.Color.WHITE.withAlpha(.7),outlineWidth:named?1.5:0,id:{layer:'satellites',sat}});if(named){sat.label=viewer.entities.add({position:p,properties:{satellite:sat},label:{text:sat.name.replace(/ \(.*\)$/,''),font:'12px sans-serif',fillColor:Cesium.Color.fromCssColorString('#dff6ff'),style:Cesium.LabelStyle.FILL_AND_OUTLINE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,pixelOffset:new Cesium.Cartesian2(0,-12),verticalOrigin:Cesium.VerticalOrigin.BOTTOM}});L.labels.push(sat.label)}L.sats.push(sat)});viewer.scene.primitives.add(col);L.points=col;L.count=L.sats.length;L.timer=setInterval(stepSatellites,1500)}
function drawLaunches(data){const L=layerState.launches;clearLayer('launches');(data.launches||[]).forEach((l,n)=>{const pad=l&&l.pad||{};if(!HuSpace.coordinates(pad.lon,pad.lat))return;const when=l.net?new Date(l.net):null,day=when&&!isNaN(when)?when.toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';L.entities.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(pad.lon,pad.lat,4000),billboard:{image:glowPin(DATA_LAYERS.launches.color),width:22,height:22},label:{text:String(l.name||'Launch').split('|')[0].trim().slice(0,40)+(day?' · '+day:''),font:'11px sans-serif',fillColor:Cesium.Color.WHITE,style:Cesium.LabelStyle.FILL_AND_OUTLINE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,pixelOffset:new Cesium.Cartesian2(0,-16),verticalOrigin:Cesium.VerticalOrigin.BOTTOM,distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,2.6e7)},properties:{launch:l},id:'hu-launch-'+n+'-'+String(l.id||'').slice(0,40)}))});L.count=L.entities.length}
/* the place a news story MENTIONS (GDELT's extraction; js/mnet.js sends it from a news card), never where something happened.
   The Earth turns to it from above the region; a mission that was picked lets go, since the strip would describe the wrong place. */
let lastPlace=null;
/* a hook for the browser test, like __huGlobeSettled: the last place a news card sent */
window.__huFocusPlace=()=>lastPlace;
function focusPlace(d){const lat=d.lat,lon=d.lon;if(typeof lat!=='number'||typeof lon!=='number'||!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return false;
 lastPlace={lat,lon,label:typeof d.label==='string'?d.label.slice(0,120):''};selectionShown=false;missionPins.forEach(p=>{if(p.billboard)p.billboard.scale=1});
 viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lon,lat,900000),duration:1.4});return true}
/* the credit line grows when layers are on; the toggles and the controls stay above it, and the page is told how tall it is */
function creditHeight(){const el=document.querySelector('.osm-credit');return el?Math.ceil(el.getBoundingClientRect().height):0}
function liftAboveCredit(){const h=creditHeight();document.documentElement.style.setProperty('--hu-credit-h',h+'px');
 /* the bar floats a little off the bottom, so what matters is where its top is, not how tall it is */
 if(EXPLORE){const bar=document.querySelector('.appbar'),deck=$('deck'),px=el=>el&&!el.hidden?Math.ceil(el.getBoundingClientRect().height):0,barH=bar&&bar.offsetHeight?Math.max(0,Math.ceil(innerHeight-bar.getBoundingClientRect().top)):0;document.documentElement.style.setProperty('--hu-bar-h',barH+'px');document.documentElement.style.setProperty('--hu-sheet-h',px(deck)+'px')}
 return h}
function paintLayerCredits(){const c=$('layerCredits');if(!c)return;const parts=Object.keys(DATA_LAYERS).filter(k=>layerState[k].on).map(k=>layerState[k].credit||DATA_LAYERS[k].credit);c.textContent=parts.length?parts.join(' · ')+' · ':'';liftAboveCredit()}
async function toggleLayer(k){const spec=DATA_LAYERS[k],b=$(spec.id),L=layerState[k];if(!viewer||!b)return;if(!L.on&&lockOf(k)&&explainLock(k))return;if(spec.members&&!sessionToken()){tell({type:'hu:ask-sign-in',reason:'layers'});return}
 if(L.on){L.on=false;b.setAttribute('aria-pressed','false');clearLayer(k);paintLayerCredits();tell({type:'hu:layer',layer:k,on:false,creditHeight:creditHeight()});return}
 b.setAttribute('aria-busy','true');try{const data=await layerFetch(k);if(lockOf(k))return;if(k==='flights')drawFlights(data);else if(k==='satellites')await drawSatellites(data);else drawLaunches(data);if(lockOf(k)){clearLayer(k);return}L.credit=typeof data.credit==='string'?data.credit.slice(0,60):'';L.on=true;b.setAttribute('aria-pressed','true');paintLayerCredits();
  tell({type:'hu:layer',layer:k,on:true,count:L.count,creditHeight:creditHeight(),unavailable:!!data.unavailable,stale:!!data.stale,attribution:String(data.attribution||''),next:k==='launches'?(data.launches||[]).slice(0,3).map(l=>({name:String(l.name||''),net:l.net||null,where:String(l.pad&&(l.pad.location||l.pad.name)||'')})):undefined})}
 catch(e){if(String(e&&e.message)==='members'){paintDataLocks();tell({type:'hu:ask-sign-in',reason:'layers'})}else{try{console.warn('[world layer] '+k+': '+(e&&e.message||e))}catch(_){}tell({type:'hu:layer',layer:k,on:false,failed:true})}}finally{b.removeAttribute('aria-busy')}}
function wireDataLayers(){Object.keys(DATA_LAYERS).forEach(k=>{const b=$(DATA_LAYERS[k].id);if(b)b.onclick=()=>toggleLayer(k)});paintDataLocks();window.addEventListener('storage',paintDataLocks);const cb=$('ctlCctv');if(cb)cb.onclick=()=>toggleCctv();const mb=$('ctlMusic');if(mb)mb.onclick=showMusic;const ib=$('ctlIntel');if(ib)ib.onclick=()=>toggleIntel();const tb=$('ctlTransport');if(tb)tb.onclick=()=>openWhip();window.addEventListener('storage',e=>{if(e.key==='mccdb_session')loadAccess()});const cx=$('cctvClose');if(cx)cx.onclick=closeSheet;window.addEventListener('storage',e=>{if(e.key==='mccdb_session')cctvEligibility()});
 if(BARE){const ex=$('bareExit');if(ex)ex.hidden=false;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&($('cctvSheet')||{}).hidden!==false)location.href='action-globe.html?explore=1'})}liftAboveCredit();window.addEventListener('resize',liftAboveCredit);
 /* the full pane: the bar arrives after this script (js/tabbar.js), and the sheet grows when a mission is chosen */
 if(EXPLORE){new MutationObserver(liftAboveCredit).observe(document.body,{childList:true});if(window.ResizeObserver)new ResizeObserver(liftAboveCredit).observe($('deck'));window.addEventListener('load',liftAboveCredit);const hint=document.querySelector('#worldFilters p');if(hint)hint.textContent='Tap a pin to open its mission. Drag to turn the Earth, pinch to zoom.'}}
/* Optional globe data is admin preview. Server policy and existing feature
   permissions must both allow it. Missing/old policy never falls back to sign-in. */
const ACCESS_IDS={flights:'ctlFlights',satellites:'ctlSats',launches:'ctlLaunch',intel:'ctlIntel',music:'ctlMusic',cctv:'ctlCctv',transport:'ctlTransport'};
let access=null;
window.__huAccess=()=>access;
function lockOf(id){
 if(!sessionToken()||!access||access.release?.version!=='globe-admin-preview/v1'||access.release.admin_preview!==true||accessToken!==sessionToken())return{id,reason:'admin_preview'};
 if(!access.unlocked_layers.includes(id))return(access.locked_layers||[]).find(x=>x.id===id)||{id,reason:'feature_withdrawn'};
 return null}
function paintAccess(){Object.keys(ACCESS_IDS).forEach(k=>{const b=$(ACCESS_IDS[k]);if(!b)return;const l=lockOf(k);b.hidden=ANALYTICS||!!l;b.setAttribute('aria-disabled',l?'true':'false')});
 const a=$('ctlAudience');if(a&&lockOf('audience'))a.hidden=true;
 if(!viewer)return;
 Object.keys(DATA_LAYERS).forEach(k=>{if(lockOf(k)&&layerState[k].on){layerState[k].on=false;clearLayer(k);const b=$(DATA_LAYERS[k].id);if(b)b.setAttribute('aria-pressed','false');tell({type:'hu:layer',layer:k,on:false})}});
 if(lockOf('intel')&&intel.on)intelOff();if(lockOf('cctv')&&cctv.on)cctvOff();if(lockOf('audience'))drawAudience([]);
 if(lockOf('ion'))ionOff('release unavailable');paintLayerCredits()}
let accessToken='',accessSeq=0;
async function loadAccess(){const seq=++accessSeq,t=sessionToken(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4000);if(accessToken!==t){access=null;accessToken=t;paintAccess()}
 try{const r=await fetch(API+'/v1/world/access',{headers:t?{authorization:'Bearer '+t,accept:'application/json'}:{accept:'application/json'},cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('access '+r.status);const d=await r.json();if(seq!==accessSeq||t!==sessionToken())return null;access=d&&d.release?.version==='globe-admin-preview/v1'&&Array.isArray(d.locked_layers)&&Array.isArray(d.unlocked_layers)?d:null}catch(e){if(seq!==accessSeq)return null;access=null}finally{clearTimeout(timeout)}paintAccess();return access}
window.addEventListener('storage',e=>{if(!e.key||e.key==='mccdb_session'){access=null;accessSeq++;accessToken='';paintAccess();loadAccess()}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadAccess()});
setInterval(()=>{if(!document.hidden)loadAccess()},60000);
/* a locked layer explains itself: a guest is asked to sign in; a member is told what unlocks it */
function explainLock(id){const l=lockOf(id);if(!l)return false;
 if(l.reason==='admin_preview'||l.reason==='feature_withdrawn'){return true}
 if(l.reason==='sign_in_required'||!sessionToken()){tell({type:'hu:ask-sign-in',reason:'layers'});return true}
 if(id==='cctv'){cctvGate();return true}
 sheet('Locked','<p>This layer opens at a later level.</p>');return true}
/* WHIP EQUIPPED (owner, 2026-10-15: "People should be able to sign up to Whip Equipped real quick. When they try to use it,
   it'll just tell them the service is not done, but if you know a driver, or you are a driver, have them sign up today").
   Any signed-in member opens it; a guest is asked to sign in. Whip Equipped LLC is Matthew McCluster's separate company: its
   own name only, no McCluster branding, and nothing about the member is sent anywhere by opening it. Rides are not live, so
   there is no ride request here at all; the sign-up is Whip's own Driver app, where Whip's own checks decide who drives. */
const WHIP_DRIVER_SIGNUP='https://matthew.mccluster.org/whip/driver/';
window.__huWhip=()=>({open:!($('cctvSheet')||{}).hidden&&!!(($('cctvBody')||{}).querySelector&&$('cctvBody').querySelector('[data-whip-signup]'))});
function openWhip(){if(lockOf('transport')&&explainLock('transport'))return;const t=access&&access.layers&&access.layers.transport||{};const signup=String(t.driver_signup_url||WHIP_DRIVER_SIGNUP);const target=window.top!==window?' target="_top"':'';
 sheet('Transport','<p class="cctv-meta">By Whip Equipped LLC, a separate company.</p><p><b>Whip Equipped rides aren’t live yet.</b> You can’t request a ride today.</p><p>Are you a driver, or know one? Have them sign up today.</p><p><a class="cctv-act" href="'+escHtml(signup)+'"'+target+' data-whip-signup>Driver sign-up →</a></p><p class="cctv-note">Signing up is an application, not approval: Whip Equipped’s own checks (licence, insurance, background check and local rideshare rules) decide who drives.</p>');if(window.HuTransport)HuTransport.mount($('cctvBody'),{region:selectionShown&&!$('mission').hidden&&missions[i]?missions[i].region_label:''})}
/* MUSIC ON THE EARTH: open to members, but nothing musical carries a real place yet (creator profiles hold no location;
   the news ingester has no music topic; listener geography is the owner's private analytics). It says so instead of
   drawing invented points. */
function showMusic(){if(explainLock('music'))return;sheet('Music','<p>Music on the Earth needs a real place for each release or creator, and none is recorded yet. Nothing is drawn until one is.</p>')}
/* INTEL EVENTS (members), by contract: GET /v1/intel/geo (docs/control-plane/INTEL-TO-MISSION-CANON.md §5). The Worker
   derives the audience from the session (members: accepted records, k=5 suppression). Cells are drawn as cells, never as
   points; located, unknown and suppressed counts and the attribution are always said. The endpoint ships switched off
   (503 intel_schema_not_ready): then the line says so and nothing is drawn. */
const intel={on:false,entities:[]};
window.__huIntel=()=>({on:intel.on,cells:intel.entities.length});
/* hooks for the coordinate test: where each drawn thing really is, read back from Cesium in degrees */
function entityDegrees(e){const now=Cesium.JulianDate.now();if(e.rectangle){const r=e.rectangle.coordinates.getValue(now);return{rect:[r.west,r.south,r.east,r.north].map(x=>Math.round(Cesium.Math.toDegrees(x)*1000)/1000)}}const c=e.position&&e.position.getValue(now);if(!c)return null;const g=Cesium.Cartographic.fromCartesian(c);return{lon:Math.round(Cesium.Math.toDegrees(g.longitude)*1000)/1000,lat:Math.round(Cesium.Math.toDegrees(g.latitude)*1000)/1000}}
window.__huPlaced=()=>({intel:intel.entities.map(entityDegrees),analytics:analytics.entities.map(e=>Object.assign({code:e.properties&&e.properties.analyticsCode&&e.properties.analyticsCode.getValue()},entityDegrees(e))),cctv:cctv.points?Array.from({length:cctv.points.length},(_,n)=>{const p=cctv.points.get(n),g=Cesium.Cartographic.fromCartesian(p.position);return{cam:p.id&&p.id.cam,lon:Math.round(Cesium.Math.toDegrees(g.longitude)*1000)/1000,lat:Math.round(Cesium.Math.toDegrees(g.latitude)*1000)/1000}}):[]});
function intelOff(){intel.entities.forEach(e=>viewer.entities.remove(e));intel.entities=[];intel.on=false;const b=$('ctlIntel');if(b)b.setAttribute('aria-pressed','false');tell({type:'hu:layer',layer:'intel',on:false,creditHeight:creditHeight()})}
async function toggleIntel(){const b=$('ctlIntel');if(!viewer||!b)return;if(intel.on){intelOff();return}if(lockOf('intel')&&explainLock('intel'))return;
 b.setAttribute('aria-busy','true');try{const t=sessionToken(),r=await fetch(API+'/v1/intel/geo?cell=10&bucket=day',{headers:t?{authorization:'Bearer '+t,accept:'application/json'}:{accept:'application/json'},cache:'no-store'});const d=await r.json().catch(()=>({}));
  if(!r.ok){tell({type:'hu:layer',layer:'intel',on:false,failed:true});sheet('Intel events','<p>'+(r.status===503?'Intel events are not switched on yet.':'Intel events could not load right now.')+' Nothing is drawn.</p>');return}
  if(lockOf('intel'))return;const cells={};(d.buckets||[]).forEach(x=>{const c=x&&x.cell_center||{},bd=cellBounds(x&&x.cell_bounds),ll=lonLat(c.lon,c.lat);if(!bd||!ll)return;const k=String(x.cell);(cells[k]||(cells[k]={bd,lat:ll[1],lon:ll[0],n:0})).n+=Number(x.count)||0});
  const list=Object.values(cells),max=Math.max(1,...list.map(c=>c.n));list.forEach(c=>{intel.entities.push(viewer.entities.add({rectangle:{coordinates:Cesium.Rectangle.fromDegrees(c.bd[0],c.bd[1],c.bd[2],c.bd[3]),material:Cesium.Color.fromCssColorString('#ffb347').withAlpha(.15+.45*Math.sqrt(c.n/max)),outline:true,outlineColor:Cesium.Color.WHITE.withAlpha(.5),height:0}}))});
  intel.on=true;b.setAttribute('aria-pressed','true');const tt=d.totals||{};
  tell({type:'hu:layer',layer:'intel',on:true,count:Number(tt.located)||0,unknown:Number(tt.unknown_location)||0,suppressed:Number(tt.suppressed_records)||0,attribution:((d.layer&&d.layer.attribution)||[]).join(' · '),creditHeight:creditHeight()})}
 catch(e){tell({type:'hu:layer',layer:'intel',on:false,failed:true})}finally{b.removeAttribute('aria-busy')}}
/* ---------- CCTV, FOR MEMBERS WHO EARNED IT (owner, 2026-10-15: "ONLY after they are logged in, have given location consent, AND have completed a mission") ----------
   The Worker decides (workers/mccluster/src/world-cctv.js): eligibility is three checks, the camera list and every frame come
   through it from Hitman's Halo only for an eligible member. A guest never sees the switch. A member who is not eligible sees it
   locked, and the lock explains the three requirements with a way to meet each. Frames are live snapshots only: the Worker
   refuses Street View and synthetic fallbacks, so a camera without a live frame says so and shows nothing in its place. */
const cctv={state:null,on:false,points:null,sources:[],url:null,seq:0};
window.__huCctv=()=>({state:cctv.state,on:cctv.on,count:cctv.points?cctv.points.length:0});
/* a hook for the browser test, like __huGlobeSettled: open a camera's sheet without aiming at a pixel */
window.__huOpenCamera=id=>openCamera(String(id));
function cctvFetch(path,init){const t=sessionToken();if(!t)return Promise.reject(Error('members'));return fetch(API+path,Object.assign({cache:'no-store'},init||{},{headers:Object.assign({authorization:'Bearer '+t,accept:'application/json'},(init&&init.headers)||{})}))}
async function cctvEligibility(){const b=$('ctlCctv');if(!b)return null;if(!sessionToken()||ANALYTICS||lockOf('cctv')){cctv.state=null;if(cctv.on)cctvOff();paintAccess();return null}
 try{const r=await cctvFetch('/v1/world/cctv/eligibility');if(!r.ok)throw Error('eligibility '+r.status);const d=await r.json();cctv.state=d;paintAccess();if(!d.eligible&&cctv.on)cctvOff();return d}
 catch(e){cctv.state=null;paintAccess();return null}}
function sheet(title,html){clearSpaceFocus();const s=$('cctvSheet');if(!s)return;$('cctvTitle').textContent=title;$('cctvBody').innerHTML=html;s.hidden=false}
function closeSheet(){clearSpaceFocus();const s=$('cctvSheet');if(s)s.hidden=true;if(cctv.url){URL.revokeObjectURL(cctv.url);cctv.url=null}cctv.seq++}
function cctvGate(d){d=d||cctv.state||{checks:{}};const c=d.checks||{},row=(ok,title,detail,action)=>'<li class="cctv-check'+(ok?' is-ok':'')+'"><span class="cctv-check__mark" aria-hidden="true">'+(ok?'✓':'✕')+'</span><span><b>'+title+'</b><small>'+(ok?'Done.':detail)+'</small>'+(ok?'':action||'')+'</span></li>';
 const target=window.top!==window?' target="_top"':'';
 /* LOCATION CONSENT IS THE PRIVACY ACKNOWLEDGEMENT (owner, 2026-10-15). The site-entry notice (js/live-content.js) is kept
    in this browser; the Worker reads the member's own record of it (auth user_metadata, workers/mccluster/src/world-cctv.js).
    A member who signed up another way records it here with one tap, the same two fields the join flow writes. */
 sheet('CCTV is for members who earned it','<p>Live public cameras open when all three are true:</p><ol class="cctv-checks">'+
  row(c.signed_in,'Signed in','Sign in with your M Account.','<a class="cctv-act" href="account.html?stay=1"'+target+'>Sign in →</a>')+
  row(c.privacy_acknowledged,'Privacy Policy agreed','Agreeing to the <a href="privacy.html"'+target+'>Privacy Policy</a> is your location consent: we use your approximate location from your connection, and your precise location only if your browser asks you and you allow it.','<button class="cctv-act" type="button" data-cctv-privacy>I agree to the Privacy Policy</button>')+
  row(c.mission_completed,'A mission completed','You have no verified mission yet. Join one, send its proof, and it counts once a reviewer verifies it.','<a class="cctv-act" href="mnet.html?view=missions"'+target+'>Find a mission →</a>')+
  '</ol><p class="cctv-msg" role="status" aria-live="polite"></p>');
 const msg=document.querySelector('#cctvBody .cctv-msg');
 const agree=document.querySelector('[data-cctv-privacy]');if(agree)agree.onclick=()=>{agree.disabled=true;msg.textContent='Saving…';recordPrivacyAck(d.privacy_version).then(()=>cctvEligibility()).then(n=>cctvGate(n||cctv.state)).catch(e=>{agree.disabled=false;msg.textContent=String(e&&e.message||'Could not save that right now; try again.')})}}
/* the member's own auth record, with their own session: the fields js/action.js writes at sign-up */
async function recordPrivacyAck(version){const t=sessionToken();if(!t)throw Error('Sign in first.');if(!version)throw Error('The current Privacy Policy version is unknown; try again.');
 try{const v={version,accepted_at:new Date().toISOString()};localStorage.setItem('mcc_privacy_ack',JSON.stringify(v))}catch(e){}
 const r=await fetch(SB+'/auth/v1/user',{method:'PUT',headers:{apikey:KEY,authorization:'Bearer '+t,'content-type':'application/json'},body:JSON.stringify({data:{privacy_policy_version:version,privacy_acknowledged_at:new Date().toISOString()}})});
 if(!r.ok)throw Error('Could not save that right now; try again.');return true}
function cctvOff(){cctv.on=false;if(cctv.points&&viewer){viewer.scene.primitives.remove(cctv.points)}cctv.points=null;cctv.sources=[];const b=$('ctlCctv');if(b)b.setAttribute('aria-pressed','false');closeSheet();tell({type:'hu:layer',layer:'cctv',on:false,creditHeight:creditHeight()})}
async function toggleCctv(){const b=$('ctlCctv');if(!viewer||!b)return;if(cctv.on){cctvOff();return}if(lockOf('cctv'))return;if(!sessionToken()){tell({type:'hu:ask-sign-in',reason:'layers'});return}
 const d=await cctvEligibility();if(!d||!d.eligible){cctvGate(d);return}
 b.setAttribute('aria-busy','true');try{const r=await cctvFetch('/v1/world/cctv/sources');if(r.status===401||r.status===403){await cctvEligibility();cctvGate();return}const data=await r.json();if(!r.ok)throw Error(data&&data.error||'cctv '+r.status);if(lockOf('cctv'))return;
  const col=new Cesium.PointPrimitiveCollection(),c=Cesium.Color.fromCssColorString('#7cfc9a');cctv.sources=(data.sources||[]).filter(s=>lonLat(s.lon,s.lat)).map(s=>Object.assign({},s,{lon:deg(s.lon),lat:deg(s.lat)}));cctv.sources.forEach(s=>col.add({position:Cesium.Cartesian3.fromDegrees(s.lon,s.lat,30),pixelSize:7,color:c,outlineColor:Cesium.Color.BLACK.withAlpha(.8),outlineWidth:1.5,id:{layer:'cctv',cam:String(s.id)}}));
  viewer.scene.primitives.add(col);cctv.points=col;cctv.on=true;b.setAttribute('aria-pressed','true');tell({type:'hu:layer',layer:'cctv',on:true,count:cctv.sources.length,creditHeight:creditHeight()})}
 catch(e){tell({type:'hu:layer',layer:'cctv',on:false,failed:true});sheet('CCTV','<p>'+escHtml(String(e&&e.message||'CCTV could not load right now.'))+'</p>')}finally{b.removeAttribute('aria-busy')}}
function fmtTime(v){const d=v?new Date(v):null;return d&&!isNaN(d)?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}):null}
async function openCamera(id){if(lockOf('cctv'))return;const cam=cctv.sources.find(s=>String(s.id)===id);if(!cam)return;const seq=++cctv.seq;if(cctv.url){URL.revokeObjectURL(cctv.url);cctv.url=null}
 const where=[cam.city,cam.provider].filter(Boolean).map(escHtml).join(' · ');sheet(String(cam.name||'Camera'),'<p class="cctv-meta">'+where+'</p><p class="cctv-msg" role="status" aria-live="polite">Loading the live frame…</p>');
 try{const r=await cctvFetch('/v1/world/cctv/frame/'+encodeURIComponent(id),{headers:{accept:'image/*'}});if(seq!==cctv.seq)return;
  if(r.status===401||r.status===403){await cctvEligibility();cctvGate();return}
  if(!r.ok){const j=await r.json().catch(()=>({}));$('cctvBody').querySelector('.cctv-msg').textContent=j&&j.detail&&j.detail.reason==='no_live_frame'?'No live frame from this camera right now. Nothing is shown in its place.':(j&&j.error)||'This camera could not load right now.';return}
  const blob=await r.blob();if(seq!==cctv.seq||lockOf('cctv'))return;cctv.url=URL.createObjectURL(blob);const h=k=>r.headers.get(k);
  const facts=[['Provider',h('x-cctv-provider')||cam.provider],['Captured',fmtTime(h('x-cctv-captured-at')||h('last-modified'))],['Retrieved',fmtTime(h('x-cctv-retrieved-at'))],['Media',h('content-type')],['Licence',h('x-cctv-license')||cam.license]].filter(x=>x[1]);
  $('cctvBody').innerHTML='<p class="cctv-meta">'+where+'</p><figure class="cctv-frame"><img alt="'+escHtml('Live snapshot from '+(cam.name||'this camera'))+'" src="'+cctv.url+'"><figcaption>Live snapshot</figcaption></figure><dl class="cctv-facts">'+facts.map(x=>'<div><dt>'+x[0]+'</dt><dd>'+escHtml(String(x[1]).slice(0,120))+'</dd></div>').join('')+'</dl>'}
 catch(e){if(seq===cctv.seq){const m=$('cctvBody').querySelector('.cctv-msg');if(m)m.textContent='This camera could not load right now.'}}}
/* ---------- THE ANALYTICS SURFACE (Control Room → Analytics, the 60/40 globe) ----------
   The owner's dashboard sends country aggregates it already read with the owner's own session (js/control-room/analytics.js);
   this frame only draws them, highlights the selected one, and says which country was tapped. Nothing is fetched here. */
const analytics={points:[],selected:null,entities:[]};
window.__huAnalyticsCount=()=>analytics.entities.length;
function drawAnalytics(){if(!viewer)return;analytics.entities.forEach(e=>viewer.entities.remove(e));analytics.entities=[];
 const max=Math.max(1,...analytics.points.map(p=>Number(p.value)||0));
 analytics.points.forEach(p=>{const ll=lonLat(p.lon,p.lat),v=Math.max(0,Number(p.value)||0),on=p.code===analytics.selected;if(!ll||!v)return;const[lon,lat]=ll;
  /* a grid cell (intel events) is drawn as its cell, never as a point */
  const bd=cellBounds(p.bounds);
  if(bd){analytics.entities.push(viewer.entities.add({rectangle:{coordinates:Cesium.Rectangle.fromDegrees(bd[0],bd[1],bd[2],bd[3]),material:Cesium.Color.fromCssColorString(on?'#ff3d5e':'#ffb347').withAlpha(.2+.45*Math.sqrt(v/max)),outline:true,outlineColor:Cesium.Color.WHITE.withAlpha(.6),height:0},properties:{analyticsCode:p.code}}));
   analytics.entities.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lon,lat,2000),label:{text:v.toLocaleString(),font:'600 12px Inter, system-ui, sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE},properties:{analyticsCode:p.code}}));return}
  analytics.entities.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lon,lat,2000),point:{pixelSize:Math.round(8+22*Math.sqrt(v/max))*(on?1.25:1),color:Cesium.Color.fromCssColorString(on?'#ff3d5e':'#4fd1ff').withAlpha(on?.95:.75),outlineColor:Cesium.Color.WHITE.withAlpha(.9),outlineWidth:on?2.5:1.2},
   label:{text:String(p.name||p.code).slice(0,40)+' · '+v.toLocaleString(),font:'600 12px Inter, system-ui, sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-20),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,on?3e7:9e6)},properties:{analyticsCode:p.code}}))})}
function selectAnalytics(code,fly){analytics.selected=code||null;drawAnalytics();if(!fly||!viewer)return;const p=analytics.points.find(x=>x.code===code);if(p)viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(Number(p.lon),Number(p.lat),7000000),duration:1.2});else viewer.camera.flyTo({destination:homePosition(),duration:1.2})}
function wireEditorialTools(){
 if(!EDITORIAL)return;
 const credit=document.querySelector('.osm-credit'),ionCredit=$('ionCredits');
 if(credit){credit.innerHTML='<a href="https://earthdata.nasa.gov/">NASA imagery</a> · <a href="https://www.naturalearthdata.com/">Natural Earth</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ';if(ionCredit)credit.appendChild(ionCredit);credit.classList.add('is-editorial')}
 const row=document.querySelector('.globe-data'),nav=document.querySelector('.globe-controls');
 const tools=document.createElement('details');tools.className='globe-editorial-tools';
 tools.innerHTML='<summary aria-label="Globe controls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M9 3v6M15 9v6M9 15v6"/></svg></summary>';
 const panel=document.createElement('div');panel.className='globe-editorial-tools__panel';
 if(nav)panel.appendChild(nav);if(row)panel.appendChild(row);tools.appendChild(panel);document.body.appendChild(tools);
 const rail=document.createElement('nav');rail.className='globe-travel-controls';rail.setAttribute('aria-label','Travel globe controls');document.body.appendChild(rail);setTravelMode(travelMode);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&tools.open){tools.open=false;tools.querySelector('summary').focus()}});
 document.addEventListener('click',e=>{if(!tools.contains(e.target))tools.open=false});
}
function wireControls(){const on=(id,f)=>{const b=$(id);if(b){if(id==='ctlZoomIn'||id==='ctlZoomOut')b.disabled=false;b.onclick=f}};
 on('ctlAudience',()=>{if(lockOf('audience'))return;const b=$('ctlAudience'),next=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',next?'true':'false');if(!next)drawAudience([]);tell({type:'hu:audience',on:next})});
 on('ctlWorld',()=>{selectionShown=false;missionPins.forEach(p=>{if(p.billboard)p.billboard.scale=1});setLayer(layerMode==='map'?'auto':layerMode);viewer.camera.flyTo({destination:homePosition(),duration:1.4});tell({type:'hu:selection-cleared'})});
 /* Near me answers in #status; inside the network that line is hidden, so hand the page that one answer */
 on('ctlLocate',()=>{if(travelMode&&parentFrame){tell({type:'hu:request-location'});return}const st=$('status'),mo=new MutationObserver(()=>{tell({type:'hu:status',text:String(st.textContent||'').slice(0,200)});mo.disconnect()});mo.observe(st,{childList:true,characterData:true,subtree:true});$('nearMe').click();setTimeout(()=>mo.disconnect(),15000)});
 const zoom=f=>{const h=viewer.camera.positionCartographic.height;f?viewer.camera.zoomIn(h*.45):viewer.camera.zoomOut(h*.8)};on('ctlZoomIn',()=>zoom(true));on('ctlZoomOut',()=>zoom(false));
 on('ctlLayers',()=>setLayer(EDITORIAL?(layerMode==='map'?'auto':'map'):({auto:'night',night:'map',map:'auto'}[layerMode]||'auto')));}
/* ---------- THE EARTH UP CLOSE: Cesium ion, for signed-in members (owner, 2026-10-15: "I added an ion, cesium ion key to the McCluster worker";
   the public gets the globe and its free layers, the paid map data is for members) ----------
   From far out the Earth stays NASA's, exactly as above. Coming down, Cesium ion takes over: Cesium World Terrain under everything,
   aerial imagery (Bing Aerial with Labels, else Bing Aerial, else Sentinel-2) easing in from 3,000 km and whole by 1,200 km while
   the cloud still eases out, and Cesium OSM Buildings below 50 km. The street map stays one tap away on the Layers button.
   The account's token never comes to the page: Ion.defaultServer is the Worker (workers/mccluster/src/world-ion.js), which asks ion
   for each asset and hands back a token for that one asset that lives about an hour. GET /v1/world/ion says first whether there
   is ion at all; with none, or when any part of it fails, the Earth is what it was. Terrain is built before it is used, so the
   ground never blanks while it loads; vertex normals stay off, because with them the night lights would cover the day side.
   MEMBERS ONLY. A logged-out page never asks the Worker's ion route (not even its status) and never reaches Cesium ion: its Earth
   is NASA's, with the street map below 900 km. A member's page sends its Supabase session to the Worker's ion route in an
   Authorization header, never in a URL: Ion.defaultServer is a Cesium.Resource carrying it, and CesiumJS 1.131 derives every
   asset-endpoint request from Ion.defaultServer (CesiumTerrainProvider and Cesium3DTileset.fromIonAssetId take no server option),
   copying its headers and its retryCallback. The session rotates: when the Worker refuses a stale one (401) the request is retried
   with the newest session in this browser, once per change; with none, or on a 403, 429 or 503, ion steps aside for the page
   (ionOff) and the Earth is NASA's again, quietly. Signing out in another tab does the same; signing in brings ion on the next load. */
const ION_HI=3000000,ION_FULL=1200000,ION_OFF=3400000,BUILD_ON=50000,BUILD_OFF=60000,ION_WAIT=1500,TERRAIN_WAIT=2500;
let ion=null,ionGround=false,ionImagery=null,ionImageryTried=false,ionBuildings=null,ionBuildingsTried=false,ionServer=null;
/* hooks for the browser test, like __huGlobeSettled */
window.__huIon=()=>({on:!!ion,ground:!!(viewer&&viewer.scene.globe.terrainProvider),terrain:!!(viewer&&viewer.scene.globe.terrainProvider&&!(viewer.scene.globe.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)),imagery:!!(ionImagery&&ionImagery.ready),imageryShown:!!(ionImagery&&ionImagery.show),buildings:!!ionBuildings,buildingsShown:!!(ionBuildings&&ionBuildings.show),street:!!(mapLayer&&mapLayer.show),clouds:cloudLayer?Math.round(cloudLayer.alpha*100)/100:null,nightLights:nightLayer?Math.round(nightLayer.nightAlpha*100)/100:null,groundIsIon:ionGround,height:viewer?Math.round(viewer.camera.positionCartographic.height):null});
function ionWarn(what,e){if(!ion)return;try{console.warn('[world ion] '+what+': '+(e&&e.message||e))}catch(_){}}
/* At navigation height, roads stay legible even when the member has aerial imagery.
   Outside travel, the existing ion / NASA / street transition is unchanged. */
function streetAuto(h){return h<900000&&((travelMode&&!!(roadRoute||currentLocation))||!(ionImagery&&ionImagery.ready))}
function ionBearer(){const t=sessionToken();return t?'Bearer '+t:''}
function ionStatus(){if(!ionBearer())return Promise.resolve(null);const late=new Promise(r=>setTimeout(()=>r(null),ION_WAIT));
 const ask=fetch(API+'/v1/world/ion',{headers:{accept:'application/json',authorization:ionBearer()}}).then(r=>r.ok?r.json():null).then(s=>s&&s.available===true&&s.assets&&Number.isInteger(s.assets.terrain)?s.assets:null).catch(()=>null);
 return Promise.race([ask,late])}
/* the Worker refused an asset endpoint: a rotated session is tried again; otherwise ion steps aside. Retries happen only when the
   session actually changed, so the high retryAttempts (Cesium counts them for the life of the resource) is never a loop. */
function ionRetry(resource,error){const code=error&&error.statusCode;
 if(code===401){const b=ionBearer();if(b&&resource.headers.Authorization!==b){resource.headers.Authorization=b;if(ionServer)ionServer.headers.Authorization=b;return true}}
 if(code===401||code===403||code===429||code===503)ionOff('the map data answered '+code);
 return false}
/* back to NASA's Earth and the street map, with nothing more asked of ion on this page */
function ionOff(why){if(!ion)return;ionWarn('off',why);ion=null;document.documentElement.classList.remove('globe-ion');if(!viewer)return;
 if(ionImagery){if(viewer.imageryLayers.contains(ionImagery))viewer.imageryLayers.remove(ionImagery,true);ionImagery=null}
 if(cloudLayer)cloudLayer.alpha=EDITORIAL?EDITORIAL_CLOUD_ALPHA:1;if(nightLayer)nightLayer.nightAlpha=1;
 if(ionBuildings){viewer.scene.primitives.remove(ionBuildings);ionBuildings=null}
 if(ionGround){ionGround=false;viewer.scene.globe.terrainProvider=new Cesium.EllipsoidTerrainProvider()}
 if(layerMode==='auto'&&mapLayer)mapLayer.show=streetAuto(viewer.camera.positionCartographic.height)}
function startIon(){if(!ion||!viewer)return;const bearer=ionBearer();if(!bearer){ion=null;return}
 Cesium.Ion.defaultAccessToken=undefined;ionServer=new Cesium.Resource({url:API+'/v1/world/ion/',headers:{Authorization:bearer},retryAttempts:1e9,retryCallback:ionRetry});Cesium.Ion.defaultServer=ionServer;
 window.addEventListener('storage',e=>{if(e&&e.key&&e.key!=='mccdb_session')return;if(!ion)return;const b=ionBearer();if(!b)ionOff('signed out');else ionServer.headers.Authorization=b});
 document.documentElement.classList.add('globe-ion');const line=document.querySelector('.osm-credit');if(line&&window.ResizeObserver)new ResizeObserver(liftAboveCredit).observe(line);liftAboveCredit();
 /* nothing is drawn until the terrain is in hand (or TERRAIN_WAIT passes), so the Earth appears once, with its ground */
 const g=viewer.scene.globe,flat=g.terrainProvider;let landed=false;const land=p=>{if(landed)return;landed=true;ionGround=!!(p&&ion);g.terrainProvider=ionGround?p:flat};
 g.terrainProvider=undefined;Cesium.CesiumTerrainProvider.fromIonAssetId(ion.terrain).then(p=>land(p),e=>{land(null);ionWarn('terrain',e)});setTimeout(()=>land(null),TERRAIN_WAIT);
 viewer.scene.preRender.addEventListener(ionFrame)}
function addIonImagery(k){const id=ion&&Array.isArray(ion.imagery)?ion.imagery[k]:undefined;if(!Number.isInteger(id)||!viewer)return;
 const layer=Cesium.ImageryLayer.fromProviderAsync(Cesium.IonImageryProvider.fromAssetId(id),{alpha:0});ionImagery=layer;
 layer.readyEvent.addEventListener(()=>{if(ionImagery===layer&&layerMode==='auto'&&mapLayer)mapLayer.show=streetAuto(viewer.camera.positionCartographic.height)});
 layer.errorEvent.addEventListener(e=>{ionWarn('imagery '+id,e);if(viewer.imageryLayers.contains(layer))viewer.imageryLayers.remove(layer,true);
  if(ionImagery===layer){ionImagery=null;if(cloudLayer)cloudLayer.alpha=EDITORIAL?EDITORIAL_CLOUD_ALPHA:1;if(nightLayer)nightLayer.nightAlpha=1;if(layerMode==='auto'&&mapLayer)mapLayer.show=streetAuto(viewer.camera.positionCartographic.height)}addIonImagery(k+1)});
 viewer.imageryLayers.add(layer,viewer.imageryLayers.indexOf(dayLayer)+1)}
function addIonBuildings(){if(!ion||!Number.isInteger(ion.buildings)||!viewer)return;
 const coarse=window.matchMedia&&matchMedia('(pointer:coarse)').matches;
 Cesium.Cesium3DTileset.fromIonAssetId(ion.buildings,{maximumScreenSpaceError:coarse?24:16}).then(ts=>{if(!ion){ts.destroy();return}ts.show=false;ts.style=new Cesium.Cesium3DTileStyle({color:"color('#e4e8ee')"});ionBuildings=viewer.scene.primitives.add(ts)},e=>ionWarn('buildings',e))}
/* every frame: what ion shows at this height, with a little hysteresis so nothing flickers on the line */
function ionFrame(){if(!ion||!viewer)return;const h=viewer.camera.positionCartographic.height,auto=layerMode==='auto'&&!(travelMode&&(roadRoute||currentLocation)&&h<900000);
 if(!ionImageryTried&&auto&&h<ION_HI){ionImageryTried=true;addIonImagery(0)}
 if(ionImagery){const on=auto&&h<(ionImagery.show?ION_OFF:ION_HI);if(ionImagery.show!==on)ionImagery.show=on;const a=Math.min(1,Math.max(0,(ION_HI-h)/(ION_HI-ION_FULL)));if(ionImagery.alpha!==a)ionImagery.alpha=a;
  if(cloudLayer){const c=(ionImagery.ready&&on?1-a:1)*(EDITORIAL?EDITORIAL_CLOUD_ALPHA:1);if(cloudLayer.alpha!==c)cloudLayer.alpha=c}
  /* the city lights are opaque and sits over the aerial imagery; on the night side it would cover the ground at every height */
  if(nightLayer){const n=ionImagery.ready&&on?1-a:1;if(nightLayer.nightAlpha!==n)nightLayer.nightAlpha=n}}
 /* OSM Buildings sit on Cesium World Terrain's heights; on the flat fallback they would float or sink, so they wait for the real ground */
 if(!ionBuildingsTried&&ionGround&&auto&&h<BUILD_OFF*2){ionBuildingsTried=true;addIonBuildings()}
 if(ionBuildings){const on=auto&&h<(ionBuildings.show?BUILD_OFF:BUILD_ON);if(ionBuildings.show!==on)ionBuildings.show=on}}
async function boot(){paintMembersDoor();
 /* the layout, the data toggles and the mission data do not wait on the ion status; only the Earth itself does */
 wireDataLayers();const ionP=Promise.race([loadAccess().then(()=>lockOf('ion')?null:ionStatus()),new Promise(r=>setTimeout(()=>r(null),ION_WAIT))]),dataP=Promise.all([NO_MISSIONS?Promise.resolve([]):rpc('action_globe_public_region_missions').then(groupPins),rpc('action_globe_public_regions')]);dataP.catch(()=>{});
 ion=await ionP;viewer=new Cesium.Viewer('globe',{creditContainer:ion?$('ionCredits'):undefined,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,animation:false,timeline:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,baseLayer:(dayLayer=new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({url:DAY_TILES,maximumLevel:8,credit:'NASA Blue Marble (GIBS)'}),{saturation:1.15,contrast:1.05}))});/* the night side is lit at Cesium's 30% floor, so the lights are lifted six-fold to read as navy sea and gold cities */nightLayer=new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({url:NIGHT_TILES,maximumLevel:8,credit:'NASA Black Marble (GIBS)'}),{dayAlpha:0,nightAlpha:1,brightness:6,contrast:1.1,saturation:1.15,gamma:0.85,hue:0.2});viewer.imageryLayers.add(nightLayer);cloudLayer=Cesium.ImageryLayer.fromProviderAsync(Cesium.SingleTileImageryProvider.fromUrl(CLOUDS,{rectangle:Cesium.Rectangle.fromDegrees(-180,-90,180,90),credit:'NASA Visible Earth'}),{dayAlpha:0.92,nightAlpha:0.1});viewer.imageryLayers.add(cloudLayer);mapLayer=new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({url:'https://tile.openstreetmap.org/'}));viewer.imageryLayers.add(mapLayer);mapLayer.show=false;styleScene();wireControls();startIon();mountCountries();loadAccess().then(()=>cctvEligibility());if(ANALYTICS)drawAnalytics();
 if(ion){const box=viewer.container.querySelector('.cesium-credit-lightbox');if(box)box.addEventListener('click',e=>{if(!(e.target.closest&&e.target.closest('a[href]')))viewer.creditDisplay.hideLightbox()})}
 viewer.camera.setView({destination:homePosition()});travelSceneReady=true;wireTravelGestures();restoreTravelScene();
 if(EDITORIAL&&window.ResizeObserver){let sizeTimer;new ResizeObserver(()=>{clearTimeout(sizeTimer);sizeTimer=setTimeout(()=>{sizeEditorialResolution();if(!selectionShown&&viewer.camera.positionCartographic.height>7e6){const p=viewer.camera.positionCartographic;viewer.camera.setView({destination:Cesium.Cartesian3.fromRadians(p.longitude,p.latitude,homeAltitude())})}},100)}).observe(viewer.scene.canvas)}
viewer.screenSpaceEventHandler.setInputAction(p=>{
 if(travelMode&&mapPickKind&&parentFrame&&!ANALYTICS){
  const coordinates=travelMapPoint(p.position);
  if(coordinates){const kind=mapPickKind;travelPickKind(null);tell({type:'hu:travel-location-selected',kind,coordinates})}
  return;
 }
 const e=pickSolid(p.position);if(e&&e.id&&e.id.layer==='satellites'){openSatellite(e.id.sat);return}const selectedSat=e?.id?.properties?.satellite?.getValue?.();if(selectedSat){openSatellite(selectedSat);return}const launch=e?.id?.properties?.launch?.getValue?.();if(launch){openLaunch(launch);return}if(e&&e.id&&e.id.layer==='flights'){openAircraft(e.id);return}if(e&&e.id&&e.id.layer==='cctv'){openCamera(String(e.id.cam));return}const ac=e?.id?.properties?.analyticsCode?.getValue?.();if(ac){selectAnalytics(ac,false);tell({type:'hu:analytics-region',code:ac});return}const newsId=e?.id?.properties?.worldNewsId?.getValue?.();if(newsId&&publicNewsOn){tell({type:'hu:world-news-selected',id:newsId});return}const completedId=e?.id?.properties?.completedEventId?.getValue?.();if(completedId&&selectCompletedEvent(completedId))return;const liveCode=e?.id?.properties?.liveCountry?.getValue?.();if(liveCode&&countries){countries.select(liveCode);return}const n=e?.id?.properties?.missionIndex?.getValue();if(Number.isInteger(n)){show(n);announce();return;}if(travelMode&&(roadRoute||currentLocation))return;if(countries&&!(e&&e.id&&e.id.properties&&e.id.properties.region_key)&&countries.click(p.position))return;const regionKey=e?.id?.properties?.region_key?.getValue?.();if(regionKey){const match=regions.find(r=>r.region_key===regionKey);if(match)setRegion(match);}},Cesium.ScreenSpaceEventType.LEFT_CLICK);
/* NEAR ME: the approximate place from this connection first (the Worker's request.cf, in the access map; never stored), then
   the precise one only if the browser asks the person and they allow it. Browsers enforce that prompt; nothing here gets around it. */
$('nearMe').onclick=()=>{const ap=access&&access.approximate_location,apl=ap&&lonLat(ap.lon,ap.lat);if(apl&&viewer){viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(apl[0],apl[1],1500000),duration:1.2});$('status').hidden=false;$('status').textContent='Near '+[ap.city,ap.region,ap.country].filter(Boolean).join(', ')+' (approximate, from your connection).'}
 if(!navigator.geolocation){$('status').hidden=false;$('status').textContent='Location is unavailable on this device.';return;}navigator.geolocation.getCurrentPosition(position=>{const {latitude,longitude}=position.coords;viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(longitude,latitude,homeAltitude()),duration:1.5});$('nearMe').textContent='Nearby ✓';$('status').hidden=false;$('status').textContent='Nearby view enabled for this session. Precise location is not uploaded. Regional locking awaits verified state/province boundary data.';},()=>{$('status').hidden=false;$('status').textContent='Location denied. Worldwide missions remain available.';},{enableHighAccuracy:false,timeout:12000,maximumAge:300000});};
$('globeMode').onclick=()=>setMode('globe');$('feedMode').onclick=()=>setMode('feed');$('openFeed').onclick=()=>openDetail(i);$('feedBack').onclick=closeDetail;$('detailLocate').onclick=()=>{closeDetail();show(i)};$('clearSelection').onclick=()=>{setSelection(false);closeDetail()};$('filterBack').onclick=()=>setSelection(false);$('worldSearch').addEventListener('input',filterMissions);
$('previous').onclick=()=>show(i-1);$('next').onclick=()=>show(i+1);
$('missionsLayer').onclick=()=>{showMissions=!showMissions;draw()};$('citiesLayer').onclick=()=>{showCities=!showCities;draw()};
let touchY;const deck=$('deck');deck.addEventListener('touchstart',e=>{touchY=e.touches[0].clientY},{passive:true});deck.addEventListener('touchend',e=>{if(touchY===undefined)return;const d=e.changedTouches[0].clientY-touchY;if(Math.abs(d)>45)show(i+(d<0?1:-1));touchY=undefined},{passive:true});
// Navigation can start as soon as the renderer is ready. Public mission RPCs
// enrich this message later; they cannot hold a visitor's street map hostage.
if(!ANALYTICS){readyMessage={type:'hu:globe-ready',missionIds:[],dataPending:true};tell(readyMessage)}
try{[missions,cities]=await dataP;regions=cities.slice();const requestedSong=new URLSearchParams(location.search).get('song');if(requestedSong){missions=missions.filter(m=>String(m.song_title||'').toLocaleLowerCase()===requestedSong.toLocaleLowerCase());}allMissions=missions.slice();if(ANALYTICS||NO_MISSIONS){showMissions=false;showCities=false}draw();if(!ANALYTICS&&!NO_MISSIONS)drawBoundaries();$('status').textContent=missions.length||NO_MISSIONS?'':(requestedSong?'No approved regional missions are linked to this song yet.':'No approved globe missions published yet.');if(NO_MISSIONS)$('status').hidden=true;if(missions.length){$('status').hidden=true;setSelection(false)}renderFeed();if(countries&&countries.refresh)countries.refresh();readyMessage={type:'hu:globe-ready',missionIds:allMissions.map(m=>m.mission_id),missions:allMissions.slice(0,200).map(publicMission)};tell(readyMessage)}catch(e){$('status').textContent='Globe data is not available yet.';readyMessage={type:'hu:globe-ready',missionIds:[],dataUnavailable:true};tell(readyMessage);console.warn(e)}}
// Layout and the parent-owned location request work even if WebGL cannot load.
wireEditorialTools();wireTravelControlLayout();
if(EDITORIAL&&parentFrame){$('ctlLocate').onclick=()=>{if(travelMode)tell({type:'hu:request-location'})};for(const id of ['ctlZoomIn','ctlZoomOut'])$(id).disabled=true;}
if(window.Cesium)boot().catch(e=>{$('status').hidden=false;$('status').textContent='Interactive globe unavailable on this device. Mission browsing will be available when the map can load.';readyMessage={type:'hu:globe-unavailable'};tell(readyMessage);console.warn(e)});else{$('status').textContent='Unable to load globe.';readyMessage={type:'hu:globe-unavailable'};tell(readyMessage)}})();
