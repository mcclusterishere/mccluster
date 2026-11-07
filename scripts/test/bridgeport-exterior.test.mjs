import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {advanceExterior,travelClear} from '../../js/spatial/exterior-controls.mjs';
import {clearEdge,restorePosition} from '../../js/spatial/region-graph.mjs';
import {avatarModel} from '../../js/spatial/exterior-avatar.mjs';
const region=JSON.parse(readFileSync('data/spatial/bridgeport-downtown.v2.json','utf8'));
test('manual walking uses the canonical swept collision and keeps the pinned floor',()=>{
 const before=JSON.stringify(region);let accepted=0,rejected=0;
 for(const n of region.graphs.hex.nodes.filter((_,i)=>i%20===0))for(const heading of [0,Math.PI/2,Math.PI,3*Math.PI/2]){
  const next={x:n.position.x+Math.sin(heading)*.3,y:0,z:n.position.z-Math.cos(heading)*.3};
  const result=advanceExterior(region,n.position,heading,'walk',.3);
  assert.equal(!!result,clearEdge(region,n.position,next));if(result){accepted++;assert.deepEqual(result,next);}else rejected++;
 }
 assert.ok(accepted&&rejected);assert.equal(JSON.stringify(region),before);
});
test('bicycle body cannot use every foot clearance; closed roads and footprints reject movement',()=>{
 const narrow=region.graphs.hex.nodes.find(n=>travelClear(region,n.position,n.position,'walk')&&!travelClear(region,n.position,n.position,'bike'));assert.ok(narrow);
 assert.equal(advanceExterior(region,narrow.position,0,'bike',0),null);
 const broad=region.graphs.hex.nodes.find(n=>travelClear(region,n.position,n.position,'bike'));assert.ok(broad);
 assert.equal(travelClear(region,broad.position,broad.position,'bike',region.roads.map(r=>r.id)),false);
 const ring=region.buildings[0].rings[0],inside={x:ring.reduce((s,p)=>s+p.x,0)/ring.length,y:0,z:ring.reduce((s,p)=>s+p.z,0)/ring.length};
 assert.equal(travelClear(region,broad.position,inside,'walk'),false);
 assert.equal(advanceExterior(region,broad.position,NaN,'walk',.2),null);
 assert.equal(advanceExterior(region,broad.position,0,'walk',10),null);
});
test('continuous shared pose remains readable by the original revision-pinned save reader',()=>{
 const n=region.graphs.hex.nodes.find(n=>advanceExterior(region,n.position,0,'walk',.1));
 const position=advanceExterior(region,n.position,0,'walk',.1),c=region.contract;
 assert.ok(restorePosition(region,{schema:c.state.schema,regionId:c.id,revision:c.revision,frameId:c.frame.id,floorId:'street',position,topology:'hex'}));
});
test('original player and bicycle models are self-contained glTF with bounded finite geometry',()=>{
 for(const bike of [false,true]){const gltf=JSON.parse(Buffer.from(avatarModel(bike).split(',')[1],'base64').toString());assert.equal(gltf.asset.version,'2.0');assert.ok(gltf.accessors[0].count<2000);assert.ok(gltf.accessors[0].min.every(Number.isFinite));assert.equal(Buffer.from(gltf.buffers[0].uri.split(',')[1],'base64').length,gltf.buffers[0].byteLength);}
});
test('a legal walk graph edge can be refused for bicycle clearance without changing the graph',()=>{
 const nodes=new Map(region.graphs.hex.nodes.map(n=>[n.id,n]));let found=false;
 for(const a of nodes.values()){for(const edge of a.edges){const b=nodes.get(edge.to);if(travelClear(region,a.position,b.position,'walk')&&!travelClear(region,a.position,b.position,'bike')){found=true;assert.equal(clearEdge(region,a.position,b.position),true);break;}}if(found)break;}
 assert.equal(found,true);
});
test('camera handoff cancels entry flights before capturing input state and leaves map flights alone',async()=>{
 const {mountExterior}=await import('../../js/spatial/exterior-controls.mjs');
 const previous={document:globalThis.document,window:globalThis.window};
 const select=()=>({disabled:false,value:'',blur(){}}),camera=select(),travel=select();
 const controls={dataset:{},querySelector:s=>s.includes('camera')?camera:travel,querySelectorAll:s=>s==='[data-drive]'?[]:[camera,travel],remove(){}};
 const style={remove(){}};let created=0,cancels=0;const controller={enableInputs:false};
 const viewer={scene:{screenSpaceCameraController:controller},camera:{flight:true,cancelFlight(){cancels++;if(this.flight)controller.enableInputs=true;this.flight=false;},lookAtTransform(){}}};
 globalThis.document={hidden:false,createElement:()=>created++===0?controls:style,head:{append(){}},addEventListener(){},removeEventListener(){}};
 globalThis.window={addEventListener(){},removeEventListener(){}};
 try{
  const panel={dataset:{},querySelector:s=>s==='strong'?{after(){}}:{click(){}}};
  const control=mountExterior({panel,viewer,C:{Matrix4:{IDENTITY:{}}},state:()=>({owner:true,region:{},position:{x:0,y:0,z:0},actor:null}),move(){},interrupt(){},save(){},status(){}});
  control.attach();camera.onchange({target:{value:'close',blur(){}}});assert.equal(controller.enableInputs,false);assert.equal(cancels,1);
  camera.onchange({target:{value:'overview',blur(){}}});assert.equal(controller.enableInputs,true);
  const before=cancels;viewer.camera.flight=true;control.detach();assert.equal(cancels,before,'unloading in Map must not cancel a globe flight');
  control.attach();camera.onchange({target:{value:'first',blur(){}}});assert.equal(controller.enableInputs,false);control.detach();assert.equal(controller.enableInputs,true);control.destroy();
 }finally{globalThis.document=previous.document;globalThis.window=previous.window;}
});
