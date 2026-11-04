import {metricFrame,polygon,localCell,cellId} from './metric-frame.mjs';
import {route,clearEdge,restorePosition} from './region-graph.mjs';
import {regionGate} from './region-gate.mjs';

// Draws the bounded region inside the existing Cesium viewer/ion pipeline. Never creates a second globe.
export function mountBridgeport({globe,C=window.Cesium}){
 const viewer=globe.viewer();let entered=false,region=null,frame=null,source=null,position=null,topology='hex',preview=null,walking=null,last=0,original=null,actor=null,routeEntity=null,raf=0,entranceId=null;
 const panel=document.createElement('section');panel.id='bridgeportWalk';panel.setAttribute('aria-label','Bridgeport walking review');panel.hidden=true;
 panel.innerHTML='<strong>Golden Hill Street · Bridgeport</strong><p data-status role="status">Fly to the walking region to load it.</p><label>Navigation <select aria-label="Navigation topology"><option value="hex">Hex</option><option value="square">Square</option></select></label><button data-preview>Preview court approach</button><button data-confirm disabled>Confirm walk</button><button data-stop>Stop</button><button data-return>Return to globe</button><small data-ion></small><small>Exterior simulation · estimated road width and heights. Not pedestrian directions. © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · CT GIS footprints.</small>';
 const style=document.createElement('style');style.textContent='#bridgeportWalk{position:fixed;z-index:300;left:12px;right:12px;bottom:100px;max-height:42vh;overflow:auto;padding:12px;background:#101a29f5;color:white;border:1px solid #81b9da;border-radius:12px;font:16px/1.35 system-ui}#bridgeportWalk[hidden]{display:none}#bridgeportWalk button,#bridgeportWalk select{font:inherit;min-height:44px;margin:3px;padding:5px 9px}#bridgeportWalk small{display:block;margin-top:6px;font-size:12px}#bridgeportWalk p{margin:5px 0}#bridgeportWalk a{color:#a7ddff}@media(min-width:768px){#bridgeportWalk{right:auto;width:390px;bottom:30px}}';document.head.append(style);document.body.append(panel);
 const status=s=>panel.querySelector('[data-status]').textContent=s;
 const notify=(event)=>globe.tell?.({type:'bridgeport:state',schema:'mccluster.spatial-lifecycle/v1',event,regionId:'bridgeport-golden-hill.v1',revision:1,frameId:'bridgeport-golden-hill.enu.v1',floorId:'street',entered,loaded:!!region,position:position?{...position}:null,topology,entranceId,capabilities:['exterior-navigation','square','hex','preview-confirm','local-resume']});
 const save=()=>{if(!region||!position)return;try{localStorage.setItem(region.contract.state.key,JSON.stringify({schema:region.contract.state.schema,regionId:region.contract.id,revision:region.contract.revision,frameId:region.contract.frame.id,floorId:'street',position,topology}));notify('saved');}catch{status('Position cannot be saved on this device.');}};
 const cart=p=>{const g=frame.toGeo(p);return C.Cartesian3.fromDegrees(g.lon,g.lat,0);};
 const line=points=>points.map(cart);
 function clearRoute(){preview=null;walking=null;panel.querySelector('[data-confirm]').disabled=true;if(routeEntity&&source)source.entities.remove(routeEntity);routeEntity=null;}
 function drawCells(){
  if(!source)return;for(const e of [...source.entities.values])if(e.properties?.spatialCell)source.entities.remove(e);
  for(const n of region.graphs[topology].nodes)source.entities.add({id:n.id,properties:{spatialCell:n.id},polygon:{hierarchy:line(polygon(region.contract,topology,n.q,n.r)),material:C.Color.CYAN.withAlpha(.16),heightReference:C.HeightReference.CLAMP_TO_GROUND,outline:false}});
  viewer.scene.requestRender();
 }
 function plan(id){if(!region||!globe.owner())return;clearRoute();preview=route(region,topology,position,id);if(!preview){status('No legal path from this position.');return;}
  routeEntity=source.entities.add({id:'bridgeport-preview',polyline:{positions:line(preview.points),width:5,clampToGround:true,material:C.Color.YELLOW}});
  panel.querySelector('[data-confirm]').disabled=false;status(`Preview: ${preview.costM.toFixed(1)} m, ${preview.ids.length} ${topology} cells. Confirm to walk.`);viewer.scene.requestRender();
 }
 function detach(){save();clearRoute();if(source){viewer.dataSources.remove(source,true);source=null;}region=null;actor=null;notify('unloaded');status('Region unloaded. Return near Golden Hill Street to resume.');}
 function attach(data){
  if(!entered||!globe.owner())return;region=data;frame=metricFrame(data.contract.frame.anchor);let stored=null;try{stored=restorePosition(data,JSON.parse(localStorage.getItem(data.contract.state.key)));}catch{}
  topology=stored?.topology||topology;position=stored?.position||(entranceId==='bridgeport-main-golden-hill'?{x:0,y:0,z:0}:null)||{...data.graphs[topology].nodes.find(n=>n.id===data.graphs[topology].entryId).position};
  panel.querySelector('select').value=topology;source=new C.CustomDataSource('bridgeport-shared-navigation');viewer.dataSources.add(source);
  for(const b of data.buildings)source.entities.add({id:'ct:'+b.id,name:b.name,polygon:{hierarchy:new C.PolygonHierarchy(b.coordinates[0].map(p=>C.Cartesian3.fromDegrees(p[0],p[1])),b.coordinates.slice(1).map(r=>new C.PolygonHierarchy(r.map(p=>C.Cartesian3.fromDegrees(p[0],p[1]))))),height:0,heightReference:C.HeightReference.CLAMP_TO_GROUND,extrudedHeight:12,extrudedHeightReference:C.HeightReference.RELATIVE_TO_GROUND,material:C.Color.SLATEGRAY.withAlpha(.8)}});
  for(const road of data.roads)source.entities.add({id:'osm:'+road.id,name:road.name,polyline:{positions:line(road.points),width:4,clampToGround:true,material:C.Color.WHITE.withAlpha(.8)}});
  drawCells();actor=source.entities.add({id:'bridgeport-walker',position:cart(position),point:{pixelSize:16,color:C.Color.LIME,outlineColor:C.Color.BLACK,outlineWidth:2,heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:'You · street',font:'15px sans-serif',pixelOffset:new C.Cartesian2(0,-28),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY}});
  status('Choose the court approach or tap a highlighted cell, then confirm.');save();notify('ready');
 }
 const gate=regionGate({load:async signal=>{const res=await fetch('data/spatial/bridgeport-golden-hill.v1.json',{signal,credentials:'same-origin'});if(!res.ok)throw Error('Region unavailable');const text=await res.text();if(new TextEncoder().encode(text).length>500000)throw Error('Region byte budget exceeded');const data=JSON.parse(text);if(data.contract?.id!=='bridgeport-golden-hill.v1'||data.contract.revision!==1||Object.values(data.graphs).some(g=>g.nodes.length>2500))throw Error('Region revision or node budget mismatch');return data;},attach,detach,onError:e=>status(e.message)});
 function view(){const canvas=viewer.scene.canvas,p=viewer.camera.pickEllipsoid(new C.Cartesian2(canvas.clientWidth/2,canvas.clientHeight/2),viewer.scene.globe.ellipsoid);if(!p)return null;const g=C.Cartographic.fromCartesian(p);return {lon:C.Math.toDegrees(g.longitude),lat:C.Math.toDegrees(g.latitude),height:viewer.camera.positionCartographic.height};}
 function tick(){
  if(!globe.owner()&&entered){leave(false);return;}
  gate.update({owner:globe.owner(),entered,view:view()});panel.querySelector('[data-ion]').textContent=globe.ion()?'Existing ion pipeline enabled; rendering uses its current terrain.':'Ion unavailable here; ellipsoid/fallback imagery only.';
 }
 function animate(now){raf=requestAnimationFrame(animate);const dt=Math.min(1,(now-last)/1000||0);last=now;if(!walking||!source||!globe.owner()||document.hidden)return;let budget=dt*2;
  while(budget>0&&walking.length){const next=walking[0],d=Math.hypot(next.x-position.x,next.z-position.z),t=d?Math.min(1,budget/d):1;const p={x:position.x+(next.x-position.x)*t,y:0,z:position.z+(next.z-position.z)*t};if(!clearEdge(region,position,p)){clearRoute();status('Movement blocked; preview again.');break;}position=p;budget-=d;if(t===1)walking.shift();else break;}
  actor.position=cart(position);viewer.scene.requestRender();if(walking&&!walking.length){walking=null;save();status('Arrived at the selected exterior street cell.');notify('arrived');}else if(walking){status(`Walking · ${walking.length} waypoints remaining`);}
 }
 function leave(restore=true){save();entered=false;gate.dispose();panel.hidden=true;if(restore&&original)viewer.camera.setView(original);original=null;notify('returned');}
 panel.querySelector('[data-preview]').onclick=()=>region&&plan(region.graphs[topology].destinationId);
 panel.querySelector('[data-confirm]').onclick=()=>{if(!preview||!globe.owner())return;const fresh=route(region,topology,position,preview.ids.at(-1));if(!fresh){clearRoute();return;}walking=fresh.points.slice(1);preview=null;panel.querySelector('[data-confirm]').disabled=true;};
 panel.querySelector('[data-stop]').onclick=()=>{clearRoute();save();status('Stopped. Preview a route to continue.');};
 panel.querySelector('[data-return]').onclick=()=>leave();
 panel.querySelector('select').onchange=e=>{clearRoute();topology=e.target.value;drawCells();save();status('Topology changed; metric position preserved. Preview a new route.');};
 const interval=setInterval(tick,250);viewer.camera.moveEnd.addEventListener(tick);raf=requestAnimationFrame(animate);
 return {
  enter(options={}){if(!globe.owner())return;if(options.entranceId&&!['bridgeport-main-golden-hill','golden-hill-west'].includes(options.entranceId))return;entranceId=options.entranceId||'golden-hill-west';if(!entered)original={destination:C.Cartesian3.clone(viewer.camera.positionWC),orientation:{heading:viewer.camera.heading,pitch:viewer.camera.pitch,roll:viewer.camera.roll}};entered=true;panel.hidden=false;viewer.camera.flyTo({destination:C.Cartesian3.fromDegrees(-73.19055,41.18035,360),orientation:{heading:0,pitch:-Math.PI/2,roll:0},duration:1,complete:tick});},
  previewDestination(id){if(region&&id==='court-exterior-approach')plan(region.graphs[topology].destinationId);},
  confirm(){panel.querySelector('[data-confirm]').click();},
  pick(picked,screen){
   if(!entered||!region)return false;let id;
   if(screen){const ray=viewer.camera.getPickRay(screen),hit=viewer.scene.globe.pick(ray,viewer.scene)||viewer.camera.pickEllipsoid(screen,viewer.scene.globe.ellipsoid);if(hit){const g=C.Cartographic.fromCartesian(hit),p=frame.toLocal({lon:C.Math.toDegrees(g.longitude),lat:C.Math.toDegrees(g.latitude),h:0}),cell=localCell(region.contract,topology,p);id=cellId('street',topology,cell.q,cell.r);}}
   if(!screen)id=picked?.id?.properties?.spatialCell?.getValue();
   if(!region.graphs[topology].nodes.some(n=>n.id===id))return false;plan(id);return true;
  },
  leave,
  snapshot(){return {entered,topology,position,regionId:region?.contract.id,entities:source?.entities.values.length||0,walking:!!walking,...gate.status()};},
  destroy(){leave(false);clearInterval(interval);cancelAnimationFrame(raf);viewer.camera.moveEnd.removeEventListener(tick);panel.remove();style.remove();}
 };
}
