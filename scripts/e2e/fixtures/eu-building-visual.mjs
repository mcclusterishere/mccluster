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

// Appended to the real module only in the server's in-memory response. Reads the actual
// scene/renderer, never substitutes models, bypasses owner gates, or changes device state.
// frameStation changes only a review camera, using the authored station's real bounds/yaw.
export const OBSERVER = String.raw`
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
  return {focus:currentFocus,room:roomMode,plant:plantMode,xray:engineeringMode,
   workstationStatus:workstationLayer.status,workstationRootVisible:!!workstations?.visible,
   fullElectronicsVisible:!!electronics?.visible,servicesVisible:!!services?.visible,
   floors:Array.from({length:8},(_,i)=>({level:i,loaded:!!loadedFloorRoot(i),visible:effectivelyVisible(loadedFloorRoot(i)),meshes:visibleMeshes(loadedFloorRoot(i)).length})),
   devices:[...devices.values()].map(d=>({...d,box:{min:d.box.min.toArray(),max:d.box.max.toArray()}})),
   fullDeviceIds:[...new Set(full.map(o=>o.userData.assetId).filter(Boolean))],
   rootTransform:workstations?{position:workstations.position.toArray(),scale:workstations.scale.toArray(),rotation:workstations.rotation.toArray()}:null,
   rendered:{calls:ren.info.render.calls,triangles:ren.info.render.triangles},pixelSample,
   camera:{position:cam.position.toArray(),target:ctl.target.toArray()},
   overflow:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}};
 },
 frameStation(id) {
  const record=deviceRecordById.get(id);if(!record||roomMode)throw new Error('Review camera requires a visible normal-view authored device');
  const station=record.support_binding?.station_id,box=new THREE.Box3();let found=0;
  workstations?.traverse(o=>{if(!o.isMesh||!effectivelyVisible(o))return;const r=o.userData.euDeviceRecord;
   if(r?.asset_id===id||(station&&r?.support_binding?.station_id===station)){box.union(new THREE.Box3().setFromObject(o));found++}});
  if(!found)throw new Error('Authored device is not visible: '+id);
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),d=Math.max(5,Math.max(size.x,size.z)*1.5),yaw=(record.support_binding?.yaw_degrees||0)*Math.PI/180;
  ctl.target.copy(center);cam.position.set(center.x+d*(Math.sin(yaw)+.32*Math.cos(yaw)),center.y+d*.5,center.z+d*(Math.cos(yaw)-.32*Math.sin(yaw)));cam.lookAt(center);ctl.update();
  return {id,station,components:found,bounds:{min:box.min.toArray(),max:box.max.toArray()}};
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
