import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import * as THREE from '../../vendor/three.module.min.js';
import {usableViewport,boxCorners,visibleWorldBounds,fitPerspectiveBox,fovForPosition,applyCameraViewport,floorCutawayHeight} from '../../js/eu-screens/view-framing.mjs';
import {prepareWorkstationRoot,syncWorkstationVisibility,authoredName,effectivelyVisible} from '../../js/eu-screens/workstation-layer.mjs';
import {findStationView,STATION_SEATS} from '../e2e/fixtures/eu-building-visual.mjs';

const ROOT=new URL('../../',import.meta.url),P='docs/design/equity-uprise-building/production/';
const read=p=>readFileSync(new URL(p,ROOT));
const catalog=JSON.parse(read(P+'electronics/generated/equity-uprise-device-components-v1.json'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const rectFor=width=>usableViewport(width,900,width===390?
  [{left:0,top:640,right:390,bottom:900},{left:8,top:8,right:382,bottom:37}]:
  [{left:12,top:12,right:672,bottom:300},{left:1000,top:860,right:1428,bottom:888}]);
function projectBox(camera,box,width,height) {
  camera.updateMatrixWorld(true);
  return boxCorners(THREE,box).map(p=>{p.project(camera);return {x:(p.x+1)*width/2,y:(1-p.y)*height/2}});
}

test('HUD-safe overview fits all visible bounds at phone, desktop and rotated-phone aspects',()=>{
  for(const [width,height] of [[390,844],[1440,1000],[844,390]]){
    const rect=usableViewport(width,height,[{left:0,top:height*.72,right:width,bottom:height},{left:8,top:8,right:width-8,bottom:38}]);
    for(const y of [-13.5,0,27,81]){
      const box=new THREE.Box3(new THREE.Vector3(0,y*.3048,-72*.3048),new THREE.Vector3(72*.3048,(y+7.5)*.3048,0));
      const camera=new THREE.PerspectiveCamera(52,width/height,.02,150),controls={target:new THREE.Vector3(),minDistance:.35,maxDistance:79,update(){}};
      const result=fitPerspectiveBox(THREE,{camera,controls,box,width,height,rect});
      for(const p of projectBox(camera,box,width,height)){
        assert.ok(p.x>=rect.left&&p.x<=rect.right,JSON.stringify({width,height,p,rect}));
        assert.ok(p.y>=rect.top&&p.y<=rect.bottom,JSON.stringify({width,height,p,rect}));
      }
      assert.ok(result.distance<=controls.maxDistance,'OrbitControls must not clamp the fitted camera');
    }
  }
});

test('floor presentation clipping is reversible for every mode and leaves authored geometry untouched',()=>{
  for(let level=0;level<=6;level++){
    const state={focus:String(level),room:false,plant:false,xray:false,services:false,cabling:false};
    const y=floorCutawayHeight(state);near(y,((level-1)*13.5+7.5)*.3048);
    for(const mode of ['room','plant','xray','services','cabling'])assert.equal(floorCutawayHeight({...state,[mode]:true}),null,mode);
    for(const focus of ['stack','facade','7'])assert.equal(floorCutawayHeight({...state,focus}),null,focus);
    const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,4,2));mesh.position.y=y-1;root.add(mesh);
    const positions=Array.from(mesh.geometry.attributes.position.array);
    const full=visibleWorldBounds(THREE,root),cut=visibleWorldBounds(THREE,root,y);near(cut.max.y,y);assert.ok(full.max.y>y);
    assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),positions);assert.equal(mesh.visible,true);
    assert.deepEqual(mesh.matrix.toArray(),new THREE.Matrix4().compose(mesh.position,mesh.quaternion,mesh.scale).toArray());
    assert.deepEqual(visibleWorldBounds(THREE,root),full,'full bounds return after presentation clipping ends');
  }
  const html=read('_unfinished/equity-uprise/equity-uprise-building-core-v2-3d.html').toString();
  assert.match(html,/ren\.clippingPlanes=\[\]/);assert.match(html,/ren\.clippingPlanes=\[floorCutPlane\]/);
  assert.match(html,/upper walls \/ ceilings clipped at 7\.5 ft/);
  assert.match(html,/ctl\.minDistance=\/\^\[0-7\]\$\/.test\(currentFocus\)\?\.35:ft\(15\)/);
  assert.match(html,/cam\.clearViewOffset\(\);cam\.fov=52/);
});

// Real uncompressed glTF triangle data, including every native node transform. No boxes/proxies
// substitute for obstruction tests. Materials are two-sided to reject even back-facing walls.
function realGlb(path) {
  const bytes=read(path),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length)),bin=bytes.subarray(28+length);
  function accessor(index) {
    const a=json.accessors[index],view=json.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    const type={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array}[a.componentType],out=new type(a.count*size);
    const data=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),step=view.byteStride||size*type.BYTES_PER_ELEMENT;
    const method={5121:'getUint8',5123:'getUint16',5125:'getUint32',5126:'getFloat32'}[a.componentType];
    for(let i=0;i<a.count;i++)for(let k=0;k<size;k++)out[i*size+k]=data[method]((view.byteOffset||0)+(a.byteOffset||0)+i*step+k*type.BYTES_PER_ELEMENT,true);
    return new THREE.BufferAttribute(out,size);
  }
  const geometries=json.meshes.map(m=>{
    assert.equal(m.primitives.length,1,'test requires exact triangle primitive support');const p=m.primitives[0],g=new THREE.BufferGeometry();
    g.setAttribute('position',accessor(p.attributes.POSITION));if(p.indices!=null)g.setIndex(accessor(p.indices));g.computeBoundingBox();return g;
  });
  const nodes=json.nodes.map(n=>{
    const o=n.mesh==null?new THREE.Group():new THREE.Mesh(geometries[n.mesh],new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    o.name=n.name||'';o.userData.name=n.name;
    if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale)}
    else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale)}
    return o;
  });
  json.nodes.forEach((n,i)=>(n.children||[]).forEach(child=>nodes[i].add(nodes[child])));
  const root=new THREE.Group();for(const i of json.scenes[json.scene||0].nodes)root.add(nodes[i]);return root;
}

const missingGeneratedFloors=Array.from({length:7},(_,level)=>`equity-uprise-${level===0?'basement-b1':`floor-0${level}`}-core-v2.glb`)
  .filter(name=>!existsSync(new URL(P+'generated/'+name,ROOT)));
test('actual authored chair-side cameras clear the complete floor triangles on every floor at both widths',
  {skip:!process.env.EU_VISUAL_REQUIRE_GENERATED&&missingGeneratedFloors.length?
    'Generated floor inputs absent; run canonical builders or required visual CI: '+missingGeneratedFloors.join(', '):false},()=>{
  for(let level=0;level<=6;level++){
    const floor=level===0?'B1':'F'+level,stem=level===0?'basement-b1':`floor-0${level}`;
    const path=P+`generated/equity-uprise-${stem}-core-v2.glb`;
    assert.ok(existsSync(new URL(path,ROOT)),'Run canonical floor builders before visual geometry tests: '+path);
    const architecture=realGlb(path);architecture.rotation.x=-Math.PI/2;architecture.position.y=(level-1)*13.5*.3048;architecture.updateMatrixWorld(true);
    // Same explicit duplicated-core visibility policy as the canonical isolated-floor viewer.
    architecture.traverse(o=>{if(level>=1&&level<=6&&o.isMesh&&(level===1?/^(stair_|passenger_|freight_|mep)/i:/^(stair_|pass_|freight_|mep)/i).test(o.name))o.visible=false});
    const native=prepareWorkstationRoot(realGlb(P+'electronics/generated/equity-uprise-workstations-v1.glb'),catalog);
    syncWorkstationVisibility(native,{floorVisible:f=>f===floor});native.updateMatrixWorld(true);
    const id=floor+'-USER-WS-01',record=catalog.devices.find(d=>d.asset_id===id),station=record.support_binding.station_id;
    const boxes=new Map(),obstacles=[],targets=[];let seat;
    architecture.traverse(o=>{if(o.isMesh&&effectivelyVisible(o)){obstacles.push(o);if(authoredName(o)===STATION_SEATS[id])seat=new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())}});
    native.traverse(o=>{if(!o.isMesh||!effectivelyVisible(o))return;obstacles.push(o);const r=o.userData.euDeviceRecord;
      if(r.support_binding?.station_id===station){if(!boxes.has(r.asset_id))boxes.set(r.asset_id,new THREE.Box3());boxes.get(r.asset_id).union(new THREE.Box3().setFromObject(o));if(authoredName(o)===r.asset_id)targets.push({id:r.asset_id,point:new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())})}});
    assert.ok(seat,'exact seat '+STATION_SEATS[id]);assert.ok(targets.length>=2,'host and monitor must each be visible');
    for(const width of [390,1440])for(const target of targets){
      const box=boxes.get(target.id),rect=rectFor(width),view=findStationView(THREE,{box,seat,ffe:(level-1)*13.5*.3048,targets:[target],obstacles,width,height:900,rect,fovForPosition});
      assert.ok(view.clear(view.position),floor+' '+width+' real triangle sightlines');
      assert.ok(view.fov<=100&&view.position.distanceTo(box.getCenter(new THREE.Vector3()))>=.35,'no OrbitControls clamp');
      const camera=new THREE.PerspectiveCamera(view.fov,width/900,.02,200);camera.position.copy(view.position);camera.lookAt(box.getCenter(new THREE.Vector3()));applyCameraViewport(camera,width,900,rect);
      for(const p of projectBox(camera,box,width,900)){assert.ok(p.x>=rect.left&&p.x<=rect.right,floor+' horizontal fit');assert.ok(p.y>=rect.top&&p.y<=rect.bottom,floor+' vertical fit');}
    }
  }
});
