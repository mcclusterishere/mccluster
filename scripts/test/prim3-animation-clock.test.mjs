import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Run the production frame loop with a controlled RAF clock. GPU drawing and
// scene objects are doubles; interpolation, busy state and walk ownership are not.
const source=await readFile(new URL('../../js/prim3-tactics/level3d.mjs',import.meta.url),'utf8');
const begin=source.indexOf('  let model = null, needs = true, t0 = performance.now()');
const end=source.indexOf('\n  raf = requestAnimationFrame(frame);\n',begin);
assert.ok(begin>=0&&end>begin,'production frame-loop boundary');
const loop=source.slice(begin,end);
const activeMethod=source.slice(source.indexOf('    setActive(on) {'),source.indexOf('    zoom(step) {'));
const create=new Function('env',`let viewAt=0; const {THREE,scene,camera,view,showcase,reducedMotion,actors,unitsGroup,M,kit,waterNormal,beacon,OBJ,beaconY,rain,cx,cz,placeCamera,composer,renderer,placeLabels,onView,destroyed,requestAnimationFrame,performance,stepFire}=env;
${loop}
return {frame,get busy(){return busy;},${activeMethod}};`);
function vector(x=0,y=0,z=0){return {x,y,z,set(x,y,z){Object.assign(this,{x,y,z});return this;},distanceToSquared(v){return (v.x-this.x)**2+(v.y-this.y)**2+(v.z-this.z)**2;},lerp(v,k){this.x+=(v.x-this.x)*k;this.y+=(v.y-this.y)*k;this.z+=(v.z-this.z)*k;return this;}};}
function fixture({reducedMotion=false}={}){
 let completions=0,now=0,draws=0;
 const actor={g:{position:vector(19,0.02,30),rotation:{x:0,y:0}},walk:{pts:Array.from({length:7},(_,i)=>({x:19,y:30-i,h:0})),t:0,at:0,done:()=>completions++},walkAmt:0,phase:0,crouch:0,crouchGoal:0,face:0,faceGoal:0,restFace:0,recoil:0,flinch:0,dying:null,rig:{glb:true}};
 const view={target:vector(16,0,16),goal:vector(19,0,31.1),dist:30,distGoal:22,pitch:0.86,pitchGoal:0.86,yaw:0,yawGoal:0};
 const noop=()=>{};
 const clock=create({THREE:{Group:class{}},scene:{add:noop},camera:{},view,showcase:false,reducedMotion,unitsGroup:{remove:noop},actors:new Map([['T1',actor]]),M:m=>m/3.54,kit:{pose:noop},waterNormal:{offset:{x:0,y:0}},beacon:{rotation:{y:0}},OBJ:null,beaconY:()=>0,rain:{visible:false},cx:16,cz:16,placeCamera:noop,composer:null,renderer:{render:()=>draws++},placeLabels:noop,onView:null,destroyed:false,requestAnimationFrame:()=>1,performance:{now:()=>now},stepFire:noop});
 const frame=clock.frame;clock.frame=at=>{now=at;frame(at);};
 return {clock,actor,view,at:at=>{now=at;},draws:()=>draws,completions:()=>completions};
}
for(const frameMs of [1000/60,1000,3000,9000])test(`a six-tile move settles on elapsed time with ${frameMs}ms frames`,()=>{
 const f=fixture();
 for(let now=frameMs;now<=9000+1e-6;now+=frameMs)f.clock.frame(now);
 assert.equal(f.actor.walk,null,'render cadence must not stretch a resolved move indefinitely');
 assert.equal(f.completions(),1,'complete the move exactly once');
 assert.equal(f.clock.busy,false,'the camera and walk fade must settle too');
 assert.deepEqual([f.actor.g.position.x,f.actor.g.position.y,f.actor.g.position.z],[19,0.02,24]);
 assert.ok(f.view.target.distanceToSquared(f.view.goal)<=1e-5);
});

test('irregular sparse frames draw the final pose and release busy without extra frames',()=>{
 const f=fixture();for(const now of [16,33,50,9050])f.clock.frame(now);
 assert.equal(f.actor.walk,null);assert.equal(f.actor.walkAmt,0);assert.equal(f.clock.busy,false);
 assert.equal(f.completions(),1);assert.equal(f.draws(),4);
 f.clock.frame(18050);assert.equal(f.completions(),1);
});
test('a new walk cannot inherit an idle gap before it was started',()=>{
 const f=fixture();f.actor.walk.at=8990;f.clock.frame(9000);
 assert.ok(f.actor.walk.t>0&&f.actor.walk.t<0.03);assert.equal(f.completions(),0);
 f.clock.frame(18000);assert.equal(f.actor.walk,null);assert.equal(f.clock.busy,false);assert.equal(f.completions(),1);
});
test('explicit renderer suspension pauses finite animations',()=>{
 const f=fixture();f.clock.frame(100);const progress=f.actor.walk.t;
 f.at(100);f.clock.setActive(false);f.clock.frame(10000);assert.equal(f.actor.walk.t,progress);
 f.at(10000);f.clock.setActive(true);f.clock.frame(10100);
 assert.ok(Math.abs(f.actor.walk.t-2*progress)<1e-9);assert.equal(f.completions(),0);
 f.clock.frame(14000);assert.equal(f.actor.walk,null);assert.equal(f.completions(),1);
});

test('work created during explicit suspension begins at resume, not in the future',()=>{
 const f=fixture();f.at(1000);f.clock.setActive(false);f.actor.walk.at=9000;
 f.at(10000);f.clock.setActive(true);f.clock.frame(10100);
 assert.ok(f.actor.walk.t>0&&f.actor.walk.t<0.22);assert.equal(f.completions(),0);
 f.clock.frame(14000);assert.equal(f.actor.walk,null);assert.equal(f.completions(),1);
});
test('a sparse final death frame draws even with reduced motion',()=>{
 const f=fixture({reducedMotion:true});f.actor.walk=null;f.actor.dying={at:0,t:0,remove:true};
 f.clock.frame(100);assert.equal(f.draws(),1);
 f.clock.frame(9000);assert.equal(f.draws(),2);assert.equal(f.clock.busy,false);
 assert.ok(f.actor.g.rotation.x<-1.4);
});

// Exercise the production shot queue as well: a queued shot owns its clock only
// once activated, rather than inheriting another shot's or an idle frame's time.
const shotSource=source.slice(source.indexOf('  const wp = new THREE.Vector3();'),source.indexOf("  /* ---------- update from the page's board model"));
const createShots=new Function('env',`const {THREE,actors,M,reducedMotion,performance,burst,tracer}=env;
let fireQueue=[],fireAnim=null,shotCam=null,needs=false;${shotSource}
return {enqueue(s){fireQueue.push(s);},step:stepFire,get current(){return fireAnim;}};`);
function shotVector(x=0,y=0,z=0){const v=vector(x,y,z);return Object.assign(v,{clone(){return shotVector(this.x,this.y,this.z);},add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;},addScaledVector(v,k){this.x+=v.x*k;this.y+=v.y*k;this.z+=v.z*k;return this;}});}
test('queued shots finish exactly once without inheriting pre-activation elapsed time',()=>{
 let now=0;const done=[];
 const actor=(x)=>({g:{position:shotVector(x,0,0)},crouch:0,aim:0,restFace:0});
 const a=actor(0),b=actor(1);
 const shots=createShots({THREE:{Vector3:shotVector},actors:new Map([['a',a],['b',b]]),M:m=>m/3.54,reducedMotion:false,performance:{now:()=>now},burst(){},tracer(){}});
 for(const id of [1,2])shots.enqueue({attackerId:'a',targetId:'b',result:{hit:true,killed:false},cinematic:false,done:()=>done.push(id)});
 const advance=at=>{now=at;shots.step(0.25,at);};
 advance(10000);assert.equal(shots.current.t,0);assert.deepEqual(done,[]);
 advance(12000);assert.equal(shots.current,null);assert.deepEqual(done,[1]);
 advance(20000);assert.equal(shots.current.t,0);assert.deepEqual(done,[1]);
 advance(22000);assert.equal(shots.current,null);assert.deepEqual(done,[1,2]);
 advance(30000);assert.deepEqual(done,[1,2]);
});
