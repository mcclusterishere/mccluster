import {clearEdge} from './region-graph.mjs';
import {createTravelControls,TRAVEL} from '../fictional-city/travel-controls.mjs';
import {safeCameraDistance} from '../fictional-city/camera-controls.mjs';
import {avatarModel} from './exterior-avatar.mjs';
// Query the same metric collision implementation with the existing locomotion body profile.
// This is a query view, never a mutation of the descriptor, graph, or tactical occupancy.
export function travelClear(region,a,b,mode,closedRoadIds=[]){
 if(!region||!TRAVEL[mode])return false;
 const query={...region,contract:{...region.contract,actor:{...region.contract.actor,radiusM:Math.max(region.contract.actor.radiusM,TRAVEL[mode].radius)}}};
 return clearEdge(query,a,b,{closedRoadIds});
}
export function advanceExterior(region,position,heading,mode,distance,closedRoadIds=[]){
 if(![heading,distance].every(Number.isFinite)||Math.abs(distance)>1)return null;
 const next={x:position.x+Math.sin(heading)*distance,y:region.contract.floor.heightM,z:position.z-Math.cos(heading)*distance};
 return travelClear(region,position,next,mode,closedRoadIds)?next:null;
}
export function mountExterior({panel,viewer,C,state,move,interrupt,save,status}){
 const travel=createTravelControls(),keys=new Set(),models={walk:avatarModel(),bike:avatarModel(true)};
 let camera='overview',heading=0,active=false,wasMoving=false,originalInputs=null,switchingCamera=false;
 const controls=document.createElement('div');controls.dataset.exteriorControls='';
 controls.innerHTML='<label>Camera <select aria-label="Street camera"><option value="overview">Map</option><option value="close">Follow behind</option><option value="first">First person</option></select></label><label>Travel <select aria-label="Street travel"><option value="walk">Walk</option><option value="bike">Bicycle</option></select></label><div aria-label="Street movement"><button data-drive="left" aria-label="Turn left">↶</button><button data-drive="forward" aria-label="Move forward">Forward</button><button data-drive="back" aria-label="Move backward">Back</button><button data-drive="right" aria-label="Turn right">↷</button></div><small>W/S move · A/D turn. Hold a movement button on touch screens. Session camera and bicycle; shared street position saves.</small>';
 panel.querySelector('strong').after(controls);for(const el of controls.querySelectorAll('button,select'))el.disabled=true;
 const style=document.createElement('style');style.textContent='#bridgeportWalk[data-street-camera="close"],#bridgeportWalk[data-street-camera="first"]{max-height:24vh}[data-drive]{touch-action:none}';document.head.append(style);
 const enabled=()=>{const s=state();return active&&s.owner&&s.region&&s.position&&!document.hidden;};
 function stop(){keys.clear();travel.stop();if(wasMoving){save();wasMoving=false;}}
 function releaseCamera(){if(originalInputs===null)return;viewer.camera.cancelFlight();viewer.scene.screenSpaceCameraController.enableInputs=originalInputs;originalInputs=null;viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);}
 // Cesium can dispatch moveEnd synchronously while cancelling a flight. Keep the attached
 // actor's location eligible until the new camera pose is installed in this same call.
 function setCamera(mode){if(!['overview','close','first'].includes(mode)||!enabled())return;switchingCamera=true;try{stop();camera=mode;controls.querySelector('[aria-label="Street camera"]').value=mode;panel.dataset.streetCamera=mode;
  releaseCamera();if(mode!=='overview'){viewer.camera.cancelFlight();originalInputs=viewer.scene.screenSpaceCameraController.enableInputs;viewer.scene.screenSpaceCameraController.enableInputs=false;}else panel.querySelector('[data-locate]').click();sync();}finally{switchingCamera=false;}}
 function sync(){const s=state();if(!enabled()||!s.actor)return;
  const geo=s.frame.toGeo(s.position),g=C.Cartographic.fromDegrees(geo.lon,geo.lat),sample=viewer.scene.globe.getHeight(g),ground=Number.isFinite(sample)?sample:0;
  s.actor.position=C.Cartesian3.fromDegrees(geo.lon,geo.lat,ground);s.actor.orientation=C.Transforms.headingPitchRollQuaternion(s.actor.position.getValue(C.JulianDate.now()),new C.HeadingPitchRoll(heading+Math.PI/2,0,0));
  if(!s.actor.model)s.actor.model=new C.ModelGraphics({uri:models[travel.mode],scale:1,heightReference:C.HeightReference.NONE});
  else if(s.actor.model.uri?.getValue()!==models[travel.mode])s.actor.model.uri=models[travel.mode];
  s.actor.model.show=camera!=='first';
  s.actor.point.show=camera==='overview';s.actor.label.show=camera==='overview';
  if(camera==='first')viewer.camera.setView({destination:C.Cartesian3.fromDegrees(geo.lon,geo.lat,ground+1.65),orientation:{heading,pitch:0,roll:0}});
  if(camera==='close'){const boom=safeCameraDistance(s.position,-heading,7,(x,z)=>travelClear(s.region,s.position,{x,y:0,z},'walk',s.closedRoadIds));viewer.camera.lookAt(C.Cartesian3.fromDegrees(geo.lon,geo.lat,ground+1),new C.HeadingPitchRange(heading,-.25,boom));}
  viewer.scene.requestRender();
 }
 controls.querySelector('[aria-label="Street camera"]').onchange=e=>{setCamera(e.target.value);e.target.blur();};
 controls.querySelector('[aria-label="Street travel"]').onchange=e=>{const s=state(),next=e.target.value;stop();interrupt();if(!enabled()||!travel.setMode(next,{clear:()=>travelClear(s.region,s.position,s.position,'bike',s.closedRoadIds)})){e.target.value=travel.mode;status('Not enough clear street space to mount the bicycle.');return;}sync();e.target.blur();};
 const mapping={KeyW:'forward',ArrowUp:'forward',KeyS:'back',ArrowDown:'back',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
 function input(key,on){if(on){if(!enabled())return;interrupt();keys.add(key);}else{keys.delete(key);if(!keys.size)stop();}}
 const down=e=>{if(!enabled()||/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||!mapping[e.code])return;e.preventDefault();input(mapping[e.code],true);};
 const up=e=>{if(mapping[e.code])input(mapping[e.code],false);};
 window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',stop);document.addEventListener('visibilitychange',stop);
 for(const b of controls.querySelectorAll('[data-drive]')){b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);input(b.dataset.drive,true);};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>input(b.dataset.drive,false);}
 return {
  attach(){active=true;for(const el of controls.querySelectorAll('button,select'))el.disabled=false;sync();},
  detach(){stop();active=false;for(const el of controls.querySelectorAll('button,select'))el.disabled=true;releaseCamera();camera='overview';travel.setMode('walk');controls.querySelector('[aria-label="Street camera"]').value=camera;controls.querySelector('[aria-label="Street travel"]').value='walk';panel.dataset.streetCamera=camera;},
  update(dt){if(!enabled())return;const turn=Number(keys.has('right'))-Number(keys.has('left')),throttle=Number(keys.has('forward'))-Number(keys.has('back'));dt=Math.min(.05,Math.max(0,dt));heading+=turn*dt*1.8;
   if(throttle){const s=state(),p=advanceExterior(s.region,s.position,heading,travel.mode,throttle*travel.speedFor(throttle,dt)*dt,s.closedRoadIds);if(p){move(p);wasMoving=true;}else{stop();status('Blocked by the street boundary, footprint, or road closure.');}}
   else if(turn)travel.stop();if(turn||throttle)sync();
  },
  routeClear(points){const s=state();return points.every((p,i)=>i===0||travelClear(s.region,points[i-1],p,travel.mode,s.closedRoadIds));},
  edgeClear(a,b){const s=state();return travelClear(s.region,a,b,travel.mode,s.closedRoadIds);},
  routeSpeed(dt){return travel.mode==='bike'?travel.speedFor(1,Math.min(.05,dt)):2;},
  follow(a,b){if(Math.hypot(b.x-a.x,b.z-a.z)>.00001)heading=Math.atan2(b.x-a.x,a.z-b.z);sync();},
  view(){if(switchingCamera){const s=state(),g=s.frame.toGeo(s.position);return {lon:g.lon,lat:g.lat,height:0};}if(camera==='overview')return null;const p=viewer.camera.positionCartographic;return {lon:C.Math.toDegrees(p.longitude),lat:C.Math.toDegrees(p.latitude),height:p.height};},
  overview(){if(enabled())setCamera('overview');},
  resetTravel(){stop();travel.setMode('walk');controls.querySelector('[aria-label="Street travel"]').value='walk';sync();},stop,
  snapshot(){return {camera,mode:travel.mode,heading,moving:wasMoving,active};},
  destroy(){this.detach();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',stop);controls.remove();style.remove();}
 };
}
