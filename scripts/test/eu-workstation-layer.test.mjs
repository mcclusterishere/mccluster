import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../vendor/three.module.min.js';
import { createScreenHooks } from '../../js/eu-screens/enter.mjs';
import { WORKSTATION_FILE, workstationCatalog, prepareWorkstationRoot, syncWorkstationVisibility, effectivelyVisible,
  paintWorkstationMonitors, createWorkstationLayer } from '../../js/eu-screens/workstation-layer.mjs';
import * as HQ from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';

const ROOT = new URL('../../', import.meta.url);
const source = path => readFileSync(new URL(path, ROOT), 'utf8');
const P = 'docs/design/equity-uprise-building/production/';
const FT = .3048;
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);
function record(id, archetype, parts) {
  return { asset_id:id, archetype, components:parts.map(component_id => ({component_id,
    mesh_name:component_id==='DISPLAY_PANEL'||component_id==='BODY'?id:`${id}::PART::${component_id}`})) };
}
const catalog = {devices:[
  record('B1-USER-WS-01','workstation',['BODY']),
  record('F1-USER-WS-01','workstation',['BODY']),
  record('F1-USER-MON-01-01','monitor',['DISPLAY_PANEL','BEZEL','STAND_OR_MOUNT']),
  record('F6-USER-MON-01-01','monitor',['DISPLAY_PANEL','BEZEL','STAND_OR_MOUNT']),
  record('F1-SEC-CAM-01','camera',['BODY'])
]};
const registry={screens:[{screen_id:'one',asset_id:'F1-USER-MON-01-01',network_asset_id:'F1-USER-WS-01',floor:'F1',asset_type:'monitor'},
 {screen_id:'six',asset_id:'F6-USER-MON-01-01',network_asset_id:'F6-USER-WS-01',floor:'F6',asset_type:'monitor'}]};
function rawRoot(c = catalog) {
  const root=new THREE.Group();
  for (const r of c.devices) for (const part of r.components) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(.6,.2,.4),new THREE.MeshStandardMaterial({color:0x888888}));
    mesh.name=part.mesh_name.replaceAll(':','');mesh.userData.name=part.mesh_name;
    mesh.position.set(30,42,(r.asset_id.startsWith('B1')?-13.5:r.asset_id.startsWith('F6')?67.5:0)+3);
    root.add(mesh);
  }
  return root;
}
function prepared() { return prepareWorkstationRoot(rawRoot(),catalog); }

test('exact authored components only, with one absolute-feet/Z-up transform and no fabricated meshes',()=>{
  const root=rawRoot(), count=root.children.length;
  const outlet=new THREE.Mesh();outlet.name='F1-USER-MON-01-01::PWR-OUTLET::BODY';root.add(outlet);
  prepareWorkstationRoot(root,catalog);
  assert.equal(root.children.length,count+1);
  assert.equal(root.children.find(o=>o.userData.name==='F1-SEC-CAM-01').visible,false);
  assert.equal(outlet.visible,false);
  assert.equal(root.userData.euWorkstationMeshes.length,8);
  assert.deepEqual([...new Set(root.userData.euWorkstationMeshes.map(o=>o.userData.assetId))],
    catalog.devices.filter(d=>d.archetype!=='camera').map(d=>d.asset_id));
  for(const mesh of root.userData.euWorkstationMeshes) {
    assert.equal(mesh.name,mesh.userData.name);
    const world=mesh.getWorldPosition(new THREE.Vector3());
    close(world.x,30*FT);close(world.z,-42*FT);close(world.y,mesh.position.z*FT);
  }
  prepareWorkstationRoot(root,catalog);close(root.scale.x,FT); // not multiplied twice
});

test('normal/plant/room switching suppresses duplicates, hidden floors and hidden ancestors cannot be picked',()=>{
  const root=prepared(),scene=new THREE.Group();scene.add(root);
  const floorVisible=floor=>floor==='F1';
  assert.equal(syncWorkstationVisibility(root,{floorVisible}),2);
  const hooks=createScreenHooks({THREE,registry,camera:new THREE.PerspectiveCamera()});
  hooks.bindFloor('F1',root);hooks.bindFloor('F6',root);
  assert.equal(hooks.targets().length,2,'only exact F1 face/bezel selectable');
  assert.equal(syncWorkstationVisibility(root,{floorVisible,fullElectronicsVisible:true}),0);
  assert.equal(hooks.targets().length,0,'full plant owns visible assemblies, never both');
  assert.equal(syncWorkstationVisibility(root,{floorVisible,fullElectronicsVisible:false}),2,'room restores authored layer');
  scene.visible=false;assert.equal(syncWorkstationVisibility(root,{floorVisible}),0);assert.equal(hooks.targets().length,0);
  scene.visible=true;assert.equal(syncWorkstationVisibility(root,{floorVisible:()=>false}),0);assert.equal(hooks.targets().length,0);
  syncWorkstationVisibility(root,{floorVisible});
  const hiddenParent=new THREE.Group();hiddenParent.visible=false;root.add(hiddenParent);
  const face=root.userData.euWorkstationMeshes.find(m=>m.userData.componentId==='DISPLAY_PANEL');hiddenParent.add(face);
  syncWorkstationVisibility(root,{floorVisible});assert.equal(effectivelyVisible(face),false);
  assert.equal(hooks.screenForObject(face),null);
});

test('standalone F1/B1/F2–F6 subtract the floor FFE once in the outer frame, never individual devices',()=>{
  for(const [floor,ffe] of [['B1',-13.5],...Array.from({length:6},(_,i)=>['F'+(i+1),i*13.5])]) {
    const id=floor+'-USER-WS-01', c={devices:[record(id,'workstation',['BODY'])]}, root=rawRoot(c);
    root.children[0].position.set(30,42,ffe+3);
    const before=root.children[0].position.toArray();prepareWorkstationRoot(root,c);
    const frame=new THREE.Group();frame.position.y=-ffe*FT;frame.add(root);frame.updateMatrixWorld(true);
    const world=root.children[0].getWorldPosition(new THREE.Vector3());
    close(world.y,3*FT);close(world.x,30*FT);close(world.z,-42*FT);
    assert.deepEqual(root.children[0].position.toArray(),before);
  }
});

test('PRIM3 applies its one canonical world frame to absolute feet without adding floor elevation again',()=>{
  const origin=HQ.modelToWorld(0,0,0),root=prepareWorkstationRoot(rawRoot(),catalog,{metresPerWorldUnit:HQ.WORLD_M,origin:[origin.X,origin.Y,origin.Z]});
  for(const mesh of root.userData.euWorkstationMeshes) {
    const want=HQ.modelToWorld(mesh.position.x*FT,mesh.position.y*FT,mesh.position.z*FT);
    const point=mesh.getWorldPosition(new THREE.Vector3());
    close(point.x,want.X);close(point.y,want.Y);close(point.z,want.Z);
  }
});

test('native monitor illumination reads the exact sandbox signal, stays dark when unavailable, and leaves hosts/mounts unchanged',()=>{
  const root=prepared(),before=new Map(root.userData.euWorkstationMeshes.map(m=>[m,m.material]));
  const fleet={byId:new Map([['F1-USER-WS-01',{}],['F6-USER-WS-01',{}]]),monitorStatus(host,monitor){return {video_connection:'exact',stage:monitor.startsWith('F1')?'OFF':'LOGIN',display:true};}};
  paintWorkstationMonitors(root,registry,fleet);
  for(const mesh of root.userData.euWorkstationMeshes) {
    if(mesh.userData.componentId!=='DISPLAY_PANEL')assert.equal(mesh.material,before.get(mesh));
    else assert.equal(mesh.userData.euMonitorState,mesh.userData.euAssemblyFloor==='F1'?'OFF':'LOGIN');
  }
  paintWorkstationMonitors(root,registry,null);
  for(const mesh of root.userData.euWorkstationMeshes.filter(m=>m.userData.componentId==='DISPLAY_PANEL')) {
    assert.equal(mesh.userData.euMonitorState,'UNKNOWN');assert.equal(mesh.material.emissiveIntensity,0);
    assert.equal(mesh.userData.euMonitorLabel,'Sandbox: State unavailable');
  }
});

test('loading coalesces, missing or incomplete assets fail closed, and retry does not duplicate roots',async()=>{
  const states=[],ready=[];let loads=0;
  const layer=createWorkstationLayer({loadAsset:async()=>{loads++;if(loads===1)throw Error('404');return {scene:rawRoot()};},
    loadCatalog:async()=>catalog,onStatus:state=>states.push(state),onReady:root=>ready.push(root)});
  const first=layer.ensure();assert.equal(layer.ensure(),first);await assert.rejects(first,/404/);
  assert.equal(layer.root,null);assert.equal(layer.status,'unavailable');assert.equal(ready.length,0);
  const root=await layer.ensure();assert.equal(await layer.ensure(),root);assert.equal(loads,2);assert.equal(ready.length,1);
  assert.deepEqual(states,['loading','unavailable','loading','ready']);
  const incomplete=createWorkstationLayer({loadAsset:async()=>({scene:new THREE.Group()}),loadCatalog:async()=>catalog,onReady:()=>assert.fail('partial model exposed')});
  await assert.rejects(incomplete.ensure(),/incomplete/);assert.equal(incomplete.root,null);
  const partial=rawRoot();partial.remove(partial.children.find(o=>o.userData.name==='F1-USER-MON-01-01::PART::STAND_OR_MOUNT'));
  assert.throws(()=>prepareWorkstationRoot(partial,catalog),/incomplete/);
  const duplicate=rawRoot();duplicate.add(duplicate.children[0].clone());assert.throws(()=>prepareWorkstationRoot(duplicate,catalog),/duplicate/);
});

function glb(file) {
  const bytes=readFileSync(new URL(file,ROOT));assert.equal(bytes.toString('ascii',0,4),'glTF');
  return {bytes,json:JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)))};
}
test('dedicated production GLB has every exact workstation/monitor component from the full fabric, no infrastructure',()=>{
  const catalog=JSON.parse(source(P+'electronics/generated/equity-uprise-device-components-v1.json'));
  const wanted=workstationCatalog(catalog), dedicated=glb(P+'electronics/generated/'+WORKSTATION_FILE), full=glb(P+'electronics/generated/equity-uprise-electronics-fabric-v1.glb');
  const real=dedicated.json.nodes.filter(n=>n.mesh!=null), originals=new Map(full.json.nodes.filter(n=>n.mesh!=null).map(n=>[n.name,n]));
  assert.deepEqual(real.map(n=>n.name).sort(),[...wanted.keys()].sort());
  assert.equal(new Set(real.map(n=>wanted.get(n.name).record.asset_id)).size,98);
  for(const node of real) {
    const original=originals.get(node.name);assert.ok(original,node.name);
    for(const key of ['matrix','translation','rotation','scale'])assert.deepEqual(node[key],original[key],node.name+' '+key);
    const bounds=(json,n)=>json.meshes[n.mesh].primitives.map(p=>({min:json.accessors[p.attributes.POSITION].min,max:json.accessors[p.attributes.POSITION].max,count:json.accessors[p.attributes.POSITION].count}));
    assert.deepEqual(bounds(dedicated.json,node),bounds(full.json,original),node.name+' geometry not moved');
  }
  assert.ok(real.length<full.json.nodes.length/5,'no all-cable node overhead');
  assert.ok(dedicated.bytes.length<full.bytes.length/3,'dedicated lightweight download');
});

test('real GLB per-instance transforms survive normal, standalone and game frames',()=>{
  const catalog=JSON.parse(source(P+'electronics/generated/equity-uprise-device-components-v1.json'));
  const {json}=glb(P+'electronics/generated/'+WORKSTATION_FILE);
  function tree() {
    const nodes=json.nodes.map(n=>{
      const o=new THREE.Object3D();o.name=n.name?.replaceAll(':','')||'';o.userData.name=n.name;
      if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale);}
      else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);}
      if(n.mesh!=null){o.isMesh=true;o.material=new THREE.MeshStandardMaterial();const a=json.accessors[json.meshes[n.mesh].primitives[0].attributes.POSITION];
        o.userData.testLocalCenter=new THREE.Vector3(...a.min).add(new THREE.Vector3(...a.max)).multiplyScalar(.5);}
      return o;
    });
    json.nodes.forEach((n,i)=>(n.children||[]).forEach(child=>nodes[i].add(nodes[child])));
    const root=new THREE.Group();for(const index of json.scenes[json.scene||0].nodes)root.add(nodes[index]);
    root.updateMatrixWorld(true);return root;
  }
  const native=tree(),points=new Map();native.traverse(o=>{if(o.isMesh)points.set(o.userData.name,o.userData.testLocalCenter.clone().applyMatrix4(o.matrixWorld));});
  for(const [unit,origin] of [[1,[0,0,0]],[HQ.WORLD_M,[HQ.modelToWorld(0,0,0).X,0,HQ.modelToWorld(0,0,0).Z]]]) {
    const root=prepareWorkstationRoot(tree(),catalog,{metresPerWorldUnit:unit,origin});
    for(const mesh of root.userData.euWorkstationMeshes){const p=points.get(mesh.name),world=mesh.userData.testLocalCenter.clone().applyMatrix4(mesh.matrixWorld);
      close(world.x,origin[0]+p.x*FT/unit);close(world.y,origin[1]+p.z*FT/unit);close(world.z,origin[2]-p.y*FT/unit);}
  }
  const levels=JSON.parse(source(P+'building-core-v2.json')).levels;
  for(const entry of levels.filter(l=>l.level<7)) {
    const root=prepareWorkstationRoot(tree(),catalog),frame=new THREE.Group();frame.position.y=-entry.finished_floor_elevation_ft*FT;frame.add(root);frame.updateMatrixWorld(true);
    const floor=entry.level===0?'B1':'F'+entry.level;syncWorkstationVisibility(root,{floorVisible:f=>f===floor});
    for(const mesh of root.userData.euWorkstationMeshes.filter(o=>o.visible)) {
      const p=points.get(mesh.name),world=mesh.userData.testLocalCenter.clone().applyMatrix4(mesh.matrixWorld);
      close(world.y,(p.z-entry.finished_floor_elevation_ft)*FT);
    }
  }
});

test('every viewer consumes the dedicated layer; game descriptor publishes it independently of architecture/Shared Fate',()=>{
  const stack=source('_unfinished/equity-uprise/equity-uprise-building-core-v2-3d.html');
  assert.match(stack,/ensureWorkstations\(\)\.catch/);assert.match(stack,/allowPlant=plantMode&&!roomMode/);
  assert.match(stack,/intersectObjects\(\[f1,workstations\]/);assert.match(stack,/effectivelyVisible\(o\)/);
  assert.match(stack,/currentFocus!=='facade'/);assert.match(stack,/Workstation models unavailable/);
  const demo=source('js/eu-screens/apps/building.mjs');assert.match(demo,/loadGlb\(q\(WORKSTATION_FILE\)\)/);assert.doesNotMatch(demo,/electronics-fabric-v1\.glb/);
  for(const [floor,stem,ffe] of [['B1','basement-b1',-13.5],...Array.from({length:6},(_,i)=>['F'+(i+1),'floor-0'+(i+1),i*13.5])]) {
    const viewer=source('_unfinished/equity-uprise/equity-uprise-'+stem+'-3d.html');
    assert.ok(viewer.includes(`floor:'${floor}',ffeFt:${ffe},getFloorRoot:()=>model`));
    assert.match(viewer,/Workstation models unavailable/);
  }
  assert.equal(HQ.MODEL.workstations.file,WORKSTATION_FILE);
  assert.equal(HQ.MODEL.parts.some(p=>p.file===WORKSTATION_FILE),false,'not merged into anonymous architecture meshes');
  const game=source('js/prim3-tactics/level3d.mjs');assert.match(game,/if \(!MODEL\?\.workstations\) return/);
  assert.match(game,/partState\.get\(part\) === 'ready'/);assert.match(game,/storey <= st/);
  assert.match(source('.github/workflows/deploy-pages.yml'),/cp .*equity-uprise-workstations-v1\.glb equity-uprise-preview\/equity-uprise-workstations-v1\.glb/);
});
