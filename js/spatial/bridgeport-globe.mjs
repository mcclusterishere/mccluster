import {metricFrame,polygon,localCell,cellId} from './metric-frame.mjs';
import {route,routeToEntrance,clearEdge,restorePosition,importCompatiblePose} from './region-graph.mjs';
import {regionGate} from './region-gate.mjs';

// Configuration alone does not prove that a terrain provider loaded successfully.
export function terrainDescription(state){
 if(!state?.configured)return 'Ion unavailable here; ellipsoid/fallback imagery only.';
 return state.terrain?'Ion terrain provider active. Street navigation remains a flat simulation.':'Ion configured; terrain is loading or unavailable. Ellipsoid fallback may be in use.';
}

// Draws the bounded region inside the existing Cesium viewer/ion pipeline. Never creates a second globe.
export function mountBridgeport({globe,C=window.Cesium}){
 const viewer=globe.viewer();let entered=false,region=null,frame=null,source=null,position=null,topology='hex',preview=null,walking=null,last=0,original=null,actor=null,routeEntity=null,raf=0,entranceId=null,requestedRegion='bridgeport-golden-hill.v1',closedRoadIds=[],navigationRevision=0,cellOrigin=null,importController=null,arrivalRequest=null;
 const panel=document.createElement('section');panel.id='bridgeportWalk';panel.setAttribute('aria-label','Bridgeport walking review');panel.hidden=true;
 panel.innerHTML='<strong>Golden Hill Street · Bridgeport</strong><p data-status role="status">Fly to the walking region to load it.</p><label>Navigation <select aria-label="Navigation topology"><option value="hex">Hex</option><option value="square">Square</option></select></label><label data-destination>Destination <select aria-label="Street destination"><option value="court-exterior-approach">Court exterior approach</option></select></label><button data-preview>Preview route</button><button data-confirm disabled>Confirm walk</button><button data-stop>Stop</button><button data-locate>Find me</button><button data-return>Return to globe</button><label data-closures hidden>Simulation closure <select aria-label="Simulation road closure"><option value="">All roads open</option></select></label><button data-import hidden>Import previous slice position</button><small data-ion></small><small>Exterior simulation · estimated road width and heights. Not pedestrian directions. © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · CT GIS footprints.</small>';
 const style=document.createElement('style');style.textContent='#bridgeportWalk{position:fixed;z-index:300;left:12px;right:12px;bottom:100px;max-height:42vh;overflow:auto;padding:12px;background:#101a29f5;color:white;border:1px solid #81b9da;border-radius:12px;font:16px/1.35 system-ui}#bridgeportWalk[hidden]{display:none}#bridgeportWalk button,#bridgeportWalk select{font:inherit;min-height:44px;margin:3px;padding:5px 9px}#bridgeportWalk small{display:block;margin-top:6px;font-size:12px}#bridgeportWalk p{margin:5px 0}#bridgeportWalk a{color:#a7ddff}@media(min-width:768px){#bridgeportWalk{right:auto;width:390px;bottom:30px}}';document.head.append(style);document.body.append(panel);
 const status=s=>panel.querySelector('[data-status]').textContent=s;
 const notify=(event,detail={})=>globe.tell?.({...detail,type:'bridgeport:state',schema:'mccluster.spatial-lifecycle/v1',event,regionId:requestedRegion,revision:requestedRegion.endsWith('.v2')?2:1,frameId:'bridgeport-golden-hill.enu.v1',floorId:'street',entered,loaded:!!region,position:position?{...position}:null,topology,entranceId,closedRoadIds:[...closedRoadIds],navigationRevision,capabilities:['exterior-navigation','square','hex','preview-confirm','local-resume','correlated-arrival',...(requestedRegion.endsWith('.v2')?['road-closures','explicit-v1-pose-import']:[])]});
 const save=()=>{if(!region||!position)return;try{localStorage.setItem(region.contract.state.key,JSON.stringify({schema:region.contract.state.schema,regionId:region.contract.id,revision:region.contract.revision,frameId:region.contract.frame.id,floorId:'street',position,topology,closedRoadIds}));notify('saved');}catch{status('Position cannot be saved on this device.');}};
 const cart=p=>{const g=frame.toGeo(p);return C.Cartesian3.fromDegrees(g.lon,g.lat,0);};
 const line=points=>points.map(cart);
 function clearRoute(){preview=null;walking=null;arrivalRequest=null;panel.querySelector('[data-confirm]').disabled=true;if(routeEntity&&source)source.entities.remove(routeEntity);routeEntity=null;}
 function drawCells(){
  if(!source)return;for(const e of [...source.entities.values])if(e.properties?.spatialCell)source.entities.remove(e);
  cellOrigin={...position};for(const n of region.graphs[topology].nodes.filter(n=>region.contract.revision===1||Math.hypot(n.position.x-position.x,n.position.z-position.z)<45))source.entities.add({id:n.id,properties:{spatialCell:n.id},polygon:{hierarchy:line(polygon(region.contract,topology,n.q,n.r)),material:C.Color.CYAN.withAlpha(.16),heightReference:C.HeightReference.CLAMP_TO_GROUND,outline:false}});
  viewer.scene.requestRender();
 }
 function plan(id,entrance=null,requestId=null){if(!region||!globe.owner())return;clearRoute();preview=entrance?routeToEntrance(region,topology,position,entrance,{closedRoadIds}):route(region,topology,position,id,{closedRoadIds});if(!preview){status('No legal path from this position.');return;}
  arrivalRequest=entrance&&typeof requestId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(requestId)?{requestId,destinationId:entrance}:null;
  routeEntity=source.entities.add({id:'bridgeport-preview',polyline:{positions:line(preview.points),width:5,clampToGround:true,zIndex:10,material:C.Color.YELLOW}});
  panel.querySelector('[data-confirm]').disabled=false;status(`Preview: ${preview.costM.toFixed(1)} m, ${preview.ids.length} ${topology} cells. Confirm to walk.`);viewer.scene.requestRender();
 }
 function detach(){importController?.abort();importController=null;save();clearRoute();if(source){viewer.dataSources.remove(source,true);source=null;}region=null;actor=null;notify('unloaded');status('Region unloaded. Return near Golden Hill Street to resume.');}
 function attach(data){
  if(!entered||!globe.owner())return;region=data;frame=metricFrame(data.contract.frame.anchor);let stored=null;try{stored=restorePosition(data,JSON.parse(localStorage.getItem(data.contract.state.key)));}catch{}
  topology=stored?.topology||topology;closedRoadIds=(Array.isArray(stored?.closedRoadIds)?stored.closedRoadIds:[]).filter(id=>data.roads.some(r=>r.id===id));navigationRevision++;position=stored?.position||(data.graphs[topology].entrances?.find(e=>e.id===entranceId)?.position)||(entranceId==='bridgeport-main-golden-hill'?{x:0,y:0,z:0}:null)||{...data.graphs[topology].nodes.find(n=>n.id===data.graphs[topology].entryId).position};
  panel.querySelector('select[aria-label="Navigation topology"]').value=topology;
  panel.querySelector('strong').textContent=data.contract.revision===2?'Downtown Bridgeport · street navigation':'Golden Hill Street · Bridgeport';panel.querySelector('[data-destination]').hidden=!data.contract.entrances;
  const dest=panel.querySelector('[aria-label="Street destination"]');dest.innerHTML='<option value="court-exterior-approach">Court exterior approach</option>';for(const e of data.contract.entrances||[]){const o=document.createElement('option');o.value=e.id;o.textContent=e.alias.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' / ');dest.append(o);}
  const closures=panel.querySelector('[aria-label="Simulation road closure"]');closures.innerHTML='<option value="">All roads open</option>';for(const road of data.roads){const o=document.createElement('option');o.value=road.id;o.textContent=road.name;closures.append(o);}closures.value=closedRoadIds.length===1?closedRoadIds[0]:'';
  panel.querySelector('[data-closures]').hidden=!data.contract.capabilities?.includes('road-closures');panel.querySelector('[data-import]').hidden=!data.contract.state.importFrom;
  source=new C.CustomDataSource('bridgeport-shared-navigation');viewer.dataSources.add(source);
  for(const b of data.buildings)source.entities.add({id:'ct:'+b.id,name:b.name,polygon:{hierarchy:new C.PolygonHierarchy(b.coordinates[0].map(p=>C.Cartesian3.fromDegrees(p[0],p[1])),b.coordinates.slice(1).map(r=>new C.PolygonHierarchy(r.map(p=>C.Cartesian3.fromDegrees(p[0],p[1]))))),height:0,heightReference:C.HeightReference.CLAMP_TO_GROUND,extrudedHeight:12,extrudedHeightReference:C.HeightReference.RELATIVE_TO_GROUND,material:C.Color.SLATEGRAY.withAlpha(.8)}});
  for(const road of data.roads)source.entities.add({id:'osm:'+road.id,name:road.name,polyline:{positions:line(road.points),width:4,clampToGround:true,material:C.Color.WHITE.withAlpha(.8)}});
  drawCells();actor=source.entities.add({id:'bridgeport-walker',position:cart(position),point:{pixelSize:16,color:C.Color.LIME,outlineColor:C.Color.BLACK,outlineWidth:2,heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:'You · street',font:'15px sans-serif',pixelOffset:new C.Cartesian2(0,-28),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY}});
  status('Choose the court approach or tap a highlighted cell, then confirm.');save();notify('ready');
 }
 const gate=regionGate({load:async signal=>{const res=await fetch('data/spatial/'+requestedRegion+'.json',{signal,credentials:'same-origin'});if(!res.ok)throw Error('Region unavailable');const text=await res.text();if(new TextEncoder().encode(text).length>(requestedRegion.endsWith('.v2')?1600000:500000))throw Error('Region byte budget exceeded');const data=JSON.parse(text);if(data.contract?.id!==requestedRegion||data.contract.revision!==(requestedRegion.endsWith('.v2')?2:1)||Object.values(data.graphs).some(g=>g.nodes.length>4000))throw Error('Region revision or node budget mismatch');return data;},attach,detach,onError:e=>status(e.message)});
 function view(){const canvas=viewer.scene.canvas,p=viewer.camera.pickEllipsoid(new C.Cartesian2(canvas.clientWidth/2,canvas.clientHeight/2),viewer.scene.globe.ellipsoid);if(!p)return null;const g=C.Cartographic.fromCartesian(p);return {lon:C.Math.toDegrees(g.longitude),lat:C.Math.toDegrees(g.latitude),height:viewer.camera.positionCartographic.height};}
 function tick(){
  if(!globe.owner()&&entered){leave(false);return;}
  gate.update({owner:globe.owner(),entered,view:view()});panel.querySelector('[data-ion]').textContent=terrainDescription(globe.ionState?.());
 }
 function animate(now){raf=requestAnimationFrame(animate);const dt=Math.min(1,(now-last)/1000||0);last=now;if(!walking||!source||!globe.owner()||document.hidden)return;let budget=dt*2;
  while(budget>0&&walking.length){const next=walking[0],d=Math.hypot(next.x-position.x,next.z-position.z),t=d?Math.min(1,budget/d):1;const p={x:position.x+(next.x-position.x)*t,y:0,z:position.z+(next.z-position.z)*t};if(!clearEdge(region,position,p,{closedRoadIds})){clearRoute();status('Movement blocked; preview again.');break;}position=p;budget-=d;if(t===1)walking.shift();else break;}
  actor.position=cart(position);if(cellOrigin&&Math.hypot(position.x-cellOrigin.x,position.z-cellOrigin.z)>12)drawCells();viewer.scene.requestRender();if(walking&&!walking.length){walking=null;save();status('Arrived at the selected exterior street cell.');notify('arrived',arrivalRequest||{});arrivalRequest=null;}else if(walking){status(`Walking · ${walking.length} waypoints remaining`);}
 }
 function leave(restore=true){save();entered=false;gate.dispose();panel.hidden=true;if(restore&&original)viewer.camera.setView(original);original=null;notify('returned');}
 function previewDestination(id,requestId=null){if(!region)return;const target=id==='court-exterior-approach'?region.graphs[topology].destinationId:region.graphs[topology].entrances?.find(e=>e.id===id)?.nodeId;if(target)plan(target,id==='court-exterior-approach'?null:id,requestId);}
 function setClosures(ids){if(!region?.contract.capabilities?.includes('road-closures')||!globe.owner()||!Array.isArray(ids)||ids.some(id=>!region.roads.some(r=>r.id===id)))return false;closedRoadIds=[...new Set(ids)];navigationRevision++;clearRoute();save();notify('closures-changed');status('Simulation roads changed; preview again. Your position is unchanged.');return true;}
 panel.querySelector('[aria-label="Simulation road closure"]').onchange=e=>setClosures(e.target.value?[e.target.value]:[]);
 panel.querySelector('[aria-label="Street destination"]').onchange=()=>clearRoute();
 panel.querySelector('[data-import]').onclick=async()=>{if(!region?.contract.state.importFrom||!globe.owner())return;const target=region;importController?.abort();const control=new AbortController();importController=control;try{const previous=await fetch('data/spatial/bridgeport-golden-hill.v1.json',{signal:control.signal}).then(r=>{if(!r.ok)throw Error('Previous region unavailable');return r.json();});const raw=JSON.parse(localStorage.getItem(target.contract.state.importFrom.key)),next=importCompatiblePose(target,previous,raw);if(control.signal.aborted||region!==target||!globe.owner())return;if(!next)throw Error('No compatible previous position to import');localStorage.setItem(target.contract.state.key,JSON.stringify(next));clearRoute();position={...next.position};topology=next.topology;closedRoadIds=[];panel.querySelector('[aria-label="Navigation topology"]').value=topology;panel.querySelector('[aria-label="Simulation road closure"]').value='';drawCells();actor.position=cart(position);notify('imported');status('Previous position copied. Original save preserved.');}catch(e){if(!control.signal.aborted)status(e.message);}finally{if(importController===control)importController=null;}};
 panel.querySelector('[data-preview]').onclick=()=>previewDestination(panel.querySelector('[aria-label="Street destination"]').value);
 panel.querySelector('[data-confirm]').onclick=()=>{if(!preview||!globe.owner())return;const fresh=preview.entranceId?routeToEntrance(region,topology,position,preview.entranceId,{closedRoadIds}):route(region,topology,position,preview.ids.at(-1),{closedRoadIds});if(!fresh){clearRoute();return;}walking=fresh.points.slice(1);preview=null;panel.querySelector('[data-confirm]').disabled=true;};
 panel.querySelector('[data-stop]').onclick=()=>{clearRoute();save();status('Stopped. Preview a route to continue.');};
 panel.querySelector('[data-locate]').onclick=()=>{
  if(!entered||!region||!position||!globe.owner())return;
  // Offset the centre south so the actor stays above the phone's control panel.
  // This only moves the camera; it does not move the actor or change saved geography.
  const g=frame.toGeo({x:position.x,y:0,z:position.z+80}),ground=viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(g.lon,g.lat));
  viewer.camera.flyTo({destination:C.Cartesian3.fromDegrees(g.lon,g.lat,(Number.isFinite(ground)?ground:0)+360),orientation:{heading:0,pitch:-Math.PI/2,roll:0},duration:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:1});
 };
 panel.querySelector('[data-return]').onclick=()=>leave();
 panel.querySelector('select[aria-label="Navigation topology"]').onchange=e=>{clearRoute();topology=e.target.value;drawCells();save();status('Topology changed; metric position preserved. Preview a new route.');};
 const interval=setInterval(tick,250);viewer.camera.moveEnd.addEventListener(tick);raf=requestAnimationFrame(animate);
 return {
  enter(options={}){if(!globe.owner())return;const nextRegion=options.regionId||'bridgeport-golden-hill.v1';if(!['bridgeport-golden-hill.v1','bridgeport-downtown.v2'].includes(nextRegion))return;if(entered&&requestedRegion!==nextRegion)leave();requestedRegion=nextRegion;if(options.entranceId&&!['bridgeport-main-elm','bridgeport-main-fairfield','bridgeport-middle-golden-hill','bridgeport-main-south','bridgeport-main-golden-hill','golden-hill-west'].includes(options.entranceId))return;if(requestedRegion.endsWith('.v1')&&options.entranceId&&!['bridgeport-main-golden-hill','golden-hill-west'].includes(options.entranceId))return;entranceId=options.entranceId||'golden-hill-west';if(!entered)original={destination:C.Cartesian3.clone(viewer.camera.positionWC),orientation:{heading:viewer.camera.heading,pitch:viewer.camera.pitch,roll:viewer.camera.roll}};entered=true;panel.hidden=false;viewer.camera.flyTo({destination:C.Cartesian3.fromDegrees(-73.19055,requestedRegion.endsWith('.v2')?41.1797:41.18035,360),orientation:{heading:0,pitch:-Math.PI/2,roll:0},duration:1,complete:tick});},
  previewDestination,
  setClosures,
  confirm(){panel.querySelector('[data-confirm]').click();},
  pick(picked,screen){
   if(!entered||!region)return false;let id;
   if(screen){const ray=viewer.camera.getPickRay(screen),hit=viewer.scene.globe.pick(ray,viewer.scene)||viewer.camera.pickEllipsoid(screen,viewer.scene.globe.ellipsoid);if(hit){const g=C.Cartographic.fromCartesian(hit),p=frame.toLocal({lon:C.Math.toDegrees(g.longitude),lat:C.Math.toDegrees(g.latitude),h:0}),cell=localCell(region.contract,topology,p);id=cellId('street',topology,cell.q,cell.r);}}
   if(!screen)id=picked?.id?.properties?.spatialCell?.getValue();
   if(!region.graphs[topology].nodes.some(n=>n.id===id))return false;plan(id);return true;
  },
  leave,
  snapshot(){return {entered,topology,position,regionId:region?.contract.id,closedRoadIds:[...closedRoadIds],navigationRevision,entities:source?.entities.values.length||0,walking:!!walking,...gate.status()};},
  destroy(){leave(false);clearInterval(interval);cancelAnimationFrame(raf);viewer.camera.moveEnd.removeEventListener(tick);panel.remove();style.remove();}
 };
}
