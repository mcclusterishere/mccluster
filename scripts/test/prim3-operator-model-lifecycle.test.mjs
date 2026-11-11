import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Exercise the renderer's actual asynchronous loader without needing WebGL.
// Only fetch/GLTF decoding and scene objects are doubles; actor replacement is
// the production function, so the old clear-and-recreate implementation fails.
const renderer=await readFile(new URL('../../js/prim3-tactics/level3d.mjs',import.meta.url),'utf8');
const loader=renderer.slice(renderer.indexOf('  async function loadModels() {'),renderer.indexOf('  /* ---------- the White Industrial kit:'))
 .replace("const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');",'');
const load= new Function('fetch','MODEL_ROOT','GLTFLoader','glbs','actors','unitsGroup','makeActor','update','model','destroyed',`let needs=false; ${loader}; return loadModels().then(()=>needs);`);
function group(...children){return {children,position:{x:2,y:0,z:3},rotation:{x:0,y:0.4,z:0},clear(){this.children=[];},add(...items){this.children.push(...items);}};}
async function fixture({fail=false,destroyed=false}={}){
 let resolveModel;const pending=new Promise(resolve=>{resolveModel=resolve;});
 let calls=0;
 const walk={pts:[{x:2,y:3},{x:8,y:3}],t:0.25,done:()=>calls++};
 const actor={unit:{id:'T1',role:'T',faction:'PLAYER'},g:group('stand-in'),rig:{glb:false},walk,dying:{t:0.3,remove:false},face:1.2,aim:0.4};
 const actors=new Map([['T1',actor]]),glbs={},scene=group(actor.g),model={units:[actor.unit]};
 const makeActor=u=>({unit:u,g:group('authored model','halo'),rig:{glb:true},walk:null,dying:null});
 scene.remove=g=>{scene.children=scene.children.filter(child=>child!==g);};
 const update=()=>{for(const u of model.units)if(!actors.has(u.id)){const a=makeActor(u);actors.set(u.id,a);scene.add(a.g);}};
 const running=load(async()=>({ok:true,json:async()=>({models:{T:'T.glb'}})}),new URL('https://local.test/operators/'),class{async loadAsync(){await pending;if(fail)throw Error('model unavailable');return {scene:'decoded'};}},glbs,actors,scene,makeActor,update,model,destroyed);
 resolveModel();const redraw=await running;
 return {actor,actors,walk,scene,redraw,calls:()=>calls};
}
test('late operator models preserve a live walk, its callback, group and pose',async()=>{
 const f=await fixture(),a=f.actors.get('T1');
 assert.equal(a,f.actor,'model arrival must not replace the actor owning the pending callback');
 assert.equal(a.walk,f.walk);assert.equal(a.g,f.scene.children[0]);
 assert.deepEqual(a.g.children,['authored model','halo']);assert.equal(a.rig.glb,true);
 assert.deepEqual(a.g.position,{x:2,y:0,z:3});assert.equal(a.g.rotation.y,0.4);
 assert.deepEqual(a.dying,{t:0.3,remove:false});assert.equal(a.face,1.2);assert.equal(a.aim,0.4);
 a.walk.done();assert.equal(f.calls(),1,'the normal animation can still acknowledge completion');
 assert.equal(f.redraw,true);
});
test('failed model loads keep the current visual and in-flight animation',async()=>{
 const f=await fixture({fail:true}),a=f.actors.get('T1');
 assert.equal(a,f.actor);assert.equal(a.walk,f.walk);assert.deepEqual(a.g.children,['stand-in']);assert.equal(a.rig.glb,false);
});
test('a destroyed renderer is not changed when a model finishes loading',async()=>{
 const f=await fixture({destroyed:true});assert.equal(f.actors.get('T1'),f.actor);assert.deepEqual(f.actor.g.children,['stand-in']);assert.equal(f.redraw,false);
});
