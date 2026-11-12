// Test-only loopback fixture. Never copied into a published viewer or asset bundle.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

export const VIEWER_PATH = '/equity-uprise-building-core-v2-3d.html';
export const PRODUCTION = 'docs/design/equity-uprise-building/production/';
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json',
  '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.glb':'model/gltf-binary' };

export function candidatePaths(root, pathname) {
  const path = decodeURIComponent(pathname);
  if (!path.startsWith('/') || path.includes('\\') || path.split('/').some(p => p.startsWith('.'))) return [];
  if (path === VIEWER_PATH) return [resolve(root, '_unfinished/equity-uprise' + path)];
  if (path.startsWith('/equity-uprise-preview/')) {
    const tail = path.slice('/equity-uprise-preview/'.length);
    if (tail.includes('/')) {
      if (!/^(?:lab-runtime|electronics|brand)\//.test(tail)) return [];
      return [resolve(root, PRODUCTION, tail)];
    }
    return ['generated', 'electronics/generated', 'asset-registry/generated', 'lab-runtime', 'electronics']
      .map(dir => resolve(root, PRODUCTION, dir, tail));
  }
  return [resolve(root, '.' + path)];
}

// Exact authored seats, not a nearest-object/proximity guess. These are camera anchors only.
export const STATION_SEATS = {
  'B1-USER-WS-01':'B1-WORKSHOP-BENCH-STOOL-01::stool_counter',
  'F1-USER-WS-01':'F1-RECEPTION-CHAIR-02::task_chair',
  'F2-USER-WS-01':'F2-DESK-CHIOMA-OKEKE-CHAIR::task_chair',
  'F3-USER-WS-01':'F3-DESK-NUSRAT-RAHMAN-CHAIR::task_chair',
  'F4-USER-WS-01':'F4-DESK-PRIYA-SRISAWAT-CHAIR::task_chair',
  'F5-USER-WS-01':'F5-DESK-OKSANA-BONDARENKO-CHAIR::task_chair',
  'F6-USER-WS-01':'F6-OFFICE-HELEN-CLARKE-CHAIR::task_chair_exec',
};

// Search a bounded standing-review area on the exact chair side. Every target must have
// a real triangle-level sightline. No geometry/material/visibility change makes a view pass.
export function findStationView(THREE, {box,seat,ffe,targets,obstacles,width,height,rect,fovForPosition}) {
  const center=box.getCenter(new THREE.Vector3()),away=seat.clone().sub(center);away.y=0;away.normalize();
  const side=new THREE.Vector3(-away.z,0,away.x),ray=new THREE.Raycaster();
  const blockers=(position)=>targets.flatMap(target=>{
    const delta=target.point.clone().sub(position),distance=delta.length();
    ray.set(position,delta.normalize());ray.near=.025;ray.far=distance-.025;
    const hit=ray.intersectObjects(obstacles,false).find(h=>h.object.userData.assetId!==target.id);
    if(hit)return [{target:target.id,mesh:hit.object.userData.name||hit.object.name,distance:hit.distance}];
    // Reverse ray also catches a candidate accidentally inside a one-sided wall.
    ray.set(target.point,position.clone().sub(target.point).normalize());
    const reverse=ray.intersectObjects(obstacles,false).find(h=>h.object.userData.assetId!==target.id);
    return reverse?[{target:target.id,mesh:reverse.object.userData.name||reverse.object.name,distance:reverse.distance}]:[];
  });
  const clear=position=>blockers(position).length===0;
  const candidates=[];
  for(const back of [0,.25,.5,.75,1,1.25,1.5,2,2.5])for(const lateral of [0,-.3,.3,-.6,.6,-.9,.9])for(const eye of [1.6,1.75]) {
    const position=seat.clone().addScaledVector(away,back).addScaledVector(side,lateral);position.y=ffe+eye;
    if(position.x<.15||position.x>72*.3048-.15||position.z>-.15||position.z<-(72*.3048-.15))continue;
    const fov=Math.max(52,fovForPosition(THREE,{box,position,width,height,rect,pad:1.12}));
    if(fov>100)continue;
    candidates.push({position,fov,back,lateral,eye,score:back*10+Math.abs(lateral)*3+Math.max(0,fov-70)*.3});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const found=candidates.find(c=>clear(c.position));
  if(!found)throw new Error('No unobstructed authored chair-side view fits; inspect the room, never hide its walls: '+JSON.stringify(candidates.slice(0,3).map(c=>({position:c.position.toArray(),fov:c.fov,blockers:blockers(c.position)}))));
  return {...found,clear,targets:targets.map(t=>t.id)};
}

// Appended to the real module only in the server's in-memory response. Reads the actual
// scene/renderer, never substitutes models, bypasses owner gates, or changes device state.
// frameStation changes only a review camera, using the authored station's real bounds/yaw.
export const OBSERVER = String.raw`
const visualStationSeats=${JSON.stringify(STATION_SEATS)};
const findVisualStationView=${findStationView.toString()};
globalThis.__euVisualFixture = Object.freeze({
 snapshot(samplePixels=false) {
  scene.updateMatrixWorld(true);ren.render(scene,cam);
  const visibleMeshes=root=>{const list=[];root?.traverse(o=>{if(o.isMesh&&effectivelyVisible(o))list.push(o)});return list};
  const native=visibleMeshes(workstations),full=visibleMeshes(electronics);
  const devices=new Map();
  native.forEach(o=>{const id=o.userData.assetId;if(!devices.has(id))devices.set(id,{id,archetype:o.userData.euDeviceRecord?.archetype,
   floor:o.userData.euAssemblyFloor,components:[],box:new THREE.Box3()});
   const d=devices.get(id);d.components.push(authoredName(o));d.box.union(new THREE.Box3().setFromObject(o));});
  let pixelSample=null;
  if(samplePixels){const gl=ren.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixels=new Uint8Array(w*h*4);
   gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const colors=new Set();let lit=0,samples=0;
   for(let i=0;i<pixels.length;i+=4*97){colors.add((pixels[i]>>3)+','+(pixels[i+1]>>3)+','+(pixels[i+2]>>3));if(pixels[i]+pixels[i+1]+pixels[i+2]>30)lit++;samples++}
   pixelSample={width:w,height:h,colors:colors.size,lit,samples,contextLost:gl.isContextLost()};}
  const reviewRoot=currentFocus==='stack'?scene:currentFocus==='facade'?facade:loadedFloorRoot(Number(currentFocus));
  const projectedBounds=[];
  if(reviewRoot&&!roomMode){const b=visibleWorldBounds(THREE,reviewRoot,floorCutY??Infinity);
   if(!b.isEmpty())for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
    const p=new THREE.Vector3(x,y,z).project(cam);projectedBounds.push({x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2});}}
  return {focus:currentFocus,room:roomMode,plant:plantMode,xray:engineeringMode,
   facadeVisible:effectivelyVisible(facade),
   workstationStatus:workstationLayer.status,workstationRootVisible:!!workstations?.visible,
   fullElectronicsVisible:!!electronics?.visible,servicesVisible:!!services?.visible,
   floors:Array.from({length:8},(_,i)=>({level:i,loaded:!!loadedFloorRoot(i),visible:effectivelyVisible(loadedFloorRoot(i)),meshes:visibleMeshes(loadedFloorRoot(i)).length})),
   devices:[...devices.values()].map(d=>({...d,box:{min:d.box.min.toArray(),max:d.box.max.toArray()}})),
   fullDeviceIds:[...new Set(full.map(o=>o.userData.assetId).filter(Boolean))],
   rootTransform:workstations?{position:workstations.position.toArray(),scale:workstations.scale.toArray(),rotation:workstations.rotation.toArray()}:null,
   rendered:{calls:ren.info.render.calls,triangles:ren.info.render.triangles},pixelSample,
   presentation:{ceilingY:floorCutY,clipPlanes:ren.clippingPlanes.length,label:document.getElementById('presentationStatus').textContent},
   camera:{position:cam.position.toArray(),target:ctl.target.toArray(),fov:cam.fov,minDistance:ctl.minDistance,viewport:reviewViewport(),projectedBounds},
   overflow:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}};
 },
 async frameStation(id,focusId=id) {
  const {fovForPosition,applyCameraViewport}=await import('/js/eu-screens/view-framing.mjs');
  const record=deviceRecordById.get(id);if(!record||roomMode)throw new Error('Review camera requires a visible normal-view authored device');
  const station=record.support_binding?.station_id,box=new THREE.Box3();let found=0;
  workstations?.traverse(o=>{if(!o.isMesh||!effectivelyVisible(o))return;const r=o.userData.euDeviceRecord;
   if(r?.asset_id===focusId&&r?.support_binding?.station_id===station){box.union(new THREE.Box3().setFromObject(o));found++}});
  if(!found)throw new Error('Authored device is not visible: '+id);
  const level=record.support_binding.level,floorRoot=loadedFloorRoot(level),obstacles=[],targets=[];let seatMesh;
  floorRoot.traverse(o=>{if(!o.isMesh||!effectivelyVisible(o))return;
    if(authoredName(o)===visualStationSeats[id])seatMesh=o;
    const ms=Array.isArray(o.material)?o.material:[o.material];if(ms.some(m=>m&&(!m.transparent||m.opacity>=.65)))obstacles.push(o)});
  if(!seatMesh)throw new Error('Missing exact authored chair/stool: '+visualStationSeats[id]);
  workstations.traverse(o=>{if(!o.isMesh||!effectivelyVisible(o))return;obstacles.push(o);const r=o.userData.euDeviceRecord;
    if(r?.asset_id===focusId&&r?.support_binding?.station_id===station&&authoredName(o)===r.asset_id)targets.push({id:r.asset_id,point:new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())})});
  if(targets.length!==1)throw new Error('Expected one exact authored base component for '+focusId+', found '+targets.length);
  const seat=new THREE.Box3().setFromObject(seatMesh).getCenter(new THREE.Vector3()),rect=reviewViewport();
  const view=findVisualStationView(THREE,{box,seat,ffe:(level-1)*13.5*.3048,targets,obstacles,width:innerWidth,height:innerHeight,rect,fovForPosition});
  const center=box.getCenter(new THREE.Vector3());ctl.target.copy(center);cam.position.copy(view.position);cam.fov=view.fov;
  applyCameraViewport(cam,innerWidth,innerHeight,rect);cam.lookAt(center);ctl.update();cam.updateMatrixWorld(true);
  if(!view.clear(cam.position))throw new Error('OrbitControls moved the inspection camera behind geometry');
  return {id,focusId,station,seat:visualStationSeats[id],components:found,clearSightlines:view.targets,fov:cam.fov,
    cameraAfterControls:cam.position.toArray(),seatOffset:{back:view.back,lateral:view.lateral,eye:view.eye},bounds:{min:box.min.toArray(),max:box.max.toArray()}};
 }
});
`;

export function instrumentViewer(html) {
  if (!/<script type="module">/.test(html) || !/<\/script>\s*<\/body>\s*<\/html>\s*$/.test(html)) {
    throw new Error('Canonical viewer module boundary changed; do not silently test a substitute page');
  }
  return html.replace(/<\/script>\s*<\/body>\s*<\/html>\s*$/, OBSERVER + '\n</script></body></html>');
}

export async function startVisualServer(root) {
  root = await realpath(root);
  const requests = [];
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    let code=404, body='', file;
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { code=405; throw new Error('Read only'); }
      for (const candidate of candidatePaths(root, pathname)) {
        try { const real=await realpath(candidate);if(real.startsWith(root+sep)&&(await stat(real)).isFile()){file=real;break;} } catch {}
      }
      if (!file) throw new Error('Missing fixture asset');
      body=await readFile(file);if(pathname===VIEWER_PATH)body=instrumentViewer(body.toString());code=200;
    } catch (error) { body=String(error.message); }
    requests.push({method:req.method,path:pathname,status:code});
    res.writeHead(code, {'content-type':TYPES[extname(file||'')]||'text/plain','cache-control':'no-store'});
    res.end(req.method==='HEAD'?'':body);
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok)});
  return {base:`http://127.0.0.1:${server.address().port}`,requests,
    close:()=>new Promise(resolve=>server.close(resolve))};
}
