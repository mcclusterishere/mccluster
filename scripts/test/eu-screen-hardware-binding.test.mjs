import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildComputerCatalog, ComputerFleet } from '../../docs/design/equity-uprise-building/production/lab-runtime/equity-uprise-computer-hardware.mjs';
import { ElectronicsSandbox } from '../../docs/design/equity-uprise-building/production/lab-runtime/equity-uprise-electronics-sandbox.mjs';
import { screenForName, createScreenHooks } from '../../js/eu-screens/enter.mjs';
const p = new URL('../../docs/design/equity-uprise-building/production/', import.meta.url);
const j = path => JSON.parse(readFileSync(new URL(path,p),'utf8'));
const registry = j('asset-registry/generated/equity-uprise-asset-registry-v1.json');
const connections = j('electronics/generated/equity-uprise-electronics-connections-v1.json');
const screens = JSON.parse(readFileSync(new URL('../../screens/data/screen-registry-v1.json',import.meta.url),'utf8'));
const manifest = j('electronics/generated/equity-uprise-electronics-manifest-v1.json');
const catalog = buildComputerCatalog({registry,connections,screens,profile:j('lab-runtime/computer-hardware-profile-v1.json'),serverHardware:j('electronics/server-lab-hardware-v1.json')});
function fleet() { const session={}; return new ComputerFleet({catalog,sandbox:new ElectronicsSandbox({registry,connections,manifest}),readSession:()=>session,persist:()=>{},mode:'TRAINING'}); }
test('every canonical monitor has one exact healthy host cable regardless of app kind',()=>{
 const f=fleet(); const monitors=screens.screens.filter(s=>s.asset_type==='monitor');assert.equal(monitors.length,62);
 for(const s of monitors){const st=f.monitorStatus(s.network_asset_id,s.asset_id);assert.ok(st.video_connection,s.screen_id);assert.equal(st.display,true,s.screen_id);}
});
test('disconnecting one monitor does not disable its sibling or masquerade as healthy',()=>{
 const f=fleet(),c=catalog.find(c=>c.ports.filter(p=>p.kind==='video').length===2),[a,b]=c.ports.filter(p=>p.kind==='video');
 assert.equal(f.act(c.id,{type:'disconnect',port:a.id}).accepted,true);
 assert.equal(f.monitorStatus(c.id,a.peer).display,false);assert.equal(f.monitorStatus(c.id,b.peer).display,true);
 assert.equal(f.monitorStatus(c.id,'missing').display,false);
});
test('headless equipment has no display signal',()=>{const f=fleet(),headless=catalog.filter(c=>!c.ports.some(p=>p.kind==='video'));assert.equal(headless.length,6);for(const c of headless) assert.equal(f.status(c.id).display,false);});
test('ambiguous family names are not silently assigned to an instance',()=>{const registry={screens:[{asset_id:'A-I1',mesh_node_prefix:'A'},{asset_id:'A-I2',mesh_node_prefix:'A'}]};assert.equal(screenForName(registry,'A::case'),null);assert.equal(screenForName(registry,'A-I2::case').asset_id,'A-I2');});
test('no fabricated fallback display geometry for any canonical record',()=>{
 const hooks=createScreenHooks({THREE:{Raycaster:class{},Vector2:class{}},registry:screens});
 for(const floor of new Set(screens.screens.map(s=>s.floor))) assert.deepEqual(hooks.addProxies(floor,{add(){throw Error('invented geometry');}},{all:true}),[]);
});
test('hidden ancestor cannot be picked and exact instance mesh binds correctly',()=>{
 let targets=[]; const registry={screens:[{screen_id:'one',floor:'B1',asset_id:'A-I1',mesh_node_prefix:'A'},{screen_id:'two',floor:'B1',asset_id:'A-I2',mesh_node_prefix:'A'}]};
 const mesh={isMesh:true,name:'A-I2::case',userData:{},visible:true,parent:{visible:false}};
 const hooks=createScreenHooks({THREE:{Raycaster:class{setFromCamera(){} intersectObjects(t){targets=t;return t.map(object=>({object}));}},Vector2:class{set(){}}},registry});
 hooks.bindFloor('B1',{traverse(fn){fn(mesh);}});assert.equal(mesh.userData.euScreenId,'two');assert.equal(hooks.pickNdc(0,0),null);assert.equal(targets.length,0);
 mesh.parent.visible=true;assert.equal(hooks.pickNdc(0,0).screen_id,'two');
});

test('full canonical electronics GLB binds every physical monitor, never its receptacle',()=>{
 const bytes=readFileSync(new URL('electronics/generated/equity-uprise-electronics-fabric-v1.glb',p));
 assert.equal(bytes.toString('ascii',0,4),'glTF');
 const glb=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
 const parent={visible:true};
 const meshes=glb.nodes.filter(n=>n.mesh!==undefined).map(n=>({isMesh:true,name:n.name.replaceAll(':',''),userData:{name:n.name},visible:true,parent,node:n}));
 const root={traverse(fn){meshes.forEach(fn);}};
 const hooks=createScreenHooks({THREE:{Raycaster:class{},Vector2:class{}},registry:screens});
 for(const floor of Object.keys(screens.floors)) hooks.bindFloor(floor,root);
 for(const s of screens.screens.filter(s=>s.asset_type==='monitor')) {
   const bound=hooks.bound.get(s.screen_id)||[];
   assert.equal(bound.length,2,s.asset_id+' binds face and bezel only');
   assert.deepEqual(bound.map(m=>m.userData.name).sort(),[s.asset_id,s.asset_id+'::PART::BEZEL'].sort());
   assert.ok(meshes.some(m=>m.userData.name===s.asset_id+'::PART::STAND_OR_MOUNT'),s.asset_id+' has physical mount');
   const face=bound.find(m=>m.userData.name===s.asset_id);
   const accessor=glb.accessors[glb.meshes[face.node.mesh].primitives[0].attributes.POSITION];
   const center=accessor.min.map((v,i)=>(v+accessor.max[i])/2);
   assert.ok(Math.abs(center[0]-s.position.x)<2,s.asset_id+' native X aligned');
   assert.ok(Math.abs(center[1]-s.position.y)<2,s.asset_id+' native Y aligned');
   assert.ok(Math.abs(center[2]-s.position.z_abs)<2,s.asset_id+' native absolute elevation aligned');
 }
 assert.equal(meshes.filter(m=>m.userData.name.includes('::PWR-OUTLET::')&&m.userData.euScreenId).length,0);
 const before=hooks.targets().length;
 for(const floor of Object.keys(screens.floors)) hooks.bindFloor(floor,root);
 assert.equal(hooks.targets().length,before,'rebinding is idempotent');
 parent.visible=false;assert.equal(hooks.targets().length,0,'hidden fabric cannot be picked');
});

const { monitorVisualState } = await import('../../js/eu-screens/monitor-visual-state.mjs');
test('canonical 62 monitor visual states follow exact host boot/login without advancing it',()=>{
 const f=fleet(), monitors=screens.screens.filter(s=>s.asset_type==='monitor');
 for (const host of new Set(monitors.map(s=>s.network_asset_id))) {
   const attached=monitors.filter(s=>s.network_asset_id===host);
   const check=state=>{for(const s of attached) assert.equal(monitorVisualState(f,s).state,state,s.asset_id);};
   check('ON');f.act(host,{type:'shutdown'});check('OFF');
   f.act(host,{type:'power_on'});check('BOOT');
   for(let i=0;i<2;i++){f.act(host,{type:'advance'});check('BOOT');}
   f.act(host,{type:'advance'});check('LOGIN');
   for(const s of attached) monitorVisualState(f,s);
   assert.equal(f.status(host).stage,'LOGIN','rendering never signs in');
   f.act(host,{type:'sign_in',user:'operator'});check('ON');
 }
});
test('visual signal failures stay per-monitor and unresolved state never displays healthy',()=>{
 const f=fleet(),c=catalog.find(c=>c.ports.filter(p=>p.kind==='video').length===2),[a,b]=c.ports.filter(p=>p.kind==='video');
 const sa=screens.screens.find(s=>s.asset_id===a.peer),sb=screens.screens.find(s=>s.asset_id===b.peer);
 f.act(c.id,{type:'disconnect',port:a.id});
 assert.equal(monitorVisualState(f,sa).state,'NO_SIGNAL');assert.equal(monitorVisualState(f,sb).state,'ON');
 assert.equal(monitorVisualState(null,sa).state,'UNKNOWN');
 assert.equal(monitorVisualState(f,{...sa,asset_id:'missing'}).state,'UNKNOWN');
 assert.equal(monitorVisualState(f,{...sa,asset_type:'headless'}).state,'UNKNOWN');
});
